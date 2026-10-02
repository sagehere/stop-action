import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const port = 18787 + Math.floor(Math.random()*500);
const base = `http://127.0.0.1:${port}`;
const secret = 'test-relay-secret';
let stdout = '';
let stderr = '';
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('.', import.meta.url),
  env: {
    ...process.env,
    HOST: '127.0.0.1', PORT: String(port), MOCK_OPENAI: '1',
    RELAY_BEARER_TOKEN: secret, RATE_LIMIT_MAX: '20',
  },
  stdio: ['ignore','pipe','pipe'],
});
child.stdout.on('data', d => { stdout += d.toString(); });
child.stderr.on('data', d => { stderr += d.toString(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitHealth() {
  for (let i=0;i<50;i++) {
    try { const r=await fetch(`${base}/api/health`); if(r.ok)return r.json(); } catch {}
    await sleep(60);
  }
  throw new Error(`relay did not start\nstdout=${stdout}\nstderr=${stderr}`);
}
const goodRequest = {
  schema:'coach-chat-request-v1',
  policy:{explainOnly:true,mayModifyTrainingEngine:false,rawEventsAllowed:false,medicalDiagnosisAllowed:false,trainingParameterAdviceAllowed:false},
  model:null,
  context:{
    schema:'coach-context-v1', generatedAt:1, source:'real', stage:{week:3,name:'恢复能力'}, promptMode:'full',
    samples:{completed:4,stopStart:4,usable:3,excluded:1,recent:3,previous:0},
    recent:{count:3,meanArtSec:34,medianArtSec:33,csr:.8,overshootRate:.2,control:7,stopLevel:7,pelvicTension:4,stress:3,fatigue:3},
    previous:{count:0}, change:{artPct:null,overshootDelta:null,controlDelta:null,stopLevelDelta:null},
    signals:[{label:'盆底紧张',count:2,sessionRate:.66}], latestState:{pain:false,difficulty:'合适',awareness:'比较明显'},
    adaptive:{type:'KEEP_CURRENT_DIFFICULTY',title:'保持当前难度',reason:'继续积累稳定样本',applied:false},
    privacy:{rawEventsIncluded:false,exactTimestampsIncluded:false,sessionIdsIncluded:false,revisionsIncluded:false}
  },
  conversation:[{role:'assistant',text:'可以继续观察。'}],
  message:'下次训练我应该关注什么？ SECRET_QUESTION_SHOULD_NOT_BE_LOGGED',
  responseFormat:{schema:'coach-chat-response-v1',allowedFields:['answer','focus','evidence','uncertainty','safetyNotice']}
};

try {
  const health=await waitHealth();
  assert.equal(health.ok,true);
  assert.equal(health.upstream,'mock');
  assert.equal(health.modelConfigured,true);

  const staticResp=await fetch(`${base}/index.html`);
  assert.equal(staticResp.status,200);
  assert.match(staticResp.headers.get('content-security-policy')||'',/default-src 'self'/);
  assert.match(await staticResp.text(),/v1\.0/);

  const noAuth=await fetch(`${base}/api/coach`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(goodRequest)});
  assert.equal(noAuth.status,401);

  const badOrigin=await fetch(`${base}/api/coach`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${secret}`,'Origin':'https://evil.example'},body:JSON.stringify(goodRequest)});
  assert.equal(badOrigin.status,403);

  const ok=await fetch(`${base}/api/coach`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${secret}`},body:JSON.stringify(goodRequest)});
  assert.equal(ok.status,200);
  const out=await ok.json();
  assert.equal(out.schema,'coach-chat-response-v1');
  assert.equal(typeof out.output.answer,'string');
  assert.equal('stopThreshold' in out.output,false);

  const rawLeak=structuredClone(goodRequest);
  rawLeak.context.events=[{type:'AROUSAL_LEVEL_CHANGED',level:7}];
  const rawResp=await fetch(`${base}/api/coach`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${secret}`},body:JSON.stringify(rawLeak)});
  assert.equal(rawResp.status,400);

  const forbidden=structuredClone(goodRequest);
  forbidden.stopThreshold=6;
  const forbiddenResp=await fetch(`${base}/api/coach`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${secret}`},body:JSON.stringify(forbidden)});
  assert.equal(forbiddenResp.status,400);

  await sleep(80);
  assert.equal(stdout.includes('SECRET_QUESTION_SHOULD_NOT_BE_LOGGED'),false,'request body leaked to logs');
  assert.equal(stdout.includes(secret),false,'bearer token leaked to logs');

  console.log('RELAY CONTRACT TEST OK');
} finally {
  child.kill('SIGTERM');
  await sleep(40);
}
