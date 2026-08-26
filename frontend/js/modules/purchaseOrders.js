/* ============================================================
 * js/modules/purchaseOrders.js
 * ------------------------------------------------------------
 * Renders the Purchase Orders (Bon de commande) management page
 * into #pageContent.
 *
 * Features:
 *   • Toolbar: search box, status filter, refresh, "New"
 *   • Server-side paginated table (order # / date / supplier /
 *     items count / total / status badge / actions)
 *   • Add/Edit modal: supplier picker, expected date, line
 *     items (search product → autofill unit price or type free
 *     item), quantity, unit price, totals auto-computed, status
 *     (draft / sent / received / cancelled), notes.
 *   • Marking a purchase order as 'received' automatically
 *     increments product stock (handled by the backend).
 *   • Delete via Toast.confirm() (only for non-received orders)
 *   • View detail modal (read-only) with print-friendly layout
 *
 * Backend contract:
 *   GET    /api/purchase-orders?page&limit&status&search
 *   GET    /api/purchase-orders/:id
 *   POST   /api/purchase-orders  { supplier, items[], expectedDate, ... }
 *   PUT    /api/purchase-orders/:id
 *   DELETE /api/purchase-orders/:id
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  page: 1,
  limit: 20,
  search: '',
  status: '',
  pagination: null,
  items: [],
  suppliers: [],
  products: []
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtCurrency(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function fmtDateShort(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString();
  } catch { return '—'; }
}

function statusBadge(s) {
  const map = {
    draft:     ['badge-muted',   'draft'],
    sent:      ['badge-info',    'sent'],
    received:  ['badge-success', 'received'],
    cancelled: ['badge-danger',  'cancelled']
  };
  const m = map[s] || map.draft;
  return '<span class="badge ' + m[0] + '">' + t(m[1], m[1]) + '</span>';
}

function supplierName(s) {
  if (!s) return '—';
  if (typeof s === 'string') return s;
  if (s.name && typeof s.name === 'object') return s.name.ar || s.name.en || s.name.fr || '—';
  if (typeof s.name === 'string') return s.name;
  return s.displayName || '—';
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">${t('purchaseOrders', 'Bon de commande')}</div>
        <div class="page-subtitle">${t('purchaseOrdersSubtitle', 'Manage purchase orders from suppliers')}</div>
      </div>
    </div>
    <div class="toolbar">
      <div class="skeleton" style="height:40px;width:280px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
    </div>
    <div class="table-wrap">
      ${[1,2,3,4,5,6].map(() => '<div class="skeleton skeleton-line" style="height:48px;margin:0;border-radius:0;"></div>').join('')}
    </div>`;
}

/* ---------- Toolbar ---------- */
function renderToolbar() {
  return `
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" id="poSearch" type="search"
                 placeholder="${escapeHtml(t('searchPurchaseOrders', 'Search by order # or supplier...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <select class="select" id="poStatusFilter" style="width:auto;">
          <option value="">${t('all', 'All')} — ${t('status', 'Status')}</option>
          <option value="draft"     ${state.status === 'draft' ? 'selected' : ''}>${t('draft', 'Draft')}</option>
          <option value="sent"      ${state.status === 'sent' ? 'selected' : ''}>${t('sent', 'Sent')}</option>
          <option value="received"  ${state.status === 'received' ? 'selected' : ''}>${t('received', 'Received')}</option>
          <option value="cancelled" ${state.status === 'cancelled' ? 'selected' : ''}>${t('cancelled', 'Cancelled')}</option>
        </select>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="poRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
        <button class="btn btn-primary" id="poAddBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('newPurchaseOrder', 'New purchase order')}</span>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <div class="empty-title">${t('noPurchaseOrders', 'No purchase orders yet')}</div>
        <div class="empty-subtitle">${t('noPurchaseOrdersHint', 'Create your first purchase order to restock from a supplier')}</div>
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="poEmptyAddBtn" type="button">${t('newPurchaseOrder', 'New purchase order')}</button>
        </div>
      </div>`;
  }

  const rows = state.items.map((po, i) => {
    const idx = (state.page - 1) * state.limit + i + 1;
    const num = escapeHtml(po.orderNumber || ('#' + String(po._id || '').slice(-6)));
    const date = fmtDate(po.orderDate || po.createdAt);
    const sup = escapeHtml(supplierName(po.supplier) || po.supplierName || '—');
    const itemCount = (po.items && po.items.length) || 0;
    const total = fmtCurrency(po.total);
    const st = statusBadge(po.status);
    return `
      <tr>
        <td class="cell-muted">${idx}</td>
        <td class="cell-strong">
          <a href="#" class="po-link" data-id="${po._id}" style="color:inherit;text-decoration:underline;">${num}</a>
        </td>
        <td>${date}</td>
        <td>${sup}</td>
        <td>${itemCount}</td>
        <td class="cell-strong">${total}</td>
        <td>${st}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn view" data-id="${po._id}" aria-label="${t('view', 'View')}" title="${t('view', 'View')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="table-action-btn edit" data-id="${po._id}" aria-label="${t('edit', 'Edit')}" title="${t('edit', 'Edit')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="table-action-btn delete" data-id="${po._id}" data-name="${escapeHtml(num)}" aria-label="${t('delete', 'Delete')}" title="${t('delete', 'Delete')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  const p = state.pagination || { page: state.page, pages: 1, total: state.items.length, limit: state.limit };
  const from = p.total === 0 ? 0 : ((p.page - 1) * p.limit + 1);
  const to = Math.min(p.page * p.limit, p.total);
  const pageBtns = [];
  pageBtns.push(`<button class="page-btn" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>«</button>`);
  let start = Math.max(1, p.page - 2), end = Math.min(p.pages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) {
    pageBtns.push(`<button class="page-btn ${i === p.page ? 'active' : ''}" data-page="${i}">${i}</button>`);
  }
  pageBtns.push(`<button class="page-btn" data-page="${p.page + 1}" ${p.page >= p.pages ? 'disabled' : ''}>»</button>`);

  return `
    <div class="table-wrap">
      <table class="table table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>${t('orderNumber', 'Order #')}</th>
            <th>${t('date', 'Date')}</th>
            <th>${t('supplier', 'Supplier')}</th>
            <th>${t('itemsCount', 'Items')}</th>
            <th>${t('total', 'Total')}</th>
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
async function fetchSuppliers() {
  try {
    const r = await apiFetch.get('/api/suppliers', { page: 1, limit: 200 });
    if (r && r.success) {
      state.suppliers = r.data || r.suppliers || [];
    }
  } catch (e) { console.warn('[po] fetchSuppliers', e); }
}

async function fetchPurchaseOrders() {
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  if (state.status) qs.status = state.status;
  try {
    const r = await apiFetch.get('/api/purchase-orders', qs);
    if (r && r.success) {
      state.items = r.data || r.purchaseOrders || [];
      state.pagination = r.total != null
        ? { page: r.page || 1, pages: r.totalPages || 1, total: r.total, limit: r.limit || state.limit }
        : (r.pagination || null);
    } else {
      state.items = []; state.pagination = null;
    }
  } catch (e) {
    console.error('[po] fetch', e);
    state.items = []; state.pagination = null;
  }
}

async function searchProducts(query) {
  if (!query || query.trim().length < 2) return [];
  try {
    const r = await apiFetch.get('/api/products', { page: 1, limit: 10, search: query.trim() });
    if (r && r.success) return r.data || r.products || [];
  } catch (e) { console.warn('[po] searchProducts', e); }
  return [];
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const header = `
    <div class="page-header">
      <div>
        <div class="page-title">${t('purchaseOrders', 'Bon de commande')}</div>
        <div class="page-subtitle">${t('purchaseOrdersSubtitle', 'Manage purchase orders from suppliers')}</div>
      </div>
    </div>`;
  content.innerHTML = header + renderToolbar() + '<div id="poTableContainer">' + renderTable() + '</div>';
  bindToolbar();
  bindTable();
}

function bindToolbar() {
  const search = document.getElementById('poSearch');
  if (search) {
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.search = search.value.trim();
        state.page = 1;
        refreshTable();
      }, 300);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); state.search = search.value.trim(); state.page = 1; refreshTable(); }
    });
  }
  const st = document.getElementById('poStatusFilter');
  if (st) st.addEventListener('change', () => {
    state.status = st.value; state.page = 1; refreshTable();
  });
  const refresh = document.getElementById('poRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => refreshTable());
  const addBtn = document.getElementById('poAddBtn');
  if (addBtn) addBtn.addEventListener('click', () => openPurchaseOrderModal(null));
  const emptyAdd = document.getElementById('poEmptyAddBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openPurchaseOrderModal(null));
}

function bindTable() {
  const container = document.getElementById('poTableContainer');
  if (!container) return;

  const openDetail = async (id) => {
    try {
      const r = await apiFetch.get('/api/purchase-orders/' + id);
      if (r && r.success) {
        const po = (r.data && r.data.purchaseOrder) ? r.data.purchaseOrder : (r.purchaseOrder || r.data);
        if (po) viewPurchaseOrderModal(po);
      }
    } catch (e) { if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error')); }
  };

  container.querySelectorAll('.po-link').forEach(a => {
    a.addEventListener('click', (e) => { e.preventDefault(); openDetail(a.dataset.id); });
  });
  container.querySelectorAll('.table-action-btn.view').forEach(b => {
    b.addEventListener('click', () => openDetail(b.dataset.id));
  });
  container.querySelectorAll('.table-action-btn.edit').forEach(b => {
    b.addEventListener('click', async () => {
      try {
        const r = await apiFetch.get('/api/purchase-orders/' + b.dataset.id);
        if (r && r.success) {
          const po = (r.data && r.data.purchaseOrder) ? r.data.purchaseOrder : (r.purchaseOrder || r.data);
          if (po) openPurchaseOrderModal(po);
        }
      } catch (e) { if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error')); }
    });
  });
  container.querySelectorAll('.table-action-btn.delete').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const name = b.dataset.name || '—';
      const ok = await (window.Toast && window.Toast.confirm
        ? window.Toast.confirm(t('deleteConfirm', 'Delete "{name}"?').replace('{name}', name))
        : Promise.resolve(true));
      if (!ok) return;
      try {
        const r = await apiFetch.delete('/api/purchase-orders/' + id);
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('purchaseOrderDeleted', 'Purchase order deleted'));
          refreshTable();
        } else {
          throw new Error((r && r.message) || 'Failed');
        }
      } catch (e) {
        if (window.Toast) window.Toast.error((e && e.message) || t('deleteFailed', 'Delete failed'));
      }
    });
  });
  container.querySelectorAll('.page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshTable(); }
    });
  });
}

