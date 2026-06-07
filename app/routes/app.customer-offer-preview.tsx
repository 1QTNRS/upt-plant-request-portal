import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SAMPLE_CUSTOMER_OFFER } from "../lib/sample-offer";
import { useFedexWarningSettings } from "../lib/fedex-warning-settings";

type ItemChoice = "accept" | "reject";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { offer: SAMPLE_CUSTOMER_OFFER };
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

export default function CustomerOfferPreview() {
  const { offer } = useLoaderData<typeof loader>();
  const { fedexRemovalWarning } = useFedexWarningSettings();

  const [itemChoices, setItemChoices] = useState<Record<string, ItemChoice>>(
    () =>
      Object.fromEntries(
        offer.items.map((item) => [item.id, "accept" as ItemChoice]),
      ),
  );
  const [fedexUpgrade, setFedexUpgrade] = useState(true);
  const [showFedexModal, setShowFedexModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

  const handleSubmit = () => {
    setIsSubmitting(true);
    window.setTimeout(() => {
      setIsSubmitting(false);
      setSubmitted(true);
    }, 1200);
  };

  if (submitted) {
    return (
      <s-page heading="Your private checkout link is ready">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              We also emailed this link to you just in case.
            </s-paragraph>
            <s-text color="subdued">{offer.customerEmail}</s-text>
            <s-button variant="primary">
              Continue to Checkout
            </s-button>
            <s-text color="subdued">
              Mock link — draft order creation coming soon
            </s-text>
            <s-button
              variant="tertiary"
              onClick={() => {
                setSubmitted(false);
                setFedexUpgrade(true);
                setShowFedexModal(false);
                setItemChoices(
                  Object.fromEntries(
                    offer.items.map((item) => [item.id, "accept" as ItemChoice]),
                  ),
                );
              }}
            >
              Back to offer preview
            </s-button>
          </s-stack>
        </s-section>
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
            const choice = itemChoices[item.id] ?? "accept";

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
                    <s-stack direction="block" gap="base">
                      <s-heading>{item.plantName}</s-heading>
                      <s-text>
                        <strong>{formatCurrency(item.price)}</strong>
                      </s-text>

                      <s-stack direction="block" gap="small">
                        <s-text color="subdued">Notes from UPT</s-text>
                        <s-text>{item.notesFromUpt}</s-text>
                      </s-stack>

                      <s-stack direction="inline" gap="small">
                        <s-button
                          variant={
                            choice === "accept" ? "primary" : "secondary"
                          }
                          onClick={() => setChoice(item.id, "accept")}
                        >
                          Accept
                        </s-button>
                        <s-button
                          variant={
                            choice === "reject" ? "primary" : "secondary"
                          }
                          onClick={() => setChoice(item.id, "reject")}
                        >
                          Reject
                        </s-button>
                      </s-stack>
                    </s-stack>
                  </s-stack>
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>

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
              {offer.fedexUpgradeLabel}, {formatCurrency(offer.fedexUpgradePrice)}
            </s-text>
          </label>
        </s-box>
      </s-section>

      <s-section>
        <s-button
          variant="primary"
          onClick={handleSubmit}
          {...(isSubmitting ? { loading: true } : {})}
        >
          Submit
        </s-button>
      </s-section>

      <FedexWarningModal
        open={showFedexModal}
        message={fedexRemovalWarning}
        onKeep={handleKeepFedexUpgrade}
        onRemove={handleRemoveFedexUpgrade}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
