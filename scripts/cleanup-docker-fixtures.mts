/**
 * Disposable PostgreSQL fixtures for the cleanup Docker runtime check.
 * Never targets production shops or credentials.
 */
import process from "node:process";

import prisma from "../app/db.server.ts";
import { normalizeCleanupEmail } from "../app/lib/test-customer-cleanup.server.ts";

export const DOCKER_TEST_SHOP = "cleanup-docker-runtime.myshopify.com";
export const DOCKER_OTHER_SHOP = "cleanup-docker-unrelated.myshopify.com";
export const DOCKER_TARGET_EMAIL = "aprilbalaga@yahoo.com";
export const DOCKER_UNRELATED_EMAIL = "unrelated-customer@example.com";

async function purgeShop(shop: string) {
  await prisma.adminPushMessage.deleteMany({ where: { shop } });
  await prisma.emailMessage.deleteMany({ where: { shop } });
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
}

async function seedRequest(
  shop: string,
  requestNumber: string,
  email: string,
  name: string,
) {
  const customer = await prisma.customerProfile.create({
    data: { shop, email: normalizeCleanupEmail(email), name },
  });
  await prisma.plantRequest.create({
    data: {
      shop,
      requestNumber,
      customerId: customer.id,
      customerName: name,
      customerEmail: normalizeCleanupEmail(email),
      status: "Pending",
      items: {
        create: {
          plantName: "Docker runtime fixture plant",
          offeredName: "Docker runtime fixture plant",
          availability: "available",
          price: 10,
          weightLbs: 1,
        },
      },
      statusEvents: {
        create: { toStatus: "Pending", reason: "Docker runtime fixture seed" },
      },
      draftOrder: {
        create: {
          shopifyDraftOrderGid: "gid://shopify/DraftOrder/docker-fixture-1",
          invoiceUrl: "https://example.com/invoices/docker-fixture-1",
          lineItemsJson: "[]",
        },
      },
    },
  });
}

export async function seedCleanupDockerFixtures() {
  await purgeShop(DOCKER_TEST_SHOP);
  await purgeShop(DOCKER_OTHER_SHOP);

  await seedRequest(
    DOCKER_TEST_SHOP,
    "REQ-DOCKER-TARGET",
    DOCKER_TARGET_EMAIL,
    "April Docker Fixture",
  );
  await seedRequest(
    DOCKER_TEST_SHOP,
    "REQ-DOCKER-OTHER",
    DOCKER_UNRELATED_EMAIL,
    "Unrelated Same Shop",
  );
  await seedRequest(
    DOCKER_OTHER_SHOP,
    "REQ-DOCKER-FOREIGN",
    "foreign-shop@example.com",
    "Foreign Shop Customer",
  );
}

export async function snapshotCleanupDockerFixtures() {
  const shops = [DOCKER_TEST_SHOP, DOCKER_OTHER_SHOP];
  const snapshot: Record<string, unknown> = {
    shops: {},
  };

  for (const shop of shops) {
    snapshot.shops[shop] = {
      customers: await prisma.customerProfile.count({ where: { shop } }),
      requests: await prisma.plantRequest.count({ where: { shop } }),
      requestNumbers: (
        await prisma.plantRequest.findMany({
          where: { shop },
          select: { requestNumber: true, customerEmail: true },
          orderBy: { requestNumber: "asc" },
        })
      ).map((row) => ({
        requestNumber: row.requestNumber,
        customerEmail: row.customerEmail,
      })),
      emails: await prisma.emailMessage.count({ where: { shop } }),
      pushMessages: await prisma.adminPushMessage.count({ where: { shop } }),
    };
  }

  return snapshot;
}

async function main() {
  const command = process.argv[2];
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  if (command === "seed") {
    await seedCleanupDockerFixtures();
    console.log(JSON.stringify(await snapshotCleanupDockerFixtures(), null, 2));
    return;
  }

  if (command === "snapshot") {
    console.log(JSON.stringify(await snapshotCleanupDockerFixtures(), null, 2));
    return;
  }

  throw new Error("Usage: tsx scripts/cleanup-docker-fixtures.mts <seed|snapshot>");
}

const invokedPath = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedPath.endsWith("/cleanup-docker-fixtures.mts")) {
  await main();
}
