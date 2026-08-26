
import { MAX_PLANT_ROWS } from "../lib/customer-form-limits";
import {
  computeTimeRemaining,
  customerStatusTone,
  formatCustomerStatusLabel,
  isOfferExpired,
  type CustomerMyRequestRow,
  type RequestStatus,
} from "../lib/portal";
import { CUSTOMER_REQUEST_PAGE_SIZE } from "../lib/list-page";
import { THEME } from "../lib/theme";
import { CustomerEnhanceScripts, CustomerTime } from "./customer-enhance";
import { PagerChevron, pagerArrowStyle } from "./paged-list";
import {
  CustomerPageShell,
  LeafIcon,
  StatusBadge,
  themeFieldStyle,
  themePrimaryButtonStyle,
} from "./theme";

export type PlantLine = {
  plantName: string;
  notes: string;
};

export const EMPTY_PLANT_LINE: PlantLine = { plantName: "", notes: "" };

const secondaryButtonStyle: React.CSSProperties = {
  ...themePrimaryButtonStyle,
  width: "auto",
  background: THEME.white,
  color: THEME.darkGreen,
  WebkitTextFillColor: THEME.darkGreen,
};

const loginLinkStyle: React.CSSProperties = {
  ...themePrimaryButtonStyle,
  textDecoration: "none",
};

/** Real storefront anchor — app-proxy pages never hydrate. */
export function CustomerLoginLink({ href }: { href: string }) {
  return (
    <p style={{ margin: "16px 0 0" }}>
      <a href={href} style={loginLinkStyle}>
        Log in
      </a>
    </p>
  );
}

