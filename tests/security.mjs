import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),port=19999,base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['relay/server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),MOCK_OPENAI:'0',OPENAI_API_KEY:'',OPENAI_API_KEY_FILE:'',RELAY_BEARER_TOKEN_FILE:'',RATE_LIMIT_BACKEND:'memory'},stdio:'ignore'});
try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ready')).ok)break;}catch{}await new Promise(r=>setTimeout(r,30));}
  assert.equal((await fetch(base+'/api/ready')).status,200);assert.equal((await fetch(base+'/api/coach/ready')).status,503);
  for(const path of ['/relay/server.mjs','/.git/HEAD','/deploy/docker-compose.yml','/relay/.env.example','/%2e%67%69%74/HEAD','/docs/RELAY_SECURITY_SPEC.md'])assert.equal((await fetch(base+path)).status,404,path);
  assert.equal((await fetch(base+'/%zz')).status,400);
  for(const path of ['/index.html','/content.js','/plans.js','/backup.js','/plan-ui.js','/training-core.js'])assert.equal((await fetch(base+path)).status,200,path);
  assert.equal((await fetch(base+'/index.html',{method:'HEAD'})).headers.get('content-type'),'text/html; charset=utf-8');
  console.log('STATIC BOUNDARY / CORE READY TESTS OK');
}finally{child.kill();}
