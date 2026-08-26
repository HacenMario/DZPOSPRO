/* ============================================================
 * js/modules/returns.js
 * ------------------------------------------------------------
 * Renders the Returns management page into #pageContent.
 *
 * Backend contract (verified):
 *   GET /api/returns?page=&limit=&search=&from=&to=
 *     → { success, data:[...], total, page, limit, totalPages }
 *   GET /api/returns/:id → { success, data: { return, ... } }
 *   POST /api/returns  body { sale, items:[{ saleItem, product,
 *                                  quantity, price }], reason }
 *
 * Return shape:
 *   { _id, returnNumber, sale:{_id, saleNumber, total},
 *     items:[{ saleItem, product:{_id, name}, quantity, price,
 *             total, reason }],
 *     reason: {ar,en,fr} | string,
 *     totalRefund, createdBy:{_id, name}, createdAt }
 *
 * Sale lookup:
 *   GET /api/sales?search=<saleNumber>&limit=10
 *   GET /api/sales/:id   → full sale with items[]
 *
 * Features:
 *   • Toolbar: search (debounced), date range, refresh,
 *     "New return"
 *   • Server-side paginated table
 *     Columns: #, Return # (strong mono), Sale # (clickable →
 *     sale-detail modal), Items count, Total refund (currency),
 *     Reason (string or reason.en/ar), Created by, Date,
 *     Actions (view)
 *   • View-return modal (full detail: items table, totals)
 *   • "New Return" multi-step modal (single modal with step
 *     indicator):
 *       Step 1 — find the sale by sale number
 *       Step 2 — select items + qty + reason per item
 *       Step 3 — review + confirm → POST /api/returns
 *   • All text via window.t(); all API calls via window.apiFetch()
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  page: 1,
  limit: 20,
  search: '',
  from: '',
  to: '',
  pagination: null,
  items: []
};

// "New Return" flow state — scoped to a single open modal
let newReturn = {
  sale: null,
  saleItems: [],          // normalized original sale items
  selected: new Map(),    // saleItemId -> { quantity, reason, notes }
  globalReason: ''
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

function fmtNumber(n) { return Number(n || 0).toLocaleString(); }

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return escapeHtml(String(d));
  return dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function currentLang() {
  return (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';
}

function saleNumber(sale) {
  if (!sale) return '—';
  return sale.saleNumber || sale.invoiceNumber || ('#' + String(sale._id || '').slice(-6).toUpperCase());
}

function returnNumber(ret) {
  if (!ret) return '—';
  return ret.returnNumber || ('RET-' + String(ret._id || '').slice(-6).toUpperCase());
}

function productName(p) {
  if (!p) return '—';
  if (typeof p === 'string') return p;
  if (typeof p.name === 'object' && p.name !== null) {
    const lang = currentLang();
    return p.name[lang] || p.name.ar || p.name.en || p.name.fr || '—';
  }
  return p.name || p.displayName || '—';
}

function customerName(c) {
  if (!c) return t('noCustomer', 'Walk-in customer');
  if (typeof c === 'string') return escapeHtml(c.slice(-8));
  const name = (typeof c.name === 'object' && c.name !== null)
    ? (c.name[currentLang()] || c.name.ar || c.name.en || c.name.fr || '')
    : (c.name || c.fullName || '');
  return escapeHtml(name || t('noCustomer', 'Walk-in customer'));
}

const RETURN_REASONS = [
  { value: 'defective',         key: 'returnReasonDefective' },
  { value: 'wrong_item',        key: 'returnReasonWrongItem' },
  { value: 'customer_request',  key: 'returnReasonCustomerRequest' },
  { value: 'other',             key: 'returnReasonOther' }
];

// Reason may be a string code, a free-text string, or {ar,en,fr}
function reasonText(r) {
  if (r == null || r === '') return '';
  if (typeof r === 'object') {
    const lang = currentLang();
    return r[lang] || r.en || r.ar || r.fr || '';
  }
  // string
  const found = RETURN_REASONS.find(x => x.value === r);
  return found ? t(found.key, found.value) : String(r);
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title"><span class="page-title-text">${t('returns', 'Returns')}</span></h1>
      </div>
      <div class="page-actions"><div class="skeleton" style="height:40px;width:160px;"></div></div>
    </div>
    <div class="toolbar">
      <div class="skeleton" style="height:40px;width:280px;"></div>
      <div class="skeleton" style="height:40px;width:140px;"></div>
      <div class="skeleton" style="height:40px;width:140px;"></div>
    </div>
    <div class="table-wrap">
      ${[1,2,3,4,5,6].map(() => '<div class="skeleton skeleton-line" style="height:48px;margin:0;border-radius:0;"></div>').join('')}
    </div>`;
}

/* ---------- Toolbar ---------- */
function renderToolbar() {
  return `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">
          <svg id="pageTitleIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          <span class="page-title-text">${t('returns', 'Returns')}</span>
        </h1>
        <div class="page-subtitle">${t('returnsSubtitle', 'Process refunds and merchandise returns')}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary btn-sm" id="returnRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
        <button class="btn btn-primary" id="addReturnBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('newReturn', 'New return')}</span>
        </button>
      </div>
    </div>
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" id="returnSearch" type="search"
                 placeholder="${escapeHtml(t('searchReturns', 'Search by return or sale number...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <input class="input" id="returnFrom" type="date" value="${state.from}" style="width:auto;" title="${t('fromDate', 'From')}" aria-label="${t('fromDate', 'From')}" />
        <input class="input" id="returnTo"   type="date" value="${state.to}"   style="width:auto;" title="${t('toDate', 'To')}" aria-label="${t('toDate', 'To')}" />
      </div>
    </div>`;
}