export function CustomerRequestPortal({
  loggedIn,
  name,
  email,
  myRequests,
  successMessage,
  errors,
  requestDetailHref,
  showDemoLogin,
  loginHref = null,
  formAction,
  browseAction,
  plantLines = [EMPTY_PLANT_LINE],
  canSubmit = true,
  customerTimeZone = null,
  hasExistingOrder = null,
}: {
  loggedIn: boolean;
  name: string;
  email: string;
  myRequests: CustomerMyRequestRow[];
  successMessage?: string | null;
  errors?: string[];
  requestDetailHref: (requestId: string) => string;
  showDemoLogin: boolean;
  loginHref?: string | null;
  formAction?: string;
  /**
   * Where the add and remove buttons navigate to with GET when JavaScript is
   * blocked. The storefront page itself, so the customer never leaves it.
   */
  browseAction?: string;
  /**
   * Rows come from the server (or the GET fallback query string). Adding and
   * removing a row is done in place by the plant-rows enhance script. The
   * buttons stay GET submits so a blocked script still works — an app proxy
   * page never hydrates, so this cannot be React state.
   */
  plantLines?: PlantLine[];
  canSubmit?: boolean;
  customerTimeZone?: string | null;
  hasExistingOrder?: "yes" | "no" | null;
}) {

  if (!loggedIn) {
    return (
      <CustomerPageShell title="Customer Request Form">
        <section className="upt-card">
          <p className="upt-muted">
            Please log in to your Shopify customer account to submit a plant
            request.
          </p>
          {loginHref ? <CustomerLoginLink href={loginHref} /> : null}
          {showDemoLogin ? (
            <form method="post" action={formAction}>
              <input type="hidden" name="intent" value="demo-login" />
              <button type="submit" style={themePrimaryButtonStyle}>
                <LeafIcon />
                Continue as logged in customer
              </button>
              <p className="upt-muted" style={{ marginTop: 12 }}>
                Development login uses the demo customer account. Production
                uses the Shopify customer account from the app proxy or
                Customer Account authentication.
              </p>
            </form>
          ) : null}
        </section>
      </CustomerPageShell>
    );
  }

  return (
    <CustomerPageShell title="Customer Request Form">
      {successMessage ? (
        <div className="upt-banner-gap">
          <s-banner tone="success">
            <s-text>{successMessage}</s-text>
          </s-banner>
        </div>
      ) : null}

      <section className="upt-card">
        <h2 className="upt-card-title">New request</h2>
        <p className="upt-muted">
          Your name and email are pulled from your customer account. Feel free
          to request multiple plants at once. Any plants we’re able to offer
          will be shown individually with photos and details so you know
          exactly what you’re reviewing.
        </p>
        <label>
          <span>Name</span>
          <input type="text" value={name} readOnly style={themeFieldStyle} />
        </label>
        <label style={{ display: "block", marginTop: 12 }}>
          <span>Email</span>
          <input type="email" value={email} readOnly style={themeFieldStyle} />
        </label>
      </section>

      <form method="post" action={formAction}>
        <input type="hidden" name="customerTimeZone" defaultValue="" />
        <section
          className="upt-card"
          data-plant-rows
          data-max-rows={MAX_PLANT_ROWS}
        >
          <h2 className="upt-card-title">Plants requested</h2>
          {plantLines.map((line, index) => (
            <div key={index} className="upt-plant-card" data-plant-row>
              <label>
                <span>Plant Name</span>
                <input
                  type="text"
                  name={`plantName-${index}`}
                  defaultValue={line.plantName}
                  required
                  style={themeFieldStyle}
                />
              </label>
              <label style={{ display: "block", marginTop: 12 }}>
                <span>Notes (optional)</span>
                <textarea
                  name={`notes-${index}`}
                  defaultValue={line.notes}
                  rows={3}
                  style={{ ...themeFieldStyle, resize: "vertical" }}
                />
              </label>
              <button
                type="submit"
                name="removePlant"
                value={String(index)}
                formMethod="get"
                formAction={browseAction}
                formNoValidate
                data-plant-remove
                hidden={plantLines.length <= 1}
                style={{ ...secondaryButtonStyle, marginTop: 12 }}
              >
                Remove plant
              </button>
            </div>
          ))}
          <input
            type="hidden"
            name="itemCount"
            defaultValue={String(plantLines.length)}
            data-item-count
          />
          {/*
            GET is the no-JavaScript fallback: the browser puts typed values in
            the query string and the page re-renders with one more row. When
            the plant-rows enhance script runs it intercepts the click and
            populates the row in place.
          */}
          <button
            type="submit"
            name="addPlant"
            value="1"
            formMethod="get"
            formAction={browseAction}
            formNoValidate
            data-plant-add
            hidden={plantLines.length >= MAX_PLANT_ROWS}
            style={themePrimaryButtonStyle}
          >
            <span aria-hidden="true">+</span>
            Add another plant
          </button>
        </section>

        {(errors?.length ?? 0) > 0 && (
          <s-banner tone="critical">
            <s-stack direction="block" gap="small">
              {errors?.map((error) => (
                <s-text key={error}>{error}</s-text>
              ))}
            </s-stack>
          </s-banner>
        )}

        <section
          className="upt-card"
          style={{ borderColor: THEME.yellow, borderWidth: 2 }}
        >
          <h2 className="upt-card-title">Have an existing order?</h2>
          <fieldset className="upt-choice-set">
            <legend className="upt-sr-only">Have an existing order?</legend>
            <label className="upt-choice">
              <input
                type="radio"
                name="hasExistingOrder"
                value="yes"
                required
                defaultChecked={hasExistingOrder === "yes"}
              />
              <span>Yes</span>
            </label>
            <label className="upt-choice">
              <input
                type="radio"
                name="hasExistingOrder"
                value="no"
                required
                defaultChecked={hasExistingOrder === "no"}
              />
              <span>No</span>
            </label>
          </fieldset>
        </section>

        <section className="upt-card" style={{ padding: 0, overflow: "hidden" }}>
          <button
            type="submit"
            name="intent"
            value="submit-request"
            disabled={!canSubmit}
            style={{
              ...themePrimaryButtonStyle,
              borderRadius: 14,
              minHeight: 52,
            }}
          >
            Submit request
          </button>
        </section>
      </form>

      <section className="upt-card">
        <h2 className="upt-card-title">My Requests</h2>
        {myRequests.length === 0 ? (
          <p className="upt-muted">
            You have not submitted any plant requests yet.
          </p>
        ) : (
          <div
            data-paged-list
            data-page-size={CUSTOMER_REQUEST_PAGE_SIZE}
          >
            <style>{`
              [data-paged-item][hidden] { display: none !important; }
              [data-paged-items] {
                min-height: calc(${CUSTOMER_REQUEST_PAGE_SIZE} * 45px);
                padding-bottom: 32px;
              }
              [data-paged-list] { overflow-anchor: none; }
              [data-paged-prev]:disabled,
              [data-paged-next]:disabled { opacity: 0.35; cursor: default; }
              [data-paged-status] { display: inline-block; min-width: 11ch; text-align: center; }
              [data-paged-item] s-link {
                width: auto !important;
                max-width: max-content;
                justify-self: start;
              }
              [data-paged-item] [data-status-badge] { justify-self: center; }
            `}</style>
            <div data-paged-items>
              {myRequests.map((request) => {
                const label = formatCustomerStatusLabel(request.status, {
                  hasPayableItems: request.hasPayableItems,
                  hasResponded: request.hasResponded,
                });
                return (
                  <div
                    key={request.id}
                    data-paged-item
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      alignItems: "center",
                      width: "100%",
                      height: 45,
                      boxSizing: "border-box",
                      padding: "8px 0",
                      borderBottom: `1px solid ${THEME.line}`,
                    }}
                  >
                    <s-link href={requestDetailHref(request.id)}>
                      {request.requestNumber}
                    </s-link>
                    <StatusBadge
                      tone={customerStatusTone(request.status as RequestStatus, {
                        hasPayableItems: request.hasPayableItems,
                        hasResponded: request.hasResponded,
                      })}
                    >
                      {label}
                    </StatusBadge>
                    <span aria-hidden="true" />
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                marginTop: 80,
                paddingTop: 32,
                minHeight: 36,
              }}
            >
              <button
                type="button"
                data-paged-prev
                aria-label="Previous page"
                style={{ ...pagerArrowStyle, color: THEME.darkGreen }}
              >
                <PagerChevron direction="prev" />
              </button>
              <span className="upt-muted">
                <span data-paged-status></span>
              </span>
              <button
                type="button"
                data-paged-next
                aria-label="Next page"
                style={{ ...pagerArrowStyle, color: THEME.darkGreen }}
              >
                <PagerChevron direction="next" />
              </button>
            </div>
          </div>
        )}
      </section>
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
    </CustomerPageShell>
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
            The hold ended on{" "}
            <CustomerTime iso={expiresAtIso}>{expiresAt}</CustomerTime>. These
            plants are no longer held for you and this offer can no longer be
            answered.
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
        <s-text color="subdued">
          Expires: <CustomerTime iso={expiresAtIso}>{expiresAt}</CustomerTime>
        </s-text>
        {remaining ? <s-text color="subdued">{remaining}</s-text> : null}
      </s-stack>
    </s-banner>
  );
}
