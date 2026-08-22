import type { AdminContext } from "./admin-auth.server";
import { customerLinksForShop } from "./customer-links.server";
import {
  buildExactPlantInventoryInput,
  buildExactPlantVariantInput,
  declinedItemTag,
  exactPlantMediaError,
  EXACT_PLANTS_COLLECTION_TITLE,
  isOnlineStorePublicationHandle,
  isPosPublicationHandle,
  ONLINE_STORE_APP_HANDLE,
  planExactPlantMedia,
  POS_APP_HANDLES,
  buildExactPlantProductCreateInput,
  type ExistingProductMedia,
} from "./exact-plants";
import { canStubShopifyWrites, requireAdminClient } from "./environment.server";
import {
  buildDraftOrderInput,
  buildDraftOrderLineItems,
  draftOrderIdempotencyTag,
  FEDEX_PRODUCT_HANDLE,
  plantRevenueFromLines,
  tagSearchQuery,
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
    productByIdentifier: {
      variants: { nodes: Array<{ id: string; price: string }> };
    } | null;
  }>(
    admin,
    `#graphql
      query FedexUpgradeProduct($identifier: ProductIdentifierInput!) {
        productByIdentifier(identifier: $identifier) {
          variants(first: 1) {
            nodes { id price }
          }
        }
      }
    `,
    {
      identifier: { handle: settings.fedexProductHandle || FEDEX_PRODUCT_HANDLE },
    },
  );

  const variant = data.productByIdentifier?.variants.nodes[0];
  if (variant) {
    const price = Number.parseFloat(variant.price) || settings.fedexUpgradePrice;
    // The stored price is what the offer quotes, the confirmation email states
    // and the response snapshot freezes. Nothing else ever wrote it, so it sat
    // at its default of 15 while Shopify billed the live variant price.
    await updateShopSettings(shop, {
      fedexVariantGid: variant.id,
      fedexUpgradePrice: price,
    });
    return { variantGid: variant.id, price };
  }

  return { variantGid: settings.fedexVariantGid ?? undefined, price: settings.fedexUpgradePrice };
}

/**
 * Brings the stored FedEx upgrade price back in line with Shopify before an
 * offer freezes it.
 *
 * Best effort: quoting a stale price is bad, but refusing to send the offer at
 * all because Shopify is unreachable is worse.
 */
export async function refreshFedexUpgradePrice(
  admin: GraphqlClient | undefined,
  shop: string,
): Promise<void> {
  if (!admin) return;
  try {
    await resolveFedexVariant(admin, shop);
  } catch (error) {
    console.error(
      `Could not refresh the FedEx upgrade price for ${shop}; the offer will quote the stored price.`,
      error,
    );
  }
}

/**
 * Custom draft-order line items need an explicit currency, so the store's
 * currency has to be read before prices can be set. Cached per process because
 * a store's currency effectively never changes.
 */
const shopCurrencyCache = new Map<string, string>();

export async function resolveShopCurrency(
  admin: GraphqlClient,
  shop: string,
): Promise<string> {
  const cached = shopCurrencyCache.get(shop);
  if (cached) return cached;

  const data = await adminGraphql<{ shop: { currencyCode: string } }>(
    admin,
    `#graphql
      query PortalShopCurrency {
        shop { currencyCode }
      }
    `,
  );
  shopCurrencyCache.set(shop, data.shop.currencyCode);
  return data.shop.currencyCode;
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
    { query: tagSearchQuery(draftOrderIdempotencyTag(requestId)) },
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
    /** The upgrade price frozen into the customer's response. */
    fedexPrice?: number;
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
    fedexPrice: input.fedexPrice ?? fedex.price,
  });

  if (lineItems.length === 0) {
    throw new Error("Cannot create a draft order with no accepted plant items.");
  }

  requireAdminClient(admin, shop, "Creating a Shopify draft order");

  let shopifyDraftOrderGid: string | undefined;
  let invoiceUrl: string | undefined;

  if (admin) {
    // Shopify may already hold a draft order for this request if an earlier
    // attempt's reply never reached us. Reusing it is what stops a retry from
    // billing the customer twice.
    const existing = await findDraftOrderByRequestTag(admin, input.requestId);
    if (existing) {
      shopifyDraftOrderGid = existing.id;
      invoiceUrl = existing.invoiceUrl ?? undefined;
    } else {
      const draftInput = buildDraftOrderInput({
        requestId: input.requestId,
        requestNumber: input.requestNumber,
        customerEmail: input.customerEmail,
        currencyCode: await resolveShopCurrency(admin, shop),
        lineItems,
        fedexVariantGid: fedex.variantGid,
      });

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
    }
  }

  if (!invoiceUrl) {
    // On a real shop a missing checkout link must not be papered over with a
    // placeholder the customer cannot pay.
    if (!canStubShopifyWrites(shop)) {
      throw new Error(
        "Shopify did not return a checkout link for this draft order. The customer's selections were saved; retry once the Admin API is reachable.",
      );
    }
    invoiceUrl = `${customerLinksForShop(shop).requestDetail(input.requestId)}?checkout=pending`;
  }

  // Recorded before the invoice is sent: the draft order already exists in
  // Shopify at this point, and losing the reference would let a retry create a
  // second one for the same request.
  await saveDraftOrderReference(shop, input.requestId, {
    shopifyDraftOrderGid,
    invoiceUrl,
    lineItems,
  });

  if (admin && shopifyDraftOrderGid) {
    await sendDraftOrderInvoice(admin, shopifyDraftOrderGid, input.requestNumber);
  }

  return { invoiceUrl, shopifyDraftOrderGid, lineItems };
}

