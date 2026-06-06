import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type DateRange =
  | "7d"
  | "30d"
  | "month"
  | "lastMonth"
  | "year"
  | "custom";

type PlantMetric = {
  plantName: string;
  requestCount: number;
  purchaseCount: number;
  revenue: number;
  conversionRate: number;
};

type AnalyticsData = {
  financial: {
    revenueThisMonth: number;
    revenueLastMonth: number;
    growthVsPreviousMonth: number;
    averageOrderValue: number;
    revenueFromPlantRequests: number;
  };
  requests: {
    total: number;
    new: number;
    offersSent: number;
    purchased: number;
    expired: number;
    conversionRate: number;
  };
  mostRequested: PlantMetric[];
  mostPurchased: PlantMetric[];
  revenueByPlant: PlantMetric[];
};

type SortKey = keyof Pick<
  PlantMetric,
  "plantName" | "requestCount" | "purchaseCount" | "revenue" | "conversionRate"
>;

type SortDirection = "asc" | "desc";

const DATE_FILTERS: { id: DateRange; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "month", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
  { id: "year", label: "This Year" },
  { id: "custom", label: "Custom Range" },
];

const RANGE_MULTIPLIERS: Record<DateRange, number> = {
  "7d": 0.25,
  "30d": 0.75,
  month: 1,
  lastMonth: 0.92,
  year: 8.5,
  custom: 1,
};

const BASE_PLANT_DATA: PlantMetric[] = [
  {
    plantName: "Monstera Deliciosa",
    requestCount: 48,
    purchaseCount: 19,
    revenue: 2850,
    conversionRate: 39.6,
  },
  {
    plantName: "Fiddle Leaf Fig",
    requestCount: 41,
    purchaseCount: 14,
    revenue: 2100,
    conversionRate: 34.1,
  },
  {
    plantName: "Snake Plant",
    requestCount: 36,
    purchaseCount: 22,
    revenue: 1760,
    conversionRate: 61.1,
  },
  {
    plantName: "Bird of Paradise",
    requestCount: 29,
    purchaseCount: 11,
    revenue: 1980,
    conversionRate: 37.9,
  },
  {
    plantName: "Philodendron Brasil",
    requestCount: 27,
    purchaseCount: 16,
    revenue: 1280,
    conversionRate: 59.3,
  },
  {
    plantName: "Rubber Plant",
    requestCount: 24,
    purchaseCount: 9,
    revenue: 1080,
    conversionRate: 37.5,
  },
];

function scaleMetric(metric: PlantMetric, multiplier: number): PlantMetric {
  const requestCount = Math.round(metric.requestCount * multiplier);
  const purchaseCount = Math.round(metric.purchaseCount * multiplier);
  const revenue = Math.round(metric.revenue * multiplier);

  return {
    ...metric,
    requestCount,
    purchaseCount,
    revenue,
    conversionRate:
      requestCount > 0
        ? Math.round((purchaseCount / requestCount) * 1000) / 10
        : 0,
  };
}

