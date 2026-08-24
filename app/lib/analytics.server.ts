import prisma from "../db.server";
import { exactPlantReleaseReason } from "./exact-plants";
import {
  resolveFulfillmentType,
  type FulfillmentType,
} from "./growers-choice";
import { customerPlantPatterns } from "./plant-behavior.server";
import {
  backfillCanonicalPlants,
  canonicalPlantVariants,
} from "./plant-identity.server";
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
import {
  expireOverdueOffers,
  OFFER_ITEM_ORDER,
  REQUEST_ITEM_ORDER,
} from "./portal.server";

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
  // Every per-plant figure below groups on canonical identity, so rows that
  // predate it — or that were written while the resolver was unavailable — have
  // to be claimed before anything is counted, or they would each read as a plant
  // of their own. Idempotent: a shop with nothing outstanding pays one query.
  await backfillCanonicalPlants(shop);

  const requests = await prisma.plantRequest.findMany({
    where: { shop, submittedAt: { gte: range.start, lte: range.end } },
    include: {
      items: { orderBy: REQUEST_ITEM_ORDER, include: { canonicalPlant: true } },
      offer: { include: { items: { orderBy: OFFER_ITEM_ORDER } } },
      response: { include: { items: { orderBy: OFFER_ITEM_ORDER } } },
      draftOrder: true,
      shopifyOrder: true,
    },
    orderBy: { submittedAt: "desc" },
  });

  const statusCounts = {
    total: requests.length,
    new: requests.filter((request) => request.status === "New").length,
    pending: requests.filter((request) => request.status === "Pending").length,
    expired: requests.filter((request) => request.status === "Expired").length,
    closed: requests.filter((request) => request.status === "Closed").length,
  };

  const closedPaid = requests.filter((request) => request.paidAt);
  // Paid-order plant revenue, or the draft snapshot when the order row is
  // missing. Every figure on this page uses the Date Range `requests` query —
  // including the customer table, item conversion, and this/last-month cards.
  const plantRevenue = (request: {
    shopifyOrder: { plantRevenue: number } | null;
    draftOrder: { lineItemsJson: string } | null;
  }) => {
    if (request.shopifyOrder) return request.shopifyOrder.plantRevenue;
    return plantRevenueFromLines(parseLineItems(request.draftOrder?.lineItemsJson));
  };

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = thisMonthStart;

  const revenueThisMonth = requests
    .filter((request) => request.paidAt && request.paidAt >= thisMonthStart)
    .reduce((sum, request) => sum + plantRevenue(request), 0);
  const revenueLastMonth = requests
    .filter(
      (request) =>
        request.paidAt &&
        request.paidAt >= lastMonthStart &&
        request.paidAt < lastMonthEnd,
    )
    .reduce((sum, request) => sum + plantRevenue(request), 0);

  // Closed does not mean paid: a customer closing their own request, or an
  // admin closing one by hand, leaves paidAt null. Counting those as revenue
  // reported money nobody sent, and reported it right beside a correctly-zero
  // "revenue this month" — the larger, wrong number being the one that reads
  // like a total.
  const revenueFromClosed = requests
    .filter((request) => request.status === "Closed" && request.paidAt)
    .reduce((sum, request) => sum + plantRevenue(request), 0);

  const revenueLostExpired = requests
    .filter((request) => request.status === "Expired")
    .reduce((sum, request) => {
      const declined = new Set(
        (request.response?.items ?? [])
          .filter((item) => item.choice === "reject")
          .map((item) => item.requestItemId),
      );
      // A plant the customer turned down was never at risk of being lost to a
      // missed deadline, and counting it here also double-counts it against
      // releasedItems.customerDeclined, which the two are kept apart to avoid.
      const offered = (request.offer?.items ?? []).filter(
        (item) =>
          item.availability === "available" && !declined.has(item.requestItemId),
      );
      return (
        sum +
        offered.reduce((itemSum, item) => itemSum + item.price * item.quantity, 0)
      );
    }, 0);

  const revenueByMonthMap = new Map<string, number>();
  for (const request of requests) {
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
    unclaimedAfterClose: 0,
  };

  /**
   * The funnel again, split by how UPT meant to supply each plant.
   *
   * Read from the offer snapshot rather than from the request item, because the
   * route is a decision made per offer and the item may have been relinked or
   * marked unavailable since. `lines` counts every plant offered on the route
   * and `offered` only the ones the customer could actually buy, which is what
   * makes the Not Available column readable at all.
   */
  const fulfillment: Record<
    FulfillmentType,
    {
      lines: number;
      offered: number;
      accepted: number;
      rejected: number;
      purchased: number;
      revenue: number;
    }
  > = {
    exact_plant: { lines: 0, offered: 0, accepted: 0, rejected: 0, purchased: 0, revenue: 0 },
    growers_choice: { lines: 0, offered: 0, accepted: 0, rejected: 0, purchased: 0, revenue: 0 },
    not_available: { lines: 0, offered: 0, accepted: 0, rejected: 0, purchased: 0, revenue: 0 },
  };

  /** Requests whose paid order included at least one plant off the shelf. */
  const requestsFulfilledFromExistingStock = new Set<string>();

  /**
   * One row per canonical plant identity, never per typed spelling. `plantName`
   * is the identity's name and `variants` is every wording customers actually
   * used for it, so the owner can see what a row is made of and tell a genuine
   * grouping from an over-eager one.
   */
  type PlantBucket = {
    plantId: string;
    plantName: string;
    variants: Set<string>;
    offeredNames: Set<string>;
    requestCount: number;
    purchaseCount: number;
    offeredCount: number;
    acceptedCount: number;
    revenue: number;
  };
  const plants = new Map<string, PlantBucket>();
  const variantsByCanonicalId = await canonicalPlantVariants(shop);

  type PlantIdentity = { plantId: string; plantName: string; variants: string[] };

  const identityOf = (item: {
    plantName: string;
    canonicalPlantId: string | null;
    canonicalPlant: { id: string; displayName: string } | null;
  }): PlantIdentity => {
    const typed = item.plantName.trim();
    if (item.canonicalPlant) {
      return {
        plantId: item.canonicalPlant.id,
        plantName: item.canonicalPlant.displayName,
        variants: variantsByCanonicalId.get(item.canonicalPlant.id) ?? [typed],
      };
    }
    // No identity yet, which the backfill above should have prevented. Falling
    // back to the typed name keeps the row visible rather than dropping the
    // request from every plant figure.
    return {
      plantId: `typed:${typed.toLowerCase() || "unknown"}`,
      plantName: typed || "Unknown",
      variants: typed ? [typed] : [],
    };
  };

  const bumpPlant = (
    identity: PlantIdentity,
    field: keyof Omit<PlantBucket, "plantId" | "plantName" | "variants" | "offeredNames">,
    amount = 1,
  ) => {
    const current = plants.get(identity.plantId) ?? {
      plantId: identity.plantId,
      plantName: identity.plantName,
      variants: new Set<string>(identity.variants),
      offeredNames: new Set<string>(),
      requestCount: 0,
      purchaseCount: 0,
      offeredCount: 0,
      acceptedCount: 0,
      revenue: 0,
    };
    current[field] += amount;
    plants.set(identity.plantId, current);
  };

  const noteOfferedName = (identity: PlantIdentity, offeredName: string) => {
    const offered = offeredName.trim();
    const bucket = plants.get(identity.plantId);
    if (!bucket || !offered || bucket.variants.has(offered)) return;
    bucket.offeredNames.add(offered);
  };

  for (const request of requests) {
    // Every figure in this table is attributed to the plant the customer asked
    // for, found through requestItemId. Keying the offer and response figures
    // on their own plantName instead split every renamed plant into two rows —
    // one with the requests, one with the purchases — each converting at 0%.
    const requestedIdentity = new Map(
      request.items.map((item) => [item.id, identityOf(item)]),
    );
    const fallbackIdentity = (requestItemId: string, plantName: string) =>
      requestedIdentity.get(requestItemId) ??
      identityOf({ plantName, canonicalPlantId: null, canonicalPlant: null });

    for (const item of request.items) {
      itemFunnel.requested += 1;
      bumpPlant(identityOf(item), "requestCount");
    }
    for (const item of request.offer?.items ?? []) {
      if (item.availability !== "available") continue;
      itemFunnel.offered += 1;
      const identity = fallbackIdentity(item.requestItemId, item.plantName);
      bumpPlant(identity, "offeredCount");
      noteOfferedName(identity, item.plantName);
    }
    for (const item of request.response?.items ?? []) {
      if (item.choice !== "accept") continue;
      itemFunnel.accepted += 1;
      const identity = fallbackIdentity(item.requestItemId, item.plantName);
      bumpPlant(identity, "acceptedCount");
      noteOfferedName(identity, item.plantName);
      if (request.paidAt) {
        itemFunnel.purchased += 1;
        bumpPlant(identity, "purchaseCount");
        bumpPlant(identity, "revenue", item.price * item.quantity);
      }
    }

    // Counted from the offer, so an offer that expired with no response at all
    // is still counted. Availability and payment are checked by
    // `exactPlantReleaseReason`, which is the same rule the listing queue uses.
    for (const offerItem of request.offer?.items ?? []) {
      const responseItem = request.response?.items.find(
        (entry) => entry.requestItemId === offerItem.requestItemId,
      );
      const choice = responseItem?.choice;

      const route = resolveFulfillmentType(offerItem);
      const bucket = fulfillment[route];
      bucket.lines += 1;
      if (offerItem.availability === "available") bucket.offered += 1;
      if (choice === "accept") {
        bucket.accepted += 1;
        if (request.paidAt) {
          bucket.purchased += 1;
          bucket.revenue += offerItem.price * offerItem.quantity;
          if (route === "growers_choice") {
            requestsFulfilledFromExistingStock.add(request.id);
          }
        }
      }
      if (choice === "reject") bucket.rejected += 1;

      const reason = exactPlantReleaseReason({
        hasOfferItem: true,
        offerAvailability: offerItem.availability,
        offerFulfillmentType: offerItem.fulfillmentType,
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
      if (reason === "unclaimed_after_close") {
        releasedItems.unclaimedAfterClose += 1;
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

  for (const request of requests) {
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

  // Internal only, and computed per canonical plant rather than per typed name:
  // three spellings of one plant turned down three times is the pattern, and on
  // raw text it looks like three unrelated plants asked for once each.
  const plantPatterns = await customerPlantPatterns(shop);
  const patternsByEmail = new Map(
    plantPatterns.map((row) => [row.email, row.patterns]),
  );

  const customerRows = [...customers.values()].map((customer) => {
    const patterns = patternsByEmail.get(customer.email.toLowerCase()) ?? [];
    const flags = computeBehaviorFlags({
      ...customer,
      repeatedRequestDeclinePlants: patterns.length,
    });
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
      lastRequestAtIso: customer.lastRequestDate.toISOString(),
      behaviorFlag: primaryBehaviorFlag(flags) as BehaviorFlag,
      behaviorFlags: flags,
      plantPatterns: patterns.map((pattern) => ({
        canonicalPlantId: pattern.activity.canonicalPlantId,
        plantName: pattern.activity.displayName,
        summary: pattern.summary,
        timesRequested: pattern.activity.timesRequested,
        timesOffered: pattern.activity.timesOffered,
        timesDeclined: pattern.activity.timesDeclined,
        timesPurchased: pattern.activity.timesPurchased,
        rangeDays: pattern.activity.rangeDays,
        mostRecentRequestDate: formatDate(pattern.activity.mostRecentRequestAt),
        mostRecentRequestAtIso: pattern.activity.mostRecentRequestAt.toISOString(),
        requestedNames: pattern.activity.requestedNames,
      })),
    };
  });

  const itemPurchaseRows = requests.map((request) => {
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

  const plantMetrics = [...plants.values()].map(
    ({ offeredNames, variants, ...plant }) => ({
      ...plant,
      // What UPT called the plant when it offered it, when that differs from the
      // requested name. A column rather than a row of its own.
      offeredName: [...offeredNames].sort().join(", "),
      // The customer wordings counted under this identity. Shown so a grouping
      // the owner disagrees with is visible instead of invisible.
      variants: [...variants].sort().join(", "),
      conversionRate: percent(plant.purchaseCount, plant.requestCount),
    }),
  );

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
        releasedItems.neverRespondedExpired +
        releasedItems.unclaimedAfterClose,
    },
    fulfillment: {
      exactPlant: fulfillment.exact_plant,
      growersChoice: fulfillment.growers_choice,
      notAvailable: fulfillment.not_available,
      /** Paid requests that included at least one plant off the shelf. */
      requestsFulfilledFromExistingStock: requestsFulfilledFromExistingStock.size,
      existingStockAcceptanceRate: percent(
        fulfillment.growers_choice.accepted,
        fulfillment.growers_choice.offered,
      ),
      existingStockPurchaseRate: percent(
        fulfillment.growers_choice.purchased,
        fulfillment.growers_choice.accepted,
      ),
      // Offered to paid on each route, side by side. This is the number that
      // says whether sourcing one plant for one customer is worth the work.
      exactPlantConversionRate: percent(
        fulfillment.exact_plant.purchased,
        fulfillment.exact_plant.offered,
      ),
      existingStockConversionRate: percent(
        fulfillment.growers_choice.purchased,
        fulfillment.growers_choice.offered,
      ),
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
      repeatedRequestDeclineCustomers: customerRows.filter(
        (row) => row.plantPatterns.length > 0,
      ).length,
    },
  };
}
