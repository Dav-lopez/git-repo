'use strict';

/**
 * Merge eligible PRs across repositories owned by OWNER.
 * Merge conflict-free PRs regardless of CI status; GitHub merge restrictions still apply.
 * GitHub remains authoritative for branch protections and required reviews.
 */
function names(text) {
  return new Set((text || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

async function run({ github, core, owner, dryRun = false, allowForks = false, include, exclude, expected, maxMerges = 10 }) {
  if (!owner || !/^[-\w]+$/.test(owner)) throw new Error('OWNER must be a GitHub username');
  const listedRepos = await github.paginate(github.rest.repos.listForAuthenticatedUser, {
    affiliation: 'owner', visibility: 'all', per_page: 100,
  });
  const repos = [...listedRepos];
  const visible = new Set(repos
    .filter(r => r.owner.login.toLowerCase() === owner.toLowerCase())
    .flatMap(r => [r.name.toLowerCase(), r.full_name.toLowerCase()]));
  let directProbes = 0;
  const inaccessible = [];

  // An incomplete /user/repos listing does not, by itself, prove missing token
  // access. Probe each missing expected repository directly, and scan it when
  // the token can actually read it.
  for (const name of names(expected)) {
    const parts = name.split('/');
    if (parts.length > 2 || (parts.length === 2 && parts[0] !== owner.toLowerCase()) ||
        !/^[a-z0-9_.-]+$/.test(parts[parts.length - 1])) {
      throw new Error('Invalid expected repository under owner ' + owner + ': ' + name);
    }
    const repoName = parts[parts.length - 1];
    if (visible.has(repoName) || visible.has(owner.toLowerCase() + '/' + repoName)) continue;
    try {
      const { data: direct } = await github.rest.repos.get({ owner, repo: repoName });
      if (direct.owner.login.toLowerCase() !== owner.toLowerCase()) {
        throw new Error('Repository is not owned by ' + owner);
      }
      directProbes++;
      core.warning(owner + '/' + repoName +
        ': absent from /user/repos but directly accessible. Including it in scan.');
      repos.push(direct);
      visible.add(repoName);
      visible.add(direct.full_name.toLowerCase());
    } catch (error) {
      const status = error.status ? 'HTTP ' + error.status : error.message;
      inaccessible.push(repoName);
      core.warning(owner + '/' + repoName + ': direct repository lookup failed (' + status +
        '). Check token resource owner, repository selection, permissions and secret value.');
    }
  }
  const includedRepos = names(include);
  const excludedRepos = names(exclude);
  const eligibleRepos = repos.filter(repo =>
    repo.owner.login.toLowerCase() === owner.toLowerCase() && !repo.archived &&
    !repo.disabled && (allowForks || !repo.fork) &&
    (!includedRepos.size || includedRepos.has(repo.name.toLowerCase()) || includedRepos.has(repo.full_name.toLowerCase())) &&
    !excludedRepos.has(repo.name.toLowerCase()) && !excludedRepos.has(repo.full_name.toLowerCase())
  );
  const totals = { listed: listedRepos.length, repos: eligibleRepos.length, directlyDiscovered: directProbes,
    open: 0, merged: 0, draftsReady: 0, skipped: 0, errors: inaccessible.length };
  core.info('Repository discovery: ' + listedRepos.length + ' listed, ' +
    directProbes + ' additionally accessible by direct API lookup, ' +
    inaccessible.length + ' inaccessible expected repositories.');

  for (const repository of eligibleRepos) {
    const repo = repository.name;
    let prs;
    try {
      prs = await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', per_page: 100 });
    } catch (error) {
      totals.errors++;
      core.warning(repo + ': unable to list PRs: ' + error.message);
      continue;
    }
    for (const found of prs) {
      totals.open++;
      const id = owner + '/' + repo + '#' + found.number;
      if (totals.merged >= maxMerges) {
        totals.skipped++;
        core.info(id + ': merge limit reached');
        continue;
      }
      try {
        // Fetch a fresh PR snapshot rather than trusting a cached search/index result.
        const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: found.number });
        if (pr.state !== 'open' || pr.merged) { totals.skipped++; continue; }
        if (!allowForks && pr.head.repo?.full_name?.toLowerCase() !== repository.full_name.toLowerCase()) {
          totals.skipped++;
          core.info(id + ': skipped cross-repository head');
          continue;
        }
        if (pr.mergeable !== true) {
          totals.skipped++;
          core.info(id + ': skipped: mergeable=' + pr.mergeable + ' (conflict or pending GitHub computation)');
          continue;
        }
        if (pr.draft) {
          if (dryRun) {
            totals.draftsReady++;
            core.info(id + ': DRY RUN: would mark draft ready and recheck');
            continue;
          }
          await github.graphql('mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { clientMutationId } }', { id: pr.node_id });
          totals.draftsReady++;
          core.info(id + ': marked ready for review');
        }
        // Always refresh after draft transition and after earlier PR merges.
        const { data: current } = await github.rest.pulls.get({ owner, repo, pull_number: found.number });
        if (current.state !== 'open' || current.draft || current.mergeable !== true) {
          totals.skipped++;
          core.info(id + ': skipped after refresh: state=' + current.state + ', draft=' + current.draft + ', mergeable=' + current.mergeable);
          continue;
        }
        if (dryRun) {
          core.info(id + ': DRY RUN: would merge verified head ' + current.head.sha);
          continue;
        }
        await github.rest.pulls.merge({
          owner, repo, pull_number: pr.number, sha: current.head.sha,
          merge_method: 'squash',
        });
        totals.merged++;
        core.info(id + ': merged conflict-free PR (CI not a gate)');
      } catch (error) {
        totals.errors++;
        core.warning(id + ': merge not performed: ' + error.message);
      }
    }
  }
  core.info('Summary: ' + JSON.stringify(totals));
  if (totals.errors) {
    core.warning(totals.errors + ' repository access or merge operation(s) failed; see logs.');
    core.setFailed('Incomplete PR merge scan: ' + totals.errors + ' access/merge error(s)');
  }
  return totals;
}

module.exports = { run, names };
