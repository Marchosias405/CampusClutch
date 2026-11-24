const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { test } = require('node:test');
const { checkPublicConfig, checkGoogleServicesFile } = require('./public-client-config.cjs');

function exampleJwt(role) {
  return ['header', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'fixture'].join('.');
}
const preview = {
  EXPO_PUBLIC_APP_ENV: 'preview',
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co/',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
};

test('Expo accepts publishable and legacy anon keys and rejects private settings before bundling', () => {
  checkPublicConfig(preview);
  checkPublicConfig({ ...preview, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: exampleJwt('anon') });
  for (const value of ['sb_secret_fixture', 'unrecognized-fixture', exampleJwt('service_role')]) {
    assert.throws(() => checkPublicConfig({ ...preview, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: value }),
      error => !error.message.includes(value) && error.message.includes('publishable'));
  }
  assert.throws(() => checkPublicConfig({ ...preview, EXPO_PUBLIC_SIGNING_PASSWORD: 'fixture' }));
});

test('release builds require an HTTPS origin; local development can use the emulator bridge', () => {
  const config = { ...preview, EXPO_PUBLIC_APP_ENV: 'development', EXPO_PUBLIC_SUPABASE_URL: 'http://10.0.2.2:54321' };
  checkPublicConfig(config);
  assert.throws(() => checkPublicConfig({ ...config, EAS_BUILD_PROFILE: 'preview' }));
  for (const origin of ['http://localhost.example.org', 'http://10.example.org', 'https://name:pw@example.org', 'https://example.org/?key=fixture']) {
    assert.throws(() => checkPublicConfig({ ...config, EXPO_PUBLIC_SUPABASE_URL: origin }));
  }
});

test('Firebase configuration must identify the Android app rather than a service account', t => {
  const os = require('node:os');
  const path = require('node:path');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'campusclutch-client-'));
  const file = path.join(folder, 'google-services.json');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(folder); });
  const packageName = 'com.example.test';
  const client = [{ client_info: { android_client_info: { package_name: packageName } } }];
  fs.writeFileSync(file, JSON.stringify({ client }));
  checkGoogleServicesFile(file, packageName);
  assert.throws(() => checkGoogleServicesFile(file, 'com.example.other'));
  fs.writeFileSync(file, JSON.stringify({ client, type: 'service_account', private_key: 'fixture' }));
  assert.throws(() => checkGoogleServicesFile(file, packageName), /Android client/);
});

test('Git excludes real env, signing, and service credential files, including nested copies', () => {
  const paths = ['.env', '.env.production', 'supabase/functions/.env.local', 'secrets/preview.env',
    'credentials.json', 'app.keystore', 'keys/sfu.jks', 'service-account.json', 'firebase/campus-firebase-adminsdk-test.json'];
  for (const file of paths) execFileSync('git', ['check-ignore', '--no-index', '-q', '--', file]);
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
  const privateName = /(?:^|\/)(?:\.env(?:\..*)?|.*\.env|credentials\.json|.*(?:firebase-adminsdk|service[-_]account).*\.json|.*\.(?:jks|keystore|p8|p12|pfx|key|pem))$/i;
  assert.deepEqual(tracked.filter(file => privateName.test(file) && !/(^|\/)\.env\.example$/.test(file)), []);
});

test('tracked text files contain no server keys or exported private-key material', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
  const findings = [];
  for (const file of tracked) {
    if (!/\.(?:json|[cm]?[jt]sx?|sql|toml|ya?ml|md|ps1|py|sh|example)$/i.test(file) || !fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/\bsb_secret_[A-Za-z0-9_-]{25,}/.test(text) ||
        /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\\nr]*[A-Za-z0-9+/=]{32,}/.test(text)) {
      findings.push(file);
      continue;
    }
    for (const match of text.matchAll(/\beyJ[\w-]+\.([\w-]+)\.[\w-]{16,}/g)) {
      try {
        if (JSON.parse(Buffer.from(match[1], 'base64url')).role === 'service_role') {
          findings.push(file);
          break;
        }
      } catch { /* Ordinary text is not a JWT. */ }
    }
  }
  assert.deepEqual(findings, [], 'Restricted credential found in: ' + findings.join(', '));
});
