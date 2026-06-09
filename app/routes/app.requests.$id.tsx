import { useEffect, useState, type ChangeEvent } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getCustomerItemNote,
  hydrateCustomerItemNotes,
  setCustomerItemNote,
} from "../lib/customer-item-notes";
import {
  getItemAvailabilityState,
  hydrateItemAvailability,
  isItemAvailable,
  setItemAvailability,
  setUnavailableReason,
  UNAVAILABLE_REASON_OPTIONS,
  type ItemAvailabilityStatus,
  type UnavailableReason,
} from "../lib/item-availability";
import {
  getEffectiveItemPrice,
  getEffectiveItemWeight,
  hydrateItemPricing,
  setItemPrice,
  setItemWeight,
} from "../lib/item-pricing";
import {
  getCustomerOfferResponse,
  hydrateCustomerOfferResponses,
  type CustomerOfferResponse,
} from "../lib/customer-offer-responses";
import { LOCAL_STATE_CHANGED_EVENT } from "../lib/local-state-events";
import { hydrateSubmittedRequests } from "../lib/customer-request-submissions";
import {
  getBuiltInRequestWithState,
  getRequestWithState,
  hydrateSampleOfferState,
  sendOfferToCustomer,
  type OfferExpirationDays,
  type PlantItem,
  type PlantItemStatus,
  type RequestStatus,
  type SentOffer,
} from "../lib/sample-requests";

type RequestDetailData = NonNullable<ReturnType<typeof getRequestWithState>>;

function requestStatusTone(
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

const numberInputStyle = {
  width: "120px",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
} as const;

const disabledNumberInputStyle = {
  ...numberInputStyle,
  background: "#f6f6f7",
  color: "#6d7175",
  border: "1px solid #e1e3e5",
} as const;

const selectStyle = {
  width: "100%",
  maxWidth: "420px",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
  background: "#fff",
} as const;

const disabledTextareaStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #e1e3e5",
  font: "inherit",
  lineHeight: 1.5,
  resize: "vertical" as const,
  background: "#f6f6f7",
  color: "#6d7175",
};

const editableTextareaStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
  lineHeight: 1.5,
  resize: "vertical" as const,
};

