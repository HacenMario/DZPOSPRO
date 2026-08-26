/* ============================================================
 * js/modules/sessions.js
 * ------------------------------------------------------------
 * Renders the Sessions (cashier shifts) page into #pageContent.
 *
 * Features:
 *   • Active session banner with live elapsed-time counter
 *   • Open Session button (disabled when user already has one)
 *   • Server-side paginated table of all sessions
 *   • Open modal: opening cash + notes → POST /api/sessions
 *   • Close modal: counted cash + notes → PUT /api/sessions/:id/close
 *     with real-time difference vs expected cash + PDF report
 *   • View session detail: full summary, sales list, payment-method
 *     breakdown, "Download Report PDF" button
 *
 * Backend session shape:
 *   { _id, user:{_id,name,email}, userName, openingBalance, closingBalance,
 *     totalSales, totalDiscount, totalTax, saleCount,
 *     cashSales, cardSales, transferSales,
 *     expectedCash, actualCash, difference,
 *     status:'open'|'closed', openedAt, closedAt, notes, createdAt, updatedAt }
 *
 * All text via window.t(), all API calls via window.apiFetch().
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  page: 1,
  limit: 20,
  status: '',         // '' | 'open' | 'closed'
  pagination: null,
  items: [],
  currentSession: null,    // open session for the logged-in user
  currentStats: null,      // sales stats for current session
  elapsedTimer: null,
  settings: null           // populated lazily by fetchSettings()
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtCurrency(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + t('currency', 'DZD');
}

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtElapsed(fromMs) {
  const ms = Math.max(0, Date.now() - fromMs);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return h + t('hourShort', 'h') + ' ' + m + t('minShort', 'm');
  if (m > 0) return m + t('minShort', 'm') + ' ' + s + t('secShort', 's');
  return s + t('secShort', 's');
}

/* Static (deterministic) version of fmtElapsed — takes a duration in ms.
 * Used by the PDF report so the printed elapsed time does not depend on
 * `Date.now()` and stays consistent with the closed-session time range. */
function fmtElapsedStatic(durationMs) {
  const ms = Math.max(0, durationMs);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return h + t('hourShort', 'h') + ' ' + m + t('minShort', 'm');
  if (m > 0) return m + t('minShort', 'm') + ' ' + s + t('secShort', 's');
  return s + t('secShort', 's');
}

/* Lazily fetch settings so the PDF report can show store name / footer. */
async function fetchSettings() {
  if (state.settings) return state.settings;
  try {
    const r = await apiFetch.get('/api/settings');
    if (r && r.success) {
      // Backend may return either {data: {...settings...}} or {data: {settings: {...}}}
      const s = (r.data && r.data.settings) || r.data || {};
      state.settings = {
        storeName: s.storeName || 'DZ POS PRO',
        currency: s.currency || 'DZD',
        invoiceFooter: s.invoiceFooter || '',
        invoiceCustomText: s.invoiceCustomText || '',
        companyInfo: Object.assign({ rc: '', nif: '', nis: '', art: '', address: '', phone: '', whatsapp: '', email: '' }, s.companyInfo || {})
      };
    }
  } catch (e) { console.warn('[sessions] fetchSettings', e); }
  return state.settings;
}

function sessionIdShort(s) {
  if (!s || !s._id) return '—';
  return String(s._id).replace(/^[0-9a-f]{4}/i, '').slice(-6).toUpperCase() || String(s._id).slice(-6).toUpperCase();
}

function statusBadge(status) {
  if (status === 'open')   return '<span class="badge badge-success">' + t('sessionOpen', 'Open') + '</span>';
  if (status === 'closed') return '<span class="badge badge-muted">'   + t('sessionClosed', 'Closed') + '</span>';
  return '<span class="badge badge-muted">' + escapeHtml(status || '—') + '</span>';
}

