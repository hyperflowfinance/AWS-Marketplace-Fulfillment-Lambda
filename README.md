# AWS Marketplace SaaS Contract Fulfillment Lambda

Handles the fulfillment redirect when a customer subscribes to your SaaS product on AWS Marketplace.

## Flow

1. Customer clicks **Subscribe** on your Marketplace listing.
2. AWS Marketplace POST-redirects them to this Lambda Function URL with an `x-amzn-marketplace-token`.
3. Lambda calls **ResolveCustomer** to get the customer ID and AWS account.
4. Lambda calls **GetEntitlements** to verify the contract is active.
5. Lambda **302-redirects** the customer to `REDIRECT_URL#marketplace=<token>`. The token is `base64url(JSON {customerId, awsAccountId, productCode, exp}).base64url(HMAC-SHA256)`, valid 1 hour; dashboard-api verifies it at signup.

## Environment Variables

| Variable       | Description                                              |
| -------------- | -------------------------------------------------------- |
| `REDIRECT_URL` | URL to redirect customer to after successful fulfillment |
| `PRODUCT_CODE` | Your AWS Marketplace product code                        |
| `MARKETPLACE_TOKEN_SECRET_NAME` | Secrets Manager name shared with dashboard-api |
| `MARKETPLACE_TOKEN_SECRET_REGION` | Region where that secret lives |
| `ALLOW_TEST_MODE` | `true` enables direct-invoke test mode; keep `false` in prod |

## Build and Deploy

The release workflow runs tests, builds the SAM package, and publishes the ZIP. It does not deploy the Lambda directly. Deployment is controlled by the approved Terragrunt workflow in `infra-shared`; see [Release to Stage](#release-to-stage).

## IAM Permissions

The SAM template grants the Lambda these permissions:
- `aws-marketplace:ResolveCustomer`
- `aws-marketplace:GetEntitlements`
- `secretsmanager:GetSecretValue` for the shared token secret only

## Release to Stage

Push a `vX.Y.Z` tag on reviewed `main`. The Release workflow tests/builds `lambda.zip`,
uploads it to the versioned stage S3 bucket, and publishes its exact version/checksum.
The shared release workflow opens the stage-only infra PR, validates and applies a
saved artifact-only plan, verifies the running Lambda checksum, then merges the PR.
No per-version approval is needed. Production and engineering PR reviews are unchanged.

Complete the [one-time stage release setup](https://github.com/hyperflowfinance/infra-shared/blob/main/docs/stage-releases.md)
first. Infra polls successful tagged builds every five minutes. No new source secret
is needed; merge credentials stay in infra's main-only `stage-release` environment.

Manual publishing still uploads an asset to an existing GitHub Release. Select its
tag as the workflow ref and provide the matching `release_tag` for automatic stage.
Creating a GitHub Release is not required for normal tag-triggered deployments.
