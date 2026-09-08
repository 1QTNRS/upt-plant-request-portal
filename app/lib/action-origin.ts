/**
 * Replica of React Router 7.12+ `throwIfPotentialCSRFAttack`.
 *
 * `singleFetchAction` catches that throw and returns:
 *   handleQueryError(new Error("Bad Request"), 400)
 * before any route action runs. That is the production
 * `POST /app/settings.data 400` for Create device token.
 *
 * Keep this aligned with
 * `node_modules/react-router/dist/production/chunk-UODOIDHR.mjs`
 * (`throwIfPotentialCSRFAttack`). Do not invent a second check.
 */

export function actionOriginWouldReject(
  originHeader: string | null,
  requestUrl: string,
): boolean {
  let originDomain: string | null = null;
  let originUrl: URL | null = null;
  try {
    if (typeof originHeader === "string" && originHeader !== "null") {
      originUrl = new URL(originHeader);
      originDomain = originUrl.host;
    } else {
      originDomain = originHeader;
    }
  } catch {
    return true;
  }

  const request = new URL(requestUrl);
  const originMatchesRequest = originUrl
    ? originUrl.origin === request.origin
    : originDomain === request.host;
  return Boolean(originDomain && !originMatchesRequest);
}

export const SETTINGS_CREATE_TOKEN_INTENT = "create-mobile-token";

export const SETTINGS_KNOWN_INTENTS = [
  "save",
  "reset",
  "save-admin-emails",
  "save-admin-push",
  "create-mobile-token",
  "revoke-mobile-token",
] as const;

export type SettingsIntent = (typeof SETTINGS_KNOWN_INTENTS)[number];

export function parseSettingsIntent(raw: FormDataEntryValue | null): {
  intent: string;
  known: boolean;
} {
  const intent = String(raw || "save");
  return {
    intent,
    known: (SETTINGS_KNOWN_INTENTS as readonly string[]).includes(intent),
  };
}
