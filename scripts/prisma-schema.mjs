/**
 * Single source of truth for which Prisma schema a command should use.
 *
 * Prisma cannot take its datasource provider from an environment variable, so
 * the PostgreSQL schema is a generated copy of the SQLite one with a different
 * datasource block. Everything else (models, indexes, defaults) is identical
 * and `--check` enforces that.
 *
 * Usage:
 *   node scripts/prisma-schema.mjs            # print the schema path for DATABASE_URL
 *   node scripts/prisma-schema.mjs --sync     # regenerate the PostgreSQL schema
 *   node scripts/prisma-schema.mjs --check    # fail if the PostgreSQL schema is stale
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SQLITE_SCHEMA = path.join(REPO_ROOT, "prisma", "schema.prisma");
const POSTGRES_SCHEMA = path.join(REPO_ROOT, "prisma", "postgres", "schema.prisma");

const POSTGRES_HEADER = `// GENERATED FILE — do not edit by hand.
//
// Regenerate with \`npm run prisma:sync-schema\` after changing
// prisma/schema.prisma. \`npm run prisma:check-schema\` fails when this file is
// stale, so the two providers cannot drift apart.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`;

export function isPostgresUrl(url) {
  return /^postgres(ql)?:\/\//i.test(url ?? "");
}

export function schemaPathFor(databaseUrl) {
  return isPostgresUrl(databaseUrl) ? POSTGRES_SCHEMA : SQLITE_SCHEMA;
}

/** Everything after the generator and datasource blocks: the shared models. */
function modelSection(source) {
  const index = source.indexOf("\nmodel ");
  if (index === -1) {
    throw new Error("prisma/schema.prisma contains no model blocks");
  }
  return source.slice(index + 1);
}

async function renderPostgresSchema() {
  const sqlite = await readFile(SQLITE_SCHEMA, "utf8");
  return `${POSTGRES_HEADER}\n${modelSection(sqlite)}`;
}

async function main() {
  const mode = process.argv[2];

  if (mode === "--sync") {
    const rendered = await renderPostgresSchema();
    await mkdir(path.dirname(POSTGRES_SCHEMA), { recursive: true });
    await writeFile(POSTGRES_SCHEMA, rendered);
    console.log(`Wrote ${path.relative(REPO_ROOT, POSTGRES_SCHEMA)}`);
    return;
  }

  if (mode === "--check") {
    const rendered = await renderPostgresSchema();
    let current = "";
    try {
      current = await readFile(POSTGRES_SCHEMA, "utf8");
    } catch {
      // Treated as stale below.
    }
    if (current !== rendered) {
      console.error(
        "prisma/postgres/schema.prisma is out of sync with prisma/schema.prisma.\n" +
          "Run `npm run prisma:sync-schema` and commit the result.",
      );
      process.exit(1);
    }
    console.log("PostgreSQL schema is in sync with the SQLite schema.");
    return;
  }

  if (mode) {
    console.error(`Unknown argument: ${mode}`);
    process.exit(1);
  }

  process.stdout.write(schemaPathFor(process.env.DATABASE_URL));
}

if (process.argv[1] === import.meta.filename) {
  await main();
}
