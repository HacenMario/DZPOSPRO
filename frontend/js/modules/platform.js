/* ============================================================
 * js/modules/platform.js — Super-admin platform console (v3.2)
 * Tabs: Overview · Stores · Backups
 *  • Overview: KPIs + trial warnings + recent stores + activity feed
 *  • Stores: search/filter table + create/edit modal (sections),
 *    users manager per store, extend trial, suspend/activate,
 *    login-as (2h impersonation), safe delete
 * Exports: renderPlatformPage({ apiBase })
 * ============================================================ */

export async function renderPlatformPage(ctx) {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const t = (k, fb) => (typeof window.t === 'function') ? window.t(k, fb) : fb;
  const lang = (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';
  const apiBase = (ctx && ctx.apiBase) || window.DZPOS_API_BASE || '';

  content.innerHTML = `
    <div class="page-subtitle">${t('platformSubtitle', 'لوحة المنصة: إدارة المخازن، الاشتراكات، والنسخ الاحتياطي الأسبوعي.')}</div>
    <div class="tabs-bar">
      <button class="tab-btn active" data-tab="overview">📊 ${t('pfOverview', 'نظرة عامة')}</button>
      <button class="tab-btn" data-tab="stores">🏪 ${t('stores', 'المخازن')}</button>
      <button class="tab-btn" data-tab="backups">💾 ${t('backups', 'النسخ الاحتياطي')}</button>
    </div>
    <div class="tab-body" id="pfTabBody"></div>`;

  let overviewCache = null;

  content.querySelectorAll('.tabs-bar .tab-btn').forEach(b => {
    b.addEventListener('click', () => {
      content.querySelectorAll('.tabs-bar .tab-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderTab(b.dataset.tab);
    });
  });

  function renderTab(name) {
    const body = content.querySelector('#pfTabBody');
    if (name === 'overview') renderOverview(body);
    else if (name === 'stores') renderStores(body);
    else renderBackups(body);
  }

  /* ================= OVERVIEW ================= */
  async function renderOverview(body) {
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
    let d;
    try {
      const res = await apiFetch.get('/api/stores/platform-overview');
      d = res.data || res;
      overviewCache = d;
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`;
      return;
    }
    const st = d.stores || {};
    const warn = st.trialEndingSoon
      ? `<div class="card pf-warn">⏳ ${t('pfTrialWarning', 'تنتهي التجربة قريباً')}: <strong>${st.trialEndingSoon}</strong> ${t('pfTrialWarningSub', 'مخازن خلال 7 أيام — فكّر في التمديد أو الترقية')}</div>`
      : '';
    body.innerHTML = `
      ${warn}
      <div class="kpi-grid">
        <div class="card kpi-card"><div class="kpi-label">🏪 ${t('stores', 'المخازن')}</div><div class="kpi-value">${st.total || 0}</div><div class="kpi-sub">${st.active || 0} ${t('active', 'نشط')} · ${st.suspended || 0} ${t('suspended', 'موقوف')} · ${st.trial || 0} ${t('pfTrial', 'تجريبي')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">👥 ${t('users', 'المستخدمون')}</div><div class="kpi-value">${d.users || 0}</div><div class="kpi-sub">${t('allStores', 'كل المخازن')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">📦 ${t('products', 'المنتجات')}</div><div class="kpi-value">${d.products || 0}</div><div class="kpi-sub">${t('allStores', 'كل المخازن')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">💰 ${t('revenue', 'المبيعات')}</div><div class="kpi-value">${(d.revenue || 0).toLocaleString()}</div><div class="kpi-sub">DZD · ${d.salesCount || 0} ${t('sales', 'عملية بيع')}</div></div>
        <div class="card kpi-card"><div class="kpi-label">🤖 AI</div><div class="kpi-value">${d.aiCallsToday || 0}</div><div class="kpi-sub">${t('pfAiCallsToday', 'طلبات آخر 24 ساعة')}</div></div>
      </div>
      <div class="pf-two-col">
        <div class="card pf-panel">
          <div class="pf-panel-head"><strong>🆕 ${t('pfRecentStores', 'أحدث المخازن')}</strong></div>
          ${d.recentStores && d.recentStores.length ? d.recentStores.map(s => `
            <div class="pf-row">
              <div><strong>${esc(s.name)}</strong><br/><small class="muted">${fmtDate(s.createdAt)}</small></div>
              <div>${planBadge(s.plan)} ${statusBadge(s)}</div>
            </div>`).join('') : `<div class="muted" style="padding:8px 0">${t('noData', 'لا بيانات')}</div>`}
        </div>
        <div class="card pf-panel">
          <div class="pf-panel-head"><strong>🕐 ${t('pfRecentActivity', 'آخر النشاطات على المنصة')}</strong></div>
          ${d.recentAudit && d.recentAudit.length ? d.recentAudit.map(a => `
            <div class="pf-row">
              <div><strong>${esc(a.userName || '—')}</strong> <span class="badge badge-info">${esc(actionLabel(a.action))}</span> <span class="muted">${esc(a.entity || '')}</span><br/><small class="muted">${fmtDate(a.createdAt)} ${new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>
            </div>`).join('') : `<div class="muted" style="padding:8px 0">${t('noData', 'لا بيانات')}</div>`}
        </div>
      </div>`;
  }

  function actionLabel(a) {
    const map = { create: t('pfActCreate', 'إنشاء'), update: t('pfActUpdate', 'تعديل'), delete: t('pfActDelete', 'حذف'), login: t('pfActLogin', 'دخول'), logout: t('pfActLogout', 'خروج'), export: t('pfActExport', 'تصدير'), restore: t('pfActRestore', 'استعادة'), ai: 'AI' };
    return map[a] || a || '—';
  }

  /* ================= STORES ================= */
  const storeFilters = { search: '', status: '', plan: '' };

  async function renderStores(body) {
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
    let data = [];
    try {
      const res = await apiFetch.get('/api/stores');
      data = (res.data || res).data || [];
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`; return;
    }
    if (storeFilters.search) {
      const q = storeFilters.search.toLowerCase();
      data = data.filter(s => (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q) || (s.ownerName || '').toLowerCase().includes(q) || (s.city || '').toLowerCase().includes(q));
    }
    if (storeFilters.status) data = data.filter(s => s.status === storeFilters.status);
    if (storeFilters.plan) data = data.filter(s => s.plan === storeFilters.plan);

    body.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="search-box">
            <span class="search-icon">🔎</span>
            <input class="input" id="pfSearch" type="search" placeholder="${t('pfSearchStore', 'ابحث باسم المخزن / المالك / البريد…')}" value="${esc(storeFilters.search)}" />
          </div>
          <select class="select" id="pfStatusF">
            <option value="">${t('pfAllStatuses', 'كل الحالات')}</option>
            <option value="active" ${storeFilters.status === 'active' ? 'selected' : ''}>${t('active', 'نشط')}</option>
            <option value="suspended" ${storeFilters.status === 'suspended' ? 'selected' : ''}>${t('suspended', 'موقوف')}</option>
          </select>
          <select class="select" id="pfPlanF">
            <option value="">${t('pfAllPlans', 'كل الخطط')}</option>
            ${['trial', 'basic', 'pro', 'enterprise'].map(p => `<option value="${p}" ${storeFilters.plan === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-primary" id="stAdd">➕ ${t('addStore', 'إضافة مخزن')}</button>
        </div>
      </div>
      <div class="card"><div class="table-wrap"><table class="table table-hover">
        <thead><tr>
          <th>${t('storeName', 'المخزن')}</th><th>${t('plan', 'الخطة')}</th><th>${t('status', 'الحالة')}</th>
          <th>${t('users', 'المستخدمون')}</th><th>${t('products', 'المنتجات')}</th><th>${t('revenue', 'المبيعات')}</th>
          <th>${t('trialEnds', 'نهاية التجربة')}</th><th>${t('actions', 'إجراءات')}</th>
        </tr></thead>
        <tbody>
          ${data.length ? data.map(s => `
            <tr>
              <td><strong>${esc(s.name)}</strong><br/><small class="muted">${esc(s.ownerName || s.email || '')}${s.city ? ' · ' + esc(s.city) : ''}</small></td>
              <td>${planBadge(s.plan)}</td>
              <td>${statusBadge(s)}</td>
              <td><button class="link-btn pf-users" data-id="${s._id}" data-name="${esc(s.name)}">${(s.stats && s.stats.users) || 0} 👥</button></td>
              <td>${(s.stats && s.stats.products) || 0}</td>
              <td>${((s.stats && s.stats.revenue) || 0).toLocaleString()} <small class="muted">DZD</small></td>
              <td>${trialCell(s)}</td>
              <td class="row-actions">
                <button class="btn btn-sm btn-secondary pf-users" data-id="${s._id}" data-name="${esc(s.name)}">👥</button>
                <button class="btn btn-sm btn-secondary pf-edit" data-id="${s._id}">✏️</button>
                <button class="btn btn-sm btn-secondary pf-toggle" data-id="${s._id}" data-status="${s.status}">${s.status === 'active' ? '⏸️' : '▶️'}</button>
                <button class="btn btn-sm btn-secondary pf-extend" data-id="${s._id}">⏳</button>
                <button class="btn btn-sm btn-secondary pf-loginas" data-id="${s._id}" data-name="${esc(s.name)}">🔑</button>
                <button class="btn btn-sm btn-danger pf-del" data-id="${s._id}" data-name="${esc(s.name)}">🗑️</button>
              </td>
            </tr>`).join('') : `<tr><td colspan="8" class="empty-state">${t('pfNoStores', 'لا مخازن مطابقة')}</td></tr>`}
        </tbody>
      </table></div></div>`;

    body.querySelector('#stAdd').addEventListener('click', () => openStoreModal());
    const search = body.querySelector('#pfSearch');
    let deb;
    search.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => { storeFilters.search = search.value; renderStores(body); }, 350);
    });
    body.querySelector('#pfStatusF').addEventListener('change', (e) => { storeFilters.status = e.target.value; renderStores(body); });
    body.querySelector('#pfPlanF').addEventListener('change', (e) => { storeFilters.plan = e.target.value; renderStores(body); });

    body.querySelectorAll('.pf-users').forEach(b => b.addEventListener('click', () => openUsersModal(b.dataset.id, b.dataset.name)));
    body.querySelectorAll('.pf-edit').forEach(b => b.addEventListener('click', () => openStoreModal(b.dataset.id)));
    body.querySelectorAll('.pf-toggle').forEach(b => b.addEventListener('click', () => toggleStore(b.dataset.id, b.dataset.status)));
    body.querySelectorAll('.pf-extend').forEach(b => b.addEventListener('click', () => openExtendModal(b.dataset.id)));
    body.querySelectorAll('.pf-loginas').forEach(b => b.addEventListener('click', () => loginAs(b.dataset.id, b.dataset.name)));
    body.querySelectorAll('.pf-del').forEach(b => b.addEventListener('click', () => deleteStore(b.dataset.id, b.dataset.name)));
  }

  function planBadge(plan) {
    const cls = { trial: 'badge-warning', basic: 'badge-info', pro: 'badge-success', enterprise: 'badge-super' }[plan] || 'badge-muted';
    return `<span class="badge ${cls}">${esc(plan || '—')}</span>`;
  }

  function statusBadge(s) {
    if (s.status === 'suspended') return `<span class="badge badge-danger">${t('suspended', 'موقوف')}</span>`;
    if (s.plan === 'trial' && s.trialEndsAt && new Date(s.trialEndsAt) < new Date()) {
      return `<span class="badge badge-danger">${t('pfTrialExpired', 'انتهت التجربة')}</span>`;
    }
    return `<span class="badge badge-success">${t('active', 'نشط')}</span>`;
  }

  function trialCell(s) {
    if (!s.trialEndsAt) return '—';
    const end = new Date(s.trialEndsAt);
    const days = Math.ceil((end - Date.now()) / 86400000);
    const dateStr = end.toLocaleDateString();
    if (s.plan === 'trial') {
      if (days < 0) return `<span class="badge badge-danger">${dateStr}</span>`;
      if (days <= 7) return `<span class="badge badge-warning" title="${t('pfDaysLeft', 'يوم متبقٍ')}">${dateStr} · ${days}${t('pfDayShort', 'ي')}</span>`;
      return `${dateStr} <small class="muted">(${days} ${t('pfDayShort', 'ي')})</small>`;
    }
    return `<span class="muted">${dateStr}</span>`;
  }

  async function toggleStore(id, current) {
    const next = current === 'active' ? 'suspended' : 'active';
    const msg = next === 'suspended'
      ? t('pfSuspendConfirm', '⚠️ سيتم منع فريق هذا المخزن من الدخول حتى إعادة التفعيل. متابعة؟')
      : t('pfActivateConfirm', 'إعادة تفعيل هذا المخزن؟');
    const ok = await (window.Toast && Toast.confirm ? Toast.confirm(msg) : Promise.resolve(window.confirm(msg)));
    if (!ok) return;
    try {
      await apiFetch.put('/api/stores/' + id, { status: next });
      window.Toast && Toast.success(t('saved', 'تم الحفظ'));
      refreshCurrent();
    } catch (err) { window.Toast && Toast.error(err.message); }
  }

  async function deleteStore(id, name) {
    const msg = (t('deleteStoreConfirm', '⚠️ سيتم حذف المخزن وكل بياناته نهائياً. متأكد؟') + ' — ' + (name || ''));
    const ok = await (window.Toast && Toast.confirm ? Toast.confirm(msg) : Promise.resolve(window.confirm(msg)));
    if (!ok) return;
    try {
      await apiFetch.delete('/api/stores/' + id);
      window.Toast && Toast.success(t('deleted', 'تم الحذف'));
      refreshCurrent();
    } catch (err) { window.Toast && Toast.error(err.message); }
  }

  async function loginAs(id, name) {
    const msg = t('pfLoginAsConfirm', '🔑 سيتم فتح جلسة مؤقتة (ساعتان) داخل حساب مدير هذا المخزن. للعودة إلى المنصة استخدم زر "العودة للمنصة". متابعة؟') + ' — ' + (name || '');
    const ok = await (window.Toast && Toast.confirm ? Toast.confirm(msg) : Promise.resolve(window.confirm(msg)));
    if (!ok) return;
    try {
      const res = await apiFetch.post('/api/stores/' + id + '/login-as', {});
      const d = res.data || res;
      // keep the super session so the user can hop back
      try {
        localStorage.setItem('pf_super_session', JSON.stringify({ token: localStorage.getItem('token'), user: localStorage.getItem('user') }));
        localStorage.setItem('token', d.token);
        localStorage.setItem('user', JSON.stringify(d.user || {}));
      } catch (_) {}
      window.Toast && Toast.success(t('pfLoginAsDone', 'تم الدخول باسم مدير المخزن ✓'));
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 700);
    } catch (err) { window.Toast && Toast.error(err.message); }
  }

  function openExtendModal(id) {
    pfModal({
      title: '⏳ ' + t('pfExtendTrial', 'تمديد فترة التجربة'),
      body: `
        <label class="pf-label">${t('pfDays', 'عدد الأيام')}</label>
        <input class="input" id="pfExtDays" type="number" min="1" max="365" value="14" />
        <div class="pf-quick-row">
          ${[7, 14, 30, 90].map(n => `<button class="btn btn-sm btn-secondary pf-quick" data-days="${n}">+${n}</button>`).join('')}
        </div>`,
      confirmText: t('save', 'حفظ'),
      onConfirm: async (close) => {
        const days = parseInt(document.getElementById('pfExtDays').value, 10) || 14;
        try {
          await apiFetch.post('/api/stores/' + id + '/extend-trial', { days });
          window.Toast && Toast.success(t('pfTrialExtended', 'تم تمديد التجربة ✓'));
          close(); refreshCurrent();
        } catch (err) { window.Toast && Toast.error(err.message); }
      }
    });
    setTimeout(() => {
      document.querySelectorAll('.pf-quick').forEach(b => b.addEventListener('click', () => {
        const inp = document.getElementById('pfExtDays');
        inp.value = (parseInt(inp.value, 10) || 0) + parseInt(b.dataset.days, 10);
      }));
    }, 50);
  }

  /* ---------- Create / Edit store (professional modal) ---------- */
  async function openStoreModal(id) {
    let store = null, stats = null;
    if (id) {
      try {
        const res = await apiFetch.get('/api/stores/' + id);
        const d = res.data || res;
        store = d.store || d; stats = d.stats || null;
      } catch (err) { window.Toast && Toast.error(err.message); return; }
    }
    const isEdit = !!store;
    const L = store && store.limits || {};
    pfModal({
      title: isEdit ? '✏️ ' + t('pfEditStore', 'تعديل المخزن') : '➕ ' + t('addStore', 'إضافة مخزن'),
      subtitle: isEdit ? esc(store.name) + (stats ? ` · ${stats.users} 👥 · ${stats.products} 📦 · ${(stats.revenue || 0).toLocaleString()} DZD` : '') : t('pfCreateHint', 'سيُنشأ حساب مدير تلقائياً للمخزن الجديد'),
      wide: true,
      body: `
        <div class="pf-section-title">🏪 ${t('pfStoreInfo', 'معلومات المخزن')}</div>
        <div class="pf-grid">
          <div><label class="pf-label">${t('storeName', 'اسم المخزن')} *</label><input class="input" id="pfName" value="${esc(store && store.name || '')}" /></div>
          <div><label class="pf-label">${t('pfPhone', 'الهاتف')}</label><input class="input" id="pfPhone" value="${esc(store && store.phone || '')}" /></div>
          <div><label class="pf-label">${t('ownerName', 'اسم المالك')}</label><input class="input" id="pfOwner" value="${esc(store && store.ownerName || '')}" /></div>
          <div><label class="pf-label">${t('pfCity', 'المدينة / الولاية')}</label><input class="input" id="pfCity" value="${esc(store && store.city || '')}" /></div>
          ${isEdit ? `<div><label class="pf-label">${t('email', 'البريد')}</label><input class="input" id="pfEmail" value="${esc(store && store.email || '')}" /></div>` : ''}
          <div class="pf-span2"><label class="pf-label">${t('pfAddress', 'العنوان')}</label><input class="input" id="pfAddress" value="${esc(store && store.address || '')}" /></div>
        </div>
        ${isEdit ? `
          <div class="pf-section-title">⚙️ ${t('pfSubscription', 'الاشتراك')}</div>
          <div class="pf-grid">
            <div><label class="pf-label">${t('plan', 'الخطة')}</label>
              <select class="select" id="pfPlan">
                ${['trial', 'basic', 'pro', 'enterprise'].map(p => `<option value="${p}" ${store.plan === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select></div>
            <div><label class="pf-label">${t('status', 'الحالة')}</label>
              <select class="select" id="pfStatus">
                <option value="active" ${store.status === 'active' ? 'selected' : ''}>${t('active', 'نشط')}</option>
                <option value="suspended" ${store.status === 'suspended' ? 'selected' : ''}>${t('suspended', 'موقوف')}</option>
              </select></div>
            <div><label class="pf-label">${t('pfMaxUsers', 'حد المستخدمين')}</label><input class="input" id="pfMaxUsers" type="number" min="1" value="${L.maxUsers || 5}" /></div>
            <div><label class="pf-label">${t('pfMaxProducts', 'حد المنتجات')}</label><input class="input" id="pfMaxProducts" type="number" min="1" value="${L.maxProducts || 2000}" /></div>
            <div><label class="pf-label">${t('pfAiDaily', 'حد طلبات AI يومياً')}</label><input class="input" id="pfAiDaily" type="number" min="0" value="${(L.aiDailyCalls != null) ? L.aiDailyCalls : 200}" /></div>
          </div>
          <div><label class="pf-label">${t('pfNotes', 'ملاحظات إدارية')}</label><textarea class="input" id="pfNotes" rows="2">${esc(store.notes || '')}</textarea></div>
        ` : `
          <div class="pf-section-title">👤 ${t('pfOwnerAccount', 'حساب المدير')}</div>
          <div class="pf-grid">
            <div><label class="pf-label">${t('email', 'البريد الإلكتروني')} *</label><input class="input" id="pfEmail" type="email" placeholder="admin@store.com" /></div>
            <div><label class="pf-label">${t('password', 'كلمة المرور')} *</label>
              <div class="pf-pass"><input class="input" id="pfPass" type="password" /><button type="button" class="pf-pass-toggle" id="pfPassToggle">👁️</button></div>
            </div>
            <div><label class="pf-label">${t('plan', 'الخطة')}</label>
              <select class="select" id="pfPlan">
                <option value="trial">trial</option><option value="basic">basic</option>
                <option value="pro" selected>pro</option><option value="enterprise">enterprise</option>
              </select></div>
            <div><label class="pf-label">${t('pfTrialDays', 'مدة التجربة (يوم)')}</label><input class="input" id="pfTrialDays" type="number" min="0" value="14" /></div>
          </div>`}
      `,
      confirmText: isEdit ? t('save', 'حفظ') : t('pfCreate', 'إنشاء المخزن'),
      onConfirm: async (close) => {
        const payload = {
          name: val('pfName'), ownerName: val('pfOwner'), phone: val('pfPhone'),
          city: val('pfCity'), address: val('pfAddress'), plan: val('pfPlan')
        };
        if (isEdit) {
          payload.email = val('pfEmail');
          payload.status = val('pfStatus');
          payload.limits = { maxUsers: +val('pfMaxUsers') || 5, maxProducts: +val('pfMaxProducts') || 2000, aiDailyCalls: +val('pfAiDailyCalls') || 200 };
          payload.notes = val('pfNotes');
        } else {
          payload.email = val('pfEmail');
          payload.password = val('pfPass');
          if (+val('pfTrialDays') >= 0) payload.trialDays = +val('pfTrialDays');
        }
        if (!payload.name) { window.Toast && Toast.error(t('pfNameRequired', 'اسم المخزن مطلوب')); return; }
        if (!isEdit && (!payload.email || !payload.password)) { window.Toast && Toast.error(t('pfFieldsRequired', 'أكمل البريد وكلمة المرور')); return; }
        try {
          if (isEdit) await apiFetch.put('/api/stores/' + id, payload);
          else await apiFetch.post('/api/stores', payload);
          window.Toast && Toast.success(isEdit ? t('saved', 'تم الحفظ') : t('storeCreated', 'تم إنشاء المخزن ✓'));
          close(); refreshCurrent();
        } catch (err) { window.Toast && Toast.error(err.message); }
      }
    });
    const tog = document.getElementById('pfPassToggle');
    if (tog) tog.addEventListener('click', () => {
      const inp = document.getElementById('pfPass');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  }

  /* ---------- Users manager per store ---------- */
  async function openUsersModal(storeId, storeName) {
    let users = [];
    try {
      const res = await apiFetch.get('/api/stores/' + storeId + '/users');
      users = (res.data || res).users || [];
    } catch (err) { window.Toast && Toast.error(err.message); return; }

    pfModal({
      title: '👥 ' + t('pfUsersOf', 'حسابات مخزن') + ' — ' + (storeName || ''),
      subtitle: t('pfUsersHint', 'غيّر الدور، أوقف حساباً، أو أعد تعيين كلمة المرور مباشرة'),
      wide: true,
      body: `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>${t('name', 'الاسم')}</th><th>${t('email', 'البريد')}</th><th>${t('role', 'الدور')}</th><th>${t('status', 'الحالة')}</th><th>${t('lastLogin', 'آخر دخول')}</th><th>${t('actions', 'إجراءات')}</th></tr></thead>
          <tbody>
            ${users.length ? users.map(u => `
              <tr data-uid="${u._id}">
                <td class="cell-strong">${esc(u.name || '—')}</td>
                <td class="cell-muted">${esc(u.email || '—')}</td>
                <td>
                  <select class="select pf-role" data-uid="${u._id}">
                    ${['admin', 'manager', 'cashier'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                  </select>
                </td>
                <td>${u.isActive === false ? `<span class="badge badge-muted">${t('inactive', 'غير نشط')}</span>` : `<span class="badge badge-success">${t('active', 'نشط')}</span>`}</td>
                <td class="cell-muted">${u.lastLogin ? new Date(u.lastLogin).toLocaleString() : '—'}</td>
                <td class="row-actions">
                  <button class="btn btn-sm btn-secondary pf-u-toggle" data-uid="${u._id}" data-active="${u.isActive === false ? '0' : '1'}">${u.isActive === false ? '▶️' : '⏸️'}</button>
                  <button class="btn btn-sm btn-secondary pf-u-reset" data-uid="${u._id}">🔑</button>
                  <button class="btn btn-sm btn-danger pf-u-del" data-uid="${u._id}" data-name="${esc(u.name || '')}">🗑️</button>
                </td>
              </tr>`).join('') : `<tr><td colspan="6" class="empty-state">${t('noData', 'لا حسابات')}</td></tr>`}
          </tbody>
        </table></div>
        <div class="pf-add-user">
          <div class="pf-section-title">➕ ${t('pfAddUserToStore', 'إضافة حساب لهذا المخزن')}</div>
          <div class="pf-grid">
            <div><label class="pf-label">${t('name', 'الاسم')} *</label><input class="input" id="pfUName" /></div>
            <div><label class="pf-label">${t('email', 'البريد')} *</label><input class="input" id="pfUEmail" type="email" /></div>
            <div><label class="pf-label">${t('password', 'كلمة المرور')} *</label><input class="input" id="pfUPass" type="password" /></div>
            <div><label class="pf-label">${t('role', 'الدور')}</label>
              <select class="select" id="pfURole"><option value="cashier">cashier</option><option value="manager">manager</option><option value="admin">admin</option></select>
            </div>
          </div>
          <button class="btn btn-primary" id="pfUAdd" style="margin-top:10px">${t('pfAdd', 'إضافة')}</button>
        </div>`,
      hideConfirm: true,
      onOpen: () => {
        const bodyEl = document.querySelector('.pf-modal');
        bodyEl.querySelectorAll('.pf-role').forEach(sel => sel.addEventListener('change', async () => {
          try {
            await apiFetch.patch('/api/stores/' + storeId + '/users/' + sel.dataset.uid, { role: sel.value });
            window.Toast && Toast.success(t('saved', 'تم الحفظ'));
          } catch (err) { window.Toast && Toast.error(err.message); }
        }));
        bodyEl.querySelectorAll('.pf-u-toggle').forEach(b => b.addEventListener('click', async () => {
          const active = b.dataset.active === '1';
          try {
            await apiFetch.patch('/api/stores/' + storeId + '/users/' + b.dataset.uid, { isActive: !active });
            window.Toast && Toast.success(t('saved', 'تم الحفظ'));
            refreshCurrent(); closeTopModal(); openUsersModal(storeId, storeName);
          } catch (err) { window.Toast && Toast.error(err.message); }
        }));
        bodyEl.querySelectorAll('.pf-u-reset').forEach(b => b.addEventListener('click', async () => {
          const np = window.prompt(t('pfNewPassword', 'كلمة المرور الجديدة (6 أحرف على الأقل):') );
          if (!np) return;
          try {
            await apiFetch.patch('/api/stores/' + storeId + '/users/' + b.dataset.uid, { password: np });
            window.Toast && Toast.success(t('pfResetDone', 'تم تعيين كلمة المرور ✓'));
          } catch (err) { window.Toast && Toast.error(err.message); }
        }));
        bodyEl.querySelectorAll('.pf-u-del').forEach(b => b.addEventListener('click', async () => {
          const ok = await (window.Toast && Toast.confirm ? Toast.confirm(t('deleteConfirm', 'تأكيد الحذف؟') + ' — ' + b.dataset.name) : Promise.resolve(window.confirm('delete?')));
          if (!ok) return;
          try {
            await apiFetch.delete('/api/stores/' + storeId + '/users/' + b.dataset.uid);
            window.Toast && Toast.success(t('deleted', 'تم الحذف'));
            refreshCurrent(); closeTopModal(); openUsersModal(storeId, storeName);
          } catch (err) { window.Toast && Toast.error(err.message); }
        }));
        const addBtn = bodyEl.querySelector('#pfUAdd');
        addBtn.addEventListener('click', async () => {
          const payload = { name: val('pfUName'), email: val('pfUEmail'), password: val('pfUPass'), role: val('pfURole') };
          if (!payload.name || !payload.email || !payload.password) { window.Toast && Toast.error(t('pfFieldsRequired', 'أكمل جميع الحقول')); return; }
          try {
            await apiFetch.post('/api/stores/' + storeId + '/users', payload);
            window.Toast && Toast.success(t('userCreated', 'تم إنشاء الحساب ✓'));
            refreshCurrent(); closeTopModal(); openUsersModal(storeId, storeName);
          } catch (err) { window.Toast && Toast.error(err.message); }
        });
      }
    });
  }

  /* ================= BACKUPS (kept from v3) ================= */
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
        <thead><tr><th>${t('filename', 'الملف')}</th><th>${t('size', 'الحجم')}</th><th>${t('created', 'أُنشئت')}</th><th>${t('type', 'النوع')}</th><th>${t('docsCount', 'سجلات')}</th><th>${t('actions', 'إجراءات')}</th></tr></thead>
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
      const ok = await (window.Toast && Toast.confirm ? Toast.confirm(t('restoreConfirm', '⚠️ سيتم استبدال بيانات النظام الحالية بالنسخة. متأكد؟')) : Promise.resolve(window.confirm('restore?')));
      if (!ok) return;
      try {
        await apiFetch.post('/api/backups/restore', { filename: b.dataset.file });
        window.Toast && Toast.success(t('restoreDone', 'تمت الاستعادة ✓ (أعد تحميل الصفحة)'));
      } catch (err) { window.Toast && Toast.error(err.message); }
    }));
  }

  /* ================= helpers ================= */
  function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

  function refreshCurrent() {
    const active = content.querySelector('.tabs-bar .tab-btn.active');
    renderTab(active ? active.dataset.tab : 'stores');
  }

  function fmtDate(d) {
    try { return new Date(d).toLocaleDateString((lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB')); }
    catch (e) { return '—'; }
  }

  function esc(x) {
    return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- reusable professional modal ---------- */
  function pfModal({ title, subtitle, body, confirmText, onConfirm, onOpen, wide, hideConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'pf-overlay';
    overlay.innerHTML = `
      <div class="pf-modal ${wide ? 'pf-wide' : ''}" role="dialog" aria-modal="true">
        <div class="pf-modal-head">
          <div>
            <div class="pf-modal-title">${title}</div>
            ${subtitle ? `<div class="pf-modal-sub">${subtitle}</div>` : ''}
          </div>
          <button class="pf-close" aria-label="close">✕</button>
        </div>
        <div class="pf-modal-body">${body}</div>
        ${hideConfirm ? '' : `
        <div class="pf-modal-foot">
          <button class="btn btn-secondary pf-cancel">${t('cancel', 'إلغاء')}</button>
          <button class="btn btn-primary pf-ok">${confirmText || t('save', 'حفظ')}</button>
        </div>`}
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const close = () => {
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.pf-close').addEventListener('click', close);
    const cancel = overlay.querySelector('.pf-cancel');
    if (cancel) cancel.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const ok = overlay.querySelector('.pf-ok');
    if (ok && onConfirm) ok.addEventListener('click', () => onConfirm(close));
    if (onOpen) onOpen();
    const first = overlay.querySelector('.pf-modal-body input');
    if (first) setTimeout(() => first.focus(), 60);
  }

  function closeTopModal() {
    const overlays = document.querySelectorAll('.pf-overlay');
    if (overlays.length) {
      overlays[overlays.length - 1].remove();
      document.body.style.overflow = '';
    }
  }

  await loadOverviewSafe();
  renderTab('overview');

  async function loadOverviewSafe() {
    try { const r = await apiFetch.get('/api/stores/platform-overview'); overviewCache = r.data || r; } catch (e) { /* rendered later anyway */ }
  }
}
