const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { target } = require('./preview.cjs');

const output = '.expo/clu-web-pilot';
target(process.env);
execFileSync(process.execPath, [
  require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--max-workers', '2', '--output-dir', output,
], { stdio: 'inherit', env: { ...process.env, CLU_WEB_PILOT: '1' } });

const scripts = path.join(output, 'client/_expo/static/js/web');
const entries = fs.readdirSync(scripts).filter(file => /^entry-.*\.js$/.test(file));
assert.equal(entries.length, 1, 'Expected one web entry bundle');
const bundle = fs.readFileSync(path.join(scripts, entries[0]), 'utf8');
for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) {
  assert.ok(bundle.includes(JSON.stringify(process.env[name])), 'Export must contain the Preview value for ' + name);
}
const routes = JSON.parse(fs.readFileSync(path.join(output, 'server/_expo/routes.json'), 'utf8'));
for (const section of ['requests', 'students', 'messages']) {
  assert.ok(routes.htmlRoutes.some(route => route.page === '/' + section + '/[id]'), 'Missing shared route for ' + section);
}
console.log('Verified Preview backend, publishable key and shared links in the export.');
