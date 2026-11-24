const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { expoProject } = require('./preview.cjs');

const unfinished = new Set(['NEW', 'PENDING_UPLOAD', 'IN_QUEUE', 'IN_PROGRESS']);
function usable(build) {
  return build.status === 'FINISHED' && !!build.artifacts?.buildUrl &&
    (!build.expirationDate || Date.parse(build.expirationDate) > Date.now());
}
async function ensureApk(sha, eas, pause = delay) {
  assert.match(sha, /^[a-f0-9]{40}$/);
  const message = 'Preview CI ' + sha;
  function matches(build) {
    return build?.app?.id === expoProject && build.gitCommitHash === sha &&
      build.platform === 'ANDROID' && build.distribution === 'INTERNAL' &&
      build.buildProfile === 'preview' && build.message === message;
  }
  const builds = eas(['build:list','--platform','android','--build-profile','preview',
    '--git-commit-hash',sha,'--limit','25','--json','--non-interactive']).filter(matches);
  let build = builds.find(usable) || builds.find(item => unfinished.has(item.status));
  if (!build) {
    [build] = eas(['build','--platform','android','--profile','preview','--message',message,
      '--no-wait','--non-interactive','--json']);
  }
  assert.ok(build && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(build.id), 'Missing Expo build ID');
  const id = build.id;
  for (let attempt = 0; attempt < 180; attempt++) {
    build = eas(['build:view', id, '--json']);
    assert.ok(build.id === id && matches(build), 'Expo returned a different project, commit or build profile');
    if (usable(build)) return 'https://expo.dev/accounts/marchosias405/projects/CampusClutch/builds/' + id;
    assert.ok(unfinished.has(build.status), 'Preview APK did not finish successfully: ' + build.status);
    await pause(30000);
  }
  throw Error('Timed out waiting for the Preview APK. Retrying will check the existing build.');
}
module.exports = { ensureApk };
if (require.main === module) {
  const eas = args => JSON.parse(execFileSync('eas', args, { encoding:'utf8', stdio:['ignore','pipe','inherit'] }));
  ensureApk(process.env.TESTED_SHA, eas).then(url => {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'url=' + url + '\n');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
