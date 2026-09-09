import prisma from "../db.server";
import { deleteDraftOrder, readDraftOrderStatus } from "./shopify-ops.server";
import type { GraphqlClient } from "./shopify-ops.server";

/** Exact token required on the CLI to run destructive cleanup. */
export const TEST_CUSTOMER_CLEANUP_CONFIRM = "DELETE-TEST-DATA";

export const DEFAULT_PRODUCTION_SHOP =
  "unsolicited-plant-talks.myshopify.com";

export function normalizeCleanupEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidCleanupConfirmation(value: string | undefined): boolean {
  return value === TEST_CUSTOMER_CLEANUP_CONFIRM;
}

export type TestCustomerCleanupCounts = {
  requests: number;
  requestItems: number;
  photos: number;
  offers: number;
  offerItems: number;
  responses: number;
  responseItems: number;
  draftOrderReferences: number;
  shopifyOrderReferences: number;
  statusEvents: number;
  internalNotes: number;
  exactPlantListings: number;
  emailMessages: number;
  adminPushMessages: number;
};

export type TestCustomerRequestAudit = {
  id: string;
  requestNumber: string;
  status: string;
  submittedAt: string;
  closedAt: string | null;
  paidAt: string | null;
  customerName: string;
  customerEmail: string;
  shopifyCustomerId: string | null;
  itemCount: number;
  hasOffer: boolean;
  hasResponse: boolean;
  draftOrder: {
    shopifyDraftOrderGid: string | null;
    invoiceUrl: string | null;
    voidedAt: string | null;
    paidAt: string | null;
    reserveInventoryUntil: string | null;
  } | null;
  shopifyOrder: {
    shopifyOrderGid: string;
    orderNumber: string | null;
    paidAt: string;
    plantRevenue: number;
  } | null;
  exactPlantListings: Array<{
    id: string;
    title: string;
    status: string;
    shopifyProductGid: string | null;
    shopifyProductHandle: string | null;
  }>;
  statusEventCount: number;
  internalNoteCount: number;
  emailMessageCount: number;
  adminPushMessageCount: number;
};

export type ShopifyDraftOrderAudit = {
  requestNumber: string;
  shopifyDraftOrderGid: string;
  portalVoidedAt: string | null;
  liveStatus: string | null;
  liveInvoiceUrl: string | null;
  completedOrderGid: string | null;
  lookupError: string | null;
};

export type ShopifyCompletedOrderAudit = {
  requestNumber: string;
  shopifyOrderGid: string;
  orderNumber: string | null;
  portalPaidAt: string;
  plantRevenue: number;
  liveName: string | null;
  liveDisplayFinancialStatus: string | null;
  lookupError: string | null;
};

export type ShopifyExactPlantProductAudit = {
  requestNumber: string;
  listingId: string;
  title: string;
  listingStatus: string;
  shopifyProductGid: string;
  shopifyProductHandle: string | null;
  liveTitle: string | null;
  liveTotalInventory: number | null;
  lookupError: string | null;
};

export type TestCustomerCleanupAudit = {
  shop: string;
  email: string;
  normalizedEmail: string;
  customerProfiles: Array<{
    id: string;
    email: string;
    name: string;
    shopifyCustomerId: string | null;
    requestCount: number;
  }>;
  requests: TestCustomerRequestAudit[];
  counts: TestCustomerCleanupCounts;
  analyticsImpact: {
    computedDynamically: true;
    note: string;
    requestNumbersRemoved: string[];
    statuses: Record<string, number>;
    purchasedRequestCount: number;
    totalPlantRevenue: number;
  };
  shopify: {
    draftOrders: ShopifyDraftOrderAudit[];
    completedOrders: ShopifyCompletedOrderAudit[];
    exactPlantProducts: ShopifyExactPlantProductAudit[];
    draftOrdersEligibleForVoid: number;
    completedOrdersRequireManualReview: number;
    exactPlantProductsRequireManualReview: number;
  };
};

const requestInclude = {
  items: {
    include: { exactPlantListing: true, photos: true },
  },
  offer: { include: { items: true } },
  response: { include: { items: true } },
  draftOrder: true,
  shopifyOrder: true,
  statusEvents: true,
  internalNotes: true,
  emails: true,
  pushMessages: true,
} as const;

