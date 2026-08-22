import prisma from "../db.server";
import { canStubShopifyWrites } from "./environment.server";
import {
  INVOICE_VOIDED_REASON,
  PAYMENT_AFTER_VOID_REASON,
} from "./portal";

export type VoidUnpaidDraftOrderOptions = {
  /**
   * StatusEvent reason written after a successful delete. Defaults to the
   * expiration-sweep wording. Admin override close uses a different reason so
   * the two closures stay distinguishable.
   */
  reason?: string;
};
import {
  deleteDraftOrder,
  readDraftOrderStatus,
} from "./shopify-ops.server";
import type { GraphqlClient } from "./shopify-ops.server";

/** How long one void attempt may hold the claim before another sweep takes over. */
export const VOID_CLAIM_MS = 2 * 60 * 1000;

/**
 * Shopify completed the draft before we could delete it. Terminal: retrying
 * would call `draftOrderDelete` on a COMPLETED draft, which a live store
 * accepts and which would drop the admin record of a payment that just landed.
 */
export const COMPLETED_BEFORE_VOID = "completed_before_void";

export type VoidOutcome =
  | "voided"
  | "already_voided"
  | "completed"
  | "in_flight"
  | "skipped"
  | "failed";

function isStaleClaim(startedAt: Date | null | undefined, now: Date): boolean {
  if (!startedAt) return true;
  return now.getTime() - startedAt.getTime() >= VOID_CLAIM_MS;
}

async function claimVoid(
  requestId: string,
  now: Date,
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - VOID_CLAIM_MS);
  const { count } = await prisma.draftOrderReference.updateMany({
    where: {
      requestId,
      voidedAt: null,
      AND: [
        {
          OR: [
            { voidError: null },
            { voidError: { not: COMPLETED_BEFORE_VOID } },
          ],
        },
        {
          OR: [{ voidStartedAt: null }, { voidStartedAt: { lt: staleBefore } }],
        },
      ],
    },
    data: {
      voidStartedAt: now,
      voidAttempts: { increment: 1 },
      voidError: null,
    },
  });
  return count === 1;
}

async function markVoided(
  requestId: string,
  now: Date,
  reason: string,
  status: string,
) {
  await prisma.$transaction([
    prisma.draftOrderReference.update({
      where: { requestId },
      data: { voidedAt: now, voidError: null, voidStartedAt: now },
    }),
    prisma.statusEvent.create({
      data: {
        requestId,
        fromStatus: status,
        toStatus: status,
        reason,
      },
    }),
  ]);
}

/**
 * Makes one unpaid Draft Order unpayable.
 *
 * Shopify has no void state. `draftOrderDelete` is the mechanism a live store
 * confirmed: the checkout URL then 404s with "This invoice is not available"
 * and that draft's reserved inventory returns immediately.
 *
 * Does not require Expired — admin override close uses this on Pending/New so a
 * payable invoice is not left behind. Paid requests and COMPLETED drafts are
 * never deleted.
 */
export async function voidUnpaidDraftOrder(
  shop: string,
  requestId: string,
  admin: GraphqlClient | undefined,
  now = new Date(),
  options: VoidUnpaidDraftOrderOptions = {},
): Promise<VoidOutcome> {
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    include: { draftOrder: true },
  });
  if (!request?.draftOrder) return "skipped";
  if (request.paidAt) return "skipped";
  if (request.draftOrder.voidedAt) return "already_voided";
  if (request.draftOrder.voidError === COMPLETED_BEFORE_VOID) return "completed";
  if (!request.draftOrder.invoiceUrl && !request.draftOrder.shopifyDraftOrderGid) {
    return "skipped";
  }

  const reason = options.reason ?? INVOICE_VOIDED_REASON;

  if (!(await claimVoid(requestId, now))) {
    return isStaleClaim(request.draftOrder.voidStartedAt, now)
      ? "in_flight"
      : "in_flight";
  }

  const gid = request.draftOrder.shopifyDraftOrderGid;
  if (!admin || !gid) {
    if (canStubShopifyWrites(shop)) {
      await markVoided(requestId, now, reason, request.status);
      return "voided";
    }
    await prisma.draftOrderReference.update({
      where: { requestId },
      data: { voidError: "No Admin API client; invoice was not voided." },
    });
    return "failed";
  }

  try {
    const live = await readDraftOrderStatus(admin, gid);
    if (!live) {
      await markVoided(requestId, now, reason, request.status);
      return "voided";
    }
    if (live.status === "COMPLETED" || live.orderGid) {
      await prisma.draftOrderReference.update({
        where: { requestId },
        data: { voidError: COMPLETED_BEFORE_VOID, voidStartedAt: now },
      });
      return "completed";
    }

    await deleteDraftOrder(admin, gid);
    await markVoided(requestId, now, reason, request.status);
    return "voided";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.draftOrderReference.update({
      where: { requestId },
      data: { voidError: message.slice(0, 1000) },
    });
    return "failed";
  }
}

/**
 * Expiration-sweep entry point. Only Expired unpaid drafts are in scope;
 * Pending invoices stay live until paid, superseded, or admin override close.
 */
export async function voidExpiredDraftOrder(
  shop: string,
  requestId: string,
  admin: GraphqlClient | undefined,
  now = new Date(),
): Promise<VoidOutcome> {
  const request = await prisma.plantRequest.findFirst({
    where: { id: requestId, shop },
    select: { status: true },
  });
  if (!request || request.status !== "Expired") return "skipped";
  return voidUnpaidDraftOrder(shop, requestId, admin, now, {
    reason: INVOICE_VOIDED_REASON,
  });
}

/**
 * Voids every expired unpaid invoice that still has a live Shopify draft order.
 *
 * Called from the hourly sweep after `expireOverdueOffers`, and from the
 * customer/admin page that first notices the hold has ended — never from
 * `expireOverdueOffers` itself, which stays a database-only claim so a page
 * load cannot stall on Shopify.
 */
export async function voidExpiredDraftOrders(
  shop: string,
  admin: GraphqlClient | undefined,
  now = new Date(),
): Promise<{ voided: number; completed: number; failed: number }> {
  const pending = await prisma.plantRequest.findMany({
    where: {
      shop,
      status: "Expired",
      paidAt: null,
      draftOrder: {
        voidedAt: null,
        AND: [
          {
            OR: [
              { voidError: null },
              { voidError: { not: COMPLETED_BEFORE_VOID } },
            ],
          },
          {
            OR: [
              { invoiceUrl: { not: null } },
              { shopifyDraftOrderGid: { not: null } },
            ],
          },
        ],
      },
    },
    select: { id: true },
  });

  const summary = { voided: 0, completed: 0, failed: 0 };
  for (const request of pending) {
    const outcome = await voidExpiredDraftOrder(shop, request.id, admin, now);
    if (outcome === "voided") summary.voided += 1;
    else if (outcome === "completed") summary.completed += 1;
    else if (outcome === "failed") summary.failed += 1;
  }
  return summary;
}

export function paymentAfterVoidReason(input: {
  status?: string | null;
  voidedAt?: Date | string | null;
}): string {
  if (input.voidedAt || input.status === "Expired") {
    return PAYMENT_AFTER_VOID_REASON;
  }
  return "Payment completed";
}
