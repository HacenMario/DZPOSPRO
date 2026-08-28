/* ============================================================
 * js/modules/categories.js
 * ------------------------------------------------------------
 * Renders the Categories page into #pageContent.
 *
 * Features:
 *   • Toolbar: search box + "Add category" button
 *   • Paginated table with name (localized), description, parent
 *   • Add/Edit modal appended to <body>
 *   • Delete via Toast.confirm() — backend enforces "has products"
 *     and we surface the error as a Toast
 *   • All text via window.t(), all API calls via window.apiFetch()
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  page: 1,
  limit: 10,
  search: '',
  pagination: null,
  items: []
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderSkeleton() {
  return `
    <div class="toolbar">
      <div class="skeleton" style="height:40px;width:280px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
    </div>
    <div class="table-wrap">
      ${[1,2,3,4,5,6].map(() => `<div class="skeleton skeleton-line" style="height:48px;margin:0;border-radius:0;"></div>`).join('')}
    </div>`;
}

function renderToolbar() {
  return `
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" id="categorySearch" type="search"
                 placeholder="${escapeHtml(t('searchCategories', 'Search categories...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="categoryRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
        <button class="btn btn-primary" id="addCategoryBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('addCategory', 'Add category')}</span>
        </button>
      </div>
    </div>`;
}

function renderTable() {
  if (!state.items.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        </div>
        <div class="empty-title">${t('noCategoriesMatch', 'No matching categories')}</div>
        <div class="empty-subtitle">${t('noCategories', 'No categories found')}</div>
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="emptyAddCatBtn" type="button">${t('addCategory', 'Add category')}</button>
        </div>
      </div>`;
  }

  const rows = state.items.map((c, i) => {
    const name = c.displayName || (c.name && (c.name.ar || c.name.en || c.name.fr)) || '—';
    const desc = c.displayDescription || (c.description && (c.description.ar || c.description.en || c.description.fr)) || '—';
    const parent = c.parentId && (c.parentId.displayName || (c.parentId.name && (c.parentId.name.ar || c.parentId.name.en))) || '—';
    const statusBadge = c.isActive === false
      ? '<span class="badge badge-muted">' + t('inactive', 'Inactive') + '</span>'
      : '<span class="badge badge-primary">' + t('active', 'Active') + '</span>';
    const idx = (state.page - 1) * state.limit + i + 1;
    return `
      <tr>
        <td class="cell-muted">${idx}</td>
        <td class="cell-strong">${escapeHtml(name)}</td>
        <td class="cell-muted">${escapeHtml(desc)}</td>
        <td>${escapeHtml(parent)}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn edit" data-id="${c._id}" aria-label="${t('edit', 'Edit')}" title="${t('edit', 'Edit')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="table-action-btn delete" data-id="${c._id}" data-name="${escapeHtml(name)}" aria-label="${t('delete', 'Delete')}" title="${t('delete', 'Delete')}">
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
            <th>${t('name', 'Name')}</th>
            <th>${t('description', 'Description')}</th>
            <th>${t('parent', 'Parent')}</th>
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

async function fetchCategories() {
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  try {
    const r = await apiFetch.get('/api/categories', qs);
    if (r && r.success) {
      state.items = (r.data && r.data.categories) || r.categories || [];
      state.pagination = r.pagination || null;
    } else { state.items = []; state.pagination = null; }
  } catch (e) {
    console.error('[categories] fetch', e);
    state.items = []; state.pagination = null;
  }
}

function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = renderToolbar() + '<div id="categoriesTableContainer">' + renderTable() + '</div>';
  bindToolbar();
  bindTable();
}

function bindToolbar() {
  const search = document.getElementById('categorySearch');
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
  const addBtn = document.getElementById('addCategoryBtn');
  if (addBtn) addBtn.addEventListener('click', () => openCategoryModal(null));
  const emptyAdd = document.getElementById('emptyAddCatBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openCategoryModal(null));
  const refresh = document.getElementById('categoryRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => refreshTable());
}

function bindTable() {
  document.querySelectorAll('#categoriesTableContainer .table-action-btn.edit').forEach(b => {
    b.addEventListener('click', () => {
      const c = state.items.find(x => x._id === b.dataset.id);
      if (c) openCategoryModal(c);
    });
  });
  document.querySelectorAll('#categoriesTableContainer .table-action-btn.delete').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const name = b.dataset.name || '—';
      const ok = await (window.Toast && window.Toast.confirm
        ? window.Toast.confirm(t('deleteConfirm', 'Delete "{name}"?').replace('{name}', name))
        : Promise.resolve(true));
      if (!ok) return;
      try {
        const r = await apiFetch.delete('/api/categories/' + id);
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('categoryDeleted', 'Category deleted'));
          refreshTable();
        } else {
          throw new Error((r && r.message) || 'Failed');
        }
      } catch (e) {
        // Distinguish "has products" error
        const msg = (e && e.message) || '';
        if (/products|منتجات|produits/i.test(msg)) {
          if (window.Toast) window.Toast.error(t('categoryHasProducts', 'Cannot delete a category with products'));
        } else {
          if (window.Toast) window.Toast.error(msg || t('deleteFailed', 'Delete failed'));
        }
      }
    });
  });
  document.querySelectorAll('#categoriesTableContainer .page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshTable(); }
    });
  });
}

async function refreshTable() {
  const container = document.getElementById('categoriesTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchCategories();
  if (container) container.innerHTML = renderTable();
  bindTable();
}

/* ---------- Modal ---------- */
async function openCategoryModal(category) {
  const isEdit = !!category;

  // Fetch all categories for the parent select
  let allCats = [];
  try {
    const r = await apiFetch.get('/api/categories', { limit: 1000 });
    if (r && r.success) allCats = (r.data && r.data.categories) || r.categories || [];
  } catch (_) {}

  const parentOpts = ['<option value="">' + t('noParent', 'No parent') + '</option>']
    .concat(allCats
      .filter(c => !(isEdit && c._id === category._id))
      .map(c => {
        const name = c.displayName || (c.name && (c.name.ar || c.name.en || c.name.fr)) || '—';
        const sel = category && category.parentId && (category.parentId._id === c._id || category.parentId === c._id) ? 'selected' : '';
        return '<option value="' + c._id + '" ' + sel + '>' + escapeHtml(name) + '</option>';
      }))
    .join('');

  const html = `
    <div class="modal-overlay" id="categoryModal" role="dialog" aria-modal="true" aria-labelledby="categoryModalTitle">
      <div class="modal" role="document">
        <div class="modal-header">
          <div class="modal-title" id="categoryModalTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            <span>${isEdit ? t('editCategory', 'Edit category') : t('addCategory', 'Add category')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="categoryForm">
          <div class="modal-body">
            <input type="hidden" id="categoryId" value="${category ? category._id || '' : ''}" />

            <div class="form-group">
              <label class="form-label" for="catName">${t('name', 'Name')} <span class="req">*</span></label>
              <input class="input" id="catName" type="text" required
                     value="${category ? escapeHtml(category.displayName || (category.name && (category.name.ar || category.name.en || category.name.fr)) || '') : ''}"
                     placeholder="${escapeHtml(t('categoryNamePlaceholder', 'Category name'))}" />
              <div class="help-text">${t('singleFieldAllLanguages', 'Used for all languages (Arabic, English, French)')}</div>
            </div>

            <div class="form-group">
              <label class="form-label" for="catDesc">${t('description', 'Description')}</label>
              <textarea class="textarea" id="catDesc" rows="2"
                placeholder="${escapeHtml(t('descriptionPlaceholder', 'Optional category description'))}">${category ? escapeHtml(category.displayDescription || (category.description && (category.description.ar || category.description.en || category.description.fr)) || '') : ''}</textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="catParent">${t('parentCategory', 'Parent Category')}</label>
              <select class="select" id="catParent">
                ${parentOpts}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">${t('status', 'Status')}</label>
              <select class="select" id="catIsActive">
                <option value="true"  ${!category || category.isActive !== false ? 'selected' : ''}>${t('active', 'Active')}</option>
                <option value="false" ${category && category.isActive === false ? 'selected' : ''}>${t('inactive', 'Inactive')}</option>
              </select>
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
  const overlay = document.getElementById('categoryModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#categoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = overlay.querySelector('#categoryId').value;
    // Single name/description string — backend fans it out across all
    // three language slots (ar / en / fr) via the fanOutString helper.
    const nameVal = overlay.querySelector('#catName').value.trim();
    const descVal = overlay.querySelector('#catDesc').value.trim();
    if (!nameVal) {
      if (window.Toast) window.Toast.warning(t('nameRequired', 'Name is required'));
      return;
    }
    const body = {
      name: nameVal,
      description: descVal,
      parentId: overlay.querySelector('#catParent').value || null,
      isActive: overlay.querySelector('#catIsActive').value === 'true'
    };

    try {
      const url = id ? '/api/categories/' + id : '/api/categories';
      const r = id ? await apiFetch.put(url, body) : await apiFetch.post(url, body);
      if (r && r.success) {
        if (window.Toast) window.Toast.success(id ? t('categoryUpdated', 'Category updated') : t('categoryCreated', 'Category created'));
        close();
        await refreshTable();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/exists|موجود|existe/i.test(msg)) {
        if (window.Toast) window.Toast.error(t('categoryNameExists', 'Category name already exists'));
      } else {
        if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
      }
    }
  });

  setTimeout(() => { const first = overlay.querySelector('#catName'); if (first) first.focus(); }, 50);
}

/* ---------- Entry ---------- */
export async function renderCategoriesPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.search = '';
  content.innerHTML = renderSkeleton();
  await fetchCategories();
  render();
}