/**
 * Asks Shopify to email its own invoice for the draft order.
 *
 * Best effort: the portal sends its own checkout email with the same invoice
 * URL, so a failure here is logged rather than thrown — it must not undo a
 * draft order the customer can already pay. The `userErrors` used to be
 * discarded entirely, which hid a store with invoice emails misconfigured.
 */
async function sendDraftOrderInvoice(
  admin: GraphqlClient,
  draftOrderGid: string,
  requestNumber: string,
): Promise<void> {
  try {
    const sent = await adminGraphql<{
      draftOrderInvoiceSend: {
        draftOrder: { id: string } | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>(
      admin,
      `#graphql
        mutation SendPlantRequestInvoice($id: ID!) {
          draftOrderInvoiceSend(id: $id) {
            draftOrder { id }
            userErrors { field message }
          }
        }
      `,
      { id: draftOrderGid },
    );

    const errors = sent.draftOrderInvoiceSend.userErrors;
    if (errors.length > 0) {
      console.error(
        `Shopify would not send the draft order invoice for ${requestNumber}: ${errors
          .map((error) => error.message)
          .join("; ")}`,
      );
    }
  } catch (error) {
    console.error(
      `Could not send the draft order invoice for ${requestNumber}.`,
      error,
    );
  }
}

export { plantRevenueFromLines };

const FILE_CREATE_MUTATION = `#graphql
  mutation CreatePlantPhoto($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        fileErrors { code message }
        ... on MediaImage {
          image { url }
        }
      }
      userErrors { field message }
    }
  }
`;

const FILE_STATUS_QUERY = `#graphql
  query PlantPhotoStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        fileStatus
        fileErrors { code message }
        image { url }
      }
    }
  }
`;

type ShopifyFileNode = {
  id: string;
  fileStatus: string;
  fileErrors: Array<{ code: string; message: string }>;
  image?: { url?: string | null } | null;
};

const FILE_READY_ATTEMPTS = 10;
const FILE_READY_DELAY_MS = 500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fileErrorMessage(file: ShopifyFileNode): string {
  const detail = file.fileErrors
    .map((error) => `${error.code}: ${error.message}`)
    .join("; ");
  return detail || "Shopify could not process the uploaded photo.";
}

/**
 * Waits for Shopify to finish processing an uploaded file.
 *
 * `fileCreate` returns immediately with `fileStatus: UPLOADED` and no CDN URL —
 * files are processed asynchronously. Reading `image.url` straight from the
 * mutation response therefore fails intermittently, which is what made photo
 * uploads fall back to local disk.
 */
async function waitForFileUrl(
  admin: GraphqlClient,
  file: ShopifyFileNode,
): Promise<{ url: string; shopifyFileId: string }> {
  let current = file;

  for (let attempt = 0; attempt < FILE_READY_ATTEMPTS; attempt += 1) {
    if (current.fileStatus === "FAILED") {
      throw new Error(fileErrorMessage(current));
    }
    const url = current.image?.url;
    if (current.fileStatus === "READY" && url) {
      return { url, shopifyFileId: current.id };
    }

    await wait(FILE_READY_DELAY_MS);
    const polled = await adminGraphql<{ node: ShopifyFileNode | null }>(
      admin,
      FILE_STATUS_QUERY,
      { id: current.id },
    );
    if (!polled.node) {
      throw new Error("Shopify lost track of the uploaded photo.");
    }
    current = polled.node;
  }

  const url = current.image?.url;
  if (url) return { url, shopifyFileId: current.id };
  throw new Error(
    `Shopify did not finish processing the photo (status ${current.fileStatus}).`,
  );
}

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
      files: Array<ShopifyFileNode | null>;
      userErrors: Array<{ field: string[] | null; message: string }>;
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

  if (created.fileCreate.userErrors.length > 0) {
    throw new Error(
      created.fileCreate.userErrors.map((error) => error.message).join("; "),
    );
  }

  const uploaded = created.fileCreate.files[0];
  if (!uploaded) {
    throw new Error("Shopify fileCreate returned no file.");
  }

  return waitForFileUrl(admin, uploaded);
}

function userErrorMessage(
  errors: Array<{ message: string }> | undefined,
  fallback: string,
): string {
  const message = errors?.map((error) => error.message).filter(Boolean).join("; ");
  return message || fallback;
}

type ExactPlantProduct = {
  id: string;
  handle: string;
  variantId?: string;
  inventoryItemId?: string;
};

export async function findExactPlantProductByItemTag(
  admin: GraphqlClient,
  requestItemId: string,
): Promise<ExactPlantProduct | null> {
  const tag = declinedItemTag(requestItemId);
  const data = await adminGraphql<{
    products: {
      nodes: Array<{
        id: string;
        handle: string;
        variants: {
          nodes: Array<{ id: string; inventoryItem: { id: string } }>;
        };
      }>;
    };
  }>(
    admin,
    `#graphql
      query ExactPlantProductByTag($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            handle
            variants(first: 1) {
              nodes {
                id
                inventoryItem { id }
              }
            }
          }
        }
      }
    `,
    { query: tagSearchQuery(tag) },
  );

  const product = data.products.nodes[0];
  if (!product) return null;
  const variant = product.variants.nodes[0];
  return {
    id: product.id,
    handle: product.handle,
    variantId: variant?.id,
    inventoryItemId: variant?.inventoryItem.id,
  };
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

/**
 * `catalogType: APP` is required: without it Shopify returns `catalog: null`
 * for every publication, so nothing ever matched and no listing could be
 * published.
 */
const PUBLICATIONS_QUERY = `#graphql
  query SalesChannelPublications($after: String) {
    publications(first: 50, after: $after, catalogType: APP) {
      nodes {
        id
        catalog {
          ... on AppCatalog {
            apps(first: 1) {
              nodes { handle }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function resolveOnlineStoreAndPosPublications(
  admin: GraphqlClient,
): Promise<{ onlineStoreId: string; posId: string }> {
  let onlineStoreId: string | undefined;
  let posId: string | undefined;
  let after: string | null = null;

  // A store with many channels and catalogs can push Online Store or POS past
  // the first page, and silently failing to publish is worse than a slow loop.
  do {
    const data: {
      publications: {
        nodes: Array<{
          id: string;
          catalog?: { apps?: { nodes: Array<{ handle?: string | null }> } } | null;
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await adminGraphql(admin, PUBLICATIONS_QUERY, { after });

    for (const publication of data.publications.nodes) {
      const handle = publication.catalog?.apps?.nodes[0]?.handle;
      if (!onlineStoreId && isOnlineStorePublicationHandle(handle)) {
        onlineStoreId = publication.id;
      }
      if (!posId && isPosPublicationHandle(handle)) {
        posId = publication.id;
      }
    }

    if (onlineStoreId && posId) break;
    after = data.publications.pageInfo.hasNextPage
      ? data.publications.pageInfo.endCursor
      : null;
  } while (after);

  if (!onlineStoreId || !posId) {
    const missing = [
      !onlineStoreId ? `Online Store (${ONLINE_STORE_APP_HANDLE})` : null,
      !posId ? `POS (${POS_APP_HANDLES.join(" or ")})` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `This store has no ${missing} sales channel publication. ` +
        "Add the sales channel to the store in Shopify admin under Settings > Apps and sales channels, then approve the listing again.",
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

  await unpublishExactPlantFromOtherChannels(admin, productId, [onlineStoreId, posId]);
}

/**
 * Removes the listing from any sales channel other than Online Store and POS.
 *
 * Publishing to two channels does not keep a product off the others: a channel
 * set to publish new products automatically picks it up on creation. On the
 * development store Shopify recorded "Product was included on Microsoft
 * Copilot" one second after `productCreate`, attributed to no app, on a product
 * this code had not published anywhere yet. An EXACT PLANTS listing is a single
 * physical plant, so an unintended channel is a place it can be sold twice.
 */
async function unpublishExactPlantFromOtherChannels(
  admin: GraphqlClient,
  productId: string,
  allowedPublicationIds: string[],
): Promise<void> {
  const allowed = new Set(allowedPublicationIds);
  // `resourcePublicationsV2` is the current field and it does not list every
  // channel: on the development store it reported only Online Store and Point
  // of Sale for a product that the deprecated `resourcePublications` — and the
  // store's own event log — showed was also on Microsoft Copilot. The
  // deprecated field is the one telling the truth, so it is the one to ask.
  const result = await adminGraphql<{
    product: {
      resourcePublications: {
        nodes: Array<{ publication: { id: string; catalog: { title: string | null } | null } | null }>;
      };
    } | null;
  }>(
    admin,
    `#graphql
      query ExactPlantPublications($id: ID!) {
        product(id: $id) {
          resourcePublications(first: 50) {
            nodes { publication { id catalog { title } } }
          }
        }
      }
    `,
    { id: productId },
  );

  const unwanted = (result.product?.resourcePublications.nodes ?? [])
    .flatMap((node) => (node.publication ? [node.publication] : []))
    .filter((publication) => !allowed.has(publication.id));
  if (unwanted.length === 0) return;

  const removed = await adminGraphql<{
    publishableUnpublish: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation UnpublishExactPlant($id: ID!, $input: [PublicationInput!]!) {
        publishableUnpublish(id: $id, input: $input) {
          userErrors { message }
        }
      }
    `,
    {
      id: productId,
      input: unwanted.map((publication) => ({ publicationId: publication.id })),
    },
  );

  if (removed.publishableUnpublish.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        removed.publishableUnpublish.userErrors,
        "Could not remove the product from other sales channels.",
      ),
    );
  }

  // Some channels accept the mutation, report no error, and stay published —
  // Microsoft Copilot did on the development store. The app cannot revoke those
  // per product, so the merchant has to turn off "automatically publish new
  // products" on the channel itself. Say which one, or nobody will ever know a
  // single physical plant is listed somewhere it can be sold again.
  console.warn(
    `Removed EXACT PLANTS product ${productId} from ${unwanted.length} unintended ` +
      `sales channel(s): ${unwanted
        .map((publication) => publication.catalog?.title ?? publication.id)
        .join(", ")}. If a listing keeps reappearing on one of these, turn off ` +
      `its "automatically publish new products" setting in the Shopify admin.`,
  );
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
      variants: [buildExactPlantVariantInput({ variantId, price, weightLbs })],
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

