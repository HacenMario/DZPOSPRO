/* ============================================================
 * js/modules/customers.js
 * ------------------------------------------------------------
 * Renders the Customers page into #pageContent.
 *
 * Features:
 *   • Page header: title + subtitle + "Add customer" action
 *   • Toolbar: debounced search box, status filter, refresh
 *   • Server-side paginated table with name, phone, email,
 *     address, loyalty points badge, total spent (currency),
 *     status badge, row actions (edit / delete / view)
 *   • Add/Edit modal appended to <body> with collapsible
 *     "Fiscal information" section (rc / nif / nis / art)
 *   • Client-side validation: name & phone required
 *   • Delete via Toast.confirm() — backend enforces "has sales"
 *     (HTTP 400) which we surface as a Toast.error
 *   • Row click → customer detail modal with sales history
 *     (GET /api/sales?customer=:id)
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
  status: '',        // 'active' | 'inactive' | ''
  pagination: null,
  items: []
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Customer name may be a multilingual object {ar,en,fr} or a plain string.
// The backend decorate() also adds displayName.
function custName(c) {
  if (!c) return '—';
  if (c.displayName) return c.displayName;
  if (typeof c.name === 'string') return c.name;
  if (c.name && typeof c.name === 'object') return c.name.ar || c.name.en || c.name.fr || '—';
  return '—';
}

// Customer address may be a multilingual object {ar,en,fr} or a plain string.
function custAddress(c) {
  if (!c) return '';
  if (c.displayAddress) return c.displayAddress;
  if (typeof c.address === 'string') return c.address;
  if (c.address && typeof c.address === 'object') return c.address.ar || c.address.en || c.address.fr || '';
  return '';
}

function fmtCurrency(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + t('currency', 'DZD');
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString();
  } catch (_) { return '—'; }
}

function statusBadge(c) {
  if (c.status === 'inactive' || c.isActive === false) {
    return '<span class="badge badge-muted">' + t('inactive', 'Inactive') + '</span>';
  }
  return '<span class="badge badge-success">' + t('active', 'Active') + '</span>';
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">${t('customers', 'Customers')}</div>
        <div class="page-subtitle">${t('customersPageSubtitle', 'Manage your customer directory, loyalty points and history')}</div>
      </div>
    </div>
    <div class="toolbar">
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
          <input class="input" id="customerSearch" type="search"
                 placeholder="${escapeHtml(t('searchCustomers', 'Search customers by name, phone or email...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <select class="select" id="customerStatusFilter" style="width:auto;">
          <option value="">${t('all', 'All')} — ${t('status', 'Status')}</option>
          <option value="active" ${state.status === 'active' ? 'selected' : ''}>${t('active', 'Active')}</option>
          <option value="inactive" ${state.status === 'inactive' ? 'selected' : ''}>${t('inactive', 'Inactive')}</option>
        </select>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="customerRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
        <button class="btn btn-primary" id="addCustomerBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('addCustomer', 'Add customer')}</span>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="empty-title">${t('noCustomersMatch', 'No matching customers')}</div>
        <div class="empty-subtitle">${t('noCustomers', 'No customers found')}</div>
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="emptyAddCustBtn" type="button">${t('addCustomer', 'Add customer')}</button>
        </div>
      </div>`;
  }

  const rows = state.items.map((c, i) => {
    const idx = (state.page - 1) * state.limit + i + 1;
    const phone = c.phone ? escapeHtml(c.phone) : '—';
    const email = c.email ? escapeHtml(c.email) : '—';
    const address = custAddress(c) || '—';
    const loyalty = (typeof c.loyaltyPoints === 'number') ? c.loyaltyPoints : 0;
    const loyaltyBadge = loyalty > 0
      ? '<span class="badge badge-info">' + loyalty + '</span>'
      : '<span class="badge badge-muted">0</span>';
    const totalSpent = fmtCurrency(c.totalSpent);
    return `
      <tr data-id="${c._id}" style="cursor:pointer;">
        <td class="cell-muted" data-label="#">${idx}</td>
        <td class="cell-strong" data-label="${t('name', 'Name')}">${escapeHtml(custName(c))}</td>
        <td data-label="${t('phone', 'Phone')}">${phone}</td>
        <td data-label="${t('emailAddress', 'Email')}">${email}</td>
        <td class="cell-muted" data-label="${t('address', 'Address')}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(custAddress(c))}">${escapeHtml(address)}</td>
        <td data-label="${t('loyaltyPoints', 'Loyalty')}">${loyaltyBadge}</td>
        <td class="cell-strong" data-label="${t('totalSpent', 'Total spent')}">${totalSpent}</td>
        <td data-label="${t('status', 'Status')}">${statusBadge(c)}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn view" data-id="${c._id}" aria-label="${t('view', 'View')}" title="${t('view', 'View')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="table-action-btn edit" data-id="${c._id}" aria-label="${t('edit', 'Edit')}" title="${t('edit', 'Edit')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="table-action-btn delete" data-id="${c._id}" data-name="${escapeHtml(custName(c))}" aria-label="${t('delete', 'Delete')}" title="${t('delete', 'Delete')}">
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
            <th>${t('name', 'Name')}</th>
            <th>${t('phone', 'Phone')}</th>
            <th>${t('emailAddress', 'Email')}</th>
            <th>${t('address', 'Address')}</th>
            <th>${t('loyaltyPoints', 'Loyalty')}</th>
            <th>${t('totalSpent', 'Total spent')}</th>
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
async function fetchCustomers() {
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  if (state.status) qs.status = state.status;
  try {
    const r = await apiFetch.get('/api/customers', qs);
    if (r && r.success) {
      state.items = r.data || r.customers || [];
      state.pagination = {
        page: r.page || state.page,
        pages: r.totalPages || 1,
        total: r.total || state.items.length,
        limit: r.limit || state.limit
      };
    } else { state.items = []; state.pagination = null; }
  } catch (e) {
    console.error('[customers] fetch', e);
    state.items = []; state.pagination = null;
  }
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const header = `
    <div class="page-header">
      <div>
        <div class="page-title">${t('customers', 'Customers')}</div>
        <div class="page-subtitle">${t('customersPageSubtitle', 'Manage your customer directory, loyalty points and history')}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="addCustomerBtnHeader" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('addCustomer', 'Add customer')}</span>
        </button>
      </div>
    </div>`;
  content.innerHTML = header + renderToolbar() + '<div id="customersTableContainer">' + renderTable() + '</div>';
  bindToolbar();
  bindTable();
}

function bindToolbar() {
  const search = document.getElementById('customerSearch');
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
  const st = document.getElementById('customerStatusFilter');
  if (st) st.addEventListener('change', () => {
    state.status = st.value; state.page = 1; refreshTable();
  });
  const addBtn = document.getElementById('addCustomerBtn');
  if (addBtn) addBtn.addEventListener('click', () => openCustomerModal(null));
  const addBtnHeader = document.getElementById('addCustomerBtnHeader');
  if (addBtnHeader) addBtnHeader.addEventListener('click', () => openCustomerModal(null));
  const refresh = document.getElementById('customerRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => refreshTable());
}

function bindTable() {
  const container = document.getElementById('customersTableContainer');
  if (!container) return;

  // Bound here (not bindToolbar) so the empty-state button survives every table refresh
  const emptyAdd = document.getElementById('emptyAddCustBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openCustomerModal(null));

  container.querySelectorAll('.table-action-btn.edit').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = state.items.find(x => x._id === b.dataset.id);
      if (c) openCustomerModal(c);
    });
  });
  container.querySelectorAll('.table-action-btn.delete').forEach(b => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.dataset.id;
      const name = b.dataset.name || '—';
      const ok = await (window.Toast && window.Toast.confirm
        ? window.Toast.confirm(t('deleteConfirm', 'Delete "{name}"?').replace('{name}', name))
        : Promise.resolve(true));
      if (!ok) return;
      try {
        const r = await apiFetch.delete('/api/customers/' + id);
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('customerDeleted', 'Customer deleted'));
          refreshTable();
        } else {
          throw new Error((r && r.message) || 'Failed');
        }
      } catch (err) {
        const msg = (err && err.message) || '';
        // Backend returns 400 when the customer has sales
        if (err && err.status === 400) {
          if (window.Toast) window.Toast.error(msg || t('customerHasSales', 'Cannot delete a customer with sales history'));
        } else if (/sales|مبيعات|ventes/i.test(msg)) {
          if (window.Toast) window.Toast.error(t('customerHasSales', 'Cannot delete a customer with sales history'));
        } else {
          if (window.Toast) window.Toast.error(msg || t('deleteFailed', 'Delete failed'));
        }
      }
    });
  });
  container.querySelectorAll('.table-action-btn.view').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = state.items.find(x => x._id === b.dataset.id);
      if (c) viewCustomerDetail(c);
    });
  });
  // Row click → detail
  container.querySelectorAll('tbody tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const c = state.items.find(x => x._id === tr.dataset.id);
      if (c) viewCustomerDetail(c);
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
  const container = document.getElementById('customersTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchCustomers();
  if (container) container.innerHTML = renderTable();
  bindTable();
}

/* ---------- Modal: Add / Edit customer ---------- */
function openCustomerModal(customer) {
  const isEdit = !!customer;

  const html = `
    <div class="modal-overlay" id="customerModal" role="dialog" aria-modal="true" aria-labelledby="customerModalTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="customerModalTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>${isEdit ? t('editCustomer', 'Edit customer') : t('addCustomer', 'Add customer')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="customerForm" novalidate>
          <div class="modal-body">
            <input type="hidden" id="customerId" value="${customer ? customer._id || '' : ''}" />

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="custName">${t('name', 'Name')} <span class="req">*</span></label>
                <input class="input" id="custName" name="name" type="text" required
                       value="${customer && customer.name ? escapeHtml(typeof customer.name === 'string' ? customer.name : (customer.name.ar || customer.name.en || customer.name.fr || '')) : ''}"
                       placeholder="${escapeHtml(t('customerNamePlaceholder', 'Customer full name'))}" />
                <div class="invalid-feedback" id="custNameErr" style="display:none;">${t('nameRequired', 'Name is required')}</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="custPhone">${t('phone', 'Phone')} <span class="req">*</span></label>
                <input class="input" id="custPhone" type="tel" required
                       value="${customer && customer.phone ? escapeHtml(customer.phone) : ''}"
                       placeholder="${escapeHtml(t('phonePlaceholder', 'e.g. 0555 12 34 56'))}" />
                <div class="invalid-feedback" id="custPhoneErr" style="display:none;">${t('phoneRequired', 'Phone is required')}</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="custEmail">${t('emailAddress', 'Email')}</label>
                <input class="input" id="custEmail" type="email"
                       value="${customer && customer.email ? escapeHtml(customer.email) : ''}"
                       placeholder="client@example.com" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="custAddress">${t('address', 'Address')}</label>
              <textarea class="textarea" id="custAddress" name="address" rows="2" placeholder="${escapeHtml(t('addressPlaceholder', 'Street, city, province'))}">${customer && customer.address ? escapeHtml(typeof customer.address === 'string' ? customer.address : (customer.address.ar || customer.address.en || customer.address.fr || '')) : ''}</textarea>
            </div>

            <div class="divider" style="margin:1rem 0;"></div>

            <div class="form-group" style="margin-bottom:0.5rem;">
              <div style="font-weight:600;display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <span>${t('fiscalInformation', 'Fiscal information')}</span>
              </div>
              <div class="form-row" style="margin-top:0.5rem;">
                <div class="form-group">
                  <label class="form-label" for="custRc">RC</label>
                  <input class="input" id="custRc" type="text" value="${customer && customer.rc ? escapeHtml(customer.rc) : ''}" placeholder="Registre de commerce" />
                </div>
                <div class="form-group">
                  <label class="form-label" for="custNif">NIF</label>
                  <input class="input" id="custNif" type="text" value="${customer && customer.nif ? escapeHtml(customer.nif) : ''}" placeholder="Numéro d'identification fiscale" />
                </div>
                <div class="form-group">
                  <label class="form-label" for="custNis">NIS</label>
                  <input class="input" id="custNis" type="text" value="${customer && customer.nis ? escapeHtml(customer.nis) : ''}" placeholder="Numéro d'identification statistique" />
                </div>
                <div class="form-group">
                  <label class="form-label" for="custArt">ART</label>
                  <input class="input" id="custArt" type="text" value="${customer && customer.art ? escapeHtml(customer.art) : ''}" placeholder="Article d'imposition" />
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="custNotes">${t('notes', 'Notes')}</label>
              <textarea class="textarea" id="custNotes" rows="2" placeholder="${escapeHtml(t('notesPlaceholder', 'Optional internal notes about this customer'))}">${customer && customer.notes ? escapeHtml(customer.notes) : ''}</textarea>
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
  const overlay = document.getElementById('customerModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Esc closes topmost modal
  const escHandler = (e) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  overlay.querySelector('#customerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameEl = overlay.querySelector('#custName');
    const phoneEl = overlay.querySelector('#custPhone');
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();

    let valid = true;
    const nameErr = overlay.querySelector('#custNameErr');
    const phoneErr = overlay.querySelector('#custPhoneErr');
    nameErr.style.display = name ? 'none' : 'block';
    phoneErr.style.display = phone ? 'none' : 'block';
    if (!name) { nameEl.focus(); valid = false; }
    if (!phone) { if (!name) {} else phoneEl.focus(); valid = false; }
    if (!valid) {
      if (window.Toast) window.Toast.warning(t('checkFormFields', 'Please check the form fields'));
      return;
    }

    const addressValue = overlay.querySelector('#custAddress').value.trim();
    const body = {
      name,
      phone,
      email: overlay.querySelector('#custEmail').value.trim(),
      address: addressValue,
      rc: overlay.querySelector('#custRc').value.trim(),
      nif: overlay.querySelector('#custNif').value.trim(),
      nis: overlay.querySelector('#custNis').value.trim(),
      art: overlay.querySelector('#custArt').value.trim(),
      notes: overlay.querySelector('#custNotes').value.trim()
    };

    try {
      const id = overlay.querySelector('#customerId').value;
      const url = id ? '/api/customers/' + id : '/api/customers';
      const r = id ? await apiFetch.put(url, body) : await apiFetch.post(url, body);
      if (r && r.success) {
        if (window.Toast) window.Toast.success(id ? t('customerUpdated', 'Customer updated') : t('customerCreated', 'Customer created'));
        close();
        await refreshTable();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/exists|موجود|existe|already/i.test(msg)) {
        if (window.Toast) window.Toast.error(t('customerNameExists', 'A customer with this name or phone already exists'));
      } else {
        if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
      }
    }
  });

  setTimeout(() => { const first = overlay.querySelector('#custName'); if (first) first.focus(); }, 50);
}

/* ---------- Modal: Customer detail + sales history ---------- */
async function viewCustomerDetail(customer) {
  // Build a basic shell first, then fetch sales history
  const html = `
    <div class="modal-overlay" id="customerDetailModal" role="dialog" aria-modal="true" aria-labelledby="customerDetailTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="customerDetailTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>${escapeHtml(custName(customer))}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="grid grid-3" style="margin-bottom:1rem;">
            <div class="card" style="box-shadow:none;border:1px solid var(--border-color);">
              <div class="card-body" style="padding:0.85rem;">
                <div class="cell-muted" style="font-size:0.8rem;">${t('phone', 'Phone')}</div>
                <div class="cell-strong">${escapeHtml(customer.phone || '—')}</div>
              </div>
            </div>
            <div class="card" style="box-shadow:none;border:1px solid var(--border-color);">
              <div class="card-body" style="padding:0.85rem;">
                <div class="cell-muted" style="font-size:0.8rem;">${t('emailAddress', 'Email')}</div>
                <div class="cell-strong" style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(customer.email || '—')}</div>
              </div>
            </div>
            <div class="card" style="box-shadow:none;border:1px solid var(--border-color);">
              <div class="card-body" style="padding:0.85rem;">
                <div class="cell-muted" style="font-size:0.8rem;">${t('address', 'Address')}</div>
                <div class="cell-strong" style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(custAddress(customer) || '—')}</div>
              </div>
            </div>
          </div>

          <div class="grid grid-4" style="margin-bottom:1rem;">
            <div class="stat-card">
              <div class="stat-icon cyan" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              </div>
              <div>
                <div class="stat-value">${(typeof customer.loyaltyPoints === 'number') ? customer.loyaltyPoints : 0}</div>
                <div class="stat-label">${t('loyaltyPoints', 'Loyalty points')}</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon green" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <div>
                <div class="stat-value">${fmtCurrency(customer.totalSpent)}</div>
                <div class="stat-label">${t('totalSpent', 'Total spent')}</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon amber" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
              </div>
              <div>
                <div class="stat-value">${escapeHtml(customer.rc || '—')}</div>
                <div class="stat-label">RC</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon red" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
              </div>
              <div>
                <div class="stat-value">${escapeHtml(customer.nif || '—')}</div>
                <div class="stat-label">NIF</div>
              </div>
            </div>
          </div>

          ${customer.notes ? `
            <div class="card" style="box-shadow:none;border:1px solid var(--border-color);margin-bottom:1rem;">
              <div class="card-body" style="padding:0.85rem;">
                <div class="cell-muted" style="font-size:0.8rem;margin-bottom:0.25rem;">${t('notes', 'Notes')}</div>
                <div>${escapeHtml(customer.notes)}</div>
              </div>
            </div>` : ''}

          <div class="card" style="box-shadow:none;border:1px solid var(--border-color);">
            <div class="card-header">
              <div class="card-title">${t('salesHistory', 'Sales history')}</div>
            </div>
            <div class="card-body" id="customerSalesHistory" style="padding:0.85rem;">
              <div class="loading-state"><div class="spinner"></div><span>${t('loading', 'Loading...')}</span></div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary btn-sm" type="button" data-action="edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>${t('edit', 'Edit')}</span>
          </button>
          <button class="btn btn-ghost" type="button" data-action="cancel">${t('close', 'Close')}</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('customerDetailModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-action="edit"]').addEventListener('click', () => {
    close();
    openCustomerModal(customer);
  });
  const escHandler = (e) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  // Fetch sales history
  const historyEl = overlay.querySelector('#customerSalesHistory');
  try {
    const r = await apiFetch.get('/api/sales', { customer: customer._id, limit: 20, page: 1 });
    const sales = (r && r.success && (r.data || r.sales)) || [];
    if (!sales.length) {
      historyEl.innerHTML = `
        <div class="empty-state" style="padding:1.5rem;">
          <div class="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div class="empty-title">${t('noSalesForCustomer', 'No sales recorded for this customer')}</div>
        </div>`;
    } else {
      const rows = sales.map((s, i) => {
        const num = escapeHtml(s.saleNumber || ('#' + (s._id || '').slice(-6)));
        const date = fmtDate(s.saleDate || s.createdAt);
        const total = fmtCurrency(s.total);
        const st = (s.status || 'completed');
        const cls = st === 'cancelled' ? 'badge-muted'
                  : st === 'pending' ? 'badge-warning'
                  : st === 'returned' ? 'badge-info'
                  : 'badge-success';
        return `
          <tr>
            <td class="cell-muted">${i + 1}</td>
            <td class="cell-strong">${num}</td>
            <td>${date}</td>
            <td>${(s.items && s.items.length) || 0}</td>
            <td class="cell-strong">${total}</td>
            <td><span class="badge ${cls}">${t(st, st)}</span></td>
          </tr>`;
      }).join('');
      historyEl.innerHTML = `
        <div class="table-wrap" style="margin:0;">
          <table class="table">
            <thead>
              <tr>
                <th>#</th>
                <th>${t('invoiceNumber', 'Invoice #')}</th>
                <th>${t('date', 'Date')}</th>
                <th>${t('itemsCount', 'Items')}</th>
                <th>${t('total', 'Total')}</th>
                <th>${t('status', 'Status')}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }
  } catch (err) {
    historyEl.innerHTML = `<div class="empty-state" style="padding:1.5rem;"><div class="empty-title">${t('error', 'Error')}</div><div class="empty-subtitle">${escapeHtml((err && err.message) || '')}</div></div>`;
  }
}

/* ---------- Entry ---------- */
export async function renderCustomersPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.search = ''; state.status = '';
  content.innerHTML = renderSkeleton();
  await fetchCustomers();
  render();
}
