const fs = require('node:fs');
const { checkPublicConfig, checkGoogleServicesFile } = require('./scripts/public-client-config.cjs');

module.exports = ({ config }) => {
  checkPublicConfig(process.env);
  const production = process.env.EAS_BUILD_PROFILE === 'production' || process.env.EXPO_PUBLIC_APP_ENV === 'production';
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ||
    (!production && fs.existsSync('./google-services.json') ? './google-services.json' : undefined);
  checkGoogleServicesFile(googleServicesFile, config.android?.package);
  if (process.env.EAS_BUILD_PLATFORM === 'android' && process.env.EAS_BUILD_PROFILE === 'preview' && !googleServicesFile) {
    throw new Error('Add the Preview Firebase Android client file before building the push-enabled APK.');
  }
  return { ...config, android: { ...config.android, ...(googleServicesFile && { googleServicesFile }) } };
};
