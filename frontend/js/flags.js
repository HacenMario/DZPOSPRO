/* ============================================================
 * js/flags.js — DZ POS PRO v4 · Official language flags + switcher
 * ------------------------------------------------------------
 *  • window.DZPOS_LANGS   — language metadata (name, flag, dir)
 *  • window.DZPOS_FLAGS   — official-style flag SVG per language
 *                           (ar = Algeria official style: green/white
 *                            vertical halves + red crescent & star)
 *  • Enabled languages    — On/Off toggles (Settings → Languages),
 *                           persisted in localStorage.
 *  • window.initLangSwitchers() — builds every [data-lang-switcher]
 *                           flag dropdown on the page (idempotent).
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- precise 5-point star generator ---------- */
  function starPts(cx, cy, R, r, startDeg) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const rad = (i % 2 === 0) ? R : r;
      const a = (startDeg + i * 36) * Math.PI / 180;
      // SVG y-axis points down; use minus to keep math convention
      pts.push((cx + rad * Math.cos(a)).toFixed(2) + ',' + (cy - rad * Math.sin(a)).toFixed(2));
    }
    return pts.join(' ');
  }

  /* ---------- flag builders (viewBox 0 0 640 480) ---------- */
  const F = {};

  // 🇩🇿 Algeria — OFFICIAL flag (v4.2): exact geometry of the national
  // flag (green #006633 hoist half, white fly half, red #d21034
  // crescent + 5-point star straddling the divide, horns opening
  // towards the fly side). Source: official construction / Wikipedia
  // Flag_of_Algeria.svg — verified against the official flag image.
  F.dz = '<svg viewBox="0 0 900 600" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<path fill="#ffffff" d="M0 0h900v600H0z"/>' +
    '<path fill="#006633" d="M0 0h450v600H0z"/>' +
    '<path fill="#d21034" d="M579.903811 225a150 150 0 1 0 0 150 120 120 0 1 1 0-150M585.676275 300 450 255.916106 533.852549 371.329239v-142.658277L450 344.083894z"/>' +
    '</svg>';

  // 🇬🇧 United Kingdom — Union Flag (compact official construction)
  F.gb = '<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<clipPath id="dzgbS"><path d="M0,0 v30 h60 v-30 z"/></clipPath>' +
    '<clipPath id="dzgbT"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>' +
    '<g clip-path="url(#dzgbS)">' +
    '<path d="M0,0 v30 h60 v-30 z" fill="#012169"/>' +
    '<path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" stroke-width="6"/>' +
    '<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#dzgbT)" stroke="#C8102E" stroke-width="4"/>' +
    '<path d="M30,0 v30 M0,15 h60" stroke="#ffffff" stroke-width="10"/>' +
    '<path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/>' +
    '</g></svg>';

  // 🇫🇷 France
  F.fr = '<svg viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<rect width="213.33" height="480" fill="#0055A4"/>' +
    '<rect x="213.33" width="213.33" height="480" fill="#ffffff"/>' +
    '<rect x="426.66" width="213.34" height="480" fill="#EF4135"/></svg>';

  // 🇹🇷 Türkiye — official: red field, white crescent + star
  // (star inside the crescent opening, one point towards the hoist)
  (function () {
    const star = starPts(326.4, 240, 60, 24, 180);
    F.tr = '<svg viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<rect width="640" height="480" fill="#E30A17"/>' +
      '<circle cx="193.24" cy="240" r="120" fill="#ffffff"/>' +
      '<circle cx="250.39" cy="240" r="96" fill="#E30A17"/>' +
      '<polygon fill="#ffffff" points="' + star + '"/></svg>';
  })();

  // 🇪🇸 España — official 1:2:1 red-yellow-red (civil, without crest)
  F.es = '<svg viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<rect width="640" height="480" fill="#AA151B"/>' +
    '<rect y="120" width="640" height="240" fill="#F1BF00"/></svg>';

  // 🇮🇹 Italia
  F.it = '<svg viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<rect width="213.33" height="480" fill="#009246"/>' +
    '<rect x="213.33" width="213.33" height="480" fill="#ffffff"/>' +
    '<rect x="426.66" width="213.34" height="480" fill="#CE2B37"/></svg>';

  // 🇩🇪 Deutschland
  F.de = '<svg viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<rect width="640" height="160" fill="#000000"/>' +
    '<rect y="160" width="640" height="160" fill="#DD0000"/>' +
    '<rect y="320" width="640" height="160" fill="#FFCE00"/></svg>';

  // 🇷🇺 Россия
  F.ru = '<svg viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<rect width="640" height="160" fill="#ffffff"/>' +
    '<rect y="160" width="640" height="160" fill="#0039A6"/>' +
    '<rect y="320" width="640" height="160" fill="#D52B1E"/></svg>';

  // 🇨🇳 中国 — official: red field, 1 large + 4 small stars,
  // every small star rotated so one point aims at the big star centre.
  (function () {
    const big = starPts(80, 80, 48, 19.2, 180);
    const centers = [[160, 32], [192, 64], [192, 112], [160, 144]];
    let small = '';
    centers.forEach(function (c) {
      const dx = 80 - c[0], dy = 80 - c[1];
      const ang = Math.atan2(dy, dx) * 180 / Math.PI; // vertex angle → big star
      small += '<polygon fill="#FFDE00" points="' + starPts(c[0], c[1], 16, 6.4, ang) + '"/>';
    });
    F.cn = '<svg viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<rect width="640" height="480" fill="#DE2910"/>' +
      '<polygon fill="#FFDE00" points="' + big + '"/>' + small + '</svg>';
  })();

  /* ---------- language metadata ---------- */
  const LANGS = {
    ar: { name: 'العربية',   flag: 'dz', dir: 'rtl' },
    en: { name: 'English',   flag: 'gb', dir: 'ltr' },
    fr: { name: 'Français',  flag: 'fr', dir: 'ltr' },
    tr: { name: 'Türkçe',    flag: 'tr', dir: 'ltr' },
    es: { name: 'Español',   flag: 'es', dir: 'ltr' },
    it: { name: 'Italiano',  flag: 'it', dir: 'ltr' },
    de: { name: 'Deutsch',   flag: 'de', dir: 'ltr' },
    ru: { name: 'Русский',   flag: 'ru', dir: 'ltr' },
    zh: { name: '中文',       flag: 'cn', dir: 'ltr' }
  };
  const ORDER = ['ar', 'en', 'fr', 'tr', 'es', 'it', 'de', 'ru', 'zh'];
  const ALL_CODES = ORDER.slice();
  const LS_KEY = 'dzpos_enabled_langs';

  /* ---------- enabled-languages store (On/Off) ---------- */
  function enabledLangs() {
    let list;
    try { list = JSON.parse(global.localStorage.getItem(LS_KEY) || 'null'); } catch (_) { list = null; }
    if (!Array.isArray(list) || !list.length) return ALL_CODES.slice();
    const valid = ALL_CODES.filter(function (c) { return list.indexOf(c) !== -1; });
    return valid.length ? valid : ALL_CODES.slice();
  }

  function setLangEnabled(code, on) {
    if (!LANGS[code]) return enabledLangs();
    if (code === 'ar' && !on) return enabledLangs();  // Arabic = default, always on
    let list = enabledLangs().slice();
    if (on) {
      if (list.indexOf(code) === -1) list.push(code);
    } else {
      if (list.length <= 1) return list;               // never disable the last one
      list = list.filter(function (c) { return c !== code; });
      // if the active language was disabled → fall back to ar
      if (global.currentLang === code && typeof global.setLanguage === 'function') {
        global.setLanguage(list[0]);
      }
    }
    try { global.localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (_) {}
    global.dispatchEvent(new CustomEvent('dzposlangschange', { detail: { enabled: list } }));
    return list;
  }

  /* ---------- flag svg helper ---------- */
  function flagSvg(code, cls) {
    const svg = DZPOS_FLAGS[LANGS[code] ? LANGS[code].flag : code] || '';
    return '<span class="lang-flag' + (cls ? ' ' + cls : '') + '">' + svg + '</span>';
  }

  /* ---------- dropdown switcher component ---------- */
  function closeAll(except) {
    document.querySelectorAll('.lang-switcher.open').forEach(function (sw) {
      if (sw !== except) { sw.classList.remove('open'); const b = sw.querySelector('.lang-switcher-btn'); if (b) b.setAttribute('aria-expanded', 'false'); }
    });
  }

  function buildSwitcher(sw) {
    if (sw.dataset.built === '1') { renderSwitcher(sw); return; }
    sw.dataset.built = '1';
    const btn = document.createElement('button');
    btn.className = 'lang-switcher-btn';
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'lang-menu';
    menu.setAttribute('role', 'listbox');
    sw.appendChild(btn);
    sw.appendChild(menu);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const willOpen = !sw.classList.contains('open');
      closeAll(sw);
      if (willOpen) { renderSwitcher(sw); sw.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    });
    document.addEventListener('click', function () { closeAll(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
    global.addEventListener('languagechange', function () { renderSwitcher(sw); });
    global.addEventListener('dzposlangschange', function () { renderSwitcher(sw); });
    renderSwitcher(sw);
  }

  function renderSwitcher(sw) {
    const btn = sw.querySelector('.lang-switcher-btn');
    const menu = sw.querySelector('.lang-menu');
    if (!btn || !menu) return;
    const cur = (typeof global.currentLang === 'string' && global.currentLang) || 'ar';
    const meta = LANGS[cur] || LANGS.ar;
    btn.innerHTML = flagSvg(cur) +
      '<span class="lang-label">' + meta.name + '</span>' +
      '<svg class="lang-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
    const curDir = meta.dir;
    menu.innerHTML = '';
    enabledLangs().forEach(function (code) {
      const m = LANGS[code];
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'lang-item' + (code === cur ? ' active' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', code === cur ? 'true' : 'false');
      item.setAttribute('dir', m.dir);
      item.innerHTML = flagSvg(code) + '<span class="lang-item-name">' + m.name + '</span>' +
        (code === cur ? '<svg class="lang-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' : '');
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        closeAll();
        if (code !== cur && typeof global.setLanguage === 'function') global.setLanguage(code);
      });
      menu.appendChild(item);
    });
    void curDir;
  }

  function initLangSwitchers(root) {
    (root || document).querySelectorAll('[data-lang-switcher]').forEach(buildSwitcher);
  }

  /* ---------- exports ---------- */
  global.DZPOS_FLAGS = F;
  global.DZPOS_LANGS = LANGS;
  global.DZPOS_LANG_ORDER = ORDER;
  global.dzposEnabledLangs = enabledLangs;
  global.dzposSetLangEnabled = setLangEnabled;
  global.dzposFlagSvg = flagSvg;
  global.initLangSwitchers = initLangSwitchers;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initLangSwitchers(); });
  } else {
    initLangSwitchers();
  }
})(window);
