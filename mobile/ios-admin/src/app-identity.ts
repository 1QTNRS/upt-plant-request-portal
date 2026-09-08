export type AppVariant = "development" | "production";

export {
  APP_IDENTITIES,
  DEVELOPMENT_IDENTITY,
  EAS_PROJECT_ID,
  EXPO_OWNER,
  EXPO_SLUG,
  PRODUCTION_IDENTITY,
  resolveAppVariant,
  iosAdminSchemeForVariant,
  iosAdminLinkPrefixForVariant,
  iosAdminSchemeFromConfig,
  iosAdminRequestUrlForVariant,
} from "../appIdentity.js";
