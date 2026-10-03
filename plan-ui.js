(() => {
  'use strict';
  const P=window.LongPlans, C=window.TrainingContent;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let bridge,templates=[],instances=[],activeId=null,month=P.dateKey().slice(0,7),selected=P.dateKey(),draft=null,editorWeek=0,preview=null,draftTaskId=null,draftPlanId=null,startDate=P.dateKey(),previewTaskId=null,busy=false;
  const active=()=>instances.find(p=>p.id===activeId&&p.status==='ACTIVE');
  const allTemplates=()=>[...P.builtins,...templates.filter(t=>!t.archived)];
  function meta(){return {longTemplates:templates,longPlans:instances,activeLongPlanId:activeId};}
  async function save(){try{await bridge.db.importData([],meta());bridge.changed();render();}catch(error){templates=await bridge.db.getMeta('longTemplates',[]);instances=await bridge.db.getMeta('longPlans',[]);activeId=await bridge.db.getMeta('activeLongPlanId',null);render();throw new Error('安排未保存，已恢复最后成功版本：'+error.message);}}
  function tasks(){return instances.filter(p=>p.status==='ACTIVE'||p.status==='ARCHIVED'||p.status==='PAUSED').flatMap(p=>p.tasks.map(t=>({...t,instance:p})));}
  function todayTask(){return active()?.tasks.find(t=>t.date===P.dateKey()&&t.status==='PLANNED')||instances.filter(p=>p.free).flatMap(p=>p.tasks).find(t=>t.date===P.dateKey()&&t.status==='PLANNED')||null;}
  function stage(task){const plan=task?instances.find(p=>p.id===task.planId):active();if(!plan)return null;const week=P.effectiveWeek(plan,task);return {name:week.phase,focus:week.goal,sessions:week.days.length,cycles:week.program.modules.find(m=>m.exerciseId==='stop_start')?.cycles||2,mindfulness:week.days.length,pelvic:week.days.length};}
  function taskProgram(task){const instance=instances.find(p=>p.id===task.planId);if(!instance||task.userEdited||instance.free)return P.clone(task.programSnapshot);return P.clone(task.weekIndex>instance.confirmedWeek?P.effectiveWeek(instance,task).program:task.programSnapshot);}
  async function init(api){
    bridge=api;templates=await api.db.getMeta('longTemplates',[]);instances=await api.db.getMeta('longPlans',[]);activeId=await api.db.getMeta('activeLongPlanId',null);
    if(!await api.db.getMeta('migration-long-v1',false)){
      if(api.sessions().length||api.legacyPlan().currentWeek>0){const legacy=P.migrateLegacy(api.legacyPlan(),api.programs());instances.push(legacy);activeId=legacy.id;}
      await api.db.importData([],{...meta(),'legacyPlanBeforeMigration':P.clone(api.legacyPlan()),'migration-long-v1':true});
    }
    const root=document.getElementById('longPlanRoot');root.addEventListener('click',async event=>{if(busy)return;busy=true;try{await handle(event);}catch(error){bridge.toast(error.message);}finally{busy=false;}});
    root.addEventListener('change',event=>change(event).catch(error=>bridge.toast(error.message)));
    document.getElementById('calendarTools').addEventListener('click',event=>calendarAction(event));
    document.getElementById('calendarMonth').addEventListener('change',event=>{if(/^\d{4}-\d{2}$/.test(event.target.value)){month=event.target.value;renderCalendar();}});
    document.getElementById('scheduleCalendar').addEventListener('click',event=>{const cell=event.target.closest('[data-date]');if(cell){selected=cell.dataset.date;renderCalendar();render();}});
    document.getElementById('scheduleCalendar').addEventListener('dragover',event=>event.preventDefault());
    document.getElementById('scheduleCalendar').addEventListener('drop',event=>{event.preventDefault();const cell=event.target.closest('[data-date]'),task=active()?.tasks.find(t=>t.id===event.dataTransfer.getData('text/plain'));if(cell&&task?.status==='PLANNED'&&!bridge.isTaskRunning(task.id)){task.date=cell.dataset.date;save().catch(e=>bridge.toast(e.message));}});
    root.addEventListener('dragstart',event=>{const row=event.target.closest('[data-drag-task]');if(row)event.dataTransfer.setData('text/plain',row.dataset.dragTask);});
    render();
  }
  function calendarAction(event){const action=event.target.dataset.calendar;if(!action)return;if(action==='today'){month=P.dateKey().slice(0,7);selected=P.dateKey();}else{const d=P.parseDate(month+'-01');d.setMonth(d.getMonth()+(action==='prev'?-1:1));month=P.dateKey(d).slice(0,7);}renderCalendar();}
  function renderCalendar(){
    const container=document.getElementById('scheduleCalendar');if(!container||!bridge)return;
    document.getElementById('calendarMonth').value=month;
    container.innerHTML=['一','二','三','四','五','六','日'].map(d=>`<div class="small" style="text-align:center">${d}</div>`).join('')+P.monthCells(month).map(date=>{
      const rows=tasks().filter(t=>t.date===date),past=date<P.dateKey(),planned=rows.filter(t=>t.status==='PLANNED').length,done=rows.filter(t=>t.status==='COMPLETED').length,actual=bridge.sessions().filter(s=>!s.simulated&&!s.rehearsal&&s.endedAt&&P.dateKey(new Date(s.endedAt))===date).length;
      return `<button class="calendar-day ${date===P.dateKey()?'today':''} ${date===selected?'selected':''}" data-date="${date}" style="opacity:${date.startsWith(month)?1:.45}" aria-label="${date}，${rows.length}次安排，${actual}条实际训练记录"><span>${Number(date.slice(-2))}</span><span class="small">${done?'✓ '+done:''}${actual?'<br>记录 '+actual:''}${planned?'<br>'+ (past?'待处理 ':'待练 ')+planned:rows.some(t=>['SKIPPED','CANCELLED'].includes(t.status))?'<br>跳过/取消':''}${!rows.length&&!actual?'<br>休息':''}</span></button>`;
    }).join('');
  }
  function btn(action,label,extra=''){return `<button type="button" class="secondary" data-action="${action}" ${extra}>${label}</button>`;}
  function editor(){
    const week=draft.weeks[editorWeek];
    return `<div class="card" id="longEditor"><h2>长期计划草稿</h2><label>名称<input class="text-input" data-field="name" value="${esc(draft.name)}" maxlength="80"></label><label>总周数<input class="text-input" type="number" min="1" max="52" data-field="length" value="${draft.weeks.length}"></label><label>编辑周次<select class="text-input" data-field="week">${draft.weeks.map((w,i)=>`<option value="${i}" ${i===editorWeek?'selected':''}>第${i+1}周 · ${esc(w.phase)}</option>`).join('')}</select></label><label>阶段名称<input class="text-input" data-field="phase" value="${esc(week.phase)}" maxlength="80"></label><label>本周目标<textarea class="text-input" data-field="goal" maxlength="1000">${esc(week.goal)}</textarea></label><p class="small">训练日在每个计划周的开始日期后计算。例如开始日为周三，+3天为周六。</p><div class="chips">${Array.from({length:7},(_,day)=>`<label><input type="checkbox" data-day="${day}" ${week.days.includes(day)?'checked':''}>+${day}天</label>`).join('')}</div><label>单次方案名称<input class="text-input" data-field="programName" value="${esc(week.program.name)}" maxlength="80"></label><div class="small">以下模块与顺序只修改当前周。分钟/轮/循环均为产品安排，可随时减少或结束。</div>${Object.entries(C.modules).map(([key])=>{
      const m=week.program.modules.find(x=>x.exerciseId===key), timed=!['stop_start','pelvic_coordination'].includes(key),value=m?(timed?m.durationSec/60:m.cycles??m.rounds):(timed?3:2);
      return `<div class="builder-row"><input type="checkbox" data-module="${key}" ${m?'checked':''} aria-label="包含${esc(bridge.exerciseName(key))}"><span>${esc(bridge.exerciseName(key))}</span><input type="number" min="1" max="30" data-module-value="${key}" value="${value}" aria-label="${esc(bridge.exerciseName(key))}数量"><span>${timed?'分钟':key==='stop_start'?'循环':'轮'}</span></div>`;
    }).join('')}<div class="mini-actions">${btn('moduleUp','当前第一个模块移到末尾')}${btn('copyWeek','复制当前周')}${btn('deleteWeek','删除当前周')}${btn('weekUp','本周前移')}${btn('weekDown','本周后移')}${btn('applyAll','将本周内容复制到全部周')}${btn('saveDraft','保存个人模板')}${btn('closeDraft','关闭草稿')}</div><label>开始日期<input class="text-input" id="longStartDate" type="date" value="${P.dateKey()}"></label>${btn('previewDraft','预览完整执行排程')}</div>`;
  }
  function render(){
    if(!bridge)return;renderCalendar();const current=active(),rows=tasks().filter(t=>t.date===selected),history=bridge.sessions().filter(s=>!s.simulated&&!s.rehearsal&&P.dateKey(new Date(s.endedAt||s.createdAt))===selected);
    let html=`<div class="card"><h2>长期主计划</h2><p class="small">${esc(C.guidance.plan.text)}</p>${current?`<strong>${esc(current.name)}</strong><p class="small">${current.startDate} 起 · ${current.templateSnapshot.weeks.length}周 · 已确认第${current.confirmedWeek+1}周阶段</p><div class="mini-actions">${btn('pausePlan','暂停主计划')}${btn('archivePlan','归档主计划')}${btn('shiftPlan','从今天重新安排')}${btn('editActive','编辑未来安排')}</div>${P.phaseDue(current)?`<div class="engine-note">阶段复盘：未确认前沿用当前阶段，不自动增加练习量。</div><div class="mini-actions">${btn('advance','确认下一阶段')}${btn('repeat','重复当前阶段')}</div>`:''}`:'<p class="muted">没有正在执行的主计划。选择模板或恢复暂停的计划。</p>'}</div>`;
    html+=`<div class="card"><h2>${selected} · 日期详情</h2>${rows.length?rows.map(t=>`<div class="program-card" ${t.status==='PLANNED'?'draggable="true" data-drag-task="'+esc(t.id)+'"':''}><strong>${esc(t.programSnapshot?.name||'训练')}</strong><div class="small">${esc(t.instance.name)} · ${esc(t.status==='PLANNED'?(t.date<P.dateKey()?'逾期待处理':'待完成'):({COMPLETED:'已完成',SKIPPED:'已跳过',CANCELLED:'已取消'}[t.status]))}</div>${t.status==='PLANNED'&&(t.instance.status==='ACTIVE'||t.instance.free)?`<div class="mini-actions">${btn('startTask','开始','data-task="'+esc(t.id)+'"')}${btn('moveTask','改期','data-task="'+esc(t.id)+'"')}${btn('editTask','编辑模块','data-task="'+esc(t.id)+'"')}${btn('skipTask','跳过','data-task="'+esc(t.id)+'"')}${btn('cancelTask','取消','data-task="'+esc(t.id)+'"')}</div>`:''}${t.completedSessionId?btn('viewSession','查看记录','data-session="'+esc(t.completedSessionId)+'"'):''}</div>`).join(''):'<p class="muted">休息或自由安排。</p>'}${history.filter(s=>!rows.some(t=>t.completedSessionId===s.id)).map(s=>btn('viewSession','自由训练 · '+esc(s.programSnapshot?.name||'训练'),'data-session="'+esc(s.id)+'"')).join('')}<label>添加单次方案<select id="dateProgram" class="text-input">${bridge.programs().map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>${btn('addTask','安排在所选日期')}</div>`;
    html+=`<div class="card"><h2>长期计划模板库</h2>${allTemplates().map(t=>`<div class="program-card"><strong>${esc(t.name)}</strong><p class="small">${t.weeks.length}周 · ${t.builtin?'内置，可编辑副本':'个人模板'} · 内容v${esc(t.contentVersion||'1')}</p><div class="mini-actions">${btn('editTemplate','预览／编辑副本','data-template="'+esc(t.id)+'"')}${btn('exportTemplate','导出模板','data-template="'+esc(t.id)+'"')}${!t.builtin?btn('archiveTemplate','归档模板','data-template="'+esc(t.id)+'"'):''}</div></div>`).join('')}<div class="mini-actions">${btn('newTemplate','创建1–52周计划')}${btn('importTemplate','导入模板')}</div><input id="templateFile" type="file" accept=".json" hidden></div>`;
    const others=instances.filter(p=>p.status!=='ACTIVE');if(others.length)html+=`<div class="card"><h2>暂停与历史计划</h2>${others.map(p=>`<div class="program-card">${esc(p.name)} · ${p.status==='PAUSED'?'已暂停':'已归档'}${p.status==='PAUSED'?btn('resumePlan','恢复','data-plan="'+esc(p.id)+'"'):''}${btn('saveInstance','保存为个人模板','data-plan="'+esc(p.id)+'"')}</div>`).join('')}</div>`;
    if(draft)html+=editor();
    if(preview)html+=`<div class="card"><h2>完整排程预览</h2><p class="small">可以先修改每次日期与模块。启动将暂停旧主计划，所有已完成记录保留。</p><div class="plan-preview">${preview.tasks.map(t=>`<div><label>第${t.weekIndex+1}周 · ${esc(t.programSnapshot.name)}<input class="text-input" type="date" data-preview-date="${esc(t.id)}" value="${t.date}"></label>${btn('editPreviewTask','编辑此次模块','data-task="'+esc(t.id)+'"')}</div>`).join('')}</div>${btn('activatePreview','确认启用主计划')}${btn('closePreview','取消')}</div>`;
    const root=document.getElementById('longPlanRoot');root.innerHTML=html;
    document.getElementById('templateFile').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>1024*1024)throw new Error('模板文件过大');const data=JSON.parse(await file.text());if(data.format!=='stop-action-plan-template'||data.version!==1)throw new Error('模板格式不支持');draft=P.clone(P.validateTemplate(data.template));draft.id=P.id('template');draft.builtin=false;editorWeek=0;render();}catch(error){bridge.toast(error.message);}});
    if(draft){document.getElementById('longStartDate').value=startDate;const order=document.createElement('div');order.className='mini-actions';order.innerHTML=draft.weeks[editorWeek].program.modules.map((m,i)=>`${btn('moveModule',esc(bridge.exerciseName(m.exerciseId))+' ↑','data-index="'+i+'" data-direction="-1"')}${btn('moveModule',esc(bridge.exerciseName(m.exerciseId))+' ↓','data-index="'+i+'" data-direction="1"')}`).join('')+(draftTaskId?btn('applyTaskDraft','应用本次／以后安排'):'')+(draftPlanId?btn('applyPlanDraft','预览并应用未来周安排'):'')+(previewTaskId?btn('applyPreviewTask','应用预览任务修改'):'');document.getElementById('longEditor').appendChild(order);}
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
    if(action==='activatePreview'){if(bridge.isTraining())throw new Error('请先结束当前训练再切换主计划');if(current)current.status='PAUSED';instances.push(preview);activeId=preview.id;preview=null;draft=null;await save();return;}
    if(action==='pausePlan'||action==='archivePlan'){if(bridge.isTraining())throw new Error('请先暂停并结束当前训练');current.status=action==='pausePlan'?'PAUSED':'ARCHIVED';activeId=null;await save();return;}
    if(action==='resumePlan'){if(bridge.isTraining())throw new Error('请先结束当前训练');if(current)current.status='PAUSED';const p=instances.find(p=>p.id===button.dataset.plan);p.status='ACTIVE';activeId=p.id;await save();return;}
    if(action==='saveInstance'){const p=instances.find(p=>p.id===button.dataset.plan),copy=P.clone(p.templateSnapshot);copy.id=P.id('template');copy.builtin=false;copy.name+=' · 保存的模板';templates.push(copy);await save();return;}
    if(action==='advance'){const next=P.nextPhaseWeek(current);if(next===null)return;if(confirm('进入“'+current.templateSnapshot.weeks[next].phase+'”？不自动提高练习量。')){current.confirmations.push({type:'ADVANCE',oldWeek:current.confirmedWeek,newWeek:next,at:Date.now()});current.confirmedWeek=next;await save();}return;}
    if(action==='repeat'){if(bridge.isTraining())throw new Error('请先结束当前训练');if(confirm('重复已确认阶段一周，未来待练安排顺延；历史不移动。')){P.repeatWeek(current);await save();}return;}
    if(action==='shiftPlan'){if(bridge.isTraining())throw new Error('请先结束当前训练');const changes=P.shiftPreview(current,P.dateKey());if(changes.length&&confirm('未来安排整体顺延，保留间隔：\n'+changes.map(x=>x.from+' → '+x.to).join('\n'))){changes.forEach(x=>current.tasks.find(t=>t.id===x.id).date=x.to);await save();}return;}
    if(action==='editActive'){draft=P.clone(current.templateSnapshot);draft.id=P.id('template');draft.name+=' · 草稿';editorWeek=current.confirmedWeek;draftPlanId=current.id;draftTaskId=null;}
    if(action==='startTask'){bridge.launch(taskProgram(task),task);return;}
    if(action==='moveTask'){const date=prompt('新日期（YYYY-MM-DD，可跨月）',task.date);if(date){P.parseDate(date);task.date=date;await save();}return;}
    if(action==='skipTask'||action==='cancelTask'){task.status=action==='skipTask'?'SKIPPED':'CANCELLED';await save();return;}
    if(action==='editTask'){draft=P.makeTemplate(1);draft.name='任务模块草稿';draft.weeks[0].program=P.clone(task.programSnapshot);editorWeek=0;draftTaskId=task.id;draftPlanId=null;}
    if(action==='applyTaskDraft'){
      P.validateTemplate(draft);const selectedTask=instances.flatMap(p=>p.tasks).find(t=>t.id===draftTaskId),owner=instances.find(p=>p.tasks.includes(selectedTask));
      const future=confirm('确定：修改本次及以后未开始的安排。\n取消：仅修改本次。');
      owner.tasks.filter(t=>t.status==='PLANNED'&&!bridge.isTaskRunning(t.id)&&(future?t.date>=selectedTask.date:t.id===selectedTask.id)).forEach(t=>{t.programSnapshot=P.clone(draft.weeks[0].program);t.userEdited=true;});draft=null;draftTaskId=null;await save();return;
    }
    if(action==='applyPlanDraft'){
      P.validateTemplate(draft);const owner=instances.find(p=>p.id===draftPlanId),generated=P.instantiate(draft,owner.startDate),future=owner.tasks.filter(t=>t.status==='PLANNED'&&t.date>=P.dateKey()&&!bridge.isTaskRunning(t.id));
      if(!confirm('更新未来未开始的安排；已完成、逾期和正在训练的记录保留。\n新排程：\n'+generated.tasks.filter(t=>t.date>=P.dateKey()).map(t=>t.date+' '+t.programSnapshot.name).join('\n')))return;
      const match=new Map(future.map(t=>[t.weekIndex+':'+t.originalDate,t]));owner.tasks=owner.tasks.filter(t=>!future.includes(t));
      generated.tasks.filter(t=>t.date>=P.dateKey()).forEach(t=>{const old=match.get(t.weekIndex+':'+t.originalDate);if(old){t.id=old.id;t.date=old.date;}if(!owner.tasks.some(x=>x.weekIndex===t.weekIndex&&x.date===t.date)){t.planId=owner.id;owner.tasks.push(t);}});
      owner.templateSnapshot=P.clone(draft);owner.name=draft.name;owner.confirmedWeek=Math.min(owner.confirmedWeek,draft.weeks.length-1);draft=null;draftPlanId=null;await save();return;
    }
    if(action==='addTask'){const program=bridge.programs().find(p=>p.id===document.getElementById('dateProgram').value);await addTask(program,selected);return;}
    render();
  }
  async function addTask(program,date){
    P.parseDate(date);let instance=active()||instances.find(p=>p.free);if(!instance){instance={schemaVersion:1,id:P.id('plan'),free:true,name:'自由安排',templateSnapshot:P.makeTemplate(1),startDate:date,status:'PAUSED',confirmedWeek:0,confirmations:[],tasks:[]};instances.push(instance);}
    instance.tasks.push({schemaVersion:1,id:P.id('task'),planId:instance.id,weekIndex:currentWeekSafe(instance,date),date,programId:program.id,programSnapshot:P.clone(program),userEdited:true,status:'PLANNED',createdAt:Date.now()});await save();
  }
  function currentWeekSafe(instance,date){return Math.max(0,Math.min(instance.templateSnapshot.weeks.length-1,Math.floor(P.dayDistance(instance.startDate,date)/7)));}
  function markCompleted(taskId,sessionId){for(const p of instances){const task=p.tasks.find(t=>t.id===taskId);if(task){task.status='COMPLETED';task.completedSessionId=sessionId;return;}}}
  async function removeSession(id){for(const p of instances)p.tasks.forEach(t=>{if(t.completedSessionId===id){t.status='PLANNED';delete t.completedSessionId;}});await save();}
  async function associate(sessionId,taskId){markCompleted(taskId,sessionId);await save();}
  async function defer(){const task=todayTask();if(task){task.date=P.addDays(task.date,1);await save();}}
  function reset(){templates=[];instances=[];activeId=null;draft=null;preview=null;render();}
  function hydrate(values){templates=values.longTemplates||[];instances=values.longPlans||[];activeId=values.activeLongPlanId||null;draft=null;preview=null;render();}
  window.LongPlanUI={init,render,renderCalendar,meta,active,tasks,todayTask,stage,taskProgram,markCompleted,removeSession,associate,defer,addTask,reset,hydrate};
})();
