import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  createAdminMobileToken,
  listAdminMobileTokens,
  revokeAdminMobileToken,
} from "../lib/admin-mobile-auth.server";
import { requireAdmin } from "../lib/admin-auth.server";
import { missingProductionSecrets } from "../lib/environment.server";
import { DEFAULT_FEDEX_REMOVAL_WARNING, FEDEX_PRODUCT_SKU } from "../lib/portal";
import { getShopSettings, updateShopSettings } from "../lib/portal.server";
import { ensureShopSeeded } from "../lib/seed-demo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  const settings = await getShopSettings(shop);
  const mobileTokens = await listAdminMobileTokens(shop);
  return {
    fedexRemovalWarning: settings.fedexRemovalWarning,
    adminNotificationEmail: settings.adminNotificationEmail,
    fedexProductHandle: settings.fedexProductHandle,
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
  const { shop } = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "save");

  if (intent === "create-mobile-token") {
    const created = await createAdminMobileToken(
      shop,
      String(form.get("mobileTokenLabel") || ""),
    );
    return {
      saved: false,
      reset: false,
      newMobileToken: { label: created.record.label, token: created.token },
    };
  }

  if (intent === "revoke-mobile-token") {
    await revokeAdminMobileToken(shop, String(form.get("tokenId") || ""));
    return { saved: false, reset: false, revokedMobileToken: true };
  }

  if (intent === "reset") {
    await updateShopSettings(shop, {
      fedexRemovalWarning: DEFAULT_FEDEX_REMOVAL_WARNING,
    });
    return { saved: true, reset: true };
  }

  await updateShopSettings(shop, {
    fedexRemovalWarning: String(form.get("fedexRemovalWarning") || ""),
    adminNotificationEmail: String(form.get("adminNotificationEmail") || ""),
  });
  return { saved: true, reset: false };
};

export default function Settings() {
  const settings = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [draft, setDraft] = useState(settings.fedexRemovalWarning);
  const [adminEmail, setAdminEmail] = useState(settings.adminNotificationEmail);

  useEffect(() => {
    setDraft(settings.fedexRemovalWarning);
    setAdminEmail(settings.adminNotificationEmail);
  }, [settings.adminNotificationEmail, settings.fedexRemovalWarning]);

  return (
    <s-page heading="Settings">
      {actionData?.saved && (
        <s-banner tone="success">
          <s-text>
            {actionData.reset
              ? "FedEx warning message reset to the default."
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
            Priority Overnight upgrade on their offer page. It is also included
            in the confirmation email and approval summary if the upgrade is
            removed.
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
              <s-text-field
                name="adminNotificationEmail"
                label="Admin notification email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.currentTarget.value)}
              />
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  type="submit"
                  {...(navigation.state !== "idle" ? { loading: true } : {})}
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

      <s-section heading="iOS admin app">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            The iPhone app signs in with a device token from this page — not
            your Shopify password. Create a token, paste it once in the app,
            then keep this page for revoke if a phone is lost.
          </s-paragraph>
          {actionData &&
          "newMobileToken" in actionData &&
          actionData.newMobileToken ? (
            <s-banner tone="warning">
              <s-stack direction="block" gap="small">
                <s-text>
                  Copy this token now. It will not be shown again.
                </s-text>
                <s-text>
                  {actionData.newMobileToken.label}:{" "}
                  <code>{actionData.newMobileToken.token}</code>
                </s-text>
              </s-stack>
            </s-banner>
          ) : null}
          {actionData &&
          "revokedMobileToken" in actionData &&
          actionData.revokedMobileToken ? (
            <s-banner tone="success">
              <s-text>Device token revoked. That phone can no longer sign in.</s-text>
            </s-banner>
          ) : null}
          <Form method="post">
            <s-stack direction="block" gap="base">
              <input type="hidden" name="intent" value="create-mobile-token" />
              <s-text-field
                name="mobileTokenLabel"
                label="Device name"
                placeholder="iPhone"
              />
              <s-button variant="primary" type="submit">
                Create device token
              </s-button>
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
