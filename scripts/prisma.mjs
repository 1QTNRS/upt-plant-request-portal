/**
 * Runs the Prisma CLI against whichever schema matches DATABASE_URL.
 *
 * Prisma cannot select its datasource provider from an environment variable, so
 * the provider is decided by the URL scheme here instead of by a second config
 * knob. Local development keeps working with no environment at all because
 * DATABASE_URL falls back to the SQLite dev file.
 *
 * Usage: node scripts/prisma.mjs migrate deploy
 */
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { isPostgresUrl, schemaPathFor } from "./prisma-schema.mjs";

export const DEV_DATABASE_URL = "file:dev.sqlite";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "DATABASE_URL is required in production. Set it to a PostgreSQL connection string.",
    );
    process.exit(1);
  }
  process.env.DATABASE_URL = DEV_DATABASE_URL;
}

// The server refuses to boot on a SQLite URL in production; failing here too
// turns an obscure "unable to open database file" into the actual problem.
if (process.env.NODE_ENV === "production" && !isPostgresUrl(process.env.DATABASE_URL)) {
  console.error(
    "DATABASE_URL must be a PostgreSQL connection string in production; " +
      `got "${process.env.DATABASE_URL}". Container filesystems are ephemeral ` +
      "and SQLite cannot be shared between instances.",
  );
  process.exit(1);
}

const schema = schemaPathFor(process.env.DATABASE_URL);
const args = [
  "prisma",
  ...process.argv.slice(2),
  "--schema",
  path.relative(REPO_ROOT, schema),
];

const child = spawn("npx", args, {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
