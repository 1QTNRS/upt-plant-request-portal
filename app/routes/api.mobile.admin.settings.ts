import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";
import { countRegisteredPushDevices } from "../lib/admin-push.server";
import { DEFAULT_FEDEX_REMOVAL_WARNING, FEDEX_PRODUCT_SKU } from "../lib/portal";
import { getShopSettings, updateShopSettings } from "../lib/portal.server";

function asOptionalBool(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

async function settingsPayload(
  settings: Awaited<ReturnType<typeof getShopSettings>>,
) {
  return {
    fedexRemovalWarning: settings.fedexRemovalWarning,
    adminNotificationEmail: settings.adminNotificationEmail,
    adminEmailNewRequest: settings.adminEmailNewRequest,
    adminEmailCustomerResponse: settings.adminEmailCustomerResponse,
    adminEmailPaymentAfterVoid: settings.adminEmailPaymentAfterVoid,
    adminPushNewRequest: settings.adminPushNewRequest,
    adminPushItemStatusUpdate: settings.adminPushItemStatusUpdate,
    registeredPushDevices: await countRegisteredPushDevices(settings.shop),
    fedexProductHandle: settings.fedexProductHandle,
    fedexProductSku: FEDEX_PRODUCT_SKU,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  return Response.json(await settingsPayload(await getShopSettings(auth.shop)));
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
    return Response.json({
      ok: true,
      reset: true,
      ...(await settingsPayload(settings)),
    });
  }

  if (intent === "save-admin-push") {
    const settings = await updateShopSettings(auth.shop, {
      adminPushNewRequest: asOptionalBool(body.adminPushNewRequest),
      adminPushItemStatusUpdate: asOptionalBool(body.adminPushItemStatusUpdate),
    });
    return Response.json({
      ok: true,
      reset: false,
      ...(await settingsPayload(settings)),
    });
  }

  if (intent !== "save") {
    return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  const settings = await updateShopSettings(auth.shop, {
    fedexRemovalWarning: String(body.fedexRemovalWarning ?? ""),
    adminNotificationEmail: String(body.adminNotificationEmail ?? ""),
    adminEmailNewRequest: asOptionalBool(body.adminEmailNewRequest),
    adminEmailCustomerResponse: asOptionalBool(body.adminEmailCustomerResponse),
    adminEmailPaymentAfterVoid: asOptionalBool(body.adminEmailPaymentAfterVoid),
  });
  return Response.json({
    ok: true,
    reset: false,
    ...(await settingsPayload(settings)),
  });
};
