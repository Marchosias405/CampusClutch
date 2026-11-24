/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const id = n => `d1a00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, modules, extra = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, ...extra });
  return exports;
}
const reports = load('src/lib/safetyReports.ts', { './offers': {}, './supabase': {} });
let response, failure, calls = [];
const moderation = { decisionValidation: reason => reason.trim().length < 10 || reason.trim().length > 2000,
  moderationAccessLost: e => e.code === '42501', moderationCode: e => e.code,
  moderationRpc: async (...args) => { calls.push(plain(args)); if (failure) throw Object.assign(Error('offline'), { code: failure }); return response; } };
const enforcement = load('src/lib/moderationEnforcement.ts', { './moderation': moderation, './safetyReports': reports });
const entries = new Map();
let diskFailure = false, serial = 800;
const storage = { getItem: async k => entries.get(k) ?? null, setItem: async (k,v) => { if (diskFailure) throw Error('disk'); entries.set(k,v); }, removeItem: async k => entries.delete(k) };
const draft = load('src/lib/moderationEnforcementDraft.ts', { './moderation': moderation, './moderationEnforcement': enforcement,
  './safetyReports': reports, './env': { env: { supabaseUrl: 'https://test.invalid' } }, '@react-native-async-storage/async-storage': storage },
  { globalThis: { crypto: { randomUUID: () => id(++serial) } } });
const api = load('src/lib/directModeration.ts', { './moderation': moderation, './moderationEnforcement': enforcement,
  './moderationEnforcementDraft': draft, './env': { env: { supabaseUrl: 'https://test.invalid' } }, './safetyReports': reports });
const stamp = '2026-11-14T12:00:00Z';
const attempt = { reportId: id(2), operationId: id(4), expectedVersion: 0, kind: 'remove_request', reason: 'The request violates our rules.', reviewUpdatedAt: stamp };
const receipt = { action_id: id(9), kind: 'remove_request', warning_count: 0, automatic_suspension: false, suspended_until: null };
let checks=0;
async function test(name, fn) { failure=null; calls=[]; entries.clear(); diskFailure=false; await fn(); console.log('PASS '+name); checks++; }
(async()=>{
  await test('review context includes ratings but strips author and private identities',async()=>{
    response={label:'CMPT 120',updated_at:stamp,warning_count:2,suspended_until:null,subject_id:id(7),evidence:{course_code:'CMPT 120',difficulty:4,workload:5,comment:'Review text',author_id:id(7)}};
    const result=await api.getDirectContext(id(1),'course_review',id(2));
    assert.equal(JSON.stringify(result).includes(id(7)),false);assert.ok(result.evidence.some(item=>item.label==='Workload / 5'&&item.value==='5'));
  });
  await test('untrusted context and routes are rejected before use',async()=>{
    await assert.rejects(api.getDirectContext(id(1),'message',id(2)));assert.equal(calls.length,0);
    response={label:'Target',updated_at:'bad',warning_count:0,suspended_until:null,evidence:{}};
    await assert.rejects(api.getDirectContext(id(1),'request',id(2)));
  });
  await test('only matching actions with content timestamp and explanation are dispatched',async()=>{
    for(const value of [{...attempt,reviewUpdatedAt:null},{...attempt,reason:'tiny'},{...attempt,kind:'remove_review'}]) await assert.rejects(api.takeDirectAction(id(1),'request',value));
    assert.equal(calls.length,0);response={...receipt,subject_id:id(7)};
    assert.deepEqual(plain(await api.takeDirectAction(id(1),'request',attempt)),receipt);
    assert.equal(calls[0][2].p_updated_at,stamp);assert.equal(calls[0][2].p_target_id,id(2));
  });
  await test('malformed action receipts cannot be mistaken for success',async()=>{
    response={...receipt,kind:'warn'};await assert.rejects(api.takeDirectAction(id(1),'request',attempt));
    response={...receipt,warning_count:-1};await assert.rejects(api.takeDirectAction(id(1),'request',attempt));
  });
  await test('lost response is retried after restart with exact operation and content version',async()=>{
    failure='network';const a=api.createDirectAction(id(1),'request',id(2));await a.restore();await a.submit(attempt);a.dispose();
    const b=api.createDirectAction(id(1),'request',id(2));await b.restore();assert.equal(b.getState().pending.kind,'remove_request');
    failure=null;response=receipt;await b.submit({...attempt,reason:'Changed reason must not be sent.'});
    assert.deepEqual(calls[0],calls[1]);assert.equal(b.getState().receipt.kind,'remove_request');assert.equal(entries.size,0);
  });
  await test('pending actions stay isolated by account and target type',async()=>{
    failure='network';const a=api.createDirectAction(id(1),'request',id(2));await a.restore();await a.submit(attempt);
    for(const b of [api.createDirectAction(id(3),'request',id(2)),api.createDirectAction(id(1),'course_review',id(2))]){await b.restore();assert.equal(b.getState().pending,null);}
  });
  await test('no action is sent if durable save fails, double taps submit once',async()=>{
    const a=api.createDirectAction(id(1),'request',id(2));await a.restore();diskFailure=true;await a.submit(attempt);assert.equal(calls.length,0);
    diskFailure=false;response=receipt;await Promise.all([a.submit(attempt),a.submit(attempt)]);assert.equal(calls.length,1);
  });
  await test('definitive stale-content conflict permits reload, ambiguous failure does not',async()=>{
    const a=api.createDirectAction(id(1),'request',id(2));await a.restore();failure='network';await a.submit(attempt);assert.equal(await a.clearConflict(),false);
    failure='PT409';await a.submit();assert.equal(await a.clearConflict(),true);assert.equal(entries.size,0);
  });
  await test('revoked role stops dispatch and retains exact attempt',async()=>{
    const a=api.createDirectAction(id(1),'request',id(2));await a.restore();failure='42501';await a.submit(attempt);await a.submit();
    assert.equal(calls.length,1);assert.equal(a.getState().accessLost,true);assert.equal(entries.size,1);
  });
  await test('entry hook hides non-admins and rejects retained handlers after revocation/background',async()=>{
    let access={status:'allowed',role:'admin'};const navigations=[];const ref={current:false};const appState={currentState:'active'};
    const hook=load('src/lib/useDirectAdmin.ts',{'react':{useRef:()=>ref},'react-native':{AppState:appState},'expo-router':{useRouter:()=>({push:v=>navigations.push(v)})},'./useModerationAccess':{useModerationAccess:()=>access}});
    const a=hook.useDirectAdmin(id(1));assert.equal(a.allowed,true);a.open('request',id(2));assert.equal(navigations.length,1);
    appState.currentState='background';a.open('request',id(2));assert.equal(navigations.length,1);appState.currentState='active';
    access={status:'allowed',role:'moderator'};assert.equal(hook.useDirectAdmin(id(1)).allowed,false);a.open('request',id(2));assert.equal(navigations.length,1);
  });
  console.log(`Direct moderation client checks passed: ${checks}`);
})().catch(e=>{console.error(e);process.exitCode=1;});
