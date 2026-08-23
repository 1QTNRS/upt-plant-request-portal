import prisma from "../db.server";
import { APPROVED_SMOKE_SHOP, assertApprovedSmokeShop } from "./pr-risk";

export const SMOKE_EMAIL_PATTERN = /^smoke\+[a-z0-9._-]+@upt-smoke\.test$/i;

export function isSmokeAutomationEmail(email: string): boolean {
  return SMOKE_EMAIL_PATTERN.test(email.trim());
}

/**
 * Deletes only automation-created portal rows for the approved dev shop.
 * Refuses any other shop. Never touches production UPT data.
 */
export async function cleanupSmokePortalData(shop: string): Promise<{
  requests: number;
  customers: number;
}> {
  assertApprovedSmokeShop(shop);
  if (shop !== APPROVED_SMOKE_SHOP) {
    throw new Error("Smoke cleanup refused.");
  }

  const customers = await prisma.customerProfile.findMany({
    where: { shop, email: { contains: "@upt-smoke.test" } },
    select: { id: true, email: true },
  });
  const ids = customers
    .filter((row) => isSmokeAutomationEmail(row.email))
    .map((row) => row.id);

  if (ids.length === 0) return { requests: 0, customers: 0 };

  const deletedRequests = await prisma.plantRequest.deleteMany({
    where: { shop, customerId: { in: ids } },
  });
  const deletedCustomers = await prisma.customerProfile.deleteMany({
    where: { shop, id: { in: ids } },
  });

  return { requests: deletedRequests.count, customers: deletedCustomers.count };
}
