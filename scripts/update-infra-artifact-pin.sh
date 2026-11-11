#!/usr/bin/env bash
set -euo pipefail

file=infra-shared/terragrunt/aws/us-east-1/stage/marketplace-fulfillment/artifact.json
jq --arg bucket "$ARTIFACT_BUCKET" \
  --arg key "$ARTIFACT_KEY" \
  --arg version "$VERSION_ID" \
  --arg sha "$ARTIFACT_SHA256" \
  '.artifact_bucket = $bucket | .artifact_key = $key | .artifact_version_id = $version | .artifact_sha256 = $sha' \
  "$file" > "$file.tmp"
mv "$file.tmp" "$file"