/* ---------- Table ---------- */
function renderTable() {
  if (!state.items.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </div>
        <div class="empty-title">${t('noReturnsMatch', 'No matching returns')}</div>
        <div class="empty-subtitle">${t('noReturns', 'No returns found')}</div>
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="emptyAddReturnBtn" type="button">${t('newReturn', 'New return')}</button>
        </div>
      </div>`;
  }

  const rows = state.items.map((r, i) => {
    const sale = r.sale || {};
    const sNum = saleNumber(sale);
    const itemsCount = (r.items && r.items.length) || 0;
    const totalRefund = Number(r.totalRefund != null ? r.totalRefund : r.total || 0);
    const reason = reasonText(r.reason);
    const createdBy = r.createdBy && (r.createdBy.name || r.createdBy.fullName)
      ? escapeHtml(r.createdBy.name || r.createdBy.fullName) : '—';
    const idx = (state.page - 1) * state.limit + i + 1;
    return `
      <tr>
        <td class="cell-muted">${idx}</td>
        <td class="cell-strong" style="font-family:var(--font-mono, monospace);">${escapeHtml(returnNumber(r))}</td>
        <td>
          <button class="btn btn-ghost btn-sm" type="button" data-sale-id="${sale._id || ''}" data-sale-number="${escapeHtml(sNum)}" style="padding:0.15rem 0.4rem;height:auto;font-family:var(--font-mono, monospace);color:var(--primary);">
            ${escapeHtml(sNum)}
          </button>
        </td>
        <td>${fmtNumber(itemsCount)}</td>
        <td class="cell-strong">${escapeHtml(fmtCurrency(totalRefund))}</td>
        <td class="cell-muted">${escapeHtml(reason || '—')}</td>
        <td class="cell-muted">${createdBy}</td>
        <td class="cell-muted">${escapeHtml(fmtDateTime(r.createdAt))}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn view" data-id="${r._id}" aria-label="${t('viewReturn', 'View return')}" title="${t('viewReturn', 'View return')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  const p = state.pagination || { page: state.page, pages: 1, total: state.items.length, limit: state.limit };
  const from = p.total === 0 ? 0 : ((p.page - 1) * p.limit + 1);
  const to = Math.min(p.page * p.limit, p.total);
  const pageBtns = [];
  pageBtns.push(`<button class="page-btn" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''} aria-label="${t('previous', 'Previous')}">«</button>`);
  let start = Math.max(1, p.page - 2), end = Math.min(p.pages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) {
    pageBtns.push(`<button class="page-btn ${i === p.page ? 'active' : ''}" data-page="${i}">${i}</button>`);
  }
  pageBtns.push(`<button class="page-btn" data-page="${p.page + 1}" ${p.page >= p.pages ? 'disabled' : ''} aria-label="${t('next', 'Next')}">»</button>`);

  return `
    <div class="table-wrap">
      <table class="table table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>${t('returnNumber', 'Return #')}</th>
            <th>${t('saleNumber', 'Sale #')}</th>
            <th>${t('items', 'Items')}</th>
            <th>${t('returnTotal', 'Total refund')}</th>
            <th>${t('reason', 'Reason')}</th>
            <th>${t('createdBy', 'Created by')}</th>
            <th>${t('date', 'Date')}</th>
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
async function fetchReturns() {
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  if (state.from) qs.from = state.from;
  if (state.to) qs.to = state.to;
  try {
    const r = await apiFetch.get('/api/returns', qs);
    if (r && r.success) {
      state.items = r.data || r.returns || [];
      if (r.totalPages != null) {
        state.pagination = { page: r.page || state.page, pages: r.totalPages, total: r.total || 0, limit: r.limit || state.limit };
      } else if (r.pagination) {
        state.pagination = r.pagination;
      } else if (r.total != null) {
        state.pagination = { page: state.page, pages: Math.max(1, Math.ceil(r.total / state.limit)), total: r.total, limit: state.limit };
      } else {
        state.pagination = null;
      }
    } else {
      state.items = []; state.pagination = null;
    }
  } catch (e) {
    console.error('[returns] fetch', e);
    state.items = []; state.pagination = null;
  }
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = renderToolbar() + '<div id="returnsTableContainer">' + renderTable() + '</div>';
  bindToolbar();
  bindTable();
}

function bindToolbar() {
  const search = document.getElementById('returnSearch');
  if (search) {
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.search = search.value.trim();
        state.page = 1;
        refreshTable();
      }, 350);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); state.search = search.value.trim(); state.page = 1; refreshTable(); }
    });
  }
  const from = document.getElementById('returnFrom');
  if (from) from.addEventListener('change', () => { state.from = from.value; state.page = 1; refreshTable(); });
  const to = document.getElementById('returnTo');
  if (to) to.addEventListener('change', () => { state.to = to.value; state.page = 1; refreshTable(); });
  const addBtn = document.getElementById('addReturnBtn');
  if (addBtn) addBtn.addEventListener('click', () => openNewReturnModal());
  const emptyAdd = document.getElementById('emptyAddReturnBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openNewReturnModal());
  const refresh = document.getElementById('returnRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => refreshTable());
}

function bindTable() {
  document.querySelectorAll('#returnsTableContainer .table-action-btn.view').forEach(b => {
    b.addEventListener('click', () => openViewReturnModal(b.dataset.id));
  });
  document.querySelectorAll('#returnsTableContainer [data-sale-id]').forEach(b => {
    b.addEventListener('click', () => openSaleDetailModal(b.dataset.saleId, b.dataset.saleNumber));
  });
  document.querySelectorAll('#returnsTableContainer .page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshTable(); }
    });
  });
}

async function refreshTable() {
  const container = document.getElementById('returnsTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchReturns();
  if (container) container.innerHTML = renderTable();
  bindTable();
}

/* ---------- View return modal ---------- */
async function openViewReturnModal(id) {
  const ret = state.items.find(x => x._id === id);
  if (!ret) {
    try {
      const r = await apiFetch.get('/api/returns/' + id);
      const data = r && r.success ? (r.data && (r.data.return || r.data)) || r.return || r.data : null;
      if (data) { openViewReturnModalWithData(data); return; }
    } catch (e) {
      if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
    }
    return;
  }
  openViewReturnModalWithData(ret);
}

function openViewReturnModalWithData(ret) {
  const sale = ret.sale || {};
  const items = (ret.items || []).map((it, idx) => {
    const pname = productName(it.product);
    const lineTotal = Number(it.total != null ? it.total : (Number(it.quantity || 0) * Number(it.price || 0)));
    const itReason = reasonText(it.reason);
    return `
      <tr>
        <td class="cell-muted">${idx + 1}</td>
        <td class="cell-strong">${escapeHtml(pname)}</td>
        <td>${fmtNumber(it.quantity)}</td>
        <td>${escapeHtml(fmtCurrency(it.price))}</td>
        <td class="cell-muted">${escapeHtml(fmtCurrency(lineTotal))}</td>
        <td class="cell-muted">${escapeHtml(itReason || '—')}</td>
      </tr>`;
  }).join('');

  const totalRefund = Number(ret.totalRefund != null ? ret.totalRefund : ret.total || 0);

  const html = `
    <div class="modal-overlay" id="viewReturnModal" role="dialog" aria-modal="true" aria-labelledby="viewReturnTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="viewReturnTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span>${t('returnDetails', 'Return details')} — ${escapeHtml(returnNumber(ret))}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-row" style="margin-bottom:0.5rem;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${t('saleNumber', 'Sale #')}</label>
              <div style="font-family:var(--font-mono, monospace);">${escapeHtml(saleNumber(sale))}</div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${t('date', 'Date')}</label>
              <div>${escapeHtml(fmtDateTime(ret.createdAt))}</div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${t('createdBy', 'Created by')}</label>
              <div>${ret.createdBy && (ret.createdBy.name || ret.createdBy.fullName) ? escapeHtml(ret.createdBy.name || ret.createdBy.fullName) : '—'}</div>
            </div>
          </div>

          <div class="form-group" style="margin-top:1rem;">
            <label class="form-label">${t('returnReason', 'Return reason')}</label>
            <div>${escapeHtml(reasonText(ret.reason) || '—')}</div>
          </div>

          <hr class="divider" />

          <div class="form-label" style="margin-bottom:0.5rem;">${t('returnItems', 'Returned items')}</div>
          <div class="table-wrap" style="max-height:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>${t('product', 'Product')}</th>
                  <th>${t('quantity', 'Quantity')}</th>
                  <th>${t('price', 'Price')}</th>
                  <th>${t('subtotal', 'Subtotal')}</th>
                  <th>${t('reason', 'Reason')}</th>
                </tr>
              </thead>
              <tbody>
                ${items || '<tr><td colspan="6" class="cell-muted" style="text-align:center;padding:1rem;">' + t('noData', 'No data') + '</td></tr>'}
              </tbody>
            </table>
          </div>

          <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
            <div style="min-width:220px;">
              <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-top:1px solid var(--border-color);margin-top:0.3rem;">
                <span class="cell-strong">${t('returnTotal', 'Total refund')}</span>
                <span class="cell-strong">${escapeHtml(fmtCurrency(totalRefund))}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" type="button" data-action="close">${t('close', 'Close')}</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('viewReturnModal');
  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="close"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

/* ---------- Sale detail modal (clickable sale #) ---------- */
async function openSaleDetailModal(saleId, saleNumHint) {
  if (!saleId) {
    if (window.Toast) window.Toast.info(t('noSaleFound', 'No sale found'));
    return;
  }
  // Quick loading modal
  const wrap = document.createElement('div');
  wrap.className = 'modal-overlay';
  wrap.id = 'saleDetailModal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = '<div class="modal modal-lg"><div class="modal-body"><div class="loading-state"><div class="spinner"></div><span>' + escapeHtml(t('loading', 'Loading...')) + '</span></div></div></div>';
  document.body.appendChild(wrap);

  let sale = null;
  try {
    const r = await apiFetch.get('/api/sales/' + saleId);
    if (r && r.success) sale = r.sale || (r.data && (r.data.sale || r.data)) || r.data || null;
  } catch (e) { /* ignore */ }

  wrap.remove();
  if (!sale) {
    if (window.Toast) window.Toast.error(t('noSaleFound', 'No sale found'));
    return;
  }
  renderSaleDetailModal(sale);
}

function renderSaleDetailModal(sale) {
  const items = (sale.items || []).map((it, i) => {
    const pname = productName(it.product);
    const qty = Number(it.quantity || 0);
    const price = Number(it.price || it.unitPrice || 0);
    const lineTotal = Number(it.total != null ? it.total : qty * price);
    return `
      <tr>
        <td class="cell-muted">${i + 1}</td>
        <td class="cell-strong">${escapeHtml(pname)}</td>
        <td>${fmtNumber(qty)}</td>
        <td>${escapeHtml(fmtCurrency(price))}</td>
        <td>${escapeHtml(fmtCurrency(lineTotal))}</td>
      </tr>`;
  }).join('');

  const html = `
    <div class="modal-overlay" id="saleDetailModal" role="dialog" aria-modal="true" aria-labelledby="saleDetailTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="saleDetailTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>${t('saleDetails', 'Sale details')} — ${escapeHtml(saleNumber(sale))}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-row" style="margin-bottom:0.5rem;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${t('customer', 'Customer')}</label>
              <div>${customerName(sale.customer)}</div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${t('date', 'Date')}</label>
              <div>${escapeHtml(fmtDateTime(sale.createdAt || sale.date || sale.saleDate))}</div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${t('paymentMethod', 'Payment method')}</label>
              <div>${escapeHtml(sale.paymentMethod || sale.payment || '—')}</div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${t('status', 'Status')}</label>
              <div>${escapeHtml(sale.status || '—')}</div>
            </div>
          </div>
          <hr class="divider" />
          <div class="table-wrap" style="max-height:none;">
            <table class="table">
              <thead><tr><th>#</th><th>${t('product', 'Product')}</th><th>${t('quantity', 'Quantity')}</th><th>${t('price', 'Price')}</th><th>${t('subtotal', 'Subtotal')}</th></tr></thead>
              <tbody>${items || '<tr><td colspan="5" class="cell-muted" style="text-align:center;padding:1rem;">' + t('noData', 'No data') + '</td></tr>'}</tbody>
            </table>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
            <div style="min-width:220px;">
              <div style="display:flex;justify-content:space-between;padding:0.3rem 0;"><span class="cell-muted">${t('subtotal', 'Subtotal')}</span><span>${escapeHtml(fmtCurrency(sale.subtotal))}</span></div>
              <div style="display:flex;justify-content:space-between;padding:0.3rem 0;"><span class="cell-muted">${t('tax', 'Tax')}</span><span>${escapeHtml(fmtCurrency(sale.tax))}</span></div>
              <div style="display:flex;justify-content:space-between;padding:0.3rem 0;"><span class="cell-muted">${t('discount', 'Discount')}</span><span>-${escapeHtml(fmtCurrency(sale.discount))}</span></div>
              <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-top:1px solid var(--border-color);margin-top:0.3rem;"><span class="cell-strong">${t('total', 'Total')}</span><span class="cell-strong">${escapeHtml(fmtCurrency(sale.total))}</span></div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" type="button" data-action="close">${t('close', 'Close')}</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('saleDetailModal');
  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="close"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

/* ============================================================
 * NEW RETURN MODAL — single modal with 3-step indicator
 *   Step 1: Find the sale by sale number
 *   Step 2: Select items + qty + reason per item
 *   Step 3: Review + confirm → POST /api/returns
 * ============================================================ */
function renderStepIndicator(current) {
  // current: 1 | 2 | 3
  const steps = [
    { n: 1, key: 'findSale',            label: t('findSale', 'Find the sale') },
    { n: 2, key: 'selectItemsToReturn', label: t('selectItemsToReturn', 'Select items to return') },
    { n: 3, key: 'reviewReturn',        label: t('reviewReturn', 'Review the return') }
  ];
  return `
    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;padding:0.5rem 0.75rem;background:var(--bg-body, #f8fafc);border:1px solid var(--border-color, #e2e8f0);border-radius:var(--radius-sm, 8px);">
      ${steps.map((s, i) => {
        const active = s.n === current;
        const done = s.n < current;
        const bg = active ? 'var(--primary)' : (done ? 'var(--success)' : 'var(--bg-hover, #e2e8f0)');
        const color = (active || done) ? '#fff' : 'var(--text-muted, #64748b)';
        const numContent = done
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg>'
          : String(s.n);
        return `
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${bg};color:${color};font-size:0.75rem;font-weight:700;flex-shrink:0;">${numContent}</span>
            <span style="font-size:0.8rem;font-weight:${active ? '700' : '500'};color:${active ? 'var(--text-primary, #0f172a)' : 'var(--text-muted, #64748b)'};">${escapeHtml(s.label)}</span>
            ${i < steps.length - 1 ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;color:var(--text-muted, #94a3b8);margin:0 0.25rem;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' : ''}
          </div>`;
      }).join('')}
    </div>`;
}

function openNewReturnModal() {
  // Reset flow state
  newReturn = {
    sale: null,
    saleItems: [],
    selected: new Map(),
    globalReason: ''
  };

  const html = `
    <div class="modal-overlay" id="newReturnModal" role="dialog" aria-modal="true" aria-labelledby="newReturnTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="newReturnTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span>${t('newReturn', 'New return')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" id="newReturnBody">
          ${renderStep1()}
        </div>
        <div class="modal-footer" id="newReturnFooter">
          <button class="btn btn-ghost" type="button" data-action="cancel">${t('cancel', 'Cancel')}</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('newReturnModal');
  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  bindStep1(overlay);
}

/* ---------- Step 1: Find the sale ---------- */
function renderStep1() {
  return `
    ${renderStepIndicator(1)}
    <div class="form-group">
      <label class="form-label" for="returnSaleSearch">${t('findSale', 'Find the sale')}</label>
      <div class="search-box" style="max-width:none;width:100%;">
        <span class="search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input class="input" id="returnSaleSearch" type="search"
               placeholder="${escapeHtml(t('searchSale', 'Enter sale number...'))}" />
      </div>
      <div class="help-text">${t('findSaleHelp', 'Search by invoice / sale number, then pick the matching sale')}</div>
    </div>
    <div id="returnSaleResults" style="margin-top:0.5rem;"></div>`;
}

function bindStep1(overlay) {
  const search = overlay.querySelector('#returnSaleSearch');
  const results = overlay.querySelector('#returnSaleResults');
  if (!search || !results) return;

  let debounce;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = search.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    debounce = setTimeout(() => searchSales(q, results), 350);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounce);
      const q = search.value.trim();
      if (q) searchSales(q, results);
    }
  });
  setTimeout(() => search.focus(), 50);
}

async function searchSales(q, resultsEl) {
  resultsEl.innerHTML = '<div class="loading-state" style="padding:1rem;"><div class="spinner sm"></div><span>' + escapeHtml(t('loading', 'Loading...')) + '</span></div>';
  let sales = [];
  try {
    const r = await apiFetch.get('/api/sales', { search: q, limit: 10 });
    if (r && r.success) sales = r.sales || r.data || [];
  } catch (e) {
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
  }
  if (!sales.length) {
    resultsEl.innerHTML = `
      <div class="empty-state" style="padding:1.5rem;">
        <div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
        <div class="empty-title">${t('noSaleFound', 'No sale found')}</div>
        <div class="empty-subtitle">${t('noSaleFoundHint', 'Try a different sale number')}</div>
      </div>`;
    return;
  }
  resultsEl.innerHTML = '<div class="low-stock-list">' + sales.map(s => `
    <div class="recent-sale-item" style="cursor:pointer;" data-sale-id="${s._id}">
      <div class="recent-sale-id" style="font-family:var(--font-mono, monospace);font-weight:700;">${escapeHtml(saleNumber(s))}</div>
      <div class="recent-sale-customer">${customerName(s.customer)} · ${escapeHtml(fmtDateTime(s.createdAt || s.date || s.saleDate))}</div>
      <div class="recent-sale-amount">${escapeHtml(fmtCurrency(s.total))}</div>
    </div>`).join('') + '</div>';

  resultsEl.querySelectorAll('[data-sale-id]').forEach(el => {
    el.addEventListener('click', () => selectSale(el.dataset.saleId));
  });
}

async function selectSale(saleId) {
  const overlay = document.getElementById('newReturnModal');
  if (!overlay) return;
  const body = overlay.querySelector('#newReturnBody');
  if (body) body.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + escapeHtml(t('loading', 'Loading...')) + '</span></div>';

  let sale = null;
  try {
    const r = await apiFetch.get('/api/sales/' + saleId);
    if (r && r.success) sale = r.sale || (r.data && (r.data.sale || r.data)) || r.data || null;
  } catch (e) {
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
  }
  if (!sale) {
    if (body) body.innerHTML = renderStep1();
    bindStep1(overlay);
    if (window.Toast) window.Toast.error(t('noSaleFound', 'No sale found'));
    return;
  }

  newReturn.sale = sale;
  newReturn.saleItems = (sale.items || []).map(it => ({
    _id: it._id || (it.product && (it.product._id || it.product)) || Math.random().toString(36).slice(2),
    product: it.product,
    name: productName(it.product),
    quantity: Number(it.quantity || 0),
    price: Number(it.price || it.unitPrice || 0),
    maxReturnable: Number(it.quantity || 0) - Number(it.returnedQuantity || 0)
  }));
  newReturn.selected = new Map();

  renderStep2(overlay);
}

/* ---------- Step 2: Select items + qty + reason ---------- */
function renderStep2(overlay) {
  const body = overlay.querySelector('#newReturnBody');
  const footer = overlay.querySelector('#newReturnFooter');
  if (!body || !footer) return;

  const sale = newReturn.sale;
  const itemsHtml = newReturn.saleItems.map((it) => {
    const max = Math.max(0, it.maxReturnable);
    const disabled = max <= 0 ? 'disabled' : '';
    const checked = newReturn.selected.has(it._id) ? 'checked' : '';
    const qty = newReturn.selected.has(it._id) ? (newReturn.selected.get(it._id).quantity || 1) : 1;
    const reason = newReturn.selected.has(it._id) ? (newReturn.selected.get(it._id).reason || 'customer_request') : 'customer_request';
    const notes = newReturn.selected.has(it._id) ? (newReturn.selected.get(it._id).notes || '') : '';
    const lineTotal = it.quantity * it.price;
    return `
      <tr data-item-id="${it._id}">
        <td style="width:36px;">
          <input type="checkbox" class="return-item-check" data-item-id="${it._id}" ${checked} ${disabled} />
        </td>
        <td class="cell-strong">${escapeHtml(it.name)}</td>
        <td class="cell-muted">${fmtNumber(it.quantity)}</td>
        <td>${escapeHtml(fmtCurrency(it.price))}</td>
        <td class="cell-muted">${escapeHtml(fmtCurrency(lineTotal))}</td>
        <td>
          <input class="input return-item-qty" type="number" min="1" max="${max}" value="${qty}" data-item-id="${it._id}" style="width:80px;height:36px;" ${disabled} />
        </td>
        <td>
          <select class="select return-item-reason" data-item-id="${it._id}" style="height:36px;" ${disabled}>
            ${RETURN_REASONS.map(r => '<option value="' + r.value + '" ' + (r.value === reason ? 'selected' : '') + '>' + t(r.key, r.value) + '</option>').join('')}
          </select>
        </td>
        <td>
          <input class="input return-item-notes" type="text" data-item-id="${it._id}" style="width:120px;height:36px;" placeholder="${escapeHtml(t('notes', 'Notes'))}" value="${escapeHtml(notes)}" ${disabled} />
        </td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    ${renderStepIndicator(2)}
    <div class="form-row" style="margin-bottom:0.75rem;">
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">${t('saleNumber', 'Sale #')}</label>
        <div style="font-family:var(--font-mono, monospace);">${escapeHtml(saleNumber(sale))}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">${t('customer', 'Customer')}</label>
        <div>${customerName(sale.customer)}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">${t('date', 'Date')}</label>
        <div>${escapeHtml(fmtDateTime(sale.createdAt || sale.date || sale.saleDate))}</div>
      </div>
    </div>
    <div class="form-label" style="margin-bottom:0.5rem;">${t('selectItemsToReturn', 'Select items to return')}</div>
    <div class="table-wrap" style="max-height:none;overflow-x:auto;">
      <table class="table">
        <thead>
          <tr>
            <th></th>
            <th>${t('product', 'Product')}</th>
            <th>${t('originalQty', 'Original qty')}</th>
            <th>${t('price', 'Price')}</th>
            <th>${t('subtotal', 'Subtotal')}</th>
            <th>${t('returnQuantity', 'Return qty')}</th>
            <th>${t('reason', 'Reason')}</th>
            <th>${t('notes', 'Notes')}</th>
          </tr>
        </thead>
        <tbody>${itemsHtml || '<tr><td colspan="8" class="cell-muted" style="text-align:center;padding:1rem;">' + t('noItems', 'No items') + '</td></tr>'}</tbody>
      </table>
    </div>
    <div class="form-group" style="margin-top:1rem;">
      <label class="form-label" for="returnGlobalReason">${t('returnReason', 'General return reason')}</label>
      <select class="select" id="returnGlobalReason">
        ${RETURN_REASONS.map(r => '<option value="' + r.value + '" ' + (r.value === newReturn.globalReason ? 'selected' : '') + '>' + t(r.key, r.value) + '</option>').join('')}
      </select>
      <div class="help-text">${t('returnGlobalReasonHelp', 'Applies to all selected items without a specific reason')}</div>
    </div>`;

  footer.innerHTML = `
    <button class="btn btn-ghost" type="button" data-action="back">${t('back', 'Back')}</button>
    <button class="btn btn-primary" type="button" id="returnStep2Next">
      <span>${t('next', 'Next')}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>`;

  // Bind checkbox + qty + reason + notes changes
  body.querySelectorAll('.return-item-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.itemId;
      const row = body.querySelector('tr[data-item-id="' + id + '"]');
      const qtyInput = row && row.querySelector('.return-item-qty');
      const reasonSel = row && row.querySelector('.return-item-reason');
      const notesInput = row && row.querySelector('.return-item-notes');
      if (cb.checked) {
        newReturn.selected.set(id, {
          quantity: parseInt(qtyInput && qtyInput.value, 10) || 1,
          reason: reasonSel ? reasonSel.value : 'customer_request',
          notes: notesInput ? notesInput.value.trim() : ''
        });
        if (qtyInput) qtyInput.disabled = false;
        if (reasonSel) reasonSel.disabled = false;
        if (notesInput) notesInput.disabled = false;
      } else {
        newReturn.selected.delete(id);
        if (qtyInput) qtyInput.disabled = true;
        if (reasonSel) reasonSel.disabled = true;
        if (notesInput) notesInput.disabled = true;
      }
    });
  });
  body.querySelectorAll('.return-item-qty').forEach(qi => {
    qi.addEventListener('input', () => {
      const id = qi.dataset.itemId;
      if (!newReturn.selected.has(id)) return;
      const cur = newReturn.selected.get(id);
      const max = parseInt(qi.max, 10) || 1;
      let v = parseInt(qi.value, 10) || 1;
      if (v < 1) v = 1;
      if (v > max) { v = max; qi.value = max; }
      cur.quantity = v;
    });
  });
  body.querySelectorAll('.return-item-reason').forEach(rs => {
    rs.addEventListener('change', () => {
      const id = rs.dataset.itemId;
      if (!newReturn.selected.has(id)) return;
      newReturn.selected.get(id).reason = rs.value;
    });
  });
  body.querySelectorAll('.return-item-notes').forEach(nt => {
    nt.addEventListener('input', () => {
      const id = nt.dataset.itemId;
      if (!newReturn.selected.has(id)) return;
      newReturn.selected.get(id).notes = nt.value.trim();
    });
  });
  const globalReason = body.querySelector('#returnGlobalReason');
  if (globalReason) globalReason.addEventListener('change', () => { newReturn.globalReason = globalReason.value; });

  footer.querySelector('[data-action="back"]').addEventListener('click', () => {
    newReturn.sale = null; newReturn.saleItems = []; newReturn.selected = new Map();
    body.innerHTML = renderStep1();
    footer.innerHTML = '<button class="btn btn-ghost" type="button" data-action="cancel">' + t('cancel', 'Cancel') + '</button>';
    const cancelBtn = footer.querySelector('[data-action="cancel"]');
    if (cancelBtn) cancelBtn.addEventListener('click', () => overlay.remove());
    bindStep1(overlay);
  });

  footer.querySelector('#returnStep2Next').addEventListener('click', () => {
    if (newReturn.selected.size === 0) {
      if (window.Toast) window.Toast.warning(t('selectItemsToReturn', 'Select items to return'));
      return;
    }
    let valid = true;
    newReturn.selected.forEach((sel) => {
      if (!sel.quantity || sel.quantity < 1) valid = false;
    });
    if (!valid) {
      if (window.Toast) window.Toast.warning(t('selectItemsToReturn', 'Select items to return'));
      return;
    }
    renderStep3(overlay);
  });
}