function sumCounts(requests: Awaited<
  ReturnType<typeof loadRequestsForCleanupEmail>
>): TestCustomerCleanupCounts {
  return {
    requests: requests.length,
    requestItems: requests.reduce((n, r) => n + r.items.length, 0),
    photos: requests.reduce(
      (n, r) => n + r.items.reduce((m, i) => m + i.photos.length, 0),
      0,
    ),
    offers: requests.filter((r) => r.offer).length,
    offerItems: requests.reduce((n, r) => n + (r.offer?.items.length ?? 0), 0),
    responses: requests.filter((r) => r.response).length,
    responseItems: requests.reduce(
      (n, r) => n + (r.response?.items.length ?? 0),
      0,
    ),
    draftOrderReferences: requests.filter((r) => r.draftOrder).length,
    shopifyOrderReferences: requests.filter((r) => r.shopifyOrder).length,
    statusEvents: requests.reduce((n, r) => n + r.statusEvents.length, 0),
    internalNotes: requests.reduce((n, r) => n + r.internalNotes.length, 0),
    exactPlantListings: requests.reduce(
      (n, r) => n + r.items.filter((i) => i.exactPlantListing).length,
      0,
    ),
    emailMessages: requests.reduce((n, r) => n + r.emails.length, 0),
    adminPushMessages: requests.reduce((n, r) => n + r.pushMessages.length, 0),
  };
}

function toRequestAudit(
  request: Awaited<ReturnType<typeof loadRequestsForCleanupEmail>>[number],
): TestCustomerRequestAudit {
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    submittedAt: request.submittedAt.toISOString(),
    closedAt: request.closedAt?.toISOString() ?? null,
    paidAt: request.paidAt?.toISOString() ?? null,
    customerName: request.customerName,
    customerEmail: request.customerEmail,
    shopifyCustomerId: request.shopifyCustomerId,
    itemCount: request.items.length,
    hasOffer: Boolean(request.offer),
    hasResponse: Boolean(request.response),
    draftOrder: request.draftOrder
      ? {
          shopifyDraftOrderGid: request.draftOrder.shopifyDraftOrderGid,
          invoiceUrl: request.draftOrder.invoiceUrl,
          voidedAt: request.draftOrder.voidedAt?.toISOString() ?? null,
          paidAt: request.draftOrder.paidAt?.toISOString() ?? null,
          reserveInventoryUntil:
            request.draftOrder.reserveInventoryUntil?.toISOString() ?? null,
        }
      : null,
    shopifyOrder: request.shopifyOrder
      ? {
          shopifyOrderGid: request.shopifyOrder.shopifyOrderGid,
          orderNumber: request.shopifyOrder.orderNumber,
          paidAt: request.shopifyOrder.paidAt.toISOString(),
          plantRevenue: request.shopifyOrder.plantRevenue,
        }
      : null,
    exactPlantListings: request.items
      .filter((item) => item.exactPlantListing)
      .map((item) => ({
        id: item.exactPlantListing!.id,
        title: item.exactPlantListing!.title,
        status: item.exactPlantListing!.status,
        shopifyProductGid: item.exactPlantListing!.shopifyProductGid,
        shopifyProductHandle: item.exactPlantListing!.shopifyProductHandle,
      })),
    statusEventCount: request.statusEvents.length,
    internalNoteCount: request.internalNotes.length,
    emailMessageCount: request.emails.length,
    adminPushMessageCount: request.pushMessages.length,
  };
}

async function loadRequestsForCleanupEmail(shop: string, email: string) {
  const normalizedEmail = normalizeCleanupEmail(email);
  const customers = await prisma.customerProfile.findMany({
    where: { shop, email: normalizedEmail },
    select: { id: true },
  });
  const customerIds = customers.map((row) => row.id);

  return prisma.plantRequest.findMany({
    where: {
      shop,
      OR: [
        { customerEmail: normalizedEmail },
        ...(customerIds.length > 0
          ? [{ customerId: { in: customerIds } }]
          : []),
      ],
    },
    include: requestInclude,
    orderBy: { submittedAt: "asc" },
  });
}

