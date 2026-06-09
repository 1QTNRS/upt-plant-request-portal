import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { hydrateCustomerOfferResponses } from "../lib/customer-offer-responses";
import { LOCAL_STATE_CHANGED_EVENT } from "../lib/local-state-events";
import { hydrateSubmittedRequests } from "../lib/customer-request-submissions";
import {
  formatPlantsSummary,
  getAllPlantRequests,
  getEffectiveRequestStatus,
  hydrateSampleOfferState,
  type RequestStatus,
} from "../lib/sample-requests";
import { resetAllSampleLocalState } from "../lib/sample-local-state";

type DashboardData = {
  stats: {
    newRequests: number;
    offerSent: number;
    purchased: number;
    expired: number;
  };
  requests: Array<{
    id: string;
    customer: string;
    email: string;
    plantsRequested: string;
    status: RequestStatus;
    submittedDate: string;
  }>;
};

function getDashboardData(): DashboardData {
  const allRequests = getAllPlantRequests();

  const stats = {
    newRequests: allRequests.filter(
      (r) => getEffectiveRequestStatus(r.id, r.status) === "New",
    ).length,
    offerSent: allRequests.filter(
      (r) => getEffectiveRequestStatus(r.id, r.status) === "Pending",
    ).length,
    purchased: allRequests.filter(
      (r) => getEffectiveRequestStatus(r.id, r.status) === "Closed",
    ).length,
    expired: allRequests.filter(
      (r) => getEffectiveRequestStatus(r.id, r.status) === "Expired",
    ).length,
  };

  const requests = allRequests.map((request) => ({
    id: request.id,
    customer: request.customer,
    email: request.email,
    plantsRequested: formatPlantsSummary(request.items),
    status: getEffectiveRequestStatus(request.id, request.status),
    submittedDate: request.submittedDate,
  }));

  return { stats, requests };
}

function statusTone(
  status: RequestStatus,
): "info" | "warning" | "caution" | "success" | "critical" {
  switch (status) {
    case "New":
      return "info";
    case "Pending":
      return "caution";
    case "Closed":
      return "success";
    case "Expired":
      return "critical";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return getDashboardData();
};

function getInitialDashboardData(fallback: DashboardData): DashboardData {
  if (typeof window === "undefined") return fallback;

  hydrateSampleOfferState();
  hydrateSubmittedRequests();
  hydrateCustomerOfferResponses();
  return getDashboardData();
}

export default function Dashboard() {
  const loaderData = useLoaderData<typeof loader>();
  const [dashboardData, setDashboardData] = useState(() =>
    getInitialDashboardData(loaderData),
  );

  useEffect(() => {
    const refresh = () => {
      hydrateSampleOfferState();
      hydrateSubmittedRequests();
      hydrateCustomerOfferResponses();
      setDashboardData(getDashboardData());
    };

    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(LOCAL_STATE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(LOCAL_STATE_CHANGED_EVENT, refresh);
    };
  }, []);

  const { stats, requests } = dashboardData;

  const statCards = [
    { label: "New Requests", value: stats.newRequests },
    { label: "Pending", value: stats.offerSent },
    { label: "Closed", value: stats.purchased },
    { label: "Expired", value: stats.expired },
  ];

  const handleResetSampleData = () => {
    resetAllSampleLocalState();
    setDashboardData(getDashboardData());
  };

  return (
    <s-page heading="UPT Plant Request Portal">
      <s-section heading="Sample data (local testing)">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Resets offer status, customer responses, notes, availability, and
            customer form submissions saved in this browser. Use this to return
            Sarah Mitchell and other requests to their default sample states.
          </s-text>
          <s-button variant="secondary" onClick={handleResetSampleData}>
            Reset sample request state
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          {statCards.map((card) => (
            <s-box
              key={card.label}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              inlineSize="180px"
            >
              <s-stack direction="block" gap="small">
                <s-text color="subdued">{card.label}</s-text>
                <s-heading>{card.value}</s-heading>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Recent Requests">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Customer</s-table-header>
            <s-table-header>Email</s-table-header>
            <s-table-header>Plants Requested</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Submitted Date</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {requests.map((request) => (
              <s-table-row key={request.id}>
                <s-table-cell>{request.customer}</s-table-cell>
                <s-table-cell>{request.email}</s-table-cell>
                <s-table-cell>{request.plantsRequested}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={statusTone(request.status)}>
                    {request.status}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>{request.submittedDate}</s-table-cell>
                <s-table-cell>
                  <s-link href={`/app/requests/${request.id}`}>
                    View items
                  </s-link>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