/* ---------- Step 3: Review + confirm ---------- */
function renderStep3(overlay) {
  const body = overlay.querySelector('#newReturnBody');
  const footer = overlay.querySelector('#newReturnFooter');
  if (!body || !footer) return;

  const rows = [];
  let totalRefund = 0;
  let firstReason = '';
  let first = true;
  newReturn.selected.forEach((sel, itemId) => {
    const it = newReturn.saleItems.find(x => x._id === itemId);
    if (!it) return;
    if (first) { firstReason = sel.reason; first = false; }
    const lineTotal = Number(sel.quantity) * Number(it.price);
    totalRefund += lineTotal;
    rows.push(`
      <tr>
        <td class="cell-strong">${escapeHtml(it.name)}</td>
        <td>${fmtNumber(sel.quantity)}</td>
        <td>${escapeHtml(fmtCurrency(it.price))}</td>
        <td>${escapeHtml(fmtCurrency(lineTotal))}</td>
        <td class="cell-muted">${escapeHtml(reasonText(sel.reason))}</td>
      </tr>`);
  });

  const displayReason = newReturn.globalReason || firstReason;

  body.innerHTML = `
    ${renderStepIndicator(3)}
    <div class="form-label" style="margin-bottom:0.5rem;">${t('reviewReturn', 'Review the return')}</div>
    <div class="form-row" style="margin-bottom:0.75rem;">
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">${t('saleNumber', 'Sale #')}</label>
        <div style="font-family:var(--font-mono, monospace);">${escapeHtml(saleNumber(newReturn.sale))}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">${t('customer', 'Customer')}</label>
        <div>${customerName(newReturn.sale.customer)}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">${t('returnReason', 'Return reason')}</label>
        <div>${escapeHtml(reasonText(displayReason))}</div>
      </div>
    </div>
    <div class="table-wrap" style="max-height:none;">
      <table class="table">
        <thead>
          <tr>
            <th>${t('product', 'Product')}</th>
            <th>${t('returnQuantity', 'Return qty')}</th>
            <th>${t('price', 'Price')}</th>
            <th>${t('subtotal', 'Subtotal')}</th>
            <th>${t('reason', 'Reason')}</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
      <div style="min-width:220px;">
        <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-top:1px solid var(--border-color);margin-top:0.3rem;">
          <span class="cell-strong">${t('returnTotal', 'Total refund')}</span>
          <span class="cell-strong">${escapeHtml(fmtCurrency(totalRefund))}</span>
        </div>
      </div>
    </div>`;

  footer.innerHTML = `
    <button class="btn btn-ghost" type="button" data-action="back">${t('back', 'Back')}</button>
    <button class="btn btn-success" type="button" id="returnConfirmBtn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      <span>${t('confirmReturn', 'Confirm return')}</span>
    </button>`;

  footer.querySelector('[data-action="back"]').addEventListener('click', () => renderStep2(overlay));
  footer.querySelector('#returnConfirmBtn').addEventListener('click', submitReturn);
}

