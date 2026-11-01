'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../.github/scripts/auto-merge.cjs');

function fixture({ draft = false, mergeable = true, mergeable_state = 'clean', checkStatus = 'success', resolveAfter = 0, fork = false, external = false, dryRun = false, include, exclude, expected, directAllowed = false } = {}) {
  const calls = { merges: [], ready: [], logs: [], warnings: [], failures: [], probes: [], pullGets: 0 };
  const owner = 'Dav-lopez', repo = 'sample';
  const repository = { name: repo, full_name: owner + '/' + repo, owner: { login: owner }, archived: false, disabled: false, fork };
  const pr = { state: 'open', merged: false, number: 7, node_id: 'PR_node', head: { sha: 'deadbeef', repo: { full_name: external ? 'other/sample' : repository.full_name } }, draft, mergeable, mergeable_state };
  const github = {
    rest: {
      repos: {
        listForAuthenticatedUser: () => {},
        get: async ({ owner, repo: requested }) => {
          calls.probes.push(requested);
          if (!directAllowed) { const error = new Error('Not Found'); error.status = 404; throw error; }
          return { data: { name: requested, full_name: owner + '/' + requested, owner: { login: owner }, archived: false, disabled: false, fork: false } };
        },
        getCombinedStatusForRef: async () => ({ data: { statuses: [] } }),
      },
      pulls: {
        list: () => {},
        get: async () => { calls.pullGets++; if (resolveAfter && calls.pullGets >= resolveAfter) pr.mergeable = true; return { data: pr }; },
        merge: async (args) => { calls.merges.push(args); return { data: { merged: true } }; },
      },
      checks: { listForRef: () => {} },
    },
    paginate: async (func) => {
      if (func === github.rest.repos.listForAuthenticatedUser) return [repository];
      if (func === github.rest.pulls.list) return [{ number: 7 }];
      if (func === github.rest.checks.listForRef) return checkStatus === 'none' ? [] : [{ name: 'unit-tests', status: checkStatus === 'pending' ? 'in_progress' : 'completed', conclusion: checkStatus === 'pending' ? null : checkStatus }];
      throw new Error('Unexpected paginate call');
    },
    graphql: async (q, values) => { calls.ready.push(values.id); pr.draft = false; return {}; },
  };
  const core = { info: message => calls.logs.push(message), warning: message => calls.warnings.push(message), setFailed: message => calls.failures.push(message) };
  return { calls, task: { github, core, owner, dryRun, include, exclude, expected, sleep: async () => {} }, pr };
}

test('squash merges clean ready PR with exact head SHA', async () => {
  const { task, calls } = fixture();
  const result = await run(task);
  assert.equal(result.merged, 1);
  assert.deepEqual(calls.merges, [{ owner: 'Dav-lopez', repo: 'sample', pull_number: 7, sha: 'deadbeef', merge_method: 'squash' }]);
});

test('merges unsorted GitHub PR listings in ascending PR-number order', async () => {
  const { task, calls, pr } = fixture();
  const previous = task.github.paginate;
  task.github.paginate = async (method) => method === task.github.rest.pulls.list
    ? [{ number: 9 }, { number: 3 }, { number: 7 }]
    : previous(method);
  task.github.rest.pulls.get = async ({ pull_number }) =>
    ({ data: { ...pr, number: pull_number } });
  await run(task);
  assert.deepEqual(calls.merges.map(m => m.pull_number), [3, 7, 9]);
});

test('includes draft PRs by marking ready and merging in the same pass', async () => {
  const { task, calls } = fixture({ draft: true, mergeable_state: 'draft' });
  const result = await run(task);
  assert.equal(result.draftsReady, 1);
  assert.deepEqual(calls.ready, ['PR_node']);
  assert.equal(calls.merges.length, 1);
});

test('conflicting PR is skipped', async () => {
  const { task, calls } = fixture({ mergeable: false, mergeable_state: 'dirty' });
  assert.equal((await run(task)).skipped, 1);
  assert.equal(calls.merges.length, 0);
});

test('GitHub-mergeable blocked state is attempted (GitHub rules remain authoritative)', async () => {
  const { task, calls } = fixture({ mergeable_state: 'blocked' });
  assert.equal((await run(task)).merged, 1);
  assert.equal(calls.merges.length, 1);
});

test('failed CI does not prevent a conflict-free merge', async () => {
  const { task, calls } = fixture({ checkStatus: 'failure', mergeable_state: 'unstable' });
  assert.equal((await run(task)).merged, 1);
  assert.equal(calls.merges.length, 1);
});

test('pending CI does not prevent a conflict-free merge', async () => {
  const { task, calls } = fixture({ checkStatus: 'pending', mergeable_state: 'unstable' });
  assert.equal((await run(task)).merged, 1);
  assert.equal(calls.merges.length, 1);
});

test('clean PR with no configured CI can merge', async () => {
  const { task, calls } = fixture({ checkStatus: 'none' });
  assert.equal((await run(task)).merged, 1);
  assert.equal(calls.merges.length, 1);
});

test('skips external-branch PR by default', async () => {
  const { task, calls } = fixture({ external: true });
  assert.equal((await run(task)).skipped, 1);
  assert.equal(calls.merges.length, 0);
});

