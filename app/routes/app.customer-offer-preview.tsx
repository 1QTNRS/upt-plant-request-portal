import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  closeCustomerRequest,
  getCustomerOfferResponse,
  hydrateCustomerOfferResponses,
  saveCustomerOfferResponse,
  type CustomerOfferResponse,
  type CustomerResponseItem,
} from "../lib/customer-offer-responses";
import {
  getCustomerItemNote,
  hydrateCustomerItemNotes,
} from "../lib/customer-item-notes";
import {
  getItemAvailabilityState,
  hydrateItemAvailability,
  isItemAvailable,
} from "../lib/item-availability";
import {
  getOfferItemPrice,
  hydrateItemPricing,
} from "../lib/item-pricing";
import {
  getOfferItemQuantity,
  hydrateItemQuantity,
} from "../lib/item-quantity";
import {
  buildCustomerOfferFromRequest,
  SAMPLE_CUSTOMER_OFFER,
  type OfferPlantItem,
  type SampleCustomerOffer,
} from "../lib/sample-offer";
import { LOCAL_STATE_CHANGED_EVENT } from "../lib/local-state-events";
import { hydrateSampleOfferState } from "../lib/sample-requests";
import { useFedexWarningSettings } from "../lib/fedex-warning-settings";

type ItemChoice = "accept" | "reject";

type ApprovalSnapshotItem = OfferPlantItem & {
  choice: ItemChoice | "unavailable";
  customerNotes: string;
  quantity: number;
  lineRevenue: number;
  unavailableReason?: string;
};

type SubmittedMode = "checkout" | "close_required" | "nothing_to_pay";

type PhotoLightboxState = {
  plantName: string;
  photos: string[];
  index: number;
};

const modalButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  background: "#ffffff",
  font: "inherit",
  cursor: "pointer",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const requestId = new URL(request.url).searchParams.get("requestId");

  return { requestId };
};

function getInitialOffer(requestId: string | null): SampleCustomerOffer | null {
  if (typeof window === "undefined") {
    return requestId ? null : SAMPLE_CUSTOMER_OFFER;
  }

  hydrateSampleOfferState();
  hydrateCustomerItemNotes();
  hydrateItemAvailability();
  hydrateItemQuantity();
  hydrateItemPricing();

  if (requestId) {
    return buildCustomerOfferFromRequest(requestId);
  }

  return SAMPLE_CUSTOMER_OFFER;
}

function createItemChoices(offer: SampleCustomerOffer) {
  hydrateItemAvailability();
  return Object.fromEntries(
    offer.items.map((item) => [
      item.id,
      isItemAvailable(item.sourceItemId)
        ? ("accept" as ItemChoice)
        : "unavailable",
    ]),
  );
}

function getDisplayCustomerNotes(item: OfferPlantItem): string {
  const savedNote = getCustomerItemNote(item.sourceItemId);
  return savedNote || item.notesFromUpt;
}

function buildApprovalSnapshot(
  offer: SampleCustomerOffer,
  itemChoices: Record<string, ItemChoice | "unavailable">,
): ApprovalSnapshotItem[] {
  hydrateItemAvailability();
  hydrateItemQuantity();
  hydrateItemPricing();

  return offer.items.map((item) => {
    const available = isItemAvailable(item.sourceItemId);
    const availability = getItemAvailabilityState(item.sourceItemId);
    const quantity = getOfferItemQuantity(item.sourceItemId);
    const price = getOfferItemPrice(item.sourceItemId);

    return {
      ...item,
      price,
      choice: available ? (itemChoices[item.id] ?? "accept") : "unavailable",
      customerNotes: getDisplayCustomerNotes(item),
      quantity,
      lineRevenue: available && itemChoices[item.id] === "accept" ? price * quantity : 0,
      unavailableReason: available ? undefined : availability.unavailableReason,
    };
  });
}

function getSubmittedMode(snapshot: ApprovalSnapshotItem[]): SubmittedMode {
  const purchasable = snapshot.filter((item) => item.choice !== "unavailable");
  const accepted = snapshot.filter((item) => item.choice === "accept");

  if (purchasable.length === 0) return "nothing_to_pay";
  if (accepted.length === 0) return "close_required";
  return "checkout";
}