function PlantItemCard({
  item,
  canEdit,
}: {
  item: PlantItem;
  canEdit: boolean;
}) {
  const [customerNotes, setCustomerNotes] = useState(() =>
    getCustomerItemNote(item.id),
  );
  const [availabilityState, setAvailabilityState] = useState(() =>
    getItemAvailabilityState(item.id),
  );
  const [price, setPrice] = useState(() =>
    getEffectiveItemPrice(item.id, item.price),
  );
  const [weightLbs, setWeightLbs] = useState(() =>
    getEffectiveItemWeight(item.id, item.weightLbs),
  );

  useEffect(() => {
    hydrateCustomerItemNotes();
    hydrateItemAvailability();
    hydrateItemPricing();
    setCustomerNotes(getCustomerItemNote(item.id));
    setAvailabilityState(getItemAvailabilityState(item.id));
    setPrice(getEffectiveItemPrice(item.id, item.price));
    setWeightLbs(getEffectiveItemWeight(item.id, item.weightLbs));
  }, [item.id, item.price, item.weightLbs]);

  const isAvailable = availabilityState.availability === "available";
  const fieldsLocked = !canEdit;

  const handleCustomerNotesChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (fieldsLocked) return;

    const value = event.currentTarget.value;
    setCustomerNotes(value);
    setCustomerItemNote(item.id, value);
  };

  const handleAvailabilityChange = (availability: ItemAvailabilityStatus) => {
    if (fieldsLocked) return;

    setItemAvailability(item.id, availability);
    setAvailabilityState(getItemAvailabilityState(item.id));
  };

  const handleUnavailableReasonChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    if (fieldsLocked) return;

    const reason = event.currentTarget.value as UnavailableReason;
    setUnavailableReason(item.id, reason);
    setAvailabilityState(getItemAvailabilityState(item.id));
  };

  const handlePriceChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (fieldsLocked) return;

    const parsed = Number.parseFloat(event.currentTarget.value);
    if (!Number.isFinite(parsed)) return;

    setPrice(parsed);
    setItemPrice(item.id, parsed);
  };

  const handleWeightChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (fieldsLocked) return;

    const parsed = Number.parseFloat(event.currentTarget.value);
    if (!Number.isFinite(parsed)) return;

    setWeightLbs(parsed);
    setItemWeight(item.id, parsed);
  };

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
          <s-badge tone={isAvailable ? "success" : "critical"}>
            {isAvailable ? "Available" : "Not Available"}
          </s-badge>
        </s-stack>

        <s-stack direction="block" gap="small">
          <s-text color="subdued">Availability</s-text>
          <s-stack direction="inline" gap="small">
            <s-button
              variant={isAvailable ? "primary" : "secondary"}
              onClick={() => handleAvailabilityChange("available")}
              {...(fieldsLocked ? { disabled: true } : {})}
            >
              Available
            </s-button>
            <s-button
              variant={!isAvailable ? "primary" : "secondary"}
              onClick={() => handleAvailabilityChange("not_available")}
              {...(fieldsLocked ? { disabled: true } : {})}
            >
              Not Available
            </s-button>
          </s-stack>
        </s-stack>

        {!isAvailable && (
          <s-stack direction="block" gap="small">
            <label htmlFor={`unavailable-reason-${item.id}`}>
              <s-text color="subdued">Unavailable Reason</s-text>
            </label>
            <select
              id={`unavailable-reason-${item.id}`}
              value={availabilityState.unavailableReason}
              onChange={handleUnavailableReasonChange}
              disabled={fieldsLocked}
              style={selectStyle}
            >
              {UNAVAILABLE_REASON_OPTIONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </s-stack>
        )}

        {isAvailable && (
          <>
            <s-stack direction="inline" gap="large">
              <s-stack direction="block" gap="small">
                <label htmlFor={`price-${item.id}`}>
                  <s-text color="subdued">Price</s-text>
                </label>
                <input
                  id={`price-${item.id}`}
                  type="number"
                  min={0}
                  step={0.01}
                  value={price}
                  onChange={handlePriceChange}
                  readOnly={fieldsLocked}
                  disabled={fieldsLocked}
                  style={
                    fieldsLocked ? disabledNumberInputStyle : numberInputStyle
                  }
                />
              </s-stack>
              <s-stack direction="block" gap="small">
                <label htmlFor={`weight-${item.id}`}>
                  <s-text color="subdued">Weight in lbs (internal only)</s-text>
                </label>
                <input
                  id={`weight-${item.id}`}
                  type="number"
                  min={0}
                  step={0.1}
                  value={weightLbs}
                  onChange={handleWeightChange}
                  readOnly={fieldsLocked}
                  disabled={fieldsLocked}
                  style={
                    fieldsLocked ? disabledNumberInputStyle : numberInputStyle
                  }
                />
              </s-stack>
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
          </>
        )}

        <s-stack direction="block" gap="small">
          <label htmlFor={`customer-notes-${item.id}`}>
            <s-text color="subdued">Customer Notes / Disclaimers</s-text>
          </label>
          <textarea
            id={`customer-notes-${item.id}`}
            rows={3}
            value={customerNotes}
            onChange={handleCustomerNotesChange}
            readOnly={fieldsLocked}
            disabled={fieldsLocked}
            placeholder="e.g. Minor cosmetic damage on one leaf."
            style={fieldsLocked ? disabledTextareaStyle : editableTextareaStyle}
          />
          <s-text color="subdued">
            {fieldsLocked
              ? "Read-only. Only New requests can be edited before an offer is sent."
              : "Shown to the customer on the offer page, approval snapshot, confirmation email, and final approval summary."}
          </s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const requestId = params.id ?? "";
  const plantRequest = getBuiltInRequestWithState(requestId) ?? null;

  return { requestId, plantRequest };
};

const EXPIRATION_OPTIONS: { days: OfferExpirationDays; label: string }[] = [
  { days: 3, label: "3 days" },
  { days: 5, label: "5 days" },
  { days: 7, label: "7 days" },
];

