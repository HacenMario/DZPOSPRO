/* ============================================================
 * js/i18n.js — Trilingual i18n (ar / en / fr) with RTL support
 * ------------------------------------------------------------
 * Exposes:
 *   window.translations          — { ar: {...}, en: {...}, fr: {...} }
 *   window.currentLang           — active language code
 *   window.t(key, fallback?)     — translate a key
 *   window.loadLanguage(lang)    — fetch + cache a lang JSON
 *   window.applyLanguage(lang)   — update DOM + <html lang/dir>
 *   window.setLanguage(lang)     — load + apply + dispatch event + re-render
 *   window.initI18n()            — restore saved language and apply
 *   window.updateI18n(lang)      — alias of setLanguage (back-compat)
 *
 * Dispatches a `languagechange` event on window whenever the
 * active language changes. Modules can listen for it to
 * re-render their content.
 * ============================================================ */

(function (global) {
  'use strict';

  const SUPPORTED = ['ar', 'en', 'fr'];
  const RTL_LANGS = ['ar'];

  const translations = {};
  let currentLang = (function () {
    try { return localStorage.getItem('lang') || 'ar'; } catch { return 'ar'; }
  })();

  async function loadLanguage(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'ar';
    if (translations[lang]) return translations[lang];
    try {
      const res = await fetch('/lang/' + lang + '.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      translations[lang] = await res.json();
      return translations[lang];
    } catch (err) {
      console.error('[i18n] failed to load', lang, err);
      translations[lang] = translations[lang] || {};
      return translations[lang];
    }
  }

  function applyLanguage(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'ar';
    const data = translations[lang] || {};
    const doc = document.documentElement;
    doc.lang = lang;
    doc.dir = RTL_LANGS.indexOf(lang) !== -1 ? 'rtl' : 'ltr';
    try { localStorage.setItem('lang', lang); } catch (_) {}

    // Translate textContent
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const val = data[key];
      if (val === undefined) return;
      // Only set when element has no child elements OR is a pure text node owner
      if (el.children.length === 0) {
        el.textContent = val;
      } else {
        // Replace only the first text node (preserve nested elements)
        let replaced = false;
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) { node.nodeValue = ' ' + val + ' '; replaced = true; break; }
        }
        if (!replaced) el.textContent = val;
      }
    });
    // Translate placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = data[key];
      if (val !== undefined) el.setAttribute('placeholder', val);
    });
    // Translate titles
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const val = data[key];
      if (val !== undefined) el.setAttribute('title', val);
    });
    // Translate aria-labels
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria-label');
      const val = data[key];
      if (val !== undefined) el.setAttribute('aria-label', val);
    });

    // Keep <select id="langSelect"> in sync
    const sel = document.getElementById('langSelect');
    if (sel && sel.value !== lang) sel.value = lang;
  }

  /**
   * Switch the active language: load JSON, apply to DOM, dispatch
   * event, then re-render the current page (if a loader exists).
   */
  async function setLanguage(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'ar';
    if (lang === currentLang && translations[lang]) {
      applyLanguage(lang);
      return;
    }
    currentLang = lang;
    await loadLanguage(lang);
    applyLanguage(lang);

    // Notify listeners
    global.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));

    // Re-render the current page so module strings refresh
    if (typeof global.loadPage === 'function' && global.currentPage) {
      try { await global.loadPage(global.currentPage); } catch (e) {
        console.warn('[i18n] re-render failed', e);
      }
    }
  }

  function t(key, fallback) {
    const data = translations[currentLang] || {};
    const val = data[key];
    if (val !== undefined && val !== null && val !== '') return val;
    // Try English fallback for missing keys
    if (currentLang !== 'en' && translations.en && translations.en[key]) return translations.en[key];
    return fallback !== undefined ? fallback : key;
  }

  async function initI18n() {
    await loadLanguage(currentLang);
    // Preload English as a fallback source
    if (currentLang !== 'en') loadLanguage('en');
    applyLanguage(currentLang);
  }

  // Expose to the global scope
  global.translations = translations;
  Object.defineProperty(global, 'currentLang', {
    configurable: true,
    get: () => currentLang
  });
  global.t = t;
  global.loadLanguage = loadLanguage;
  global.applyLanguage = applyLanguage;
  global.setLanguage = setLanguage;
  global.initI18n = initI18n;
  global.updateI18n = setLanguage; // back-compat alias

  // Kick off as soon as the script loads
  initI18n();
})(window);
