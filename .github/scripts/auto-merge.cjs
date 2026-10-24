'use strict';

/**
 * Merge eligible PRs across repositories owned by OWNER.
 * A true GitHub mergeable flag means no file-level conflicts. Ignore CI status,
 * but let GitHub reject merges blocked by rulesets, approvals or branch protection.
 */
function names(text) {
  return new Set((text || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

async function run({ github, core, owner, dryRun = false, allowForks = false, include, exclude, maxMerges = 10 }) {
  if (!owner || !/^[-\w]+$/.test(owner)) throw new Error('OWNER must be a GitHub username');
  const included = names(include);
  const excluded = names(exclude);
  const repos = await github.paginate(github.rest.repos.listForAuthenticatedUser, {
    affiliation: 'owner', visibility: 'all', per_page: 100,
  });
  const eligibleRepos = repos.filter(repo =>
    repo.owner.login.toLowerCase() === owner.toLowerCase() && !repo.archived &&
    !repo.disabled && (allowForks || !repo.fork) &&
    (!included.size || included.has(repo.name.toLowerCase()) || included.has(repo.full_name.toLowerCase())) &&
    !excluded.has(repo.name.toLowerCase()) && !excluded.has(repo.full_name.toLowerCase())
  );
  const totals = { repos: eligibleRepos.length, open: 0, merged: 0, draftsReady: 0, skipped: 0, errors: 0 };

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
        if (!allowForks && pr.head.repo?.full_name.toLowerCase() !== repository.full_name.toLowerCase()) {
          totals.skipped++;
          core.info(id + ': skipped cross-repository head');
          continue;
        }
        if (pr.mergeable !== true) {
          totals.skipped++;
          core.info(id + ': GitHub mergeable=' + pr.mergeable + '; waiting/requires conflict resolution');
          continue;
        }
        if (pr.draft) {
          // GitHub prohibits merging draft PRs. Mark them ready, then re-evaluate
          // on the next run once GitHub recalculates mergeability and protections.
          if (!dryRun) {
            await github.graphql('mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { clientMutationId } }', { id: pr.node_id });
          }
          totals.draftsReady++;
          core.info(id + ': ' + (dryRun ? 'would mark' : 'marked') + ' draft ready for review; will recheck conflict state before merge');
          continue;
        }
        if (dryRun) {
          core.info(id + ': DRY RUN: would merge conflict-free head ' + pr.head.sha + '; CI is not a gate');
          continue;
        }
        await github.rest.pulls.merge({
          owner, repo, pull_number: pr.number, sha: pr.head.sha,
          merge_method: 'squash',
        });
        totals.merged++;
        core.info(id + ': merged conflict-free PR (CI was not a gate)');
      } catch (error) {
        totals.errors++;
        core.warning(id + ': merge not performed: ' + error.message);
      }
    }
  }
  core.info('Summary: ' + JSON.stringify(totals));
  if (totals.errors) core.warning(totals.errors + ' PR/repository operation(s) failed; see logs.');
  return totals;
}

module.exports = { run, names };
