/* ============================================================
 * js/config.js — v4.2 Resilient API base resolution
 * ------------------------------------------------------------
 * ONE source of truth for "where is the backend?".
 * Every other script must use window.dzposApiBase() at call time
 * (NEVER cache the value in a const) so a mid-session server
 * switch is picked up instantly.
 *
 * Resolution order:
 *   1. localStorage 'dzpos_api_base'   → explicit user override (highest)
 *   2. window.DZPOS_API_BASE           → pre-configured constant
 *   3. same origin                      → when served by the backend itself
 *   4. probe known candidates           → the live Railway URL list
 *
 * v4.2 behaviour (fixes "Offline + no data on mobile"):
 *   • At startup the resolver probes each candidate with GET /api/health
 *     (3.5 s timeout) and keeps the first healthy one.
 *   • The winner is remembered in localStorage 'dzpos_api_base_resolved'.
 *   • If a request later fails with a NETWORK error, api.js triggers
 *     dzposReresolveApi() which re-probes — the app heals itself when
 *     the Railway URL changes (new deployment) without any user action.
 *   • window.dzposApiCandidates() exposes the list for the Connection
 *     Doctor in Settings → Connection.
 * ============================================================ */
(function (global) {
  'use strict';

  // Known backend deployments — first healthy candidate wins.
  var CANDIDATES = [
    'https://dzpospro-production-ec3f34a9.up.railway.app'
  ];
  // v4.2.1 — saved bases pointing here are wiped WITHOUT probing. The old
  // Railway domain now 404s WITH no CORS headers, so every request to it
  // throws a network error ("تعذّر الوصول إلى الخادم" on login, Offline
  // chip on the dashboard) — even after the user cleared browser HISTORY
  // (history clearing does NOT remove localStorage / service workers).
  var KNOWN_DEAD = [
    'https://dzpospro-production.up.railway.app'
  ];
  var LS_OVERRIDE = 'dzpos_api_base';
  var LS_RESOLVED = 'dzpos_api_base_resolved';

  function stripSlash(s) { return String(s || '').replace(/\/+$/, ''); }

  function getOverride() {
    try {
      var o = global.localStorage.getItem(LS_OVERRIDE) || global.DZPOS_API_BASE || '';
      return o ? stripSlash(o) : '';
    } catch (e) { return global.DZPOS_API_BASE ? stripSlash(global.DZPOS_API_BASE) : ''; }
  }

  function getRemembered() {
    try { return stripSlash(global.localStorage.getItem(LS_RESOLVED) || ''); } catch (e) { return ''; }
  }

  function staticBase() {
    var o = getOverride();
    if (o) return o;
    var r = getRemembered();
    if (r) return r;
    if (location.protocol === 'file:') return CANDIDATES[0];
    if (/(^|\.)vercel\.app$/i.test(location.hostname || '')) return CANDIDATES[0];
    return stripSlash(location.origin || '');
  }

  var resolved = staticBase();

  function apiBase() { return resolved; }

  function setResolved(base, persist) {
    var next = stripSlash(base);
    if (next === resolved) return resolved;
    resolved = next;
    if (persist) {
      try { global.localStorage.setItem(LS_RESOLVED, resolved); } catch (e) { /* private mode */ }
    }
    try {
      global.dispatchEvent(new CustomEvent('dzpos:apibase-changed', { detail: { base: resolved } }));
    } catch (e) { /* old browsers */ }
    return resolved;
  }

  /* Probe a candidate: resolves true when /api/health answers
     success:true within `timeout` ms. */
  function probe(url, timeout) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (ok) { if (!done) { done = true; resolve(ok); } };
      var tm = setTimeout(function () { finish(false); }, timeout || 3500);
      var target = stripSlash(url) + '/api/health?t=' + Date.now();
      try {
        fetch(target, { cache: 'no-store' }).then(function (r) {
          if (!r || !r.ok) { clearTimeout(tm); finish(false); return; }
          r.json().then(function (j) {
            clearTimeout(tm);
            finish(!!(j && j.success !== false));
          }).catch(function () { clearTimeout(tm); finish(false); });
        }).catch(function () { clearTimeout(tm); finish(false); });
      } catch (_) { clearTimeout(tm); finish(false); }
    });
  }

  /* Full resolution pass. Returns the winning base (may be '' when
     offline — the app then shows its proper offline state). */
  async function resolveApiBase(opts) {
    opts = opts || {};
    // 0 — v4.2.1: purge known-dead saved bases first (no network needed)
    purgeDeadSaved();
    // 1 — explicit override wins; verify it unless asked not to
    var o = (function () { try { return stripSlash(global.localStorage.getItem(LS_OVERRIDE) || ''); } catch (e) { return ''; } })();
    if (o) {
      setResolved(o, false);
      if (opts.verify === false) return resolved;
      var okOverride = await probe(o);
      if (okOverride) { setResolved(o, true); return resolved; }
      // v4.2.1 — the override is UNREACHABLE. Never return a dead base:
      // wipe it and fall through to the candidate list so the app heals
      // itself (root fix for "login unreachable + Offline after the
      // Railway URL changed, even after clearing browser history").
      try { global.localStorage.removeItem(LS_OVERRIDE); } catch (e) { /* private mode */ }
    }
    // 2 — build candidate list: same-origin (non-Vercel), remembered, known list
    var list = [];
    var isVercel = /(^|\.)vercel\.app$/i.test(location.hostname || '');
    if ((location.protocol === 'http:' || location.protocol === 'https:') && !isVercel) list.push('');
    var remembered = getRemembered();
    if (remembered && list.indexOf(remembered) === -1) list.push(remembered);
    CANDIDATES.forEach(function (c) { if (list.indexOf(c) === -1) list.push(c); });
    // 3 — probe in order (remembered first → fastest on known-good phones)
    for (var i = 0; i < list.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      var ok = await probe(list[i]);
      if (ok) return setResolved(list[i], true);
    }
    // 4 — v4.2.1: nothing healthy → last resort is the first known
    // candidate (never a stale remembered/override value that just failed).
    return setResolved(CANDIDATES[0] || '', false);
  }

  /* Manual override management (Connection Doctor) */
  function setOverride(base) {
    var v = stripSlash(base);
    try {
      if (v) global.localStorage.setItem(LS_OVERRIDE, v);
      else global.localStorage.removeItem(LS_OVERRIDE);
    } catch (e) { return false; }
    return setResolved(v || '', false);
  }
  function clearOverride() { return setOverride(''); }
  function candidates() { return CANDIDATES.slice(); }

  /* v4.2.1 — instantly purge saved bases (override + remembered) that point
     to a known-dead host. Runs before any network activity so a device that
     still stores the old Railway URL heals on the very next page load. */
  function purgeDeadSaved() {
    try {
      var o = global.localStorage.getItem(LS_OVERRIDE);
      if (o && KNOWN_DEAD.indexOf(stripSlash(o)) !== -1) global.localStorage.removeItem(LS_OVERRIDE);
      var r = global.localStorage.getItem(LS_RESOLVED);
      if (r && KNOWN_DEAD.indexOf(stripSlash(r)) !== -1) global.localStorage.removeItem(LS_RESOLVED);
    } catch (e) { /* private mode */ }
  }

  /* Exports */
  global.dzposApiBase = apiBase;
  global.dzposResolveApiBase = resolveApiBase;
  global.dzposReresolveApi = function () { return resolveApiBase({ verify: true }); };
  global.dzposApiSetOverride = setOverride;
  global.dzposApiClearOverride = clearOverride;
  global.dzposApiCandidates = candidates;
  global.dzposApiProbe = probe;
  global.DZPOS_API_BASE = resolved; // back-compat snapshot (never used as live value)

  // v4.3.1 — ONE source of truth for the app version. pwa.js compares the
  // RUNNING service worker's version against this: a mismatch means a stale
  // worker → unregister + reload. Keeping it here (instead of a hardcoded
  // constant in pwa.js) makes the check correct in EVERY future release and
  // fixes the v4.2.0 hardcode that silently unregistered the CURRENT worker
  // on every load — which killed Web Push notifications in the background.
  global.DZPOS_VERSION = '4.5.0';

  // Kick off the first resolution as soon as possible (non-blocking).
  if (typeof Promise !== 'undefined') {
    try { resolveApiBase({ verify: true }); } catch (e) { /* noop */ }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = resolved;
})(typeof window !== 'undefined' ? window : globalThis);
