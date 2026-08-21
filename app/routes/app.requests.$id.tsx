import { useEffect, useState, type ChangeEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import { canStubShopifyWrites } from "../lib/environment.server";
import {
  listEmailsForRequest,
  notifyOfferReady,
  redeliverEmailMessage,
} from "../lib/emails.server";
import { listExactPlantCandidates } from "../lib/exact-plants.server";
import { createPaymentLinkForRequest } from "../lib/offer-response.server";
import {
  formatCurrency,
  formatDateTime,
  getDisplayRequestNumber,
  requestStatusTone,
  UNAVAILABLE_REASON_OPTIONS,
  type ItemAvailabilityStatus,
  type OfferExpirationDays,
  type PlantItem,
  type PlantItemStatus,
  type RequestStatus,
  type SentOffer,
  type UnavailableReason,
} from "../lib/portal";
import {
  addItemPhotos,
  getCustomerResponse,
  getDraftOrder,
  getRequest,
  markRequestViewed,
  sendOffer,
  updateRequestItem,
} from "../lib/portal.server";
import { ensureShopSeeded } from "../lib/seed-demo.server";
import { uploadPlantPhoto } from "../lib/shopify-ops.server";
import { saveLocalUpload } from "../lib/uploads.server";

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
    case "Listed":
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

const textInputStyle = {
  width: "100%",
  maxWidth: "420px",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
} as const;

const selectStyle = {
  ...textInputStyle,
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const requestId = params.id ?? "";
  const plantRequest = await getRequest(shop, requestId);
  if (plantRequest) {
    await markRequestViewed(shop, requestId);
  }
  const response = plantRequest
    ? await getCustomerResponse(shop, requestId)
    : null;
  // Dates are formatted here because the outbox rows are rendered as text.
  const emails = plantRequest
    ? (await listEmailsForRequest(shop, requestId)).map((email) => ({
        ...email,
        createdAt: formatDateTime(email.createdAt),
        sentAt: email.sentAt ? formatDateTime(email.sentAt) : null,
      }))
    : [];
  const draftOrder = plantRequest ? await getDraftOrder(shop, requestId) : null;

  const declinedExactPlants = plantRequest
    ? await listExactPlantCandidates(shop, requestId)
    : [];

  return {
    requestId,
    plantRequest,
    response,
    emails,
    paymentLink: draftOrder?.invoiceUrl ?? null,
    declinedExactPlants,
  };
};

/** A retry that did not deliver has to say why, or it looks like it worked. */
function undeliveredMessage(error?: string | null): string {
  return error
    ? `Still undelivered: ${error}`
    : "Still undelivered. Check that RESEND_API_KEY and EMAIL_FROM are set for this deployment.";
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop, admin } = await requireAdmin(request);
  const requestId = params.id ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  try {
    if (intent === "update-item") {
      await updateRequestItem(shop, {
        requestId,
        itemId: String(form.get("itemId") || ""),
        offeredName: form.has("offeredName")
          ? String(form.get("offeredName") || "")
          : undefined,
        availability: form.has("availability")
          ? (String(form.get("availability")) as ItemAvailabilityStatus)
          : undefined,
        unavailableReason: form.has("unavailableReason")
          ? (String(form.get("unavailableReason")) as UnavailableReason)
          : undefined,
        price: form.has("price")
          ? Number.parseFloat(String(form.get("price")))
          : undefined,
        weightLbs: form.has("weightLbs")
          ? Number.parseFloat(String(form.get("weightLbs")))
          : undefined,
        customerFacingNotes: form.has("customerFacingNotes")
          ? String(form.get("customerFacingNotes") || "")
          : undefined,
      });
      return { ok: true };
    }

    if (intent === "add-photo-url") {
      const url = String(form.get("photoUrl") || "").trim();
      if (url) {
        await addItemPhotos(shop, requestId, String(form.get("itemId") || ""), [
          { url },
        ]);
      }
      return { ok: true };
    }

    if (intent === "upload-photo") {
      const itemId = String(form.get("itemId") || "");
      const upload = form.get("photo");
      if (upload instanceof File && upload.size > 0) {
        const data = Buffer.from(await upload.arrayBuffer());
        let stored: { url: string; shopifyFileId?: string };
        try {
          stored = await uploadPlantPhoto(admin, shop, {
            filename: upload.name,
            mimeType: upload.type || "image/jpeg",
            data,
          });
        } catch (error) {
          // Local disk is ephemeral on a hosted deploy and is not served by
          // the Shopify CDN, so a failed upload must surface rather than appear
          // to succeed with a URL that dies at the next deploy.
          if (!canStubShopifyWrites(shop)) {
            console.error(
              `Shopify Files upload failed for request ${requestId}.`,
              error,
            );
            throw new Error(
              `Could not upload ${upload.name} to Shopify Files: ${
                error instanceof Error ? error.message : "unknown error"
              }. The photo was not attached — please try again.`,
            );
          }
          stored = {
            url: await saveLocalUpload(shop, itemId, {
              filename: upload.name,
              data,
            }),
          };
        }
        await addItemPhotos(shop, requestId, itemId, [stored]);
      }
      return { ok: true };
    }

    if (intent === "send-offer") {
      const days = Number(form.get("expirationDays")) as OfferExpirationDays;
      const expirationDays: OfferExpirationDays =
        days === 5 || days === 7 ? days : 3;
      const updated = await sendOffer(shop, requestId, expirationDays);
      if (updated) {
        const appUrl =
          process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
        await notifyOfferReady(shop, requestId, appUrl);
      }
      return { ok: true, sent: Boolean(updated) };
    }

    // `sendOffer` commits the offer and moves the request out of New, so it
    // refuses to run a second time. Without this, an offer-ready email that
    // failed after that commit could never be sent at all.
    if (intent === "resend-offer-email") {
      const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
      const message = await notifyOfferReady(shop, requestId, appUrl);
      if (message?.status === "sent") return { ok: true };
      return { ok: false, error: undeliveredMessage(message?.error) };
    }

    if (intent === "retry-email") {
      const message = await redeliverEmailMessage(
        shop,
        String(form.get("emailId") || ""),
      );
      if (!message) {
        return { ok: false, error: "That email is no longer in the outbox." };
      }
      if (message.status === "sent") return { ok: true };
      return { ok: false, error: undeliveredMessage(message.error) };
    }

    if (intent === "create-payment-link") {
      const result = await createPaymentLinkForRequest({
        shop,
        requestId,
        admin,
      });
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Save failed",
    };
  }

  return { ok: false, error: "Unknown action" };
};

