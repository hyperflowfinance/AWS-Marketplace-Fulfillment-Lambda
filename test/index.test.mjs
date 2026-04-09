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

const { handler } = await import("../index.mjs");

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
});
