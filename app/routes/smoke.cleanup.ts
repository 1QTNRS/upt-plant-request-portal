import type { ActionFunctionArgs } from "react-router";

import { APPROVED_SMOKE_SHOP } from "../lib/pr-risk";
import { smokeAdminContext } from "../lib/smoke-auth.server";
import { cleanupSmokePortalData } from "../lib/smoke-cleanup.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "POST only." }, { status: 405 });
  }
  const smoke = smokeAdminContext(request);
  if (!smoke) {
    return Response.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }
  const result = await cleanupSmokePortalData(APPROVED_SMOKE_SHOP);
  return Response.json({ ok: true, ...result });
};
