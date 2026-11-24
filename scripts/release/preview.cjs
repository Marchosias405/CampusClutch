const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');

const project = 'udbijakeasbvoycjyghe';
const origin = 'https://' + project + '.supabase.co';
const expoProject = 'a5524197-aec7-42b0-a8ea-37d5fe714c68';
const workers = ['account-deletion', 'android-push', 'email-verified'];

// These local migrations have separate rollout checkpoints. Keep their SQL
// under CI coverage, but outside the workdir used by Preview db push.
const deferred = new Set([
  '20261123045834_admin_retention_holds.sql',
  '20261123050800_held_deletion_evidence.sql',
  '20261123052259_released_evidence_cleanup.sql',
  '20261123054206_sfu_signup_eligibility.sql',
  '20261123060001_ordinary_dm_retention.sql',
  '20261123061511_shared_job_retention.sql',
  '20261123063122_closed_case_retention.sql',
  '20261123064954_ordinary_bell_retention.sql',
  '20261123070407_deletion_receipt_retention.sql',
  '20261123081024_unclaimed_request_retention.sql',
]);

function eligible(run, repository, main, jobs) {
  const latest = new Map();
  for (const job of jobs) {
    if (Number.isInteger(job.run_attempt) && job.run_attempt >= 1 && job.run_attempt <= run.run_attempt &&
        job.run_attempt > (latest.get(job.name)?.run_attempt ?? 0)) {
      latest.set(job.name, job);
    }
  }
  return run.event === 'push' && run.conclusion === 'success' &&
    run.head_repository?.full_name === repository && run.head_branch === 'main' &&
    /^[a-f0-9]{40}$/.test(main) && run.head_sha === main &&
    ['Lint and typecheck', 'Database migrations and pgTAP'].every(name =>
      latest.get(name)?.conclusion === 'success');
}

function target(env) {
  assert.ok(env.EXPO_PUBLIC_APP_ENV === 'preview' && env.EXPO_PUBLIC_SUPABASE_URL === origin,
    'Preview must use the pinned CampusClutch Preview origin and environment');
  const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  let claims;
  try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); } catch { /* Report only the setting name. */ }
  assert.ok(key.split('.').length === 3 && claims?.role === 'anon' && claims.ref === project,
    'Preview requires its own public Supabase key');
}

function prepare(root, directory) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const app = read('app.json').expo;
  const profile = read('eas.json').build.preview;
  assert.ok(app.extra?.eas?.projectId === expoProject && app.android?.package === 'com.marchosias405.campusclutch',
    'Unexpected Expo project or Android application');
  assert.ok(profile.environment === 'preview' && profile.distribution === 'internal' &&
    !profile.developmentClient && (!profile.android?.buildType || profile.android.buildType === 'apk'),
    'Use an internal standalone Android Preview profile');
  for (const name of ['app.config.js', ...workers.map(worker => 'supabase/functions/' + worker + '/index.ts')]) {
    assert.ok(fs.existsSync(path.join(root, name)), 'Tested app source missing: ' + name);
  }
  const migrations = path.join(root, 'supabase/migrations');
  const files = fs.readdirSync(migrations).filter(file => file.endsWith('.sql'));
  assert.ok(files.includes('20261124064748_avatar_storage_budget.sql'), 'Commit predates the verified Preview database');
  const output = path.join(directory, 'supabase');
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(output); // Refuse to mix the plan with a previous link or project.
  fs.mkdirSync(path.join(output, 'migrations'));
  fs.copyFileSync(path.join(root, 'supabase/config.toml'), path.join(output, 'config.toml'));
  for (const file of files.filter(name => !deferred.has(name))) {
    fs.copyFileSync(path.join(migrations, file), path.join(output, 'migrations', file));
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'gate') {
    const [eventFile, repository, mainSha, jobsFile] = args;
    const run = JSON.parse(fs.readFileSync(eventFile)).workflow_run;
    const jobs = JSON.parse(fs.readFileSync(jobsFile)).flatMap(page => page.jobs);
    console.log('eligible=' + eligible(run, repository, mainSha, jobs));
  } else if (command === 'prepare') {
    prepare(process.cwd(), args[0]);
  } else if (command === 'verify-build') {
    if (process.env.EAS_BUILD_PROFILE === 'preview') target(process.env);
  } else if (command === 'target' || command === 'smoke') {
    target(process.env);
    const response = await fetch(origin + '/auth/v1/settings', {
      headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    assert.ok(response.ok && (await response.json()).external?.email === true, 'Preview email Auth check failed');
    if (command === 'smoke') {
      const callback = await fetch(origin + '/functions/v1/email-verified', { redirect: 'error', signal: AbortSignal.timeout(20000) });
      assert.ok(callback.ok && (await callback.text()).startsWith('CampusClutch\n'), 'Preview email callback check failed');
    }
  } else throw Error('Unknown Preview release command');
}

module.exports = { project, expoProject, eligible, target, prepare, deferred };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
