# Independent hourly GitHub auto-merge trigger

This Cloudflare Worker gives the GitHub PR merger an **independent hourly trigger**. GitHub Actions' built-in cron has been delayed by more than six hours despite a five-minute schedule. Cloudflare Cron Triggers do not depend on the GitHub Actions scheduler.

It calls the existing **Merge eligible open PRs** workflow on `Dav-lopez/git-repo`, which merges draft and regular PRs in **ascending numeric order**, bypasses CI as a merge eligibility gate, and skips confirmed merge conflicts. The Worker does **not** merge on its own and does **not** need access to the product repos.

## One-time activation (Cloudflare account owner)

1. In GitHub, create a **fine-grained personal access token** restricted to `Dav-lopez/git-repo`. Set repository permission **Actions: Read and write**. Do not commit or share the token. This is for triggering the *controller workflow*, not the `AUTO_MERGE_TOKEN` already stored in GitHub Actions.
2. Open a terminal with Cloudflare Wrangler available, then run:

   ```sh
   cd cloudflare-merge-trigger
   npx wrangler@4 login
   npx wrangler@4 deploy
   npx wrangler@4 secret put GITHUB_DISPATCH_TOKEN
   ```

   Paste the GitHub token when Wrangler prompts. Do **not** paste it in ChatGPT or source control.
3. In **Cloudflare Dashboard → Workers & Pages → dav-lopez-hourly-merge-check → Settings → Triggers**, confirm the cron is `19 * * * *` (19 minutes past every UTC hour).
4. In **GitHub → Dav-lopez/git-repo → Actions → Merge eligible open PRs**, check that a new `workflow_dispatch` run appears after the next cron event. It should run with `dry_run=false` and real merge behavior.

### Verification and limitations

- This worker intentionally exposes no HTTP route. It only handles scheduled events and does not log the GitHub token.
- GitHub Actions retains `workflow_dispatch`, its own cron triggers, and concurrency protection. Repeated dispatches are serialized, not merged concurrently by this worker.
- Cloudflare Cron on the Free plan has limits, including a maximum of five cron triggers per account. The schedule is independent of GitHub Actions but it still is **not a hard real-time SLA**.
- The controller still requires a working GitHub Actions secret `AUTO_MERGE_TOKEN` with write access to product repos. For PRs that modify `.github/workflows/*`, a classic PAT might require the `workflow` scope; alternatively configure a supported GitHub App token with appropriate permissions.
- The Worker does not resolve code conflicts. Conflicting PRs are left open until they can be updated safely.
- No Cloudflare deployment is triggered just by merging this PR. You must complete the one-time Wrangler setup above.
- The Worker uses Cloudflare's request-based Free plan limits; you do not need a Render cron job (Render's cron services have a monthly minimum charge).

Local CI test: `node --test cloudflare-merge-trigger/tests/dispatch.test.mjs`.
