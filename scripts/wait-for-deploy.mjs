#!/usr/bin/env node
/**
 * Poll /versionz until the live commit matches EXPECTED_SHA.
 * No secrets. Fails clearly on timeout.
 */
import { commitMatchesExpected } from "../app/lib/deployed-version.ts";

const expected = (process.env.EXPECTED_SHA || "").trim();
const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
const timeoutMs = Number(process.env.DEPLOY_WAIT_MS || 12 * 60 * 1000);
const intervalMs = Number(process.env.DEPLOY_POLL_MS || 15_000);

if (!expected || !base) {
  console.error("EXPECTED_SHA and APP_BASE_URL are required.");
  process.exit(1);
}

const deadline = Date.now() + timeoutMs;
let last = "none";

while (Date.now() < deadline) {
  try {
    const response = await fetch(`${base}/versionz`, {
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    last = typeof body.commit === "string" ? body.commit : "none";
    if (
      response.ok &&
      body.status === "ok" &&
      body.migrations === "applied" &&
      commitMatchesExpected(last, expected)
    ) {
      console.log(`Live commit ${last} matches ${expected}.`);
      process.exit(0);
    }
    console.log(
      `Waiting for ${expected}; live=${last} status=${body.status} http=${response.status}`,
    );
  } catch (error) {
    console.log(
      `Waiting for ${expected}; probe failed: ${error instanceof Error ? error.message : error}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.error(`Timed out waiting for ${expected}. Last seen commit: ${last}`);
process.exit(1);
