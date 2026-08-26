/* ============================================================
 * js/modules/inventory.js
 * ------------------------------------------------------------
 * Renders the Inventory page into #pageContent.
 *
 * Three tabs:
 *   1. Movements  — paginated log of stock movements (in/out/adjust)
 *                   with search, type filter, date range
 *   2. Summary    — total items / total stock value / low-stock
 *                   count + low-stock table
 *   3. Adjust     — quick form to log a new movement (no modal)
 *
 * "New Movement" button on the Movements tab opens the same form
 * in a modal appended to <body>.
 *
 * All text via window.t(), all API calls via window.apiFetch().
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  tab: 'movements',          // 'movements' | 'summary' | 'adjust'
  page: 1,
  limit: 20,
  search: '',                // product name search (client-side filter)
  type: '',                  // '' | 'in' | 'out' | 'adjust'
  from: '',
  to: '',
  pagination: null,
  items: [],
  summary: null,             // { lowStock, totalStockValue, totalItems }
  products: []               // product picker cache
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

function productName(p) {
  if (!p) return '—';
  if (typeof p === 'string') return p;
  return p.displayName || (p.name && (p.name.ar || p.name.en || p.name.fr)) || '—';
}

function currentUserId() {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u._id || u.id || ''; } catch { return ''; }
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="tabs">
      <div class="tab-list">
        <div class="skeleton" style="height:32px;width:120px;border-radius:8px;"></div>
        <div class="skeleton" style="height:32px;width:120px;border-radius:8px;"></div>
        <div class="skeleton" style="height:32px;width:140px;border-radius:8px;"></div>
      </div>
    </div>
    <div class="toolbar">
      <div class="skeleton" style="height:40px;width:280px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
    </div>
    <div class="table-wrap">
      ${[1,2,3,4,5,6].map(() => `<div class="skeleton skeleton-line" style="height:48px;margin:0;border-radius:0;"></div>`).join('')}
    </div>`;
}

/* ---------- Page header ---------- */
function renderHeader() {
  const openBtn = state.tab === 'movements'
    ? `<button class="btn btn-primary" id="newMovementBtn" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>${t('newMovement', 'New movement')}</span>
      </button>` : '';
  return `
    <div class="page-header">
      <div class="page-title-block">
        <div class="page-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;color:var(--primary);"><line x1="16.5" y1="5.5" x2="7.5" y2="14.5"/><polyline points="21 2 12 11 7 6"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/></svg>
          <span class="page-title-text">${t('inventory', 'Inventory')}</span>
        </div>
        <div class="page-subtitle">${t('inventorySubtitle', 'Track stock movements and adjust quantities')}</div>
      </div>
      <div class="page-actions">${openBtn}</div>
    </div>`;
}

/* ---------- Tabs ---------- */
function renderTabs() {
  const tabs = [
    { id: 'movements', label: t('movements', 'Movements') },
    { id: 'summary',   label: t('summary', 'Summary') },
    { id: 'adjust',    label: t('adjustStock', 'Adjust stock') }
  ];
  return `
    <div class="tabs">
      <div class="tab-list" role="tablist">
        ${tabs.map(t2 => `
          <button type="button" class="tab-item ${state.tab === t2.id ? 'active' : ''}" data-tab="${t2.id}" role="tab" aria-selected="${state.tab === t2.id ? 'true' : 'false'}">${t2.label}</button>`).join('')}
      </div>
    </div>`;
}

/* ---------- Movements toolbar ---------- */
function renderMovementsToolbar() {
  return `
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" id="movSearch" type="search"
                 placeholder="${escapeHtml(t('searchMovements', 'Search by product...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <select class="select" id="movType" aria-label="${t('type', 'Type')}">
          <option value=""  ${state.type === '' ? 'selected' : ''}>${t('allTypes', 'All types')}</option>
          <option value="in"     ${state.type === 'in' ? 'selected' : ''}>${t('stockIn', 'Stock in')}</option>
          <option value="out"    ${state.type === 'out' ? 'selected' : ''}>${t('stockOut', 'Stock out')}</option>
          <option value="adjust" ${state.type === 'adjust' ? 'selected' : ''}>${t('adjust', 'Adjust')}</option>
        </select>
        <input class="input" id="movFrom" type="date" value="${escapeHtml(state.from)}" aria-label="${t('from', 'From')}" style="max-width:160px;" />
        <input class="input" id="movTo"   type="date" value="${escapeHtml(state.to)}"   aria-label="${t('to', 'To')}"   style="max-width:160px;" />
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="movRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
      </div>
    </div>`;
}

