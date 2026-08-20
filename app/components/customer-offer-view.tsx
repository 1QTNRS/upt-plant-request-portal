import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";

import {
  DEFAULT_FEDEX_REMOVAL_WARNING,
  formatCurrency,
  type CustomerOfferResponse,
  type OfferPlantItem,
  type SampleCustomerOffer,
} from "../lib/portal";
import { OfferExpiryBanner } from "./customer-request-portal";

type ItemChoice = "accept" | "reject" | "unavailable";

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
        style={{ position: "relative", zIndex: 1001, width: "min(520px, 100%)" }}
      >
        <s-box padding="large" borderWidth="base" borderRadius="base" background="base">
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasMultiple) {
        onNavigate((state.index - 1 + state.photos.length) % state.photos.length);
      }
      if (event.key === "ArrowRight" && hasMultiple) {
        onNavigate((state.index + 1) % state.photos.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasMultiple, onClose, onNavigate, state.index, state.photos.length]);

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
        style={{ position: "relative", zIndex: 1101, width: "min(900px, 100%)" }}
      >
        <s-box padding="large" borderWidth="base" borderRadius="base" background="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline">
              <s-heading>{state.plantName}</s-heading>
              <button
                type="button"
                aria-label="Close photo viewer"
                style={{ ...modalButtonStyle, marginLeft: "auto" }}
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
                      (state.index - 1 + state.photos.length) % state.photos.length,
                    )
                  }
                >
                  ←
                </button>
              ) : null}
              <img
                src={state.photos[state.index]}
                alt={`${state.plantName} ${state.index + 1}`}
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
                  onClick={() => onNavigate((state.index + 1) % state.photos.length)}
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

