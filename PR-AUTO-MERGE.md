# GitHub PR Auto-Merger

A central GitHub Actions workflow checks non-archived, non-fork repositories owned by Dav-lopez every 20 minutes, including draft PRs.

## Merge policy

- Checks each open PR and, if eligible, merges with squash.
- Draft PRs are converted to Ready for review when conflict-free, even if CI is failing or pending. They are reconsidered on a subsequent run; GitHub cannot merge draft PRs directly.
- Requires GitHub's mergeable=true (no file-level conflict); skips false and unknown/null mergeability.
- Deliberately ignores failing/pending CI and mergeable_state=unstable/blocked. GitHub may still reject the merge under branch protections, repository rulesets, or required approvals; the bot never bypasses GitHub's enforcement.
- Merge uses the exact head SHA, rejecting a merge if new commits arrive after inspection.
- Skips cross-repository branches and forked/archived repositories by default. Maximum 10 merges per run.
- PRs may merge even with failing or pending CI. This can introduce broken code. Use repository-level required checks if you want protection to override this automation.

WARNING: This merges old and new conflict-free PRs across every accessible owned repository, including drafts after conversion, WITHOUT blocking on failed CI. Consider setting an inclusion list. If a repository must never accept failing checks, make them required through GitHub branch protection/rulesets.

## One-time manual setup

1. Merge this feature PR into the controller repository's default main branch. Scheduled workflows only run from the default branch.
2. At https://github.com/settings/personal-access-tokens create a fine-grained token for resource owner Dav-lopez. Select the repositories you wish to automate (or all owned repositories). Grant Contents: Read and write, Pull requests: Read and write, Checks: Read, and Commit statuses: Read. Actions: Read is optional. Private repos require explicit token access. An equivalently configured GitHub App token also works.
3. In https://github.com/Dav-lopez/git-repo/settings/secrets/actions create the Actions secret AUTO_MERGE_TOKEN containing that token. Do not commit tokens.
4. Optionally set the Actions variable AUTO_MERGE_INCLUDE_REPOS at https://github.com/Dav-lopez/git-repo/settings/variables/actions to a comma-separated list such as drugai,nigeria-finops-platform,The_Last_Decision_Day,mid-elections. If unset, ALL accessible owned non-fork repositories are scanned. AUTO_MERGE_EXCLUDE_REPOS is an optional exclusion list.
5. In Actions > Merge eligible open PRs > Run workflow, start with dry_run=true to inspect decisions, then use dry_run=false to merge, or permit the next scheduled run.

## Timing and limitations

Cron is 7,27,47 * * * * (UTC), every 20 minutes at minutes :07, :27, and :47. This avoids peak minute :00 because GitHub can delay or drop scheduled events under load; it does not guarantee reliable real-time execution. A push that changes the workflow file on main also triggers one live verification scan. GitHub can disable scheduled workflows in inactive repositories. The controller needs Actions enabled. Check https://github.com/Dav-lopez/git-repo/actions for recent runs with event=schedule.

The built-in GitHub Actions GITHUB_TOKEN cannot merge pull requests in other repositories. The AUTO_MERGE_TOKEN secret is required for account-wide access.

The script respects branch protections and repository rulesets, and logs errors per repository. It does not perform semantic code review and does not bypass approvals. GitHub checks with unknown mergeability are skipped and reconsidered later.

## Tests

Run: node --test tests/auto-merge.test.cjs (Node.js 22).

Mocked tests cover conflict-free merges despite failed/pending CI or blocked state, draft conversion, conflicts, unknown mergeability, GitHub protection errors, external PRs, dry-run and repository filters. The script uses the Octokit client supplied by actions/github-script.