function renderTypeBadge(type) {
  if (type === 'in')     return '<span class="badge badge-success">' + t('stockIn', 'Stock in') + '</span>';
  if (type === 'out')    return '<span class="badge badge-danger">'  + t('stockOut', 'Stock out') + '</span>';
  if (type === 'adjust') return '<span class="badge badge-warning">' + t('adjust', 'Adjust') + '</span>';
  return '<span class="badge badge-muted">' + escapeHtml(type || '—') + '</span>';
}

function renderQtyCell(m) {
  const q = Number(m.quantity || 0);
  if (m.type === 'in')  return '<span style="color:var(--success);font-weight:700;">+' + q + '</span>';
  if (m.type === 'out') return '<span style="color:var(--danger);font-weight:700;">-' + q + '</span>';
  return '<span style="color:var(--warning);font-weight:700;">~' + q + '</span>';
}

function renderMovementsTable() {
  if (!state.items.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="5.5" x2="7.5" y2="14.5"/><polyline points="21 2 12 11 7 6"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/></svg>
        </div>
        <div class="empty-title">${t('noMovementsMatch', 'No matching movements')}</div>
        <div class="empty-subtitle">${t('noMovements', 'No stock movements recorded yet')}</div>
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="emptyNewMovementBtn" type="button">${t('newMovement', 'New movement')}</button>
        </div>
      </div>`;
  }

  const rows = state.items.map((m, i) => {
    const idx = (state.page - 1) * state.limit + i + 1;
    const createdByName = m.createdBy && (m.createdBy.name || m.createdBy.email) || '—';
    const reason = m.reason || '';
    return `
      <tr>
        <td class="cell-muted">${idx}</td>
        <td class="cell-muted">${escapeHtml(fmtDateTime(m.createdAt))}</td>
        <td class="cell-strong">${escapeHtml(productName(m.product))}</td>
        <td>${renderTypeBadge(m.type)}</td>
        <td>${renderQtyCell(m)}</td>
        <td class="cell-muted">${escapeHtml(String(m.previousStock != null ? m.previousStock : '—'))}</td>
        <td class="cell-strong">${escapeHtml(String(m.newStock != null ? m.newStock : '—'))}</td>
        <td class="cell-muted">${escapeHtml(reason) || '—'}</td>
        <td class="cell-muted">${escapeHtml(createdByName)}</td>
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
            <th>${t('date', 'Date')}</th>
            <th>${t('product', 'Product')}</th>
            <th>${t('type', 'Type')}</th>
            <th>${t('quantity', 'Quantity')}</th>
            <th>${t('previousStock', 'Previous stock')}</th>
            <th>${t('newStock', 'New stock')}</th>
            <th>${t('reason', 'Reason')}</th>
            <th>${t('createdBy', 'Created by')}</th>
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

/* ---------- Summary tab ---------- */
function renderSummaryTab() {
  if (!state.summary) {
    return '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  }
  const s = state.summary;
  const low = Array.isArray(s.lowStock) ? s.lowStock : [];
  const cards = [
    { icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
      color: 'green', value: String(s.totalItems || 0), label: t('totalItems', 'Total items') },
    { icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
      color: 'cyan', value: fmtCurrency(s.totalStockValue), label: t('totalStockValue', 'Total stock value') },
    { icon: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
      color: 'red', value: String(low.length), label: t('lowStockCount', 'Low stock count') }
  ];

  const lowRows = low.map(p => {
    const stock = Number(p.stock || 0);
    const minStock = Number(p.minStock || 0);
    const deficit = Math.max(0, minStock - stock);
    return `
      <tr>
        <td class="cell-strong">${escapeHtml(productName(p))}</td>
        <td class="cell-muted">${escapeHtml(p.barcode || '—')}</td>
        <td>${escapeHtml(String(stock))}</td>
        <td class="cell-muted">${escapeHtml(String(minStock))}</td>
        <td><span style="color:var(--danger);font-weight:700;">-${deficit}</span></td>
        <td><span class="badge badge-danger">${t('lowStockBadge', 'Low stock')}</span></td>
      </tr>`;
  }).join('');

  return `
    <div class="stats-grid">
      ${cards.map(c => `
        <div class="stat-card">
          <div class="stat-icon ${c.color}" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>
          </div>
          <div class="stat-info">
            <div class="stat-value">${c.value}</div>
            <div class="stat-label">${c.label}</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">${t('lowStockAlert', 'Low stock alert')}</div></div>
      <div class="card-body" style="padding:0;">
        ${low.length ? `
          <div class="table-wrap">
            <table class="table table-hover">
              <thead>
                <tr>
                  <th>${t('product', 'Product')}</th>
                  <th>${t('barcode', 'Barcode')}</th>
                  <th>${t('stock', 'Stock')}</th>
                  <th>${t('minStock', 'Min stock')}</th>
                  <th>${t('deficit', 'Deficit')}</th>
                  <th>${t('status', 'Status')}</th>
                </tr>
              </thead>
              <tbody>${lowRows}</tbody>
            </table>
          </div>` : `
          <div class="empty-state">
            <div class="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div class="empty-title">${t('allStockOk', 'All products are in stock')}</div>
          </div>`}
      </div>
    </div>`;
}

/* ---------- Adjust tab ---------- */
function renderAdjustTab() {
  const prodOpts = ['<option value="">' + t('selectProduct', 'Select a product') + '</option>']
    .concat(state.products.map(p => {
      const name = productName(p);
      const stock = Number(p.stock || 0);
      return '<option value="' + p._id + '">' + escapeHtml(name) + ' (' + t('stock', 'Stock') + ': ' + stock + ')</option>';
    }))
    .join('');

  return `
    <div class="card" style="max-width:640px;">
      <div class="card-header">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;color:var(--primary);"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('adjustStock', 'Adjust stock')}</span>
        </div>
      </div>
      <div class="card-body">
        <form id="adjustForm">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">${t('product', 'Product')} <span class="req">*</span></label>
              <select class="select" id="adjProduct" required>${prodOpts}</select>
            </div>
            <div class="form-group">
              <label class="form-label">${t('type', 'Type')} <span class="req">*</span></label>
              <select class="select" id="adjType" required>
                <option value="in">${t('stockIn', 'Stock in')}</option>
                <option value="out">${t('stockOut', 'Stock out')}</option>
                <option value="adjust">${t('adjust', 'Adjust (set absolute)')}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">${t('quantity', 'Quantity')} <span class="req">*</span></label>
              <input class="input" id="adjQty" type="number" min="1" step="1" required />
              <div class="help-text" id="adjHelp"></div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${t('reason', 'Reason')}</label>
            <textarea class="textarea" id="adjReason" rows="3" placeholder="${escapeHtml(t('movementReasonPlaceholder', 'Reason for this movement...'))}"></textarea>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
            <button class="btn btn-ghost" type="reset">${t('clear', 'Clear')}</button>
            <button class="btn btn-primary" type="submit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span>${t('logMovement', 'Log movement')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>`;
}

/* ---------- Fetch ---------- */
async function fetchMovements() {
  const qs = { page: state.page, limit: state.limit };
  if (state.type) qs.type = state.type;
  if (state.from) qs.from = state.from;
  if (state.to)   qs.to = state.to;
  try {
    const r = await apiFetch.get('/api/inventory/movements', qs);
    if (r && r.success) {
      let items = r.data || [];
      // client-side product-name search
      if (state.search) {
        const q = state.search.toLowerCase();
        items = items.filter(m => productName(m.product).toLowerCase().indexOf(q) !== -1);
      }
      state.items = items;
      state.pagination = {
        page: r.page, limit: r.limit, total: r.total, totalPages: r.totalPages
      };
    } else { state.items = []; state.pagination = null; }
  } catch (e) {
    console.error('[inventory] fetchMovements', e);
    state.items = []; state.pagination = null;
  }
}

async function fetchSummary() {
  try {
    const r = await apiFetch.get('/api/inventory/summary');
    if (r && r.success) state.summary = r.data || null;
    else state.summary = null;
  } catch (e) {
    console.error('[inventory] fetchSummary', e);
    state.summary = null;
  }
}

async function fetchProducts() {
  try {
    const r = await apiFetch.get('/api/products', { page: 1, limit: 100, status: 'active' });
    if (r && r.success) state.products = r.products || r.data || [];
    else state.products = [];
  } catch (e) {
    console.warn('[inventory] fetchProducts', e);
    state.products = [];
  }
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  let body = '';
  if (state.tab === 'movements') {
    body = renderMovementsToolbar() + '<div id="movementsContainer">' + renderMovementsTable() + '</div>';
  } else if (state.tab === 'summary') {
    body = '<div id="summaryContainer">' + renderSummaryTab() + '</div>';
  } else if (state.tab === 'adjust') {
    body = '<div id="adjustContainer">' + renderAdjustTab() + '</div>';
  }
  content.innerHTML = renderHeader() + renderTabs() + body;
  bindTabs();
  if (state.tab === 'movements') bindMovementsToolbar();
  if (state.tab === 'movements') bindMovementsTable();
  if (state.tab === 'adjust') bindAdjustForm();
  // Header "New Movement" button
  const newBtn = document.getElementById('newMovementBtn');
  if (newBtn) newBtn.addEventListener('click', () => openMovementModal());
}

function bindTabs() {
  document.querySelectorAll('#pageContent .tab-item').forEach(b => {
    b.addEventListener('click', async () => {
      const tab = b.dataset.tab;
      if (!tab || tab === state.tab) return;
      state.tab = tab;
      state.page = 1;
      if (tab === 'movements') {
        await refreshMovements();
        render();
      } else if (tab === 'summary') {
        await refreshSummary();
      } else if (tab === 'adjust') {
        if (!state.products.length) await fetchProducts();
        render();
      } else {
        render();
      }
    });
  });
}

function bindMovementsToolbar() {
  const search = document.getElementById('movSearch');
  if (search) {
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.search = search.value.trim();
        state.page = 1;
        refreshMovements();
      }, 350);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); state.search = search.value.trim(); state.page = 1; refreshMovements(); }
    });
  }
  const type = document.getElementById('movType');
  if (type) type.addEventListener('change', () => { state.type = type.value; state.page = 1; refreshMovements(); });
  const fromEl = document.getElementById('movFrom');
  if (fromEl) fromEl.addEventListener('change', () => { state.from = fromEl.value; state.page = 1; refreshMovements(); });
  const toEl = document.getElementById('movTo');
  if (toEl) toEl.addEventListener('change', () => { state.to = toEl.value; state.page = 1; refreshMovements(); });
  const refBtn = document.getElementById('movRefreshBtn');
  if (refBtn) refBtn.addEventListener('click', () => refreshMovements());
  const emptyNew = document.getElementById('emptyNewMovementBtn');
  if (emptyNew) emptyNew.addEventListener('click', () => openMovementModal());
}

