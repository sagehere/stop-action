'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const playwright=require(process.argv[2]||'playwright');
const engine=process.env.BROWSER||'chromium',channel=process.argv[3]||process.env.BROWSER_CHANNEL||undefined;
const port=19777,base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['relay/server.mjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',MOCK_OPENAI:'1',RATE_LIMIT_BACKEND:'memory',OPENAI_API_KEY_FILE:'',RELAY_BEARER_TOKEN_FILE:''},stdio:'ignore'});
let browser;
(async()=>{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ready')).ok)break;}catch{}await new Promise(r=>setTimeout(r,30));}
  browser=await playwright[engine].launch({headless:true,...(channel?{channel}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(base);await page.waitForFunction(()=>document.body.dataset.appReady==='true');
  await page.locator('#closeRehearsal').click();await page.locator('[data-nav="plan"]').first().click();
  assert.equal(await page.locator('#scheduleCalendar [data-date]').count(),42);
  await page.locator('[data-template="builtin-4"][data-action="editTemplate"]').click();
  await page.locator('[data-field="name"]').fill('浏览器测试计划');await page.locator('[data-field="name"]').blur();
  await page.locator('[data-action="previewDraft"]').click();assert.equal(await page.locator('.plan-preview > div').count(),8);
  const movedDate=await page.evaluate(()=>LongPlans.addDays(LongPlans.dateKey(),35));await page.locator('[data-preview-date]').nth(1).fill(movedDate);await page.locator('[data-preview-date]').nth(1).blur();await page.locator('[data-action="editPreviewTask"]').nth(1).click();await page.locator('[data-module-value="breathing"]').fill('4');await page.locator('[data-module-value="breathing"]').blur();await page.locator('[data-action="applyPreviewTask"]').click();
  await page.locator('[data-action="activatePreview"]').click();await page.waitForFunction(()=>LongPlanUI.active()?.name==='浏览器测试计划');
  assert.equal(await page.evaluate(()=>LongPlanUI.active().tasks[1].date),movedDate);assert.equal(await page.evaluate(()=>LongPlanUI.active().tasks[1].programSnapshot.modules[0].durationSec),240);assert.equal(await page.evaluate(()=>LongPlanUI.active().templateSnapshot.weeks[0].program.modules[0].durationSec),180);
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:`test-results/calendar-${engine}.png`,fullPage:true});
  await page.evaluate(()=>{window.originalImport=TrainingDB.importData;TrainingDB.importData=()=>Promise.reject(new Error('simulated quota failure'));});await page.locator('[data-action="skipTask"]').first().click();await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('安排未保存'));assert.equal(await page.evaluate(()=>LongPlanUI.active().tasks[0].status),'PLANNED');await page.evaluate(()=>TrainingDB.importData=window.originalImport);
  await page.locator('[data-action="startTask"]').first().click();await page.locator('#continueCheckin').click();await page.locator('#skipModule').click();
  assert.equal(await page.locator('#applyUpdate:visible').count(),0);
  assert.equal(await page.locator('#session.active').count(),1);
  await page.locator('#levelUp').click({clickCount:1});await page.locator('#levelUp').click();await page.locator('#explicitStop').click();
  await page.waitForTimeout(100);await page.locator('#pauseBtn').click();
  const before=await page.evaluate(async()=>await TrainingDB.getCurrentSession());await page.waitForTimeout(700);
  await page.locator('#resumePause').click();await page.locator('#levelDown').click();await page.locator('#explicitResume').click();
  await page.locator('#explicitFinish').click();await page.evaluate(()=>{window.originalComplete=TrainingDB.completeSession;TrainingDB.completeSession=()=>Promise.reject(new Error('simulated disk failure'));});await page.locator('#saveReview').click();await page.waitForFunction(()=>document.getElementById('saveStatus').textContent.includes('失败'));assert.equal(await page.locator('#review.active').count(),1);assert.equal((await page.evaluate(()=>TrainingDB.getAllSessions())).length,0);await page.evaluate(()=>TrainingDB.completeSession=window.originalComplete);await page.locator('#saveReview').click({clickCount:2});await page.waitForSelector('#summary.active');
  const sessions=await page.evaluate(()=>TrainingDB.getAllSessions());assert.equal(sessions.length,1);assert.equal(sessions[0].clockVersion,2);assert.equal(sessions[0].cycles.length,1);assert.ok(sessions[0].cycles[0].artMs<700,'ART excludes 700ms pause');
  assert.equal(await page.evaluate(()=>TrainingDB.getCurrentSession()),null);
  await page.locator('#summaryDone').click();await page.locator('[data-nav="settings"]').first().click();
  await page.locator('#exportJson').click();await page.locator('#backupPassword').fill('browser test password');await page.locator('#backupPasswordAgain').fill('browser test password');
  const downloaded=page.waitForEvent('download');await page.locator('#backupForm button[type="submit"]').click();const download=await downloaded;
  await fs.mkdir('test-results',{recursive:true});const backupPath=path.resolve('test-results/browser-backup.json');await download.saveAs(backupPath);
  const envelope=JSON.parse(await fs.readFile(backupPath,'utf8'));assert.equal(envelope.format,'stop-action-encrypted-backup');
  await page.locator('#importBackupFile').setInputFiles(backupPath);await page.locator('#restorePassword').fill('incorrect password');await page.locator('#restoreSubmit').click();await page.waitForFunction(()=>document.getElementById('restoreError').textContent.includes('密码错误'));
  assert.equal((await page.evaluate(()=>TrainingDB.getAllSessions())).length,1);
  await page.locator('#restorePassword').fill('browser test password');await page.locator('#restoreSubmit').click();await page.waitForFunction(()=>document.getElementById('restoreSubmit').textContent==='确认提交导入');await Promise.all([page.waitForEvent('load'),page.locator('#restoreSubmit').click()]);await page.waitForFunction(()=>document.body.dataset.appReady==='true');
  assert.equal((await page.evaluate(()=>TrainingDB.getAllSessions())).length,1);
  // IndexedDB transaction rollback: a malformed key must not erase the existing row.
  await page.evaluate(async()=>{try{await TrainingDB.importData([{events:[]}],{},true);}catch{}});assert.equal((await page.evaluate(()=>TrainingDB.getAllSessions())).length,1);
  await page.locator('[data-nav="settings"]').first().click();await page.locator('#toggleGestures').click();await page.locator('[data-nav="dashboard"]').first().click();await page.locator('#startTraining').click();await page.locator('#continueCheckin').click();await page.locator('#skipModule').click();
  const level=Number(await page.locator('#arousal').textContent()),surface=await page.locator('#gestureSurface').boundingBox();await page.mouse.move(surface.x+surface.width/2,surface.y+surface.height/2+60);await page.mouse.down();await page.mouse.move(surface.x+surface.width/2,surface.y+surface.height/2-60);await page.mouse.up();assert.equal(Number(await page.locator('#arousal').textContent()),level+1);await page.locator('#levelDown').click();assert.equal(Number(await page.locator('#arousal').textContent()),level);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});await page.locator('#hidePrivacy').click();assert.equal(await page.locator('#pause.active').count(),1);const background=await page.evaluate(()=>TrainingDB.getCurrentSession());await page.waitForTimeout(400);assert.equal((await page.evaluate(()=>TrainingDB.getCurrentSession())).activeAccumulatedMs,background.activeAccumulatedMs);
  await page.reload();await page.waitForFunction(()=>document.body.dataset.appReady==='true');assert.equal(await page.locator('#pause.active').count(),1);
  const recovered=await page.evaluate(()=>TrainingDB.getCurrentSession());assert.equal(recovered.activeStartedAt,null);assert.ok(recovered.activeAccumulatedMs>=0);
  await page.locator('#endFromPause').click();await page.locator('#saveReview').click();await page.locator('#summaryDone').click();
  await page.locator('[data-nav="plan"]').first().click();await page.locator('[data-start-program="mindfulness_only"]').click();await page.locator('#continueCheckin').click();await page.locator('#skipModule').click({clickCount:2});assert.equal(await page.locator('#moduleGuide.active').count(),1);await page.waitForFunction(async()=>{const s=await TrainingDB.getCurrentSession();return s?.moduleIndex===1;});const repeated=await page.evaluate(()=>TrainingDB.getCurrentSession());assert.equal(repeated.moduleResults.length,1);await page.locator('#guidedPause').click();await page.locator('#endFromPause').click();await page.locator('#saveReview').click();await page.locator('#summaryDone').click();
  // Verify own assets are cached, API remains live, and core training starts offline.
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>document.body.dataset.appReady==='true');
  const cacheKeys=await page.evaluate(()=>caches.keys());assert.ok(cacheKeys.includes('stop-action-v20'));
  await page.evaluate(()=>fetch('/api/health'));const cachedApi=await page.evaluate(async()=>{const cache=await caches.open('stop-action-v20');return !!await cache.match('/api/health');});assert.equal(cachedApi,false);
  if(engine==='webkit'){
    // Playwright #42775: setOffline incorrectly blocks even Service Worker responses.
    // Stop the origin instead; prove an uncached browser cannot load it before testing cache recovery.
    const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;
    await assert.rejects(fetch(base+'/api/ready'));
    const uncached=await browser.newContext({serviceWorkers:'block'}),probe=await uncached.newPage();
    try{await assert.rejects(probe.goto(base));}finally{await uncached.close();}
  }else await context.setOffline(true);
  const offlineResponse=await page.reload();assert.equal(offlineResponse.status(),200);assert.equal(offlineResponse.fromServiceWorker(),true);
  await page.waitForFunction(()=>document.body.dataset.appReady==='true');
  assert.equal(await page.evaluate(async()=>{try{await fetch('/api/ready');return true;}catch{return false;}}),false,'API remains unavailable instead of being served from cache');
  const savedBeforeOffline=(await page.evaluate(()=>TrainingDB.getAllSessions())).length;
  await page.locator('#startTraining').click();await page.locator('#continueCheckin').click();assert.equal(await page.locator('#moduleGuide.active').count(),1);
  await page.locator('#guidedPause').click();await page.locator('#endFromPause').click();await page.locator('#saveReview').click();await page.waitForSelector('#summary.active');
  assert.equal((await page.evaluate(()=>TrainingDB.getAllSessions())).length,savedBeforeOffline+1);
  if(engine!=='webkit')await context.setOffline(false);
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log(`BROWSER ${engine} ${channel||''} OK — lifecycle, plans, ART, write failures, background handler, gestures, backup, atomic rollback, cached restart and save (${engine==='webkit'?'origin stopped':'offline emulation'})`);
  await context.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();});
