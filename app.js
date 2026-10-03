(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const views = $$('.view');
  const mainNav = $('#mainNav');
  const DB = window.TrainingDB;

  const DEFAULT_STOP_THRESHOLD = 7;
  const DEFAULT_RESUME_THRESHOLD = 5;
  const DAY_MS = 86400000;
  const APP_VERSION = '2.0.0';
  const Core = window.TrainingCore, Content = window.TrainingContent, Long = window.LongPlanUI, Backup = window.TrainingBackup;
  let acceptedParameters={stopThreshold:7,resumeThreshold:5},parameterHistory=[],saveInFlight=false,guideLastElapsed=0,checkpointTimer=null,wakeLock=null,waitingWorker=null,moduleActionReadyAt=0;
  let pendingRestore=null,restorePreview=null,updateRequested=false,insightFilter={plan:'',stage:'',program:'',mode:'',clock:'2',from:'',to:''};
  const BETA_MAX_EVENTS = 2500;

  const STAGES = {
    0: { name: '基线校准', focus: '先熟悉 0–9 兴奋度和 Stop → Recovery → Resume 操作，不追求任何表现。', sessions: 2, cycles: 2, mindfulness: 2, pelvic: 2 },
    1: { name: '身体觉察', focus: '先学会分辨兴奋等级和身体变化，不追求延长时间。', sessions: 2, cycles: 2, mindfulness: 2, pelvic: 2 },
    2: { name: '第一次控制训练', focus: '建立“高兴奋 → Stop → 回到可控水平”的基本回路。', sessions: 3, cycles: 3, mindfulness: 3, pelvic: 3 },
    3: { name: '恢复能力', focus: '重点观察 Stop 后的恢复过程和 ART，而不是单次坚持时间。', sessions: 3, cycles: 3, mindfulness: 3, pelvic: 3 },
    4: { name: '提前识别', focus: '把注意点从“已经很高”前移到更早的身体预警信号。', sessions: 3, cycles: 3, mindfulness: 3, pelvic: 3 },
    5: { name: '稳定高兴奋区', focus: '在可控高兴奋区保持稳定，不需要不断逼近失控边缘。', sessions: 3, cycles: 4, mindfulness: 3, pelvic: 3 },
    6: { name: '动态控制', focus: '观察节奏和强度变化如何影响兴奋曲线，练习更早主动调节。', sessions: 3, cycles: 4, mindfulness: 3, pelvic: 3 },
    7: { name: '自主控制', focus: '逐渐减少外部提示，把判断权交还给自己的身体觉察。', sessions: 3, cycles: 4, mindfulness: 3, pelvic: 3 },
    8: { name: '迁移与巩固', focus: '把觉察、降档和恢复能力迁移到更真实的情境中。', sessions: 2, cycles: 3, mindfulness: 2, pelvic: 2 }
  };

  const EXERCISES = {
    breathing: {
      id: 'breathing', name: '呼吸觉察', category: 'mindfulness', type: 'timed', defaultValue: 3, unit: '分钟', icon: '◯',
      instruction: '自然呼吸，不需要刻意放慢。注意呼吸正在发生，并留意身体有没有不自觉用力。'
    },
    mindfulness_body_scan: {
      id: 'mindfulness_body_scan', name: '身体扫描', category: 'mindfulness', type: 'timed', defaultValue: 5, unit: '分钟', icon: '◎',
      instruction: '依次注意下颌、肩部、腹部、臀部、大腿和盆底。发现紧张即可，不要求立刻把感觉赶走。'
    },
    pelvic_coordination: {
      id: 'pelvic_coordination', name: '盆底协调', category: 'pelvic', type: 'interval', defaultValue: 5, unit: '轮', icon: '◇',
      instruction: '轻柔收缩与完整放松交替进行。保持正常呼吸，不同时夹紧腹部、臀部和大腿。'
    },
    stop_start: {
      id: 'stop_start', name: '动停控制', category: 'stop', type: 'stop_start', defaultValue: 3, unit: '循环', icon: '↕',
      instruction: '记录兴奋变化，在高兴奋时 Stop，恢复到可控水平后再 Resume。'
    },
    pelvic_release: {
      id: 'pelvic_release', name: '盆底释放', category: 'pelvic', type: 'timed', defaultValue: 3, unit: '分钟', icon: '▽',
      instruction: '保持自然呼吸，留意腹部、臀部和盆底是否仍在持续用力，允许多余的张力慢慢释放。'
    }
  };
  Object.entries(Content.modules).forEach(([key,text])=>EXERCISES[key].instruction=text.short);

  const PROMPT_MODES = {
    full: '完整提示',
    haptic: '震动为主',
    threshold: '仅阈值',
    autonomous: '自主模式'
  };

  let settings = { haptics: true, promptMode: 'full' };
  let plan = null;
  let sessionCache = [];
  let adaptiveDecision = null;
  let adaptiveHistory = [];
  let simulationAdaptiveHistory = [];
  let coachHistory = [];
  let coachChatMessages = [];
  let externalCoachToken = '';
  let acceptanceResults = {};
  let betaTelemetry = [];
  let betaInstallId = '';
  let betaPersistTimer = null;
  let activeInsightTab = 'trends';
  let customPrograms = [];
  let builderState = [];
  let pain = false;
  let currentSession = null;
  let pendingLaunch = null;
  let sessionTimer = null;
  let guidedTimer = null;
  let touchStart = null;
  let lastTap = 0;
  let longPressTimer = null;
  let toastTimer = null;
  let dragState = null;

  function betaDeviceSnapshot() {
    return {
      appVersion: APP_VERSION,
      userAgent: navigator.userAgent || '',
      platform: navigator.platform || '',
      language: navigator.language || '',
      screen: { width: window.screen?.width || null, height: window.screen?.height || null, dpr: window.devicePixelRatio || 1 },
      viewport: { width: window.innerWidth || null, height: window.innerHeight || null },
      maxTouchPoints: navigator.maxTouchPoints || 0,
      standalone: !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone),
      capabilities: {
        vibration: !!navigator.vibrate,
        serviceWorker: 'serviceWorker' in navigator,
        wakeLock: 'wakeLock' in navigator,
        pointerEvents: 'PointerEvent' in window,
        indexedDB: !!window.indexedDB,
        fileApi: !!window.FileReader
      }
    };
  }
  function betaRunAliasMap(events) {
    const map = new Map(); let i = 0;
    events.forEach(e => { if (e.runId && !map.has(e.runId)) map.set(e.runId, `run-${String(++i).padStart(3,'0')}`); });
    return map;
  }
  function persistBetaTelemetrySoon() {
    clearTimeout(betaPersistTimer);
    betaPersistTimer = setTimeout(() => DB.setMeta('betaTelemetry', betaTelemetry).catch(()=>{}), 180);
  }
  function recordBetaEvent(type, meta = {}) {
    if (!settings.betaTelemetryEnabled) return;
    const safeMeta = { ...meta };
    delete safeMeta.arousal; delete safeMeta.level; delete safeMeta.signal; delete safeMeta.label; delete safeMeta.question; delete safeMeta.message;
    betaTelemetry.push({ seq: (betaTelemetry.at(-1)?.seq || 0) + 1, at: now(), runId: currentSession?.id || null, elapsedMs: currentSession ? activeElapsed() : null, type, meta: safeMeta });
    if (betaTelemetry.length > BETA_MAX_EVENTS) betaTelemetry = betaTelemetry.slice(-BETA_MAX_EVENTS);
    persistBetaTelemetrySoon();
  }
  function betaExportPayload() {
    const events = betaTelemetry.slice();
    const aliases = betaRunAliasMap(events);
    const firstAt = events[0]?.at || now();
    const counts = {};
    events.forEach(e => counts[e.type] = (counts[e.type] || 0) + 1);
    return {
      format: 'stop-action-device-test', version: 1, appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(), installationId: betaInstallId,
      device: betaDeviceSnapshot(),
      acceptance: { ...acceptanceResults },
      summary: { eventCount: events.length, runCount: aliases.size, eventCounts: counts },
      events: events.map(e => ({ seq: e.seq, offsetMs: Math.max(0, e.at - firstAt), run: e.runId ? aliases.get(e.runId) : null, elapsedMs: e.elapsedMs, type: e.type, meta: e.meta || {} }))
    };
  }
  function exportBetaJson() {
    const payload = betaExportPayload();
    downloadBlob(JSON.stringify(payload,null,2),`stop-action-device-test-${dateKey()}.json`,'application/json;charset=utf-8');
    showToast('实机测试 JSON 已生成');
  }
  function exportBetaCsv() {
    const payload = betaExportPayload();
    const headers = ['seq','offsetMs','run','elapsedMs','type','meta'];
    const rows = payload.events.map(e => [e.seq,e.offsetMs,e.run||'',e.elapsedMs??'',e.type,JSON.stringify(e.meta||{})]);
    const csv='\ufeff'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\n');
    downloadBlob(csv,`stop-action-device-test-${dateKey()}.csv`,'text/csv;charset=utf-8');
    showToast('实机测试 CSV 已生成');
  }
  async function toggleBetaTelemetry() {
    settings.betaTelemetryEnabled = !settings.betaTelemetryEnabled;
    await DB.setMeta('settings', settings);
    if (settings.betaTelemetryEnabled) {
      if (!betaInstallId) { betaInstallId = crypto.randomUUID?.() || `install-${now()}-${Math.random().toString(16).slice(2)}`; await DB.setMeta('betaInstallId', betaInstallId); }
      recordBetaEvent('COLLECTION_ENABLED', { device: betaDeviceSnapshot() });
    } else {
      await DB.setMeta('betaTelemetry', betaTelemetry);
    }
    renderSettings();
    showToast(settings.betaTelemetryEnabled ? '已开启实机测试数据收集' : '已停止实机测试数据收集');
  }
  async function clearBetaTelemetry() {
    if (!betaTelemetry.length) { showToast('没有实机测试数据'); return; }
    if (!confirm('清空本机实机测试数据？训练记录不会受影响。')) return;
    betaTelemetry=[]; await DB.setMeta('betaTelemetry', betaTelemetry); renderSettings(); showToast('实机测试数据已清空');
  }
  async function saveBetaFeedback() {
    if (!settings.betaTelemetryEnabled) { showToast('请先在“我的 → 真实使用验收”开启数据收集'); return; }
    recordBetaEvent('POST_SESSION_FEEDBACK', {
      gestureStability: +$('#betaGesture').value,
      hapticClarity: +$('#betaHapticRating').value,
      interactionInterference: +$('#betaInterference').value
    });
    await DB.setMeta('betaTelemetry', betaTelemetry);
    showToast('本次实机反馈已保存');
  }
  function now() { return Date.now(); }
  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function average(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
  }
  function dateKey(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function startOfDay(value = new Date()) {
    const d = value instanceof Date ? new Date(value) : new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function addDays(value, days) {
    const d = new Date(value);
    d.setDate(d.getDate() + days);
    return d;
  }
  function weekdayLabel(value) {
    const labels = ['日', '一', '二', '三', '四', '五', '六'];
    return '周' + labels[new Date(value).getDay()];
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }
  function showToast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function show(id) {
    views.forEach(v => v.classList.toggle('active', v.id === id));
    mainNav.style.display = ['dashboard', 'plan', 'insights', 'settings'].includes(id) ? 'grid' : 'none';
    window.scrollTo(0, 0);
    const heading=document.getElementById(id)?.querySelector?.('h1,.screen-title');if(heading){heading.setAttribute('tabindex','-1');heading.focus?.({preventScroll:true});}
  }
  function navTo(id) {
    show(id);
    $$('#mainNav button').forEach(b => b.classList.toggle('active', b.dataset.nav === id));
    if (id === 'dashboard') refreshDashboard();
    if (id === 'plan') renderPlan();
    if (id === 'insights') renderInsights();
    if (id === 'settings') renderSettings();
  }
  function vibrate(pattern) {
    if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
  }

  function stage() { return Long.stage() || STAGES[clamp(plan?.currentWeek ?? 0, 0, 8)]; }

  function builtInPrograms() {
    const cycles = stage().cycles;
    return [
      {
        id: 'standard', name: '标准训练', description: '呼吸 → 动停 → 盆底释放', builtin: true,
        modules: [
          { exerciseId: 'breathing', durationSec: 180 },
          { exerciseId: 'stop_start', cycles },
          { exerciseId: 'pelvic_release', durationSec: 120 }
        ]
      },
      {
        id: 'mind_body', name: '身心训练', description: '呼吸 + 身体扫描 + 动停', builtin: true,
        modules: [
          { exerciseId: 'breathing', durationSec: 180 },
          { exerciseId: 'mindfulness_body_scan', durationSec: 300 },
          { exerciseId: 'stop_start', cycles }
        ]
      },
      {
        id: 'pelvic_control', name: '盆底协调', description: '协调收缩与释放，不含动停', builtin: true,
        modules: [
          { exerciseId: 'pelvic_coordination', rounds: 5 },
          { exerciseId: 'pelvic_release', durationSec: 180 }
        ]
      },
      {
        id: 'mindfulness_only', name: '正念恢复', description: '只做呼吸与身体扫描', builtin: true,
        modules: [
          { exerciseId: 'breathing', durationSec: 180 },
          { exerciseId: 'mindfulness_body_scan', durationSec: 300 }
        ]
      }
    ];
  }

  function allPrograms() { return [...builtInPrograms(), ...customPrograms]; }
  function programById(id) { return allPrograms().find(p => p.id === id) || builtInPrograms()[0]; }
  function moduleLabel(module) {
    const ex = EXERCISES[module.exerciseId];
    if (!ex) return module.exerciseId;
    if (ex.type === 'timed') return `${ex.name} ${Math.max(1, Math.round((module.durationSec || ex.defaultValue * 60) / 60))}min`;
    if (ex.type === 'interval') return `${ex.name} ×${module.rounds || ex.defaultValue}`;
    return `${ex.name} ×${module.cycles || stage().cycles}`;
  }
  function hasExercise(session, exerciseId) {
    const modules = session.programSnapshot?.modules || [];
    if (modules.some(m => m.exerciseId === exerciseId)) return true;
    const legacy = session.modules || [];
    if (exerciseId === 'stop_start' && legacy.some(x => String(x).includes('动停'))) return true;
    if (exerciseId === 'breathing' && legacy.some(x => String(x).includes('呼吸'))) return true;
    if (exerciseId === 'pelvic_release' && legacy.some(x => String(x).includes('盆底'))) return true;
    return false;
  }
  function sessionHasCategory(session, category) {
    const modules = session.programSnapshot?.modules || [];
    if (modules.some(m => EXERCISES[m.exerciseId]?.category === category)) return true;
    if (!modules.length) {
      if (category === 'stop') return hasExercise(session, 'stop_start');
      if (category === 'mindfulness') return hasExercise(session, 'breathing');
      if (category === 'pelvic') return hasExercise(session, 'pelvic_release');
    }
    return false;
  }

  function persistCurrentSoon() {
    if (!currentSession || currentSession.phase==='COMPLETED') return Promise.resolve();
    if(currentSession.phase==='MODULE_ACTIVE'&&!currentSession.pausedAt)updateGuidedClock();
    const snapshot=Core.checkpoint(currentSession);
    $('#saveStatus').textContent='正在保存';
    return DB.setCurrentSession(snapshot).then(()=>{$('#saveStatus').textContent='已保存';}).catch(error=>{$('#saveStatus').textContent='保存失败 · 可重试或导出';console.error('Training save failed',error);});
  }
  function activeElapsed() {
    if (!currentSession) return 0;
    return Core.elapsed(currentSession);
  }
  function stopActiveClock() {
    if (currentSession?.activeStartedAt) {
      currentSession.activeAccumulatedMs += now() - currentSession.activeStartedAt;
      currentSession.activeStartedAt = null;
    }
  }
  function ensureActiveClock() {
    if (!currentSession.startedAt) currentSession.startedAt = now();
    if (!currentSession.activeStartedAt && !currentSession.pausedAt) currentSession.activeStartedAt = now();
  }
  function event(type, data = {}) {
    if (!currentSession) return;
    const module = currentSession.programSnapshot?.modules?.[currentSession.moduleIndex] || null;
    currentSession.events.push({
      type, at: now(), elapsedMs: activeElapsed(), arousal: currentSession.arousal,
      cycle: currentSession.cycleIndex + 1, moduleIndex: currentSession.moduleIndex,
      exerciseId: module?.exerciseId || null, ...data
    });
    persistCurrentSoon();
  }

  function analysisSessions() {
    return sessionCache.filter(s => (!s.simulated || settings.includeSimulatedData)&&!s.rehearsal&&(!insightFilter.plan||s.longPlanId===insightFilter.plan)&&(!insightFilter.stage||s.planSnapshot?.stageName===insightFilter.stage)&&(!insightFilter.program||s.programSnapshot?.name===insightFilter.program)&&(!insightFilter.mode||s.promptModeSnapshot===insightFilter.mode)&&(!insightFilter.clock||String(s.clockVersion||1)===insightFilter.clock)&&(!insightFilter.from||dateKey(new Date(sessionTimestamp(s)))>=insightFilter.from)&&(!insightFilter.to||dateKey(new Date(sessionTimestamp(s)))<=insightFilter.to));
  }
  function activeRevisions(s) {
    const revisions = Array.isArray(s.revisions) ? s.revisions : [];
    const reversed = new Set(revisions.filter(r => r.kind === 'REVISION_REVERSED' && r.targetRevisionId).map(r => r.targetRevisionId));
    return revisions.filter(r => r.kind === 'CYCLE_CORRECTION' && !reversed.has(r.id));
  }
  function effectiveCycles(s) {
    const cycles = structuredClone(Array.isArray(s.cycles) ? s.cycles : []);
    activeRevisions(s).forEach(r => {
      const c = cycles[r.cycleIndex];
      if (!c || !['stopLevel','resumeLevel','artMs'].includes(r.field)) return;
      c[r.field] = r.newValue;
      c._revised = true;
    });
    return cycles;
  }
  function dataQuality(s) {
    const issues = [];
    const stopSession = hasExercise(s, 'stop_start');
    const rawCycles = Array.isArray(s.cycles) ? s.cycles : [];
    const cycles = effectiveCycles(s);
    const events = Array.isArray(s.events) ? s.events : [];
    let score = 100;
    if (!s.endedAt) { issues.push('Session 未正常结束'); score -= 35; }
    if (!s.review) { issues.push('缺少训练后复盘'); score -= 15; }
    if (!s.checkin) { issues.push('缺少训练前 Check-in'); score -= 10; }
    if (stopSession) {
      const stopEvents = events.filter(e => e.type === 'STOP_STARTED');
      const arousalEvents = events.filter(e => e.type === 'AROUSAL_LEVEL_CHANGED');
      if (!cycles.length) { issues.push('没有完整 Control Cycle'); score -= 35; }
      if (stopEvents.length && Math.abs(stopEvents.length - rawCycles.length) > 1) { issues.push('Stop 事件与 Cycle 数量不一致'); score -= 18; }
      const artMissing = cycles.filter(c => !Number.isFinite(c.artMs) || c.artMs <= 0).length;
      if (artMissing) { issues.push(`${artMissing} 个 Cycle 缺少有效 ART`); score -= Math.min(30, artMissing * 10); }
      const artOdd = cycles.filter(c => Number.isFinite(c.artMs) && (c.artMs < 3000 || c.artMs > 300000)).length;
      if (artOdd) { issues.push(`${artOdd} 个 ART 值明显异常`); score -= Math.min(20, artOdd * 8); }
      const missingLevel = cycles.filter(c => !Number.isFinite(c.stopLevel) || !Number.isFinite(c.resumeLevel)).length;
      if (missingLevel) { issues.push(`${missingLevel} 个 Cycle 缺少 Stop/Resume Level`); score -= Math.min(24, missingLevel * 8); }
      const expectedArousal = Math.max(4, cycles.length * 3);
      if (arousalEvents.length < expectedArousal) { issues.push('兴奋度记录较稀疏'); score -= 15; }
      if (!events.some(e => e.type === 'MODULE_STARTED' && e.exerciseId === 'stop_start')) { issues.push('缺少动停模块起始事件'); score -= 6; }
    } else if (!(s.moduleResults || []).length) {
      issues.push('缺少模块完成记录'); score -= 15;
    }
    if (s.simulated) issues.unshift('模拟数据');
    score = clamp(score, 0, 100);
    const label = score >= 85 ? '完整' : score >= 65 ? '可用' : '注意';
    return {
      score, label, issues,
      className: score >= 85 ? 'quality-good' : score >= 65 ? 'quality-ok' : 'quality-low',
      usableForTrend: score >= 65 && !!s.endedAt,
      revised: activeRevisions(s).length > 0,
      simulated: !!s.simulated
    };
  }
  function qualityBadge(s) {
    const q=dataQuality(s);
    return `<span class="quality-badge ${q.className}">${q.label}${q.revised?' · 已修订':''}</span>${q.simulated?'<span class="sim-badge">模拟</span>':''}`;
  }

  function computeMetrics(s) {
    const cycles = effectiveCycles(s);
    const arts = cycles.map(c => c.artMs).filter(Number.isFinite);
    const stopCount = (s.events || []).filter(e => e.type === 'STOP_STARTED').length;
    const overshootCycles = new Set((s.events || []).filter(e => e.type === 'OVERSHOOT').map(e => `${e.moduleIndex ?? 0}:${e.cycle}`)).size;
    const overshoot = overshootCycles || Number(s.overshootCount || 0);
    return {
      cycles: cycles.length,
      stopCount,
      csr: stopCount ? cycles.length / stopCount : null,
      meanART: average(arts),
      medianART: Core.median(arts),
      overshoot,
      overshootRate: stopCount ? Math.min(1, overshoot / stopCount) : null,
      control: s.review?.control ?? null,
      pelvicTension: s.checkin?.pelvicTension ?? null,
      stress: s.checkin?.stress ?? null,
      fatigue: s.checkin?.fatigue ?? null,
      difficulty: s.review?.difficulty ?? null,
      awareness: s.review?.awareness ?? null,
      meanStopLevel: average(cycles.map(c => c.stopLevel).filter(Number.isFinite)),
      activeMinutes: Number.isFinite(s.activeAccumulatedMs) ? s.activeAccumulatedMs / 60000 : null
    };
  }

  function sessionTimestamp(s) { return s.endedAt || s.startedAt || s.createdAt || 0; }
  function formatDateTime(ts) {
    if (!ts) return '未知时间';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  function weekStartKey(ts) {
    const d = startOfDay(new Date(ts));
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return dateKey(d);
  }
  function weeklySeries() {
    const groups = new Map();
    analysisSessions().filter(s => s.endedAt && hasExercise(s,'stop_start') && dataQuality(s).usableForTrend).forEach(s => {
      const key = weekStartKey(sessionTimestamp(s));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });
    const observed=[...groups.keys()].sort();if(!observed.length)return [];
    const end=observed.at(-1)>weekStartKey(now())?observed.at(-1):weekStartKey(now()),first=observed[0],weeks=Math.min(52,Math.floor(LongPlans.dayDistance(first,end)/7)+1);
    return Array.from({length:weeks},(_,index)=>{const key=LongPlans.addDays(end,-7*(weeks-1-index));return [key,groups.get(key)||[]];}).map(([key, sessions]) => {
      const metrics=sessions.map(computeMetrics);
      return {
        key, label:key.slice(5), count:sessions.length,
        art: average(metrics.map(m => Number.isFinite(m.meanART) ? m.meanART/1000 : null)),
        stop: average(metrics.map(m => m.meanStopLevel)),
        overshoot: average(metrics.map(m => Number.isFinite(m.overshootRate) ? m.overshootRate*100 : null)),
        control: average(metrics.map(m => m.control))
      };
    });
  }
  function renderLineChart(svg, rows, key, options = {}) {
    if (!svg) return;
    const points = rows.map((r,index) => ({label:r.label, value:r[key],index})).filter(p => Number.isFinite(p.value));
    if (!points.length) { svg.innerHTML='<text x="18" y="90" fill="#7f8a98" font-size="13">暂无足够数据</text>'; return; }
    const w=480,h=180,padL=34,padR=16,padT=16,padB=30;
    let min = Number.isFinite(options.min) ? options.min : Math.min(...points.map(p=>p.value));
    let max = Number.isFinite(options.max) ? options.max : Math.max(...points.map(p=>p.value));
    if (min===max) { min-=1; max+=1; }
    const range=max-min;
    const coords=points.map((p,i)=>({
      ...p,
      x:padL+(rows.length===1?0.5:p.index/(rows.length-1))*(w-padL-padR),
      y:h-padB-((p.value-min)/range)*(h-padT-padB)
    }));
    const path=coords.map((p,i)=>(i&&p.index===coords[i-1].index+1?'L':'M')+p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
    const grid=[0,0.5,1].map(t=>{
      const y=padT+t*(h-padT-padB), val=max-t*range;
      return `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#252b34" stroke-width="1"/><text x="2" y="${y+4}" fill="#74808d" font-size="10">${options.format?options.format(val):Math.round(val*10)/10}</text>`;
    }).join('');
    const dots=coords.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#edf2f7"><title>${escapeHtml(p.label)} · ${escapeHtml(options.format?options.format(p.value):Math.round(p.value*10)/10)}</title></circle>`).join('');
    const labels=coords.map((p,i)=> (i===0||i===coords.length-1||coords.length<=4) ? `<text x="${p.x}" y="${h-8}" fill="#74808d" font-size="9" text-anchor="middle">${escapeHtml(p.label)}</text>` : '').join('');
    svg.innerHTML=grid+`<path d="${path}" fill="none" stroke="#edf2f7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`+dots+labels;
  }
  function csvCell(value) {
    const raw=String(value ?? ''),text=/^[=+@-]/.test(raw)?"'"+raw:raw;
    return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
  }
  function downloadBlob(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], {type});
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function decisionRecord(decision, context={}) {
    return {
      id:'D'+now()+Math.random().toString(36).slice(2,6), generatedAt:now(),
      type:decision?.type||'UNKNOWN', title:decision?.title||'训练引擎更新', reason:decision?.reason||'',
      stopThreshold:decision?.stopThreshold ?? null, resumeThreshold:decision?.resumeThreshold ?? null,
      applied:!!decision?.applied, ...context
    };
  }
  async function appendAdaptiveHistory(decision, context={}) {
    const duplicate=context.afterSessionId && adaptiveHistory.some(x=>x.afterSessionId===context.afterSessionId && x.source===context.source);
    if (duplicate) return;
    adaptiveHistory.push(decisionRecord(decision,context));
    adaptiveHistory=adaptiveHistory.slice(-100);
    await DB.setMeta('adaptiveHistory',adaptiveHistory);
  }
  async function ensureAdaptiveHistory() {
    if (adaptiveHistory.length) return;
    const recovered=sessionCache.filter(s=>!s.simulated && s.planSnapshot?.adaptiveType && s.planSnapshot.adaptiveType!=='NONE').slice(-20).map(s=>({
      id:'DL'+s.id, generatedAt:s.createdAt||sessionTimestamp(s), type:s.planSnapshot.adaptiveType,
      title:'旧版训练决策快照', reason:'根据旧 Session 保存的训练引擎类型与阈值恢复；旧版本没有保存完整决策理由。',
      stopThreshold:s.stopThreshold ?? null, resumeThreshold:s.resumeThreshold ?? null, applied:true,
      source:'legacy-session', appliedToSessionId:s.id
    }));
    adaptiveHistory=[...recovered,decisionRecord(adaptiveDecision,{source:'v0.4-init',afterSessionId:sessionCache.at(-1)?.id||null})].slice(-100);
    await DB.setMeta('adaptiveHistory',adaptiveHistory);
  }

  function bodySignalCounts(sessions) {
    const counts = {};
    sessions.forEach(s => {
      const quick = (s.events || []).filter(e => e.type === 'BODY_SIGNAL_RECORDED');
      quick.forEach(e => {
        const label = e.label || e.signal;
        if (label) counts[label] = (counts[label] || 0) + 1;
      });
      if (!quick.length) {
        const reviewSignal = s.review?.signal;
        if (reviewSignal && reviewSignal !== '没有明显信号') counts[reviewSignal] = (counts[reviewSignal] || 0) + 1;
      }
    });
    return counts;
  }

  function adaptiveEngine(sessions, options = {}) {
    const completed = sessions.filter(s => s.review && s.endedAt&&!s.rehearsal && (options.allowSimulated || !s.simulated));
    const lastAny = completed[completed.length - 1];
    if (lastAny?.checkin?.pain) {
      return {
        type: 'SAFETY_REVIEW_REQUIRED', title: '先暂停并确认身体状态',
        reason: '最近一次训练记录了疼痛或明显不适。建议暂停强度升级；如果症状持续或明显，应考虑专业评估。',
        stopThreshold: 6, resumeThreshold: 4, applied: false
      };
    }
    let stopSessions = completed.filter(s => hasExercise(s, 'stop_start') && dataQuality(s).usableForTrend&&(options.allowSimulated||s.clockVersion===2));
    const condition=stopSessions.at(-1);if(condition)stopSessions=stopSessions.filter(s=>Core.conditionKey(s)===Core.conditionKey(condition));
    if (!stopSessions.length) {
      return {
        type: 'ESTABLISH_BASELINE', title: '先建立个人基线',
        reason: '先积累同条件、同计时口径的记录。系统提出产品规则建议，由你确认，不作疗效判断。',
        stopThreshold: DEFAULT_STOP_THRESHOLD, resumeThreshold: DEFAULT_RESUME_THRESHOLD, applied: false
      };
    }
    const recent = stopSessions.slice(-3);
    const metrics = recent.map(computeMetrics);
    const last = recent[recent.length - 1];
    const lastMetric = metrics[metrics.length - 1];
    const hardCount = recent.slice(-2).filter(s => s.review?.difficulty === '太困难').length;
    const avgOvershoot = average(metrics.map(m => m.overshootRate));
    if (hardCount >= 2 || (metrics.length >= 2 && avgOvershoot != null && avgOvershoot >= 0.5)) {
      return {
        type: 'LOWER_STOP_THRESHOLD', title: '下一次提前一点 Stop',
        reason: '近期训练偏难或较频繁进入 Level 8。下一次把 Stop 阈值临时提前到 6，重点练习更早识别和恢复。',
        stopThreshold: 6, resumeThreshold: 4, applied: false
      };
    }
    const previousArts = stopSessions.slice(-4, -1).map(computeMetrics).map(m => m.meanART).filter(Number.isFinite);
    const previousArt = average(previousArts);
    if (lastMetric.meanART && previousArt && lastMetric.meanART > previousArt * 1.25 && (lastMetric.pelvicTension ?? 0) >= 7) {
      return {
        type: 'RECOVERY_FOCUS', title: '下一次优先练恢复',
        reason: '最近一次恢复时间高于近期水平，同时盆底紧张评分较高。保持原阈值，但增加呼吸与盆底释放提示。',
        stopThreshold: DEFAULT_STOP_THRESHOLD, resumeThreshold: DEFAULT_RESUME_THRESHOLD, applied: false
      };
    }
    const avgCSR = average(metrics.map(m => m.csr));
    const avgControl = average(metrics.map(m => m.control));
    if (metrics.length >= 3 && avgCSR != null && avgCSR >= 0.8 && (avgOvershoot ?? 1) <= 0.2 && avgControl != null && avgControl >= 7) {
      return {
        type: 'REDUCE_PROMPTS_SUGGESTED', title: '控制较稳定',
        reason: '最近三次恢复成功率、Level 8 控制和主观控制感较稳定。可以继续当前难度，并由你决定是否减少外部提示。',
        stopThreshold: DEFAULT_STOP_THRESHOLD, resumeThreshold: DEFAULT_RESUME_THRESHOLD, applied: false
      };
    }
    return {
      type: 'KEEP_CURRENT_DIFFICULTY', title: '保持当前难度',
      reason: '近期数据还没有显示需要明显升降级。继续积累稳定的控制循环，比频繁改变难度更有价值。',
      stopThreshold: DEFAULT_STOP_THRESHOLD, resumeThreshold: DEFAULT_RESUME_THRESHOLD, applied: false
    };
  }

  const COACH_CONTEXT_VERSION = 1;
  const COACH_OUTPUT_VERSION = 1;
  const COACH_ALLOWED_FIELDS = ['version','mode','generatedAt','headline','summary','focus','nextStep','watch','evidence','uncertainty','safetyNotice'];
  const COACH_FORBIDDEN_FIELDS = ['stopThreshold','resumeThreshold','trainingWeek','safetyFlag','applyDecision','setThreshold','actions'];
  const COACH_CHAT_ALLOWED_FIELDS = ['answer','focus','evidence','uncertainty','safetyNotice'];
  const COACH_CHAT_MAX_MESSAGES = 60;

  function summarizeMetrics(sessions) {
    const ms=sessions.map(computeMetrics);
    return {
      count:sessions.length,
      meanArtSec:average(ms.map(m=>Number.isFinite(m.meanART)?m.meanART/1000:null)),
      medianArtSec:average(ms.map(m=>Number.isFinite(m.medianART)?m.medianART/1000:null)),
      csr:average(ms.map(m=>m.csr)),
      overshootRate:average(ms.map(m=>m.overshootRate)),
      control:average(ms.map(m=>m.control)),
      stopLevel:average(ms.map(m=>m.meanStopLevel)),
      pelvicTension:average(ms.map(m=>m.pelvicTension)),
      stress:average(ms.map(m=>m.stress)),
      fatigue:average(ms.map(m=>m.fatigue))
    };
  }
  function pctDelta(current, previous) {
    if(!Number.isFinite(current)||!Number.isFinite(previous)||previous===0)return null;
    return (current-previous)/Math.abs(previous);
  }
  function absDelta(current, previous) {
    if(!Number.isFinite(current)||!Number.isFinite(previous))return null;
    return current-previous;
  }
  function topSignalsForCoach(sessions) {
    const counts=bodySignalCounts(sessions), total=Math.max(1,sessions.length);
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([label,count])=>({label,count,sessionRate:count/total}));
  }
  function buildCoachContext(sessions=sessionCache, options={}) {
    const allowSimulated=!!options.allowSimulated;
    const onlySimulated=!!options.onlySimulated;
    const ended=sessions.filter(s=>s.endedAt&&!s.rehearsal && (onlySimulated?s.simulated:(allowSimulated||!s.simulated)));
    const stopAll=ended.filter(s=>hasExercise(s,'stop_start'));
    let usable=stopAll.filter(s=>dataQuality(s).usableForTrend && (onlySimulated||s.clockVersion===2));
    const condition=usable.at(-1);if(condition)usable=usable.filter(s=>Core.conditionKey(s)===Core.conditionKey(condition));
    const recent=usable.slice(-3), previous=usable.slice(-6,-3), signalWindow=usable.slice(-6);
    const current=summarizeMetrics(recent), baseline=summarizeMetrics(previous);
    const latest=usable.at(-1)||null;
    const decision=options.decision || (onlySimulated?adaptiveEngine(usable,{allowSimulated:true}):adaptiveDecision||adaptiveEngine(sessions));
    return {
      schema:`coach-context-v${COACH_CONTEXT_VERSION}`,
      generatedAt:now(),
      source:onlySimulated?'simulated-preview':'real',
      stage:{week:0,name:'个人练习'},
      promptMode:settings.promptMode,
      samples:{completed:ended.length,stopStart:stopAll.length,usable:usable.length,excluded:stopAll.length-usable.length,recent:recent.length,previous:previous.length},
      recent:current,
      previous:baseline,
      change:{artPct:pctDelta(current.meanArtSec,baseline.meanArtSec),overshootDelta:absDelta(current.overshootRate,baseline.overshootRate),controlDelta:absDelta(current.control,baseline.control),stopLevelDelta:absDelta(current.stopLevel,baseline.stopLevel)},
      signals:topSignalsForCoach(signalWindow),
      latestState: latest ? {pain:!!latest.checkin?.pain,difficulty:latest.review?.difficulty||null,awareness:latest.review?.awareness||null} : {pain:false,difficulty:null,awareness:null},
      adaptive:{type:decision?.type||'NONE',title:decision?.title||'',reason:decision?.reason||'',applied:!!decision?.applied},
      privacy:{rawEventsIncluded:false,exactTimestampsIncluded:false,sessionIdsIncluded:false,revisionsIncluded:false}
    };
  }
  function fmtCoachNumber(value, suffix='', digits=0) { return Number.isFinite(value)?value.toFixed(digits)+suffix:'—'; }
  function coachRuleEngine(context) {
    const r=context.recent, p=context.previous, a=context.adaptive||{};
    const evidence=[];
    if(r.count) {
      evidence.push({label:'近期可用 Session',value:String(r.count)});
      evidence.push({label:'平均 ART',value:fmtCoachNumber(r.meanArtSec,'s',0)});
      evidence.push({label:'Overshoot',value:Number.isFinite(r.overshootRate)?Math.round(r.overshootRate*100)+'%':'—'});
      evidence.push({label:'控制感',value:fmtCoachNumber(r.control,'/10',1)});
    }
    let headline='先建立可解释的个人基线';
    let summary='目前还没有足够的高质量动停记录。先完成几次训练，Coach 才会比较恢复、稳定性和主观控制感。';
    let focus='下一次只需要把兴奋等级和 Stop → Recovery → Resume 记录完整。';
    let nextStep='继续当前训练计划，不根据单次表现自行升降难度。';
    let watch='关注记录是否完整，而不是追求某个时长。';
    let safetyNotice=null;
    if(context.latestState?.pain || a.type==='SAFETY_REVIEW_REQUIRED') {
      headline='先处理身体不适信号';
      summary='最近记录里出现了疼痛或明显不适。Coach 不继续做表现解释，也不会建议提高训练负荷。';
      focus='先确认不适是否持续或明显；在原因不清楚时避免把训练强度往上推。';
      nextStep='按 Training Engine 的 Safety Review 处理；如果症状持续或明显，考虑专业评估。';
      watch='身体不适优先于任何训练指标。';
      safetyNotice='安全状态优先：Coach 不能覆盖 Training Engine 的 Safety Review。';
    } else if(r.count) {
      if(a.type==='LOWER_STOP_THRESHOLD') {
        headline='近期更值得练“早点发现”';
        summary=`近期可用记录中 Overshoot 约为 ${Number.isFinite(r.overshootRate)?Math.round(r.overshootRate*100)+'%':'—'}，训练引擎因此把重点放在更早的识别与 Stop。`;
        focus='留意个人呼吸、盆底和动作变化，不需要等待高等级再休息。';
        nextStep='可查看系统建议，确认后才作用于未来训练；Coach 只解释。';
        watch='如果训练明显偏难，优先看控制循环是否完整，而不是是否坚持更久。';
      } else if(a.type==='RECOVERY_FOCUS') {
        headline='下一次把 Recovery 放在第一位';
        summary=`近期平均 ART 约 ${fmtCoachNumber(r.meanArtSec,'s',0)}，同时盆底紧张均值约 ${fmtCoachNumber(r.pelvicTension,'/10',1)}。`;
        focus='Stop 后优先保持呼吸、松腹和盆底释放，观察兴奋是否能自然回到可控区。';
        nextStep='保持训练引擎当前参数，把注意力放在恢复过程，而不是继续提高刺激强度。';
        watch='ART 会受疲劳、压力和记录密度影响，单次变慢不代表能力退步。';
      } else if(a.type==='REDUCE_PROMPTS_SUGGESTED') {
        headline='近期数据支持尝试减少外部提示';
        summary=`近期 CSR 约 ${Number.isFinite(r.csr)?Math.round(r.csr*100)+'%':'—'}，Overshoot 约 ${Number.isFinite(r.overshootRate)?Math.round(r.overshootRate*100)+'%':'—'}，控制感约 ${fmtCoachNumber(r.control,'/10',1)}。`;
        focus='尝试把判断权更多交给自己的身体信号，观察是否能在没有完整提示的情况下主动 Stop。';
        nextStep='是否减少提示仍由你确认；Coach 不会自动切换提示模式。';
        watch='减少提示的目标是建立内部控制，不是把训练变得更难。';
      } else {
        const art=context.change.artPct, control=context.change.controlDelta, over=context.change.overshootDelta;
        if(p.count>=3 && r.count>=3 && Number.isFinite(art) && art<=-0.15 && (control==null||control>=0) && (over==null||over<=0.05)) {
          headline='近期恢复与控制数据出现一致的积极变化';
          summary=`最近 ${r.count} 次的平均 ART 相比前一窗口约 ${Math.abs(Math.round(art*100))}% 更短，同时控制感没有下降。`;
          focus='继续保持当前训练难度，优先复制“更早觉察 → Stop → 放松 → Resume”的过程。';
          nextStep='先积累同条件记录，不依据少量变化增加练习量。';
          watch='观察这种变化能否在更多 Session 中保持，而不是追逐单次最好成绩。';
        } else if(p.count>=3 && r.count>=3 && ((Number.isFinite(art)&&art>=0.2)||(Number.isFinite(control)&&control<=-1))) {
          headline='近期波动增大，先看状态而不是追成绩';
          summary=`近期平均 ART 为 ${fmtCoachNumber(r.meanArtSec,'s',0)}，控制感为 ${fmtCoachNumber(r.control,'/10',1)}。与前一窗口相比，至少一个核心指标出现明显波动。`;
          focus='下一次先观察压力、疲劳、呼吸和盆底紧张是否比平时更高。';
          nextStep='保持或按 Training Engine 调整，不因为一次波动自行加练。';
          watch='训练数据天然会波动，样本窗口比单次结果更重要。';
        } else {
          headline='当前更适合继续积累稳定样本';
          summary=`近期平均 ART ${fmtCoachNumber(r.meanArtSec,'s',0)}，Overshoot ${Number.isFinite(r.overshootRate)?Math.round(r.overshootRate*100)+'%':'—'}，控制感 ${fmtCoachNumber(r.control,'/10',1)}。目前没有出现需要 Coach 额外解释的强趋势。`;
          focus='继续关注高兴奋前的身体信号和 Stop 后恢复过程。';
          nextStep='保持 Training Engine 当前安排，等样本更多后再判断趋势。';
          watch='没有明显趋势并不等于“没效果”，也可能只是数据还少或波动正常。';
        }
      }
      if(context.signals?.length) {
        const top=context.signals[0];
        evidence.push({label:'常见预警信号',value:`${top.label} · ${top.count} 次`});
        focus += ` 最近最常记录到的预警信号是“${top.label}”，可以优先留意它是否在兴奋继续升高前出现。`;
      }
    }
    const uncertainty=context.samples.recent<3||context.samples.previous<3?'前后窗口各需3条同条件、同计时口径的记录；当前只作描述，不判断改善。':'当前比较描述个人记录，不代表临床疗效或因果关系。';
    return sanitizeCoachOutput({version:COACH_OUTPUT_VERSION,mode:'offline-rules',generatedAt:now(),headline,summary,focus,nextStep,watch,evidence,uncertainty,safetyNotice});
  }
  function sanitizeCoachOutput(candidate={}) {
    const out={};
    COACH_ALLOWED_FIELDS.forEach(k=>{ if(candidate[k]!==undefined) out[k]=structuredClone(candidate[k]); });
    if(!Array.isArray(out.evidence))out.evidence=[];
    out.evidence=out.evidence.slice(0,8).map(x=>({label:String(x?.label||'依据'),value:String(x?.value||'—')}));
    ['headline','summary','focus','nextStep','watch','uncertainty','safetyNotice'].forEach(k=>{if(out[k]!=null)out[k]=String(out[k]).slice(0,1200);});
    out.version=COACH_OUTPUT_VERSION; out.mode=String(out.mode||'unknown'); out.generatedAt=Number(out.generatedAt)||now();
    return out;
  }
  function validateCoachOutput(output) {
    if(!output||typeof output!=='object')return false;
    if(COACH_FORBIDDEN_FIELDS.some(k=>Object.prototype.hasOwnProperty.call(output,k)))return false;
    const extras=Object.keys(output).filter(k=>!COACH_ALLOWED_FIELDS.includes(k));
    return extras.length===0 && typeof output.headline==='string' && typeof output.summary==='string' && Array.isArray(output.evidence);
  }
  function externalCoachPayload(context=buildCoachContext()) {
    return {schema:'coach-adapter-request-v1',policy:{explainOnly:true,mayModifyTrainingEngine:false,rawEventsAllowed:false,medicalDiagnosisAllowed:false},context};
  }
  function coachChatEvidenceText(report) {
    return (report.output.evidence||[]).map(e=>`${e.label}：${e.value}`).join('；');
  }
  function localCoachChatReply(question) {
    const q=String(question||'').trim();
    const report=liveCoach();
    const o=report.output, c=report.context;
    let answer=o.summary, focus=o.focus, uncertainty=o.uncertainty, safetyNotice=o.safetyNotice||null;
    const evidence=(o.evidence||[]).slice(0,6);
    if(!q) return {answer:'可以问我最近数据为什么波动、下次关注什么，或者身体信号怎么看。',focus:o.focus,evidence,uncertainty,safetyNotice};
    if(c.latestState?.pain || c.adaptive?.type==='SAFETY_REVIEW_REQUIRED') {
      answer='最近记录里出现了疼痛或明显不适。这里不继续做表现推断；训练数据的优先级低于身体不适本身。';
      focus='先处理不适与安全评估，再决定是否继续相关训练。';
      safetyNotice='如果疼痛持续、明显，或伴随射精疼痛、泌尿症状、近期性功能突然变化，应暂停相关训练并考虑专业评估。';
      return {answer,focus,evidence,uncertainty,safetyNotice};
    }
    if(/art|恢复|下降|回落/i.test(q)) {
      const r=c.recent, prev=c.previous;
      answer=`最近可用记录的平均 ART 约 ${fmtCoachNumber(r.meanArtSec,'s',0)}。${prev.count?`前一窗口约 ${fmtCoachNumber(prev.meanArtSec,'s',0)}。`:''} ART 反映 Stop 后回到可控水平所需时间，但会受压力、疲劳和记录密度影响。`;
      focus='看 3 次左右的小窗口趋势，而不是把某一次更快或更慢当成能力结论。';
    } else if(/身体|盆底|呼吸|信号|预警/i.test(q)) {
      if(c.signals?.length){const top=c.signals.map(x=>`${x.label}（${x.count} 次）`).join('、');answer=`最近记录到的高频预警信号是：${top}。这些只是你的训练记录关联，不代表生理因果。`;focus=`下一次优先观察“${c.signals[0].label}”是否在兴奋继续升高之前出现。`;}
      else {answer='目前还没有足够的身体信号记录形成个人模式。';focus='Recovery 或复盘时只记录最明显的一个信号即可，不需要为了数据而打断训练。';}
    } else if(/为什么|原因|依据|怎么判断/i.test(q)) {
      answer=`当前解释主要依据：${coachChatEvidenceText(report)||'可用样本数量和训练引擎当前状态'}。Coach 只描述个人训练窗口，不把相关性解释成因果。`;
      focus=o.focus;
    } else if(/下次|下一次|注意|关注|怎么做|练什么/i.test(q)) {
      answer=o.nextStep;
      focus=o.focus;
    } else if(/问题|哪里.*错|失败|退步|变差/i.test(q)) {
      answer=`从当前可用数据里，不适合把某一次训练定义成“失败”。${o.summary}`;
      focus='优先检查记录完整度、当天压力/疲劳，以及是否能完成 Stop → Recovery → Resume 的控制循环。';
    } else if(/提示|自主|外部提示/i.test(q)) {
      answer=`当前提示模式是“${PROMPT_MODES[settings.promptMode]||PROMPT_MODES.full}”。是否减少提示由你确认；Coach 不会自动切换，也不会修改训练阈值。`;
      focus=c.adaptive?.type==='REDUCE_PROMPTS_SUGGESTED'?'训练引擎近期认为控制较稳定，可以把“减少提示”作为可选尝试，而不是必须升级。':'继续使用当前提示强度，等控制循环更稳定后再考虑减少外部提示。';
    }
    return {answer,focus,evidence,uncertainty,safetyNotice};
  }
  function sanitizeCoachChatOutput(candidate={}) {
    const src=candidate?.output && typeof candidate.output==='object'?candidate.output:candidate;
    const out={};
    COACH_CHAT_ALLOWED_FIELDS.forEach(k=>{if(src?.[k]!==undefined)out[k]=structuredClone(src[k]);});
    out.answer=String(out.answer||'').slice(0,3000);
    out.focus=out.focus==null?'':String(out.focus).slice(0,1200);
    out.uncertainty=out.uncertainty==null?'':String(out.uncertainty).slice(0,1200);
    out.safetyNotice=out.safetyNotice==null?null:String(out.safetyNotice).slice(0,1200);
    if(!Array.isArray(out.evidence))out.evidence=[];
    out.evidence=out.evidence.slice(0,8).map(x=>({label:String(x?.label||'依据').slice(0,120),value:String(x?.value||'—').slice(0,240)}));
    return out;
  }
  function objectHasForbiddenCoachKey(value) {
    if(!value||typeof value!=='object')return false;
    for(const [k,v] of Object.entries(value)){
      if(COACH_FORBIDDEN_FIELDS.includes(k))return true;
      if(objectHasForbiddenCoachKey(v))return true;
    }
    return false;
  }
  function containsTrainingControlDirective(text='') {
    const t=String(text);
    return [
      /(?:stop|resume)\s*threshold\s*[:=]\s*[0-9]/i,
      /training\s*week\s*[:=]\s*[0-9]/i,
      /safety\s*flag\s*[:=]/i,
      /(?:停止|恢复|stop|resume).{0,12}阈值.{0,12}(?:改为|设为|调到|调整到)\s*[0-9]/i,
      /(?:把|将).{0,10}(?:停止|恢复).{0,8}阈值.{0,8}(?:改为|设为|调整到)\s*[0-9]/i
    ].some(re=>re.test(t));
  }
  function validateExternalCoachEndpoint(raw) {
    try {
      const u=new URL(String(raw||'').trim());
      if(u.protocol==='https:')return u.toString();
      if(u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))return u.toString();
    } catch(_) {}
    return null;
  }
  function bundledRelayEndpoint() {
    try {
      if(typeof location!=='undefined' && /^https?:$/.test(location.protocol)) return `${location.origin}/api/coach`;
    } catch(_) {}
    return null;
  }
  function bundledRelayHealthEndpoint() {
    try {
      if(typeof location!=='undefined' && /^https?:$/.test(location.protocol)) return `${location.origin}/api/coach/ready`;
    } catch(_) {}
    return null;
  }
  async function testBundledRelayHealth() {
    const endpoint=bundledRelayHealthEndpoint();
    if(!endpoint)throw new Error('当前页面不是通过 HTTP/HTTPS 打开。');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    try {
      const r=await fetch(endpoint,{cache:'no-store',headers:{'Accept':'application/json'},signal:controller.signal});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json();
      if(!data?.ok||data?.service!=='coach-relay')throw new Error('返回内容不是 Stop Action Coach Relay。');
      return data;
    } finally { clearTimeout(timer); }
  }
  function externalCoachConfigured() {
    return !!(settings.externalCoachEnabled && settings.externalCoachConsent && validateExternalCoachEndpoint(settings.externalCoachEndpoint));
  }
  function configureExternalCoachForTest(endpoint='https://relay.example.com/coach', token='test-token') {
    settings.externalCoachEnabled=true; settings.externalCoachConsent=true; settings.externalCoachEndpoint=endpoint; settings.externalCoachModel='test-model'; settings.coachChatMode='external'; externalCoachToken=token;
  }
  function coachChatRequest(question) {
    const turns=coachChatMessages.slice(-9,-1).map(m=>({role:m.role,text:String(m.text||'').slice(0,1600)}));
    return {
      schema:'coach-chat-request-v1',
      policy:{explainOnly:true,mayModifyTrainingEngine:false,rawEventsAllowed:false,medicalDiagnosisAllowed:false,trainingParameterAdviceAllowed:false},
      model:settings.externalCoachModel||null,
      context:buildCoachContext(),
      conversation:turns,
      message:String(question||'').slice(0,1600),
      responseFormat:{schema:'coach-chat-response-v1',allowedFields:COACH_CHAT_ALLOWED_FIELDS}
    };
  }
  async function callExternalCoach(question) {
    const endpoint=validateExternalCoachEndpoint(settings.externalCoachEndpoint);
    if(!externalCoachConfigured()||!endpoint)throw new Error('外部 Coach 尚未完成配置与授权。');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    const headers={'Content-Type':'application/json','Accept':'application/json'};
    if(externalCoachToken)headers.Authorization=`Bearer ${externalCoachToken}`;
    let response;
    try { response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(coachChatRequest(question)),signal:controller.signal}); }
    finally { clearTimeout(timer); }
    if(!response.ok)throw new Error(`Relay 返回 HTTP ${response.status}`);
    let data; try{data=await response.json();}catch(_){throw new Error('Relay 没有返回有效 JSON');}
    if(objectHasForbiddenCoachKey(data))throw new Error('外部回答包含禁止的训练控制字段，已拒绝显示。');
    const out=sanitizeCoachChatOutput(data);
    if(!out.answer)throw new Error('外部回答缺少 answer 字段。');
    const visible=[out.answer,out.focus,out.uncertainty,out.safetyNotice,...out.evidence.flatMap(e=>[e.label,e.value])].filter(Boolean).join('\n');
    if(containsTrainingControlDirective(visible))throw new Error('外部回答包含直接修改训练参数的指令，已拒绝显示。');
    return out;
  }
  async function persistCoachChat() {
    coachChatMessages=coachChatMessages.slice(-COACH_CHAT_MAX_MESSAGES);
    await DB.setMeta('coachChatMessages',coachChatMessages);
  }
  function coachMessageHtml(m) {
    const extra=[];
    if(m.focus)extra.push(`关注：${m.focus}`);
    if(m.uncertainty)extra.push(`不确定性：${m.uncertainty}`);
    if(m.safetyNotice)extra.push(`安全：${m.safetyNotice}`);
    const ev=(m.evidence||[]).map(e=>`${e.label}：${e.value}`);
    return `<div class="coach-msg ${m.role==='user'?'user':'assistant'}">${escapeHtml(m.text)}${extra.length?`<div class="small" style="margin-top:7px">${extra.map(escapeHtml).join('<br>')}</div>`:''}${ev.length?`<div class="external-evidence">${ev.map(x=>`<div>${escapeHtml(x)}</div>`).join('')}</div>`:''}<span class="msg-meta">${escapeHtml(m.role==='user'?'你':(m.mode==='external'?'外部 LLM':'本地 Coach'))}</span></div>`;
  }
  function coachChatHtml() {
    const messages=coachChatMessages.slice(-20);
    const externalReady=externalCoachConfigured();
    const mode=settings.coachChatMode==='external'?'external':'local';
    return `<div class="card"><div class="section-head"><h2>教练对话</h2><span class="muted">${mode==='external'?'外部 LLM':'本地规则'}</span></div><div class="coach-mode-row"><button class="choice ${mode==='local'?'selected':''}" data-coach-mode="local">本地 Coach</button><button class="choice ${mode==='external'?'selected':''}" data-coach-mode="external">外部 LLM</button><button class="ghost" id="clearCoachChat">清空对话</button></div><div class="adapter-state"><span><span class="status-dot ${externalReady?'on':''}"></span>${externalReady?'外部 Adapter 已授权':'外部 Adapter 未启用'}</span><span class="small">不写训练参数</span></div>${mode==='external'&&!externalReady?'<div class="adapter-warning">请先到“我的 → 外部 LLM Adapter”填写 HTTPS Relay，并明确勾选发送授权。</div>':''}<div class="coach-quick"><button class="ghost" data-coach-quick="这次哪里最值得关注？">这次关注什么</button><button class="ghost" data-coach-quick="为什么最近 ART 会波动？">解释 ART 波动</button><button class="ghost" data-coach-quick="我的身体预警信号怎么看？">身体信号</button><button class="ghost" data-coach-quick="下次训练我应该关注什么？">下次怎么练</button></div><div id="coachMessages" class="coach-messages">${messages.length?messages.map(coachMessageHtml).join(''):'<div class="empty-compact">可以直接问“为什么最近会波动？”、“下次关注什么？”；本地模式完全离线。</div>'}</div><div class="coach-compose"><textarea id="coachQuestion" class="text-input" maxlength="1600" placeholder="问一个关于你训练数据的问题…"></textarea><button id="sendCoachQuestion" class="primary">发送</button></div><div id="coachChatError" class="coach-error" style="display:none"></div></div>`;
  }
  async function sendCoachQuestion(question) {
    const q=String(question||'').trim(); if(!q)return;
    coachChatMessages.push({id:'M'+now()+Math.random().toString(36).slice(2,5),role:'user',text:q,at:now()});
    await persistCoachChat(); renderCoachPanel();
    try {
      const mode=settings.coachChatMode==='external'?'external':'local';
      const reply=mode==='external'?await callExternalCoach(q):sanitizeCoachChatOutput(localCoachChatReply(q));
      coachChatMessages.push({id:'M'+now()+Math.random().toString(36).slice(2,5),role:'assistant',mode,text:reply.answer,focus:reply.focus,evidence:reply.evidence,uncertainty:reply.uncertainty,safetyNotice:reply.safetyNotice,at:now()});
      await persistCoachChat(); renderCoachPanel();
    } catch(err) {
      const fallback=sanitizeCoachChatOutput(localCoachChatReply(q));
      coachChatMessages.push({id:'M'+now()+Math.random().toString(36).slice(2,5),role:'assistant',mode:'local',text:`外部 Coach 暂不可用：${String(err?.message||err)}\n\n已回退到本地解释：${fallback.answer}`,focus:fallback.focus,evidence:fallback.evidence,uncertainty:fallback.uncertainty,safetyNotice:fallback.safetyNotice,at:now()});
      await persistCoachChat(); renderCoachPanel();
    }
  }
  function liveCoach(options={}) {
    const context=buildCoachContext(sessionCache,options);
    const output=coachRuleEngine(context);
    return {context,output};
  }
  async function appendCoachHistory(context={}) {
    const duplicate=context.afterSessionId && coachHistory.some(x=>x.afterSessionId===context.afterSessionId && x.source===context.source);
    if(duplicate)return;
    const report=liveCoach();
    coachHistory.push({id:'C'+now()+Math.random().toString(36).slice(2,6),generatedAt:now(),source:context.source||'manual',afterSessionId:context.afterSessionId||null,context:report.context,output:report.output});
    coachHistory=coachHistory.slice(-50);
    await DB.setMeta('coachHistory',coachHistory);
  }
  function coachEvidenceHtml(output) {
    return (output.evidence||[]).map(e=>`<div class="detail-stat"><span class="muted">${escapeHtml(e.label)}</span><strong>${escapeHtml(e.value)}</strong></div>`).join('');
  }
  function renderCoachReport(report, compact=false) {
    const o=report.output;
    return `<div class="coach-kicker"><span class="coach-badge">本地 Coach · 不联网</span><span class="small">Explain only</span></div><h2>${escapeHtml(o.headline)}</h2><div class="coach-output">${escapeHtml(o.summary)}</div><div class="coach-focus"><strong>下一次关注</strong><div class="small" style="margin-top:5px">${escapeHtml(o.focus)}</div></div>${compact?'':`<div class="coach-focus"><strong>怎么做</strong><div class="small" style="margin-top:5px">${escapeHtml(o.nextStep)}</div></div><div class="coach-evidence">${coachEvidenceHtml(o)}</div><div class="reason"><strong>注意：</strong> ${escapeHtml(o.watch||'')}<br>${escapeHtml(o.uncertainty||'')}</div>${o.safetyNotice?`<div class="notice" style="display:block;margin-top:12px">${escapeHtml(o.safetyNotice)}</div>`:''}`}`;
  }
  function renderCoachPanel() {
    const body=$('#coachPanelBody');
    const report=liveCoach();
    const history=[...coachHistory].sort((a,b)=>(b.generatedAt||0)-(a.generatedAt||0)).slice(0,10);
    const external=externalCoachPayload(report.context);
    let simulated='';
    if(settings.developerMode && settings.includeSimulatedData && sessionCache.some(s=>s.simulated)) {
      const simReport=liveCoach({allowSimulated:true,onlySimulated:true,decision:adaptiveEngine(sessionCache.filter(s=>s.simulated),{allowSimulated:true})});
      simulated=`<details class="card"><summary>开发者：模拟 Coach 预览</summary><div style="margin-top:12px">${renderCoachReport(simReport,false)}</div></details>`;
    }
    body.innerHTML=`<div class="card coach-card">${renderCoachReport(report,false)}<div class="coach-actions"><button id="saveCoachReport" class="secondary">保存这次复盘</button><button id="copyCoachContext" class="ghost">复制 AI 上下文</button></div><details style="margin-top:12px"><summary class="small">查看最小化结构化上下文</summary><pre id="coachContextPreview" class="coach-context">${escapeHtml(JSON.stringify(external,null,2))}</pre></details></div>${coachChatHtml()}<div class="card"><h2>Coach 与 Training Engine 的边界</h2><p class="muted" style="line-height:1.6">Coach 只能解释训练数据与下一次关注点。无论本地还是外部模式，都没有权限修改 Stop / Resume 阈值、训练周次、Safety Flag 或日程；这些仍由确定性的 Training Engine 处理。</p></div>${simulated}<div class="section-head"><h2>教练复盘历史</h2><span class="muted">${coachHistory.length} 条</span></div>${history.length?`<div class="coach-history">${history.map(h=>`<div class="decision-item"><div class="small">${escapeHtml(formatDateTime(h.generatedAt))}</div><strong>${escapeHtml(h.output?.headline||'Coach 复盘')}</strong><div class="reason">${escapeHtml(h.output?.summary||'')}</div></div>`).join('')}</div>`:'<div class="card empty-compact">完成训练或点击“保存这次复盘”后，这里会保留本地 Coach 历史。</div>'}`;
    requestAnimationFrame(()=>{const box=document.querySelector('#coachMessages');if(box)box.scrollTop=box.scrollHeight;});
  }
  async function copyCoachContext() {
    const payload=JSON.stringify(externalCoachPayload(buildCoachContext()),null,2);
    try { if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(payload); else throw new Error('clipboard unavailable'); showToast('已复制最小化 AI 上下文'); }
    catch(_) { const ta=document.createElement('textarea');ta.value=payload;document.body.appendChild(ta);ta.select?.();try{document.execCommand?.('copy');showToast('已复制最小化 AI 上下文');}catch(__){showToast('当前浏览器无法自动复制');}ta.remove(); }
  }

  function defaultPlan() {
    return { version: 2, currentWeek: 0, weekStartedAt: startOfDay(new Date()).getTime(), createdAt: now(), schedule: [], scheduleWeekStart: null };
  }
  function sessionsInCurrentPlanWeek() {
    const key=weekStartKey(now());
    return sessionCache.filter(s=>!s.simulated&&!s.rehearsal&&s.review&&weekStartKey(sessionTimestamp(s))===key);
  }

  function weeklyProgress() {
    const sessions = sessionsInCurrentPlanWeek();
    const s = stage();
    return {
      stop: { done: sessions.filter(x => sessionHasCategory(x, 'stop')).length, target: s.sessions },
      mind: { done: sessions.filter(x => sessionHasCategory(x, 'mindfulness')).length, target: s.mindfulness },
      pelvic: { done: sessions.filter(x => sessionHasCategory(x, 'pelvic')).length, target: s.pelvic }
    };
  }
  function recommendedDates(target) {
    const offsets = target <= 2 ? [0, 3] : target === 3 ? [0, 2, 5] : [0, 2, 4, 6];
    return offsets.slice(0, target).map(offset => addDays(new Date(plan.weekStartedAt), offset));
  }
  async function ensureSchedule(force = false) {
    if (!plan.schedule) plan.schedule = [];
    const needs = force || plan.scheduleWeekStart !== plan.weekStartedAt || !plan.schedule.length;
    if (!needs) return;
    const dates = recommendedDates(stage().sessions);
    plan.schedule = dates.map((d, i) => ({
      id: `P${plan.currentWeek}-${i}-${plan.weekStartedAt}`,
      date: dateKey(d), programId: 'standard', status: 'PLANNED', createdAt: now()
    }));
    plan.scheduleWeekStart = plan.weekStartedAt;
    plan.deferredUntil = null;
    await DB.setMeta('plan', plan);
  }
  async function maybeAdvancePlan() {
    // Phase advancement is explicit in the long-term plan UI.
    Long.render();
  }
  function todayTask() { return Long.todayTask(); }

  function programSnapshot(program) {
    return {
      id: program.id, name: program.name, description: program.description || '',
      modules: program.modules.map(m => ({ ...m }))
    };
  }
  function newSession(program, scheduleItemId = null) {
    const stopThreshold = acceptedParameters.stopThreshold;
    const resumeThreshold = acceptedParameters.resumeThreshold;
    currentSession = {
      schemaVersion: 5, clockVersion:2, contentVersion:Content.version, guidanceSnapshot:structuredClone(Content.modules), id: 'S-' + crypto.randomUUID(), createdAt: now(), startedAt: null, endedAt: null,
      activeStartedAt: null, activeAccumulatedMs: 0, pausedAt: null, pausedFrom: null,
      phase: 'CHECK_IN', arousal: 2, cycleIndex: 0, cycles: [], currentCycle: null,
      events: [], revisions: [], review: null, checkin: null, overshootCount: 0,
      stopThreshold, resumeThreshold, targetCycles: 0, moduleIndex: 0, moduleResults: [],
      guidedState: null, stopStartBaseCycles: 0, scheduleItemId,
      promptModeSnapshot: settings.promptMode,
      planSnapshot: { week: plan.currentWeek, stageName: stage().name, adaptiveType: adaptiveDecision?.type || 'NONE' },
      programSnapshot: programSnapshot(program),
      modules: program.modules.map(moduleLabel)
    };
    persistCurrentSoon();
    updateReady();
  }

  function launchProgram(programId, scheduleItemId = null) {
    if(currentSession&&currentSession.phase!=='COMPLETED'){showToast('请先完成或结束当前训练');return;}
    moduleActionReadyAt=0;
    const task=Long.tasks().find(t=>t.id===scheduleItemId);
    const program = task?Long.taskProgram(task):programById(programId);
    pendingLaunch = { programId: program.id, scheduleItemId };
    newSession(program, scheduleItemId);
    if(task){currentSession.longPlanId=task.planId;const instance=Long.meta().longPlans.find(p=>p.id===task.planId);currentSession.guidanceSnapshot=structuredClone(instance?.templateSnapshot.contentSnapshot||Content.modules);currentSession.contentVersion=instance?.templateSnapshot.contentVersion||Content.version;currentSession.planSnapshot={week:task.weekIndex,stageName:Long.stage(task)?.name||stage().name,adaptiveType:adaptiveDecision?.type||'NONE'};}
    pain=false;$$('[data-pain]').forEach(b=>b.classList.toggle('selected',b.dataset.pain==='false'));$('#painNotice').style.display='none';
    ['difficulty','signals','awareness'].forEach(id=>$$(`#${id} .chip`).forEach(c=>c.classList.remove('selected')));$('#control').value=6;$('#controlV').textContent='6 / 10';$('#relax').value=5;$('#relaxV').textContent='5 / 10';
    persistCurrentSoon();
    recordBetaEvent('SESSION_LAUNCHED', { programType: programId === 'standard' ? 'standard' : (programId === 'mindfulness' ? 'mindfulness' : 'custom_or_other') });
    show('checkin');
  }

  function currentModule() { return currentSession?.programSnapshot?.modules?.[currentSession.moduleIndex] || null; }
  function startNextModule() {
    clearInterval(guidedTimer);
    closeQuickMarker();
    if (!currentSession) return;
    ensureActiveClock();
    requestWake();
    const module = currentModule();
    if (!module) { finishSession(); return; }
    const ex = EXERCISES[module.exerciseId];
    if (!ex) { currentSession.moduleIndex += 1; startNextModule(); return; }
    if (ex.type === 'stop_start') startStopStartModule(module);
    else startGuidedModule(module);
  }

  function renderModuleDots() {
    const wrap = $('#moduleDots');
    wrap.innerHTML = '';
    const total = currentSession?.programSnapshot?.modules?.length || 0;
    for (let i = 0; i < total; i++) {
      const d = document.createElement('span');
      d.className = 'dot';
      if (i < currentSession.moduleIndex) d.classList.add('done');
      else if (i === currentSession.moduleIndex) d.classList.add('current');
      wrap.appendChild(d);
    }
  }
  function startGuidedModule(module) {
    clearInterval(sessionTimer);
    const ex = EXERCISES[module.exerciseId];
    currentSession.phase = 'MODULE_ACTIVE';
    if (!currentSession.guidedState || currentSession.guidedState.exerciseId !== module.exerciseId) {
      if (ex.type === 'timed') {
        currentSession.guidedState = { exerciseId: module.exerciseId, type: 'timed', remainingSec: module.durationSec || ex.defaultValue * 60 };
      } else {
        currentSession.guidedState = {
          exerciseId: module.exerciseId, type: 'interval', round: 1, rounds: module.rounds || ex.defaultValue,
          intervalPhase: 'contract', phaseRemainingSec: 3
        };
      }
      event('MODULE_STARTED', { exerciseId: module.exerciseId, config: { ...module } });
    }
    show('moduleGuide');
    renderGuided();
    runGuidedTimer();
  }
  function renderGuided() {
    const module = currentModule();
    if (!module) return;
    const ex = EXERCISES[module.exerciseId];
    const guide=currentSession.guidanceSnapshot?.[module.exerciseId]||Content.modules[module.exerciseId];
    $('#guidedExplanation').textContent=guide.detail+' '+guide.limitation+' 来源：'+guide.sourceIds.map(key=>Content.sources[key].institution).join('、');
    const state = currentSession.guidedState;
    $('#guidedEyebrow').textContent = `${currentSession.moduleIndex + 1} / ${currentSession.programSnapshot.modules.length} · ${currentSession.programSnapshot.name}`;
    $('#guidedIcon').textContent = ex.icon;
    $('#guidedTitle').textContent = ex.name;
    $('#guidedStep').textContent = guide.short;
    if (state?.type === 'interval') {
      const contract = state.intervalPhase === 'contract';
      $('#guidedCount').textContent = fmt(Math.ceil(state.phaseRemainingSec || 0) * 1000);
      $('#guidedStep').textContent = contract ? '轻柔收缩，保持正常呼吸。不要同时夹紧腹部、臀部和大腿。' : '完全放松，观察盆底是否真正释放，不需要急着进入下一次收缩。';
      $('#guidedMeta').textContent = `第 ${state.round} / ${state.rounds} 轮 · ${contract ? '轻柔收缩 3 秒' : '完整放松 6 秒'}`;
    } else {
      $('#guidedCount').textContent = fmt(Math.ceil(state?.remainingSec || 0) * 1000);
      $('#guidedMeta').textContent = moduleLabel(module);
    }
    renderModuleDots();
  }
  function updateGuidedClock() {
    if(!currentSession?.guidedState||currentSession.pausedAt)return;
    const elapsed=activeElapsed(),delta=Math.max(0,elapsed-guideLastElapsed);guideLastElapsed=elapsed;
    const result=Core.guidedStep(currentSession.guidedState,delta);currentSession.guidedState=result.state;
    return result.done;
  }
  function runGuidedTimer() {
    clearInterval(guidedTimer);guideLastElapsed=activeElapsed();requestWake();
    guidedTimer=setInterval(()=>{
      if(!currentSession||currentSession.phase!=='MODULE_ACTIVE'||currentSession.pausedAt)return;
      if(updateGuidedClock()){completeCurrentModule('COMPLETED');return;}
      renderGuided();
    },250);
  }

  function completeCurrentModule(status = 'COMPLETED') {
    clearInterval(guidedTimer);
    const module = currentModule();
    if (!module) { finishSession(); return; }
    currentSession.moduleResults.push({ exerciseId: module.exerciseId, status, completedAt: now() });
    event(status === 'SKIPPED' ? 'MODULE_SKIPPED' : 'MODULE_COMPLETED', { exerciseId: module.exerciseId });
    currentSession.guidedState = null;
    currentSession.moduleIndex += 1;
    vibrate(24);
    startNextModule();
  }

  function startStopStartModule(module) {
    clearInterval(guidedTimer);
    currentSession.guidedState = null;
    currentSession.targetCycles = module.cycles || stage().cycles;
    currentSession.cycleIndex = 0;
    currentSession.currentCycle = null;
    currentSession.stopStartBaseCycles = currentSession.cycles.length;
    currentSession.phase = 'BUILD';
    currentSession.arousal = clamp(currentSession.arousal || 2, 0, 8);
    event('MODULE_STARTED', { exerciseId: 'stop_start', config: { ...module }, promptMode: settings.promptMode });
    show('session');
    renderSession();
    runSessionTimer();
  }
  function completeStopStartModule() {
    const completed = currentSession.cycles.length - (currentSession.stopStartBaseCycles || 0);
    currentSession.moduleResults.push({ exerciseId: 'stop_start', status: 'COMPLETED', cycles: completed, completedAt: now() });
    event('MODULE_COMPLETED', { exerciseId: 'stop_start', cycles: completed });
    currentSession.moduleIndex += 1;
    currentSession.currentCycle = null;
    currentSession.cycleIndex = 0;
    $('#finishSheet').classList.remove('show');
    startNextModule();
  }
  function runSessionTimer() {
    clearInterval(sessionTimer);
    sessionTimer = setInterval(() => {
      if (!currentSession) return;
      $('#activeTime').textContent = fmt(activeElapsed());
      if (currentSession.currentCycle && currentSession.phase === 'RECOVERY') $('#recoveryTime').textContent = fmt(activeElapsed() - (currentSession.currentCycle.stopActiveElapsedMs ?? activeElapsed()));
      else $('#recoveryTime').textContent = '';
    }, 250);
  }
  function setPhase(phase) {
    currentSession.phase = phase;
    event('PHASE_CHANGED', { phase });
    renderSession();
  }
  function moduleCycleCount() { return currentSession.cycles.length - (currentSession.stopStartBaseCycles || 0); }
  function renderCycles() {
    const wrap = $('#cycleDots');
    wrap.innerHTML = '';
    const target = currentSession.targetCycles || 3;
    const completed = moduleCycleCount();
    const current = completed;
    const dotCount = Math.max(target, current + 1);
    for (let i = 0; i < dotCount; i++) {
      const d = document.createElement('span');
      d.className = 'dot';
      if (i < completed) d.classList.add('done');
      else if (i === current) d.classList.add('current');
      wrap.appendChild(d);
    }
  }
  function renderSession() {
    if (!currentSession) return;
    const phase = currentSession.phase;
    const mode = settings.promptMode || 'full';
    $('#explicitStop').disabled=currentSession.pausedAt||!['BUILD','CONTROL_ZONE','STOP_SUGGESTED'].includes(phase);
    $('#explicitResume').disabled=currentSession.pausedAt||phase!=='RESUME_AVAILABLE';
    $('#explicitMarker').disabled=currentSession.pausedAt||phase!=='RECOVERY';
    const shell = $('#sessionShell');
    shell.className = 'session-shell';
    $('#arousal').textContent = currentSession.arousal;
    const target = currentSession.targetCycles || 3;
    const completed = moduleCycleCount();
    $('#phaseSub').textContent = completed < target ? `Cycle ${completed + 1} / ${target}` : `额外 Cycle ${completed + 1}`;
    $('#recoveryTime').textContent = '';
    $('#pulse').style.display = 'none';
    let label = mode === 'autonomous' ? '自主练习' : '兴奋建立';
    let hint = mode === 'autonomous' ? '根据自己的身体信号决定何时 Stop' : '↑ 上滑增加 · ↓ 下滑降低';
    let g = mode === 'autonomous' ? '单击屏幕开始 Recovery' : `Stop 阈值 ${currentSession.stopThreshold}`;
    if (phase === 'CONTROL_ZONE') {
      label = mode === 'full' ? '注意区' : '训练中';
      hint = mode === 'full' ? '注意呼吸、腹部和盆底' : '继续观察身体变化';
      g = mode === 'full' ? '保持动作可控' : '关键节点通过反馈提示';
    }
    if (phase === 'STOP_SUGGESTED') { label = '停止'; hint = mode === 'haptic' ? '已到当前训练阈值' : '停止当前刺激'; g = '单击屏幕确认'; shell.classList.add('stage-stop'); }
    if (phase === 'RECOVERY') { label = '恢复中'; hint = '自然呼吸 · 放松 · 观察'; g = '↓ 记录下降 · ← 记录身体信号'; shell.classList.add('stage-recovery'); }
    if (phase === 'RESUME_AVAILABLE') { label = '已恢复'; hint = '准备好后继续'; g = '双击屏幕'; shell.classList.add('stage-recovery'); }
    if (phase === 'COMPLETE_READY') { label = '本模块目标已完成'; hint = `已完成 ${completed} 个控制循环`; g = '建议进入下一模块；也可以再进行一轮'; }
    $('#phaseLabel').textContent = label;
    $('#sessionHint').textContent = hint;
    $('#gestureHint').textContent = settings.gestures?g:'使用下方按钮；等级是个人感受，随时可以暂停。';
    renderCycles();
  }
  function changeArousal(delta) {
    if (!currentSession || currentSession.pausedAt || !['BUILD','CONTROL_ZONE','STOP_SUGGESTED','RECOVERY','RESUME_AVAILABLE','COMPLETE_READY'].includes(currentSession.phase)) return;
    const previous = currentSession.arousal;
    let next = clamp(previous + delta, 0, 9);
    if (next === 9 && previous === 8 && !confirm('确认记录为 9？这会结束本次训练并进入复盘。')) return;
    if (next === previous) return;
    if (currentSession.phase === 'COMPLETE_READY') { currentSession.phase = 'BUILD'; $('#finishSheet').classList.remove('show'); }
    currentSession.arousal = next;
    recordBetaEvent(delta > 0 ? 'SWIPE_LEVEL_UP' : 'SWIPE_LEVEL_DOWN', { phase: currentSession.phase });
    event('AROUSAL_LEVEL_CHANGED', { arousal: next });
    const mode = settings.promptMode || 'full';
    if (next === 8) {
      currentSession.overshootCount += 1;
      event('OVERSHOOT');
      if (mode !== 'autonomous') vibrate([70,60,70]); else vibrate(18);
    } else vibrate(18);
    if (next === 9) { event('EJACULATION_EVENT'); finishSession(); return; }

    const stopThreshold = currentSession.stopThreshold || DEFAULT_STOP_THRESHOLD;
    const warningThreshold = Math.max(1, stopThreshold - 1);
    const resumeThreshold = currentSession.resumeThreshold || DEFAULT_RESUME_THRESHOLD;

    if (currentSession.phase === 'BUILD' || currentSession.phase === 'CONTROL_ZONE') {
      if (mode === 'autonomous') {
        if (currentSession.phase !== 'BUILD') currentSession.phase = 'BUILD';
      } else if (next >= stopThreshold) {
        setPhase('STOP_SUGGESTED');
        event('STOP_SUGGESTED');
        vibrate([100,70,100]);
      } else if (next >= warningThreshold) {
        if (mode === 'full') setPhase('CONTROL_ZONE');
        else if (mode === 'haptic' && next === warningThreshold) vibrate([30,45,30]);
      } else if (currentSession.phase !== 'BUILD') setPhase('BUILD');
    } else if (currentSession.phase === 'STOP_SUGGESTED' && next < stopThreshold) {
      if (mode === 'full' && next >= warningThreshold) setPhase('CONTROL_ZONE'); else setPhase('BUILD');
    } else if (currentSession.phase === 'RESUME_AVAILABLE') {
      if (next > resumeThreshold) setPhase('RECOVERY');
    } else if (currentSession.phase === 'RECOVERY' && next <= resumeThreshold) {
      if (currentSession.currentCycle && !currentSession.currentCycle.recoveryReachedAt) {
        currentSession.currentCycle.recoveryReachedAt = now();
        currentSession.currentCycle.artMs = activeElapsed() - currentSession.currentCycle.stopActiveElapsedMs;
        event('RECOVERY_TARGET_REACHED', { artMs: currentSession.currentCycle.artMs });
      }
      setPhase('RESUME_AVAILABLE');
      vibrate([45,50,45,50,120]);
    }
    renderSession();
  }
  function confirmStop(manual = false) {
    const phase = currentSession?.phase;
    const autonomousAllowed = manual && ['BUILD','CONTROL_ZONE'].includes(phase);
    if(currentSession?.pausedAt)return;
    if (phase !== 'STOP_SUGGESTED' && !autonomousAllowed) return;
    currentSession.currentCycle = {
      id: 'C' + (currentSession.cycles.length + 1), stopStartedAt: now(), stopActiveElapsedMs:activeElapsed(), stopLevel: currentSession.arousal,
      peakLevel: currentSession.arousal, recoveryReachedAt: null, artMs: null, signals: [], manual
    };
    recordBetaEvent('STOP_CONFIRMED', { manual, phase });
    event('STOP_STARTED', { manual, stopLevel: currentSession.arousal });
    setPhase('RECOVERY');
  }
  function resumeCycle() {
    if (currentSession?.phase !== 'RESUME_AVAILABLE'||currentSession.pausedAt) return;
    const c = currentSession.currentCycle;
    c.resumedAt = now(); c.resumeLevel = currentSession.arousal; c.successful = true;
    currentSession.cycles.push(c);
    recordBetaEvent('RESUME_CONFIRMED', { manualStop: !!c.manual });
    event('CYCLE_COMPLETED', { artMs: c.artMs, signals: c.signals || [], stopLevel: c.stopLevel, manual: c.manual });
    currentSession.currentCycle = null;
    currentSession.cycleIndex += 1;
    if (moduleCycleCount() >= currentSession.targetCycles) {
      setPhase('COMPLETE_READY');
      setTimeout(() => openFinishSheet('module'), 260);
    } else setPhase('BUILD');
    vibrate(24);
  }
  function openQuickMarker() {
    if (currentSession?.phase !== 'RECOVERY'||currentSession.pausedAt) return;
    const sheet = $('#quickMarkerSheet');
    recordBetaEvent('QUICK_MARKER_OPENED', { phase: currentSession.phase });
    sheet.classList.add('show'); sheet.setAttribute('aria-hidden','false'); vibrate(20);
    sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-label','记录身体信号');sheet.querySelector('button')?.focus?.();
  }
  function closeQuickMarker() {
    const sheet = $('#quickMarkerSheet');
    sheet.classList.remove('show'); sheet.setAttribute('aria-hidden','true');
    if(document.activeElement&&sheet.contains?.(document.activeElement))$('#explicitMarker').focus?.();
  }
  function recordQuickSignal(signal, label) {
    if (!currentSession?.currentCycle) return;
    currentSession.currentCycle.signals = currentSession.currentCycle.signals || [];
    if (currentSession.currentCycle.signals.includes(signal)) { closeQuickMarker(); showToast(`本轮已记录：${label}`); return; }
    currentSession.currentCycle.signals.push(signal);
    recordBetaEvent('QUICK_MARKER_SAVED');
    event('BODY_SIGNAL_RECORDED', { signal, label });
    closeQuickMarker(); showToast(`已记录：${label}`); vibrate([18,35,18]);
  }

  function openFinishSheet(mode = 'early') {
    const sheet = $('#finishSheet');
    sheet.dataset.mode = mode;
    if (mode === 'module') {
      $('#finishNow').textContent = '完成本模块';
      $('#cancelFinish').textContent = '再进行一轮';
    } else {
      $('#finishNow').textContent = '结束整个训练';
      $('#cancelFinish').textContent = '继续训练';
    }
    sheet.classList.add('show');
    sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-label','结束训练');sheet.querySelector('button')?.focus?.();
  }
  function finishPrimaryAction() {
    const mode = $('#finishSheet').dataset.mode;
    if (mode === 'module') completeStopStartModule(); else finishSession();
  }
  function cancelFinishAction() {
    const mode = $('#finishSheet').dataset.mode;
    $('#finishSheet').classList.remove('show');
    if (mode === 'module' && currentSession?.phase === 'COMPLETE_READY') setPhase('BUILD');
  }

  function pauseSession() {
    if (!currentSession||currentSession.pausedAt||['CHECK_IN','REVIEW','COMPLETED'].includes(currentSession.phase)) return;
    updateGuidedClock();
    clearTimeout(longPressTimer);touchStart=null;closeQuickMarker();
    $('#finishSheet').classList.remove('show');
    clearInterval(guidedTimer);
    stopActiveClock();
    releaseWake();
    currentSession.pausedAt = now();
    currentSession.pausedFrom = currentSession.phase;
    recordBetaEvent('SESSION_PAUSED', { from: currentSession.pausedFrom });
    event('SESSION_PAUSED', { from: currentSession.pausedFrom });
    $('#pauseTime').textContent = fmt(activeElapsed());
    show('pause');
    persistCurrentSoon();
  }
  function resumePaused() {
    if (!currentSession) return;
    currentSession.pausedAt = null;
    currentSession.activeStartedAt = now();
    requestWake();
    recordBetaEvent('SESSION_RESUMED', { to: currentSession.phase });
    event('SESSION_RESUMED', { to: currentSession.phase });
    if(currentSession.phase==='CHECK_IN'){currentSession.activeStartedAt=null;show('checkin');return;} if (currentSession.phase === 'MODULE_ACTIVE') { show('moduleGuide'); renderGuided(); runGuidedTimer(); }
    else { show('session'); renderSession(); runSessionTimer(); }
  }
  function finishSession() {
    if (!currentSession||currentSession.phase==='COMPLETED'||currentSession.phase==='REVIEW') return;
    updateGuidedClock();clearInterval(guidedTimer); clearInterval(sessionTimer); closeQuickMarker();
    stopActiveClock();
    releaseWake();
    currentSession.endedAt = now();
    recordBetaEvent('SESSION_FINISHED', { phase: currentSession.phase, cycles: currentSession.cycles.length });
    event('SESSION_ENDED');
    currentSession.phase = 'REVIEW';
    persistCurrentSoon();
    prefillReviewSignal(); configureReview(); show('review');
  }

  function configureReview() {
    const hasStop = hasExercise(currentSession, 'stop_start');
    $('#reviewControlTitle').textContent = hasStop ? '今天整体控制感' : '今天整体训练状态';
    $('#relaxReviewGroup').style.display = hasStop ? 'block' : 'none';
    $('#awarenessReviewGroup').style.display = hasStop ? 'block' : 'none';
  }
  function reviewSelection(groupId) {
    const selected = $(`#${groupId} .chip.selected`);
    return selected ? selected.textContent.trim() : null;
  }
  function prefillReviewSignal() {
    if (!currentSession) return;
    const quick = (currentSession.events || []).filter(e => e.type === 'BODY_SIGNAL_RECORDED');
    if (!quick.length) return;
    const counts = {};
    quick.forEach(e => { if (e.label) counts[e.label] = (counts[e.label] || 0) + 1; });
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0];
    if (!top) return;
    const map = { '呼吸加快':'呼吸','屏住呼吸':'呼吸','盆底紧张':'盆底','腹部收紧':'腹部','大腿用力':'大腿','臀部用力':'臀部','紧张/焦虑':'紧张/焦虑' };
    const target = map[top] || top;
    $$('#signals .chip').forEach(c => c.classList.toggle('selected', c.textContent.trim() === target));
  }
  async function saveReview() {
    if(!currentSession||saveInFlight||currentSession.phase==='COMPLETED')return;
    saveInFlight=true;$('#saveReview').disabled=true;
    const before=structuredClone(Long.meta());
    try{
      const hasStop=hasExercise(currentSession,'stop_start');
      currentSession.review={control:+$('#control').value,relax:hasStop?+$('#relax').value:null,difficulty:reviewSelection('difficulty'),signal:reviewSelection('signals'),awareness:hasStop?reviewSelection('awareness'):null};
      event('REVIEW_COMPLETED',currentSession.review);await persistCurrentSoon();
      const completed=structuredClone(currentSession);completed.phase='COMPLETED';
      if(completed.scheduleItemId)Long.markCompleted(completed.scheduleItemId,completed.id);
      await DB.completeSession(completed,Long.meta());
      currentSession=completed;sessionCache=sessionCache.filter(s=>s.id!==completed.id);sessionCache.push(completed);sessionCache.sort((a,b)=>sessionTimestamp(a)-sessionTimestamp(b));
      $('#saveStatus').textContent='训练已保存';
      adaptiveDecision=adaptiveEngine(sessionCache);
      try{await DB.setMeta('adaptiveDecision',adaptiveDecision);await appendAdaptiveHistory(adaptiveDecision,{source:'session-review',afterSessionId:completed.id});await appendCoachHistory({source:'session-review',afterSessionId:completed.id});}catch{showToast('训练已保存，附加复盘暂未写入');}
      renderSummary();show('summary');Long.render();updateReady();
    }catch(error){Long.hydrate(before);$('#saveStatus').textContent='保存失败 · 请重试或导出';showToast('未完成保存，请重试；当前记录仍在。');}
    finally{saveInFlight=false;$('#saveReview').disabled=false;}
  }

  function renderSummary() {
    const m = computeMetrics(currentSession);
    $('#summaryProgram').textContent = currentSession.programSnapshot?.name || '训练';
    $('#sumCycles').textContent = m.cycles || '—';
    $('#sumArt').textContent = m.meanART ? Math.round(m.meanART / 1000) + 's' : '—';
    $('#sumOvershoot').textContent = hasExercise(currentSession,'stop_start') ? m.overshoot : '—';
    $('#sumControl').textContent = m.control != null ? m.control + '/10' : '—';
    drawChart(currentSession);
    $('#summaryCoachCard').innerHTML=renderCoachReport(liveCoach(),true);
    if ($('#betaFeedbackCard')) $('#betaFeedbackCard').style.display = settings.betaTelemetryEnabled ? 'block' : 'none';
    const target=$('#associateTask');
    if(target){target.innerHTML='<option value="">保持自由训练记录</option>'+Long.tasks().filter(t=>t.status==='PLANNED'&&t.instance.status==='ACTIVE').map(t=>`<option value="${escapeHtml(t.id)}">${t.date} · ${escapeHtml(t.programSnapshot.name)}</option>`).join('');$('#associateCard').hidden=!!currentSession.scheduleItemId;}
  }
  function drawChart(s) {
    const svg = $('#chart');
    const pts = (s.events || []).filter(e => e.type === 'AROUSAL_LEVEL_CHANGED' || e.type === 'MODULE_STARTED' && e.exerciseId === 'stop_start');
    if (!pts.length) { svg.innerHTML = '<text x="20" y="110" fill="#7f8a98">本次没有兴奋曲线数据</text>'; return; }
    const maxX = Math.max(...pts.map(p => p.elapsedMs), 1);
    const w=480,h=220,pad=20;
    const coords = pts.map(p => [pad + (p.elapsedMs/maxX)*(w-pad*2), h-pad-(Number(p.arousal||0)/9)*(h-pad*2)]);
    const d = coords.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
    let grid='';
    for (let lvl=0;lvl<=9;lvl+=3) {
      const y=h-pad-(lvl/9)*(h-pad*2);
      grid += `<line x1="${pad}" y1="${y}" x2="${w-pad}" y2="${y}" stroke="#252b34" stroke-width="1"/><text x="2" y="${y+4}" fill="#74808d" font-size="11">${lvl}</text>`;
    }
    const stops=(s.events||[]).filter(e=>e.type==='STOP_STARTED').map(e=>{const x=pad+(e.elapsedMs/maxX)*(w-pad*2);return `<line x1="${x}" y1="${pad}" x2="${x}" y2="${h-pad}" stroke="#586473" stroke-width="1" stroke-dasharray="4 5"/>`;}).join('');
    svg.innerHTML = grid + stops + `<path d="${d}" fill="none" stroke="#edf2f7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  function setProgress(id, barId, item) {
    const target = Math.max(1,item.target);
    $(id).textContent = `${Math.min(item.done,item.target)}/${item.target}`;
    $(barId).style.width = `${Math.min(100,(item.done/target)*100)}%`;
  }
  function refreshDashboard() {
    const s=stage(), p=weeklyProgress(), task=todayTask();
    const program = task ? Long.taskProgram(task) : programById('standard');
    $('#dashboardStage').textContent = `${Long.active()?'主计划':'自由训练'} · ${s.name}`;
    $('#todayTitle').textContent = task ? program.name : `${program.name} · 灵活训练`;
    $('#todayFocus').textContent = `今天重点：${s.focus}`;
    const minutes = program.modules.reduce((sum,m)=>sum+(m.durationSec||0)/60+(m.exerciseId==='stop_start'?(m.cycles||s.cycles)*3:0)+(m.exerciseId==='pelvic_coordination'?(m.rounds||5)*0.15:0),0);
    $('#todayDuration').textContent = `约 ${Math.max(5,Math.round(minutes))} 分钟`;
    $('#todayModules').innerHTML = program.modules.map(m=>`<span class="pill">${escapeHtml(moduleLabel(m))}</span>`).join('');
    $('#startTraining').dataset.programId = program.id;
    $('#startTraining').dataset.scheduleId = task?.id || '';
    $('#startTraining').textContent = task ? '开始今日训练' : '开始灵活训练';
    setProgress('#weekStop','#weekStopBar',p.stop); setProgress('#weekMind','#weekMindBar',p.mind); setProgress('#weekPelvic','#weekPelvicBar',p.pelvic);
    if (!sessionCache.length) { $('#dashArt').textContent='暂无'; $('#dashTrend').textContent='完成一次动停训练后生成'; }
    else {
      const recent=sessionCache.filter(x=>!x.simulated&&hasExercise(x,'stop_start')&&dataQuality(x).usableForTrend).slice(-3).map(computeMetrics).filter(m=>m.meanART);
      if (recent.length) { $('#dashArt').textContent=Math.round(recent.at(-1).meanART/1000)+'s'; $('#dashTrend').textContent=recent.length>1?recent.map(m=>Math.round(m.meanART/1000)+'s').join(' → '):'已建立第一条记录'; }
      else { $('#dashArt').textContent='—'; $('#dashTrend').textContent='尚无动停恢复数据'; }
    }
    const todayExists = !!task;
    $('#deferToday').style.display = todayExists ? 'block' : 'none';
    $('#restoreSchedule').style.visibility = 'visible';
    renderAdaptiveCard();
  }
  function renderAdaptiveCard() {
    const d=adaptiveDecision||adaptiveEngine(sessionCache);
    const applied=`当前已确认阈值 ${acceptedParameters.stopThreshold} / ${acceptedParameters.resumeThreshold}；确认后才用于未来训练`;
    let action='';
    if (d.type==='REDUCE_PROMPTS_SUGGESTED' && settings.promptMode==='full') action='<button id="adaptiveReducePrompt" class="secondary" style="margin-top:12px">由我确认：减少提示</button>';
    if(d.type==='LOWER_STOP_THRESHOLD'&&(d.stopThreshold!==acceptedParameters.stopThreshold||d.resumeThreshold!==acceptedParameters.resumeThreshold))action+='<button id="confirmParameters" class="secondary">确认参数建议</button>';
    const last=parameterHistory.filter(row=>row.kind==='APPLY'&&!row.reversed).at(-1);
    if(last)action+='<button id="revertParameters" class="ghost">撤回最近参数调整</button>';
    $('#adaptiveCard').innerHTML=`<div class="eyebrow">${escapeHtml(d.type.replaceAll('_',' '))}</div><strong>${escapeHtml(d.title)}</strong><div class="muted">${applied}</div><div class="reason">${escapeHtml(d.reason)}</div>${action}`;
    document.getElementById('adaptiveReducePrompt')?.addEventListener('click', async()=>{ settings.promptMode='threshold'; await DB.setMeta('settings',settings); renderAdaptiveCard(); showToast('已切换为“仅阈值”提示'); });
    document.getElementById('confirmParameters')?.addEventListener('click',async()=>{
      if(!confirm(`只影响未来训练：${acceptedParameters.stopThreshold}/${acceptedParameters.resumeThreshold} → ${d.stopThreshold}/${d.resumeThreshold}\n${d.reason}`))return;
      const next={stopThreshold:d.stopThreshold,resumeThreshold:d.resumeThreshold},history=[...parameterHistory,{id:crypto.randomUUID(),kind:'APPLY',oldValue:{...acceptedParameters},newValue:next,reason:d.reason,at:now()}];
      try{await DB.importData([],{acceptedParameters:next,parameterHistory:history});acceptedParameters=next;parameterHistory=history;renderAdaptiveCard();}catch{showToast('参数未保存，请重试');}
    });
    document.getElementById('revertParameters')?.addEventListener('click',async()=>{
      const history=structuredClone(parameterHistory),record=history.find(row=>row.id===last.id);record.reversed=true;
      history.push({kind:'REVERT',targetId:record.id,oldValue:{...acceptedParameters},newValue:record.oldValue,at:now(),reason:'用户撤回，仅影响未来训练'});
      try{await DB.importData([],{acceptedParameters:record.oldValue,parameterHistory:history});acceptedParameters=record.oldValue;parameterHistory=history;renderAdaptiveCard();}catch{showToast('撤回未保存，请重试');}
    });
  }

  function renderPlan() {
    const s=stage();
    $('#planStage').textContent=`${Long.active()?'主计划':'自由安排'} · ${s.name}`;
    $('#stageTitle').textContent=`这一阶段：${s.name}`; $('#stageDescription').textContent=s.focus;
    $('#planEngineNote').innerHTML='<span>◌</span><span>训练内容已经拆成独立 Exercise。日历只负责“哪天做哪个方案”；你可以拖动 ≡ 到其他日期，也可以把自定义方案安排到任意日期。</span>';
    renderScheduleCalendar(); Long.render(); renderPrograms(); renderBuilder();
  }
  function renderScheduleCalendar() { Long.renderCalendar(); }

  function programCard(program) {
    const modules=program.modules.map(m=>`<span class="pill">${escapeHtml(moduleLabel(m))}</span>`).join('');
    return `<div class="program-card"><div class="program-head"><div><strong>${escapeHtml(program.name)}</strong><div class="small" style="margin-top:4px">${escapeHtml(program.description||'自定义组合')}</div></div>${program.builtin?'<span class="schedule-badge">内置</span>':'<span class="schedule-badge">自定义</span>'}</div><div class="modules">${modules}</div><div class="program-actions"><button class="secondary" data-start-program="${escapeHtml(program.id)}">立即开始</button><button class="ghost" data-schedule-program="${escapeHtml(program.id)}">安排日期</button>${program.builtin?'':`<button class="ghost" data-delete-program="${escapeHtml(program.id)}">删除</button>`}</div></div>`;
  }
  function renderPrograms() {
    $('#programList').innerHTML=allPrograms().map(programCard).join('');
  }
  function resetBuilderState() {
    builderState=[
      {exerciseId:'breathing',selected:true,value:3},
      {exerciseId:'mindfulness_body_scan',selected:false,value:5},
      {exerciseId:'pelvic_coordination',selected:false,value:5},
      {exerciseId:'stop_start',selected:true,value:stage().cycles},
      {exerciseId:'pelvic_release',selected:true,value:2}
    ];
  }
  function renderBuilder() {
    if (!builderState.length) resetBuilderState();
    $('#builderModules').innerHTML=builderState.map((row,i)=>{const ex=EXERCISES[row.exerciseId];return `<div class="builder-row" data-builder-id="${ex.id}"><input type="checkbox" data-builder-check="${ex.id}" ${row.selected?'checked':''}><div><strong>${escapeHtml(ex.name)}</strong><div class="small">${escapeHtml(ex.instruction)}</div></div><div><input type="number" min="1" max="30" value="${row.value}" data-builder-value="${ex.id}" aria-label="${escapeHtml(ex.name)} 数量"><div class="small" style="text-align:center;margin-top:3px">${ex.unit}</div></div><div class="builder-order"><button data-builder-move="up" data-index="${i}">↑</button><button data-builder-move="down" data-index="${i}">↓</button></div></div>`;}).join('');
  }
  async function saveCustomProgram() {
    const name=$('#customProgramName').value.trim()||'我的训练';
    const modules=builderState.filter(x=>x.selected).map(row=>{
      const ex=EXERCISES[row.exerciseId], value=clamp(Number(row.value)||ex.defaultValue,1,30);
      if(ex.type==='timed') return {exerciseId:ex.id,durationSec:value*60};
      if(ex.type==='interval') return {exerciseId:ex.id,rounds:value};
      return {exerciseId:ex.id,cycles:value};
    });
    if(!modules.length){showToast('至少选择一个训练模块');return;}
    customPrograms.push({id:'custom-'+now(),name,description:'自定义训练方案',builtin:false,createdAt:now(),modules});
    await DB.setMeta('customPrograms',customPrograms);
    renderPrograms(); showToast('已保存自定义方案');
  }
  async function scheduleProgram(programId) {
    const date=prompt('安排日期（YYYY-MM-DD，可跨月）',dateKey());
    if(!date)return;
    try{await Long.addTask(programById(programId),date);showToast('已加入日历');}catch(error){showToast(error.message);}
  }

  async function deleteProgram(id) {
    customPrograms=customPrograms.filter(p=>p.id!==id);
    plan.schedule=(plan.schedule||[]).filter(x=>x.programId!==id || x.status==='COMPLETED');
    await DB.setMeta('customPrograms',customPrograms); await DB.setMeta('plan',plan); renderPlan(); refreshDashboard(); showToast('已删除方案');
  }
  function bindScheduleDrag() {
    $$('.drag-handle').forEach(handle=>handle.addEventListener('pointerdown',e=>{
      e.preventDefault(); const id=handle.dataset.dragId, task=(plan.schedule||[]).find(x=>x.id===id); if(!task)return;
      const ghost=document.createElement('div'); ghost.className='drag-ghost'; ghost.textContent=programById(task.programId).name; document.body.appendChild(ghost);
      dragState={id,ghost,targetDate:null}; moveDragGhost(e.clientX,e.clientY); handle.setPointerCapture?.(e.pointerId);
    }));
  }
  function moveDragGhost(x,y){ if(!dragState)return; dragState.ghost.style.left=(x+12)+'px';dragState.ghost.style.top=(y+12)+'px'; $$('.calendar-day').forEach(x=>x.classList.remove('drop-target')); const el=document.elementFromPoint(x,y)?.closest?.('.calendar-day'); if(el){dragState.targetDate=el.dataset.date;el.classList.add('drop-target');} }
  async function endDrag(){ if(!dragState)return; const {id,ghost,targetDate}=dragState; ghost.remove(); $$('.calendar-day').forEach(x=>x.classList.remove('drop-target')); dragState=null; if(!targetDate)return; const item=(plan.schedule||[]).find(x=>x.id===id); if(item&&item.date!==targetDate){item.date=targetDate;item.movedAt=now();await DB.setMeta('plan',plan);renderPlan();refreshDashboard();showToast(`已移动到 ${targetDate.slice(5)}`);} }

  function setInsightTab(tab) {
    activeInsightTab=tab;
    $$('#insightTabs .insight-tab').forEach(b=>b.classList.toggle('active',b.dataset.insightTab===tab));
    const map={trends:'trendPanel',coach:'coachPanel',history:'historyPanel',compare:'comparePanel',decisions:'decisionsPanel',quality:'qualityPanel'};
    Object.entries(map).forEach(([k,id])=>$('#'+id).classList.toggle('active',k===tab));
  }
  function renderTrendPanel() {
    const body=$('#trendPanelBody');
    const visible=analysisSessions();
    if(!visible.length){body.innerHTML='<div class="card empty">完成训练后，这里会出现 ART、Stop Level、Overshoot 和控制感的周趋势。</div>';return;}
    const stopVisible=visible.filter(s=>s.endedAt&&hasExercise(s,'stop_start'));
    const usableCount=stopVisible.filter(s=>dataQuality(s).usableForTrend).length;
    const excludedCount=stopVisible.length-usableCount;
    const weeks=weeklySeries();
    const latest=weeks.at(-1)||{};
    body.innerHTML=`
      <div class="card"><div class="section-head"><h2>趋势数据质量</h2><span class="muted">${usableCount}/${stopVisible.length||0} 可用</span></div><p class="small">低质量 Session 不进入周趋势和真实 Adaptive Decision。${excludedCount?`当前排除 ${excludedCount} 条。`: '当前没有因质量问题被排除的动停记录。'}</p></div>
      <div class="card"><div class="trend-meta"><div><div class="eyebrow">所选时间段</div><h2>恢复记录 · ART</h2></div><div class="metric-big">${Number.isFinite(latest.art)?Math.round(latest.art)+'s':'—'}</div></div><svg id="trendArtChart" viewBox="0 0 480 180" preserveAspectRatio="none"></svg><div class="small">按每周平均值展示。ART是应用内主观恢复记录，不追求更短，也不单独说明训练效果。</div></div>
      <div class="card"><div class="trend-meta"><div><div class="eyebrow">实际 Stop</div><h2>平均 Stop Level</h2></div><div class="metric-big">${Number.isFinite(latest.stop)?latest.stop.toFixed(1):'—'}</div></div><svg id="trendStopChart" viewBox="0 0 480 180" preserveAspectRatio="none"></svg><div class="small">记录实际停止时的主观等级；自主模式尤其适合观察这个趋势。</div></div>
      <div class="card"><div class="trend-meta"><div><div class="eyebrow">稳定性</div><h2>Level 8 · Overshoot</h2></div><div class="metric-big">${Number.isFinite(latest.overshoot)?Math.round(latest.overshoot)+'%':'—'}</div></div><svg id="trendOvershootChart" viewBox="0 0 480 180" preserveAspectRatio="none"></svg><div class="small">按进入 STOP 的循环计算，只和自己的近期状态比较。</div></div>
      <div class="card"><div class="trend-meta"><div><div class="eyebrow">主观维度</div><h2>控制感</h2></div><div class="metric-big">${Number.isFinite(latest.control)?latest.control.toFixed(1)+'/10':'—'}</div></div><svg id="trendControlChart" viewBox="0 0 480 180" preserveAspectRatio="none"></svg></div>
      <div class="card"><h2>每周样本</h2>${weeks.length?weeks.map(w=>`<div class="progress-row"><span>${w.label}</span><div class="progress"><i style="width:${Math.min(100,w.count/3*100)}%"></i></div><b>${w.count} 次</b></div>`).join(''):'<div class="muted">暂无动停训练</div>'}</div>`;
    renderLineChart(document.getElementById('trendArtChart'),weeks,'art',{min:0,format:v=>Math.round(v)+'s'});
    renderLineChart(document.getElementById('trendStopChart'),weeks,'stop',{min:0,max:9,format:v=>v.toFixed(1)});
    renderLineChart(document.getElementById('trendOvershootChart'),weeks,'overshoot',{min:0,max:100,format:v=>Math.round(v)+'%'});
    renderLineChart(document.getElementById('trendControlChart'),weeks,'control',{min:0,max:10,format:v=>v.toFixed(1)});
  }
  function renderHistoryPanel() {
    const body=$('#historyPanelBody');
    const rows=[...analysisSessions()].filter(s=>s.endedAt).sort((a,b)=>sessionTimestamp(b)-sessionTimestamp(a));
    if(!rows.length){body.innerHTML='<div class="card empty">还没有完成的训练记录。</div>';return;}
    body.innerHTML=`<div class="section-head"><h2>训练历史</h2><span class="muted">${rows.length} 次</span></div><div class="history-list">${rows.map(s=>{
      const m=computeMetrics(s), modules=(s.programSnapshot?.modules||[]).map(x=>EXERCISES[x.exerciseId]?.name||x.exerciseId);
      return `<button class="session-row" data-history-id="${escapeHtml(s.id)}"><div class="session-row-top"><div><strong>${escapeHtml(s.programSnapshot?.name||'训练')}</strong><div class="small">${escapeHtml(formatDateTime(sessionTimestamp(s)))}</div></div><span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">${qualityBadge(s)}<span class="pill">Week ${s.planSnapshot?.week ?? '—'}</span></span></div><div class="modules">${modules.map(x=>`<span class="pill">${escapeHtml(x)}</span>`).join('')}</div><div class="session-row-meta"><span>Cycle ${m.cycles||0}</span><span>ART ${Number.isFinite(m.meanART)?Math.round(m.meanART/1000)+'s':'—'}</span><span>Stop ${Number.isFinite(m.meanStopLevel)?m.meanStopLevel.toFixed(1):'—'}</span><span>控制 ${m.control!=null?m.control+'/10':'—'}</span></div></button>`;
    }).join('')}</div>`;
  }
  function renderComparePanel() {
    const body=$('#comparePanelBody');
    const groups=new Map();
    analysisSessions().filter(s=>s.endedAt&&hasExercise(s,'stop_start')&&dataQuality(s).usableForTrend).forEach(s=>{
      const key=Core.conditionKey(s);
      if(!groups.has(key))groups.set(key,{name:(s.programSnapshot?.name||'训练')+' · '+(s.planSnapshot?.stageName||'未标阶段')+' · '+(PROMPT_MODES[s.promptModeSnapshot]||'默认提示')+' · 时钟v'+(s.clockVersion||1),sessions:[]});
      groups.get(key).sessions.push(s);
    });
    const rows=[...groups.values()].map(g=>{
      const ms=g.sessions.map(computeMetrics);
      return {name:g.name,n:g.sessions.length,art:average(ms.map(m=>Number.isFinite(m.meanART)?m.meanART/1000:null)),stop:average(ms.map(m=>m.meanStopLevel)),over:average(ms.map(m=>Number.isFinite(m.overshootRate)?m.overshootRate*100:null)),control:average(ms.map(m=>m.control)),csr:average(ms.map(m=>m.csr))};
    }).sort((a,b)=>b.n-a.n);
    if(!rows.length){body.innerHTML='<div class="card empty">完成包含动停模块的训练后，可以按训练方案查看描述性差异。</div>';return;}
    body.innerHTML=`<div class="card"><h2>方案描述性对比</h2><p class="muted" style="line-height:1.55">这里不评选“最佳方案”。不同日期的压力、疲劳、熟练度和训练阶段都会影响结果；每个方案至少累计 2–3 次后再观察趋势更有意义。</p><div style="overflow-x:auto"><table class="comparison-table"><thead><tr><th>方案</th><th>次数</th><th>ART</th><th>Stop</th><th>Level 8</th><th>控制感</th><th>CSR</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${escapeHtml(r.name)}</strong>${r.n<2?'<div class="small">样本少</div>':''}</td><td>${r.n}</td><td>${Number.isFinite(r.art)?Math.round(r.art)+'s':'—'}</td><td>${Number.isFinite(r.stop)?r.stop.toFixed(1):'—'}</td><td>${Number.isFinite(r.over)?Math.round(r.over)+'%':'—'}</td><td>${Number.isFinite(r.control)?r.control.toFixed(1):'—'}</td><td>${Number.isFinite(r.csr)?Math.round(r.csr*100)+'%':'—'}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function renderDecisionPanel() {
    const body=$('#decisionsPanelBody');
    const rows=[...adaptiveHistory,...(settings.includeSimulatedData?simulationAdaptiveHistory:[])].sort((a,b)=>(b.generatedAt||0)-(a.generatedAt||0));
    if(!rows.length){body.innerHTML='<div class="card empty">训练引擎还没有产生调整记录。</div>';return;}
    body.innerHTML=`<div class="card"><h2>Adaptive Engine 决策历史</h2><p class="muted">这里保存系统当时为什么保持、降低或调整下一次动停训练参数。它是训练规则的可解释记录，不是医学诊断。</p><div class="decision-list">${rows.map(d=>`<div class="decision-item"><div class="small">${escapeHtml(formatDateTime(d.generatedAt))} · ${escapeHtml(d.type)}</div><strong>${escapeHtml(d.title)}</strong><div class="small">Stop ${d.stopThreshold??'—'} · Resume ${d.resumeThreshold??'—'} · ${d.applied?'已应用参数':'建议/记录'}</div><div class="reason">${escapeHtml(d.reason)}</div>${d.simulated?'<div class="small">模拟引擎记录</div>':''}${d.afterSessionId?`<div class="small">基于 Session ${escapeHtml(d.afterSessionId)}</div>`:''}</div>`).join('')}</div></div>`;
  }
  function renderInsights() {
    renderTrendPanel(); renderCoachPanel(); renderHistoryPanel(); renderComparePanel(); renderDecisionPanel(); renderQualityPanel(); setInsightTab(activeInsightTab);
  }
  function renderHistoryDetail(sessionId) {
    const s=sessionCache.find(x=>x.id===sessionId); if(!s){showToast('找不到这次训练');navTo('insights');return;}
    const m=computeMetrics(s), cycles=effectiveCycles(s), signals=bodySignalCounts([s]), quality=dataQuality(s);
    const events=(s.events||[]).slice().sort((a,b)=>(a.elapsedMs||0)-(b.elapsedMs||0));
    const modules=(s.programSnapshot?.modules||[]).map(moduleLabel);
    $('#historyDetailBody').innerHTML=`<div class="eyebrow">Session Detail</div><div class="screen-title">${escapeHtml(s.programSnapshot?.name||'训练')}</div><p class="muted">${escapeHtml(formatDateTime(sessionTimestamp(s)))}</p><div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px">${qualityBadge(s)}</div>
      <div class="detail-grid"><div class="detail-stat"><span class="muted">控制循环</span><strong>${m.cycles||0}</strong></div><div class="detail-stat"><span class="muted">平均 ART</span><strong>${Number.isFinite(m.meanART)?Math.round(m.meanART/1000)+'s':'—'}</strong></div><div class="detail-stat"><span class="muted">平均 Stop</span><strong>${Number.isFinite(m.meanStopLevel)?m.meanStopLevel.toFixed(1):'—'}</strong></div><div class="detail-stat"><span class="muted">Level 8 比例</span><strong>${Number.isFinite(m.overshootRate)?Math.round(m.overshootRate*100)+'%':'—'}</strong></div></div>
      <div class="card"><h2>训练组成</h2><div class="modules">${modules.map(x=>`<span class="pill">${escapeHtml(x)}</span>`).join('')}</div><div class="small" style="margin-top:10px">提示模式：${escapeHtml(PROMPT_MODES[s.promptModeSnapshot]||s.promptModeSnapshot||'—')} · Stop ${s.stopThreshold??'—'} / Resume ${s.resumeThreshold??'—'}</div></div>
      <div class="card"><h2>训练前与复盘</h2><table class="detail-table"><tbody><tr><th>压力</th><td>${s.checkin?.stress??'—'}/10</td><th>疲劳</th><td>${s.checkin?.fatigue??'—'}/10</td></tr><tr><th>盆底紧张</th><td>${s.checkin?.pelvicTension??'—'}/10</td><th>疼痛/不适</th><td>${s.checkin?.pain?'有':'无'}</td></tr><tr><th>控制感</th><td>${s.review?.control??'—'}/10</td><th>难度</th><td>${escapeHtml(s.review?.difficulty||'—')}</td></tr><tr><th>提前觉察</th><td>${escapeHtml(s.review?.awareness||'—')}</td><th>主要信号</th><td>${escapeHtml(s.review?.signal||'—')}</td></tr></tbody></table></div>
      ${cycles.length?`<div class="card"><div class="section-head"><h2>Control Cycles</h2><span class="small">修订不会改写原始 Event</span></div><div style="overflow-x:auto"><table class="detail-table"><thead><tr><th>#</th><th>Stop</th><th>Resume</th><th>ART</th><th>信号</th><th></th></tr></thead><tbody>${cycles.map((c,i)=>`<tr><td>${i+1}${c._revised?' *':''}</td><td>${c.stopLevel??'—'}</td><td>${c.resumeLevel??'—'}</td><td>${Number.isFinite(c.artMs)?Math.round(c.artMs/1000)+'s':'—'}</td><td>${(c.signals||[]).map(x=>escapeHtml(x)).join(', ')||'—'}</td><td><div class="cycle-actions"><button class="ghost" data-revise-cycle="${i}" data-session-id="${escapeHtml(s.id)}">修订</button></div></td></tr>`).join('')}</tbody></table></div></div>`:''}
      <div class="card"><h2>数据质量</h2><div class="quality-summary"><div class="detail-stat"><span class="muted">质量</span><strong>${quality.label}</strong></div><div class="detail-stat"><span class="muted">内部评分</span><strong>${quality.score}</strong></div><div class="detail-stat"><span class="muted">趋势使用</span><strong>${quality.usableForTrend?'是':'否'}</strong></div></div><div class="reason">${quality.issues.length?quality.issues.map(x=>'• '+escapeHtml(x)).join('<br>'):'没有发现明显的数据完整性问题。'}</div></div>
      ${renderRevisionLogHtml(s)}
      <div class="card"><h2>身体信号</h2>${Object.keys(signals).length?Object.entries(signals).map(([k,v])=>`<div class="progress-row"><span>${escapeHtml(k)}</span><div class="progress"><i style="width:${Math.min(100,v/Math.max(1,cycles.length)*100)}%"></i></div><b>${v}</b></div>`).join(''):'<div class="muted">本次没有记录明显信号</div>'}</div>
      <div class="chart-wrap"><div class="section-head"><h2>兴奋度曲线</h2><span class="small">本次 Session</span></div><svg id="historyChart" viewBox="0 0 480 220" preserveAspectRatio="none"></svg></div>
      <details class="card"><summary>查看原始事件 (${events.length})</summary><div style="overflow-x:auto;margin-top:10px"><table class="detail-table"><thead><tr><th>有效时间</th><th>事件</th><th>等级</th><th>Cycle</th></tr></thead><tbody>${events.map(e=>`<tr><td>${fmt(e.elapsedMs||0)}</td><td>${escapeHtml(e.type)}</td><td>${e.arousal??'—'}</td><td>${e.cycle??'—'}</td></tr>`).join('')}</tbody></table></div></details>
      <button id="deleteHistorySession" class="ghost" data-delete-session="${escapeHtml(s.id)}" style="margin-top:14px">删除这次训练记录</button>`;
    drawChartTo(document.getElementById('historyChart'),s);
    show('historyDetail');
  }
  function drawChartTo(svg,s) {
    const pts=(s.events||[]).filter(e=>e.type==='AROUSAL_LEVEL_CHANGED'||e.type==='MODULE_STARTED'&&e.exerciseId==='stop_start');
    if(!pts.length){svg.innerHTML='<text x="20" y="110" fill="#7f8a98">本次没有兴奋曲线数据</text>';return;}
    const maxX=Math.max(...pts.map(p=>p.elapsedMs),1),w=480,h=220,pad=20;
    const coords=pts.map(p=>[pad+(p.elapsedMs/maxX)*(w-pad*2),h-pad-(Number(p.arousal||0)/9)*(h-pad*2)]);
    const d=coords.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
    let grid='';for(let lvl=0;lvl<=9;lvl+=3){const y=h-pad-(lvl/9)*(h-pad*2);grid+=`<line x1="${pad}" y1="${y}" x2="${w-pad}" y2="${y}" stroke="#252b34" stroke-width="1"/><text x="2" y="${y+4}" fill="#74808d" font-size="11">${lvl}</text>`;}
    const stops=(s.events||[]).filter(e=>e.type==='STOP_STARTED').map(e=>{const x=pad+(e.elapsedMs/maxX)*(w-pad*2);return `<line x1="${x}" y1="${pad}" x2="${x}" y2="${h-pad}" stroke="#586473" stroke-width="1" stroke-dasharray="4 5"/>`;}).join('');
    svg.innerHTML=grid+stops+`<path d="${d}" fill="none" stroke="#edf2f7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  async function deleteHistoricalSession(id) {
    const s=sessionCache.find(x=>x.id===id); if(!s)return;
    if(!confirm('删除这次训练记录？相关趋势会重新计算，此操作无法撤销。'))return;
    await DB.deleteSession(id); sessionCache=sessionCache.filter(x=>x.id!==id); await Long.removeSession(id);
    (plan.schedule||[]).forEach(item=>{if(item.completedSessionId===id){item.status='PLANNED';delete item.completedSessionId;}});
    await DB.setMeta('plan',plan);
    adaptiveDecision=adaptiveEngine(sessionCache); await DB.setMeta('adaptiveDecision',adaptiveDecision);
    renderInsights(); refreshDashboard(); renderSettings(); navTo('insights'); showToast('训练记录已删除');
  }
  async function exportJsonBackup() {
    $('#backupPassword').value='';$('#backupPasswordAgain').value='';$('#backupMode').value='encrypted';$('#backupError').textContent='';$('#backupDialog').showModal();
  }
  async function backupPayload(){
    const meta={};for(const key of Backup.metaKeys)meta[key]=await DB.getMeta(key,null);
    Object.assign(meta,{settings,plan,customPrograms,adaptiveDecision,adaptiveHistory,simulationAdaptiveHistory,coachHistory,coachChatMessages,acceptanceResults,betaTelemetry,betaInstallId,...Long.meta(),acceptedParameters,parameterHistory,currentSession:currentSession&&currentSession.phase!=='COMPLETED'?Core.checkpoint(currentSession):null});
    return {format:'ec-training-backup',version:3,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),sessions:sessionCache,meta};
  }

  function exportCsvSummary() {
    const headers=['date','sessionId','program','week','activeMinutes','cycles','meanARTSeconds','meanStopLevel','overshootRatePercent','control','difficulty','awareness','stress','fatigue','pelvicTension','promptMode','dataQuality','qualityScore','revised','simulated'];
    const rows=sessionCache.filter(s=>s.endedAt).map(s=>{const m=computeMetrics(s);return [new Date(sessionTimestamp(s)).toISOString(),s.id,s.programSnapshot?.name||'',s.planSnapshot?.week??'',Number.isFinite(m.activeMinutes)?m.activeMinutes.toFixed(1):'',m.cycles,Number.isFinite(m.meanART)?(m.meanART/1000).toFixed(1):'',Number.isFinite(m.meanStopLevel)?m.meanStopLevel.toFixed(2):'',Number.isFinite(m.overshootRate)?(m.overshootRate*100).toFixed(1):'',m.control??'',m.difficulty??'',m.awareness??'',m.stress??'',m.fatigue??'',m.pelvicTension??'',s.promptModeSnapshot||'',dataQuality(s).label,dataQuality(s).score,dataQuality(s).revised?'yes':'no',s.simulated?'yes':'no'];});
    const csv='\ufeff'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\n');
    downloadBlob(csv,`training-summary-${dateKey()}.csv`,'text/csv;charset=utf-8'); showToast('CSV 摘要已生成');
  }
  async function restoreJsonBackup(file) {
    if(currentSession&&currentSession.phase!=='COMPLETED'){showToast('请先结束当前训练再恢复备份');return;}
    try{
      if(file.size>Backup.MAX_BYTES)throw new Error('备份超过50MB上限');
      pendingRestore=JSON.parse(await file.text());restorePreview=null;
      const encrypted=pendingRestore.format==='stop-action-encrypted-backup';
      if(!encrypted)pendingRestore=Backup.validate(pendingRestore);
      $('#restorePassword').value='';$('#restorePasswordLabel').hidden=!encrypted;$('#restoreError').textContent='';$('#restoreSubmit').textContent='校验并预览';$('#restoreSummary').textContent=encrypted?'已选择加密文件，输入密码后校验。':'已选择明文文件，下一步查看导入预览。';$('#restoreDialog').showModal();
    }catch(error){showToast(error.message);}
  }

  function renderRevisionLogHtml(s) {
    const revisions=Array.isArray(s.revisions)?s.revisions:[];
    if(!revisions.length) return '<div class="card"><h2>修订日志</h2><div class="muted">没有手动修订。原始事件流保持不变。</div></div>';
    const reversed=new Set(revisions.filter(r=>r.kind==='REVISION_REVERSED').map(r=>r.targetRevisionId));
    const rows=revisions.filter(r=>r.kind==='CYCLE_CORRECTION').slice().reverse();
    return `<div class="card"><h2>修订日志</h2><p class="small">修订以追加记录保存，不覆盖原始 Event Stream。撤销也会新增一条反向记录。</p><div class="revision-log">${rows.map(r=>`<div class="revision-item ${reversed.has(r.id)?'reversed':''}"><div class="small">${escapeHtml(formatDateTime(r.createdAt))} · Cycle ${r.cycleIndex+1} · ${escapeHtml(r.field)}</div><strong>${escapeHtml(r.oldValue)} → ${escapeHtml(r.newValue)}</strong><div class="small">${escapeHtml(r.reason||'手动纠错')}</div>${reversed.has(r.id)?'<div class="small">已撤销</div>':`<button class="ghost" style="margin-top:7px;width:auto;padding:6px 9px" data-reverse-revision="${escapeHtml(r.id)}" data-session-id="${escapeHtml(s.id)}">撤销此修订</button>`}</div>`).join('')}</div></div>`;
  }
  async function reviseCycle(sessionId, cycleIndex) {
    const s=sessionCache.find(x=>x.id===sessionId); if(!s)return;
    const cycles=effectiveCycles(s), c=cycles[cycleIndex]; if(!c)return;
    const stopRaw=prompt(`Cycle ${cycleIndex+1} · Stop Level（0–9，留空保持 ${c.stopLevel??'—'}）`,''); if(stopRaw===null)return;
    const resumeRaw=prompt(`Resume Level（0–9，留空保持 ${c.resumeLevel??'—'}）`,''); if(resumeRaw===null)return;
    const artRaw=prompt(`ART 秒数（留空保持 ${Number.isFinite(c.artMs)?Math.round(c.artMs/1000):'—'}）`,''); if(artRaw===null)return;
    const changes=[];
    if(stopRaw.trim()!==''){const v=clamp(Number(stopRaw),0,9);if(Number.isFinite(v)&&v!==Number(c.stopLevel))changes.push(['stopLevel',c.stopLevel,v]);}
    if(resumeRaw.trim()!==''){const v=clamp(Number(resumeRaw),0,9);if(Number.isFinite(v)&&v!==Number(c.resumeLevel))changes.push(['resumeLevel',c.resumeLevel,v]);}
    if(artRaw.trim()!==''){const sec=Number(artRaw);if(Number.isFinite(sec)&&sec>0){const v=Math.round(sec*1000);if(v!==Number(c.artMs))changes.push(['artMs',c.artMs,v]);}}
    if(!changes.length){showToast('没有需要保存的修改');return;}
    const reason=prompt('修订原因（例如：误滑、漏记、训练后核对）','误操作纠错'); if(reason===null)return;
    s.revisions=s.revisions||[];
    changes.forEach(([field,oldValue,newValue])=>s.revisions.push({id:'R'+now()+Math.random().toString(36).slice(2,5),kind:'CYCLE_CORRECTION',createdAt:now(),cycleIndex,field,oldValue,newValue,reason:reason||'手动纠错',source:'USER'}));
    s.schemaVersion=Math.max(4,s.schemaVersion||0); await DB.putSession(s);
    adaptiveDecision=adaptiveEngine(sessionCache); await DB.setMeta('adaptiveDecision',adaptiveDecision); await appendAdaptiveHistory(adaptiveDecision,{source:'data-correction',afterSessionId:s.id});
    renderHistoryDetail(s.id); renderInsights(); refreshDashboard(); showToast('已追加修订记录');
  }
  async function reverseRevision(sessionId, revisionId) {
    const s=sessionCache.find(x=>x.id===sessionId); if(!s)return;
    const target=(s.revisions||[]).find(r=>r.id===revisionId); if(!target)return;
    if(!confirm('撤销这条修订？原修订记录仍会保留，并新增一条撤销记录。'))return;
    s.revisions=s.revisions||[]; s.revisions.push({id:'RR'+now()+Math.random().toString(36).slice(2,5),kind:'REVISION_REVERSED',createdAt:now(),targetRevisionId:revisionId,reason:'用户撤销修订',source:'USER'});
    await DB.putSession(s); adaptiveDecision=adaptiveEngine(sessionCache); await DB.setMeta('adaptiveDecision',adaptiveDecision); await appendAdaptiveHistory(adaptiveDecision,{source:'revision-reversed',afterSessionId:s.id});
    renderHistoryDetail(s.id); renderInsights(); refreshDashboard(); showToast('已撤销修订');
  }
  function renderQualityPanel() {
    const body=$('#qualityPanelBody');
    const rows=analysisSessions().filter(s=>s.endedAt).map(s=>({s,q:dataQuality(s)})).sort((a,b)=>sessionTimestamp(b.s)-sessionTimestamp(a.s));
    if(!rows.length){body.innerHTML='<div class="card empty">完成训练后，这里会显示每条 Session 的数据完整性检查。</div>';return;}
    const complete=rows.filter(x=>x.q.score>=85).length, usable=rows.filter(x=>x.q.score>=65&&x.q.score<85).length, low=rows.filter(x=>x.q.score<65).length;
    body.innerHTML=`<div class="card"><h2>数据质量概览</h2><p class="muted">质量标记只评价记录完整性，不评价训练表现。低质量动停记录不会进入趋势和真实 Adaptive Decision。</p><div class="quality-summary"><div class="detail-stat"><span class="muted">完整</span><strong>${complete}</strong></div><div class="detail-stat"><span class="muted">可用</span><strong>${usable}</strong></div><div class="detail-stat"><span class="muted">注意</span><strong>${low}</strong></div></div></div><div class="history-list">${rows.map(({s,q})=>`<button class="session-row" data-history-id="${escapeHtml(s.id)}"><div class="session-row-top"><div><strong>${escapeHtml(s.programSnapshot?.name||'训练')}</strong><div class="small">${escapeHtml(formatDateTime(sessionTimestamp(s)))}</div></div><span style="display:flex;gap:6px">${qualityBadge(s)}</span></div><div class="reason">${q.issues.length?q.issues.map(x=>'• '+escapeHtml(x)).join('<br>'):'没有发现明显的数据完整性问题。'}</div></button>`).join('')}</div>`;
    body.querySelectorAll('[data-history-id]').forEach(el=>el.addEventListener('click',()=>renderHistoryDetail(el.dataset.historyId)));
  }
  function seededRandom(seed=20261002) { let x=seed>>>0; return ()=>((x=(1664525*x+1013904223)>>>0)/4294967296); }
  function simulatedProgramFor(i) { return programSnapshot(programById(i%3===1?'mind_body':'standard')); }
  function makeSimulatedSession(index, startTs, rnd) {
    const week=Math.floor(index/3)+1, inWeek=index%3;
    const ts=startTs+(week-1)*7*DAY_MS+[1,3,5][inWeek]*DAY_MS+(19*60+20)*60000;
    const progress=(week-1)/7;
    const program=simulatedProgramFor(index);
    const cycles=week<3?2:week<6?3:4;
    const stopModule=program.modules.find(m=>m.exerciseId==='stop_start'); if(stopModule)stopModule.cycles=cycles;
    const stress=clamp(Math.round(5+(rnd()-.5)*4),1,9), fatigue=clamp(Math.round(4+(rnd()-.5)*4),1,9), pelvic=clamp(Math.round(5-progress*1.8+(rnd()-.5)*3),1,9);
    const control=clamp(Math.round(4.5+progress*3+(rnd()-.5)*1.4),2,9);
    const overshootP=Math.max(.08,.5-progress*.34);
    const events=[], cs=[]; let elapsed=120000;
    const stopModuleIndex=program.modules.findIndex(m=>m.exerciseId==='stop_start');
    events.push({type:'MODULE_STARTED',at:ts+elapsed,elapsedMs:elapsed,arousal:2,cycle:1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',simulated:true});
    for(let c=0;c<cycles;c++){
      [3,4,5,6].forEach((lvl,j)=>{elapsed+=18000+Math.round(rnd()*12000);events.push({type:'AROUSAL_LEVEL_CHANGED',at:ts+elapsed,elapsedMs:elapsed,arousal:lvl,cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',simulated:true});});
      const stopLevel=clamp(Math.round((6.6+progress*.25+(rnd()-.5)*.7)*10)/10,6,8);
      elapsed+=16000+Math.round(rnd()*10000); events.push({type:'AROUSAL_LEVEL_CHANGED',at:ts+elapsed,elapsedMs:elapsed,arousal:Math.round(stopLevel),cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',simulated:true});
      const overshoot=rnd()<overshootP; if(overshoot){elapsed+=5000;events.push({type:'OVERSHOOT',at:ts+elapsed,elapsedMs:elapsed,arousal:8,cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',simulated:true});events.push({type:'AROUSAL_LEVEL_CHANGED',at:ts+elapsed,elapsedMs:elapsed,arousal:8,cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',simulated:true});}
      events.push({type:'STOP_STARTED',at:ts+elapsed,elapsedMs:elapsed,arousal:stopLevel,cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',stopLevel,simulated:true});
      const baseArt=50000-progress*23000+stress*700+pelvic*900; const artMs=Math.max(9000,Math.round(baseArt+(rnd()-.5)*11000));
      const mid=Math.max(5,Math.round(stopLevel-1)); elapsed+=Math.round(artMs*.45); events.push({type:'AROUSAL_LEVEL_CHANGED',at:ts+elapsed,elapsedMs:elapsed,arousal:mid,cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',simulated:true});
      elapsed+=Math.round(artMs*.55); events.push({type:'AROUSAL_LEVEL_CHANGED',at:ts+elapsed,elapsedMs:elapsed,arousal:5,cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',simulated:true}); events.push({type:'RECOVERY_TARGET_REACHED',at:ts+elapsed,elapsedMs:elapsed,arousal:5,cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',artMs,simulated:true});
      if(rnd()<.65){const signal=pelvic>=5?'PELVIC_TENSION':'BREATH_FAST',label=signal==='PELVIC_TENSION'?'盆底紧张':'呼吸加快';events.push({type:'BODY_SIGNAL_RECORDED',at:ts+elapsed,elapsedMs:elapsed,arousal:5,cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',signal,label,simulated:true});}
      cs.push({id:`SIMC${index+1}-${c+1}`,stopStartedAt:ts+elapsed-artMs,stopLevel,peakLevel:overshoot?8:stopLevel,recoveryReachedAt:ts+elapsed,artMs,resumedAt:ts+elapsed+2500,resumeLevel:5,successful:true,signals:[]});
      elapsed+=2500; events.push({type:'RESUME_STARTED',at:ts+elapsed,elapsedMs:elapsed,arousal:5,cycle:c+1,moduleIndex:stopModuleIndex,exerciseId:'stop_start',simulated:true});
    }
    const endedAt=ts+elapsed+60000;
    return {schemaVersion:4,id:`SIM-${dateKey(ts)}-${index+1}`,simulated:true,createdAt:ts,startedAt:ts,endedAt,activeAccumulatedMs:elapsed+60000,phase:'COMPLETED',arousal:5,cycles:cs,events,revisions:[],review:{control,relax:clamp(Math.round(5+progress*2+(rnd()-.5)*2),2,9),difficulty:week<2?'太困难':week>6?'合适':'合适',signal:pelvic>=5?'盆底':'呼吸',awareness:week<3?'一点':week<6?'比较明显':'很早就发现'},checkin:{stress,fatigue,pelvicTension:pelvic,pain:false},overshootCount:events.filter(e=>e.type==='OVERSHOOT').length,stopThreshold:7,resumeThreshold:5,moduleIndex:program.modules.length,moduleResults:program.modules.map(m=>({exerciseId:m.exerciseId,status:'COMPLETED',completedAt:endedAt})),promptModeSnapshot:week>=7?'threshold':'full',planSnapshot:{week,stageName:STAGES[Math.min(8,week)]?.name||'模拟',adaptiveType:'SIMULATED'},programSnapshot:program,modules:program.modules.map(moduleLabel)};
  }
  async function generateEightWeekSimulation() {
    if(sessionCache.some(s=>s.simulated) && !confirm('本机已经有模拟数据。继续会先删除旧模拟数据再生成一套新的 8 周数据。'))return;
    await removeSimulatedData(false);
    const rnd=seededRandom(), start=startOfDay(addDays(new Date(),-56)).getTime(); const core=[];
    for(let i=0;i<24;i++)core.push(makeSimulatedSession(i,start,rnd));
    simulationAdaptiveHistory=[];
    for(let i=0;i<core.length;i++){const d=adaptiveEngine(core.slice(0,i+1),{allowSimulated:true});simulationAdaptiveHistory.push({...decisionRecord(d,{source:'simulator',afterSessionId:core[i].id}),simulated:true});}
    const edgeA=structuredClone(core[4]); edgeA.id='SIM-EDGE-MISSING-ART'; edgeA.createdAt+=2*3600000; edgeA.startedAt+=2*3600000; edgeA.endedAt+=2*3600000; edgeA.programSnapshot.name+=' · 质量样本'; edgeA.simulatedScenario='missing-art'; edgeA.cycles.forEach(c=>c.artMs=null); edgeA.events=edgeA.events.filter(e=>e.type!=='RECOVERY_TARGET_REACHED'&&e.type!=='AROUSAL_LEVEL_CHANGED').slice(0,6);
    const edgeB=structuredClone(core[10]); edgeB.id='SIM-EDGE-SPARSE'; edgeB.createdAt+=3*3600000; edgeB.startedAt+=3*3600000; edgeB.endedAt+=3*3600000; edgeB.programSnapshot.name+=' · 质量样本'; edgeB.simulatedScenario='sparse-review'; edgeB.review=null; edgeB.events=edgeB.events.filter(e=>['MODULE_STARTED','STOP_STARTED'].includes(e.type));
    const simulated=[...core,edgeA,edgeB];
    for(const sess of simulated)await DB.putSession(sess);
    sessionCache=await DB.getAllSessions(); settings.includeSimulatedData=true; await DB.setMeta('settings',settings); await DB.setMeta('simulationAdaptiveHistory',simulationAdaptiveHistory);
    renderSettings();renderInsights();showToast('已生成 8 周模拟数据与质量边界样本');
  }
  async function removeSimulatedData(ask=true) {
    const sims=sessionCache.filter(s=>s.simulated); if(!sims.length){if(ask)showToast('没有模拟数据');return;}
    if(ask&&!confirm(`删除 ${sims.length} 条模拟 Session？真实训练数据不会受影响。`))return;
    for(const sess of sims)await DB.deleteSession(sess.id);
    sessionCache=sessionCache.filter(s=>!s.simulated);simulationAdaptiveHistory=[];settings.includeSimulatedData=false;await DB.setMeta('simulationAdaptiveHistory',[]);await DB.setMeta('settings',settings);
    renderSettings();renderInsights();if(ask)showToast('模拟数据已删除');
  }
  const ACCEPTANCE_ITEMS=[
    ['gesture','竖屏状态下，上下滑能稳定改变等级，连续操作不会误触页面滚动'],
    ['stop','达到阈值后，单击 Stop 的反馈清晰且不会误触成双击'],
    ['resume','主观舒适且可控后，双击 Resume 能稳定识别'],
    ['quick','Recovery 左滑能打开 Quick Marker，关闭后仍停留在原训练状态'],
    ['haptic','关键节点震动在当前手机上能清楚区分，且不过度打扰'],
    ['calendar','日历拖拽在触屏上不会与页面滚动冲突'],
    ['offline','安装/PWA 或断网后仍能启动并完成一次训练'],
    ['recover','训练中强制关闭页面后，重新进入可以恢复未完成 Session'],
    ['export','JSON / CSV 可以成功导出；JSON 备份可以恢复'],
    ['privacy','锁屏、多任务界面和页面文案没有暴露不希望显示的敏感词']
  ];
  function renderCapabilities(){const caps=[['IndexedDB',!!window.indexedDB],['Vibration API',!!navigator.vibrate],['Service Worker','serviceWorker' in navigator],['Wake Lock','wakeLock' in navigator],['Pointer Events','PointerEvent' in window],['File API',!!window.FileReader]];$('#capabilityReport').innerHTML=caps.map(([name,ok])=>`<div class="qa-item"><span class="cap-dot ${ok?'ok':'warn'}"></span><label>${escapeHtml(name)}<div class="small">${ok?'当前浏览器支持':'当前环境未检测到'}</div></label></div>`).join('');}
  function renderAcceptanceChecklist(){$('#acceptanceChecklist').innerHTML=ACCEPTANCE_ITEMS.map(([id,label])=>`<div class="qa-item"><input type="checkbox" id="qa-${id}" data-acceptance-id="${id}" ${acceptanceResults[id]?'checked':''}><label for="qa-${id}">${escapeHtml(label)}</label></div>`).join('');}
  async function saveAcceptanceResult(e){const input=e.target.closest('[data-acceptance-id]');if(!input)return;acceptanceResults[input.dataset.acceptanceId]=input.checked;recordBetaEvent('ACCEPTANCE_ITEM_CHANGED',{item:input.dataset.acceptanceId,passed:input.checked});await DB.setMeta('acceptanceResults',acceptanceResults); await DB.setMeta('betaTelemetry',betaTelemetry); await DB.setMeta('betaInstallId',betaInstallId);}
  async function resetAcceptanceResults(){if(!confirm('重置手机实机验收勾选结果？'))return;acceptanceResults={};await DB.setMeta('acceptanceResults',acceptanceResults); await DB.setMeta('betaTelemetry',betaTelemetry); await DB.setMeta('betaInstallId',betaInstallId);renderAcceptanceChecklist();showToast('验收结果已重置');}

  function renderSettings() {
    $('#hapticLabel').textContent=settings.haptics?'开启':'关闭';
    const realCount=sessionCache.filter(s=>!s.simulated).length; $('#sessionCount').textContent=`${realCount} 次真实训练`;
    $('#dbStatus').textContent='IndexedDB · Session v5 · App v2.0'; renderPreferences();
    $('#promptModeLabel').textContent=PROMPT_MODES[settings.promptMode]||PROMPT_MODES.full;
    $('#externalCoachStatus').textContent=externalCoachConfigured()?'已授权':'关闭';
    $('#externalCoachEndpoint').value=settings.externalCoachEndpoint||'';
    $('#externalCoachModel').value=settings.externalCoachModel||'';
    $('#externalCoachToken').value=externalCoachToken||'';
    $('#externalCoachConsent').checked=!!settings.externalCoachConsent;
    const bundled=bundledRelayEndpoint();
    const relayStatus=$('#relayHealthStatus');
    if(relayStatus && bundled && settings.externalCoachEndpoint===bundled) relayStatus.textContent='当前使用同源 /api/coach。点击“检测 Relay”可以检查后端是否在线；上游 API Key 只应配置在服务器环境变量中。';
    $$('#promptModes .mode-btn').forEach(b=>b.classList.toggle('selected',b.dataset.mode===settings.promptMode));
    const suggestion=$('#promptSuggestion');
    if(adaptiveDecision?.type==='REDUCE_PROMPTS_SUGGESTED' && settings.promptMode==='full'){
      suggestion.style.display='flex'; suggestion.innerHTML='<span>◌</span><span>训练引擎认为近期控制较稳定。是否减少提示由你决定；系统不会自动切换。</span>';
    } else suggestion.style.display='none';
    $('#developerModeLabel').textContent=settings.developerMode?'开启':'关闭';
    $('#toggleDeveloperMode').textContent=settings.developerMode?'关闭验收工具':'打开验收工具';
    $('#developerTools').style.display=settings.developerMode?'block':'none';
    if ($('#betaTelemetryStatus')) $('#betaTelemetryStatus').textContent=settings.betaTelemetryEnabled?'收集中':'未开启';
    if ($('#toggleBetaTelemetry')) $('#toggleBetaTelemetry').textContent=settings.betaTelemetryEnabled?'停止实机数据收集':'开启实机数据收集';
    if ($('#betaTelemetrySummary')) $('#betaTelemetrySummary').textContent=betaTelemetry.length?`已收集 ${betaTelemetry.length} 个交互事件；导出时会把 Session ID 替换为匿名 run 编号。`:'尚未收集实机测试事件。';
    $('#toggleSimulatedAnalysis').textContent=`分析模拟数据：${settings.includeSimulatedData?'开':'关'}`;
    const simulated=sessionCache.filter(s=>s.simulated).length;
    $('#simulationStatus').textContent=simulated?`本地有 ${simulated} 条模拟 Session。${settings.includeSimulatedData?'当前会显示在分析页。':'当前不会显示在分析页。'}`:'尚未生成模拟数据。';
    if(settings.developerMode){renderCapabilities();renderAcceptanceChecklist();}
  }

  async function deferToTomorrow() { await Long.defer();refreshDashboard();renderPlan(); }
  async function restoreSchedule() { navTo('plan');showToast('在主计划中选择“从今天重新安排”，预览后确认。'); }

  function bindUI() {
    $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>navTo(b.dataset.nav)));
    $$('[data-back]').forEach(b=>b.addEventListener('click',()=>navTo(b.dataset.back)));
    $('#insightTabs').addEventListener('click',e=>{const b=e.target.closest('[data-insight-tab]');if(!b)return;setInsightTab(b.dataset.insightTab);});
    $('#historyPanelBody').addEventListener('click',e=>{const row=e.target.closest('[data-history-id]');if(row)renderHistoryDetail(row.dataset.historyId);});
    $('#coachPanelBody').addEventListener('click',async e=>{
      if(e.target.closest('#copyCoachContext'))await copyCoachContext();
      if(e.target.closest('#saveCoachReport')){await appendCoachHistory({source:'manual'});renderCoachPanel();showToast('Coach 复盘已保存在本机');return;}
      const mode=e.target.closest('[data-coach-mode]');
      if(mode){const next=mode.dataset.coachMode;if(next==='external'&&!externalCoachConfigured()){showToast('请先到“我的”配置并授权外部 LLM Adapter');return;}settings.coachChatMode=next;await DB.setMeta('settings',settings);renderCoachPanel();return;}
      const quick=e.target.closest('[data-coach-quick]'); if(quick){await sendCoachQuestion(quick.dataset.coachQuick);return;}
      if(e.target.closest('#sendCoachQuestion')){const input=document.querySelector('#coachQuestion');const q=input?.value||'';if(input)input.value='';await sendCoachQuestion(q);return;}
      if(e.target.closest('#clearCoachChat')){if(!coachChatMessages.length||confirm('清空本机 Coach 对话历史？这不会删除训练数据。')){coachChatMessages=[];await persistCoachChat();renderCoachPanel();}return;}
    });
    $('#coachPanelBody').addEventListener('keydown',async e=>{if(e.target?.id==='coachQuestion'&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();const q=e.target.value;e.target.value='';await sendCoachQuestion(q);}});
    $('#historyDetailBody').addEventListener('click',e=>{const del=e.target.closest('[data-delete-session]'),rev=e.target.closest('[data-revise-cycle]'),undo=e.target.closest('[data-reverse-revision]');if(del)deleteHistoricalSession(del.dataset.deleteSession);else if(rev)reviseCycle(rev.dataset.sessionId,+rev.dataset.reviseCycle);else if(undo)reverseRevision(undo.dataset.sessionId,undo.dataset.reverseRevision);});
    $('#exportJson').addEventListener('click',exportJsonBackup); $('#exportCsv').addEventListener('click',exportCsvSummary);
    $('#importJson').addEventListener('click',()=>$('#importBackupFile').click()); $('#importBackupFile').addEventListener('change',async e=>{const f=e.target.files?.[0];e.target.value='';if(f)await restoreJsonBackup(f);});
    $('#toggleDeveloperMode').addEventListener('click',async()=>{settings.developerMode=!settings.developerMode;await DB.setMeta('settings',settings);renderSettings();});
    $('#toggleSimulatedAnalysis').addEventListener('click',async()=>{settings.includeSimulatedData=!settings.includeSimulatedData;await DB.setMeta('settings',settings);renderSettings();renderInsights();showToast(settings.includeSimulatedData?'已显示模拟数据':'已隐藏模拟数据');});
    $('#testHaptic').addEventListener('click',()=>{if(navigator.vibrate){navigator.vibrate([40,60,90]);recordBetaEvent('HAPTIC_TEST',{supported:true});showToast('已发送震动测试');}else showToast('当前浏览器不支持震动 API');});
    $('#generateSimulation').addEventListener('click',generateEightWeekSimulation); $('#removeSimulation').addEventListener('click',removeSimulatedData);
    $('#acceptanceChecklist').addEventListener('change',saveAcceptanceResult); $('#resetAcceptance').addEventListener('click',resetAcceptanceResults);
    $('#toggleBetaTelemetry').addEventListener('click',toggleBetaTelemetry); $('#exportBetaJson').addEventListener('click',exportBetaJson); $('#exportBetaCsv').addEventListener('click',exportBetaCsv); $('#clearBetaTelemetry').addEventListener('click',clearBetaTelemetry);
    ['betaGesture','betaHapticRating','betaInterference'].forEach(id=>{const el=$('#'+id);if(el)el.addEventListener('input',()=>{const out=id==='betaGesture'?'#betaGestureV':id==='betaHapticRating'?'#betaHapticV':'#betaInterferenceV';$(out).textContent=el.value;});});
    $('#saveBetaFeedback').addEventListener('click',saveBetaFeedback);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseSession();showCover();}else releaseWake();}); window.addEventListener('pagehide',()=>{pauseSession();persistCurrentSoon();});

    $('#startTraining').addEventListener('click',()=>launchProgram($('#startTraining').dataset.programId||'standard',$('#startTraining').dataset.scheduleId||null));
    $('#deferToday').addEventListener('click',deferToTomorrow); $('#restoreSchedule').addEventListener('click',restoreSchedule);

    ['stress','fatigue','tension'].forEach(id=>$('#'+id).addEventListener('input',()=>$('#'+id+'V').textContent=$('#'+id).value));
    $$('[data-pain]').forEach(b=>b.addEventListener('click',()=>{pain=b.dataset.pain==='true';$$('[data-pain]').forEach(x=>x.classList.toggle('selected',x===b));$('#painNotice').style.display=pain?'block':'none';}));
    $('#continueCheckin').addEventListener('click',()=>{
      currentSession.checkin={stress:+$('#stress').value,fatigue:+$('#fatigue').value,pelvicTension:+$('#tension').value,pain}; recordBetaEvent('CHECKIN_CONTINUED',{painFlag:!!pain}); event('CHECKIN_COMPLETED',currentSession.checkin);
      if((currentSession.checkin.stress>=8||currentSession.checkin.fatigue>=8)&&!pain&&!confirm('今天状态偏疲劳。继续原计划吗？\n取消后留在训练前记录，可降低安排或结束本次。')){show('checkin');return;}
      if(pain){showToast('出现不适，先结束并记录；持续或明显时寻求专业评估。');finishSession();return;}
      startNextModule();
    });

    const guideAction=status=>{if(now()<moduleActionReadyAt||currentSession?.phase!=='MODULE_ACTIVE'||currentSession?.pausedAt)return;moduleActionReadyAt=now()+350;completeCurrentModule(status);};
    $('#guidedPause').addEventListener('click',pauseSession); $('#completeModule').addEventListener('click',()=>guideAction('COMPLETED')); $('#skipModule').addEventListener('click',()=>guideAction('SKIPPED'));
    $('#pauseBtn').addEventListener('click',pauseSession); $('#resumePause').addEventListener('click',resumePaused); $('#endFromPause').addEventListener('click',finishSession);

    const surface=$('#gestureSurface');
    surface.addEventListener('pointerdown',e=>{if(!settings.gestures||currentSession?.pausedAt)return;touchStart={x:e.clientX,y:e.clientY,t:now()};longPressTimer=setTimeout(()=>openFinishSheet('early'),900);surface.setPointerCapture?.(e.pointerId);});
    surface.addEventListener('pointermove',e=>{if(!touchStart)return;if(Math.hypot(e.clientX-touchStart.x,e.clientY-touchStart.y)>12)clearTimeout(longPressTimer);});
    surface.addEventListener('pointercancel',()=>{clearTimeout(longPressTimer);touchStart=null;lastTap=0;});
    surface.addEventListener('pointerup',e=>{
      clearTimeout(longPressTimer); if(!touchStart)return; const dx=e.clientX-touchStart.x,dy=e.clientY-touchStart.y,dt=now()-touchStart.t;touchStart=null;
      if(Math.abs(dy)>45&&Math.abs(dy)>Math.abs(dx)){changeArousal(dy<0?1:-1);return;}
      if(dx<-70&&Math.abs(dx)>Math.abs(dy)&&currentSession?.phase==='RECOVERY'){openQuickMarker();return;}
      if(Math.abs(dx)<=70&&Math.abs(dy)<=50&&dt>=350)recordBetaEvent('GESTURE_UNRECOGNIZED',{phase:currentSession?.phase||'none',durationBucket:dt>900?'long':'medium'});
      if(dt<350){const t=now(),dbl=t-lastTap<320;lastTap=t;if(settings.promptMode==='autonomous'&&['BUILD','CONTROL_ZONE'].includes(currentSession?.phase)&&!dbl){confirmStop(true);lastTap=0;return;}if(currentSession?.phase==='STOP_SUGGESTED'&&!dbl){setTimeout(()=>{if(currentSession?.phase==='STOP_SUGGESTED')confirmStop(false);},330);}if(dbl&&currentSession?.phase==='RESUME_AVAILABLE'){resumeCycle();lastTap=0;}}
    });
    $$('.signal-btn').forEach(b=>b.addEventListener('click',()=>recordQuickSignal(b.dataset.signal,b.dataset.label))); $('#closeMarker').addEventListener('click',closeQuickMarker);
    $('#finishNow').addEventListener('click',finishPrimaryAction); $('#cancelFinish').addEventListener('click',cancelFinishAction);

    $('#control').addEventListener('input',()=>$('#controlV').textContent=$('#control').value+' / 10'); $('#relax').addEventListener('input',()=>$('#relaxV').textContent=$('#relax').value+' / 10');
    ['difficulty','signals','awareness'].forEach(id=>$$(`#${id} .chip`).forEach(c=>c.addEventListener('click',()=>{$$(`#${id} .chip`).forEach(x=>x.classList.remove('selected'));c.classList.add('selected');})));
    $('#saveReview').addEventListener('click',saveReview); $('#summaryDone').addEventListener('click',()=>{currentSession=null;pendingLaunch=null;navTo('dashboard');}); $('#summaryOpenCoach').addEventListener('click',()=>{currentSession=null;pendingLaunch=null;navTo('insights');setInsightTab('coach');});

    $('#toggleHaptic').addEventListener('click',async()=>{settings.haptics=!settings.haptics;await DB.setMeta('settings',settings);renderSettings();vibrate(40);});
    $('#useBundledRelay').addEventListener('click',()=>{
      const endpoint=bundledRelayEndpoint();
      if(!endpoint){showToast('请先通过 HTTP/HTTPS 打开应用');return;}
      $('#externalCoachEndpoint').value=endpoint;
      showToast('已填入同源 Relay Endpoint，请确认发送授权后保存');
    });
    $('#testBundledRelay').addEventListener('click',async()=>{
      const el=$('#relayHealthStatus');
      try {
        if(el)el.textContent='正在检测同源 Relay…';
        const health=await testBundledRelayHealth();
        if(el)el.textContent=`Relay 在线 · ${health.upstream||'unknown'} · 模型 ${health.model||'—'} · ${health.modelConfigured?'上游已配置':'尚未配置上游 API Key'}`;
        showToast('Relay 检测通过');
      } catch(err) {
        if(el)el.textContent=`Relay 检测失败：${String(err?.message||err)}`;
        showToast('Relay 暂不可用');
      }
    });
    $('#saveExternalCoach').addEventListener('click',async()=>{
      const endpoint=$('#externalCoachEndpoint').value.trim(); const model=$('#externalCoachModel').value.trim(); const consent=$('#externalCoachConsent').checked;
      if(endpoint&&!validateExternalCoachEndpoint(endpoint)){showToast('Endpoint 必须使用 HTTPS（localhost 可用 HTTP）');return;}
      if(endpoint&&!consent){showToast('启用外部 Coach 前需要明确勾选发送授权');return;}
      settings.externalCoachEndpoint=endpoint; settings.externalCoachModel=model; settings.externalCoachConsent=!!consent; settings.externalCoachEnabled=!!(endpoint&&consent); externalCoachToken=$('#externalCoachToken').value||'';
      if(!settings.externalCoachEnabled&&settings.coachChatMode==='external')settings.coachChatMode='local';
      await DB.setMeta('settings',settings); renderSettings(); renderCoachPanel(); showToast(settings.externalCoachEnabled?'外部 Coach Adapter 已启用':'Adapter 设置已保存');
    });
    $('#disableExternalCoach').addEventListener('click',async()=>{settings.externalCoachEnabled=false;settings.externalCoachConsent=false;settings.coachChatMode='local';externalCoachToken='';await DB.setMeta('settings',settings);renderSettings();renderCoachPanel();showToast('外部 Coach 已关闭');});
    $('#promptModes').addEventListener('click',async e=>{const b=e.target.closest('[data-mode]');if(!b)return;const mode=b.dataset.mode;if(mode==='autonomous'&&settings.promptMode!=='autonomous'&&!confirm('自主模式会关闭自动 Stop 提示。训练时由你自己判断何时单击进入 Recovery，系统只记录实际 Stop 等级。确认启用吗？'))return;settings.promptMode=mode;await DB.setMeta('settings',settings);renderSettings();showToast(`已切换：${PROMPT_MODES[mode]}`);});
    $('#clearData').addEventListener('click',async()=>{if(!confirm('删除全部本地训练数据并重置训练计划？此操作无法撤销。'))return;await DB.clearTrainingData();Long.reset();acceptedParameters={stopThreshold:7,resumeThreshold:5};parameterHistory=[];sessionCache=[];customPrograms=[];adaptiveHistory=[];simulationAdaptiveHistory=[];coachHistory=[];coachChatMessages=[];externalCoachToken='';acceptanceResults={};betaTelemetry=[];betaInstallId='';plan=defaultPlan();adaptiveDecision=adaptiveEngine([]);await DB.setMeta('plan',plan);await DB.setMeta('customPrograms',customPrograms);await DB.setMeta('adaptiveDecision',adaptiveDecision);await DB.setMeta('adaptiveHistory',adaptiveHistory);await DB.setMeta('simulationAdaptiveHistory',simulationAdaptiveHistory);await DB.setMeta('coachHistory',coachHistory);await DB.setMeta('coachChatMessages',coachChatMessages);await DB.setMeta('acceptanceResults',acceptanceResults); await DB.setMeta('betaTelemetry',betaTelemetry); await DB.setMeta('betaInstallId',betaInstallId);await ensureSchedule(true);refreshDashboard();renderPlan();renderSettings();showToast('本地训练数据已清空');});

    $('#programList').addEventListener('click',async e=>{const start=e.target.closest('[data-start-program]'),sched=e.target.closest('[data-schedule-program]'),del=e.target.closest('[data-delete-program]');if(start)launchProgram(start.dataset.startProgram,null);else if(sched)await scheduleProgram(sched.dataset.scheduleProgram);else if(del&&confirm('删除这个自定义训练方案？'))await deleteProgram(del.dataset.deleteProgram);});
    $('#scheduleCalendar').addEventListener('click',e=>{if(e.target.closest('.drag-handle'))return;const card=e.target.closest('[data-start-schedule]');if(!card)return;const item=(plan.schedule||[]).find(x=>x.id===card.dataset.startSchedule);if(item)launchProgram(item.programId,item.id);});
    $('#builderModules').addEventListener('change',e=>{if(e.target.matches('[data-builder-check]')){const row=builderState.find(x=>x.exerciseId===e.target.dataset.builderCheck);if(row)row.selected=e.target.checked;}if(e.target.matches('[data-builder-value]')){const row=builderState.find(x=>x.exerciseId===e.target.dataset.builderValue);if(row)row.value=clamp(+e.target.value||1,1,30);}});
    $('#builderModules').addEventListener('click',e=>{const b=e.target.closest('[data-builder-move]');if(!b)return;const i=+b.dataset.index,dir=b.dataset.builderMove==='up'?-1:1,j=i+dir;if(j<0||j>=builderState.length)return;[builderState[i],builderState[j]]=[builderState[j],builderState[i]];renderBuilder();});
    $('#saveCustomProgram').addEventListener('click',saveCustomProgram); $('#resetBuilder').addEventListener('click',()=>{resetBuilderState();renderBuilder();showToast('已重置组合');});

    window.addEventListener('pointermove',e=>{if(dragState){e.preventDefault();moveDragGhost(e.clientX,e.clientY);}}, {passive:false});
    window.addEventListener('pointerup',()=>endDrag());
  }

  function upgradePendingSession(pending) {
    if (pending.programSnapshot) { pending.schemaVersion=Math.max(4,pending.schemaVersion||0); pending.revisions=pending.revisions||[]; return pending; }
    const standard=programById('standard');
    pending.schemaVersion=4; pending.revisions=pending.revisions||[]; pending.programSnapshot=programSnapshot(standard); pending.moduleResults=pending.moduleResults||[]; pending.promptModeSnapshot=settings.promptMode;
    if(['BUILD','CONTROL_ZONE','STOP_SUGGESTED','RECOVERY','RESUME_AVAILABLE','COMPLETE_READY'].includes(pending.phase)) pending.moduleIndex=standard.modules.findIndex(m=>m.exerciseId==='stop_start');
    else pending.moduleIndex=0;
    pending.stopStartBaseCycles=0; pending.targetCycles=pending.targetCycles||stage().cycles; return pending;
  }
  async function recoverPendingSession() {
    let pending=await DB.getCurrentSession();if(!pending)return;
    pending=Core.recover(upgradePendingSession(pending));currentSession=pending;
    if(pending.phase==='REVIEW'||(pending.endedAt&&!pending.review)){prefillReviewSignal();configureReview();show('review');return;}
    $('#pauseTime').textContent=fmt(activeElapsed());$('#pause .muted').textContent=pending.recoveryNotice;
    if(pending.currentCycle&&pending.currentCycle.stopActiveElapsedMs==null){pending.currentCycle.stopActiveElapsedMs=activeElapsed();pending.currentCycle.legacyRecovery=true;}
    show('pause');
  }

  async function init() {
    try {
      await DB.init();
      sessionCache=await DB.getAllSessions();
      settings={gestures:false,leftHanded:false,keepAwake:false,haptics:true,promptMode:'full',developerMode:false,includeSimulatedData:false,coachChatMode:'local',externalCoachEnabled:false,externalCoachEndpoint:'',externalCoachModel:'',externalCoachConsent:false,betaTelemetryEnabled:false,...(await DB.getMeta('settings',{}))};
      customPrograms=await DB.getMeta('customPrograms',[]);
      adaptiveHistory=await DB.getMeta('adaptiveHistory',[]);
      simulationAdaptiveHistory=await DB.getMeta('simulationAdaptiveHistory',[]);
      coachHistory=await DB.getMeta('coachHistory',[]);
      coachChatMessages=await DB.getMeta('coachChatMessages',[]);
      acceptanceResults=await DB.getMeta('acceptanceResults',{});
      betaTelemetry=await DB.getMeta('betaTelemetry',[]);
      betaInstallId=await DB.getMeta('betaInstallId','');
      plan=await DB.getMeta('plan',null); if(!plan){plan=defaultPlan();await DB.setMeta('plan',plan);} if(!plan.version||plan.version<2)plan.version=2;
      await ensureSchedule();
      acceptedParameters=await DB.getMeta('acceptedParameters',{stopThreshold:7,resumeThreshold:5});parameterHistory=await DB.getMeta('parameterHistory',[]);
      await Long.init({db:DB,legacyPlan:()=>plan,programs:allPrograms,sessions:()=>sessionCache,exerciseName:key=>EXERCISES[key].name,toast:showToast,download:downloadBlob,changed:()=>refreshDashboard(),isTraining:()=>!!currentSession&&currentSession.phase!=='COMPLETED',isTaskRunning:id=>!!id&&currentSession?.scheduleItemId===id&&currentSession.phase!=='COMPLETED',viewSession:renderHistoryDetail,launch:(program,task)=>launchProgram(program.id,task.id)});
      adaptiveDecision=adaptiveEngine(sessionCache); await DB.setMeta('adaptiveDecision',adaptiveDecision);
      await ensureAdaptiveHistory();
      await maybeAdvancePlan();
      resetBuilderState(); bindUI(); bindNewUI(); refreshDashboard(); renderPlan(); renderSettings(); await recoverPendingSession();
      document.body.dataset.appReady='true';
      registerWorker(); checkpointTimer=setInterval(()=>{if(currentSession&&!currentSession.pausedAt&&currentSession.phase!=='COMPLETED')persistCurrentSoon();},5000); $('#saveStatus').textContent='已读取本机数据';if(!await DB.getMeta('onboardingDone',false)&&!currentSession)$('#rehearsalDialog').showModal();
    } catch(err) {
      console.error(err); $('#adaptiveCard').innerHTML='<strong>本地数据读取失败</strong><div class="reason">'+escapeHtml(err.message)+'。原始迁移数据不会清除。请保留当前浏览器数据并重试。</div>'; $('#dbStatus').textContent='初始化失败'; document.body.dataset.appReady='error';
    }
  }

  function requestWake() {
    if(!settings.keepAwake||wakeLock||document.hidden||currentSession?.pausedAt||!navigator.wakeLock)return;
    navigator.wakeLock.request('screen').then(lock=>{wakeLock=lock;lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;});}).catch(()=>{});
  }
  function releaseWake(){if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}}
  function showCover(){if(currentSession&&currentSession.phase!=='COMPLETED')pauseSession();$('#privacyCover').classList.add('show');}
  function renderPreferences(){
    document.body.classList.toggle('left-handed',!!settings.leftHanded);
    $('#toggleGestures').textContent='手势：'+(settings.gestures?'开启':'关闭');
    $('#toggleHand').textContent=settings.leftHanded?'左手布局':'右手布局';
    $('#toggleWake').textContent='屏幕常亮：'+(settings.keepAwake?'开启':'关闭');
    DB.getMeta('lastExportAt',null).then(at=>{$('#backupReminder').textContent=at?'上次发起备份：'+formatDateTime(at)+(now()-at>7*DAY_MS?'。建议生成新备份，不能确认上次文件已保存。':'。请自行核对文件保存。'):'尚未生成完整备份。换设备或域名前，请先备份。';});
  }
  function openEvidence(){
    $('#evidenceBody').innerHTML=`<p>${escapeHtml(Content.guidance.plan.text)}</p><p class="small">内容版本 ${Content.version} · 核对 ${Content.checkedAt}</p>`+Object.entries(Content.modules).map(([key,m])=>`<div class="field"><strong>${escapeHtml(EXERCISES[key].name)}</strong><p>${escapeHtml(m.detail)}</p><p class="small">${escapeHtml(m.limitation)}</p><p>${m.sourceIds.map(id=>`<a href="${escapeHtml(Content.sources[id].url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(Content.sources[id].institution)}</a>`).join(' · ')}</p></div>`).join('')+Object.values(Content.guidance).map(g=>`<p class="small">${escapeHtml(g.text)} · ${escapeHtml(g.kind||'健康教育')} ${g.sourceIds.map(id=>`<a href="${escapeHtml(Content.sources[id].url)}" target="_blank" rel="noopener noreferrer">来源</a>`).join(' ')}</p>`).join('')+Object.values(Content.sources).map(source=>`<div class="field"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a><p class="small">${escapeHtml(source.institution)} · ${source.year||'页面未注明年份'} · ${source.checkedAt}</p><p class="small">${escapeHtml(source.supports)}</p></div>`).join('');
    $('#evidenceDialog').showModal();
  }
  function reportAndFilters(){
    const samples=analysisSessions().filter(s=>s.review&&s.endedAt),real=samples.filter(s=>!s.simulated),start=weekStartKey(now()),week=real.filter(s=>weekStartKey(sessionTimestamp(s))===start),usable=week.filter(s=>hasExercise(s,'stop_start')&&dataQuality(s).usableForTrend);
    const plan=Long.active(),tasks=plan?.tasks.filter(t=>weekStartKey(LongPlans.parseDate(t.date).getTime())===start)||[],done=tasks.filter(t=>t.status==='COMPLETED').length;
    const latest=usable.at(-1),same=latest?real.filter(s=>Core.conditionKey(s)===Core.conditionKey(latest)&&hasExercise(s,'stop_start')&&dataQuality(s).usableForTrend).sort((a,b)=>sessionTimestamp(a)-sessionTimestamp(b)):[],recent=same.slice(-3),previous=same.slice(-6,-3);
    let change='同条件前后窗口各不足3条，暂不判断变化。';
    if(recent.length===3&&previous.length===3){const before=average(previous.map(s=>computeMetrics(s).control)),after=average(recent.map(s=>computeMetrics(s).control));if(Number.isFinite(before)&&Number.isFinite(after))change=`同条件最近3次控制感均值 ${after.toFixed(1)}/10，之前3次 ${before.toFixed(1)}/10。仅描述个人记录，不证明训练效果。`;}
    const excluded=week.length-usable.length;
    $('#weeklyReport').innerHTML=`<h2>个人周复盘</h2><p>本周 ${week.length} 次记录 · 主计划 ${done}/${tasks.length} 次完成 · ${usable.length} 条可比较动停记录 · ${excluded} 条不参与动停比较</p><p class="small">${Content.guidance.trend.text}</p><p>值得关注：${escapeHtml(change)}</p><p class="small">下一次：${escapeHtml(Content.modules.stop_start.short)}</p>`;
    const select=(key,label,values)=>`<label>${label}<select class="text-input" data-filter="${key}"><option value="">全部</option>${values.map(([value,text])=>`<option value="${escapeHtml(value)}" ${insightFilter[key]===value?'selected':''}>${escapeHtml(text)}</option>`).join('')}</select></label>`;
    const unique=key=>[...new Set(sessionCache.map(key).filter(Boolean))].map(value=>[value,value]);
    $('#insightFilters').innerHTML=`<details><summary>筛选条件与计时口径</summary>${select('plan','长期计划',Long.meta().longPlans.map(p=>[p.id,p.name]))}${select('stage','阶段',unique(s=>s.planSnapshot?.stageName))}${select('program','单次方案',unique(s=>s.programSnapshot?.name))}${select('mode','提示模式',Object.entries(PROMPT_MODES))}${select('clock','计时口径',[['2','新版有效时钟'],['1','旧版：暂停口径不可靠']])}<label>开始日期<input type="date" class="text-input" data-filter="from" value="${insightFilter.from}"></label><label>结束日期<input type="date" class="text-input" data-filter="to" value="${insightFilter.to}"></label><p class="small">默认仅比较新版计时。选择全部会混合计时口径，仅供浏览，不作前后改善结论。</p></details>`;
  }
  function updateReady(){const training=!!currentSession&&currentSession.phase!=='COMPLETED';$('#applyUpdate').hidden=!waitingWorker||training;$('#applyUpdate').disabled=training;}
  async function registerWorker(){
    if(!('serviceWorker'in navigator))return;
    try{
      const registration=await navigator.serviceWorker.register('./sw.js');
      waitingWorker=registration.waiting;updateReady();
      registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller){waitingWorker=registration.waiting;updateReady();}});});
      navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested&&(!currentSession||currentSession.phase==='COMPLETED'))location.reload();});
    }catch{showToast('离线缓存未启用，请检查 HTTPS 与网络');}
  }
  function bindNewUI(){
    const on=(id,fn)=>$('#'+id).addEventListener('click',()=>Promise.resolve().then(fn).catch(error=>showToast(error.message)));
    on('levelDown',()=>changeArousal(-1));on('levelUp',()=>changeArousal(1));on('explicitStop',()=>confirmStop(true));on('explicitResume',resumeCycle);on('explicitMarker',openQuickMarker);on('explicitFinish',finishSession);
    on('endCheckin',()=>{if(currentSession){currentSession.checkin={stress:+$('#stress').value,fatigue:+$('#fatigue').value,pelvicTension:+$('#tension').value,pain};finishSession();}});
    on('cancelCheckin',async()=>{await DB.clearCurrentSession();currentSession=null;pendingLaunch=null;updateReady();navTo('dashboard');showToast('已取消，原安排保留');});
    on('associateTraining',async()=>{const id=$('#associateTask').value;if(!id||!currentSession)return;const task=Long.tasks().find(t=>t.id===id);if(!task)return;const before=structuredClone(Long.meta()),copy=structuredClone(currentSession);copy.scheduleItemId=id;copy.longPlanId=task.planId;Long.markCompleted(id,copy.id);try{await DB.completeSession(copy,Long.meta());currentSession=copy;sessionCache=sessionCache.map(s=>s.id===copy.id?copy:s);renderSummary();showToast('已关联，实际训练时间保留');}catch(error){Long.hydrate(before);throw error;}});
    on('retrySave',persistCurrentSoon);on('exportCurrent',exportJsonBackup);on('showPrivacy',showCover);on('hidePrivacy',()=>$('#privacyCover').classList.remove('show'));
    on('exportPendingReview',exportJsonBackup);
    for(const [id,key] of [['toggleGestures','gestures'],['toggleHand','leftHanded'],['toggleWake','keepAwake']])on(id,async()=>{settings[key]=!settings[key];await DB.setMeta('settings',settings);renderPreferences();if(key==='keepAwake'){if(settings[key])requestWake();else releaseWake();}});
    on('showEvidence',openEvidence);on('closeEvidence',()=>$('#evidenceDialog').close());
    on('applyUpdate',()=>{if(!currentSession||currentSession.phase==='COMPLETED'){updateRequested=true;waitingWorker?.postMessage({type:'APPLY_UPDATE'});}});
    on('closeBackup',()=>{$('#backupDialog').close();$('#backupPassword').value='';$('#backupPasswordAgain').value='';});
    $('#backupDialog').addEventListener('close',()=>{$('#backupPassword').value='';$('#backupPasswordAgain').value='';});
    $('#restoreDialog').addEventListener('close',()=>{$('#restorePassword').value='';pendingRestore=null;restorePreview=null;});
    $('#backupForm').addEventListener('submit',async event=>{
      event.preventDefault();const button=event.submitter;button.disabled=true;
      try{
        let payload=await backupPayload(),encrypted=$('#backupMode').value==='encrypted';
        if(encrypted){const password=$('#backupPassword').value;if(password!==$('#backupPasswordAgain').value)throw new Error('两次密码不一致');payload=await Backup.encrypt(payload,password);}
        else if(!confirm('明文完整备份包含私密事件和对话。仍要导出吗？'))return;
        downloadBlob(JSON.stringify(payload,null,2),`training-backup-${dateKey()}${encrypted?'-encrypted':''}.json`,'application/json');
        let reminderSaved=true;try{await DB.setMeta('lastExportAt',now());}catch{reminderSaved=false;}$('#backupDialog').close();renderPreferences();showToast('备份已生成并发起下载，请核对文件'+(reminderSaved?'':'；提醒时间未保存'));
      }catch(error){$('#backupError').textContent=error.message;}
      finally{button.disabled=false;$('#backupPassword').value='';$('#backupPasswordAgain').value='';}
    });
    on('closeRestore',()=>{$('#restoreDialog').close();pendingRestore=null;restorePreview=null;$('#restorePassword').value='';});
    $('#restoreMode').addEventListener('change',()=>{restorePreview=null;$('#restoreSubmit').textContent='校验并预览';});
    $('#restoreForm').addEventListener('submit',async event=>{
      event.preventDefault();const button=event.submitter;button.disabled=true;
      try{
        if(!restorePreview){
          const data=pendingRestore.format==='stop-action-encrypted-backup'?await Backup.decrypt(pendingRestore,$('#restorePassword').value):Backup.validate(pendingRestore);
          pendingRestore=data;
          const replace=$('#restoreMode').value==='replace',merged=Backup.merge(sessionCache,data.sessions);
          const templateMerge=Backup.merge(Long.meta().longTemplates,data.meta.longTemplates||[]),planMerge=Backup.merge(Long.meta().longPlans,data.meta.longPlans||[]),localTaskIds=new Set(Long.meta().longPlans.flatMap(p=>p.tasks.map(t=>t.id))),taskConflicts=[];
          const importedPlans=planMerge.sessions.filter(p=>{if(Long.meta().longPlans.some(x=>x.id===p.id))return true;if(p.tasks.some(t=>localTaskIds.has(t.id))){taskConflicts.push(p.id);return false;}return true;}).map(p=>Long.meta().longPlans.some(x=>x.id===p.id)?p:{...p,status:'PAUSED'});
          const conflicts=[...merged.conflicts,...templateMerge.conflicts.map(id=>'模板:'+id),...planMerge.conflicts.map(id=>'计划:'+id),...taskConflicts.map(id=>'任务ID冲突计划:'+id)];
          const meta=replace?data.meta:{...Long.meta(),longTemplates:templateMerge.sessions,longPlans:importedPlans};
          if(replace&&meta.currentSession)meta.currentSession=Core.recover(meta.currentSession);
          if(replace&&(meta.longPlans||[]).length){const chosen=meta.longPlans.find(p=>p.id===meta.activeLongPlanId);meta.longPlans.forEach(p=>{if(p!==chosen&&p.status==='ACTIVE')p.status='PAUSED';});}
          restorePreview={sessions:replace?data.sessions:merged.sessions,meta,replace};
          $('#restoreSummary').textContent=`已校验 ${data.sessions.length} 条记录、${data.meta.longTemplates?.length||0} 个模板、${data.meta.longPlans?.length||0} 个计划。${replace?'将替换本机数据。':'合并后 '+merged.sessions.length+' 条，冲突 '+conflicts.length+' 条，保留本机。冲突ID：'+conflicts.slice(0,20).join('、')}`;
          $('#restorePassword').value='';$('#restorePasswordLabel').hidden=true;$('#restoreSubmit').textContent='确认提交导入';return;
        }
        await DB.importData(restorePreview.sessions,restorePreview.meta,restorePreview.replace);
        $('#restoreDialog').close();showToast('导入已提交，正在重新读取');location.reload();
      }catch(error){$('#restoreError').textContent=error.message;}
      finally{button.disabled=false;}
    });
    let demo={level:2,stop:false,paused:false,done:new Set()};
    const demoRender=()=>{$('#rehearsalLevel').textContent=demo.level;$('#rehearsalHint').textContent=`用＋／－记录感受，Stop后降低等级，再Resume；试试暂停和标记。已体验 ${demo.done.size}/5 项。${demo.paused?'当前暂停。':''}`;};
    on('startRehearsal',()=>{demo={level:2,stop:false,paused:false,done:new Set()};demoRender();$('#rehearsalDialog').showModal();});
    on('demoUp',()=>{if(!demo.paused){demo.level=Math.min(8,demo.level+1);demo.done.add('level');demoRender();}});
    on('demoDown',()=>{if(!demo.paused){demo.level=Math.max(0,demo.level-1);demo.done.add('level');demoRender();}});
    on('demoStop',()=>{if(!demo.paused){demo.stop=true;demo.done.add('stop');demoRender();}});
    on('demoResume',()=>{if(demo.stop&&!demo.paused&&demo.level<=5){demo.stop=false;demo.done.add('resume');demoRender();}else $('#rehearsalHint').textContent='先Stop，降低等级，再继续。';});
    on('demoPause',()=>{demo.paused=!demo.paused;demo.done.add('pause');demoRender();});on('demoMarker',()=>{demo.done.add('marker');demoRender();});
    on('closeRehearsal',async()=>{await DB.setMeta('onboardingDone',true);$('#rehearsalDialog').close();});demoRender();
    $('#insightFilters').addEventListener('change',event=>{const key=event.target.dataset.filter;if(key){insightFilter[key]=event.target.value;renderInsights();reportAndFilters();}});
    const oldRender=renderInsights;renderInsights=()=>{oldRender();reportAndFilters();};
    window.addEventListener('unhandledrejection',()=>{$('#saveStatus').textContent='操作未完成 · 请重试或导出';});
    window.addEventListener('training-db-blocked',()=>showToast('请关闭其他标签页后重试数据库升级'));
    if(typeof BroadcastChannel!=='undefined'){
      const channel=new BroadcastChannel('stop-action-tabs');channel.onmessage=event=>{if(event.data==='hello'){channel.postMessage('present');showToast('已打开多个标签页，请只在一个页面训练');}else if(event.data==='present')showToast('已有其他标签页，请只在一个页面训练');};channel.postMessage('hello');
    }
    $$('input[type="range"]').forEach(input=>{if(!input.getAttribute?.('aria-label'))input.setAttribute('aria-label',input.id);});
    $('#arousal').setAttribute('role','status');$('#arousal').setAttribute('aria-live','polite');
    document.addEventListener('keydown',event=>{
      const sheet=['quickMarkerSheet','finishSheet','privacyCover'].map(id=>$('#'+id)).find(el=>el?.classList.contains('show'));if(!sheet)return;
      if(event.key==='Escape'){event.preventDefault();if(sheet.id==='quickMarkerSheet')closeQuickMarker();else if(sheet.id==='finishSheet')cancelFinishAction();else sheet.classList.remove('show');}
      if(event.key==='Tab'){const controls=[...sheet.querySelectorAll('button,input,select,textarea,a[href]')].filter(el=>!el.disabled);if(!controls.length)return;const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||!sheet.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!sheet.contains(document.activeElement))){event.preventDefault();first.focus();}}
    });
    $('#checkin .screen-title + .muted')?.remove();
    $('#pause .muted').textContent=Content.guidance.pause.text;
    $('#review > .muted').textContent=Content.guidance.review.text;
  }

  function configureBetaTelemetryForTest() { settings.betaTelemetryEnabled=true; betaInstallId='test-install'; betaTelemetry=[]; }
  window.__EC_DEBUG__ = { dataQuality, effectiveCycles, adaptiveEngine, buildCoachContext, coachRuleEngine, validateCoachOutput, externalCoachPayload, localCoachChatReply, sanitizeCoachChatOutput, containsTrainingControlDirective, validateExternalCoachEndpoint, bundledRelayEndpoint, bundledRelayHealthEndpoint, testBundledRelayHealth, coachChatRequest, callExternalCoach, configureExternalCoachForTest, makeSimulatedSession, seededRandom, betaDeviceSnapshot, betaExportPayload, recordBetaEvent, configureBetaTelemetryForTest };
  init();
})();
