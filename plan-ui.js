(() => {
  'use strict';
  const P=window.LongPlans, C=window.TrainingContent;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let bridge,templates=[],instances=[],activeId=null,month=P.dateKey().slice(0,7),selected=P.dateKey(),draft=null,editorWeek=0,preview=null,draftTaskId=null,draftPlanId=null,startDate=P.dateKey(),previewTaskId=null,busy=false;
  const active=()=>instances.find(p=>p.id===activeId&&p.status==='ACTIVE');
  const allTemplates=()=>[...P.builtins,...templates.filter(t=>!t.archived)];
  function meta(){return {longTemplates:templates,longPlans:instances,activeLongPlanId:activeId};}
  let beforeAction;
  async function save(){
    try {
      await bridge.db.importData([],meta(),false,{expected:beforeAction,sessionId:bridge.runningSessionId()});
    } catch(error) {
      templates=await bridge.db.getMeta('longTemplates',[]);
      instances=await bridge.db.getMeta('longPlans',[]);
      activeId=await bridge.db.getMeta('activeLongPlanId',null);
      bridge.changed();render();
      throw new Error('安排未保存，已恢复最后成功版本：'+error.message);
    }
    bridge.changed();render();
  }
  function tasks(){return instances.filter(p=>p.status==='ACTIVE'||p.status==='ARCHIVED'||p.status==='PAUSED').flatMap(p=>p.tasks.map(t=>({...t,instance:p})));}
  const available=task=>task.instance.status==='ACTIVE'||task.instance.free;
  const weekdayNames=['日','一','二','三','四','五','六'];
  const shortDate=date=>`${Number(date.slice(5,7))}月${Number(date.slice(8))}日 周${weekdayNames[P.weekday(date)]}`;
  const dialog=()=>document.getElementById('planDialog');
  function todayTask(){return tasks().find(t=>t.instance.status==='ACTIVE'&&t.date===P.dateKey()&&t.status==='PLANNED')||tasks().find(t=>t.instance.free&&t.date===P.dateKey()&&t.status==='PLANNED')||null;}
  function stage(task){const plan=task?instances.find(p=>p.id===task.planId):active();if(!plan)return null;const week=P.effectiveWeek(plan,task);return {name:week.phase,focus:week.goal,sessions:week.days.length,cycles:week.program.modules.find(m=>m.exerciseId==='stop_start')?.cycles||2,mindfulness:week.days.length,pelvic:week.days.length};}
  function taskProgram(task){const instance=instances.find(p=>p.id===task.planId);if(!instance||task.userEdited||instance.free)return P.clone(task.programSnapshot);return P.clone(task.weekIndex>instance.confirmedWeek?P.effectiveWeek(instance,task).program:task.programSnapshot);}
  async function init(api){
    bridge=api;templates=await api.db.getMeta('longTemplates',[]);instances=await api.db.getMeta('longPlans',[]);activeId=await api.db.getMeta('activeLongPlanId',null);
    if(!await api.db.getMeta('migration-long-v1',false)){
      if(api.sessions().length||api.legacyPlan().currentWeek>0){const legacy=P.migrateLegacy(api.legacyPlan(),api.programs());instances.push(legacy);activeId=legacy.id;}
      await api.db.importData([],{...meta(),'legacyPlanBeforeMigration':P.clone(api.legacyPlan()),'migration-long-v1':true});
    }
    const root=document.getElementById('longPlanRoot');
    for(const id of ['quickPlanRoot','longPlanRoot','planDateRoot']){
      document.getElementById(id).addEventListener('click',event=>{
        if(event.target.closest('[data-action]'))withPlanAction(()=>handle(event));
      });
    }
    root.addEventListener('change',event=>change(event).catch(error=>bridge.toast(error.message)));
    dialog().addEventListener('input',updatePlanForm);
    dialog().addEventListener('click',event=>{
      const action=event.target.dataset.dialogAction;
      if(action==='close'&&!busy)dialog().close();
      if(action==='tomorrow')submitPlanForm(P.addDays(P.dateKey(),1));
      if(event.target.closest('[data-action="editTaskModules"]'))withPlanAction(()=>{
        const row=requireTask(formContext.taskId);
        draft=P.makeTemplate(1);draft.name='修改本次训练';draft.weeks[0].program=taskProgram(row);
        editorWeek=0;draftTaskId=row.id;draftPlanId=null;previewTaskId=null;preview=null;
        dialog().close();
        document.getElementById('planAdvancedDetails').open=true;
        render();
        document.getElementById('longEditor').scrollIntoView({block:'start'});
      },showFormError);
    });
    dialog().addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog().addEventListener('submit',event=>{event.preventDefault();submitPlanForm();});
    document.getElementById('calendarTools').addEventListener('click',event=>calendarAction(event));
    document.getElementById('calendarMonth').addEventListener('change',event=>{if(/^\d{4}-\d{2}$/.test(event.target.value)){month=event.target.value;renderCalendar();}});
    document.getElementById('scheduleCalendar').addEventListener('click',event=>{const cell=event.target.closest('[data-date]');if(cell){selected=cell.dataset.date;renderCalendar();render();}});
    document.getElementById('scheduleCalendar').addEventListener('dragover',event=>event.preventDefault());
    document.getElementById('scheduleCalendar').addEventListener('drop',event=>{event.preventDefault();const cell=event.target.closest('[data-date]'),task=active()?.tasks.find(t=>t.id===event.dataTransfer.getData('text/plain'));if(cell&&task)withPlanAction(async()=>{moveTask(requireTask(task.id),cell.dataset.date);await save();});});
    document.getElementById('planDateRoot').addEventListener('dragstart',event=>{const row=event.target.closest('[data-drag-task]');if(row)event.dataTransfer.setData('text/plain',row.dataset.dragTask);});
    render();
  }
  function calendarAction(event){const action=event.target.dataset.calendar;if(!action)return;if(action==='today'){month=P.dateKey().slice(0,7);selected=P.dateKey();}else{const d=P.parseDate(month+'-01');d.setMonth(d.getMonth()+(action==='prev'?-1:1));month=P.dateKey(d).slice(0,7);}render();}
  function renderCalendar(){
    const container=document.getElementById('scheduleCalendar');if(!container||!bridge)return;
    document.getElementById('calendarMonth').value=month;
    container.innerHTML=['一','二','三','四','五','六','日'].map(d=>`<div class="small" style="text-align:center">${d}</div>`).join('')+P.monthCells(month).map(date=>{
      const rows=tasks().filter(t=>t.date===date),past=date<P.dateKey(),planned=rows.filter(t=>t.status==='PLANNED'&&!t.lastPartialSessionId).length,partial=rows.filter(t=>t.status==='PLANNED'&&t.lastPartialSessionId).length,done=rows.filter(t=>t.status==='COMPLETED').length,actual=bridge.sessions().filter(s=>!s.simulated&&!s.rehearsal&&s.endedAt&&P.dateKey(new Date(s.endedAt))===date).length;
      return `<button class="calendar-day ${date===P.dateKey()?'today':''} ${date===selected?'selected':''}" data-date="${date}" style="opacity:${date.startsWith(month)?1:.45}" aria-label="${date}，${rows.length}次安排，${actual}条实际训练记录"><span>${Number(date.slice(-2))}</span><span class="small">${done?'✓ '+done:''}${partial?'<br>部分 '+partial:''}${actual?'<br>记录 '+actual:''}${planned?'<br>'+ (past?'待处理 ':'待练 ')+planned:rows.some(t=>['SKIPPED','CANCELLED'].includes(t.status))?'<br>跳过/取消':''}${!rows.length&&!actual?'<br>休息':''}</span></button>`;
    }).join('');
  }
  function btn(action,label,extra=''){return `<button type="button" class="secondary" data-action="${action}" ${extra}>${label}</button>`;}
  function primary(action,label,extra=''){
    return `<button type="button" class="primary" data-action="${action}" ${extra}>${label}</button>`;
  }
  function taskRow(task,calendar=false){
    const actionable=available(task)&&task.status==='PLANNED';
    const attr=`data-task="${esc(task.id)}"`;
    const record=task.completedSessionId||task.lastPartialSessionId;
    const status={COMPLETED:'已完成',SKIPPED:'已跳过',CANCELLED:'已取消'}[task.status]
      ||(task.lastPartialSessionId?'部分完成':task.date<P.dateKey()?'逾期待处理':available(task)?'待训练':'已暂停');
    const program=task.status==='PLANNED'?taskProgram(task):task.programSnapshot;
    return `<article class="plan-row" ${calendar&&actionable?`draggable="true" data-drag-task="${esc(task.id)}"`:''}>
      <strong>${esc(program?.name||'训练')}</strong>
      <p class="small">${shortDate(task.date)} · ${status}</p>
      ${actionable?`<div class="mini-actions">${primary('startTask','开始',attr)}${btn('moveTask','改期',attr)}</div>
      <details><summary>本次更多操作</summary><div class="mini-actions">${btn('editTask','修改内容',attr)}${btn('skipTask','跳过本次',attr)}${btn('cancelTask','取消本次安排',attr)}</div></details>`:''}
      ${record?btn('viewSession','查看记录',`data-session="${esc(record)}"`):''}
    </article>`;
  }
  function renderQuick(allTasks,current){
    const today=P.dateKey(),monday=P.addDays(today,-((P.weekday(today)+6)%7));
    const scheduled=allTasks.filter(available).sort((a,b)=>a.date.localeCompare(b.date));
    const week=scheduled.filter(task=>task.date>=monday&&task.date<=P.addDays(monday,6));
    const next=scheduled.find(task=>task.date>=today&&task.status==='PLANNED');
    const overdue=scheduled.filter(task=>task.date<today&&task.status==='PLANNED'&&!week.includes(task));
    const intro=P.builtins[0],introWeek=intro.weeks[0];
    const setup=current?`<strong>${esc(current.name)}</strong>
      ${next?`<p>下次训练 · ${shortDate(next.date)} · ${esc(taskProgram(next)?.name||'训练')}</p>`:'<p class="muted">接下来没有待练安排</p>'}
      ${P.phaseDue(current)?`<p class="small">到了阶段复盘时间。确认前继续按当前阶段练习。</p>
      <div class="mini-actions">${btn('advance','确认下一阶段')}${btn('repeat','重复当前阶段')}</div>`:''}
      <div class="mini-actions">${P.dayDistance(current.startDate,today)<current.templateSnapshot.weeks.length*7?btn('adjustWeekly','调整每周安排'):''}${btn('openSchedule','另建计划')}</div>`
      :`<h2>${esc(intro.name)}安排</h2><p>每周 ${introWeek.days.length} 次 · ${introWeek.program.modules.map(m=>esc(bridge.exerciseName(m.exerciseId))).join('、')}</p>
      <p class="small">前两次 · ${introWeek.days.map(day=>shortDate(P.addDays(today,day))).join('、')}</p>
      <p class="small">周期和频率由本应用预设。</p>
      <div class="mini-actions">${primary('activateIntro','采用这个安排')}${btn('openSchedule','自己安排')}</div>`;
    document.getElementById('quickPlanRoot').innerHTML=`<div class="card">${setup}</div>
      <div class="card"><div class="section-head"><h2>本周安排</h2>${btn('addQuick','加练一次')}</div>
      ${week.length?week.map(task=>taskRow(task)).join(''):'<p class="muted">本周暂无安排</p>'}
      ${next&&!week.includes(next)?`<h3>接下来</h3>${taskRow(next)}`:''}
      ${overdue.length?`<details id="overduePlans"><summary>更早的待处理安排（${overdue.length}）</summary>${overdue.map(task=>taskRow(task)).join('')}</details>`:''}
      </div>`;
  }
  function withPlanAction(action,onError=error=>bridge.toast(error.message)){
    if(busy)return;
    busy=true;
    beforeAction=P.clone(meta());
    return Promise.resolve().then(action).catch(onError).finally(()=>{busy=false;beforeAction=null;});
  }
  function programOptions(chosen){
    const programs=bridge.programs().filter(program=>program.id!==chosen?.id);
    return [chosen||programs.shift(),...programs].map(program=>
      `<option value="${esc(program.id)}">${esc(program.name)}</option>`).join('');
  }
  function weekdayFields(days){
    return `<fieldset class="plan-weekdays" id="planWeekdays"><legend>每周训练日</legend>
      ${[1,2,3,4,5,6,0].map(day=>`<label><input type="checkbox" name="weekday" value="${day}" ${days.includes(day)?'checked':''}>周${weekdayNames[day]}</label>`).join('')}
    </fieldset>`;
  }
  let formContext;
  function openPlanForm(mode,{task,program,date=P.dateKey()}={}){
    const current=active(),formDate=task?.date>=P.dateKey()?task.date:date;
    formContext={mode,taskId:task?.id,planId:current?.id,program};
    const titles={schedule:'自己安排',once:'安排一次训练',move:'改期',edit:'修改本次内容',weekly:'调整每周安排'};
    const scheduling=mode==='schedule'||mode==='once';
    const nextWeek=mode==='weekly'?P.currentWeek(current):0;
    const offsetDays=mode==='weekly'?current.templateSnapshot.weeks[nextWeek].days:[0,3];
    const anchor=P.weekday(mode==='weekly'?current.startDate:date);
    dialog().innerHTML=`<form><h2 id="planDialogTitle">${titles[mode]}</h2>
      ${mode==='schedule'?'<label>安排方式<select class="text-input" name="scheduleType"><option value="once">只练一次</option><option value="repeat">每周重复</option></select></label>':''}
      ${scheduling||mode==='edit'?`<label>训练内容<select class="text-input" name="program">${programOptions(program)}</select></label>`:''}
      ${scheduling||mode==='move'?`<label><span id="planDateLabel">训练日期</span><input class="text-input" type="date" name="date" min="${P.dateKey()}" value="${esc(formDate)}" required></label>`:''}
      ${mode==='move'?`<button type="button" class="secondary" data-dialog-action="tomorrow">改到明天（${shortDate(P.addDays(P.dateKey(),1))}）</button>`:''}
      ${mode==='schedule'||mode==='weekly'?weekdayFields(offsetDays.map(day=>(anchor+day)%7)):''}
      ${mode==='schedule'?'<label id="planWeeksLabel">持续周数<input class="text-input" type="number" name="weeks" min="1" max="52" value="4"></label>':''}
      ${mode==='edit'?'<p class="small">只修改本次训练。也可以编辑本次的模块、数量与顺序。</p>'+btn('editTaskModules','编辑本次模块'):''}
      <p id="planFormPreview" class="small" aria-live="polite"></p>
      <p id="planFormError" class="small" role="alert" hidden></p>
      <div class="mini-actions"><button class="primary" type="submit">${mode==='move'?'保存日期':'保存安排'}</button>
      <button type="button" class="secondary" data-dialog-action="close">取消</button></div></form>`;
    updatePlanForm();
    dialog().showModal();
  }
  function readPlanForm(){
    const form=dialog().querySelector('form'),data=new FormData(form);
    return {repeat:data.get('scheduleType')==='repeat',date:data.get('date'),length:Number(data.get('weeks')),
      weekdays:data.getAll('weekday').map(Number),programId:data.get('program')};
  }
  function formProgram(programId){
    return formContext.program?.id===programId?formContext.program:bridge.programs().find(program=>program.id===programId);
  }
  function updatePlanForm(){
    const {repeat,date,length,weekdays,programId}=readPlanForm();
    const {mode}=formContext,preview=document.getElementById('planFormPreview');
    const weekdayPicker=document.getElementById('planWeekdays'),weekInput=document.getElementById('planWeeksLabel');
    if(weekdayPicker)weekdayPicker.hidden=mode==='schedule'&&!repeat;
    if(weekInput){
      weekInput.hidden=!repeat;
      weekInput.querySelector('input').disabled=!repeat;
      document.getElementById('planDateLabel').textContent=repeat?'从哪天开始排':'训练日期';
    }
    const error=document.getElementById('planFormError');
    error.hidden=true;
    preview.textContent='';
    try{
      if(repeat&&date&&weekdays.length&&length>=1&&length<=52&&Number.isInteger(length)){
        const plan=makeWeeklyPlan(formProgram(programId),date,weekdays,length);
        preview.textContent=`共 ${plan.tasks.length} 次 · 最近 ${plan.tasks.slice(0,2).map(task=>shortDate(task.date)).join('、')}`
          +(active()?'。保存后，当前计划将暂停。':'');
      }
      if(mode==='weekly'&&weekdays.length){
        const change=weeklyChange(weekdays);
        const next=change.tasks.filter(task=>task.date>=P.dateKey()&&task.status==='PLANNED')
          .sort((a,b)=>a.date.localeCompare(b.date)).slice(0,2).map(task=>shortDate(task.date));
        preview.textContent=`新增 ${change.added.length} 次，替换掉 ${change.removed.length} 次原安排。`
          +(next.length?`接下来是 ${next.join('、')}。`:'接下来没有待练安排。');
      }
    }catch(error){showFormError(error);}
  }
  function showFormError(error){
    const target=document.getElementById('planFormError');
    target.textContent=error.message;target.hidden=false;
  }
  function makeWeeklyPlan(program,date,weekdays,length){
    return P.instantiate(P.weeklyTemplate(program,date,weekdays,length),date);
  }
  function weeklyChange(weekdays){
    const current=active();
    if(!current||current.id!==formContext.planId)throw new Error('当前计划已变化，请关闭后重新打开');
    return P.weeklyAdjustment(current,weekdays,P.dateKey(),bridge.isTaskRunning);
  }
  function requireTask(taskId){
    const task=tasks().find(task=>task.id===taskId&&task.status==='PLANNED'&&available(task));
    if(!task)throw new Error('这次训练已更新，请重新打开安排');
    if(bridge.isTaskRunning(taskId))throw new Error('当前任务正在训练，请先完成或结束');
    return task.instance.tasks.find(row=>row.id===taskId);
  }
  function moveTask(task,date){
    P.parseDate(date);
    task.date=date;
  }
  function activate(plan){
    if(bridge.isTraining())throw new Error('请先结束当前训练再切换主计划');
    if(active())active().status='PAUSED';
    instances.push(plan);activeId=plan.id;
  }
  function submitPlanForm(quickDate){
    return withPlanAction(async()=>{
      const {mode,taskId}=formContext;
      const {repeat,date,length,weekdays,programId}=readPlanForm();
      if(mode==='weekly'){
        const change=weeklyChange(weekdays);
        const current=active();
        current.templateSnapshot=change.template;
        current.tasks=change.tasks;
        await save();
      }else if(mode==='edit'){
        const task=requireTask(taskId);
        const program=formProgram(programId);
        P.validateProgram(program);
        task.programSnapshot=P.clone(program);task.programId=program.id;task.userEdited=true;
        await save();
      }else{
        const target=quickDate||date;
        P.parseDate(target);
        if(target<P.dateKey())throw new Error('日期请选择今天或之后');
        if(mode==='move'){
          moveTask(requireTask(taskId),target);
          selected=target;month=target.slice(0,7);
          await save();
        }else if(repeat){
          activate(makeWeeklyPlan(formProgram(programId),target,weekdays,length));
          await save();
        }else{
          await addTask(formProgram(programId),target);
        }
      }
      dialog().close();
      bridge.toast(mode==='move'?'已改期':'已保存安排');
    },showFormError);
  }
  function editor(){
    const week=draft.weeks[editorWeek];
    const single=!!draftTaskId;
    return `<div class="card" id="longEditor"><h2>${single?'修改本次模块':'长期计划草稿'}</h2>${single?'':`<label>名称<input class="text-input" data-field="name" value="${esc(draft.name)}" maxlength="80"></label><label>总周数<input class="text-input" type="number" min="1" max="52" data-field="length" value="${draft.weeks.length}"></label><label>编辑周次<select class="text-input" data-field="week">${draft.weeks.map((w,i)=>`<option value="${i}" ${i===editorWeek?'selected':''}>第${i+1}周 · ${esc(w.phase)}</option>`).join('')}</select></label><label>阶段名称<input class="text-input" data-field="phase" value="${esc(week.phase)}" maxlength="80"></label><label>本周目标<textarea class="text-input" data-field="goal" maxlength="1000">${esc(week.goal)}</textarea></label><p class="small">训练日在每个计划周的开始日期后计算。例如开始日为周三，+3天为周六。</p><div class="chips">${Array.from({length:7},(_,day)=>`<label><input type="checkbox" data-day="${day}" ${week.days.includes(day)?'checked':''}>+${day}天</label>`).join('')}</div>`}<label>单次方案名称<input class="text-input" data-field="programName" value="${esc(week.program.name)}" maxlength="80"></label><div class="small">以下模块与顺序只修改当前周。分钟/轮/循环均为产品安排，可随时减少或结束。</div>${Object.entries(C.modules).map(([key])=>{
      const m=week.program.modules.find(x=>x.exerciseId===key), timed=!['stop_start','pelvic_coordination'].includes(key),value=m?(timed?m.durationSec/60:m.cycles??m.rounds):(timed?3:2);
      return `<div class="builder-row"><input type="checkbox" data-module="${key}" ${m?'checked':''} aria-label="包含${esc(bridge.exerciseName(key))}"><span>${esc(bridge.exerciseName(key))}</span><input type="number" min="1" max="30" data-module-value="${key}" value="${value}" aria-label="${esc(bridge.exerciseName(key))}数量"><span>${timed?'分钟':key==='stop_start'?'循环':'轮'}</span></div>`;
    }).join('')}<div class="mini-actions">${single?btn('closeDraft','取消'):`${btn('moduleUp','当前第一个模块移到末尾')}${btn('copyWeek','复制当前周')}${btn('deleteWeek','删除当前周')}${btn('weekUp','本周前移')}${btn('weekDown','本周后移')}${btn('applyAll','将本周内容复制到全部周')}${btn('saveDraft','保存个人模板')}${btn('closeDraft','关闭草稿')}</div><label>开始日期<input class="text-input" id="longStartDate" type="date" value="${P.dateKey()}"></label>${btn('previewDraft','预览完整执行排程')}`}</div>`;
  }
  function render(){
    if(!bridge)return;renderCalendar();const current=active(),allTasks=tasks(),rows=allTasks.filter(t=>t.date===selected),history=bridge.sessions().filter(s=>!s.simulated&&!s.rehearsal&&P.dateKey(new Date(s.endedAt||s.createdAt))===selected);
    renderQuick(allTasks,current);
    let html=`<div class="card"><h2>长期主计划</h2><p class="small">${esc(C.guidance.plan.text)}</p>${current?`<strong>${esc(current.name)}</strong><p class="small">${current.startDate} 起 · ${current.templateSnapshot.weeks.length}周 · 已确认第${current.confirmedWeek+1}周阶段</p><div class="mini-actions">${btn('pausePlan','暂停主计划')}${btn('archivePlan','归档主计划')}${btn('shiftPlan','从今天重新安排')}${btn('editActive','编辑未来安排')}</div>${P.phaseDue(current)?`<div class="engine-note">阶段复盘：未确认前沿用当前阶段，不自动增加练习量。</div><div class="mini-actions">${btn('advance','确认下一阶段')}${btn('repeat','重复当前阶段')}</div>`:''}`:'<p class="muted">没有正在执行的主计划。选择模板或恢复暂停的计划。</p>'}</div>`;
    document.getElementById('planDateRoot').innerHTML=`<div class="card"><h2>${shortDate(selected)} · 日期详情</h2>
      ${rows.length?rows.map(task=>taskRow(task,true)).join(''):'<p class="muted">暂无训练安排</p>'}
      ${history.filter(session=>!rows.some(task=>[task.completedSessionId,task.lastPartialSessionId].includes(session.id)))
        .map(session=>btn('viewSession','自由训练 · '+esc(session.programSnapshot?.name||'训练'),'data-session="'+esc(session.id)+'"')).join('')}
      ${btn('addOnDate','安排一次训练')}</div>`;
    html+=`<div class="card"><h2>长期计划模板库</h2>${allTemplates().map(t=>`<div class="program-card"><strong>${esc(t.name)}</strong><p class="small">${t.weeks.length}周 · ${t.builtin?'内置，可编辑副本':'个人模板'} · 内容v${esc(t.contentVersion||'1')}</p><div class="mini-actions">${btn('editTemplate','预览／编辑副本','data-template="'+esc(t.id)+'"')}${btn('exportTemplate','导出模板','data-template="'+esc(t.id)+'"')}${!t.builtin?btn('archiveTemplate','归档模板','data-template="'+esc(t.id)+'"'):''}</div></div>`).join('')}<div class="mini-actions">${btn('newTemplate','创建1–52周计划')}${btn('importTemplate','导入模板')}</div><input id="templateFile" type="file" accept=".json" hidden></div>`;
    const others=instances.filter(p=>p.status!=='ACTIVE');if(others.length)html+=`<div class="card"><h2>暂停与历史计划</h2>${others.map(p=>`<div class="program-card">${esc(p.name)} · ${p.status==='PAUSED'?'已暂停':'已归档'}${p.status==='PAUSED'?btn('resumePlan','恢复','data-plan="'+esc(p.id)+'"'):''}${btn('saveInstance','保存为个人模板','data-plan="'+esc(p.id)+'"')}</div>`).join('')}</div>`;
    if(draft)html+=editor();
    if(preview)html+=`<div class="card"><h2>完整排程预览</h2><p class="small">可以先修改每次日期与模块。启动将暂停旧主计划，所有已完成记录保留。</p><div class="plan-preview">${preview.tasks.map(t=>`<div><label>第${t.weekIndex+1}周 · ${esc(t.programSnapshot.name)}<input class="text-input" type="date" data-preview-date="${esc(t.id)}" value="${t.date}"></label>${btn('editPreviewTask','编辑此次模块','data-task="'+esc(t.id)+'"')}</div>`).join('')}</div>${btn('activatePreview','确认启用主计划')}${btn('closePreview','取消')}</div>`;
    const root=document.getElementById('longPlanRoot');root.innerHTML=html;
    document.getElementById('templateFile').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>1024*1024)throw new Error('模板文件过大');const data=JSON.parse(await file.text());if(data.format!=='stop-action-plan-template'||data.version!==1)throw new Error('模板格式不支持');draft=P.clone(P.validateTemplate(data.template));draft.id=P.id('template');draft.builtin=false;editorWeek=0;render();}catch(error){bridge.toast(error.message);}});
    if(draft){const dateField=document.getElementById('longStartDate');if(dateField)dateField.value=startDate;const order=document.createElement('div');order.className='mini-actions';order.innerHTML=draft.weeks[editorWeek].program.modules.map((m,i)=>`${btn('moveModule',esc(bridge.exerciseName(m.exerciseId))+' ↑','data-index="'+i+'" data-direction="-1"')}${btn('moveModule',esc(bridge.exerciseName(m.exerciseId))+' ↓','data-index="'+i+'" data-direction="1"')}`).join('')+(draftTaskId?btn('applyTaskDraft','保存本次模块'):'')+(draftPlanId?btn('applyPlanDraft','预览并应用未来周安排'):'')+(previewTaskId?btn('applyPreviewTask','应用预览任务修改'):'');document.getElementById('longEditor').appendChild(order);}
  }
  async function change(event){
    if(event.target.dataset.previewDate){P.parseDate(event.target.value);preview.tasks.find(t=>t.id===event.target.dataset.previewDate).date=event.target.value;return;}
    if(event.target.id==='longStartDate'){P.parseDate(event.target.value);startDate=event.target.value;return;}
    if(!draft)return;const el=event.target,w=draft.weeks[editorWeek],field=el.dataset.field;
    if(field==='name')draft.name=el.value;
    if(field==='length'){const length=Number(el.value);if(!Number.isInteger(length)||length<1||length>52)throw new Error('周数应为1–52');while(draft.weeks.length<length){const copy=P.clone(w);copy.id=P.id('week');draft.weeks.push(copy);}draft.weeks.length=length;editorWeek=Math.min(editorWeek,length-1);render();}
    if(field==='week'){editorWeek=Number(el.value);render();}
    if(field==='phase'||field==='goal')w[field]=el.value;
    if(field==='programName')w.program.name=el.value;
    if(el.dataset.day!=null){const d=Number(el.dataset.day);w.days=el.checked?[...new Set([...w.days,d])].sort() : w.days.filter(x=>x!==d);}
    const key=el.dataset.module??el.dataset.moduleValue;
    if(key){let module=w.program.modules.find(m=>m.exerciseId===key);if(el.dataset.module&&!el.checked){w.program.modules=w.program.modules.filter(m=>m.exerciseId!==key);return;}
      const val=Number(el.dataset.moduleValue?el.value:document.querySelector('[data-module-value="'+key+'"]').value);
      if(!Number.isFinite(val)||val<1||val>30)throw new Error('数量应为1–30');
      const next={exerciseId:key,...(key==='stop_start'?{cycles:val}:key==='pelvic_coordination'?{rounds:val}:{durationSec:val*60})};
      if(module)Object.assign(module,next);else if(el.checked)w.program.modules.push(next);
    }
  }
  async function handle(event){
    const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,task=instances.flatMap(p=>p.tasks).find(t=>t.id===button.dataset.task),template=allTemplates().find(t=>t.id===button.dataset.template),current=active();
    if(['moveTask','editTask','skipTask','cancelTask'].includes(action)&&bridge.isTaskRunning(task?.id))throw new Error('当前任务正在训练，请先完成或结束。');
    if(action==='activateIntro'){
      if(current)return;
      activate(P.instantiate(P.builtins[0],P.dateKey()));
      await save();bridge.toast('已启用 4 周入门安排');return;
    }
    if(action==='openSchedule'){openPlanForm('schedule');return;}
    if(action==='addQuick'||action==='addOnDate'){openPlanForm('once',{date:action==='addOnDate'&&selected>=P.dateKey()?selected:P.dateKey()});return;}
    if(action==='adjustWeekly'){openPlanForm('weekly');return;}
    if(action==='viewSession'){bridge.viewSession(button.dataset.session);return;}
    if(action==='newTemplate'){draft=P.makeTemplate();editorWeek=0;draftTaskId=null;draftPlanId=null;previewTaskId=null;preview=null;}
    if(action==='editTemplate'){draft=P.clone(template);draft.id=P.id('template');draft.builtin=false;draft.name+=' · 副本';editorWeek=0;draftTaskId=null;draftPlanId=null;previewTaskId=null;preview=null;}
    if(action==='closeDraft'){draft=null;draftTaskId=null;draftPlanId=null;}
    if(action==='moveModule'){const modules=draft.weeks[editorWeek].program.modules,i=Number(button.dataset.index),j=i+Number(button.dataset.direction);if(j>=0&&j<modules.length)[modules[i],modules[j]]=[modules[j],modules[i]];}
    if(action==='copyWeek'){if(draft.weeks.length>=52)throw new Error('最多52周');const copy=P.clone(draft.weeks[editorWeek]);copy.id=P.id('week');draft.weeks.splice(editorWeek+1,0,copy);editorWeek++;}
    if(action==='deleteWeek'){if(draft.weeks.length===1)throw new Error('至少保留一周');draft.weeks.splice(editorWeek,1);editorWeek=Math.min(editorWeek,draft.weeks.length-1);}
    if(action==='weekUp'||action==='weekDown'){const j=editorWeek+(action==='weekUp'?-1:1);if(j>=0&&j<draft.weeks.length){[draft.weeks[editorWeek],draft.weeks[j]]=[draft.weeks[j],draft.weeks[editorWeek]];editorWeek=j;}}
    if(action==='moduleUp'){const modules=draft.weeks[editorWeek].program.modules;if(modules.length>1)modules.push(modules.shift());}
    if(action==='applyAll'){if(confirm('将当前周的目标、训练日和模块复制到全部周？'))draft.weeks=draft.weeks.map(()=>({...P.clone(draft.weeks[editorWeek]),id:P.id('week')}));}
    if(action==='saveDraft'){P.validateTemplate(draft);const copy=P.clone(draft);copy.id=P.id('template');copy.builtin=false;templates.push(copy);await save();bridge.toast('个人模板已保存');return;}
    if(action==='archiveTemplate'){templates.find(t=>t.id===template.id).archived=true;await save();return;}
    if(action==='exportTemplate'){bridge.download(JSON.stringify({format:'stop-action-plan-template',version:1,template},null,2),'plan-template.json','application/json');return;}
    if(action==='importTemplate'){document.getElementById('templateFile').click();return;}
    if(action==='previewDraft'){preview=P.instantiate(draft,document.getElementById('longStartDate').value);}
    if(action==='editPreviewTask'){const task=preview.tasks.find(t=>t.id===button.dataset.task);draft=P.makeTemplate(1);draft.name='预览任务草稿';draft.weeks[0].program=P.clone(task.programSnapshot);editorWeek=0;previewTaskId=task.id;draftTaskId=null;draftPlanId=null;}
    if(action==='applyPreviewTask'){P.validateTemplate(draft);const task=preview.tasks.find(t=>t.id===previewTaskId);task.programSnapshot=P.clone(draft.weeks[0].program);task.userEdited=true;previewTaskId=null;draft=null;}
    if(action==='closePreview')preview=null;
    if(action==='activatePreview'){activate(preview);preview=null;draft=null;await save();return;}
    if(action==='pausePlan'||action==='archivePlan'){if(bridge.isTraining())throw new Error('请先暂停并结束当前训练');current.status=action==='pausePlan'?'PAUSED':'ARCHIVED';activeId=null;await save();return;}
    if(action==='resumePlan'){if(bridge.isTraining())throw new Error('请先结束当前训练');if(current)current.status='PAUSED';const p=instances.find(p=>p.id===button.dataset.plan);p.status='ACTIVE';activeId=p.id;await save();return;}
    if(action==='saveInstance'){const p=instances.find(p=>p.id===button.dataset.plan),copy=P.clone(p.templateSnapshot);copy.id=P.id('template');copy.builtin=false;copy.name+=' · 保存的模板';templates.push(copy);await save();return;}
    if(action==='advance'){const next=P.nextPhaseWeek(current);if(next===null)return;if(confirm('进入“'+current.templateSnapshot.weeks[next].phase+'”？不自动提高练习量。')){current.confirmations.push({type:'ADVANCE',oldWeek:current.confirmedWeek,newWeek:next,at:Date.now()});current.confirmedWeek=next;await save();}return;}
    if(action==='repeat'){if(bridge.isTraining())throw new Error('请先结束当前训练');if(confirm('重复已确认阶段一周，未来待练安排顺延；历史不移动。')){P.repeatWeek(current);await save();}return;}
    if(action==='shiftPlan'){if(bridge.isTraining())throw new Error('请先结束当前训练');const changes=P.shiftPreview(current,P.dateKey());if(changes.length&&confirm('未来安排整体顺延，保留间隔：\n'+changes.map(x=>x.from+' → '+x.to).join('\n'))){changes.forEach(x=>current.tasks.find(t=>t.id===x.id).date=x.to);await save();}return;}
    if(action==='editActive'){draft=P.clone(current.templateSnapshot);draft.id=P.id('template');draft.name+=' · 草稿';editorWeek=current.confirmedWeek;draftPlanId=current.id;draftTaskId=null;}
    if(action==='startTask'){const row=requireTask(task.id);await bridge.launch(taskProgram(row),row);return;}
    if(action==='moveTask'){openPlanForm('move',{task:requireTask(task.id)});return;}
    if(action==='skipTask'||action==='cancelTask'){requireTask(task.id).status=action==='skipTask'?'SKIPPED':'CANCELLED';await save();return;}
    if(action==='editTask'){const row=requireTask(task.id);openPlanForm('edit',{task:row,program:taskProgram(row)});return;}
    if(action==='applyTaskDraft'){
      const row=requireTask(draftTaskId),program=draft.weeks[0].program;
      P.validateProgram(program);
      row.programSnapshot=P.clone(program);row.programId=program.id;row.userEdited=true;
      draft=null;draftTaskId=null;await save();return;
    }
    if(action==='applyPlanDraft'){
      P.validateTemplate(draft);const owner=instances.find(p=>p.id===draftPlanId),generated=P.instantiate(draft,owner.startDate),future=owner.tasks.filter(t=>t.status==='PLANNED'&&!t.lastPartialSessionId&&t.date>=P.dateKey()&&!bridge.isTaskRunning(t.id));
      if(!confirm('更新未来未开始的安排；已完成、逾期和正在训练的记录保留。\n新排程：\n'+generated.tasks.filter(t=>t.date>=P.dateKey()).map(t=>t.date+' '+t.programSnapshot.name).join('\n')))return;
      const match=new Map(future.map(t=>[t.weekIndex+':'+t.originalDate,t]));owner.tasks=owner.tasks.filter(t=>!future.includes(t));
      generated.tasks.filter(t=>t.date>=P.dateKey()).forEach(t=>{const old=match.get(t.weekIndex+':'+t.originalDate);if(old){t.id=old.id;t.date=old.date;}if(!owner.tasks.some(x=>x.weekIndex===t.weekIndex&&x.date===t.date)){t.planId=owner.id;owner.tasks.push(t);}});
      owner.templateSnapshot=P.clone(draft);owner.name=draft.name;owner.confirmedWeek=Math.min(owner.confirmedWeek,draft.weeks.length-1);draft=null;draftPlanId=null;await save();return;
    }
    render();
  }
  async function addTask(program,date){
    P.parseDate(date);P.validateProgram(program);let instance=instances.find(p=>p.free);if(!instance){instance={schemaVersion:1,id:P.id('plan'),free:true,name:'自由安排',templateSnapshot:P.makeTemplate(1),startDate:date,status:'PAUSED',confirmedWeek:0,confirmations:[],tasks:[]};instances.push(instance);}
    instance.tasks.push({schemaVersion:1,id:P.id('task'),planId:instance.id,weekIndex:currentWeekSafe(instance,date),date,programId:program.id,programSnapshot:P.clone(program),userEdited:true,status:'PLANNED',createdAt:Date.now()});await save();
  }
  function currentWeekSafe(instance,date){return Math.max(0,Math.min(instance.templateSnapshot.weeks.length-1,Math.floor(P.dayDistance(instance.startDate,date)/7)));}
  function markCompleted(taskId,sessionId,status='completed'){
    const task = instances.flatMap(plan=>plan.tasks).find(item=>item.id===taskId);
    if (!task || task.status !== 'PLANNED') return;
    if (status === 'partial') task.lastPartialSessionId = sessionId;
    if (status === 'completed') {
      task.status = 'COMPLETED';
      task.completedSessionId = sessionId;
      delete task.lastPartialSessionId;
    }
  }
  function withoutSession(id){
    const snapshot = P.clone(meta());
    for (const task of snapshot.longPlans.flatMap(plan=>plan.tasks)) {
      if (task.lastPartialSessionId === id) delete task.lastPartialSessionId;
      if (task.completedSessionId === id) {
        task.status = 'PLANNED';
        delete task.completedSessionId;
      }
    }
    return snapshot;
  }
  async function defer(){return withPlanAction(async()=>{const task=todayTask();if(task){moveTask(requireTask(task.id),P.addDays(task.date,1));await save();}});}
  function reset(){templates=[];instances=[];activeId=null;draft=null;preview=null;render();}
  function hydrate(values){templates=values.longTemplates||[];instances=values.longPlans||[];activeId=values.activeLongPlanId||null;draft=null;preview=null;render();}
  window.LongPlanUI={init,render,renderCalendar,meta,active,tasks,todayTask,stage,taskProgram,markCompleted,withoutSession,defer,openPlanForm,reset,hydrate};
})();
