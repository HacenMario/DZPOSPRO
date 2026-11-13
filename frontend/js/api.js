/* ============================================================
 * js/api.js — Global authenticated fetch wrapper
 * ------------------------------------------------------------
 * Every API call in the dashboard should go through `apiFetch`.
 * It:
 *   • attaches the Authorization Bearer token from localStorage
 *   • sets JSON Content-Type when a body is provided
 *   • parses the JSON response (or returns text on 204)
 *   • on 401: clears session and redirects to index.html
 *   • on 403: shows a "Permission denied" toast
 *   • on network errors: shows a friendly toast
 * ============================================================ */

(function (global) {
  'use strict';

  // ===== v4.2: LIVE API base (resolved by js/config.js, probed & healed) =====
  // MUST be read at call time — never cached — so a Railway URL change
  // is picked up instantly (fixes mobile "Offline + no data").
  function API_BASE() {
    if (typeof global.dzposApiBase === 'function') return global.dzposApiBase();
    return (global.DZPOS_API_BASE || '').replace(/\/+$/, '');
  }

  // ===== v4.2: app language on EVERY request =====
  // The backend used to read the BROWSER's Accept-Language (often "fr" in
  // Algeria) which made AI/notifications/validation answers ignore the
  // language chosen in the app. We now always send the app language.
  function langHeaders(extra) {
    var h = Object.assign({}, extra || {});
    var lang = '';
    try { lang = (global.currentLang || global.localStorage.getItem('lang') || 'ar').slice(0, 2); } catch (e) { lang = 'ar'; }
    if (!h['Accept-Language']) h['Accept-Language'] = lang + ',ar;q=0.8,en;q=0.6';
    if (!h['x-dzpos-lang']) h['x-dzpos-lang'] = lang;
    return h;
  }

  function getToken() {
    try { return localStorage.getItem('token'); } catch { return null; }
  }

  function clearSession() {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch (_) {}
  }

  function redirectToLogin() {
    if (location.pathname.indexOf('dashboard.html') !== -1) {
      window.location.href = 'index.html?reason=session';
    }
  }

  function t(key, fallback) {
    if (typeof window.t === 'function') return window.t(key, fallback);
    return fallback || key;
  }

  /**
   * Authenticated fetch wrapper.
   * @param {string} url      Relative URL (e.g. '/api/products')
   * @param {object} options  Standard fetch options. `body` may be an object
   *                          (auto-serialized to JSON) or a string/FormData.
   * @returns {Promise<object>} Parsed JSON response.
   *
   * v4.1 hardening (mobile reliability):
   *   • every request gets an AbortController timeout (FETCH_TIMEOUT_MS)
   *     unless the caller passes its own `options.signal`
   *   • GET requests are automatically retried once (GET_RETRY_DELAY_MS)
   *     on network errors / 502-504 — kills the "dashboard empty on mobile
   *     after one flaky request" class of failures
   *   • global connection state: window.dzposApiOnline + the window events
   *     'dzpos:api-offline' / 'dzpos:api-online' so the shell can flip the
   *     connection chip and re-fetch data when the network comes back
   */
  const FETCH_TIMEOUT_MS = 20000;
  const GET_RETRY_DELAY_MS = 900;

  function setApiOnline(on) {
    if (global.dzposApiOnline === on) return;
    global.dzposApiOnline = on;
    try { global.dispatchEvent(new CustomEvent(on ? 'dzpos:api-online' : 'dzpos:api-offline')); } catch (_) {}
  }
  global.dzposApiOnline = true;
  global.dzposSetApiOnline = setApiOnline;

  async function rawFetch(fullUrl, options) {
    const fetchOpts = Object.assign({}, options);
    let ctrl = null, timer = null;
    // v4.1 — enforce a hard timeout on every request unless the caller
    // manages its own AbortSignal.
    if (!fetchOpts.signal && typeof AbortController === 'function') {
      ctrl = new AbortController();
      fetchOpts.signal = ctrl.signal;
      timer = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, FETCH_TIMEOUT_MS);
    }
    let res;
    try {
      res = await fetch(fullUrl, fetchOpts);
      setApiOnline(true);
    } catch (networkErr) {
      // AbortError from our own timeout is a network failure too
      setApiOnline(false);
      throw networkErr;
    } finally {
      if (timer) clearTimeout(timer);
    }
    return res;
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function apiFetch(url, options) {
    options = options || {};
    const token = getToken();

    const headers = langHeaders(options.headers);
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // Auto-serialize plain object bodies
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(body);
    }
    if (options.method && options.method.toUpperCase() !== 'GET' && !headers['Content-Type'] && body && typeof body === 'string') {
      // assume JSON if a raw string was passed without explicit Content-Type
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    // ===== بناء URL كامل (v4.2: base محسوبة لحظة الطلب) =====
    function buildUrl() { return url.startsWith('http') ? url : `${API_BASE()}${url}`; }

    const isGet = !options.method || options.method.toUpperCase() === 'GET';
    const attempts = isGet ? 2 : 1;

    let res;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        res = await rawFetch(buildUrl(), Object.assign({}, options, { headers, body }));
        break;
      } catch (networkErr) {
        const callerAborted = options.signal && networkErr && networkErr.name === 'AbortError';
        if (attempt < attempts && !callerAborted) {
          // v4.2 — the configured server may have MOVED (Railway redeploy).
          // Re-probe candidates once; if the base changed, retry immediately
          // against the new one, otherwise wait and retry normally.
          let baseChanged = false;
          try {
            if (typeof window.dzposReresolveApi === 'function' && !url.startsWith('http')) {
              const oldBase = API_BASE();
              await window.dzposReresolveApi();
              baseChanged = API_BASE() !== oldBase;
            }
          } catch (_) { /* keep old base */ }
          if (!baseChanged) await delay(GET_RETRY_DELAY_MS);
          continue;
        }
        console.error('[apiFetch] network error:', networkErr);
        if (typeof window.Toast === 'object' && window.Toast.error) {
          window.Toast.error(t('networkError', 'لا يمكن الاتصال بالخادم'));
        }
        throw networkErr;
      }
    }

    // 401 — session expired / not authenticated
    if (res.status === 401) {
      clearSession();
      if (typeof window.Toast === 'object' && window.Toast.warning) {
        window.Toast.warning(t('sessionExpired', 'انتهت الجلسة. يرجى إعادة تسجيل الدخول.'));
      }
      redirectToLogin();
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }

    // 403 — forbidden
    if (res.status === 403) {
      if (typeof window.Toast === 'object' && window.Toast.error) {
        window.Toast.error(t('permissionDenied', 'ليس لديك صلاحية لتنفيذ هذا الإجراء'));
      }
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }

    // 204 No Content
    if (res.status === 204) return { success: true };

    // Parse JSON (best-effort)
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') !== -1) {
      data = await res.json().catch(() => null);
    } else {
      const text = await res.text();
      if (text) {
        try { data = JSON.parse(text); } catch { data = { success: res.ok, message: text }; }
      } else {
        data = { success: res.ok };
      }
    }

    if (!res.ok) {
      const message = (data && (data.message || data.error)) || ('HTTP ' + res.status);
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  // Convenience HTTP-method helpers
  // GET requests use cache: 'no-store' so dashboard/reports/invoices always
  // reflect fresh data after a sale (browsers may otherwise serve stale 304s).
  apiFetch.get    = (url, qs)  => apiFetch(qs ? url + '?' + new URLSearchParams(qs).toString() : url, { method: 'GET', cache: 'no-store' });
  apiFetch.post   = (url, b, o) => apiFetch(url, Object.assign({ method: 'POST',   body: b }, o || {}));
  apiFetch.put    = (url, b, o) => apiFetch(url, Object.assign({ method: 'PUT',    body: b }, o || {}));
  apiFetch.patch  = (url, b, o) => apiFetch(url, Object.assign({ method: 'PATCH',  body: b }, o || {}));
  apiFetch.delete = (url, o)    => apiFetch(url, Object.assign({ method: 'DELETE' }, o || {}));

  /**
   * Resolve a backend asset path (e.g. "/uploads/1698-123.jpg") to an
   * absolute URL. The backend stores RELATIVE paths, so when the frontend
   * is served from a different origin (Vercel) a bare <img src="/uploads/…">
   * resolves to the FRONTEND origin and shows a broken-image icon.
   * Prefixing with API_BASE fixes product images everywhere.
   */
  function resolveAssetUrl(path) {
    if (!path || typeof path !== 'string') return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
    if (path.startsWith('/uploads/')) return API_BASE() + path;
    return path;
  }

  apiFetch.resolveAssetUrl = resolveAssetUrl;
  global.apiFetch = apiFetch;
  global.resolveAssetUrl = resolveAssetUrl;
})(window);
