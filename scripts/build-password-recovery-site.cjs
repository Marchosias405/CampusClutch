/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = path.resolve(__dirname, '../web/password-recovery');
function buildRecoverySite(output, configurations) {
  const origins = configurations.map(config => new URL(config.url).origin);
  const csp = `default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${[...new Set(origins)].join(' ')}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  const headers = { 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin' };
  fs.mkdirSync(output, { recursive: true });
  for (const config of configurations) {
    assert.match(config.directory, /^[a-z0-9-]*$/);
    const url = new URL(config.url);
    assert.ok((url.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) || (url.protocol === 'http:' && url.hostname === '127.0.0.1'));
    assert.ok(config.key.startsWith('sb_publishable_') || (JSON.parse(Buffer.from(config.key.split('.')[1], 'base64url')).role === 'anon'), 'Only public Auth keys may be deployed');
    const target = path.join(output, config.directory); fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'reset-password.html'), fs.readFileSync(path.join(source, 'reset-password.html'), 'utf8').replace('__CSP__', csp.replace("; frame-ancestors 'none'", '')));
    fs.writeFileSync(path.join(target, 'recovery.js'), fs.readFileSync(path.join(source, 'recovery.js'), 'utf8').replace('const config = __PUBLIC_CONFIG__;', 'const config = ' + JSON.stringify({url:url.origin,key:config.key}) + ';'));
    fs.copyFileSync(path.join(source, 'recovery.css'), path.join(target, 'recovery.css'));
  }
  fs.mkdirSync(path.join(output, '_expo'), { recursive: true });
  fs.writeFileSync(path.join(output, '_expo/routes.json'), JSON.stringify({version:1, apiRoutes:[], htmlRoutes:configurations.map(config => { const file = [config.directory, 'reset-password.html'].filter(Boolean).join('/'); return { file, page: '/' + file, namedRegex: '^/' + file.replaceAll('.', '\\.') + '$', routeKeys: {} }; }), notFoundRoutes:[], redirects:[], rewrites:[], headers}));
  return { headers };
}
module.exports = { buildRecoverySite };
if (require.main === module) {
  const [output, configFile] = process.argv.slice(2);
  assert.ok(output && configFile, 'Usage: node scripts/build-password-recovery-site.cjs OUTPUT PUBLIC_CONFIG_JSON');
  buildRecoverySite(path.resolve(output), JSON.parse(fs.readFileSync(configFile, 'utf8')));
  console.log('Built isolated password recovery pages with public Auth configuration only.');
}
