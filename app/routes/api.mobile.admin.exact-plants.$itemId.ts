import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { readMobileAdminActionBody } from "../lib/admin-mobile-actions.server";
import {
  handleMobileExactPlantAction,
  loadMobileExactPlantReview,
} from "../lib/admin-mobile-exact-plants.server";
import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";
import { ExactPlantListingError } from "../lib/exact-plants.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  try {
    return Response.json(
      await loadMobileExactPlantReview(auth.shop, params.itemId ?? ""),
    );
  } catch (error) {
    const message =
      error instanceof ExactPlantListingError
        ? error.message
        : "This declined exact plant could not be loaded.";
    return Response.json({ error: message }, { status: 404 });
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const { fields } = await readMobileAdminActionBody(request);
  const result = await handleMobileExactPlantAction({
    shop: auth.shop,
    requestItemId: params.itemId ?? "",
    fields,
  });
  return Response.json(result, {
    status: result.error === "Unknown action." ? 400 : 200,
  });
};
