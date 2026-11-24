/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const id = n => `e4140000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, modules) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code,{ exports, require: name => { assert.ok(name in modules,name); return modules[name]; } });
  return exports;
}
const reports = load('src/lib/safetyReports.ts', { './offers': {}, './supabase': {} });
let response, calls=[];
const moderation = { decisionValidation: note => Array.from(note.trim()).length < 10 || Array.from(note.trim()).length > 2000,
  moderationRpc: async (...args) => { calls.push(plain(args)); return response; }, moderationAccessLost: e => e.code==='42501', moderationCode: e => e.code };
const api=load('src/lib/moderationEnforcement.ts', { './moderation':moderation,'./safetyReports':reports });
const modelApi=load('src/lib/moderationEnforcementDraft.ts', { './moderation':moderation,'./moderationEnforcement':api,
  './safetyReports':reports,'./env':{ env:{ supabaseUrl:'https://example.test' } },'@react-native-async-storage/async-storage':{default:{}} });
const fields={expectedVersion:2,kind:'warn',reason:'Please follow the community rules.',reviewUpdatedAt:null};
const receipt={action_id:id(8),kind:'warn',automatic_suspension:false,suspended_until:null,warning_count:1};
let serial=0, checks=0;
function fixture() {
  const entries=new Map(), sent=[];
  let fail=false, storageFail=false;
  const overrides={namespace:'https://test-'+(++serial)+'.local',randomUUID:()=>id(4),
    storage:{getItem:async k=>entries.get(k)??null,setItem:async(k,v)=>{if(storageFail)throw Error('disk');entries.set(k,v);},removeItem:async k=>entries.delete(k)},
    send:async(u,a)=>{assert.equal(entries.size,1);sent.push(plain(a));if(fail)throw Object.assign(Error('network'),{code:fail});return receipt;} };
  return {entries,sent,create:(user=id(1),backend=overrides.namespace)=>modelApi.createModerationEnforcement(user,id(2),{...overrides,namespace:backend}),
    fail:v=>{fail=v;},storageFail:v=>{storageFail=v;}};
}
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
  await test('enforcement validation and receipt projection reject invalid actions and preserve exact fields',async()=>{
    const attempt={...fields,reportId:id(2),operationId:id(4)};
    for(const change of [{kind:'ban_forever'},{expectedVersion:-1},{reason:'tiny'},{kind:'remove_review',reviewUpdatedAt:null}]) assert.throws(()=>api.normalizeEnforcement({...attempt,...change}));
    response={...receipt,subject_id:id(7)};
    assert.deepEqual(plain(await api.enforceReport(id(1),attempt)),receipt);
    assert.equal(calls[0][2].p_kind,'warn');
    response={...receipt,kind:'remove_review'};await assert.rejects(api.enforceReport(id(1),attempt));
  });
  await test('current review and action history never forward author or staff identities',async()=>{
    response={version:3,is_admin:true,can_act:true,warning_count:2,suspended_until:null,review_removed:false,review_updated_at:'2026-11-11T00:00:00Z',
      current_review:{comment:'Review text',difficulty:4,workload:5,grade:'B',tips:'',instructor:'',author_id:id(9)},
      actions:[{id:id(8),kind:'warn',reason:fields.reason,created_at:'2026-11-11T00:00:00Z',automatic_suspension:false,suspended_until:null,actor_id:id(9)}],subject_id:id(9)};
    const output=await api.getEnforcementContext(id(1),id(2));
    assert.equal(JSON.stringify(output).includes(id(9)),false);assert.equal(output.current_review.difficulty,4);
  });
  await test('response loss survives restart and retries the same warning exactly once',async()=>{
    const f=fixture();f.fail('network');const first=f.create();await first.restore();await first.submit(fields);first.dispose();
    const next=f.create();await next.restore();assert.equal(next.getState().pending.reason,fields.reason);
    f.fail(false);await next.submit({...fields,kind:'suspend_7_days'});
    assert.deepEqual(f.sent[0],f.sent[1]);assert.equal(next.getState().receipt.warning_count,1);assert.equal(f.entries.size,0);
  });
  await test('pending actions cannot cross accounts or backends',async()=>{
    const f=fixture();f.fail('network');const model=f.create();await model.restore();await model.submit(fields);
    for(const other of [f.create(id(9)),f.create(id(1),'https://different.test')]){await other.restore();assert.equal(other.getState().pending,null);}
  });
  await test('storage failure sends nothing; concurrent clicks reuse one saved operation',async()=>{
    const f=fixture();const model=f.create();await model.restore();f.storageFail(true);await model.submit(fields);assert.equal(f.sent.length,0);
    f.storageFail(false);await Promise.all([model.submit(fields),model.submit(fields)]);assert.equal(f.sent.length,1);
  });
  await test('only a confirmed conflict permits abandoning an unconfirmed enforcement action',async()=>{
    const f=fixture();const model=f.create();await model.restore();f.fail('network');await model.submit(fields);
    assert.equal(await model.clearConflict(),false);f.fail('PT409');await model.submit();assert.equal(await model.clearConflict(),true);assert.equal(f.entries.size,0);
  });
  await test('live access loss retains action but stops further dispatch',async()=>{
    const f=fixture();const model=f.create();await model.restore();f.fail('42501');await model.submit(fields);await model.submit();
    assert.equal(model.getState().accessLost,true);assert.equal(f.sent.length,1);assert.equal(f.entries.size,1);
  });
  console.log(`Moderation enforcement client checks passed: ${checks}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
