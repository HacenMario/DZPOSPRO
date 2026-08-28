/* ============================================================
 * js/modules/products.js
 * ------------------------------------------------------------
 * Renders the Products page into #pageContent.
 *
 * Features:
 *   • Toolbar: search box, category filter, status filter, "Add"
 *   • Server-side paginated table (page/pageSize)
 *   • Image thumbnail + barcode + low-stock badge + status badge
 *   • Add/Edit modal appended to <body> (clean on close)
 *   • Barcode lookup: pressing Enter on a barcode-like query hits
 *     GET /api/products/barcode/:code
 *   • Delete via Toast.confirm()
 *   • All text via window.t()
 *   • All API calls via window.apiFetch()
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));
import API_BASE from '../config.js';

// CSV round-trip column order — MUST stay in sync with backend exportProducts/importProducts
const CSV_HEADERS = ['id', 'name', 'description', 'barcode', 'sku', 'category', 'price', 'costPrice', 'stock', 'minStock', 'unit', 'tax', 'timbre', 'status'];

let state = {
  page: 1,
  limit: 10,
  search: '',
  category: '',
  status: '',     // 'active' | 'inactive' | ''
  pagination: null,
  items: [],
  categories: []
};

/* ---------- Helpers ---------- */
function fmtCurrency(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + t('currency', 'دج');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isBarcodeLike(q) {
  return /^[0-9]{4,}$/.test(q.trim());
}

// Product name may be a multilingual object {ar,en,fr} or a plain string.
function productName(p) {
  if (!p || !p.name) return '';
  if (typeof p.name === 'string') return p.name;
  return p.name.ar || p.name.en || p.name.fr || '';
}

// Product description may be a multilingual object {ar,en,fr} or a plain string.
function productDescription(p) {
  if (!p || !p.description) return '';
  if (typeof p.description === 'string') return p.description;
  return p.description.ar || p.description.en || p.description.fr || '';
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="toolbar">
      <div class="skeleton" style="height:40px;width:280px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
      <div class="skeleton" style="height:40px;width:160px;"></div>
    </div>
    <div class="table-wrap">
      ${[1,2,3,4,5,6,7,8].map(() => `<div class="skeleton skeleton-line" style="height:48px;margin:0;border-radius:0;"></div>`).join('')}
    </div>`;
}

/* ---------- Toolbar ---------- */
function renderToolbar() {
  const categories = Array.isArray(state.categories) ? state.categories : [];
  
  const catOptions = ['<option value="">' + t('allCategories', 'All categories') + '</option>']
    .concat(categories.map(c => {
      let name = c.displayName || 
                 (c.name && (c.name.ar || c.name.en || c.name.fr)) || 
                 c.name ||
                 '—';
      return '<option value="' + (c._id || c.id) + '">' + escapeHtml(name) + '</option>';
    })).join('');

  return `
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" id="productSearch" type="search"
                 placeholder="${escapeHtml(t('searchProducts', 'Search by name or barcode...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <select class="select" id="productCategoryFilter" style="width:auto;">
          ${catOptions}
        </select>
        <select class="select" id="productStatusFilter" style="width:auto;">
          <option value="">${t('all', 'All')} — ${t('status', 'Status')}</option>
          <option value="active" ${state.status === 'active' ? 'selected' : ''}>${t('active', 'Active')}</option>
          <option value="inactive" ${state.status === 'inactive' ? 'selected' : ''}>${t('inactive', 'Inactive')}</option>
        </select>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="productRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
        </button>
        <button class="btn btn-secondary btn-sm" id="exportProductsBtn" type="button" title="${t('exportCsv', 'Export CSV')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>${t('exportCsv', 'Export CSV')}</span>
        </button>
        <button class="btn btn-secondary btn-sm" id="importProductsBtn" type="button" title="${t('importCsv', 'Import CSV')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>${t('importCsv', 'Import CSV')}</span>
        </button>
        <button class="btn btn-primary" id="addProductBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('addProduct', 'Add product')}</span>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        </div>
        <div class="empty-title">${t('noProductsMatch', 'No matching products')}</div>
        <div class="empty-subtitle">${t('noProducts', 'No products found')}</div>
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="emptyAddBtn" type="button">${t('addProduct', 'Add product')}</button>
        </div>
      </div>`;
  }

  const rows = state.items.map((p, i) => {
    const name = p.displayName || productName(p) || '—';
    
    // ✅ استخراج اسم الفئة بشكل صحيح
    let categoryName = '—';
    if (p.category) {
      if (typeof p.category === 'object') {
        categoryName = p.category.displayName || 
                       (p.category.name && (p.category.name.ar || p.category.name.en || p.category.name.fr)) || 
                       p.category.name || 
                       '—';
      } else {
        categoryName = String(p.category);
      }
    }
    
    const lowStock = typeof p.stock === 'number' && typeof p.minStock === 'number' && p.stock <= p.minStock;
    const stockBadge = lowStock
      ? '<span class="badge badge-danger">' + t('lowStockBadge', 'Low stock') + '</span>'
      : '<span class="badge badge-success">' + t('inStock', 'In stock') + '</span>';
    
    const statusBadge = p.status === 'inactive'
      ? '<span class="badge badge-muted">' + t('inactive', 'Inactive') + '</span>'
      : '<span class="badge badge-primary">' + t('active', 'Active') + '</span>';
    
    const thumb = p.images && p.images.length
      ? '<img class="cell-thumb" src="' + escapeHtml(window.resolveAssetUrl ? window.resolveAssetUrl(p.images[0]) : p.images[0]) + '" alt="" loading="lazy" />'
      : '<div class="cell-thumb-placeholder" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>';
    
    const idx = (state.page - 1) * state.limit + i + 1;
    return `
      <tr>
        <td class="cell-muted">${idx}</td>
        <td>${thumb}</td>
        <td class="cell-strong">${escapeHtml(name)}</td>
        <td class="cell-mono">${escapeHtml(p.barcode || '—')}</td>
        <td>${escapeHtml(categoryName)}</td>
        <td>${fmtCurrency(p.price)}</td>
        <td>${escapeHtml(String(p.stock || 0))} <span class="text-muted">/ ${escapeHtml(String(p.minStock || 0))}</span></td>
        <td>${stockBadge}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn edit" data-id="${p._id}" aria-label="${t('edit', 'Edit')}" title="${t('edit', 'Edit')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="table-action-btn delete" data-id="${p._id}" data-name="${escapeHtml(name)}" aria-label="${t('delete', 'Delete')}" title="${t('delete', 'Delete')}">
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
            <th></th>
            <th>${t('name', 'Name')}</th>
            <th>${t('barcode', 'Barcode')}</th>
            <th>${t('category', 'Category')}</th>
            <th>${t('price', 'Price')}</th>
            <th>${t('stock', 'Stock')}</th>
            <th>${t('status', 'Status')}</th>
            <th>${t('active', 'Active')}</th>
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
async function fetchCategories() {
  try {
    const token = localStorage.getItem('token');
    console.log('🔵 Fetching categories with token:', token ? 'Yes' : 'No');
    
    const response = await fetch('https://dzpospro-production.up.railway.app/api/categories?limit=1000', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('🔵 Response status:', response.status);
    const data = await response.json();
    console.log('📦 Full API response:', JSON.stringify(data, null, 2));
    
    let categories = [];
    
    // ✅ استخراج المصفوفة من المسار الصحيح
    if (data && data.success) {
      // الحالة الصحيحة: data.data.categories هي المصفوفة
      if (data.data && data.data.categories && Array.isArray(data.data.categories)) {
        categories = data.data.categories;
        console.log('📦 Extracted from data.data.categories');
      }
      // الحالة 2: data.data هي المصفوفة مباشرة
      else if (data.data && Array.isArray(data.data)) {
        categories = data.data;
        console.log('📦 Extracted from data.data');
      }
      // الحالة 3: data.categories هي المصفوفة
      else if (data.categories && Array.isArray(data.categories)) {
        categories = data.categories;
        console.log('📦 Extracted from data.categories');
      }
      // الحالة 4: data.data.data هي المصفوفة
      else if (data.data && data.data.data && Array.isArray(data.data.data)) {
        categories = data.data.data;
        console.log('📦 Extracted from data.data.data');
      }
    } else if (data && Array.isArray(data)) {
      categories = data;
      console.log('📦 Extracted from data (array)');
    } else if (data && data.data && Array.isArray(data.data)) {
      categories = data.data;
      console.log('📦 Extracted from data.data');
    }
    
    state.categories = categories;
    console.log('✅ Categories loaded:', state.categories.length);
    
    // عرض تفاصيل الفئات
    if (categories.length > 0) {
      console.log('📦 First category:', categories[0]);
      console.log('📦 Category names:', categories.map(c => c.name?.ar || c.name || 'unnamed'));
    } else {
      console.warn('⚠️ No categories found in response');
    }
  } catch (e) { 
    console.error('[products] fetchCategories error:', e);
    state.categories = [];
  }
}

async function fetchProducts() {
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  if (state.category) qs.category = state.category;
  if (state.status) qs.status = state.status;
  try {
    const r = await apiFetch.get('/api/products', qs);
    if (r && r.success) {
      let items = r.data || r.products || [];
      state.items = items;
      state.pagination = r.total != null
        ? { page: r.page || 1, pages: r.totalPages || 1, total: r.total, limit: r.limit || state.limit }
        : (r.pagination || null);
    } else {
      state.items = []; state.pagination = null;
    }
  } catch (e) {
    console.error('[products] fetchProducts', e);
    state.items = []; state.pagination = null;
  }
}

async function lookupBarcode(code) {
  try {
    const r = await apiFetch.get('/api/products/barcode/' + encodeURIComponent(code));
    if (r && r.success && ((r.data && r.data.product) || r.product)) {
      openProductModal((r.data && r.data.product) || r.product);
      return true;
    }
  } catch (_) {}
  if (window.Toast) window.Toast.info(t('productNotFound', 'Product not found'));
  return false;
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  
  const categories = Array.isArray(state.categories) ? state.categories : [];
  console.log('📦 Rendering with categories:', categories.length);
  
  content.innerHTML = renderToolbar() + '<div id="productsTableContainer">' + renderTable() + '</div>';
  bindToolbar();
  bindTable();
}

function bindToolbar() {
  const search = document.getElementById('productSearch');
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
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = search.value.trim();
        if (isBarcodeLike(q)) {
          lookupBarcode(q);
        } else {
          state.search = q; state.page = 1; refreshTable();
        }
      }
    });
  }
  const cat = document.getElementById('productCategoryFilter');
  if (cat) cat.addEventListener('change', () => {
    state.category = cat.value; state.page = 1; refreshTable();
  });
  const st = document.getElementById('productStatusFilter');
  if (st) st.addEventListener('change', () => {
    state.status = st.value; state.page = 1; refreshTable();
  });
  const addBtn = document.getElementById('addProductBtn');
  if (addBtn) addBtn.addEventListener('click', () => openProductModal(null));
  const emptyAdd = document.getElementById('emptyAddBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openProductModal(null));
  const refresh = document.getElementById('productRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => refreshTable());
  const exportBtn = document.getElementById('exportProductsBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportProductsCsv);
  const importBtn = document.getElementById('importProductsBtn');
  if (importBtn) importBtn.addEventListener('click', openImportModal);
}

function bindTable() {
  document.querySelectorAll('#productsTableContainer .table-action-btn.edit').forEach(b => {
    b.addEventListener('click', () => {
      const p = state.items.find(x => x._id === b.dataset.id);
      if (p) openProductModal(p);
    });
  });
  document.querySelectorAll('#productsTableContainer .table-action-btn.delete').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const name = b.dataset.name || '—';
      const ok = await (window.Toast && window.Toast.confirm
        ? window.Toast.confirm(t('deleteConfirm', 'Delete "{name}"?').replace('{name}', name))
        : Promise.resolve(true));
      if (!ok) return;
      try {
        const r = await apiFetch.delete('/api/products/' + id);
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('productDeleted', 'Product deleted'));
          refreshTable();
        } else {
          throw new Error((r && r.message) || 'Failed');
        }
      } catch (e) {
        if (window.Toast) window.Toast.error((e && e.message) || t('deleteFailed', 'Delete failed'));
      }
    });
  });
  document.querySelectorAll('#productsTableContainer .page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshTable(); }
    });
  });
}

