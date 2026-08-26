/* ============================================================
 * js/modules/invoices.js
 * ------------------------------------------------------------
 * Renders the Invoices (= Sales) history page into #pageContent.
 *
 * Features:
 *   • Page header: title + subtitle + Export CSV action
 *   • Toolbar: debounced search (sale # / customer name),
 *     status filter, date range (from / to), refresh
 *   • 4 stat cards: Total invoices, Total revenue, Paid vs
 *     Pending count, Today's invoices
 *   • Server-side paginated table with invoice # (clickable →
 *     detail modal), date, customer, items count, total,
 *     payment method badge, color-coded status badge, and
 *     row actions (view / download PDF)
 *   • Invoice detail modal: customer info + items table +
 *     totals + payment, with "Download PDF" (jsPDF + autotable)
 *     and "Print" (window.print with print stylesheet) buttons
 *   • Skeleton + empty states, Esc-to-close topmost modal
 *   • All text via window.t(), all API via window.apiFetch(),
 *     all notifications via window.Toast
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  page: 1,
  limit: 20,
  search: '',
  status: '',     // '' | 'completed' | 'pending' | 'cancelled' | 'returned'
  from: '',       // ISO date
  to: '',
  pagination: null,
  items: [],
  stats: { total: 0, revenue: 0, paid: 0, pending: 0, today: 0 },
  settings: null
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtCurrency(n) {
  const v = Number(n || 0);
  const cur = (state.settings && state.settings.currency) || t('currency', 'DZD');
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur;
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return '—'; }
}

function fmtDateShort(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString();
  } catch (_) { return '—'; }
}

function statusBadge(s) {
  const st = (s || 'completed').toLowerCase();
  const map = {
    completed: ['badge-success', 'completed'],
    paid:      ['badge-success', 'completed'],
    pending:   ['badge-warning', 'pending'],
    cancelled: ['badge-muted',   'cancelled'],
    canceled:  ['badge-muted',   'cancelled'],
    returned:  ['badge-info',    'returned']
  };
  const m = map[st] || map.completed;
  return '<span class="badge ' + m[0] + '">' + t(m[1], m[1]) + '</span>';
}

function paymentBadge(method) {
  const m = (method || 'cash').toLowerCase();
  const map = {
    cash: 'badge-success',
    card: 'badge-primary',
    transfer: 'badge-info',
    split: 'badge-warning',
    credit: 'badge-muted'
  };
  const label = t(m, m);
  return '<span class="badge ' + (map[m] || 'badge-muted') + '">' + label + '</span>';
}

function customerName(sale) {
  if (!sale) return t('noCustomer', 'Walk-in customer');
  return resolveCustomerName(sale.customer);
}

/* ---------- Receipt-rendering helpers (parity with sales.js) ----------
 * These replicate the helpers used by sales.js so the invoice detail modal
 * and PDF match the sale-time receipt exactly.
 * ----------------------------------------------------------------- */

/* Resolve a customer reference to a STRING — never [object Object].
 * Handles the case where `cust.name` is an object {ar,en,fr}. */
function resolveCustomerName(cust, fallback) {
  const fb = fallback || t('noCustomer', 'Walk-in customer');
  if (!cust) return fb;
  if (typeof cust === 'string') return cust;
  if (typeof cust === 'object') {
    let name = cust.displayName || cust.name;
    if (name && typeof name === 'object') {
      name = name.ar || name.en || name.fr || '';
    }
    if (name) return String(name);
    if (cust.phone) return String(cust.phone);
    return fb;
  }
  return fb;
}

function paymentLabel(method) {
  const m = String(method || 'cash').toLowerCase();
  return ({ cash: t('cash', 'Cash'), card: t('card', 'Card'), transfer: t('transfer', 'Transfer'), split: t('split', 'Split') })[m] || m;
}

function productNameStr(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  if (p.displayName) return p.displayName;
  if (p.name && typeof p.name === 'object') return p.name.ar || p.name.en || p.name.fr || '';
  if (typeof p.name === 'string') return p.name;
  return '';
}

/* Normalise a sale item into {name, unit, qty, price, discount, total} strings/numbers. */
function itemDisplay(it) {
  const rawName = it.productName
    || (it.product && productNameStr(it.product))
    || (it.name && typeof it.name === 'object' ? (it.name.ar || it.name.en || it.name.fr) : it.name)
    || '—';
  const qty   = Number(it.quantity) || 0;
  const price = Number(it.price) || 0;
  const discount = Number(it.discount) || 0;
  const total = Number(it.total) || Math.max(0, qty * price - discount);
  // Prefer the historical snapshot captured at sale time (productUnit), then
  // fall back to the live product.unit. Default to 'pcs' so we never show '—'.
  const unit = it.productUnit
    || (it.product && (it.product.unit || it.product.unité))
    || it.unit
    || 'pcs';
  return { name: String(rawName) || '—', unit: unit || 'pcs', qty, price, discount, total };
}

/* Convert a number to French words — used by the total-in-words line.
 * (Replicated from sales.js num2frenchwords so the invoices page does not
 *  depend on sales.js being loaded.) */
