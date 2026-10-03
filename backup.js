(() => {
  'use strict';
  const FORMAT='ec-training-backup', MAX_BYTES=50*1024*1024;
  const metaKeys=['settings','plan','customPrograms','adaptiveDecision','adaptiveHistory','simulationAdaptiveHistory','coachHistory','coachChatMessages','acceptanceResults','betaTelemetry','betaInstallId','longTemplates','longPlans','activeLongPlanId','currentSession','acceptedParameters','parameterHistory','lastExportAt','onboardingDone','legacyPlanBeforeMigration','migration-long-v1'];
  function validateSession(session){
    if(!session||typeof session.id!=='string'||!session.id||session.id.length>150)throw new Error('记录ID无效');
    if(session.schemaVersion!=null&&(!Number.isInteger(session.schemaVersion)||session.schemaVersion<1||session.schemaVersion>5))throw new Error('训练记录版本不支持');
    for(const key of ['events','cycles','revisions','moduleResults'])if(session[key]!=null&&(!Array.isArray(session[key])||session[key].length>100000))throw new Error('记录数组无效：'+key);
    for(const key of ['events','revisions','moduleResults'])for(const row of session[key]||[]){if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('记录条目无效：'+key);if(key==='events'){if(row.type!=null&&typeof row.type!=='string')throw new Error('事件类型无效');for(const field of ['elapsedMs','at'])if(row[field]!=null&&(!Number.isFinite(row[field])||row[field]<0))throw new Error('事件时间无效');}}
    for(const key of ['createdAt','endedAt','startedAt','activeAccumulatedMs','checkpointAt','pausedAt'])if(session[key]!=null&&(!Number.isFinite(session[key])||session[key]<0))throw new Error('记录时间无效');
    if(session.guidanceSnapshot){window.LongPlans.validateTemplate({...window.LongPlans.makeTemplate(1),contentSnapshot:session.guidanceSnapshot});}
    for(const key of ['stress','fatigue','pelvicTension'])if(session.checkin?.[key]!=null&&(!Number.isFinite(session.checkin[key])||session.checkin[key]<0||session.checkin[key]>10))throw new Error('训练前评分无效');
    if(session.checkin?.pain!=null&&typeof session.checkin.pain!=='boolean')throw new Error('不适记录无效');
    if(session.currentCycle){if(typeof session.currentCycle!=='object'||Array.isArray(session.currentCycle))throw new Error('恢复阶段无效');for(const key of ['signals'])if(session.currentCycle[key]!=null&&!Array.isArray(session.currentCycle[key]))throw new Error('恢复阶段无效');}
    if(session.programSnapshot)window.LongPlans.validateProgram(session.programSnapshot);
    if(session.review?.control!=null&&(!Number.isFinite(session.review.control)||session.review.control<0||session.review.control>10))throw new Error('评分无效');
    for(const cycle of session.cycles||[]){if(!cycle||typeof cycle!=='object')throw new Error('循环无效');for(const key of ['stopLevel','resumeLevel'])if(cycle[key]!=null&&(!Number.isFinite(cycle[key])||cycle[key]<0||cycle[key]>9))throw new Error('等级无效');if(cycle.artMs!=null&&(!Number.isFinite(cycle.artMs)||cycle.artMs<0))throw new Error('ART无效');}
    return session;
  }
  function validate(data){
    if(!data||data.format!==FORMAT||![1,2,3].includes(data.version)||!Array.isArray(data.sessions)||data.sessions.length>50000)throw new Error('备份格式或版本不支持');
    if(new Set(data.sessions.map(s=>s?.id)).size!==data.sessions.length)throw new Error('备份包含重复记录ID');
    data.sessions.forEach(validateSession);
    const meta={};for(const key of metaKeys)if(data.meta?.[key]!==undefined)meta[key]=structuredClone(data.meta[key]);
    for(const key of ['customPrograms','longTemplates','longPlans','adaptiveHistory','coachHistory','coachChatMessages','betaTelemetry','parameterHistory'])if(meta[key]!=null&&(!Array.isArray(meta[key])||meta[key].length>50000))throw new Error('元数据列表无效：'+key);
    (meta.customPrograms||[]).forEach(window.LongPlans.validateProgram);
    (meta.longTemplates||[]).forEach(window.LongPlans.validateTemplate);
    (meta.longPlans||[]).forEach(plan=>{
      window.LongPlans.validateTemplate(plan.templateSnapshot);window.LongPlans.parseDate(plan.startDate);
      if(typeof plan.id!=='string'||!['ACTIVE','PAUSED','ARCHIVED'].includes(plan.status)||!Number.isInteger(plan.confirmedWeek)||plan.confirmedWeek<0||plan.confirmedWeek>=plan.templateSnapshot.weeks.length||!Array.isArray(plan.tasks)||plan.tasks.length>10000)throw new Error('执行计划无效');
      if(!Array.isArray(plan.confirmations)||typeof plan.name!=='string'||plan.name.length>80||new Set(plan.tasks.map(t=>t.id)).size!==plan.tasks.length)throw new Error('计划元数据无效');
      for(const task of plan.tasks){window.LongPlans.parseDate(task.date);if(task.originalDate)window.LongPlans.parseDate(task.originalDate);if(typeof task.id!=='string'||!task.id||task.planId!==plan.id||!Number.isInteger(task.weekIndex)||task.weekIndex<0||task.weekIndex>51||!['PLANNED','COMPLETED','SKIPPED','CANCELLED'].includes(task.status))throw new Error('任务无效');if(task.programSnapshot)window.LongPlans.validateProgram(task.programSnapshot);}
    });
    for(const key of ['longPlans','longTemplates'])if(meta[key]&&new Set(meta[key].map(row=>row.id)).size!==meta[key].length)throw new Error('重复对象ID');
    const taskIds=(meta.longPlans||[]).flatMap(p=>p.tasks.map(t=>t.id));if(new Set(taskIds).size!==taskIds.length)throw new Error('跨计划任务ID重复');
    if(meta.activeLongPlanId!=null&&typeof meta.activeLongPlanId!=='string')throw new Error('主计划ID无效');
    if(meta.acceptedParameters){const p=meta.acceptedParameters;if(!Number.isInteger(p.stopThreshold)||!Number.isInteger(p.resumeThreshold)||p.stopThreshold<1||p.stopThreshold>9||p.resumeThreshold<0||p.resumeThreshold>=p.stopThreshold)throw new Error('训练参数无效');}
    for(const row of meta.parameterHistory||[]){if(!row||!['APPLY','REVERT'].includes(row.kind)||!Number.isFinite(row.at))throw new Error('参数修订无效');for(const p of [row.oldValue,row.newValue])if(!p||!Number.isInteger(p.stopThreshold)||!Number.isInteger(p.resumeThreshold)||p.stopThreshold<1||p.stopThreshold>9||p.resumeThreshold<0||p.resumeThreshold>=p.stopThreshold)throw new Error('参数修订值无效');}
    if(meta.currentSession)validateSession(meta.currentSession);
    if(meta.currentSession){const s=meta.currentSession;if(!['CHECK_IN','MODULE_ACTIVE','BUILD','CONTROL_ZONE','STOP_SUGGESTED','RECOVERY','RESUME_AVAILABLE','COMPLETE_READY','REVIEW','COMPLETED'].includes(s.phase))throw new Error('当前训练状态不支持');if(s.guidedState){const g=s.guidedState;if(g.type==='timed'){if(!Number.isFinite(g.remainingSec)||g.remainingSec<0||g.remainingSec>1800)throw new Error('当前倒计时无效');}else if(g.type==='interval'){if(!Number.isFinite(g.phaseRemainingSec)||g.phaseRemainingSec<0||g.phaseRemainingSec>6||!['contract','release'].includes(g.intervalPhase)||!Number.isInteger(g.rounds)||g.rounds<1||g.rounds>30||!Number.isInteger(g.round)||g.round<1||g.round>g.rounds)throw new Error('当前协调轮次无效');}else throw new Error('当前模块状态不支持');}}
    if(meta.plan&&(!Array.isArray(meta.plan.schedule)||!Number.isFinite(meta.plan.weekStartedAt)))throw new Error('旧计划无效');
    if(meta.settings){if(typeof meta.settings!=='object'||Array.isArray(meta.settings))throw new Error('设置无效');delete meta.settings.externalCoachToken;meta.settings.externalCoachEnabled=false;meta.settings.externalCoachConsent=false;meta.settings.coachChatMode='local';}
    return {...data,meta};
  }
  function base64(bytes){let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
  function unbase64(value){if(typeof value!=='string'||value.length>MAX_BYTES*2)throw new Error('密文无效');return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
  async function derive(password,salt,iterations){
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function encrypt(data,password){
    if(password.length<12)throw new Error('请使用至少12个字符的密码，并妥善保存；密码丢失无法恢复。');
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),iterations=600000;
    const key=await derive(password,salt,iterations);
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('stop-action-encrypted-v1')},key,new TextEncoder().encode(JSON.stringify(data)));
    return {format:'stop-action-encrypted-backup',version:1,kdf:'PBKDF2-SHA-256',iterations,cipher:'AES-256-GCM',salt:base64(salt),iv:base64(iv),ciphertext:base64(new Uint8Array(ciphertext))};
  }
  async function decrypt(envelope,password){
    if(envelope.version!==1||envelope.kdf!=='PBKDF2-SHA-256'||envelope.cipher!=='AES-256-GCM'||envelope.iterations!==600000)throw new Error('加密备份版本不支持');
    try{
      const salt=unbase64(envelope.salt),iv=unbase64(envelope.iv);if(salt.length!==16||iv.length!==12)throw new Error('无效参数');
      const key=await derive(password,salt,envelope.iterations);
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('stop-action-encrypted-v1')},key,unbase64(envelope.ciphertext));
      return validate(JSON.parse(new TextDecoder().decode(plain)));
    }catch{throw new Error('密码错误或文件已损坏；本机数据未改变。');}
  }
  function merge(local,incoming){
    const map=new Map(local.map(s=>[s.id,s])),conflicts=[];for(const row of incoming){if(!map.has(row.id))map.set(row.id,row);else if(JSON.stringify(map.get(row.id))!==JSON.stringify(row))conflicts.push(row.id);}
    return {sessions:[...map.values()],conflicts};
  }
  window.TrainingBackup={MAX_BYTES,metaKeys,validate,validateSession,encrypt,decrypt,merge};
})();
