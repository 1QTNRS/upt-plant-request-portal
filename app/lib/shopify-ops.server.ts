import type { AdminContext } from "./admin-auth.server";
import {
  declinedItemTag,
  EXACT_PLANTS_COLLECTION_TITLE,
  isOnlineStorePublicationTitle,
  isPosPublicationTitle,
  buildExactPlantProductCreateInput,
} from "./exact-plants";
import { canStubShopifyWrites, requireAdminClient } from "./environment.server";
import {
  buildDraftOrderLineItems,
  FEDEX_PRODUCT_HANDLE,
  plantRevenueFromLines,
  type DraftOrderLineItem,
} from "./portal";
import {
  getDraftOrder,
  getShopSettings,
  parseDraftOrderLineItems,
  saveDraftOrderReference,
  updateShopSettings,
} from "./portal.server";

type GraphqlClient = NonNullable<AdminContext["admin"]>;

async function adminGraphql<T>(
  admin: GraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  if (!json.data) {
    throw new Error("Shopify Admin API returned no data.");
  }
  return json.data;
}

export async function resolveFedexVariant(
  admin: GraphqlClient | undefined,
  shop: string,
): Promise<{ variantGid?: string; price: number }> {
  const settings = await getShopSettings(shop);
  if (!admin) {
    return { variantGid: settings.fedexVariantGid ?? undefined, price: settings.fedexUpgradePrice };
  }

  const data = await adminGraphql<{
    productByHandle: {
      variants: { nodes: Array<{ id: string; price: string }> };
    } | null;
  }>(
    admin,
    `#graphql
      query FedexUpgradeProduct($handle: String!) {
        productByHandle(handle: $handle) {
          variants(first: 1) {
            nodes { id price }
          }
        }
      }
    `,
    { handle: settings.fedexProductHandle || FEDEX_PRODUCT_HANDLE },
  );

  const variant = data.productByHandle?.variants.nodes[0];
  if (variant) {
    await updateShopSettings(shop, { fedexVariantGid: variant.id });
    return { variantGid: variant.id, price: Number.parseFloat(variant.price) || settings.fedexUpgradePrice };
  }

  return { variantGid: settings.fedexVariantGid ?? undefined, price: settings.fedexUpgradePrice };
}

export function draftOrderIdempotencyTag(requestId: string): string {
  return `upt-request:${requestId}`;
}

/**
 * Recovers a draft order that Shopify already created for this request. Covers
 * the window where `draftOrderCreate` succeeded but the reply never reached us,
 * so a retry would otherwise bill the customer twice.
 */
async function findDraftOrderByRequestTag(
  admin: GraphqlClient,
  requestId: string,
): Promise<{ id: string; invoiceUrl: string | null } | null> {
  const data = await adminGraphql<{
    draftOrders: { nodes: Array<{ id: string; invoiceUrl: string | null }> };
  }>(
    admin,
    `#graphql
      query PlantRequestDraftOrderByTag($query: String!) {
        draftOrders(first: 1, query: $query) {
          nodes { id invoiceUrl }
        }
      }
    `,
    { query: `tag:'${draftOrderIdempotencyTag(requestId)}'` },
  );
  return data.draftOrders.nodes[0] ?? null;
}