function snapshotToResponseItems(
  snapshot: ApprovalSnapshotItem[],
): CustomerResponseItem[] {
  return snapshot.map((item) => ({
    offerItemId: item.id,
    sourceItemId: item.sourceItemId,
    plantName: item.plantName,
    choice: item.choice,
    price: item.price,
    quantity: item.quantity,
    lineRevenue: item.lineRevenue,
    customerNotes: item.customerNotes,
    unavailableReason: item.unavailableReason,
  }));
}

function responseToSnapshot(
  response: CustomerOfferResponse,
  offer: SampleCustomerOffer,
): ApprovalSnapshotItem[] {
  return response.items.map((item) => {
    const offerItem = offer.items.find((entry) => entry.id === item.offerItemId);
    return {
      id: item.offerItemId,
      sourceItemId: item.sourceItemId,
      plantName: item.plantName,
      price: item.price,
      photoUrl: offerItem?.photoUrl ?? "",
      photoUrls: offerItem?.photoUrls ?? [],
      notesFromUpt: offerItem?.notesFromUpt ?? "",
      choice: item.choice,
      customerNotes: item.customerNotes,
      quantity: item.quantity,
      lineRevenue: item.lineRevenue,
      unavailableReason: item.unavailableReason,
    };
  });
}

function hasPurchasableItems(offer: SampleCustomerOffer): boolean {
  hydrateItemAvailability();
  return offer.items.some((item) => isItemAvailable(item.sourceItemId));
}

function FedexWarningModal({
  open,
  message,
  onKeep,
  onRemove,
}: {
  open: boolean;
  message: string;
  onKeep: () => void;
  onRemove: () => void;
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        role="presentation"
        onClick={onKeep}
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.45)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fedex-warning-title"
        style={{
          position: "relative",
          zIndex: 1001,
          width: "min(520px, 100%)",
        }}
      >
        <s-box
          padding="large"
          borderWidth="base"
          borderRadius="base"
          background="base"
        >
          <s-stack direction="block" gap="base">
            <s-heading id="fedex-warning-title">
              Remove FedEx Priority Overnight upgrade?
            </s-heading>
            <s-paragraph>{message}</s-paragraph>
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" onClick={onKeep}>
                Keep FedEx Upgrade
              </s-button>
              <s-button variant="secondary" onClick={onRemove}>
                I understand, remove upgrade
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </div>
    </div>
  );
}

