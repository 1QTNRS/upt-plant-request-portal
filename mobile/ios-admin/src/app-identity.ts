export type AppVariant = "development" | "production";

export {
  APP_IDENTITIES,
  EAS_PROJECT_ID,
  EXPO_OWNER,
  EXPO_SLUG,
  resolveAppVariant,
  iosAdminSchemeForVariant,
  iosAdminLinkPrefixForVariant,
  iosAdminSchemeFromConfig,
  iosAdminRequestUrlForVariant,
} from "../appIdentity.js";
