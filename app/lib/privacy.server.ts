import prisma from "../db.server";

export type CustomerPrivacySubject = {
  shopifyCustomerId?: string | null;
  email?: string | null;
};

/**
 * Matches the portal's own ownership rule: a Shopify customer id identifies the
 * shopper, with email as the fallback for requests submitted before their
 * account was linked.
 */
function subjectFilters(subject: CustomerPrivacySubject) {
  const filters: Array<Record<string, unknown>> = [];
  const shopifyCustomerId = subject.shopifyCustomerId
    ? String(subject.shopifyCustomerId)
    : "";
  const email = subject.email?.trim().toLowerCase() ?? "";

  if (shopifyCustomerId) filters.push({ shopifyCustomerId });
  if (email) filters.push({ customerEmail: email });
  return filters;
}

export type CustomerDataExport = {
  shop: string;
  customer: { name: string; email: string; shopifyCustomerId: string | null };
  requests: Array<{
    requestNumber: string;
    status: string;
    submittedAt: string;
    items: Array<{ plantName: string; offeredName: string; itemStatus: string }>;
  }>;
  emails: Array<{ subject: string; sentAt: string | null; templateKey: string }>;
};

/**
 * Assembles everything the portal stores about a shopper, for the merchant to
 * forward in response to a `customers/data_request` webhook.
 */
export async function exportCustomerData(
  shop: string,
  subject: CustomerPrivacySubject,
): Promise<CustomerDataExport[]> {
  const filters = subjectFilters(subject);
  if (filters.length === 0) return [];

  const requests = await prisma.plantRequest.findMany({
    where: { shop, OR: filters },
    include: { items: true, emails: true },
    orderBy: { submittedAt: "asc" },
  });
  if (requests.length === 0) return [];

  return [
    {
      shop,
      customer: {
        name: requests[0].customerName,
        email: requests[0].customerEmail,
        shopifyCustomerId: requests[0].shopifyCustomerId,
      },
      requests: requests.map((request) => ({
        requestNumber: request.requestNumber,
        status: request.status,
        submittedAt: request.submittedAt.toISOString(),
        items: request.items.map((item) => ({
          plantName: item.plantName,
          offeredName: item.offeredName,
          itemStatus: item.itemStatus,
        })),
      })),
      emails: requests.flatMap((request) =>
        request.emails.map((email) => ({
          subject: email.subject,
          sentAt: email.sentAt?.toISOString() ?? null,
          templateKey: email.templateKey,
        })),
      ),
    },
  ];
}

/**
 * Erases a shopper's portal data. Requests cascade to items, photos, offers,
 * responses, draft-order and order references, and status events.
 */
export async function redactCustomerData(
  shop: string,
  subject: CustomerPrivacySubject,
): Promise<{ requestsDeleted: number; profilesDeleted: number }> {
  const filters = subjectFilters(subject);
  if (filters.length === 0) return { requestsDeleted: 0, profilesDeleted: 0 };

  const requests = await prisma.plantRequest.findMany({
    where: { shop, OR: filters },
    select: { id: true },
  });
  const requestIds = requests.map((request) => request.id);

  // Emails only SetNull on request delete, so remove them explicitly.
  if (requestIds.length > 0) {
    await prisma.emailMessage.deleteMany({
      where: { shop, requestId: { in: requestIds } },
    });
  }
  const deletedRequests = await prisma.plantRequest.deleteMany({
    where: { shop, OR: filters },
  });

  const profileFilters: Array<Record<string, unknown>> = [];
  if (subject.shopifyCustomerId) {
    profileFilters.push({ shopifyCustomerId: String(subject.shopifyCustomerId) });
  }
  if (subject.email?.trim()) {
    profileFilters.push({ email: subject.email.trim().toLowerCase() });
  }
  const deletedProfiles = await prisma.customerProfile.deleteMany({
    where: { shop, OR: profileFilters },
  });

  return {
    requestsDeleted: deletedRequests.count,
    profilesDeleted: deletedProfiles.count,
  };
}

/** Erases every trace of a shop after `shop/redact`. */
export async function redactShopData(shop: string): Promise<void> {
  await prisma.emailMessage.deleteMany({ where: { shop } });
  await prisma.exactPlantListing.deleteMany({ where: { shop } });
  await prisma.plantRequest.deleteMany({ where: { shop } });
  await prisma.customerProfile.deleteMany({ where: { shop } });
  await prisma.requestNumberSequence.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.session.deleteMany({ where: { shop } });
}
