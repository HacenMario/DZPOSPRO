/* ============================================================
 * js/modules/employees.js  —  v4.5
 * ------------------------------------------------------------
 * Renders the Employees & Attendance (الموظفون والدوام) page
 * into #pageContent.
 *
 * TAB A — الموظفون (employees):
 *   • Toolbar: debounced search (300ms) + ➕ add + refresh
 *   • Server-paginated table (limit 20) with per-row actions:
 *     edit ✏️ · day sheet 📅 (jumps to TAB B) · toggle active ⏸/▶ · delete 🗑
 *   • Add/Edit modal (#employeeModal) → POST/PUT /api/employees
 *   • Delete asks confirm (Toast.confirm → window.confirm fallback):
 *     deleting an employee also deletes its attendance history
 *
 * TAB B — الدوام (attendance):
 *   • Date picker (attDate, default today) → day sheet for ACTIVE employees
 *   • Per-row: status select (present/absent/leave/half_day/late),
 *     check-in / check-out time inputs, notes, 💾 save button
 *   • "💾 حفظ الكل" posts only rows whose values actually changed
 *     (dirty rows are highlighted live)
 *   • Monthly summary modal → /api/employees/attendance/summary
 *
 * Backend shapes:
 *   employee       { _id, name, phone, jobTitle, address, monthlySalary,
 *                    hiredAt, weeklyRestDay (0=الأحد..6=السبت), active, notes }
 *   attendance doc { _id, employee, day, status:'present'|'absent'|'leave'|
 *                    'half_day'|'late', checkIn, checkOut, workedMinutes, notes }
 *   day sheet item { employee: { id, name, jobTitle, phone, weeklyRestDay },
 *                    sheet: attendanceDoc | null }
 *   summary item   { employee: { id, name, jobTitle, monthlySalary },
 *                    days: { present, absent, leave, half_day, late },
 *                    workedHours, marked }
 *
 * Time inputs send ISO combined values: checkIn = date + 'T' + 'HH:MM'
 * (parsed server-side with new Date()).
 *
 * All text via window.t(), all API calls via window.apiFetch().
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

/* ---------- State ---------- */
let state = {
  tab: 'employees',            // 'employees' | 'attendance'

  /* Tab A — employees list */
  page: 1,
  limit: 20,
  search: '',
  pagination: null,
  items: [],

  /* Tab B — attendance day sheet */
  attDate: '',                 // YYYY-MM-DD
  attRows: [],                 // [{ employee, sheet }]
  attInit: {},                 // employeeId -> initial raw values (dirty tracking)
  attFocusId: null             // employee id to highlight when the sheet loads
};

/* ============================================================
 * Helpers
 * ============================================================ */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString('en-US') + ' DZD';
}

/* hiredAt may arrive as 'YYYY-MM-DD...' (no TZ shift) or a full ISO date.
 * Parse date-only strings manually to avoid timezone off-by-one errors. */