async function submitReturn() {
  const overlay = document.getElementById('newReturnModal');
  if (!overlay) return;
  const confirmBtn = overlay.querySelector('#returnConfirmBtn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.innerHTML = '<div class="spinner sm"></div>'; }

  const items = [];
  let firstReason = 'customer_request';
  newReturn.selected.forEach((sel, itemId) => {
    const it = newReturn.saleItems.find(x => x._id === itemId);
    if (!it) return;
    if (items.length === 0) firstReason = sel.reason;
    items.push({
      saleItem: it._id,
      product: (it.product && it.product._id) || (typeof it.product === 'string' ? it.product : undefined),
      quantity: sel.quantity,
      price: it.price
    });
  });

  const body = {
    sale: newReturn.sale._id,
    items,
    reason: newReturn.globalReason || firstReason
  };

  try {
    const r = await apiFetch.post('/api/returns', body);
    if (r && r.success) {
      if (window.Toast) window.Toast.success(t('returnCreated', 'Return created successfully'));
      overlay.remove();
      await refreshTable();
    } else {
      throw new Error((r && r.message) || 'Failed');
    }
  } catch (e) {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>' + t('confirmReturn', 'Confirm return') + '</span>';
    }
    const msg = (e && e.message) || '';
    if (/already|موجود|déjà|returned/i.test(msg)) {
      if (window.Toast) window.Toast.error(t('returnAlreadyExists', 'A return already exists for this sale/item'));
    } else if (/quantity|exceed|كمية/i.test(msg)) {
      if (window.Toast) window.Toast.error(t('returnQtyExceeds', 'Return quantity exceeds purchased quantity'));
    } else {
      if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
    }
  }
}

/* ---------- Entry ---------- */
export async function renderReturnsPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.search = ''; state.from = ''; state.to = '';
  content.innerHTML = renderSkeleton();
  await fetchReturns();
  render();
}