async function readShopifyOrderSummary(
  admin: GraphqlClient,
  orderGid: string,
): Promise<{
  name: string | null;
  displayFinancialStatus: string | null;
} | null> {
  const data = await admin.graphql(
    `#graphql
      query TestCleanupOrderSummary($id: ID!) {
        order(id: $id) {
          name
          displayFinancialStatus
        }
      }
    `,
    { variables: { id: orderGid } },
  );
  const json = (await data.json()) as {
    data?: {
      order?: { name: string; displayFinancialStatus: string } | null;
    };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  const order = json.data?.order;
  if (!order) return null;
  return {
    name: order.name,
    displayFinancialStatus: order.displayFinancialStatus,
  };
}

async function readShopifyProductSummary(
  admin: GraphqlClient,
  productGid: string,
): Promise<{ title: string | null; totalInventory: number | null } | null> {
  const data = await admin.graphql(
    `#graphql
      query TestCleanupProductSummary($id: ID!) {
        product(id: $id) {
          title
          totalInventory
        }
      }
    `,
    { variables: { id: productGid } },
  );
  const json = (await data.json()) as {
    data?: {
      product?: { title: string; totalInventory: number } | null;
    };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  const product = json.data?.product;
  if (!product) return null;
  return {
    title: product.title,
    totalInventory: product.totalInventory,
  };
}

export async function auditTestCustomerCleanup(
  shop: string,
  email: string,
  admin?: GraphqlClient,
): Promise<TestCustomerCleanupAudit> {
  const normalizedEmail = normalizeCleanupEmail(email);
  const requests = await loadRequestsForCleanupEmail(shop, normalizedEmail);
  const requestIds = requests.map((row) => row.id);

  const customers = await prisma.customerProfile.findMany({
    where: { shop, email: normalizedEmail },
    select: {
      id: true,
      email: true,
      name: true,
      shopifyCustomerId: true,
      _count: { select: { requests: true } },
    },
  });

  const counts = sumCounts(requests);
  const statuses: Record<string, number> = {};
  for (const request of requests) {
    statuses[request.status] = (statuses[request.status] ?? 0) + 1;
  }

  const draftOrders: ShopifyDraftOrderAudit[] = [];
  for (const request of requests) {
    const gid = request.draftOrder?.shopifyDraftOrderGid;
    if (!gid) continue;
    const row: ShopifyDraftOrderAudit = {
      requestNumber: request.requestNumber,
      shopifyDraftOrderGid: gid,
      portalVoidedAt: request.draftOrder?.voidedAt?.toISOString() ?? null,
      liveStatus: null,
      liveInvoiceUrl: null,
      completedOrderGid: null,
      lookupError: null,
    };
    if (admin) {
      try {
        const live = await readDraftOrderStatus(admin, gid);
        if (live) {
          row.liveStatus = live.status;
          row.liveInvoiceUrl = live.invoiceUrl;
          row.completedOrderGid = live.orderGid;
        } else {
          row.lookupError = "Shopify draft order not found (already deleted?)";
        }
      } catch (error) {
        row.lookupError =
          error instanceof Error ? error.message : String(error);
      }
    }
    draftOrders.push(row);
  }

  const completedOrders: ShopifyCompletedOrderAudit[] = [];
  for (const request of requests) {
    const ref = request.shopifyOrder;
    if (!ref) continue;
    const row: ShopifyCompletedOrderAudit = {
      requestNumber: request.requestNumber,
      shopifyOrderGid: ref.shopifyOrderGid,
      orderNumber: ref.orderNumber,
      portalPaidAt: ref.paidAt.toISOString(),
      plantRevenue: ref.plantRevenue,
      liveName: null,
      liveDisplayFinancialStatus: null,
      lookupError: null,
    };
    if (admin) {
      try {
        const live = await readShopifyOrderSummary(admin, ref.shopifyOrderGid);
        if (live) {
          row.liveName = live.name;
          row.liveDisplayFinancialStatus = live.displayFinancialStatus;
        } else {
          row.lookupError = "Shopify order not found";
        }
      } catch (error) {
        row.lookupError =
          error instanceof Error ? error.message : String(error);
      }
    }
    completedOrders.push(row);
  }

  const exactPlantProducts: ShopifyExactPlantProductAudit[] = [];
  for (const request of requests) {
    for (const item of request.items) {
      const listing = item.exactPlantListing;
      const gid = listing?.shopifyProductGid;
      if (!listing || !gid) continue;
      const row: ShopifyExactPlantProductAudit = {
        requestNumber: request.requestNumber,
        listingId: listing.id,
        title: listing.title,
        listingStatus: listing.status,
        shopifyProductGid: gid,
        shopifyProductHandle: listing.shopifyProductHandle,
        liveTitle: null,
        liveTotalInventory: null,
        lookupError: null,
      };
      if (admin) {
        try {
          const live = await readShopifyProductSummary(admin, gid);
          if (live) {
            row.liveTitle = live.title;
            row.liveTotalInventory = live.totalInventory;
          } else {
            row.lookupError = "Shopify product not found";
          }
        } catch (error) {
          row.lookupError =
            error instanceof Error ? error.message : String(error);
        }
      }
      exactPlantProducts.push(row);
    }
  }

  const draftOrdersEligibleForVoid = draftOrders.filter(
    (row) =>
      row.liveStatus !== "COMPLETED" &&
      !row.portalVoidedAt &&
      Boolean(row.shopifyDraftOrderGid),
  ).length;

  return {
    shop,
    email,
    normalizedEmail,
    customerProfiles: customers.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      shopifyCustomerId: row.shopifyCustomerId,
      requestCount: row._count.requests,
    })),
    requests: requests.map(toRequestAudit),
    counts,
    analyticsImpact: {
      computedDynamically: true,
      note:
        "Portal analytics are computed from PlantRequest and related rows at query time; deleting these requests removes them from counts, revenue, accept/decline stats, and monthly totals automatically. No separate analytics cache exists.",
      requestNumbersRemoved: requests.map((row) => row.requestNumber),
      statuses,
      purchasedRequestCount: requests.filter((row) => row.shopifyOrder).length,
      totalPlantRevenue: requests.reduce(
        (sum, row) => sum + (row.shopifyOrder?.plantRevenue ?? 0),
        0,
      ),
    },
    shopify: {
      draftOrders,
      completedOrders,
      exactPlantProducts,
      draftOrdersEligibleForVoid,
      completedOrdersRequireManualReview: completedOrders.length,
      exactPlantProductsRequireManualReview: exactPlantProducts.length,
    },
  };
}

