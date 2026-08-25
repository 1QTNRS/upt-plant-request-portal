import type { ReactNode } from "react";

import {
  FULFILLMENT_TYPE_LABELS,
  GROWERS_CHOICE_CUSTOMER_SUMMARY,
  GROWERS_CHOICE_IMAGE_DISCLOSURE,
} from "../lib/growers-choice";
import {
  CUSTOMER_SUPPORT_EMAIL,
  DEFAULT_FEDEX_REMOVAL_WARNING,
  formatCurrency,
  isOfferExpired,
  shouldRenderCustomerSupportNote,
  type CustomerOfferResponse,
  type OfferPlantItem,
  type RequestStatus,
  type SampleCustomerOffer,
} from "../lib/portal";
import { CustomerEnhanceScripts, CustomerTime } from "./customer-enhance";
import { CustomerPhotoGallery } from "./customer-photo-gallery";
import { OfferExpiryBanner } from "./customer-request-portal";
import {
  CustomerSurface,
  NestedBox,
  StatusBadge as ThemeStatusBadge,
  ThemeStyles,
} from "./theme";

function CustomerOfferPage({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <CustomerSurface>
      <s-page heading={heading}>
        <ThemeStyles />
        {children}
      </s-page>
    </CustomerSurface>
  );
}

type ItemChoice = "accept" | "reject" | "unavailable";

const buttonStyle: React.CSSProperties = {
  padding: "12px 20px",
  minHeight: 44,
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  background: "#ffffff",
  color: "#202223",
  WebkitTextFillColor: "#202223",
  font: "inherit",
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  display: "inline-block",
  width: "auto",
  minWidth: 120,
  fontWeight: 600,
  background: "#002910",
  color: "#ffffff",
  WebkitTextFillColor: "#ffffff",
  borderColor: "#002910",
  appearance: "none",
  WebkitAppearance: "none",
};

const choiceLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  padding: "12px 20px",
  minHeight: 44,
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  cursor: "pointer",
};

const supportNoteStyle: React.CSSProperties = {
  margin: 0,
  color: "#6d7175",
  fontSize: "0.9em",
  lineHeight: 1.5,
};

export function CustomerSupportNote() {
  return (
    <p style={supportNoteStyle}>
      Need help with this request or need something changed? Email{" "}
      <a href={`mailto:${CUSTOMER_SUPPORT_EMAIL}`}>{CUSTOMER_SUPPORT_EMAIL}</a>.
      Otherwise, you can follow your request status here.
    </p>
  );
}

function CloseRequestButton({
  formAction,
  prominent = false,
}: {
  formAction?: string;
  prominent?: boolean;
}) {
  return (
    <form method="post" action={formAction}>
      <button
        type="submit"
        name="intent"
        value="close-request"
        style={{
          ...buttonStyle,
          fontWeight: prominent ? 600 : 400,
          background: prominent ? "#002910" : "#ffffff",
          color: prominent ? "#ffffff" : "inherit",
          borderColor: prominent ? "#002910" : "#c9cccf",
        }}
      >
        Close Request
      </button>
    </form>
  );
}

function answeredOfferHeading(state: {
  requestPaid: boolean;
  requestClosed: boolean;
  hasAccepted: boolean;
  hasCheckoutLink: boolean;
  allUnavailable: boolean;
}): string {
  if (state.requestPaid) return "Payment received";
  if (state.requestClosed) return "Request closed";
  if (state.hasAccepted) {
    return state.hasCheckoutLink
      ? "Your private checkout link is ready"
      : "Your selections are saved";
  }
  if (state.allUnavailable) return "Nothing to pay for";
  return "Your selections are saved";
}

