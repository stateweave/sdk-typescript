#!/usr/bin/env node
const [repo = "stateweave/sdk-typescript"] = process.argv.slice(2);
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!token) throw new Error("Set GH_TOKEN or GITHUB_TOKEN with repo administration access.");

const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28"
};

await patch(`/repos/${repo}`, {
  delete_branch_on_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: true,
  allow_squash_merge: true,
  allow_auto_merge: true
});

await put(`/repos/${repo}/branches/main/protection`, {
  required_status_checks: {
    strict: true,
    contexts: ["test"]
  },
  enforce_admins: true,
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    require_last_push_approval: true
  },
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: true
});

await patch(`/repos/${repo}/vulnerability-alerts`, undefined, "PUT").catch(() => undefined);

console.log(`Protected main for ${repo}`);

async function put(path, body) {
  return request(path, "PUT", body);
}

async function patch(path, body, method = "PATCH") {
  return request(path, method, body);
}

async function request(path, method, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined : response.json();
}
