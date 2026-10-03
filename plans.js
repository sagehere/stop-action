(() => {
  'use strict';
  const clone=value=>structuredClone(value);
  const id=prefix=>prefix+'-'+crypto.randomUUID();
  function dateKey(date=new Date()){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
  function parseDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('日期格式无效');
    const [y,m,d]=value.split('-').map(Number), date=new Date(y,m-1,d,12);
    if(dateKey(date)!==value)throw new Error('日期不存在');return date;
  }
  function addDays(value,days){const date=parseDate(value);date.setDate(date.getDate()+days);return dateKey(date);}
  function dayDistance(a,b){const x=parseDate(a),y=parseDate(b);return Math.round((Date.UTC(y.getFullYear(),y.getMonth(),y.getDate())-Date.UTC(x.getFullYear(),x.getMonth(),x.getDate()))/86400000);}
  function monthCells(month){const start=parseDate(month+'-01'),offset=(start.getDay()+6)%7;return Array.from({length:42},(_,i)=>addDays(dateKey(start),i-offset));}
  const baseProgram=()=>({id:'standard',name:'基础觉察与动停',description:'可编辑的产品初始安排',modules:[{exerciseId:'breathing',durationSec:180},{exerciseId:'stop_start',cycles:2},{exerciseId:'pelvic_release',durationSec:120}]});
  function phaseFor(length,index){
    if(length===4)return index===0?'熟悉操作与觉察':index===3?'复盘与后续安排':'动停与恢复';
    if(length===8)return ['熟悉与校准','稳定流程','提前识别信号','自主判断与复盘'][Math.floor(index/2)];
    if(length===12)return index<2?'熟悉与校准':index<6?'稳定流程':index<10?'自主练习':'巩固与后续安排';
    return '个人练习';
  }
  function makeTemplate(length=8){return {schemaVersion:1,id:id('template'),version:1,contentVersion:window.TrainingContent?.version||'1.0.0',contentSnapshot:clone(window.TrainingContent.modules),name:length+'周个人计划',sourceIds:['eau','nhs','trial','rehab'],weeks:Array.from({length},(_,i)=>({id:id('week'),phase:phaseFor(length,i),goal:'留意个人信号，完成后记录感受；不追求时长或高等级。',days:[0,3],program:baseProgram()})),createdAt:Date.now()};}
  const builtins=[4,8,12].map(length=>({...makeTemplate(length),id:'builtin-'+length,builtin:true,name:length===4?'4周入门':length===8?'8周循序练习':'12周巩固'}));
  function validateProgram(program){
    if(!program||typeof program.name!=='string'||!program.name.trim()||program.name.length>80||!Array.isArray(program.modules)||!program.modules.length||program.modules.length>20)throw new Error('单次方案无效');
    for(const module of program.modules){
      if(!window.TrainingContent.modules[module.exerciseId])throw new Error('未知训练模块');
      const timed=!['stop_start','pelvic_coordination'].includes(module.exerciseId),value=timed?module.durationSec:module.exerciseId==='stop_start'?module.cycles:module.rounds;
      if(!Number.isFinite(value)||value<=0||value>(timed?1800:30)||(!timed&&!Number.isInteger(value)))throw new Error('模块数量需在允许范围内');
    }
  }
  function validateTemplate(template){
    if(!template||template.schemaVersion!==1||typeof template.name!=='string'||!template.name.trim()||template.name.length>80||!Array.isArray(template.weeks)||template.weeks.length<1||template.weeks.length>52)throw new Error('计划需要名称及1–52周');
    if(typeof template.id!=='string'||!template.id||template.id.length>150)throw new Error('模板ID无效');
    if(template.sourceIds&&(!Array.isArray(template.sourceIds)||template.sourceIds.some(key=>!window.TrainingContent.sources[key])))throw new Error('来源引用无效');
    if(template.contentSnapshot){for(const [key,entry] of Object.entries(template.contentSnapshot)){if(!window.TrainingContent.modules[key]||!entry||typeof entry.short!=='string'||entry.short.length>2000||typeof entry.detail!=='string'||entry.detail.length>5000||!Array.isArray(entry.sourceIds)||entry.sourceIds.some(id=>!window.TrainingContent.sources[id]))throw new Error('内容快照无效');}}
    template.weeks.forEach(week=>{
      if(typeof week.phase!=='string'||week.phase.length>80||typeof week.goal!=='string'||week.goal.length>1000)throw new Error('周目标无效');
      if(!Array.isArray(week.days)||week.days.length>7||new Set(week.days).size!==week.days.length||week.days.some(day=>!Number.isInteger(day)||day<0||day>6))throw new Error('每周训练日应为0–6且不能重复');
      validateProgram(week.program);
    });return template;
  }
  function instantiate(template,startDate){
    validateTemplate(template);parseDate(startDate);
    const instance={schemaVersion:1,id:id('plan'),name:template.name,templateSnapshot:clone(template),startDate,status:'ACTIVE',confirmedWeek:0,confirmations:[],createdAt:Date.now(),tasks:[]};
    template.weeks.forEach((week,index)=>week.days.forEach(day=>instance.tasks.push({schemaVersion:1,id:id('task'),planId:instance.id,weekIndex:index,date:addDays(startDate,index*7+day),originalDate:addDays(startDate,index*7+day),programId:week.program.id||'standard',programSnapshot:clone(week.program),status:'PLANNED',createdAt:Date.now()})));
    return instance;
  }
  function currentWeek(instance,today=dateKey()){return Math.max(0,Math.min(instance.templateSnapshot.weeks.length-1,Math.floor(dayDistance(instance.startDate,today)/7)));}
  function effectiveWeek(instance,task){const weeks=instance.templateSnapshot.weeks,requested=weeks[task?.weekIndex??currentWeek(instance)],confirmed=weeks[instance.confirmedWeek];return requested?.phase===confirmed.phase?requested:confirmed;}
  function nextPhaseWeek(instance){const weeks=instance.templateSnapshot.weeks,phase=weeks[instance.confirmedWeek].phase;const index=weeks.findIndex((week,i)=>i>instance.confirmedWeek&&week.phase!==phase);return index<0?null:index;}
  function phaseDue(instance,today=dateKey()){const index=nextPhaseWeek(instance);if(index===null)return false;const dates=instance.tasks.filter(t=>t.weekIndex>=index&&t.status!=='CANCELLED').map(t=>t.date).sort();return (dates[0]||addDays(instance.startDate,index*7))<=today;}
  function shiftPreview(instance,startDate,today=dateKey()){
    parseDate(startDate);const tasks=instance.tasks.filter(task=>task.status==='PLANNED').sort((a,b)=>a.date.localeCompare(b.date));
    if(!tasks.length)return [];
    const delta=dayDistance(tasks[0].date,startDate);
    return tasks.map(task=>({id:task.id,from:task.date,to:addDays(task.date,delta)}));
  }
  function repeatWeek(instance,today=dateKey()){
    if(instance.templateSnapshot.weeks.length>=52)throw new Error('已到52周上限，请把当前阶段保存为后续计划。');
    const at=instance.confirmedWeek+1, week=clone(instance.templateSnapshot.weeks[instance.confirmedWeek]);week.id=id('week');
    instance.templateSnapshot.weeks.splice(at,0,week);
    const repeatStart=[today,addDays(instance.startDate,at*7)].sort().at(-1),future=instance.tasks.filter(t=>t.status==='PLANNED'&&t.weekIndex>=at),first=future.map(t=>t.date).sort()[0],delta=first?Math.max(7,dayDistance(first,addDays(repeatStart,7))):7;
    future.forEach(t=>{t.date=addDays(t.date,delta);t.weekIndex++;});
    week.days.forEach(day=>instance.tasks.push({schemaVersion:1,id:id('task'),planId:instance.id,weekIndex:at,date:addDays(repeatStart,day),originalDate:addDays(instance.startDate,at*7+day),programId:week.program.id,programSnapshot:clone(week.program),status:'PLANNED',createdAt:Date.now()}));
    instance.confirmedWeek=at;instance.confirmations.push({type:'REPEAT',week:at,at:Date.now()});
  }
  function migrateLegacy(plan,programs){
    const length=Math.max(1,9-(plan.currentWeek||0)),template=makeTemplate(length);
    template.name='旧版进行中计划';template.legacyStage=plan.currentWeek||0;
    const originalProgram=programs.find(p=>p.id==='standard')||baseProgram();template.weeks.forEach(week=>week.program=clone(originalProgram));
    template.weeks[0].phase='旧版阶段 '+(plan.currentWeek||0);template.weeks[0].goal='保留旧版阶段与安排；未来调整由你确认。';
    const instance=instantiate(template,dateKey(new Date(plan.weekStartedAt||Date.now())));
    const generated=instance.tasks.filter(task=>task.weekIndex>0);
    instance.tasks=(plan.schedule||[]).map(task=>({...clone(task),schemaVersion:1,planId:instance.id,weekIndex:0,programSnapshot:clone(programs.find(p=>p.id===task.programId)||baseProgram())})).concat(generated);
    instance.legacy=true;return instance;
  }
  window.LongPlans={clone,id,dateKey,parseDate,addDays,dayDistance,monthCells,baseProgram,makeTemplate,builtins,validateProgram,validateTemplate,instantiate,currentWeek,effectiveWeek,nextPhaseWeek,phaseDue,shiftPreview,repeatWeek,migrateLegacy};
})();