function fmtDateDMY(d) {
  if (!d) return '—';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm + '/' + dt.getFullYear();
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function currentMonthISO() {
  return todayISO().slice(0, 7); // YYYY-MM
}

/* ISO datetime → 'HH:MM' for <input type="time"> */
function isoToTime(v) {
  if (!v) return '';
  const dt = new Date(v);
  if (isNaN(dt.getTime())) return '';
  return String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
}

/* 'YYYY-MM-DD' → JS day number (0=Sunday..6=Saturday) — matches weeklyRestDay */
function dayNumOf(dateStr) {
  const dt = new Date(String(dateStr || '') + 'T00:00:00');
  return isNaN(dt.getTime()) ? -1 : dt.getDay();
}

function restDayName(v) {
  const n = Number(v);
  if (isNaN(n) || n < 0 || n > 6) return '—';
  const keys = ['attDay0', 'attDay1', 'attDay2', 'attDay3', 'attDay4', 'attDay5', 'attDay6'];
  const fb   = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return t(keys[n], fb[n]);
}

function attStatusBadge(status) {
  if (status === 'present')  return '<span class="badge badge-success">' + t('attStPresent', 'حاضر') + '</span>';
  if (status === 'absent')   return '<span class="badge badge-danger">'  + t('attStAbsent', 'غائب') + '</span>';
  if (status === 'leave')    return '<span class="badge badge-info">'    + t('attStLeave', 'إجازة') + '</span>';
  if (status === 'late')     return '<span class="badge badge-warning">' + t('attStLate', 'متأخر') + '</span>';
  if (status === 'half_day') return '<span class="badge badge-muted">'   + t('attStHalfDay', 'نصف يوم') + '</span>';
  return '<span class="badge badge-muted">' + escapeHtml(status || '—') + '</span>';
}

function toast(type, msg) {
  if (window.Toast && typeof window.Toast[type] === 'function') window.Toast[type](msg);
  else if (type === 'error') console.error('[employees]', msg);
}

/* ============================================================
 * Modal wiring (✕ / cancel / Esc / overlay-click) — sessions.js pattern
 * ============================================================ */
function closeModalEl(overlay) {
  if (!overlay) return;
  if (overlay.__escHandler) document.removeEventListener('keydown', overlay.__escHandler);
  overlay.remove();
}

function attachModalHandlers(overlay, close) {
  const x = overlay.querySelector('.modal-close');
  if (x) x.addEventListener('click', close);
  const cancel = overlay.querySelector('[data-action="cancel"]');
  if (cancel) cancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.__escHandler = onKey; // removed by closeModalEl()
}

/* ============================================================
 * Skeleton
 * ============================================================ */
function renderSkeleton() {
  return `
    <div class="tabs">
      <div class="tab-list">
        <div class="skeleton" style="height:32px;width:120px;border-radius:8px;"></div>
        <div class="skeleton" style="height:32px;width:120px;border-radius:8px;"></div>
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

/* ============================================================
 * Page header + tabs
 * ============================================================ */
function renderHeader() {
  return `
    <div class="page-header">
      <div class="page-title-block">
        <div class="page-title">
          <span class="page-title-text">👥 ${t('employees', 'الموظفون والدوام')}</span>
        </div>
        <div class="page-subtitle">${t('employeesPageSubtitle', 'سجل الموظفين، الحضور اليومي والملخص الشهري — نظام دوام احترافي')}</div>
      </div>
    </div>`;
}

function renderTabs() {
  const tabs = [
    { id: 'employees',  label: '👥 ' + t('empTabRegister', 'الموظفون') },
    { id: 'attendance', label: '🗓️ ' + t('empTabAttendance', 'الدوام') }
  ];
  return `
    <div class="tabs">
      <div class="tab-list" role="tablist">
        ${tabs.map(tb => `
          <button type="button" class="tab-item ${state.tab === tb.id ? 'active' : ''}" data-tab="${tb.id}"
                  role="tab" aria-selected="${state.tab === tb.id ? 'true' : 'false'}">${tb.label}</button>`).join('')}
      </div>
    </div>`;
}

/* ============================================================
 * TAB A — Employees
 * ============================================================ */
function renderEmployeesToolbar() {
  return `
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" id="empSearch" type="search"
                 placeholder="${escapeHtml(t('empSearchPlaceholder', 'ابحث بالاسم أو الهاتف أو المنصب...'))}"
                 value="${escapeHtml(state.search)}" />
        </div>
        <button class="btn btn-primary" id="empAddBtn" type="button">➕ <span>${t('empAdd', 'إضافة موظف')}</span></button>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="empRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'تحديث')}</span>
        </button>
      </div>
    </div>`;
}

function employeeStatusBadge(emp) {
  return emp.active === false
    ? '<span class="badge badge-muted">' + t('empInactive', 'موقوف') + '</span>'
    : '<span class="badge badge-success">' + t('empActive', 'نشط') + '</span>';
}

function renderEmployeesTable() {
  if (!state.items.length) {
    const filtered = !!(state.search || state.page > 1);
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="empty-title">${t('empEmptyTitle', 'لا يوجد موظفون')}</div>
        <div class="empty-subtitle">${filtered
          ? t('empNoMatchSubtitle', 'لا يوجد موظفون مطابقون لبحثك')
          : t('empEmptySubtitle', 'ابدأ بإضافة موظفك الأول لتتبع الحضور والرواتب')}</div>
        ${filtered ? '' : `
        <div class="empty-action">
          <button class="btn btn-primary btn-sm" id="empAddFirstBtn" type="button">➕ ${t('empAddFirst', 'إضافة أول موظف')}</button>
        </div>`}
      </div>`;
  }

  const rows = state.items.map((emp, i) => {
    const idx = (state.page - 1) * state.limit + i + 1;
    const isActive = emp.active !== false;
    return `
      <tr>
        <td class="cell-muted" data-label="#">${idx}</td>
        <td class="cell-strong" data-label="${escapeHtml(t('empName', 'الاسم'))}">
          <div class="emp-name-block">
            <span>${escapeHtml(emp.name || '—')}</span>
            ${emp.jobTitle ? `<span class="emp-job">${escapeHtml(emp.jobTitle)}</span>` : ''}
          </div>
        </td>
        <td class="cell-muted" data-label="${escapeHtml(t('empPhone', 'الهاتف'))}">${escapeHtml(emp.phone || '—')}</td>
        <td data-label="${escapeHtml(t('empJobTitle', 'المنصب'))}">${escapeHtml(emp.jobTitle || '—')}</td>
        <td data-label="${escapeHtml(t('empSalary', 'الراتب الشهري'))}">${escapeHtml(fmtMoney(emp.monthlySalary))}</td>
        <td class="cell-muted" data-label="${escapeHtml(t('empHiredAt', 'تاريخ التعيين'))}">${escapeHtml(fmtDateDMY(emp.hiredAt))}</td>
        <td data-label="${escapeHtml(t('status', 'الحالة'))}">${employeeStatusBadge(emp)}</td>
        <td data-label="${escapeHtml(t('actions', 'الإجراءات'))}">
          <div class="table-actions">
            <button class="table-action-btn edit" data-id="${emp._id}" data-action="edit"
                    aria-label="${escapeHtml(t('empEdit', 'تعديل الموظف'))}" title="${escapeHtml(t('empEdit', 'تعديل الموظف'))}">✏️</button>
            <button class="table-action-btn view" data-id="${emp._id}" data-action="attendance"
                    aria-label="${escapeHtml(t('empMarkAttendance', 'تسجيل الحضور'))}" title="${escapeHtml(t('empMarkAttendance', 'تسجيل الحضور'))}">📅</button>
            <button class="table-action-btn view" data-id="${emp._id}" data-action="toggle"
                    aria-label="${escapeHtml(isActive ? t('empDeactivate', 'إيقاف الموظف') : t('empActivate', 'تفعيل الموظف'))}"
                    title="${escapeHtml(isActive ? t('empDeactivate', 'إيقاف الموظف') : t('empActivate', 'تفعيل الموظف'))}">${isActive ? '⏸️' : '▶️'}</button>
            <button class="table-action-btn delete" data-id="${emp._id}" data-name="${escapeHtml(emp.name || '')}" data-action="delete"
                    aria-label="${escapeHtml(t('delete', 'حذف'))}" title="${escapeHtml(t('delete', 'حذف'))}">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  const p = state.pagination || { page: state.page, totalPages: 1, total: state.items.length, limit: state.limit };
  const from = p.total === 0 ? 0 : ((p.page - 1) * p.limit + 1);
  const to = Math.min(p.page * p.limit, p.total);
  const pageBtns = [];
  pageBtns.push(`<button class="page-btn" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''} aria-label="${escapeHtml(t('previous', 'السابق'))}">«</button>`);
  let start = Math.max(1, p.page - 2), end = Math.min(p.totalPages || 1, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) {
    pageBtns.push(`<button class="page-btn ${i === p.page ? 'active' : ''}" data-page="${i}">${i}</button>`);
  }
  pageBtns.push(`<button class="page-btn" data-page="${p.page + 1}" ${p.page >= (p.totalPages || 1) ? 'disabled' : ''} aria-label="${escapeHtml(t('next', 'التالي'))}">»</button>`);

  return `
    <div class="table-wrap">
      <table class="table table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>${t('empName', 'الاسم')}</th>
            <th>${t('empPhone', 'الهاتف')}</th>
            <th>${t('empJobTitle', 'المنصب')}</th>
            <th>${t('empSalary', 'الراتب الشهري')}</th>
            <th>${t('empHiredAt', 'تاريخ التعيين')}</th>
            <th>${t('status', 'الحالة')}</th>
            <th>${t('actions', 'الإجراءات')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-top:0.85rem;">
      <div class="page-info">${t('showing', 'عرض')} ${from}–${to} ${t('of', 'من')} ${p.total} ${t('results', 'نتيجة')}</div>
      <div class="pagination">${pageBtns.join('')}</div>
    </div>`;
}

function renderEmployeesTab() {
  return `
    ${renderEmployeesToolbar()}
    <div id="empTableContainer">${renderEmployeesTable()}</div>`;
}

/* ============================================================
 * TAB B — Attendance day sheet
 * ============================================================ */
function renderAttendanceToolbar() {
  return `
    <div class="toolbar">
      <div class="toolbar-left">
        <input class="input att-date-input" id="attDate" type="date" value="${escapeHtml(state.attDate)}"
               aria-label="${escapeHtml(t('attDateLabel', 'التاريخ'))}" />
        <button class="btn btn-primary btn-sm" id="attSaveAllBtn" type="button">💾 <span>${t('attSaveAll', 'حفظ الكل')}</span></button>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" id="attSummaryBtn" type="button">📊 <span>${t('empMonthlySummary', 'الملخص الشهري')}</span></button>
        <button class="btn btn-secondary btn-sm" id="attRefreshBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('refresh', 'تحديث')}</span>
        </button>
      </div>
    </div>
    <div class="att-legend" aria-hidden="true">
      ${attStatusBadge('present')}
      ${attStatusBadge('absent')}
      ${attStatusBadge('leave')}
      ${attStatusBadge('late')}
      ${attStatusBadge('half_day')}
    </div>`;
}

function renderDaySheet() {
  if (!state.attRows.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div class="empty-title">${t('attNoEmployees', 'لا يوجد موظفون نشطون')}</div>
        <div class="empty-subtitle">${t('attNoEmployeesSub', 'أضف موظفين من تبويب «الموظفون» لبدء تسجيل الحضور')}</div>
      </div>`;
  }

  const restDayNum = dayNumOf(state.attDate);
  const rows = state.attRows.map((row) => {
    const emp = row.employee || {};
    const sh = row.sheet || null;
    const init = state.attInit[emp.id] || { status: 'present', checkIn: '', checkOut: '', notes: '' };
    const isRestDay = emp.weeklyRestDay !== null && emp.weeklyRestDay !== undefined && Number(emp.weeklyRestDay) === restDayNum;
    const savedChip = sh ? attStatusBadge(sh.status) : '';
    return `
      <tr data-emp-id="${escapeHtml(emp.id)}">
        <td class="cell-strong" data-label="${escapeHtml(t('attColEmployee', 'الموظف'))}">
          <div class="emp-name-block">
            <span>${escapeHtml(emp.name || '—')}${savedChip ? ' ' + savedChip : ''}</span>
            <span class="emp-job">${escapeHtml(emp.jobTitle || '')}${isRestDay ? ` · <span class="badge badge-muted" title="${escapeHtml(restDayName(emp.weeklyRestDay))}">😴 ${t('attRestDay', 'يوم راحة')}</span>` : ''}</span>
          </div>
        </td>
        <td data-label="${escapeHtml(t('attColStatus', 'الحالة'))}">
          <select class="select att-status" aria-label="${escapeHtml(t('attColStatus', 'الحالة'))}">
            <option value="present"  ${init.status === 'present'  ? 'selected' : ''}>${t('attStPresent', 'حاضر')}</option>
            <option value="absent"   ${init.status === 'absent'   ? 'selected' : ''}>${t('attStAbsent', 'غائب')}</option>
            <option value="leave"    ${init.status === 'leave'    ? 'selected' : ''}>${t('attStLeave', 'إجازة')}</option>
            <option value="half_day" ${init.status === 'half_day' ? 'selected' : ''}>${t('attStHalfDay', 'نصف يوم')}</option>
            <option value="late"     ${init.status === 'late'     ? 'selected' : ''}>${t('attStLate', 'متأخر')}</option>
          </select>
        </td>
        <td data-label="${escapeHtml(t('attColCheckIn', 'الدخول'))}">
          <input class="input att-in" type="time" value="${escapeHtml(init.checkIn)}" aria-label="${escapeHtml(t('attColCheckIn', 'الدخول'))}" />
        </td>
        <td data-label="${escapeHtml(t('attColCheckOut', 'الخروج'))}">
          <input class="input att-out" type="time" value="${escapeHtml(init.checkOut)}" aria-label="${escapeHtml(t('attColCheckOut', 'الخروج'))}" />
        </td>
        <td data-label="${escapeHtml(t('attColNotes', 'ملاحظات'))}">
          <input class="input att-notes-input att-notes" type="text" value="${escapeHtml(init.notes)}"
                 placeholder="${escapeHtml(t('attNotesPlaceholder', 'ملاحظة (اختياري)'))}" />
        </td>
        <td data-label="${escapeHtml(t('attColSave', 'حفظ'))}">
          <button class="btn btn-primary btn-sm att-save-btn att-save" type="button"
                  title="${escapeHtml(t('attSaveRow', 'حفظ هذا السجل'))}">💾</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="table table-hover">
        <thead>
          <tr>
            <th>${t('attColEmployee', 'الموظف')}</th>
            <th>${t('attColStatus', 'الحالة')}</th>
            <th>${t('attColCheckIn', 'الدخول')}</th>
            <th>${t('attColCheckOut', 'الخروج')}</th>
            <th>${t('attColNotes', 'ملاحظات')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderAttendanceTab() {
  return `
    ${renderAttendanceToolbar()}
    <div class="att-sheet" id="attSheetContainer">${renderDaySheet()}</div>`;
}

/* ============================================================
 * Fetch — employees
 * ============================================================ */
async function fetchEmployees() {
  const qs = { page: state.page, limit: state.limit };
  if (state.search) qs.search = state.search;
  try {
    const r = await apiFetch.get('/api/employees', qs);
    if (r && r.success) {
      // Primary shape: { success, data: { data: [...], total, page, limit } }
      const d = r.data;
      if (Array.isArray(d)) {
        // Flat-shape fallback: { success, data: [...], page, total, limit }
        const limit = r.limit || state.limit;
        const total = typeof r.total === 'number' ? r.total : d.length;
        state.items = d;
        state.pagination = {
          page: r.page || state.page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit))
        };
      } else if (d && Array.isArray(d.data)) {
        const limit = d.limit || state.limit;
        const total = typeof d.total === 'number' ? d.total : d.data.length;
        state.items = d.data;
        state.pagination = {
          page: d.page || state.page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit))
        };
      } else {
        state.items = []; state.pagination = null;
      }
    } else {
      state.items = []; state.pagination = null;
    }
  } catch (e) {
    console.error('[employees] fetchEmployees', e);
    toast('error', (e && e.message) || t('error', 'حدث خطأ'));
    state.items = []; state.pagination = null;
  }
}

/* ============================================================
 * Fetch — attendance day sheet
 * ============================================================ */
async function fetchDaySheet() {
  try {
    const r = await apiFetch.get('/api/employees/attendance', { date: state.attDate });
    state.attRows = (r && r.success && r.data && Array.isArray(r.data.data)) ? r.data.data : [];
  } catch (e) {
    console.error('[employees] fetchDaySheet', e);
    toast('error', (e && e.message) || t('error', 'حدث خطأ'));
    state.attRows = [];
  }
}

/* Build the initial-values snapshot used for dirty-row detection */
function buildInit() {
  state.attInit = {};
  state.attRows.forEach((row) => {
    const emp = row.employee || {};
    const sh = row.sheet || null;
    if (!emp.id) return;
    state.attInit[emp.id] = {
      status: sh && sh.status ? sh.status : 'present',
      checkIn: isoToTime(sh && sh.checkIn),
      checkOut: isoToTime(sh && sh.checkOut),
      notes: (sh && sh.notes) || ''
    };
  });
}

/* ============================================================
 * Day sheet — row value collection / dirty tracking
 * ============================================================ */
function collectRowRaw(tr) {
  return {
    id: tr.getAttribute('data-emp-id'),
    status: (tr.querySelector('.att-status') || {}).value || 'present',
    checkIn: (tr.querySelector('.att-in') || {}).value || '',
    checkOut: (tr.querySelector('.att-out') || {}).value || '',
    notes: ((tr.querySelector('.att-notes') || {}).value || '').trim()
  };
}

function collectRowBody(tr) {
  const raw = collectRowRaw(tr);
  return {
    employeeId: raw.id,
    date: state.attDate,
    status: raw.status,
    checkIn: raw.checkIn ? (state.attDate + 'T' + raw.checkIn) : null,
    checkOut: raw.checkOut ? (state.attDate + 'T' + raw.checkOut) : null,
    notes: raw.notes
  };
}

function isRowDirty(tr) {
  const cur = collectRowRaw(tr);
  const init = state.attInit[cur.id] || { status: 'present', checkIn: '', checkOut: '', notes: '' };
  return cur.status !== init.status ||
         cur.checkIn !== init.checkIn ||
         cur.checkOut !== init.checkOut ||
         cur.notes !== init.notes;
}

function markDirtyRows() {
  const container = document.getElementById('attSheetContainer');
  if (!container) return;
  container.querySelectorAll('tr[data-emp-id]').forEach((tr) => {
    tr.classList.toggle('att-row-dirty', isRowDirty(tr));
  });
}

function markRowClean(tr, raw) {
  state.attInit[raw.id] = {
    status: raw.status,
    checkIn: raw.checkIn,
    checkOut: raw.checkOut,
    notes: raw.notes
  };
  tr.classList.remove('att-row-dirty');
}

/* ============================================================
 * Day sheet — save (single row / all dirty rows)
 * ============================================================ */
async function saveRow(tr, btn) {
  if (!tr) return;
  const body = collectRowBody(tr);
  const raw = collectRowRaw(tr);
  if (btn) btn.disabled = true;
  try {
    const r = await apiFetch.post('/api/employees/attendance', body);
    if (r && r.success) {
      markRowClean(tr, raw);
      toast('success', t('saved', 'تم الحفظ'));
    } else {
      throw new Error((r && r.message) || t('error', 'حدث خطأ'));
    }
  } catch (e) {
    toast('error', (e && e.message) || t('error', 'حدث خطأ'));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveAllRows(btn) {
  const container = document.getElementById('attSheetContainer');
  if (!container) return;
  const dirty = Array.from(container.querySelectorAll('tr[data-emp-id]')).filter(isRowDirty);
  if (!dirty.length) {
    toast('info', t('attNoChanges', 'لا توجد تغييرات لحفظها'));
    return;
  }
  if (btn) btn.disabled = true;
  let ok = 0, fail = 0;
  for (const tr of dirty) {
    const body = collectRowBody(tr);
    const raw = collectRowRaw(tr);
    try {
      const r = await apiFetch.post('/api/employees/attendance', body);
      if (r && r.success) { ok++; markRowClean(tr, raw); }
      else fail++;
    } catch (e) {
      console.error('[employees] saveAllRows', e);
      fail++;
    }
  }
  if (btn) btn.disabled = false;
  if (ok > 0) toast('success', t('saved', 'تم الحفظ') + ' (' + ok + ')');
  if (fail > 0) toast('error', t('attSavePartialFailed', 'تعذر حفظ بعض السجلات') + ' (' + fail + ')');
}

/* ============================================================
 * Monthly summary modal
 * ============================================================ */
async function openSummaryModal() {
  const month = currentMonthISO();
  const html = `
    <div class="modal-overlay" id="attSummaryModal" role="dialog" aria-modal="true" aria-labelledby="attSummaryTitle">
      <div class="modal modal-lg" role="document">
        <div class="modal-header">
          <div class="modal-title" id="attSummaryTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>📊 ${t('attSummaryTitle', 'الملخص الشهري للحضور')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${escapeHtml(t('close', 'إغلاق'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group" style="max-width:220px;">
            <label class="form-label" for="attSummaryMonth">${t('attSummaryMonth', 'الشهر')}</label>
            <input class="input" id="attSummaryMonth" type="month" value="${month}" />
          </div>
          <div class="table-wrap" id="attSummaryTableWrap">
            <div class="loading-state"><div class="spinner"></div><span>${t('loading', 'جارٍ التحميل...')}</span></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" type="button" data-action="cancel">${t('close', 'إغلاق')}</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('attSummaryModal');
  function close() { closeModalEl(overlay); }
  attachModalHandlers(overlay, close);

  async function load(monthVal) {
    const wrap = document.getElementById('attSummaryTableWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'جارٍ التحميل...') + '</span></div>';
    let rows = [];
    try {
      const r = await apiFetch.get('/api/employees/attendance/summary', { month: monthVal });
      rows = (r && r.success && r.data && Array.isArray(r.data.data)) ? r.data.data : [];
    } catch (e) {
      console.error('[employees] summary', e);
      toast('error', (e && e.message) || t('error', 'حدث خطأ'));
    }

    if (!rows.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">${t('attSummaryEmpty', 'لا توجد بيانات لهذا الشهر')}</div>
          <div class="empty-subtitle">${t('attSummaryEmptySub', 'سجّل الحضور اليومي أولاً لعرض الملخص')}</div>
        </div>`;
      return;
    }

    const trRows = rows.map((row) => {
      const emp = row.employee || {};
      const d = row.days || {};
      const hours = Number(row.workedHours || 0);
      const marked = !!row.marked;
      return `
        <tr>
          <td class="cell-strong" data-label="${escapeHtml(t('attSumColEmployee', 'الموظف'))}">
            <div class="emp-name-block">
              <span>${escapeHtml(emp.name || '—')}</span>
              ${emp.jobTitle ? `<span class="emp-job">${escapeHtml(emp.jobTitle)}</span>` : ''}
            </div>
          </td>
          <td data-label="${escapeHtml(t('attSumPresent', 'حاضر'))}">${Number(d.present || 0)}</td>
          <td data-label="${escapeHtml(t('attSumAbsent', 'غائب'))}">${Number(d.absent || 0)}</td>
          <td data-label="${escapeHtml(t('attSumLeave', 'إجازة'))}">${Number(d.leave || 0)}</td>
          <td data-label="${escapeHtml(t('attSumLate', 'متأخر'))}">${Number(d.late || 0)}</td>
          <td data-label="${escapeHtml(t('attSumHours', 'ساعات العمل'))}">${hours.toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>
          <td data-label="${escapeHtml(t('attSumMarked', 'تم التسجيل'))}">${marked
            ? '<span class="badge badge-success">✓ ' + t('attSumMarkedYes', 'معلّم') + '</span>'
            : '<span class="badge badge-muted">—</span>'}</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="table table-hover">
        <thead>
          <tr>
            <th>${t('attSumColEmployee', 'الموظف')}</th>
            <th>${t('attSumPresent', 'حاضر')}</th>
            <th>${t('attSumAbsent', 'غائب')}</th>
            <th>${t('attSumLeave', 'إجازة')}</th>
            <th>${t('attSumLate', 'متأخر')}</th>
            <th>${t('attSumHours', 'ساعات العمل')}</th>
            <th>${t('attSumMarked', 'تم التسجيل')}</th>
          </tr>
        </thead>
        <tbody>${trRows}</tbody>
      </table>`;
  }

  const monthInput = overlay.querySelector('#attSummaryMonth');
  if (monthInput) monthInput.addEventListener('change', () => load(monthInput.value || currentMonthISO()));

  await load(month);
}

/* ============================================================
 * Add / Edit employee modal (#employeeModal)
 * ============================================================ */
function openEmployeeModal(emp) {
  const isEdit = !!emp;
  const restOptions = [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const keys = ['attDay0', 'attDay1', 'attDay2', 'attDay3', 'attDay4', 'attDay5', 'attDay6'];
    const fb = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const selected = (isEdit ? Number(emp.weeklyRestDay) === n : n === 5) ? 'selected' : '';
    return `<option value="${n}" ${selected}>${t(keys[n], fb[n])}</option>`;
  }).join('');

  const hiredAtVal = emp && emp.hiredAt ? String(emp.hiredAt).slice(0, 10) : '';

  const html = `
    <div class="modal-overlay" id="employeeModal" role="dialog" aria-modal="true" aria-labelledby="employeeModalTitle">
      <div class="modal" role="document">
        <div class="modal-header">
          <div class="modal-title" id="employeeModalTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>${isEdit ? t('empModalEdit', 'تعديل الموظف') : t('empModalAdd', 'إضافة موظف')}</span>
          </div>
          <button class="modal-close" type="button" aria-label="${escapeHtml(t('close', 'إغلاق'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="employeeForm">
          <div class="modal-body">
            <input type="hidden" id="empId" value="${emp ? emp._id || '' : ''}" />

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="empNameInput">${t('empName', 'الاسم')} <span class="req">*</span></label>
                <input class="input" id="empNameInput" type="text" required value="${emp && emp.name ? escapeHtml(emp.name) : ''}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="empPhoneInput">${t('empPhone', 'الهاتف')}</label>
                <input class="input" id="empPhoneInput" type="tel" dir="ltr" value="${emp && emp.phone ? escapeHtml(emp.phone) : ''}" placeholder="05XXXXXXXX" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="empJobTitleInput">${t('empJobTitle', 'المنصب')}</label>
                <input class="input" id="empJobTitleInput" type="text" value="${emp && emp.jobTitle ? escapeHtml(emp.jobTitle) : ''}" placeholder="${escapeHtml(t('empJobTitlePlaceholder', 'بائع، أمين مخزن...'))}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="empSalaryInput">${t('empSalary', 'الراتب الشهري')} (DZD)</label>
                <input class="input" id="empSalaryInput" type="number" min="0" step="0.01" dir="ltr" value="${emp && emp.monthlySalary !== undefined && emp.monthlySalary !== null ? escapeHtml(String(emp.monthlySalary)) : ''}" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="empHiredAtInput">${t('empHiredAt', 'تاريخ التعيين')}</label>
                <input class="input" id="empHiredAtInput" type="date" value="${escapeHtml(hiredAtVal)}" />
              </div>
              <div class="form-group">
                <label class="form-label" for="empRestDaySelect">${t('empRestDay', 'يوم الراحة الأسبوعي')}</label>
                <select class="select" id="empRestDaySelect">${restOptions}</select>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="empAddressInput">${t('empAddress', 'العنوان')}</label>
              <input class="input" id="empAddressInput" type="text" value="${emp && emp.address ? escapeHtml(emp.address) : ''}" />
            </div>

            <div class="form-group">
              <label class="form-label" for="empNotesInput">${t('empNotes', 'ملاحظات')}</label>
              <textarea class="input" id="empNotesInput" rows="2">${emp && emp.notes ? escapeHtml(emp.notes) : ''}</textarea>
            </div>

            ${isEdit ? `
            <div class="form-group">
              <label class="form-label" style="display:inline-flex;align-items:center;gap:0.5rem;cursor:pointer;">
                <input type="checkbox" id="empActiveCheck" ${emp.active !== false ? 'checked' : ''} />
                <span>${t('empActive', 'نشط')} — ${t('empActiveHint', 'الموظف النشط يظهر في كشف الدوام اليومي')}</span>
              </label>
            </div>` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" type="button" data-action="cancel">${t('cancel', 'إلغاء')}</button>
            <button class="btn btn-primary" type="submit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span>${isEdit ? t('update', 'تحديث') : t('save', 'حفظ')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('employeeModal');
  function close() { closeModalEl(overlay); }
  attachModalHandlers(overlay, close);

  overlay.querySelector('#employeeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = overlay.querySelector('#empId').value;
    const name = overlay.querySelector('#empNameInput').value.trim();
    if (!name) { toast('error', t('empNameRequired', 'اسم الموظف مطلوب')); return; }

    const phone = overlay.querySelector('#empPhoneInput').value.trim();
    const jobTitle = overlay.querySelector('#empJobTitleInput').value.trim();
    const address = overlay.querySelector('#empAddressInput').value.trim();
    const salaryRaw = overlay.querySelector('#empSalaryInput').value;
    const hiredAt = overlay.querySelector('#empHiredAtInput').value;
    const weeklyRestDay = Number(overlay.querySelector('#empRestDaySelect').value);
    const notes = overlay.querySelector('#empNotesInput').value.trim();

    const body = { name, phone, jobTitle, address, monthlySalary: Number(salaryRaw) || 0, weeklyRestDay, notes };
    if (hiredAt) body.hiredAt = hiredAt;
    else if (isEdit) body.hiredAt = null;
    if (isEdit) body.active = overlay.querySelector('#empActiveCheck') ? overlay.querySelector('#empActiveCheck').checked : true;

    const btn = overlay.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const url = id ? '/api/employees/' + id : '/api/employees';
      const r = id ? await apiFetch.put(url, body) : await apiFetch.post(url, body);
      if (r && r.success) {
        toast('success', t('saved', 'تم الحفظ'));
        close();
        await refreshEmployees();
      } else {
        throw new Error((r && r.message) || t('error', 'حدث خطأ'));
      }
    } catch (err) {
      toast('error', (err && err.message) || t('error', 'حدث خطأ'));
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  setTimeout(() => { const first = overlay.querySelector('#empNameInput'); if (first) first.focus(); }, 50);
}

/* ============================================================
 * Row actions — delete / toggle active
 * ============================================================ */
async function deleteEmployee(emp) {
  const msg = t('empDeleteConfirm', 'حذف الموظف سيحذف سجل حضوره أيضاً. هل أنت متأكد؟');
  const ok = (window.Toast && window.Toast.confirm)
    ? await window.Toast.confirm(msg)
    : window.confirm(msg);
  if (!ok) return;
  try {
    const r = await apiFetch.delete('/api/employees/' + emp._id);
    if (r && r.success) {
      toast('success', t('empDeleted', 'تم حذف الموظف'));
      // If the deleted employee was the last one on this page, step back a page
      if (state.items.length === 1 && state.page > 1) state.page -= 1;
      await refreshEmployees();
    } else {
      throw new Error((r && r.message) || t('error', 'حدث خطأ'));
    }
  } catch (e) {
    toast('error', (e && e.message) || t('error', 'حدث خطأ'));
  }
}

async function toggleEmployeeActive(emp) {
  const newActive = emp.active === false; // inactive → activate, otherwise deactivate
  try {
    const r = await apiFetch.put('/api/employees/' + emp._id, { active: newActive });
    if (r && r.success) {
      toast('success', t('saved', 'تم الحفظ'));
      await refreshEmployees();
    } else {
      throw new Error((r && r.message) || t('error', 'حدث خطأ'));
    }
  } catch (e) {
    toast('error', (e && e.message) || t('error', 'حدث خطأ'));
  }
}

/* ============================================================
 * Render + bind
 * ============================================================ */
function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML =
    renderHeader() +
    renderTabs() +
    (state.tab === 'employees' ? renderEmployeesTab() : renderAttendanceTab());
  bindTabs();
  if (state.tab === 'employees') bindEmployeesTab();
  else bindAttendanceTab();
}

function bindTabs() {
  document.querySelectorAll('#pageContent .tab-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === state.tab) return;
      state.tab = btn.dataset.tab;
      document.querySelectorAll('#pageContent .tab-item').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      render();
      if (state.tab === 'attendance') refreshDaySheet();
    });
  });
}

function bindEmployeesTab() {
  const search = document.getElementById('empSearch');
  if (search) {
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.search = search.value.trim();
        state.page = 1;
        refreshEmployees();
      }, 300);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounce);
        state.search = search.value.trim();
        state.page = 1;
        refreshEmployees();
      }
    });
  }

  const addBtn = document.getElementById('empAddBtn');
  if (addBtn) addBtn.addEventListener('click', () => openEmployeeModal(null));

  const refBtn = document.getElementById('empRefreshBtn');
  if (refBtn) refBtn.addEventListener('click', () => refreshEmployees());

  bindEmployeesTable();
}

