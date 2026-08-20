import type {
  CustomerResponse as DbCustomerResponse,
  Offer,
  OfferItem,
  PhotoReference,
  PlantRequest as DbPlantRequest,
  RequestItem,
} from "@prisma/client";

import prisma from "../db.server";
import {
  DEFAULT_FEDEX_REMOVAL_WARNING,
  DEFAULT_UNAVAILABLE_REASON,
  FEDEX_PRODUCT_HANDLE,
  formatDate,
  formatDateTime,
  getOfferHoldMessage,
  getOfferUrgencyMessage,
  normalizePrice,
  normalizeQuantity,
  normalizeRequestStatus,
  normalizeUnavailableReason,
  normalizeWeight,
  type CustomerOfferResponse,
  type CustomerResponseItem,
  type CustomerResponseItemChoice,
  type DraftOrderLineItem,
  type ItemAvailabilityStatus,
  type OfferExpirationDays,
  type OfferPlantItem,
  type PlantItem,
  type PlantItemStatus,
  type PlantRequest,
  type SampleCustomerOffer,
  type SentOffer,
  type UnavailableReason,
} from "./portal";

export const prismaClient = prisma;

type RequestWithRelations = DbPlantRequest & {
  items: Array<RequestItem & { photos: PhotoReference[] }>;
  offer?:
    | (Offer & {
        items: OfferItem[];
      })
    | null;
  response?: DbCustomerResponse | null;
  draftOrder?: {
    invoiceUrl: string | null;
    shopifyDraftOrderGid: string | null;
    createdAt: Date;
  } | null;
};

const requestInclude = {
  items: { include: { photos: { orderBy: { sortOrder: "asc" as const } } } },
  offer: { include: { items: true } },
  response: true,
  draftOrder: true,
} as const;

