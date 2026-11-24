const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const {once}=require('node:events');
const {chromium}=require('playwright-core');
const serveStatic=require('serve-static');
const {localClientConfig}=require('./local-student-fixtures.cjs');
(async()=>{
 const {url}=localClientConfig();
 const files=serveStatic(path.resolve('.expo/password-recovery-app'),{extensions:['html']});
 const server=http.createServer((req,res)=>files(req,res,()=>res.writeHead(404).end()));server.listen(0,'127.0.0.1');await once(server,'listening');
 let browser;
 try {
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();let count=0;
  await page.route(url+'/auth/v1/recover*',async route=>{
   count++;const body=route.request().postDataJSON();assert.equal(body.email,'student@example.test');assert.ok(body.code_challenge==null);
   assert.equal(new URL(route.request().url()).searchParams.get('redirect_to'),'http://127.0.0.1:54731/reset-password.html');
   await route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByText('Forgot password?',{exact:true}).click();
  await page.getByRole('textbox',{name:'student@example.com',exact:true}).fill('student@example.test');await page.getByText('Send Reset Link',{exact:true}).click();
  await page.getByText(/Open it on any device to choose a new password/).waitFor();assert.equal(count,1);
  await page.setViewportSize({width:320,height:360});await page.getByText('Return to Sign In',{exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByText('Return to Sign In',{exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'student@example.com',exact:true}).inputValue(),'student@example.test');
  assert.equal(await page.locator('input[placeholder="Enter your password"]:visible').inputValue(),'');
  console.log('PASS exported mobile app requests the browser reset URL and returns to sign-in with only the email prefilled');
 } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
