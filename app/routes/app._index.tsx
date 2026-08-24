import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import {
  ADMIN_DASHBOARD_STATUS_FILTERS,
  adminDashboardFilterLabel,
  countAdminDashboardStatusFilters,
  filterAdminDashboardRequests,
  formatPlantsSummary,
  getDisplayRequestNumber,
  parseAdminDashboardStatusFilter,
  requestStatusTone,
  summarizeAdminDashboardStats,
  type AdminDashboardStatusFilter,
  type PlantRequest,
  type RequestStatus,
} from "../lib/portal";
import { listRequests } from "../lib/portal.server";
import { ensureShopSeeded } from "../lib/seed-demo.server";
import {
  AdminResponsiveStyles,
  statCardStyle,
  WrappingRow,
} from "../components/admin-layout";
import { ListPager, PagedFrame, usePagedItems } from "../components/paged-list";
import { StatusBadge } from "../components/theme";
import { ViewerLocalTime } from "../components/viewer-local-time";
import { ADMIN_REQUEST_PAGE_SIZE, padPageSlots } from "../lib/list-page";
import { THEME } from "../lib/theme";

type DashboardData = {
  stats: {
    newRequests: number;
    pending: number;
    closed: number;
    expired: number;
  };
  requests: Array<{
    id: string;
    requestNumber: string;
    customer: string;
    email: string;
    plantsRequested: string;
    status: RequestStatus;
    submittedDate: string;
    submittedAtIso: string;
    hasExistingOrder: boolean;
  }>;
  query: string;
  statusFilter: AdminDashboardStatusFilter;
  statusCounts: Record<AdminDashboardStatusFilter, number>;
};

