/** @typedef {'development' | 'production'} AppVariant */

/** @type {const} */
const APP_IDENTITIES = {
  production: {
    name: "Request Portal",
    bundleIdentifier: "com.unsolicitedplanttalks.admin",
    androidPackage: "com.unsolicitedplanttalks.admin",
    scheme: "uptadmin",
  },
  development: {
    name: "Request Portal Dev",
    bundleIdentifier: "com.unsolicitedplanttalks.admin.dev",
    androidPackage: "com.unsolicitedplanttalks.admin.dev",
    scheme: "uptadmin-dev",
  },
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

const SPLASH = {
  image: "./assets/splash-icon.png",
  imageWidth: 260,
  resizeMode: "contain",
  backgroundColor: "#002910",
};

const PLUGINS = [
  "expo-asset",
  [
    "expo-splash-screen",
    {
      backgroundColor: SPLASH.backgroundColor,
      image: SPLASH.image,
      imageWidth: SPLASH.imageWidth,
      resizeMode: SPLASH.resizeMode,
    },
  ],
  [
    "expo-image-picker",
    {
      photosPermission:
        "Allow access to your photo library so you can upload photos to requests.",
      cameraPermission: false,
      microphonePermission: false,
    },
  ],
  [
    "expo-notifications",
    {
      enableBackgroundRemoteNotifications: false,
    },
  ],
  [
    "expo-secure-store",
    {
      faceIDPermission: false,
    },
  ],
];

/** @param {AppVariant} variant */
function buildExpoConfig(variant) {
  const identity = APP_IDENTITIES[variant];

  return {
    name: identity.name,
    slug: EXPO_SLUG,
    scheme: identity.scheme,
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    icon: "./assets/icon.png",
    owner: EXPO_OWNER,
    splash: SPLASH,
    ios: {
      supportsTablet: true,
      bundleIdentifier: identity.bundleIdentifier,
      icon: "./assets/icon.png",
      splash: SPLASH,
      infoPlist: {
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
          NSExceptionDomains: {
            localhost: {
              NSExceptionAllowsInsecureHTTPLoads: true,
            },
          },
        },
      },
    },
    android: {
      package: identity.androidPackage,
    },
    extra: {
      appVariant: variant,
      eas: {
        projectId: EAS_PROJECT_ID,
      },
    },
    plugins: PLUGINS,
  };
}

module.exports = {
  APP_IDENTITIES,
  EAS_PROJECT_ID,
  EXPO_OWNER,
  EXPO_SLUG,
  resolveAppVariant,
  iosAdminSchemeForVariant,
  iosAdminLinkPrefixForVariant,
  iosAdminSchemeFromConfig,
  iosAdminRequestUrlForVariant,
  buildExpoConfig,
};
