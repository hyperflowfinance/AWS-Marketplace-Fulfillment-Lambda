#!/usr/bin/env bash
set -euo pipefail

[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
key="AWS-Marketplace-Fulfillment-Lambda/${RELEASE_TAG}/lambda.zip"
result=$(aws s3api put-object \
  --bucket "$ARTIFACT_BUCKET" \
  --key "$key" \
  --body lambda.zip \
  --checksum-algorithm SHA256 \
  --output json)

echo "key=$key" >> "$GITHUB_OUTPUT"
echo "version_id=$(jq -r '.VersionId' <<< "$result")" >> "$GITHUB_OUTPUT"
echo "sha256=$(jq -r '.ChecksumSHA256' <<< "$result")" >> "$GITHUB_OUTPUT"