function PlantItemCard({
  item,
  canEdit,
}: {
  item: PlantItem;
  canEdit: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const photoFetcher = useFetcher<typeof action>();
  const [offeredName, setOfferedName] = useState(item.offeredName);
  const [customerNotes, setCustomerNotes] = useState(item.customerFacingNotes);
  const [availability, setAvailability] = useState(item.availability);
  const [unavailableReason, setUnavailableReason] = useState(
    item.unavailableReason,
  );
  const [price, setPrice] = useState(item.price);
  const [weightLbs, setWeightLbs] = useState(item.weightLbs);
  const [photoUrl, setPhotoUrl] = useState("");

  useEffect(() => {
    setOfferedName(item.offeredName);
    setCustomerNotes(item.customerFacingNotes);
    setAvailability(item.availability);
    setUnavailableReason(item.unavailableReason);
    setPrice(item.price);
    setWeightLbs(item.weightLbs);
  }, [item]);

  const isAvailable = availability === "available";
  const fieldsLocked = !canEdit;

  const saveField = (fields: Record<string, string>) => {
    if (fieldsLocked) return;
    const data = new FormData();
    data.set("intent", "update-item");
    data.set("itemId", item.id);
    for (const [key, value] of Object.entries(fields)) {
      data.set(key, value);
    }
    fetcher.submit(data, { method: "post" });
  };

  const handleAvailabilityChange = (next: ItemAvailabilityStatus) => {
    setAvailability(next);
    saveField({ availability: next });
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

        {item.adminNotes ? (
          <s-text color="subdued">Customer request notes: {item.adminNotes}</s-text>
        ) : null}

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
              value={unavailableReason}
              disabled={fieldsLocked}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const reason = event.currentTarget.value as UnavailableReason;
                setUnavailableReason(reason);
                saveField({ unavailableReason: reason });
              }}
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
            <s-stack direction="block" gap="small">
              <label htmlFor={`offered-name-${item.id}`}>
                <s-text color="subdued">Final item name</s-text>
              </label>
              <input
                id={`offered-name-${item.id}`}
                value={offeredName}
                readOnly={fieldsLocked}
                disabled={fieldsLocked}
                onChange={(event) => setOfferedName(event.currentTarget.value)}
                onBlur={() => saveField({ offeredName })}
                style={fieldsLocked ? disabledNumberInputStyle : textInputStyle}
              />
            </s-stack>

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
                  readOnly={fieldsLocked}
                  disabled={fieldsLocked}
                  onChange={(event) =>
                    setPrice(Number.parseFloat(event.currentTarget.value) || 0)
                  }
                  onBlur={() => saveField({ price: String(price) })}
                  style={fieldsLocked ? disabledNumberInputStyle : numberInputStyle}
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
                  readOnly={fieldsLocked}
                  disabled={fieldsLocked}
                  onChange={(event) =>
                    setWeightLbs(
                      Number.parseFloat(event.currentTarget.value) || 0,
                    )
                  }
                  onBlur={() => saveField({ weightLbs: String(weightLbs) })}
                  style={fieldsLocked ? disabledNumberInputStyle : numberInputStyle}
                />
              </s-stack>
            </s-stack>

            <s-stack direction="block" gap="small">
              <s-text color="subdued">Exact plant photos</s-text>
              <s-stack direction="inline" gap="base">
                {item.photoUrls.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt={item.offeredName || item.plantName}
                    width={120}
                    height={120}
                    style={{
                      display: "block",
                      objectFit: "cover",
                      borderRadius: "8px",
                    }}
                  />
                ))}
              </s-stack>
              {canEdit ? (
                <s-stack direction="block" gap="small">
                  <photoFetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="upload-photo" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="file" name="photo" accept="image/*" />
                    <s-button variant="secondary" type="submit">
                      Upload plant photo
                    </s-button>
                  </photoFetcher.Form>
                  <photoFetcher.Form method="post">
                    <input type="hidden" name="intent" value="add-photo-url" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <s-stack direction="inline" gap="small">
                      <input
                        name="photoUrl"
                        value={photoUrl}
                        placeholder="https://..."
                        onChange={(event) => setPhotoUrl(event.currentTarget.value)}
                        style={textInputStyle}
                      />
                      <s-button variant="secondary" type="submit">
                        Add photo URL
                      </s-button>
                    </s-stack>
                  </photoFetcher.Form>
                </s-stack>
              ) : null}
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
            readOnly={fieldsLocked}
            disabled={fieldsLocked}
            placeholder="e.g. Minor cosmetic damage on one leaf."
            onChange={(event) => setCustomerNotes(event.currentTarget.value)}
            onBlur={() => saveField({ customerFacingNotes: customerNotes })}
            style={fieldsLocked ? disabledTextareaStyle : editableTextareaStyle}
          />
          <s-text color="subdued">
            {fieldsLocked
              ? "Read-only. Notes, photos, and prices are frozen after the offer is sent so the customer sees the exact snapshot."
              : "Shown to the customer on the offer page, approval snapshot, confirmation email, and final approval summary."}
          </s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

