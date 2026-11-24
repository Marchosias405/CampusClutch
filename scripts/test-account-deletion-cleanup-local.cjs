/* global __dirname */
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { randomBytes, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { localClientConfig, localSql: sql, createStudentFixture, cleanupStudentFixtures } = require('./local-student-fixtures.cjs');
const { url, key } = localClientConfig();
const service = process.env.CAMPUSCLUTCH_LOCAL_SERVICE_KEY;
assert.ok(service, 'Runner must supply only the isolated local service credential');
const admin = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const fixtures=[], people=[]; let checks=0;
const pass = text => { checks++; console.log('PASS '+text); };
const quote = text => "'"+text.replaceAll("'","''")+"'";
async function student() {
 const credentials=createStudentFixture(); fixtures.push(credentials);
 const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const signup=await c.auth.signUp(credentials); assert.ifError(signup.error); const id=signup.data.user.id;
 const person={id,credentials,c}; people.push(person);
 sql(`update auth.users set email_confirmed_at=now() where id='${id}'; update public.profiles set display_name='Deletion test',is_discoverable=true where id='${id}'`);
 const login=await c.auth.signInWithPassword(credentials); assert.ifError(login.error); person.token=login.data.session.access_token; person.refresh=login.data.session.refresh_token;
 return person;
}
async function rpc(user,name,args={}) {
 const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${user.token}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
 return {status:r.status,data:await r.json()};
}
function args(receipt) {return {p_operation_id:receipt.id,p_receipt_secret:receipt.secret,p_confirmation:'DELETE'};}
function receipt() {return {id:randomUUID(),secret:randomBytes(32).toString('hex')};}
async function main() {
 const {deletionHandler}=await import(pathToFileURL(path.resolve(__dirname,'../supabase/functions/account-deletion/worker.mjs')));
 const adapter={
  async rpc(name,args) {const r=await admin.rpc(name,args); if(r.error)throw r.error;return r.data;},
  async remove(bucket,paths){const r=await admin.storage.from(bucket).remove(paths);if(r.error)throw r.error;},
  async softDelete(id){const r=await admin.auth.admin.deleteUser(id,true);if(r.error)throw r.error;},
 };
 const handler=deletionHandler(adapter,'local-worker-fixture');
 async function work(token,handlerOverride=handler) { const r=await handlerOverride(new Request('http://localhost/account-deletion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(token)}));return {http:r.status,...await r.json()};}
 try {
  const a=await student(), b=await student(), staff=await student();
  const r=receipt();
  assert.ok([401,403].includes((await rpc(a,'claim_account_deletion',{p_id:r.id,p_secret:r.secret})).status));
  assert.equal((await work(r)).status,'unconfirmed');
  assert.equal((await work({id:r.id,secret:'x'})).http,400);
  assert.equal((await rpc(a,'begin_my_account_deletion',{...args(r),p_confirmation:'yes'})).status,400);
  sql(`select safety_private.assign_staff_role('${staff.id}','admin',true,'Disposable test staff');`);
  assert.deepEqual((await rpc(staff,'begin_my_account_deletion',args(receipt()))).data,{accepted:false,blockers:['staff_access']});
  sql(`select safety_private.assign_staff_role('${staff.id}','admin',false,'Disposable staff handover');`);
  pass('confirmation and staff blockers are enforced; worker RPCs and forged receipts cannot delete an account');

  const chat=await rpc(a,'start_direct_conversation',{p_other_profile_id:b.id});assert.equal(chat.status,200,JSON.stringify(chat));
  const conversation=typeof chat.data==='string'?chat.data:chat.data.id;
  assert.match(conversation,/^[0-9a-f-]{36}$/);
  const sent=await rpc(a,'send_conversation_message',{p_conversation_id:conversation,p_client_message_id:randomUUID(),p_body:'Keep this historical message'});
  assert.equal(sent.status,200,JSON.stringify(sent));
  const asset=`${a.id}/deletion-fixture.png`;
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN0cAAAAASUVORK5CYII=','base64');
  const uploaded=await a.c.storage.from('avatars').upload(asset,image,{contentType:'image/png'});assert.ifError(uploaded.error);
  const signed=await a.c.storage.from('avatars').createSignedUrl(asset,3600);assert.ifError(signed.error);
  sql(`update public.profiles set avatar_path='${asset}',major='Private major',year_of_study=3 where id='${a.id}';
   insert into public.profile_interests(profile_id,interest_id) select '${a.id}',id from public.interests limit 1;
   insert into public.course_memberships(profile_id,course_id) select '${a.id}',id from public.courses limit 1;
   insert into course_reviews_private.reviews(course_code,term_id,author_id,difficulty,workload,recommend,comment,tags)
    select code,term_id,'${a.id}',3,4,true,'Disposable deletion review',array[]::text[] from public.courses limit 1;`);
  const job=randomUUID();
  sql(`begin;insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size,status)
   values('${job}','${a.id}','delivery','Private title','Disposable request details',(select id from public.campuses limit 1),'Private room',now()+interval '1 day',10,'medium','accepted');
   insert into public.delivery_request_details(request_id,pickup_location,dropoff_location) values('${job}','Private pickup','Private dropoff');
   insert into public.request_offers(request_id,offering_user_id,status,decided_at) values('${job}','${b.id}','accepted',now());
   insert into public.request_point_reservations(request_id,offer_round,poster_id,helper_id,amount) values('${job}',1,'${a.id}','${b.id}',10);
   update public.points_wallets set reserved=10 where profile_id='${a.id}';commit;`);
  for(const p of [a,b])assert.deepEqual((await rpc(p,'begin_my_account_deletion',args(receipt()))).data,{accepted:false,blockers:['accepted_jobs','reserved_points']});
  assert.equal(sql(`select count(*) from account_private.deletions where profile_id in('${a.id}','${b.id}')`),'0');
  sql(`begin;update public.requests set status='cancelled',cancelled_at=now() where id='${job}';update public.request_point_reservations set status='released',released_at=now() where request_id='${job}';update public.points_wallets set reserved=0 where profile_id='${a.id}';commit;`);
  pass('accepted work blocks both participants without partial cleanup or lost photos/messages');

  const beginning=await Promise.all([rpc(a,'begin_my_account_deletion',args(r)),rpc(a,'begin_my_account_deletion',args(r))]);
  for(const result of beginning)assert.deepEqual(result,{status:200,data:{accepted:true}});
  assert.equal(sql(`select count(*) from account_private.deletions where profile_id='${a.id}'`),'1');
  assert.equal(sql(`select count(*) from auth.sessions where user_id='${a.id}'`),'0');
  assert.ok((await rpc(a,'get_my_account_deletion_preflight')).status>=400);
  assert.ok((await rpc(a,'send_conversation_message',{p_conversation_id:conversation,p_client_message_id:randomUUID(),p_body:'Must fail'})).status>=400);
  const refreshing=await a.c.auth.refreshSession({refresh_token:a.refresh});assert.ok(refreshing.error);
  const profile={data:JSON.parse(sql(`select row_to_json(p) from public.profiles p where id='${a.id}'`))};
  assert.equal(profile.data.display_name,'Deleted student');assert.equal(profile.data.onboarding_completed_at,null);assert.equal(profile.data.major,null);assert.equal(profile.data.avatar_path,null);assert.equal(profile.data.is_discoverable,false);
  assert.equal(sql(`select (select count(*) from course_reviews_private.reviews where author_id='${a.id}')+(select count(*) from public.course_memberships where profile_id='${a.id}')+(select count(*) from public.profile_interests where profile_id='${a.id}')`),'0');
  const history=await rpc(b,'get_conversation_summary',{p_conversation_id:conversation});assert.equal(history.status,200,JSON.stringify(history));
  assert.equal(history.data.other_display_name,'Deleted student');assert.equal(history.data.status,'closed');assert.equal(history.data.other_profile_deleted,true);assert.equal(history.data.last_message_body,'Keep this historical message');
  const reading=await b.c.from('profiles').select('id').eq('id',a.id);assert.ifError(reading.error);assert.deepEqual(reading.data,[]);
  assert.ok((await rpc(b,'send_conversation_message',{p_conversation_id:conversation,p_client_message_id:randomUUID(),p_body:'No new contact'})).status>=400);
  pass('duplicate confirmation cleans exactly once, revokes sessions, hides personal data and preserves read-only recipient history');

  assert.equal((await work({...r,secret:randomBytes(32).toString('hex')})).status,'unconfirmed');
  const broken=deletionHandler({...adapter,remove:async()=>{throw new Error('Simulated Storage outage');}},'local-worker-fixture');
  sql(`update account_private.deletions set requested_at=now()-interval '1 year' where id='${r.id}'`);
  assert.equal((await work(r,broken)).http,503);
  assert.equal(sql(`select completed_at is null from account_private.deletions where id='${r.id}'`),'t');
  sql(`update account_private.deletions set lease_until=now()-interval '1 minute',due_at=now() where id='${r.id}'`);
  const lostAuth=deletionHandler({...adapter,softDelete:async id=>{await adapter.softDelete(id);throw new Error('Lost Auth response');}},'local-worker-fixture');
  assert.equal((await work(r,lostAuth)).http,503);
  assert.equal(sql(`select deleted_at is not null from auth.users where id='${a.id}'`),'t');
  assert.equal(sql(`select completed_at is null from account_private.deletions where id='${r.id}'`),'t');
  sql(`update account_private.deletions set lease_until=now()-interval '1 minute',due_at=now() where id='${r.id}'`);
  const scheduled=await handler(new Request('http://localhost/account-deletion',{method:'POST',headers:{'x-deletion-worker-secret':'local-worker-fixture'},body:'{}'}));assert.equal(scheduled.status,200);
  assert.equal((await work(r)).status,'complete');assert.equal((await work(r)).status,'complete');
  assert.equal(sql(`select count(*) from storage.objects where name='${asset}'`),'0');
  assert.equal(sql(`select deleted_at is not null from auth.users where id='${a.id}'`),'t');
  const oldImage=await fetch(signed.data.signedUrl);assert.equal(oldImage.ok,false);
  const login=await a.c.auth.signInWithPassword(a.credentials);assert.ok(login.error);
  pass('Storage outage remains retryable; scheduled cleanup removes photo, disables Auth and returns a stable receipt');

  sql(`update account_private.deletions set completed_at=now()-interval '2160 hours' where id='${r.id}'`);
  const unavailable=await work(receipt());
  assert.deepEqual(await work(r),unavailable);
  assert.deepEqual(unavailable,{http:200,status:'unconfirmed'});
  sql('select account_private.erase_expired_deletion_receipts()');
  assert.deepEqual(await work(r),unavailable);
  assert.equal(sql(`select receipt_hash is null and completed_at is not null from account_private.deletions where id='${r.id}'`),'t');
  pass('expired, unknown and erased receipts give identical HTTP results and keep the deletion record');

  const fresh=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const signup=await fresh.auth.signUp(a.credentials);assert.ifError(signup.error);assert.notEqual(signup.data.user.id,a.id);
  people.push({id:signup.data.user.id,credentials:a.credentials,c:fresh});
  sql(`update auth.users set email_confirmed_at=now() where id='${signup.data.user.id}'`);
  assert.equal(sql(`select balance from public.points_wallets where profile_id='${signup.data.user.id}'`),'100');
  assert.equal(sql(`select balance from public.points_wallets where profile_id='${b.id}'`),'100');
  pass('same-email re-registration restores remaining points without a second welcome grant; other balances stay unchanged');
  for(let race=0;race<3;race++) {
    const poster=await student(), helper=await student(), token=receipt(), requestId=randomUUID();
    sql(`begin;insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size)
      values('${requestId}','${poster.id}','delivery','Deletion race','Disposable race fixture',(select id from public.campuses limit 1),'Library',now()+interval '1 day',10,'medium');
      insert into public.delivery_request_details(request_id,pickup_location,dropoff_location) values('${requestId}','Cafe','Library');commit;`);
    const offer=await rpc(helper,'create_my_request_offer_for_terms',{p_request_id:requestId,p_expected_round:1,p_expected_points:10});assert.equal(offer.status,200,JSON.stringify(offer));
    const [accepted,deletion]=await Promise.all([
      rpc(poster,'decide_request_offer_for_round',{p_offer_id:offer.data,p_action:'accepted',p_expected_round:1,p_expected_points:10}),
      rpc(helper,'begin_my_account_deletion',args(token)),
    ]);
    const deleted=sql(`select exists(select 1 from account_private.deletions where profile_id='${helper.id}')`)==='t';
    const held=sql(`select count(*) from public.request_point_reservations where request_id='${requestId}' and status='reserved'`);
    assert.ok(!(deleted && accepted.status===200),'Accepted helper must never be deleted');
    assert.equal(held,accepted.status===200?'1':'0');
    if(!deleted) {
      if(accepted.status===200) {
        const blocked=await rpc(helper,'begin_my_account_deletion',args(token));assert.equal(blocked.data.accepted,false);
        const cancel=await rpc(poster,'cancel_my_request_for_round',{p_request_id:requestId,p_expected_round:1,p_expected_status:'accepted'});assert.equal(cancel.status,200,JSON.stringify(cancel));
      }
      const retry=await rpc(helper,'begin_my_account_deletion',args(token));assert.equal(retry.data.accepted,true,JSON.stringify({retry,accepted,deletion}));
    }
    assert.equal((await work(token)).status,'complete');
    assert.equal(sql(`select reserved from public.points_wallets where profile_id='${poster.id}'`),'0');
  }
  pass('concurrent offer acceptance and deletion cannot delete an accepted helper or strand reserved points');

 } finally {
  // Soft-deleted Auth rows have anonymized emails. Give those test-only IDs a
  // fresh issued fixture address so the existing strict cleanup can find them.
  for(const p of people) {
   const isDeleted=sql(`select coalesce(deleted_at is not null,false) from auth.users where id='${p.id}'`);
   if(isDeleted==='t') {const alias=createStudentFixture();fixtures.push(alias);sql(`update auth.users set email=${quote(alias.email)} where id='${p.id}'`);}
   const assets=await admin.storage.from('avatars').list(p.id);
   if(assets.data?.length)await admin.storage.from('avatars').remove(assets.data.map(x=>`${p.id}/${x.name}`));
  }
  const ids=people.map(p=>quote(p.id)).join(',');
  if(ids)sql(`delete from account_private.deletions where profile_id in(${ids})`);
  cleanupStudentFixtures(fixtures);
 }
 console.log(`Account deletion: ${checks} integration groups passed`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
