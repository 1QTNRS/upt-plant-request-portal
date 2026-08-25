import type { LoaderFunctionArgs } from "react-router";

import { mobileAdminDashboardPayload } from "../lib/admin-mobile-api";
import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";
import { listRequests } from "../lib/portal.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const search = new URL(request.url).searchParams;
  const requests = await listRequests(auth.shop);
  return Response.json(
    mobileAdminDashboardPayload(
      auth.shop,
      requests,
      search.get("q") ?? "",
      search.get("status"),
    ),
  );
};