function num2frenchwords(n) {
  if (n === undefined || n === null || isNaN(n)) return '';
  n = Math.round(n * 100) / 100;
  const parts = n.toFixed(2).split('.');
  const integerPart = parseInt(parts[0], 10);
  const decimalPart = parseInt(parts[1], 10);
  if (integerPart === 0 && decimalPart === 0) return 'Zéro dinar algérien';
  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];
  function convertChunk(num) {
    if (num === 0) return '';
    let result = '';
    const hundreds = Math.floor(num / 100);
    const remainder = num % 100;
    if (hundreds > 0) {
      if (hundreds === 1) result += 'cent';
      else result += units[hundreds] + ' cent';
      if (remainder === 0) result += 's';
      result += ' ';
    }
    if (remainder === 0) return result.trim();
    if (remainder < 17) {
      result += units[remainder];
    } else if (remainder < 70) {
      const ten = Math.floor(remainder / 10);
      const unit = remainder % 10;
      if (ten === 1) {
        result += 'dix';
        if (unit > 0) result += '-' + units[unit];
      } else if (ten === 7) {
        result += 'soixante';
        if (unit === 1) result += '-onze';
        else if (unit > 1) result += '-' + units[unit + 10];
        else result += '-dix';
      } else {
        result += tens[ten];
        if (unit > 0) result += '-' + units[unit];
      }
    } else if (remainder < 80) {
      const unit = remainder - 70;
      result += 'soixante';
      if (unit === 0) result += '-dix';
      else if (unit === 1) result += '-onze';
      else result += '-' + units[unit + 10];
    } else if (remainder < 90) {
      const unit = remainder - 80;
      result += 'quatre-vingt';
      if (unit > 0) result += '-' + units[unit];
      else result += 's';
    } else {
      const unit = remainder - 90;
      result += 'quatre-vingt';
      if (unit === 0) result += '-dix';
      else if (unit === 1) result += '-onze';
      else result += '-' + units[unit + 10];
    }
    return result.trim();
  }
  function convertBig(num) {
    if (num === 0) return '';
    const millions = Math.floor(num / 1000000);
    const thousands = Math.floor((num % 1000000) / 1000);
    const remainder = num % 1000;
    let result = '';
    if (millions > 0) {
      if (millions === 1) result += 'un million';
      else result += convertChunk(millions) + ' millions';
      if (thousands > 0 || remainder > 0) result += ' ';
    }
    if (thousands > 0) {
      if (thousands === 1) result += 'mille';
      else result += convertChunk(thousands) + ' mille';
      if (remainder > 0) result += ' ';
    }
    if (remainder > 0) result += convertChunk(remainder);
    return result.trim();
  }
  const integerWords = integerPart > 0 ? convertBig(integerPart) : '';
  const decimalWords = decimalPart > 0 ? convertChunk(decimalPart) + (decimalPart === 1 ? ' centime' : ' centimes') : '';
  let result = '';
  if (integerWords) result += integerWords + ' dinar algérien';
  if (decimalWords) {
    if (integerWords) result += ' et ';
    result += decimalWords;
  }
  result = result.replace(/\s+/g, ' ').trim();
  return result.charAt(0).toUpperCase() + result.slice(1);
}

/* Primary brand color — settings may override the default emerald. */
function primaryColor() {
  return (state.settings && state.settings.invoicePrimaryColor) || '#10b981';
}

