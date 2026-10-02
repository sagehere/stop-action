'use strict';
const fs=require('fs');
class FakeClassList{toggle(){} add(){} remove(){} contains(){return false}}
function fakeEl(){return {style:{},dataset:{},classList:new FakeClassList(),textContent:'',innerHTML:'',value:'4',checked:false,files:[],addEventListener(){},setAttribute(){},removeAttribute(){},appendChild(){},remove(){},click(){},closest(){return null},querySelectorAll(){return []},querySelector(){return null},setPointerCapture(){}}}
const body=fakeEl();body.dataset={};
global.document={body,querySelector:()=>fakeEl(),querySelectorAll:()=>[],getElementById:()=>fakeEl(),createElement:()=>fakeEl(),elementFromPoint:()=>null};
global.window=global;window.scrollTo=()=>{};window.addEventListener=()=>{};window.PointerEvent=function(){};window.FileReader=function(){};
Object.defineProperty(globalThis,'navigator',{value:{vibrate:()=>true},configurable:true});
global.confirm=()=>true;global.prompt=()=>'';global.alert=()=>{};
Object.defineProperty(globalThis,'location',{value:{protocol:'http:',origin:'http://localhost:8080',href:'http://localhost:8080/index.html'},configurable:true});
class FakeURL{constructor(raw){const m=String(raw).match(/^(https?):\/\/([^\/]+)(.*)$/i);if(!m)throw new Error('bad url');this.protocol=m[1].toLowerCase()+':';this.host=m[2];this.hostname=m[2].split(':')[0];this.href=String(raw)}toString(){return this.href}static createObjectURL(){return ''}static revokeObjectURL(){}}
Object.defineProperty(globalThis,'URL',{value:FakeURL,configurable:true});Object.defineProperty(globalThis,'Blob',{value:function(){},configurable:true});
const mem=new Map();
window.TrainingDB={init:async()=>true,getAllSessions:async()=>[],putSession:async()=>{},deleteSession:async()=>{},getMeta:async(k,f)=>mem.has(k)?mem.get(k):f,setMeta:async(k,v)=>{mem.set(k,v)},deleteMeta:async k=>mem.delete(k),setCurrentSession:async()=>{},getCurrentSession:async()=>null,clearCurrentSession:async()=>{},clearTrainingData:async()=>{mem.clear()}};
const code=fs.readFileSync(process.argv[2]||'app.js','utf8');
try{eval(code)}catch(e){console.error('EVAL_ERROR',e);process.exit(2)}
function assert(cond,msg){if(!cond){console.error('ASSERT_FAIL',msg);process.exit(4)}}
setTimeout(async()=>{
  assert(body.dataset.appReady==='true','app initialization');
  const d=window.__EC_DEBUG__; assert(d,'debug api');
  const rnd=d.seededRandom(1234); const sim=d.makeSimulatedSession(0,Date.now()-56*86400000,rnd);
  const good=d.dataQuality(sim); assert(good.score>=85 && good.usableForTrend,'complete simulated session quality');
  const broken=structuredClone(sim); broken.cycles.forEach(c=>c.artMs=null); broken.events=broken.events.filter(e=>e.type==='STOP_STARTED'); broken.review=null;
  const bad=d.dataQuality(broken); assert(bad.score<65 && !bad.usableForTrend,'broken session excluded from trends');
  const realDefault=d.adaptiveEngine([sim]); assert(realDefault.type==='ESTABLISH_BASELINE','simulated data isolated from real adaptive engine');
  const simAllowed=d.adaptiveEngine([sim],{allowSimulated:true}); assert(simAllowed.type!=='ESTABLISH_BASELINE','simulated adaptive preview allowed');
  const rev={...sim,cycles:[{artMs:50000,stopLevel:7,resumeLevel:5}],events:[],revisions:[{id:'R1',kind:'CYCLE_CORRECTION',cycleIndex:0,field:'artMs',newValue:30000}]};
  assert(d.effectiveCycles(rev)[0].artMs===30000,'correction applied');
  rev.revisions.push({id:'RR1',kind:'REVISION_REVERSED',targetRevisionId:'R1'});
  assert(d.effectiveCycles(rev)[0].artMs===50000,'correction reversal applied');
  const coachContext=d.buildCoachContext([sim]); assert(coachContext.samples.usable===0,'real coach excludes simulated session');
  const simContext=d.buildCoachContext([sim],{allowSimulated:true,onlySimulated:true,decision:d.adaptiveEngine([sim],{allowSimulated:true})}); assert(simContext.samples.usable===1 && simContext.privacy.rawEventsIncluded===false,'coach context minimizes and allows isolated simulation preview');
  const coachOutput=d.coachRuleEngine(simContext); assert(d.validateCoachOutput(coachOutput),'coach output schema valid');
  assert(!('stopThreshold' in coachOutput) && !('resumeThreshold' in coachOutput),'coach cannot emit training control fields');
  const external=d.externalCoachPayload(simContext); assert(external.policy.mayModifyTrainingEngine===false && external.context.privacy.sessionIdsIncluded===false,'external coach payload guardrails');
  const chat=d.localCoachChatReply('为什么最近 ART 会波动？'); assert(typeof chat.answer==='string' && chat.answer.length>10,'local coach multi-turn answer');
  const sanitized=d.sanitizeCoachChatOutput({answer:'ok',focus:'x',stopThreshold:6,evidence:[{label:'A',value:'B'}]}); assert(!('stopThreshold' in sanitized) && sanitized.answer==='ok','chat output allowlist');
  assert(d.containsTrainingControlDirective('请把停止阈值改为 6')===true,'training control directive rejected');
  assert(d.containsTrainingControlDirective('继续观察近期恢复趋势')===false,'normal coach text allowed');
  assert(!!d.validateExternalCoachEndpoint('https://relay.example.com/coach'),'https relay accepted');
  assert(!d.validateExternalCoachEndpoint('http://relay.example.com/coach'),'insecure remote relay rejected');
  assert(!!d.validateExternalCoachEndpoint('http://localhost:8787/coach'),'localhost relay allowed');
  assert(d.bundledRelayEndpoint()==='http://localhost:8080/api/coach','bundled same-origin relay endpoint');
  assert(d.bundledRelayHealthEndpoint()==='http://localhost:8080/api/health','bundled relay health endpoint');
  d.configureBetaTelemetryForTest(); d.recordBetaEvent('SWIPE_LEVEL_UP',{phase:'BUILD',arousal:7,signal:'PELVIC_TENSION'});
  const beta=d.betaExportPayload(); assert(beta.format==='stop-action-device-test' && beta.events.length===1,'device test export generated');
  assert(!('arousal' in beta.events[0].meta) && !('signal' in beta.events[0].meta),'device test export strips sensitive training fields');
  global.fetch=async()=>({ok:true,status:200,json:async()=>({ok:true,service:'coach-relay',upstream:'mock',model:'gpt-5.6-luna',modelConfigured:true})});
  const health=await d.testBundledRelayHealth(); assert(health.ok===true && health.service==='coach-relay','bundled relay health check');
  const chatReq=d.coachChatRequest('下次关注什么'); assert(chatReq.policy.mayModifyTrainingEngine===false && chatReq.policy.rawEventsAllowed===false && chatReq.context.privacy.sessionIdsIncluded===false,'chat request privacy and guardrails');
  d.configureExternalCoachForTest();
  let captured=null; global.fetch=async(url,opts)=>{captured={url,opts};return {ok:true,status:200,json:async()=>({schema:'coach-chat-response-v1',output:{answer:'继续观察近期趋势。',focus:'关注恢复过程',evidence:[{label:'ART',value:'34s'}],uncertainty:'样本有限',safetyNotice:null}})}};
  const extReply=await d.callExternalCoach('为什么？'); assert(extReply.answer.includes('继续观察') && captured && captured.opts.method==='POST','external relay request path');
  const sent=JSON.parse(captured.opts.body); assert(sent.schema==='coach-chat-request-v1' && sent.policy.mayModifyTrainingEngine===false && sent.context.privacy.rawEventsIncluded===false,'external relay payload minimized');
  global.fetch=async()=>({ok:true,status:200,json:async()=>({output:{answer:'把停止阈值改为 6',stopThreshold:6,evidence:[]}})});
  let rejected=false; try{await d.callExternalCoach('修改参数');}catch(_){rejected=true} assert(rejected,'external forbidden control response rejected');
  console.log('RUNTIME SMOKE OK');
},60);
