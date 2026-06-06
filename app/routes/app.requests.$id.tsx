import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getRequestById,
  type PlantItem,
  type PlantItemStatus,
  type RequestStatus,
} from "../lib/sample-requests";

function requestStatusTone(
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

function itemStatusTone(
  status: PlantItemStatus,
): "info" | "warning" | "caution" | "success" | "critical" {
  switch (status) {
    case "Requested":
      return "info";
    case "Sourced":
      return "warning";
    case "Offered":
      return "caution";
    case "Sold":
      return "success";
    case "Unavailable":
      return "critical";
  }
}

function formatCurrency(amount: number): string {
  if (amount === 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function PlantItemCard({ item }: { item: PlantItem }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base">
          <s-heading>{item.plantName}</s-heading>
          <s-badge tone={itemStatusTone(item.itemStatus)}>
            {item.itemStatus}
          </s-badge>
        </s-stack>

        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Quantity</s-text>
            <s-text>{item.quantity}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Price</s-text>
            <s-text>{formatCurrency(item.price)}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Weight</s-text>
            <s-text>{item.weightLbs} lbs</s-text>
          </s-stack>
        </s-stack>

        <s-stack direction="block" gap="small">
          <s-text color="subdued">Admin notes</s-text>
          <s-text>{item.adminNotes || "No notes yet."}</s-text>
        </s-stack>

        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Photo upload</s-text>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="base"
            >
              <s-stack direction="block" gap="small">
                <s-button variant="secondary" disabled>
                  Upload plant photo
                </s-button>
                <s-text color="subdued">
                  Placeholder — file upload coming soon
                </s-text>
              </s-stack>
            </s-box>
          </s-stack>

          <s-stack direction="block" gap="small">
            <s-text color="subdued">Photo preview</s-text>
            <s-box
              padding="small"
              borderWidth="base"
              borderRadius="base"
              background="base"
            >
              <img
                src={item.photoPreviewUrl}
                alt={`Sample photo of ${item.plantName}`}
                width={160}
                height={160}
                style={{
                  display: "block",
                  objectFit: "cover",
                  borderRadius: "8px",
                }}
              />
              <s-text color="subdued">Sample placeholder image</s-text>
            </s-box>
          </s-stack>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const plantRequest = getRequestById(params.id ?? "");
  if (!plantRequest) {
    throw new Response("Request not found", { status: 404 });
  }

  return { plantRequest };
};

export default function RequestDetail() {
  const { plantRequest } = useLoaderData<typeof loader>();

  return (
    <s-page heading={`Request from ${plantRequest.customer}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>

      <s-section heading="Request summary">
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Customer</s-text>
            <s-text>{plantRequest.customer}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Email</s-text>
            <s-text>{plantRequest.email}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Status</s-text>
            <s-badge tone={requestStatusTone(plantRequest.status)}>
              {plantRequest.status}
            </s-badge>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Submitted</s-text>
            <s-text>{plantRequest.submittedDate}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Plant items">
        <s-paragraph>
          Photos shown here represent the exact plants being offered. Customers
          will see these on their request/offer page in a future update.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          {plantRequest.items.map((item) => (
            <PlantItemCard key={item.id} item={item} />
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
