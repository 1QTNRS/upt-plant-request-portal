/**
 * Exercises audit Shopify lookups with a mocked Admin GraphQL client.
 * Safe for Docker runtime checks; never calls Shopify.
 */
import process from "node:process";

import {
  DOCKER_TARGET_EMAIL,
  DOCKER_TEST_SHOP,
} from "./cleanup-docker-fixtures.mts";
import { auditTestCustomerCleanup } from "../app/lib/test-customer-cleanup.server.ts";
import type { GraphqlClient } from "../app/lib/shopify-ops.server.ts";

function mockAdmin(): GraphqlClient {
  return {
    graphql: async (_query: string, options?: { variables?: Record<string, unknown> }) => {
      const id = options?.variables?.id as string | undefined;
      if (id?.includes("DraftOrder")) {
        return {
          json: async () => ({
            data: {
              draftOrder: {
                id,
                status: "INVOICE_SENT",
                invoiceUrl: "https://example.com/invoices/mock",
                order: null,
              },
            },
          }),
        };
      }
      if (id?.includes("Order")) {
        return {
          json: async () => ({
            data: {
              order: {
                name: "#MOCK1001",
                displayFinancialStatus: "PAID",
              },
            },
          }),
        };
      }
      if (id?.includes("Product")) {
        return {
          json: async () => ({
            data: {
              product: {
                title: "Mock Exact Plant",
                totalInventory: 1,
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected mock Shopify id: ${id ?? "missing"}`);
    },
  } as unknown as GraphqlClient;
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const audit = await auditTestCustomerCleanup(
  DOCKER_TEST_SHOP,
  DOCKER_TARGET_EMAIL,
  mockAdmin(),
);

if (audit.counts.requests !== 1) {
  console.error(`Expected 1 target request, found ${audit.counts.requests}.`);
  process.exit(1);
}

const draft = audit.shopify.draftOrders[0];
if (!draft || draft.liveStatus !== "INVOICE_SENT") {
  console.error("Expected mocked draft order status INVOICE_SENT.");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      requestNumber: audit.requests[0]?.requestNumber,
      draftLiveStatus: draft.liveStatus,
    },
    null,
    2,
  ),
);
