'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const listeners={},deleted=[],cached=[],scope='https://example.test/sw.js';let skips=0,claims=0;
const context={URL,Response,Promise,Set,self:{location:scope,addEventListener:(name,handler)=>listeners[name]=handler,skipWaiting:()=>{skips++;},clients:{claim:async()=>{claims++;}}},caches:{open:async()=>({addAll:async assets=>cached.push(...assets),match:async()=>null}),keys:async()=>['stop-action-v19','stop-action-v20','another-app-cache'],delete:async key=>deleted.push(key)}};
vm.runInNewContext(fs.readFileSync('sw.js','utf8'),context);
(async()=>{
  let pending;listeners.install({waitUntil:promise=>pending=promise});await pending;assert.equal(skips,0);assert.ok(cached.includes('./plan-ui.js'));
  listeners.activate({waitUntil:promise=>pending=promise});await pending;assert.deepEqual(deleted,['stop-action-v19']);assert.equal(claims,1);
  for(const request of [{method:'GET',url:'https://example.test/api/coach/ready'},{method:'GET',url:'https://foreign.test/app.js'},{method:'POST',url:'https://example.test/app.js'},{method:'GET',url:'https://example.test/missing.png',mode:'no-cors'}])listeners.fetch({request,respondWith:()=>assert.fail('Nonpublic request intercepted')});
  listeners.message({data:{type:'UNKNOWN'}});assert.equal(skips,0);listeners.message({data:{type:'APPLY_UPDATE'}});assert.equal(skips,1);
  console.log('SERVICE WORKER CACHE / UPDATE BOUNDARY TESTS OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
