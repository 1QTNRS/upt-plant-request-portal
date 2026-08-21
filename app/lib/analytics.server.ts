import prisma from "../db.server";
import { exactPlantReleaseReason } from "./exact-plants";
import {
  computeBehaviorFlags,
  computeNoPaymentRate,
  formatDate,
  percent,
  plantRevenueFromLines,
  primaryBehaviorFlag,
  type BehaviorFlag,
  type DraftOrderLineItem,
} from "./portal";
import { expireOverdueOffers } from "./portal.server";

export type DateRangeId =
  | "7d"
  | "30d"
  | "month"
  | "lastMonth"
  | "year"
  | "custom";

export type AnalyticsRange = {
  start: Date;
  end: Date;
};

export function resolveAnalyticsRange(
  range: DateRangeId,
  customStart?: string,
  customEnd?: string,
  now = new Date(),
): AnalyticsRange {
  const end = new Date(now);
  const start = new Date(now);

  switch (range) {
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "month":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case "lastMonth": {
      start.setMonth(start.getMonth() - 1, 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(1);
      end.setHours(0, 0, 0, 0);
      break;
    }
    case "year":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    case "custom": {
      if (customStart) start.setTime(new Date(customStart).getTime());
      if (customEnd) {
        const parsed = new Date(customEnd);
        parsed.setHours(23, 59, 59, 999);
        end.setTime(parsed.getTime());
      }
      break;
    }
  }

  return { start, end };
}

function parseLineItems(raw: string | null | undefined): DraftOrderLineItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DraftOrderLineItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function getAnalytics(shop: string, range: AnalyticsRange) {
  await expireOverdueOffers(shop);

  const requests = await prisma.plantRequest.findMany({
    where: { shop, submittedAt: { gte: range.start, lte: range.end } },
    include: {
      items: true,
      offer: { include: { items: true } },
      response: { include: { items: true } },
      draftOrder: true,
      shopifyOrder: true,
    },
    orderBy: { submittedAt: "desc" },
  });

  const allShopRequests = await prisma.plantRequest.findMany({
    where: { shop },
    include: {
      items: true,
      offer: { include: { items: true } },
      response: { include: { items: true } },
      draftOrder: true,
      shopifyOrder: true,
    },
  });

  const statusCounts = {
    total: requests.length,
    new: requests.filter((request) => request.status === "New").length,
    pending: requests.filter((request) => request.status === "Pending").length,
    expired: requests.filter((request) => request.status === "Expired").length,
    closed: requests.filter((request) => request.status === "Closed").length,
  };

  const closedPaid = requests.filter((request) => request.paidAt);
  const plantRevenue = (request: (typeof requests)[number]) => {
    if (request.shopifyOrder) return request.shopifyOrder.plantRevenue;
    return plantRevenueFromLines(parseLineItems(request.draftOrder?.lineItemsJson));
  };

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = thisMonthStart;

  const revenueThisMonth = allShopRequests
    .filter((request) => request.paidAt && request.paidAt >= thisMonthStart)
    .reduce((sum, request) => sum + plantRevenue(request), 0);
  const revenueLastMonth = allShopRequests
    .filter(
      (request) =>
        request.paidAt &&
        request.paidAt >= lastMonthStart &&
        request.paidAt < lastMonthEnd,
    )
    .reduce((sum, request) => sum + plantRevenue(request), 0);

  const revenueFromClosed = requests
    .filter((request) => request.status === "Closed")
    .reduce((sum, request) => sum + plantRevenue(request), 0);

  const revenueLostExpired = requests
    .filter((request) => request.status === "Expired")
    .reduce((sum, request) => {
      const offered = (request.offer?.items ?? []).filter(
        (item) => item.availability === "available",
      );
      return (
        sum +
        offered.reduce((itemSum, item) => itemSum + item.price * item.quantity, 0)
      );
    }, 0);

  const revenueByMonthMap = new Map<string, number>();
  for (const request of allShopRequests) {
    if (!request.paidAt) continue;
    const key = monthKey(request.paidAt);
    revenueByMonthMap.set(key, (revenueByMonthMap.get(key) ?? 0) + plantRevenue(request));
  }

  const itemFunnel = {
    requested: 0,
    offered: 0,
    accepted: 0,
    purchased: 0,
  };

  /**
   * Why an offered exact plant did not sell. Kept apart because they mean
   * different things: a decline is a judgement on the plant, an unpaid hold is a
   * checkout problem, and silence is a reachability problem.
   */
  const releasedItems = {
    customerDeclined: 0,
    acceptedUnpaidExpired: 0,
    neverRespondedExpired: 0,
  };

  type PlantBucket = {
    plantName: string;
    requestCount: number;
    purchaseCount: number;
    offeredCount: number;
    acceptedCount: number;
    revenue: number;
  };
  const plants = new Map<string, PlantBucket>();

  const bumpPlant = (
    plantName: string,
    field: keyof Omit<PlantBucket, "plantName">,
    amount = 1,
  ) => {
    const key = plantName.trim() || "Unknown";
    const current = plants.get(key) ?? {
      plantName: key,
      requestCount: 0,
      purchaseCount: 0,
      offeredCount: 0,
      acceptedCount: 0,
      revenue: 0,
    };
    current[field] += amount;
    plants.set(key, current);
  };

  for (const request of requests) {
    for (const item of request.items) {
      itemFunnel.requested += 1;
      bumpPlant(item.plantName, "requestCount");
    }
    for (const item of request.offer?.items ?? []) {
      if (item.availability !== "available") continue;
      itemFunnel.offered += 1;
      bumpPlant(item.plantName, "offeredCount");
    }
    for (const item of request.response?.items ?? []) {
      if (item.choice !== "accept") continue;
      itemFunnel.accepted += 1;
      bumpPlant(item.plantName, "acceptedCount");
      if (request.paidAt) {
        itemFunnel.purchased += 1;
        bumpPlant(item.plantName, "purchaseCount");
        bumpPlant(item.plantName, "revenue", item.price * item.quantity);
      }
    }

    // Counted from the offer, so an offer that expired with no response at all
    // is still counted. Availability and payment are checked by
    // `exactPlantReleaseReason`, which is the same rule the listing queue uses.
    for (const offerItem of request.offer?.items ?? []) {
      const choice = request.response?.items.find(
        (entry) => entry.requestItemId === offerItem.requestItemId,
      )?.choice;
      const reason = exactPlantReleaseReason({
        hasOfferItem: true,
        offerAvailability: offerItem.availability,
        responseChoice: choice,
        requestStatus: request.status,
        paidAt: request.paidAt,
      });
      if (reason === "customer_declined") releasedItems.customerDeclined += 1;
      if (reason === "accepted_unpaid_expired") {
        releasedItems.acceptedUnpaidExpired += 1;
      }
      if (reason === "never_responded_expired") {
        releasedItems.neverRespondedExpired += 1;
      }
    }
  }

  const customers = new Map<
    string,
    {
      customerName: string;
      email: string;
      totalRequests: number;
      offersSent: number;
      itemsRequested: number;
      itemsOffered: number;
      itemsAccepted: number;
      itemsPurchased: number;
      closedPaidRequests: number;
      expiredRequests: number;
      totalRevenue: number;
      lastRequestDate: Date;
    }
  >();

  for (const request of allShopRequests) {
    const key = request.customerEmail.toLowerCase();
    const current = customers.get(key) ?? {
      customerName: request.customerName,
      email: request.customerEmail,
      totalRequests: 0,
      offersSent: 0,
      itemsRequested: 0,
      itemsOffered: 0,
      itemsAccepted: 0,
      itemsPurchased: 0,
      closedPaidRequests: 0,
      expiredRequests: 0,
      totalRevenue: 0,
      lastRequestDate: request.submittedAt,
    };

    current.totalRequests += 1;
    if (request.offer) current.offersSent += 1;
    current.itemsRequested += request.items.length;
    current.itemsOffered += (request.offer?.items ?? []).filter(
      (item) => item.availability === "available",
    ).length;
    current.itemsAccepted += (request.response?.items ?? []).filter(
      (item) => item.choice === "accept",
    ).length;
    if (request.paidAt) {
      current.closedPaidRequests += 1;
      current.itemsPurchased += (request.response?.items ?? []).filter(
        (item) => item.choice === "accept",
      ).length;
      current.totalRevenue += plantRevenue(request);
    }
    if (request.status === "Expired") current.expiredRequests += 1;
    if (request.submittedAt > current.lastRequestDate) {
      current.lastRequestDate = request.submittedAt;
    }
    customers.set(key, current);
  }

  const customerRows = [...customers.values()].map((customer) => {
    const flags = computeBehaviorFlags(customer);
    return {
      customerName: customer.customerName,
      email: customer.email,
      totalRequests: customer.totalRequests,
      offersSent: customer.offersSent,
      itemsRequested: customer.itemsRequested,
      itemsOffered: customer.itemsOffered,
      itemsAccepted: customer.itemsAccepted,
      itemsPurchased: customer.itemsPurchased,
      closedPaidRequests: customer.closedPaidRequests,
      expiredRequests: customer.expiredRequests,
      noPaymentRate: computeNoPaymentRate(
        customer.totalRequests,
        customer.closedPaidRequests,
      ),
      acceptedVsPurchasedPercent: percent(
        customer.itemsPurchased,
        customer.itemsAccepted,
      ),
      requestToPurchasePercent: percent(
        customer.itemsPurchased,
        customer.itemsRequested,
      ),
      totalRevenue: customer.totalRevenue,
      lastRequestDate: formatDate(customer.lastRequestDate),
      behaviorFlag: primaryBehaviorFlag(flags) as BehaviorFlag,
      behaviorFlags: flags,
    };
  });

  const itemPurchaseRows = allShopRequests.map((request) => {
    const itemsRequested = request.items.length;
    const itemsOffered = (request.offer?.items ?? []).filter(
      (item) => item.availability === "available",
    ).length;
    const itemsAccepted = (request.response?.items ?? []).filter(
      (item) => item.choice === "accept",
    ).length;
    const itemsPurchased = request.paidAt ? itemsAccepted : 0;
    const itemRevenue = request.paidAt ? plantRevenue(request) : 0;
    const flags = computeBehaviorFlags({
      totalRequests: 1,
      offersSent: request.offer ? 1 : 0,
      itemsRequested,
      itemsOffered,
      itemsAccepted,
      itemsPurchased,
      closedPaidRequests: request.paidAt ? 1 : 0,
      expiredRequests: request.status === "Expired" ? 1 : 0,
      totalRevenue: itemRevenue,
    });

    return {
      customerName: request.customerName,
      email: request.customerEmail,
      requestId: request.requestNumber,
      itemsRequested,
      itemsOffered,
      itemsAccepted,
      itemsPurchased,
      acceptedVsPurchasedPercent: percent(itemsPurchased, itemsAccepted),
      requestToPurchasePercent: percent(itemsPurchased, itemsRequested),
      itemRevenue,
      behaviorFlag: primaryBehaviorFlag(flags),
    };
  });

  const plantMetrics = [...plants.values()].map((plant) => ({
    ...plant,
    conversionRate: percent(plant.purchaseCount, plant.requestCount),
  }));

  return {
    financial: {
      revenueThisMonth,
      revenueLastMonth,
      growthVsPreviousMonth:
        revenueLastMonth > 0
          ? percent(revenueThisMonth - revenueLastMonth, revenueLastMonth)
          : 0,
      averageOrderValue:
        closedPaid.length > 0
          ? Math.round(
              (closedPaid.reduce((sum, request) => sum + plantRevenue(request), 0) /
                closedPaid.length) *
                100,
            ) / 100
          : 0,
      revenueFromClosedRequests: revenueFromClosed,
      revenueLostToExpiredRequests: revenueLostExpired,
      revenueByMonth: [...revenueByMonthMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, revenue]) => ({ month, revenue })),
    },
    requests: {
      ...statusCounts,
      closeRate: percent(statusCounts.closed, statusCounts.total),
      expirationRate: percent(statusCounts.expired, statusCounts.total),
    },
    releasedItems: {
      ...releasedItems,
      total:
        releasedItems.customerDeclined +
        releasedItems.acceptedUnpaidExpired +
        releasedItems.neverRespondedExpired,
    },
    itemFunnel: {
      ...itemFunnel,
      acceptedVsPurchasedPercent: percent(itemFunnel.purchased, itemFunnel.accepted),
      requestToPurchasePercent: percent(itemFunnel.purchased, itemFunnel.requested),
      itemPurchaseConversionRate: percent(itemFunnel.purchased, itemFunnel.accepted),
      itemDropOffRate: percent(
        itemFunnel.accepted - itemFunnel.purchased,
        itemFunnel.accepted,
      ),
    },
    plants: {
      mostRequested: [...plantMetrics].sort((a, b) => b.requestCount - a.requestCount),
      mostPurchased: [...plantMetrics].sort((a, b) => b.purchaseCount - a.purchaseCount),
      highestRevenue: [...plantMetrics].sort((a, b) => b.revenue - a.revenue),
      revenueByPlant: [...plantMetrics].sort((a, b) => b.revenue - a.revenue),
    },
    customers: customerRows.sort((a, b) => b.totalRequests - a.totalRequests),
    itemPurchaseRows,
    customerSummary: {
      repeatRequestCustomers: customerRows.filter((row) => row.totalRequests > 1).length,
      customersWithExpiredOffers: customerRows.filter((row) => row.expiredRequests > 0)
        .length,
      customersWithClosedPaidRequests: customerRows.filter(
        (row) => row.closedPaidRequests > 0,
      ).length,
      highRequestLowPurchaseCustomers: customerRows.filter(
        (row) => row.behaviorFlag === "High Request / Low Purchase",
      ).length,
    },
  };
}
