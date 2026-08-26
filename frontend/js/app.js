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

  // ===== إضافة هذا السطر =====
  const API_BASE = 'https://dzpospro-production.up.railway.app';
  
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
    try {
const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 250);
      } else {
        // Build a helpful message. If the backend returned validation errors,
        // surface the first field-level message instead of the generic "Validation failed".
        let msg = (data && (data.message || data.error)) || (window.t ? window.t('loginFailed', 'فشل تسجيل الدخول') : 'Login failed');
        if (data && Array.isArray(data.errors) && data.errors.length) {
          msg = data.errors[0].message || msg;
        }
        showLoginError(msg);
      }
    } catch (err) {
      console.error('[login] error', err);
      showLoginError(window.t ? window.t('loginServerUnreachable', 'تعذّر الوصول إلى الخادم') : 'Cannot reach server');
    } finally {
      setLoading(false);
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

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    // Restore theme
    const savedTheme = (function () { try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; } })();
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    // Restore language (initI18n in i18n.js already runs on script load,
    // but make sure the <select> reflects the saved value)
    const langSel = document.getElementById('langSelect');
    if (langSel) {
      try { langSel.value = localStorage.getItem('lang') || 'ar'; } catch (_) {}
      langSel.addEventListener('change', () => setLanguage(langSel.value));
    }

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
  });

  // Expose setTheme globally for any external caller
  window.setTheme = setTheme;
})();