function bindMovementsTable() {
  document.querySelectorAll('#movementsContainer .page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshMovements(); }
    });
  });
}

function bindAdjustForm() {
  const form = document.getElementById('adjustForm');
  if (!form) return;
  const typeEl = form.querySelector('#adjType');
  const qtyEl  = form.querySelector('#adjQty');
  const helpEl = form.querySelector('#adjHelp');
  const prodEl = form.querySelector('#adjProduct');

  function updateHelp() {
    if (!helpEl) return;
    const type = typeEl.value;
    if (type === 'adjust') helpEl.textContent = t('adjustHelp', 'Sets the absolute stock value');
    else if (type === 'in') helpEl.textContent = t('stockInHelp', 'Adds the quantity to current stock');
    else if (type === 'out') helpEl.textContent = t('stockOutHelp', 'Removes the quantity from current stock');
    else helpEl.textContent = '';
  }
  typeEl.addEventListener('change', updateHelp);
  updateHelp();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const product = prodEl.value;
    const type = typeEl.value;
    const qty = parseInt(qtyEl.value, 10);
    const reason = form.querySelector('#adjReason').value.trim();
    if (!product || !type || !qty || qty <= 0) {
      if (window.Toast) window.Toast.error(t('missingFields', 'Please fill all required fields'));
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const r = await apiFetch.post('/api/inventory/movements', { product, type, quantity: qty, reason });
      if (r && r.success) {
        if (window.Toast) window.Toast.success(t('movementLogged', 'Movement logged successfully'));
        form.reset();
        updateHelp();
        // Switch to Movements tab and refresh
        state.tab = 'movements';
        state.page = 1;
        state.summary = null; // invalidate summary
        await refreshMovements();
        render();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/insufficient|غير كاف/i.test(msg)) {
        if (window.Toast) window.Toast.error(t('insufficientStock', 'Insufficient stock'));
      } else {
        if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function refreshMovements() {
  const container = document.getElementById('movementsContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchMovements();
  if (container) container.innerHTML = renderMovementsTable();
  bindMovementsTable();
}

async function refreshSummary() {
  const container = document.getElementById('summaryContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchSummary();
  render();
}

/* ---------- Modal ---------- */
async function openMovementModal() {
  // Ensure product cache is loaded
  if (!state.products.length) await fetchProducts();

  const prodOpts = ['<option value="">' + t('selectProduct', 'Select a product') + '</option>']
    .concat(state.products.map(p => {
      const name = productName(p);
      const stock = Number(p.stock || 0);
      return '<option value="' + p._id + '">' + escapeHtml(name) + ' (' + t('stock', 'Stock') + ': ' + stock + ')</option>';
    }))
    .join('');

  const html = `
    <div class="modal-overlay" id="movementModal" role="dialog" aria-modal="true" aria-labelledby="movementModalTitle">
      <div class="modal" role="document">
        <div class="modal-header">
          <div class="modal-title" id="movementModalTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="5.5" x2="7.5" y2="14.5"/><polyline points="21 2 12 11 7 6"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/></svg>
            <span>${t('newMovement', 'New movement')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="movementForm">
          <div class="modal-body">
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">${t('product', 'Product')} <span class="req">*</span></label>
                <select class="select" id="mProduct" required>${prodOpts}</select>
              </div>
              <div class="form-group">
                <label class="form-label">${t('type', 'Type')} <span class="req">*</span></label>
                <select class="select" id="mType" required>
                  <option value="in">${t('stockIn', 'Stock in')}</option>
                  <option value="out">${t('stockOut', 'Stock out')}</option>
                  <option value="adjust">${t('adjust', 'Adjust (set absolute)')}</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">${t('quantity', 'Quantity')} <span class="req">*</span></label>
                <input class="input" id="mQty" type="number" min="1" step="1" required />
                <div class="help-text" id="mHelp"></div>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">${t('reason', 'Reason')}</label>
              <textarea class="textarea" id="mReason" rows="3" placeholder="${escapeHtml(t('movementReasonPlaceholder', 'Reason for this movement...'))}"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" type="button" data-action="cancel">${t('cancel', 'Cancel')}</button>
            <button class="btn btn-primary" type="submit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span>${t('logMovement', 'Log movement')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('movementModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const typeEl = overlay.querySelector('#mType');
  const helpEl = overlay.querySelector('#mHelp');
  function updateHelp() {
    if (!helpEl) return;
    const type = typeEl.value;
    if (type === 'adjust') helpEl.textContent = t('adjustHelp', 'Sets the absolute stock value');
    else if (type === 'in') helpEl.textContent = t('stockInHelp', 'Adds the quantity to current stock');
    else if (type === 'out') helpEl.textContent = t('stockOutHelp', 'Removes the quantity from current stock');
    else helpEl.textContent = '';
  }
  typeEl.addEventListener('change', updateHelp);
  updateHelp();

  overlay.querySelector('#movementForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const product = overlay.querySelector('#mProduct').value;
    const type = overlay.querySelector('#mType').value;
    const qty = parseInt(overlay.querySelector('#mQty').value, 10);
    const reason = overlay.querySelector('#mReason').value.trim();
    if (!product || !type || !qty || qty <= 0) {
      if (window.Toast) window.Toast.error(t('missingFields', 'Please fill all required fields'));
      return;
    }
    const btn = overlay.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const r = await apiFetch.post('/api/inventory/movements', { product, type, quantity: qty, reason });
      if (r && r.success) {
        if (window.Toast) window.Toast.success(t('movementLogged', 'Movement logged successfully'));
        // Show stock change confirmation if available
        const mov = r.data && r.data.movement;
        if (mov && mov.previousStock != null && mov.newStock != null) {
          if (window.Toast) window.Toast.info(
            t('stockChange', 'Stock: {prev} → {new}')
              .replace('{prev}', mov.previousStock)
              .replace('{new}', mov.newStock)
          );
        }
        close();
        // Invalidate summary and refresh movements tab
        state.summary = null;
        state.page = 1;
        state.tab = 'movements';
        await refreshMovements();
        render();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/insufficient|غير كاف/i.test(msg)) {
        if (window.Toast) window.Toast.error(t('insufficientStock', 'Insufficient stock'));
      } else {
        if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  setTimeout(() => { const first = overlay.querySelector('#mProduct'); if (first) first.focus(); }, 50);
}

/* ---------- Entry ---------- */
export async function renderInventoryPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.tab = 'movements';
  state.page = 1; state.search = ''; state.type = ''; state.from = ''; state.to = '';
  state.summary = null;
  content.innerHTML = renderSkeleton();
  await fetchMovements();
  render();
}
