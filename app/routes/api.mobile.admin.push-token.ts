import type { ActionFunctionArgs } from "react-router";

import { registerDeviceExpoPushToken } from "../lib/admin-push.server";
import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const expoPushToken = String(body.expoPushToken || "");
  const result = await registerDeviceExpoPushToken({
    shop: auth.shop,
    tokenId: auth.tokenId,
    expoPushToken,
  });
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 400 });
  }
  return Response.json({ ok: true });
};
