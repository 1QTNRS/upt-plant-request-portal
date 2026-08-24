import type { LoaderFunctionArgs } from "react-router";

import { toMobileAdminRequestDetail } from "../lib/admin-mobile-api";
import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";
import { getRequest, markRequestViewed } from "../lib/portal.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const requestId = params.id ?? "";
  const plantRequest = await getRequest(auth.shop, requestId);
  if (!plantRequest) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  await markRequestViewed(auth.shop, plantRequest.id);
  return Response.json(toMobileAdminRequestDetail(plantRequest));
};
