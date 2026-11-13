/* ============================================================
 * js/modules/audit.js — Audit trail page (v4.2, admin/manager)
 * ------------------------------------------------------------
 * Rich audit console:
 *   • quick ranges (today / 7 / 30 / 90 days) + free-text search
 *   • filters: action, entity, HTTP method, date range
 *   • KPI row: events, active users, creates, updates, deletes, logins
 *   • 24-hour activity strip + top users / top entities bar lists
 *   • table with device + method + path column
 *   • row click → full detail popup (SweetAlert2, translated)
 *   • Excel export
 * Exports: renderAuditPage({ apiBase })
 * ============================================================ */

export async function renderAuditPage(ctx) {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : fb);
  const lang = (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';

  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const daysAgo = (n) => iso(new Date(Date.now() - n * 24 * 3600 * 1000));

  content.innerHTML = `
    <div class="audit-head-row">
      <div class="page-subtitle">${t('auditSubtitle', 'سجل كامل لكل ما يحدث في متجرك: من فعل ماذا، متى، ومن أي جهاز.')}</div>
      <button class="btn btn-secondary btn-sm" id="auRefresh" title="${t('refresh', 'تحديث')}">⟳</button>
    </div>

    <div class="card audit-filters">
      <div class="audit-ranges" id="auRanges">
        <button class="chip range-chip" data-days="0">${t('rangeToday', 'اليوم')}</button>
        <button class="chip range-chip active" data-days="7">${t('range7', '٧ أيام')}</button>
        <button class="chip range-chip" data-days="30">${t('range30', '٣٠ يوم')}</button>
        <button class="chip range-chip" data-days="90">${t('range90', '٩٠ يوم')}</button>
      </div>
      <div class="audit-filters-row">
        <input type="text" class="input" id="auSearch" placeholder="${t('auditSearch', 'بحث بالاسم، البريد، الكيان، المسار، IP…')}" />
        <select class="input" id="auAction">
          <option value="">${t('allActions', 'كل الإجراءات')}</option>
          <option value="create">${t('filterCreate', 'إنشاء')}</option>
          <option value="update">${t('filterUpdate', 'تعديل')}</option>
          <option value="delete">${t('filterDelete', 'حذف')}</option>
          <option value="login">${t('filterLogin', 'دخول')}</option>
          <option value="logout">${t('filterLogout', 'خروج')}</option>
          <option value="export">${t('filterExport', 'تصدير')}</option>
          <option value="restore">${t('filterRestore', 'استعادة')}</option>
          <option value="ai">${t('filterAi', 'ذكاء اصطناعي')}</option>
        </select>
        <select class="input" id="auEntity">
          <option value="">${t('allEntities', 'كل الكيانات')}</option>
          <option value="products">${t('products', 'المنتجات')}</option>
          <option value="sales">${t('sales', 'المبيعات')}</option>
          <option value="customers">${t('customers', 'العملاء')}</option>
          <option value="users">${t('users', 'المستخدمون')}</option>
          <option value="settings">${t('settings', 'الإعدادات')}</option>
          <option value="suppliers">${t('suppliers', 'الموردون')}</option>
          <option value="returns">${t('returns', 'المرتجعات')}</option>
          <option value="purchase-orders">${t('purchaseOrders', 'أوامر الشراء')}</option>
          <option value="auth">${t('auditEntityAuth', 'المصادقة')}</option>
          <option value="stores">${t('auditEntityStores', 'المتاجر')}</option>
        </select>
        <select class="input" id="auMethod">
          <option value="">${t('auditAllMethods', 'كل الوسوم')}</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
          <option value="GET">GET</option>
        </select>
        <input type="date" class="input" id="auFrom" value="${daysAgo(7)}" />
        <input type="date" class="input" id="auTo" value="${iso(today)}" />
        <button class="btn btn-primary btn-sm" id="auApply">${t('apply', 'تطبيق')}</button>
        <button class="btn btn-secondary btn-sm" id="auXlsx">📊 Excel</button>
      </div>
    </div>

    <div id="auStats"></div>
    <div class="audit-mid-grid" id="auMid"></div>

    <div class="card">
      <div class="table-wrap"><table class="table audit-table" id="auTable">
        <thead><tr>
          <th>${t('date', 'التاريخ')}</th>
          <th>${t('user', 'المستخدم')}</th>
          <th>${t('type', 'الإجراء')}</th>
          <th>${t('entity', 'الكيان')}</th>
          <th>${t('details', 'التفاصيل')}</th>
          <th>${t('auditSource', 'المصدر')}</th>
        </tr></thead>
        <tbody><tr><td colspan="6"><div class="loading-state"><div class="spinner"></div></div></td></tr></tbody>
      </table></div>
      <div class="table-foot">
        <span id="auInfo"></span>
        <div class="pager">
          <button class="btn btn-sm btn-secondary" id="auPrev">‹</button>
          <button class="btn btn-sm btn-secondary" id="auNext">›</button>
        </div>
      </div>
    </div>`;

  let page = 1;
  let allRows = [];
  let totalPages = 1;

  const ACTION_ICON = { create: '➕', update: '✏️', delete: '🗑️', login: '🔑', logout: '🚪', export: '📤', restore: '⏪', ai: '🤖', other: '•' };
  const ACTION_CLS = { create: 'success', update: 'info', delete: 'danger', login: 'primary', logout: 'muted', export: 'warning', restore: 'info', ai: 'ai', other: 'muted' };

  /* ---------- device parsing from userAgent ---------- */
  function deviceInfo(ua) {
    const s = String(ua || '');
    if (!s) return { icon: '💻', label: '—' };
    const isMobile = /Mobile|iPhone|Android(?!.*Tablet)/i.test(s);
    const isTablet = /iPad|Tablet/i.test(s);
    let browser = '';
    if (/Edg\//i.test(s)) browser = 'Edge';
    else if (/OPR\//i.test(s)) browser = 'Opera';
    else if (/Chrome\//i.test(s)) browser = 'Chrome';
    else if (/Firefox\//i.test(s)) browser = 'Firefox';
    else if (/Safari\//i.test(s)) browser = 'Safari';
    const icon = isTablet ? '📲' : (isMobile ? '📱' : '💻');
    return { icon, label: (browser || '') + (isMobile ? ' · ' + t('deviceMobile', 'هاتف') : isTablet ? ' · ' + t('deviceTablet', 'لوحي') : ' · ' + t('deviceDesktop', 'حاسوب')) };
  }

  function esc(x) {
    return String(x == null ? '' : x)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtWhen(v) { return (v && v.count ? v.count : 0); }

  /* ---------- stats ---------- */
  async function loadStats() {
    const el = content.querySelector('#auStats');
    const mid = content.querySelector('#auMid');
    try {
      const res = await apiFetch.get('/api/audit/stats?days=7');
      const st = res.data || res;
      const byAction = st.byAction || [];
      const hit = (a) => { const h = byAction.find(x => x._id === a); return h ? h.count : 0; };
      const total = (typeof st.total === 'number') ? st.total : byAction.reduce((s, x) => s + x.count, 0);

      el.innerHTML = `<div class="kpi-grid kpi-grid-6">
        <div class="card kpi-card"><div class="kpi-label">📋 ${t('auditTotalEvents', 'إجمالي الأحداث')}</div><div class="kpi-value">${total}</div><div class="kpi-sub">${t('lastDays7', 'آخر 7 أيام')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">👥 ${t('auditActiveUsers', 'مستخدمون نشطون')}</div><div class="kpi-value">${st.uniqueUsers != null ? st.uniqueUsers : (st.byUser || []).length}</div><div class="kpi-sub">${t('lastDays7', 'آخر 7 أيام')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">➕ ${t('filterCreate', 'إنشاء')}</div><div class="kpi-value">${hit('create')}</div><div class="kpi-sub">${t('lastDays7', 'آخر 7 أيام')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">✏️ ${t('filterUpdate', 'تعديل')}</div><div class="kpi-value">${hit('update')}</div><div class="kpi-sub">${t('lastDays7', 'آخر 7 أيام')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">🗑️ ${t('filterDelete', 'حذف')}</div><div class="kpi-value">${hit('delete')}</div><div class="kpi-sub">${t('lastDays7', 'آخر 7 أيام')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">🔑 ${t('filterLogin', 'دخول')}</div><div class="kpi-value">${hit('login')}</div><div class="kpi-sub">${t('lastDays7', 'آخر 7 أيام')}</div></div>
      </div>`;

      // ---- mid grid: 24h strip + top users + top entities ----
      const hours = Array.from({ length: 24 }, (_, h) => {
        const found = (st.byHour || []).find(x => x._id === h);
        return { h, count: found ? found.count : 0 };
      });
      const maxHour = Math.max(1, ...hours.map(x => x.count));
      const users = (st.byUser || []).filter(u => u._id);
      const maxUser = Math.max(1, ...users.map(u => u.count));
      const entities = (st.byEntity || []).filter(e => e._id);
      const maxEnt = Math.max(1, ...entities.map(e => e.count));

      mid.innerHTML = `
        <div class="card audit-hour-card">
          <div class="audit-mid-title">⏱ ${t('auditLast24h', 'نشاط آخر 24 ساعة')}</div>
          <div class="audit-hours">${hours.map(x =>
            `<div class="audit-hour-col" title="${x.h}:00 — ${x.count}"><span class="audit-hour-bar" style="height:${Math.round((x.count / maxHour) * 46) + 3}px"></span><span class="audit-hour-lab">${x.h % 6 === 0 ? String(x.h).padStart(2, '0') : ''}</span></div>`).join('')}
          </div>
        </div>
        <div class="card audit-top-card">
          <div class="audit-mid-title">👤 ${t('auditTopUsers', 'الأكثر نشاطاً (مستخدمون)')}</div>
          ${users.length ? users.slice(0, 6).map(u => `
            <div class="audit-bar-row"><span class="audit-bar-name">${esc(u._id)}</span>
              <span class="audit-bar-track"><span class="audit-bar-fill" style="width:${Math.round((u.count / maxUser) * 100)}%"></span></span>
              <span class="audit-bar-num">${u.count}</span></div>`).join('')
          : `<div class="muted">${t('noData', 'لا توجد بيانات')}</div>`}
        </div>
        <div class="card audit-top-card">
          <div class="audit-mid-title">🗂 ${t('auditTopEntities', 'الأكثر تغييراً (كيانات)')}</div>
          ${entities.length ? entities.slice(0, 6).map(e => `
            <div class="audit-bar-row"><span class="audit-bar-name">${esc(e._id)}</span>
              <span class="audit-bar-track"><span class="audit-bar-fill alt" style="width:${Math.round((e.count / maxEnt) * 100)}%"></span></span>
              <span class="audit-bar-num">${e.count}</span></div>`).join('')
          : `<div class="muted">${t('noData', 'لا توجد بيانات')}</div>`}
        </div>`;
    } catch (_) {
      if (el) el.innerHTML = '';
      if (mid) mid.innerHTML = '';
    }
  }

  /* ---------- list ---------- */
  async function load() {
    const action = content.querySelector('#auAction').value;
    const entity = content.querySelector('#auEntity').value;
    const method = content.querySelector('#auMethod').value;
    const from = content.querySelector('#auFrom').value;
    const to = content.querySelector('#auTo').value;
    const search = content.querySelector('#auSearch').value.trim();
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (action) qs.set('action', action);
    if (entity) qs.set('entity', entity);
    if (method) qs.set('method', method);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (search) qs.set('search', search);
    try {
      const res = await apiFetch.get('/api/audit?' + qs.toString());
      const data = res.data || res;
      allRows = data.data || [];
      totalPages = data.totalPages || 1;
      renderRows(data);
    } catch (err) {
      content.querySelector('#auTable tbody').innerHTML =
        `<tr><td colspan="6" class="empty-state">⛔ ${esc(err.message)}</td></tr>`;
    }
  }

  function renderRows(data) {
    const tb = content.querySelector('#auTable tbody');
    tb.innerHTML = allRows.length ? allRows.map((r, idx) => {
      const dev = deviceInfo(r.userAgent);
      const actCls = ACTION_CLS[r.action] || 'muted';
      return `
      <tr class="audit-row" data-idx="${idx}" title="${t('auditClickDetail', 'اضغط لعرض التفاصيل الكاملة')}">
        <td class="audit-when"><strong>${new Date(r.createdAt).toLocaleDateString()}</strong><br/><small class="muted">${new Date(r.createdAt).toLocaleTimeString()}</small></td>
        <td>${esc(r.userName || '—')}<br/><small class="muted">${esc(r.userEmail || '')}</small></td>
        <td><span class="badge audit-badge-${actCls}">${ACTION_ICON[r.action] || '•'} ${esc(actionLabel(r.action))}</span></td>
        <td><span class="badge badge-info">${esc(r.entity || '—')}</span>${r.entityId ? `<br/><small class="muted">#${esc(String(r.entityId).slice(-6))}</small>` : ''}</td>
        <td class="audit-sum-cell"><code>${esc(summarize(r.summary))}</code></td>
        <td class="audit-src"><small>${dev.icon} ${esc(dev.label)}<br/>${esc((r.method || '') + ' ' + shortPath(r.path))}<br/><span class="muted">${esc(r.ip || '')}</span></small></td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty-state">${t('noData', 'لا توجد بيانات')}</td></tr>`;

    content.querySelector('#auInfo').textContent =
      `${t('showing', 'عرض')} ${allRows.length} / ${data.total || 0} — ${t('page', 'صفحة')} ${page}/${totalPages}`;

    tb.querySelectorAll('.audit-row').forEach(tr => {
      tr.addEventListener('click', () => showDetail(allRows[parseInt(tr.dataset.idx, 10)]));
    });
  }

  function actionLabel(a) {
    const map = { create: 'filterCreate', update: 'filterUpdate', delete: 'filterDelete', login: 'filterLogin', logout: 'filterLogout', export: 'filterExport', restore: 'filterRestore', ai: 'filterAi', other: 'auditOther' };
    return map[a] ? t(map[a], a) : a;
  }

  function shortPath(p) {
    const s = String(p || '');
    return s.length > 34 ? s.slice(0, 33) + '…' : (s || '—');
  }

  function summarize(s) {
    if (!s) return '—';
    if (typeof s === 'string') return s.slice(0, 90);
    const parts = [];
    try {
      if (s.body && typeof s.body === 'object') {
        for (const k of Object.keys(s.body).slice(0, 4)) {
          let v = s.body[k];
          if (v && typeof v === 'object') v = '{…}';
          parts.push(k + ': ' + String(v).slice(0, 60));
        }
      }
      if (s.query && typeof s.query === 'object') {
        for (const k of Object.keys(s.query).slice(0, 2)) {
          parts.push('?' + k + '=' + String(s.query[k]).slice(0, 30));
        }
      }
    } catch (_) { return '—'; }
    return parts.join(' · ') || '—';
  }

  /* ---------- detail popup ---------- */
  function showDetail(r) {
    if (!r) return;
    const dev = deviceInfo(r.userAgent);
    const sumJson = (() => {
      try { return JSON.stringify(r.summary || {}, null, 2); } catch (_) { return String(r.summary || '—'); }
    })();
    const rows = [
      ['🕐', t('date', 'التاريخ'), new Date(r.createdAt).toLocaleString()],
      ['👤', t('user', 'المستخدم'), (r.userName || '—') + (r.userEmail ? ' — ' + r.userEmail : '')],
      ['⚡', t('type', 'الإجراء'), (ACTION_ICON[r.action] || '•') + ' ' + actionLabel(r.action)],
      ['🗂', t('entity', 'الكيان'), (r.entity || '—') + (r.entityId ? ' — #' + r.entityId : '')],
      ['📡', t('auditRequest', 'الطلب'), (r.method || '—') + ' ' + (r.path || '—')],
      [dev.icon, t('auditDevice', 'الجهاز'), dev.label],
      ['🌐', 'IP', r.ip || '—']
    ];
    const html =
      '<div class="au-detail">' +
      rows.map(x => `<div class="au-detail-row"><span class="au-detail-ic">${x[0]}</span><span class="au-detail-k">${esc(x[1])}</span><span class="au-detail-v">${esc(x[2])}</span></div>`).join('') +
      `<div class="au-detail-json"><div class="au-detail-k">${t('details', 'التفاصيل')}</div><pre>${esc(sumJson)}</pre></div>` +
      '</div>';
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: '🔍 ' + t('auditEventDetails', 'تفاصيل الحدث'),
        html,
        width: 620,
        confirmButtonText: t('close', 'إغلاق'),
        confirmButtonColor: '#10b981',
        customClass: { popup: 'au-detail-popup' }
      });
    } else {
      window.Toast.info(t('auditEventDetails', 'تفاصيل الحدث'));
    }
  }

  /* ---------- wire up ---------- */
  content.querySelector('#auApply').addEventListener('click', () => { page = 1; load(); });
  content.querySelector('#auSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { page = 1; load(); }
  });
  content.querySelector('#auPrev').addEventListener('click', () => { if (page > 1) { page--; load(); } });
  content.querySelector('#auNext').addEventListener('click', () => { if (page < totalPages) { page++; load(); } });
  content.querySelector('#auRefresh').addEventListener('click', () => { load(); loadStats(); });
  content.querySelectorAll('.range-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('.range-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const d = parseInt(btn.dataset.days, 10);
      content.querySelector('#auFrom').value = d === 0 ? iso(new Date()) : daysAgo(d);
      content.querySelector('#auTo').value = iso(today);
      page = 1;
      load();
    });
  });
  content.querySelector('#auXlsx').addEventListener('click', () => {
    const cols = [
      { label: t('date', 'التاريخ'), value: r => new Date(r.createdAt).toLocaleString() },
      { label: t('user', 'المستخدم'), key: 'userName' },
      { label: t('email', 'البريد'), key: 'userEmail' },
      { label: t('type', 'الإجراء'), key: 'action' },
      { label: t('entity', 'الكيان'), key: 'entity' },
      { label: t('auditEntityId', 'معرف الكيان'), key: 'entityId' },
      { label: t('auditMethod', 'الوسيلة'), key: 'method' },
      { label: t('auditPath', 'المسار'), key: 'path' },
      { label: 'IP', key: 'ip' },
      { label: t('auditDevice', 'الجهاز'), value: r => deviceInfo(r.userAgent).label },
      { label: t('details', 'التفاصيل'), value: r => summarize(r.summary) }
    ];
    window.DZExport.exportToExcel({ columns: cols, rows: allRows, filename: 'dzpospro-audit', title: t('audit', 'سجل التدقيق') });
  });

  await load();
  loadStats();
}