function SendOfferSection({
  requestId,
  status,
  sentOffer,
  items,
  onOfferSent,
}: {
  requestId: string;
  status: RequestStatus;
  sentOffer?: SentOffer;
  items: PlantItem[];
  onOfferSent: (offer: SentOffer) => void;
}) {
  const [expirationDays, setExpirationDays] = useState<OfferExpirationDays>(3);
  const [isSending, setIsSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(Boolean(sentOffer));

  const handleSendOffer = () => {
    setIsSending(true);

    window.setTimeout(() => {
      const offer = sendOfferToCustomer(requestId, expirationDays);
      setIsSending(false);

      if (offer) {
        onOfferSent(offer);
        setShowSuccess(true);
      }
    }, 600);
  };

  if (sentOffer) {
    return (
      <s-stack direction="block" gap="base">
        {showSuccess && (
          <s-banner tone="success">
            <s-text>Offer sent to customer</s-text>
          </s-banner>
        )}

        <s-text>
          <strong>Offer already sent</strong>
        </s-text>

        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-text color="subdued">Offer link</s-text>
              <s-link href={sentOffer.offerLink}>{sentOffer.offerLink}</s-link>
            </s-stack>
            <s-stack direction="inline" gap="large">
              <s-stack direction="block" gap="small">
                <s-text color="subdued">Offer sent</s-text>
                <s-text>{sentOffer.sentAt}</s-text>
              </s-stack>
              <s-stack direction="block" gap="small">
                <s-text color="subdued">Expires</s-text>
                <s-text>{sentOffer.expiresAt}</s-text>
              </s-stack>
              <s-stack direction="block" gap="small">
                <s-text color="subdued">Expiration window</s-text>
                <s-text>{sentOffer.expirationDays} days</s-text>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-box>

        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="base"
        >
          <s-stack direction="block" gap="base">
            <s-heading>Approval snapshot</s-heading>
            {items.map((item) => {
              const availability = getItemAvailabilityState(item.id);
              const available = isItemAvailable(item.id);
              return (
                <s-stack key={item.id} direction="block" gap="small">
                  <s-text>
                    <strong>{item.plantName}</strong>
                  </s-text>
                  <s-text>Quantity: {item.quantity}</s-text>
                  <s-text>
                    {available ? "Available" : "Not Available"}
                    {!available && ` — ${availability.unavailableReason}`}
                  </s-text>
                  <s-text color="subdued">Customer Notes / Disclaimers</s-text>
                  <s-text>
                    {getCustomerItemNote(item.id) ||
                      "No customer notes added yet."}
                  </s-text>
                </s-stack>
              );
            })}
          </s-stack>
        </s-box>
      </s-stack>
    );
  }

  if (status !== "New") {
    return (
      <s-text color="subdued">
        Offers can only be sent while the request status is New.
      </s-text>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      <s-paragraph>
        Choose how long the customer has to review and accept this offer.
      </s-paragraph>

      <s-stack direction="inline" gap="small">
        {EXPIRATION_OPTIONS.map((option) => (
          <s-button
            key={option.days}
            variant={expirationDays === option.days ? "primary" : "secondary"}
            onClick={() => setExpirationDays(option.days)}
          >
            {option.label}
          </s-button>
        ))}
      </s-stack>

      <s-button
        variant="primary"
        onClick={handleSendOffer}
        {...(isSending ? { loading: true } : {})}
      >
        Send Offer
      </s-button>
    </s-stack>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function CustomerResponseSection({ requestId }: { requestId: string }) {
  const [response, setResponse] = useState<CustomerOfferResponse | undefined>(
    () => {
      if (typeof window === "undefined") return undefined;
      hydrateCustomerOfferResponses();
      return getCustomerOfferResponse(requestId);
    },
  );

  useEffect(() => {
    const refresh = () => {
      hydrateCustomerOfferResponses();
      setResponse(getCustomerOfferResponse(requestId));
    };

    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(LOCAL_STATE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(LOCAL_STATE_CHANGED_EVENT, refresh);
    };
  }, [requestId]);

  if (!response) {
    return (
      <s-section heading="Customer response">
        <s-text color="subdued">
          No customer response has been submitted for this request yet.
        </s-text>
      </s-section>
    );
  }

  const accepted = response.items.filter((item) => item.choice === "accept");
  const rejected = response.items.filter((item) => item.choice === "reject");
  const unavailable = response.items.filter(
    (item) => item.choice === "unavailable",
  );

  return (
    <s-section heading="Customer response">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Responded</s-text>
            <s-text>{response.respondedAt}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Accepted purchasable items</s-text>
            <s-text>
              {response.hasAcceptedPurchasableItems ? "Yes" : "No"}
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">FedEx upgrade</s-text>
            <s-text>
              {response.hasAcceptedPurchasableItems &&
              response.fedexUpgradeSelected
                ? `Selected (${formatCurrency(response.fedexUpgradePrice)})`
                : response.hasAcceptedPurchasableItems
                  ? "Removed"
                  : "Not applicable"}
            </s-text>
          </s-stack>
          {response.closedAt ? (
            <s-stack direction="block" gap="small">
              <s-text color="subdued">Closed</s-text>
              <s-text>{response.closedAt}</s-text>
            </s-stack>
          ) : null}
        </s-stack>

        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-heading>Accepted items</s-heading>
            {accepted.length === 0 ? (
              <s-text color="subdued">None</s-text>
            ) : (
              accepted.map((item) => (
                <s-text key={item.offerItemId}>
                  {item.plantName} — Qty {item.quantity} —{" "}
                  {formatCurrency(item.lineRevenue)}
                </s-text>
              ))
            )}
          </s-stack>
        </s-box>

        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-heading>Rejected items</s-heading>
            {rejected.length === 0 ? (
              <s-text color="subdued">None</s-text>
            ) : (
              rejected.map((item) => (
                <s-text key={item.offerItemId}>{item.plantName}</s-text>
              ))
            )}
          </s-stack>
        </s-box>

        {unavailable.length > 0 ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-heading>Not available items</s-heading>
              {unavailable.map((item) => (
                <s-text key={item.offerItemId}>
                  {item.plantName}
                  {item.unavailableReason ? ` — ${item.unavailableReason}` : ""}
                </s-text>
              ))}
            </s-stack>
          </s-box>
        ) : null}
      </s-stack>
    </s-section>
  );
}

function getRequestDetailState(requestId: string): RequestDetailData | null {
  if (typeof window === "undefined") return null;

  hydrateSubmittedRequests();
  hydrateSampleOfferState();
  hydrateCustomerOfferResponses();
  hydrateItemAvailability();
  hydrateCustomerItemNotes();
  hydrateItemPricing();
  return getRequestWithState(requestId) ?? null;
}

function getInitialRequestDetail(
  requestId: string,
  fallback: RequestDetailData | null,
): RequestDetailData | null {
  if (typeof window === "undefined") return fallback;
  return getRequestDetailState(requestId) ?? fallback;
}

export default function RequestDetail() {
  const { requestId, plantRequest: loaderRequest } =
    useLoaderData<typeof loader>();
  const [request, setRequest] = useState<RequestDetailData | null>(() =>
    getInitialRequestDetail(requestId, loaderRequest),
  );
  const [status, setStatus] = useState<RequestStatus>(
    () => getInitialRequestDetail(requestId, loaderRequest)?.status ?? "New",
  );
  const [sentOffer, setSentOffer] = useState<SentOffer | undefined>(
    () => getInitialRequestDetail(requestId, loaderRequest)?.sentOffer,
  );

  useEffect(() => {
    const refresh = () => {
      const nextRequest = getRequestDetailState(requestId);
      if (!nextRequest) {
        setRequest(null);
        return;
      }

      setRequest(nextRequest);
      setStatus(nextRequest.status);
      setSentOffer(nextRequest.sentOffer);
    };

    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(LOCAL_STATE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(LOCAL_STATE_CHANGED_EVENT, refresh);
    };
  }, [requestId]);

  if (!request) {
    return (
      <s-page heading="Request not found">
        <s-link slot="breadcrumb-actions" href="/app">
          Dashboard
        </s-link>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              This request could not be loaded. Submitted customer requests are
              stored in this browser only.
            </s-text>
            <s-link href="/app">Back to dashboard</s-link>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const canEditItems = status === "New";

  return (
    <s-page heading={`Request from ${request.customer}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>

      <s-section heading="Request summary">
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Customer</s-text>
            <s-text>{request.customer}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Email</s-text>
            <s-text>{request.email}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Status</s-text>
            <s-badge tone={requestStatusTone(status)}>
              {status}
            </s-badge>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Submitted</s-text>
            <s-text>{request.submittedDate}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Plant items">
        {!canEditItems && (
          <s-banner tone="info">
            <s-text>
              This request is read-only because its status is {status}. Only New
              requests can be edited before an offer is sent.
            </s-text>
          </s-banner>
        )}
        <s-paragraph>
          Set availability, pricing, and customer-facing notes for each plant
          before sending the offer.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          {request.items.map((item) => (
            <PlantItemCard key={item.id} item={item} canEdit={canEditItems} />
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Send Offer">
        <SendOfferSection
          requestId={request.id}
          status={status}
          sentOffer={sentOffer}
          items={request.items}
          onOfferSent={(offer) => {
            setSentOffer(offer);
            setStatus("Pending");
          }}
        />
      </s-section>

      <CustomerResponseSection requestId={request.id} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
