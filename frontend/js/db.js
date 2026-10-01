/* ============================================================
 * js/db.js — OfflineDB: real IndexedDB offline subsystem (v3)
 * ------------------------------------------------------------
 * Replaces the legacy stub. Provides:
 *   • Pending-operations queue (offline sales / customers / …)
 *     that is replayed automatically when connectivity returns.
 *   • Generic key-value cache for "last known good" data.
 *
 * Global API (window.OfflineDB):
 *   await OfflineDB.init()
 *   await OfflineDB.addPendingOp({ url, method, body, kind, label })
 *   await OfflineDB.getPendingOps()
 *   await OfflineDB.removePendingOp(id)
 *   await OfflineDB.clearPending()
 *   await OfflineDB.pendingCount()
 *   await OfflineDB.cachePut(key, value)
 *   await OfflineDB.cacheGet(key)
 *
 * Events (dispatched on window):
 *   'offlinequeue:changed'  { count }   — queue size changed
 *   'offlinequeue:replay'   { done, failed }  — after a replay pass
 * ============================================================ */

(function (global) {
  'use strict';

  const DB_NAME = 'dzpospro-offline';
  const DB_VERSION = 1;
  const STORE_OPS = 'pendingOps';
  const STORE_CACHE = 'cache';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_OPS)) {
          const ops = db.createObjectStore(STORE_OPS, { keyPath: 'id', autoIncrement: true });
          ops.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode) {
    return openDB().then(db => db.transaction(store, mode).objectStore(store));
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function emit(name, detail) {
    try { global.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
  }

  const OfflineDB = {
    async init() { await openDB(); },

    /* ---------- pending operations queue ---------- */
    async addPendingOp(op) {
      const store = await tx(STORE_OPS, 'readwrite');
      const doc = {
        url: op.url,
        method: op.method || 'POST',
        headers: op.headers || null,          // extra headers (JSON body auto set on replay)
        body: op.body || null,                 // object → JSON on replay
        kind: op.kind || 'sale',               // sale | customer | other
        label: op.label || '',
        createdAt: Date.now(),
        tries: 0
      };
      const id = await wrap(store.add(doc));
      emit('offlinequeue:changed', { count: await OfflineDB.pendingCount() });
      return id;
    },

    async getPendingOps() {
      const store = await tx(STORE_OPS, 'readonly');
      const all = await wrap(store.getAll());
      return (all || []).sort((a, b) => a.createdAt - b.createdAt);
    },

    async removePendingOp(id) {
      const store = await tx(STORE_OPS, 'readwrite');
      await wrap(store.delete(id));
      emit('offlinequeue:changed', { count: await OfflineDB.pendingCount() });
    },

    async clearPending() {
      const store = await tx(STORE_OPS, 'readwrite');
      await wrap(store.clear());
      emit('offlinequeue:changed', { count: 0 });
    },

    async pendingCount() {
      const store = await tx(STORE_OPS, 'readonly');
      return await wrap(store.count());
    },

    /* ---------- generic cache ---------- */
    async cachePut(key, value) {
      const store = await tx(STORE_CACHE, 'readwrite');
      await wrap(store.put({ key, value, at: Date.now() }));
    },

    async cacheGet(key) {
      const store = await tx(STORE_CACHE, 'readonly');
      const hit = await wrap(store.get(key));
      return hit ? hit.value : null;
    },

    /* ---------- replay queue (called by pwa.js on online / sync) ---------- */
    async replayPending(token, apiBase) {
      const ops = await OfflineDB.getPendingOps();
      let done = 0, failed = 0;
      for (const op of ops) {
        try {
          const headers = Object.assign(
            { 'Content-Type': 'application/json' },
            token ? { 'Authorization': 'Bearer ' + token } : {},
            op.headers || {}
          );
          const url = (op.url && op.url.startsWith('http')) ? op.url : (apiBase + op.url);
          const res = await fetch(url, {
            method: op.method,
            headers,
            body: op.body ? JSON.stringify(op.body) : undefined
          });
          if (res.ok) {
            await OfflineDB.removePendingOp(op.id);
            done++;
          } else if (res.status === 400 || res.status === 409 || res.status === 422) {
            // unrecoverable (duplicate sale number etc.) — drop it, don't retry forever
            await OfflineDB.removePendingOp(op.id);
            failed++;
          } else {
            failed++; // 401/403/5xx → keep for later (or session issue)
            if (res.status === 401) break; // stop replaying with a dead session
          }
        } catch (_) {
          failed++;
          break; // still offline — stop early
        }
      }
      if (done || failed) {
        emit('offlinequeue:replay', { done, failed });
        if (done && typeof Toast !== 'undefined' && Toast.success) {
          Toast.success((global.t ? global.t('offlineSynced', 'تمت مزامنة العمليات المحلية') : 'Synced') + ' ✓ ' + done);
        }
      }
      return { done, failed };
    }
  };

  global.OfflineDB = OfflineDB;
})(window);