type OutboxMessage = Awaited<ReturnType<typeof loader>>["emails"][number];

const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  request_received: "Request received",
  admin_new_request: "New request (admin)",
  offer_ready: "Offer ready",
  confirmation: "Selections confirmed",
  checkout_link: "Payment link",
  expiration_reminder: "Expiration reminder",
  compliance_data_request: "Customer data request",
};

function emailStatusTone(
  status: string,
): "success" | "warning" | "critical" | "info" {
  switch (status) {
    case "sent":
      return "success";
    case "failed":
      return "critical";
    case "preview":
      return "warning";
    default:
      return "info";
  }
}

/**
 * The outbox for this request. A failed message used to exist only as one line
 * in the hosting provider's log, so nobody found out until a customer asked why
 * they had heard nothing.
 */
function EmailSection({ emails }: { emails: OutboxMessage[] }) {
  const undelivered = emails.filter((email) => email.status !== "sent");

  return (
    <s-section heading="Emails">
      <s-stack direction="block" gap="base">
        {undelivered.length > 0 ? (
          <s-banner tone="critical">
            <s-text>
              {undelivered.length === 1
                ? "1 email for this request has not been delivered."
                : `${undelivered.length} emails for this request have not been delivered.`}{" "}
              Retry each one below once the cause is fixed. The hourly maintenance
              run also retries them.
            </s-text>
          </s-banner>
        ) : null}

        {emails.length === 0 ? (
          <s-text color="subdued">
            No emails have been queued for this request yet.
          </s-text>
        ) : (
          emails.map((email) => (
            <s-box
              key={email.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="base">
                  <s-text>
                    <strong>
                      {EMAIL_TEMPLATE_LABELS[email.templateKey] ?? email.templateKey}
                    </strong>
                  </s-text>
                  <s-badge tone={emailStatusTone(email.status)}>
                    {email.status}
                  </s-badge>
                </s-stack>
                <s-text color="subdued">To {email.toEmail}</s-text>
                <s-text color="subdued">
                  {email.sentAt
                    ? `Sent ${email.sentAt}`
                    : `Queued ${email.createdAt} · ${email.attempts} delivery attempt(s)`}
                </s-text>
                {email.error ? (
                  <s-banner tone="critical">
                    <s-text>{email.error}</s-text>
                  </s-banner>
                ) : null}
                {email.status === "sent" ? null : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="retry-email" />
                    <input type="hidden" name="emailId" value={email.id} />
                    <s-button variant="secondary" type="submit">
                      Retry delivery
                    </s-button>
                  </Form>
                )}
              </s-stack>
            </s-box>
          ))
        )}
      </s-stack>
    </s-section>
  );
}

