import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";
import {
  listPropagationPlanning,
  savePropagationPlanningNotes,
  setPropagationPlanningDone,
} from "../lib/propagation-planning.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const payload = await listPropagationPlanning(
    auth.shop,
    new URL(request.url).searchParams,
  );
  return Response.json(payload);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const intent = String(body.intent || "");
  const groupKey = String(body.groupKey || "").trim();

  if (!groupKey) {
    return Response.json({ ok: false, error: "Missing group key." }, { status: 400 });
  }

  try {
    if (intent === "set-done") {
      await setPropagationPlanningDone(auth.shop, groupKey, true);
      return Response.json({ ok: true });
    }
    if (intent === "undo-done") {
      await setPropagationPlanningDone(auth.shop, groupKey, false);
      return Response.json({ ok: true });
    }
    if (intent === "save-notes") {
      await savePropagationPlanningNotes(
        auth.shop,
        groupKey,
        String(body.propNotes ?? ""),
      );
      return Response.json({ ok: true });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update propagation planning.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }

  return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
};
