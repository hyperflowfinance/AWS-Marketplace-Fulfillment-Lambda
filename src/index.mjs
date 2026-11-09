import { MarketplaceMeteringClient, ResolveCustomerCommand } from "@aws-sdk/client-marketplace-metering";
import {
  MarketplaceEntitlementServiceClient,
  GetEntitlementsCommand,
} from "@aws-sdk/client-marketplace-entitlement-service";
import { parse } from "querystring";
import { createHmac } from "crypto";

const meteringClient = new MarketplaceMeteringClient({});
const entitlementClient = new MarketplaceEntitlementServiceClient({});

const REDIRECT_URL = process.env.REDIRECT_URL;
const PRODUCT_CODE = process.env.PRODUCT_CODE;
const ALLOW_TEST_MODE = process.env.ALLOW_TEST_MODE === "true";
// Shared with dashboard-api (MARKETPLACE_TOKEN_SECRET); signs the redirect token.
const SIGNING_SECRET = process.env.SIGNING_SECRET;
const TOKEN_TTL_SECONDS = 3600;

/**
 * AWS Marketplace SaaS Contract Fulfillment Lambda
 *
 * Flow:
 * 1. Customer subscribes on AWS Marketplace and is POST-redirected to this Lambda
 *    (via API Gateway) with `x-amzn-marketplace-token` in the body.
 * 2. We call ResolveCustomer to exchange the token for customer details.
 * 3. We call GetEntitlements to verify the customer's contract/entitlements.
 * 4. We redirect the customer to REDIRECT_URL#marketplace=<signed token>.
 *    The fragment keeps the token out of server logs and Referer headers.
 *
 * Test mode (direct invoke only):
 *   Send { "testMode": true } to skip ResolveCustomer and use mock data.
 *   Requires ALLOW_TEST_MODE=true environment variable.
 */
export const handler = async (event) => {
  try {
    // --- Test mode: direct Lambda invoke with mock data ---
    if (event.testMode && ALLOW_TEST_MODE) {
      console.log("TEST MODE: skipping ResolveCustomer, using mock data");

      const customerId = event.customerId || "test-customer-id";
      const awsAccountId = event.awsAccountId || "123456789012";
      const productCode = event.productCode || PRODUCT_CODE;

      // Still call GetEntitlements to verify that path works
      console.log("Fetching entitlementsג€¦");
      const entitlementResult = await entitlementClient.send(
        new GetEntitlementsCommand({
          ProductCode: productCode,
          Filter: {
            CUSTOMER_IDENTIFIER: [customerId],
          },
        })
      );

      const entitlements = entitlementResult.Entitlements || [];
      console.log(`Found ${entitlements.length} entitlement(s)`, JSON.stringify(entitlements));

      return { ...redirect({ customerId, awsAccountId, productCode }), _testMode: true };
    }

    // --- 1. Extract the marketplace token from the POST body ---
    const body =
      typeof event.body === "string"
        ? event.isBase64Encoded
          ? Buffer.from(event.body, "base64").toString("utf-8")
          : event.body
        : "";

    const params = parse(body);
    const token = params["x-amzn-marketplace-token"];

    if (!token || typeof token !== "string") {
      console.error("Missing x-amzn-marketplace-token in request body");
      return response(400, "Missing registration token.");
    }

    // --- 2. Resolve the customer ---
    console.log("Resolving customer tokenג€¦");
    const resolveResult = await meteringClient.send(
      new ResolveCustomerCommand({ RegistrationToken: token })
    );

    const {
      CustomerIdentifier: customerId,
      CustomerAWSAccountId: awsAccountId,
      ProductCode: productCode,
    } = resolveResult;

    console.log("Resolved customer", {
      customerId,
      awsAccountId,
      productCode,
    });

    // --- 3. Get entitlements for the customer ---
    console.log("Fetching entitlementsג€¦");
    const entitlementResult = await entitlementClient.send(
      new GetEntitlementsCommand({
        ProductCode: PRODUCT_CODE || productCode,
        Filter: {
          CUSTOMER_IDENTIFIER: [customerId],
        },
      })
    );

    const entitlements = entitlementResult.Entitlements || [];
    console.log(`Found ${entitlements.length} entitlement(s)`, JSON.stringify(entitlements));

    if (entitlements.length === 0) {
      console.warn("No active entitlements found for customer", customerId);
      return response(403, "No active entitlements found. Please complete your subscription on AWS Marketplace.");
    }

    // --- 4. Redirect to the configured URL ---
    console.log("Redirecting customer", customerId);
    return redirect({ customerId, awsAccountId, productCode });
  } catch (err) {
    console.error("Fulfillment error:", err);

    if (err.name === "InvalidTokenException" || err.name === "ExpiredTokenException") {
      return response(400, "Invalid or expired marketplace token. Please subscribe again from AWS Marketplace.");
    }

    return response(500, "Internal server error during fulfillment.");
  }
};

/** HMAC-SHA256 token: base64url(JSON claims) + "." + base64url(signature). */
export function signToken(claims, secret = SIGNING_SECRET) {
  if (!secret) throw new Error("SIGNING_SECRET is not configured");
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ ...claims, exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function redirect(claims) {
  const target = new URL(REDIRECT_URL);
  target.hash = `marketplace=${signToken(claims)}`;
  return { statusCode: 302, headers: { Location: target.toString() }, body: "" };
}

function response(statusCode, message) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  };
}
