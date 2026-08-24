import type { LoaderFunctionArgs } from "react-router";

import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();
  return Response.json({ ok: true, shop: auth.shop });
};