export async function createDraftOrderForRequest(
  admin: GraphqlClient | undefined,
  shop: string,
  input: {
    requestId: string;
    requestNumber: string;
    customerEmail: string;
    acceptedItems: Array<{
      plantName: string;
      quantity: number;
      price: number;
      weightLbs: number;
    }>;
    fedexSelected: boolean;
  },
): Promise<{ invoiceUrl: string; shopifyDraftOrderGid?: string; lineItems: DraftOrderLineItem[] }> {
  // A draft order already recorded for this request is authoritative. Never
  // create a second one.
  const recorded = await getDraftOrder(shop, input.requestId);
  if (recorded?.shopifyDraftOrderGid && recorded.invoiceUrl) {
    return {
      invoiceUrl: recorded.invoiceUrl,
      shopifyDraftOrderGid: recorded.shopifyDraftOrderGid,
      lineItems: parseDraftOrderLineItems(recorded.lineItemsJson),
    };
  }

  const settings = await getShopSettings(shop);
  const fedex = input.fedexSelected
    ? await resolveFedexVariant(admin, shop)
    : { price: settings.fedexUpgradePrice };

  const lineItems = buildDraftOrderLineItems({
    acceptedItems: input.acceptedItems,
    fedexSelected: input.fedexSelected,
    fedexLabel: settings.fedexUpgradeLabel,
    fedexPrice: fedex.price,
  });

  if (lineItems.length === 0) {
    throw new Error("Cannot create a draft order with no accepted plant items.");
  }

  requireAdminClient(admin, shop, "Creating a Shopify draft order");

  let shopifyDraftOrderGid: string | undefined;
  let invoiceUrl: string | undefined;

  if (admin) {
    const existing = await findDraftOrderByRequestTag(admin, input.requestId);
    if (existing) {
      shopifyDraftOrderGid = existing.id;
      invoiceUrl = existing.invoiceUrl ?? undefined;
    } else {
      const draftInput = {
        email: input.customerEmail,
        note: `UPT plant request ${input.requestNumber}`,
        tags: [
          "upt-plant-request",
          input.requestNumber,
          draftOrderIdempotencyTag(input.requestId),
        ],
        lineItems: lineItems.map((line) => {
          if (line.kind === "fedex" && fedex.variantGid) {
            return { variantId: fedex.variantGid, quantity: 1 };
          }
          return {
            title: line.title,
            originalUnitPrice: line.price.toFixed(2),
            quantity: line.quantity,
            weight: { value: line.weightLbs, unit: "POUNDS" },
          };
        }),
      };

      const created = await adminGraphql<{
        draftOrderCreate: {
          draftOrder: { id: string; invoiceUrl: string | null } | null;
          userErrors: Array<{ field: string[] | null; message: string }>;
        };
      }>(
        admin,
        `#graphql
          mutation CreatePlantRequestDraftOrder($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder { id invoiceUrl }
              userErrors { field message }
            }
          }
        `,
        { input: draftInput },
      );

      const errors = created.draftOrderCreate.userErrors;
      if (errors.length > 0) {
        throw new Error(errors.map((error) => error.message).join("; "));
      }

      shopifyDraftOrderGid = created.draftOrderCreate.draftOrder?.id;
      invoiceUrl = created.draftOrderCreate.draftOrder?.invoiceUrl ?? undefined;

      if (shopifyDraftOrderGid) {
        await adminGraphql(
          admin,
          `#graphql
            mutation SendPlantRequestInvoice($id: ID!) {
              draftOrderInvoiceSend(id: $id) {
                draftOrder { id }
                userErrors { message }
              }
            }
          `,
          { id: shopifyDraftOrderGid },
        );
      }
    }
  }

  if (!invoiceUrl) {
    if (!canStubShopifyWrites(shop)) {
      throw new Error(
        "Shopify did not return a checkout link for this draft order. The customer's selections were saved; retry once the Admin API is reachable.",
      );
    }
    invoiceUrl = `/customer/requests/${input.requestId}?checkout=pending`;
  }

  await saveDraftOrderReference(shop, input.requestId, {
    shopifyDraftOrderGid,
    invoiceUrl,
    lineItems,
  });

  return { invoiceUrl, shopifyDraftOrderGid, lineItems };
}

export { plantRevenueFromLines };

const FILE_CREATE_MUTATION = `#graphql
  mutation CreatePlantPhoto($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        ... on MediaImage {
          id
          image { url }
        }
      }
      userErrors { message }
    }
  }
`;

