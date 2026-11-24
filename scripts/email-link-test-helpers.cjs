/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const port = process.env.CAMPUSCLUTCH_TEST_MAIL_PORT || '54324';
assert.match(port, /^\d{4,5}$/);
const mailbox = `http://127.0.0.1:${port}`;
const exportsForHandler = {};
const handlerCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../supabase/functions/email-verified/handler.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(handlerCode, { exports: exportsForHandler, Request, Response, URL });
const handle = exportsForHandler.handleEmailVerified;
async function readMailLink(email, seen) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent('to:' + email)}`);
    assert.ok(response.ok);
    const data = await response.json();
    const found = data.messages.find(m => !seen.has(m.ID));
    if (found) {
      seen.add(found.ID);
      const detail = await (await fetch(`${mailbox}/api/v1/message/${found.ID}`)).json();
      const link = detail.HTML.match(/href="([^"]*\/auth\/v1\/verify[^\"]*)"/)?.[1]?.replaceAll('&amp;', '&');
      assert.ok(link, 'Default email template includes a real Auth verification link');
      return link;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Expected fixture email in local mail sink');
}
async function cleanupMail(ids) {
  if (!ids.size) return;
  for (const id of ids) assert.match(id, /^[a-zA-Z0-9-]+$/);
  const response = await fetch(`${mailbox}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [...ids] }) });
  assert.ok(response.ok);
}
module.exports = { handle, readMailLink, cleanupMail };
