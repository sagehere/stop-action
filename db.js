(() => {
  'use strict';

  const DB_NAME = 'ec-training-db';
  const DB_VERSION = 2;
  const SESSION_STORE = 'sessions';
  const KV_STORE = 'kv';
  let db = null;
  let writeQueue = Promise.resolve();

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const sessions = database.createObjectStore(SESSION_STORE, { keyPath: 'id' });
          sessions.createIndex('endedAt', 'endedAt', { unique: false });
          sessions.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!database.objectStoreNames.contains(KV_STORE)) {
          database.createObjectStore(KV_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB'));
      request.onblocked = () => {const status=document.getElementById('dbStatus');if(status)status.textContent='数据库升级受阻，请关闭其他标签页后重试';window.dispatchEvent(new CustomEvent('training-db-blocked'));};
    });
  }

  function enqueueWrite(task) {
    const run = () => task();
    writeQueue = writeQueue.then(run, run);
    return writeQueue;
  }

  async function rawGetMeta(key) {
    const tx = db.transaction(KV_STORE, 'readonly');
    const done = transactionDone(tx);
    const row = await requestToPromise(tx.objectStore(KV_STORE).get(key));
    await done;
    return row ? row.value : undefined;
  }

  async function rawSetMeta(key, value) {
    const tx = db.transaction(KV_STORE, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(KV_STORE).put({ key, value, updatedAt: Date.now() });
    await done;
  }

  async function migrateLegacyLocalStorage() {
    const migrated = await rawGetMeta('legacy-v1-migrated');
    if (migrated) return;

    let importedSessions = 0;
    try {
      const legacy = JSON.parse(localStorage.getItem('ec-training-prototype-v1') || '[]');
      if (Array.isArray(legacy) && legacy.length) {
        const tx = db.transaction(SESSION_STORE, 'readwrite');
        const store = tx.objectStore(SESSION_STORE);
        legacy.forEach(session => {
          if (session && session.id) {
            store.put(session);
            importedSessions += 1;
          }
        });
        await transactionDone(tx);
      }
    } catch (error) { throw new Error('旧训练迁移失败，原数据已保留：' + error.message); }

    try {
      const pending = JSON.parse(localStorage.getItem('ec-current-session') || 'null');
      if (pending && pending.id) await rawSetMeta('currentSession', pending);
    } catch (error) { throw new Error('旧当前训练迁移失败，原数据已保留：' + error.message); }

    try {
      const settings = JSON.parse(localStorage.getItem('ec-training-settings-v1') || 'null');
      if (settings) await rawSetMeta('settings', settings);
    } catch (error) { throw new Error('旧设置迁移失败，原数据已保留：' + error.message); }

    await rawSetMeta('legacy-v1-migrated', { at: Date.now(), importedSessions });
    localStorage.removeItem('ec-training-prototype-v1');
    localStorage.removeItem('ec-current-session');
    localStorage.removeItem('ec-training-settings-v1');
  }

  async function init() {
    if (!('indexedDB' in window)) throw new Error('This browser does not support IndexedDB');
    db = await openDatabase();
    db.onversionchange = () => { db.close(); window.dispatchEvent(new CustomEvent('training-db-blocked')); };
    await migrateLegacyLocalStorage();
    return true;
  }

  async function getAllSessions() {
    const tx = db.transaction(SESSION_STORE, 'readonly');
    const done = transactionDone(tx);
    const rows = await requestToPromise(tx.objectStore(SESSION_STORE).getAll());
    await done;
    return (rows || []).sort((a, b) => (a.endedAt || a.createdAt || 0) - (b.endedAt || b.createdAt || 0));
  }

  function putSession(session) {
    const snapshot=structuredClone(session);
    return enqueueWrite(async () => {
      const tx = db.transaction(SESSION_STORE, 'readwrite');
      tx.objectStore(SESSION_STORE).put(snapshot);
      await transactionDone(tx);
    });
  }

  function deleteSession(id, meta = {}) {
    const values = structuredClone(meta);
    return enqueueWrite(async () => {
      const tx = db.transaction([SESSION_STORE, KV_STORE], 'readwrite');
      tx.objectStore(SESSION_STORE).delete(id);
      const kv = tx.objectStore(KV_STORE);
      Object.entries(values).forEach(([key,value])=>kv.put({key,value,updatedAt:Date.now()}));
      await transactionDone(tx);
    });
  }

  async function getMeta(key, fallback = undefined) {
    const value = await rawGetMeta(key);
    return value === undefined ? fallback : value;
  }

  function setMeta(key, value) {
    const snapshot = structuredClone(value);
    return enqueueWrite(() => rawSetMeta(key, snapshot));
  }

  function deleteMeta(key) {
    return enqueueWrite(async () => {
      const tx = db.transaction(KV_STORE, 'readwrite');
      tx.objectStore(KV_STORE).delete(key);
      await transactionDone(tx);
    });
  }

  function changeCurrentSession(tx, change) {
    const done = transactionDone(tx);
    const store = tx.objectStore(KV_STORE);
    const request = store.get('currentSession');
    let failure;
    // Queue writes while the IndexedDB request handler still owns the active transaction.
    request.onsuccess = () => {
      try { change(request.result?.value,store); }
      catch (error) {
        failure = error;
        tx.abort();
      }
    };
    return done.catch(error=>{throw failure || error;});
  }

  function writeCurrentSession(session, starting) {
    const snapshot = structuredClone(session);
    return enqueueWrite(() => changeCurrentSession(db.transaction(KV_STORE,'readwrite'),(existing,store)=>{
      if (starting ? existing : existing?.id !== snapshot.id) throw new Error('当前训练已在其他页面更新');
      store.put({key:'currentSession',value:snapshot,updatedAt:Date.now()});
    }));
  }

  function startSession(session) { return writeCurrentSession(session, true); }
  function setCurrentSession(session) { return writeCurrentSession(session, false); }
  function getCurrentSession() { return getMeta('currentSession', null); }

  function clearCurrentSession(id) {
    return enqueueWrite(() => changeCurrentSession(db.transaction(KV_STORE,'readwrite'),(existing,store)=>{
      if (existing?.id === id) store.delete('currentSession');
    }));
  }

  function clearTrainingData() {
    return enqueueWrite(async () => {
      const tx = db.transaction([SESSION_STORE, KV_STORE], 'readwrite');
      tx.objectStore(SESSION_STORE).clear();
      const kv = tx.objectStore(KV_STORE);
      kv.delete('currentSession');
      kv.delete('plan');
      kv.delete('adaptiveDecision');
      kv.delete('adaptiveHistory');
      kv.delete('simulationAdaptiveHistory');
      kv.delete('coachHistory');
      kv.delete('coachChatMessages');
      kv.delete('acceptanceResults');
      kv.delete('betaTelemetry');
      kv.delete('betaInstallId');
      for (const key of ['customPrograms','longTemplates','longPlans','activeLongPlanId','acceptedParameters','parameterHistory','migration-long-v1']) kv.delete(key);
      await transactionDone(tx);
    });
  }

  function importData(sessions, meta, replace = false, planWrite = null) {
    const rows = structuredClone(sessions), values = structuredClone(meta);
    return enqueueWrite(async () => {
      const tx = db.transaction([SESSION_STORE, KV_STORE], 'readwrite');
      const done = transactionDone(tx), store = tx.objectStore(SESSION_STORE), kv = tx.objectStore(KV_STORE);
      try {
        if (planWrite) {
          const entries = Object.entries(planWrite.expected);
          const [pending, ...saved] = await Promise.all(
            ['currentSession', ...entries.map(([key]) => key)].map(key => requestToPromise(kv.get(key)))
          );
          if (entries.some(([, value], index) => JSON.stringify(saved[index]?.value ?? (Array.isArray(value) ? [] : null)) !== JSON.stringify(value))) {
            throw new Error('安排已在其他页面更新，请查看当前安排后再试');
          }
          if (pending?.value && pending.value.id !== planWrite.sessionId) {
            throw new Error('另一个页面有未结束的训练，请结束后再调整安排');
          }
        }
        if (replace) { store.clear(); kv.clear(); }
        rows.forEach(row => store.put(row));
        Object.entries(values).forEach(([key, value]) => kv.put({ key, value, updatedAt: Date.now() }));
      } catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
      await done;
    });
  }
  function completeSession(session, meta = {}, finishPending = true) {
    const snapshot = structuredClone(session), values = structuredClone(meta);
    return enqueueWrite(async () => {
      const tx = db.transaction([SESSION_STORE, KV_STORE], 'readwrite');
      const write = store => {
        tx.objectStore(SESSION_STORE).put(snapshot);
        Object.entries(values).forEach(([key,value])=>store.put({key,value,updatedAt:Date.now()}));
      };
      if (finishPending) {
        return changeCurrentSession(tx,(existing,store)=>{
          if (existing?.id !== snapshot.id) throw new Error('当前训练已在其他页面结束或更新');
          store.delete('currentSession');
          write(store);
        });
      }
      const done = transactionDone(tx);
      try { write(tx.objectStore(KV_STORE)); }
      catch (error) { tx.abort(); await done.catch(()=>{}); throw error; }
      await done;
    });
  }

  window.TrainingDB = {
    init,
    getAllSessions,
    putSession,
    deleteSession,
    getMeta,
    setMeta,
    deleteMeta,
    startSession, setCurrentSession,
    getCurrentSession,
    clearCurrentSession,
    clearTrainingData, importData, completeSession
  };
})();