async function refreshTable() {
  const container = document.getElementById('productsTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchProducts();
  if (container) container.innerHTML = renderTable();
  bindTable();
}

/* ---------- Modal ---------- */
function openProductModal(product) {
  const isEdit = !!product;
  
  // ✅ تحميل الفئات قبل فتح النافذة
  const loadAndOpen = async () => {
    // إذا كانت الفئات فارغة، قم بتحميلها
    if (!state.categories || state.categories.length === 0) {
      console.log('🔵 Loading categories before opening modal...');
      await fetchCategories();
    }
    
    console.log('📦 Categories before building modal:', state.categories.length);
    buildModal(product);
  };
  
  function buildModal(product) {
    const isEdit = !!product;
    const cats = Array.isArray(state.categories) ? state.categories : [];
    console.log('📦 Building modal with categories:', cats.length);
    
    const currentCatId = product && product.category
      ? (typeof product.category === 'object' ? (product.category._id || '').toString() : String(product.category))
      : '';
    
    // ✅ بناء خيارات الفئات
    let catOpts = '<option value="">' + t('selectCategory', 'Select category') + '</option>';
    if (cats && cats.length) {
      cats.forEach(c => {
        let name = c.displayName || 
                   (c.name && (c.name.ar || c.name.en || c.name.fr)) || 
                   c.name ||
                   '—';
        const sel = currentCatId && currentCatId === String(c._id || c.id) ? 'selected' : '';
        catOpts += '<option value="' + (c._id || c.id) + '" ' + sel + '>' + escapeHtml(name) + '</option>';
      });
    }
    
    console.log('📦 Category options count:', catOpts.split('<option').length - 1);
    
    const html = `
      <div class="modal-overlay" id="productModal" role="dialog" aria-modal="true" aria-labelledby="productModalTitle">
        <div class="modal modal-lg" role="document">
          <div class="modal-header">
            <div class="modal-title" id="productModalTitle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              <span>${isEdit ? t('editProduct', 'Edit product') : t('addProduct', 'Add product')}</span>
            </div>
            <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <form id="productForm">
            <div class="modal-body">
              <input type="hidden" id="productId" value="${product ? product._id || '' : ''}" />

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="productName">${t('name', 'Name')} <span class="req">*</span></label>
                  <input class="input" id="productName" name="name" type="text" required value="${escapeHtml(productName(product))}" placeholder="${escapeHtml(t('productNamePlaceholder', 'Product name'))}" />
                  <div class="invalid-feedback" id="productNameErr" style="display:none;">${t('nameRequired', 'Name is required')}</div>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="productDescription">${t('description', 'Description')}</label>
                <textarea class="textarea" id="productDescription" name="description" rows="2" placeholder="${escapeHtml(t('descriptionPlaceholder', 'Optional product description'))}">${escapeHtml(productDescription(product))}</textarea>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">${t('price', 'Price')} <span class="req">*</span></label>
                  <input class="input" id="price" type="number" step="0.01" min="0" required value="${product && product.price != null ? product.price : ''}" />
                </div>
                <div class="form-group">
                  <label class="form-label">${t('costPrice', 'Cost price')}</label>
                  <input class="input" id="costPrice" type="number" step="0.01" min="0" value="${product && product.costPrice != null ? product.costPrice : 0}" />
                </div>
                <div class="form-group">
                  <label class="form-label">${t('stock', 'Stock')}</label>
                  <input class="input" id="stock" type="number" step="1" min="0" value="${product && product.stock != null ? product.stock : 0}" />
                </div>
                <div class="form-group">
                  <label class="form-label">${t('minStock', 'Min stock')}</label>
                  <input class="input" id="minStock" type="number" step="1" min="0" value="${product && product.minStock != null ? product.minStock : 5}" />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">${t('barcode', 'Barcode')}</label>
                  <input class="input" id="barcode" type="text" value="${product && product.barcode ? escapeHtml(product.barcode) : ''}" />
                </div>
                <div class="form-group">
                  <label class="form-label">${t('sku', 'SKU')}</label>
                  <input class="input" id="sku" type="text" value="${product && product.sku ? escapeHtml(product.sku) : ''}" />
                </div>
                <div class="form-group">
                  <label class="form-label">${t('unit', 'Unit')}</label>
                  <input class="input" id="unit" type="text" value="${product && product.unit ? escapeHtml(product.unit) : 'قطعة'}" />
                </div>
                <div class="form-group">
                  <label class="form-label">${t('timbre', 'Timbre')}</label>
                  <input class="input" id="timbre" type="number" step="0.01" min="0" value="${product && product.timbre != null ? product.timbre : 0}" />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">${t('category', 'Category')}</label>
                  <select class="select" id="category">${catOpts}</select>
                </div>
                <div class="form-group">
                  <label class="form-label">${t('tax', 'Tax')} (%)</label>
                  <input class="input" id="tax" type="number" step="0.01" min="0" max="100" value="${product && product.tax != null ? product.tax : 0}" />
                </div>
                <div class="form-group">
                  <label class="form-label">${t('status', 'Status')}</label>
                  <select class="select" id="productStatus">
                    <option value="active" ${(product && product.status === 'active') || (!product || !product.status || product.status !== 'inactive') ? 'selected' : ''}>${t('active', 'Active')}</option>
                    <option value="inactive" ${product && product.status === 'inactive' ? 'selected' : ''}>${t('inactive', 'Inactive')}</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">${t('images', 'Images')}</label>
                <input class="input" id="images" type="file" accept="image/*" multiple />
                <div class="help-text">${t('uploadImage', 'Upload image')} — JPG/PNG — max 5</div>
                <div id="imagePreview" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;"></div>
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

    // إلحاق النافذة بالـ body
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('productModal');

    function close() { overlay.remove(); }

    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Image preview + delete-existing-image support
    const fileInput = overlay.querySelector('#images');
    const preview = overlay.querySelector('#imagePreview');
    let keptImages = [];
    if (product && product.images && product.images.length) {
      keptImages = product.images.slice();
      renderImagePreview();
    }
    function renderImagePreview() {
      if (!preview) return;
      preview.innerHTML = '';
      keptImages.forEach((src, i) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:64px;height:64px;';
        const img = document.createElement('img');
        img.src = (window.resolveAssetUrl ? window.resolveAssetUrl(src) : src); img.alt = '';
        img.style.cssText = 'width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--border-color);';
        const del = document.createElement('button');
        del.type = 'button';
        del.setAttribute('aria-label', t('removeImage', 'Remove image'));
        del.style.cssText = 'position:absolute;top:-6px;' + (document.documentElement.dir === 'rtl' ? 'left:-6px;' : 'right:-6px;') + 'width:20px;height:20px;border-radius:50%;background:var(--danger);color:#fff;border:none;cursor:pointer;display:grid;place-items:center;font-size:12px;line-height:1;';
        del.innerHTML = '&times;';
        del.addEventListener('click', () => {
          keptImages.splice(i, 1);
          renderImagePreview();
        });
        wrap.appendChild(img);
        wrap.appendChild(del);
        preview.appendChild(wrap);
      });
      if (fileInput && fileInput.files) {
        Array.from(fileInput.files).slice(0, 5).forEach(f => {
          const url = URL.createObjectURL(f);
          const img = document.createElement('img');
          img.src = url; img.alt = '';
          img.style.cssText = 'width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--border-color);';
          preview.appendChild(img);
        });
      }
    }
    if (fileInput) {
      fileInput.addEventListener('change', renderImagePreview);
    }

    // Submit
    overlay.querySelector('#productForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = overlay.querySelector('#productId').value;
      const nameValue = overlay.querySelector('#productName').value.trim();
      let valid = true;
      const nameEl = overlay.querySelector('#productName');
      const nameErr = overlay.querySelector('#productNameErr');
      nameErr.style.display = nameValue ? 'none' : 'block';
      if (!nameValue) { nameEl.focus(); valid = false; }
      if (!valid) {
        if (window.Toast) window.Toast.warning(t('checkFormFields', 'Please check the form fields'));
        return;
      }
      const body = {
        name: nameValue,
        description: overlay.querySelector('#productDescription').value.trim(),
        price: parseFloat(overlay.querySelector('#price').value) || 0,
        costPrice: parseFloat(overlay.querySelector('#costPrice').value) || 0,
        stock: parseInt(overlay.querySelector('#stock').value, 10) || 0,
        minStock: parseInt(overlay.querySelector('#minStock').value, 10) || 0,
        barcode: overlay.querySelector('#barcode').value.trim() || undefined,
        sku: overlay.querySelector('#sku').value.trim() || undefined,
        unit: overlay.querySelector('#unit').value.trim() || 'قطعة',
        timbre: parseFloat(overlay.querySelector('#timbre').value) || 0,
        tax: parseFloat(overlay.querySelector('#tax').value) || 0,
        category: overlay.querySelector('#category').value || null,
        status: overlay.querySelector('#productStatus').value || 'active'
      };

      const fileInput = overlay.querySelector('#images');
      let payload, headers;
      if (fileInput && fileInput.files && fileInput.files.length) {
        const fd = new FormData();
        Object.keys(body).forEach(k => {
          const v = body[k];
          if (v == null) return;
          if (typeof v === 'object') {
            Object.keys(v).forEach(sub => fd.append(k + '[' + sub + ']', v[sub] || ''));
          } else {
            fd.append(k, v);
          }
        });
        keptImages.forEach(src => fd.append('existingImages', src));
        Array.from(fileInput.files).slice(0, 5).forEach(f => fd.append('images', f));
        payload = fd; headers = {};
      } else {
        body.existingImages = keptImages;
        payload = body; headers = {};
      }

      try {
        const url = id ? '/api/products/' + id : '/api/products';
        const r = id
          ? await apiFetch.put(url, payload, { headers })
          : await apiFetch.post(url, payload, { headers });
        if (r && r.success) {
          if (window.Toast) window.Toast.success(id ? t('productUpdated', 'Product updated') : t('productCreated', 'Product created'));
          close();
          await refreshTable();
        } else {
          throw new Error((r && r.message) || 'Failed');
        }
      } catch (err) {
        if (window.Toast) window.Toast.error((err && err.message) || t('error', 'Error'));
      }
    });

    // Focus first input
    setTimeout(() => { const first = overlay.querySelector('#productName'); if (first) first.focus(); }, 50);
  }
  
  // ✅ تنفيذ التحميل ثم فتح النافذة
  loadAndOpen();
}

/* ---------- CSV export ---------- */
function csvCell(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function exportProductsCsv() {
  const btn = document.getElementById('exportProductsBtn');
  const setBusy = (busy) => {
    if (!btn) return;
    btn.disabled = busy;
    const lbl = btn.querySelector('span');
    if (lbl) {
      if (busy) { lbl.dataset.orig = lbl.textContent; lbl.textContent = t('csvExporting', 'Exporting...'); }
      else if (lbl.dataset.orig) { lbl.textContent = lbl.dataset.orig; delete lbl.dataset.orig; }
    }
  };
  setBusy(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(API_BASE + '/api/products/export', { headers: { 'Authorization': 'Bearer ' + (token || '') } });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.message) msg = j.message; } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const d = new Date();
    const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    downloadBlob(blob, 'products-' + stamp + '.csv');
    if (window.Toast) window.Toast.success(t('exportDone', 'Export ready'));
  } catch (e) {
    console.error('[products] export error:', e);
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
  } finally {
    setBusy(false);
  }
}

/* ---------- CSV import ---------- */
function downloadCsvTemplate() {
  const sample = ['', 'Sample product', 'Product description', '1234567890123', 'SKU-001', 'Category name', '250.00', '150.00', '10', '5', 'pcs', '19', '0', 'active'];
  const csv = '\uFEFF' + CSV_HEADERS.join(',') + '\r\n' + sample.map(csvCell).join(',');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'products-template.csv');
}

function openImportModal() {
  document.querySelectorAll('#importProductsModal').forEach(m => m.remove());

  const html = `
      <div class="modal-overlay" id="importProductsModal" role="dialog" aria-modal="true" aria-labelledby="importModalTitle">
        <div class="modal" role="document">
          <div class="modal-header">
            <div class="modal-title" id="importModalTitle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>${t('csvImportTitle', 'Import products from a CSV file')}</span>
            </div>
            <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <p class="help-text" style="margin:0 0 0.75rem;line-height:1.6;">${t('csvImportHint', '')}</p>
            <div style="margin-bottom:0.9rem;">
              <button class="btn btn-ghost btn-sm" id="csvTemplateBtn" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>${t('csvDownloadTemplate', 'Download CSV template')}</span>
              </button>
            </div>
            <div class="form-group">
              <label class="form-label" for="csvFileInput">${t('csvChooseFile', 'Choose a CSV file')}</label>
              <input class="input" id="csvFileInput" type="file" accept=".csv,text/csv" />
            </div>
            <div id="csvImportResult" style="display:none;"></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" type="button" data-action="cancel">${t('cancel', 'Cancel')}</button>
            <button class="btn btn-primary" type="button" id="csvImportSubmit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>${t('importCsv', 'Import CSV')}</span>
            </button>
          </div>
        </div>
      </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('importProductsModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const templateBtn = overlay.querySelector('#csvTemplateBtn');
  if (templateBtn) templateBtn.addEventListener('click', downloadCsvTemplate);

  const submitBtn = overlay.querySelector('#csvImportSubmit');
  if (submitBtn) submitBtn.addEventListener('click', () => submitCsvImport(overlay));

  setTimeout(() => { const f = overlay.querySelector('#csvFileInput'); if (f) f.focus(); }, 50);
}

function showImportResult(overlay, d) {
  const box = overlay.querySelector('#csvImportResult');
  if (!box) return;
  const created = Number(d.created || 0);
  const updated = Number(d.updated || 0);
  const skipped = Number(d.skipped || 0);
  const errors = Array.isArray(d.errors) ? d.errors : [];
  const badge = (cls, txt) => '<span class="badge ' + cls + '">' + txt + '</span>';
  let html =
    '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:0.75rem 0 0.25rem;">' +
      badge('badge-success', created + ' ' + t('csvImportCreated', 'created')) +
      badge('badge-primary', updated + ' ' + t('csvImportUpdated', 'updated')) +
      (skipped ? badge('badge-danger', skipped + ' ' + t('csvImportSkipped', 'skipped')) : '') +
    '</div>';
  if (errors.length) {
    html += '<div style="margin-top:0.5rem;padding:0.6rem 0.75rem;background:var(--bg-secondary, rgba(0,0,0,0.04));border-radius:8px;max-height:160px;overflow:auto;font-size:0.85rem;">';
    errors.forEach(e => {
      html += '<div style="margin:0.15rem 0;">' + escapeHtml(String(e.message || '')) + '</div>';
    });
    html += '</div>';
  }
  box.innerHTML = html;
  box.style.display = 'block';
}

async function submitCsvImport(overlay) {
  const input = overlay.querySelector('#csvFileInput');
  const file = input && input.files && input.files[0];
  if (!file) {
    if (window.Toast) window.Toast.warning(t('csvChooseFile', 'Choose a CSV file'));
    return;
  }
  const btn = overlay.querySelector('#csvImportSubmit');
  const lbl = btn ? btn.querySelector('span') : null;
  if (btn) btn.disabled = true;
  if (lbl) { lbl.dataset.orig = lbl.textContent; lbl.textContent = t('csvImporting', 'Importing...'); }
  try {
    const fd = new FormData();
    fd.append('file', file, file.name || 'products.csv');
    const r = await apiFetch.post('/api/products/import', fd);
    if (r && r.success) {
      const d = r.data || {};
      showImportResult(overlay, d);
      if (window.Toast) window.Toast.success(r.message || t('csvImportDone', 'Products imported successfully'));
      await refreshTable();
    } else {
      throw new Error((r && r.message) || t('csvImportFailed', 'Import failed'));
    }
  } catch (e) {
    console.error('[products] import error:', e);
    if (window.Toast) window.Toast.error((e && e.message) || t('csvImportFailed', 'Import failed'));
  } finally {
    if (btn) btn.disabled = false;
    if (lbl && lbl.dataset.orig) { lbl.textContent = lbl.dataset.orig; delete lbl.dataset.orig; }
  }
}

/* ---------- Entry ---------- */
export async function renderProductsPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.search = ''; state.category = ''; state.status = '';
  content.innerHTML = renderSkeleton();

  // ✅ تأكد من تحميل الفئات أولاً
  await fetchCategories();
  console.log('✅ Categories loaded in renderProductsPage:', state.categories.length);
  
  await fetchProducts();
  render();
}
