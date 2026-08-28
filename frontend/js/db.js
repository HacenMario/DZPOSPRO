/* ============================================================
 * js/db.js — OfflineDB stub (legacy compat)
 * ------------------------------------------------------------
 * The previous IndexedDB-backed offline subsystem was never
 * loaded and used malformed ES module syntax. This file is now
 * a no-op stub kept only for forward compatibility. It is NOT
 * loaded by index.html or dashboard.html.
 *
 * Future agents: if you implement a real offline queue, replace
 * the bodies below — the public API is:
 *   window.OfflineDB.addPendingSale(data)
 *   window.OfflineDB.getPendingSales()
 *   window.OfflineDB.removePendingSale(id)
 *   window.OfflineDB.clearAllPending()
 *   window.syncPendingSales()
 * ============================================================ */

(function (global) {
  'use strict';

  const NOT_IMPLEMENTED = function () {
    console.warn('[db] OfflineDB is not implemented — call ignored.');
    return Promise.resolve(null);
  };

  const OfflineDB = {
    addPendingSale:     NOT_IMPLEMENTED,
    getPendingSales:    () => Promise.resolve([]),
    removePendingSale:  NOT_IMPLEMENTED,
    clearAllPending:    NOT_IMPLEMENTED,
    isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true)
  };

  global.OfflineDB = OfflineDB;
  global.syncPendingSales = function () {
    // No-op stub for forward compatibility with app.js listeners.
    return Promise.resolve();
  };
})(window);
