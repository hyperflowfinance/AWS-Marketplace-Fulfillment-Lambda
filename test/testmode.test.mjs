import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// --- Stubs for AWS SDK clients ---
const sendMeteringMock = mock.fn();
const sendEntitlementMock = mock.fn();

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

// Enable test mode BEFORE importing handler
process.env.REDIRECT_URL = "https://example.com/welcome";
process.env.PRODUCT_CODE = "prod-test123";
process.env.ALLOW_TEST_MODE = "true";

const { handler } = await import("../src/index.mjs");

describe("test mode (ALLOW_TEST_MODE=true)", () => {
  beforeEach(() => {
    sendMeteringMock.mock.resetCalls();
    sendEntitlementMock.mock.resetCalls();
  });

  it("skips ResolveCustomer and redirects with mock data", async () => {
    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [{ Dimension: "Users", Value: { IntegerValue: 5 } }],
    }));

    const result = await handler({ testMode: true });

    assert.equal(result.statusCode, 302);
    assert.equal(result._testMode, true);

    const location = new URL(result.headers.Location);
    assert.equal(location.searchParams.get("customerId"), "test-customer-id");
    assert.equal(location.searchParams.get("awsAccountId"), "123456789012");
    assert.equal(location.searchParams.get("productCode"), "prod-test123");

    // ResolveCustomer must NOT be called in test mode
    assert.equal(sendMeteringMock.mock.callCount(), 0);
    // GetEntitlements IS still called to verify that path
    assert.equal(sendEntitlementMock.mock.callCount(), 1);
  });

  it("uses custom customer data when provided", async () => {
    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [],
    }));

    const result = await handler({
      testMode: true,
      customerId: "my-custom-id",
      awsAccountId: "999999999999",
      productCode: "prod-custom",
    });

    assert.equal(result.statusCode, 302);
    const location = new URL(result.headers.Location);
    assert.equal(location.searchParams.get("customerId"), "my-custom-id");
    assert.equal(location.searchParams.get("awsAccountId"), "999999999999");
    assert.equal(location.searchParams.get("productCode"), "prod-custom");
  });

  it("calls GetEntitlements with the provided customerId", async () => {
    sendEntitlementMock.mock.mockImplementation(async (cmd) => ({
      Entitlements: [{ Dimension: "Seats", Value: { IntegerValue: 1 } }],
    }));

    await handler({ testMode: true, customerId: "ent-check-id" });

    assert.equal(sendEntitlementMock.mock.callCount(), 1);
    const input = sendEntitlementMock.mock.calls[0].arguments[0].input;
    assert.deepEqual(input.Filter, { CUSTOMER_IDENTIFIER: ["ent-check-id"] });
  });

  it("returns 500 when GetEntitlements fails in test mode", async () => {
    sendEntitlementMock.mock.mockImplementation(async () => {
      throw new Error("entitlement service down");
    });

    const result = await handler({ testMode: true });

    assert.equal(result.statusCode, 500);
    assert.match(JSON.parse(result.body).message, /Internal server error/);
  });

  it("still redirects even with zero entitlements in test mode", async () => {
    // Test mode skips the entitlement count check — it always redirects
    sendEntitlementMock.mock.mockImplementation(async () => ({
      Entitlements: [],
    }));

    const result = await handler({ testMode: true });

    assert.equal(result.statusCode, 302);
    assert.equal(result._testMode, true);
  });
});
