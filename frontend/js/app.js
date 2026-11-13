/* ============================================================
 * js/app.js — Login page (index.html) logic ONLY
 * ------------------------------------------------------------
 * Responsibilities:
 *   • restore theme + language on DOMContentLoaded
 *   • wire the theme toggle (SVG icon swap)
 *   • wire the language selector
 *   • wire the password show/hide toggle
 *   • submit the login form via apiFetch and redirect
 *
 * This file is loaded ONLY on index.html. The dashboard uses
 * js/dashboard.js instead.
 * ============================================================ */

(function () {
  'use strict';

  // ===== v4.2: LIVE API base (js/config.js resolves + heals) =====
  const API_BASE = () => (typeof window.dzposApiBase === 'function'
    ? window.dzposApiBase()
    : (window.DZPOS_API_BASE || '').replace(/\/+$/, ''));
  
  /* ---------- Theme ---------- */
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (_) {}
    updateThemeIcon(theme);
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  function updateThemeIcon(theme) {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const sun = btn.querySelector('.icon-sun');
    const moon = btn.querySelector('.icon-moon');
    if (!sun || !moon) return;
    if (theme === 'dark') {
      sun.style.display = 'none';
      moon.style.display = 'block';
    } else {
      sun.style.display = 'block';
      moon.style.display = 'none';
    }
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(cur === 'dark' ? 'light' : 'dark');
  }

  /* ---------- Language ---------- */
  function setLanguage(lang) {
    try { localStorage.setItem('lang', lang); } catch (_) {}
    if (typeof window.setLanguage === 'function') {
      // i18n.js global — re-renders DOM
      window.setLanguage(lang);
    } else {
      // Fallback: reload
      location.reload();
    }
  }

  /* ---------- Login submit ---------- */
  function showLoginError(message) {
    const box = document.getElementById('loginError');
    const msg = document.getElementById('loginErrorMsg');
    if (!box || !msg) { alert(message); return; }
    msg.textContent = message;
    box.classList.add('show');
    setTimeout(() => box.classList.remove('show'), 5000);
  }

  function clearLoginError() {
    const box = document.getElementById('loginError');
    if (box) box.classList.remove('show');
  }

  function setLoading(loading) {
    const btn = document.getElementById('loginBtn');
    if (!btn) return;
    if (loading) {
      btn.classList.add('is-loading');
      btn.disabled = true;
      const label = btn.querySelector('.btn-label');
      if (label && typeof window.t === 'function') label.textContent = window.t('loginSigningIn', 'جاري الدخول...');
    } else {
      btn.classList.remove('is-loading');
      btn.disabled = false;
      const label = btn.querySelector('.btn-label');
      if (label && typeof window.t === 'function') label.textContent = window.t('loginBtn', 'تسجيل الدخول');
    }
  }

  // v4.2.1 — one login attempt. Throws ONLY on network-level errors
  // (fetch threw); HTTP-level failures return { failed: true, msg }.
  async function attemptLogin(email, password) {
    const res = await fetch(`${API_BASE()}/api/auth/login`, {
      method: 'POST',
      headers: (function () {
        // v4.2 — send the app language so backend validation messages follow it
        var h = { 'Content-Type': 'application/json' };
        var lang = 'ar';
        try { lang = (window.currentLang || localStorage.getItem('lang') || 'ar').slice(0, 2); } catch (_) {}
        h['Accept-Language'] = lang;
        h['x-dzpos-lang'] = lang;
        return h;
      })(),
      body: JSON.stringify({ email, password })
    });
    let data = null;
    try { data = await res.json(); } catch (_) { data = {}; }

    // Backend envelope: { success, message, data: { token, user } }
    const payload = (data && data.data && data.data.token) ? data.data : data;
    if (res.ok && payload && payload.token) {
      try {
        localStorage.setItem('token', payload.token);
        localStorage.setItem('user', JSON.stringify(payload.user || {}));
      } catch (_) {}
      if (typeof window.Toast !== 'undefined' && window.Toast.success) {
        window.Toast.success(window.t ? window.t('loginSuccess', 'تم تسجيل الدخول بنجاح') : 'Login successful');
      }
      // Brief delay so the toast can show before redirect
      // v3.2 — super-admin lands directly on the platform console
      const role = payload.user && payload.user.role;
      setTimeout(() => {
        window.location.href = role === 'superadmin' ? 'dashboard.html#platform' : 'dashboard.html';
      }, 250);
      return { ok: true };
    }

    // Build a helpful message. If the backend returned validation errors,
    // surface the first field-level message instead of the generic "Validation failed".
    let msg = (data && (data.message || data.error)) || (window.t ? window.t('loginFailed', 'فشل تسجيل الدخول') : 'Login failed');
    if (data && Array.isArray(data.errors) && data.errors.length) {
      msg = data.errors[0].message || msg;
    }
    return { ok: false, failed: true, msg };
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    clearLoginError();
    const emailEl = document.getElementById('email');
    const passwordEl = document.getElementById('password');
    const email = (emailEl.value || '').trim();
    const password = (passwordEl.value || '').trim();
    if (!email || !password) {
      showLoginError(window.t ? window.t('loginFillFields', 'يرجى إدخال البريد وكلمة المرور') : 'Please fill all fields');
      return;
    }

    setLoading(true);
    let outcome = null;
    try {
      outcome = await attemptLogin(email, password);
    } catch (err) {
      console.error('[login] error', err);
      // v4.2.1 — self-heal: a stale/dead API base saved on the device (e.g.
      // the OLD Railway URL) throws a network error here. Re-resolve the
      // base and retry ONCE automatically before telling the user anything.
      let baseChanged = false;
      try {
        if (typeof window.dzposReresolveApi === 'function') {
          const oldBase = API_BASE();
          await window.dzposReresolveApi();
          baseChanged = API_BASE() !== oldBase;
        }
      } catch (_) { /* keep whatever base we have */ }
      if (baseChanged) {
        console.info('[login] API base healed →', API_BASE(), '— retrying login');
        try { outcome = await attemptLogin(email, password); } catch (err2) {
          console.error('[login] retry error', err2);
        }
      }
    }
    setLoading(false);
    if (!outcome) {
      showLoginError(window.t ? window.t('loginServerUnreachable', 'تعذّر الوصول إلى الخادم') : 'Cannot reach server');
    } else if (outcome.failed) {
      showLoginError(outcome.msg);
    }
  }

  /* ---------- Password visibility ---------- */
  function wirePasswordToggle() {
    const btn = document.getElementById('pwToggle');
    const input = document.getElementById('password');
    if (!btn || !input) return;
    const eye = btn.querySelector('.icon-eye');
    const eyeOff = btn.querySelector('.icon-eye-off');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      if (eye && eyeOff) {
        eye.style.display = show ? 'none' : 'block';
        eyeOff.style.display = show ? 'block' : 'none';
      }
    });
  }

  /* ---------- v4.1 — real server status on the login page ----------
   * The green dot used to be purely decorative; now it reflects a real
   * probe against GET /api/health so users instantly see whether the
   * backend is reachable (esp. on mobile networks).
   */
  async function probeServer() {
    const dot = document.querySelector('.login-status-dot');
    if (!dot) return false;
    dot.classList.add('checking');
    let ok = false;
    try {
      const ctrl = ('AbortController' in window) ? new AbortController() : null;
      const tm = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 5000) : null;
      const res = await fetch(API_BASE() + '/api/health?t=' + Date.now(), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (tm) clearTimeout(tm);
      const j = await res.json().catch(() => null);
      ok = res.ok && j && (j.success !== false);
    } catch (_) { ok = false; }
    dot.classList.remove('checking');
    dot.classList.toggle('bad', !ok);
    dot.classList.toggle('ok', ok);
    dot.title = ok
      ? (window.t ? window.t('connOnlineTitle', 'الخادم متصل ويعمل بشكل طبيعي') : 'Server online')
      : (window.t ? window.t('connOfflineTitle', 'تعذّر الوصول إلى الخادم — اضغط لإعادة الفحص') : 'Server unreachable');
    return ok;
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    // Restore theme
    const savedTheme = (function () { try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; } })();
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    // Restore language (initI18n in i18n.js already runs on script load).
    // v4 — the flag switcher (js/flags.js) binds itself; just make sure the
    // component exists even if DOMContentLoaded raced ahead of us.
    if (typeof window.initLangSwitchers === 'function') window.initLangSwitchers();

    // Theme toggle
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

    // Password show/hide
    wirePasswordToggle();

    // Demo credentials "fill" button
    const fillDemoBtn = document.getElementById('fillDemoBtn');
    if (fillDemoBtn) {
      fillDemoBtn.addEventListener('click', () => {
        const emailEl = document.getElementById('email');
        const pwEl = document.getElementById('password');
        if (emailEl) emailEl.value = 'admin@dzpos.pro';
        if (pwEl) pwEl.value = 'Admin@123456';
        clearLoginError();
        if (pwEl) pwEl.focus();
      });
    }

    // Auto-focus email on first load
    const emailEl = document.getElementById('email');
    if (emailEl) emailEl.focus();

    // Show "Create account" link — always visible (registration is always open)
    const registerLink = document.getElementById('registerLink');
    if (registerLink) {
      registerLink.style.display = 'inline-block';
    }

    // v4.1 — live server status (probe now, then every 30 s) + version chip
    probeServer();
    setInterval(() => { if (!document.hidden) probeServer(); }, 30000);
    const dotEl = document.querySelector('.login-status-dot');
    if (dotEl) {
      dotEl.style.cursor = 'pointer';
      dotEl.addEventListener('click', () => probeServer());
    }
    const verEl = document.querySelector('[data-i18n="version"]');
    if (verEl) {
      // v4.4 — i18n composes the label + live DZPOS_VERSION (see i18n.js);
      // this immediate pass covers the moment before the language JSON lands.
      verEl.textContent = 'v' + (window.DZPOS_VERSION || '4.4.0');
    }
  });

  // Expose setTheme globally for any external caller
  window.setTheme = setTheme;
})();