const STAGED_UPLOADS_MUTATION = `#graphql
  mutation StagedPlantPhotoUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

export async function uploadPlantPhoto(
  admin: GraphqlClient | undefined,
  shop: string,
  file: { filename: string; mimeType: string; data: Buffer },
): Promise<{ url: string; shopifyFileId?: string }> {
  requireAdminClient(admin, shop, "Uploading a plant photo to Shopify Files");

  if (!admin) {
    // Demo shop only. A base64 data URL keeps the local walkthrough working but
    // would bloat the database and break Shopify product media in production.
    const encoded = `data:${file.mimeType};base64,${file.data.toString("base64")}`;
    return { url: encoded };
  }

  const staged = await adminGraphql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ message: string }>;
    };
  }>(admin, STAGED_UPLOADS_MUTATION, {
    input: [
      {
        filename: file.filename,
        mimeType: file.mimeType,
        httpMethod: "POST",
        resource: "FILE",
      },
    ],
  });

  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) {
    throw new Error(
      staged.stagedUploadsCreate.userErrors.map((error) => error.message).join("; ") ||
        "Shopify staged upload failed.",
    );
  }

  const form = new FormData();
  for (const parameter of target.parameters) {
    form.append(parameter.name, parameter.value);
  }
  form.append(
    "file",
    new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
    file.filename,
  );
  const uploadResponse = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    throw new Error("Failed to upload plant photo to Shopify staged target.");
  }

  const created = await adminGraphql<{
    fileCreate: {
      files: Array<{ id?: string; image?: { url?: string } } | null>;
      userErrors: Array<{ message: string }>;
    };
  }>(admin, FILE_CREATE_MUTATION, {
    files: [
      {
        alt: file.filename,
        contentType: "IMAGE",
        originalSource: target.resourceUrl,
      },
    ],
  });

  const uploaded = created.fileCreate.files[0];
  const url = uploaded?.image?.url;
  if (!url) {
    throw new Error(
      created.fileCreate.userErrors.map((error) => error.message).join("; ") ||
        "Shopify fileCreate returned no image URL.",
    );
  }

  return { url, shopifyFileId: uploaded?.id };
}

function userErrorMessage(
  errors: Array<{ message: string }> | undefined,
  fallback: string,
): string {
  const message = errors?.map((error) => error.message).filter(Boolean).join("; ");
  return message || fallback;
}

export async function findExactPlantProductByItemTag(
  admin: GraphqlClient,
  requestItemId: string,
): Promise<{ id: string; handle: string } | null> {
  const tag = declinedItemTag(requestItemId);
  const data = await adminGraphql<{
    products: { nodes: Array<{ id: string; handle: string }> };
  }>(
    admin,
    `#graphql
      query ExactPlantProductByTag($query: String!) {
        products(first: 1, query: $query) {
          nodes { id handle }
        }
      }
    `,
    { query: `tag:${tag}` },
  );
  return data.products.nodes[0] ?? null;
}

export async function findOrCreateExactPlantsCollection(
  admin: GraphqlClient,
): Promise<{ id: string; title: string; handle: string }> {
  const existing = await adminGraphql<{
    collections: {
      nodes: Array<{ id: string; title: string; handle: string }>;
    };
  }>(
    admin,
    `#graphql
      query ExactPlantsCollection($query: String!) {
        collections(first: 5, query: $query) {
          nodes { id title handle }
        }
      }
    `,
    { query: `title:'${EXACT_PLANTS_COLLECTION_TITLE}'` },
  );

  const match = existing.collections.nodes.find(
    (collection) =>
      collection.title.trim().toLowerCase() ===
      EXACT_PLANTS_COLLECTION_TITLE.toLowerCase(),
  );
  if (match) return match;

  const created = await adminGraphql<{
    collectionCreate: {
      collection: { id: string; title: string; handle: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation CreateExactPlantsCollection($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection { id title handle }
          userErrors { message }
        }
      }
    `,
    { input: { title: EXACT_PLANTS_COLLECTION_TITLE } },
  );

  const collection = created.collectionCreate.collection;
  if (!collection) {
    throw new Error(
      userErrorMessage(
        created.collectionCreate.userErrors,
        "Could not find or create the EXACT PLANTS collection.",
      ),
    );
  }
  return collection;
}

