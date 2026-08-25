import {
  toMobileExactPlantReview,
  type MobileExactPlantReview,
} from "./admin-mobile-api";
import {
  createExactPlantListing,
  dismissExactPlantFromQueue,
  ExactPlantListingError,
  getExactPlantReview,
} from "./exact-plants.server";
import { offlineAdminClient } from "./offline-admin.server";

export type MobileExactPlantActionResult = {
  ok: boolean;
  error?: string;
  pendingDismiss?: boolean;
  listed?: boolean;
  review?: MobileExactPlantReview;
};

function asString(body: Record<string, unknown>, key: string): string {
  return String(body[key] ?? "");
}

export async function loadMobileExactPlantReview(
  shop: string,
  requestItemId: string,
): Promise<MobileExactPlantReview> {
  return toMobileExactPlantReview(await getExactPlantReview(shop, requestItemId));
}

/**
 * Review / approve / dismiss through the same `exact-plants.server` functions
 * the website uses. The phone never talks to Shopify.
 */
export async function handleMobileExactPlantAction(input: {
  shop: string;
  requestItemId: string;
  fields: Record<string, unknown>;
}): Promise<MobileExactPlantActionResult> {
  const intent = asString(input.fields, "intent");

  try {
    if (intent === "dismiss-exact-plant") {
      const result = await dismissExactPlantFromQueue({
        shop: input.shop,
        requestItemId: input.requestItemId,
        confirmed: asString(input.fields, "confirmed") === "true",
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          pendingDismiss: Boolean(result.pendingDismiss),
        };
      }
      return { ok: true };
    }

    if (intent !== "create-listing") {
      return { ok: false, error: "Unknown action." };
    }

    const photoUrls = Array.isArray(input.fields.photoUrls)
      ? input.fields.photoUrls.map((value) => String(value))
      : typeof input.fields.photoUrl === "string"
        ? [input.fields.photoUrl]
        : [];

    const admin = await offlineAdminClient(input.shop);
    await createExactPlantListing(admin, input.shop, {
      requestItemId: input.requestItemId,
      title: asString(input.fields, "title"),
      price: Number.parseFloat(asString(input.fields, "price") || "0"),
      weightLbs: Number.parseFloat(asString(input.fields, "weightLbs") || "0"),
      photoUrls,
    });
    return {
      ok: true,
      listed: true,
      review: await loadMobileExactPlantReview(input.shop, input.requestItemId),
    };
  } catch (error) {
    const message =
      error instanceof ExactPlantListingError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Listing creation failed.";
    return { ok: false, error: message };
  }
}
