#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target_root="${1:-/root/stateweave-sdk-benchmark/payload}"

if [[ -z "${DESMOS_API_KEY:-}" ]]; then
  echo "DESMOS_API_KEY must be supplied without writing it to the repository." >&2
  exit 1
fi

cd "$repo_root"
pnpm install --frozen-lockfile
pnpm build

rm -rf "$target_root"
mkdir -p "$target_root/runtime" "$target_root/deps" "$target_root/workspace-seed/vendor"
cp -a dist node_modules package.json pnpm-lock.yaml ops "$target_root/runtime/"
cp ops/openshell-benchmark/workspace-seed/package.json "$target_root/deps/package.json"
cp -a ops/openshell-benchmark/workspace-seed/. "$target_root/workspace-seed/"

npm install --prefix "$target_root/deps" --ignore-scripts --no-audit --no-fund
curl --fail --silent --show-error --location \
  "https://www.desmos.com/api/v1.11/calculator.js?apiKey=${DESMOS_API_KEY}" \
  --output "$target_root/workspace-seed/vendor/desmos.js"

size="$(wc -c < "$target_root/workspace-seed/vendor/desmos.js")"
if (( size < 1000000 )); then
  echo "Downloaded Desmos bundle is unexpectedly small (${size} bytes)." >&2
  exit 1
fi
if grep -Fq "$DESMOS_API_KEY" "$target_root/workspace-seed/vendor/desmos.js"; then
  echo "Downloaded browser bundle unexpectedly contains the API key." >&2
  exit 1
fi

chmod -R go-rwx "$(dirname "$target_root")"
echo "Prepared benchmark payload at $target_root"