const EXPIRATION_OPTIONS: { days: OfferExpirationDays; label: string }[] = [
  { days: 3, label: "3 days" },
  { days: 5, label: "5 days" },
  { days: 7, label: "7 days" },
];

function SendOfferSection({
  status,
  sentOffer,
  offerEmail,
}: {
  status: RequestStatus;
  sentOffer?: SentOffer;
  /** The outbox row, which is the only evidence the customer was told. */
  offerEmail?: OutboxMessage;
}) {
  const [expirationDays, setExpirationDays] = useState<OfferExpirationDays>(3);
  const navigation = useNavigation();
  const sending =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "send-offer";

  if (sentOffer) {
    const delivered = offerEmail?.status === "sent";
    return (
      <s-stack direction="block" gap="base">
        {delivered ? (
          <s-banner tone="success">
            <s-text>Offer sent to customer</s-text>
          </s-banner>
        ) : (
          /*
           * The offer is committed and the request is no longer New, so the
           * banner used to claim the customer had been told whether or not the
           * email ever left the building.
           */
          <s-stack direction="block" gap="base">
            <s-banner tone="critical">
              <s-text>
                The offer is live but the offer-ready email has not reached the
                customer{offerEmail?.error ? `: ${offerEmail.error}` : ""}. They
                have no idea it is waiting, and the hold is already running.
              </s-text>
            </s-banner>
            <Form method="post">
              <input type="hidden" name="intent" value="resend-offer-email" />
              <s-button variant="primary" type="submit">
                Send the offer email again
              </s-button>
            </Form>
          </s-stack>
        )}
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
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
    <Form method="post">
      <s-stack direction="block" gap="base">
        <input type="hidden" name="intent" value="send-offer" />
        <input type="hidden" name="expirationDays" value={expirationDays} />
        <s-paragraph>
          Choose how long the customer has to review and accept this offer.
        </s-paragraph>
        <s-stack direction="inline" gap="small">
          {EXPIRATION_OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              onClick={() => setExpirationDays(option.days)}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid #c9cccf",
                background: expirationDays === option.days ? "#008060" : "#fff",
                color: expirationDays === option.days ? "#fff" : "inherit",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          ))}
        </s-stack>
        <s-button variant="primary" type="submit" {...(sending ? { loading: true } : {})}>
          Send Offer
        </s-button>
      </s-stack>
    </Form>
  );
}

function DeclinedExactPlantsSection({
  requestId,
  items,
}: {
  requestId: string;
  items: Awaited<ReturnType<typeof listExactPlantCandidates>>;
}) {
  const returnTo = `/app/requests/${requestId}`;
  return (
    <s-section heading="Declined exact plants">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          These plants were marked Available, offered as exact plants, and
          rejected by the customer. Review a listing before any Shopify product
          is created. Not Available items are not included.
        </s-text>
        {items.length === 0 ? (
          <s-text color="subdued">No declined exact plants on this request.</s-text>
        ) : (
          items.map((item) => {
            const listed =
              item.listing?.status === "listed" && item.listing.shopifyProductGid;
            return (
              <s-box
                key={item.requestItemId}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>{item.title}</s-heading>
                  <s-text>
                    {formatCurrency(item.price)} · {item.weightLbs} lb
                  </s-text>
                  {item.listing?.status === "failed" && item.listing.lastError ? (
                    <s-banner tone="critical">
                      <s-text>{item.listing.lastError}</s-text>
                    </s-banner>
                  ) : null}
                  {listed ? (
                    <s-stack direction="inline" gap="base">
                      <s-badge tone="success">Listed in EXACT PLANTS</s-badge>
                      {item.listing?.productAdminUrl ? (
                        <s-link href={item.listing.productAdminUrl} target="_blank">
                          Open Shopify product
                        </s-link>
                      ) : null}
                    </s-stack>
                  ) : (
                    <s-link
                      href={`/app/exact-plants/${item.requestItemId}?returnTo=${encodeURIComponent(returnTo)}`}
                    >
                      Create EXACT PLANTS Listing
                    </s-link>
                  )}
                </s-stack>
              </s-box>
            );
          })
        )}
      </s-stack>
    </s-section>
  );
}

