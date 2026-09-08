/** @typedef {'development' | 'production'} AppVariant */

/** Production App Store identity — must stay exactly as shipped. */
const PRODUCTION_IDENTITY = {
  name: "Request Portal",
  bundleIdentifier: "com.unsolicitedplanttalks.admin",
  androidPackage: "com.unsolicitedplanttalks.admin",
  scheme: "uptadmin",
};

/** Development dev-client identity — installable beside production. */
const DEVELOPMENT_IDENTITY = {
  name: "Request Portal Dev",
  bundleIdentifier: "com.unsolicitedplanttalks.admin.dev",
  androidPackage: "com.unsolicitedplanttalks.admin.dev",
  scheme: "uptadmin-dev",
};

/** @type {Record<AppVariant, typeof PRODUCTION_IDENTITY>} */
const APP_IDENTITIES = {
  production: PRODUCTION_IDENTITY,
  development: DEVELOPMENT_IDENTITY,
};

const EAS_PROJECT_ID = "2c4abfc0-98d5-462b-abd0-8ecba3deeeed";
const EXPO_OWNER = "unsolicited-plant-talks";
const EXPO_SLUG = "upt-admin-ios";

/** @param {string | undefined} [raw] */
function resolveAppVariant(raw = process.env.APP_VARIANT) {
  return raw === "development" ? "development" : "production";
}

/** @param {AppVariant} variant */
function iosAdminSchemeForVariant(variant) {
  return APP_IDENTITIES[variant].scheme;
}

/** @param {AppVariant} variant */
function iosAdminLinkPrefixForVariant(variant) {
  return `${iosAdminSchemeForVariant(variant)}://`;
}

/** @param {{ appVariant?: string; scheme?: string | string[] | null; envVariant?: string }} input */
function iosAdminSchemeFromConfig(input) {
  if (input.appVariant === "development" || input.appVariant === "production") {
    return iosAdminSchemeForVariant(input.appVariant);
  }

  const scheme = input.scheme;
  if (typeof scheme === "string" && scheme.trim()) {
    return scheme.trim();
  }
  if (Array.isArray(scheme) && typeof scheme[0] === "string" && scheme[0].trim()) {
    return scheme[0].trim();
  }

  return iosAdminSchemeForVariant(resolveAppVariant(input.envVariant));
}

/** @param {AppVariant} variant @param {string} requestId */
function iosAdminRequestUrlForVariant(variant, requestId) {
  return `${iosAdminLinkPrefixForVariant(variant)}request/${requestId}`;
}

module.exports = {
  APP_IDENTITIES,
  PRODUCTION_IDENTITY,
  DEVELOPMENT_IDENTITY,
  EAS_PROJECT_ID,
  EXPO_OWNER,
  EXPO_SLUG,
  resolveAppVariant,
  iosAdminSchemeForVariant,
  iosAdminLinkPrefixForVariant,
  iosAdminSchemeFromConfig,
  iosAdminRequestUrlForVariant,
};
