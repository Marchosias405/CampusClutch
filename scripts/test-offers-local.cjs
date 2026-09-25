/* global __dirname */
// Exercises the actual typed service through local Auth/PostgREST. Fixtures are removed.
const fs = require('fs');
const cp = require('child_process');
const vm = require('vm');
const root = require('path').resolve(__dirname, '..');
const assert = require('node:assert/strict');
const { createClient } = require(root + '/node_modules/@supabase/supabase-js');
const ts = require(root + '/node_modules/typescript');
const env = Object.fromEntries(fs.readFileSync(root + '/.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i=l.indexOf('='); return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]; }));
if (env.EXPO_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('Local API required');
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const users = [];
const compiled = ts.transpileModule(fs.readFileSync(root+'/src/lib/offers.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const pointsCompiled = ts.transpileModule(fs.readFileSync(root+'/src/lib/points.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function sql(query) {
 const out=cp.spawnSync('psql',['-X','-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query],{env:{...process.env,PGPASSWORD:'postgres'},encoding:'utf8'});
 if(out.status!==0) throw Error(out.stderr);
}
function service(client) {
 const exports = {};
 vm.runInNewContext(compiled,{exports,require:()=>({supabase:client}),Error});
 return exports;
}
function pointsService(client) {
 const exports = {};
 vm.runInNewContext(pointsCompiled,{exports,require:path=>path==='./supabase'?{supabase:client}:service(client),Error});
 return exports;
}
async function account() {
 const client=createClient(env.EXPO_PUBLIC_SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const email=`offer-api-${require('crypto').randomUUID()}@test.local`,password=require('crypto').randomBytes(24).toString('hex');
 const signup=await client.auth.signUp({email,password}); if(signup.error) throw signup.error;
 const id=signup.data.user.id; assert.match(id,/^[0-9a-f-]{36}$/);
 const user={id,client,api:service(client),points:pointsService(client)}; users.push(user);
 sql(`update auth.users set email_confirmed_at=now() where id='${id}'; update public.profiles set display_name='Offer API Tester',major='Testing',year_of_study=2,is_discoverable=false,campus_id=(select id from public.campuses where slug='burnaby') where id='${id}';`);
 const signin=await client.auth.signInWithPassword({email,password}); if(signin.error)throw signin.error;
 return user;
}
const pass=message=>console.log('PASS '+message);
(async()=>{
 try {
  sql("notify pgrst, 'reload schema';");
  const owner=await account(),helper=await account(),other=await account();
  for(const user of [owner,helper,other]) {
   const wallet=await user.points.readWallet(user.id);
   assert.equal(wallet.balance,100); assert.equal(wallet.available,100); assert.equal(wallet.reserved,0);
   assert.equal(wallet.history.length,1); assert.equal(wallet.history[0].kind,'starter_grant');
  }
  pass('new accounts each receive exactly 100 starting points and one grant');
  const campus=await owner.client.from('campuses').select('id').eq('slug','burnaby').single(); if(campus.error)throw campus.error;
  const saved=await owner.client.rpc('save_my_request',{p_payload:{category:'delivery',title:'Offer service test',description:'Temporary offer integration fixture.',campus_id:campus.data.id,room_location:'Library',deadline_at:new Date(Date.now()+86400000).toISOString(),points:10,item_size:'small',details:{pickup_location:'Cafe',dropoff_location:'Library'}}}); if(saved.error)throw saved.error;
  const requestId=saved.data;
  const first=await helper.api.submitOffer(helper.id,requestId,'  I can help  ',1,10);
  assert.equal(await helper.api.submitOffer(helper.id,requestId,'retry',1,10),first); pass('submit and retry preserve one offer');
  await other.api.submitOffer(other.id,requestId,'Other helper',1,10);
  const page=await owner.api.loadOfferPage(owner.id,requestId);
  assert.equal(page.items.length,2); assert.equal(page.hasMore,false); pass('owner page exposes two helpers');
  assert.equal(page.items.find(o=>o.id===first).message,'I can help'); pass('message is normalized');
  assert.equal(page.items[0].helper_display_name,'Offer API Tester'); assert.equal(page.items[0].helper_major,'Testing'); pass('approved private-profile summary maps through API');
  assert.equal((await helper.api.loadOfferPage(helper.id,requestId)).items.length,1); pass('helper cannot load competing offer');
  assert.equal(page.items[0].offer_round,1); assert.equal(page.items[0].request_offer_round,1); assert.equal(page.items[0].request_points,10); pass('page includes matching offer/request rounds and reviewed reward');
  await assert.rejects(()=>other.api.decideOffer(other.id,first,'accepted',1,10)); pass('unauthorized decision rejected');
  await assert.rejects(()=>owner.api.decideOffer(owner.id,first,'accepted',1,30),error=>error.code==='22023');
  assert.equal((await owner.points.readWallet(owner.id)).reserved,0);
  const refreshed=await owner.client.from('requests').select('points,status').eq('id',requestId).single(); if(refreshed.error)throw refreshed.error;
  assert.equal(refreshed.data.status,'open'); assert.equal(refreshed.data.points,10); pass('changed reward rejects acceptance without reserving points; refresh exposes current amount');
  await owner.api.decideOffer(owner.id,first,'accepted',1,refreshed.data.points);
  const held=await owner.points.readWallet(owner.id);
  assert.equal(held.balance,100); assert.equal(held.reserved,10); assert.equal(held.available,90);
  assert.equal((await helper.points.readWallet(helper.id)).balance,100); pass('acceptance reserves poster points without crediting helper');
  assert.equal((await helper.points.loadRequestReservation(helper.id,requestId,1)).status,'reserved'); pass('participants can see funded reservation');
  assert.equal((await helper.api.loadOfferPage(helper.id,null)).items[0].status,'accepted'); pass('accepted offer survives history reload');
  assert.equal((await other.api.loadOfferPage(other.id,null)).items[0].status,'rejected'); pass('other helper sees rejection');
  const detail=await helper.client.from('requests').select('id').eq('id',requestId).single(); assert.equal(detail.data?.id,requestId); pass('accepted helper can reopen request');
  await assert.rejects(()=>helper.api.decideOffer(helper.id,first,'withdrawn',1)); pass('accepted offer cannot be withdrawn');
  const deadline=new Date(Date.now()+172800000).toISOString();
  await assert.rejects(()=>helper.api.reopenRequest(helper.id,requestId,1,deadline)); pass('helper cannot reopen poster request');
  await owner.api.reopenRequest(owner.id,requestId,1,deadline);
  await owner.api.reopenRequest(owner.id,requestId,1,deadline);
  assert.equal((await owner.points.readWallet(owner.id)).available,100); pass('reopening releases reserved points');
  const reopened=await helper.api.loadOfferPage(helper.id,null);
  assert.equal(reopened.items[0].status,'rejected'); assert.equal(reopened.items[0].offer_round,1); assert.equal(reopened.items[0].request_offer_round,2); pass('reopening retires acceptance and retry preserves round');
  await helper.api.renewOffer(helper.id,first,2,'  Available again  ',10);
  await helper.api.renewOffer(helper.id,first,2,'duplicate',10);
  const renewed=await owner.api.loadOfferPage(owner.id,requestId);
  assert.equal(renewed.items.find(o=>o.id===first).message,'Available again'); assert.equal(renewed.items.find(o=>o.id===first).offer_round,2); pass('renewal requires helper consent and retry preserves message');
  await assert.rejects(()=>owner.api.decideOffer(owner.id,first,'accepted',1,10));
  const legacy=await owner.client.rpc('decide_request_offer',{p_offer_id:first,p_action:'accepted'}); assert.equal(legacy.error?.code,'22023'); pass('stale and legacy decisions cannot act on renewed offer');
  await owner.api.decideOffer(owner.id,first,'accepted',2,10);
  await assert.rejects(()=>owner.api.reopenRequest(owner.id,requestId,1,deadline));
  assert.equal((await helper.api.loadOfferPage(helper.id,null)).items[0].status,'accepted'); pass('new acceptance survives stale reopen retry');
  await assert.rejects(()=>helper.points.completeRequest(helper.id,requestId,2)); pass('helper cannot confirm completion');
  await owner.points.completeRequest(owner.id,requestId,2);
  await owner.points.completeRequest(owner.id,requestId,2);
  const paid=await owner.points.readWallet(owner.id),earned=await helper.points.readWallet(helper.id);
  assert.equal(paid.balance,90); assert.equal(paid.available,90); assert.equal(paid.reserved,0); assert.equal(earned.balance,110);
  assert.equal(paid.history.filter(row=>row.kind==='request_sent').length,1); assert.equal(earned.history.filter(row=>row.kind==='request_received').length,1);
  assert.equal((await helper.points.loadRequestReservation(helper.id,requestId,2)).status,'settled'); pass('poster completion transfers once with matching histories');
  assert.equal((await helper.api.loadOfferPage(helper.id,null)).items[0].request_status,'completed');
  await assert.rejects(()=>owner.api.reopenRequest(owner.id,requestId,2,deadline)); pass('completed request cannot reopen');
  const privateWallet=await other.client.from('points_wallets').select('*').eq('profile_id',owner.id);
  assert.equal(privateWallet.data?.length,0);
  const forged=await helper.client.from('points_wallets').update({balance:9999}).eq('profile_id',helper.id); assert.ok(forged.error); pass('wallet privacy and write permissions enforced through API');
  await assert.rejects(()=>helper.api.submitOffer(owner.id,requestId,'',2,10)); pass('account mismatch blocks submission');
  await assert.rejects(()=>helper.api.submitOffer(helper.id,requestId,'a'.repeat(1001),2,10)); pass('client message validation');
  // A changed auth session must not silently switch the identity of an in-flight RPC.
  let checkedHeader, calls=0;
  const fake={auth:{getSession:async()=>({data:{session:++calls===1?{user:{id:helper.id},access_token:'original-token'}:{user:{id:other.id},access_token:'other-token'}}})},rpc:()=>({setHeader:(name,value)=>{checkedHeader=[name,value];return Promise.resolve({data:'id',error:null});}})};
  await assert.rejects(()=>service(fake).submitOffer(helper.id,requestId,'',2,10));
  assert.deepEqual(checkedHeader,['Authorization','Bearer original-token']); pass('session switch pins original token and rejects stale success');
  const consentPayload={category:'delivery',title:'Reward consent API test',description:'Temporary changed-reward fixture.',campus_id:campus.data.id,room_location:'Library',deadline_at:new Date(Date.now()+86400000).toISOString(),points:30,item_size:'small',details:{pickup_location:'Cafe',dropoff_location:'Library'}};
  const consentSaved=await owner.client.rpc('save_my_request',{p_payload:consentPayload}); if(consentSaved.error)throw consentSaved.error;
  const consentRequest=consentSaved.data;
  const consentOffer=await helper.api.submitOffer(helper.id,consentRequest,'Agreed to 30',1,30);
  const changedReward=await owner.client.rpc('save_my_request',{p_request_id:consentRequest,p_payload:{...consentPayload,points:20}}); if(changedReward.error)throw changedReward.error;
  const retired=(await helper.api.loadOfferPage(helper.id,consentRequest)).items[0];
  assert.equal(retired.status,'rejected'); assert.equal(retired.offer_round,1); assert.equal(retired.request_offer_round,2); assert.equal(retired.request_points,20);
  pass('reward edit retires helper consent and exposes the new amount');
  await assert.rejects(()=>other.api.submitOffer(other.id,consentRequest,'Stale first offer',1,30),error=>error.code==='22023');
  assert.equal((await other.api.loadOfferPage(other.id,consentRequest)).items.length,0); pass('stale first offer cannot silently agree to a changed reward');
  await assert.rejects(()=>owner.api.decideOffer(owner.id,consentOffer,'accepted',1,30),error=>error.code==='22023');
  await assert.rejects(()=>owner.api.decideOffer(owner.id,consentOffer,'accepted',2,20),error=>error.code==='22023');
  assert.equal((await owner.points.readWallet(owner.id)).reserved,0); pass('poster cannot accept old helper consent using old or new terms');
  const unchecked=await helper.client.rpc('renew_my_request_offer',{p_offer_id:consentOffer,p_expected_round:2});
  assert.equal(unchecked.error?.code,'42501'); pass('legacy helper API cannot bypass reward consent');
  await assert.rejects(()=>helper.api.renewOffer(helper.id,consentOffer,2,'Stale amount',30),error=>error.code==='22023');
  pass('renewal rejects an amount different from the reviewed current terms');
  await helper.api.renewOffer(helper.id,consentOffer,2,'I agree to 20',20);
  const confirmed=(await owner.api.loadOfferPage(owner.id,consentRequest)).items[0];
  assert.equal(confirmed.status,'pending'); assert.equal(confirmed.offer_round,2); assert.equal(confirmed.request_points,20); pass('helper explicitly confirms the changed reward');
  await owner.api.decideOffer(owner.id,consentOffer,'accepted',confirmed.offer_round,confirmed.request_points);
  assert.equal((await owner.points.readWallet(owner.id)).reserved,20); pass('fresh consent reserves exactly the confirmed 20 points');
  await owner.points.completeRequest(owner.id,consentRequest,2);
  await owner.points.completeRequest(owner.id,consentRequest,2);
  const posterFinal=await owner.points.readWallet(owner.id),helperFinal=await helper.points.readWallet(helper.id);
  assert.equal(posterFinal.balance,70); assert.equal(posterFinal.reserved,0); assert.equal(helperFinal.balance,130);
  assert.equal(posterFinal.history.filter(row=>row.kind==='request_sent').length,2);
  assert.equal(helperFinal.history.filter(row=>row.kind==='request_received').length,2);
  pass('changed-reward completion transfers exactly 20 once');
 } finally {
  for(const user of users) sql(`delete from public.requests where owner_id='${user.id}';`);
  for(const user of users) { await user.client.auth.signOut(); sql(`delete from auth.users where id='${user.id}';`); }
  console.log('Temporary API fixtures removed.');
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
