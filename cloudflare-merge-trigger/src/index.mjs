// Cron-only Cloudflare Worker: no public HTTP handler, no token in source control.
// This token needs GitHub Actions:write on Dav-lopez/git-repo only.
const DISPATCH_URL = 'https://api.github.com/repos/Dav-lopez/git-repo/actions/workflows/merge-open-prs.yml/dispatches';

export async function dispatchMerge(token, fetcher = fetch) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Missing GITHUB_DISPATCH_TOKEN Worker secret');
  }
  const result = await fetcher(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'dav-lopez-hourly-merge-cron',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main', inputs: { dry_run: 'false' } }),
  });
  if (result.status !== 204) {
    // Never print the token or raw response body (which may contain sensitive data).
    throw new Error('GitHub merge workflow dispatch failed (HTTP ' + result.status + ')');
  }
}

export default {
  async scheduled(controller, env, ctx) {
    // The existing GitHub workflow serializes concurrent dispatches.
    ctx.waitUntil(dispatchMerge(env.GITHUB_DISPATCH_TOKEN));
  },
};