const INVENTORY_TARGET_QUERY = `#graphql
  query ExactPlantInventoryLocation {
    location { id }
  }
`;

const INVENTORY_LEVEL_QUERY = `#graphql
  query ExactPlantInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
    inventoryItem(id: $inventoryItemId) {
      inventoryLevel(locationId: $locationId) { id }
    }
  }
`;

const INVENTORY_ACTIVATE_MUTATION = `#graphql
  mutation ActivateExactPlantInventory($inventoryItemId: ID!, $locationId: ID!) {
    inventoryActivate(
      inventoryItemId: $inventoryItemId
      locationId: $locationId
      available: 1
    ) {
      userErrors { message }
    }
  }
`;

const INVENTORY_SET_MUTATION = `#graphql
  mutation StockExactPlant($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { message }
    }
  }
`;

/**
 * Puts exactly one of this plant in stock at the shop's primary location.
 *
 * An EXACT PLANTS listing is one specific physical plant, so without a tracked
 * quantity three customers can buy the same plant. `inventoryQuantities` on
 * `ProductVariantsBulkInput` is only honoured by `productVariantsBulkCreate`,
 * so the quantity needs its own call; which call depends on whether Shopify
 * has already stocked the item at that location.
 *
 * Only `Location.id` is read, which `write_inventory` covers — every other
 * Location field would additionally require `read_locations`.
 */