test('dry run never merges or removes draft state', async () => {
  const { task, calls } = fixture({ draft: true, dryRun: true, mergeable_state: 'draft' });
  assert.equal((await run(task)).draftsReady, 1);
  assert.deepEqual(calls.ready, []);
  assert.deepEqual(calls.merges, []);
});

test('include filter scopes repositories', async () => {
  const { task, calls } = fixture({ include: 'some-other-repo' });
  assert.equal((await run(task)).repos, 0);
  assert.equal(calls.merges.length, 0);
});

test('exclusions block repositories', async () => {
  const { task, calls } = fixture({ exclude: 'sample' });
  assert.equal((await run(task)).repos, 0);
  assert.equal(calls.merges.length, 0);
});

test('failed commit status does not block an otherwise mergeable PR', async () => {
  const { task, calls } = fixture();
  task.github.rest.repos.getCombinedStatusForRef = async () => ({ data: { statuses: [{ context: 'deploy', state: 'failure' }] } });
  assert.equal((await run(task)).merged, 1);
  assert.equal(calls.merges.length, 1);
});

test('requires explicit account owner', async () => {
  const { task } = fixture();
  task.owner = '';
  await assert.rejects(run(task), /OWNER/);
});

test('unknown GitHub mergeability is skipped until recomputed', async () => {
  const { task, calls } = fixture({ mergeable: null });
  assert.equal((await run(task)).skipped, 1);
  assert.equal(calls.merges.length, 0);
});

test('temporary null mergeability is retried and merged within same run', async () => {
  const { task, calls } = fixture({ mergeable: null, resolveAfter: 4 });
  const result = await run(task);
  assert.equal(result.merged, 1);
  assert.ok(calls.pullGets >= 4);
  assert.equal(calls.merges.length, 1);
});

test('null mergeability never triggers a speculative merge', async () => {
  const { task, calls } = fixture({ mergeable: null });
  const result = await run(task);
  assert.equal(result.skipped, 1);
  assert.equal(result.merged, 0);
  assert.ok(calls.pullGets >= 8);
  assert.match(calls.logs.join(' '), /unknown after retries/);
});

test('draft with failed CI is marked ready and merged in the same run', async () => {
  const { task, calls } = fixture({ draft: true, checkStatus: 'failure', mergeable_state: 'unstable' });
  const result = await run(task);
  assert.equal(result.draftsReady, 1);
  assert.equal(calls.ready.length, 1);
  assert.equal(calls.merges.length, 1);
});

test('late GitHub merge conflict is a safe skip rather than a failed scan', async () => {
  const { task, calls } = fixture();
  task.github.rest.pulls.merge = async () => {
    const error = new Error('Pull Request has merge conflicts');
    error.status = 405;
    throw error;
  };
  const result = await run(task);
  assert.equal(result.merged, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 0);
  assert.deepEqual(calls.failures, []);
  assert.match(calls.logs.join(' '), /confirmed merge conflict at merge time/);
});

test('GitHub merge API rejection is recorded without bypassing protections', async () => {
  const { task, calls } = fixture({ mergeable_state: 'blocked' });
  task.github.rest.pulls.merge = async () => { throw new Error('Branch protection prohibits merging'); };
  const result = await run(task);
  assert.equal(result.merged, 0);
  assert.equal(result.errors, 1);
  assert.equal(calls.warnings.length, 2);
});

test('explicit expected repo visible to PAT passes coverage audit', async () => {
  const { task, calls } = fixture({ expected: 'sample' });
  const result = await run(task);
  assert.equal(result.errors, 0);
  assert.equal(calls.failures.length, 0);
});

test('PAT missing a critical expected repo fails visibly', async () => {
  const { task, calls } = fixture({ expected: 'nigeria-finops-platform' });
  const result = await run(task);
  assert.equal(result.errors, 1);
  assert.equal(calls.failures.length, 1);
  assert.match(calls.warnings[0], /direct repository lookup failed/);
});

test('direct lookup of missing listed private repo restores scanning', async () => {
  const { task, calls } = fixture({ expected: 'drugai', directAllowed: true });
  const result = await run(task);
  assert.equal(result.errors, 0);
  assert.equal(result.listed, 1);
  assert.equal(result.repos, 2);
  assert.equal(result.directlyDiscovered, 1);
  assert.deepEqual(calls.probes, ['drugai']);
  assert.equal(calls.failures.length, 0);
  assert.equal(result.merged, 1); // fixture's second PR has a cross-repository head
});

test('direct GET is not required when repository already appears in listing', async () => {
  const { task, calls } = fixture({ expected: 'DaV-LoPeZ/SaMpLe', directAllowed: true });
  const result = await run(task);
  assert.equal(result.errors, 0);
  assert.equal(result.directlyDiscovered, 0);
  assert.deepEqual(calls.probes, []);
});

test('unreachable repository is reported without stopping other merges', async () => {
  const { task, calls } = fixture({ expected: 'drugai' });
  const result = await run(task);
  assert.equal(result.errors, 1);
  assert.equal(result.merged, 1);
  assert.equal(calls.failures.length, 1);
  assert.deepEqual(calls.probes, ['drugai']);
});