export function CustomerOfferView({
  offer,
  response,
  invoiceUrl,
  fedexRemovalWarning,
  statusLabel,
  statusTone = "info",
  backHref,
  requestClosed,
  requestPaid = false,
  requestStatus,
  paidAt,
  paidAtIso,
  customerTimeZone,
  formAction,
  submittedChoices,
  fedexSelected = true,
  pendingFedexRemoval = false,
  error,
}: {
  offer: SampleCustomerOffer | null;
  response: CustomerOfferResponse | null;
  invoiceUrl?: string | null;
  fedexRemovalWarning: string;
  /** Derived from the stored status; the same label the request list shows. */
  statusLabel?: string;
  statusTone?: "info" | "warning" | "caution" | "success" | "critical";
  backHref?: string;
  requestClosed: boolean;
  /** Set once `orders/paid` has closed the request. */
  requestPaid?: boolean;
  /** Stored status. The support note only renders for New / Pending. */
  requestStatus?: RequestStatus | null;
  paidAt?: string | null;
  paidAtIso?: string | null;
  customerTimeZone?: string | null;
  /**
   * Where the form posts. Must be the storefront proxy path — React Router
   * would otherwise render the app's own `/customer/...` path, which does not
   * exist on the shop's domain and returns a Shopify 404.
   */
  formAction?: string;
  /** Choices the customer already picked, echoed back by the server. */
  submittedChoices?: Record<string, "accept" | "reject">;
  fedexSelected?: boolean;
  /** Set when the customer unchecked FedEx and has to confirm the warning. */
  pendingFedexRemoval?: boolean;
  /** Validation message from the last submission, e.g. an unanswered plant. */
  error?: string | null;
}) {
  if (!offer) {
    return (
      <CustomerOfferPage heading="Customer Offer">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              No offer is available for this request yet. An admin must send an
              offer before you can review it.
            </s-text>
            {backHref ? <s-link href={backHref}>Back to My Requests</s-link> : null}
          </s-stack>
        </s-section>
      </CustomerOfferPage>
    );
  }

  const purchasable = offer.items.filter((item) => item.availability === "available");
  const allUnavailable = purchasable.length === 0;
  const submitted = Boolean(response);
  const acceptedItems = (response?.items ?? []).filter((item) => item.choice === "accept");
  const rejectedItems = (response?.items ?? []).filter((item) => item.choice === "reject");
  const hasAccepted = acceptedItems.length > 0;
  const canCloseRequest =
    !requestClosed &&
    submitted &&
    !hasAccepted &&
    (purchasable.length === 0 ||
      (rejectedItems.length >= purchasable.length &&
        acceptedItems.length === 0));
  // A closed request has nothing left to collect: paid through `orders/paid`,
  // or closed by the customer once they had rejected everything.
  const hasCheckoutLink = Boolean(invoiceUrl) && !requestClosed;
  const holdEnded = isOfferExpired(offer.expiresAtIso) && !requestClosed;
  const showSupportNote = shouldRenderCustomerSupportNote({
    status: requestStatus,
    requestClosed,
    offerExpired: isOfferExpired(offer.expiresAtIso),
  });

  if (submitted) {
    return (
      <CustomerOfferPage
        heading={answeredOfferHeading({
          requestPaid,
          requestClosed,
          hasAccepted,
          hasCheckoutLink,
          allUnavailable,
        })}
      >
        <StatusBadge label={statusLabel} tone={statusTone} />
        {showSupportNote ? (
          <s-section>
            <CustomerSupportNote />
          </s-section>
        ) : null}

        {requestPaid ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-banner tone="success">
                <s-text>
                  We received your payment
                  {paidAt ? (
                    <>
                      {" "}
                      on{" "}
                      {paidAtIso ? (
                        <CustomerTime iso={paidAtIso}>{paidAt}</CustomerTime>
                      ) : (
                        paidAt
                      )}
                    </>
                  ) : null}
                  . This request is complete.
                </s-text>
              </s-banner>
              <s-paragraph>
                There is nothing left to pay. Your order confirmation went to{" "}
                {offer.customerEmail}.
              </s-paragraph>
            </s-stack>
          </s-section>
        ) : null}

        {hasAccepted && invoiceUrl && !requestClosed && !holdEnded ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-paragraph>We also emailed this link to you just in case.</s-paragraph>
              <s-text color="subdued">{offer.customerEmail}</s-text>
              <s-link href={invoiceUrl}>Continue to Checkout</s-link>
            </s-stack>
          </s-section>
        ) : null}

        {hasAccepted && holdEnded && !requestPaid && !requestClosed ? (
          <s-section>
            <s-banner tone="critical">
              <s-stack direction="block" gap="small">
                <s-text>
                  <strong>Offer Expired</strong>
                </s-text>
                <s-text>
                  The items are no longer being held
                  {offer.expiresAt ? (
                    <>
                      {" "}
                      — the hold ended on{" "}
                      <CustomerTime iso={offer.expiresAtIso}>
                        {offer.expiresAt}
                      </CustomerTime>
                    </>
                  ) : null}
                  .
                  The previous checkout/payment link is no longer valid.
                </s-text>
                <s-text>
                  You may submit a new request if you are still interested.
                </s-text>
              </s-stack>
            </s-banner>
          </s-section>
        ) : null}

        {hasAccepted && !invoiceUrl && !requestClosed && !requestPaid && !holdEnded ? (
          /*
           * There is no payment link, and nothing on this page will produce one:
           * re-submitting an answered offer is refused. Telling the customer a
           * link had been emailed and would appear here shortly was false on
           * both counts. After the hold ends the expired banner above is the
           * only message — this one would claim the plants are still held.
           */
          <s-section>
            <s-stack direction="block" gap="base">
              <s-banner tone="warning">
                <s-text>
                  We could not create your payment link yet. Your selections are
                  saved and your plants are still held for you.
                </s-text>
              </s-banner>
              <s-paragraph>
                We will email the payment link to {offer.customerEmail} as soon as
                it is ready. Nothing has been charged, and you do not need to
                submit this offer again.
              </s-paragraph>
            </s-stack>
          </s-section>
        ) : null}

        {!hasAccepted && allUnavailable ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-text>
                Unfortunately, none of the requested plants are currently
                available. Please review the notes below for additional
                information.
              </s-text>
              {requestClosed ? null : (
                <s-text color="subdued">
                  Close this request when you are finished.
                </s-text>
              )}
            </s-stack>
          </s-section>
        ) : null}

        {!hasAccepted && !allUnavailable ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-text>
                You did not accept any plants from this offer, so there is
                nothing to pay. No checkout link was created and the FedEx
                Priority Overnight upgrade was not applied.
              </s-text>
              {requestClosed ? null : (
                <s-text color="subdued">
                  Close this request when you are finished.
                </s-text>
              )}
            </s-stack>
          </s-section>
        ) : null}

        {rejectedItems.length > 0 ? (
          /*
           * What the customer turned down, exactly as the offer froze it. This
           * is the only record they have once the request is closed, so it
           * comes from the response snapshot rather than the live request —
           * a later admin edit must not rewrite what they were shown. Keep it
           * even when they also accepted plants — those live in the summary
           * below, and hiding this used to drop the declined photos entirely.
           */
          <s-section heading="Plants you declined">
            <s-stack direction="block" gap="base">
              {rejectedItems.map((item) => (
                <DeclinedItemCard key={item.offerItemId} item={item} />
              ))}
            </s-stack>
          </s-section>
        ) : null}

        {hasAccepted ? (
          <s-section heading="Final approval summary">
            <s-stack direction="block" gap="base">
              {acceptedItems.map((item) => (
                <AcceptedItemCard key={item.offerItemId} item={item} />
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

        {canCloseRequest ? (
          <s-section>
            <CloseRequestButton formAction={formAction} prominent />
          </s-section>
        ) : backHref ? (
          <s-section>
            <s-link href={backHref}>Back to My Requests</s-link>
          </s-section>
        ) : null}
        <form
          method="post"
          action={formAction}
          data-tz-capture
          data-known-tz={customerTimeZone ?? ""}
          hidden
        >
          <input type="hidden" name="intent" value="save-timezone" />
          <input type="hidden" name="customerTimeZone" defaultValue="" />
        </form>
        <CustomerEnhanceScripts />
      </CustomerOfferPage>
    );
  }

  // The hold, not the request status, decides whether this offer can still be
  // answered: the expiry sweep may not have run yet, and the server refuses a
  // late answer either way, so the page must stop offering one.
  //
  // A closed request counts the same way. The terminal state used to be decided
  // by a recorded answer, so a customer who closed an all-unavailable request
  // was handed the live offer again — countdown, "held for you", and the same
  // Close Request button — while their own request list already said Closed.
  const expired = isOfferExpired(offer.expiresAtIso) || requestClosed;

  return (
    <CustomerOfferPage
      heading={
        requestClosed
          ? "Request closed"
          : expired
            ? "This offer has expired"
            : offer.title
      }
    >
      <StatusBadge label={statusLabel} tone={statusTone} />
      {showSupportNote ? (
        <s-section>
          <CustomerSupportNote />
        </s-section>
      ) : null}

      <OfferExpiryBanner
        expirationDays={offer.expirationDays}
        expiresAt={offer.expiresAt}
        expiresAtIso={offer.expiresAtIso}
        urgencyMessage={offer.urgencyMessage}
        holdMessage={offer.holdMessage}
        requestClosed={requestClosed}
      />

      {expired ? (
        <>
          <s-section heading="Plants that were offered to you">
            <s-stack direction="block" gap="base">
              {offer.items.map((item) => (
                <OfferItemCard key={item.id} item={item} answerable={false} />
              ))}
            </s-stack>
          </s-section>
          {backHref ? (
            <s-section>
              <s-link href={backHref}>Back to My Requests</s-link>
            </s-section>
          ) : null}
        </>
      ) : pendingFedexRemoval ? (
        /*
         * Removing the upgrade used to open a JS modal, which never opens on the
         * storefront. It is now a second server round-trip, so the warning is
         * still shown and the removal is still an explicit choice.
         */
        <s-section heading="Remove the shipping upgrade?">
          <s-stack direction="block" gap="base">
            <s-banner tone="warning">
              <s-text>{fedexRemovalWarning || DEFAULT_FEDEX_REMOVAL_WARNING}</s-text>
            </s-banner>
            <form method="post" action={formAction}>
              <input type="hidden" name="fedexRemovalAcknowledged" value="true" />
              <input type="hidden" name="customerTimeZone" value="" />
              {purchasable
                .filter((item) => submittedChoices?.[item.sourceItemId])
                .map((item) => (
                  <input
                    key={item.id}
                    type="hidden"
                    name={`choice-${item.sourceItemId}`}
                    value={submittedChoices![item.sourceItemId]}
                  />
                ))}
              <s-stack direction="inline" gap="small">
                <button
                  type="submit"
                  name="intent"
                  value="submit-response"
                  style={buttonStyle}
                >
                  I Understand, Remove Upgrade
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="keep-fedex"
                  style={{ ...buttonStyle, fontWeight: 600 }}
                >
                  Keep FedEx Upgrade
                </button>
              </s-stack>
            </form>
          </s-stack>
        </s-section>
      ) : (
        <form method="post" action={formAction}>
          <input type="hidden" name="customerTimeZone" defaultValue="" />
          <input
            type="hidden"
            id="fedex-ack"
            name="fedexRemovalAcknowledged"
            defaultValue=""
          />
          {error ? (
            <s-section>
              <s-banner tone="critical">
                <s-text>{error}</s-text>
              </s-banner>
            </s-section>
          ) : null}

          <s-section heading="Plants offered to you">
            <s-stack direction="block" gap="base">
              <s-text color="subdued">
                Choose Accept or Reject for each available plant. Nothing is
                selected for you.
              </s-text>
              {offer.items.map((item) => (
                <OfferItemCard
                  key={item.id}
                  item={item}
                  choice={
                    item.availability === "available"
                      ? submittedChoices?.[item.sourceItemId]
                      : "unavailable"
                  }
                  answerable
                />
              ))}
            </s-stack>
          </s-section>

          {allUnavailable ? (
            <s-section>
              <s-stack direction="block" gap="base">
                <s-text>
                  Unfortunately, none of the requested plants are currently
                  available. Please review the notes below for additional
                  information.
                </s-text>
                <button
                  type="submit"
                  name="intent"
                  value="submit-response"
                  data-offer-submit
                  style={primaryButtonStyle}
                >
                  Submit
                </button>
              </s-stack>
            </s-section>
          ) : (
            <>
              <s-section heading="Shipping upgrade">
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="base"
                >
                  <label
                    htmlFor="fedex-upgrade"
                    id="fedex-upgrade-label"
                    style={choiceLabelStyle}
                  >
                    {/*
                      A real checkbox: unchecked submits nothing, which is
                      exactly "upgrade removed". JavaScript disables and greys
                      this out while no plant is accepted; the server also
                      strips FedEx when nothing was accepted.
                    */}
                    <input
                      id="fedex-upgrade"
                      type="checkbox"
                      name="fedexUpgradeSelected"
                      value="true"
                      defaultChecked={fedexSelected}
                    />
                    <s-text>
                      {offer.fedexUpgradeLabel},{" "}
                      {formatCurrency(offer.fedexUpgradePrice)}
                    </s-text>
                  </label>
                  <div
                    id="fedex-removal-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="fedex-warning-title"
                    hidden
                    aria-hidden="true"
                    data-fedex-removal-dialog
                    style={{
                      position: "fixed",
                      inset: 0,
                      zIndex: 50,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 16,
                      background: "rgba(32, 34, 35, 0.72)",
                    }}
                  >
                    <style>{`#fedex-removal-dialog[hidden]{display:none!important}`}</style>
                    <div
                      data-fedex-warning-card
                      style={{
                        width: "min(480px, 100%)",
                        padding: 20,
                        border: "1px solid #c9cccf",
                        borderRadius: 12,
                        background: "#fff",
                      }}
                    >
                      <s-stack direction="block" gap="base">
                        <s-heading id="fedex-warning-title">
                          Remove the shipping upgrade?
                        </s-heading>
                        <s-text>
                          {fedexRemovalWarning || DEFAULT_FEDEX_REMOVAL_WARNING}
                        </s-text>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          <button
                            id="fedex-keep"
                            type="button"
                            style={{ ...buttonStyle, fontWeight: 600 }}
                          >
                            Keep FedEx Upgrade
                          </button>
                          <button
                            id="fedex-confirm-remove"
                            type="button"
                            style={buttonStyle}
                          >
                            I Understand, Remove Upgrade
                          </button>
                        </div>
                      </s-stack>
                    </div>
                  </div>
                </s-box>
              </s-section>

              <s-section>
                <button
                  type="submit"
                  name="intent"
                  value="submit-response"
                  data-offer-submit
                  style={primaryButtonStyle}
                >
                  Submit
                </button>
              </s-section>
            </>
          )}
        </form>
      )}
      <form
        method="post"
        action={formAction}
        data-tz-capture
        data-known-tz={customerTimeZone ?? ""}
        hidden
      >
        <input type="hidden" name="intent" value="save-timezone" />
        <input type="hidden" name="customerTimeZone" defaultValue="" />
      </form>
      <CustomerEnhanceScripts includeFedexWarning={!expired && !pendingFedexRemoval} />
    </CustomerOfferPage>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label?: string;
  tone: "info" | "warning" | "caution" | "success" | "critical";
}) {
  if (!label) return null;
  return (
    <s-section>
      <ThemeStatusBadge tone={tone}>{label}</ThemeStatusBadge>
    </s-section>
  );
}

/** Snapshot photos from the response, not the live request item. */
function ResponseItemPhotos({
  item,
}: {
  item: CustomerOfferResponse["items"][number];
}) {
  const growersChoice = item.fulfillmentType === "growers_choice";

  if (growersChoice && item.linkedImageUrl) {
    return (
      <CustomerPhotoGallery
        urls={[item.linkedImageUrl]}
        alt={`${item.plantName}, from our store listing`}
      />
    );
  }

  if (!growersChoice && item.photoUrls.length > 0) {
    return <CustomerPhotoGallery urls={item.photoUrls} alt={item.plantName} />;
  }

  return null;
}

/** One plant the customer accepted, as the offer and the answer froze it. */
function AcceptedItemCard({ item }: { item: CustomerOfferResponse["items"][number] }) {
  return (
    <NestedBox>
      <s-stack direction="block" gap="base">
        <ResponseItemPhotos item={item} />
        <s-stack direction="block" gap="small">
          <s-heading>{item.plantName}</s-heading>
          <s-text>{formatCurrency(item.price)}</s-text>
          {item.fulfillmentType === "growers_choice" ? (
            <s-stack direction="block" gap="small">
              <s-badge tone="info">
                {FULFILLMENT_TYPE_LABELS.growers_choice}
              </s-badge>
              <s-text color="subdued">
                {GROWERS_CHOICE_CUSTOMER_SUMMARY}
              </s-text>
            </s-stack>
          ) : null}
          <s-text color="subdued">Customer Notes / Disclaimers</s-text>
          <s-text>{item.customerNotes}</s-text>
        </s-stack>
      </s-stack>
    </NestedBox>
  );
}

/** One plant the customer rejected, as the offer and the answer froze it. */
function DeclinedItemCard({ item }: { item: CustomerOfferResponse["items"][number] }) {
  const growersChoice = item.fulfillmentType === "growers_choice";

  return (
    <NestedBox>
      <s-stack direction="block" gap="base">
        <ResponseItemPhotos item={item} />

        <s-stack direction="block" gap="base">
          <s-heading>{item.plantName}</s-heading>
          <s-text>{formatCurrency(item.price)}</s-text>
          {growersChoice ? (
            <s-badge tone="info">{FULFILLMENT_TYPE_LABELS.growers_choice}</s-badge>
          ) : null}
          <s-badge tone="critical">Declined</s-badge>
        </s-stack>

        {item.customerNotes.trim() ? (
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Customer Notes / Disclaimers</s-text>
            <s-text>{item.customerNotes}</s-text>
          </s-stack>
        ) : null}
      </s-stack>
    </NestedBox>
  );
}

function OfferItemCard({
  item,
  choice,
  answerable,
}: {
  item: OfferPlantItem;
  /** Undefined until the customer picks one; nothing is pre-selected. */
  choice?: ItemChoice;
  /** False once the hold has lapsed: the plant is no longer held for anyone. */
  answerable: boolean;
}) {
  const available = item.availability === "available";
  const growersChoice = available && item.fulfillmentType === "growers_choice";

  return (
    <NestedBox>
      <s-stack direction="block" gap="base">
        {growersChoice && item.listingImageUrl ? (
          /*
           * The listing's photo, said to be the listing's photo. An exact-plant
           * offer on this same page shows the very plant being bought, so an
           * unlabelled picture here would read as the same promise — and the
           * plant that arrives would not be the one in it.
           */
          <CustomerPhotoGallery
            urls={[item.listingImageUrl]}
            alt={`${item.plantName}, from our store listing`}
          />
        ) : null}

        {available && !growersChoice && item.photoUrls.length > 0 ? (
          <CustomerPhotoGallery urls={item.photoUrls} alt={item.plantName} />
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

        {growersChoice ? (
          <s-stack direction="block" gap="small">
            <s-badge tone="info">
              {FULFILLMENT_TYPE_LABELS.growers_choice}
            </s-badge>
            <s-text>{GROWERS_CHOICE_CUSTOMER_SUMMARY}</s-text>
            <s-text color="subdued">{GROWERS_CHOICE_IMAGE_DISCLOSURE}</s-text>
          </s-stack>
        ) : null}

        <s-stack direction="block" gap="small">
          <s-text color="subdued">Customer Notes / Disclaimers</s-text>
          <s-text>{item.notesFromUpt || " "}</s-text>
        </s-stack>

        {available && answerable ? (
          /*
           * Native radios inside the submitting form. A choice held in React
           * state and mirrored into a hidden input submits the default for every
           * item when the page does not hydrate, which it never does through the
           * app proxy — the customer would silently accept everything.
           */
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(["accept", "reject"] as const).map((option) => (
              <label key={option} style={choiceLabelStyle}>
                <input
                  type="radio"
                  name={`choice-${item.sourceItemId}`}
                  value={option}
                  defaultChecked={choice === option}
                  required
                />
                <s-text>{option === "accept" ? "Accept" : "Reject"}</s-text>
              </label>
            ))}
          </div>
        ) : null}

        {available && !answerable ? (
          <s-text color="subdued">
            This plant is no longer held for you and can no longer be accepted.
          </s-text>
        ) : null}

        {!available ? (
          <s-text color="subdued">
            This plant is unavailable and cannot be accepted or rejected. It will
            be excluded from checkout.
          </s-text>
        ) : null}
      </s-stack>
    </NestedBox>
  );
}
