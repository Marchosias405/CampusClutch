/* global __dirname */
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');const crypto=require('node:crypto');
// Match React Native's installed runtime, not Node's newer AbortSignal API.
const { AbortController, AbortSignal } = require('abort-controller/dist/abort-controller');
const userId=crypto.randomUUID();const backend='https://fixture.invalid';
function harness() {
 const storage=new Map();const requests=[];const timers=new Map();let nextTimer=0,signouts=0;
 const state={eligible:true,blockers:[],loginError:null,begin:{accepted:true},worker:'complete',failSave:false,failBegin:false,stallAt:null,stallBody:false,httpError:false,invalidBody:false};
 const exports={};
 const mocks={
  '@/lib/crypto':{},'./env':{env:{supabaseUrl:backend,supabasePublishableKey:'public-fixture'}},
  '@react-native-async-storage/async-storage':{getItem:async k=>storage.get(k)??null,setItem:async(k,v)=>{if(state.failSave)throw Error('Storage unavailable');storage.set(k,v);},removeItem:async k=>storage.delete(k),getAllKeys:async()=>[...storage.keys()],multiRemove:async keys=>keys.forEach(k=>storage.delete(k))},
  '@supabase/supabase-js':{createClient:()=>({auth:{signInWithPassword:async()=>({error:state.loginError,data:{user:{id:userId},session:{access_token:'fresh-fixture-token'}}}),signOut:async()=>{signouts++;return {};}}})},
 };
 mocks['./privateDrafts'] = { privateDrafts: { clearAccount: async () => {} } };
 mocks['./credentialStorage']={credentialStorage:mocks['@react-native-async-storage/async-storage']};
 const code=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/lib/accountDeletion.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{assert.ok(name in mocks,name);return mocks[name];},crypto:crypto.webcrypto,Uint8Array,AbortSignal,AbortController,
  setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  fetch:async(url,options)=>{requests.push({url,...options});let value;
   assert.ok(options.signal instanceof AbortSignal,'Use the installed React Native AbortSignal');
   const stalled=()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('Aborted')),{once:true}));
   if(url.endsWith(state.stallAt)&&!state.stallBody)return stalled();
   if(url.endsWith('get_my_account_deletion_preflight'))value={eligible:state.eligible,blockers:state.blockers};
   else if(url.endsWith('begin_my_account_deletion')){assert.equal(storage.size,1,'Receipt must be saved before dispatch');if(state.failBegin)throw Error('Lost response');value=state.begin;}
   else value={status:state.worker};return {ok:!state.httpError,json:async()=>{
    if(state.invalidBody)throw Error('Invalid JSON');
    if(url.endsWith(state.stallAt)&&state.stallBody)return stalled();
    return value;
   }};
  }});
 return {api:exports,state,storage,requests,timers,signouts:()=>signouts};
}
(async()=>{
 let h=harness(), saved=null,rejected=false;
 const run=()=>h.api.confirmAccountDeletion(userId,'fixture@example.test','private-fixture-password',saved,x=>{saved=x;},()=>{saved=null;rejected=true;});
 h.state.loginError=Error('Invalid');await assert.rejects(run,/Check your password/);assert.equal(h.requests.length,0);assert.equal(h.storage.size,0);
 h.state.loginError=null;h.state.eligible=false;h.state.blockers=['accepted_jobs'];await assert.rejects(run,/Finish or cancel/);assert.equal(h.storage.size,0);assert.ok(h.signouts()>0);
 h.state.eligible=true;h.state.failSave=true;await assert.rejects(run,/Storage unavailable/);assert.ok(h.requests.every(r=>!r.url.endsWith('begin_my_account_deletion')));
 h.state.failSave=false;h.state.failBegin=true;await assert.rejects(run,/Unable to confirm deletion/);assert.equal(h.storage.size,1);assert.match(saved.secret,/^[0-9a-f]{64}$/);
 assert.deepEqual(JSON.parse(JSON.stringify(await h.api.readDeletionReceipt())),JSON.parse(JSON.stringify(saved)));
 assert.ok(![...h.storage.values()].some(v=>v.includes('password')||v.includes('fixture-token')));
 h.state.failBegin=false;const original=saved.id;await run();assert.equal(saved.id,original);
 assert.equal(await h.api.finishAccountDeletion(saved),'complete');assert.equal(JSON.parse(h.requests.at(-1).body).id,original);
 const other=crypto.randomUUID();const ownKey=`campusclutch:message-draft:v1:${encodeURIComponent(backend)}:${userId}:chat`;
 const otherKey=ownKey.replace(userId,other);h.storage.set(ownKey,'draft');h.storage.set(otherKey,'other draft');h.storage.set('unrelated','value');
 const requestKey=`campusclutch:request-draft:v1:${backend}:${userId}:new`;
 const targetKey=`campusclutch:report-draft:v1:${encodeURIComponent(backend)}:${other}:student:${userId}`;
 h.storage.set(requestKey,'own request');h.storage.set(targetKey,'other student reporting this user');
 await h.api.clearDeletedAccountDrafts(userId);assert.equal(h.storage.has(requestKey),false);assert.equal(h.storage.get(targetKey),'other student reporting this user');assert.equal(h.storage.has(ownKey),false);assert.equal(h.storage.get(otherKey),'other draft');assert.equal(h.storage.get('unrelated'),'value');
 await h.api.clearDeletionReceipt();assert.equal(await h.api.readDeletionReceipt(),null);
 h=harness();saved=null;h.state.begin={accepted:false,blockers:['staff_access']};await assert.rejects(run,/admin handover/);assert.equal(rejected,true);assert.equal(h.storage.size,0);
 assert.equal(h.timers.size,0,'No pending timeout after blocker response');
 // Test each timeout with the same AbortSignal implementation bundled on Android.
 for(const stage of ['get_my_account_deletion_preflight','begin_my_account_deletion','account-deletion']) {
  for(const stallBody of [false,true]) {
   h=harness();saved=null;h.state.stallAt=stage;h.state.stallBody=stallBody;
   const worker=stage==='account-deletion';
   if(worker)await run();
   const pending=worker?h.api.finishAccountDeletion(saved):run();
   const failed=assert.rejects(pending,worker?/Unable to check deletion status/:/Unable to confirm deletion/);
   await new Promise(setImmediate);
   assert.equal(h.timers.size,1,'Timeout remains active through request and body');
   const timer=[...h.timers.values()][0];assert.equal(timer.ms,worker?30000:20000);timer.fn();
   await failed;assert.equal(h.timers.size,0,'Abort clears its timer');
   if(stage==='get_my_account_deletion_preflight') {
    assert.equal(saved,null);assert.equal(h.storage.size,0);assert.equal(h.signouts(),1);
    assert.equal(h.requests.length,1,'Timed-out preflight must not authorize deletion');
   } else {
    assert.ok(saved,'Potentially accepted deletion retains its recovery receipt');
    const original=JSON.stringify(saved);assert.equal(JSON.stringify(await h.api.readDeletionReceipt()),original);
    h.state.stallAt=null;
    assert.equal(await h.api.finishAccountDeletion(saved),'complete');
    assert.equal(JSON.stringify(saved),original,'Recovery reuses the receipt');
   }
   assert.equal(h.timers.size,0);
  }
 }
 for(const failure of ['httpError','invalidBody']) {
  h=harness();saved=null;h.state[failure]=true;
  await assert.rejects(run,/Unable to confirm deletion/);assert.equal(h.timers.size,0);assert.equal(h.storage.size,0);
  h.state[failure]=false;await run();assert.equal(h.timers.size,0);
  h.state[failure]=true;
  await assert.rejects(h.api.finishAccountDeletion(saved),/Unable to check deletion status/);
  assert.equal(h.timers.size,0);assert.ok(await h.api.readDeletionReceipt());
 }
 console.log('PASS deletion client: Android runtime, confirmation, blockers, receipt recovery, scoped cleanup, six timeout cases and HTTP/body failures');
})().catch(e=>{console.error(e);process.exitCode=1;});