async function stockOneExactPlant(
  admin: GraphqlClient,
  inventoryItemId: string,
): Promise<void> {
  const target = await adminGraphql<{ location: { id: string } | null }>(
    admin,
    INVENTORY_TARGET_QUERY,
  );
  const locationId = target.location?.id;
  if (!locationId) {
    throw new Error(
      "This store has no primary location, so the exact plant cannot be stocked.",
    );
  }

  const level = await adminGraphql<{
    inventoryItem: { inventoryLevel: { id: string } | null } | null;
  }>(admin, INVENTORY_LEVEL_QUERY, { inventoryItemId, locationId });

  if (!level.inventoryItem?.inventoryLevel) {
    const activated = await adminGraphql<{
      inventoryActivate: { userErrors: Array<{ message: string }> };
    }>(admin, INVENTORY_ACTIVATE_MUTATION, { inventoryItemId, locationId });
    if (activated.inventoryActivate.userErrors.length > 0) {
      throw new Error(
        userErrorMessage(
          activated.inventoryActivate.userErrors,
          "Could not stock the exact plant at the store's primary location.",
        ),
      );
    }
    return;
  }

  const result = await adminGraphql<{
    inventorySetQuantities: { userErrors: Array<{ message: string }> };
  }>(admin, INVENTORY_SET_MUTATION, {
    input: buildExactPlantInventoryInput({ inventoryItemId, locationId }),
  });
  if (result.inventorySetQuantities.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        result.inventorySetQuantities.userErrors,
        "Could not set the exact plant stock to one.",
      ),
    );
  }
}

