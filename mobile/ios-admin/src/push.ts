import Constants from "expo-constants";

import { iosAdminSchemeFromConfig } from "./app-identity";
export {
  requestIdFromAdminPushData,
  resolveAdminPushDeepLink,
} from "./push-deep-link";

/** Deep-link scheme for this installed binary (production or development). */
export function iosAdminScheme(): string {
  const extra = Constants.expoConfig?.extra as { appVariant?: string } | undefined;
  return iosAdminSchemeFromConfig({
    appVariant: extra?.appVariant,
    scheme: Constants.expoConfig?.scheme,
  });
}

export function iosAdminLinkPrefix(): string {
  return `${iosAdminScheme()}://`;
}

export function iosAdminRequestUrl(requestId: string): string {
  return `${iosAdminLinkPrefix()}request/${requestId}`;
}
