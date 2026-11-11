# AWS Marketplace SaaS Contract Fulfillment Lambda

Handles the fulfillment redirect when a customer subscribes to your SaaS product on AWS Marketplace.

## Flow

1. Customer clicks **Subscribe** on your Marketplace listing.
2. AWS Marketplace POST-redirects them to this Lambda Function URL with an `x-amzn-marketplace-token`.
3. Lambda calls **ResolveCustomer** to get the customer ID and AWS account.
4. Lambda calls **GetEntitlements** to verify the contract is active.
5. Lambda **302-redirects** the customer to your app's `REDIRECT_URL` with query params (`customerId`, `awsAccountId`, `productCode`).

## Environment Variables

| Variable       | Description                                              |
| -------------- | -------------------------------------------------------- |
| `REDIRECT_URL` | URL to redirect customer to after successful fulfillment |
| `PRODUCT_CODE` | Your AWS Marketplace product code                        |

## Build and Deploy

The release workflow runs tests, builds the SAM package, and publishes the ZIP. It does not deploy the Lambda directly. Deployment is controlled by the approved Terragrunt workflow in `infra-shared`; see [Release to Stage](#release-to-stage).

## IAM Permissions

The SAM template grants the Lambda these permissions:
- `aws-marketplace:ResolveCustomer`
- `aws-marketplace:GetEntitlements`

## Release to Stage

Publishing a `v*` GitHub Release runs tests, builds `lambda.zip`, publishes it to the release and to the versioned stage artifact bucket, then opens a PR in `infra-shared` updating the stage artifact pin. Merge that PR and deploy the `marketplace-fulfillment` component in `stage/us-east-1` to release the code.

To publish an existing release, run the **Release** workflow manually with its tag after the artifact bucket is provisioned. The workflow needs `INFRA_PR_APP_ID` and `INFRA_PR_APP_PRIVATE_KEY` secrets for a GitHub App installed on `infra-shared` with Contents and Pull requests write access.
