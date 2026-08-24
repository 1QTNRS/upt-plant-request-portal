import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  handleMobileAdminRequestAction,
  loadMobileAdminRequestDetail,
  readMobileAdminActionBody,
} from "../lib/admin-mobile-actions.server";
import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";
import { markRequestViewed } from "../lib/portal.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const requestId = params.id ?? "";
  const detail = await loadMobileAdminRequestDetail(auth.shop, requestId);
  if (!detail) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  await markRequestViewed(auth.shop, detail.id);
  return Response.json(detail);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const requestId = params.id ?? "";
  const existing = await loadMobileAdminRequestDetail(auth.shop, requestId);
  if (!existing) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { fields, photo } = await readMobileAdminActionBody(request);
  const result = await handleMobileAdminRequestAction({
    shop: auth.shop,
    requestId,
    origin: new URL(request.url).origin,
    fields,
    photo,
  });
  return Response.json(result, {
    status: result.error === "Unknown action." ? 400 : 200,
  });
};
