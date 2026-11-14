/* ============================================================
 * js/scanner.js — Shared camera scanning engine (v4.5)
 * ------------------------------------------------------------
 * ONE professional scanner used by BOTH the POS barcode button
 * and the invoice-QR button:
 *   • Engine A — native BarcodeDetector (Chrome/Edge/Android, GPU)
 *   • Engine B — ZXing JS fallback (iOS Safari / Firefox / every
 *     browser) bundled at vendor/zxing.min.js
 * Formats covered (EVERYTHING common in the market):
 *   EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, Code 93,
 *   ITF, Codabar, QR, DataMatrix, PDF417, Aztec (+ RSS when native)
 * Global API (window.dzposScanner):
 *   dzposScanner.open({ title, hint, formats, onDecode(code, format) })
 *   dzposScanner.canScan()  → 'native' | 'zxing' | 'manual' | null
 * Requires a secure context (https / localhost) for the camera; on
 * file:// the caller falls back to manual entry.
 * ============================================================ */

(function (global) {
  'use strict';

  const ZXING_SRC = 'vendor/zxing.min.js?v=4.5.0';

  // --- 1D/2D formats ---
  const ALL_FORMATS_NATIVE = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39',
    'code_93', 'codabar', 'itf', 'qr_code', 'data_matrix', 'pdf417', 'aztec'];

  function zxingFormatList() {
    const F = global.ZXing && global.ZXing.BarcodeFormat;
    if (!F) return [];
    return [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93,
      F.ITF, F.CODABAR, F.QR_CODE, F.DATA_MATRIX, F.PDF_417, F.AZTEC].filter(Boolean);
  }

  // The 2 formats that identify an invoice QR vs. product barcode
  function isQrish(format) {
    const f = String(format || '').toLowerCase();
    return f.indexOf('qr') !== -1 || f.indexOf('data_matrix') !== -1 || f.indexOf('aztec') !== -1 || f.indexOf('pdf') !== -1;
  }

  let __zxingLoading = null;
  function loadZxing() {
    if (global.ZXing && global.ZXing.BrowserMultiFormatReader) return Promise.resolve(true);
    if (__zxingLoading) return __zxingLoading;
    __zxingLoading = new Promise((resolve) => {
      const sc = document.createElement('script');
      sc.src = ZXING_SRC;
      sc.onload = () => resolve(!!(global.ZXing && global.ZXing.BrowserMultiFormatReader));
      sc.onerror = () => resolve(false);
      document.head.appendChild(sc);
    });
    return __zxingLoading;
  }

  function secureMediaAvailable() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
  }

  function t(key, fallback) {
    if (typeof global.t === 'function') { const v = global.t(key, fallback); if (v) return v; }
    return fallback || key;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let activeSession = null;   // only one scanner at a time

  /**
   * Open the scanning modal.
   * @param {object} opts
   *   title   {string}       modal title
   *   hint    {string}       instruction line under the viewport
   *   formats {string[]}    native formats to restrict to (default: all)
   *   onDecode{fn(code, info)} called ONCE with the decoded text
   */
  async function open(opts) {
    if (!opts || typeof opts.onDecode !== 'function') return;
    if (activeSession) return; // already scanning
    if (!secureMediaAvailable()) {
      if (opts.onUnavailable) opts.onUnavailable();
      return;
    }

    const session = { stopped: false, stream: null, rafId: null, zxingControls: null, zxingReader: null, overlay: null };
    activeSession = session;

    const nativeAvailable = 'BarcodeDetector' in global;
    if (!nativeAvailable) {
      const ok = await loadZxing();
      if (!ok) {
        activeSession = null;
        if (opts.onUnavailable) opts.onUnavailable();
        return;
      }
    }

    // --- shared camera modal ---
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'dzposScannerModal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const SCAN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12" stroke-width="3"/></svg>';
    overlay.innerHTML = `
      <div class="modal" role="document" style="max-width:520px;">
        <div class="modal-header">
          <div class="modal-title">${SCAN_ICON}<span>${esc(opts.title || t('scanBarcode', 'Scan'))}</span></div>
          <button class="modal-close" type="button" aria-label="${esc(t('close', 'Close'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" style="padding:1rem;text-align:center;">
          <div style="position:relative;width:100%;max-width:480px;margin:0 auto;background:#000;border-radius:8px;overflow:hidden;aspect-ratio:4/3;">
            <video id="dzposScanVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
            <div style="position:absolute;inset:8%;border:2px solid #10b981;border-radius:8px;pointer-events:none;box-shadow:0 0 0 9999px rgba(0,0,0,0.4);"></div>
          </div>
          <div style="margin-top:0.75rem;font-size:0.85rem;color:var(--text-muted);">
            ${esc(opts.hint || t('scanBarcodeHint', 'Align the code inside the green box'))}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" type="button" data-action="cancel">${esc(t('cancel', 'Cancel'))}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    session.overlay = overlay;

    function close() {
      if (session.stopped) return;
      session.stopped = true;
      if (session.rafId) cancelAnimationFrame(session.rafId);
      try { if (session.zxingControls && typeof session.zxingControls.stop === 'function') session.zxingControls.stop(); } catch (_) {}
      try { if (session.zxingReader && typeof session.zxingReader.reset === 'function') session.zxingReader.reset(); } catch (_) {}
      if (session.stream) {
        session.stream.getTracks().forEach(tr => { try { tr.stop(); } catch (_) {} });
        session.stream = null;
      }
      if (overlay.parentNode) overlay.remove();
      document.removeEventListener('keydown', escHandler);
      if (activeSession === session) activeSession = null;
    }

    function onCode(code, info) {
      if (session.stopped || !code) return;
      close();
      try { opts.onDecode(String(code).trim(), info || {}); } catch (e) { console.error('[scanner] onDecode', e); }
    }

    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    const video = overlay.querySelector('#dzposScanVideo');

    // --- Engine A: native BarcodeDetector ---
    if (nativeAvailable) {
      let detector = null;
      try {
        let formats = opts.formats || ALL_FORMATS_NATIVE;
        try {
          const supported = await global.BarcodeDetector.getSupportedFormats();
          if (Array.isArray(supported) && supported.length) {
            const want = formats.filter(f => supported.includes(f));
            formats = want.length ? want : supported;
          }
        } catch (_) { /* keep requested */ }
        detector = new global.BarcodeDetector({ formats });
      } catch (e) {
        // fall through to ZXing below
      }
      if (detector) {
        try {
          session.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          });
          video.srcObject = session.stream;
          await new Promise(r => { video.onloadedmetadata = () => { video.play().catch(() => {}); r(); }; });
        } catch (e) {
          try { if (global.Toast && global.Toast.error) global.Toast.error(t('cameraAccessDenied', 'Camera access denied or unavailable')); } catch (_) {}
          close();
          return;
        }
        let lastAt = 0;
        async function tick() {
          if (session.stopped) return;
          if (video.readyState >= 2) {
            const now = Date.now();
            if (now - lastAt > 120) {   // ~8 fps is plenty and saves battery
              lastAt = now;
              try {
                const codes = await detector.detect(video);
                if (codes && codes.length > 0 && codes[0].rawValue) {
                  onCode(codes[0].rawValue, { format: codes[0].format, engine: 'native' });
                  return;
                }
              } catch (_) { /* transient */ }
            }
          }
          if (!session.stopped) session.rafId = requestAnimationFrame(tick);
        }
        session.rafId = requestAnimationFrame(tick);
        return;
      }
      // native detector failed to construct → ZXing engine
    }

    // --- Engine B: ZXing ---
    try {
      const H = global.ZXing.DecodeHintType;
      const hints = new Map();
      const fmts = zxingFormatList();
      if (fmts.length && H && H.POSSIBLE_FORMATS) hints.set(H.POSSIBLE_FORMATS, fmts);
      if (H && H.TRY_HARDER) hints.set(H.TRY_HARDER, true);
      const reader = new global.ZXing.BrowserMultiFormatReader(hints, 180);
      session.zxingReader = reader;
      session.zxingControls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        video,
        (result) => { if (result && result.text) onCode(result.text, { format: result.format, engine: 'zxing' }); }
      );
      session.stream = reader && reader.stream ? reader.stream : null;
    } catch (e) {
      try { if (global.Toast && global.Toast.error) global.Toast.error(t('cameraAccessDenied', 'Camera access denied or unavailable')); } catch (_) {}
      close();
    }
  }

  function canScan() {
    if (!secureMediaAvailable()) return null;
    if ('BarcodeDetector' in global) return 'native';
    return 'zxing';
  }

  function isBusy() { return !!activeSession; }

  global.dzposScanner = { open, canScan, isBusy, isQrish, loadZxing };
})(window);
