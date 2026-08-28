/* ============================================================
 * js/modules/tickets.js
 * ------------------------------------------------------------
 * NEW PAGE — Tickets (sales receipts).
 *
 * A dedicated page that lists completed sales as receipt-style
 * ticket cards. For every ticket the user can:
 *   • view the full sale details (items, totals, payment…)
 *   • print a classic 80mm thermal ticket (window.printThermalTicket)
 *   • download the A4 invoice PDF
 *   • create a return DIRECTLY from this page (select items +
 *     quantities → POST /api/returns) without visiting the
 *     Returns page
 *   • delete the sale (admin/manager only — backend enforces)
 *
 * Conventions (mirrors invoices.js):
 *   • All API calls go through window.apiFetch()
 *   • All user-visible strings go through window.t()
 *   • Modals are appended to document.body and removed on close
 *   • All text is trilingual (ar / en / fr) via lang/*.json
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  page: 1,
  limit: 12,
  search: '',
  status: '',
  from: '',
  to: '',
  quick: '',   // quick period filter (same values as invoices)
  pagination: null,
  items: [],
  settings: null
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtCurrency(v) {
  const cur = (state.settings && state.settings.currency) || 'DZD';
  return (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur;
}

function fmtDateShort(d) {
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d || '');
    const p = (n) => String(n).padStart(2, '0');
    return p(dt.getDate()) + '/' + p(dt.getMonth() + 1) + '/' + dt.getFullYear();
  } catch { return String(d || ''); }
}

function fmtTime(d) {
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return p(dt.getHours()) + ':' + p(dt.getMinutes());
  } catch { return ''; }
}

function saleNo(s) {
  return s.saleNumber || s.invoiceNumber || ('#' + String(s._id || '').slice(-6).toUpperCase());
}

function resolveCustomerName(cust, fallback) {
  if (!cust) return fallback || '';
  if (typeof cust === 'string') return cust;
  if (typeof cust.displayName === 'string' && cust.displayName) return cust.displayName;
  if (cust.name && typeof cust.name === 'object') return cust.name.ar || cust.name.en || cust.name.fr || '';
  if (typeof cust.name === 'string' && cust.name) return cust.name;
  return fallback || '';
}

function customerOf(s) {
  return resolveCustomerName(s.customer, t('noCustomer', 'Walk-in customer'));
}

function statusBadge(status) {
  const st = String(status || 'completed').toLowerCase();
  const map = {
    completed: { cls: 'badge-success', label: t('completed', 'Completed') },
    paid:      { cls: 'badge-success', label: t('completed', 'Completed') },
    pending:   { cls: 'badge-warning', label: t('pending', 'Pending') },
    cancelled: { cls: 'badge-danger',  label: t('cancelled', 'Cancelled') },
    returned:  { cls: 'badge-info',    label: t('returned', 'Returned') }
  };
  const m = map[st] || { cls: 'badge-muted', label: st };
  return '<span class="badge ' + m.cls + '">' + escapeHtml(m.label) + '</span>';
}

function paymentBadge(method) {
  const m = String(method || 'cash').toLowerCase();
  const map = {
    cash:     { label: t('cash', 'Cash'),     icon: 'M17 9V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2m10-6h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2m0-10V9m0 4h-2m2-4v6' },
    card:     { label: t('card', 'Card'),     icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3z' },
    transfer: { label: t('transfer', 'Transfer'), icon: 'M3 21h18M4 18h16l-1.5-9L12 5 5.5 9 4 18z' },
    split:    { label: t('split', 'Split'),   icon: 'M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4' }
  };
  const m2 = map[m] || map.cash;
  return '<span class="badge badge-muted"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="' + m2.icon + '"/></svg>' + escapeHtml(m2.label) + '</span>';
}

/* ---------- Quick period filters (shared logic with invoices) ---------- */
function applyQuickFilter() {
  if (!state.quick) return;
  const now = new Date();
  const iso = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  let from = null, to = null;
  switch (state.quick) {
    case 'today':     from = startOfDay(now); to = now; break;
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      from = startOfDay(y);
      to = new Date(y); to.setHours(23, 59, 59, 999);
      break;
    }
    case 'lastMonth':   from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); to = now; break;
    case 'last3Months': from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); to = now; break;
    case 'last6Months': from = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); to = now; break;
    case 'lastYear':    from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); to = now; break;
  }
  state.from = from ? iso(from) : '';
  state.to = to ? iso(to) : '';
}

