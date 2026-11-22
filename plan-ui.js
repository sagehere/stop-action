(() => {
  'use strict';
  const P = window.LongPlans;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const $ = id => document.getElementById(id);
  const today = () => P.dateKey();
  const weekdayNames = ['日','一','二','三','四','五','六'];
  const shortDate = date => `${Number(date.slice(5,7))}月${Number(date.slice(8))}日`;
  const button = (action,label,attrs='',style='secondary') =>
    `<button type="button" class="${style}" data-action="${action}" ${attrs}>${label}</button>`;
  const cycleSummary = days => `每 ${days.length} 天一轮，练 ${days.filter(Boolean).length} 天、休 ${days.filter(day=>!day).length} 天`;
  let bridge, templates=[], instances=[], activeId=null, beforeAction, busy=false;
  let month=today().slice(0,7), selected=today(), formContext;
  const active = () => instances.find(plan=>plan.id===activeId&&plan.status==='ACTIVE');
  const available = (task,date=today()) => task.instance.free ||
    (task.instance.status==='ACTIVE' && !(task.instance.pauses||[]).some(pause=>date>=pause.from&&date<pause.until)) ||
    Boolean(task.instance.pausedFrom && date<task.instance.pausedFrom);
  const allTemplates = () => [P.cycleBuiltin(),...templates.filter(template=>!template.archived)];
  const meta = () => ({longTemplates:templates,longPlans:instances,activeLongPlanId:activeId});

  async function save(){
    try {
      await bridge.db.importData([],meta(),false,{expected:beforeAction,sessionId:bridge.runningSessionId()});
    } catch(error) {
      hydrate({
        longTemplates:await bridge.db.getMeta('longTemplates',[]),
        longPlans:await bridge.db.getMeta('longPlans',[]),
        activeLongPlanId:await bridge.db.getMeta('activeLongPlanId',null)
      });
      bridge.changed();
      throw new Error('安排未保存，已恢复最后成功版本：'+error.message);
    }
    bridge.changed();
    render();
  }

  function withPlanAction(action,onError=error=>bridge.toast(error.message)){
    if(busy)return;
    busy=true;
    beforeAction=P.clone(meta());
    return Promise.resolve().then(action).catch(onError).finally(()=>{busy=false;beforeAction=null;});
  }

  function tasks(from=P.addDays(today(),-30),until=P.addDays(today(),61)){
    return instances.flatMap(instance=>P.tasksBetween(instance,from,until)
      .map(task=>({...task,instance}))).sort((a,b)=>a.date.localeCompare(b.date));
  }

  function taskById(id){
    if(!id)return null;
    for(const instance of instances){
      const stored=instance.tasks.find(task=>task.id===id);
      if(stored)return {...stored,instance};
    }
    const match=/^(.+):(\d{4}-\d{2}-\d{2})$/.exec(id);
    const instance=match&&instances.find(plan=>plan.id===match[1]);
    const task=instance&&P.cycleTask(instance,match[2]);
    return task?{...task,instance}:null;
  }

  function todayTask(){
    const rows=tasks(today(),P.addDays(today(),1)).filter(task=>available(task)&&task.status==='PLANNED');
    return rows.find(task=>!task.instance.free)||rows[0]||null;
  }

  function nextTraining(){
    const date=today();
    const possible=instances.filter(plan=>!plan.free).flatMap(plan=>[
      ...plan.tasks.filter(task=>task.date>=date).map(task=>({...task,instance:plan})),
      ...(plan.cycles||[]).flatMap(segment=>{
        const from=segment.startDate>date?segment.startDate:date;
        if(segment.until&&from>=segment.until)return [];
        return P.tasksBetween(plan,from,P.addDays(from,segment.cycleDays.length+1))
          .map(task=>({...task,instance:plan}));
      })
    ]);
    return possible.filter(task=>task.status==='PLANNED'&&available(task,task.date)).sort((a,b)=>a.date.localeCompare(b.date))[0];
  }

  function restToday(){
    const plan=instances.find(item=>item.status==='ACTIVE'||(item.pausedFrom&&today()<item.pausedFrom));
    const day=plan&&P.cycleDay(plan,today());
    return day&&!day.practice?{index:day.index,length:day.segment.cycleDays.length}:null;
  }

  function stage(task){
    const plan=task?.instance||active();
    if(!plan)return null;
    const date=task?.originalDate||task?.date||today(), day=P.cycleAt(plan,date);
    const program=(plan.cycles&&day?.program)||plan.templateSnapshot.program;
    if(program)return {name:'循环练习',focus:program.description||'按自己的节奏练习。',sessions:(day?.cycleDays||plan.templateSnapshot.cycleDays).filter(Boolean).length,cycles:program.modules.find(module=>module.exerciseId==='stop_start')?.cycles||2};
    const week=P.effectiveWeek(plan,task);
    return {name:week.phase,focus:week.goal,sessions:week.days.length,cycles:week.program.modules.find(module=>module.exerciseId==='stop_start')?.cycles||2};
  }

  function taskProgram(task){
    const plan=task.instance||instances.find(item=>item.id===task.planId);
    if(!plan||plan.free||task.userEdited||plan.templateSnapshot.schemaVersion===2||
      (plan.cycles&&P.cycleAt(plan,task.originalDate||task.date))||task.weekIndex<=plan.confirmedWeek)return P.clone(task.programSnapshot);
    return P.clone(P.effectiveWeek(plan,task).program);
  }

  function renderCalendar(){
    if(!bridge)return;
    $('calendarMonth').value=month;
    const cells=P.monthCells(month), rows=tasks(cells[0],P.addDays(cells.at(-1),1));
    const actual=new Map();
    for(const session of bridge.sessions()){
      if(!session.endedAt||session.simulated||session.rehearsal)continue;
      const date=P.dateKey(new Date(session.endedAt));
      actual.set(date,(actual.get(date)||0)+1);
    }
    $('scheduleCalendar').innerHTML=calendarGrid(cells,month,date=>{
      const byDate=rows.filter(task=>task.date===date);
      const planned=byDate.some(task=>task.status==='PLANNED'&&available(task,date));
      const recorded=actual.get(date);
      const scheduled=instances.some(plan=>P.cycleDay(plan,date)?.practice===false);
      const skipped=byDate.some(task=>task.status==='SKIPPED'||task.status==='CANCELLED');
      const completed=byDate.some(task=>task.status==='COMPLETED');
      const label=recorded?'已练 '+recorded:completed?'已完成':skipped?'已跳过':planned?(date<today()?'待处理':'练') : scheduled?'休':'';
      return `<button type="button" class="calendar-day ${date===today()?'today':''} ${date===selected?'selected':''}" data-date="${date}" aria-label="${date}${label?' '+label:''}"><span>${Number(date.slice(-2))}</span><small>${label}</small></button>`;
    });
  }

  function calendarGrid(cells,shownMonth,cell){
    return weekdayNames.slice(1).concat(weekdayNames[0]).map(day=>`<div class="small" style="text-align:center">${day}</div>`).join('')+
      cells.map(date=>`<div class="calendar-slot ${date.startsWith(shownMonth)?'':'outside-month'}">${cell(date)}</div>`).join('');
  }

  function taskRow(task){
    const attr=`data-task="${esc(task.id)}"`, actionable=available(task)&&task.status==='PLANNED';
    const record=task.completedSessionId||task.lastPartialSessionId;
    const status={COMPLETED:'已完成',SKIPPED:'已跳过',CANCELLED:'已取消'}[task.status]||
      (task.lastPartialSessionId?'部分完成':!actionable?'已暂停':task.date<today()?'待处理':'待练');
    return `<div class="plan-row"><strong>${shortDate(task.date)} · ${esc(taskProgram(task).name)}</strong><span class="small"> ${status}</span>
      <div class="mini-actions">${actionable?button('startTask','开始练习',attr,'primary'):''}
      ${record?button('viewSession','查看记录',`data-session="${esc(record)}"`):''}</div>
      ${actionable?`<details><summary>调整这次</summary><div class="mini-actions">${button('moveTask','改期',attr)}${button('editTask','修改本次',attr)}${button('skipTask','跳过',attr)}</div></details>`:''}</div>`;
  }

  function templateCard(template){
    const choice=P.uniformCycle(template), program=choice?.program||template.weeks[0].program;
    const attr=`data-template="${esc(template.id)}"`;
    return `<div class="program-card"><strong>${esc(template.name)}</strong>
      <p class="small">${program.modules.map(module=>esc(bridge.exerciseName(module.exerciseId))+
        (module.durationSec?` ${Math.round(module.durationSec/60*10)/10} 分钟`:module.cycles?` ${module.cycles} 循环`:` ${module.rounds} 轮`)).join(' · ')}</p>
      <p class="small">${choice?cycleSummary(choice.cycleDays):`${template.weeks.length} 周 · 分阶段`}${template.builtin?' · 可调整的预设节奏':''}</p>
      ${template.builtin?'<p class="small"><a href="https://www.nhs.uk/conditions/ejaculation-problems/" target="_blank" rel="noopener noreferrer">训练方法来源 · NHS</a></p>':''}
      <div class="mini-actions">${button('useTemplate','使用模板',attr,'primary')}${button('adjustTemplate','调整后使用',attr)}</div>
      ${template.builtin?'':`<details><summary>模板管理</summary><div class="mini-actions">${button('exportTemplate','导出',attr)}${button('archiveTemplate','归档',attr)}</div></details>`}</div>`;
  }

  function render(){
    if(!bridge)return;
    renderCalendar();
    const plan=active(), next=nextTraining(), day=restToday(), template=P.cycleBuiltin();
    const segment=plan&&(P.cycleAt(plan,today())||plan.cycles?.at(-1));
    const weekStart=P.addDays(today(),-((P.weekday(today())+6)%7));
    const thisWeek=tasks(weekStart,P.addDays(weekStart,7)).filter(task=>available(task,task.date)||task.status==='COMPLETED');
    const legacyPhase=plan&&!plan.cycles?.length&&P.phaseDue(plan);
    $('quickPlanRoot').innerHTML=`<div class="card">${plan?
      `<h2>${esc(plan.name)}</h2><p>${segment?cycleSummary(segment.cycleDays):'按现有计划练习'}${day?` · 今天休息（第 ${day.index+1} 天）`:''}</p>
        ${next?`<p class="small">下次练习 · ${shortDate(next.date)}</p>`:''}
        <div class="mini-actions">${(segment||P.uniformCycle(plan.templateSnapshot))?button('adjustCycle','修改循环') : ''}
        ${button('newCycle','另建计划')}${legacyPhase?button('advance','确认下一阶段'):''}</div>`
      :`<h2>开始一个练习计划</h2><p class="small">${cycleSummary(template.cycleDays)}</p>
        <div class="mini-actions">${button('useTemplate','使用基础模板','data-template="builtin-cycle"','primary')}${button('newCycle','自定循环')}</div>`}</div>
      <div class="card"><div class="section-head"><h2>本周安排</h2>${button('addQuick','加练一次')}</div>
      ${thisWeek.length?thisWeek.map(taskRow).join(''):'<p class="muted">本周暂无训练安排</p>'}</div>`;
    const selectedRows=tasks(selected,P.addDays(selected,1));
    const history=bridge.sessions().filter(session=>session.endedAt&&!session.simulated&&!session.rehearsal&&P.dateKey(new Date(session.endedAt))===selected);
    $('planDateRoot').innerHTML=`<div class="card"><h2>${shortDate(selected)} · 日期详情</h2>
      ${selectedRows.length?selectedRows.map(taskRow).join(''):'<p class="muted">当天没有排练</p>'}
      ${history.filter(session=>!selectedRows.some(task=>[task.completedSessionId,task.lastPartialSessionId].includes(session.id)))
        .map(session=>button('viewSession','实际训练 · '+esc(session.programSnapshot?.name||'训练'),`data-session="${esc(session.id)}"`)).join('')}
      ${selected>=today()?button('addOnDate','安排一次训练'):''}</div>`;
    const other=instances.filter(item=>!item.free&&item!==plan);
    $('longPlanRoot').innerHTML=`<h2>计划模板</h2>${allTemplates().map(templateCard).join('')}
      <details><summary>管理计划与导入模板</summary><div class="mini-actions">${plan?button('pausePlan','暂停计划')+button('saveInstance','存为我的模板'):''}${button('importTemplate','导入模板')}</div>
      <input id="templateFile" type="file" accept=".json" hidden>
      ${other.map(item=>`<div class="program-card">${esc(item.name)} · ${item.status==='PAUSED'?'已暂停':'已归档'}
        ${item.status==='PAUSED'?button('resumePlan','恢复',`data-plan="${esc(item.id)}"`):''}</div>`).join('')}</details>`;
    $('templateFile').addEventListener('change',importTemplate);
  }

  function shiftMonth(value,delta){
    const date=P.parseDate(value+'-01');
    date.setMonth(date.getMonth()+delta);
    return P.dateKey(date).slice(0,7);
  }

  function programOptions(chosen){
    const programs=bridge.programs().filter(program=>program.id!==chosen?.id);
    return [chosen||programs.shift(),...programs].map(program=>
      `<option value="${esc(program.id)}">${esc(program.name)}</option>`).join('');
  }

  function openPlanForm(mode,{task,program,date=today(),template}={}){
    const plan=active();
    const edit=mode==='cycle-edit', ready=mode==='template';
    const legacy=ready&&!template.adjust&&template.schemaVersion===1;
    const current=edit&&(P.cycleAt(plan,date)||plan.cycles?.at(-1)||P.uniformCycle(plan.templateSnapshot));
    const choice=current||(template&&P.uniformCycle(template))||P.cycleBuiltin();
    const cycling=edit||mode==='cycle'||ready;
    formContext={mode,taskId:task?.id,planId:plan?.id,template,legacy,previewMonth:null,
      program:program||(cycling&&!legacy?choice.program:null),cycleDays:[...choice.cycleDays]};
    const titles={'cycle':'自定循环','cycle-edit':'修改循环',template:'使用模板',once:'安排一次训练',move:'改期',edit:'修改本次',save:'存为我的模板'};
    const target=task?.date>=today()?task.date:date;
    const allowCycle=cycling&&(!ready||!legacy);
    const customize=allowCycle&&(!ready||template.adjust);
    const pickProgram=(allowCycle&&(!ready||template.adjust)||mode==='once'||mode==='edit');
    $('planDialog').innerHTML=`<form><h2 id="planDialogTitle">${titles[mode]}</h2>
      ${template?`<p class="small">${esc(template.name)}</p>`:''}
      ${mode==='save'?`<label>模板名称<input class="text-input" name="name" maxlength="80" required value="${esc(plan.name)}"></label>`:''}
      ${pickProgram?`<label>训练内容<select class="text-input" name="program">${programOptions(formContext.program)}</select></label>`:''}
      ${['edit','save'].includes(mode)?'':`<label>${edit?'生效日期':cycling?'开始日期':'训练日期'}<input class="text-input" type="date" name="date" min="${today()}" value="${esc(target)}" required></label>`}
      ${customize?`<label>一轮有几天<input class="text-input" type="number" name="length" min="1" max="${P.maxCycleDays}" required value="${choice.cycleDays.length}"></label>
        <div class="cycle-days" id="cycleDays" role="group" aria-label="逐天设定练习或休息"></div>`:''}
      ${mode==='move'?`<button type="button" class="secondary" data-dialog-action="tomorrow">改到明天（${shortDate(P.addDays(today(),1))}）</button>`:''}
      ${mode==='edit'?'<p class="small">只影响这一次训练。</p>':''}
      <p id="planFormPreview" class="small" aria-live="polite"></p>
      ${cycling?`<div class="toolbar"><button type="button" class="ghost" data-preview-month="-1" aria-label="预览上一月">‹</button><strong id="planPreviewMonth"></strong><button type="button" class="ghost" data-preview-month="1" aria-label="预览下一月">›</button></div><div class="calendar-grid" id="planPreviewCalendar"></div>`:''}
      <p id="planFormError" class="small" role="alert" hidden></p>
      <div class="mini-actions"><button class="primary" type="submit">${mode==='move'?'保存日期':mode==='save'?'保存模板':cycling&&!edit?'开始计划':'保存安排'}</button><button type="button" class="secondary" data-dialog-action="close">取消</button></div></form>`;
    renderCycleButtons();
    updatePlanForm();
    $('planDialog').showModal();
  }

  function renderCycleButtons(){
    const root=$('cycleDays');
    if(!root)return;
    root.innerHTML=formContext.cycleDays.map((practice,index)=>
      `<button type="button" class="cycle-day ${practice?'practice':''}" data-cycle-index="${index}" aria-pressed="${practice}"><small>第 ${index+1} 天</small>${practice?'练':'休'}</button>`).join('');
  }

  function planFormValues(){
    const data=new FormData($('planDialog').querySelector('form'));
    const id=data.get('program'), chosen=formContext.program;
    return {date:data.get('date'),name:data.get('name'),
      program:!id||id===chosen?.id?chosen:bridge.programs().find(program=>program.id===id)};
  }

  function updatePlanForm(){
    $('planFormError').hidden=true;
    if(!$('planPreviewCalendar'))return;
    const {date}=planFormValues();
    if(!date||date<today()){ $('planPreviewCalendar').replaceChildren();$('planFormPreview').textContent='';return; }
    const {mode,legacy,template,cycleDays,previewMonth}=formContext;
    const shown=previewMonth||date.slice(0,7);
    $('planPreviewMonth').textContent=shown;
    const scheduled=legacy?new Set(template.weeks.flatMap((week,index)=>week.days.map(day=>P.addDays(date,index*7+day)))):null;
    const summary=legacy?`${template.weeks.length} 周，共 ${scheduled.size} 次安排`:cycleSummary(cycleDays);
    const old=active(), kept=mode==='cycle-edit'&&old?
      P.changeCycle(old,date,cycleDays.includes(true)?cycleDays:[true],planFormValues().program,bridge.isTaskRunning).tasks:[];
    const overrides=new Map(kept.flatMap(task=>[[task.originalDate||task.date,task.date!==task.originalDate?'改期':''],[task.date,task.status==='COMPLETED'?'已练':task.status==='SKIPPED'||task.status==='CANCELLED'?'跳过':'已排']]));
    $('planFormPreview').textContent=summary+(old&&mode!=='cycle-edit'?`。原计划于 ${shortDate(date)} 暂停。`:'');
    $('planPreviewCalendar').innerHTML=calendarGrid(P.monthCells(shown),shown,cell=>{
      const index=P.dayDistance(date,cell);
      const label=index<0?'':overrides.get(cell)||
        (legacy?(index<template.weeks.length*7?(scheduled.has(cell)?'练':'休'):''):cycleDays[index%cycleDays.length]?'练':'休');
      return `<div class="calendar-day"><span>${Number(cell.slice(-2))}</span><small>${label}</small></div>`;
    });
  }

  function showFormError(error){
    const target=$('planFormError');
    target.textContent=error.message;
    target.hidden=false;
  }

  function changeStart(plan,date){
    for(const item of instances.filter(other=>other!==plan&&(other.status==='ACTIVE'||(other.pausedFrom&&other.pausedFrom>date)))){
      item.status='PAUSED';
      item.pausedFrom=date;
    }
    plan.status='ACTIVE';
    if(plan.pausedFrom&&date>plan.pausedFrom)(plan.pauses||=[]).push({from:plan.pausedFrom,until:date});
    delete plan.pausedFrom;
    activeId=plan.id;
  }

  function storedTask(id){
    const task=taskById(id);
    if(!task)return null;
    const existing=task.instance.tasks.find(item=>item.id===id);
    if(existing)return existing;
    const {instance,...record}=task;
    instance.tasks.push(record);
    return record;
  }

  function requireTask(id){
    const task=taskById(id);
    if(!task||task.status!=='PLANNED'||!available(task))throw new Error('这次训练已更新，请重新打开安排');
    if(bridge.isTaskRunning(id))throw new Error('请先结束正在进行的训练');
    return storedTask(id);
  }

  function moveTask(task,date){
    P.parseDate(date);
    task.moved=true;
    task.date=date;
  }

  async function addTask(program,date){
    P.validateProgram(program);
    let instance=instances.find(plan=>plan.free);
    if(!instance){
      instance=P.instantiate(P.makeTemplate(1),date);
      Object.assign(instance,{free:true,name:'自由安排',status:'PAUSED',tasks:[]});
      instances.push(instance);
    }
    instance.tasks.push({schemaVersion:1,id:P.id('task'),planId:instance.id,weekIndex:0,date,
      programId:program.id,programSnapshot:P.clone(program),userEdited:true,status:'PLANNED'});
    await save();
  }

  function submitPlanForm(quickDate){
    return withPlanAction(async()=>{
      const {mode,taskId,planId,cycleDays,template}=formContext;
      const {date,name,program}=planFormValues(), current=active();
      const target=quickDate||date;
      if(!['edit','save'].includes(mode)){
        P.parseDate(target);
        if(target<today())throw new Error('日期请选择今天或之后');
      }
      if(mode==='move'){
        moveTask(requireTask(taskId),target);
      }else if(mode==='edit'){
        P.validateProgram(program);
        Object.assign(requireTask(taskId),{programSnapshot:P.clone(program),programId:program.id,userEdited:true});
      }else if(mode==='save'){
        if(!current||current.id!==planId)throw new Error('请重新打开当前计划');
        const cycle=P.cycleAt(current,today())||current.cycles?.at(-1)||P.uniformCycle(current.templateSnapshot);
        const copy=cycle?P.makeCycleTemplate(cycle.program,cycle.cycleDays,name.trim()):
          {...P.clone(current.templateSnapshot),id:P.id('template'),builtin:false,name:name.trim()};
        templates.push(P.validateTemplate(copy));
      }else if(mode==='once'){
        await addTask(program,target);
      }else if(mode==='cycle-edit'){
        if(!current||current.id!==planId)throw new Error('请重新打开当前计划');
        if(bridge.isTraining())throw new Error('请先结束当前训练');
        const next=P.changeCycle(current,target,cycleDays,program,bridge.isTaskRunning);
        Object.assign(current,next);
      }else{
        if(bridge.isTraining())throw new Error('请先结束当前训练');
        const choice=mode==='template'&&!template.adjust?template:
          P.makeCycleTemplate(program,cycleDays,template?.name||program.name);
        const plan=P.instantiate(choice,target);
        instances.push(plan);
        changeStart(plan,target);
      }
      if(target){selected=target;month=target.slice(0,7);}
      if(mode!=='once')await save();
      else render();
      $('planDialog').close();
      bridge.toast(mode==='move'?'已改期':mode==='save'?'已保存模板':'已保存安排');
    },showFormError);
  }

  async function handle(event){
    const control=event.target.closest('[data-action]');
    if(!control)return;
    const {action,task:id,template:templateId,plan:planId}=control.dataset;
    const task=taskById(id), template=allTemplates().find(item=>item.id===templateId);
    if(action==='newCycle')return openPlanForm('cycle');
    if(action==='adjustCycle')return openPlanForm('cycle-edit');
    if(action==='useTemplate'||action==='adjustTemplate'){
      if(!P.uniformCycle(template)&&action==='adjustTemplate'){
        return openPlanForm('cycle',{template:{...P.makeCycleTemplate(template.weeks[0].program,
          Array.from({length:7},(_,i)=>template.weeks[0].days.length?template.weeks[0].days.includes(i):i===0),template.name),adjust:true}});
      }
      return openPlanForm('template',{template:{...template,adjust:action==='adjustTemplate'}});
    }
    if(action==='addQuick'||action==='addOnDate')return openPlanForm('once',{date:action==='addOnDate'?selected:today()});
    if(action==='viewSession')return bridge.viewSession(control.dataset.session);
    if(action==='startTask'&&task&&available(task)&&task.status==='PLANNED')return bridge.launch(taskProgram(task),task);
    if(action==='moveTask'||action==='editTask'){
      if(bridge.isTaskRunning(id))throw new Error('请先结束正在进行的训练');
      return openPlanForm(action==='moveTask'?'move':'edit',{task,program:taskProgram(task)});
    }
    if(action==='saveInstance')return openPlanForm('save');
    if(action==='skipTask'){requireTask(id).status='SKIPPED';await save();return;}
    if(action==='pausePlan'||action==='resumePlan'){
      if(bridge.isTraining())throw new Error('请先结束当前训练');
      if(action==='pausePlan'){
        const plan=active();
        plan.status='PAUSED';
        plan.pausedFrom=today();
        activeId=null;
      }else changeStart(instances.find(plan=>plan.id===planId),today());
      await save();return;
    }
    if(action==='advance'){
      const plan=active(),next=P.nextPhaseWeek(plan);
      if(next!==null){
        plan.confirmations.push({type:'ADVANCE',oldWeek:plan.confirmedWeek,newWeek:next,at:Date.now()});
        plan.confirmedWeek=next;
        await save();
      }
      return;
    }
    if(action==='archiveTemplate'){template.archived=true;await save();return;}
    if(action==='exportTemplate')return bridge.download(JSON.stringify({format:'stop-action-plan-template',version:1,template},null,2),'plan-template.json','application/json');
    if(action==='importTemplate')$('templateFile').click();
  }

  function importTemplate(event){
    return withPlanAction(async()=>{
      const file=event.target.files[0];
      if(!file)return;
      if(file.size>1024*1024)throw new Error('模板文件过大');
      const data=JSON.parse(await file.text());
      if(data.format!=='stop-action-plan-template'||data.version!==1)throw new Error('模板格式不支持');
      const template=P.validateTemplate(data.template);
      templates.push({...template,id:P.id('template'),builtin:false,archived:false});
      await save();
      bridge.toast('模板已导入');
    });
  }

  async function init(api){
    bridge=api;
    templates=await api.db.getMeta('longTemplates',[]);
    instances=await api.db.getMeta('longPlans',[]);
    activeId=await api.db.getMeta('activeLongPlanId',null);
    if(!await api.db.getMeta('migration-long-v1',false)){
      if(api.sessions().length||api.legacyPlan().currentWeek>0){
        const legacy=P.migrateLegacy(api.legacyPlan(),api.programs());
        instances.push(legacy);
        activeId=legacy.id;
      }
      await api.db.importData([],{...meta(),legacyPlanBeforeMigration:P.clone(api.legacyPlan()),'migration-long-v1':true});
    }
    for(const id of ['quickPlanRoot','longPlanRoot','planDateRoot']){
      $(id).addEventListener('click',event=>{
        if(event.target.closest('[data-action]'))withPlanAction(()=>handle(event));
      });
    }
    const dialog=$('planDialog');
    dialog.addEventListener('input',event=>{
      if(event.target.name==='date')formContext.previewMonth=null;
      const length=Number(event.target.value);
      if(event.target.name==='length'&&Number.isInteger(length)&&length>=1&&length<=P.maxCycleDays){
        formContext.cycleDays=Array.from({length},(_,index)=>formContext.cycleDays[index]??false);
        renderCycleButtons();
      }
      updatePlanForm();
    });
    dialog.addEventListener('click',event=>{
      const action=event.target.closest('[data-dialog-action]')?.dataset.dialogAction;
      if(action==='close'&&!busy)dialog.close();
      if(action==='tomorrow')submitPlanForm(P.addDays(today(),1));
      const index=event.target.closest('[data-cycle-index]')?.dataset.cycleIndex;
      if(index!=null){
        formContext.cycleDays[index]=!formContext.cycleDays[index];
        renderCycleButtons();
        $('cycleDays').children[index].focus({preventScroll:true});
        updatePlanForm();
      }
      const delta=event.target.closest('[data-preview-month]')?.dataset.previewMonth;
      if(delta){
        const target=planFormValues().date;
        if(!target)return;
        formContext.previewMonth=shiftMonth(formContext.previewMonth||target.slice(0,7),Number(delta));
        updatePlanForm();
      }
    });
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('submit',event=>{event.preventDefault();submitPlanForm();});
    $('calendarTools').addEventListener('click',event=>{
      const action=event.target.dataset.calendar;
      if(!action)return;
      if(action==='today'){month=today().slice(0,7);selected=today();}
      else month=shiftMonth(month,action==='prev'?-1:1);
      render();
    });
    $('calendarMonth').addEventListener('change',event=>{
      if(/^\d{4}-\d{2}$/.test(event.target.value)){month=event.target.value;render();}
    });
    $('scheduleCalendar').addEventListener('click',event=>{
      const cell=event.target.closest('[data-date]');
      if(cell){selected=cell.dataset.date;render();}
    });
    render();
  }

  function markCompleted(id,sessionId,status='completed'){
    if(!['completed','partial'].includes(status))return;
    const task=storedTask(id);
    if(!task||task.status!=='PLANNED')return;
    if(status==='partial')task.lastPartialSessionId=sessionId;
    else{
      task.status='COMPLETED';
      task.completedSessionId=sessionId;
      delete task.lastPartialSessionId;
    }
  }

  function withoutSession(id){
    const snapshot=P.clone(meta());
    for(const task of snapshot.longPlans.flatMap(plan=>plan.tasks)){
      if(task.lastPartialSessionId===id)delete task.lastPartialSessionId;
      if(task.completedSessionId===id){task.status='PLANNED';delete task.completedSessionId;}
    }
    return snapshot;
  }

  function defer(){
    return withPlanAction(async()=>{
      const task=todayTask();
      if(task){moveTask(requireTask(task.id),P.addDays(task.date,1));await save();}
    });
  }

  function hydrate(values){
    templates=values.longTemplates||[];
    instances=values.longPlans||[];
    activeId=values.activeLongPlanId||null;
    render();
  }

  window.LongPlanUI={init,render,renderCalendar,meta,active,tasks,taskById,available,todayTask,nextTraining,restToday,
    stage,taskProgram,markCompleted,withoutSession,defer,openPlanForm,hydrate,reset:()=>hydrate({})};
})();
