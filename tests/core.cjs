'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
global.window=global;
for(const file of ['content.js','training-core.js','plans.js','backup.js'])vm.runInThisContext(fs.readFileSync(file,'utf8'),{filename:file});
const P=LongPlans,T=TrainingCore,B=TrainingBackup;
(async()=>{
  for(const month of ['2024-02','2025-02','2026-04','2026-12','2027-01']){
    const cells=P.monthCells(month);assert.equal(cells.length,42);assert.equal(P.parseDate(cells[0]).getDay(),1);assert.equal(new Set(cells).size,42);
    const expected=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();assert.equal(cells.filter(d=>d.startsWith(month)).length,expected);
  }
  assert.equal(P.addDays('2026-12-31',1),'2027-01-01');assert.equal(P.addDays('2024-02-28',1),'2024-02-29');assert.throws(()=>P.parseDate('2025-02-29'));
  for(const count of [1,4,8,12,52]){
    const template=P.makeTemplate(count);P.validateTemplate(template);const plan=P.instantiate(template,'2026-10-07');
    assert.equal(plan.tasks.length,count*2);assert.equal(plan.tasks[1].date,'2026-10-10');
    template.weeks[0].program.modules[0].durationSec=900;assert.equal(plan.tasks[0].programSnapshot.modules[0].durationSec,180);
    plan.confirmedWeek=0;assert.equal(P.effectiveWeek(plan,plan.tasks.at(-1)).phase,plan.templateSnapshot.weeks[0].phase);
  }
  const plan=P.instantiate(P.makeTemplate(4),'2026-09-01');const completed=plan.tasks[0];completed.status='COMPLETED';const doneDate=completed.date;
  const changes=P.shiftPreview(plan,'2026-10-03');assert.equal(changes[0].to,'2026-10-03');assert.ok(!changes.some(c=>c.id===completed.id));assert.equal(completed.date,doneDate);
  P.repeatWeek(plan);assert.equal(plan.templateSnapshot.weeks.length,5);assert.equal(completed.date,doneDate);assert.throws(()=>P.repeatWeek(P.instantiate(P.makeTemplate(52),'2026-01-01')));
  assert.ok(plan.tasks.filter(t=>t.weekIndex===1&&t.status==='PLANNED').every(t=>t.date>=P.dateKey()));
  const eight=P.instantiate(P.makeTemplate(8),'2026-10-01');assert.equal(P.nextPhaseWeek(eight),2);assert.equal(P.phaseDue(eight,'2026-10-14'),false);assert.equal(P.phaseDue(eight,'2026-10-15'),true);assert.equal(P.effectiveWeek(eight,eight.tasks[2]),eight.templateSnapshot.weeks[1]);
  const rest=P.makeTemplate(1);rest.weeks[0].days=[];assert.equal(P.instantiate(rest,'2026-10-03').tasks.length,0);
  const session={id:'test',activeAccumulatedMs:1000,activeStartedAt:1000,pausedAt:null};assert.equal(T.elapsed(session,3000),3000);
  const cp=T.checkpoint(session,3000);assert.equal(cp.activeStartedAt,null);assert.equal(cp.activeAccumulatedMs,3000);assert.equal(T.elapsed(T.recover(cp),900000),3000);
  assert.equal(T.median([1,3,5,7]),4);assert.equal(T.median([null,4]),4);assert.equal(T.median([]),null);
  assert.equal(T.guidedStep({type:'timed',remainingSec:10},3500).state.remainingSec,6.5);
  const interval={type:'interval',round:1,rounds:2,intervalPhase:'contract',phaseRemainingSec:3};const transitioned=T.guidedStep(interval,10000);assert.equal(transitioned.state.round,2);assert.equal(transitioned.state.intervalPhase,'contract');assert.equal(transitioned.state.phaseRemainingSec,2);
  assert.equal(T.guidedStep(interval,19000).done,true);
  const payload={format:'ec-training-backup',version:3,sessions:[{id:'s1',createdAt:1,cycles:[],events:[]}],meta:{settings:{externalCoachEnabled:true,externalCoachConsent:true,externalCoachToken:'secret'},longTemplates:[P.makeTemplate(4)],longPlans:[]}};
  const safe=B.validate(payload);assert.equal(safe.meta.settings.externalCoachEnabled,false);assert.equal(safe.meta.settings.externalCoachToken,undefined);
  assert.throws(()=>B.validate({...payload,version:99}));assert.throws(()=>B.validate({...payload,sessions:[{id:'x',cycles:'broken'}]}));assert.throws(()=>B.validate({...payload,sessions:[{id:'x'},{id:'x'}]}));
  const merged=B.merge([{id:'same',createdAt:1}],[{id:'same',createdAt:2},{id:'new'}]);assert.equal(merged.sessions.length,2);assert.equal(merged.sessions[0].createdAt,1);assert.deepEqual(merged.conflicts,['same']);
  const encrypted=await B.encrypt(payload,'correct horse battery staple');assert.equal(encrypted.sessions,undefined);assert.ok(!JSON.stringify(encrypted).includes('"sessions"'));
  const decoded=await B.decrypt(encrypted,'correct horse battery staple');assert.equal(decoded.sessions[0].id,'s1');
  await assert.rejects(B.decrypt(encrypted,'wrong-password'));const damaged={...encrypted,ciphertext:encrypted.ciphertext.slice(0,-8)+'AAAAAAAA'};await assert.rejects(B.decrypt(damaged,'correct horse battery staple'));
  assert.equal(B.validate({...payload,version:2}).sessions.length,1);
  const legacy=P.migrateLegacy({currentWeek:3,weekStartedAt:P.parseDate('2026-10-01').getTime(),schedule:[{id:'original-task',date:'2026-10-02',programId:'standard',status:'COMPLETED',completedSessionId:'s1'}]},[P.baseProgram()]);assert.equal(legacy.tasks[0].id,'original-task');assert.equal(legacy.tasks[0].completedSessionId,'s1');assert.equal(legacy.templateSnapshot.legacyStage,3);assert.equal(legacy.legacy,true);
  assert.throws(()=>P.validateProgram({name:'wrong units',modules:[{exerciseId:'stop_start',durationSec:60}]}));
  assert.throws(()=>B.validate({...payload,meta:{acceptedParameters:{stopThreshold:5,resumeThreshold:8}}}));
  assert.throws(()=>B.validate({...payload,sessions:[{id:'broken-event',events:[null]}]}));assert.throws(()=>B.validate({...payload,sessions:[{id:'future',schemaVersion:6}]}));assert.throws(()=>B.validate({...payload,meta:{currentSession:{id:'broken-clock',phase:'MODULE_ACTIVE',guidedState:{type:'timed',remainingSec:'wrong'}}}}));
  assert.throws(()=>B.validate({...payload,meta:{longPlans:[{...P.instantiate(P.makeTemplate(4),'2026-10-03'),tasks:[{id:'broken',date:'2026-10-03',status:'PLANNED'}]}]}}));
  for(const text of Object.values(TrainingContent.modules)){assert.ok(text.short&&text.detail&&text.limitation);for(const key of text.sourceIds)assert.ok(TrainingContent.sources[key]?.url.startsWith('https://'));}
  console.log('CORE / PLANS / CONTENT / BACKUP TESTS OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