function placeholderPhoto(seed: string): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/800`;
}

function parsePhotoUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function toPlantItem(item: RequestItem & { photos: PhotoReference[] }): PlantItem {
  const photoUrls =
    item.photos.length > 0
      ? item.photos.map((photo) => photo.url)
      : [placeholderPhoto(item.id)];

  const adminNotes = [
    item.budget ? `Customer budget: ${item.budget}` : "",
    item.customerRequestNotes ?? "",
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    id: item.id,
    plantName: item.plantName,
    offeredName: item.offeredName || item.plantName,
    quantity: normalizeQuantity(item.quantity),
    itemStatus: (item.itemStatus as PlantItemStatus) || "Requested",
    availability:
      item.availability === "not_available" ? "not_available" : "available",
    unavailableReason: normalizeUnavailableReason(item.unavailableReason),
    price: normalizePrice(item.price),
    weightLbs: normalizeWeight(item.weightLbs),
    budget: item.budget ?? undefined,
    customerRequestNotes: item.customerRequestNotes ?? undefined,
    adminNotes,
    customerFacingNotes: item.customerFacingNotes ?? "",
    photoPreviewUrl: photoUrls[0] ?? placeholderPhoto(item.id),
    photoUrls,
  };
}

function toSentOffer(offer: Offer, requestId: string): SentOffer {
  return {
    offerLink: offer.offerLink || `/app/customer-offer-preview?requestId=${requestId}`,
    sentAt: formatDateTime(offer.sentAt),
    expiresAt: formatDateTime(offer.expiresAt),
    expiresAtIso: offer.expiresAt.toISOString(),
    expirationDays: offer.expirationDays as OfferExpirationDays,
  };
}

export function toPlantRequest(request: RequestWithRelations): PlantRequest {
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    customer: request.customerName,
    email: request.customerEmail,
    shopifyCustomerId: request.shopifyCustomerId ?? undefined,
    status: normalizeRequestStatus(request.status),
    submittedDate: formatDate(request.submittedAt),
    submittedAtIso: request.submittedAt.toISOString(),
    closedAt: request.closedAt ? formatDateTime(request.closedAt) : undefined,
    expiredAt: request.expiredAt ? formatDateTime(request.expiredAt) : undefined,
    paidAt: request.paidAt ? formatDateTime(request.paidAt) : undefined,
    items: request.items.map(toPlantItem),
    sentOffer: request.offer ? toSentOffer(request.offer, request.id) : undefined,
  };
}

export async function expireOverdueOffers(shop: string, now = new Date()): Promise<number> {
  const pending = await prisma.plantRequest.findMany({
    where: {
      shop,
      status: "Pending",
      paidAt: null,
      offer: { expiresAt: { lte: now } },
    },
    include: { offer: true },
  });

  for (const request of pending) {
    await prisma.$transaction([
      prisma.plantRequest.update({
        where: { id: request.id },
        data: { status: "Expired", expiredAt: now },
      }),
      prisma.statusEvent.create({
        data: {
          requestId: request.id,
          fromStatus: "Pending",
          toStatus: "Expired",
          reason: "Offer expired before payment",
        },
      }),
    ]);
  }

  return pending.length;
}

async function loadRequest(
  shop: string,
  requestId: string,
): Promise<RequestWithRelations | null> {
  await expireOverdueOffers(shop);
  return prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    include: requestInclude,
  });
}

export async function getShopSettings(shop: string) {
  const existing = await prisma.shopSettings.findUnique({ where: { shop } });
  if (existing) return existing;

  return prisma.shopSettings.create({
    data: {
      shop,
      fedexRemovalWarning: DEFAULT_FEDEX_REMOVAL_WARNING,
      fedexProductHandle: FEDEX_PRODUCT_HANDLE,
    },
  });
}

export async function updateShopSettings(
  shop: string,
  data: {
    fedexRemovalWarning?: string;
    adminNotificationEmail?: string;
    fedexVariantGid?: string | null;
  },
) {
  await getShopSettings(shop);
  return prisma.shopSettings.update({
    where: { shop },
    data: {
      ...(data.fedexRemovalWarning !== undefined
        ? {
            fedexRemovalWarning:
              data.fedexRemovalWarning.trim() || DEFAULT_FEDEX_REMOVAL_WARNING,
          }
        : {}),
      ...(data.adminNotificationEmail !== undefined
        ? { adminNotificationEmail: data.adminNotificationEmail.trim() }
        : {}),
      ...(data.fedexVariantGid !== undefined
        ? { fedexVariantGid: data.fedexVariantGid }
        : {}),
    },
  });
}

async function nextRequestNumber(shop: string): Promise<string> {
  const year = new Date().getFullYear();
  const sequence = await prisma.requestNumberSequence.upsert({
    where: { shop_year: { shop, year } },
    create: { shop, year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });

  const value = sequence.nextValue - 1;
  return `UPT-REQ-${year}-${String(value).padStart(6, "0")}`;
}

export async function findOrCreateCustomer(
  shop: string,
  input: {
    name: string;
    email: string;
    shopifyCustomerId?: string;
  },
) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (input.shopifyCustomerId) {
    const byShopify = await prisma.customerProfile.findFirst({
      where: { shop, shopifyCustomerId: input.shopifyCustomerId },
    });
    if (byShopify) {
      return prisma.customerProfile.update({
        where: { id: byShopify.id },
        data: {
          name: name || byShopify.name,
          email: email || byShopify.email,
        },
      });
    }
  }

  const existing = await prisma.customerProfile.findUnique({
    where: { shop_email: { shop, email } },
  });
  if (existing) {
    return prisma.customerProfile.update({
      where: { id: existing.id },
      data: {
        name: name || existing.name,
        shopifyCustomerId: input.shopifyCustomerId ?? existing.shopifyCustomerId,
      },
    });
  }

  return prisma.customerProfile.create({
    data: {
      shop,
      name: name || email,
      email,
      shopifyCustomerId: input.shopifyCustomerId,
    },
  });
}

export async function listRequests(shop: string): Promise<PlantRequest[]> {
  await expireOverdueOffers(shop);
  const rows = await prisma.plantRequest.findMany({
    where: { shop },
    include: requestInclude,
    orderBy: { submittedAt: "desc" },
  });
  return rows.map(toPlantRequest);
}

export async function getRequest(
  shop: string,
  requestId: string,
): Promise<PlantRequest | null> {
  const row = await loadRequest(shop, requestId);
  return row ? toPlantRequest(row) : null;
}

export async function markRequestViewed(shop: string, requestId: string) {
  await prisma.plantRequest.updateMany({
    where: { id: requestId, shop, firstViewedAt: null },
    data: { firstViewedAt: new Date() },
  });
}

export async function listCustomerRequests(
  shop: string,
  identity: { email?: string; shopifyCustomerId?: string },
): Promise<PlantRequest[]> {
  await expireOverdueOffers(shop);
  const email = identity.email?.trim().toLowerCase();
  const identityFilters = [
    email ? { customerEmail: email } : undefined,
    identity.shopifyCustomerId
      ? { shopifyCustomerId: identity.shopifyCustomerId }
      : undefined,
  ].filter(Boolean) as Array<{ customerEmail?: string; shopifyCustomerId?: string }>;

  if (identityFilters.length === 0) return [];

  const rows = await prisma.plantRequest.findMany({
    where: {
      shop,
      OR: identityFilters,
    },
    include: requestInclude,
    orderBy: { submittedAt: "desc" },
  });
  return rows.map(toPlantRequest);
}

export async function submitCustomerRequest(
  shop: string,
  input: {
    name: string;
    email: string;
    shopifyCustomerId?: string;
    items: Array<{ plantName: string; budget?: string; notes?: string }>;
  },
): Promise<PlantRequest> {
  const customer = await findOrCreateCustomer(shop, input);
  const requestNumber = await nextRequestNumber(shop);

  const created = await prisma.plantRequest.create({
    data: {
      shop,
      requestNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      shopifyCustomerId: customer.shopifyCustomerId,
      status: "New",
      items: {
        create: input.items.map((item) => ({
          plantName: item.plantName.trim(),
          offeredName: item.plantName.trim(),
          budget: item.budget?.trim() || null,
          customerRequestNotes: item.notes?.trim() || null,
          quantity: 1,
          availability: "available",
          unavailableReason: DEFAULT_UNAVAILABLE_REASON,
          price: 0,
          weightLbs: 0,
          itemStatus: "Requested",
        })),
      },
      statusEvents: {
        create: {
          toStatus: "New",
          reason: "Customer submitted request",
        },
      },
    },
    include: requestInclude,
  });

  return toPlantRequest(created);
}

export async function updateRequestItem(
  shop: string,
  input: {
    requestId: string;
    itemId: string;
    offeredName?: string;
    availability?: ItemAvailabilityStatus;
    unavailableReason?: UnavailableReason;
    price?: number;
    weightLbs?: number;
    customerFacingNotes?: string;
    photoUrls?: string[];
  },
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, input.requestId);
  if (!request) return null;
  if (normalizeRequestStatus(request.status) !== "New") {
    throw new Error("Only New requests can be edited before an offer is sent.");
  }

  const item = request.items.find((entry) => entry.id === input.itemId);
  if (!item) return null;

  await prisma.requestItem.update({
    where: { id: item.id },
    data: {
      ...(input.offeredName !== undefined
        ? { offeredName: input.offeredName.trim() || item.plantName }
        : {}),
      ...(input.availability
        ? {
            availability: input.availability,
            itemStatus:
              input.availability === "not_available" ? "Unavailable" : "Requested",
          }
        : {}),
      ...(input.unavailableReason
        ? { unavailableReason: normalizeUnavailableReason(input.unavailableReason) }
        : {}),
      ...(input.price !== undefined ? { price: normalizePrice(input.price) } : {}),
      ...(input.weightLbs !== undefined
        ? { weightLbs: normalizeWeight(input.weightLbs) }
        : {}),
      ...(input.customerFacingNotes !== undefined
        ? { customerFacingNotes: input.customerFacingNotes }
        : {}),
    },
  });

  if (input.photoUrls) {
    await prisma.$transaction([
      prisma.photoReference.deleteMany({ where: { itemId: item.id } }),
      ...input.photoUrls.filter(Boolean).map((url, index) =>
        prisma.photoReference.create({
          data: { itemId: item.id, url, sortOrder: index },
        }),
      ),
    ]);
  }

  return getRequest(shop, input.requestId);
}

export async function addItemPhotos(
  shop: string,
  requestId: string,
  itemId: string,
  photos: Array<{ url: string; shopifyFileId?: string }>,
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;
  if (normalizeRequestStatus(request.status) !== "New") {
    throw new Error("Photos can only be added before an offer is sent.");
  }

  const currentCount =
    request.items.find((item) => item.id === itemId)?.photos.length ?? 0;

  await prisma.photoReference.createMany({
    data: photos.map((photo, index) => ({
      itemId,
      url: photo.url,
      shopifyFileId: photo.shopifyFileId,
      sortOrder: currentCount + index,
    })),
  });

  return getRequest(shop, requestId);
}

export async function sendOffer(
  shop: string,
  requestId: string,
  expirationDays: OfferExpirationDays,
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;
  if (normalizeRequestStatus(request.status) !== "New") return null;

  const sentAt = new Date();
  const expiresAt = new Date(sentAt);
  expiresAt.setDate(expiresAt.getDate() + expirationDays);

  await prisma.$transaction(async (tx) => {
    await tx.offer.create({
      data: {
        requestId,
        sentAt,
        expiresAt,
        expirationDays,
        offerLink: `/customer/requests/${requestId}`,
        items: {
          create: request.items.map((item) => ({
            requestItemId: item.id,
            plantName: item.offeredName || item.plantName,
            quantity: normalizeQuantity(item.quantity),
            price: normalizePrice(item.price),
            weightLbs: normalizeWeight(item.weightLbs),
            customerFacingNotes: item.customerFacingNotes,
            availability: item.availability,
            unavailableReason: item.unavailableReason,
            photoUrlsJson: JSON.stringify(
              item.photos.map((photo) => photo.url).filter(Boolean),
            ),
          })),
        },
      },
    });

    for (const item of request.items) {
      await tx.requestItem.update({
        where: { id: item.id },
        data: {
          itemStatus:
            item.availability === "available" ? "Offered" : "Unavailable",
        },
      });
    }

    await tx.plantRequest.update({
      where: { id: requestId },
      data: { status: "Pending" },
    });

    await tx.statusEvent.create({
      data: {
        requestId,
        fromStatus: "New",
        toStatus: "Pending",
        reason: `Offer sent (${expirationDays} days)`,
      },
    });
  });

  return getRequest(shop, requestId);
}

function offerItemToPlant(
  item: OfferItem,
  index: number,
  requestId: string,
): OfferPlantItem {
  const photoUrls = parsePhotoUrls(item.photoUrlsJson);
  const available = item.availability === "available";
  return {
    id: `offer-${requestId}-${index + 1}`,
    sourceItemId: item.requestItemId,
    plantName: item.plantName,
    price: available ? normalizePrice(item.price) : 0,
    photoUrl: photoUrls[0] ?? placeholderPhoto(item.requestItemId),
    photoUrls: available
      ? photoUrls.length > 0
        ? photoUrls
        : [placeholderPhoto(item.requestItemId)]
      : [],
    notesFromUpt: item.customerFacingNotes,
    quantity: normalizeQuantity(item.quantity),
    availability: available ? "available" : "not_available",
    unavailableReason: available
      ? undefined
      : normalizeUnavailableReason(item.unavailableReason),
  };
}

export async function buildCustomerOffer(
  shop: string,
  requestId: string,
): Promise<SampleCustomerOffer | null> {
  const settings = await getShopSettings(shop);
  const request = await loadRequest(shop, requestId);
  if (!request?.offer) return null;

  const expiresAt = formatDateTime(request.offer.expiresAt);
  return {
    title: "Your Personal Plant Offer from UPT",
    expirationDays: request.offer.expirationDays,
    expiresAt,
    expiresAtIso: request.offer.expiresAt.toISOString(),
    urgencyMessage: getOfferUrgencyMessage(),
    holdMessage: getOfferHoldMessage(expiresAt),
    fedexUpgradeLabel: settings.fedexUpgradeLabel,
    fedexUpgradePrice: settings.fedexUpgradePrice,
    customerEmail: request.customerEmail,
    customerName: request.customerName,
    requestNumber: request.requestNumber,
    items: request.offer.items.map((item, index) =>
      offerItemToPlant(item, index, request.id),
    ),
  };
}

function toResponseDto(
  response: DbCustomerResponse & { items?: Array<{
    id: string;
    requestItemId: string;
    plantName: string;
    choice: string;
    price: number;
    quantity: number;
    customerFacingNotes: string;
    photoUrlsJson: string;
    unavailableReason: string | null;
  }> },
  closedAt?: Date | null,
): CustomerOfferResponse {
  const items = (response.items ?? []).map((item) => ({
    offerItemId: item.id,
    sourceItemId: item.requestItemId,
    plantName: item.plantName,
    choice: item.choice as CustomerResponseItemChoice,
    price: item.price,
    quantity: item.quantity,
    lineRevenue:
      item.choice === "accept" ? normalizePrice(item.price) * item.quantity : 0,
    customerNotes: item.customerFacingNotes,
    photoUrls: parsePhotoUrls(item.photoUrlsJson),
    unavailableReason: item.unavailableReason ?? undefined,
  }));

  return {
    requestId: response.requestId,
    requestNumber: response.requestNumber,
    customerName: response.customerName,
    customerEmail: response.customerEmail,
    shopifyCustomerId: response.shopifyCustomerId ?? undefined,
    respondedAt: formatDateTime(response.respondedAt),
    respondedAtIso: response.respondedAt.toISOString(),
    offerExpiresAt: response.offerExpiresAt
      ? formatDateTime(response.offerExpiresAt)
      : undefined,
    fedexUpgradeSelected: response.fedexUpgradeSelected,
    fedexUpgradePrice: response.fedexUpgradePrice,
    hasAcceptedPurchasableItems: items.some((item) => item.choice === "accept"),
    items,
    closedAt: closedAt ? formatDateTime(closedAt) : undefined,
  };
}

export async function getCustomerResponse(
  shop: string,
  requestId: string,
): Promise<CustomerOfferResponse | null> {
  const request = await loadRequest(shop, requestId);
  if (!request?.response) return null;

  const withItems = await prisma.customerResponse.findUnique({
    where: { requestId },
    include: { items: true },
  });
  if (!withItems) return null;
  return toResponseDto(withItems, request.closedAt);
}

export async function saveCustomerResponse(
  shop: string,
  input: {
    requestId: string;
    items: CustomerResponseItem[];
    fedexUpgradeSelected: boolean;
    fedexUpgradePrice: number;
  },
): Promise<CustomerOfferResponse> {
  const request = await loadRequest(shop, input.requestId);
  if (!request) throw new Error("Request not found.");
  if (normalizeRequestStatus(request.status) === "Expired") {
    throw new Error("This offer has expired.");
  }

  const snapshot = {
    customerName: request.customerName,
    customerEmail: request.customerEmail,
    shopifyCustomerId: request.shopifyCustomerId,
    requestNumber: request.requestNumber,
    submittedAt: new Date().toISOString(),
    offerExpiresAt: request.offer?.expiresAt.toISOString() ?? null,
    fedexUpgradeSelected: input.fedexUpgradeSelected,
    items: input.items,
  };

  const saved = await prisma.customerResponse.upsert({
    where: { requestId: input.requestId },
    create: {
      requestId: input.requestId,
      customerName: request.customerName,
      customerEmail: request.customerEmail,
      shopifyCustomerId: request.shopifyCustomerId,
      requestNumber: request.requestNumber,
      offerExpiresAt: request.offer?.expiresAt,
      fedexUpgradeSelected: input.fedexUpgradeSelected,
      fedexUpgradePrice: input.fedexUpgradePrice,
      snapshotJson: JSON.stringify(snapshot),
      items: {
        create: input.items.map((item) => ({
          requestItemId: item.sourceItemId,
          plantName: item.plantName,
          choice: item.choice,
          price: item.price,
          quantity: item.quantity,
          customerFacingNotes: item.customerNotes,
          photoUrlsJson: JSON.stringify(item.photoUrls ?? []),
          unavailableReason: item.unavailableReason,
        })),
      },
    },
    update: {
      respondedAt: new Date(),
      fedexUpgradeSelected: input.fedexUpgradeSelected,
      fedexUpgradePrice: input.fedexUpgradePrice,
      snapshotJson: JSON.stringify(snapshot),
      items: {
        deleteMany: {},
        create: input.items.map((item) => ({
          requestItemId: item.sourceItemId,
          plantName: item.plantName,
          choice: item.choice,
          price: item.price,
          quantity: item.quantity,
          customerFacingNotes: item.customerNotes,
          photoUrlsJson: JSON.stringify(item.photoUrls ?? []),
          unavailableReason: item.unavailableReason,
        })),
      },
    },
    include: { items: true },
  });

  return toResponseDto(saved, request.closedAt);
}

export async function closeRequest(
  shop: string,
  requestId: string,
  reason: string,
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;

  const now = new Date();
  await prisma.$transaction([
    prisma.plantRequest.update({
      where: { id: requestId },
      data: { status: "Closed", closedAt: now },
    }),
    prisma.statusEvent.create({
      data: {
        requestId,
        fromStatus: request.status,
        toStatus: "Closed",
        reason,
      },
    }),
  ]);

  return getRequest(shop, requestId);
}

export async function markRequestPaid(
  shop: string,
  requestId: string,
  order: {
    shopifyOrderGid: string;
    orderNumber?: string;
    plantRevenue: number;
  },
): Promise<PlantRequest | null> {
  const request = await loadRequest(shop, requestId);
  if (!request) return null;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.plantRequest.update({
      where: { id: requestId },
      data: { status: "Closed", closedAt: now, paidAt: now },
    });
    await tx.shopifyOrderReference.upsert({
      where: { requestId },
      create: {
        requestId,
        shopifyOrderGid: order.shopifyOrderGid,
        orderNumber: order.orderNumber,
        paidAt: now,
        plantRevenue: order.plantRevenue,
      },
      update: {
        shopifyOrderGid: order.shopifyOrderGid,
        orderNumber: order.orderNumber,
        paidAt: now,
        plantRevenue: order.plantRevenue,
      },
    });
    if (request.draftOrder) {
      await tx.draftOrderReference.update({
        where: { requestId },
        data: { paidAt: now },
      });
    }
    const acceptedIds = (
      await tx.responseItem.findMany({
        where: { response: { requestId }, choice: "accept" },
        select: { requestItemId: true },
      })
    ).map((item) => item.requestItemId);
    if (acceptedIds.length > 0) {
      await tx.requestItem.updateMany({
        where: { id: { in: acceptedIds } },
        data: { itemStatus: "Sold", purchasedAt: now },
      });
    }
    await tx.statusEvent.create({
      data: {
        requestId,
        fromStatus: request.status,
        toStatus: "Closed",
        reason: "Payment completed",
      },
    });
  });

  return getRequest(shop, requestId);
}

export async function saveDraftOrderReference(
  shop: string,
  requestId: string,
  data: {
    shopifyDraftOrderGid?: string;
    invoiceUrl?: string;
    lineItems: DraftOrderLineItem[];
  },
) {
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
  });
  if (!request) throw new Error("Request not found.");

  return prisma.draftOrderReference.upsert({
    where: { requestId },
    create: {
      requestId,
      shopifyDraftOrderGid: data.shopifyDraftOrderGid,
      invoiceUrl: data.invoiceUrl,
      lineItemsJson: JSON.stringify(data.lineItems),
    },
    update: {
      shopifyDraftOrderGid: data.shopifyDraftOrderGid,
      invoiceUrl: data.invoiceUrl,
      lineItemsJson: JSON.stringify(data.lineItems),
    },
  });
}

export async function getDraftOrder(shop: string, requestId: string) {
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    include: { draftOrder: true },
  });
  return request?.draftOrder ?? null;
}

export async function findRequestByDraftOrderGid(draftOrderGid: string) {
  return prisma.draftOrderReference.findFirst({
    where: { shopifyDraftOrderGid: draftOrderGid },
    include: { request: true },
  });
}

export async function findRequestByNumber(shop: string, requestNumber: string) {
  return prisma.plantRequest.findFirst({
    where: { shop, requestNumber },
  });
}
