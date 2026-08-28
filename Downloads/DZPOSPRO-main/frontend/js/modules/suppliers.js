/* ============================================================
 * js/modules/suppliers.js
 * ------------------------------------------------------------
 * Renders the Suppliers management page into #pageContent.
 *
 * Backend contract (verified):
 *   GET /api/suppliers?page=&limit=&search=
 *     → { success, data:[...], total, page, limit, totalPages }
 *   POST /api/suppliers   body { name, contactName, phone, email,
 *                                 address, rc, nif, nis, art, notes,
 *                                 isActive }
 *     (name/address are flat strings; backend mirrors the value
 *      into legacy {ar,en,fr} slots for back-compat)
 *   PUT /api/suppliers/:id (same)
 *   DELETE /api/suppliers/:id
 *
 * Supplier shape (name/address may be either a flat string or
 * the legacy multilingual object {ar,en,fr}):
 *   { _id, name, contactName, phone, email, address,
 *     rc, nif, nis, art, notes, isActive, createdAt }
 *
 * Features:
 *   • Toolbar: search (debounced), status filter, refresh, "Add"
 *   • Server-side paginated table
 *   • Name (strong, localized), Contact person, Phone (mono),
 *     Email, Address (truncated, localized), Fiscal info
 *     (RC + NIF + NIS + ART as chips), Status badge
 *   • Add/Edit modal: single name input, contactName, phone
 *     (required), email, single address textarea, collapsible
 *     fiscal section (RC/NIF/NIS/ART), notes, isActive toggle
 *   • Validation: name + phone required; email format check
 *   • Delete via Toast.confirm(); surfaces "has products" 400
 *     from the backend as Toast.error
 *   • All text via window.t(); all API calls via window.apiFetch()
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  page: 1,
  limit: 20,
  search: '',
  status: '',
  pagination: null,
  items: []
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? escapeHtml(s.slice(0, n - 1)) + '…' : escapeHtml(s);
}

function currentLang() {
  return (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';
}

function localized(obj, lang) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] || obj.ar || obj.en || obj.fr || '';
}

function supplierName(s) {
  return localized(s && s.name, currentLang()) || '—';
}

function supplierAddress(s) {
  return localized(s && s.address, currentLang()) || '';
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title"><span class="page-title-text">${t('suppliers', 'Suppliers')}</span></h1>
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
          <svg id="pageTitleIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          <span class="page-title-text">${t('suppliers', 'Suppliers')}</span>
        </h1>
        <div class="page-subtitle">${t('suppliersSubtitle', 'Vendors and purchase orders')}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary btn-sm" id="supplierRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
        <button class="btn btn-primary" id="addSupplierBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('addSupplier', 'Add supplier')}</span>
        </button>
      </div>
    </div>
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" id="supplierSearch" type="search"
                 placeholder="${escapeHtml(t('searchSuppliers', 'Search by name, contact, phone...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <select class="select" id="supplierStatusFilter" style="width:auto;">
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        </div>
        <div class="empty-title">${t('noSuppliersMatch', 'No matching suppliers')}</div>
        <div class="empty-subtitle">${t('noSuppliers', 'No suppliers found')}</div>
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="emptyAddSupplierBtn" type="button">${t('addSupplier', 'Add supplier')}</button>
        </div>
      </div>`;
  }

  const rows = state.items.map((s, i) => {
    const name = supplierName(s);
    const addr = supplierAddress(s);
    const fiscalBits = [];
    if (s.rc)  fiscalBits.push('<span class="chip">RC: ' + escapeHtml(s.rc) + '</span>');
    if (s.nif) fiscalBits.push('<span class="chip">NIF: ' + escapeHtml(s.nif) + '</span>');
    if (s.nis) fiscalBits.push('<span class="chip">NIS: ' + escapeHtml(s.nis) + '</span>');
    if (s.art) fiscalBits.push('<span class="chip">ART: ' + escapeHtml(s.art) + '</span>');
    const fiscal = fiscalBits.length
      ? '<div style="display:flex;gap:0.25rem;flex-wrap:wrap;">' + fiscalBits.join('') + '</div>'
      : '<span class="cell-muted">—</span>';
    const statusBadge = s.isActive === false
      ? '<span class="badge badge-muted">' + t('inactive', 'Inactive') + '</span>'
      : '<span class="badge badge-success">' + t('active', 'Active') + '</span>';
    const idx = (state.page - 1) * state.limit + i + 1;
    return `
      <tr>
        <td class="cell-muted">${idx}</td>
        <td class="cell-strong">${escapeHtml(name)}</td>
        <td>${escapeHtml(s.contactName || '—')}</td>
        <td class="cell-mono">${escapeHtml(s.phone || '—')}</td>
        <td class="cell-muted">${s.email ? '<a href="mailto:' + escapeHtml(s.email) + '" style="color:inherit;">' + escapeHtml(s.email) + '</a>' : '—'}</td>
        <td class="cell-muted" title="${escapeHtml(addr)}">${addr ? truncate(addr, 28) : '—'}</td>
        <td>${fiscal}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn edit" data-id="${s._id}" aria-label="${t('edit', 'Edit')}" title="${t('edit', 'Edit')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="table-action-btn delete" data-id="${s._id}" data-name="${escapeHtml(name)}" aria-label="${t('delete', 'Delete')}" title="${t('delete', 'Delete')}">
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
            <th>${t('supplierName', 'Name')}</th>
            <th>${t('contactPerson', 'Contact person')}</th>
            <th>${t('phone', 'Phone')}</th>
            <th>${t('emailAddress', 'Email')}</th>
            <th>${t('address', 'Address')}</th>
            <th>${t('fiscalInfo', 'Fiscal info')}</th>
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
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  try {
    const r = await apiFetch.get('/api/suppliers', qs);
    if (r && r.success) {
      let items = r.data || r.suppliers || [];
      if (state.status === 'active')   items = items.filter(s => s.isActive !== false);
      if (state.status === 'inactive') items = items.filter(s => s.isActive === false);
      state.items = items;
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
    console.error('[suppliers] fetch', e);
    state.items = []; state.pagination = null;
  }
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = renderToolbar() + '<div id="suppliersTableContainer">' + renderTable() + '</div>';
  bindToolbar();
  bindTable();
}

function bindToolbar() {
  const search = document.getElementById('supplierSearch');
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
  const statusSel = document.getElementById('supplierStatusFilter');
  if (statusSel) statusSel.addEventListener('change', () => {
    state.status = statusSel.value; state.page = 1; refreshTable();
  });
  const addBtn = document.getElementById('addSupplierBtn');
  if (addBtn) addBtn.addEventListener('click', () => openSupplierModal(null));
  const emptyAdd = document.getElementById('emptyAddSupplierBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openSupplierModal(null));
  const refresh = document.getElementById('supplierRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => refreshTable());
}

function bindTable() {
  document.querySelectorAll('#suppliersTableContainer .table-action-btn.edit').forEach(b => {
    b.addEventListener('click', () => {
      const s = state.items.find(x => x._id === b.dataset.id);
      if (s) openSupplierModal(s);
    });
  });
  document.querySelectorAll('#suppliersTableContainer .table-action-btn.delete').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const name = b.dataset.name || '—';
      const ok = await (window.Toast && window.Toast.confirm
        ? window.Toast.confirm(t('deleteConfirm', 'Delete "{name}"?').replace('{name}', name))
        : Promise.resolve(true));
      if (!ok) return;
      try {
        const r = await apiFetch.delete('/api/suppliers/' + id);
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('supplierDeleted', 'Supplier deleted'));
          refreshTable();
        } else {
          throw new Error((r && r.message) || 'Failed');
        }
      } catch (e) {
        const msg = (e && e.message) || '';
        if (/products|منتجات|produits|in use|referenced|linked/i.test(msg)) {
          if (window.Toast) window.Toast.error(t('supplierHasProducts', 'Cannot delete a supplier linked to products'));
        } else {
          if (window.Toast) window.Toast.error(msg || t('deleteFailed', 'Delete failed'));
        }
      }
    });
  });
  document.querySelectorAll('#suppliersTableContainer .page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshTable(); }
    });
  });
}

async function refreshTable() {
  const container = document.getElementById('suppliersTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchSuppliers();
  if (container) container.innerHTML = renderTable();
  bindTable();
}

/* ---------- Modal ---------- */
function openSupplierModal(supplier) {
  const isEdit = !!supplier;
  const lang = currentLang();

  // Single-field name/address: support both flat string and legacy {ar,en,fr} objects.
  const nameVal = (supplier && supplier.name)
    ? (typeof supplier.name === 'string' ? supplier.name : (supplier.name.ar || supplier.name.en || supplier.name.fr || ''))
    : '';
  const addrVal = (supplier && supplier.address)
    ? (typeof supplier.address === 'string' ? supplier.address : (supplier.address.ar || supplier.address.en || supplier.address.fr || ''))
    : '';

  const html = `
    <div class="modal-overlay" id="supplierModal" role="dialog" aria-modal="true" aria-labelledby="supplierModalTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="supplierModalTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            <span>${isEdit ? t('editSupplier', 'Edit supplier') : t('addSupplier', 'Add supplier')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="supplierForm" novalidate>
          <div class="modal-body">
            <input type="hidden" id="supplierId" value="${supplier ? supplier._id || '' : ''}" />

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="supplierName">${t('name', 'Name')} <span class="req">*</span></label>
                <input class="input" id="supplierName" name="name" type="text" required maxlength="120"
                       value="${escapeHtml(nameVal)}" />
                <div class="invalid-feedback" id="supplierNameErr" style="display:none;">${t('supplierNameRequired', 'Name is required')}</div>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="supplierContactName">${t('contactPerson', 'Contact person')}</label>
                <input class="input" id="supplierContactName" type="text" maxlength="120"
                       value="${supplier && supplier.contactName ? escapeHtml(supplier.contactName) : ''}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="supplierPhone">${t('phone', 'Phone')} <span class="req">*</span></label>
                <input class="input" id="supplierPhone" type="tel" required maxlength="32"
                       value="${supplier && supplier.phone ? escapeHtml(supplier.phone) : ''}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="supplierEmail">${t('emailAddress', 'Email')}</label>
                <input class="input" id="supplierEmail" type="email" maxlength="120"
                       value="${supplier && supplier.email ? escapeHtml(supplier.email) : ''}" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="supplierAddress">${t('address', 'Address')}</label>
              <textarea class="textarea" id="supplierAddress" name="address" rows="2">${escapeHtml(addrVal)}</textarea>
            </div>

            <details class="card" style="margin-top:0.5rem;background:var(--bg-body, transparent);border:1px solid var(--border-color, #eee);border-radius:var(--radius-sm, 8px);overflow:hidden;">
              <summary style="display:flex;align-items:center;gap:0.5rem;padding:0.85rem 1rem;cursor:pointer;font-weight:600;list-style:none;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;color:var(--primary);"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg>
                <span>${t('fiscalInfo', 'Fiscal information')}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-inline-start:auto;"><polyline points="6 9 12 15 18 9"/></svg>
              </summary>
              <div style="padding:1rem;">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label" for="supplierRc">${t('rc', 'RC')}</label>
                    <input class="input" id="supplierRc" type="text" maxlength="40"
                           value="${supplier && supplier.rc ? escapeHtml(supplier.rc) : ''}" />
                    <div class="help-text">${t('rcHelp', 'Registre de commerce')}</div>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="supplierNif">${t('nif', 'NIF')}</label>
                    <input class="input" id="supplierNif" type="text" maxlength="40"
                           value="${supplier && supplier.nif ? escapeHtml(supplier.nif) : ''}" />
                    <div class="help-text">${t('nifHelp', 'Numéro d\'identification fiscale')}</div>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="supplierNis">${t('nis', 'NIS')}</label>
                    <input class="input" id="supplierNis" type="text" maxlength="40"
                           value="${supplier && supplier.nis ? escapeHtml(supplier.nis) : ''}" />
                    <div class="help-text">${t('nisHelp', 'Numéro d\'identification statistique')}</div>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="supplierArt">${t('art', 'ART')}</label>
                    <input class="input" id="supplierArt" type="text" maxlength="40"
                           value="${supplier && supplier.art ? escapeHtml(supplier.art) : ''}" />
                    <div class="help-text">${t('artHelp', 'Article d\'imposition')}</div>
                  </div>
                </div>
              </div>
            </details>

            <div class="form-group" style="margin-top:1rem;">
              <label class="form-label" for="supplierNotes">${t('notes', 'Notes')}</label>
              <textarea class="textarea" id="supplierNotes" rows="2">${supplier && supplier.notes ? escapeHtml(supplier.notes) : ''}</textarea>
            </div>

            <div class="form-group" style="margin-top:0.5rem;">
              <label class="form-label" style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                <input type="checkbox" id="supplierIsActive" style="width:18px;height:18px;"
                       ${!supplier || supplier.isActive !== false ? 'checked' : ''} />
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
  const overlay = document.getElementById('supplierModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#supplierForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = overlay.querySelector('#supplierId').value;
    const nameValue = overlay.querySelector('#supplierName').value.trim();
    const phone = overlay.querySelector('#supplierPhone').value.trim();
    const email = overlay.querySelector('#supplierEmail').value.trim();

    // Validation
    if (!nameValue) {
      const errEl = overlay.querySelector('#supplierNameErr');
      if (errEl) errEl.style.display = 'block';
      overlay.querySelector('#supplierName').focus();
      if (window.Toast) window.Toast.error(t('supplierNameRequired', 'Name is required'));
      return;
    }
    if (!phone) {
      if (window.Toast) window.Toast.error(t('supplierPhoneRequired', 'Phone is required'));
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (window.Toast) window.Toast.error(t('emailInvalid', 'Invalid email format'));
      return;
    }

    const body = {
      name: nameValue,
      contactName: overlay.querySelector('#supplierContactName').value.trim(),
      phone,
      email,
      address: overlay.querySelector('#supplierAddress').value.trim(),
      rc: overlay.querySelector('#supplierRc').value.trim(),
      nif: overlay.querySelector('#supplierNif').value.trim(),
      nis: overlay.querySelector('#supplierNis').value.trim(),
      art: overlay.querySelector('#supplierArt').value.trim(),
      notes: overlay.querySelector('#supplierNotes').value.trim(),
      isActive: overlay.querySelector('#supplierIsActive').checked
    };

    try {
      const url = id ? '/api/suppliers/' + id : '/api/suppliers';
      const r = id ? await apiFetch.put(url, body) : await apiFetch.post(url, body);
      if (r && r.success) {
        if (window.Toast) window.Toast.success(id ? t('supplierUpdated', 'Supplier updated') : t('supplierCreated', 'Supplier created'));
        close();
        await refreshTable();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/exists|موجود|existe|duplicate|already/i.test(msg)) {
        if (window.Toast) window.Toast.error(t('supplierExists', 'Supplier already exists'));
      } else {
        if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
      }
    }
  });

  setTimeout(() => { const first = overlay.querySelector('#supplierName'); if (first) first.focus(); }, 50);
}

/* ---------- Entry ---------- */
export async function renderSuppliersPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.search = ''; state.status = '';
  content.innerHTML = renderSkeleton();
  await fetchSuppliers();
  render();
}
