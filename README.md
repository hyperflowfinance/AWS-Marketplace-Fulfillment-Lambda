# AWS Marketplace SaaS Contract Fulfillment Lambda

Handles the fulfillment redirect when a customer subscribes to your SaaS product on AWS Marketplace.

## Flow

1. Customer clicks **Subscribe** on your Marketplace listing.
2. AWS Marketplace POST-redirects them to this Lambda (via API Gateway) with an `x-amzn-marketplace-token`.
3. Lambda calls **ResolveCustomer** to get the customer ID and AWS account.
4. Lambda calls **GetEntitlements** to verify the contract is active.
5. Lambda **302-redirects** the customer to `REDIRECT_URL#marketplace=<token>`. The token is `base64url(JSON {customerId, awsAccountId, productCode, exp}).base64url(HMAC-SHA256)`, valid 1 hour; dashboard-api verifies it at signup.

## Environment Variables

| Variable       | Description                                              |
| -------------- | -------------------------------------------------------- |
| `REDIRECT_URL` | URL to redirect customer to after successful fulfillment |
| `PRODUCT_CODE` | Your AWS Marketplace product code                        |
| `SIGNING_SECRET` | HMAC secret; must equal dashboard-api `MARKETPLACE_TOKEN_SECRET` |
| `ALLOW_TEST_MODE` | `true` enables direct-invoke test mode; keep `false` in prod |

## Deploy with SAM

```bash
npm install

sam build
sam deploy --guided \
  --parameter-overrides \
    RedirectUrl=https://app.example.com/signup \
    ProductCode=your-product-code \
    SigningSecret=<shared-secret>
```

After deployment the output `FulfillmentApiUrl` is the URL you set as the **Fulfillment URL** in your AWS Marketplace listing.

## IAM Permissions

The SAM template grants the Lambda these permissions:
- `aws-marketplace:ResolveCustomer`
- `aws-marketplace:GetEntitlements`
