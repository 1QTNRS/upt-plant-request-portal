export type ItemPurchaseBehaviorFlag =
  | "Strong Buyer"
  | "Partial Buyer"
  | "Approval Drop-Off"
  | "High Request / Low Purchase"
  | "No Purchase";

export type ItemPurchaseBehavior = {
  customerName: string;
  email: string;
  requestId: string;
  itemsRequested: number;
  itemsOffered: number;
  itemsAccepted: number;
  itemsPurchased: number;
  acceptedVsPurchasedPercent: number;
  requestToPurchasePercent: number;
  itemRevenue: number;
  behaviorFlag: ItemPurchaseBehaviorFlag;
};

type ItemPurchaseBehaviorInput = Omit<
  ItemPurchaseBehavior,
  "acceptedVsPurchasedPercent" | "requestToPurchasePercent" | "behaviorFlag"
>;

export type ItemConversionSummary = {
  totalItemsOffered: number;
  totalItemsAccepted: number;
  totalItemsPurchased: number;
  acceptedButNotPurchased: number;
  itemPurchaseConversionRate: number;
  itemDropOffRate: number;
};

export type ItemConversionCustomerSummary = {
  totalItemsRequested: number;
  totalItemsAccepted: number;
  totalItemsPurchased: number;
  overallAcceptedVsPurchasedPercent: number;
  overallRequestToPurchasePercent: number;
};

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function computeItemPurchaseBehaviorFlag(
  row: ItemPurchaseBehaviorInput,
): ItemPurchaseBehaviorFlag {
  if (row.itemsPurchased === 0 && row.itemsAccepted > 0) {
    return "Approval Drop-Off";
  }

  if (row.itemsPurchased === 0) {
    return "No Purchase";
  }

  const requestToPurchaseRate = row.itemsPurchased / row.itemsRequested;
  if (row.itemsRequested >= 5 && requestToPurchaseRate < 0.4) {
    return "High Request / Low Purchase";
  }

  const acceptedVsPurchasedRate = row.itemsPurchased / row.itemsAccepted;
  if (row.itemsAccepted > 0 && acceptedVsPurchasedRate >= 0.75) {
    return "Strong Buyer";
  }

  return "Partial Buyer";
}

function buildItemPurchaseRow(
  input: ItemPurchaseBehaviorInput,
): ItemPurchaseBehavior {
  return {
    ...input,
    acceptedVsPurchasedPercent: percent(
      input.itemsPurchased,
      input.itemsAccepted,
    ),
    requestToPurchasePercent: percent(
      input.itemsPurchased,
      input.itemsRequested,
    ),
    behaviorFlag: computeItemPurchaseBehaviorFlag(input),
  };
}

