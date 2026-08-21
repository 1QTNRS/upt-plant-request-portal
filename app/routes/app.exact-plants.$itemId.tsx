import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import {
  createExactPlantListing,
  ExactPlantListingError,
  getExactPlantReview,
} from "../lib/exact-plants.server";
import { formatCurrency } from "../lib/portal";
import { EXACT_PLANT_RELEASE_LABELS } from "../lib/exact-plants";

const inputStyle = {
  width: "100%",
  maxWidth: "420px",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
} as const;

const buttonStyle = {
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  background: "#fff",
  font: "inherit",
  cursor: "pointer",
} as const;

function safeReturnTo(value: string | null): string {
  if (value && value.startsWith("/app")) return value;
  return "/app/exact-plants";
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const itemId = params.itemId ?? "";
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));

  try {
    const review = await getExactPlantReview(shop, itemId);
    return { ok: true as const, review, returnTo, error: null as string | null };
  } catch (error) {
    const message =
      error instanceof ExactPlantListingError
        ? error.message
        : "This declined exact plant could not be loaded.";
    return { ok: false as const, review: null, returnTo, error: message };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop, admin } = await requireAdmin(request);
  const itemId = params.itemId ?? "";
  const form = await request.formData();
  const returnTo = safeReturnTo(String(form.get("returnTo") || ""));

  if (String(form.get("intent")) !== "create-listing") {
    return { error: "Unknown action." };
  }

  try {
    await createExactPlantListing(admin, shop, {
      requestItemId: itemId,
      title: String(form.get("title") || ""),
      price: Number.parseFloat(String(form.get("price") || "0")),
      weightLbs: Number.parseFloat(String(form.get("weightLbs") || "0")),
      photoUrls: form.getAll("photoUrl").map((value) => String(value)),
    });
    throw redirect(returnTo);
  } catch (error) {
    if (error instanceof Response) throw error;
    const message =
      error instanceof ExactPlantListingError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Listing creation failed.";
    return { error: message };
  }
};

export default function ExactPlantListingReview() {
  const { ok, review, returnTo, error } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [title, setTitle] = useState(review?.draft.title ?? "");
  const [price, setPrice] = useState(String(review?.draft.price ?? 0));
  const [weightLbs, setWeightLbs] = useState(String(review?.draft.weightLbs ?? 0));
  const [photoUrls, setPhotoUrls] = useState(review?.draft.photoUrls ?? []);

  useEffect(() => {
    if (!review) return;
    setTitle(review.draft.title);
    setPrice(String(review.draft.price));
    setWeightLbs(String(review.draft.weightLbs));
    setPhotoUrls(review.draft.photoUrls);
  }, [review]);

  if (!ok || !review) {
    return (
      <s-page heading="Create EXACT PLANTS listing">
        <s-link slot="breadcrumb-actions" href={returnTo}>
          Back
        </s-link>
        <s-section>
          <s-banner tone="critical">
            <s-text>{error}</s-text>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  const listed = review.listing?.status === "listed" && review.listing.shopifyProductGid;
  const submitting = navigation.state !== "idle";
  const formError = actionData?.error ?? review.listing?.lastError;

  if (listed) {
    return (
      <s-page heading="Listed in EXACT PLANTS">
        <s-link slot="breadcrumb-actions" href={returnTo}>
          Back
        </s-link>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>{review.draft.title}</s-text>
            <s-text>
              {formatCurrency(review.draft.price)} · {review.draft.weightLbs} lb
            </s-text>
            {review.listing?.productAdminUrl ? (
              <s-link href={review.listing.productAdminUrl} target="_blank">
                Open Shopify product
              </s-link>
            ) : null}
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Create EXACT PLANTS listing">
      <s-link slot="breadcrumb-actions" href={returnTo}>
        Back
      </s-link>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small">
            <s-badge>{EXACT_PLANT_RELEASE_LABELS[review.releaseReason]}</s-badge>
          </s-stack>
          <s-banner tone="info">
            <s-text>
              Review and edit this exact plant before creating a Shopify product.
              Nothing is published until you approve. Customer notes, identity,
              and request details are not included.
            </s-text>
          </s-banner>
        </s-stack>
      </s-section>

      {formError ? (
        <s-section>
          <s-banner tone="critical">
            <s-text>{formError}</s-text>
          </s-banner>
        </s-section>
      ) : null}

      <Form method="post">
        <input type="hidden" name="intent" value="create-listing" />
        <input type="hidden" name="returnTo" value={returnTo} />
        {photoUrls.map((url) => (
          <input key={url} type="hidden" name="photoUrl" value={url} />
        ))}

        <s-section heading="Listing details">
          <s-stack direction="block" gap="base">
            <label>
              <s-text>Product title</s-text>
              <input
                name="title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                required
                style={{ ...inputStyle, display: "block", marginTop: "8px" }}
              />
            </label>
            <label>
              <s-text>Price</s-text>
              <input
                name="price"
                type="number"
                min={0}
                step={0.01}
                value={price}
                onChange={(event) => setPrice(event.currentTarget.value)}
                required
                style={{ ...inputStyle, display: "block", marginTop: "8px" }}
              />
            </label>
            <label>
              <s-text>Weight (lb)</s-text>
              <input
                name="weightLbs"
                type="number"
                min={0}
                step={0.1}
                value={weightLbs}
                onChange={(event) => setWeightLbs(event.currentTarget.value)}
                required
                style={{ ...inputStyle, display: "block", marginTop: "8px" }}
              />
            </label>
          </s-stack>
        </s-section>

        <s-section heading="Exact plant photos">
          {photoUrls.length === 0 ? (
            <s-text color="subdued">No photos selected. You can still create the listing.</s-text>
          ) : (
            <s-stack direction="block" gap="base">
              {photoUrls.map((url, index) => (
                <s-box
                  key={`${url}-${index}`}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="inline" gap="base">
                    <img
                      src={url}
                      alt={`Exact plant ${index + 1}`}
                      style={{
                        width: "96px",
                        height: "96px",
                        objectFit: "cover",
                        borderRadius: "8px",
                      }}
                    />
                    <s-stack direction="block" gap="small">
                      <s-text>Photo {index + 1}</s-text>
                      <s-stack direction="inline" gap="small">
                        <button
                          type="button"
                          style={buttonStyle}
                          disabled={index === 0}
                          onClick={() =>
                            setPhotoUrls((current) => {
                              if (index === 0) return current;
                              const next = [...current];
                              [next[index - 1], next[index]] = [next[index], next[index - 1]];
                              return next;
                            })
                          }
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          style={buttonStyle}
                          disabled={index === photoUrls.length - 1}
                          onClick={() =>
                            setPhotoUrls((current) => {
                              if (index >= current.length - 1) return current;
                              const next = [...current];
                              [next[index + 1], next[index]] = [next[index], next[index + 1]];
                              return next;
                            })
                          }
                        >
                          Move down
                        </button>
                        <button
                          type="button"
                          style={buttonStyle}
                          onClick={() =>
                            setPhotoUrls((current) =>
                              current.filter((_, photoIndex) => photoIndex !== index),
                            )
                          }
                        >
                          Remove
                        </button>
                      </s-stack>
                    </s-stack>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-section>

        <s-section>
          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              type="submit"
              {...(submitting ? { loading: true } : {})}
            >
              {review.listing?.status === "failed"
                ? "Retry EXACT PLANTS listing"
                : "Approve and create listing"}
            </s-button>
            <s-link href={returnTo}>Cancel</s-link>
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
