import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";
import { DEFAULT_FEDEX_REMOVAL_WARNING, FEDEX_PRODUCT_SKU } from "../lib/portal";
import { getShopSettings, updateShopSettings } from "../lib/portal.server";

function settingsPayload(
  settings: Awaited<ReturnType<typeof getShopSettings>>,
) {
  return {
    fedexRemovalWarning: settings.fedexRemovalWarning,
    adminNotificationEmail: settings.adminNotificationEmail,
    fedexProductHandle: settings.fedexProductHandle,
    fedexProductSku: FEDEX_PRODUCT_SKU,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  return Response.json(settingsPayload(await getShopSettings(auth.shop)));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const intent = String(body.intent || "save");

  if (intent === "reset") {
    const settings = await updateShopSettings(auth.shop, {
      fedexRemovalWarning: DEFAULT_FEDEX_REMOVAL_WARNING,
    });
    return Response.json({ ok: true, reset: true, ...settingsPayload(settings) });
  }

  if (intent !== "save") {
    return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  const settings = await updateShopSettings(auth.shop, {
    fedexRemovalWarning: String(body.fedexRemovalWarning ?? ""),
    adminNotificationEmail: String(body.adminNotificationEmail ?? ""),
  });
  return Response.json({ ok: true, reset: false, ...settingsPayload(settings) });
};
