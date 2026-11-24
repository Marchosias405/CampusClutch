const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');

// Check an actual installation upgrade with an outstanding status-only receipt.
// This fixture has no account, and the status request is answered locally.
async function checkWebCredentialUpgrade(browser, origin, backend) {
  const context = await browser.newContext();
  context.setDefaultTimeout(20000);
  const key = 'campusclutch:account-deletion:v1:' + encodeURIComponent(backend.url);
  const priorKey = 'campusclutch:account-deletion:v1:' + encodeURIComponent('https://earlier-project.invalid');
  const sessionKey = 'sb-' + new URL(backend.url).hostname.split('.')[0] + '-auth-token';
  const receipt = { id: randomUUID(), userId: randomUUID(), secret: randomBytes(32).toString('hex') };
  const priorReceipt = { id: randomUUID(), userId: randomUUID(), secret: randomBytes(32).toString('hex') };
  let checks = 0;
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === backend.url && url.pathname === '/functions/v1/account-deletion') {
        if (route.request().method() === 'POST') {
          assert.deepEqual(route.request().postDataJSON(), { id: receipt.id, secret: receipt.secret });
          checks++;
        }
        return route.fulfill({ json: { status: 'pending' }, headers: {
          'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'apikey, content-type',
        } });
      }
      return url.origin === origin || url.origin === backend.url ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    // Interrupt only the inactive project's first migration transaction.
    await page.addInitScript(priorKey => {
      if (!sessionStorage.getItem('test-interrupt-receipt')) return;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, name) {
        const request = put.call(this, value, name);
        if (this.name === 'receipts' && name === priorKey) {
          this.transaction.abort();
          sessionStorage.setItem('test-receipt-aborted', 'yes');
        }
        return request;
      };
    }, priorKey);
    await page.goto(origin);
    await page.getByText('Sign In', { exact: true }).waitFor();
    await page.evaluate(({ key, priorKey, sessionKey, receipt, priorReceipt }) => {
      localStorage.setItem(key, JSON.stringify(receipt));
      localStorage.setItem(priorKey, JSON.stringify(priorReceipt));
      localStorage.setItem(priorKey + ':display', 'unrelated setting');
      sessionStorage.setItem('test-interrupt-receipt', 'yes');
      for (const suffix of ['', '-user', '-code-verifier']) localStorage.setItem(sessionKey + suffix, 'legacy test value');
      localStorage.setItem('sb-priordev-auth-token', 'older test backend');
      localStorage.setItem('sb-priordev-auth-token-display', 'unrelated setting');
    }, { key, priorKey, sessionKey, receipt, priorReceipt });
    // A second tab on the same origin holds the inactive receipt lock across
    // the retry. The current project's status button must remain usable.
    const otherTab = await context.newPage();
    await otherTab.route(origin + '/receipt-lock-test', route => route.fulfill({contentType:'text/html', body:'<title>Local receipt fixture</title>'}));
    await otherTab.goto(origin + '/receipt-lock-test');
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.reload();
      await page.getByRole('button', { name: 'Check deletion status' }).click();
      await page.getByText('Cleanup is in progress.', { exact: false }).waitFor();
      if (attempt === 0) {
        await page.waitForFunction(() => sessionStorage.getItem('test-receipt-aborted') === 'yes');
        assert.ok(await page.evaluate(({priorKey, priorReceipt}) =>
          localStorage.getItem(priorKey) === JSON.stringify(priorReceipt), {priorKey, priorReceipt}),
        'An interrupted transaction keeps the pending receipt recoverable');
        await page.evaluate(() => sessionStorage.removeItem('test-interrupt-receipt'));
        await otherTab.evaluate(name => new Promise(ready => {
          void navigator.locks.request(name, () => new Promise(release => {
            window.releaseReceiptLock = release;
            ready();
          }));
        }), priorKey);
      } else {
        await page.waitForFunction(async name => (await navigator.locks.query()).pending.some(lock => lock.name === name), priorKey);
        await otherTab.evaluate(() => window.releaseReceiptLock());
        await page.waitForFunction(name => localStorage.getItem(name) === null, priorKey);
      }
      const migrated = await page.evaluate(async ({ key, priorKey, sessionKey, receipt, priorReceipt, attempt }) => {
        const oldKeys = [key, sessionKey, sessionKey + '-user', sessionKey + '-code-verifier', 'sb-priordev-auth-token'];
        const leftover = oldKeys.find(k => localStorage.getItem(k) !== null);
        if (leftover) return 'Legacy key still present: ' + leftover;
        if (localStorage.getItem('sb-priordev-auth-token-display') !== 'unrelated setting') return 'Unrelated auth setting changed';
        if (localStorage.getItem(priorKey + ':display') !== 'unrelated setting') return 'Unrelated receipt setting changed';
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('campusclutch-deletion-receipts');
          r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        try {
          for (const [name, expected] of [[key, receipt], [priorKey, priorReceipt]]) {
            const record = await new Promise((resolve, reject) => {
              const r = db.transaction('receipts').objectStore('receipts').get(name);
              r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
            });
            if (name === priorKey && attempt === 0) {
              if (record !== undefined) return 'Interrupted record was committed';
              continue;
            }
            if (!(record?.key instanceof CryptoKey) || record.key.extractable || !(record.ciphertext instanceof ArrayBuffer)) return 'Missing encrypted receipt';
            const decrypted = await crypto.subtle.decrypt({name:'AES-GCM', iv:record.iv,
              additionalData:new TextEncoder().encode(name)}, record.key, record.ciphertext);
            if (new TextDecoder().decode(decrypted) !== JSON.stringify(expected)) return 'Receipt contents changed';
          }
          return 'ok';
        } finally { db.close(); }
      }, { key, priorKey, sessionKey, receipt, priorReceipt, attempt });
      assert.equal(migrated, 'ok');
    }
    assert.equal(checks, 2, 'The original receipt works before and after a second reload');
    console.log('PASS browser credential upgrade for two projects, interrupted write, cross-tab retry, encrypted receipts and status after reload');
  } finally { await context.close(); }
}

module.exports = { checkWebCredentialUpgrade };
