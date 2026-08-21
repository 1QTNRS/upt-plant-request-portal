import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import {
  getAnalytics,
  resolveAnalyticsRange,
  type DateRangeId,
} from "../lib/analytics.server";
import {
  behaviorFlagTone,
  formatCurrency,
  type BehaviorFlag,
} from "../lib/portal";
import { ensureShopSeeded } from "../lib/seed-demo.server";

type SortDirection = "asc" | "desc";

const DATE_FILTERS: { id: DateRangeId; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "month", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
  { id: "year", label: "This Year" },
  { id: "custom", label: "Custom Range" },
];

function formatPercent(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}%`;
}

function sortByKey<T extends Record<string, string | number>>(
  items: T[],
  key: keyof T,
  direction: SortDirection,
): T[] {
  return [...items].sort((a, b) => {
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
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const url = new URL(request.url);
  const range = (url.searchParams.get("range") as DateRangeId) || "year";
  const customStart = url.searchParams.get("start") || "";
  const customEnd = url.searchParams.get("end") || "";
  const data = await getAnalytics(
    shop,
    resolveAnalyticsRange(range, customStart, customEnd),
  );
  return { range, customStart, customEnd, data };
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

type PlantMetric = {
  plantName: string;
  requestCount: number;
  purchaseCount: number;
  revenue: number;
  conversionRate: number;
};

function PlantTable({ heading, plants }: { heading: string; plants: PlantMetric[] }) {
  const [sortKey, setSortKey] = useState<keyof PlantMetric>("requestCount");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const sorted = useMemo(
    () => sortByKey(plants, sortKey, sortDirection),
    [plants, sortKey, sortDirection],
  );

  const handleSort = (key: keyof PlantMetric) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "plantName" ? "asc" : "desc");
  };

  const headerLabel = (key: keyof PlantMetric, label: string) => (
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
      {sortKey === key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
    </span>
  );

  return (
    <s-section heading={heading}>
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">
            {headerLabel("plantName", "Plant Name")}
          </s-table-header>
          <s-table-header>{headerLabel("requestCount", "Request Count")}</s-table-header>
          <s-table-header>{headerLabel("purchaseCount", "Purchase Count")}</s-table-header>
          <s-table-header>{headerLabel("revenue", "Revenue")}</s-table-header>
          <s-table-header>{headerLabel("conversionRate", "Conversion Rate")}</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {sorted.map((plant) => (
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
  const { range, customStart, customEnd, data } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  const setRange = (next: DateRangeId) => {
    const params = new URLSearchParams();
    params.set("range", next);
    if (next === "custom") {
      if (customStart) params.set("start", customStart);
      if (customEnd) params.set("end", customEnd);
    }
    setSearchParams(params);
  };

  return (
    <s-page heading="Analytics">
      <s-section heading="Date Range">
        <s-stack direction="inline" gap="small">
          {DATE_FILTERS.map((filter) => (
            <s-button
              key={filter.id}
              variant={range === filter.id ? "primary" : "secondary"}
              onClick={() => setRange(filter.id)}
            >
              {filter.label}
            </s-button>
          ))}
        </s-stack>
        {range === "custom" && (
          <Form method="get">
            <input type="hidden" name="range" value="custom" />
            <s-stack direction="inline" gap="base">
              <s-text-field name="start" label="Start date" value={customStart} />
              <s-text-field name="end" label="End date" value={customEnd} />
              <s-button variant="primary" type="submit">
                Apply
              </s-button>
            </s-stack>
          </Form>
        )}
      </s-section>

      <s-section heading="Financial Metrics">
        <s-stack direction="inline" gap="base">
          <MetricCard label="Revenue This Month" value={formatCurrency(data.financial.revenueThisMonth)} />
          <MetricCard label="Revenue Last Month" value={formatCurrency(data.financial.revenueLastMonth)} />
          <MetricCard label="Growth vs Previous Month" value={formatPercent(data.financial.growthVsPreviousMonth)} />
          <MetricCard label="Average Order Value" value={formatCurrency(data.financial.averageOrderValue)} />
          <MetricCard label="Revenue From Closed Requests" value={formatCurrency(data.financial.revenueFromClosedRequests)} />
          <MetricCard label="Revenue Lost To Expired Requests" value={formatCurrency(data.financial.revenueLostToExpiredRequests)} />
        </s-stack>
      </s-section>

      <s-section heading="Revenue By Month">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Month</s-table-header>
            <s-table-header>Revenue</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.financial.revenueByMonth.map((row) => (
              <s-table-row key={row.month}>
                <s-table-cell>{row.month}</s-table-cell>
                <s-table-cell>{formatCurrency(row.revenue)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Request Metrics">
        <s-stack direction="inline" gap="base">
          <MetricCard label="Total Requests" value={String(data.requests.total)} />
          <MetricCard label="New" value={String(data.requests.new)} />
          <MetricCard label="Pending" value={String(data.requests.pending)} />
          <MetricCard label="Expired" value={String(data.requests.expired)} />
          <MetricCard label="Closed" value={String(data.requests.closed)} />
          <MetricCard label="Close Rate" value={`${data.requests.closeRate}%`} />
          <MetricCard label="Expiration Rate" value={`${data.requests.expirationRate}%`} />
        </s-stack>
      </s-section>

      <s-section heading="Item Funnel">
        <s-stack direction="inline" gap="base">
          <MetricCard label="Total items requested" value={String(data.itemFunnel.requested)} />
          <MetricCard label="Total items offered" value={String(data.itemFunnel.offered)} />
          <MetricCard label="Total items accepted" value={String(data.itemFunnel.accepted)} />
          <MetricCard label="Total items purchased" value={String(data.itemFunnel.purchased)} />
          <MetricCard label="Accepted vs Purchased %" value={`${data.itemFunnel.acceptedVsPurchasedPercent}%`} />
          <MetricCard label="Request-to-Purchase %" value={`${data.itemFunnel.requestToPurchasePercent}%`} />
          <MetricCard label="Item purchase conversion rate" value={`${data.itemFunnel.itemPurchaseConversionRate}%`} />
          <MetricCard label="Item drop-off rate" value={`${data.itemFunnel.itemDropOffRate}%`} />
        </s-stack>
      </s-section>

      <s-section heading="Exact Plants Released">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Offered exact plants whose hold has ended and that are eligible for an
            EXACT PLANTS listing. Counted separately because a decline, an unpaid
            hold and no reply at all are different problems.
          </s-text>
          <s-stack direction="inline" gap="base">
            <MetricCard
              label="Customer Declined"
              value={String(data.releasedItems.customerDeclined)}
            />
            <MetricCard
              label="Accepted but Unpaid/Expired"
              value={String(data.releasedItems.acceptedUnpaidExpired)}
            />
            <MetricCard
              label="Never Responded/Expired"
              value={String(data.releasedItems.neverRespondedExpired)}
            />
            <MetricCard
              label="Total released"
              value={String(data.releasedItems.total)}
            />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Customer Behavior">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <MetricCard label="Repeat Request Customers" value={String(data.customerSummary.repeatRequestCustomers)} />
            <MetricCard label="Customers With Expired Offers" value={String(data.customerSummary.customersWithExpiredOffers)} />
            <MetricCard label="Customers With Closed/Paid Requests" value={String(data.customerSummary.customersWithClosedPaidRequests)} />
            <MetricCard label="High Request / Low Purchase Customers" value={String(data.customerSummary.highRequestLowPurchaseCustomers)} />
          </s-stack>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Customer Name</s-table-header>
              <s-table-header>Email</s-table-header>
              <s-table-header>Total Requests</s-table-header>
              <s-table-header>Offers Sent</s-table-header>
              <s-table-header>Items Requested</s-table-header>
              <s-table-header>Items Offered</s-table-header>
              <s-table-header>Items Accepted</s-table-header>
              <s-table-header>Items Purchased</s-table-header>
              <s-table-header>Closed/Paid</s-table-header>
              <s-table-header>Expired</s-table-header>
              <s-table-header>No-Payment Rate</s-table-header>
              <s-table-header>Accepted vs Purchased %</s-table-header>
              <s-table-header>Request-to-Purchase %</s-table-header>
              <s-table-header>Total Revenue</s-table-header>
              <s-table-header>Last Request Date</s-table-header>
              <s-table-header>Behavior Flag</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.customers.map((customer) => (
                <s-table-row key={customer.email}>
                  <s-table-cell>{customer.customerName}</s-table-cell>
                  <s-table-cell>{customer.email}</s-table-cell>
                  <s-table-cell>{customer.totalRequests}</s-table-cell>
                  <s-table-cell>{customer.offersSent}</s-table-cell>
                  <s-table-cell>{customer.itemsRequested}</s-table-cell>
                  <s-table-cell>{customer.itemsOffered}</s-table-cell>
                  <s-table-cell>{customer.itemsAccepted}</s-table-cell>
                  <s-table-cell>{customer.itemsPurchased}</s-table-cell>
                  <s-table-cell>{customer.closedPaidRequests}</s-table-cell>
                  <s-table-cell>{customer.expiredRequests}</s-table-cell>
                  <s-table-cell>{customer.noPaymentRate}%</s-table-cell>
                  <s-table-cell>{customer.acceptedVsPurchasedPercent}%</s-table-cell>
                  <s-table-cell>{customer.requestToPurchasePercent}%</s-table-cell>
                  <s-table-cell>{formatCurrency(customer.totalRevenue)}</s-table-cell>
                  <s-table-cell>{customer.lastRequestDate}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={behaviorFlagTone(customer.behaviorFlag as BehaviorFlag)}>
                      {customer.behaviorFlag}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      <s-section heading="Item Conversion Analytics">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Customer Name</s-table-header>
            <s-table-header>Email</s-table-header>
            <s-table-header>Request Number</s-table-header>
            <s-table-header>Items Requested</s-table-header>
            <s-table-header>Items Offered</s-table-header>
            <s-table-header>Items Accepted</s-table-header>
            <s-table-header>Items Purchased</s-table-header>
            <s-table-header>Accepted vs Purchased %</s-table-header>
            <s-table-header>Request-to-Purchase %</s-table-header>
            <s-table-header>Item Revenue</s-table-header>
            <s-table-header>Behavior Flag</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.itemPurchaseRows.map((row) => (
              <s-table-row key={`${row.email}-${row.requestId}`}>
                <s-table-cell>{row.customerName}</s-table-cell>
                <s-table-cell>{row.email}</s-table-cell>
                <s-table-cell>{row.requestId}</s-table-cell>
                <s-table-cell>{row.itemsRequested}</s-table-cell>
                <s-table-cell>{row.itemsOffered}</s-table-cell>
                <s-table-cell>{row.itemsAccepted}</s-table-cell>
                <s-table-cell>{row.itemsPurchased}</s-table-cell>
                <s-table-cell>{row.acceptedVsPurchasedPercent}%</s-table-cell>
                <s-table-cell>{row.requestToPurchasePercent}%</s-table-cell>
                <s-table-cell>{formatCurrency(row.itemRevenue)}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={behaviorFlagTone(row.behaviorFlag)}>
                    {row.behaviorFlag}
                  </s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <PlantTable heading="Most Requested Plants" plants={data.plants.mostRequested} />
      <PlantTable heading="Most Purchased Plants" plants={data.plants.mostPurchased} />
      <PlantTable heading="Highest Revenue Plants" plants={data.plants.highestRevenue} />
      <PlantTable heading="Revenue By Plant" plants={data.plants.revenueByPlant} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
