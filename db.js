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
    } catch (_) {}

    try {
      const pending = JSON.parse(localStorage.getItem('ec-current-session') || 'null');
      if (pending && pending.id) await rawSetMeta('currentSession', pending);
    } catch (_) {}

    try {
      const settings = JSON.parse(localStorage.getItem('ec-training-settings-v1') || 'null');
      if (settings) await rawSetMeta('settings', settings);
    } catch (_) {}

    await rawSetMeta('legacy-v1-migrated', { at: Date.now(), importedSessions });
    localStorage.removeItem('ec-training-prototype-v1');
    localStorage.removeItem('ec-current-session');
    localStorage.removeItem('ec-training-settings-v1');
  }

  async function init() {
    if (!('indexedDB' in window)) throw new Error('This browser does not support IndexedDB');
    db = await openDatabase();
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
    return enqueueWrite(async () => {
      const tx = db.transaction(SESSION_STORE, 'readwrite');
      tx.objectStore(SESSION_STORE).put(structuredClone(session));
      await transactionDone(tx);
    });
  }

  function deleteSession(id) {
    return enqueueWrite(async () => {
      const tx = db.transaction(SESSION_STORE, 'readwrite');
      tx.objectStore(SESSION_STORE).delete(id);
      await transactionDone(tx);
    });
  }

  async function getMeta(key, fallback = undefined) {
    const value = await rawGetMeta(key);
    return value === undefined ? fallback : value;
  }

  function setMeta(key, value) {
    return enqueueWrite(() => rawSetMeta(key, structuredClone(value)));
  }

  function deleteMeta(key) {
    return enqueueWrite(async () => {
      const tx = db.transaction(KV_STORE, 'readwrite');
      tx.objectStore(KV_STORE).delete(key);
      await transactionDone(tx);
    });
  }

  function setCurrentSession(session) {
    return setMeta('currentSession', session);
  }

  async function getCurrentSession() {
    return getMeta('currentSession', null);
  }

  function clearCurrentSession() {
    return deleteMeta('currentSession');
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
      await transactionDone(tx);
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
    setCurrentSession,
    getCurrentSession,
    clearCurrentSession,
    clearTrainingData
  };
})();