function differenceCell(diff) {
  const v = Number(diff || 0);
  if (Math.abs(v) < 0.005) return '<span style="color:var(--success);font-weight:700;">' + fmtCurrency(0) + '</span>';
  if (v > 0) return '<span style="color:var(--success);font-weight:700;">+' + fmtCurrency(v) + '</span>';
  return '<span style="color:var(--danger);font-weight:700;">' + fmtCurrency(v) + '</span>';
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="toolbar">
      <div class="skeleton" style="height:40px;width:160px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
    </div>
    <div class="table-wrap">
      ${[1,2,3,4,5,6].map(() => `<div class="skeleton skeleton-line" style="height:48px;margin:0;border-radius:0;"></div>`).join('')}
    </div>`;
}

/* ---------- Header ---------- */
function renderHeader() {
  const hasOpen = !!(state.currentSession && state.currentSession.status === 'open');
  return `
    <div class="page-header">
      <div class="page-title-block">
        <div class="page-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;color:var(--primary);"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="page-title-text">${t('sessions', 'Sessions')}</span>
        </div>
        <div class="page-subtitle">${t('sessionsSubtitle', 'Cashier shift management — open / close your till')}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="openSessionBtn" type="button" ${hasOpen ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 20 7"/></svg>
          <span>${t('openSession', 'Open session')}</span>
        </button>
      </div>
    </div>`;
}

/* ---------- Active session banner ---------- */
function renderActiveBanner() {
  const s = state.currentSession;
  if (!s || s.status !== 'open') return '';
  const stats = state.currentStats || {};
  const cashierName = (s.user && (s.user.name || s.user.email)) || s.userName || '—';
  const openedAt = s.openedAt ? new Date(s.openedAt).getTime() : Date.now();
  return `
    <div class="card" id="activeSessionBanner" style="margin-bottom:1rem;border-inline-start:4px solid var(--primary);">
      <div class="card-body" style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;">
        <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;flex:1 1 320px;min-width:0;">
          <div class="stat-icon green" aria-hidden="true" style="width:48px;height:48px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:1rem;color:var(--text-primary);">
              ${t('activeSession', 'Active session')} <span class="cell-muted" style="font-weight:400;">#${escapeHtml(sessionIdShort(s))}</span>
            </div>
            <div class="cell-muted" style="margin-top:0.15rem;">
              ${t('cashier', 'Cashier')}: <strong>${escapeHtml(cashierName)}</strong> ·
              ${t('openedAt', 'Opened')}: ${escapeHtml(fmtDateTime(s.openedAt))} ·
              <span id="elapsedLabel">${escapeHtml(fmtElapsed(openedAt))}</span> ${t('elapsed', 'elapsed')}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;">
          <div style="text-align:center;">
            <div class="cell-muted" style="font-size:0.75rem;">${t('openingCash', 'Opening cash')}</div>
            <div style="font-weight:700;font-size:1rem;">${fmtCurrency(s.openingBalance)}</div>
          </div>
          <div style="text-align:center;">
            <div class="cell-muted" style="font-size:0.75rem;">${t('expectedCash', 'Expected cash')}</div>
            <div style="font-weight:700;font-size:1rem;color:var(--primary);">${fmtCurrency(stats.expectedCash || s.openingBalance)}</div>
          </div>
          <div style="text-align:center;">
            <div class="cell-muted" style="font-size:0.75rem;">${t('salesCount', 'Sales')}</div>
            <div style="font-weight:700;font-size:1rem;">${escapeHtml(String(stats.saleCount || 0))}</div>
          </div>
        </div>
        <div>
          <button class="btn btn-danger" id="closeSessionBtn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            <span>${t('closeSession', 'Close session')}</span>
          </button>
        </div>
      </div>
    </div>`;
}

/* ---------- Toolbar ---------- */
function renderToolbar() {
  return `
    <div class="toolbar">
      <div class="toolbar-left">
        <select class="select" id="sessionStatusFilter" aria-label="${t('status', 'Status')}">
          <option value=""        ${state.status === '' ? 'selected' : ''}>${t('allStatuses', 'All statuses')}</option>
          <option value="open"    ${state.status === 'open' ? 'selected' : ''}>${t('sessionOpen', 'Open')}</option>
          <option value="closed"  ${state.status === 'closed' ? 'selected' : ''}>${t('sessionClosed', 'Closed')}</option>
        </select>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="sessionRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
      </div>
    </div>`;
}

/* ---------- Table ---------- */
function renderTable() {
  if (!state.items.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="empty-title">${t('noSessionsMatch', 'No matching sessions')}</div>
        <div class="empty-subtitle">${t('noSessions', 'No sessions recorded yet')}</div>
      </div>`;
  }

  const rows = state.items.map((s, i) => {
    const idx = (state.page - 1) * state.limit + i + 1;
    const cashier = (s.user && (s.user.name || s.user.email)) || s.userName || '—';
    const closingTime = s.status === 'closed' ? fmtDateTime(s.closedAt) : '<span class="badge badge-success">' + t('sessionOpen', 'Open') + '</span>';
    const closingCash = s.status === 'closed' ? fmtCurrency(s.closingBalance) : '—';
    const diff = s.status === 'closed' ? differenceCell(s.difference) : '—';
    return `
      <tr>
        <td class="cell-muted">${idx}</td>
        <td class="cell-strong">#${escapeHtml(sessionIdShort(s))}</td>
        <td>${escapeHtml(cashier)}</td>
        <td class="cell-muted">${escapeHtml(fmtDateTime(s.openedAt))}</td>
        <td>${closingTime}</td>
        <td>${fmtCurrency(s.openingBalance)}</td>
        <td>${closingCash}</td>
        <td>${diff}</td>
        <td>${statusBadge(s.status)}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn view" data-id="${s._id}" aria-label="${t('view', 'View')}" title="${t('view', 'View')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  const p = state.pagination || { page: state.page, totalPages: 1, total: state.items.length, limit: state.limit };
  const from = p.total === 0 ? 0 : ((p.page - 1) * p.limit + 1);
  const to = Math.min(p.page * p.limit, p.total);
  const pageBtns = [];
  pageBtns.push(`<button class="page-btn" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''} aria-label="${t('previous', 'Previous')}">«</button>`);
  let start = Math.max(1, p.page - 2), end = Math.min(p.totalPages || 1, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) {
    pageBtns.push(`<button class="page-btn ${i === p.page ? 'active' : ''}" data-page="${i}">${i}</button>`);
  }
  pageBtns.push(`<button class="page-btn" data-page="${p.page + 1}" ${p.page >= (p.totalPages || 1) ? 'disabled' : ''} aria-label="${t('next', 'Next')}">»</button>`);

  return `
    <div class="table-wrap">
      <table class="table table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>${t('sessionId', 'Session')}</th>
            <th>${t('cashier', 'Cashier')}</th>
            <th>${t('openedAt', 'Opened')}</th>
            <th>${t('closedAt', 'Closed')}</th>
            <th>${t('openingCash', 'Opening cash')}</th>
            <th>${t('closingCash', 'Closing cash')}</th>
            <th>${t('difference', 'Difference')}</th>
            <th>${t('status', 'Status')}</th>
            <th>${t('actions', 'Actions')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-top:0.85rem;">
      <div class="page-info">${t('showing', 'Showing')} ${from}–${to} ${t('of', 'of')} ${p.total} ${t('results', 'results')}</div>
      <div class="pagination">${pageBtns.join('')}</div>
    </div>`;
}

/* ---------- Fetch ---------- */
async function fetchCurrentSession() {
  try {
    const r = await apiFetch.get('/api/sessions/current');
    if (r && r.success) {
      state.currentSession = (r.data && r.data.session) || null;
      state.currentStats = (r.data && r.data.stats) || null;
    } else { state.currentSession = null; state.currentStats = null; }
  } catch (e) {
    console.warn('[sessions] fetchCurrentSession', e);
    state.currentSession = null; state.currentStats = null;
  }
}

async function fetchSessions() {
  const qs = { page: state.page, limit: state.limit };
  if (state.status) qs.status = state.status;
  try {
    const r = await apiFetch.get('/api/sessions', qs);
    if (r && r.success) {
      state.items = r.data || [];
      state.pagination = { page: r.page, limit: r.limit, total: r.total, totalPages: r.totalPages };
    } else { state.items = []; state.pagination = null; }
  } catch (e) {
    console.error('[sessions] fetchSessions', e);
    state.items = []; state.pagination = null;
  }
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML =
    renderHeader() +
    renderActiveBanner() +
    renderToolbar() +
    '<div id="sessionsTableContainer">' + renderTable() + '</div>';
  bindHeader();
  bindToolbar();
  bindTable();
  startElapsedTimer();
}

function bindHeader() {
  const openBtn = document.getElementById('openSessionBtn');
  if (openBtn) openBtn.addEventListener('click', () => {
    if (openBtn.disabled) return;
    openSessionModal();
  });
  const closeBtn = document.getElementById('closeSessionBtn');
  if (closeBtn) closeBtn.addEventListener('click', async () => {
    if (state.currentSession && state.currentSession.status === 'open') {
      // Refresh stats before opening the close modal so the expected-cash figure is up-to-date
      closeBtn.disabled = true;
      try { await fetchCurrentSession(); } catch (_) {}
      closeBtn.disabled = false;
      closeSessionModal(state.currentSession, state.currentStats);
    }
  });
}

function bindToolbar() {
  const f = document.getElementById('sessionStatusFilter');
  if (f) f.addEventListener('change', () => { state.status = f.value; state.page = 1; refreshTable(); });
  const refBtn = document.getElementById('sessionRefreshBtn');
  if (refBtn) refBtn.addEventListener('click', () => refreshAll());
}

function bindTable() {
  document.querySelectorAll('#sessionsTableContainer .table-action-btn.view').forEach(b => {
    b.addEventListener('click', () => {
      const s = state.items.find(x => x._id === b.dataset.id);
      if (s) viewSessionModal(s);
    });
  });
  document.querySelectorAll('#sessionsTableContainer .page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshTable(); }
    });
  });
}

function startElapsedTimer() {
  stopElapsedTimer();
  if (!state.currentSession || state.currentSession.status !== 'open') return;
  state.elapsedTimer = setInterval(() => {
    const label = document.getElementById('elapsedLabel');
    if (!label) { stopElapsedTimer(); return; }
    const openedAt = state.currentSession.openedAt ? new Date(state.currentSession.openedAt).getTime() : Date.now();
    label.textContent = fmtElapsed(openedAt);
  }, 1000);
}

function stopElapsedTimer() {
  if (state.elapsedTimer) { clearInterval(state.elapsedTimer); state.elapsedTimer = null; }
}

async function refreshTable() {
  const container = document.getElementById('sessionsTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchSessions();
  if (container) container.innerHTML = renderTable();
  bindTable();
}

async function refreshAll() {
  await Promise.all([fetchCurrentSession(), fetchSessions()]);
  render();
}

/* ---------- Open Session modal ---------- */
function openSessionModal() {
  const html = `
    <div class="modal-overlay" id="openSessionModal" role="dialog" aria-modal="true" aria-labelledby="openSessionTitle">
      <div class="modal modal-sm" role="document">
        <div class="modal-header">
          <div class="modal-title" id="openSessionTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 20 7"/></svg>
            <span>${t('openSession', 'Open session')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="openSessionForm">
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">${t('openingCash', 'Opening cash')} <span class="req">*</span></label>
              <input class="input" id="openCash" type="number" min="0" step="0.01" required value="0" />
              <div class="help-text">${t('openingCashHelp', 'Amount of cash in the till at the start of the shift')}</div>
            </div>
            <div class="form-group">
              <label class="form-label">${t('notes', 'Notes')}</label>
              <textarea class="textarea" id="openNotes" rows="3" placeholder="${escapeHtml(t('sessionNotesPlaceholder', 'Optional notes for this session...'))}"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" type="button" data-action="cancel">${t('cancel', 'Cancel')}</button>
            <button class="btn btn-primary" type="submit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 20 7"/></svg>
              <span>${t('openSession', 'Open session')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('openSessionModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#openSessionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const openingCash = parseFloat(overlay.querySelector('#openCash').value) || 0;
    const notes = overlay.querySelector('#openNotes').value.trim();
    const btn = overlay.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const r = await apiFetch.post('/api/sessions', { openingCash, notes });
      if (r && r.success) {
        if (window.Toast) window.Toast.success(t('sessionOpened', 'Session opened'));
        close();
        await refreshAll();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/already|مفتوحة|déjà|open/i.test(msg)) {
        if (window.Toast) window.Toast.error(t('sessionAlreadyOpen', 'You already have an open session'));
      } else {
        if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  setTimeout(() => { const first = overlay.querySelector('#openCash'); if (first) { first.focus(); first.select(); } }, 50);
}

/* ---------- Close Session modal ---------- */
function closeSessionModal(session, stats) {
  const st = stats || {};
  const expected = Number(st.expectedCash || session.openingBalance || 0);
  const openingCash = Number(session.openingBalance || 0);

  const html = `
    <div class="modal-overlay" id="closeSessionModal" role="dialog" aria-modal="true" aria-labelledby="closeSessionTitle">
      <div class="modal" role="document">
        <div class="modal-header">
          <div class="modal-title" id="closeSessionTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            <span>${t('closeSession', 'Close session')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="closeSessionForm">
          <div class="modal-body">
            <input type="hidden" id="closeSessionId" value="${session._id}" />
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;margin-bottom:1rem;">
              <div class="card" style="padding:0.85rem;box-shadow:none;">
                <div class="cell-muted" style="font-size:0.75rem;">${t('openingCash', 'Opening cash')}</div>
                <div style="font-weight:700;">${fmtCurrency(openingCash)}</div>
              </div>
              <div class="card" style="padding:0.85rem;box-shadow:none;">
                <div class="cell-muted" style="font-size:0.75rem;">${t('cashSales', 'Cash sales')}</div>
                <div style="font-weight:700;">${fmtCurrency(st.cashSales || 0)}</div>
              </div>
              <div class="card" style="padding:0.85rem;box-shadow:none;border-inline-start:3px solid var(--primary);">
                <div class="cell-muted" style="font-size:0.75rem;">${t('expectedCash', 'Expected cash')}</div>
                <div style="font-weight:700;color:var(--primary);">${fmtCurrency(expected)}</div>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">${t('countedCash', 'Counted cash in drawer')} <span class="req">*</span></label>
              <input class="input" id="closeCash" type="number" min="0" step="0.01" required value="${expected.toFixed(2)}" />
              <div class="help-text" id="diffLabel" style="font-weight:700;">${t('difference', 'Difference')}: ${fmtCurrency(0)}</div>
            </div>
            <div class="form-group">
              <label class="form-label">${t('notes', 'Notes')}</label>
              <textarea class="textarea" id="closeNotes" rows="3" placeholder="${escapeHtml(t('sessionNotesPlaceholder', 'Optional notes for this session...'))}"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" type="button" data-action="cancel">${t('cancel', 'Cancel')}</button>
            <button class="btn btn-danger" type="submit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              <span>${t('closeSession', 'Close session')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('closeSessionModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const cashInput = overlay.querySelector('#closeCash');
  const diffLabel = overlay.querySelector('#diffLabel');
  function updateDiff() {
    const counted = parseFloat(cashInput.value) || 0;
    const diff = counted - expected;
    const color = Math.abs(diff) < 0.005 ? 'var(--success)' : (diff > 0 ? 'var(--success)' : 'var(--danger)');
    diffLabel.style.color = color;
    diffLabel.textContent = t('difference', 'Difference') + ': ' + (diff > 0 ? '+' : '') + fmtCurrency(diff);
  }
  cashInput.addEventListener('input', updateDiff);
  updateDiff();

  overlay.querySelector('#closeSessionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = overlay.querySelector('#closeSessionId').value;
    const closingCash = parseFloat(cashInput.value) || 0;
    const notes = overlay.querySelector('#closeNotes').value.trim();
    const btn = overlay.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const r = await apiFetch.put('/api/sessions/' + id + '/close', { closingCash, notes });
      if (r && r.success) {
        if (window.Toast) window.Toast.success(t('sessionClosed', 'Session closed'));
        const closedSession = (r.data && r.data.session) || null;
        const closedSales   = (r.data && r.data.sales) || null;
        const closedSummary = (r.data && r.data.summary) || {};
        close();
        // Generate PDF report (renamed to downloadSessionReportPdf)
        if (closedSession) downloadSessionReportPdf(closedSession, closedSales, closedSummary);
        await refreshAll();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      if (window.Toast) window.Toast.error((err && err.message) || t('error', 'Error'));
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  setTimeout(() => { cashInput.focus(); cashInput.select(); }, 50);
}

/* ---------- View session detail modal ---------- */
async function viewSessionModal(session) {
  // Show modal with a loading state, then fetch session detail (now returns
  // { session, sales, summary } in a single response — see backend getSessionById)
  const html = `
    <div class="modal-overlay" id="viewSessionModal" role="dialog" aria-modal="true" aria-labelledby="viewSessionTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="viewSessionTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${t('sessionDetail', 'Session detail')} #${escapeHtml(sessionIdShort(session))}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" id="viewSessionBody">
          <div class="loading-state"><div class="spinner"></div><span>${t('loading', 'Loading...')}</span></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" type="button" data-action="cancel">${t('close', 'Close')}</button>
          <button class="btn btn-secondary" type="button" id="printSessionBtn" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            <span>${t('print', 'Print')}</span>
          </button>
          <button class="btn btn-primary" type="button" id="downloadSessionPdfBtn" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>${t('downloadReport', 'Download report (PDF)')}</span>
          </button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('viewSessionModal');
  const body = overlay.querySelector('#viewSessionBody');
  const dlBtn = overlay.querySelector('#downloadSessionPdfBtn');
  const printBtn = overlay.querySelector('#printSessionBtn');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Lazy-load settings so the PDF report can show store name / footer.
  try { if (!state.settings) await fetchSettings(); } catch (_) {}

  let detail = session;
  let sales = [];
  let summary = {};
  try {
    const r = await apiFetch.get('/api/sessions/' + session._id);
    if (r && r.success && r.data) {
      detail  = r.data.session  || (r.data.session === undefined ? r.data : session);
      sales   = Array.isArray(r.data.sales)   ? r.data.sales   : [];
      summary = r.data.summary || {};
    } else if (r && r.data) {
      // Tolerate legacy shape: data IS the session.
      detail  = r.data.session  || r.data;
      sales   = Array.isArray(r.data.sales)   ? r.data.sales   : [];
      summary = r.data.summary || {};
    }
  } catch (e) {
    console.error('[sessions] view fetch', e);
    body.innerHTML = '<div class="empty-state"><div class="empty-title">' + t('error', 'Error') + '</div><div class="empty-subtitle">' + escapeHtml((e && e.message) || '') + '</div></div>';
    return;
  }

  body.innerHTML = renderSessionDetail(detail, sales, summary);

  if (dlBtn) {
    dlBtn.disabled = false;
    dlBtn.addEventListener('click', () => downloadSessionReportPdf(detail, sales, summary));
  }
  if (printBtn) {
    printBtn.disabled = false;
    printBtn.addEventListener('click', () => printSessionReport(detail, sales, summary));
  }
}

function renderSessionDetail(s, sales, summary) {
  const sum = summary || {};
  const cashier = (s.user && (s.user.name || s.user.email)) || s.userName || '—';
  const rows = (sales || []).map(sv => {
    return `
      <tr>
        <td class="cell-strong">${escapeHtml(sv.saleNumber || sv.invoiceNumber || '—')}</td>
        <td class="cell-muted">${escapeHtml(fmtDateTime(sv.saleDate || sv.createdAt))}</td>
        <td>${escapeHtml(sv.paymentMethod || '—')}</td>
        <td class="cell-strong">${fmtCurrency(sv.total)}</td>
        <td>${statusBadge(sv.status)}</td>
      </tr>`;
  }).join('');

  const payRows = [
    { label: t('cash', 'Cash'),     value: sum.cashSales     || s.cashSales },
    { label: t('card', 'Card'),     value: sum.cardSales     || s.cardSales },
    { label: t('transfer', 'Transfer'), value: sum.transferSales || s.transferSales }
  ].filter(r => Number(r.value) > 0).map(r => `
    <tr><td class="cell-muted">${r.label}</td><td class="cell-strong">${fmtCurrency(r.value)}</td></tr>
  `).join('');

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;margin-bottom:1rem;">
      <div class="card" style="padding:0.85rem;box-shadow:none;">
        <div class="cell-muted" style="font-size:0.75rem;">${t('cashier', 'Cashier')}</div>
        <div style="font-weight:700;">${escapeHtml(cashier)}</div>
      </div>
      <div class="card" style="padding:0.85rem;box-shadow:none;">
        <div class="cell-muted" style="font-size:0.75rem;">${t('status', 'Status')}</div>
        <div>${statusBadge(s.status)}</div>
      </div>
      <div class="card" style="padding:0.85rem;box-shadow:none;">
        <div class="cell-muted" style="font-size:0.75rem;">${t('openedAt', 'Opened')}</div>
        <div style="font-weight:700;font-size:0.9rem;">${escapeHtml(fmtDateTime(s.openedAt))}</div>
      </div>
      <div class="card" style="padding:0.85rem;box-shadow:none;">
        <div class="cell-muted" style="font-size:0.75rem;">${t('closedAt', 'Closed')}</div>
        <div style="font-weight:700;font-size:0.9rem;">${s.closedAt ? escapeHtml(fmtDateTime(s.closedAt)) : '—'}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem;box-shadow:none;">
      <div class="card-header"><div class="card-title">${t('cashSummary', 'Cash summary')}</div></div>
      <div class="card-body" style="padding:0;">
        <div class="table-wrap">
          <table class="table">
            <tbody>
              <tr><td class="cell-muted">${t('openingCash', 'Opening cash')}</td><td class="cell-strong">${fmtCurrency(sum.openingCash || s.openingBalance || 0)}</td></tr>
              <tr><td class="cell-muted">${t('totalSales', 'Total sales')}</td><td class="cell-strong">${fmtCurrency(sum.totalSales || s.totalSales || 0)}</td></tr>
              <tr><td class="cell-muted">${t('totalDiscount', 'Total discount')}</td><td>${fmtCurrency(sum.totalDiscount || s.totalDiscount || 0)}</td></tr>
              <tr><td class="cell-muted">${t('totalTax', 'Total tax')}</td><td>${fmtCurrency(sum.totalTax || s.totalTax || 0)}</td></tr>
              <tr><td class="cell-muted">${t('salesCount', 'Sales count')}</td><td>${escapeHtml(String(sum.saleCount || s.saleCount || 0))}</td></tr>
              <tr><td class="cell-muted">${t('cashSales', 'Cash sales')}</td><td>${fmtCurrency(sum.cashSales || s.cashSales || 0)}</td></tr>
              <tr><td class="cell-muted">${t('cardSales', 'Card sales')}</td><td>${fmtCurrency(sum.cardSales || s.cardSales || 0)}</td></tr>
              <tr><td class="cell-muted">${t('transferSales', 'Transfer sales')}</td><td>${fmtCurrency(sum.transferSales || s.transferSales || 0)}</td></tr>
              <tr><td class="cell-muted">${t('expectedCash', 'Expected cash')}</td><td class="cell-strong" style="color:var(--primary);">${fmtCurrency(sum.expectedCash || s.expectedCash || 0)}</td></tr>
              <tr><td class="cell-muted">${t('countedCash', 'Counted cash')}</td><td>${fmtCurrency(sum.actualCash || s.actualCash || 0)}</td></tr>
              <tr><td class="cell-muted">${t('difference', 'Difference')}</td><td>${differenceCell(sum.difference || s.difference || 0)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="box-shadow:none;">
      <div class="card-header"><div class="card-title">${t('sessionSales', 'Session sales')} (${(sales || []).length})</div></div>
      <div class="card-body" style="padding:0;">
        ${sales && sales.length ? `
          <div class="table-wrap" style="max-height:340px;overflow-y:auto;">
            <table class="table table-hover">
              <thead>
                <tr>
                  <th>${t('invoice', 'Invoice')}</th>
                  <th>${t('date', 'Date')}</th>
                  <th>${t('paymentMethod', 'Payment method')}</th>
                  <th>${t('total', 'Total')}</th>
                  <th>${t('status', 'Status')}</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>` : `
          <div class="empty-state">
            <div class="empty-title">${t('noSalesSession', 'No sales in this session')}</div>
          </div>`}
      </div>
    </div>

    ${s.notes ? `<div class="form-group" style="margin-top:1rem;"><label class="form-label">${t('notes', 'Notes')}</label><div class="cell-muted">${escapeHtml(s.notes)}</div></div>` : ''}
  `;
}

/* ---------- PDF report ---------- */
async function downloadSessionReportPdf(s, salesArr, summary) {
  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
    if (window.Toast) window.Toast.warning(t('pdfLibMissing', 'PDF library not loaded'));
    return;
  }
  // Ensure settings loaded so we can render the store name / footer
  try { if (!state.settings) await fetchSettings(); } catch (_) {}
  // If sales were not provided (e.g. called from the close-session flow),
  // try to fetch them in a single round-trip along with summary.
  if ((!salesArr || !salesArr.length) && s && s._id) {
    try {
      const r = await apiFetch.get('/api/sessions/' + s._id);
      if (r && r.success && r.data) {
        if (!salesArr || !salesArr.length) salesArr = Array.isArray(r.data.sales) ? r.data.sales : (salesArr || []);
        if (!summary || !Object.keys(summary).length) summary = r.data.summary || summary || {};
        if (r.data.session) s = Object.assign({}, s, r.data.session); // keep latest fields
      }
    } catch (e) { console.warn('[sessions] pdf fetch', e); }
  }

  const settings = state.settings || {};
  const sum = summary || {};
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;

  // Title (store name from settings if available)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(16, 185, 129);
  doc.text(settings.storeName || t('appName', 'DZ POS PRO'), M, y);
  y += 22;
  doc.setFontSize(13);
  doc.setTextColor(60, 60, 60);
  doc.text(t('sessionReport', 'Session report'), M, y);
  y += 18;

  // Session meta
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  const cashier = (s.user && (s.user.name || s.user.email)) || s.userName || '—';
  const openedMs = s.openedAt ? new Date(s.openedAt).getTime() : 0;
  const closedMs = s.closedAt ? new Date(s.closedAt).getTime() : 0;
  const elapsedMs = openedMs ? (closedMs || Date.now()) - openedMs : 0;
  const elapsedStr = elapsedMs > 0 ? fmtElapsedStatic(elapsedMs) : '—';
  const meta = [
    [t('sessionId', 'Session') + ':', '#' + sessionIdShort(s)],
    [t('cashier', 'Cashier') + ':', cashier],
    [t('openedAt', 'Opened') + ':', fmtDateTime(s.openedAt)],
    [t('closedAt', 'Closed') + ':', s.closedAt ? fmtDateTime(s.closedAt) : '—'],
    [t('elapsed', 'Elapsed') + ':', elapsedStr],
    [t('status', 'Status') + ':', s.status || '—']
  ];
  meta.forEach(row => {
    doc.setTextColor(120, 120, 120);
    doc.text(row[0], M, y);
    doc.setTextColor(30, 30, 30);
    doc.text(row[1], M + 130, y);
    y += 16;
  });
  y += 10;

  // Divider
  doc.setDrawColor(220, 220, 220);
  doc.line(M, y, W - M, y);
  y += 18;

  // Cash summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30, 30, 30);
  doc.text(t('cashSummary', 'Cash summary'), M, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const sumRows = [
    [t('openingCash', 'Opening cash'),   fmtCurrency(sum.openingCash || s.openingBalance || 0)],
    [t('totalSales', 'Total sales'),     fmtCurrency(sum.totalSales || s.totalSales || 0)],
    [t('totalDiscount', 'Total discount'), fmtCurrency(sum.totalDiscount || s.totalDiscount || 0)],
    [t('totalTax', 'Total tax'),         fmtCurrency(sum.totalTax || s.totalTax || 0)],
    [t('salesCount', 'Sales count'),     String(sum.saleCount || s.saleCount || 0)],
    [t('cashSales', 'Cash sales'),       fmtCurrency(sum.cashSales || s.cashSales || 0)],
    [t('cardSales', 'Card sales'),       fmtCurrency(sum.cardSales || s.cardSales || 0)],
    [t('transferSales', 'Transfer sales'), fmtCurrency(sum.transferSales || s.transferSales || 0)],
    [t('expectedCash', 'Expected cash'), fmtCurrency(sum.expectedCash || s.expectedCash || 0)],
    [t('countedCash', 'Counted cash'),   fmtCurrency(sum.actualCash || s.actualCash || 0)],
    [t('difference', 'Difference'),      fmtCurrency(sum.difference || s.difference || 0)]
  ];
  sumRows.forEach(r => {
    doc.setTextColor(120, 120, 120);
    doc.text(r[0], M, y);
    doc.setTextColor(30, 30, 30);
    doc.text(r[1], W - M - doc.getTextWidth(r[1]), y);
    y += 14;
  });
  y += 12;

  // Sales list (table)
  if (salesArr && salesArr.length) {
    if (y > H - 120) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 30);
    doc.text(t('sessionSales', 'Session sales') + ' (' + salesArr.length + ')', M, y);
    y += 16;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(t('invoice', 'Invoice'), M, y);
    doc.text(t('date', 'Date'), M + 130, y);
    doc.text(t('paymentMethod', 'Payment'), M + 280, y);
    doc.text(t('total', 'Total'), W - M, y, { align: 'right' });
    y += 6;
    doc.setDrawColor(220, 220, 220);
    doc.line(M, y, W - M, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    salesArr.forEach(sv => {
      if (y > H - 40) { doc.addPage(); y = M; }
      doc.text(String(sv.saleNumber || sv.invoiceNumber || '—'), M, y);
      doc.text(fmtDateTime(sv.saleDate || sv.createdAt), M + 130, y);
      doc.text(String(sv.paymentMethod || '—'), M + 280, y);
      const tot = fmtCurrency(sv.total);
      doc.text(tot, W - M, y, { align: 'right' });
      y += 14;
    });
  }

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(t('generatedAt', 'Generated at') + ': ' + fmtDateTime(new Date().toISOString()), M, H - 24);
  if (settings.invoiceFooter) {
    doc.text(settings.invoiceFooter, W - M, H - 24, { align: 'right' });
  }

  const filename = 'session-' + sessionIdShort(s) + '.pdf';
  doc.save(filename);
  if (window.Toast) window.Toast.success(t('pdfReady', 'PDF ready'));
}

/* ---------- Print session report (hidden iframe) ---------- */
function printSessionReport(s, salesArr, summary) {
  const settings = state.settings || {};
  const sum = summary || {};
  const cashier = (s.user && (s.user.name || s.user.email)) || s.userName || '—';
  const openedMs = s.openedAt ? new Date(s.openedAt).getTime() : 0;
  const closedMs = s.closedAt ? new Date(s.closedAt).getTime() : 0;
  const elapsedMs = openedMs ? (closedMs || Date.now()) - openedMs : 0;
  const elapsedStr = elapsedMs > 0 ? fmtElapsedStatic(elapsedMs) : '—';

  const salesRows = (salesArr || []).map(sv => `
    <tr>
      <td>${escapeHtml(sv.saleNumber || sv.invoiceNumber || '—')}</td>
      <td>${escapeHtml(fmtDateTime(sv.saleDate || sv.createdAt))}</td>
      <td>${escapeHtml(sv.paymentMethod || '—')}</td>
      <td style="text-align:right;">${escapeHtml(fmtCurrency(sv.total))}</td>
      <td>${escapeHtml(sv.status || '—')}</td>
    </tr>`).join('');

  const sumRows = [
    [t('openingCash', 'Opening cash'),   fmtCurrency(sum.openingCash || s.openingBalance || 0)],
    [t('totalSales', 'Total sales'),     fmtCurrency(sum.totalSales || s.totalSales || 0)],
    [t('totalDiscount', 'Total discount'), fmtCurrency(sum.totalDiscount || s.totalDiscount || 0)],
    [t('totalTax', 'Total tax'),         fmtCurrency(sum.totalTax || s.totalTax || 0)],
    [t('salesCount', 'Sales count'),     String(sum.saleCount || s.saleCount || 0)],
    [t('cashSales', 'Cash sales'),       fmtCurrency(sum.cashSales || s.cashSales || 0)],
    [t('cardSales', 'Card sales'),       fmtCurrency(sum.cardSales || s.cardSales || 0)],
    [t('transferSales', 'Transfer sales'), fmtCurrency(sum.transferSales || s.transferSales || 0)],
    [t('expectedCash', 'Expected cash'), fmtCurrency(sum.expectedCash || s.expectedCash || 0)],
    [t('countedCash', 'Counted cash'),   fmtCurrency(sum.actualCash || s.actualCash || 0)],
    [t('difference', 'Difference'),      fmtCurrency(sum.difference || s.difference || 0)]
  ];
  const sumRowsHtml = sumRows.map(r =>
    `<tr><td>${escapeHtml(r[0])}</td><td style="text-align:right;font-weight:700;">${escapeHtml(r[1])}</td></tr>`
  ).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t('sessionReport', 'Session report'))}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color:#111; padding:24px; font-size:12px; }
    h1 { font-size:22px; margin:0 0 4px; color:#10b981; }
    h2 { font-size:14px; margin:14px 0 6px; color:#333; }
    .muted { color:#555; font-size:11px; }
    .meta { margin:8px 0 16px; }
    .meta div { margin:2px 0; }
    table { width:100%; border-collapse:collapse; margin:8px 0 16px; }
    th, td { padding:6px 8px; border-bottom:1px solid #ddd; text-align:left; }
    th { background:#10b981; color:#fff; font-size:11px; text-transform:uppercase; }
    .totals-table { max-width:340px; margin-left:auto; }
    .totals-table th, .totals-table td { padding:4px 8px; }
    .footer { margin-top:24px; border-top:1px solid #ddd; padding-top:8px; text-align:center; color:#555; font-size:10px; }
    @media print { body { padding:0; } }
  </style></head><body>
    <h1>${escapeHtml(settings.storeName || 'DZ POS PRO')}</h1>
    <div class="muted">${escapeHtml(t('sessionReport', 'Session report'))}</div>
    <div class="meta">
      <div><strong>${escapeHtml(t('sessionId', 'Session'))}:</strong> #${escapeHtml(sessionIdShort(s))}</div>
      <div><strong>${escapeHtml(t('cashier', 'Cashier'))}:</strong> ${escapeHtml(cashier)}</div>
      <div><strong>${escapeHtml(t('openedAt', 'Opened'))}:</strong> ${escapeHtml(fmtDateTime(s.openedAt))}</div>
      <div><strong>${escapeHtml(t('closedAt', 'Closed'))}:</strong> ${escapeHtml(s.closedAt ? fmtDateTime(s.closedAt) : '—')}</div>
      <div><strong>${escapeHtml(t('elapsed', 'Elapsed'))}:</strong> ${escapeHtml(elapsedStr)}</div>
      <div><strong>${escapeHtml(t('status', 'Status'))}:</strong> ${escapeHtml(s.status || '—')}</div>
    </div>
    <h2>${escapeHtml(t('cashSummary', 'Cash summary'))}</h2>
    <table class="totals-table">
      <tbody>${sumRowsHtml}</tbody>
    </table>
    <h2>${escapeHtml(t('sessionSales', 'Session sales'))} (${(salesArr || []).length})</h2>
    <table>
      <thead><tr>
        <th>${escapeHtml(t('invoice', 'Invoice'))}</th>
        <th>${escapeHtml(t('date', 'Date'))}</th>
        <th>${escapeHtml(t('paymentMethod', 'Payment'))}</th>
        <th style="text-align:right;">${escapeHtml(t('total', 'Total'))}</th>
        <th>${escapeHtml(t('status', 'Status'))}</th>
      </tr></thead>
      <tbody>${salesRows || `<tr><td colspan="5" style="text-align:center;">${escapeHtml(t('noSalesSession', 'No sales in this session'))}</td></tr>`}</tbody>
    </table>
    <div class="footer">${escapeHtml(t('generatedAt', 'Generated at'))}: ${escapeHtml(fmtDateTime(new Date().toISOString()))}</div>
  </body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) {
      console.warn('[sessions] print failed', e);
      if (window.Toast) window.Toast.error(t('printFailed', 'Print failed'));
    }
    setTimeout(() => iframe.remove(), 2000);
  }, 400);
}

/* ---------- Entry ---------- */
export async function renderSessionsPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.status = '';
  state.currentSession = null; state.currentStats = null;
  content.innerHTML = renderSkeleton();
  await Promise.all([fetchCurrentSession(), fetchSessions()]);
  render();
}