function bindEmployeesTable() {
  const container = document.getElementById('empTableContainer');
  if (!container) return;

  const emptyAdd = document.getElementById('empAddFirstBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openEmployeeModal(null));

  container.querySelectorAll('.table-action-btn[data-action="edit"]').forEach((b) => {
    b.addEventListener('click', () => {
      const emp = state.items.find((x) => x._id === b.dataset.id);
      if (emp) openEmployeeModal(emp);
    });
  });

  container.querySelectorAll('.table-action-btn[data-action="attendance"]').forEach((b) => {
    b.addEventListener('click', () => {
      // Jump to TAB B with this employee highlighted in the day sheet
      state.attFocusId = b.dataset.id;
      state.tab = 'attendance';
      if (!state.attDate) state.attDate = todayISO();
      render();
      refreshDaySheet();
    });
  });

  container.querySelectorAll('.table-action-btn[data-action="toggle"]').forEach((b) => {
    b.addEventListener('click', () => {
      const emp = state.items.find((x) => x._id === b.dataset.id);
      if (emp) toggleEmployeeActive(emp);
    });
  });

  container.querySelectorAll('.table-action-btn[data-action="delete"]').forEach((b) => {
    b.addEventListener('click', () => {
      const emp = state.items.find((x) => x._id === b.dataset.id);
      if (emp) deleteEmployee(emp);
    });
  });

  container.querySelectorAll('.page-btn').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const p = parseInt(b.dataset.page, 10);
      if (!isNaN(p) && p > 0) { state.page = p; refreshEmployees(); }
    });
  });
}