function toDashboard(
  requests: PlantRequest[],
  query: string,
  statusFilter: AdminDashboardStatusFilter,
): DashboardData {
  const filtered = filterAdminDashboardRequests(requests, query, statusFilter);

  return {
    query,
    statusFilter,
    // Counts stay on the full shop dataset so the Overview cards do not
    // shrink when the list is filtered.
    statusCounts: countAdminDashboardStatusFilters(requests),
    stats: summarizeAdminDashboardStats(requests),
    requests: filtered.map((request) => ({
      id: request.id,
      requestNumber: getDisplayRequestNumber(request),
      customer: request.customer,
      email: request.email,
      plantsRequested: formatPlantsSummary(request.items),
      status: request.status,
      submittedDate: request.submittedDate,
      submittedAtIso: request.submittedAtIso,
      hasExistingOrder: request.hasExistingOrder === true,
    })),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const params = new URL(request.url).searchParams;
  const query = params.get("q") ?? "";
  const statusFilter = parseAdminDashboardStatusFilter(params.get("status"));
  const requests = await listRequests(shop);
  return toDashboard(requests, query, statusFilter);
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(data.query || searchParams.get("q") || "");

  const statCards = [
    { label: "New Requests", value: data.stats.newRequests },
    { label: "Pending", value: data.stats.pending },
    { label: "Closed", value: data.stats.closed },
    { label: "Expired", value: data.stats.expired },
  ];

  const visibleCount = useMemo(() => data.requests.length, [data.requests.length]);
  const paged = usePagedItems(
    data.requests,
    ADMIN_REQUEST_PAGE_SIZE,
    `${data.query}:${data.statusFilter}:${data.requests.length}`,
  );
  const pageSlots = padPageSlots(paged.items, ADMIN_REQUEST_PAGE_SIZE);

  return (
    <s-page heading="UPT Plant Request Portal">
      <AdminResponsiveStyles />
      <s-section heading="Overview">
        <WrappingRow>
          {statCards.map((card) => (
            <div key={card.label} style={statCardStyle}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">{card.label}</s-text>
                  <s-heading>{card.value}</s-heading>
                </s-stack>
              </s-box>
            </div>
          ))}
        </WrappingRow>
      </s-section>

      <s-section heading="Search requests">
        <Form method="get" data-admin-status-filter>
          <s-stack direction="block" gap="base">
            <WrappingRow>
              <s-text-field
                name="q"
                label="Search"
                labelAccessibilityVisibility="exclusive"
                value={query}
                placeholder="Customer name, plant, or request number"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <input type="hidden" name="q" value={query} />
              <s-button variant="primary" type="submit">
                Search
              </s-button>
            </WrappingRow>
            <s-stack direction="inline" gap="small">
              {ADMIN_DASHBOARD_STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  type="submit"
                  name="status"
                  value={status}
                  aria-pressed={data.statusFilter === status}
                  style={{
                    padding: "8px 12px",
                    minHeight: 44,
                    borderRadius: 8,
                    border: "1px solid #c9cccf",
                    background: data.statusFilter === status ? THEME.darkGreen : "#fff",
                    color: data.statusFilter === status ? "#fff" : THEME.darkGreen,
                    font: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {adminDashboardFilterLabel(status)} ({data.statusCounts[status]})
                </button>
              ))}
            </s-stack>
            <input type="hidden" name="status" value={data.statusFilter} />
          </s-stack>
        </Form>
        <s-text color="subdued">
          {`Showing ${visibleCount} request${visibleCount === 1 ? "" : "s"}${
            data.query ? ` matching “${data.query}”` : ""
          }${
            data.statusFilter === "ExistingOrder"
              ? " that have an existing order"
              : data.statusFilter !== "All"
                ? ` with status ${data.statusFilter}`
                : ""
          }.`}
        </s-text>
      </s-section>

      <s-section heading="Recent Requests">
        <div className="upt-narrow-only">
          <PagedFrame pageSize={ADMIN_REQUEST_PAGE_SIZE} rowHeight={168}>
          {paged.items.map((request) => (
            <article key={request.id} className="upt-request-card">
              <dl>
                <dt>Request Number</dt>
                <dd>
                  <s-link href={`/app/requests/${request.id}`}>
                    {request.requestNumber}
                  </s-link>
                </dd>
                <dt>Customer</dt>
                <dd>{request.customer}</dd>
                <dt>Email</dt>
                <dd>{request.email}</dd>
                <dt>Plants Requested</dt>
                <dd>{request.plantsRequested}</dd>
                <dt>Status</dt>
                <dd>
                  <StatusBadge tone={requestStatusTone(request.status)}>
                    {request.status}
                  </StatusBadge>
                  {request.hasExistingOrder ? (
                    <s-text color="subdued">Existing order</s-text>
                  ) : null}
                </dd>
                <dt>Submitted Date</dt>
                <dd>
                  <ViewerLocalTime
                    iso={request.submittedAtIso}
                    fallback={request.submittedDate}
                  />
                </dd>
              </dl>
              <s-link href={`/app/requests/${request.id}`}>View items</s-link>
            </article>
          ))}
          </PagedFrame>
        </div>
        <div className="upt-wide-only">
        <table className="upt-fixed-table">
          <colgroup>
            <col style={{ width: "8rem" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "20%" }} />
            <col />
            <col style={{ width: "6.5rem" }} />
            <col style={{ width: "12.5rem" }} />
            <col style={{ width: "6.5rem" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Request Number</th>
              <th>Customer</th>
              <th>Email</th>
              <th>Plants Requested</th>
              <th>Status</th>
              <th>Submitted Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageSlots.map((request, index) =>
              request ? (
                <tr key={request.id}>
                  <td>
                    <s-link href={`/app/requests/${request.id}`}>
                      {request.requestNumber}
                    </s-link>
                  </td>
                  <td title={request.customer}>{request.customer}</td>
                  <td title={request.email}>{request.email}</td>
                  <td title={request.plantsRequested}>{request.plantsRequested}</td>
                  <td>
                    <StatusBadge tone={requestStatusTone(request.status)}>
                      {request.status}
                    </StatusBadge>
                    {request.hasExistingOrder ? (
                      <div>
                        <s-text color="subdued">Existing order</s-text>
                      </div>
                    ) : null}
                  </td>
                  <td className="upt-cell-wrap">
                    <ViewerLocalTime
                      iso={request.submittedAtIso}
                      fallback={request.submittedDate}
                    />
                  </td>
                  <td>
                    <s-link href={`/app/requests/${request.id}`}>View items</s-link>
                  </td>
                </tr>
              ) : (
                <tr key={`empty-${index}`} className="upt-page-slot" aria-hidden="true">
                  <td colSpan={7}>&nbsp;</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        </div>
        <ListPager
          page={paged.page}
          pageCount={paged.pageCount}
          total={paged.total}
          start={paged.start}
          end={paged.end}
          onPage={paged.setPage}
        />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
