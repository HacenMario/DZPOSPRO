/* ============================================================
 * js/modules/coupons.js
 * ------------------------------------------------------------
 * Renders the Coupons management page into #pageContent.
 *
 * Backend contract (verified):
 *   GET /api/coupons?page=&limit=&search=&isActive=
 *     → { success, data:[...], total, page, limit, totalPages }
 *   GET /api/coupons/:id   → { success, data: { coupon } }
 *   POST /api/coupons      body { code, type, value, minOrder,
 *                                 maxDiscount, validFrom, validUntil,
 *                                 usageLimit, description, isActive }
 *   PUT /api/coupons/:id   (same body)
 *   DELETE /api/coupons/:id
 *
 * Coupon shape:
 *   { _id, code, type:'percentage'|'fixed', value, minOrder,
 *     maxDiscount, validFrom, validUntil, usageLimit, usedCount,
 *     isActive, description:{ar,en,fr}, createdAt }
 *
 * Features:
 *   • Toolbar: search by code (debounced), status filter,
 *     refresh, "Add coupon"
 *   • Server-side paginated table
 *   • Type badge: percentage=info, fixed=success
 *   • Value formatted: "20%" for percentage, "500 DZD" for fixed
 *   • Usage column: usedCount / usageLimit (∞ when 0)
 *   • Validity column: validFrom → validUntil + red badge if expired
 *   • Add/Edit modal appended to <body>, removed on close
 *     Validation: code non-empty, value > 0,
 *                  validUntil > validFrom
 *   • Delete via Toast.confirm()
 *   • All text via window.t(); all API calls via window.apiFetch()
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  page: 1,
  limit: 20,
  search: '',
  status: '',     // '' | 'active' | 'inactive'
  pagination: null,
  items: []
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

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return escapeHtml(String(d));
  return dt.toLocaleDateString();
}

function toDatetimeLocal(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) +
         'T' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
}

function fromDatetimeLocal(v) {
  if (!v) return undefined;
  const dt = new Date(v);
  if (isNaN(dt.getTime())) return undefined;
  return dt.toISOString();
}

function isExpired(c) {
  if (!c.validUntil) return false;
  const d = new Date(c.validUntil);
  return !isNaN(d.getTime()) && d.getTime() < Date.now();
}

function fmtValue(c) {
  const v = Number(c.value || 0);
  if (c.type === 'percentage') return v + '%';
  return fmtCurrency(v);
}

function fmtUsage(c) {
  const used = Number(c.usedCount || 0);
  const limit = Number(c.usageLimit || 0);
  if (!limit || limit <= 0) return used + ' / ∞';
  return used + ' / ' + limit;
}

function descriptionText(c) {
  if (!c || !c.description) return '';
  if (typeof c.description === 'string') return c.description;
  const lang = (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';
  return c.description[lang] || c.description.en || c.description.ar || c.description.fr || '';
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title"><span class="page-title-text">${t('coupons', 'Coupons')}</span></h1>
      </div>
      <div class="page-actions"><div class="skeleton" style="height:40px;width:160px;"></div></div>
    </div>
    <div class="toolbar">
      <div class="skeleton" style="height:40px;width:280px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
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
          <svg id="pageTitleIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/><line x1="14" y1="14" x2="20" y2="8"/></svg>
          <span class="page-title-text">${t('coupons', 'Coupons')}</span>
        </h1>
        <div class="page-subtitle">${t('couponsSubtitle', 'Discount codes and promotions')}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary btn-sm" id="couponRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
        <button class="btn btn-primary" id="addCouponBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('addCoupon', 'Add coupon')}</span>
        </button>
      </div>
    </div>
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" id="couponSearch" type="search"
                 placeholder="${escapeHtml(t('searchCoupons', 'Search by code...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <select class="select" id="couponStatusFilter" style="width:auto;">
          <option value="">${t('all', 'All')} — ${t('status', 'Status')}</option>
          <option value="active" ${state.status === 'active' ? 'selected' : ''}>${t('active', 'Active')}</option>
          <option value="inactive" ${state.status === 'inactive' ? 'selected' : ''}>${t('inactive', 'Inactive')}</option>
        </select>
      </div>
    </div>`;
}

/* ---------- Table ---------- */
function renderTable() {
  if (!state.items.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        </div>
        <div class="empty-title">${t('noCouponsMatch', 'No matching coupons')}</div>
        <div class="empty-subtitle">${t('noCoupons', 'No coupons found')}</div>
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="emptyAddCouponBtn" type="button">${t('addCoupon', 'Add coupon')}</button>
        </div>
      </div>`;
  }

  const rows = state.items.map((c, i) => {
    const typeBadge = c.type === 'percentage'
      ? '<span class="badge badge-info">' + t('percent', 'Percent') + '</span>'
      : '<span class="badge badge-success">' + t('fixed', 'Fixed') + '</span>';
    const expired = isExpired(c);
    const statusBadge = expired
      ? '<span class="badge badge-danger">' + t('expired', 'Expired') + '</span>'
      : (c.isActive === false
          ? '<span class="badge badge-muted">' + t('inactive', 'Inactive') + '</span>'
          : '<span class="badge badge-success">' + t('active', 'Active') + '</span>');
    const desc = descriptionText(c);
    const idx = (state.page - 1) * state.limit + i + 1;
    return `
      <tr>
        <td class="cell-muted" data-label="#">${idx}</td>
        <td class="cell-strong" data-label="${t('couponCode', 'Code')}" style="font-family:var(--font-mono, monospace);">${escapeHtml(c.code || '—')}</td>
        <td class="cell-muted" data-label="${t('description', 'Description')}">${escapeHtml(desc || '—')}</td>
        <td data-label="${t('type', 'Type')}">${typeBadge}</td>
        <td class="cell-strong" data-label="${t('couponValue', 'Value')}">${escapeHtml(fmtValue(c))}</td>
        <td data-label="${t('minPurchase', 'Min order')}">${(c.minOrder != null && Number(c.minOrder) > 0) ? escapeHtml(fmtCurrency(c.minOrder)) : '—'}</td>
        <td data-label="${t('usage', 'Usage')}">${escapeHtml(fmtUsage(c))}</td>
        <td class="cell-muted" data-label="${t('validity', 'Validity')}">
          <span dir="ltr">${fmtDate(c.validFrom)} → ${fmtDate(c.validUntil)}</span>
          ${expired ? '<div><span class="badge badge-danger" style="margin-top:2px;">' + t('expired', 'Expired') + '</span></div>' : ''}
        </td>
        <td data-label="${t('status', 'Status')}">${statusBadge}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn edit" data-id="${c._id}" aria-label="${t('edit', 'Edit')}" title="${t('edit', 'Edit')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="table-action-btn delete" data-id="${c._id}" data-name="${escapeHtml(c.code || '')}" aria-label="${t('delete', 'Delete')}" title="${t('delete', 'Delete')}">
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
            <th>${t('couponCode', 'Code')}</th>
            <th>${t('description', 'Description')}</th>
            <th>${t('type', 'Type')}</th>
            <th>${t('couponValue', 'Value')}</th>
            <th>${t('minPurchase', 'Min order')}</th>
            <th>${t('usage', 'Usage')}</th>
            <th>${t('validity', 'Validity')}</th>
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
async function fetchCoupons() {
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  if (state.status === 'active') qs.isActive = 'true';
  if (state.status === 'inactive') qs.isActive = 'false';
  try {
    const r = await apiFetch.get('/api/coupons', qs);
    if (r && r.success) {
      state.items = r.data || r.coupons || [];
      // Normalize pagination
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
    console.error('[coupons] fetch', e);
    state.items = []; state.pagination = null;
  }
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = renderToolbar() + '<div id="couponsTableContainer">' + renderTable() + '</div>';
  bindToolbar();
  bindTable();
}

function bindToolbar() {
  const search = document.getElementById('couponSearch');
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
  const statusSel = document.getElementById('couponStatusFilter');
  if (statusSel) statusSel.addEventListener('change', () => {
    state.status = statusSel.value; state.page = 1; refreshTable();
  });
  const addBtn = document.getElementById('addCouponBtn');
  if (addBtn) addBtn.addEventListener('click', () => openCouponModal(null));
  const emptyAdd = document.getElementById('emptyAddCouponBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openCouponModal(null));
  const refresh = document.getElementById('couponRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => refreshTable());
}

function bindTable() {
  document.querySelectorAll('#couponsTableContainer .table-action-btn.edit').forEach(b => {
    b.addEventListener('click', () => {
      const c = state.items.find(x => x._id === b.dataset.id);
      if (c) openCouponModal(c);
    });
  });
  document.querySelectorAll('#couponsTableContainer .table-action-btn.delete').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const name = b.dataset.name || '—';
      const ok = await (window.Toast && window.Toast.confirm
        ? window.Toast.confirm(t('deleteConfirm', 'Delete "{name}"?').replace('{name}', name))
        : Promise.resolve(true));
      if (!ok) return;
      try {
        const r = await apiFetch.delete('/api/coupons/' + id);
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('couponDeleted', 'Coupon deleted'));
          refreshTable();
        } else {
          throw new Error((r && r.message) || 'Failed');
        }
      } catch (e) {
        if (window.Toast) window.Toast.error((e && e.message) || t('deleteFailed', 'Delete failed'));
      }
    });
  });
  document.querySelectorAll('#couponsTableContainer .page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshTable(); }
    });
  });
}

