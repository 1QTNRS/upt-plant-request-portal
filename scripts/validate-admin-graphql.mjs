/**
 * Validates every `#graphql` document in the app against the real Shopify Admin
 * API schema for the version the app runs (`app/shopify.server.ts`).
 *
 * Shopify silently removes input fields between versions, and an invalid
 * document only fails at runtime against a live store — which cannot be
 * reached from CI or a dev sandbox. Running this catches those breaks early.
 *
 * Usage:
 *   node scripts/validate-admin-graphql.mjs [--version 2025-10] [--schema path.json]
 *   node scripts/validate-admin-graphql.mjs --write-schema schema/admin-2025-10.json
 *
 * Requires network access to https://shopify.dev unless --schema is given.
 */
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  buildClientSchema,
  coerceInputValue,
  getIntrospectionQuery,
  isInputObjectType,
  isListType,
  isNonNullType,
  parse,
  typeFromAST,
  parseType,
  validate,
} from "graphql";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schema",
  "admin-api-introspection.json",
);
const SCAN_DIRS = ["app"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);

function parseArgs(argv) {
  const args = { version: null, schema: null, writeSchema: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--version") args.version = argv[++i];
    else if (flag === "--schema") args.schema = argv[++i];
    else if (flag === "--write-schema") args.writeSchema = argv[++i] ?? DEFAULT_SCHEMA_PATH;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

async function resolveApiVersion() {
  const source = await readFile(
    path.join(REPO_ROOT, "app", "shopify.server.ts"),
    "utf8",
  );
  const match = source.match(/export const apiVersion = ApiVersion\.(\w+)/);
  if (!match) {
    throw new Error("Could not find `export const apiVersion` in app/shopify.server.ts");
  }
  const { ApiVersion } = await import(
    "@shopify/shopify-app-react-router/server"
  );
  const version = ApiVersion[match[1]];
  if (!version) {
    throw new Error(`ApiVersion.${match[1]} is not a known API version`);
  }
  return version;
}

async function fetchIntrospection(version) {
  const endpoint = `https://shopify.dev/admin-graphql-direct-proxy/${version}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Without this Shopify omits deprecated input fields entirely, so a payload
    // that uses one fails as "field is not defined by type" and the deprecation
    // check below can never fire.
    body: JSON.stringify({
      query: getIntrospectionQuery({ inputValueDeprecation: true }),
    }),
  });
  if (!response.ok) {
    throw new Error(`${endpoint} responded ${response.status}`);
  }
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }
  return body.data;
}

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "types") continue;
      files.push(...(await collectSourceFiles(full)));
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Pulls out `` `#graphql ... ` `` template literals. Documents with `${}`
 * interpolation are skipped because they are not statically analyzable.
 */
function extractDocuments(source, file) {
  const documents = [];
  const marker = "`#graphql";
  let index = source.indexOf(marker);
  while (index !== -1) {
    let cursor = index + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") cursor += 2;
      else if (source[cursor] === "`") break;
      else cursor += 1;
    }
    const body = source.slice(index + 1, cursor);
    const line = source.slice(0, index).split("\n").length;
    if (body.includes("${")) {
      documents.push({ file, line, body, interpolated: true });
    } else {
      documents.push({ file, line, body, interpolated: false });
    }
    index = source.indexOf(marker, cursor);
  }
  return documents;
}

/**
 * Sample variable payloads, built by the same pure functions the server uses.
 *
 * Document validation alone is not enough: `originalUnitPrice` shipped as a
 * valid `DraftOrderInput` document with a variable field Shopify had deprecated,
 * and only a live store would have complained.
 */
async function inputSamples() {
  const { buildDraftOrderInput, buildDraftOrderLineItems } = await import(
    "../app/lib/portal.ts"
  );
  const {
    buildExactPlantInventoryInput,
    buildExactPlantProductCreateInput,
    buildExactPlantVariantInput,
  } = await import("../app/lib/exact-plants.ts");

  const lineItems = buildDraftOrderLineItems({
    acceptedItems: [
      { plantName: "Monstera Thai Constellation", quantity: 1, price: 285, weightLbs: 4.5 },
    ],
    fedexSelected: true,
    fedexLabel: "FedEx Priority Overnight Upgrade",
    fedexPrice: 15,
  });

  const exactPlant = buildExactPlantProductCreateInput({
    requestItemId: "cm0itemid",
    title: "Monstera Thai Constellation",
    photoUrls: ["https://cdn.shopify.com/s/files/1/0/photo.jpg"],
    collectionId: "gid://shopify/Collection/1",
  });

  return [
    {
      label: "draftOrderCreate($input)",
      type: "DraftOrderInput!",
      value: buildDraftOrderInput({
        requestId: "cm0requestid",
        requestNumber: "REQ2178",
        customerEmail: "customer@example.com",
        currencyCode: "USD",
        lineItems,
        fedexVariantGid: "gid://shopify/ProductVariant/1",
      }),
    },
    {
      label: "draftOrderCreate($input) without a FedEx variant",
      type: "DraftOrderInput!",
      value: buildDraftOrderInput({
        requestId: "cm0requestid",
        requestNumber: "REQ2178",
        customerEmail: "customer@example.com",
        currencyCode: "USD",
        lineItems,
      }),
    },
    {
      label: "productCreate($product)",
      type: "ProductCreateInput!",
      value: exactPlant.product,
    },
    {
      label: "productCreate($media)",
      type: "[CreateMediaInput!]!",
      value: exactPlant.media,
    },
    {
      label: "productVariantsBulkUpdate($variants)",
      type: "[ProductVariantsBulkInput!]!",
      value: [
        buildExactPlantVariantInput({
          variantId: "gid://shopify/ProductVariant/1",
          price: 285,
          weightLbs: 4.5,
        }),
      ],
    },
    {
      label: "inventorySetQuantities($input)",
      type: "InventorySetQuantitiesInput!",
      // `ignoreCompareQuantity` is deprecated in 2025-10 and still mandatory
      // there; its replacement does not exist until 2026-01. See
      // buildExactPlantInventoryInput.
      allowDeprecated: ["InventorySetQuantitiesInput.ignoreCompareQuantity"],
      value: buildExactPlantInventoryInput({
        inventoryItemId: "gid://shopify/InventoryItem/1",
        locationId: "gid://shopify/Location/1",
      }),
    },
    {
      label: "fileCreate($files)",
      type: "[FileCreateInput!]!",
      value: [
        {
          alt: "photo.jpg",
          contentType: "IMAGE",
          originalSource: "https://staged.example.com/photo.jpg",
        },
      ],
    },
    {
      label: "stagedUploadsCreate($input)",
      type: "[StagedUploadInput!]!",
      value: [
        {
          filename: "photo.jpg",
          mimeType: "image/jpeg",
          httpMethod: "POST",
          resource: "FILE",
        },
      ],
    },
    {
      label: "publishablePublish($input)",
      type: "[PublicationInput!]!",
      value: [{ publicationId: "gid://shopify/Publication/1" }],
    },
    {
      label: "productUpdate($product)",
      type: "ProductUpdateInput!",
      value: { id: "gid://shopify/Product/1", title: "Monstera Thai Constellation" },
    },
  ];
}

/** Deprecated input fields present in a payload, as `Type.field` paths. */
function deprecatedInputFields(type, value, seen = new Set(), allowed = new Set()) {
  if (value === null || value === undefined) return [];
  if (isNonNullType(type)) {
    return deprecatedInputFields(type.ofType, value, seen, allowed);
  }
  if (isListType(type)) {
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((item) =>
      deprecatedInputFields(type.ofType, item, seen, allowed),
    );
  }
  if (!isInputObjectType(type) || typeof value !== "object") return [];

  const found = [];
  const fields = type.getFields();
  for (const [key, entry] of Object.entries(value)) {
    const field = fields[key];
    if (!field) continue;
    const path = `${type.name}.${key}`;
    if (field.deprecationReason && !seen.has(path) && !allowed.has(path)) {
      seen.add(path);
      found.push(`${path} (${field.deprecationReason})`);
    }
    found.push(...deprecatedInputFields(field.type, entry, seen, allowed));
  }
  return found;
}

function validateInputSample(schema, sample) {
  const type = typeFromAST(schema, parseType(sample.type));
  if (!type) {
    return [`Unknown type ${sample.type}`];
  }

  const errors = [];
  coerceInputValue(sample.value, type, (path, _invalidValue, error) => {
    const location = path.length ? ` at ${path.join(".")}` : "";
    errors.push(`${error.message}${location}`);
  });
  errors.push(
    ...deprecatedInputFields(
      type,
      sample.value,
      new Set(),
      new Set(sample.allowDeprecated ?? []),
    ).map((field) => `uses deprecated input field ${field}`),
  );
  return errors;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version ?? (await resolveApiVersion());

  let introspection;
  if (args.schema) {
    introspection = JSON.parse(await readFile(args.schema, "utf8"));
  } else {
    console.log(`Fetching Shopify Admin API ${version} schema…`);
    introspection = await fetchIntrospection(version);
  }

  if (args.writeSchema) {
    await mkdir(path.dirname(args.writeSchema), { recursive: true });
    await writeFile(args.writeSchema, `${JSON.stringify(introspection)}\n`);
    console.log(`Wrote schema to ${args.writeSchema}`);
  }

  const schema = buildClientSchema(introspection);

  const files = (
    await Promise.all(
      SCAN_DIRS.map((dir) => collectSourceFiles(path.join(REPO_ROOT, dir))),
    )
  ).flat();

  let checked = 0;
  let skipped = 0;
  const failures = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const doc of extractDocuments(source, file)) {
      const relative = path.relative(REPO_ROOT, doc.file);
      if (doc.interpolated) {
        skipped += 1;
        console.log(`skip  ${relative}:${doc.line} (interpolated document)`);
        continue;
      }
      checked += 1;
      let errors;
      try {
        errors = validate(schema, parse(doc.body));
      } catch (error) {
        errors = [error];
      }
      if (errors.length > 0) {
        failures.push({ relative, line: doc.line, errors });
      }
    }
  }

  console.log(
    `\nChecked ${checked} document(s) against Admin API ${version}` +
      (skipped ? ` (${skipped} skipped)` : ""),
  );

  const samples = await inputSamples();
  for (const sample of samples) {
    const errors = validateInputSample(schema, sample);
    if (errors.length > 0) {
      failures.push({
        relative: sample.label,
        line: sample.type,
        errors: errors.map((message) => ({ message })),
      });
    }
  }
  console.log(`Checked ${samples.length} variable payload(s) against their input types`);

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`FAIL  ${failure.relative}:${failure.line}`);
      for (const error of failure.errors) {
        console.error(`      ${error.message.replace(/\n/g, "\n      ")}`);
      }
    }
    console.error(`\n${failures.length} document(s) are invalid.`);
    process.exit(1);
  }

  console.log("All documents are valid.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
