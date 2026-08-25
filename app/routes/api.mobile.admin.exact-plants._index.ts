import type { LoaderFunctionArgs } from "react-router";

import { mobileAdminExactPlantsPayload } from "../lib/admin-mobile-api";
import {
  authenticateAdminMobile,
  unauthorizedMobileResponse,
} from "../lib/admin-mobile-auth.server";
import {
  listDismissedExactPlants,
  listExactPlantCandidates,
} from "../lib/exact-plants.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdminMobile(request);
  if (!auth) return unauthorizedMobileResponse();

  const [items, dismissed] = await Promise.all([
    listExactPlantCandidates(auth.shop),
    listDismissedExactPlants(auth.shop),
  ]);
  return Response.json(
    mobileAdminExactPlantsPayload(
      items,
      dismissed,
      new URL(request.url).searchParams.get("listing"),
    ),
  );
};