export type TestCustomerCleanupDeleteResult = {
  deletedRequests: number;
  deletedEmailMessages: number;
  deletedAdminPushMessages: number;
  deletedCustomerProfiles: number;
  voidedShopifyDraftOrders: number;
  shopifyDraftVoidErrors: Array<{ requestNumber: string; error: string }>;
};

export async function deleteTestCustomerCleanup(
  shop: string,
  email: string,
  options: {
    voidShopifyDrafts?: boolean;
    admin?: GraphqlClient;
  } = {},
): Promise<TestCustomerCleanupDeleteResult> {
  const normalizedEmail = normalizeCleanupEmail(email);
  const requests = await loadRequestsForCleanupEmail(shop, normalizedEmail);
  const requestIds = requests.map((row) => row.id);
  const requestNumbers = requests.map((row) => row.requestNumber);

  if (requestIds.length === 0) {
    return {
      deletedRequests: 0,
      deletedEmailMessages: 0,
      deletedAdminPushMessages: 0,
      deletedCustomerProfiles: 0,
      voidedShopifyDraftOrders: 0,
      shopifyDraftVoidErrors: [],
    };
  }

  const shopifyDraftVoidErrors: Array<{ requestNumber: string; error: string }> =
    [];
  let voidedShopifyDraftOrders = 0;

  if (options.voidShopifyDrafts && options.admin) {
    for (const request of requests) {
      const gid = request.draftOrder?.shopifyDraftOrderGid;
      if (!gid || request.draftOrder?.voidedAt) continue;
      try {
        const live = await readDraftOrderStatus(options.admin, gid);
        if (live?.status === "COMPLETED") {
          shopifyDraftVoidErrors.push({
            requestNumber: request.requestNumber,
            error:
              "Draft order already completed in Shopify; not deleted automatically.",
          });
          continue;
        }
        await deleteDraftOrder(options.admin, gid);
        voidedShopifyDraftOrders += 1;
      } catch (error) {
        shopifyDraftVoidErrors.push({
          requestNumber: request.requestNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const deletedEmailMessages = await tx.emailMessage.deleteMany({
      where: {
        shop,
        OR: [
          { requestId: { in: requestIds } },
          { toEmail: normalizedEmail },
        ],
      },
    });
    const deletedAdminPushMessages = await tx.adminPushMessage.deleteMany({
      where: { shop, requestId: { in: requestIds } },
    });
    const deletedRequests = await tx.plantRequest.deleteMany({
      where: { shop, id: { in: requestIds } },
    });

    const customers = await tx.customerProfile.findMany({
      where: { shop, email: normalizedEmail },
      select: { id: true, _count: { select: { requests: true } } },
    });
    const orphanCustomerIds = customers
      .filter((row) => row._count.requests === 0)
      .map((row) => row.id);
    const deletedCustomerProfiles =
      orphanCustomerIds.length > 0
        ? (
            await tx.customerProfile.deleteMany({
              where: { shop, id: { in: orphanCustomerIds } },
            })
          ).count
        : 0;

    return {
      deletedRequests: deletedRequests.count,
      deletedEmailMessages: deletedEmailMessages.count,
      deletedAdminPushMessages: deletedAdminPushMessages.count,
      deletedCustomerProfiles,
    };
  });

  await verifyTestCustomerCleanup(shop, normalizedEmail, requestNumbers);

  return {
    ...result,
    voidedShopifyDraftOrders,
    shopifyDraftVoidErrors,
  };
}

export type TestCustomerCleanupVerification = {
  remainingRequests: number;
  remainingByEmail: number;
  remainingByRequestNumber: string[];
  remainingEmailMessages: number;
  remainingAdminPushMessages: number;
  remainingExactPlantListings: number;
  remainingDraftOrderReferences: number;
  remainingShopifyOrderReferences: number;
};

export async function verifyTestCustomerCleanup(
  shop: string,
  email: string,
  requestNumbers: string[] = [],
): Promise<TestCustomerCleanupVerification> {
  const normalizedEmail = normalizeCleanupEmail(email);
  const remainingRequests = await prisma.plantRequest.count({
    where: { shop, customerEmail: normalizedEmail },
  });
  const remainingByEmail = await prisma.plantRequest.count({
    where: {
      shop,
      OR: [
        { customerEmail: normalizedEmail },
        { response: { customerEmail: normalizedEmail } },
      ],
    },
  });

  const remainingByRequestNumber: string[] = [];
  for (const requestNumber of requestNumbers) {
    const row = await prisma.plantRequest.findFirst({
      where: { shop, requestNumber },
      select: { requestNumber: true },
    });
    if (row) remainingByRequestNumber.push(row.requestNumber);
  }

  const remainingEmailMessages = await prisma.emailMessage.count({
    where: { shop, toEmail: normalizedEmail },
  });
  const remainingAdminPushMessages = await prisma.adminPushMessage.count({
    where: {
      shop,
      requestId: { not: null },
      request: { customerEmail: normalizedEmail },
    },
  });
  const remainingExactPlantListings = await prisma.exactPlantListing.count({
    where: {
      shop,
      requestItem: { request: { customerEmail: normalizedEmail } },
    },
  });
  const remainingDraftOrderReferences = await prisma.draftOrderReference.count({
    where: { request: { shop, customerEmail: normalizedEmail } },
  });
  const remainingShopifyOrderReferences =
    await prisma.shopifyOrderReference.count({
      where: { request: { shop, customerEmail: normalizedEmail } },
    });

  const verification = {
    remainingRequests,
    remainingByEmail,
    remainingByRequestNumber,
    remainingEmailMessages,
    remainingAdminPushMessages,
    remainingExactPlantListings,
    remainingDraftOrderReferences,
    remainingShopifyOrderReferences,
  };

  const hasRemnants =
    verification.remainingRequests > 0 ||
    verification.remainingByEmail > 0 ||
    verification.remainingByRequestNumber.length > 0 ||
    verification.remainingExactPlantListings > 0 ||
    verification.remainingDraftOrderReferences > 0 ||
    verification.remainingShopifyOrderReferences > 0;

  if (hasRemnants) {
    throw new Error(
      `Cleanup verification failed for ${normalizedEmail}: ${JSON.stringify(verification)}`,
    );
  }

  return verification;
}
