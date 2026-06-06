import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type RequestStatus =
  | "New"
  | "Awaiting Response"
  | "Offers Sent"
  | "Purchased"
  | "Expired";

type PlantRequest = {
  id: string;
  customer: string;
  email: string;
  plantsRequested: string;
  status: RequestStatus;
  submittedDate: string;
};

type DashboardData = {
  stats: {
    newRequests: number;
    awaitingResponse: number;
    offersSent: number;
    purchased: number;
    expired: number;
  };
  requests: PlantRequest[];
};

const SAMPLE_REQUESTS: PlantRequest[] = [
  {
    id: "1",
    customer: "Sarah Mitchell",
    email: "sarah.mitchell@email.com",
    plantsRequested: "Monstera Deliciosa, Fiddle Leaf Fig",
    status: "New",
    submittedDate: "Jun 4, 2026",
  },
  {
    id: "2",
    customer: "James Chen",
    email: "j.chen@email.com",
    plantsRequested: "Snake Plant, ZZ Plant, Pothos",
    status: "Awaiting Response",
    submittedDate: "Jun 3, 2026",
  },
  {
    id: "3",
    customer: "Emily Rodriguez",
    email: "emily.r@email.com",
    plantsRequested: "Bird of Paradise",
    status: "Offers Sent",
    submittedDate: "Jun 2, 2026",
  },
  {
    id: "4",
    customer: "Michael Thompson",
    email: "m.thompson@email.com",
    plantsRequested: "Rubber Plant, Peace Lily",
    status: "Purchased",
    submittedDate: "May 30, 2026",
  },
  {
    id: "5",
    customer: "Lisa Park",
    email: "lisa.park@email.com",
    plantsRequested: "Calathea, Alocasia",
    status: "Expired",
    submittedDate: "May 28, 2026",
  },
  {
    id: "6",
    customer: "David Wilson",
    email: "d.wilson@email.com",
    plantsRequested: "Philodendron Brasil, Hoya",
    status: "New",
    submittedDate: "Jun 5, 2026",
  },
];

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

  return { stats, requests: SAMPLE_REQUESTS };
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