async function refreshTable() {
  const container = document.getElementById('poTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchPurchaseOrders();
  if (container) container.innerHTML = renderTable();
  bindTable();
}

/* ---------- Modal ---------- */
function openPurchaseOrderModal(po) {
  const isEdit = !!po;
  const supOpts = ['<option value="">' + t('noSupplier', 'No supplier') + '</option>']
    .concat(state.suppliers.map(s => {
      const name = s.displayName || supplierName(s) || '—';
      const sel = po && po.supplier && (po.supplier._id === s._id || po.supplier === s._id || po.supplierName === name) ? 'selected' : '';
      return '<option value="' + s._id + '" ' + sel + '>' + escapeHtml(name) + '</option>';
    })).join('');

  const today = new Date().toISOString().slice(0, 10);
  const orderDate = po && po.orderDate ? new Date(po.orderDate).toISOString().slice(0, 10) : today;
  const expectedDate = po && po.expectedDate ? new Date(po.expectedDate).toISOString().slice(0, 10) : '';

  // Items: array of { product, productName, productBarcode, productUnit, quantity, unitPrice, total }
  const initialItems = (po && po.items && po.items.length)
    ? po.items.map(it => ({
        product: it.product && (it.product._id || it.product),
        productName: it.productName || (it.product && supplierName(it.product)) || '',
        productBarcode: it.productBarcode || '',
        productUnit: it.productUnit || '',
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || 0,
        total: Number(it.total) || 0
      }))
    : [{ product: null, productName: '', productBarcode: '', productUnit: '', quantity: 1, unitPrice: 0, total: 0 }];

  const html = `
    <div class="modal-overlay" id="poModal" role="dialog" aria-modal="true" aria-labelledby="poModalTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="poModalTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <span>${isEdit ? t('editPurchaseOrder', 'Edit purchase order') : t('newPurchaseOrder', 'New purchase order')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="poForm">
          <div class="modal-body">
            <input type="hidden" id="poId" value="${po ? po._id || '' : ''}" />

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="poSupplier">${t('supplier', 'Supplier')}</label>
                <select class="select" id="poSupplier">${supOpts}</select>
              </div>
              <div class="form-group">
                <label class="form-label" for="poOrderDate">${t('orderDate', 'Order date')}</label>
                <input class="input" id="poOrderDate" type="date" value="${orderDate}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="poExpectedDate">${t('expectedDate', 'Expected date')}</label>
                <input class="input" id="poExpectedDate" type="date" value="${expectedDate}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="poStatus">${t('status', 'Status')}</label>
                <select class="select" id="poStatus">
                  <option value="draft"     ${!po || po.status === 'draft' ? 'selected' : ''}>${t('draft', 'Draft')}</option>
                  <option value="sent"      ${po && po.status === 'sent' ? 'selected' : ''}>${t('sent', 'Sent')}</option>
                  <option value="received"  ${po && po.status === 'received' ? 'selected' : ''}>${t('received', 'Received')}</option>
                  <option value="cancelled" ${po && po.status === 'cancelled' ? 'selected' : ''}>${t('cancelled', 'Cancelled')}</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
                <label class="form-label" style="margin:0;">${t('items', 'Items')}</label>
                <button class="btn btn-secondary btn-sm" id="poAddItemBtn" type="button">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  <span>${t('addItem', 'Add item')}</span>
                </button>
              </div>
              <div id="poItemsContainer"></div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="poDiscount">${t('discount', 'Discount')}</label>
                <input class="input" id="poDiscount" type="number" min="0" step="0.01" value="${po ? (po.discount || 0) : 0}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="poTax">${t('tax', 'Tax')} (%)</label>
                <input class="input" id="poTaxPct" type="number" min="0" max="100" step="0.01" value="${po ? (po.subtotal ? (po.tax / po.subtotal * 100).toFixed(2) : 0) : 0}" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="poNotes">${t('notes', 'Notes')}</label>
              <textarea class="textarea" id="poNotes" rows="2" placeholder="${escapeHtml(t('notesPlaceholder', 'Optional internal notes'))}">${po && po.notes ? escapeHtml(po.notes) : ''}</textarea>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:1rem;font-size:0.95rem;margin-top:0.5rem;">
              <div><strong>${t('subtotal', 'Subtotal')}:</strong> <span id="poSubtotalVal">0.00</span></div>
              <div><strong>${t('discount', 'Discount')}:</strong> <span id="poDiscountVal">0.00</span></div>
              <div><strong>${t('tax', 'Tax')}:</strong> <span id="poTaxVal">0.00</span></div>
              <div><strong>${t('total', 'Total')}:</strong> <span id="poTotalVal" style="font-size:1.1rem;color:var(--primary);">0.00</span></div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" type="button" data-action="cancel">${t('cancel', 'Cancel')}</button>
            <button class="btn btn-primary" type="submit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span>${isEdit ? t('update', 'Update') : t('save', 'Save')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('poModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Items state (editable)
  let itemsState = initialItems.slice();

  function renderItems() {
    const container = overlay.querySelector('#poItemsContainer');
    if (!container) return;
    if (!itemsState.length) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;font-size:0.85rem;">' + t('noItems', 'No items') + '</div>';
      return;
    }
    container.innerHTML = itemsState.map((it, idx) => `
      <div class="po-item-row" data-idx="${idx}" style="display:grid;grid-template-columns:1fr 80px 110px 110px 32px;gap:0.5rem;align-items:center;margin-bottom:0.4rem;padding:0.5rem;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-card);">
        <div>
          <input class="input po-item-name" type="text" placeholder="${escapeHtml(t('searchProductOrTypeName', 'Search product or type a name'))}"
                 value="${escapeHtml(it.productName || '')}" data-idx="${idx}" />
          <div class="po-item-suggestions" data-idx="${idx}" style="display:none;position:relative;"></div>
        </div>
        <input class="input po-item-unit" type="text" placeholder="${t('unit', 'Unit')}" value="${escapeHtml(it.productUnit || '')}" data-idx="${idx}" />
        <input class="input po-item-qty" type="number" min="1" step="1" placeholder="${t('quantity', 'Qty')}" value="${it.quantity}" data-idx="${idx}" />
        <input class="input po-item-price" type="number" min="0" step="0.01" placeholder="${t('price', 'Price')}" value="${it.unitPrice}" data-idx="${idx}" />
        <button type="button" class="btn btn-ghost po-item-remove" data-idx="${idx}" aria-label="${t('delete', 'Delete')}" style="padding:0.3rem;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');

    // Bind item events
    container.querySelectorAll('.po-item-name').forEach(inp => {
      const idx = parseInt(inp.dataset.idx, 10);
      let debounce;
      const sugg = container.querySelector('.po-item-suggestions[data-idx="' + idx + '"]');
      inp.addEventListener('input', () => {
        itemsState[idx].productName = inp.value;
        itemsState[idx].product = null;
        itemsState[idx].productBarcode = '';
        recomputeTotals();
        clearTimeout(debounce);
        const v = inp.value.trim();
        if (v.length < 2) { if (sugg) sugg.style.display = 'none'; return; }
        debounce = setTimeout(async () => {
          const products = await searchProducts(v);
          if (!products.length || !sugg) { if (sugg) sugg.style.display = 'none'; return; }
          sugg.style.display = 'block';
          sugg.innerHTML = '<div style="position:absolute;top:2px;' + (document.documentElement.dir === 'rtl' ? 'right' : 'left') + ':0;right:0;background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-sm);box-shadow:var(--shadow-md);max-height:220px;overflow-y:auto;z-index:10;">' +
            products.map(p => {
              const name = p.displayName || (p.name && (p.name.ar || p.name.en || p.name.fr)) || '—';
              return '<div class="po-item-sugg" data-idx="' + idx + '" data-pid="' + p._id + '" data-name="' + escapeHtml(name) + '" data-price="' + (p.costPrice || p.price || 0) + '" data-unit="' + escapeHtml(p.unit || '') + '" data-barcode="' + escapeHtml(p.barcode || '') + '" style="padding:0.45rem 0.65rem;cursor:pointer;border-bottom:1px solid var(--border-color);font-size:0.82rem;">' + escapeHtml(name) + ' <span style="color:var(--text-muted);font-size:0.75rem;">' + fmtCurrency(p.costPrice || p.price || 0) + '</span></div>';
            }).join('') + '</div>';
          sugg.querySelectorAll('.po-item-sugg').forEach(row => {
            row.addEventListener('mousedown', (e) => {
              e.preventDefault();
              const i = parseInt(row.dataset.idx, 10);
              itemsState[i].product = row.dataset.pid;
              itemsState[i].productName = row.dataset.name;
              itemsState[i].productBarcode = row.dataset.barcode;
              itemsState[i].productUnit = row.dataset.unit;
              itemsState[i].unitPrice = parseFloat(row.dataset.price) || itemsState[i].unitPrice;
              const nameInput = container.querySelector('.po-item-name[data-idx="' + i + '"]');
              if (nameInput) nameInput.value = itemsState[i].productName;
              const unitInput = container.querySelector('.po-item-unit[data-idx="' + i + '"]');
              if (unitInput) unitInput.value = itemsState[i].productUnit;
              const priceInput = container.querySelector('.po-item-price[data-idx="' + i + '"]');
              if (priceInput) priceInput.value = itemsState[i].unitPrice;
              sugg.style.display = 'none';
              recomputeTotals();
            });
            row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-hover)'; });
            row.addEventListener('mouseleave', () => { row.style.background = ''; });
          });
        }, 300);
      });
      inp.addEventListener('blur', () => {
        // Delay hide so click can fire
        setTimeout(() => { if (sugg) sugg.style.display = 'none'; }, 200);
      });
    });

    container.querySelectorAll('.po-item-unit').forEach(inp => {
      const idx = parseInt(inp.dataset.idx, 10);
      inp.addEventListener('input', () => { itemsState[idx].productUnit = inp.value; });
    });
    container.querySelectorAll('.po-item-qty').forEach(inp => {
      const idx = parseInt(inp.dataset.idx, 10);
      inp.addEventListener('input', () => {
        itemsState[idx].quantity = parseFloat(inp.value) || 0;
        recomputeTotals();
      });
    });
    container.querySelectorAll('.po-item-price').forEach(inp => {
      const idx = parseInt(inp.dataset.idx, 10);
      inp.addEventListener('input', () => {
        itemsState[idx].unitPrice = parseFloat(inp.value) || 0;
        recomputeTotals();
      });
    });
    container.querySelectorAll('.po-item-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        itemsState.splice(idx, 1);
        renderItems();
        recomputeTotals();
      });
    });
  }

  function recomputeTotals() {
    let subtotal = 0;
    itemsState.forEach(it => { subtotal += (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0); });
    const discount = parseFloat(overlay.querySelector('#poDiscount').value) || 0;
    const taxPct = parseFloat(overlay.querySelector('#poTaxPct').value) || 0;
    const tax = Math.max(0, (subtotal - discount)) * (taxPct / 100);
    const total = Math.max(0, subtotal - discount + tax);
    const fmt = fmtCurrency;
    const sub = overlay.querySelector('#poSubtotalVal'); if (sub) sub.textContent = fmt(subtotal);
    const dEl = overlay.querySelector('#poDiscountVal'); if (dEl) dEl.textContent = fmt(discount);
    const tEl = overlay.querySelector('#poTaxVal'); if (tEl) tEl.textContent = fmt(tax);
    const totEl = overlay.querySelector('#poTotalVal'); if (totEl) totEl.textContent = fmt(total);
  }

  overlay.querySelector('#poAddItemBtn').addEventListener('click', () => {
    itemsState.push({ product: null, productName: '', productBarcode: '', productUnit: '', quantity: 1, unitPrice: 0, total: 0 });
    renderItems();
  });

  overlay.querySelector('#poDiscount').addEventListener('input', recomputeTotals);
  overlay.querySelector('#poTaxPct').addEventListener('input', recomputeTotals);

  // Submit
  overlay.querySelector('#poForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!itemsState.length) {
      if (window.Toast) window.Toast.warning(t('noItems', 'Please add at least one item'));
      return;
    }
    // Validate items
    for (const it of itemsState) {
      if (!it.productName || !it.productName.trim()) {
        if (window.Toast) window.Toast.warning(t('itemNameRequired', 'Each item must have a name'));
        return;
      }
      if (!Number.isFinite(Number(it.quantity)) || Number(it.quantity) < 1) {
        if (window.Toast) window.Toast.warning(t('itemQtyRequired', 'Each item must have a quantity >= 1'));
        return;
      }
      if (!Number.isFinite(Number(it.unitPrice)) || Number(it.unitPrice) < 0) {
        if (window.Toast) window.Toast.warning(t('itemPriceRequired', 'Each item must have a price >= 0'));
        return;
      }
    }
    const body = {
      supplier: overlay.querySelector('#poSupplier').value || null,
      orderDate: overlay.querySelector('#poOrderDate').value || null,
      expectedDate: overlay.querySelector('#poExpectedDate').value || null,
      status: overlay.querySelector('#poStatus').value || 'draft',
      items: itemsState.map(it => ({
        product: it.product || undefined,
        productName: it.productName,
        productBarcode: it.productBarcode,
        productUnit: it.productUnit,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice)
      })),
      discount: parseFloat(overlay.querySelector('#poDiscount').value) || 0,
      tax: Math.max(0, ((itemsState.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0)) - (parseFloat(overlay.querySelector('#poDiscount').value) || 0)) * (parseFloat(overlay.querySelector('#poTaxPct').value) || 0) / 100),
      notes: overlay.querySelector('#poNotes').value.trim()
    };

    try {
      const id = overlay.querySelector('#poId').value;
      const url = id ? '/api/purchase-orders/' + id : '/api/purchase-orders';
      const r = id ? await apiFetch.put(url, body) : await apiFetch.post(url, body);
      if (r && r.success) {
        if (window.Toast) window.Toast.success(id ? t('purchaseOrderUpdated', 'Purchase order updated') : t('purchaseOrderCreated', 'Purchase order created'));
        close();
        await refreshTable();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      if (window.Toast) window.Toast.error((err && err.message) || t('error', 'Error'));
    }
  });

  renderItems();
  recomputeTotals();
}

