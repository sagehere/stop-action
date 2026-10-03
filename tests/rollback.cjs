'use strict';
// Explicit release check against a preserved historical revision; no real user data is touched.
const {spawn,spawnSync}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const revision=process.argv[2];if(!revision||!/^[a-zA-Z0-9_.\/-]+$/.test(revision))throw new Error('Specify the preserved old commit/tag');
const playwright=require(process.argv[3]||'playwright'),channel=process.argv[4],base='http://127.0.0.1:19778';
const old={};for(const file of ['index.html','app.js','db.js']){const result=spawnSync('git',['-c','safe.directory='+process.cwd(),'show',revision+':'+file],{encoding:'utf8',maxBuffer:2*1024*1024});if(result.status!==0)throw new Error(result.stderr);old[file]=result.stdout;}
const server=spawn(process.execPath,['relay/server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'19778',MOCK_OPENAI:'1',RATE_LIMIT_BACKEND:'memory'},stdio:'ignore'});
let browser;
(async()=>{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ready')).ok)break;}catch{}await new Promise(r=>setTimeout(r,30));}
  browser=await playwright.chromium.launch({headless:true,...(channel?{channel}:{})});
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(base);await page.waitForFunction(()=>document.body.dataset.appReady==='true');
  await page.locator('#closeRehearsal').click();await page.locator('#startTraining').click();await page.locator('#continueCheckin').click();await page.locator('#skipModule').click();await page.locator('#explicitFinish').click();await page.locator('#saveReview').click();await page.waitForSelector('#summary.active');await page.locator('#summaryDone').click();
  await page.locator('[data-nav="settings"]').first().click();await page.locator('#exportJson').click();await page.locator('#backupMode').selectOption('plain');
  const downloading=page.waitForEvent('download');await page.locator('#backupForm button[type="submit"]').click();const download=await downloading;await fs.mkdir('test-results',{recursive:true});const file=path.resolve('test-results/rollback-v3.json');await download.saveAs(file);const exported=JSON.parse(await fs.readFile(file,'utf8'));
  // Restore into actual historical app code in a clean database and browser context.
  const target=await browser.newContext({serviceWorkers:'block'}),oldPage=await target.newPage();oldPage.on('pageerror',error=>errors.push(error.message));oldPage.on('dialog',dialog=>dialog.accept());
  for(const [name,body] of Object.entries(old))await oldPage.route('**/'+name,route=>route.fulfill({body,contentType:name.endsWith('.html')?'text/html':'text/javascript'}));
  await oldPage.goto(base+'/index.html');await oldPage.waitForFunction(()=>document.body.dataset.appReady==='true');await oldPage.locator('[data-nav="settings"]').first().click();await oldPage.locator('#importBackupFile').setInputFiles(file);
  await oldPage.waitForFunction(()=>document.querySelector('#insights').classList.contains('active'));
  const restored=await oldPage.evaluate(()=>TrainingDB.getAllSessions());assert.deepEqual(restored,exported.sessions);assert.deepEqual(errors,[]);
  // Also verify a migration-before v2 backup through the same historical importer.
  const before=path.resolve('test-results/rollback-before-v2.json');await fs.writeFile(before,JSON.stringify({...exported,version:2,meta:{...exported.meta,longPlans:undefined,longTemplates:undefined}}));
  await oldPage.locator('[data-nav="settings"]').first().click();await oldPage.locator('#importBackupFile').setInputFiles(before);await oldPage.waitForFunction(()=>document.querySelector('#insights').classList.contains('active'));assert.deepEqual(await oldPage.evaluate(()=>TrainingDB.getAllSessions()),exported.sessions);
  console.log('ROLLBACK RESTORE OK — '+revision+'; v2 and plaintext v3 sessions round-trip through historical app');await context.close();await target.close();
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();});
