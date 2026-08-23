import { createHmac, timingSafeEqual } from "node:crypto";

import {
  APPROVED_SMOKE_SHOP,
  assertApprovedSmokeShop,
} from "./pr-risk";

export const SMOKE_COOKIE = "upt_smoke";
export const SMOKE_HEADER = "x-upt-smoke";
const MAX_AGE_SEC = 2 * 60 * 60;

function smokeAdminAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env.ALLOW_SMOKE_ADMIN?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

function smokeSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!smokeAdminAllowed(env)) return null;
  const secret = env.SMOKE_TEST_SECRET?.trim() ?? "";
  if (secret.length < 16) return null;
  return secret;
}

export function signSmokeToken(
  nowSec = Math.floor(Date.now() / 1000),
  secret = smokeSecret(),
): string | null {
  if (!secret || secret.length < 16) return null;
  const exp = nowSec + MAX_AGE_SEC;
  const body = `admin:${APPROVED_SMOKE_SHOP}:${exp}`;
  const mac = createHmac("sha256", secret).update(body).digest("hex");
  return `${mac}.${exp}`;
}

export function smokeTokenIsValid(
  token: string | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
  secret = smokeSecret(),
): boolean {
  if (!secret || secret.length < 16 || !token) return false;
  const [mac, expRaw] = token.split(".");
  const exp = Number(expRaw);
  if (!mac || !Number.isFinite(exp) || exp < nowSec) return false;
  const body = `admin:${APPROVED_SMOKE_SHOP}:${exp}`;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  } catch {
    return false;
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Admin smoke access is shop-hardcoded. The token cannot select another shop.
 * Impossible without SMOKE_TEST_SECRET; refused for every shop except the
 * approved dev store.
 */
export function smokeAdminContext(request: Request): { shop: string } | null {
  const secret = smokeSecret();
  if (!secret) return null;
  const token =
    request.headers.get(SMOKE_HEADER) ||
    readCookie(request.headers.get("cookie"), SMOKE_COOKIE);
  if (!smokeTokenIsValid(token, Math.floor(Date.now() / 1000), secret)) {
    return null;
  }
  assertApprovedSmokeShop(APPROVED_SMOKE_SHOP);
  return { shop: APPROVED_SMOKE_SHOP };
}
