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
  getIntrospectionQuery,
  parse,
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
    body: JSON.stringify({ query: getIntrospectionQuery() }),
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