async function addProductToCollection(
  admin: GraphqlClient,
  collectionId: string,
  productId: string,
): Promise<void> {
  const result = await adminGraphql<{
    collectionAddProducts: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation AddExactPlantToCollection($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          userErrors { message }
        }
      }
    `,
    { id: collectionId, productIds: [productId] },
  );
  const errors = result.collectionAddProducts.userErrors.filter(
    (error) => !/already/i.test(error.message),
  );
  if (errors.length > 0) {
    throw new Error(userErrorMessage(errors, "Could not add the product to EXACT PLANTS."));
  }
}

export async function resolveOnlineStoreAndPosPublications(
  admin: GraphqlClient,
): Promise<{ onlineStoreId: string; posId: string }> {
  const data = await adminGraphql<{
    publications: {
      nodes: Array<{
        id: string;
        catalog?: { title?: string | null } | null;
      }>;
    };
  }>(
    admin,
    `#graphql
      query SalesChannelPublications {
        publications(first: 50) {
          nodes {
            id
            catalog { title }
          }
        }
      }
    `,
  );

  let onlineStoreId: string | undefined;
  let posId: string | undefined;
  for (const publication of data.publications.nodes) {
    const title = publication.catalog?.title ?? "";
    if (!onlineStoreId && isOnlineStorePublicationTitle(title)) {
      onlineStoreId = publication.id;
    }
    if (!posId && isPosPublicationTitle(title)) {
      posId = publication.id;
    }
  }

  if (!onlineStoreId || !posId) {
    const missing = [
      !onlineStoreId ? "Online Store" : null,
      !posId ? "POS" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `Could not find the ${missing} sales channel publication. Re-approve the app with read_publications and write_publications.`,
    );
  }

  return { onlineStoreId, posId };
}

async function publishProductToOnlineStoreAndPos(
  admin: GraphqlClient,
  productId: string,
): Promise<void> {
  const { onlineStoreId, posId } = await resolveOnlineStoreAndPosPublications(admin);
  const result = await adminGraphql<{
    publishablePublish: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation PublishExactPlant($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { message }
        }
      }
    `,
    {
      id: productId,
      input: [{ publicationId: onlineStoreId }, { publicationId: posId }],
    },
  );
  if (result.publishablePublish.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        result.publishablePublish.userErrors,
        "Could not publish the product to Online Store and POS.",
      ),
    );
  }
}

async function setExactPlantVariantPriceAndWeight(
  admin: GraphqlClient,
  productId: string,
  variantId: string,
  price: number,
  weightLbs: number,
): Promise<void> {
  const result = await adminGraphql<{
    productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation UpdateExactPlantVariant(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { message }
        }
      }
    `,
    {
      productId,
      variants: [
        {
          id: variantId,
          price: price.toFixed(2),
          inventoryItem: {
            measurement: {
              weight: { value: weightLbs, unit: "POUNDS" },
            },
          },
        },
      ],
    },
  );
  if (result.productVariantsBulkUpdate.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        result.productVariantsBulkUpdate.userErrors,
        "Could not set the exact plant price and weight.",
      ),
    );
  }
}

export async function createExactPlantShopifyProduct(
  admin: GraphqlClient,
  input: {
    requestItemId: string;
    title: string;
    price: number;
    weightLbs: number;
    photoUrls: string[];
  },
): Promise<{ productGid: string; handle: string; collectionGid: string }> {
  const existing = await findExactPlantProductByItemTag(admin, input.requestItemId);
  const collection = await findOrCreateExactPlantsCollection(admin);

  if (existing) {
    await addProductToCollection(admin, collection.id, existing.id);
    await publishProductToOnlineStoreAndPos(admin, existing.id);
    return {
      productGid: existing.id,
      handle: existing.handle,
      collectionGid: collection.id,
    };
  }

  const created = await adminGraphql<{
    productCreate: {
      product: {
        id: string;
        handle: string;
        variants: { nodes: Array<{ id: string }> };
      } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation CreateExactPlantProduct(
        $product: ProductCreateInput!
        $media: [CreateMediaInput!]
      ) {
        productCreate(product: $product, media: $media) {
          product {
            id
            handle
            variants(first: 1) { nodes { id } }
          }
          userErrors { message }
        }
      }
    `,
    buildExactPlantProductCreateInput({
      requestItemId: input.requestItemId,
      title: input.title,
      photoUrls: input.photoUrls,
      collectionId: collection.id,
    }),
  );

  const product = created.productCreate.product;
  if (!product) {
    throw new Error(
      userErrorMessage(
        created.productCreate.userErrors,
        "Shopify productCreate returned no product.",
      ),
    );
  }

  const variantId = product.variants.nodes[0]?.id;
  if (variantId) {
    await setExactPlantVariantPriceAndWeight(
      admin,
      product.id,
      variantId,
      input.price,
      input.weightLbs,
    );
  }

  await addProductToCollection(admin, collection.id, product.id);
  await publishProductToOnlineStoreAndPos(admin, product.id);

  return {
    productGid: product.id,
    handle: product.handle,
    collectionGid: collection.id,
  };
}

