/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sdk = require('@supabase/supabase-js');
function loadRecovery(url, requests, clients) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/passwordRecovery.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports,URL,require(name) {
    if(name==='@/lib/env') return {env:{supabaseUrl:url,supabasePublishableKey:'test-public-key'}};
    assert.equal(name,'@supabase/supabase-js');
    return {createClient:(url,key,options)=>{
      assert.equal(options.auth.flowType,'implicit');
      assert.equal(options.auth.persistSession,false);
      assert.equal(options.auth.autoRefreshToken,false);
      assert.equal(options.auth.detectSessionInUrl,false);
      const client=sdk.createClient(url,key,{...options,global:{fetch:async (input,init)=>{
        requests.push({url:String(input),body:JSON.parse(init.body)});
        return Response.json({});
      }}}); clients.push(client);return client;
    }};
  }});
  return exports.sendPasswordRecoveryEmail;
}
(async()=>{
  for(const url of ['https://udbijakeasbvoycjyghe.supabase.co','https://ayisjsajufjkebvbzpdr.supabase.co','http://127.0.0.1:54421']) {
    const requests=[],clients=[]; const send=loadRecovery(url,requests,clients);
    assert.equal(await send('student@example.test'),null);
    assert.equal(requests.length,1);
    const request=requests[0]; assert.equal(request.body.email,'student@example.test');
    assert.ok(request.body.code_challenge == null,'No requesting-device verifier may be required');
    const redirect=new URL(request.url).searchParams.get('redirect_to');
    assert.equal(redirect,url.startsWith('http:')?'http://127.0.0.1:54731/reset-password.html':`https://campusclutch--account.expo.app/${new URL(url).hostname.split('.')[0]}/reset-password.html`);
    assert.equal((await clients[0].auth.getSession()).data.session,null);
  }
  console.log('PASS installed Auth SDK sends browser recovery links without PKCE or persisted sessions for all environments');
  const page=fs.readFileSync(path.join(__dirname,'../web/password-recovery/recovery.js'),'utf8');
  assert.ok(page.indexOf('history.replaceState') < page.indexOf('fetch('));
  assert.ok(!/localStorage|sessionStorage|console\./.test(page));
  const app=fs.readFileSync(path.join(__dirname,'../src/lib/supabase.ts'),'utf8');
  assert.match(app,/flowType: "pkce"/);
  console.log('PASS recovery credentials stay out of storage/logs and the main app retains PKCE');
})().catch(error=>{console.error(error);process.exitCode=1});
