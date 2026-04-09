# AWS Marketplace SaaS Contract Fulfillment Lambda

Handles the fulfillment redirect when a customer subscribes to your SaaS product on AWS Marketplace.

## Flow

1. Customer clicks **Subscribe** on your Marketplace listing.
2. AWS Marketplace POST-redirects them to this Lambda (via API Gateway) with an `x-amzn-marketplace-token`.
3. Lambda calls **ResolveCustomer** to get the customer ID and AWS account.
4. Lambda calls **GetEntitlements** to verify the contract is active.
5. Lambda **302-redirects** the customer to your app's `REDIRECT_URL` with query params (`customerId`, `awsAccountId`, `productCode`).

## Environment Variables

| Variable       | Description                                              |
| -------------- | -------------------------------------------------------- |
| `REDIRECT_URL` | URL to redirect customer to after successful fulfillment |
| `PRODUCT_CODE` | Your AWS Marketplace product code                        |

## Deploy with SAM

```bash
npm install

sam build
sam deploy --guided \
  --parameter-overrides \
    RedirectUrl=https://app.example.com/welcome \
    ProductCode=your-product-code
```

After deployment the output `FulfillmentApiUrl` is the URL you set as the **Fulfillment URL** in your AWS Marketplace listing.

## IAM Permissions

The SAM template grants the Lambda these permissions:
- `aws-marketplace:ResolveCustomer`
- `aws-marketplace:GetEntitlements`
