/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root=path.resolve(__dirname,'..'), id=n=>`e4140000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const plain=v=>JSON.parse(JSON.stringify(v));
function load(file,modules){const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>{assert.ok(name in modules,name);return modules[name];}});return exports;}
const reports=load('src/lib/safetyReports.ts',{'./offers':{},'./supabase':{}});
let response,calls=[];
const moderation={decisionValidation:v=>Array.from(v.trim()).length<10||Array.from(v.trim()).length>2000,
  moderationRpc:async(...args)=>{calls.push(plain(args));return response;},moderationAccessLost:e=>e.code==='42501',moderationCode:e=>e.code};
const enforcement=load('src/lib/moderationEnforcement.ts',{'./moderation':moderation,'./safetyReports':reports});
const api=load('src/lib/moderationAppeals.ts',{'./moderation':moderation,'./moderationEnforcement':enforcement,'./safetyReports':reports});
const modelApi=load('src/lib/appealOperation.ts',{'./moderation':moderation,'./moderationAppeals':api,'./safetyReports':reports,
  './env':{env:{supabaseUrl:'https://example.test'}},'@react-native-async-storage/async-storage':{default:{}}});
const fields={expectedVersion:0,outcome:'upheld',reason:'Please reconsider the context of this decision.'};
const attempt={...fields,targetId:id(2),operationId:id(4),kind:'submit'};
let serial=0,checks=0;
function fixture(){const entries=new Map(),sent=[];let fail=false,storageFail=false;
  const overrides={namespace:'https://test-'+(++serial)+'.local',randomUUID:()=>id(4),storage:{getItem:async k=>entries.get(k)??null,
    setItem:async(k,v)=>{if(storageFail)throw Error('disk');entries.set(k,v);},removeItem:async k=>entries.delete(k)},
    send:async(u,a)=>{assert.ok(entries.size);sent.push(plain(a));if(fail)throw Object.assign(Error('network'),{code:fail});return id(8);}};
  return {entries,sent,create:(user=id(1),target=id(2),kind='submit',backend=overrides.namespace)=>modelApi.createAppealOperation(user,target,kind,{...overrides,namespace:backend}),fail:v=>{fail=v;},storageFail:v=>{storageFail=v;}};}
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
  await test('appeal validation rejects unsupported actions, malformed IDs and invalid decisions before sending',async()=>{
    for(const change of [{kind:'other'},{expectedVersion:-1},{outcome:'pending'},{reason:'tiny'},{reason:'a'.repeat(2001)},{targetId:'bad'}])assert.throws(()=>api.normalizeAppealAttempt({...attempt,...change}));
    calls=[];response=id(8);assert.equal(await api.sendAppealAttempt(id(1),attempt),id(8));
    assert.equal(calls[0][1],'submit_moderation_appeal');assert.equal(calls[0][2].p_explanation,fields.reason);
    response={id:id(8),outcome:'overturned',effect:'Applied'};await assert.rejects(api.sendAppealAttempt(id(1),{...attempt,kind:'resolve'}));
    response={id:id(8),outcome:'upheld',effect:'Unchanged',private_subject:id(9)};assert.equal(await api.sendAppealAttempt(id(1),{...attempt,kind:'resolve'}),id(8));
  });
  await test('student and admin projections exclude private identities and reject malformed pages',async()=>{
    const stamp='2026-11-12T00:00:00Z';response=[{id:id(2),created_at:stamp,kind:'warn',reason:'Reason',revoked_at:null,automatic_suspension:false,
      reporter_id:id(9),appeal:{id:id(8),explanation:'Explanation',status:'upheld',created_at:stamp,decision_reason:'Decision',effect:'Unchanged',admin_id:id(9)}}];
    assert.equal(JSON.stringify(await api.listOwnActions(id(1))).includes(id(9)),false);
    response={id:id(8),kind:'warn',status:'pending',created_at:stamp,version:0,explanation:'Explanation',action_id:id(2),action_reason:'Reason',
      action_created_at:stamp,report_id:id(3),original_admin:false,revoked_at:null,decision_reason:null,effect:null,reporter_id:id(9)};
    assert.equal(JSON.stringify(await api.getAppeal(id(1),id(8))).includes(id(9)),false);
    response={...response,original_admin:null};await assert.rejects(api.getAppeal(id(1),id(8)));
    response=Array(21).fill({});await assert.rejects(api.listOwnActions(id(1)));await assert.rejects(api.listAppeals(id(1),'pending'));
  });
  for(const kind of ['submit','resolve'])await test(kind+' response loss survives restart and retries exact saved payload',async()=>{
    const f=fixture();f.fail('network');const first=f.create(id(1),id(2),kind);await first.restore();await first.submit(fields);first.dispose();
    const next=f.create(id(1),id(2),kind);await next.restore();assert.equal(next.getState().pending.reason,fields.reason);
    f.fail(false);await next.submit({...fields,outcome:'overturned',reason:'Changed draft must never replace a saved attempt.'});
    assert.deepEqual(f.sent[0],f.sent[1]);assert.equal(next.getState().receipt,id(8));assert.equal(f.entries.size,0);
  });
  await test('pending appeals are isolated by account, backend, target and action kind',async()=>{
    const f=fixture();f.fail('network');const model=f.create();await model.restore();await model.submit(fields);
    for(const other of [f.create(id(9)),f.create(id(1),id(9)),f.create(id(1),id(2),'resolve'),f.create(id(1),id(2),'submit','https://other.test')]){await other.restore();assert.equal(other.getState().pending,null);}
  });
  await test('storage failure sends nothing and simultaneous taps dispatch only once',async()=>{
    const f=fixture();const model=f.create();await model.restore();f.storageFail(true);await model.submit(fields);assert.equal(f.sent.length,0);
    f.storageFail(false);await Promise.all([model.submit(fields),model.submit(fields)]);assert.equal(f.sent.length,1);
  });
  await test('uncertain attempts cannot be discarded; a confirmed conflict can refresh the final result',async()=>{
    const f=fixture();const model=f.create();await model.restore();f.fail('network');await model.submit(fields);assert.equal(await model.clearConflict(),false);
    f.fail('PT409');await model.submit();assert.equal(await model.clearConflict(),true);assert.equal(f.entries.size,0);
  });
  await test('revoked access prevents retries and malformed saved payloads fail closed',async()=>{
    const f=fixture();const model=f.create();await model.restore();f.fail('42501');await model.submit(fields);await model.submit();
    assert.equal(model.getState().accessLost,true);assert.equal(f.sent.length,1);
    const [key]=f.entries.keys();f.entries.set(key,'{broken');const restored=f.create();await restored.restore();await restored.submit(fields);
    assert.equal(restored.getState().ready,false);assert.equal(f.sent.length,1);
  });
  await test('background and disposed editors cannot dispatch',async()=>{
    const f=fixture();const model=f.create();await model.restore();model.setActive(false);await model.submit(fields);assert.equal(f.sent.length,0);
    model.setActive(true);model.dispose();await model.submit(fields);assert.equal(f.sent.length,0);
  });
  console.log(`Moderation appeals client checks passed: ${checks}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