/**
 * A draft order is only ever created from the customer's own submission, and
 * re-submitting an answered offer is refused, so a Shopify failure at that
 * moment left an accepted request with no way to pay. This is the way back.
 */
function PaymentLinkSection({ paymentLink }: { paymentLink: string | null }) {
  if (paymentLink) {
    return (
      <s-stack direction="block" gap="small">
        <s-text color="subdued">Payment link</s-text>
        <s-link href={paymentLink}>{paymentLink}</s-link>
      </s-stack>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      <s-banner tone="critical">
        <s-text>
          This customer accepted plants but no Shopify draft order exists, so
          they have no way to pay. Create the payment link and email it to them.
        </s-text>
      </s-banner>
      <Form method="post">
        <input type="hidden" name="intent" value="create-payment-link" />
        <s-button variant="primary" type="submit">
          Create payment link and email it
        </s-button>
      </Form>
    </s-stack>
  );
}

function CustomerResponseSection({
  response,
  status,
  paymentLink,
}: {
  response: Awaited<ReturnType<typeof getCustomerResponse>>;
  status: RequestStatus;
  paymentLink: string | null;
}) {
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

  return (
    <s-section heading="Customer response">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Customer response timestamp</s-text>
            <s-text>{response.respondedAt}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">FedEx upgrade</s-text>
            <s-text>
              {response.hasAcceptedPurchasableItems && response.fedexUpgradeSelected
                ? `Selected (${formatCurrency(response.fedexUpgradePrice)})`
                : response.hasAcceptedPurchasableItems
                  ? "Removed"
                  : "Not applicable"}
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Current request status</s-text>
            <s-badge tone={requestStatusTone(status)}>{status}</s-badge>
          </s-stack>
        </s-stack>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>Accepted Items</s-heading>
            {accepted.length === 0 ? (
              <s-text color="subdued">None</s-text>
            ) : (
              accepted.map((item) => (
                <s-text key={item.offerItemId}>
                  {item.plantName} — {formatCurrency(item.price)}
                </s-text>
              ))
            )}
            {accepted.length > 0 ? (
              <PaymentLinkSection paymentLink={paymentLink} />
            ) : null}
          </s-stack>
        </s-box>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>Rejected Items</s-heading>
            {rejected.length === 0 ? (
              <s-text color="subdued">None</s-text>
            ) : (
              rejected.map((item) => (
                <s-text key={item.offerItemId}>
                  {item.plantName} — {formatCurrency(item.price)}
                </s-text>
              ))
            )}
          </s-stack>
        </s-box>
      </s-stack>
    </s-section>
  );
}

export default function RequestDetail() {
  const { plantRequest, response, emails, paymentLink, declinedExactPlants } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  // The action already returned these; without this the page silently ignored a
  // failed photo upload and looked as though nothing had happened.
  const actionError = actionData && !actionData.ok ? actionData.error : null;

  useEffect(() => {
    const onFocus = () => revalidator.revalidate();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [revalidator]);

  if (!plantRequest) {
    return (
      <s-page heading="Request not found">
        <s-link slot="breadcrumb-actions" href="/app">
          Dashboard
        </s-link>
        <s-section>
          <s-text>This request could not be loaded.</s-text>
        </s-section>
      </s-page>
    );
  }

  const canEditItems = plantRequest.status === "New";

  return (
    <s-page heading={`Request ${getDisplayRequestNumber(plantRequest)}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>

      {actionError ? (
        <s-section>
          <s-banner tone="critical">
            <s-text>{actionError}</s-text>
          </s-banner>
        </s-section>
      ) : null}

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
        {!canEditItems && (
          <s-banner tone="info">
            <s-text>
              This request is read-only because its status is {plantRequest.status}.
              Customer-facing notes, photos, names, and prices are frozen in the
              offer snapshot.
            </s-text>
          </s-banner>
        )}
        <s-stack direction="block" gap="base">
          {plantRequest.items.map((item) => (
            <PlantItemCard key={item.id} item={item} canEdit={canEditItems} />
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Send Offer">
        <SendOfferSection
          status={plantRequest.status}
          sentOffer={plantRequest.sentOffer}
          offerEmail={emails.find((email) => email.templateKey === "offer_ready")}
        />
      </s-section>

      <CustomerResponseSection
        response={response}
        status={plantRequest.status}
        paymentLink={paymentLink}
      />

      <EmailSection emails={emails} />

      <DeclinedExactPlantsSection
        requestId={plantRequest.id}
        items={declinedExactPlants}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