export function CustomerOfferView({
  offer,
  response,
  invoiceUrl,
  fedexRemovalWarning,
  backHref,
  requestClosed,
  confirmationEmail,
}: {
  offer: SampleCustomerOffer | null;
  response: CustomerOfferResponse | null;
  invoiceUrl?: string | null;
  fedexRemovalWarning: string;
  backHref?: string;
  requestClosed: boolean;
  confirmationEmail?: { subject: string; bodyText: string } | null;
}) {
  const navigation = useNavigation();
  const [itemChoices, setItemChoices] = useState<Record<string, ItemChoice>>({});
  const [fedexUpgrade, setFedexUpgrade] = useState(true);
  const [showFedexModal, setShowFedexModal] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState<PhotoLightboxState | null>(
    null,
  );

  useEffect(() => {
    if (!offer) return;
    setItemChoices(
      Object.fromEntries(
        offer.items.map((item) => [
          item.id,
          item.availability === "available" ? "accept" : "unavailable",
        ]),
      ),
    );
    setFedexUpgrade(response?.fedexUpgradeSelected ?? true);
  }, [offer, response]);

  if (!offer) {
    return (
      <s-page heading="Customer Offer">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              No offer is available for this request yet. An admin must send an
              offer before you can review it.
            </s-text>
            {backHref ? <s-link href={backHref}>Back to My Requests</s-link> : null}
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const purchasable = offer.items.filter((item) => item.availability === "available");
  const allUnavailable = purchasable.length === 0;
  const submitted = Boolean(response);
  const acceptedItems = (response?.items ?? []).filter((item) => item.choice === "accept");
  const hasAccepted = acceptedItems.length > 0;
  const submitting = navigation.state !== "idle";

  if (submitted) {
    return (
      <s-page
        heading={
          hasAccepted
            ? "Your private checkout link is ready"
            : requestClosed
              ? "Request closed"
              : allUnavailable
                ? "Nothing to pay for"
                : "Your selections are saved"
        }
      >
        {hasAccepted ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-paragraph>We also emailed this link to you just in case.</s-paragraph>
              <s-text color="subdued">{offer.customerEmail}</s-text>
              {invoiceUrl ? (
                <s-link href={invoiceUrl}>Continue to Checkout</s-link>
              ) : (
                <s-text color="subdued">
                  Checkout link will appear here once the Shopify draft order is
                  created.
                </s-text>
              )}
            </s-stack>
          </s-section>
        ) : null}

        {!hasAccepted && allUnavailable ? (
          <s-section>
            <s-text>
              Unfortunately, none of the requested plants are currently available.
              Please review the notes below for additional information.
            </s-text>
          </s-section>
        ) : null}

        {!hasAccepted && !allUnavailable && !requestClosed ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-text>
                You did not accept any plants from this offer. Close this request
                when you are finished. No checkout link will be created.
              </s-text>
              <Form method="post">
                <input type="hidden" name="intent" value="close-request" />
                <s-button variant="primary" type="submit">
                  Close Request
                </s-button>
              </Form>
            </s-stack>
          </s-section>
        ) : null}

        {hasAccepted ? (
          <s-section heading="Final approval summary">
            <s-stack direction="block" gap="base">
              {acceptedItems.map((item) => (
                <s-box
                  key={item.offerItemId}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="small">
                    <s-heading>{item.plantName}</s-heading>
                    <s-text>{formatCurrency(item.price)}</s-text>
                    <s-text color="subdued">Customer Notes / Disclaimers</s-text>
                    <s-text>{item.customerNotes}</s-text>
                  </s-stack>
                </s-box>
              ))}
              {response?.fedexUpgradeSelected ? (
                <s-text>
                  FedEx Priority Overnight Upgrade —{" "}
                  {formatCurrency(response.fedexUpgradePrice)}
                </s-text>
              ) : (
                <s-stack direction="block" gap="small">
                  <s-text>FedEx Priority Overnight Upgrade — removed</s-text>
                  <s-text color="subdued">
                    {fedexRemovalWarning || DEFAULT_FEDEX_REMOVAL_WARNING}
                  </s-text>
                </s-stack>
              )}
            </s-stack>
          </s-section>
        ) : null}

        {confirmationEmail ? (
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
                  <strong>{confirmationEmail.subject}</strong>
                </s-text>
                {confirmationEmail.bodyText.split("\n").map((line, index) => (
                  <s-text key={`${line}-${index}`}>{line || " "}</s-text>
                ))}
              </s-stack>
            </s-box>
          </s-section>
        ) : null}

        {backHref ? (
          <s-section>
            <s-link href={backHref}>Back to My Requests</s-link>
          </s-section>
        ) : null}
      </s-page>
    );
  }

  return (
    <s-page heading={offer.title}>
      <OfferExpiryBanner
        expirationDays={offer.expirationDays}
        expiresAt={offer.expiresAt}
        expiresAtIso={offer.expiresAtIso}
        urgencyMessage={offer.urgencyMessage}
        holdMessage={offer.holdMessage}
      />

      <s-section heading="Plants offered to you">
        <s-stack direction="block" gap="base">
          {offer.items.map((item) => (
            <OfferItemCard
              key={item.id}
              item={item}
              choice={itemChoices[item.id] ?? (item.availability === "available" ? "accept" : "unavailable")}
              onChoice={(choice) =>
                setItemChoices((current) => ({ ...current, [item.id]: choice }))
              }
              onOpenPhotos={() =>
                setPhotoLightbox({
                  plantName: item.plantName,
                  photos: item.photoUrls,
                  index: 0,
                })
              }
            />
          ))}
        </s-stack>
      </s-section>

      {allUnavailable ? (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              Unfortunately, none of the requested plants are currently available.
              Please review the notes below for additional information.
            </s-text>
            <Form method="post">
              <input type="hidden" name="intent" value="close-request" />
              <s-button variant="primary" type="submit" {...(submitting ? { loading: true } : {})}>
                Close Request
              </s-button>
            </Form>
          </s-stack>
        </s-section>
      ) : (
        <>
          <s-section heading="Shipping upgrade">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
              <label
                htmlFor="fedex-upgrade"
                style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
              >
                <input
                  id="fedex-upgrade"
                  type="checkbox"
                  checked={fedexUpgrade}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setFedexUpgrade(true);
                      return;
                    }
                    setShowFedexModal(true);
                  }}
                />
                <s-text>
                  {offer.fedexUpgradeLabel}, {formatCurrency(offer.fedexUpgradePrice)}
                </s-text>
              </label>
            </s-box>
          </s-section>

          <s-section>
            <Form method="post">
              <input type="hidden" name="intent" value="submit-response" />
              <input type="hidden" name="fedexUpgradeSelected" value={fedexUpgrade ? "true" : "false"} />
              {offer.items.map((item) => (
                <input
                  key={item.id}
                  type="hidden"
                  name={`choice-${item.sourceItemId}`}
                  value={itemChoices[item.id] ?? (item.availability === "available" ? "accept" : "unavailable")}
                />
              ))}
              <s-button variant="primary" type="submit" {...(submitting ? { loading: true } : {})}>
                Submit
              </s-button>
            </Form>
          </s-section>
        </>
      )}

      <FedexWarningModal
        open={showFedexModal}
        message={fedexRemovalWarning || DEFAULT_FEDEX_REMOVAL_WARNING}
        onKeep={() => {
          setFedexUpgrade(true);
          setShowFedexModal(false);
        }}
        onRemove={() => {
          setFedexUpgrade(false);
          setShowFedexModal(false);
        }}
      />

      {photoLightbox ? (
        <PhotoLightbox
          state={photoLightbox}
          onClose={() => setPhotoLightbox(null)}
          onNavigate={(index) =>
            setPhotoLightbox((current) => (current ? { ...current, index } : current))
          }
        />
      ) : null}
    </s-page>
  );
}

function OfferItemCard({
  item,
  choice,
  onChoice,
  onOpenPhotos,
}: {
  item: OfferPlantItem;
  choice: ItemChoice;
  onChoice: (choice: "accept" | "reject") => void;
  onOpenPhotos: () => void;
}) {
  const available = item.availability === "available";

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="large">
          {available ? (
            <button
              type="button"
              onClick={onOpenPhotos}
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
                alt={item.plantName}
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
              <s-text>
                <strong>{formatCurrency(item.price)}</strong>
              </s-text>
            ) : (
              <s-badge tone="critical">Not Available</s-badge>
            )}
          </s-stack>
        </s-stack>

        {!available ? (
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Unavailable Reason</s-text>
            <s-text>{item.unavailableReason}</s-text>
          </s-stack>
        ) : null}

        <s-stack direction="block" gap="small">
          <s-text color="subdued">Customer Notes / Disclaimers</s-text>
          <s-text>{item.notesFromUpt || " "}</s-text>
        </s-stack>

        {available ? (
          <s-stack direction="inline" gap="small">
            <s-button
              variant={choice === "accept" ? "primary" : "secondary"}
              onClick={() => onChoice("accept")}
            >
              Accept
            </s-button>
            <s-button
              variant={choice === "reject" ? "primary" : "secondary"}
              onClick={() => onChoice("reject")}
            >
              Reject
            </s-button>
          </s-stack>
        ) : (
          <s-text color="subdued">
            This plant is unavailable and cannot be accepted or rejected. It will
            be excluded from checkout.
          </s-text>
        )}
      </s-stack>
    </s-box>
  );
}