/* ---------- Fetch ---------- */
async function fetchSettings() {
  try {
    const r = await apiFetch.get('/api/settings');
    if (r && r.success && r.data) {
      state.settings = r.data.settings ? r.data.settings : r.data;
    }
  } catch (e) { console.warn('[tickets] fetchSettings', e); }
}

async function fetchTickets() {
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  if (state.status) qs.status = state.status;
  if (state.from) qs.from = state.from;
  if (state.to) qs.to = state.to;
  try {
    const r = await apiFetch.get('/api/sales', qs);
    if (r && r.success) {
      state.items = r.data || r.sales || [];
      state.pagination = {
        page: r.page || state.page,
        pages: r.totalPages || 1,
        total: r.total || state.items.length,
        limit: r.limit || state.limit
      };
    } else { state.items = []; state.pagination = null; }
  } catch (e) {
    console.error('[tickets] fetch', e);
    state.items = []; state.pagination = null;
  }
}

async function fetchSaleDetail(id) {
  const r = await apiFetch.get('/api/sales/' + id);
  if (r && r.success) {
    if (r.data && r.data.sale) return r.data.sale;
    if (r.sale) return r.sale;
    if (r.data) return r.data;
  }
  throw new Error((r && r.message) || t('error', 'Error'));
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">${t('tickets', 'Tickets')}</div>
        <div class="page-subtitle">${t('ticketsPageSubtitle', 'Sales receipts — view, print or return directly')}</div>
      </div>
    </div>
    <div class="grid grid-4">
      ${[1, 2, 3, 4].map(() => '<div class="skeleton" style="height:96px;border-radius:12px;"></div>').join('')}
    </div>
    <div class="tickets-grid" style="margin-top:1rem;">
      ${[1, 2, 3, 4, 5, 6].map(() => '<div class="skeleton" style="height:210px;border-radius:12px;"></div>').join('')}
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
          <input class="input" id="ticketSearch" type="search"
                 placeholder="${escapeHtml(t('searchTickets', 'Search by ticket number or customer...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <select class="select" id="ticketStatusFilter" style="width:auto;">
          <option value="">${t('all', 'All')} — ${t('status', 'Status')}</option>
          <option value="completed" ${state.status === 'completed' ? 'selected' : ''}>${t('completed', 'Completed')}</option>
          <option value="pending" ${state.status === 'pending' ? 'selected' : ''}>${t('pending', 'Pending')}</option>
          <option value="cancelled" ${state.status === 'cancelled' ? 'selected' : ''}>${t('cancelled', 'Cancelled')}</option>
          <option value="returned" ${state.status === 'returned' ? 'selected' : ''}>${t('returned', 'Returned')}</option>
        </select>
        <select class="select" id="ticketQuickFilter" style="width:auto;">
          <option value="">${t('filterPeriod', 'Period')}: ${t('filterAllTime', 'All time')}</option>
          <option value="today" ${state.quick === 'today' ? 'selected' : ''}>${t('filterToday', 'Today')}</option>
          <option value="yesterday" ${state.quick === 'yesterday' ? 'selected' : ''}>${t('filterYesterday', 'Yesterday')}</option>
          <option value="lastMonth" ${state.quick === 'lastMonth' ? 'selected' : ''}>${t('filterLastMonth', 'Last month')}</option>
          <option value="last3Months" ${state.quick === 'last3Months' ? 'selected' : ''}>${t('filterLast3Months', 'Last 3 months')}</option>
          <option value="last6Months" ${state.quick === 'last6Months' ? 'selected' : ''}>${t('filterLast6Months', 'Last 6 months')}</option>
          <option value="lastYear" ${state.quick === 'lastYear' ? 'selected' : ''}>${t('filterLastYear', 'Last year')}</option>
        </select>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="ticketRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
      </div>
    </div>`;
}

/* ---------- Ticket cards ---------- */
function renderTickets() {
  if (!state.items.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4z"/><line x1="13" y1="7" x2="13" y2="17" stroke-dasharray="2 2"/></svg>
        </div>
        <div class="empty-title">${t('noTicketsMatch', 'No matching tickets')}</div>
        <div class="empty-subtitle">${t('noTickets', 'No sales found for this filter')}</div>
      </div>`;
  }

  const cards = state.items.map(s => {
    const itemCount = (s.items && s.items.length) || 0;
    const canReturn = s.status === 'completed' || s.status === 'paid';
    const canDelete = s.status !== 'returned' && s.status !== 'cancelled';
    return `
      <div class="ticket-card" data-id="${escapeHtml(s._id)}">
        <div class="ticket-card-top">
          <span class="ticket-no">${escapeHtml(saleNo(s))}</span>
          ${statusBadge(s.status)}
        </div>
        <div class="ticket-card-meta">
          <span>${escapeHtml(fmtDateShort(s.saleDate || s.createdAt))} · ${escapeHtml(fmtTime(s.saleDate || s.createdAt))}</span>
          <span class="ticket-cust">${escapeHtml(customerOf(s))}</span>
        </div>
        <div class="ticket-card-perf" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="ticket-card-body">
          <div class="ticket-card-row"><span>${t('itemsCount', 'Items')}</span><strong>${itemCount}</strong></div>
          <div class="ticket-card-row"><span>${t('paymentMethod', 'Payment')}</span>${paymentBadge(s.paymentMethod)}</div>
          <div class="ticket-card-row total"><span>${t('total', 'Total')}</span><strong>${fmtCurrency(s.total)}</strong></div>
        </div>
        <div class="ticket-card-actions">
          <button class="btn btn-secondary btn-sm" data-act="view" title="${t('view', 'View')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>${t('details', 'Details')}</span>
          </button>
          <button class="btn btn-outline btn-sm" data-act="print" title="${t('printTicket80', 'Print ticket 80mm')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            <span>${t('print', 'Print')}</span>
          </button>
          <button class="btn btn-outline btn-sm" data-act="return" ${canReturn ? '' : 'disabled'} title="${canReturn ? t('createReturn', 'Create return') : t('returnNotAllowed', 'Only completed sales can be returned')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span>${t('return', 'Return')}</span>
          </button>
          <button class="btn btn-danger btn-sm" data-act="delete" ${canDelete ? '' : 'disabled'} title="${canDelete ? t('deleteInvoice', 'Delete invoice') : t('saleCannotCancel', 'Cannot delete a returned sale')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>${t('delete', 'Delete')}</span>
          </button>
        </div>
      </div>`;
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
    <div class="tickets-grid" id="ticketsGrid">${cards}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-top:0.85rem;">
      <div class="page-info">${t('showing', 'Showing')} ${from}–${to} ${t('of', 'of')} ${p.total} ${t('results', 'results')}</div>
      <div class="pagination">${pageBtns.join('')}</div>
    </div>`;
}

/* ---------- Page render ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const header = `
    <div class="page-header">
      <div>
        <div class="page-title">${t('tickets', 'Tickets')}</div>
        <div class="page-subtitle">${t('ticketsPageSubtitle', 'Sales receipts — view, print or return directly')}</div>
      </div>
    </div>`;
  content.innerHTML = header + renderToolbar() + '<div id="ticketsContainer">' + renderTickets() + '</div>';
  bindToolbar();
  bindTickets();
}

function bindToolbar() {
  const search = document.getElementById('ticketSearch');
  if (search) {
    let deb;
    search.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => { state.search = search.value.trim(); state.page = 1; refreshTickets(); }, 300);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); state.search = search.value.trim(); state.page = 1; refreshTickets(); }
    });
  }
  const st = document.getElementById('ticketStatusFilter');
  if (st) st.addEventListener('change', () => { state.status = st.value; state.page = 1; refreshTickets(); });
  const quick = document.getElementById('ticketQuickFilter');
  if (quick) quick.addEventListener('change', () => { state.quick = quick.value; applyQuickFilter(); state.page = 1; refreshTickets(); });
  const refresh = document.getElementById('ticketRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => refreshTickets());
}

function bindTickets() {
  const grid = document.getElementById('ticketsGrid');
  if (!grid) return;
  grid.querySelectorAll('.ticket-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        if (btn.disabled) return;
        if (act === 'view') openTicketDetail(id);
        else if (act === 'print') printTicket(id);
        else if (act === 'return') openReturnModal(id);
        else if (act === 'delete') deleteTicket(id);
      });
    });
  });
  grid.querySelectorAll('.page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const pg = parseInt(b.dataset.page, 10);
      if (!isNaN(pg) && pg > 0) { state.page = pg; refreshTickets(); }
    });
  });
}

async function refreshTickets() {
  const container = document.getElementById('ticketsContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchTickets();
  if (container) container.innerHTML = renderTickets();
  bindTickets();
}

/* ============================================================
 * Ticket detail modal
 * ============================================================ */
async function openTicketDetail(id) {
  let sale = state.items.find(x => x._id === id);
  try {
    sale = await fetchSaleDetail(id);
  } catch (e) {
    if (!sale) {
      if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
      return;
    }
  }
  if (!state.settings) await fetchSettings();

  const items = sale.items || [];
  const currency = (state.settings && state.settings.currency) || 'DZD';
  const invLang = window.getStoredInvoiceLang ? window.getStoredInvoiceLang() : 'fr';
  const L = window.invoiceLabels ? window.invoiceLabels(invLang) : {};
  const itemRows = items.map((it, i) => {
    const name = it.productName || (it.product && (typeof it.product.name === 'object' ? (it.product.name.ar || it.product.name.en || it.product.name.fr) : it.product)) || '—';
    const qty = Number(it.quantity) || 0;
    const price = Number(it.price) || 0;
    const total = Number(it.total) || (qty * price - (Number(it.discount) || 0));
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(String(name))}</td>
        <td class="num">${qty}</td>
        <td class="num">${price.toFixed(2)}</td>
        <td class="num">${total.toFixed(2)}</td>
      </tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'ticketDetailModal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="modal" role="document">
      <div class="modal-header">
        <div class="modal-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4z"/></svg>
          <span>${t('ticketDetail', 'Ticket detail')} — ${escapeHtml(saleNo(sale))}</span>
        </div>
        <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" style="padding:1rem;">
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem 1.5rem;margin-bottom:0.9rem;font-size:0.85rem;">
          <div><strong>${t('date', 'Date')}:</strong> ${escapeHtml(fmtDateShort(sale.saleDate || sale.createdAt))} ${escapeHtml(fmtTime(sale.saleDate || sale.createdAt))}</div>
          <div><strong>${t('customer', 'Customer')}:</strong> ${escapeHtml(customerOf(sale))}</div>
          <div><strong>${t('paymentMethod', 'Payment')}:</strong> ${paymentBadge(sale.paymentMethod)}</div>
          <div><strong>${t('status', 'Status')}:</strong> ${statusBadge(sale.status)}</div>
        </div>
        <div class="table-wrap" style="max-height:40vh;">
          <table class="table">
            <thead><tr><th>#</th><th>${t('product', 'Product')}</th><th>${t('qty', 'Qty')}</th><th>${t('unitPrice', 'Unit price')}</th><th>${t('total', 'Total')}</th></tr></thead>
            <tbody>${itemRows || '<tr><td colspan="5" style="text-align:center;">' + t('noData', 'No data') + '</td></tr>'}</tbody>
          </table>
        </div>
        <div style="margin-top:0.9rem;display:flex;flex-direction:column;gap:0.25rem;align-items:flex-end;font-size:0.88rem;">
          <div><strong>${L.totalHT || 'Total H.T'}:</strong> ${(Number(sale.subtotal) || 0).toFixed(2)} ${currency}</div>
          ${Number(sale.discount) > 0 ? `<div><strong>${L.cartDiscount || 'Remise'}:</strong> −${Number(sale.discount).toFixed(2)} ${currency}</div>` : ''}
          ${Number(sale.couponDiscount) > 0 ? `<div><strong>${L.coupon || 'Coupon'}:</strong> −${Number(sale.couponDiscount).toFixed(2)} ${currency}</div>` : ''}
          ${Number(sale.tax) > 0 ? `<div><strong>${L.vat || 'TVA'}:</strong> ${Number(sale.tax).toFixed(2)} ${currency}</div>` : ''}
          ${Number(sale.timbre) > 0 ? `<div><strong>${L.stamp || 'Timbre'}:</strong> ${Number(sale.timbre).toFixed(2)} ${currency}</div>` : ''}
          <div style="font-size:1.05rem;font-weight:800;color:var(--primary);"><strong>${L.totalTTC || 'TOTAL T.T.C'}:</strong> ${(Number(sale.total) || 0).toFixed(2)} ${currency}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" data-close>${t('close', 'Close')}</button>
        <button class="btn btn-outline btn-sm" type="button" data-print>${t('ticket80', 'Ticket 80mm')}</button>
        <button class="btn btn-outline btn-sm" type="button" data-pdf>${t('downloadPdf', 'Download PDF')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function close() { overlay.remove(); document.removeEventListener('keydown', esc); }
  const esc = (e) => { if (e.key === 'Escape') close(); };
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', esc);
  overlay.querySelector('[data-print]').addEventListener('click', () => {
    if (window.printThermalTicket) window.printThermalTicket(sale, state.settings || {}, invLang);
  });
  overlay.querySelector('[data-pdf]').addEventListener('click', () => downloadTicketPdf(sale));
}

/* ============================================================
 * Print 80mm ticket + PDF download
 * ============================================================ */
async function printTicket(id) {
  try {
    const sale = await fetchSaleDetail(id);
    if (!state.settings) await fetchSettings();
    const invLang = window.getStoredInvoiceLang ? window.getStoredInvoiceLang() : 'fr';
    if (window.printThermalTicket) {
      window.printThermalTicket(sale, state.settings || {}, invLang);
    } else if (window.Toast) {
      window.Toast.error(t('ticketLibMissing', 'Ticket printing is unavailable'));
    }
  } catch (e) {
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
  }
}

function downloadTicketPdf(sale) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (window.Toast) window.Toast.error(t('pdfLibMissing', 'PDF library not loaded'));
      return;
    }
    if (window.__dzposDownloadInvoicePdf) {
      // Reuse the shared A4 invoice generator exposed by invoices.js
      window.__dzposDownloadInvoicePdf(sale);
      return;
    }
    if (window.Toast) window.Toast.info(t('openInvoicesForPdf', 'Use the Invoices page for the A4 PDF'));
  } catch (e) {
    if (window.Toast) window.Toast.error((e && e.message) || t('pdfFailed', 'Failed to generate PDF'));
  }
}

/* ============================================================
 * Direct return from the ticket (same POST /api/returns the
 * Returns page uses) — pick items + quantities, confirm, done.
 * ============================================================ */
function openReturnModal(id) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'ticketReturnModal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="modal" role="document">
      <div class="modal-header">
        <div class="modal-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          <span>${t('createReturn', 'Create return')}</span>
        </div>
        <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" style="padding:1rem;">
        <div class="loading-state" style="padding:1.5rem;"><div class="spinner"></div><span style="margin-inline-start:0.5rem;">${t('loading', 'Loading...')}</span></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" data-close>${t('cancel', 'Cancel')}</button>
        <button class="btn btn-primary" type="button" data-confirm disabled>${t('confirmReturn', 'Confirm return')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function close() { overlay.remove(); document.removeEventListener('keydown', esc); }
  const esc = (e) => { if (e.key === 'Escape') close(); };
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', esc);

  (async () => {
    const body = overlay.querySelector('.modal-body');
    let sale = null;
    try { sale = await fetchSaleDetail(id); } catch (e) {
      body.innerHTML = '<div class="empty-state"><div class="empty-title">' + escapeHtml((e && e.message) || t('error', 'Error')) + '</div></div>';
      return;
    }
    if (!sale || sale.status === 'returned') {
      body.innerHTML = '<div class="empty-state"><div class="empty-title">' + escapeHtml(t('saleAlreadyReturned', 'This sale was already returned')) + '</div></div>';
      return;
    }
    const items = (sale.items || []).filter(it => it._id);
    if (!items.length) {
      body.innerHTML = '<div class="empty-state"><div class="empty-title">' + escapeHtml(t('noItemsToReturn', 'No returnable items on this sale')) + '</div></div>';
      return;
    }

    body.innerHTML = `
      <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.6rem;">
        ${escapeHtml(saleNo(sale))} — ${escapeHtml(customerOf(sale))}
      </div>
      <div id="returnItems" style="display:flex;flex-direction:column;gap:0.5rem;">
        ${items.map((it, idx) => {
          const name = it.productName || (it.product && (typeof it.product.name === 'object' ? (it.product.name.ar || it.product.name.en || it.product.name.fr) : it.product)) || '—';
          const qty = Number(it.quantity) || 0;
          return `
          <label class="return-item-row" data-idx="${idx}" style="display:flex;align-items:center;gap:0.6rem;padding:0.55rem 0.7rem;border:1px solid var(--border-color);border-radius:var(--radius-sm);cursor:pointer;">
            <input type="checkbox" class="ret-check" data-idx="${idx}" style="width:16px;height:16px;accent-color:var(--primary);" />
            <span style="flex:1;min-width:0;font-size:0.85rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(String(name))}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);">× ${qty}</span>
            <input type="number" class="input ret-qty" data-idx="${idx}" min="1" max="${qty}" value="${qty}" disabled
                   style="width:70px;height:32px;text-align:center;padding:0;" aria-label="${t('quantity', 'Quantity')}" />
          </label>`;
        }).join('')}
      </div>
      <div class="form-group" style="margin-top:0.85rem;">
        <label class="form-label">${t('returnReason', 'Reason (optional)')}</label>
        <input class="input" id="retReason" type="text" placeholder="${escapeHtml(t('returnReasonPh', 'Why is this being returned?'))}" />
      </div>`;

    const confirmBtn = overlay.querySelector('[data-confirm]');
    const rows = Array.from(body.querySelectorAll('.return-item-row'));
    function syncState() {
      rows.forEach(row => {
        const chk = row.querySelector('.ret-check');
        const qty = row.querySelector('.ret-qty');
        if (qty) qty.disabled = !chk.checked;
      });
      confirmBtn.disabled = !body.querySelector('.ret-check:checked');
    }
    rows.forEach(row => {
      const chk = row.querySelector('.ret-check');
      chk.addEventListener('change', syncState);
      row.addEventListener('click', (e) => {
        if (e.target === chk || e.target.classList.contains('ret-qty')) return;
        chk.checked = !chk.checked;
        syncState();
      });
    });
    syncState();

    confirmBtn.addEventListener('click', async () => {
      const chosen = [];
      body.querySelectorAll('.ret-check:checked').forEach(chk => {
        const idx = parseInt(chk.dataset.idx, 10);
        const it = items[idx];
        if (!it) return;
        const qtyInput = body.querySelector('.ret-qty[data-idx="' + idx + '"]');
        let q = parseInt(qtyInput && qtyInput.value, 10);
        if (isNaN(q) || q < 1) q = 1;
        const maxQ = Number(it.quantity) || 1;
        if (q > maxQ) q = maxQ;
        chosen.push({
          saleItem: it._id,
          product: (it.product && (it.product._id || it.product)) || it.product,
          quantity: q,
          price: Number(it.price) || 0
        });
      });
      if (!chosen.length) return;
      const reason = (body.querySelector('#retReason') || {}).value || '';
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<div class="spinner sm" style="display:inline-block;vertical-align:middle;"></div>';
      try {
        const r = await apiFetch.post('/api/returns', { sale: sale._id, items: chosen, reason: reason || undefined });
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('returnCreated', 'Return created successfully'));
          close();
          refreshTickets();
          try { window.dispatchEvent(new CustomEvent('sale:completed', { detail: { saleId: sale._id, returned: true } })); } catch (_) {}
        } else {
          throw new Error((r && r.message) || t('returnFailed', 'Failed to create the return'));
        }
      } catch (e) {
        if (window.Toast) window.Toast.error((e && e.message) || t('returnFailed', 'Failed to create the return'));
        confirmBtn.disabled = false;
        confirmBtn.textContent = t('confirmReturn', 'Confirm return');
      }
    });
  })();
}

/* ============================================================
 * Delete ticket (same endpoint as invoices)
 * ============================================================ */
async function deleteTicket(id) {
  const ok = await (window.Toast && window.Toast.confirm
    ? window.Toast.confirm(t('deleteInvoiceConfirm', 'Delete this invoice? Stock will be restored to its previous level.'))
    : Promise.resolve(window.confirm(t('deleteInvoiceConfirm', 'Delete this invoice?'))));
  if (!ok) return;
  try {
    const r = await apiFetch.delete('/api/sales/' + id);
    if (r && r.success) {
      if (window.Toast) window.Toast.success(t('invoiceDeleted', 'Invoice deleted'));
      refreshTickets();
      try { window.dispatchEvent(new CustomEvent('sale:completed', { detail: { saleId: id, deleted: true } })); } catch (_) {}
    } else {
      throw new Error((r && r.message) || t('error', 'Error'));
    }
  } catch (e) {
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
  }
}

/* ============================================================
 * Entry
 * ============================================================ */
export async function renderTicketsPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state = {
    page: 1, limit: 12, search: '', status: '', from: '', to: '', quick: '',
    pagination: null, items: [], settings: null
  };
  content.innerHTML = renderSkeleton();
  await Promise.all([fetchSettings(), fetchTickets()]);
  render();
}
