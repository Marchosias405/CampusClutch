/* global __dirname */
const { createHash } = require('node:crypto');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Expo inlines these values in the JS bundle. Local and Preview exports can
// share Metro's disk cache even when they point at different backends.
const publicSettings = Object.keys(process.env)
  .filter(name => name.startsWith('EXPO_PUBLIC_'))
  .sort()
  .map(name => [name, process.env[name]]);
const digest = createHash('sha256').update(JSON.stringify(publicSettings)).digest('hex');
config.cacheVersion = (config.cacheVersion || '') + '-' + digest;
module.exports = config;
