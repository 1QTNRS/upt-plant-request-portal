import prisma from "../db.server";
import {
  PUSH_KIND_ITEM_STATUS,
  PUSH_KIND_NEW_REQUEST,
  adminPushIdempotencyKey,
  expoPushTokenHint,
  iosAdminRequestUrl,
  isExpoPushToken,
  itemStatusPushCopy,
  newRequestPushCopy,
} from "./admin-push";
import { getRequest, getShopSettings } from "./portal.server";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type ExpoPushTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
};

export type AdminPushSender = (
  messages: ExpoPushMessage[],
) => Promise<ExpoPushTicket[]>;

export async function countRegisteredPushDevices(shop: string): Promise<number> {
  return prisma.adminMobileToken.count({
    where: {
      shop,
      revokedAt: null,
      expoPushToken: { not: null },
    },
  });
}

export async function registerDeviceExpoPushToken(input: {
  shop: string;
  tokenId: string;
  expoPushToken: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const expoPushToken = input.expoPushToken.trim();
  if (!isExpoPushToken(expoPushToken)) {
    return { ok: false, error: "That is not a valid Expo push token." };
  }

  const device = await prisma.adminMobileToken.findFirst({
    where: { id: input.tokenId, shop: input.shop, revokedAt: null },
    select: { id: true },
  });
  if (!device) {
    return { ok: false, error: "That device token is no longer authorized." };
  }

  await prisma.$transaction([
    prisma.adminMobileToken.updateMany({
      where: {
        shop: input.shop,
        expoPushToken,
        id: { not: device.id },
      },
      data: { expoPushToken: null },
    }),
    prisma.adminMobileToken.update({
      where: { id: device.id },
      data: { expoPushToken },
    }),
  ]);
  return { ok: true };
}

async function authorizedPushTargets(shop: string) {
  return prisma.adminMobileToken.findMany({
    where: {
      shop,
      revokedAt: null,
      expoPushToken: { not: null },
    },
    select: { id: true, expoPushToken: true },
  });
}

export async function defaultExpoPushSender(
  messages: ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Expo push responded ${response.status}.`);
  }
  let parsed: { data?: ExpoPushTicket[] };
  try {
    parsed = JSON.parse(raw) as { data?: ExpoPushTicket[] };
  } catch {
    throw new Error("Expo push returned a non-JSON body.");
  }
  return parsed.data ?? [];
}

async function clearInvalidPushToken(tokenId: string, token: string) {
  await prisma.adminMobileToken.updateMany({
    where: { id: tokenId, expoPushToken: token },
    data: { expoPushToken: null },
  });
}

async function deliverPush(input: {
  shop: string;
  requestId: string;
  kind: typeof PUSH_KIND_NEW_REQUEST | typeof PUSH_KIND_ITEM_STATUS;
  title: string;
  body: string;
  sender?: AdminPushSender;
}): Promise<void> {
  const idempotencyKey = adminPushIdempotencyKey(input.kind, input.requestId);
  const existing = await prisma.adminPushMessage.findFirst({
    where: { shop: input.shop, idempotencyKey },
  });
  if (existing?.status === "sent") return;

  let message = existing;
  if (!message) {
    try {
      message = await prisma.adminPushMessage.create({
        data: {
          shop: input.shop,
          requestId: input.requestId,
          kind: input.kind,
          title: input.title,
          body: input.body,
          status: "queued",
          idempotencyKey,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await prisma.adminPushMessage.findFirst({
          where: { shop: input.shop, idempotencyKey },
        });
        if (!raced || raced.status === "sent") return;
        message = raced;
      } else {
        throw error;
      }
    }
  }
  if (!message) return;

  const targets = (await authorizedPushTargets(input.shop)).filter(
    (row): row is { id: string; expoPushToken: string } =>
      Boolean(row.expoPushToken),
  );
  if (targets.length === 0) {
    await prisma.adminPushMessage.update({
      where: { id: message.id },
      data: {
        status: "sent",
        sentAt: new Date(),
        attempts: { increment: 1 },
        error: null,
      },
    });
    return;
  }

  const payload: ExpoPushMessage[] = targets.map((target) => ({
    to: target.expoPushToken,
    title: input.title,
    body: input.body,
    data: {
      requestId: input.requestId,
      kind: input.kind,
      url: iosAdminRequestUrl(input.requestId),
    },
    sound: "default",
  }));

  const sender = input.sender ?? defaultExpoPushSender;
  let tickets: ExpoPushTicket[] = [];
  try {
    tickets = await sender(payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Expo push failed.";
    await prisma.adminPushMessage.update({
      where: { id: message.id },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        error: reason.slice(0, 1000),
      },
    });
    console.warn(
      `iOS admin push ${input.kind} for ${input.requestId} on ${input.shop} failed: ${reason}`,
    );
    return;
  }

  let delivered = 0;
  for (const [index, ticket] of tickets.entries()) {
    const target = targets[index];
    if (!target) continue;
    if (ticket.status === "ok") {
      delivered += 1;
      continue;
    }
    const code = ticket.details?.error || "";
    if (code === "DeviceNotRegistered") {
      await clearInvalidPushToken(target.id, target.expoPushToken);
      console.warn(
        `Cleared invalid Expo push token ${expoPushTokenHint(target.expoPushToken)} on ${input.shop}.`,
      );
      continue;
    }
    console.warn(
      `Expo push ticket error for ${expoPushTokenHint(target.expoPushToken)} on ${input.shop}: ${ticket.message || code || "unknown"}.`,
    );
  }

  await prisma.adminPushMessage.update({
    where: { id: message.id },
    data: {
      status: delivered > 0 || tickets.length === 0 ? "sent" : "failed",
      sentAt: delivered > 0 || tickets.length === 0 ? new Date() : null,
      attempts: { increment: 1 },
      error:
        delivered > 0 || tickets.length === 0
          ? null
          : "No authorized device accepted the push.",
    },
  });
}

export async function notifyNewRequestPush(
  shop: string,
  requestId: string,
  options: { sender?: AdminPushSender } = {},
) {
  try {
    const settings = await getShopSettings(shop);
    if (!settings.adminPushNewRequest) return;
    const request = await getRequest(shop, requestId);
    if (!request) return;
    const copy = newRequestPushCopy({
      requestNumber: request.requestNumber,
      customerName: request.customer,
    });
    await deliverPush({
      shop,
      requestId,
      kind: PUSH_KIND_NEW_REQUEST,
      title: copy.title,
      body: copy.body,
      sender: options.sender,
    });
  } catch (error) {
    console.warn(
      `New-request iOS push did not send for ${requestId} on ${shop}.`,
      error,
    );
  }
}

export async function notifyItemStatusUpdatePush(
  shop: string,
  input: {
    requestId: string;
    acceptedCount: number;
    rejectedCount: number;
    sender?: AdminPushSender;
  },
) {
  try {
    const settings = await getShopSettings(shop);
    if (!settings.adminPushItemStatusUpdate) return;
    const request = await getRequest(shop, input.requestId);
    if (!request) return;
    const copy = itemStatusPushCopy({
      requestNumber: request.requestNumber,
      acceptedCount: input.acceptedCount,
      rejectedCount: input.rejectedCount,
    });
    if (!copy) return;
    await deliverPush({
      shop,
      requestId: input.requestId,
      kind: PUSH_KIND_ITEM_STATUS,
      title: copy.title,
      body: copy.body,
      sender: input.sender,
    });
  } catch (error) {
    console.warn(
      `Item-status iOS push did not send for ${input.requestId} on ${shop}.`,
      error,
    );
  }
}
