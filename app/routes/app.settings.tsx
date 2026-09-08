import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { countRegisteredPushDevices } from "../lib/admin-push.server";
import {
  createAdminMobileToken,
  listAdminMobileTokens,
  revokeAdminMobileToken,
} from "../lib/admin-mobile-auth.server";
import { requireAdmin } from "../lib/admin-auth.server";
import { missingProductionSecrets } from "../lib/environment.server";
import {
  DEFAULT_FEDEX_REMOVAL_WARNING,
  FEDEX_PRODUCT_SKU,
  HEAT_PACK_PRODUCT_SKU,
} from "../lib/portal";
import { getShopSettings, updateShopSettings } from "../lib/portal.server";
import { ensureShopSeeded } from "../lib/seed-demo.server";
import { themeFieldStyle, themePrimaryButtonStyle } from "../components/theme";
import { THEME } from "../lib/theme";
import { parseSettingsIntent } from "../lib/action-origin";

function logSettingsAction(
  fields: Record<string, string | string[] | boolean | number>,
) {
  console.info(`[settings-action] ${JSON.stringify(fields)}`);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const settings = await getShopSettings(shop);
  const mobileTokens = await listAdminMobileTokens(shop);
  const registeredPushDevices = await countRegisteredPushDevices(shop);
  return {
    fedexRemovalWarning: settings.fedexRemovalWarning,
    adminNotificationEmail: settings.adminNotificationEmail,
    adminEmailNewRequest: settings.adminEmailNewRequest,
    adminEmailCustomerResponse: settings.adminEmailCustomerResponse,
    adminEmailPaymentAfterVoid: settings.adminEmailPaymentAfterVoid,
    adminPushNewRequest: settings.adminPushNewRequest,
    adminPushItemStatusUpdate: settings.adminPushItemStatusUpdate,
    registeredPushDevices,
    fedexProductHandle: settings.fedexProductHandle,
    heatPackAddonEnabled: settings.heatPackAddonEnabled,
    heatPackProductHandle: settings.heatPackProductHandle,
    missingSecrets: missingProductionSecrets(),
    mobileTokens: mobileTokens.map((token) => ({
      id: token.id,
      label: token.label,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  logSettingsAction({ reached: true });
  let shop: string;
  try {
    ({ shop } = await requireAdmin(request));
  } catch (error) {
    logSettingsAction({
      auth: error instanceof Response ? `response-${error.status}` : "threw",
    });
    throw error;
  }
  logSettingsAction({ shop, auth: "ok" });

  const form = await request.formData();
  const formKeys = [...form.keys()];
  const { intent, known } = parseSettingsIntent(form.get("intent"));
  logSettingsAction({ shop, formKeys, intent, known });

  if (!known) {
    logSettingsAction({ shop, intent, branch: "unknown-intent", status: 400 });
    return new Response("Unknown settings action.", { status: 400 });
  }

  if (intent === "create-mobile-token") {
    logSettingsAction({ shop, branch: "create-mobile-token", insert: "start" });
    try {
      const created = await createAdminMobileToken(
        shop,
        String(form.get("mobileTokenLabel") || ""),
      );
      logSettingsAction({
        shop,
        branch: "create-mobile-token",
        insert: "ok",
        tokenId: created.record.id,
      });
      return {
        saved: false,
        reset: false,
        newMobileToken: { label: created.record.label, token: created.token },
      };
    } catch {
      logSettingsAction({ shop, branch: "create-mobile-token", insert: "failed" });
      return {
        saved: false,
        reset: false,
        mobileTokenError: "Could not create a device token. Try again.",
      };
    }
  }

  if (intent === "revoke-mobile-token") {
    logSettingsAction({ shop, branch: "revoke-mobile-token" });
    await revokeAdminMobileToken(shop, String(form.get("tokenId") || ""));
    return { saved: false, reset: false, revokedMobileToken: true };
  }

  if (intent === "reset") {
    await updateShopSettings(shop, {
      fedexRemovalWarning: DEFAULT_FEDEX_REMOVAL_WARNING,
    });
    return { saved: true, reset: true, section: "fedex" as const };
  }

  if (intent === "save-heat-pack-addon") {
    await updateShopSettings(shop, {
      heatPackAddonEnabled: form.get("heatPackAddonEnabled") === "on",
    });
    return { saved: true, reset: false, section: "heat-pack" as const };
  }

  if (intent === "save-admin-emails") {
    await updateShopSettings(shop, {
      adminNotificationEmail: String(form.get("adminNotificationEmail") || ""),
      adminEmailNewRequest: form.get("adminEmailNewRequest") === "on",
      adminEmailCustomerResponse: form.get("adminEmailCustomerResponse") === "on",
      adminEmailPaymentAfterVoid: form.get("adminEmailPaymentAfterVoid") === "on",
    });
    return { saved: true, reset: false, section: "emails" as const };
  }

  if (intent === "save-admin-push") {
    await updateShopSettings(shop, {
      adminPushNewRequest: form.get("adminPushNewRequest") === "on",
      adminPushItemStatusUpdate: form.get("adminPushItemStatusUpdate") === "on",
    });
    return { saved: true, reset: false, section: "push" as const };
  }

  await updateShopSettings(shop, {
    fedexRemovalWarning: String(form.get("fedexRemovalWarning") || ""),
    ...(form.has("adminNotificationEmail")
      ? { adminNotificationEmail: String(form.get("adminNotificationEmail") || "") }
      : {}),
  });
  return { saved: true, reset: false, section: "fedex" as const };
};

export default function Settings() {
  const settings = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent = String(navigation.formData?.get("intent") || "");
  const creatingToken =
    navigation.state !== "idle" && submittingIntent === "create-mobile-token";
  const createdToken =
    actionData && "newMobileToken" in actionData && actionData.newMobileToken
      ? actionData.newMobileToken
      : null;
  const mobileTokenError =
    actionData && "mobileTokenError" in actionData && actionData.mobileTokenError
      ? actionData.mobileTokenError
      : null;
  const savingFedex =
    navigation.state !== "idle" && submittingIntent === "save";
  const savingEmails =
    navigation.state !== "idle" && submittingIntent === "save-admin-emails";
  const savingPush =
    navigation.state !== "idle" && submittingIntent === "save-admin-push";
  const savingHeatPack =
    navigation.state !== "idle" && submittingIntent === "save-heat-pack-addon";
  const [draft, setDraft] = useState(settings.fedexRemovalWarning);
  const [adminEmail, setAdminEmail] = useState(settings.adminNotificationEmail);
  const [emailNewRequest, setEmailNewRequest] = useState(settings.adminEmailNewRequest);
  const [emailCustomerResponse, setEmailCustomerResponse] = useState(
    settings.adminEmailCustomerResponse,
  );
  const [emailPaymentAfterVoid, setEmailPaymentAfterVoid] = useState(
    settings.adminEmailPaymentAfterVoid,
  );
  const [pushNewRequest, setPushNewRequest] = useState(settings.adminPushNewRequest);
  const [pushItemStatus, setPushItemStatus] = useState(
    settings.adminPushItemStatusUpdate,
  );
  const [heatPackAddonEnabled, setHeatPackAddonEnabled] = useState(
    settings.heatPackAddonEnabled,
  );

  useEffect(() => {
    setDraft(settings.fedexRemovalWarning);
    setAdminEmail(settings.adminNotificationEmail);
    setEmailNewRequest(settings.adminEmailNewRequest);
    setEmailCustomerResponse(settings.adminEmailCustomerResponse);
    setEmailPaymentAfterVoid(settings.adminEmailPaymentAfterVoid);
    setPushNewRequest(settings.adminPushNewRequest);
    setPushItemStatus(settings.adminPushItemStatusUpdate);
    setHeatPackAddonEnabled(settings.heatPackAddonEnabled);
  }, [
    settings.adminEmailCustomerResponse,
    settings.adminEmailNewRequest,
    settings.adminEmailPaymentAfterVoid,
    settings.adminNotificationEmail,
    settings.adminPushItemStatusUpdate,
    settings.adminPushNewRequest,
    settings.heatPackAddonEnabled,
    settings.fedexRemovalWarning,
  ]);

  return (
    <s-page heading="Settings">
      {actionData?.saved && (
        <s-banner tone="success">
          <s-text>
            {actionData.reset
              ? "FedEx warning message reset to the default."
              : actionData.section === "emails"
                ? "Email notifications saved."
                : actionData.section === "push"
                  ? "iOS push notifications saved."
                  : actionData.section === "heat-pack"
                    ? "Heat Pack add-on setting saved."
                    : "Settings saved."}
          </s-text>
        </s-banner>
      )}

      {settings.missingSecrets.length > 0 ? (
        <s-section heading="Setup required">
          <s-stack direction="block" gap="base">
            <s-banner tone="warning">
              <s-text>
                {settings.missingSecrets.length} environment variable
                {settings.missingSecrets.length === 1 ? " is" : "s are"} not
                configured. Some parts of the portal will not work until they are
                set.
              </s-text>
            </s-banner>
            {settings.missingSecrets.map((secret) => (
              <s-box
                key={secret.name}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>{secret.name}</s-heading>
                  <s-text color="subdued">{secret.reason}</s-text>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Customer offer — FedEx upgrade warning">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            This message is shown to customers when they try to remove the FedEx
            Priority Overnight upgrade on their offer page.
          </s-paragraph>
          <s-text color="subdued">
            FedEx listing SKU: {FEDEX_PRODUCT_SKU} (handle fallback:{" "}
            {settings.fedexProductHandle})
          </s-text>

          <Form method="post">
            <s-stack direction="block" gap="base">
              <input type="hidden" name="intent" value="save" />
              <label htmlFor="fedex-removal-warning">
                <s-text color="subdued">Warning message</s-text>
              </label>
              <textarea
                id="fedex-removal-warning"
                name="fedexRemovalWarning"
                rows={6}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                style={{
                  width: "100%",
                  maxWidth: "640px",
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid #c9cccf",
                  font: "inherit",
                  lineHeight: 1.5,
                  resize: "vertical",
                }}
              />
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  type="submit"
                  {...(savingFedex ? { loading: true } : {})}
                >
                  Save settings
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="reset" />
            <s-button variant="secondary" type="submit">
              Reset warning to default
            </s-button>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Customer offer — Heat Pack add-on">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            When enabled, customers who accept plants must choose whether to add
            a seasonal heat pack to their order.
          </s-paragraph>
          <s-text color="subdued">
            Heat Pack listing SKU: {HEAT_PACK_PRODUCT_SKU} (handle fallback:{" "}
            {settings.heatPackProductHandle})
          </s-text>
          <Form method="post">
            <s-stack direction="block" gap="base">
              <input type="hidden" name="intent" value="save-heat-pack-addon" />
              <label
                htmlFor="heat-pack-addon-enabled"
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <input
                  id="heat-pack-addon-enabled"
                  type="checkbox"
                  name="heatPackAddonEnabled"
                  checked={heatPackAddonEnabled}
                  onChange={(event) =>
                    setHeatPackAddonEnabled(event.currentTarget.checked)
                  }
                />
                <s-text>Heat Pack Add-On enabled</s-text>
              </label>
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  type="submit"
                  {...(savingHeatPack ? { loading: true } : {})}
                >
                  Save Heat Pack setting
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Admin Email Notifications">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Choose which portal emails reach the admin notification address.
            Turning a type off does not stop the underlying request, offer, or
            payment action. Shopify compliance emails and the customer&apos;s
            own request/offer emails are not controlled here.
          </s-paragraph>
          <Form method="post">
            <s-stack direction="block" gap="base">
              <input type="hidden" name="intent" value="save-admin-emails" />
              <s-text-field
                name="adminNotificationEmail"
                label="Admin notification email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.currentTarget.value)}
              />
              <label
                htmlFor="admin-email-new-request"
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <input
                  id="admin-email-new-request"
                  type="checkbox"
                  name="adminEmailNewRequest"
                  checked={emailNewRequest}
                  onChange={(event) => setEmailNewRequest(event.currentTarget.checked)}
                />
                <s-text>New request submitted</s-text>
              </label>
              <label
                htmlFor="admin-email-customer-response"
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <input
                  id="admin-email-customer-response"
                  type="checkbox"
                  name="adminEmailCustomerResponse"
                  checked={emailCustomerResponse}
                  onChange={(event) =>
                    setEmailCustomerResponse(event.currentTarget.checked)
                  }
                />
                <s-text>Customer responded to an offer</s-text>
              </label>
              <label
                htmlFor="admin-email-payment-after-void"
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <input
                  id="admin-email-payment-after-void"
                  type="checkbox"
                  name="adminEmailPaymentAfterVoid"
                  checked={emailPaymentAfterVoid}
                  onChange={(event) =>
                    setEmailPaymentAfterVoid(event.currentTarget.checked)
                  }
                />
                <s-text>Important payment/conflict alerts</s-text>
              </label>
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  type="submit"
                  {...(savingEmails ? { loading: true } : {})}
                >
                  Save email notifications
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="iOS Push Notifications">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Separate from admin emails. These reach authorized iPhone admin
            devices that have allowed notifications. Turning a type off does
            not stop the underlying request or Accept/Reject.
          </s-paragraph>
          <s-text color="subdued">
            {settings.registeredPushDevices === 0
              ? "No iOS admin device is currently registered for push notifications."
              : settings.registeredPushDevices === 1
                ? "1 iOS admin device is registered for push notifications."
                : `${settings.registeredPushDevices} iOS admin devices are registered for push notifications.`}
          </s-text>
          <Form method="post">
            <s-stack direction="block" gap="base">
              <input type="hidden" name="intent" value="save-admin-push" />
              <label
                htmlFor="admin-push-new-request"
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <input
                  id="admin-push-new-request"
                  type="checkbox"
                  name="adminPushNewRequest"
                  checked={pushNewRequest}
                  onChange={(event) => setPushNewRequest(event.currentTarget.checked)}
                />
                <s-text>New Request</s-text>
              </label>
              <label
                htmlFor="admin-push-item-status"
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <input
                  id="admin-push-item-status"
                  type="checkbox"
                  name="adminPushItemStatusUpdate"
                  checked={pushItemStatus}
                  onChange={(event) => setPushItemStatus(event.currentTarget.checked)}
                />
                <s-text>Item Status Update</s-text>
              </label>
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  type="submit"
                  {...(savingPush ? { loading: true } : {})}
                >
                  Save push notifications
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="iOS admin app">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            The iPhone app signs in with a device token from this page — not
            your Shopify password. Create a token, paste it once in the app,
            then keep this page for revoke if a phone is lost.
          </s-paragraph>
          {createdToken ? (
            <div
              data-created-mobile-token-box
              style={{
                padding: 16,
                borderRadius: 8,
                border: "1px solid #8a6116",
                background: "#fff8e1",
              }}
            >
              <p style={{ margin: "0 0 8px" }}>
                Copy this token now. It will not be shown again.
              </p>
              <p style={{ margin: "0 0 8px" }}>{createdToken.label}</p>
              <p
                data-created-mobile-token
                style={{
                  margin: 0,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  wordBreak: "break-all",
                  userSelect: "all",
                }}
              >
                {createdToken.token}
              </p>
            </div>
          ) : null}
          {mobileTokenError ? (
            <s-banner tone="critical">
              <s-text>{mobileTokenError}</s-text>
            </s-banner>
          ) : null}
          {actionData &&
          "revokedMobileToken" in actionData &&
          actionData.revokedMobileToken ? (
            <s-banner tone="success">
              <s-text>Device token revoked. That phone can no longer sign in.</s-text>
            </s-banner>
          ) : null}
          <Form method="post" data-create-mobile-token>
            <s-stack direction="block" gap="base">
              <input type="hidden" name="intent" value="create-mobile-token" />
              <label htmlFor="mobile-token-label">
                <s-text>Device name</s-text>
              </label>
              <input
                id="mobile-token-label"
                name="mobileTokenLabel"
                type="text"
                placeholder="iPhone"
                autoComplete="off"
                maxLength={80}
                style={themeFieldStyle}
              />
              <button
                type="submit"
                disabled={creatingToken}
                style={{
                  ...themePrimaryButtonStyle,
                  width: "auto",
                  minWidth: 200,
                  opacity: creatingToken ? 0.7 : 1,
                  cursor: creatingToken ? "wait" : "pointer",
                  background: THEME.darkGreen,
                  color: THEME.white,
                }}
              >
                {creatingToken ? "Creating…" : "Create device token"}
              </button>
            </s-stack>
          </Form>
          {settings.mobileTokens.length === 0 ? (
            <s-text color="subdued">No active device tokens.</s-text>
          ) : (
            <s-stack direction="block" gap="small">
              {settings.mobileTokens.map((token) => (
                <s-box
                  key={token.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="small">
                    <s-heading>{token.label}</s-heading>
                    <s-text color="subdued">
                      Created {token.createdAt}
                      {token.lastUsedAt ? ` · Last used ${token.lastUsedAt}` : ""}
                    </s-text>
                    <Form method="post">
                      <input type="hidden" name="intent" value="revoke-mobile-token" />
                      <input type="hidden" name="tokenId" value={token.id} />
                      <s-button variant="secondary" type="submit" tone="critical">
                        Revoke
                      </s-button>
                    </Form>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
