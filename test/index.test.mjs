import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// --- Stubs for AWS SDK clients ---
const sendMeteringMock = mock.fn();
const sendEntitlementMock = mock.fn();

// Mock the SDK modules before importing the handler
mock.module("@aws-sdk/client-marketplace-metering", {
  namedExports: {
    MarketplaceMeteringClient: class {
      send = sendMeteringMock;
    },
    ResolveCustomerCommand: class {
      constructor(input) {
        this.input = input;
      }
    },
  },
});

mock.module("@aws-sdk/client-marketplace-entitlement-service", {
  namedExports: {
    MarketplaceEntitlementServiceClient: class {
      send = sendEntitlementMock;
    },
    GetEntitlementsCommand: class {
      constructor(input) {
        this.input = input;
      }
    },
  },
});

// Set env vars before importing handler
process.env.REDIRECT_URL = "https://example.com/welcome";
process.env.PRODUCT_CODE = "prod-test123";

const { handler } = await import("../src/index.mjs");

// --- Helpers ---
function makeEvent(body, isBase64Encoded = false) {
  return {
    body: isBase64Encoded
      ? Buffer.from(body).toString("base64")
      : body,
    isBase64Encoded,
  };
}

describe("handler", () => {
  beforeEach(() => {
    sendMeteringMock.mock.resetCalls();
    sendEntitlementMock.mock.resetCalls();
  });

  // ---- Missing token ----
  it("returns 400 when x-amzn-marketplace-token is missing", async () => {
    const result = await handler(makeEvent("foo=bar"));

    assert.equal(result.statusCode, 400);
    assert.match(JSON.parse(result.body).message, /Missing registration token/);
  });

  it("returns 400 when body is empty", async () => {
    const result = await handler({ body: "", isBase64Encoded: false });

    assert.equal(result.statusCode, 400);
  });

  // ---- Successful flow ----
  it("resolves customer, checks entitlements, and redirects", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-123",
      CustomerAWSAccountId: "111122223333",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [
        { Dimension: "Users", Value: { IntegerValue: 5 } },
      ],
    }));

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_abc123")
    );

    assert.equal(result.statusCode, 302);

    const location = new URL(result.headers.Location);
    assert.equal(location.origin + location.pathname, "https://example.com/welcome");
    assert.equal(location.searchParams.get("customerId"), "cust-123");
    assert.equal(location.searchParams.get("awsAccountId"), "111122223333");
    assert.equal(location.searchParams.get("productCode"), "prod-test123");

    assert.equal(sendMeteringMock.mock.callCount(), 1);
    assert.equal(sendEntitlementMock.mock.callCount(), 1);
  });

  // ---- Base64-encoded body ----
  it("handles base64-encoded body", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-b64",
      CustomerAWSAccountId: "444455556666",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [{ Dimension: "Units", Value: { IntegerValue: 1 } }],
    }));

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_base64", true)
    );

    assert.equal(result.statusCode, 302);
    const location = new URL(result.headers.Location);
    assert.equal(location.searchParams.get("customerId"), "cust-b64");
  });

  // ---- No entitlements ----
  it("returns 403 when no entitlements found", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-no-ent",
      CustomerAWSAccountId: "000000000000",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [],
    }));

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_noent")
    );

    assert.equal(result.statusCode, 403);
    assert.match(JSON.parse(result.body).message, /No active entitlements/);
  });

  // ---- Invalid token exception ----
  it("returns 400 on InvalidTokenException", async () => {
    const err = new Error("invalid");
    err.name = "InvalidTokenException";
    sendMeteringMock.mock.mockImplementation(async () => {
      throw err;
    });

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_bad")
    );

    assert.equal(result.statusCode, 400);
    assert.match(JSON.parse(result.body).message, /Invalid or expired/);
  });

  // ---- Expired token exception ----
  it("returns 400 on ExpiredTokenException", async () => {
    const err = new Error("expired");
    err.name = "ExpiredTokenException";
    sendMeteringMock.mock.mockImplementation(async () => {
      throw err;
    });

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_expired")
    );

    assert.equal(result.statusCode, 400);
    assert.match(JSON.parse(result.body).message, /Invalid or expired/);
  });

  // ---- Unknown error ----
  it("returns 500 on unexpected errors", async () => {
    sendMeteringMock.mock.mockImplementation(async () => {
      throw new Error("something broke");
    });

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_err")
    );

    assert.equal(result.statusCode, 500);
    assert.match(JSON.parse(result.body).message, /Internal server error/);
  });

  // ---- Scenario 2: POST redirect includes token, customer ID is persisted in redirect ----
  it("redirect URL contains all required customer params for onboarding", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-onboard",
      CustomerAWSAccountId: "999988887777",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [{ Dimension: "Seats", Value: { IntegerValue: 10 } }],
    }));

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_onboard")
    );

    assert.equal(result.statusCode, 302);
    const location = new URL(result.headers.Location);
    // All three params must be present for the downstream app to onboard the customer
    assert.ok(location.searchParams.has("customerId"));
    assert.ok(location.searchParams.has("awsAccountId"));
    assert.ok(location.searchParams.has("productCode"));
    assert.equal(location.searchParams.get("customerId"), "cust-onboard");
    assert.equal(location.searchParams.get("awsAccountId"), "999988887777");
    assert.equal(location.searchParams.get("productCode"), "prod-test123");
  });

  // ---- Scenario 4: GetEntitlements returns undefined Entitlements array ----
  it("returns 403 when Entitlements key is missing from response", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-undef",
      CustomerAWSAccountId: "000000000000",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async () => ({}));

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_undef")
    );

    assert.equal(result.statusCode, 403);
    assert.match(JSON.parse(result.body).message, /No active entitlements/);
  });

  // ---- Scenario 5a: Subscription change – customer has multiple entitlements ----
  it("allows access with multiple entitlements (upgraded subscription)", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-multi",
      CustomerAWSAccountId: "111111111111",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [
        { Dimension: "Users", Value: { IntegerValue: 5 } },
        { Dimension: "Storage", Value: { IntegerValue: 100 } },
        { Dimension: "Premium", Value: { IntegerValue: 1 } },
      ],
    }));

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_multi")
    );

    assert.equal(result.statusCode, 302);
    assert.ok(result.headers.Location);
  });

  // ---- Scenario 5b: Subscription change – customer unsubscribed (no entitlements) ----
  it("denies access when subscription is cancelled (unsubscribe)", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-unsub",
      CustomerAWSAccountId: "222222222222",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [],
    }));

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_unsub")
    );

    assert.equal(result.statusCode, 403);
    assert.match(JSON.parse(result.body).message, /No active entitlements/);
  });

  // ---- Scenario 5c: Subscription change – entitlement service error (failed subscription) ----
  it("returns 500 when GetEntitlements fails (subscription verification failure)", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-fail",
      CustomerAWSAccountId: "333333333333",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async () => {
      throw new Error("EntitlementService unavailable");
    });

    const result = await handler(
      makeEvent("x-amzn-marketplace-token=tok_fail")
    );

    assert.equal(result.statusCode, 500);
    assert.match(JSON.parse(result.body).message, /Internal server error/);
  });

  // ---- Edge case: body is undefined ----
  it("returns 400 when event body is undefined", async () => {
    const result = await handler({ isBase64Encoded: false });

    assert.equal(result.statusCode, 400);
    assert.match(JSON.parse(result.body).message, /Missing registration token/);
  });

  // ---- Edge case: body is not a string (object) ----
  it("returns 400 when event body is not a string", async () => {
    const result = await handler({ body: 12345, isBase64Encoded: false });

    assert.equal(result.statusCode, 400);
  });

  // ---- Edge case: token alongside other form parameters ----
  it("extracts token correctly when other params are present", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-mixed",
      CustomerAWSAccountId: "555566667777",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [{ Dimension: "Users", Value: { IntegerValue: 1 } }],
    }));

    const result = await handler(
      makeEvent("foo=bar&x-amzn-marketplace-token=tok_mixed&baz=qux")
    );

    assert.equal(result.statusCode, 302);
    const location = new URL(result.headers.Location);
    assert.equal(location.searchParams.get("customerId"), "cust-mixed");
  });

  // ---- Test mode: disabled when ALLOW_TEST_MODE is not "true" ----
  it("does not activate test mode when ALLOW_TEST_MODE is false", async () => {
    // ALLOW_TEST_MODE was not set to "true" before import, so test mode is disabled
    const result = await handler({ testMode: true });

    // Should fall through to normal flow and fail due to missing token
    assert.equal(result.statusCode, 400);
  });

  // ---- Scenario 6: GetEntitlements is called with correct ProductCode and customer filter ----
  it("calls GetEntitlements with the correct ProductCode and customer filter", async () => {
    sendMeteringMock.mock.mockImplementation(async () => ({
      CustomerIdentifier: "cust-verify",
      CustomerAWSAccountId: "888899990000",
      ProductCode: "prod-test123",
    }));

    sendEntitlementMock.mock.mockImplementation(async (cmd) => ({
      Entitlements: [{ Dimension: "Users", Value: { IntegerValue: 2 } }],
    }));

    await handler(makeEvent("x-amzn-marketplace-token=tok_verify"));

    assert.equal(sendEntitlementMock.mock.callCount(), 1);
    const call = sendEntitlementMock.mock.calls[0];
    const input = call.arguments[0].input;
    assert.equal(input.ProductCode, "prod-test123");
    assert.deepEqual(input.Filter, { CUSTOMER_IDENTIFIER: ["cust-verify"] });
  });
});
