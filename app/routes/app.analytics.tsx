import { useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import {
  getAnalytics,
  resolveAnalyticsRange,
  type DateRangeId,
} from "../lib/analytics.server";
import { plantIdentityAiStatus } from "../lib/plant-identity-ai.server";
import {
  confirmPlantIdentitySuggestion,
  listPlantIdentitySuggestions,
  rejectPlantIdentitySuggestion,
} from "../lib/plant-identity.server";
import {
  behaviorFlagTone,
  formatCurrency,
  type BehaviorFlag,
} from "../lib/portal";
import { ensureShopSeeded } from "../lib/seed-demo.server";
import {
  AdminResponsiveStyles,
  statCardStyle,
  WrappingRow,
} from "../components/admin-layout";

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
  return {
    range,
    customStart,
    customEnd,
    data,
    plantIdentitySuggestions: await listPlantIdentitySuggestions(shop),
    aiStatus: plantIdentityAiStatus(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const suggestionId = String(form.get("suggestionId") || "");

  if (intent === "same-plant") {
    return confirmPlantIdentitySuggestion(shop, suggestionId);
  }
  if (intent === "keep-separate") {
    return rejectPlantIdentitySuggestion(shop, suggestionId);
  }
  return { ok: false, error: "Unknown action" };
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={statCardStyle}>
      <s-box
        padding="base"
        borderWidth="base"
        borderRadius="base"
        background="subdued"
      >
        <s-stack direction="block" gap="small">
          <s-text color="subdued">{label}</s-text>
          <s-heading>{value}</s-heading>
        </s-stack>
      </s-box>
    </div>
  );
}

type PlantMetric = {
  plantId: string;
  plantName: string;
  offeredName: string;
  variants: string;
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
    setSortDirection(key === "plantName" || key === "offeredName" ? "asc" : "desc");
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
          <s-table-header>{headerLabel("variants", "Customer Wordings")}</s-table-header>
          <s-table-header>{headerLabel("offeredName", "Offered As")}</s-table-header>
          <s-table-header>{headerLabel("requestCount", "Request Count")}</s-table-header>
          <s-table-header>{headerLabel("purchaseCount", "Purchase Count")}</s-table-header>
          <s-table-header>{headerLabel("revenue", "Revenue")}</s-table-header>
          <s-table-header>{headerLabel("conversionRate", "Conversion Rate")}</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {sorted.map((plant) => (
            <s-table-row key={plant.plantId}>
              <s-table-cell>{plant.plantName}</s-table-cell>
              <s-table-cell>{plant.variants || "—"}</s-table-cell>
              <s-table-cell>{plant.offeredName || "—"}</s-table-cell>
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

type PlantIdentitySuggestion = Awaited<
  ReturnType<typeof loader>
>["plantIdentitySuggestions"][number];

/**
 * Medium-confidence matches, which merge nothing until they are answered.
 *
 * Both spellings keep their own row in every figure above while a suggestion sits
 * here, so the queue being ignored costs the owner nothing but detail. Answering
 * Same Plant is permanent: the mapping is stored and reused, so the next time a
 * customer types that spelling it never reaches this list.
 */
function PlantIdentitySuggestions({
  suggestions,
  aiStatus,
}: {
  suggestions: PlantIdentitySuggestion[];
  aiStatus: Awaited<ReturnType<typeof loader>>["aiStatus"];
}) {
  return (
    <s-section heading="Plant Name Review">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">{aiStatus.detail}</s-text>
        {suggestions.length === 0 ? (
          <s-text color="subdued">
            No plant names are waiting on a decision. Names that differ only in
            capitalisation, spacing, punctuation, an abbreviated genus or a single
            mistyped character are grouped automatically; anything carrying a
            different cultivar, accession, clone, collection number or locality is
            always kept separate.
          </s-text>
        ) : (
          suggestions.map((suggestion) => (
            <s-box
              key={suggestion.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small">
                <s-heading>
                  {suggestion.originalName} → {suggestion.suggestedDisplayName}
                </s-heading>
                <s-text color="subdued">{suggestion.reason}</s-text>
                <s-text color="subdued">
                  Customer typed: {suggestion.originalName}
                </s-text>
                <s-text color="subdued">
                  Already counted under {suggestion.suggestedDisplayName}:{" "}
                  {suggestion.suggestedVariants.join(", ") || "—"}
                </s-text>
                <s-text color="subdued">
                  {suggestion.affectedItems === 1
                    ? "1 request line would move."
                    : `${suggestion.affectedItems} request lines would move.`}
                  {suggestion.source === "deterministic"
                    ? ""
                    : ` Suggested by ${suggestion.source}.`}
                </s-text>
                <s-stack direction="inline" gap="small">
                  <Form method="post">
                    <input type="hidden" name="intent" value="same-plant" />
                    <input
                      type="hidden"
                      name="suggestionId"
                      value={suggestion.id}
                    />
                    <s-button variant="primary" type="submit">
                      Same Plant
                    </s-button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="keep-separate" />
                    <input
                      type="hidden"
                      name="suggestionId"
                      value={suggestion.id}
                    />
                    <s-button variant="secondary" type="submit">
                      Keep Separate
                    </s-button>
                  </Form>
                </s-stack>
              </s-stack>
            </s-box>
          ))
        )}
      </s-stack>
    </s-section>
  );
}

/**
 * The funnel split by how the plant was to be supplied.
 *
 * The question this answers is whether sourcing and photographing one plant for
 * one customer earns its keep against selling one off the shelf, so the two
 * routes are shown side by side on the same measures rather than as separate
 * totals. Not Available is a column because a plant UPT could not find at all
 * is a different failure from one the customer turned down.
 */
function FulfillmentSource({
  fulfillment,
}: {
  fulfillment: Awaited<ReturnType<typeof loader>>["data"]["fulfillment"];
}) {
  const routes = [
    { label: "Exact Plant", metrics: fulfillment.exactPlant },
    { label: "Grower's Choice", metrics: fulfillment.growersChoice },
    { label: "Not Available", metrics: fulfillment.notAvailable },
  ];

  return (
    <s-section heading="Fulfilment Source">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Read from the offer snapshots, so a plant counts on the route it was
          actually offered on. The FedEx upgrade is a shipping service and is
          never counted here.
        </s-text>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Fulfilment Source</s-table-header>
            <s-table-header>Items On This Route</s-table-header>
            <s-table-header>Offered To Buy</s-table-header>
            <s-table-header>Accepted</s-table-header>
            <s-table-header>Rejected</s-table-header>
            <s-table-header>Purchased</s-table-header>
            <s-table-header>Revenue</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {routes.map((route) => (
              <s-table-row key={route.label}>
                <s-table-cell>{route.label}</s-table-cell>
                <s-table-cell>{route.metrics.lines}</s-table-cell>
                <s-table-cell>{route.metrics.offered}</s-table-cell>
                <s-table-cell>{route.metrics.accepted}</s-table-cell>
                <s-table-cell>{route.metrics.rejected}</s-table-cell>
                <s-table-cell>{route.metrics.purchased}</s-table-cell>
                <s-table-cell>{formatCurrency(route.metrics.revenue)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-stack>
    </s-section>
  );
}

/**
 * Internal insight, admin-only. Nothing here blocks a customer, changes what is
 * offered or reaches a customer-facing page; it exists so the owner knows before
 * sourcing a plant for the fourth time.
 */
function RepeatedRequestDeclinePatterns({
  customers,
}: {
  customers: Awaited<ReturnType<typeof loader>>["data"]["customers"];
}) {
  const flagged = customers.filter((customer) => customer.plantPatterns.length > 0);
  if (flagged.length === 0) return null;

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="base">
        <s-heading>Repeated Request / Decline Pattern</s-heading>
        <s-text color="subdued">
          Internal only. Counted per plant identity, so the same plant asked for
          under several spellings counts once per request rather than as several
          plants.
        </s-text>
        {flagged.map((customer) =>
          customer.plantPatterns.map((pattern) => (
            <s-box
              key={`${customer.email}-${pattern.canonicalPlantId}`}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="base">
                  <s-text>
                    <strong>{customer.customerName}</strong>
                  </s-text>
                  <s-badge tone="warning">Repeated Request / Decline Pattern</s-badge>
                </s-stack>
                <s-text>{pattern.summary}</s-text>
                <s-text color="subdued">
                  Requested {pattern.timesRequested} · offered{" "}
                  {pattern.timesOffered} · declined {pattern.timesDeclined} ·
                  purchased {pattern.timesPurchased} · over {pattern.rangeDays}{" "}
                  days · most recent {pattern.mostRecentRequestDate}
                </s-text>
                <s-text color="subdued">
                  Typed as: {pattern.requestedNames.join(", ")}
                </s-text>
              </s-stack>
            </s-box>
          )),
        )}
      </s-stack>
    </s-box>
  );
}

export default function Analytics() {
  const { range, customStart, customEnd, data, plantIdentitySuggestions, aiStatus } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
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
      <AdminResponsiveStyles />
      {actionData && !actionData.ok ? (
        <s-section>
          <s-banner tone="critical">
            <s-text>{actionData.error}</s-text>
          </s-banner>
        </s-section>
      ) : null}

      <s-section heading="Date Range">
        <WrappingRow>
          {DATE_FILTERS.map((filter) => (
            <s-button
              key={filter.id}
              variant={range === filter.id ? "primary" : "secondary"}
              onClick={() => setRange(filter.id)}
            >
              {filter.label}
            </s-button>
          ))}
        </WrappingRow>
        {range === "custom" && (
          <Form method="get">
            <input type="hidden" name="range" value="custom" />
            <WrappingRow>
              <s-text-field name="start" label="Start date" value={customStart} />
              <s-text-field name="end" label="End date" value={customEnd} />
              <s-button variant="primary" type="submit">
                Apply
              </s-button>
            </WrappingRow>
          </Form>
        )}
      </s-section>

      <s-section heading="Financial Metrics">
        <WrappingRow>
          <MetricCard label="Revenue This Month" value={formatCurrency(data.financial.revenueThisMonth)} />
          <MetricCard label="Revenue Last Month" value={formatCurrency(data.financial.revenueLastMonth)} />
          <MetricCard label="Growth vs Previous Month" value={formatPercent(data.financial.growthVsPreviousMonth)} />
          <MetricCard label="Average Order Value" value={formatCurrency(data.financial.averageOrderValue)} />
          <MetricCard label="Revenue From Closed Requests" value={formatCurrency(data.financial.revenueFromClosedRequests)} />
          <MetricCard label="Revenue Lost To Expired Requests" value={formatCurrency(data.financial.revenueLostToExpiredRequests)} />
        </WrappingRow>
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
        <WrappingRow>
          <MetricCard label="Total Requests" value={String(data.requests.total)} />
          <MetricCard label="New" value={String(data.requests.new)} />
          <MetricCard label="Pending" value={String(data.requests.pending)} />
          <MetricCard label="Expired" value={String(data.requests.expired)} />
          <MetricCard label="Closed" value={String(data.requests.closed)} />
          <MetricCard label="Close Rate" value={`${data.requests.closeRate}%`} />
          <MetricCard label="Expiration Rate" value={`${data.requests.expirationRate}%`} />
        </WrappingRow>
      </s-section>

      <s-section heading="Item Funnel">
        <WrappingRow>
          <MetricCard label="Total items requested" value={String(data.itemFunnel.requested)} />
          <MetricCard label="Total items offered" value={String(data.itemFunnel.offered)} />
          <MetricCard label="Total items accepted" value={String(data.itemFunnel.accepted)} />
          <MetricCard label="Total items purchased" value={String(data.itemFunnel.purchased)} />
          <MetricCard label="Accepted vs Purchased %" value={`${data.itemFunnel.acceptedVsPurchasedPercent}%`} />
          <MetricCard label="Request-to-Purchase %" value={`${data.itemFunnel.requestToPurchasePercent}%`} />
          <MetricCard label="Item drop-off rate" value={`${data.itemFunnel.itemDropOffRate}%`} />
        </WrappingRow>
      </s-section>

      <s-section heading="Exact Plants Released">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Offered exact plants whose hold has ended and that are eligible for an
            EXACT PLANTS listing. Counted separately because a decline, an unpaid
            hold and no reply at all are different problems.
          </s-text>
          <WrappingRow>
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
          </WrappingRow>
        </s-stack>
      </s-section>

      <FulfillmentSource fulfillment={data.fulfillment} />

      <s-section heading="Customer Behavior">
        <s-stack direction="block" gap="base">
          <WrappingRow>
            <MetricCard label="Repeat Request Customers" value={String(data.customerSummary.repeatRequestCustomers)} />
            <MetricCard label="Customers With Expired Offers" value={String(data.customerSummary.customersWithExpiredOffers)} />
            <MetricCard label="Customers With Closed/Paid Requests" value={String(data.customerSummary.customersWithClosedPaidRequests)} />
            <MetricCard label="High Request / Low Purchase Customers" value={String(data.customerSummary.highRequestLowPurchaseCustomers)} />
          </WrappingRow>
          <RepeatedRequestDeclinePatterns customers={data.customers} />
          <div className="upt-narrow-only">
            {data.customers.map((customer) => (
              <article key={customer.email} className="upt-request-card">
                <dl>
                  <dt>Customer</dt>
                  <dd>{customer.customerName}</dd>
                  <dt>Email</dt>
                  <dd>{customer.email}</dd>
                  <dt>Requests / Offers</dt>
                  <dd>
                    {customer.totalRequests} / {customer.offersSent}
                  </dd>
                  <dt>Items requested / offered / accepted / purchased</dt>
                  <dd>
                    {customer.itemsRequested} / {customer.itemsOffered} /{" "}
                    {customer.itemsAccepted} / {customer.itemsPurchased}
                  </dd>
                  <dt>Closed/Paid · Expired · No-Payment Rate</dt>
                  <dd>
                    {customer.closedPaidRequests} · {customer.expiredRequests} ·{" "}
                    {customer.noPaymentRate}%
                  </dd>
                  <dt>Revenue</dt>
                  <dd>{formatCurrency(customer.totalRevenue)}</dd>
                  <dt>Behavior Flag</dt>
                  <dd>
                    <s-badge tone={behaviorFlagTone(customer.behaviorFlag as BehaviorFlag)}>
                      {customer.behaviorFlag}
                    </s-badge>
                  </dd>
                </dl>
              </article>
            ))}
          </div>
          <div className="upt-wide-only">
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
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Item Conversion Analytics">
        <div className="upt-narrow-only">
          {data.itemPurchaseRows.map((row) => (
            <article key={`${row.email}-${row.requestId}`} className="upt-request-card">
              <dl>
                <dt>Customer</dt>
                <dd>{row.customerName}</dd>
                <dt>Email</dt>
                <dd>{row.email}</dd>
                <dt>Request</dt>
                <dd>{row.requestId}</dd>
                <dt>Items requested / offered / accepted / purchased</dt>
                <dd>
                  {row.itemsRequested} / {row.itemsOffered} / {row.itemsAccepted} /{" "}
                  {row.itemsPurchased}
                </dd>
                <dt>Accepted vs Purchased %</dt>
                <dd>{row.acceptedVsPurchasedPercent}%</dd>
                <dt>Request-to-Purchase %</dt>
                <dd>{row.requestToPurchasePercent}%</dd>
                <dt>Item Revenue</dt>
                <dd>{formatCurrency(row.itemRevenue)}</dd>
                <dt>Behavior Flag</dt>
                <dd>
                  <s-badge tone={behaviorFlagTone(row.behaviorFlag)}>
                    {row.behaviorFlag}
                  </s-badge>
                </dd>
              </dl>
            </article>
          ))}
        </div>
        <div className="upt-wide-only">
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
        </div>
      </s-section>

      <PlantIdentitySuggestions
        suggestions={plantIdentitySuggestions}
        aiStatus={aiStatus}
      />

      <PlantTable heading="Most Requested Plants" plants={data.plants.mostRequested} />
      <PlantTable heading="Most Purchased Plants" plants={data.plants.mostPurchased} />
      <PlantTable heading="Highest Revenue Plants" plants={data.plants.highestRevenue} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
