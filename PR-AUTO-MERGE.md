# GitHub PR Auto-Merger

A central GitHub Actions workflow checks non-archived, non-fork repositories owned by Dav-lopez every 20 minutes, including draft PRs.

## Merge policy

- Checks each open PR and, if eligible, merges with squash.
- Draft PRs are converted to Ready for review if conflict-free and all reported CI is complete and non-failing. They are reconsidered on a subsequent run; GitHub cannot merge draft PRs directly.
- Requires mergeable=true and, for non-drafts, mergeable_state=clean.
- Skips failed or pending CI, merge conflicts, and rules that block a clean merge. GitHub branch protection and approval requirements apply.
- Merge uses the exact head SHA, rejecting a merge if new commits arrive after inspection.
- Skips cross-repository branches and forked/archived repositories by default. Maximum 10 merges per run.
- PRs WITHOUT CONFIGURED CI can merge if GitHub reports them clean. Configure required checks in important projects.

WARNING: When enabled, this merges old and new PRs across every accessible owned repository, including drafts after conversion. Consider setting an inclusion list before providing the token.

## One-time manual setup

1. Merge this feature PR into the controller repository's default main branch. Scheduled workflows only run from the default branch.
2. At https://github.com/settings/personal-access-tokens create a fine-grained token for resource owner Dav-lopez. Select the repositories you wish to automate (or all owned repositories). Grant Contents: Read and write, Pull requests: Read and write, Checks: Read, and Commit statuses: Read. Actions: Read is optional. Private repos require explicit token access. An equivalently configured GitHub App token also works.
3. In https://github.com/Dav-lopez/git-repo/settings/secrets/actions create the Actions secret AUTO_MERGE_TOKEN containing that token. Do not commit tokens.
4. Optionally set the Actions variable AUTO_MERGE_INCLUDE_REPOS at https://github.com/Dav-lopez/git-repo/settings/variables/actions to a comma-separated list such as drugai,nigeria-finops-platform,The_Last_Decision_Day,mid-elections. If unset, ALL accessible owned non-fork repositories are scanned. AUTO_MERGE_EXCLUDE_REPOS is an optional exclusion list.
5. In Actions > Merge eligible open PRs > Run workflow, start with dry_run=true to inspect decisions, then use dry_run=false to merge, or permit the next scheduled run.

## Timing and limitations

Cron is */20 * * * * (UTC). GitHub can delay or skip scheduled executions, and may disable scheduled workflows in inactive repositories. The controller needs Actions enabled.

The built-in GitHub Actions GITHUB_TOKEN cannot merge pull requests in other repositories. The AUTO_MERGE_TOKEN secret is required for account-wide access.

The script respects branch protections and repository rulesets, and logs errors per repository. It does not perform semantic code review and does not bypass approvals. GitHub checks with unknown mergeability are skipped and reconsidered later.

## Tests

Run: node --test tests/auto-merge.test.cjs (Node.js 22).

Mocked tests cover clean merges, draft conversion, conflicts, blocked PRs, failed/pending/no CI, external PRs, dry-run and filtering. The script uses the Octokit client supplied by actions/github-script.
