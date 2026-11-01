import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { dispatchMerge } from '../src/index.mjs';

test('scheduled dispatch requests a real merge, not a dry run', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    return { status: 204 };
  };
  await dispatchMerge('example-secret', fetcher);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.github.com/repos/Dav-lopez/git-repo/actions/workflows/merge-open-prs.yml/dispatches');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer example-secret');
  assert.deepEqual(JSON.parse(requests[0].init.body), { ref: 'main', inputs: { dry_run: 'false' } });
});

test('missing token fails safely before network activity', async () => {
  let called = false;
  await assert.rejects(
    dispatchMerge(undefined, async () => { called = true; }),
    /Missing GITHUB_DISPATCH_TOKEN/
  );
  assert.equal(called, false);
});

test('GitHub refusal is reported without exposing response or token', async () => {
  await assert.rejects(
    dispatchMerge('private-example', async () => ({ status: 403, text: async () => 'private-example' })),
    err => err.message === 'GitHub merge workflow dispatch failed (HTTP 403)'
  );
});

test('cron handler schedules the dispatch promise', async () => {
  const pending = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 204 });
  try {
    await worker.scheduled({}, { GITHUB_DISPATCH_TOKEN: 'example-secret' }, {
      waitUntil: promise => pending.push(promise),
    });
    assert.equal(pending.length, 1);
    await Promise.all(pending);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