function bindAttendanceTab() {
  const dateInput = document.getElementById('attDate');
  if (dateInput) dateInput.addEventListener('change', () => {
    state.attDate = dateInput.value || todayISO();
    refreshDaySheet();
  });

  const saveAllBtn = document.getElementById('attSaveAllBtn');
  if (saveAllBtn) saveAllBtn.addEventListener('click', () => saveAllRows(saveAllBtn));

  const summaryBtn = document.getElementById('attSummaryBtn');
  if (summaryBtn) summaryBtn.addEventListener('click', () => openSummaryModal());

  const refBtn = document.getElementById('attRefreshBtn');
  if (refBtn) refBtn.addEventListener('click', () => refreshDaySheet());

  bindSheet();
}

function bindSheet() {
  const container = document.getElementById('attSheetContainer');
  if (!container) return;

  // Live dirty-row highlighting — the container element survives innerHTML
  // swaps inside refreshDaySheet(), so bind these listeners only once.
  if (!container.__sheetBound) {
    container.addEventListener('input', markDirtyRows);
    container.addEventListener('change', markDirtyRows);
    container.__sheetBound = true;
  }

  container.querySelectorAll('.att-save').forEach((btn) => {
    btn.addEventListener('click', () => saveRow(btn.closest('tr'), btn));
  });
}

