const {
  APP_IDENTITIES,
  DEVELOPMENT_IDENTITY,
  PRODUCTION_IDENTITY,
  resolveAppVariant,
} = require("./appIdentity.js");

/** @param {import('@expo/config').ExpoConfig} config @param {import('./appIdentity.js').AppVariant} variant */
function applyAppVariant(config, variant) {
  const identity = APP_IDENTITIES[variant];

  if (variant === "production") {
    return {
      ...config,
      name: PRODUCTION_IDENTITY.name,
      scheme: PRODUCTION_IDENTITY.scheme,
      ios: {
        ...config.ios,
        bundleIdentifier: PRODUCTION_IDENTITY.bundleIdentifier,
      },
      android: {
        ...config.android,
        package: PRODUCTION_IDENTITY.androidPackage,
      },
      extra: {
        ...config.extra,
        appVariant: "production",
      },
    };
  }

  return {
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: identity.bundleIdentifier,
    },
    android: {
      ...config.android,
      package: identity.androidPackage,
    },
    extra: {
      ...config.extra,
      appVariant: "development",
    },
  };
}

/** @param {import('@expo/config').ConfigContext} ctx */
function expoConfig({ config }) {
  return applyAppVariant(config, resolveAppVariant(process.env.APP_VARIANT));
}

/** Resolve the public config the same way Expo does for tests and tooling. */
function resolvePublicExpoConfig(variant) {
  const previous = process.env.APP_VARIANT;
  process.env.APP_VARIANT = variant;
  try {
    const base = require("./app.json").expo;
    return applyAppVariant(base, variant);
  } finally {
    if (previous === undefined) {
      delete process.env.APP_VARIANT;
    } else {
      process.env.APP_VARIANT = previous;
    }
  }
}

expoConfig.applyAppVariant = applyAppVariant;
expoConfig.resolvePublicExpoConfig = resolvePublicExpoConfig;

module.exports = expoConfig;