/* Convert '#10b981' / '10b981' to [r, g, b] integers (for jsPDF colors). */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [16, 185, 129];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">${t('invoices', 'Invoices')}</div>
        <div class="page-subtitle">${t('invoicesPageSubtitle', 'Browse, search and download your sales invoices')}</div>
      </div>
    </div>
    <div class="grid grid-4">
      ${[1,2,3,4].map(() => '<div class="skeleton" style="height:96px;border-radius:12px;"></div>').join('')}
    </div>
    <div class="toolbar" style="margin-top:1rem;">
      <div class="skeleton" style="height:40px;width:280px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
      <div class="skeleton" style="height:40px;width:140px;"></div>
    </div>
    <div class="table-wrap">
      ${[1,2,3,4,5,6,7,8].map(() => `<div class="skeleton skeleton-line" style="height:48px;margin:0;border-radius:0;"></div>`).join('')}
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
          <input class="input" id="invoiceSearch" type="search"
                 placeholder="${escapeHtml(t('searchInvoices', 'Search by invoice number or customer...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <select class="select" id="invoiceStatusFilter" style="width:auto;">
          <option value="">${t('all', 'All')} — ${t('status', 'Status')}</option>
          <option value="completed" ${state.status === 'completed' ? 'selected' : ''}>${t('completed', 'Completed')}</option>
          <option value="pending" ${state.status === 'pending' ? 'selected' : ''}>${t('pending', 'Pending')}</option>
          <option value="cancelled" ${state.status === 'cancelled' ? 'selected' : ''}>${t('cancelled', 'Cancelled')}</option>
          <option value="returned" ${state.status === 'returned' ? 'selected' : ''}>${t('returned', 'Returned')}</option>
        </select>
        <div class="input-group" style="width:auto;">
          <input class="input" id="invoiceFrom" type="date" value="${escapeHtml(state.from)}" title="${t('dateFrom', 'From')}" aria-label="${t('dateFrom', 'From')}" />
        </div>
        <div class="input-group" style="width:auto;">
          <input class="input" id="invoiceTo" type="date" value="${escapeHtml(state.to)}" title="${t('dateTo', 'To')}" aria-label="${t('dateTo', 'To')}" />
        </div>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="invoiceRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
        <button class="btn btn-outline btn-sm" id="invoiceExportBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>${t('exportCsv', 'Export CSV')}</span>
        </button>
      </div>
    </div>`;
}

/* ---------- Stats ---------- */
function renderStats() {
  const s = state.stats || { total: 0, revenue: 0, paid: 0, pending: 0, today: 0 };
  return `
    <div class="grid grid-4" style="margin-bottom:1rem;">
      <div class="stat-card">
        <div class="stat-icon cyan" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div>
          <div class="stat-value">${s.total}</div>
          <div class="stat-label">${t('totalInvoices', 'Total invoices')}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div>
          <div class="stat-value">${fmtCurrency(s.revenue)}</div>
          <div class="stat-label">${t('totalRevenue', 'Total revenue')}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div>
          <div class="stat-value">${s.paid} / ${s.pending}</div>
          <div class="stat-label">${t('paidVsPending', 'Paid / Pending')}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div>
          <div class="stat-value">${s.today}</div>
          <div class="stat-label">${t('todayInvoices', "Today's invoices")}</div>
        </div>
      </div>
    </div>`;
}

/* ---------- Table ---------- */
function renderTable() {
  if (!state.items.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <div class="empty-title">${t('noInvoicesMatch', 'No matching invoices')}</div>
        <div class="empty-subtitle">${t('noInvoices', 'No invoices found')}</div>
      </div>`;
  }

  const rows = state.items.map((s, i) => {
    const idx = (state.page - 1) * state.limit + i + 1;
    const num = escapeHtml(s.saleNumber || ('#' + String(s._id || '').slice(-6)));
    const date = fmtDate(s.saleDate || s.createdAt);
    const cust = escapeHtml(customerName(s));
    const itemCount = (s.items && s.items.length) || 0;
    const total = fmtCurrency(s.total);
    const pay = paymentBadge(s.paymentMethod);
    const st = statusBadge(s.status);
    return `
      <tr>
        <td class="cell-muted">${idx}</td>
        <td class="cell-strong">
          <a href="#" class="invoice-link" data-id="${s._id}" style="color:inherit;text-decoration:underline;">${num}</a>
        </td>
        <td>${date}</td>
        <td>${cust}</td>
        <td>${itemCount}</td>
        <td class="cell-strong">${total}</td>
        <td>${pay}</td>
        <td>${st}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn view" data-id="${s._id}" aria-label="${t('view', 'View')}" title="${t('view', 'View')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="table-action-btn download" data-id="${s._id}" aria-label="${t('downloadPdf', 'Download PDF')}" title="${t('downloadPdf', 'Download PDF')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
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
            <th>${t('invoiceNumber', 'Invoice #')}</th>
            <th>${t('date', 'Date')}</th>
            <th>${t('customer', 'Customer')}</th>
            <th>${t('itemsCount', 'Items')}</th>
            <th>${t('total', 'Total')}</th>
            <th>${t('paymentMethod', 'Payment')}</th>
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
async function fetchSettings() {
  // Always re-fetch — the user may have changed the primary color or
  // company info in Settings, and the invoice PDF must reflect that.
  // (apiFetch.get uses cache: 'no-store' so this is always fresh.)
  try {
    const r = await apiFetch.get('/api/settings');
    if (r && r.success && r.data) {
      // Backend returns { success, data: { settings: {...} } }
      state.settings = (r.data.settings) ? r.data.settings : r.data;
    }
  } catch (e) { console.warn('[invoices] fetchSettings', e); }
}

async function fetchInvoices() {
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
    console.error('[invoices] fetch', e);
    state.items = []; state.pagination = null;
  }
  computeStats();
}

function computeStats() {
  const todayStr = new Date().toDateString();
  let total = state.pagination ? state.pagination.total : state.items.length;
  // If we only have one page loaded, prefer items length when smaller
  if (state.pagination && state.pagination.total > state.items.length) {
    // total = pagination.total (already)
  } else {
    total = state.items.length;
  }
  let revenue = 0, paid = 0, pending = 0, today = 0;
  state.items.forEach(s => {
    const st = (s.status || 'completed').toLowerCase();
    if (st === 'completed' || st === 'paid') {
      revenue += Number(s.total) || 0;
      paid++;
    } else if (st === 'pending') {
      pending++;
    }
    const d = s.saleDate || s.createdAt;
    if (d && new Date(d).toDateString() === todayStr) today++;
  });
  state.stats = { total, revenue, paid, pending, today };
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const header = `
    <div class="page-header">
      <div>
        <div class="page-title">${t('invoices', 'Invoices')}</div>
        <div class="page-subtitle">${t('invoicesPageSubtitle', 'Browse, search and download your sales invoices')}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-outline btn-sm" id="invoiceExportBtnHeader" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>${t('exportCsv', 'Export CSV')}</span>
        </button>
      </div>
    </div>`;
  content.innerHTML = header + renderStats() + renderToolbar() + '<div id="invoicesTableContainer">' + renderTable() + '</div>';
  bindToolbar();
  bindTable();
}

function bindToolbar() {
  const search = document.getElementById('invoiceSearch');
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
  const st = document.getElementById('invoiceStatusFilter');
  if (st) st.addEventListener('change', () => {
    state.status = st.value; state.page = 1; refreshTable();
  });
  const fromEl = document.getElementById('invoiceFrom');
  if (fromEl) fromEl.addEventListener('change', () => {
    state.from = fromEl.value; state.page = 1; refreshTable();
  });
  const toEl = document.getElementById('invoiceTo');
  if (toEl) toEl.addEventListener('change', () => {
    state.to = toEl.value; state.page = 1; refreshTable();
  });
  const refresh = document.getElementById('invoiceRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => refreshTable());
  const exportBtn = document.getElementById('invoiceExportBtn');
  if (exportBtn) exportBtn.addEventListener('click', () => exportCsv());
  const exportBtnHeader = document.getElementById('invoiceExportBtnHeader');
  if (exportBtnHeader) exportBtnHeader.addEventListener('click', () => exportCsv());
}

function bindTable() {
  const container = document.getElementById('invoicesTableContainer');
  if (!container) return;

  const openDetail = async (id) => {
    const sale = state.items.find(x => x._id === id);
    if (sale) {
      viewInvoiceModal(sale);
    } else {
      try {
        const r = await apiFetch.get('/api/sales/' + id);
        if (r && r.success) {
          const saleObj = (r.data && r.data.sale) ? r.data.sale : (r.sale || r.data);
          if (saleObj) viewInvoiceModal(saleObj);
        }
      } catch (e) { if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error')); }
    }
  };

  container.querySelectorAll('.invoice-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openDetail(a.dataset.id);
    });
  });
  container.querySelectorAll('.table-action-btn.view').forEach(b => {
    b.addEventListener('click', () => openDetail(b.dataset.id));
  });
  container.querySelectorAll('.table-action-btn.download').forEach(b => {
    b.addEventListener('click', async () => {
      const sale = state.items.find(x => x._id === b.dataset.id);
      if (!sale) return;
      try {
        const r = await apiFetch.get('/api/sales/' + sale._id);
        let detail = sale;
        if (r && r.success) {
          detail = (r.data && r.data.sale) ? r.data.sale : (r.sale || r.data || sale);
        }
        downloadInvoicePdf(detail);
      } catch (e) {
        // Fallback to whatever we have
        downloadInvoicePdf(sale);
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
  const container = document.getElementById('invoicesTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchInvoices();
  if (container) container.innerHTML = renderTable();
  bindTable();
  // Also refresh stats in place
  const statsContainer = document.querySelector('.grid.grid-4');
  // The stats grid is the FIRST .grid.grid-4 in pageContent
  const pageContent = document.getElementById('pageContent');
  if (pageContent) {
    const firstGrid = pageContent.querySelector('.grid.grid-4');
    if (firstGrid) firstGrid.outerHTML = renderStats().trim();
  }
}

/* ---------- CSV export ---------- */
function exportCsv() {
  if (!state.items.length) {
    if (window.Toast) window.Toast.info(t('noInvoices', 'No invoices to export'));
    return;
  }
  const headers = ['#', 'invoiceNumber', 'date', 'customer', 'phone', 'items', 'subtotal', 'discount', 'tax', 'timbre', 'total', 'paymentMethod', 'status'];
  const lines = [headers.join(',')];
  state.items.forEach((s, i) => {
    const idx = (state.page - 1) * state.limit + i + 1;
    const cust = customerName(s);
    const phone = (s.customer && s.customer.phone) || '';
    const itemCount = (s.items && s.items.length) || 0;
    const cells = [
      idx,
      '"' + (s.saleNumber || '').replace(/"/g, '""') + '"',
      '"' + fmtDateShort(s.saleDate || s.createdAt) + '"',
      '"' + cust.replace(/"/g, '""') + '"',
      '"' + (phone || '').replace(/"/g, '""') + '"',
      itemCount,
      Number(s.subtotal || 0).toFixed(2),
      Number(s.discount || 0).toFixed(2),
      Number(s.tax || 0).toFixed(2),
      Number(s.timbre || 0).toFixed(2),
      Number(s.total || 0).toFixed(2),
      '"' + (s.paymentMethod || '') + '"',
      '"' + (s.status || '') + '"'
    ];
    lines.push(cells.join(','));
  });
  const csv = lines.join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'invoices-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (window.Toast) window.Toast.success(t('exportDone', 'Export ready'));
}

/* ---------- Invoice detail modal ---------- */
async function viewInvoiceModal(sale) {
  // Always fetch full detail (the invoices table only has stub items).
  if (sale && sale._id) {
    try {
      const r = await apiFetch.get('/api/sales/' + sale._id);
      if (r && r.success) {
        // Backend returns { success, data: { sale: {...} } }
        if (r.data && r.data.sale) sale = r.data.sale;
        else if (r.sale) sale = r.sale;
        else if (r.data) sale = r.data;
      }
    } catch (e) {
      console.warn('[invoices] fetch detail failed', e);
    }
  }
  if (!state.settings) await fetchSettings();

  const settings = state.settings || {};
  const company  = settings.companyInfo || {};
  const currency = settings.currency || 'DZD';
  const taxRate  = Number(settings.taxRate || 0);
  const pc       = primaryColor();

  // ✅ النص الترويسي
  const headerText = settings.invoiceHeader && settings.invoiceHeader.trim() ? `
    <div class="receipt-header-text" style="
        font-size:13px;
        color:var(--text-secondary);
        text-align:center;
        margin:4px 0 8px 0;
        padding:4px 0;
        border-bottom:1px dashed var(--border-color);
        line-height:1.5;
    ">
        ${escapeHtml(settings.invoiceHeader)}
    </div>
  ` : '';

  // Build normalized items + totals (parity with sales.js receipt)
  const items    = (sale.items || []).map(it => itemDisplay(it));
  const subtotal = Number(sale.subtotal) || 0;
  const cartDiscount = Number(sale.discount) || 0;
  const couponDiscount = Number(sale.couponDiscount) || 0;
  // Sum per-item discounts (each item may have its own discount)
  const itemDiscounts = items.reduce((s, it) => s + (Number(it.discount) || 0), 0);
  const totalDiscount = cartDiscount + couponDiscount + itemDiscounts;
  const tax      = Number(sale.tax) || 0;
  const timbre   = Number(sale.timbre) || 0;
  const total    = Number(sale.total) || 0;
  const totalWords = num2frenchwords(total);
  const payMethod  = sale.paymentMethod || 'cash';
  const payLabel    = paymentLabel(payMethod);
  const invoiceNo   = sale.saleNumber || ('#' + String(sale._id || '').slice(-6));
  const saleDate    = fmtDateShort(sale.saleDate || sale.createdAt);
  const customerNameStr = resolveCustomerName(sale.customer, 'Particulier');
  const customText  = (settings.invoiceCustomText || '').trim();

  const itemsRows = items.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.name)}</td>
        <td>${escapeHtml(it.unit || '—')}</td>
        <td class="num">${it.qty}</td>
        <td class="num">${it.price.toFixed(2)}</td>
        <td class="num">${it.total.toFixed(2)}</td>
      </tr>`).join('');

  const html = `
    <style>
      /* Receipt-sheet layout — replicated from sales.js POS_CSS so the
         invoice detail modal renders the EXACT same receipt as the sale-
         time preview. The selectors are scoped to #invoiceDetailModal so
         they don't leak onto the global page. */
      #invoiceDetailModal .receipt-sheet {
        background:#fff; color:#111; padding:1.2rem;
        border:1px solid #e5e7eb; border-radius:8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size:0.85rem; line-height:1.4; max-width:780px; margin:0 auto;
      }
      #invoiceDetailModal .receipt-sheet .receipt-head { text-align:center; border-bottom:2px dashed #999; padding-bottom:0.75rem; margin-bottom:0.75rem; }
      #invoiceDetailModal .receipt-sheet .receipt-store { font-size:1.6rem; font-weight:800; }
      #invoiceDetailModal .receipt-sheet .receipt-sub { font-size:0.75rem; color:#444; }
      #invoiceDetailModal .receipt-sheet .receipt-meta { display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; font-size:0.78rem; margin-bottom:0.5rem; }
      #invoiceDetailModal .receipt-sheet table { width:100%; border-collapse:collapse; font-size:0.78rem; }
      #invoiceDetailModal .receipt-sheet th, #invoiceDetailModal .receipt-sheet td { padding:0.25rem 0.3rem; text-align:start; }
      #invoiceDetailModal .receipt-sheet th { border-bottom:2px solid #999; font-weight:700; }
      #invoiceDetailModal .receipt-sheet td.num, #invoiceDetailModal .receipt-sheet th.num { text-align:end; }
      #invoiceDetailModal .receipt-sheet .receipt-totals { margin-top:0.75rem; border-top:2px dashed #999; padding-top:0.5rem; }
      #invoiceDetailModal .receipt-sheet .receipt-totals-row { display:flex; justify-content:space-between; font-size:0.8rem; padding:0.1rem 0; }
      #invoiceDetailModal .receipt-sheet .receipt-totals-row.total { font-size:1rem; font-weight:800; border-top:1px solid #999; margin-top:0.3rem; padding-top:0.3rem; }
      #invoiceDetailModal .receipt-sheet .receipt-foot { text-align:center; margin-top:0.75rem; font-size:0.78rem; color:#444; border-top:2px dashed #999; padding-top:0.5rem; }
      #invoiceDetailModal .receipt-sheet .receipt-words { font-style:italic; font-size:0.74rem; color:#333; margin-top:0.4rem; }
      /* Print-only rules — applied when <body> has the printing-receipt
         class (same pattern as sales.js printReceipt()). */
      @media print {
        body.printing-receipt #pageContent,
        body.printing-receipt .topbar,
        body.printing-receipt .sidebar,
        body.printing-receipt .main-nav,
        body.printing-receipt footer,
        body.printing-receipt .brand-footer { display:none !important; }
        body.printing-receipt * { visibility: hidden; }
        body.printing-receipt #invoiceDetailModal,
        body.printing-receipt #invoiceDetailModal * { visibility: visible; }
        body.printing-receipt #invoiceDetailModal { position:static !important; background:#fff !important; padding:0 !important; display:block !important; }
        body.printing-receipt #invoiceDetailModal .modal { box-shadow:none !important; max-width:none !important; width:100% !important; margin:0 !important; }
        body.printing-receipt #invoiceDetailModal .modal-header,
        body.printing-receipt #invoiceDetailModal .modal-footer { display:none !important; }
        body.printing-receipt #invoiceDetailModal .modal-body { padding:0 !important; background:#fff !important; }
        body.printing-receipt #invoiceDetailModal .receipt-sheet { width:100% !important; max-width:none !important; padding:0 !important; border:none !important; }
      }
    </style>
    <div class="modal-overlay" id="invoiceDetailModal" role="dialog" aria-modal="true" aria-labelledby="invoiceDetailTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="invoiceDetailTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>${t('invoiceDetail', 'Invoice detail')} — ${escapeHtml(invoiceNo)}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" style="padding:1rem;background:var(--bg-body);">
          <div id="receiptPrintArea">
            <div class="receipt-sheet">
              <div class="receipt-head" style="text-align:center;">
                <div class="receipt-store" style="font-size:1.6rem;font-weight:800;color:${pc};">${escapeHtml(settings.storeName || 'DZ POS PRO')}</div>
                <div class="receipt-contact" style="margin-top:0.3rem;font-size:0.8rem;color:#444;line-height:1.6;">
                  ${company.address ? `<div>${escapeHtml(company.address)}</div>` : ''}
                  ${company.phone ? `<div>Tel: ${escapeHtml(company.phone)}</div>` : ''}
                  ${company.whatsapp ? `<div>WhatsApp: ${escapeHtml(company.whatsapp)}</div>` : ''}
                  ${company.email ? `<div>${escapeHtml(company.email)}</div>` : ''}
                </div>
                ${(company.rc || company.nif || company.nis || company.art) ? `
                  <div class="receipt-fiscal" style="margin-top:0.4rem;font-size:0.72rem;font-weight:600;color:#444;">
                    ${company.rc ? `<div>RC: ${escapeHtml(company.rc)}</div>` : ''}
                    ${company.nif ? `<div>NIF: ${escapeHtml(company.nif)}</div>` : ''}
                    ${company.nis ? `<div>NIS: ${escapeHtml(company.nis)}</div>` : ''}
                    ${company.art ? `<div>ART: ${escapeHtml(company.art)}</div>` : ''}
                  </div>` : ''}
                ${headerText}
              </div>
              <hr style="border:none;border-top:2px solid ${pc};margin:0.6rem 0;" />
              <div class="receipt-meta">
                <div><strong>FACTURE</strong></div>
                <div><strong>${t('invoiceNumber', 'Invoice number')}:</strong> ${escapeHtml(invoiceNo)}</div>
                <div><strong>${t('date', 'Date')}:</strong> ${escapeHtml(saleDate)}</div>
              </div>
              <div class="receipt-meta">
                <div><strong>${t('customer', 'Customer')}:</strong> ${escapeHtml(customerNameStr)}</div>
                <div><strong>${t('paymentMethod', 'Payment')}:</strong> ${escapeHtml(payLabel)}</div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>${t('product', 'Product')}</th>
                    <th>${t('unit', 'Unité')}</th>
                    <th class="num">${t('quantity', 'Qté')}</th>
                    <th class="num">P Unitaire H.T</th>
                    <th class="num">Montant H.T</th>
                  </tr>
                </thead>
                <tbody>${itemsRows || `<tr><td colspan="6" style="text-align:center;">${t('noData', 'No data')}</td></tr>`}</tbody>
              </table>
              <div class="receipt-totals">
                <div class="receipt-totals-row"><span>Total H.T</span><span>${subtotal.toFixed(2)} ${currency}</span></div>
                ${itemDiscounts > 0 ? `<div class="receipt-totals-row"><span>${t('perItemDiscount', 'Item discounts')}</span><span>−${itemDiscounts.toFixed(2)} ${currency}</span></div>` : ''}
                ${cartDiscount > 0 ? `<div class="receipt-totals-row"><span>${t('discount', 'Cart discount')}</span><span>−${cartDiscount.toFixed(2)} ${currency}</span></div>` : ''}
                ${couponDiscount > 0 ? `<div class="receipt-totals-row"><span>${t('couponDiscount', 'Coupon')}</span><span>−${couponDiscount.toFixed(2)} ${currency}</span></div>` : ''}
                ${tax > 0 ? `<div class="receipt-totals-row"><span>TVA (${taxRate} %)</span><span>${tax.toFixed(2)} ${currency}</span></div>` : ''}
                ${timbre > 0 ? `<div class="receipt-totals-row"><span>${t('timbre', 'Timbre')}</span><span>${timbre.toFixed(2)} ${currency}</span></div>` : ''}
                <div class="receipt-totals-row total"><span>TOTAL T.T.C</span><span>${total.toFixed(2)} ${currency}</span></div>
                ${totalWords ? `<div class="receipt-words">Arrêté la présente facture à la somme de : ${escapeHtml(totalWords)}.</div>` : ''}
                ${customText ? `<div class="receipt-custom-text" style="margin-top:0.5rem;font-size:0.78rem;color:#111;white-space:pre-wrap;">${escapeHtml(customText)}</div>` : ''}
              </div>
              <div class="receipt-foot">
                ${escapeHtml(settings.invoiceFooter || t('thanks', 'Thank you for your trust'))}
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-danger btn-sm" type="button" id="invoiceDeleteBtn"
                  ${sale.status === 'returned' ? 'disabled title="' + t('saleCannotCancel', 'Cannot delete a returned sale') + '"' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>${sale.status === 'cancelled' ? t('saleAlreadyCancelled', 'Already cancelled') : t('deleteInvoice', 'Delete invoice')}</span>
          </button>
          <div style="flex:1;"></div>
          <button class="btn btn-ghost" type="button" data-action="cancel">${t('close', 'Close')}</button>
          <button class="btn btn-secondary btn-sm" type="button" id="invoicePrintBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            <span>${t('print', 'Print')}</span>
          </button>
          <button class="btn btn-primary btn-sm" type="button" id="invoiceDownloadBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>${t('downloadPdf', 'Download PDF')}</span>
          </button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('invoiceDetailModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#invoiceDownloadBtn').addEventListener('click', () => downloadInvoicePdf(sale));
  overlay.querySelector('#invoicePrintBtn').addEventListener('click', () => printInvoice(sale));

  // Delete invoice (actually cancels — backend restores stock + audit-trails it).
  const delBtn = overlay.querySelector('#invoiceDeleteBtn');
  if (delBtn && sale.status !== 'returned' && sale.status !== 'cancelled') {
    delBtn.addEventListener('click', async () => {
      const ok = await (window.Toast && window.Toast.confirm
        ? window.Toast.confirm(t('deleteInvoiceConfirm', 'Delete this invoice? Stock will be restored to its previous level.'))
        : Promise.resolve(window.confirm(t('deleteInvoiceConfirm', 'Delete this invoice?'))));
      if (!ok) return;
      try {
        const r = await apiFetch.delete('/api/sales/' + sale._id);
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('invoiceDeleted', 'Invoice deleted'));
          close();
          await fetchInvoices();
          render();
          // Broadcast sale completion so other pages refresh too.
          try { window.dispatchEvent(new CustomEvent('sale:completed', { detail: { saleId: sale._id, deleted: true } })); } catch (_) {}
        } else {
          throw new Error((r && r.message) || 'Failed');
        }
      } catch (e) {
        if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
      }
    });
  }

  const escHandler = (e) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
}

/* ---------- PDF generation ---------- */
async function downloadInvoicePdf(sale) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (window.Toast) window.Toast.error(t('pdfLibMissing', 'PDF library not loaded'));
      return;
    }
    // Ensure settings + full sale detail are available (parity with sales.js
    // generateInvoicePDF which expects state.settings and full sale.items).
    if (!state.settings) await fetchSettings();
    if (sale && sale._id && (!sale.items || !sale.items.length)) {
      try {
        const r = await apiFetch.get('/api/sales/' + sale._id);
        if (r && r.success) {
          if (r.data && r.data.sale) sale = r.data.sale;
          else if (r.sale) sale = r.sale;
          else if (r.data) sale = r.data;
        }
      } catch (_) {}
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth  = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    let y = margin;
    const store    = state.settings || {};
    const company  = store.companyInfo || {};
    const currency = store.currency || 'DZD';
    const taxRate  = Number(store.taxRate || 0);
    const [prR, prG, prB] = hexToRgb(primaryColor());
    const saleDate = fmtDateShort(sale.saleDate || sale.createdAt);
    // Walk-in customer → "Particulier" (same as sales.js)
    const rawCustomerName = resolveCustomerName(sale.customer, '');
    const customerNameStr = rawCustomerName && rawCustomerName !== t('noCustomer', 'Walk-in customer') && rawCustomerName !== 'Walk-in customer'
      ? rawCustomerName : 'Particulier';
    const items = (sale.items || []).map(it => itemDisplay(it));
    const subtotal   = Number(sale.subtotal) || 0;
    const cartDiscount = Number(sale.discount) || 0;
    const couponDiscount = Number(sale.couponDiscount) || 0;
    const itemDiscounts = items.reduce((s, it) => s + (Number(it.discount) || 0), 0);
    const tax        = Number(sale.tax) || 0;
    const timbre     = Number(sale.timbre) || 0;
    const total      = Number(sale.total) || 0;
    const totalWords = num2frenchwords(total);
    const payMethod  = sale.paymentMethod || 'cash';
    const payLabel   = paymentLabel(payMethod);
    const invoiceNo  = sale.saleNumber || String(sale._id || '').slice(-6);
    const rightX     = pageWidth - margin;
    const centerX    = pageWidth / 2;

    // ===== HEADER: store name large, centered, primary color =====
    doc.setFontSize(26);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(prR, prG, prB);
    doc.text(store.storeName || 'DZ POS PRO', centerX, y + 8, { align: 'center' });
    y += 14;

    // Contact info (centered, each on its own line)
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(70, 70, 70);
    if (company.address)  { doc.text(company.address, centerX, y, { align: 'center' }); y += 4.5; }
    if (company.phone)    { doc.text('Tel: ' + company.phone, centerX, y, { align: 'center' }); y += 4.5; }
    if (company.whatsapp) { doc.text('WhatsApp: ' + company.whatsapp, centerX, y, { align: 'center' }); y += 4.5; }
    if (company.email)    { doc.text(company.email, centerX, y, { align: 'center' }); y += 4.5; }

    // Fiscal info (centered, each on its own line)
    if (company.rc || company.nif || company.nis || company.art) {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(50, 50, 50);
      const fiscalLines = [];
      if (company.rc)  fiscalLines.push('RC: ' + company.rc);
      if (company.nif) fiscalLines.push('NIF: ' + company.nif);
      if (company.nis) fiscalLines.push('NIS: ' + company.nis);
      if (company.art) fiscalLines.push('ART: ' + company.art);
      fiscalLines.forEach(line => {
        doc.text(line, centerX, y, { align: 'center' });
        y += 4.5;
      });
      y += 2;
    }

    // ✅ النص الترويسي في PDF
    const headerText = (store.invoiceHeader || '').trim();
    if (headerText) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      const splitHeader = doc.splitTextToSize(headerText, pageWidth - 2 * margin);
      splitHeader.forEach(line => {
        doc.text(line, centerX, y, { align: 'center' });
        y += 5;
      });
      y += 2;
    }

    // ===== Separator line (primary color) =====
    doc.setDrawColor(prR, prG, prB);
    doc.setLineWidth(0.6);
    doc.line(margin, y, rightX, y);
    y += 6;

    // ===== Invoice meta (two columns) =====
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text('FACTURE', margin, y);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(t('invoiceNumber', 'Invoice number') + ': ' + invoiceNo, rightX, y, { align: 'right' });
    y += 5;
    doc.text(t('date', 'Date') + ': ' + saleDate, rightX, y, { align: 'right' });
    y += 6;

    // ===== Customer + Payment (side-by-side with a small gap — NOT opposite ends) =====
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text(t('customer', 'Customer') + ':', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(customerNameStr, margin + 26, y);
    doc.setFont('helvetica', 'bold');
    doc.text(t('paymentMethod', 'Payment') + ':', rightX - 60, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(payLabel, rightX, y, { align: 'right' });
    y += 7;

    // ===== Items table =====
    const head = [[
      '#',
      t('product', 'Product'),
      t('unit', 'Unité'),
      t('quantity', 'Qté'),
      'P Unitaire H.T',
      'Montant H.T'
    ]];
    const body = items.map((it, i) => [
      String(i + 1),
      String(it.name),
      it.unit || '—',
      String(it.qty),
      it.price.toFixed(2) + ' ' + currency,
      it.total.toFixed(2) + ' ' + currency
    ]);

    if (typeof doc.autoTable === 'function') {
      doc.autoTable({
        startY: y,
        head,
        body,
        theme: 'grid',
        headStyles: { fillColor: [prR, prG, prB], textColor: [255, 255, 255], fontSize: 8.5, halign: 'center', fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, halign: 'center', textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 'auto', halign: 'left' },
          2: { cellWidth: 22, halign: 'center' },
          3: { cellWidth: 22, halign: 'center' },
          4: { cellWidth: 30, halign: 'right' },
          5: { cellWidth: 30, halign: 'right' }
        },
        margin: { left: margin, right: margin }
      });
      y = doc.lastAutoTable.finalY + 12;
    } else {
      // Fallback simple table when autoTable plugin is not loaded
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(head[0].join('   |   '), margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      body.forEach(r => { doc.text(r.join('   |   '), margin, y); y += 5; });
      y += 4;
    }

    // ===== Totals (right-aligned block) =====
    const labelX = pageWidth - margin - 75;
    const valueX = pageWidth - margin;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text('Total H.T :', labelX, y);
    doc.text(subtotal.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    if (itemDiscounts > 0) {
      doc.text(t('perItemDiscount', 'Item discounts') + ' :', labelX, y);
      doc.text('−' + itemDiscounts.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    if (cartDiscount > 0) {
      doc.text(t('discount', 'Cart discount') + ' :', labelX, y);
      doc.text('−' + cartDiscount.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    if (couponDiscount > 0) {
      doc.text(t('couponDiscount', 'Coupon') + ' :', labelX, y);
      doc.text('−' + couponDiscount.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    if (tax > 0) {
      doc.text('TVA (' + taxRate + ' %) :', labelX, y);
      doc.text(tax.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    if (timbre > 0) {
      doc.text(t('timbre', 'Timbre') + ' :', labelX, y);
      doc.text(timbre.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    y += 4;
    doc.setDrawColor(prR, prG, prB);
    doc.setLineWidth(0.4);
    doc.line(labelX, y - 2, valueX, y - 2);
    y += 5;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(prR, prG, prB);
    doc.text('TOTAL T.T.C :', labelX, y);
    doc.text(total.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 10;

    // ===== Total in words (French legal requirement) =====
    if (totalWords) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(70, 70, 70);
      const wordsLabel = 'Arrêté la présente facture à la somme de :';
      const fullText = wordsLabel + ' ' + totalWords + '.';
      const splitText = doc.splitTextToSize(fullText, pageWidth - 2 * margin);
      splitText.forEach(line => {
        doc.text(line, margin, y);
        y += 5;
      });
    }

    // ===== Custom invoice text (from settings) =====
    const customText = (store.invoiceCustomText || '').trim();
    if (customText) {
      y += 2;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 30, 30);
      const splitCustom = doc.splitTextToSize(customText, pageWidth - 2 * margin);
      splitCustom.forEach(line => {
        doc.text(line, margin, y);
        y += 5;
      });
    }

    // ===== Footer =====
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140, 140, 140);
    const footer = store.invoiceFooter || t('thanks', 'Thank you for your trust');
    doc.text(footer, centerX, pageHeight - 10, { align: 'center' });

    doc.save('invoice-' + invoiceNo + '.pdf');
    if (window.Toast) window.Toast.success(t('pdfReady', 'PDF ready'));
  } catch (e) {
    console.error('[invoices] downloadInvoicePdf', e);
    if (window.Toast) window.Toast.error((e && e.message) || t('pdfFailed', 'Failed to generate PDF'));
  }
}

/* ---------- Print (uses the in-modal receipt + window.print) ----------
 * Mirrors sales.js printReceipt(): adds a `printing-receipt` class to
 * <body> so the @media print rules (injected into the modal's <style>
 * block) hide everything except the receipt-sheet, then calls window.print().
 * Requires the #invoiceDetailModal to still be open (which it is when the
 * user clicks the Print button inside the modal). */
function printInvoice(sale) {
  // Defensive: if the modal has already been closed, re-open it so the
  // receipt-sheet DOM is present for the print stylesheet to reveal.
  if (!document.getElementById('invoiceDetailModal')) {
    // Render the modal, then print once it's in the DOM. We re-use the
    // existing fetch logic in viewInvoiceModal.
    viewInvoiceModal(sale).then(() => {
      // Wait a tick for the modal HTML + settings fetch to settle.
      setTimeout(() => triggerReceiptPrint(), 250);
    });
    return;
  }
  triggerReceiptPrint();

  function triggerReceiptPrint() {
    document.body.classList.add('printing-receipt');
    setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        console.warn('[invoices] print failed', e);
        if (window.Toast) window.Toast.error(t('printFailed', 'Print failed'));
      } finally {
        // Remove the class after the print dialog closes so subsequent
        // prints of the page itself aren't affected.
        setTimeout(() => document.body.classList.remove('printing-receipt'), 500);
      }
    }, 100);
  }
}

/* ---------- Entry ---------- */
export async function renderInvoicesPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.search = ''; state.status = ''; state.from = ''; state.to = '';
  content.innerHTML = renderSkeleton();
  await fetchSettings();
  await fetchInvoices();
  render();
}
