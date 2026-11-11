#!/usr/bin/env bash
set -euo pipefail

ticket_key=$(grep -oE '[A-Z][A-Z0-9]+-[0-9]+' <<< "$TICKET_TEXT" | head -n 1 || true)
if [[ -z "$ticket_key" ]]; then
  echo "::error::Provide a valid Jira/internal ticket key such as DO-123 in the release notes or workflow input."
  exit 1
fi

file=infra-shared/terragrunt/aws/us-east-1/stage/marketplace-fulfillment/artifact.json
jq --arg bucket "$ARTIFACT_BUCKET" \
  --arg key "$ARTIFACT_KEY" \
  --arg version "$VERSION_ID" \
  --arg sha "$ARTIFACT_SHA256" \
  '.artifact_bucket = $bucket | .artifact_key = $key | .artifact_version_id = $version | .artifact_sha256 = $sha' \
  "$file" > "$file.tmp"
mv "$file.tmp" "$file"
echo "ticket_key=$ticket_key" >> "$GITHUB_OUTPUT"
