const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { eligible, target, prepare, project, expoProject, deferred } = require('./preview.cjs');
const { ensureApk } = require('./preview-apk.cjs');

const sha = 'a'.repeat(40);
const repository = 'Marchosias405/CampusClutch';
const run = { head_sha:sha, head_branch:'main', head_repository:{full_name:repository}, conclusion:'success', event:'push', run_attempt:1 };
const jobs = ['Lint and typecheck','Database migrations and pgTAP'].map(name=>({name,conclusion:'success',run_attempt:1}));
const env = { EXPO_PUBLIC_APP_ENV:'preview', EXPO_PUBLIC_SUPABASE_URL:'https://' + project + '.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture' };

test('only the current successful main push with passing app and database jobs is eligible', () => {
  assert.ok(eligible(run,repository,sha,jobs));
  for (const changes of [{event:'pull_request'}, {event:'workflow_dispatch'}, {head_branch:'test'},
    {head_repository:{full_name:'someone/other'}}, {conclusion:'cancelled'}, {conclusion:'failure'}, {head_sha:'b'.repeat(40)}]) {
    assert.equal(eligible({...run,...changes},repository,sha,jobs),false);
  }
  assert.equal(eligible(run,repository,sha,jobs.slice(0,1)),false);
  assert.equal(eligible(run,repository,sha,[jobs[0],{...jobs[1],conclusion:'skipped'}]),false);
});

test('a partial rerun retains earlier passing jobs and uses the latest result for each job', () => {
  const rerun = { ...run, run_attempt: 2 };
  const failed = { ...jobs[1], conclusion: 'failure' };
  const fixed = { ...jobs[1], run_attempt: 2 };
  assert.ok(eligible(rerun, repository, sha, [fixed, jobs[0], failed]));
  assert.equal(eligible(run, repository, sha, [jobs[0], failed, fixed]), false);
  assert.equal(eligible(rerun, repository, sha, [...jobs, { ...failed, run_attempt: 2 }]), false);
});

test('Preview rejects a missing key, private key, wrong project, or wrong app environment', () => {
  target(env);
  for (const changes of [{EXPO_PUBLIC_APP_ENV:'production'}, {EXPO_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},
    {EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''}, {EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixture'}]) {
    assert.throws(()=>target({...env,...changes}));
  }
  const jwt = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.sig';
  target({...env, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:jwt({role:'anon',ref:project})});
  for (const claims of [{role:'service_role',ref:project},{role:'anon',ref:'other'}]) {
    assert.throws(()=>target({...env, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:jwt(claims)}));
  }
});

test('the isolated workdir excludes deferred versions, credentials and seeds and refuses stale source', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'preview-cd-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  function file(name, value='fixture') {
    const dest=path.join(dir,name);
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.writeFileSync(dest,value);
  }
  file('app.json',JSON.stringify({expo:{extra:{eas:{projectId:expoProject}},android:{package:'com.marchosias405.campusclutch'}}}));
  file('eas.json',JSON.stringify({build:{preview:{environment:'preview',distribution:'internal'}}}));
  file('app.config.js');
  for (const fn of ['account-deletion','android-push','email-verified']) file('supabase/functions/'+fn+'/index.ts');
  for (const skipped of deferred) file('supabase/migrations/'+skipped);
  file('supabase/config.toml'); file('supabase/.temp/project-ref','other'); file('supabase/seed.sql');
  const stage=path.join(dir,'stage');
  assert.throws(()=>prepare(dir,stage), /predates/);
  const migration='20261124064748_avatar_storage_budget.sql';
  file('supabase/migrations/'+migration);
  file('supabase/migrations/20261125000000_next.sql','select 1;');
  prepare(dir,stage);
  assert.deepEqual(fs.readdirSync(path.join(stage,'supabase')).sort(),['config.toml','migrations']);
  assert.deepEqual(fs.readdirSync(path.join(stage,'supabase/migrations')).sort(),[migration,'20261125000000_next.sql']);
  assert.throws(()=>prepare(dir,stage),{code:'EEXIST'});
});

const built = { app:{id:expoProject}, platform:'ANDROID',distribution:'INTERNAL',buildProfile:'preview',
  gitCommitHash:sha,message:'Preview CI '+sha,id:'12345678-1234-1234-1234-123456789012',
  status:'FINISHED',artifacts:{buildUrl:'https://example.invalid/preview.apk'} };
function api(list, results) {
  const commands=[];
  return { commands, eas(args) {
    commands.push(args[0]);
    if (args[0]==='build:list') return list;
    if (args[0]==='build') return [{id:built.id}];
    if (args[0]==='build:view') return results.shift();
    assert.fail('Unexpected EAS command');
  } };
}
test('retries reuse completed and in-flight Preview APKs for the exact tested commit',async()=>{
  for (const status of ['FINISHED','IN_QUEUE']) {
    const fixture=api([{...built,status}],[{...built,status:'IN_PROGRESS'},built]);
    assert.ok((await ensureApk(sha,fixture.eas,async()=>{})).endsWith(built.id));
    assert.deepEqual(fixture.commands,['build:list','build:view','build:view']);
  }
});
test('expired, failed, and unrelated builds are replaced, and a failed new build stops the release',async()=>{
  const fixture=api([{...built,expirationDate:'2020-01-01'}, {...built,status:'ERRORED'}, {...built,gitCommitHash:'b'.repeat(40)}],[built]);
  await ensureApk(sha,fixture.eas);
  assert.deepEqual(fixture.commands,['build:list','build','build:view']);
  for (const changes of [{status:'ERRORED'}, {app:{id:'other'}}, {distribution:'STORE'}, {message:'other'}]) {
    await assert.rejects(ensureApk(sha,api([],[{...built,...changes}]).eas));
  }
});