const PRODUCT_MEDIA_QUERY = `#graphql
  query ExactPlantProductMedia($id: ID!, $after: String) {
    product(id: $id) {
      media(first: 50, after: $after) {
        nodes {
          id
          ... on MediaImage {
            originalSource { url }
            image { url }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/**
 * `fileUpdate` is what 2025-10 offers in place of the deprecated
 * `productDeleteMedia`. It drops the product's reference to the image rather
 * than deleting the image, which is the safer of the two here: the photos come
 * from Shopify Files and a frozen offer snapshot still shows them to the
 * customer who was offered the plant.
 */
const DETACH_PRODUCT_MEDIA_MUTATION = `#graphql
  mutation DetachExactPlantMedia($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      userErrors { message }
    }
  }
`;

async function listExactPlantProductMedia(
  admin: GraphqlClient,
  productId: string,
): Promise<ExistingProductMedia[]> {
  const media: ExistingProductMedia[] = [];
  let after: string | null = null;

  // Paginated because a photo left off the last page would silently stay
  // published, which is the whole failure being fixed here.
  do {
    const data: {
      product: {
        media: {
          nodes: Array<{
            id: string;
            originalSource?: { url?: string | null } | null;
            image?: { url?: string | null } | null;
          }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    } = await adminGraphql(admin, PRODUCT_MEDIA_QUERY, { id: productId, after });

    if (!data.product) break;
    for (const node of data.product.media.nodes) {
      media.push({
        id: node.id,
        sourceUrl: node.originalSource?.url ?? null,
        imageUrl: node.image?.url ?? null,
      });
    }
    after = data.product.media.pageInfo.hasNextPage
      ? data.product.media.pageInfo.endCursor
      : null;
  } while (after);

  return media;
}

async function detachExactPlantMedia(
  admin: GraphqlClient,
  productId: string,
  mediaIds: string[],
): Promise<void> {
  const result = await adminGraphql<{
    fileUpdate: { userErrors: Array<{ message: string }> };
  }>(admin, DETACH_PRODUCT_MEDIA_MUTATION, {
    files: mediaIds.map((id) => ({ id, referencesToRemove: [productId] })),
  });
  if (result.fileUpdate.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        result.fileUpdate.userErrors,
        "Could not remove the photos the admin took off this EXACT PLANTS listing.",
      ),
    );
  }
}

/**
 * Applies the admin's approved title, price, weight and photos to an existing
 * product.
 *
 * The photos are the reason this exists: the review form lets the admin remove
 * and reorder them, and a retry that only sent the title left a photo the admin
 * had deliberately removed published on the store.
 */
async function updateExactPlantProduct(
  admin: GraphqlClient,
  product: ExactPlantProduct,
  input: {
    title: string;
    price: number;
    weightLbs: number;
    photoUrls: string[];
    appUrl?: string;
  },
): Promise<{ id: string; handle: string }> {
  const plan = planExactPlantMedia({
    existing: await listExactPlantProductMedia(admin, product.id),
    title: input.title,
    photoUrls: input.photoUrls,
    appUrl: input.appUrl,
  });

  const updated = await adminGraphql<{
    productUpdate: {
      product: { id: string; handle: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation UpdateExactPlantProduct(
        $product: ProductUpdateInput!
        $media: [CreateMediaInput!]
      ) {
        productUpdate(product: $product, media: $media) {
          product { id handle }
          userErrors { message }
        }
      }
    `,
    {
      product: { id: product.id, title: input.title },
      // Left off rather than sent empty, so Shopify sees no media argument at
      // all when the product already carries the approved photos.
      media: plan.create.length > 0 ? plan.create : undefined,
    },
  );

  if (updated.productUpdate.userErrors.length > 0) {
    throw new Error(
      userErrorMessage(
        updated.productUpdate.userErrors,
        "Could not update the existing EXACT PLANTS product.",
      ),
    );
  }

  if (plan.detachMediaIds.length > 0) {
    await detachExactPlantMedia(admin, product.id, plan.detachMediaIds);
  }

  await priceAndStockExactPlantVariant(admin, product, input);

  return updated.productUpdate.product ?? product;
}