function PhotoLightbox({
  state,
  onClose,
  onNavigate,
}: {
  state: PhotoLightboxState;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const hasMultiple = state.photos.length > 1;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.8)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${state.plantName} photos`}
        style={{
          position: "relative",
          zIndex: 1101,
          width: "min(900px, 100%)",
        }}
      >
        <s-box
          padding="large"
          borderWidth="base"
          borderRadius="base"
          background="base"
        >
          <s-stack direction="block" gap="base">
            <s-stack direction="inline">
              <s-heading>{state.plantName}</s-heading>
              <button
                type="button"
                aria-label="Close photo viewer"
                style={{
                  ...modalButtonStyle,
                  marginLeft: "auto",
                }}
                onClick={onClose}
              >
                Close
              </button>
            </s-stack>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "16px",
              }}
            >
              {hasMultiple ? (
                <button
                  type="button"
                  aria-label="Previous photo"
                  style={modalButtonStyle}
                  onClick={() =>
                    onNavigate(
                      (state.index - 1 + state.photos.length) %
                        state.photos.length,
                    )
                  }
                >
                  ←
                </button>
              ) : null}
              <img
                src={state.photos[state.index]}
                alt={`${state.plantName} photo ${state.index + 1}`}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "70vh",
                  objectFit: "contain",
                  borderRadius: "8px",
                }}
              />
              {hasMultiple ? (
                <button
                  type="button"
                  aria-label="Next photo"
                  style={modalButtonStyle}
                  onClick={() =>
                    onNavigate((state.index + 1) % state.photos.length)
                  }
                >
                  →
                </button>
              ) : null}
            </div>
            {hasMultiple ? (
              <s-text color="subdued">
                Photo {state.index + 1} of {state.photos.length}
              </s-text>
            ) : null}
          </s-stack>
        </s-box>
      </div>
    </div>
  );
}

function ConfirmationEmailPreview({
  offer,
  snapshot,
  fedexUpgrade,
  submittedMode,
}: {
  offer: SampleCustomerOffer;
  snapshot: ApprovalSnapshotItem[];
  fedexUpgrade: boolean;
  submittedMode: SubmittedMode;
}) {
  const accepted = snapshot.filter((item) => item.choice === "accept");
  const rejected = snapshot.filter((item) => item.choice === "reject");
  const unavailable = snapshot.filter((item) => item.choice === "unavailable");

  return (
    <s-section heading="Confirmation email preview">
      <s-box
        padding="base"
        borderWidth="base"
        borderRadius="base"
        background="subdued"
      >
        <s-stack direction="block" gap="small">
          <s-text color="subdued">To: {offer.customerEmail}</s-text>
          <s-text>
            <strong>Your UPT plant offer selections are confirmed.</strong>
          </s-text>
          {accepted.map((item) => (
            <s-text key={item.id}>
              Accepted — {item.plantName} — Qty {item.quantity} —{" "}
              {formatCurrency(item.lineRevenue)} — {item.customerNotes}
            </s-text>
          ))}
          {rejected.map((item) => (
            <s-text key={item.id}>
              Rejected — {item.plantName}
            </s-text>
          ))}
          {unavailable.map((item) => (
            <s-text key={item.id}>
              Not available — {item.plantName}
              {item.unavailableReason ? ` — ${item.unavailableReason}` : ""}
            </s-text>
          ))}
          {submittedMode === "checkout" && fedexUpgrade ? (
            <s-text>
              FedEx Priority Overnight Upgrade —{" "}
              {formatCurrency(offer.fedexUpgradePrice)}
            </s-text>
          ) : submittedMode === "checkout" ? (
            <s-text>FedEx Priority Overnight Upgrade — removed</s-text>
          ) : null}
          <s-text color="subdued">
            Mock email — real email delivery coming soon
          </s-text>
        </s-stack>
      </s-box>
    </s-section>
  );
}

export default function CustomerOfferPreview() {
  const { requestId } = useLoaderData<typeof loader>();
  const { fedexRemovalWarning } = useFedexWarningSettings();
  const [offer, setOffer] = useState<SampleCustomerOffer | null>(() =>
    getInitialOffer(requestId),
  );
  const [itemChoices, setItemChoices] = useState<
    Record<string, ItemChoice | "unavailable">
  >(() => (offer ? createItemChoices(offer) : {}));
  const [fedexUpgrade, setFedexUpgrade] = useState(true);
  const [showFedexModal, setShowFedexModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedMode, setSubmittedMode] =
    useState<SubmittedMode>("checkout");
  const [approvalSnapshot, setApprovalSnapshot] = useState<
    ApprovalSnapshotItem[]
  >([]);
  const [savedResponse, setSavedResponse] =
    useState<CustomerOfferResponse | null>(null);
  const [requestClosed, setRequestClosed] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState<PhotoLightboxState | null>(
    null,
  );

  const showFedexSection = offer ? hasPurchasableItems(offer) : false;
  const allUnavailable = offer ? !hasPurchasableItems(offer) : false;

  const restoreSavedResponse = (currentOffer: SampleCustomerOffer) => {
    if (!requestId) return;

    hydrateCustomerOfferResponses();
    const existing = getCustomerOfferResponse(requestId);
    if (!existing) return;

    const snapshot = responseToSnapshot(existing, currentOffer);
    setSavedResponse(existing);
    setApprovalSnapshot(snapshot);
    setSubmittedMode(getSubmittedMode(snapshot));
    setFedexUpgrade(existing.fedexUpgradeSelected);
    setSubmitted(true);
    setRequestClosed(Boolean(existing.closedAt));
  };

  useEffect(() => {
    const nextOffer = getInitialOffer(requestId);
    setOffer(nextOffer);
    if (!nextOffer) return;

    setItemChoices(createItemChoices(nextOffer));
    setSubmitted(false);
    setApprovalSnapshot([]);
    setFedexUpgrade(true);
    setShowFedexModal(false);
    setSavedResponse(null);
    setRequestClosed(false);
    restoreSavedResponse(nextOffer);
  }, [requestId]);

  useEffect(() => {
    const refreshOffer = () => {
      const nextOffer = getInitialOffer(requestId);
      setOffer(nextOffer);
      if (nextOffer) {
        setItemChoices(createItemChoices(nextOffer));
        restoreSavedResponse(nextOffer);
      }
    };

    window.addEventListener("focus", refreshOffer);
    return () => window.removeEventListener("focus", refreshOffer);
  }, [requestId]);

  const handleFedexChange = (checked: boolean) => {
    if (checked) {
      setFedexUpgrade(true);
      return;
    }

    setShowFedexModal(true);
  };

  const setChoice = (itemId: string, choice: ItemChoice) => {
    setItemChoices((current) => ({ ...current, [itemId]: choice }));
  };

  const handleKeepFedexUpgrade = () => {
    setFedexUpgrade(true);
    setShowFedexModal(false);
  };

  const handleRemoveFedexUpgrade = () => {
    setFedexUpgrade(false);
    setShowFedexModal(false);
  };

  const persistResponse = (
    snapshot: ApprovalSnapshotItem[],
    mode: SubmittedMode,
    includeFedex: boolean,
  ) => {
    if (!requestId) return null;

    const responseItems = snapshotToResponseItems(snapshot);
    const response = saveCustomerOfferResponse({
      requestId,
      fedexUpgradeSelected: includeFedex && mode === "checkout" && fedexUpgrade,
      fedexUpgradePrice: offer?.fedexUpgradePrice ?? 15,
      hasAcceptedPurchasableItems: responseItems.some(
        (item) => item.choice === "accept",
      ),
      items: responseItems,
    });

    setSavedResponse(response);
    return response;
  };

  const handleSubmit = () => {
    if (!offer) return;

    setIsSubmitting(true);
    hydrateCustomerItemNotes();
    hydrateItemAvailability();
    hydrateItemQuantity();
    hydrateItemPricing();

    const snapshot = buildApprovalSnapshot(offer, itemChoices);
    const mode = getSubmittedMode(snapshot);
    const includeFedex = hasPurchasableItems(offer);

    window.setTimeout(() => {
      setApprovalSnapshot(snapshot);
      setSubmittedMode(mode);
      setIsSubmitting(false);
      setSubmitted(true);
      persistResponse(snapshot, mode, includeFedex);
    }, 1200);
  };

  const handleCloseRequest = () => {
    if (!requestId || !offer) return;

    const snapshot = approvalSnapshot.length
      ? approvalSnapshot
      : buildApprovalSnapshot(offer, itemChoices);
    const responseItems = snapshotToResponseItems(snapshot);

    const closed = closeCustomerRequest(requestId, {
      items: responseItems,
      fedexUpgradeSelected: false,
      fedexUpgradePrice: offer.fedexUpgradePrice,
      hasAcceptedPurchasableItems: false,
    });

    setApprovalSnapshot(snapshot);
    setSubmittedMode(
      allUnavailable || getSubmittedMode(snapshot) === "nothing_to_pay"
        ? "nothing_to_pay"
        : "close_required",
    );
    setSavedResponse(closed);
    setRequestClosed(true);
    setSubmitted(true);
  };

  const acceptedItems = approvalSnapshot.filter(
    (item) => item.choice === "accept",
  );

  if (!offer) {
    return (
      <s-page heading="Customer Offer">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              {requestId
                ? "No offer is available for this request yet. An admin must send an offer before you can review it."
                : "No offer data is available to preview."}
            </s-text>
            {requestId ? (
              <s-link href="/app/customer-request-form">
                Back to Customer Request Form
              </s-link>
            ) : null}
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (submitted) {
    const heading =
      submittedMode === "checkout"
        ? "Your private checkout link is ready"
        : submittedMode === "close_required"
          ? requestClosed
            ? "Request closed"
            : "Your selections are saved"
          : requestClosed
            ? "Request closed"
            : "Nothing to pay for";

    return (
      <s-page heading={heading}>
        {submittedMode === "checkout" ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-paragraph>
                We also emailed this link to you just in case.
              </s-paragraph>
              <s-text color="subdued">{offer.customerEmail}</s-text>
              <s-button variant="primary">Continue to Checkout</s-button>
              <s-text color="subdued">
                Mock link — draft order creation coming soon
              </s-text>
            </s-stack>
          </s-section>
        ) : null}

        {submittedMode === "nothing_to_pay" ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-text>
                Unfortunately, none of the requested plants are currently
                available. Please review the notes below for additional
                information.
              </s-text>
              {savedResponse?.closedAt ? (
                <s-text color="subdued">
                  Request closed on {savedResponse.closedAt}
                </s-text>
              ) : savedResponse ? (
                <s-text color="subdued">
                  Response saved on {savedResponse.respondedAt}
                </s-text>
              ) : null}
            </s-stack>
          </s-section>
        ) : null}

        {submittedMode === "close_required" ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-text>
                {requestClosed
                  ? "This request has been closed. No checkout link was created."
                  : "You did not accept any plants from this offer. Close this request when you are finished."}
              </s-text>
              {savedResponse ? (
                <s-text color="subdued">
                  Response saved on {savedResponse.respondedAt}
                </s-text>
              ) : null}
              {!requestClosed && requestId ? (
                <button
                  type="button"
                  style={{
                    ...modalButtonStyle,
                    backgroundColor: "#008060",
                    color: "#ffffff",
                    borderColor: "#008060",
                    width: "fit-content",
                  }}
                  onClick={handleCloseRequest}
                >
                  Close Request
                </button>
              ) : null}
            </s-stack>
          </s-section>
        ) : null}

        {submittedMode === "checkout" && acceptedItems.length > 0 ? (
          <s-section heading="Final approval summary">
            <s-stack direction="block" gap="base">
              {acceptedItems.map((item) => (
                <s-box
                  key={item.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="small">
                    <s-heading>{item.plantName}</s-heading>
                    <s-text>Quantity: {item.quantity}</s-text>
                    <s-text>{formatCurrency(item.price)} each</s-text>
                    <s-text>{formatCurrency(item.lineRevenue)} total</s-text>
                    <s-text color="subdued">Customer Notes / Disclaimers</s-text>
                    <s-text>{item.customerNotes}</s-text>
                  </s-stack>
                </s-box>
              ))}
              {fedexUpgrade ? (
                <s-text>
                  FedEx Priority Overnight Upgrade —{" "}
                  {formatCurrency(offer.fedexUpgradePrice)}
                </s-text>
              ) : (
                <s-text color="subdued">
                  FedEx Priority Overnight Upgrade — removed
                </s-text>
              )}
            </s-stack>
          </s-section>
        ) : null}

        <ConfirmationEmailPreview
          offer={offer}
          snapshot={approvalSnapshot}
          fedexUpgrade={fedexUpgrade}
          submittedMode={submittedMode}
        />

        {!requestId ? (
          <s-section>
            <s-button
              variant="tertiary"
              onClick={() => {
                setSubmitted(false);
                setFedexUpgrade(true);
                setShowFedexModal(false);
                setApprovalSnapshot([]);
                setItemChoices(createItemChoices(offer));
              }}
            >
              Back to offer preview
            </s-button>
          </s-section>
        ) : null}
      </s-page>
    );
  }

  return (
    <s-page heading={offer.title}>
      <s-banner tone="warning">
        <s-stack direction="block" gap="small">
          <s-text>
            <strong>Offer expires in {offer.expirationDays} days</strong>
          </s-text>
          <s-text>{offer.urgencyMessage}</s-text>
          <s-text>{offer.holdMessage}</s-text>
          <s-text color="subdued">Expires: {offer.expiresAt}</s-text>
        </s-stack>
      </s-banner>

      <s-section heading="Plants offered to you">
        <s-stack direction="block" gap="base">
          {offer.items.map((item) => {
            const available = isItemAvailable(item.sourceItemId);
            const availability = getItemAvailabilityState(item.sourceItemId);
            const quantity = getOfferItemQuantity(item.sourceItemId);
            const price = getOfferItemPrice(item.sourceItemId);
            const choice =
              itemChoices[item.id] ?? (available ? "accept" : "unavailable");
            const customerNotes = getDisplayCustomerNotes(item);

            return (
              <s-box
                key={item.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="large">
                    {available ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPhotoLightbox({
                            plantName: item.plantName,
                            photos: item.photoUrls,
                            index: 0,
                          })
                        }
                        style={{
                          display: "block",
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          cursor: "zoom-in",
                        }}
                        aria-label={`View larger photos of ${item.plantName}`}
                      >
                        <img
                          src={item.photoUrl}
                          alt={`Photo of ${item.plantName}`}
                          width={200}
                          height={200}
                          style={{
                            display: "block",
                            objectFit: "cover",
                            borderRadius: "8px",
                            flexShrink: 0,
                          }}
                        />
                      </button>
                    ) : null}
                    <s-stack direction="block" gap="base">
                      <s-heading>{item.plantName}</s-heading>
                      {available ? (
                        <>
                          <s-text>Quantity: {quantity}</s-text>
                          <s-text>
                            <strong>{formatCurrency(price)}</strong> each
                          </s-text>
                          <s-text>
                            <strong>{formatCurrency(price * quantity)}</strong>{" "}
                            total
                          </s-text>
                        </>
                      ) : (
                        <s-badge tone="critical">Not Available</s-badge>
                      )}
                    </s-stack>
                  </s-stack>

                  {!available && (
                    <s-stack direction="block" gap="small">
                      <s-text color="subdued">Unavailable Reason</s-text>
                      <s-text>{availability.unavailableReason}</s-text>
                    </s-stack>
                  )}

                  <s-stack direction="block" gap="small">
                    <s-text color="subdued">Customer Notes / Disclaimers</s-text>
                    <s-text>{customerNotes}</s-text>
                  </s-stack>

                  {available ? (
                    <s-stack direction="inline" gap="small">
                      <s-button
                        variant={choice === "accept" ? "primary" : "secondary"}
                        onClick={() => setChoice(item.id, "accept")}
                      >
                        Accept
                      </s-button>
                      <s-button
                        variant={choice === "reject" ? "primary" : "secondary"}
                        onClick={() => setChoice(item.id, "reject")}
                      >
                        Reject
                      </s-button>
                    </s-stack>
                  ) : (
                    <s-text color="subdued">
                      This plant is unavailable and cannot be accepted or
                      rejected. It will be excluded from your draft order.
                    </s-text>
                  )}
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>

      {allUnavailable && !submitted ? (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              Unfortunately, none of the requested plants are currently
              available. Please review the notes below for additional
              information.
            </s-text>
            {requestId ? (
              <button
                type="button"
                style={{
                  ...modalButtonStyle,
                  backgroundColor: "#008060",
                  color: "#ffffff",
                  borderColor: "#008060",
                  width: "fit-content",
                }}
                onClick={handleCloseRequest}
              >
                Close Request
              </button>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      {showFedexSection ? (
        <s-section heading="Shipping upgrade">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="base"
          >
            <label
              htmlFor="fedex-upgrade"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
              }}
            >
              <input
                id="fedex-upgrade"
                type="checkbox"
                checked={fedexUpgrade}
                onChange={(event) => handleFedexChange(event.target.checked)}
              />
              <s-text>
                {offer.fedexUpgradeLabel},{" "}
                {formatCurrency(offer.fedexUpgradePrice)}
              </s-text>
            </label>
          </s-box>
        </s-section>
      ) : null}

      {!allUnavailable ? (
        <s-section>
          <s-button
            variant="primary"
            onClick={handleSubmit}
            {...(isSubmitting ? { loading: true } : {})}
          >
            Submit
          </s-button>
        </s-section>
      ) : null}

      <FedexWarningModal
        open={showFedexModal}
        message={fedexRemovalWarning}
        onKeep={handleKeepFedexUpgrade}
        onRemove={handleRemoveFedexUpgrade}
      />

      {photoLightbox ? (
        <PhotoLightbox
          state={photoLightbox}
          onClose={() => setPhotoLightbox(null)}
          onNavigate={(index) =>
            setPhotoLightbox((current) =>
              current ? { ...current, index } : current,
            )
          }
        />
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