async function refreshTable() {
  const container = document.getElementById('couponsTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchCoupons();
  if (container) container.innerHTML = renderTable();
  bindTable();
}

/* ---------- Modal ---------- */
function openCouponModal(coupon) {
  const isEdit = !!coupon;
  const nowLocal = toDatetimeLocal(new Date());
  const inSevenDays = toDatetimeLocal(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

  const descText = coupon ? descriptionText(coupon) : '';

  const html = `
    <div class="modal-overlay" id="couponModal" role="dialog" aria-modal="true" aria-labelledby="couponModalTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="couponModalTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/><line x1="14" y1="14" x2="20" y2="8"/></svg>
            <span>${isEdit ? t('editCoupon', 'Edit coupon') : t('addCoupon', 'Add coupon')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="couponForm" novalidate>
          <div class="modal-body">
            <input type="hidden" id="couponId" value="${coupon ? coupon._id || '' : ''}" />

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="couponCode">${t('couponCode', 'Code')} <span class="req">*</span></label>
                <input class="input" id="couponCode" type="text" required maxlength="32"
                       style="text-transform:uppercase;font-family:var(--font-mono, monospace);"
                       value="${coupon && coupon.code ? escapeHtml(coupon.code) : ''}"
                       placeholder="SUMMER20" />
                <div class="help-text">${t('couponCodeHelp', 'Uppercase letters and numbers')}</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="couponType">${t('type', 'Type')} <span class="req">*</span></label>
                <select class="select" id="couponType">
                  <option value="percentage" ${!coupon || coupon.type === 'percentage' ? 'selected' : ''}>${t('percent', 'Percentage')} (%)</option>
                  <option value="fixed"       ${coupon && coupon.type === 'fixed' ? 'selected' : ''}>${t('fixed', 'Fixed')} (${escapeHtml(t('currency', 'DZD'))})</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="couponValue">${t('couponValue', 'Value')} <span class="req">*</span></label>
                <input class="input" id="couponValue" type="number" step="0.01" min="0" required
                       value="${coupon && coupon.value != null ? coupon.value : ''}" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="couponDescription">${t('description', 'Description')}</label>
              <textarea class="textarea" id="couponDescription" rows="2">${escapeHtml(descText)}</textarea>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="couponMinOrder">${t('minPurchase', 'Min order')}</label>
                <input class="input" id="couponMinOrder" type="number" step="0.01" min="0"
                       value="${coupon && coupon.minOrder != null ? coupon.minOrder : 0}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="couponMaxDiscount">${t('maxDiscount', 'Max discount')}</label>
                <input class="input" id="couponMaxDiscount" type="number" step="0.01" min="0"
                       value="${coupon && coupon.maxDiscount != null ? coupon.maxDiscount : 0}" />
                <div class="help-text">${t('percent', 'Percentage')} — ${t('maxDiscount', 'Max discount')}</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="couponUsageLimit">${t('usageLimit', 'Usage limit')}</label>
                <input class="input" id="couponUsageLimit" type="number" step="1" min="0"
                       value="${coupon && coupon.usageLimit != null ? coupon.usageLimit : 0}" />
                <div class="help-text">${t('maxUsesHelp', '0 = unlimited')}</div>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="couponValidFrom">${t('validFrom', 'Valid from')} <span class="req">*</span></label>
                <input class="input" id="couponValidFrom" type="datetime-local" required
                       value="${coupon && coupon.validFrom ? toDatetimeLocal(coupon.validFrom) : nowLocal}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="couponValidUntil">${t('validUntil', 'Valid until')} <span class="req">*</span></label>
                <input class="input" id="couponValidUntil" type="datetime-local" required
                       value="${coupon && coupon.validUntil ? toDatetimeLocal(coupon.validUntil) : inSevenDays}" />
              </div>
            </div>

            <div class="form-group" style="margin-top:0.5rem;">
              <label class="form-label" style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                <input type="checkbox" id="couponIsActive" style="width:18px;height:18px;"
                       ${!coupon || coupon.isActive !== false ? 'checked' : ''} />
                <span>${t('active', 'Active')}</span>
              </label>
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
  const overlay = document.getElementById('couponModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Auto-uppercase code field
  const codeInput = overlay.querySelector('#couponCode');
  if (codeInput) {
    codeInput.addEventListener('input', () => {
      const pos = codeInput.selectionStart;
      codeInput.value = codeInput.value.toUpperCase();
      try { codeInput.setSelectionRange(pos, pos); } catch (_) {}
    });
  }

  overlay.querySelector('#couponForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = overlay.querySelector('#couponId').value;
    const code = overlay.querySelector('#couponCode').value.trim();
    const type = overlay.querySelector('#couponType').value;
    const value = parseFloat(overlay.querySelector('#couponValue').value);
    const minOrder = parseFloat(overlay.querySelector('#couponMinOrder').value) || 0;
    const maxDiscount = parseFloat(overlay.querySelector('#couponMaxDiscount').value) || 0;
    const usageLimit = parseInt(overlay.querySelector('#couponUsageLimit').value, 10) || 0;
    const validFromRaw = overlay.querySelector('#couponValidFrom').value;
    const validUntilRaw = overlay.querySelector('#couponValidUntil').value;
    const isActive = overlay.querySelector('#couponIsActive').checked;
    const description = overlay.querySelector('#couponDescription').value.trim();

    // Validation
    if (!code) {
      if (window.Toast) window.Toast.error(t('couponCodeRequired', 'Code is required'));
      if (codeInput) codeInput.focus();
      return;
    }
    if (!isFinite(value) || value <= 0) {
      if (window.Toast) window.Toast.error(t('couponValueInvalid', 'Value must be greater than 0'));
      return;
    }
    if (type === 'percentage' && value > 100) {
      if (window.Toast) window.Toast.error(t('couponPercentMax', 'Percent value cannot exceed 100'));
      return;
    }
    const validFrom = fromDatetimeLocal(validFromRaw);
    const validUntil = fromDatetimeLocal(validUntilRaw);
    if (!validFrom || !validUntil) {
      if (window.Toast) window.Toast.error(t('couponCodeRequired', 'Required'));
      return;
    }
    if (new Date(validFrom) >= new Date(validUntil)) {
      if (window.Toast) window.Toast.error(t('validityRangeInvalid', '"Valid until" must be after "Valid from"'));
      return;
    }

    // Description is a single input — store in all 3 locales (per brief)
    const body = {
      code,
      type,
      value,
      minOrder,
      maxDiscount,
      validFrom,
      validUntil,
      usageLimit,
      isActive,
      description: { ar: description, en: description, fr: description }
    };

    try {
      const url = id ? '/api/coupons/' + id : '/api/coupons';
      const r = id ? await apiFetch.put(url, body) : await apiFetch.post(url, body);
      if (r && r.success) {
        if (window.Toast) window.Toast.success(id ? t('couponUpdated', 'Coupon updated') : t('couponCreated', 'Coupon created'));
        close();
        await refreshTable();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/exists|موجود|existe|duplicate|already/i.test(msg)) {
        if (window.Toast) window.Toast.error(t('couponCodeExists', 'Coupon code already exists'));
      } else {
        if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
      }
    }
  });

  setTimeout(() => { if (codeInput) codeInput.focus(); }, 50);
}

/* ---------- Entry ---------- */
export async function renderCouponsPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.search = ''; state.status = '';
  content.innerHTML = renderSkeleton();
  await fetchCoupons();
  render();
}
