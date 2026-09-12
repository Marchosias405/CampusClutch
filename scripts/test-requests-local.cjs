/* global __dirname */
// Local-only integration test. Creates one temporary account and removes its rows in finally.
const fs = require('fs');
const cp = require('child_process');
const vm = require('vm');
const root = require('path').resolve(__dirname, '..');
const { createClient } = require(root + '/node_modules/@supabase/supabase-js');
const ts = require(root + '/node_modules/typescript');
const env = Object.fromEntries(fs.readFileSync(root + '/.env.local', 'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const url = env.EXPO_PUBLIC_SUPABASE_URL;
if (url !== 'http://127.0.0.1:54321') throw Error('Local API required');
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
function sql(query) {
 const out = cp.spawnSync('psql',['-X','-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query],{env:{...process.env,PGPASSWORD:'postgres'},encoding:'utf8'});
 if(out.status!==0) throw Error('SQL fixture operation failed: '+out.stderr);
}
const exportsObject = {};
const compiled = ts.transpileModule(fs.readFileSync(root+'/src/lib/requests.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
vm.runInNewContext(compiled,{exports:exportsObject,require: name=> name==='./supabase'?{supabase:client}:{getCampuses:async()=>{const {data,error}=await client.from('campuses').select('*');if(error)throw error;return data.map(r=>({id:r.id,slug:r.slug,displayName:r.display_name}));}},Date,Map,Error});
const check=(v,m)=>{if(!v)throw Error(m);console.log('PASS '+m);};
(async()=>{
 let userId;
 try {
  const email=`request-api-${Date.now()}@test.local`, password=require('crypto').randomBytes(24).toString('hex');
  const signup=await client.auth.signUp({email,password});
  if(signup.error)throw signup.error;
  userId=signup.data.user.id;
  if(!/^[0-9a-f-]{36}$/.test(userId))throw Error('Invalid fixture ID');
  sql(`update auth.users set email_confirmed_at=now() where id='${userId}'; update public.profiles set display_name='API Test',major='Testing',year_of_study=2,campus_id=(select id from campuses where slug='burnaby') where id='${userId}';`);
  const signin=await client.auth.signInWithPassword({email,password});if(signin.error)throw signin.error;
  const ids=[];
  const base={title:'API fixture',description:'Verify request persistence and detail mapping.',campus:'Burnaby',roomLocation:'Library',deadlineAt:new Date(Date.now()+86400000).toISOString(),points:15,itemSize:'Small',timeLabel:'',location:'',pickupLocation:'Cafe',dropoffLocation:'Library',eventName:'Welcome',eventTask:'Chairs',courseOrSubject:'CMPT 120',studyTopic:'Loops'};
  for(const category of ['DELIVERY','PICKUP','EVENT HELP','STUDY HELP']) {
   const id=await exportsObject.saveRequest({...base,category});ids.push(id);
   const row=await exportsObject.loadRequest(id);
   check(row.category===category && row.ownerId===userId && row.points===15,'Persist and reload '+category);
   check(category==='EVENT HELP'?row.eventTask==='Chairs':category==='STUDY HELP'?row.studyTopic==='Loops':row.dropoffLocation==='Library','Detail mapping '+category);
  }
  const page=await exportsObject.loadRequests('ALL',userId,0);check(page.items.length===4,'Owner history');
  const filtered=await exportsObject.loadRequests('STUDY HELP',null,0);check(filtered.items.some(r=>r.id===ids[3]),'Feed RPC with embedded detail loading');
  await exportsObject.saveRequest({...base,category:'DELIVERY',title:'Edited'},ids[0]);check((await exportsObject.loadRequest(ids[0])).title==='Edited','Edit persists');
  await exportsObject.cancelRequest(ids[0]);check((await exportsObject.loadRequest(ids[0])).status==='cancelled','Cancellation persists');
  const feed=await exportsObject.loadRequests('ALL',null,0);check(!feed.items.some(r=>r.id===ids[0]),'Cancelled excluded from feed');
 } finally {
  await client.auth.signOut();
  if(userId)sql(`delete from public.requests where owner_id='${userId}'; delete from auth.users where id='${userId}';`);
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
