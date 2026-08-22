import {
  DEFAULT_FEDEX_REMOVAL_WARNING,
  formatCurrency,
  isOfferExpired,
  type CustomerOfferResponse,
  type OfferPlantItem,
  type SampleCustomerOffer,
} from "../lib/portal";
import { OfferExpiryBanner } from "./customer-request-portal";

type ItemChoice = "accept" | "reject" | "unavailable";

const buttonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  background: "#ffffff",
  font: "inherit",
  cursor: "pointer",
};

const choiceLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  cursor: "pointer",
};

/**
 * The storefront loads none of the app's CSS or JavaScript, so the gallery is a
 * plain flex row of images with inline styles.
 */
const photoRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

function CloseRequestButton({ formAction }: { formAction?: string }) {
  return (
    <form method="post" action={formAction}>
      <button type="submit" name="intent" value="close-request" style={buttonStyle}>
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
  paidAt,
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
  paidAt?: string | null;
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
  const rejectedItems = (response?.items ?? []).filter((item) => item.choice === "reject");
  const hasAccepted = acceptedItems.length > 0;
  // A closed request has nothing left to collect: paid through `orders/paid`,
  // or closed by the customer once they had rejected everything.
  const hasCheckoutLink = Boolean(invoiceUrl) && !requestClosed;
  const holdEnded = isOfferExpired(offer.expiresAtIso) && !requestClosed;

  if (submitted) {
    return (
      <s-page
        heading={answeredOfferHeading({
          requestPaid,
          requestClosed,
          hasAccepted,
          hasCheckoutLink,
          allUnavailable,
        })}
      >
        <StatusBadge label={statusLabel} tone={statusTone} />

        {requestPaid ? (
          <s-section>
            <s-stack direction="block" gap="base">
              <s-banner tone="success">
                <s-text>
                  We received your payment{paidAt ? ` on ${paidAt}` : ""}. This
                  request is complete.
                </s-text>
              </s-banner>
              <s-paragraph>
                There is nothing left to pay. Your order confirmation went to{" "}
                {offer.customerEmail}.
              </s-paragraph>
            </s-stack>
          </s-section>
        ) : null}

        {hasAccepted && invoiceUrl && !requestClosed ? (
          <s-section>
            <s-stack direction="block" gap="base">
              {holdEnded ? (
                /*
                 * The hold has lapsed, and an expired unpaid request releases
                 * its plants for review as EXACT PLANTS listings. The invoice
                 * Shopify issued is still payable, so the link stays — but
                 * presenting it as a live hold would be a promise this page
                 * cannot keep, and paying against it is no longer guaranteed
                 * to get the plant.
                 */
                <s-banner tone="warning">
                  <s-text>
                    Your hold ended{offer.expiresAt ? ` on ${offer.expiresAt}` : ""}.
                    Please contact us before paying — we can no longer guarantee
                    these plants are still reserved for you.
                  </s-text>
                </s-banner>
              ) : (
                <s-paragraph>We also emailed this link to you just in case.</s-paragraph>
              )}
              <s-text color="subdued">{offer.customerEmail}</s-text>
              <s-link href={invoiceUrl}>Continue to Checkout</s-link>
            </s-stack>
          </s-section>
        ) : null}

        {hasAccepted && !invoiceUrl && !requestClosed ? (
          /*
           * There is no payment link, and nothing on this page will produce one:
           * re-submitting an answered offer is refused. Telling the customer a
           * link had been emailed and would appear here shortly was false on
           * both counts.
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
                /*
                 * Without this the request has no action at all and sits open
                 * until the hold lapses, even though there was never anything
                 * to answer.
                 */
                <CloseRequestButton formAction={formAction} />
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
                <>
                  <s-text color="subdued">
                    Close this request when you are finished.
                  </s-text>
                  <CloseRequestButton formAction={formAction} />
                </>
              )}
            </s-stack>
          </s-section>
        ) : null}

        {!hasAccepted && rejectedItems.length > 0 ? (
          /*
           * What the customer turned down, exactly as the offer froze it. This
           * is the only record they have once the request is closed, so it
           * comes from the response snapshot rather than the live request —
           * a later admin edit must not rewrite what they were shown.
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

        {backHref ? (
          <s-section>
            <s-link href={backHref}>Back to My Requests</s-link>
          </s-section>
        ) : null}
      </s-page>
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
    <s-page
      heading={
        requestClosed
          ? "Request closed"
          : expired
            ? "This offer has expired"
            : offer.title
      }
    >
      <StatusBadge label={statusLabel} tone={statusTone} />

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
                  Remove it and continue
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="keep-fedex"
                  style={{ ...buttonStyle, fontWeight: 600 }}
                >
                  Keep the upgrade
                </button>
              </s-stack>
            </form>
          </s-stack>
        </s-section>
      ) : (
        <form method="post" action={formAction}>
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
                  value="close-request"
                  style={{ ...buttonStyle, fontWeight: 600 }}
                >
                  Close Request
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
                  <label htmlFor="fedex-upgrade" style={choiceLabelStyle}>
                    {/*
                      A real checkbox: unchecked submits nothing, which is
                      exactly "upgrade removed".
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
                </s-box>
              </s-section>

              <s-section>
                <button
                  type="submit"
                  name="intent"
                  value="submit-response"
                  style={{ ...buttonStyle, fontWeight: 600 }}
                >
                  Submit
                </button>
              </s-section>
            </>
          )}
        </form>
      )}
    </s-page>
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
      <s-badge tone={tone}>{label}</s-badge>
    </s-section>
  );
}

/** One plant the customer rejected, as the offer and the answer froze it. */
function DeclinedItemCard({ item }: { item: CustomerOfferResponse["items"][number] }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="base">
        {item.photoUrls.length > 0 ? (
          <div style={photoRowStyle}>
            {item.photoUrls.map((url, index) => (
              <img
                key={url}
                src={url}
                alt={
                  item.photoUrls.length > 1
                    ? `${item.plantName}, photo ${index + 1} of ${item.photoUrls.length}`
                    : item.plantName
                }
                width={200}
                height={200}
                style={{
                  display: "block",
                  objectFit: "cover",
                  borderRadius: "8px",
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        ) : null}

        <s-stack direction="block" gap="base">
          <s-heading>{item.plantName}</s-heading>
          <s-text>{formatCurrency(item.price)}</s-text>
          <s-badge tone="critical">Declined</s-badge>
        </s-stack>

        {item.customerNotes.trim() ? (
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Customer Notes / Disclaimers</s-text>
            <s-text>{item.customerNotes}</s-text>
          </s-stack>
        ) : null}
      </s-stack>
    </s-box>
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

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="base">
        {available && item.photoUrls.length > 0 ? (
          /*
           * Every photo the offer froze, as plain images. The storefront never
           * hydrates, so a gallery behind a click handler shows the customer
           * exactly one photo of the plant they are buying.
           */
          <div style={photoRowStyle}>
            {item.photoUrls.map((url, index) => (
              <img
                key={url}
                src={url}
                alt={
                  item.photoUrls.length > 1
                    ? `${item.plantName}, photo ${index + 1} of ${item.photoUrls.length}`
                    : item.plantName
                }
                width={200}
                height={200}
                style={{
                  display: "block",
                  objectFit: "cover",
                  borderRadius: "8px",
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
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

        {available && answerable ? (
          /*
           * Native radios inside the submitting form. A choice held in React
           * state and mirrored into a hidden input submits the default for every
           * item when the page does not hydrate, which it never does through the
           * app proxy — the customer would silently accept everything.
           */
          <s-stack direction="inline" gap="small">
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
          </s-stack>
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
    </s-box>
  );
}