/* ============================================================
 * Refresh helpers
 * ============================================================ */
async function refreshEmployees() {
  const container = document.getElementById('empTableContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'جارٍ التحميل...') + '</span></div>';
  await fetchEmployees();
  if (container) container.innerHTML = renderEmployeesTable();
  bindEmployeesTable();
}

async function refreshDaySheet() {
  const container = document.getElementById('attSheetContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>' + t('loading', 'جارٍ التحميل...') + '</span></div>';
  await fetchDaySheet();
  buildInit();
  if (container) container.innerHTML = renderDaySheet();
  bindSheet();
  applyFocusHighlight();
}

function applyFocusHighlight() {
  if (!state.attFocusId) return;
  const tr = document.querySelector('#attSheetContainer tr[data-emp-id="' + state.attFocusId + '"]');
  state.attFocusId = null;
  if (!tr) return;
  tr.classList.add('att-row-highlight');
  try { tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { /* older browsers */ }
}

/* ============================================================
 * Entry point (imported by dashboard.js)
 * ============================================================ */
export async function renderEmployeesPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.tab = 'employees';
  state.page = 1;
  state.search = '';
  state.attDate = todayISO();
  state.attRows = [];
  state.attInit = {};
  state.attFocusId = null;
  content.innerHTML = renderSkeleton();
  await fetchEmployees();
  render();
}
