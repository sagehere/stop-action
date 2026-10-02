import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const upstreamPort=19300+Math.floor(Math.random()*300);
const relayPort=19650+Math.floor(Math.random()*300);
let captured=null;
let mode='ok';
let retryHits=0;
const upstream=http.createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/v1/responses'){res.writeHead(404);return res.end();}
  let raw=''; for await(const c of req)raw+=c;
  captured={headers:req.headers,body:JSON.parse(raw)};
  if(mode==='slow'){await new Promise(r=>setTimeout(r,700));}
  if(mode==='retry' && retryHits++===0){res.writeHead(429,{'Content-Type':'application/json','Retry-After':'0.05','x-request-id':'up_retry_1'});return res.end(JSON.stringify({error:{message:'rate limited'}}));}
  if(mode==='refusal'){const payload={id:'resp_refusal',output:[{type:'message',content:[{type:'refusal',refusal:'cannot comply'}]}]};res.writeHead(200,{'Content-Type':'application/json','x-request-id':'up_refusal_1'});return res.end(JSON.stringify(payload));}
  if(mode==='incomplete'){const payload={id:'resp_incomplete',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]};res.writeHead(200,{'Content-Type':'application/json','x-request-id':'up_incomplete_1'});return res.end(JSON.stringify(payload));}
  const out=mode==='forbidden'
    ? {answer:'请把停止阈值改为 6',focus:'',evidence:[],uncertainty:null,safetyNotice:null}
    : {answer:'继续观察自己的恢复趋势。',focus:'关注更早的身体信号',evidence:[{label:'平均 ART',value:'34s'}],uncertainty:'样本有限。',safetyNotice:null};
  const payload={id:'resp_mock',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(out)}]}]};
  res.writeHead(200,{'Content-Type':'application/json','x-request-id':'up_ok_1'});res.end(JSON.stringify(payload));
});
await new Promise((resolve,reject)=>upstream.listen(upstreamPort,'127.0.0.1',e=>e?reject(e):resolve()));

const relay=spawn(process.execPath,['server.mjs'],{
  cwd:new URL('.',import.meta.url),
  env:{...process.env,HOST:'127.0.0.1',PORT:String(relayPort),OPENAI_API_KEY:'dummy',OPENAI_MODEL:'gpt-5.6-luna',ALLOWED_MODELS:'gpt-5.6-luna',OPENAI_BASE_URL:`http://127.0.0.1:${upstreamPort}/v1`,UPSTREAM_TIMEOUT_MS:'250',UPSTREAM_TOTAL_TIMEOUT_MS:'1200',UPSTREAM_RETRY_COUNT:'1'},
  stdio:['ignore','pipe','pipe']
});
let relayOut='';relay.stdout.on('data',d=>relayOut+=d.toString());
const base=`http://127.0.0.1:${relayPort}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<50;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)break;}catch{} await sleep(50);}

const reqBody={
  schema:'coach-chat-request-v1',
  policy:{explainOnly:true,mayModifyTrainingEngine:false,rawEventsAllowed:false,medicalDiagnosisAllowed:false,trainingParameterAdviceAllowed:false},
  model:'gpt-5.6-luna',
  context:{schema:'coach-context-v1',samples:{usable:3},latestState:{pain:false},privacy:{rawEventsIncluded:false,exactTimestampsIncluded:false,sessionIdsIncluded:false,revisionsIncluded:false}},
  conversation:[],message:'下一次关注什么？',responseFormat:{schema:'coach-chat-response-v1',allowedFields:['answer','focus','evidence','uncertainty','safetyNotice']}
};
const post=body=>fetch(`${base}/api/coach`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
try{
  const ok=await post(reqBody);assert.equal(ok.status,200);const data=await ok.json();assert.match(data.output.answer,/继续观察/);
  assert(captured,'upstream request captured');
  assert.equal(captured.body.store,false,'store:false sent upstream');
  assert.equal(captured.body.model,'gpt-5.6-luna');
  assert.equal(captured.body.text?.format?.type,'json_schema');
  assert.equal(captured.body.text?.format?.strict,true);
  assert.equal(captured.headers.authorization,'Bearer dummy');

  const badModel=structuredClone(reqBody);badModel.model='gpt-6-astra';
  const bm=await post(badModel);assert.equal(bm.status,400,'model allowlist enforced');

  mode='retry'; retryHits=0;
  const retried=await post(reqBody);assert.equal(retried.status,200,'temporary 429 retried');assert.equal(retryHits,2,'one retry occurred');

  mode='refusal';
  const refused=await post(reqBody);assert.equal(refused.status,422,'structured refusal handled');

  mode='incomplete';
  const incomplete=await post(reqBody);assert.equal(incomplete.status,502,'incomplete response rejected');

  mode='forbidden';
  const forbidden=await post(reqBody);assert.equal(forbidden.status,502,'relay rejects upstream training-control directive');

  mode='slow';
  const slow=await post(reqBody);assert.equal(slow.status,504,'upstream timeout enforced');

  assert.match(relayOut,/up_ok_1|up_retry_1/,'upstream request id logged');
  console.log('UPSTREAM CONTRACT TEST OK');
}finally{
  relay.kill('SIGTERM');upstream.close();await sleep(40);
}
