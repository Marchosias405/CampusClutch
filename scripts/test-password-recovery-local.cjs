/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright-core');
const serveStatic = require('serve-static');
const { buildRecoverySite } = require('./build-password-recovery-site.cjs');
const { createStudentFixture, cleanupStudentFixtures, localClientConfig, localSql } = require('./local-student-fixtures.cjs');
const { readMailLink, cleanupMail } = require('./email-link-test-helpers.cjs');
const vm = require('node:vm');
const ts = require('typescript');
const {url,key} = localClientConfig();
const fresh=()=>createClient(url,key,{auth:{flowType:'pkce',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const recoveryExports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/passwordRecovery.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:recoveryExports,URL,require(name){
  if(name==='@/lib/env') return {env:{supabaseUrl:url,supabasePublishableKey:key}};
  assert.equal(name,'@supabase/supabase-js');return {createClient};
}});
const origin='http://127.0.0.1:54731',target=origin+'/reset-password.html';
const fixtures=[],emails=new Set();
async function student(){
  const user=createStudentFixture();fixtures.push(user);
  const signup=await fresh().auth.signUp(user);assert.equal(signup.error,null);
  if(!signup.data.session){await readMailLink(user.email,emails);localSql(`update auth.users set email_confirmed_at=now() where email='${user.email}';`);}
  return user;
}
async function resetLink(user){assert.equal(await recoveryExports.sendPasswordRecoveryEmail(user.email),null);return readMailLink(user.email,emails);}
async function fill(page,password,confirm=password){await page.getByLabel('New password',{exact:true}).fill(password);await page.getByLabel('Confirm new password',{exact:true}).fill(confirm);}
async function main(){
  const output=path.resolve('.expo/password-recovery-site');
  const {headers}=buildRecoverySite(output,[{url,key,directory:''}]);
  const files=serveStatic(output,{setHeaders(res){for(const [name,value] of Object.entries(headers))res.setHeader(name,value);}});
  const server=http.createServer((req,res)=>files(req,res,()=>res.writeHead(404).end()));
  server.listen(54731,'127.0.0.1');await once(server,'listening');
  let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});
    const user=await student(),link=await resetLink(user),newPassword=randomBytes(24).toString('hex');
    const original = fresh();
    const priorLogin = await original.auth.signInWithPassword(user);
    assert.ok(!priorLogin.error && priorLogin.data.session, 'Fixture has a prior device session');
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let puts = 0;
    let recoverySessionId;
    let accessLifetime;
    page.on('request', request => {
      if (request.method() === 'PUT') puts++;
      if (request.url() === url + '/auth/v1/user' && request.method() === 'GET') {
        const jwt = request.headers().authorization.split('.')[1];
        const claims = JSON.parse(Buffer.from(jwt, 'base64url').toString());
        recoverySessionId = claims.session_id;
        accessLifetime = claims.exp - claims.iat;
      }
    });
    await page.goto(link);await page.getByLabel('New password',{exact:true}).waitFor();
    assert.equal(page.url(),target,'Link credentials are removed from URL/history');
    assert.match(recoverySessionId, /^[0-9a-f-]{36}$/);
    function recoverySessionCount() {
      return localSql(`select count(*) from auth.sessions s join auth.users u on u.id = s.user_id
        where s.id = '${recoverySessionId}' and u.email = '${user.email}';`);
    }
    assert.equal(recoverySessionCount(), '1');
    assert.ok(accessLifetime > 0, 'Access-token lifetime is measured separately from session revocation');
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    assert.equal((await context.cookies()).length,0);
    await fill(page,'short');await page.getByRole('button',{name:'Save new password'}).click();
    await page.getByText('Use a password with 8 to 128 characters.').waitFor();assert.equal(puts,0);
    await fill(page,newPassword,'mismatch');await page.getByRole('button',{name:'Save new password'}).click();
    await page.getByText('The passwords do not match.').waitFor();assert.equal(puts,0);
    await fill(page,newPassword);await page.setViewportSize({width:320,height:360});
    await page.getByRole('button',{name:'Save new password'}).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'.expo/password-reset-form.png',fullPage:true});
    await context.setOffline(true);await page.getByRole('button',{name:'Save new password'}).click();
    await page.getByText(/We could not confirm the change/).waitFor();await context.setOffline(false);
    const before=puts;
    let signouts = 0;
    await page.route('**/auth/v1/logout?scope=global', async route => {
      signouts++;
      if (signouts === 1) return route.fulfill({status:503, json:{message:'Temporarily unavailable'}});
      if (signouts === 2) return route.fulfill({status:401, json:{code:'bad_jwt'}});
      if (signouts === 3) {
        const response = await route.fetch();
        assert.ok(response.ok(), 'Auth accepted the real logout');
        return route.abort();
      }
      return route.continue();
    });
    await page.getByRole('button',{name:'Save new password'}).evaluate(button=>{button.click();button.click();});
    const retry = page.getByRole('button', {name:'Retry sign-out'});
    const pending = page.getByText(/Keep this page open and retry sign-out/);
    await pending.waitFor();
    assert.ok(await page.locator('#form').isHidden());
    assert.equal(await page.locator('#password').inputValue(), '');
    assert.ok(await page.getByRole('heading',{name:'Password updated'}).isHidden());
    assert.equal(recoverySessionCount(), '1');
    const renewal = await original.auth.refreshSession();
    assert.ok(renewal.error && !renewal.data.session, 'The previously signed-in device must sign in again on renewal');
    assert.ok(['refresh_token_not_found','refresh_token_already_used','session_not_found'].includes(renewal.error.code),
      'Auth rejected the previous device credential');
    await retry.click();
    await pending.waitFor();
    assert.equal(signouts, 2);
    assert.equal(recoverySessionCount(), '1', 'A generic authorization error does not confirm revocation');
    await retry.evaluate(button=>{button.click();button.click();});
    await pending.waitFor();
    assert.equal(signouts, 3);
    assert.equal(recoverySessionCount(), '0', 'Auth retired the session even though the response was lost');
    await retry.click();
    await page.getByRole('heading',{name:'Password updated'}).waitFor();
    assert.ok(await retry.isHidden());
    assert.equal(signouts, 4);
    assert.equal(puts-before,1,'Duplicate submissions are ignored');
    assert.ok((await fresh().auth.signInWithPassword(user)).error,'Old password no longer works');
    assert.equal((await fresh().auth.signInWithPassword({...user,password:newPassword})).error,null,'A fresh phone signs in with the new password');
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    assert.equal(await page.locator('#password').inputValue(),'');
    assert.deepEqual(errors,[]);
    await page.screenshot({path:'.expo/password-reset-success.png',fullPage:true});
    console.log('PASS real recovery email, validation, single password update, interrupted sign-out, retry after retirement and prior-device renewal. Local access-token lifetime in seconds:', accessLifetime);
    await page.reload();await page.getByText(/This reset link has expired or was already used/).waitFor();assert.ok(await page.locator('#form').isHidden());
    const replay=await context.newPage();await replay.goto(link);await replay.getByText(/This reset link has expired or was already used/).waitFor();
    assert.equal(replay.url(),target);assert.ok(await replay.locator('#form').isHidden());
    console.log('PASS refresh/replayed links cannot reopen the recovery form or retain a browser session');
    const expired=await student(),expiredLink=await resetLink(expired);
    localSql(`update auth.users set recovery_sent_at=now()-interval '2 hours' where email='${expired.email}';`);
    await replay.goto(expiredLink);await replay.getByText(/This reset link has expired or was already used/).waitFor();
    assert.ok(await replay.locator('#form').isHidden());assert.equal((await fresh().auth.signInWithPassword(expired)).error,null);
    const invalid=await context.newPage();await invalid.goto(target+'#access_token=invalid&type=recovery&refresh_token=never-store');
    await invalid.getByText(/This reset link has expired or was already used/).waitFor();assert.ok(await invalid.locator('#form').isHidden());
    await invalid.goto(target+'#access_token=invalid&type=signup');await invalid.getByText(/This reset link has expired or was already used/).waitFor();
    console.log('PASS expired, invalid and non-recovery links fail safely without changing the password');
    const lost=await student(),lostLink=await resetLink(lost),lostPassword=randomBytes(24).toString('hex');
    const lostPage=await context.newPage();await lostPage.goto(lostLink);await lostPage.getByLabel('New password',{exact:true}).waitFor();
    let interrupted=false;await lostPage.route('**/auth/v1/user',async route=>{
      if(route.request().method()==='PUT'&&!interrupted){interrupted=true;await route.fetch();await route.abort();}else await route.continue();
    });
    await fill(lostPage,lostPassword);await lostPage.getByRole('button',{name:'Save new password'}).click();
    await lostPage.getByText(/We could not confirm the change/).waitFor();
    assert.equal((await fresh().auth.signInWithPassword({...lost,password:lostPassword})).error,null);
    await lostPage.getByRole('button',{name:'Save new password'}).click();await lostPage.getByText(/Choose a different password/).waitFor();
    console.log('PASS a lost response explains recovery accurately and preserves the successfully changed password');
    const normal = await student();
    const cleanPage = await context.newPage();
    await cleanPage.goto(await resetLink(normal));
    await fill(cleanPage, randomBytes(24).toString('hex'));
    await cleanPage.getByRole('button', {name:'Save new password'}).click();
    await cleanPage.getByRole('heading', {name:'Password updated'}).waitFor();
    assert.ok(await cleanPage.locator('#retry-signout').isHidden());
    assert.equal(localSql(`select count(*) from auth.sessions s join auth.users u on s.user_id = u.id where u.email = '${normal.email}';`), '0');
    console.log('PASS uninterrupted reset confirms session retirement and needs no retry');
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));cleanupStudentFixtures(fixtures);await cleanupMail(emails);}
}
main().catch(error=>{console.error(error);process.exitCode=1});