/**
 * Prices the variant and puts one of it in stock.
 *
 * Both must happen before the product is published: publishing an untracked
 * plant lets several customers buy the same one, and publishing a tracked
 * plant that has not been stocked yet shows it as sold out.
 */
async function priceAndStockExactPlantVariant(
  admin: GraphqlClient,
  product: ExactPlantProduct,
  input: { price: number; weightLbs: number },
): Promise<void> {
  if (!product.variantId) return;
  await setExactPlantVariantPriceAndWeight(
    admin,
    product.id,
    product.variantId,
    input.price,
    input.weightLbs,
  );
  if (product.inventoryItemId) {
    await stockOneExactPlant(admin, product.inventoryItemId);
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
    appUrl?: string;
  },
  /**
   * Called the moment a product for this plant exists in Shopify, before
   * anything that could still fail. Everything after this point leaves a
   * product behind whether it succeeds or not, so the caller needs the chance
   * to record it.
   */
  onProductIdentified?: (product: {
    productGid: string;
    handle: string;
  }) => Promise<void>,
): Promise<{ productGid: string; handle: string; collectionGid: string }> {
  const mediaError = exactPlantMediaError(input.photoUrls, input.appUrl);
  if (mediaError) throw new Error(mediaError);

  const existing = await findExactPlantProductByItemTag(admin, input.requestItemId);
  if (existing) {
    await onProductIdentified?.({
      productGid: existing.id,
      handle: existing.handle,
    });

    // A retry after an edit on the review form must land the edited values on
    // the one product for this item rather than create a second one.
    const collection = await findOrCreateExactPlantsCollection(admin);
    const refreshed = await updateExactPlantProduct(admin, existing, input);
    await addProductToCollection(admin, collection.id, refreshed.id);
    await publishProductToOnlineStoreAndPos(admin, refreshed.id);
    return {
      productGid: refreshed.id,
      handle: refreshed.handle,
      collectionGid: collection.id,
    };
  }

  const collection = await findOrCreateExactPlantsCollection(admin);
  const created = await adminGraphql<{
    productCreate: {
      product: {
        id: string;
        handle: string;
        variants: {
          nodes: Array<{ id: string; inventoryItem: { id: string } }>;
        };
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
            variants(first: 1) {
              nodes {
                id
                inventoryItem { id }
              }
            }
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
      appUrl: input.appUrl,
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

  await onProductIdentified?.({ productGid: product.id, handle: product.handle });

  const variant = product.variants.nodes[0];
  await priceAndStockExactPlantVariant(
    admin,
    {
      id: product.id,
      handle: product.handle,
      variantId: variant?.id,
      inventoryItemId: variant?.inventoryItem.id,
    },
    input,
  );

  await addProductToCollection(admin, collection.id, product.id);
  await publishProductToOnlineStoreAndPos(admin, product.id);

  return {
    productGid: product.id,
    handle: product.handle,
    collectionGid: collection.id,
  };
}

