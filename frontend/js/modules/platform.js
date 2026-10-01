/* ============================================================
 * js/modules/platform.js — Super-admin platform console (v3)
 * Tabs: platform stats + stores management + weekly backups
 * Exports: renderPlatformPage({ apiBase })
 * ============================================================ */

export async function renderPlatformPage(ctx) {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : fb);
  const lang = (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';
  const apiBase = (ctx && ctx.apiBase) || window.DZPOS_API_BASE || '';

  content.innerHTML = `
    <div class="page-subtitle">${t('platformSubtitle', 'لوحة المنصة: إدارة المخازن، الاشتراكات، والنسخ الاحتياطي الأسبوعي.')}</div>
    <div id="pfStats"></div>
    <div class="tabs-bar">
      <button class="tab-btn active" data-tab="stores">🏪 ${t('stores', 'المخازن')}</button>
      <button class="tab-btn" data-tab="backups">💾 ${t('backups', 'النسخ الاحتياطي')}</button>
    </div>
    <div class="tab-body" id="pfTabBody"></div>`;

  await loadStats();
  renderTab('stores');

  content.querySelectorAll('.tabs-bar .tab-btn').forEach(b => {
    b.addEventListener('click', () => {
      content.querySelectorAll('.tabs-bar .tab-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderTab(b.dataset.tab);
    });
  });

  async function loadStats() {
    const el = content.querySelector('#pfStats');
    try {
      const res = await apiFetch.get('/api/stores/platform-stats');
      const s = res.data || res;
      el.innerHTML = `<div class="kpi-grid">
        <div class="card kpi-card"><div class="kpi-label">🏪 ${t('stores', 'المخازن')}</div><div class="kpi-value">${s.stores.total}</div><div class="kpi-sub">${s.stores.active} ${t('active', 'نشط')} · ${s.stores.suspended} ${t('suspended', 'موقوف')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">👥 ${t('users', 'المستخدمون')}</div><div class="kpi-value">${s.users}</div><div class="kpi-sub">${t('allStores', 'كل المخازن')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">📦 ${t('products', 'المنتجات')}</div><div class="kpi-value">${s.products}</div><div class="kpi-sub">${t('allStores', 'كل المخازن')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">💰 ${t('revenue', 'المبيعات')}</div><div class="kpi-value">${(s.revenue || 0).toLocaleString()}</div><div class="kpi-sub">DZD · ${s.salesCount} ${t('sales', 'عملية بيع')}</div></div>
      </div>`;
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`;
    }
  }

  function renderTab(name) {
    const body = content.querySelector('#pfTabBody');
    if (name === 'stores') renderStores(body); else renderBackups(body);
  }

  /* ---------- stores ---------- */
  async function renderStores(body) {
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
    let data = [];
    try {
      const res = await apiFetch.get('/api/stores');
      data = (res.data || res).data || [];
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`; return;
    }

    body.innerHTML = `
      <div class="card-head-row" style="margin:8px 0">
        <button class="btn btn-primary" id="stAdd">➕ ${t('addStore', 'إضافة مخزن')}</button>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr>
          <th>${t('storeName', 'المخزن')}</th><th>${t('plan', 'الخطة')}</th><th>${t('status', 'الحالة')}</th>
          <th>${t('users', 'المستخدمون')}</th><th>${t('products', 'المنتجات')}</th><th>${t('revenue', 'المبيعات')}</th>
          <th>${t('trialEnds', 'نهاية التجربة')}</th><th>${t('actions')}</th>
        </tr></thead>
        <tbody>
          ${data.length ? data.map(s => `
            <tr>
              <td><strong>${esc(s.name)}</strong><br/><small class="muted">${esc(s.ownerName || s.email || '')}</small></td>
              <td><span class="badge badge-info">${esc(s.plan)}</span></td>
              <td><span class="badge ${s.status === 'active' ? 'badge-success' : 'badge-danger'}">${s.status === 'active' ? t('active', 'نشط') : t('suspended', 'موقوف')}</span></td>
              <td>${(s.stats && s.stats.users) || 0}</td>
              <td>${(s.stats && s.stats.products) || 0}</td>
              <td>${((s.stats && s.stats.revenue) || 0).toLocaleString()}</td>
              <td>${s.trialEndsAt ? new Date(s.trialEndsAt).toLocaleDateString() : '—'}</td>
              <td class="row-actions">
                <button class="btn btn-sm btn-secondary st-toggle" data-id="${s._id}" data-status="${s.status}">
                  ${s.status === 'active' ? t('suspend', 'إيقاف') : t('activate', 'تفعيل')}
                </button>
                <button class="btn btn-sm btn-secondary st-plan" data-id="${s._id}" data-plan="${s.plan}">${t('changePlan', 'تغيير الخطة')}</button>
                <button class="btn btn-sm btn-danger st-del" data-id="${s._id}">🗑️</button>
              </td>
            </tr>`).join('') : `<tr><td colspan="8" class="empty-state">${t('noData')}</td></tr>`}
        </tbody>
      </table></div></div>`;

    body.querySelector('#stAdd').addEventListener('click', () => showAddStore());

    body.querySelectorAll('.st-toggle').forEach(b => b.addEventListener('click', async () => {
      const next = b.dataset.status === 'active' ? 'suspended' : 'active';
      try {
        await apiFetch.put('/api/stores/' + b.dataset.id, { status: next });
        window.Toast && Toast.success(t('saved', 'تم الحفظ'));
        renderStores(body);
      } catch (err) { window.Toast && Toast.error(err.message); }
    }));

    body.querySelectorAll('.st-plan').forEach(b => b.addEventListener('click', async () => {
      const plans = ['trial', 'basic', 'pro', 'enterprise'];
      const idx = plans.indexOf(b.dataset.plan);
      const pick = plans[(idx + 1) % plans.length];
      try {
        await apiFetch.put('/api/stores/' + b.dataset.id, { plan: pick });
        window.Toast && Toast.success(t('saved', 'تم الحفظ') + ': ' + pick);
        renderStores(body);
      } catch (err) { window.Toast && Toast.error(err.message); }
    }));

    body.querySelectorAll('.st-del').forEach(b => b.addEventListener('click', async () => {
      const ok = await (window.Toast && Toast.confirm ? Toast.confirm(t('deleteStoreConfirm', '⚠️ سيتم حذف المخزن وكل بياناته نهائياً. متأكد؟')) : Promise.resolve(confirm('delete?')));
      if (!ok) return;
      try {
        await apiFetch.delete('/api/stores/' + b.dataset.id);
        window.Toast && Toast.success(t('deleted', 'تم الحذف'));
        loadStats();
        renderStores(body);
      } catch (err) { window.Toast && Toast.error(err.message); }
    }));

    async function showAddStore() {
      if (typeof Swal === 'undefined') return;
      const r = await Swal.fire({
        title: t('addStore', 'إضافة مخزن'),
        html: `
          <input id="swName" class="swal2-input" placeholder="${t('storeName', 'اسم المخزن')}" />
          <input id="swOwner" class="swal2-input" placeholder="${t('ownerName', 'اسم المالك')}" />
          <input id="swEmail" class="swal2-input" placeholder="admin@store.com" />
          <input id="swPass" class="swal2-input" type="password" placeholder="${t('password')}" />
          <select id="swPlan" class="swal2-input">
            <option value="trial">trial</option><option value="basic">basic</option>
            <option value="pro" selected>pro</option><option value="enterprise">enterprise</option>
          </select>`,
        confirmButtonText: t('save', 'حفظ'),
        confirmButtonColor: '#10b981',
        showCancelButton: true,
        cancelButtonText: t('cancel', 'إلغاء'),
        preConfirm: () => ({
          name: document.getElementById('swName').value,
          ownerName: document.getElementById('swOwner').value,
          email: document.getElementById('swEmail').value,
          password: document.getElementById('swPass').value,
          plan: document.getElementById('swPlan').value
        })
      });
      if (!r.isConfirmed) return;
      try {
        await apiFetch.post('/api/stores', r.value);
        window.Toast && Toast.success(t('storeCreated', 'تم إنشاء المخزن ✓'));
        loadStats(); renderStores(body);
      } catch (err) { window.Toast && Toast.error(err.message); }
    }
  }

  /* ---------- backups ---------- */
  async function renderBackups(body) {
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
    let data = [];
    try {
      const res = await apiFetch.get('/api/backups');
      data = (res.data || res).data || [];
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`; return;
    }

    body.innerHTML = `
      <div class="card ai-narrative">
        <strong>💾</strong>
        <div>${t('backupHint', 'نسخة احتياطية تلقائية كل أسبوع (الأحد 03:00 افتراضياً). يمكن تغيير التوقيت عبر BACKUP_CRON. احتفظ بنسخ خارجية عبر زر التحميل.')}</div>
      </div>
      <div class="card-head-row" style="margin:8px 0">
        <button class="btn btn-primary" id="bkNow">💾 ${t('backupNow', 'إنشاء نسخة الآن')}</button>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>${t('filename', 'الملف')}</th><th>${t('size', 'الحجم')}</th><th>${t('created', 'أُنشئت')}</th><th>${t('type', 'النوع')}</th><th>${t('docsCount', 'سجلات')}</th><th>${t('actions')}</th></tr></thead>
        <tbody>
          ${data.length ? data.map(b => `
            <tr>
              <td><code>${esc(b.filename)}</code></td>
              <td>${(b.size / 1024).toFixed(1)} KB</td>
              <td>${new Date(b.createdAt).toLocaleString()}</td>
              <td><span class="badge badge-info">${b.trigger === 'auto-weekly' ? t('autoWeekly', 'أسبوعية تلقائية') : t('manual', 'يدوية')}</span></td>
              <td>${b.docsCount || '—'}</td>
              <td class="row-actions">
                <a class="btn btn-sm btn-secondary" href="${apiBase}/api/backups/${encodeURIComponent(b.filename)}/download" target="_blank" rel="noopener">${t('download', 'تحميل')}</a>
                <button class="btn btn-sm btn-danger bk-restore" data-file="${esc(b.filename)}">⏪ ${t('restore', 'استعادة')}</button>
              </td>
            </tr>`).join('') : `<tr><td colspan="6" class="empty-state">${t('noBackups', 'لا نسخ بعد — أنشئ أول نسخة الآن')}</td></tr>`}
        </tbody>
      </table></div></div>`;

    body.querySelector('#bkNow').addEventListener('click', async () => {
      try {
        await apiFetch.post('/api/backups/now');
        window.Toast && Toast.success(t('backupDone', 'تم إنشاء النسخة الاحتياطية ✓'));
        renderBackups(body);
      } catch (err) { window.Toast && Toast.error(err.message); }
    });

    body.querySelectorAll('.bk-restore').forEach(b => b.addEventListener('click', async () => {
      const ok = await (window.Toast && Toast.confirm ? Toast.confirm(t('restoreConfirm', '⚠️ سيتم استبدال بيانات النظام الحالية بالنسخة. متأكد؟')) : Promise.resolve(confirm('restore?')));
      if (!ok) return;
      try {
        await apiFetch.post('/api/backups/restore', { filename: b.dataset.file });
        window.Toast && Toast.success(t('restoreDone', 'تمت الاستعادة ✓ (أعد تحميل الصفحة)'));
      } catch (err) { window.Toast && Toast.error(err.message); }
    }));
  }

  function esc(x) {
    return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
