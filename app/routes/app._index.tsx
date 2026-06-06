import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  formatPlantsSummary,
  SAMPLE_REQUESTS,
  type RequestStatus,
} from "../lib/sample-requests";

type DashboardData = {
  stats: {
    newRequests: number;
    awaitingResponse: number;
    offersSent: number;
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
  const stats = {
    newRequests: SAMPLE_REQUESTS.filter((r) => r.status === "New").length,
    awaitingResponse: SAMPLE_REQUESTS.filter(
      (r) => r.status === "Awaiting Response",
    ).length,
    offersSent: SAMPLE_REQUESTS.filter((r) => r.status === "Offers Sent")
      .length,
    purchased: SAMPLE_REQUESTS.filter((r) => r.status === "Purchased").length,
    expired: SAMPLE_REQUESTS.filter((r) => r.status === "Expired").length,
  };

  const requests = SAMPLE_REQUESTS.map((request) => ({
    id: request.id,
    customer: request.customer,
    email: request.email,
    plantsRequested: formatPlantsSummary(request.items),
    status: request.status,
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
    case "Awaiting Response":
      return "warning";
    case "Offers Sent":
      return "caution";
    case "Purchased":
      return "success";
    case "Expired":
      return "critical";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return getDashboardData();
};

export default function Dashboard() {
  const { stats, requests } = useLoaderData<typeof loader>();

  const statCards = [
    { label: "New Requests", value: stats.newRequests },
    { label: "Awaiting Response", value: stats.awaitingResponse },
    { label: "Offers Sent", value: stats.offersSent },
    { label: "Purchased", value: stats.purchased },
    { label: "Expired", value: stats.expired },
  ];

  return (
    <s-page heading="UPT Plant Request Portal">
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
