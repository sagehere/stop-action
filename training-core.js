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
  function conditionKey(session){return JSON.stringify([session.clockVersion||1,session.programSnapshot?.modules||[],session.promptModeSnapshot||'full',session.planSnapshot?.stageName||'',session.stopThreshold,session.resumeThreshold]);}
  window.TrainingCore={elapsed,checkpoint,recover,median,guidedStep,conditionKey};
})();