/* ---------- View detail modal (read-only) ---------- */
function viewPurchaseOrderModal(po) {
  const items = (po.items || []);
  const itemsRows = items.length ? items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(it.productName || (it.product && (it.product.name && (it.product.name.ar || it.product.name.en || it.product.name.fr))) || '—')}</td>
      <td>${escapeHtml(it.productUnit || '—')}</td>
      <td class="num">${it.quantity}</td>
      <td class="num">${fmtCurrency(it.unitPrice)}</td>
      <td class="num">${fmtCurrency(it.total)}</td>
    </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;">${t('noData', 'No data')}</td></tr>`;

  const html = `
    <div class="modal-overlay" id="poViewModal" role="dialog" aria-modal="true" aria-labelledby="poViewTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="poViewTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <span>${t('purchaseOrderDetail', 'Purchase order detail')} — ${escapeHtml(po.orderNumber || '')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" style="padding:1rem;">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;">
            <div><strong>${t('supplier', 'Supplier')}:</strong> ${escapeHtml(supplierName(po.supplier) || po.supplierName || '—')}</div>
            <div><strong>${t('date', 'Date')}:</strong> ${fmtDateShort(po.orderDate)}</div>
            <div><strong>${t('expectedDate', 'Expected')}:</strong> ${fmtDateShort(po.expectedDate)}</div>
            <div><strong>${t('status', 'Status')}:</strong> ${statusBadge(po.status)}</div>
          </div>
          <table class="table" style="width:100%;font-size:0.82rem;">
            <thead>
              <tr>
                <th>#</th>
                <th>${t('product', 'Product')}</th>
                <th>${t('unit', 'Unité')}</th>
                <th class="num">${t('quantity', 'Qté')}</th>
                <th class="num">P Unitaire</th>
                <th class="num">Montant</th>
              </tr>
            </thead>
            <tbody>${itemsRows}</tbody>
          </table>
          <div style="margin-top:0.75rem;border-top:1px solid var(--border-color);padding-top:0.5rem;display:flex;justify-content:flex-end;gap:1rem;font-size:0.9rem;">
            <div><strong>${t('subtotal', 'Subtotal')}:</strong> ${fmtCurrency(po.subtotal)}</div>
            ${po.discount ? `<div><strong>${t('discount', 'Discount')}:</strong> −${fmtCurrency(po.discount)}</div>` : ''}
            ${po.tax ? `<div><strong>${t('tax', 'Tax')}:</strong> ${fmtCurrency(po.tax)}</div>` : ''}
            <div style="font-size:1.1rem;"><strong>${t('total', 'Total')}:</strong> ${fmtCurrency(po.total)}</div>
          </div>
          ${po.notes ? `<div style="margin-top:0.75rem;padding:0.5rem;background:var(--bg-body);border-radius:var(--radius-sm);font-size:0.82rem;"><strong>${t('notes', 'Notes')}:</strong> ${escapeHtml(po.notes)}</div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" type="button" data-action="cancel">${t('close', 'Close')}</button>
          <button class="btn btn-primary btn-sm" type="button" id="poViewEditBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>${t('edit', 'Edit')}</span>
          </button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('poViewModal');
  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#poViewEditBtn').addEventListener('click', () => {
    close();
    openPurchaseOrderModal(po);
  });
  const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
}

/* ---------- Entry ---------- */
export async function renderPurchaseOrdersPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.search = ''; state.status = '';
  content.innerHTML = renderSkeleton();
  await fetchSuppliers();
  await fetchPurchaseOrders();
  render();
}
