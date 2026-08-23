#!/usr/bin/env node
/**
 * Classify a GitHub pull request and print JSON { risk, reasons }.
 * Used by .github/workflows/pr-risk.yml and auto-merge.yml.
 */
import { classifyPullRequestRisk } from "../app/lib/pr-risk.ts";

const title = process.env.PR_TITLE || "";
const body = process.env.PR_BODY || "";
const labels = (process.env.PR_LABELS || "")
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean);
const files = (process.env.PR_FILES || "")
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean);

const result = classifyPullRequestRisk({ title, body, labels, files });
process.stdout.write(JSON.stringify(result));
