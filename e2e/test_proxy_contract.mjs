import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import http from 'node:http';

const root = fileURLToPath(new URL('..', import.meta.url));
const relayDir = path.join(root, 'relay');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'ec-v09-'));
const tokenFile = path.join(tmp, 'relay_token');
const keyFile = path.join(tmp, 'openai_key');
await writeFile(tokenFile, 'proxy-secret\n', { mode: 0o600 });
await writeFile(keyFile, 'fake-openai-key\n', { mode: 0o600 });
const port = 19600 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
let stdout = '';
let stderr = '';
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: relayDir,
  env: {
    ...process.env,
    HOST: '127.0.0.1', PORT: String(port), MOCK_OPENAI: '1', TRUST_PROXY: '1',
    RELAY_BEARER_TOKEN_FILE: tokenFile,
    OPENAI_API_KEY_FILE: keyFile,
    RATE_LIMIT_MAX: '1', RATE_LIMIT_WINDOW_MS: '5000', RATE_LIMIT_BACKEND: 'memory',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', d => { stdout += d.toString(); });
child.stderr.on('data', d => { stderr += d.toString(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/ready`); if (r.ok) return r.json(); } catch {}
    await sleep(50);
  }
  throw new Error(`relay did not become ready\nstdout=${stdout}\nstderr=${stderr}`);
}
const body = {
  schema:'coach-chat-request-v1',
  policy:{explainOnly:true,mayModifyTrainingEngine:false,rawEventsAllowed:false,medicalDiagnosisAllowed:false,trainingParameterAdviceAllowed:false},
  model:null,
  context:{schema:'coach-context-v1',generatedAt:1,source:'real',stage:{week:1,name:'基线'},promptMode:'full',samples:{completed:1,stopStart:1,usable:1,excluded:0,recent:1,previous:0},recent:{count:1},previous:{count:0},change:{artPct:null,overshootDelta:null,controlDelta:null,stopLevelDelta:null},signals:[],latestState:{pain:false,difficulty:'合适',awareness:'一点'},adaptive:{type:'KEEP_CURRENT_DIFFICULTY',title:'保持当前难度',reason:'样本不足',applied:false},privacy:{rawEventsIncluded:false,exactTimestampsIncluded:false,sessionIdsIncluded:false,revisionsIncluded:false}},
  conversation:[], message:'下一次关注什么？', responseFormat:{schema:'coach-chat-response-v1',allowedFields:['answer','focus','evidence','uncertainty','safetyNotice']}
};

function postCoach(headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname:'127.0.0.1', port, path:'/api/coach', method:'POST', headers }, res => {
      const chunks=[];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
const proxyHeaders = {
  'Content-Type':'application/json',
  'Authorization':'Bearer proxy-secret',
  'Origin':'https://training.example.com',
  'Host':'training.example.com',
  'X-Forwarded-Proto':'https',
  'X-Forwarded-For':'203.0.113.7',
};
try {
  const ready = await waitReady();
  assert.equal(ready.ok, true);
  assert.equal(ready.coreReady, true);
  const coachReady=await (await fetch(`${base}/api/coach/ready`)).json();
  assert.equal(coachReady.rateLimiter.backend, 'memory');

  const ok = await postCoach(proxyHeaders);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], 'https://training.example.com');
  assert.equal(ok.headers['x-ratelimit-backend'], 'memory');

  const limited = await postCoach(proxyHeaders);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['retry-after']) >= 1);

  const evil = await postCoach({...proxyHeaders, Origin:'https://evil.example', 'X-Forwarded-For':'203.0.113.8'});
  assert.equal(evil.status, 403);

  await sleep(50);
  assert.equal(stdout.includes('proxy-secret'), false);
  assert.equal(stdout.includes('fake-openai-key'), false);
  console.log('PROXY/SECRET CONTRACT TEST OK');
} finally {
  child.kill('SIGTERM');
  await sleep(50);
  await rm(tmp, { recursive:true, force:true });
}
