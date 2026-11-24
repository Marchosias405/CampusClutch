const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { createStudentFixture, cleanupStudentFixtures, localClientConfig, localSql } = require('./local-student-fixtures.cjs');
const { handle, readMailLink, cleanupMail } = require('./email-link-test-helpers.cjs');
const { url, key } = localClientConfig();
const callback = `${url}/functions/v1/email-verified`;
const fixtures = [], emails = new Set();
const fresh = () => createClient(url, key, { auth: { flowType: 'pkce', autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
function fixture() { const value = createStudentFixture(); fixtures.push(value); return value; }
async function signup(client, user) {
  const result = await client.auth.signUp({ ...user, options: { emailRedirectTo: callback } });
  assert.equal(result.error, null); assert.equal(result.data.session, null, 'Email confirmations must be enabled');
  return readMailLink(user.email, emails);
}
async function openLink(link) {
  // A browser with no app cookies, password or PKCE storage follows the link.
  const result = await fetch(link, { redirect: 'manual' });
  assert.equal(result.status, 303);
  const target = new URL(result.headers.get('location'));
  assert.equal(target.origin + target.pathname, callback);
  const page = await fetch(target);
  assert.equal(page.status, 200);
  const text = await page.text();
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(!text.includes(target.searchParams.get('code') || 'not-a-code'));
  return { target, text };
}
async function main() {
  const phone = fresh(), user = fixture();
  const link = await signup(phone, user);
  assert.ok((await phone.auth.signInWithPassword(user)).error, 'Unconfirmed users cannot sign in');
  const success = await openLink(link);
  assert.ok(success.target.searchParams.get('code')); assert.match(success.text, /Email verification complete/);
  assert.equal((await phone.auth.getSession()).data.session, null, 'The email reader cannot sign in the app implicitly');
  assert.equal((await phone.auth.signInWithPassword(user)).error, null);
  assert.ok((await phone.auth.getUser()).data.user.email_confirmed_at);
  console.log('PASS PKCE signup confirms from another device and the original phone signs in with its password');

  assert.equal((await fresh().auth.signInWithPassword(user)).error, null, 'Sign-in works without the original PKCE state');
  const replay = await openLink(link); assert.match(replay.text, /expired or already been opened/);
  assert.equal((await fresh().auth.signInWithPassword(user)).error, null, 'Reopening a used link cannot undo verification');
  console.log('PASS app restart and repeated email-link opening remain recoverable');

  const resendUser = fixture(); await signup(fresh(), resendUser);
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal((await fresh().auth.resend({ type: 'signup', email: resendUser.email, options: { emailRedirectTo: callback } })).error, null);
  const resendLink = await readMailLink(resendUser.email, emails);
  assert.match((await openLink(resendLink)).text, /Email verification complete/);
  assert.equal((await fresh().auth.signInWithPassword(resendUser)).error, null);
  console.log('PASS a fresh app can resend an unconfirmed account link to the browser callback');

  const expiring = fixture(); const oldLink = await signup(fresh(), expiring);
  localSql(`update auth.users set confirmation_sent_at = now() - interval '2 hours' where email = '${expiring.email}';`);
  assert.match((await openLink(oldLink)).text, /expired or already been opened/);
  assert.ok((await fresh().auth.signInWithPassword(expiring)).error);
  const unknown = fixture(); await fresh().auth.resend({ type: 'signup', email: unknown.email, options: { emailRedirectTo: callback } });
  assert.equal(localSql(`select count(*) from auth.users where email = '${unknown.email}';`), '0');
  console.log('PASS expired links fail safely and resend does not create an account');

  for (const query of ['', '?code=fake-private-value', '?error_description=private-error&code=fake-private-value']) {
    const response = handle(new Request(callback + query)); const text = await response.text();
    assert.ok(!text.includes('fake-private-value')); assert.ok(!text.includes('private-error'));
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  }
  assert.equal(handle(new Request(callback, { method: 'POST' })).status, 405);
  assert.equal(await handle(new Request(callback, { method: 'HEAD' })).text(), '');
  console.log('PASS public callback is informational, uncached, and does not expose tokens or provider errors');

  const reset = fresh();
  assert.equal((await reset.auth.resetPasswordForEmail(user.email, { redirectTo: 'campusclutch://auth/reset-password' })).error, null);
  const recovery = await readMailLink(user.email, emails);
  const response = await fetch(recovery, { redirect: 'manual' }); const target = new URL(response.headers.get('location'));
  assert.equal(target.protocol, 'campusclutch:'); assert.equal(target.pathname, '/reset-password');
  assert.equal((await reset.auth.exchangeCodeForSession(target.searchParams.get('code'))).error, null);
  console.log('PASS password recovery retains its original PKCE link and session exchange');
}
main().finally(async () => { cleanupStudentFixtures(fixtures); await cleanupMail(emails); console.log('Test accounts and emails removed.'); })
  .catch(error => { console.error(error); process.exitCode = 1; });
