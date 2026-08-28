/* ============================================================
 * js/modules/users.js
 * ------------------------------------------------------------
 * Renders the Users management page into #pageContent. (admin only)
 *
 * Features:
 *   • Toolbar: search, role filter, status filter, refresh
 *   • Server-side paginated table
 *   • Add / Edit modal appended to <body>
 *   • Delete via Toast.confirm() with 400-error handling
 *     (user has sales/sessions → cannot delete)
 *   • Reset-password action via Toast.prompt → PUT /api/users/:id
 *   • Self-delete protection (compares with localStorage user id)
 *   • All text via window.t(), all API calls via window.apiFetch()
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  page: 1,
  limit: 20,
  search: '',
  role: '',     // '' | 'admin' | 'manager' | 'cashier'
  status: '',   // '' | 'active' | 'inactive'
  pagination: null,
  items: []
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function currentUserId() {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u._id || u.id || ''; } catch { return ''; }
}

function roleBadge(role) {
  if (role === 'admin')   return '<span class="badge badge-danger">'  + t('roleAdmin', 'Admin')   + '</span>';
  if (role === 'manager') return '<span class="badge badge-warning">' + t('roleManager', 'Manager') + '</span>';
  if (role === 'cashier') return '<span class="badge badge-info">'    + t('roleCashier', 'Cashier') + '</span>';
  return '<span class="badge badge-muted">' + escapeHtml(role || '—') + '</span>';
}

function statusBadge(isActive) {
  return isActive === false
    ? '<span class="badge badge-muted">' + t('inactive', 'Inactive') + '</span>'
    : '<span class="badge badge-success">' + t('active', 'Active') + '</span>';
}

function isValidEmail(s) {
  // Accept any non-empty string (user wants to allow usernames/identifiers, not strict emails)
  return typeof s === 'string' && s.trim().length > 0;
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
      ${[1,2,3,4,5,6].map(() => `<div class="skeleton skeleton-line" style="height:48px;margin:0;border-radius:0;"></div>`).join('')}
    </div>`;
}

/* ---------- Header ---------- */
function renderHeader() {
  return `
    <div class="page-header">
      <div class="page-title-block">
        <div class="page-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;color:var(--primary);"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span class="page-title-text">${t('users', 'Users')}</span>
        </div>
        <div class="page-subtitle">${t('usersSubtitle', 'Manage user accounts and their access rights')}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="addUserBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('addUser', 'Add user')}</span>
        </button>
      </div>
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
          <input class="input" id="userSearch" type="search"
                 placeholder="${escapeHtml(t('searchUsers', 'Search by name or email...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <select class="select" id="userRoleFilter" aria-label="${t('role', 'Role')}">
          <option value=""        ${state.role === '' ? 'selected' : ''}>${t('allRoles', 'All roles')}</option>
          <option value="admin"   ${state.role === 'admin' ? 'selected' : ''}>${t('roleAdmin', 'Admin')}</option>
          <option value="manager" ${state.role === 'manager' ? 'selected' : ''}>${t('roleManager', 'Manager')}</option>
          <option value="cashier" ${state.role === 'cashier' ? 'selected' : ''}>${t('roleCashier', 'Cashier')}</option>
        </select>
        <select class="select" id="userStatusFilter" aria-label="${t('status', 'Status')}">
          <option value=""        ${state.status === '' ? 'selected' : ''}>${t('allStatuses', 'All statuses')}</option>
          <option value="active"   ${state.status === 'active' ? 'selected' : ''}>${t('active', 'Active')}</option>
          <option value="inactive" ${state.status === 'inactive' ? 'selected' : ''}>${t('inactive', 'Inactive')}</option>
        </select>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="userRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'Refresh')}</span>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="empty-title">${t('noUsersMatch', 'No matching users')}</div>
        <div class="empty-subtitle">${t('noUsers', 'No users found')}</div>
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="emptyAddUserBtn" type="button">${t('addUser', 'Add user')}</button>
        </div>
      </div>`;
  }

  const meId = currentUserId();
  const rows = state.items.map((u, i) => {
    const idx = (state.page - 1) * state.limit + i + 1;
    const isSelf = u._id === meId;
    const lastLogin = u.lastLogin ? fmtDateTime(u.lastLogin) : '<span class="cell-muted">' + t('never', 'Never') + '</span>';
    return `
      <tr>
        <td class="cell-muted" data-label="#">${idx}</td>
        <td class="cell-strong" data-label="${t('name', 'Name')}">${escapeHtml(u.name || '—')}${isSelf ? ' <span class="badge badge-info" style="margin-inline-start:0.4rem;">' + t('you', 'You') + '</span>' : ''}</td>
        <td class="cell-muted" data-label="${t('email', 'Email')}">${escapeHtml(u.email || '—')}</td>
        <td data-label="${t('role', 'Role')}">${roleBadge(u.role)}</td>
        <td data-label="${t('status', 'Status')}">${statusBadge(u.isActive)}</td>
        <td class="cell-muted" data-label="${t('created', 'Created')}"><span dir="ltr">${escapeHtml(fmtDate(u.createdAt))}</span></td>
        <td class="cell-muted" data-label="${t('lastLogin', 'Last login')}">${lastLogin}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn edit" data-id="${u._id}" aria-label="${t('edit', 'Edit')}" title="${t('edit', 'Edit')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="table-action-btn view" data-id="${u._id}" data-action="reset" aria-label="${t('resetPassword', 'Reset password')}" title="${t('resetPassword', 'Reset password')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            </button>
            <button class="table-action-btn delete" data-id="${u._id}" data-name="${escapeHtml(u.name || '')}" data-self="${isSelf ? '1' : '0'}" aria-label="${t('delete', 'Delete')}" title="${t('delete', 'Delete')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
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
            <th>${t('name', 'Name')}</th>
            <th>${t('email', 'Email')}</th>
            <th>${t('role', 'Role')}</th>
            <th>${t('status', 'Status')}</th>
            <th>${t('created', 'Created')}</th>
            <th>${t('lastLogin', 'Last login')}</th>
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
async function fetchUsers() {
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  if (state.role) qs.role = state.role;
  // Backend doesn't filter isActive via query → apply client-side
  try {
    const r = await apiFetch.get('/api/users', qs);
    if (r && r.success) {
      let items = r.data || [];
      if (state.status === 'active')   items = items.filter(u => u.isActive !== false);
      if (state.status === 'inactive') items = items.filter(u => u.isActive === false);
      state.items = items;
      state.pagination = { page: r.page, limit: r.limit, total: r.total, totalPages: r.totalPages };
    } else { state.items = []; state.pagination = null; }
  } catch (e) {
    console.error('[users] fetchUsers', e);
    state.items = []; state.pagination = null;
  }
}

/* ---------- Render + bind ---------- */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = renderHeader() + renderToolbar() + '<div id="usersTableContainer">' + renderTable() + '</div>';
  bindToolbar();
  bindTable();
}

function bindToolbar() {
  const search = document.getElementById('userSearch');
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
  const role = document.getElementById('userRoleFilter');
  if (role) role.addEventListener('change', () => { state.role = role.value; state.page = 1; refreshTable(); });
  const st = document.getElementById('userStatusFilter');
  if (st) st.addEventListener('change', () => { state.status = st.value; state.page = 1; refreshTable(); });
  const addBtn = document.getElementById('addUserBtn');
  if (addBtn) addBtn.addEventListener('click', () => openUserModal(null));
  const emptyAdd = document.getElementById('emptyAddUserBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openUserModal(null));
  const refBtn = document.getElementById('userRefreshBtn');
  if (refBtn) refBtn.addEventListener('click', () => refreshTable());
}

function bindTable() {
  document.querySelectorAll('#usersTableContainer .table-action-btn.edit').forEach(b => {
    b.addEventListener('click', () => {
      const u = state.items.find(x => x._id === b.dataset.id);
      if (u) openUserModal(u);
    });
  });
  document.querySelectorAll('#usersTableContainer .table-action-btn.view[data-action="reset"]').forEach(b => {
    b.addEventListener('click', () => {
      const u = state.items.find(x => x._id === b.dataset.id);
      if (u) resetPassword(u);
    });
  });
  document.querySelectorAll('#usersTableContainer .table-action-btn.delete').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const name = b.dataset.name || '—';
      const isSelf = b.dataset.self === '1';
      if (isSelf) {
        if (window.Toast) window.Toast.warning(t('cannotDeleteSelf', 'You cannot delete your own account'));
        return;
      }
      const ok = await (window.Toast && window.Toast.confirm
        ? window.Toast.confirm(t('deleteConfirm', 'Delete "{name}"?').replace('{name}', name))
        : Promise.resolve(true));
      if (!ok) return;
      try {
        const r = await apiFetch.delete('/api/users/' + id);
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('userDeleted', 'User deleted'));
          refreshTable();
        } else {
          throw new Error((r && r.message) || 'Failed');
        }
      } catch (e) {
        const msg = (e && e.message) || '';
        const status = e && e.status;
        if (status === 400 || /cannot delete|admin|sales|sessions|مبيعات|ورديات|لا يمكن/i.test(msg)) {
          if (window.Toast) window.Toast.error(t('userHasDependencies', 'This user has sales or sessions and cannot be deleted'));
        } else {
          if (window.Toast) window.Toast.error(msg || t('deleteFailed', 'Delete failed'));
        }
      }
    });
  });
  document.querySelectorAll('#usersTableContainer .page-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshTable(); }
    });
  });
}

async function refreshTable() {
  const container = document.getElementById('usersTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'Loading...') + '</span></div>';
  await fetchUsers();
  if (container) container.innerHTML = renderTable();
  bindTable();
}

/* ---------- Reset password ---------- */
async function resetPassword(u) {
  if (!u || !u._id) return;
  const pwd = await (window.Toast && window.Toast.prompt
    ? window.Toast.prompt({
        title: t('resetPassword', 'Reset password'),
        message: t('resetPasswordFor', 'Enter a new password for "{name}"').replace('{name}', u.name || u.email),
        inputType: 'password',
        placeholder: t('newPasswordPlaceholder', 'Enter new password (min 8 chars)')
      })
    : Promise.resolve(window.prompt('New password?', '')));
  if (pwd === null) return;
  if (typeof pwd === 'string' && pwd.length < 8) {
    if (window.Toast) window.Toast.error(t('passwordTooShort', 'Password must be at least 8 characters'));
    return;
  }
  try {
    const r = await apiFetch.put('/api/users/' + u._id, { password: pwd });
    if (r && r.success) {
      if (window.Toast) window.Toast.success(t('passwordReset', 'Password reset successfully'));
    } else {
      throw new Error((r && r.message) || 'Failed');
    }
  } catch (e) {
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
  }
}

/* ---------- Add / Edit modal ---------- */
function openUserModal(user) {
  const isEdit = !!user;
  const html = `
    <div class="modal-overlay" id="userModal" role="dialog" aria-modal="true" aria-labelledby="userModalTitle">
      <div class="modal" role="document">
        <div class="modal-header">
          <div class="modal-title" id="userModalTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>${isEdit ? t('editUser', 'Edit user') : t('addUser', 'Add user')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${t('close', 'Close')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="userForm">
          <div class="modal-body">
            <input type="hidden" id="userId" value="${user ? user._id || '' : ''}" />

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">${t('fullName', 'Full name')} <span class="req">*</span></label>
                <input class="input" id="uName" type="text" required value="${user && user.name ? escapeHtml(user.name) : ''}" />
              </div>
              <div class="form-group">
                <label class="form-label">${t('email', 'Email')} <span class="req">*</span></label>
                <input class="input" id="uEmail" type="text" required value="${user && user.email ? escapeHtml(user.email) : ''}" ${isEdit ? 'readonly style="opacity:0.7;cursor:not-allowed;"' : ''} />
                ${isEdit ? '<div class="help-text">' + t('emailNotEditable', 'Email cannot be changed') + '</div>' : ''}
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">${t('password', 'Password')} ${isEdit ? '' : '<span class="req">*</span>'}</label>
                <input class="input" id="uPassword" type="password" ${isEdit ? '' : 'required'} minlength="8" autocomplete="new-password" />
                <div class="help-text">${isEdit ? t('passwordLeaveBlank', 'Leave blank to keep the current password') : t('passwordMinLength', 'Minimum 8 characters')}</div>
              </div>
              <div class="form-group">
                <label class="form-label">${t('role', 'Role')} <span class="req">*</span></label>
                <select class="select" id="uRole" required>
                  <option value="cashier" ${!user || user.role === 'cashier' ? 'selected' : ''}>${t('roleCashier', 'Cashier')}</option>
                  <option value="manager" ${user && user.role === 'manager' ? 'selected' : ''}>${t('roleManager', 'Manager')}</option>
                  <option value="admin"   ${user && user.role === 'admin' ? 'selected' : ''}>${t('roleAdmin', 'Admin')}</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">${t('status', 'Status')}</label>
                <select class="select" id="uIsActive">
                  <option value="true"  ${!user || user.isActive !== false ? 'selected' : ''}>${t('active', 'Active')}</option>
                  <option value="false" ${user && user.isActive === false ? 'selected' : ''}>${t('inactive', 'Inactive')}</option>
                </select>
              </div>
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
  const overlay = document.getElementById('userModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = overlay.querySelector('#userId').value;
    const name = overlay.querySelector('#uName').value.trim();
    const email = overlay.querySelector('#uEmail').value.trim();
    const password = overlay.querySelector('#uPassword').value;
    const role = overlay.querySelector('#uRole').value;
    const isActive = overlay.querySelector('#uIsActive').value === 'true';

    if (!name) { if (window.Toast) window.Toast.error(t('nameRequired', 'Name is required')); return; }
    if (!email || !isValidEmail(email)) { if (window.Toast) window.Toast.error(t('emailInvalid', 'Please enter a valid email')); return; }
    if (!isEdit && (!password || password.length < 8)) {
      if (window.Toast) window.Toast.error(t('passwordMinLength', 'Minimum 8 characters'));
      return;
    }
    if (isEdit && password && password.length < 8) {
      if (window.Toast) window.Toast.error(t('passwordMinLength', 'Minimum 8 characters'));
      return;
    }

    const body = { name, email, role, isActive };
    if (!isEdit) body.password = password;
    else if (password) body.password = password;

    const btn = overlay.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const url = id ? '/api/users/' + id : '/api/users';
      const r = id ? await apiFetch.put(url, body) : await apiFetch.post(url, body);
      if (r && r.success) {
        if (window.Toast) window.Toast.success(id ? t('userUpdated', 'User updated') : t('userCreated', 'User created'));
        close();
        await refreshTable();
      } else {
        throw new Error((r && r.message) || 'Failed');
      }
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/exists|موجود|existe|already/i.test(msg)) {
        if (window.Toast) window.Toast.error(t('emailExists', 'Email already in use'));
      } else {
        if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  setTimeout(() => { const first = overlay.querySelector('#uName'); if (first) first.focus(); }, 50);
}

/* ---------- Entry ---------- */
export async function renderUsersPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.page = 1; state.search = ''; state.role = ''; state.status = '';
  content.innerHTML = renderSkeleton();
  await fetchUsers();
  render();
}
