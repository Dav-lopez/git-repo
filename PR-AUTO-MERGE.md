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
6. The workflow checks four critical repositories by default: nigeria-finops-platform, drugai, mid-elections, and The_Last_Decision_Day. If any is absent from the authenticated repository listing, the bot now issues a direct GET /repos/{owner}/{repo} probe. If that succeeds, the repository is added to the scan and no missing-permission failure is reported. If direct lookup fails, it logs the HTTP status and fails the run. Set the Actions variable AUTO_MERGE_EXPECTED_REPOS to update the comma-separated list as projects change. The token stored in Actions is separate from your ChatGPT GitHub connection.

## Timing and limitations

Cron is 17,37,57 * * * * (UTC), every 20 minutes at minutes :17, :37, and :57. This avoids peak minute :00 because GitHub can delay or drop scheduled events under load; it does not guarantee reliable real-time execution. A push that changes the workflow file on main also triggers one live verification scan. GitHub can disable scheduled workflows in inactive repositories. The controller needs Actions enabled. Check https://github.com/Dav-lopez/git-repo/actions for recent runs with event=schedule.

The built-in GitHub Actions GITHUB_TOKEN cannot merge pull requests in other repositories. The AUTO_MERGE_TOKEN secret is required for account-wide access.

The script respects branch protections and repository rulesets, and logs errors per repository. It does not perform semantic code review and does not bypass approvals. GitHub checks with unknown mergeability are skipped and reconsidered later.

## Tests

Run: node --test tests/auto-merge.test.cjs (Node.js 22).

Mocked tests cover conflict-free merges despite failed/pending CI or blocked state, draft conversion, conflicts, unknown mergeability, GitHub protection errors, external PRs, dry-run and repository filters. The script uses the Octokit client supplied by actions/github-script.

## Diagnosing missing PRs

A private repository absent from GET /user/repos does **not** conclusively prove incorrect access. The agent explicitly probes each expected repository through GET /repos/{owner}/{repo}. A successful direct probe adds that repository to its scan and reports the discovery gap; a failed probe logs the HTTP status (for example, 403 or 404) and marks the run incomplete.

If the direct request fails, verify that the fine-grained token's resource owner is Dav-lopez, that it grants repository metadata read and pull requests read/write (and Contents write when required), and that the current value of AUTO_MERGE_TOKEN in the controller Actions secrets matches the token you edited. Never paste the token into ChatGPT or source code. Missing repositories not included in AUTO_MERGE_EXPECTED_REPOS cannot be detected by this check.

## Scheduled-run troubleshooting

If the workflow has successful `workflow_dispatch` runs but zero `schedule` events, inspect its enabled status in GitHub Actions and confirm its workflow YAML is on the default branch. Editing the cron expression can refresh the scheduling actor, but it does not guarantee execution. If repeated schedules never trigger after re-registration, ask GitHub Support to check scheduled-event delivery; no script change can execute a workflow that GitHub never starts.
