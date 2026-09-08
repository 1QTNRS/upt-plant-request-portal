const { buildExpoConfig, resolveAppVariant } = require("./appIdentity.js");

/** @param {import('@expo/config').ConfigContext} ctx */
function expoConfig({ config }) {
  return {
    ...config,
    ...buildExpoConfig(resolveAppVariant(process.env.APP_VARIANT)),
  };
}

expoConfig.buildExpoConfig = buildExpoConfig;

module.exports = expoConfig;
