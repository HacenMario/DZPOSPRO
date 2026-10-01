/* ============================================================
 * js/modules/audit.js — Audit trail page (v3, admin/manager)
 * Exports: renderAuditPage({ apiBase })
 * ============================================================ */

export async function renderAuditPage(ctx) {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : fb);
  const lang = (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';

  content.innerHTML = `
    <div class="page-subtitle">${t('auditSubtitle', 'سجل كامل لكل ما يحدث في متجرك: من فعل ماذا، متى، ومن أي جهاز.')}</div>
    <div class="card audit-filters">
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
        <option value="products">${t('products')}</option>
        <option value="sales">${t('sales')}</option>
        <option value="customers">${t('customers')}</option>
        <option value="users">${t('users')}</option>
        <option value="settings">${t('settings')}</option>
        <option value="suppliers">${t('suppliers')}</option>
        <option value="returns">${t('returns')}</option>
        <option value="purchase-orders">${t('purchaseOrders')}</option>
      </select>
      <input type="date" class="input" id="auFrom" />
      <input type="date" class="input" id="auTo" />
      <button class="btn btn-primary btn-sm" id="auApply">${t('apply', 'تطبيق')}</button>
      <button class="btn btn-secondary btn-sm" id="auXlsx">📊 Excel</button>
    </div>
    <div id="auStats"></div>
    <div class="card">
      <div class="table-wrap"><table class="table" id="auTable">
        <thead><tr>
          <th>${t('date')}</th><th>${t('user', 'المستخدم')}</th><th>${t('type', 'الإجراء')}</th>
          <th>${t('entity', 'الكيان')}</th><th>${t('details', 'التفاصيل')}</th><th>IP</th>
        </tr></thead>
        <tbody><tr><td colspan="6"><div class="loading-state"><div class="spinner"></div></div></td></tr></tbody>
      </table></div>
      <div class="table-foot">
        <span id="auInfo"></span>
        <div class="pager"><button class="btn btn-sm btn-secondary" id="auPrev">‹</button><button class="btn btn-sm btn-secondary" id="auNext">›</button></div>
      </div>
    </div>`;

  let page = 1;
  let allRows = [];

  const ACTION_ICON = { create: '➕', update: '✏️', delete: '🗑️', login: '🔑', logout: '🚪', export: '📤', restore: '⏪', ai: '🤖', other: '•' };

  async function loadStats() {
    try {
      const res = await apiFetch.get('/api/audit/stats?days=7');
      const st = res.data || res;
      const el = content.querySelector('#auStats');
      el.innerHTML = `<div class="kpi-grid">
        ${['create', 'update', 'delete', 'login'].map(a => {
          const hit = (st.byAction || []).find(x => x._id === a);
          return `<div class="card kpi-card"><div class="kpi-label">${ACTION_ICON[a]} ${t('filter_' + a, a)}</div><div class="kpi-value">${hit ? hit.count : 0}</div><div class="kpi-sub">${t('lastDays7', 'آخر 7 أيام')}</div></div>`;
        }).join('')}
      </div>`;
    } catch (_) {}
  }

  async function load() {
    const action = content.querySelector('#auAction').value;
    const entity = content.querySelector('#auEntity').value;
    const from = content.querySelector('#auFrom').value;
    const to = content.querySelector('#auTo').value;
    const qs = new URLSearchParams({ page, limit: 20 });
    if (action) qs.set('action', action);
    if (entity) qs.set('entity', entity);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    try {
      const res = await apiFetch.get('/api/audit?' + qs.toString());
      const data = res.data || res;
      allRows = data.data || [];
      renderRows(data);
    } catch (err) {
      content.querySelector('#auTable tbody').innerHTML = `<tr><td colspan="6" class="empty-state">⛔ ${esc(err.message)}</td></tr>`;
    }
  }

  function renderRows(data) {
    const tb = content.querySelector('#auTable tbody');
    tb.innerHTML = allRows.length ? allRows.map(r => `
      <tr>
        <td>${new Date(r.createdAt).toLocaleString()}</td>
        <td>${esc(r.userName || '—')}<br/><small class="muted">${esc(r.userEmail || '')}</small></td>
        <td>${ACTION_ICON[r.action] || '•'} ${esc(r.action)}</td>
        <td><span class="badge badge-info">${esc(r.entity || '—')}</span>${r.entityId ? `<br/><small class="muted">#${String(r.entityId).slice(-6)}</small>` : ''}</td>
        <td><code style="font-size:10.5px">${esc(summarize(r.summary))}</code></td>
        <td><small>${esc(r.ip || '')}</small></td>
      </tr>`).join('') : `<tr><td colspan="6" class="empty-state">${t('noData')}</td></tr>`;
    content.querySelector('#auInfo').textContent = `${t('showing', 'عرض')} ${allRows.length} / ${data.total || 0}`;
  }

  function summarize(s) {
    if (!s) return '—';
    const parts = [];
    if (s.body && typeof s.body === 'object') {
      for (const k of Object.keys(s.body).slice(0, 4)) {
        let v = s.body[k];
        if (v && typeof v === 'object') v = '{…}';
        parts.push(k + ': ' + String(v).slice(0, 60));
      }
    }
    return parts.join(' · ') || '—';
  }

  function esc(x) {
    return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  content.querySelector('#auApply').addEventListener('click', () => { page = 1; load(); });
  content.querySelector('#auPrev').addEventListener('click', () => { if (page > 1) { page--; load(); } });
  content.querySelector('#auNext').addEventListener('click', () => { page++; load(); });
  content.querySelector('#auXlsx').addEventListener('click', () => {
    const cols = [
      { label: t('date'), value: r => new Date(r.createdAt).toLocaleString() },
      { label: t('user', 'المستخدم'), key: 'userName' },
      { label: t('type', 'الإجراء'), key: 'action' },
      { label: t('entity', 'الكيان'), key: 'entity' },
      { label: 'IP', key: 'ip' }
    ];
    window.DZExport.exportToExcel({ columns: cols, rows: allRows, filename: 'dzpospro-audit', title: t('audit', 'سجل التدقيق') });
  });

  await load();
  loadStats();
}
