export type BehaviorFlag =
  | "Good Customer"
  | "High Request / Low Purchase"
  | "New Customer"
  | "Expired Offer Risk";

export type CustomerBehavior = {
  customerName: string;
  email: string;
  totalRequests: number;
  offersSent: number;
  closedPaidRequests: number;
  expiredRequests: number;
  noPaymentRate: number;
  totalRevenue: number;
  lastRequestDate: string;
  behaviorFlag: BehaviorFlag;
};

type CustomerBehaviorInput = Omit<
  CustomerBehavior,
  "behaviorFlag" | "noPaymentRate"
>;

function computeNoPaymentRate(
  totalRequests: number,
  closedPaidRequests: number,
): number {
  if (totalRequests === 0) return 0;

  return (
    Math.round(
      ((totalRequests - closedPaidRequests) / totalRequests) * 1000,
    ) / 10
  );
}

export function computeBehaviorFlag(
  customer: CustomerBehaviorInput,
): BehaviorFlag {
  if (customer.closedPaidRequests > 0) {
    return "Good Customer";
  }

  if (customer.totalRequests >= 2 && customer.closedPaidRequests === 0) {
    return "High Request / Low Purchase";
  }

  if (customer.expiredRequests > 0) {
    return "Expired Offer Risk";
  }

  if (customer.totalRequests === 1 && customer.closedPaidRequests === 0) {
    return "New Customer";
  }

  return "New Customer";
}

function buildCustomer(input: CustomerBehaviorInput): CustomerBehavior {
  return {
    ...input,
    noPaymentRate: computeNoPaymentRate(
      input.totalRequests,
      input.closedPaidRequests,
    ),
    behaviorFlag: computeBehaviorFlag(input),
  };
}

const BASE_CUSTOMER_BEHAVIOR: CustomerBehaviorInput[] = [
  {
    customerName: "Michael Thompson",
    email: "m.thompson@email.com",
    totalRequests: 4,
    offersSent: 3,
    closedPaidRequests: 3,
    expiredRequests: 0,
    totalRevenue: 412,
    lastRequestDate: "Jun 1, 2026",
  },
  {
    customerName: "Maria Lopez",
    email: "maria.lopez@email.com",
    totalRequests: 6,
    offersSent: 5,
    closedPaidRequests: 4,
    expiredRequests: 1,
    totalRevenue: 980,
    lastRequestDate: "Jun 4, 2026",
  },
  {
    customerName: "Robert Kim",
    email: "robert.kim@email.com",
    totalRequests: 3,
    offersSent: 3,
    closedPaidRequests: 2,
    expiredRequests: 0,
    totalRevenue: 545,
    lastRequestDate: "May 29, 2026",
  },
  {
    customerName: "James Chen",
    email: "j.chen@email.com",
    totalRequests: 5,
    offersSent: 4,
    closedPaidRequests: 0,
    expiredRequests: 2,
    totalRevenue: 0,
    lastRequestDate: "Jun 3, 2026",
  },
  {
    customerName: "Lisa Park",
    email: "lisa.park@email.com",
    totalRequests: 3,
    offersSent: 3,
    closedPaidRequests: 0,
    expiredRequests: 2,
    totalRevenue: 0,
    lastRequestDate: "May 28, 2026",
  },
  {
    customerName: "Amanda Foster",
    email: "amanda.foster@email.com",
    totalRequests: 2,
    offersSent: 2,
    closedPaidRequests: 0,
    expiredRequests: 0,
    totalRevenue: 0,
    lastRequestDate: "May 25, 2026",
  },
  {
    customerName: "Nina Patel",
    email: "nina.patel@email.com",
    totalRequests: 1,
    offersSent: 1,
    closedPaidRequests: 0,
    expiredRequests: 1,
    totalRevenue: 0,
    lastRequestDate: "May 20, 2026",
  },
  {
    customerName: "Emily Rodriguez",
    email: "emily.r@email.com",
    totalRequests: 1,
    offersSent: 1,
    closedPaidRequests: 0,
    expiredRequests: 0,
    totalRevenue: 0,
    lastRequestDate: "Jun 2, 2026",
  },
  {
    customerName: "Sarah Mitchell",
    email: "sarah.mitchell@email.com",
    totalRequests: 1,
    offersSent: 0,
    closedPaidRequests: 0,
    expiredRequests: 0,
    totalRevenue: 0,
    lastRequestDate: "Jun 4, 2026",
  },
  {
    customerName: "David Wilson",
    email: "d.wilson@email.com",
    totalRequests: 1,
    offersSent: 0,
    closedPaidRequests: 0,
    expiredRequests: 0,
    totalRevenue: 0,
    lastRequestDate: "Jun 5, 2026",
  },
];

export const SAMPLE_CUSTOMER_BEHAVIOR: CustomerBehavior[] =
  BASE_CUSTOMER_BEHAVIOR.map(buildCustomer);

export type CustomerBehaviorSummary = {
  repeatRequestCustomers: number;
  customersWithExpiredOffers: number;
  customersWithClosedPaidRequests: number;
  highRequestLowPurchaseCustomers: number;
};

export function getCustomerBehaviorSummary(
  customers: CustomerBehavior[],
): CustomerBehaviorSummary {
  return {
    repeatRequestCustomers: customers.filter((c) => c.totalRequests > 1).length,
    customersWithExpiredOffers: customers.filter((c) => c.expiredRequests > 0)
      .length,
    customersWithClosedPaidRequests: customers.filter(
      (c) => c.closedPaidRequests > 0,
    ).length,
    highRequestLowPurchaseCustomers: customers.filter(
      (c) => c.behaviorFlag === "High Request / Low Purchase",
    ).length,
  };
}

export function behaviorFlagTone(
  flag: BehaviorFlag,
): "success" | "warning" | "info" | "critical" {
  switch (flag) {
    case "Good Customer":
      return "success";
    case "High Request / Low Purchase":
      return "warning";
    case "New Customer":
      return "info";
    case "Expired Offer Risk":
      return "critical";
  }
}
