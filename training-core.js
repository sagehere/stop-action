(() => {
  'use strict';
  function elapsed(session, time = Date.now()) {
    return Math.max(0, (session.activeAccumulatedMs || 0) + (session.activeStartedAt && !session.pausedAt ? Math.max(0,time-session.activeStartedAt) : 0));
  }
  function checkpoint(session, time = Date.now()) {
    const copy=structuredClone(session);
    copy.activeAccumulatedMs=elapsed(session,time);
    copy.activeStartedAt=null;
    copy.checkpointAt=time;
    return copy;
  }
  function recover(session) {
    const result=structuredClone(session);
    result.activeStartedAt=null;
    result.pausedAt=Date.now();
    result.pausedFrom=result.phase;
    result.clockVersion=result.clockVersion || 1;
    // Legacy live clocks cannot reveal when a process was killed. Never add that gap.
    result.recoveryNotice='从最后成功检查点恢复；中断期间未计时，最后未保存的操作可能缺失。';
    return result;
  }
  function median(values) {
    const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
    if(!a.length)return null;
    const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;
  }
  function guidedStep(state, elapsedMs) {
    const copy={...state}; let seconds=Math.max(0,elapsedMs/1000);
    if(copy.type==='timed'){copy.remainingSec=Math.max(0,copy.remainingSec-seconds);return {state:copy,done:copy.remainingSec<=0};}
    while(seconds >= copy.phaseRemainingSec){
      seconds-=copy.phaseRemainingSec;
      if(copy.intervalPhase==='contract'){copy.intervalPhase='release';copy.phaseRemainingSec=6;}
      else if(copy.round<copy.rounds){copy.round++;copy.intervalPhase='contract';copy.phaseRemainingSec=3;}
      else return {state:copy,done:true};
    }
    copy.phaseRemainingSec-=seconds;return {state:copy,done:false};
  }
  function completion(session) {
    const modules = session.programSnapshot?.modules || [];
    const results = session.moduleResults || [];
    const done = results.filter(result => result.status === 'COMPLETED').length;
    const hasActivity = done > 0 || session.cycles?.length > 0 || elapsed(session) > 0;
    return {status:modules.length && done === modules.length ? 'completed' : hasActivity ? 'partial' : 'ended',
      completedModules:done, plannedModules:modules.length};
  }
  function conditionKey(session){return JSON.stringify([session.clockVersion||1,session.programSnapshot?.modules||[],session.trackingMode||'detailed',session.trackingMode==='simple'?'':session.promptModeSnapshot||'full',session.planSnapshot?.stageName||'',session.trackingMode==='simple'?null:session.stopThreshold,session.trackingMode==='simple'?null:session.resumeThreshold]);}
  const arousalGuide=[
    '没有明显兴奋','刚察觉到一点变化','有轻微兴奋，注意力仍可轻松转移','已能清楚察觉，仍从容',
    '兴奋增强，仍能从容停下来','感觉在持续上升','上升明显，需要集中注意','已经很强，我想停下来',
    '很接近自己难以控制的程度','感觉已来不及主动停'
  ];
  const controlRatings=[
    {key:'never',score:0,label:'完全没能',example:'每次想停时都已来不及'},
    {key:'rarely',score:3,label:'偶尔能',example:'只有少数时候能及时停'},
    {key:'sometimes',score:5,label:'约一半能',example:'大约一半时候能及时停'},
    {key:'usually',score:8,label:'大多能',example:'大多数时候能及时停'},
    {key:'always',score:10,label:'每次都能',example:'每次都能按意愿停'}
  ];
  const scales={
    stress:['没有明显压力','偶尔分心，容易回到当下','思绪反复打断注意','很难把注意拉回来','压力强烈，无法专注'],
    fatigue:['精神充足','稍累，集中注意很轻松','需要比平时费力才能专注','很难保持注意力','累到很难开始或继续'],
    tension:['没有感觉到绷紧','偶尔绷紧，很快能松开','察觉持续绷紧，提醒后能松开','经常绷紧，很难松开','持续明显绷紧，尝试后仍难松开'],
    control:controlRatings.map(rating=>rating.example),
    relax:['尝试后仍难松开','很费力，偶尔能松开','需要多次尝试才能松开','稍加调整就能松开','感觉很容易松开']
  };
  function scoreText(field,score){
    const index=score===0?0:score<=3?1:score<=6?2:score<10?3:4;
    return scales[field][index];
  }
  window.TrainingCore={arousalGuide,controlRatings,scoreText,elapsed,checkpoint,recover,median,guidedStep,completion,conditionKey};
})();
