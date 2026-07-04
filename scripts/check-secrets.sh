#!/usr/bin/env bash
set -euo pipefail

patterns=(
  'github[_-]pat[_-]'
  'ghp_[A-Za-z0-9]{20,}'
  'gho_[A-Za-z0-9]{20,}'
  'ghu_[A-Za-z0-9]{20,}'
  'ghs_[A-Za-z0-9]{20,}'
  'ghr_[A-Za-z0-9]{20,}'
)

for pattern in "${patterns[@]}"; do
  if rg --hidden --glob '!/.git/**' --glob '!scripts/check-secrets.sh' -n "$pattern" .; then
    echo "Potential secret found for pattern: $pattern" >&2
    exit 1
  fi
done

echo "No matching GitHub token patterns found."
