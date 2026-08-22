
import {
  computeTimeRemaining,
  formatCustomerStatusLabel,
  isOfferExpired,
  requestStatusTone,
  type CustomerMyRequestRow,
  type RequestStatus,
} from "../lib/portal";

export type PlantLine = {
  plantName: string;
  notes: string;
};

export const EMPTY_PLANT_LINE: PlantLine = { plantName: "", notes: "" };

const fieldStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: "8px",
  padding: "8px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
  cursor: "pointer",
};

export function CustomerRequestPortal({
  loggedIn,
  name,
  email,
  myRequests,
  successMessage,
  errors,
  requestDetailHref,
  showDemoLogin,
  formAction,
  browseAction,
  plantLines = [EMPTY_PLANT_LINE],
  canSubmit = true,
}: {
  loggedIn: boolean;
  name: string;
  email: string;
  myRequests: CustomerMyRequestRow[];
  successMessage?: string | null;
  errors?: string[];
  requestDetailHref: (requestId: string) => string;
  showDemoLogin: boolean;
  formAction?: string;
  /**
   * Where the add and remove buttons navigate to with GET. The storefront page
   * itself, so the customer never leaves it.
   */
  browseAction?: string;
  /**
   * Rows come from the server. Adding and removing a row is a form submission
   * rather than client state, because an app proxy page serves its assets from
   * the shop's domain and so never hydrates.
   */
  plantLines?: PlantLine[];
  canSubmit?: boolean;
}) {

  if (!loggedIn) {
    return (
      <s-page heading="Customer Request Form">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              Please log in to your Shopify customer account to submit a plant
              request.
            </s-text>
            {showDemoLogin ? (
              <form method="post" action={formAction}>
                <input type="hidden" name="intent" value="demo-login" />
                <s-stack direction="block" gap="base">
                  <s-button variant="primary" type="submit">
                    Continue as logged in customer
                  </s-button>
                  <s-text color="subdued">
                    Development login uses the demo customer account. Production
                    uses the Shopify customer account from the app proxy or
                    Customer Account authentication.
                  </s-text>
                </s-stack>
              </form>
            ) : (
              <s-text color="subdued">
                Open this page from your Shopify account while logged in.
              </s-text>
            )}
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Customer Request Form">
      {successMessage ? (
        <s-banner tone="success">
          <s-text>{successMessage}</s-text>
        </s-banner>
      ) : null}

      <s-section heading="New request">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Name and email come from your customer account. You can submit
            multiple plants in one request. There is no quantity field — each
            exact plant is reviewed individually.
          </s-text>
          <s-text-field label="Name" value={name} readOnly />
          <s-text-field label="Email" value={email} readOnly />
        </s-stack>
      </s-section>

      <form method="post" action={formAction}>
        <s-section heading="Plants requested">
          <s-stack direction="block" gap="large">
            {plantLines.map((line, index) => (
              <s-box
                key={index}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-heading>Plant {index + 1}</s-heading>
                  <label>
                    <s-text>Plant Name</s-text>
                    <input
                      type="text"
                      name={`plantName-${index}`}
                      defaultValue={line.plantName}
                      required
                      style={fieldStyle}
                    />
                  </label>
                  <label>
                    <s-text>Notes (optional)</s-text>
                    <textarea
                      name={`notes-${index}`}
                      defaultValue={line.notes}
                      rows={3}
                      style={{ ...fieldStyle, resize: "vertical" }}
                    />
                  </label>
                  {plantLines.length > 1 ? (
                    <button
                      type="submit"
                      name="removePlant"
                      value={String(index)}
                      formMethod="get"
                      formAction={browseAction}
                      formNoValidate
                      style={buttonStyle}
                    >
                      Remove plant
                    </button>
                  ) : null}
                </s-stack>
              </s-box>
            ))}
            <input type="hidden" name="itemCount" value={plantLines.length} />
            {/*
              formMethod="get" turns this into a navigation rather than a POST:
              the browser puts the typed values in the query string, the page
              re-renders with one more row, and the customer stays on the same
              storefront URL.
            */}
            <button
              type="submit"
              name="addPlant"
              value="1"
              formMethod="get"
              formAction={browseAction}
              formNoValidate
              style={buttonStyle}
            >
              Add another plant
            </button>
          </s-stack>
        </s-section>

        {(errors?.length ?? 0) > 0 && (
          <s-section>
            <s-banner tone="critical">
              <s-stack direction="block" gap="small">
                {errors?.map((error) => (
                  <s-text key={error}>{error}</s-text>
                ))}
              </s-stack>
            </s-banner>
          </s-section>
        )}

        <s-section>
          <button
            type="submit"
            name="intent"
            value="submit-request"
            disabled={!canSubmit}
            style={{ ...buttonStyle, fontWeight: 600 }}
          >
            Submit request
          </button>
        </s-section>
      </form>

      <s-section heading="My Requests">
        {myRequests.length === 0 ? (
          <s-text color="subdued">
            You have not submitted any plant requests yet.
          </s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Request Number</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {myRequests.map((request) => (
                <s-table-row key={request.id}>
                  <s-table-cell>
                    <s-link href={requestDetailHref(request.id)}>
                      {request.requestNumber}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={requestStatusTone(request.status as RequestStatus)}>
                      {formatCustomerStatusLabel(request.status, {
                        hasPayableItems: request.hasPayableItems,
                        hasResponded: request.hasResponded,
                      })}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export function OfferExpiryBanner({
  expirationDays,
  expiresAt,
  expiresAtIso,
  urgencyMessage,
  holdMessage,
  requestClosed = false,
}: {
  expirationDays: number;
  expiresAt: string;
  expiresAtIso: string;
  urgencyMessage: string;
  holdMessage: string;
  /** Closed by payment or by the customer; the hold is moot either way. */
  requestClosed?: boolean;
}) {
  if (requestClosed) {
    return (
      <s-banner tone="info">
        <s-text>
          This request is closed. There is nothing left to answer or pay.
        </s-text>
      </s-banner>
    );
  }

  /*
   * The hold decides what this says, not the day the offer was sent. Once it
   * lapses the plant becomes an EXACT PLANTS candidate for public sale, so
   * "reserved for you" and a countdown would contradict what the listing queue
   * is already doing with it.
   */
  if (isOfferExpired(expiresAtIso)) {
    return (
      <s-banner tone="critical">
        <s-stack direction="block" gap="small">
          <s-text>
            <strong>This offer has expired</strong>
          </s-text>
          <s-text>
            The hold ended on {expiresAt}. These plants are no longer held
            for you and this offer can no longer be answered.
          </s-text>
          <s-text>
            The previous checkout/payment link is no longer valid. You may
            submit a new request if you are still interested.
          </s-text>
        </s-stack>
      </s-banner>
    );
  }

  const remaining = computeTimeRemaining(expiresAtIso);
  return (
    <s-banner tone="warning">
      <s-stack direction="block" gap="small">
        <s-text>
          <strong>Offer expires in {expirationDays} days</strong>
        </s-text>
        <s-text>{urgencyMessage}</s-text>
        <s-text>{holdMessage}</s-text>
        <s-text color="subdued">Expires: {expiresAt}</s-text>
        {remaining ? <s-text color="subdued">{remaining}</s-text> : null}
      </s-stack>
    </s-banner>
  );
}
