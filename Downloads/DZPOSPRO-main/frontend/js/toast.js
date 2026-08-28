/* ============================================================
 * js/toast.js — Unified notification API
 * ------------------------------------------------------------
 * Two backends:
 *   1. SweetAlert2 confirm/prompt modals (loaded via CDN)
 *   2. A custom lightweight toast stack (top-right, animated,
 *      auto-dismiss, manual close, RTL-aware)
 *
 * Exposes window.Toast with:
 *   .success(msg, opts?)   .error(msg, opts?)
 *   .warning(msg, opts?)   .info(msg, opts?)
 *   .confirm(msg, opts?)   -> Promise<boolean>
 *   .prompt(opts)          -> Promise<string|null>
 *   .loading(msg?)         .closeLoading()
 *
 * All toast titles go through window.t() so they honor the
 * active language.
 * ============================================================ */

(function (global) {
  'use strict';

  function tt(key, fallback) {
    if (typeof global.t === 'function') return global.t(key, fallback);
    return fallback || key;
  }

  function ensureContainer() {
    let c = document.getElementById('toastContainer');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toastContainer';
      c.className = 'toast-container';
      c.setAttribute('aria-live', 'polite');
      c.setAttribute('aria-atomic', 'true');
      document.body.appendChild(c);
    }
    return c;
  }

  const ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/><circle cx="12" cy="12" r="10"/></svg>',
  };

  const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function dismiss(toastEl) {
    if (!toastEl || toastEl.dataset.dismissed === '1') return;
    toastEl.dataset.dismissed = '1';
    toastEl.classList.add('removing');
    setTimeout(() => toastEl.remove(), 250);
  }

  function pushToast(type, message, opts) {
    opts = opts || {};
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const titleKey = { success: 'toastSuccess', error: 'toastError', warning: 'toastWarning', info: 'toastInfo' }[type];
    const title = opts.title || tt(titleKey, type);

    el.innerHTML =
      '<span class="toast-icon" aria-hidden="true">' + (ICONS[type] || ICONS.info) + '</span>' +
      '<div class="toast-body">' +
        '<div class="toast-title"></div>' +
        (message ? '<div class="toast-message"></div>' : '') +
      '</div>' +
      '<button class="toast-close" type="button" aria-label="' + tt('close', 'إغلاق') + '">' + CLOSE_ICON + '</button>';

    el.querySelector('.toast-title').textContent = title;
    if (message) el.querySelector('.toast-message').textContent = String(message);

    el.querySelector('.toast-close').addEventListener('click', () => dismiss(el));
    container.appendChild(el);

    const duration = typeof opts.duration === 'number' ? opts.duration : 4000;
    if (duration > 0) {
      setTimeout(() => dismiss(el), duration);
    }
    return el;
  }

  const Toast = {
    success: (msg, opts) => pushToast('success', msg, opts),
    error:   (msg, opts) => pushToast('error',   msg, Object.assign({ duration: 6000 }, opts || {})),
    warning: (msg, opts) => pushToast('warning', msg, opts),
    info:    (msg, opts) => pushToast('info',    msg, opts),

    /**
     * Confirmation dialog (SweetAlert2-backed). Resolves true/false.
     */
    confirm(message, opts) {
      opts = opts || {};
      const fallback = {
        ar: { title: 'تأكيد', confirm: 'نعم', cancel: 'إلغاء' },
        en: { title: 'Confirm', confirm: 'Yes', cancel: 'Cancel' },
        fr: { title: 'Confirmer', confirm: 'Oui', cancel: 'Annuler' }
      };
      const lang = (typeof global.currentLang !== 'undefined' && global.currentLang) || localStorage.getItem('lang') || 'ar';
      const f = fallback[lang] || fallback.ar;

      if (typeof Swal === 'undefined') {
        return Promise.resolve(window.confirm(message || ''));
      }
      return Swal.fire({
        title: opts.title || f.title,
        text: message || '',
        icon: opts.icon || 'question',
        showCancelButton: true,
        confirmButtonText: opts.confirmText || f.confirm,
        cancelButtonText: opts.cancelText || f.cancel,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        reverseButtons: lang === 'ar'
      }).then(r => r.isConfirmed === true);
    },

    /**
     * Prompt dialog. Resolves the entered string or null on cancel.
     */
    prompt(opts) {
      opts = opts || {};
      const fallback = {
        ar: { title: 'إدخال', confirm: 'موافق', cancel: 'إلغاء' },
        en: { title: 'Input', confirm: 'OK', cancel: 'Cancel' },
        fr: { title: 'Saisie', confirm: 'OK', cancel: 'Annuler' }
      };
      const lang = (typeof global.currentLang !== 'undefined' && global.currentLang) || localStorage.getItem('lang') || 'ar';
      const f = fallback[lang] || fallback.ar;

      if (typeof Swal === 'undefined') {
        return Promise.resolve(window.prompt(opts.message || '', opts.defaultValue || '') || null);
      }
      return Swal.fire({
        title: opts.title || f.title,
        text: opts.message || '',
        input: opts.inputType || 'text',
        inputValue: opts.defaultValue || '',
        inputPlaceholder: opts.placeholder || '',
        showCancelButton: true,
        confirmButtonText: opts.confirmText || f.confirm,
        cancelButtonText: opts.cancelText || f.cancel,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        reverseButtons: lang === 'ar'
      }).then(r => r.isConfirmed ? (r.value || '') : null);
    },

    loading(message) {
      if (typeof Swal === 'undefined') return;
      Swal.fire({
        title: message || tt('loading', 'جاري التحميل...'),
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading()
      });
    },
    closeLoading() {
      if (typeof Swal !== 'undefined') Swal.close();
    }
  };

  global.Toast = Toast;
})(window);
