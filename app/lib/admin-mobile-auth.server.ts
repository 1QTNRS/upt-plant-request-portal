import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import prisma from "../db.server";

/** Shown once. Only the SHA-256 of this value is stored. */
export const ADMIN_MOBILE_TOKEN_PREFIX = "upt_admin_";

export type AdminMobileTokenRecord = {
  id: string;
  shop: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1] ?? null;
}

export function newAdminMobileToken(): string {
  return `${ADMIN_MOBILE_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export async function createAdminMobileToken(
  shop: string,
  label: string,
): Promise<{ token: string; record: AdminMobileTokenRecord }> {
  const trimmed = label.trim() || "iPhone";
  const token = newAdminMobileToken();
  const record = await prisma.adminMobileToken.create({
    data: {
      shop,
      label: trimmed.slice(0, 80),
      tokenHash: hashToken(token),
    },
  });
  return { token, record };
}

export async function listAdminMobileTokens(
  shop: string,
): Promise<AdminMobileTokenRecord[]> {
  return prisma.adminMobileToken.findMany({
    where: { shop, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      shop: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
}

export async function revokeAdminMobileToken(
  shop: string,
  tokenId: string,
): Promise<boolean> {
  const result = await prisma.adminMobileToken.updateMany({
    where: { id: tokenId, shop, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Resolves the shop for a mobile admin request, or null when the bearer
 * token is missing, unknown, or revoked.
 */
export async function authenticateAdminMobile(
  request: Request,
): Promise<{ shop: string; tokenId: string } | null> {
  const token = readBearerToken(request);
  if (!token || !token.startsWith(ADMIN_MOBILE_TOKEN_PREFIX)) return null;

  const tokenHash = hashToken(token);
  const row = await prisma.adminMobileToken.findUnique({
    where: { tokenHash },
    select: { id: true, shop: true, revokedAt: true, tokenHash: true },
  });
  if (!row || row.revokedAt) return null;
  // The unique lookup already used the hash; this keeps a stolen row from
  // matching if the stored hash were ever rewritten to a different length.
  if (!tokensEqual(row.tokenHash, tokenHash)) return null;

  await prisma.adminMobileToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return { shop: row.shop, tokenId: row.id };
}

export function unauthorizedMobileResponse(): Response {
  return Response.json(
    { error: "Unauthorized." },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}
