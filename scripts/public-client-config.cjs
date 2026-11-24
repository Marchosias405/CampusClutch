const fs = require('node:fs');
const { isIPv4 } = require('node:net');

const publicNames = new Set([
  // Expo CLI sets these itself while exporting assets and resolving the project.
  'EXPO_PUBLIC_FOLDER',
  'EXPO_PUBLIC_PROJECT_ROOT',
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_PRIVACY_EMAIL',
]);

function publicKey(value) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return false;
  try {
    return JSON.parse(Buffer.from(value.split('.')[1], 'base64url')).role === 'anon';
  } catch {
    return false;
  }
}

function checkPublicConfig(env) {
  // Expo inlines EXPO_PUBLIC_* references into the downloadable app.
  for (const name of Object.keys(env)) {
    if (name.startsWith('EXPO_PUBLIC_') && !publicNames.has(name)) {
      throw new Error('Unrecognized EXPO_PUBLIC_ setting. Review public build configuration before bundling.');
    }
  }
  for (const name of ['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']) {
    if (env[name] && !publicKey(env[name].trim())) {
      throw new Error('The app requires a Supabase publishable key or legacy anon key.');
    }
  }
  if (env.EXPO_PUBLIC_APP_ENV && !['development', 'preview', 'production'].includes(env.EXPO_PUBLIC_APP_ENV)) {
    throw new Error('EXPO_PUBLIC_APP_ENV must be development, preview, or production.');
  }
  const configured = env.EXPO_PUBLIC_SUPABASE_URL;
  if (configured) {
    let url;
    try { url = new URL(configured); } catch { throw new Error('Invalid Supabase URL.'); }
    const localHost = ['localhost', '[::1]'].includes(url.hostname) || (isIPv4(url.hostname) &&
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname));
    const localDev = env.EXPO_PUBLIC_APP_ENV === 'development' &&
      !['preview', 'production'].includes(env.EAS_BUILD_PROFILE) && localHost && url.protocol === 'http:';
    if ((!localDev && url.protocol !== 'https:') || url.username || url.password ||
        url.search || url.hash || url.pathname !== '/') {
      throw new Error('Use a Supabase HTTPS origin, or a local HTTP address for development.');
    }
  }
}

function checkGoogleServicesFile(file, packageName) {
  // EAS file variables can be unavailable when resolving the app config locally.
  if (!file || !fs.existsSync(file)) return;
  let client;
  try { client = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Invalid Firebase Android configuration file.'); }
  if (!client || client.private_key || client.type === 'service_account' ||
      !Array.isArray(client.client) || !client.client.some(entry =>
        entry?.client_info?.android_client_info?.package_name === packageName)) {
    throw new Error('Use the Firebase Android client configuration for this app package.');
  }
}

module.exports = { checkPublicConfig, checkGoogleServicesFile };
