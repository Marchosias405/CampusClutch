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
const compileService = name => ts.transpileModule(fs.readFileSync(root+'/src/lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const offers = {};
vm.runInNewContext(compileService('offers'),{exports:offers,require:()=>({supabase:client}),Error});
const points = {};
vm.runInNewContext(compileService('points'),{exports:points,require:name=>name==='./supabase'?{supabase:client}:offers,Error});
const compiled = ts.transpileModule(fs.readFileSync(root+'/src/lib/requests.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
vm.runInNewContext(compiled,{exports:exportsObject,require: name=> name==='./supabase'?{supabase:client}:name==='./points'?points:name==='./offers'?offers:{getCampuses:async()=>{const {data,error}=await client.from('campuses').select('*');if(error)throw error;return data.map(r=>({id:r.id,slug:r.slug,displayName:r.display_name}));}},Date,Map,Error});
const check=(v,m)=>{if(!v)throw Error(m);console.log('PASS '+m);};
const rejectsForPoints=async(action,label)=>{let failure;try{await action();}catch(error){failure=error;}check(failure?.code==='P0002',label);};
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
   if (ids.length===3) {
    const draft={...base,category},before=JSON.stringify(draft);
    let failure;try{await exportsObject.saveRequest(draft);}catch(error){failure=error;}
    check(failure?.code==='P0004' && exportsObject.requestError(failure).includes('3 active requests'),'Fourth active request is blocked with a clear limit message');
    check((await exportsObject.loadRequests('ALL',userId,0)).items.length===3 && JSON.stringify(draft)===before,'Failed capped save preserves existing requests and form data');
    await exportsObject.cancelRequest(userId,ids[2],1,'open');
   }
   const id=await exportsObject.saveRequest({...base,category});ids.push(id);
   const row=await exportsObject.loadRequest(id);
   check(row.category===category && row.ownerId===userId && row.points===15,'Persist and reload '+category);
   check(category==='EVENT HELP'?row.eventTask==='Chairs':category==='STUDY HELP'?row.studyTopic==='Loops':row.dropoffLocation==='Library','Detail mapping '+category);
  }
  const page=await exportsObject.loadRequests('ALL',userId,0);check(page.items.length===4,'Owner history');
  check(page.items.filter(row=>row.status==='open').length===3,'Cancelling frees a slot without removing request history');
  const filtered=await exportsObject.loadRequests('STUDY HELP',null,0);check(filtered.items.some(r=>r.id===ids[3]),'Feed RPC with embedded detail loading');
  await exportsObject.saveRequest({...base,category:'DELIVERY',title:'Edited'},ids[0]);check((await exportsObject.loadRequest(ids[0])).title==='Edited','Edit persists');
  await exportsObject.cancelRequest(userId,ids[0],1,'open');check((await exportsObject.loadRequest(ids[0])).status==='cancelled','Cancellation persists');
  const feed=await exportsObject.loadRequests('ALL',null,0);check(!feed.items.some(r=>r.id===ids[0]),'Cancelled excluded from feed');
  await exportsObject.setRequestArchived(userId,ids[0],true);
  const archivedDetail=await exportsObject.loadRequest(ids[0]);
  check(Boolean(archivedDetail.ownerArchivedAt)&&archivedDetail.status==='cancelled'&&archivedDetail.pickupLocation==='Cafe','Archive marker maps without deleting request details');
  const currentHistory=await exportsObject.loadRequests('ALL',userId,0);
  const archivePage=await exportsObject.loadRequests('ALL',userId,0,true);
  check(currentHistory.items.length===3&&!currentHistory.items.some(r=>r.id===ids[0]),'Default owner history excludes archived requests');
  check(archivePage.items.length===1&&archivePage.items[0].id===ids[0],'Archived history selects only archived requests');
  check((await exportsObject.loadRequests('PICKUP',userId,0,true)).items.length===0,'Archived history keeps category filters');
  await exportsObject.setRequestArchived(userId,ids[0],false);
  check((await exportsObject.loadRequest(ids[0])).ownerArchivedAt===null&&(await exportsObject.loadRequests('ALL',userId,0)).items.length===4,'Restore returns history to the default list');
  let staleAccountFailure;
  try{await exportsObject.setRequestArchived(require('crypto').randomUUID(),ids[0],true);}catch(error){staleAccountFailure=error;}
  check(Boolean(staleAccountFailure)&&(await exportsObject.loadRequest(ids[0])).ownerArchivedAt===null,'Archive refuses a changed account before modifying history');
  sql(`update public.requests set deadline_at=clock_timestamp()-interval '1 minute' where id='${ids[1]}';`);
  await exportsObject.setRequestArchived(userId,ids[1],true);
  const expiredArchive=await exportsObject.loadRequest(ids[1]);
  check(expiredArchive.status==='expired'&&Boolean(expiredArchive.ownerArchivedAt)&&expiredArchive.dropoffLocation==='Library','Archiving elapsed open request preserves details and expires it');
  await exportsObject.setRequestArchived(userId,ids[1],false);
  check((await exportsObject.loadRequest(ids[1])).status==='expired','Restoring expired history does not reopen the request');
  // Boundary setup is restricted to this disposable account, never user wallets.
  sql(`update public.points_wallets set balance=110 where profile_id='${userId}';`);
  await rejectsForPoints(()=>exportsObject.saveRequest({...base,category:'DELIVERY',points:111}),'Typed save blocks 111 points with 110 available');
  const campus=await client.from('campuses').select('id').eq('slug','burnaby').single();if(campus.error)throw campus.error;
  const payload={category:'delivery',title:base.title,description:base.description,campus_id:campus.data.id,room_location:base.roomLocation,deadline_at:base.deadlineAt,points:111,item_size:'small',details:{pickup_location:'Cafe',dropoff_location:'Library'}};
  const direct=await client.rpc('save_my_request',{p_payload:payload});
  check(direct.error?.code==='P0002','Direct RPC cannot bypass the posting limit');
  const exact=await exportsObject.saveRequest({...base,category:'DELIVERY',points:110});
  check((await exportsObject.loadRequest(exact)).points===110,'Exactly 110 available points can be offered');
  await rejectsForPoints(()=>exportsObject.saveRequest({...base,category:'DELIVERY',points:111,title:'Rejected edit'},exact),'Typed edit blocks an unaffordable increase');
  const unchanged=await exportsObject.loadRequest(exact);
  check(unchanged.points===110&&unchanged.title===base.title&&unchanged.pickupLocation==='Cafe','Failed edit preserves request and details');
  sql(`update public.points_wallets set reserved=30 where profile_id='${userId}';`);
  await rejectsForPoints(()=>exportsObject.saveRequest({...base,category:'PICKUP',points:81}),'Posting excludes points reserved for other work');
  const reservedDirect=await client.rpc('save_my_request',{p_payload:{...payload,points:81}});
  check(reservedDirect.error?.code==='P0002','Direct RPC also excludes reserved points');
  await exportsObject.saveRequest({...base,category:'DELIVERY',points:80},exact);
  check((await exportsObject.loadRequest(exact)).points===80,'Editing down to the available balance succeeds');
  const wallet=await points.readWallet(userId);
  check(wallet.balance===110&&wallet.reserved===30&&wallet.available===80,'Posting and editing do not spend or reserve additional points');
  // Make archived history newer than every visible row. Filtering after LIMIT
  // would incorrectly return an empty default page and truncate archive pages.
  const visibleIds=(await exportsObject.loadRequests('ALL',userId,0)).items.map(r=>r.id).sort();
  sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${userId}',true);
   do $$ declare request_id uuid; begin for i in 1..21 loop
    request_id:=public.save_my_request('${JSON.stringify({...payload,points:10})}'::jsonb);
    perform public.cancel_my_request_for_round(request_id,1,'open');
    perform public.set_my_request_archived(request_id,true);
   end loop; end $$; commit;`);
  const afterArchiveIds=(await exportsObject.loadRequests('ALL',userId,0)).items.map(r=>r.id).sort();
  check(JSON.stringify(visibleIds)===JSON.stringify(afterArchiveIds),'Server-side archive filtering happens before pagination');
  const archivedFirst=await exportsObject.loadRequests('ALL',userId,0,true);
  const archivedSecond=await exportsObject.loadRequests('ALL',userId,archivedFirst.nextOffset,true);
  check(archivedFirst.items.length===20&&archivedFirst.hasMore&&archivedSecond.items.length===1&&!archivedSecond.hasMore,'Archived history paginates independently across twenty rows');
  check(new Set([...archivedFirst.items,...archivedSecond.items].map(r=>r.id)).size===21,'Archived pages contain no missing or duplicated requests');
 } finally {
  await client.auth.signOut();
  if(userId)sql(`delete from public.requests where owner_id='${userId}'; delete from auth.users where id='${userId}';`);
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
