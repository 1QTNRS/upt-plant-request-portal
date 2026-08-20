import type { AdminContext } from "./admin-auth.server";
import {
  buildDraftOrderLineItems,
  FEDEX_PRODUCT_HANDLE,
  plantRevenueFromLines,
  type DraftOrderLineItem,
} from "./portal";
import {
  getShopSettings,
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

  let shopifyDraftOrderGid: string | undefined;
  let invoiceUrl: string | undefined;

  if (admin) {
    const draftInput = {
      email: input.customerEmail,
      note: `UPT plant request ${input.requestNumber}`,
      tags: ["upt-plant-request", input.requestNumber],
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

  if (!invoiceUrl) {
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
  file: { filename: string; mimeType: string; data: Buffer },
): Promise<{ url: string; shopifyFileId?: string }> {
  if (!admin) {
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
