/* global __dirname */
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { createClient } = require('@supabase/supabase-js');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { localClientConfig, localSql: sql, createStudentFixture, cleanupStudentFixtures } = require('./local-student-fixtures.cjs');

async function main() {
  const { url, key } = localClientConfig();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.CAMPUSCLUTCH_LOCAL_SERVICE_KEY, options);
  const student = createClient(url, key, options);
  const { deletionHandler } = await import(pathToFileURL(path.resolve(__dirname, '../supabase/functions/account-deletion/worker.mjs')));
  const credentials = createStudentFixture();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN0cAAAAASUVORK5CYII=', 'base64');
  const bucket = student.storage.from('avatars');
  let id;
  try {
    const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
    assert.ifError(created.error);
    id = created.data.user.id;
    assert.ifError((await student.auth.signInWithPassword(credentials)).error);
    const upload = file => bucket.upload(id + '/' + file, png, { contentType: 'image/png', upsert: false });
    const attach = file => student.from('profiles').update({avatar_path: id + '/' + file}).eq('id', id).select('avatar_path').single();
    const bytes = async file => {
      const r = await bucket.download(id + '/' + file);
      assert.ifError(r.error);
      assert.deepEqual(Buffer.from(await r.data.arrayBuffer()), png);
    };
    assert.ifError((await upload('first.png')).error);
    assert.ifError((await attach('first.png')).error);
    const choices = ['replacement-a.png', 'replacement-b.png'];
    const uploads = await Promise.all(choices.map(upload));
    assert.equal(uploads.filter(r => !r.error).length, 1);
    const replacement = choices[uploads.findIndex(r => !r.error)];
    assert.equal(sql(`select count(*) from account_private.avatar_files where profile_id='${id}'`), '2');
    await bytes('first.png');
    assert.ifError((await attach(replacement)).error);
    await bytes(replacement);
    console.log('PASS a current photo and one concurrent replacement fit the per-account budget');

    // Simulate a lost save response and a failed cleanup, using only this fixture.
    await bucket.remove([id + '/' + replacement]);
    await bytes(replacement);
    assert.ok((await upload('excess.png')).error);
    assert.equal(sql(`select count(*) from account_private.avatar_files where cleanup_after<=now() and profile_id<>'${id}'`),'0',
      'Run worker tests on an isolated database');
    let failStorage = true;
    const names = [];
    const handler = deletionHandler({
      rpc: async (method, args) => {
        if (method === 'claim_account_deletion') return {status:'unconfirmed'};
        assert.equal(method, 'claim_unused_avatars');
        const r = await admin.rpc(method, args);
        assert.ifError(r.error);
        assert.ok(r.data.every(row => row.name.startsWith(id + '/')));
        return r.data;
      },
      remove: async (bucketId, files) => {
        assert.equal(bucketId, 'avatars');
        assert.deepEqual(files, [id + '/first.png']);
        names.push(...files);
        if (failStorage) throw new Error('Simulated temporary cleanup failure');
        assert.ifError((await admin.storage.from(bucketId).remove(files)).error);
      },
    }, 'avatar-fixture');
    const run = () => handler(new Request('http://localhost/account-deletion', {
      method:'POST',headers:{'x-deletion-worker-secret':'avatar-fixture'},body:'{}',
    }));
    assert.equal((await run()).status, 503);
    assert.ok((await attach('first.png')).error);
    assert.equal((await run()).status, 200);
    assert.equal(names.length, 1);
    await bytes(replacement);
    sql(`update account_private.avatar_files set cleanup_after=now() where profile_id='${id}' and retiring`);
    failStorage = false;
    assert.equal((await run()).status, 200);
    assert.equal(names.length, 2);
    assert.ok((await bucket.download(id + '/first.png')).error);
    await bytes(replacement);
    assert.ifError((await upload('next.png')).error);
    assert.equal((await run()).status, 200);
    assert.equal(names.length, 2);
    console.log('PASS lost confirmation, cleanup failure, retry, and the pending-upload grace protect the current photo');
  } finally {
    if (id) {
      sql(`update public.profiles set avatar_path=null where id='${id}'`);
      const storage = admin.storage.from('avatars');
      const listed = await storage.list(id);
      assert.ifError(listed.error);
      if (listed.data.length) assert.ifError((await storage.remove(listed.data.map(r => id + '/' + r.name))).error);
    }
    cleanupStudentFixtures([credentials]);
  }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