function getAnalyticsData(range: DateRange): AnalyticsData {
  const multiplier = RANGE_MULTIPLIERS[range];
  const plants = BASE_PLANT_DATA.map((plant) => scaleMetric(plant, multiplier));

  const totalRequests = plants.reduce((sum, p) => sum + p.requestCount, 0);
  const totalPurchased = plants.reduce((sum, p) => sum + p.purchaseCount, 0);
  const totalRevenue = plants.reduce((sum, p) => sum + p.revenue, 0);
  const offersSent = Math.round(totalRequests * 0.62);
  const newRequests = Math.round(totalRequests * 0.18);
  const expired = Math.round(totalRequests * 0.11);

  const revenueThisMonth = totalRevenue;
  const revenueLastMonth = Math.round(totalRevenue * 0.87);

  return {
    financial: {
      revenueThisMonth,
      revenueLastMonth,
      growthVsPreviousMonth:
        revenueLastMonth > 0
          ? Math.round(
              ((revenueThisMonth - revenueLastMonth) / revenueLastMonth) *
                1000,
            ) / 10
          : 0,
      averageOrderValue:
        totalPurchased > 0 ? Math.round(totalRevenue / totalPurchased) : 0,
      revenueFromPlantRequests: Math.round(totalRevenue * 0.94),
    },
    requests: {
      total: totalRequests,
      new: newRequests,
      offersSent,
      purchased: totalPurchased,
      expired,
      conversionRate:
        totalRequests > 0
          ? Math.round((totalPurchased / totalRequests) * 1000) / 10
          : 0,
    },
    mostRequested: [...plants].sort((a, b) => b.requestCount - a.requestCount),
    mostPurchased: [...plants].sort((a, b) => b.purchaseCount - a.purchaseCount),
    revenueByPlant: [...plants].sort((a, b) => b.revenue - a.revenue),
  };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPercent(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}%`;
}

function sortPlants(
  plants: PlantMetric[],
  key: SortKey,
  direction: SortDirection,
): PlantMetric[] {
  return [...plants].sort((a, b) => {
    const left = a[key];
    const right = b[key];

    if (typeof left === "string" && typeof right === "string") {
      return direction === "asc"
        ? left.localeCompare(right)
        : right.localeCompare(left);
    }

    return direction === "asc"
      ? Number(left) - Number(right)
      : Number(right) - Number(left);
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
      inlineSize="200px"
    >
      <s-stack direction="block" gap="small">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

function PlantTable({
  heading,
  plants,
}: {
  heading: string;
  plants: PlantMetric[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("requestCount");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedPlants = useMemo(
    () => sortPlants(plants, sortKey, sortDirection),
    [plants, sortKey, sortDirection],
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(key === "plantName" ? "asc" : "desc");
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  };

  const headerLabel = (key: SortKey, label: string) => (
    <span
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
      onClick={() => handleSort(key)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSort(key);
        }
      }}
    >
      {label}
      {sortIndicator(key)}
    </span>
  );

  return (
    <s-section heading={heading}>
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">
            {headerLabel("plantName", "Plant Name")}
          </s-table-header>
          <s-table-header>
            {headerLabel("requestCount", "Request Count")}
          </s-table-header>
          <s-table-header>
            {headerLabel("purchaseCount", "Purchase Count")}
          </s-table-header>
          <s-table-header>{headerLabel("revenue", "Revenue")}</s-table-header>
          <s-table-header>
            {headerLabel("conversionRate", "Conversion Rate")}
          </s-table-header>
        </s-table-header-row>
        <s-table-body>
          {sortedPlants.map((plant) => (
            <s-table-row key={plant.plantName}>
              <s-table-cell>{plant.plantName}</s-table-cell>
              <s-table-cell>{plant.requestCount}</s-table-cell>
              <s-table-cell>{plant.purchaseCount}</s-table-cell>
              <s-table-cell>{formatCurrency(plant.revenue)}</s-table-cell>
              <s-table-cell>{plant.conversionRate}%</s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  );
}

export default function Analytics() {
  const [dateRange, setDateRange] = useState<DateRange>("month");
  const [customStart, setCustomStart] = useState("2026-05-01");
  const [customEnd, setCustomEnd] = useState("2026-06-06");

  const data = useMemo(() => getAnalyticsData(dateRange), [dateRange]);

  const financialCards = [
    {
      label: "Revenue This Month",
      value: formatCurrency(data.financial.revenueThisMonth),
    },
    {
      label: "Revenue Last Month",
      value: formatCurrency(data.financial.revenueLastMonth),
    },
    {
      label: "Growth vs Previous Month",
      value: formatPercent(data.financial.growthVsPreviousMonth),
    },
    {
      label: "Average Order Value",
      value: formatCurrency(data.financial.averageOrderValue),
    },
    {
      label: "Revenue From Plant Requests",
      value: formatCurrency(data.financial.revenueFromPlantRequests),
    },
  ];

  const requestCards = [
    { label: "Total Requests", value: String(data.requests.total) },
    { label: "New Requests", value: String(data.requests.new) },
    { label: "Offers Sent", value: String(data.requests.offersSent) },
    { label: "Purchased Offers", value: String(data.requests.purchased) },
    { label: "Expired Offers", value: String(data.requests.expired) },
    {
      label: "Conversion Rate",
      value: `${data.requests.conversionRate}%`,
    },
  ];

  return (
    <s-page heading="Analytics">
      <s-section heading="Date Range">
        <s-stack direction="inline" gap="small">
          {DATE_FILTERS.map((filter) => (
            <s-button
              key={filter.id}
              variant={dateRange === filter.id ? "primary" : "secondary"}
              onClick={() => setDateRange(filter.id)}
            >
              {filter.label}
            </s-button>
          ))}
        </s-stack>
        {dateRange === "custom" && (
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Start date"
              value={customStart}
              onChange={(e) => setCustomStart(e.currentTarget.value)}
            />
            <s-text-field
              label="End date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.currentTarget.value)}
            />
          </s-stack>
        )}
      </s-section>

      <s-section heading="Financial Metrics">
        <s-stack direction="inline" gap="base">
          {financialCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} />
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Request Metrics">
        <s-stack direction="inline" gap="base">
          {requestCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} />
          ))}
        </s-stack>
      </s-section>

      <PlantTable heading="Most Requested Plants" plants={data.mostRequested} />
      <PlantTable heading="Most Purchased Plants" plants={data.mostPurchased} />
      <PlantTable heading="Revenue By Plant" plants={data.revenueByPlant} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