const BASE_ITEM_PURCHASE_BEHAVIOR: ItemPurchaseBehaviorInput[] = [
  {
    customerName: "Michael Thompson",
    email: "m.thompson@email.com",
    requestId: "REQ-104",
    itemsRequested: 3,
    itemsOffered: 3,
    itemsAccepted: 3,
    itemsPurchased: 3,
    itemRevenue: 103,
  },
  {
    customerName: "Maria Lopez",
    email: "maria.lopez@email.com",
    requestId: "REQ-112",
    itemsRequested: 6,
    itemsOffered: 5,
    itemsAccepted: 5,
    itemsPurchased: 4,
    itemRevenue: 620,
  },
  {
    customerName: "Robert Kim",
    email: "robert.kim@email.com",
    requestId: "REQ-109",
    itemsRequested: 4,
    itemsOffered: 4,
    itemsAccepted: 4,
    itemsPurchased: 3,
    itemRevenue: 385,
  },
  {
    customerName: "Amanda Foster",
    email: "amanda.foster@email.com",
    requestId: "REQ-115",
    itemsRequested: 10,
    itemsOffered: 8,
    itemsAccepted: 7,
    itemsPurchased: 2,
    itemRevenue: 180,
  },
  {
    customerName: "Sarah Mitchell",
    email: "sarah.mitchell@email.com",
    requestId: "REQ-101",
    itemsRequested: 2,
    itemsOffered: 2,
    itemsAccepted: 2,
    itemsPurchased: 1,
    itemRevenue: 85,
  },
  {
    customerName: "James Chen",
    email: "j.chen@email.com",
    requestId: "REQ-108",
    itemsRequested: 5,
    itemsOffered: 4,
    itemsAccepted: 3,
    itemsPurchased: 0,
    itemRevenue: 0,
  },
  {
    customerName: "Lisa Park",
    email: "lisa.park@email.com",
    requestId: "REQ-105",
    itemsRequested: 4,
    itemsOffered: 3,
    itemsAccepted: 2,
    itemsPurchased: 0,
    itemRevenue: 0,
  },
  {
    customerName: "Emily Rodriguez",
    email: "emily.r@email.com",
    requestId: "REQ-103",
    itemsRequested: 2,
    itemsOffered: 1,
    itemsAccepted: 1,
    itemsPurchased: 0,
    itemRevenue: 0,
  },
  {
    customerName: "Nina Patel",
    email: "nina.patel@email.com",
    requestId: "REQ-107",
    itemsRequested: 3,
    itemsOffered: 2,
    itemsAccepted: 0,
    itemsPurchased: 0,
    itemRevenue: 0,
  },
  {
    customerName: "David Wilson",
    email: "d.wilson@email.com",
    requestId: "REQ-106",
    itemsRequested: 2,
    itemsOffered: 0,
    itemsAccepted: 0,
    itemsPurchased: 0,
    itemRevenue: 0,
  },
];

export const SAMPLE_ITEM_PURCHASE_BEHAVIOR: ItemPurchaseBehavior[] =
  BASE_ITEM_PURCHASE_BEHAVIOR.map(buildItemPurchaseRow);

export function getItemConversionSummary(
  rows: ItemPurchaseBehavior[],
): ItemConversionSummary {
  const totalItemsOffered = rows.reduce((sum, row) => sum + row.itemsOffered, 0);
  const totalItemsAccepted = rows.reduce(
    (sum, row) => sum + row.itemsAccepted,
    0,
  );
  const totalItemsPurchased = rows.reduce(
    (sum, row) => sum + row.itemsPurchased,
    0,
  );
  const acceptedButNotPurchased = totalItemsAccepted - totalItemsPurchased;

  return {
    totalItemsOffered,
    totalItemsAccepted,
    totalItemsPurchased,
    acceptedButNotPurchased,
    itemPurchaseConversionRate: percent(
      totalItemsPurchased,
      totalItemsAccepted,
    ),
    itemDropOffRate: percent(acceptedButNotPurchased, totalItemsAccepted),
  };
}

export function getItemConversionCustomerSummary(
  rows: ItemPurchaseBehavior[],
): ItemConversionCustomerSummary {
  const totalItemsRequested = rows.reduce(
    (sum, row) => sum + row.itemsRequested,
    0,
  );
  const totalItemsAccepted = rows.reduce(
    (sum, row) => sum + row.itemsAccepted,
    0,
  );
  const totalItemsPurchased = rows.reduce(
    (sum, row) => sum + row.itemsPurchased,
    0,
  );

  return {
    totalItemsRequested,
    totalItemsAccepted,
    totalItemsPurchased,
    overallAcceptedVsPurchasedPercent: percent(
      totalItemsPurchased,
      totalItemsAccepted,
    ),
    overallRequestToPurchasePercent: percent(
      totalItemsPurchased,
      totalItemsRequested,
    ),
  };
}

export function itemPurchaseBehaviorFlagTone(
  flag: ItemPurchaseBehaviorFlag,
): "success" | "warning" | "info" | "critical" | "caution" {
  switch (flag) {
    case "Strong Buyer":
      return "success";
    case "Partial Buyer":
      return "info";
    case "Approval Drop-Off":
      return "critical";
    case "High Request / Low Purchase":
      return "warning";
    case "No Purchase":
      return "caution";
  }
}
