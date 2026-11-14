/* ============================================================
 * js/modules/subscription.js — Store subscription center (v4.3 / v4.3.1)
 * ------------------------------------------------------------
 * The store's admin sees everything about its subscription:
 *   • hero status: plan, state, period, days-left progress, usage
 *   • pending request banner (with cancel)
 *   • plan catalog with monthly / yearly pricing (DZD)
 *   • "request change / subscribe / renew" flow → the super-admin
 *     confirms the payment, then the plan is applied automatically
 *   • full request + payment history
 *
 * v4.3.1 — the PLATFORM OWNER can open this page too:
 *   • without focus → all-stores picker (name, plan, state, days left,
 *     pending request badge, search box)
 *   • picking a store loads its FULL detail via X-Store-Id (store focus)
 *     with a "back to all stores" button — no more "Required fields
 *     are missing" error
 * Exports: renderSubscriptionPage({ apiBase })
 * ============================================================ */

export async function renderSubscriptionPage(ctx) {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const t = (k, fb) => (typeof window.t === 'function') ? window.t(k, fb) : fb;
  const lang = (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';
  const apiBase = (ctx && ctx.apiBase) || window.DZPOS_API_BASE || '';
  const me = (function () { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch (_) { return {}; } })();
  const isSuperAdmin = (me.role || '') === 'superadmin';
  const canRequest = ['admin', 'manager'].includes(me.role || '') && !isSuperAdmin;

  let cycleView = 'monthly';
  // v4.3.1 — super-admin store focus (persisted between re-renders)
  let focusId = (isSuperAdmin && window.dzposSubFocusId) ? String(window.dzposSubFocusId) : '';
  if (!isSuperAdmin) focusId = '';

  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US');
  const fmtDate = (d) => {
    try { return new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB'); }
    catch (e) { return '—'; }
  };
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const STATE_BADGES = {
    trial:         { cls: 'badge-info',    key: 'subStateTrial',         fb: 'فترة تجريبية' },
    trial_expired: { cls: 'badge-danger',  key: 'subStateTrialExpired',  fb: 'انتهت التجربة' },
    active:        { cls: 'badge-success', key: 'subStateActive',        fb: 'مفعّل' },
    expiring:      { cls: 'badge-warning', key: 'subStateExpiring',      fb: 'ينتهي قريباً' },
    grace:         { cls: 'badge-warning', key: 'subStateGrace',         fb: 'متأخر السداد' },
    expired:       { cls: 'badge-danger',  key: 'subStateExpired',       fb: 'منتهي' },
    suspended:     { cls: 'badge-danger',  key: 'subStateSuspended',     fb: 'موقوف' }
  };
  const PAY_LABELS = {
    ccp:          { key: 'payCcp',   fb: 'CCP (بريد الجزائر)' },
    baridimob:    { key: 'payBaridimob', fb: 'BaridiMob' },
    cash:         { key: 'payCash',  fb: 'نقداً (مباشر)' },
    bank_transfer:{ key: 'payBank',  fb: 'تحويل بنكي' },
    other:        { key: 'payOther', fb: 'أخرى' },
    manual:       { key: 'payManual', fb: 'تسجيل يدوي (المنصة)' }
  };
  const TYPE_LABELS = {
    new:     { key: 'subTypeNew',     fb: 'اشتراك جديد' },
    change:  { key: 'subTypeChange',  fb: 'تغيير خطة' },
    renewal: { key: 'subTypeRenewal', fb: 'تجديد' }
  };
  const STATUS_LABELS = {
    pending:   { cls: 'badge-warning', key: 'subStatusPending',   fb: 'قيد المراجعة' },
    approved:  { cls: 'badge-success', key: 'subStatusApproved',  fb: 'مقبول' },
    rejected:  { cls: 'badge-danger',  key: 'subStatusRejected',  fb: 'مرفوض' },
    cancelled: { cls: 'badge-muted',   key: 'subStatusCancelled', fb: 'ملغى' }
  };
  const PLAN_LABELS = {
    trial:      { key: 'planTrialName',      fb: 'التجربة' },
    basic:      { key: 'planBasicName',      fb: 'الأساسية' },
    pro:        { key: 'planProName',        fb: 'الاحترافية' },
    enterprise: { key: 'planEnterpriseName', fb: 'المؤسسات' }
  };
  const lbl = (map, k) => {
    // v4.5 — the plan catalog is DYNAMIC (edited by the super-admin): prefer
    // the live catalog display name, fall back to the i18n label for the
    // default keys, then to the raw key.
    try {
      if (window.__dzposPlanNames && window.__dzposPlanNames[String(k)]) return window.__dzposPlanNames[String(k)];
    } catch (_) {}
    const m = map[k];
    return m ? t(m.key, m.fb) : (k || '—');
  };
  // cache the catalog names from the freshest server response
  function cachePlanNames(catalog) {
    if (!Array.isArray(catalog)) return;
    const names = {};
    catalog.forEach(p => { if (p && p.key) names[p.key] = p.name || p.key; });
    window.__dzposPlanNames = Object.assign({}, window.__dzposPlanNames || {}, names);
  }

  /* ---------- load ---------- */
  async function fetchView() {
    const headers = focusId ? { 'X-Store-Id': focusId } : {};
    const res = await apiFetch('/api/subscription', { method: 'GET', cache: 'no-store', headers });
    return res.data || res;
  }

  content.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
  let data = null;
  try {
    data = await fetchView();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div>
      <div class="empty-action"><button class="btn btn-secondary btn-sm" onclick="window.loadPage('subscription')">${t('retry', 'إعادة المحاولة')}</button></div></div>`;
    return;
  }

  /* ============================================================
   * v4.3.1 — PLATFORM VIEW (super-admin, no store focus)
   * ============================================================ */
  if (data.isPlatform) {
    cachePlanNames(data.catalog);
    window.dzposSubFocusId = '';
    const stores = data.stores || [];
    const pendCount = stores.filter(s => s.pending).length;
    const counts = stores.reduce((acc, s) => { const k = s.state || 'active'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});

    function platformHTML() {
      return `
        <div class="page-subtitle">${t('subPlatformSubtitle', 'نظرة شاملة على اشتراكات كل المتاجر — اختر متجراً لعرض تفاصيله الكاملة.')}</div>

        <div class="card sub-hero sub-hero-platform">
          <div class="sub-platform-kpis">
            <div class="sub-plat-kpi"><span class="sub-plat-num">${stores.length}</span><span class="sub-plat-lbl">🏪 ${t('subStoresTotal', 'إجمالي المتاجر')}</span></div>
            <div class="sub-plat-kpi"><span class="sub-plat-num" style="color:#10b981">${counts.active || 0}</span><span class="sub-plat-lbl">✅ ${t('subStateActive', 'مفعّل')}</span></div>
            <div class="sub-plat-kpi"><span class="sub-plat-num" style="color:#f59e0b">${(counts.expiring || 0) + (counts.grace || 0)}</span><span class="sub-plat-lbl">⚠️ ${t('subNeedsAttention', 'يحتاج متابعة')}</span></div>
            <div class="sub-plat-kpi"><span class="sub-plat-num" style="color:#ef4444">${(counts.expired || 0) + (counts.suspended || 0) + (counts.trial_expired || 0)}</span><span class="sub-plat-lbl">⛔ ${t('subStopped', 'متوقف')}</span></div>
            <div class="sub-plat-kpi"><span class="sub-plat-num" style="color:#6366f1">${pendCount}</span><span class="sub-plat-lbl">⏳ ${t('subPendingCount', 'طلبات معلّقة')}</span></div>
          </div>
        </div>

        <div class="card">
          <div class="sub-platform-head">
            <div class="card-title">🏪 ${t('subPlatformTitle', 'اشتراكات المتاجر')}</div>
            <input class="input sub-store-search" id="subStoreSearch" type="search"
                   placeholder="${t('subStoreSearch', 'بحث باسم المتجر…')}" />
          </div>
          <div class="sub-store-grid" id="subStoreGrid"></div>
        </div>`;
    }

    function renderStoreGrid() {
      const grid = content.querySelector('#subStoreGrid');
      if (!grid) return;
      const q = (content.querySelector('#subStoreSearch') || {}).value || '';
      const norm = (x) => String(x || '').toLowerCase().trim();
      const list = stores.filter(s => !norm(q) || norm(s.name).includes(norm(q)));
      if (!list.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${stores.length ? t('subNoMatch', 'لا نتائج مطابقة للبحث') : t('subPlatformEmpty', 'لا توجد متاجر مسجلة بعد')}</div>`;
        return;
      }
      grid.innerHTML = list.map(s => {
        const b = STATE_BADGES[s.state] || STATE_BADGES.active;
        const days = s.daysLeft == null ? '' : (s.daysLeft >= 0
          ? `<div class="sub-store-days">${t('subDaysLeft', 'يوماً متبقياً')}: <strong>${s.daysLeft}</strong></div>`
          : `<div class="sub-store-days text-danger">${t('subDaysOver', 'يوماً بعد انتهاء الفترة')}: <strong>${Math.abs(s.daysLeft)}</strong></div>`);
        const ends = s.plan === 'trial' ? s.trialEndsAt : s.subscriptionEndsAt;
        return `
          <div class="sub-store-card ${s.pending ? 'has-pending' : ''}" data-store="${esc(s.id)}" role="button" tabindex="0">
            <div class="sub-store-top">
              <strong class="sub-store-name">${esc(s.name)}</strong>
              <span class="badge ${b.cls}">${t(b.key, b.fb)}</span>
            </div>
            <div class="sub-store-mid">
              <span class="badge badge-muted">💼 ${esc(lbl(PLAN_LABELS, s.plan))}</span>
              ${s.billingCycle ? `<span class="badge badge-muted">${s.billingCycle === 'yearly' ? t('subCycleYearly', 'سنوي') : t('subCycleMonthly', 'شهري')}</span>` : ''}
              ${s.status === 'suspended' ? `<span class="badge badge-danger">${t('subStateSuspended', 'موقوف')}</span>` : ''}
            </div>
            ${ends ? `<div class="sub-store-ends muted">${s.plan === 'trial' ? t('trialEnds', 'نهاية التجربة') : t('subEnds', 'نهاية الفترة')}: ${fmtDate(ends)}</div>` : ''}
            ${days}
            ${s.pending ? `<div class="sub-store-pending">⏳ ${esc(lbl(TYPE_LABELS, s.pending.type))} → ${esc(lbl(PLAN_LABELS, s.pending.requestedPlan))} · ${fmtMoney(s.pending.amount)} DZD</div>` : ''}
            <button class="btn btn-secondary btn-sm sub-store-open">${t('subPickStore', 'عرض التفاصيل')} ›</button>
          </div>`;
      }).join('');
      grid.querySelectorAll('.sub-store-card').forEach(card => {
        const open = () => {
          window.dzposSubFocusId = card.dataset.store;
          focusId = card.dataset.store;
          window.loadPage('subscription');
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
    }

    content.innerHTML = platformHTML();
    renderStoreGrid();
    const search = content.querySelector('#subStoreSearch');
    if (search) search.addEventListener('input', renderStoreGrid);
    return;
  }

  /* ============================================================
   * STORE DETAIL VIEW (store admin — or super-admin in focus mode)
   * ============================================================ */
  const st = data.store || {};
  const plan = data.plan || {};
  const limits = st.limits || plan || {};
  const usage = data.usage || {};
  const catalog = data.catalog || [];
  cachePlanNames(catalog); // v4.5 — live plan display names
  const state = data.state || 'active';
  const daysLeft = data.daysLeft;
  const pending = data.pending;
  const isPlatformFocus = !!data.isPlatformFocus;
  if (isSuperAdmin) window.dzposSubFocusId = focusId || '';
  else window.dzposSubFocusId = '';

  /* ---------- helpers ---------- */
  function periodBar() {
    if (st.plan !== 'trial' && !st.subscriptionEndsAt) {
      return `<div class="muted" style="margin-top:6px">${t('subLegacy', 'اشتراك موروث بدون تاريخ انتهاء — يتجدد يدوياً مع إدارة المنصة.')}</div>`;
    }
    if (daysLeft == null) return '';
    const totalDays = (function () {
      const base = st.plan === 'trial' ? 14 : (st.billingCycle === 'yearly' ? 365 : 31);
      return base;
    })();
    const pct = Math.max(0, Math.min(100, Math.round((Math.max(0, daysLeft) / totalDays) * 100)));
    const cls = daysLeft <= 7 ? 'sub-bar-danger' : daysLeft <= 14 ? 'sub-bar-warn' : 'sub-bar-ok';
    return `
      <div class="sub-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="sub-progress-fill ${cls}" style="width:${pct}%"></div>
      </div>
      <div class="sub-days ${daysLeft < 0 ? 'text-danger' : ''}">${daysLeft >= 0
        ? `⏳ <strong>${daysLeft}</strong> ${t('subDaysLeft', 'يوماً متبقياً')}`
        : `⚠️ <strong>${Math.abs(daysLeft)}</strong> ${t('subDaysOver', 'يوماً بعد انتهاء الفترة')}${state === 'grace' ? ` — ${t('subGraceHint', 'مهلة سماح قبل التوقف')} (${data.graceDays} ${t('pfDayShort', 'ي')})` : ''}`}</div>`;
  }

  function usageRow(label, used, max) {
    const cap = (max != null && max > 0) ? max : null;
    const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    const cls = pct >= 100 ? 'sub-bar-danger' : pct >= 80 ? 'sub-bar-warn' : 'sub-bar-ok';
    return `
      <div class="sub-usage-row">
        <div class="sub-usage-head"><span>${label}</span><span>${used}${cap ? ' / ' + cap : ''}</span></div>
        ${cap ? `<div class="sub-progress sub-progress-sm"><div class="sub-progress-fill ${cls}" style="width:${pct}%"></div></div>` : ''}
      </div>`;
  }

  /* ---------- render ---------- */
  const badge = STATE_BADGES[state] || STATE_BADGES.active;
  const priceNow = st.plan !== 'trial' ? (st.billingCycle === 'yearly' ? plan.yearly : plan.monthly) : 0;

  content.innerHTML = `
    ${isPlatformFocus ? `
    <div class="card sub-focus-banner">
      <div>🛡️ ${t('subPlatformFocusBanner', 'أنت تعرض اشتراك متجر من حساب المنصة — طلبات التغيير تُرسل من طرف المتجر نفسه، ولديك التحكم الكامل من تبويب المنصة.')}</div>
      <button class="btn btn-secondary btn-sm" id="subBackBtn">← ${t('subBackToStores', 'كل المتاجر')}</button>
    </div>` : ''}
    <div class="page-subtitle">${t('subPageTitle', 'تفاصيل اشتراك مخزنكم، الخطط المتوفرة، وطلبات التغيير أو التجديد.')}</div>

    <!-- ===== hero status ===== -->
    <div class="card sub-hero">
      <div class="sub-hero-main">
        <div class="sub-hero-plan">
          ${isPlatformFocus ? `<span class="badge badge-info" style="font-size:13px;padding:5px 12px">🏪 ${esc(st.name || '')}</span>` : ''}
          <span class="badge ${plan.badge || 'badge-info'}" style="font-size:14px;padding:6px 14px">💼 ${esc(lbl(PLAN_LABELS, st.plan))}</span>
          <span class="badge ${badge.cls}">${t(badge.key, badge.fb)}</span>
          ${st.plan !== 'trial' && st.billingCycle ? `<span class="badge badge-muted">${st.billingCycle === 'yearly' ? t('subCycleYearly', 'سنوي') : t('subCycleMonthly', 'شهري')}</span>` : ''}
        </div>
        <div class="sub-hero-price">${st.plan !== 'trial' ? `${fmtMoney(priceNow)} <small>DZD</small>` : t('subFreeTrial', 'مجاناً')}</div>
        <div class="muted" style="margin-top:2px">
          ${st.plan !== 'trial' && st.subscriptionStart ? `${t('subStarted', 'بداية الاشتراك')}: <strong>${fmtDate(st.subscriptionStart)}</strong> · ` : ''}
          ${st.plan === 'trial' && st.trialEndsAt ? `${t('trialEnds', 'نهاية التجربة')}: <strong>${fmtDate(st.trialEndsAt)}</strong>` : ''}
          ${st.plan !== 'trial' && st.subscriptionEndsAt ? `${t('subEnds', 'نهاية الفترة')}: <strong>${fmtDate(st.subscriptionEndsAt)}</strong>` : ''}
        </div>
        ${periodBar()}
      </div>
      <div class="sub-hero-usage">
        <div class="pf-section-title">📊 ${t('subUsage', 'الاستخدام مقابل الحدود')}</div>
        ${usageRow('👥 ' + t('subUsers', 'المستخدمون'), usage.users || 0, limits.maxUsers)}
        ${usageRow('📦 ' + t('subProducts', 'المنتجات'), usage.products || 0, limits.maxProducts)}
        ${usageRow('✨ ' + t('subAiCalls', 'طلبات AI اليوم'), usage.aiToday || 0, limits.aiDailyCalls)}
      </div>
    </div>

    <!-- ===== pending request ===== -->
    ${pending ? `
    <div class="card sub-pending">
      <div>
        ⏳ <strong>${t('subPendingBanner', 'لديكم طلب قيد المراجعة')}:</strong>
        ${esc(lbl(TYPE_LABELS, pending.type))} → <strong>${esc(lbl(PLAN_LABELS, pending.requestedPlan))}</strong>
        (${pending.billingCycle === 'yearly' ? t('subCycleYearly', 'سنوي') : t('subCycleMonthly', 'شهري')} · ${fmtMoney(pending.amount)} DZD)
        <span class="badge badge-warning">${t('subStatusPending', 'قيد المراجعة')}</span>
        <br/><small class="muted">${t('subPendingHint', 'سيتم تفعيل الاشتراك تلقائياً بعد تأكيد إدارة المنصة للدفع.')}</small>
      </div>
      ${canRequest ? `<button class="btn btn-secondary btn-sm" id="subCancelReq">${t('subPendingCancel', 'إلغاء الطلب')}</button>` : ''}
    </div>` : ''}

    <!-- ===== plans ===== -->
    <div class="card">
      <div class="card-head-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div class="card-title">🧩 ${t('subPlansTitle', 'الخطط المتوفرة')}</div>
        <div class="sub-cycle-toggle" role="tablist">
          <button class="sub-cycle-btn ${cycleView === 'monthly' ? 'active' : ''}" data-cycle="monthly">${t('subCycleMonthly', 'شهري')}</button>
          <button class="sub-cycle-btn ${cycleView === 'yearly' ? 'active' : ''}" data-cycle="yearly">${t('subCycleYearly', 'سنوي')} <small>−${t('subSaveHint', 'شهران مجاناً')}</small></button>
        </div>
      </div>
      <div class="sub-plans" id="subPlans"></div>
      <div class="card ai-narrative" style="margin-top:14px">
        <strong>ℹ️</strong>
        <div>${t('subStepsHint', 'كيف يعمل الاشتراك: اختر الخطة → أرسل الطلب مع طريقة الدفع → تؤكد إدارة المنصة استلام الدفع → يتفعّل اشتراككم تلقائياً ويتم إشعاركم هنا.')}</div>
      </div>
    </div>

    <!-- ===== history ===== -->
    <div class="card">
      <div class="card-title" style="margin-bottom:10px">🧾 ${t('subHistoryTitle', 'سجل الطلبات والمدفوعات')}</div>
      <div class="table-wrap"><table class="table table-hover">
        <thead><tr>
          <th>${t('subHDate', 'التاريخ')}</th><th>${t('subHType', 'النوع')}</th><th>${t('subHPlan', 'الخطة المطلوبة')}</th>
          <th>${t('subHCycle', 'الدورة')}</th><th>${t('subHAmount', 'المبلغ')}</th><th>${t('subHMethod', 'الدفع')}</th>
          <th>${t('subHStatus', 'الحالة')}</th><th>${t('subHNote', 'ملاحظة الإدارة')}</th>
        </tr></thead>
        <tbody>
          ${(data.requests || []).length ? data.requests.map(r => {
            const sb = STATUS_LABELS[r.status] || STATUS_LABELS.pending;
            return `<tr>
              <td>${fmtDate(r.createdAt)}</td>
              <td>${esc(lbl(TYPE_LABELS, r.type))}</td>
              <td><strong>${esc(lbl(PLAN_LABELS, r.requestedPlan))}</strong></td>
              <td>${r.billingCycle === 'yearly' ? t('subCycleYearly', 'سنوي') : t('subCycleMonthly', 'شهري')}</td>
              <td>${fmtMoney(r.amount)} <small class="muted">DZD</small></td>
              <td class="cell-muted">${esc(lbl(PAY_LABELS, r.paymentMethod))}</td>
              <td><span class="badge ${sb.cls}">${t(sb.key, sb.fb)}</span></td>
              <td class="cell-muted">${esc(r.adminNote || '—')}</td>
            </tr>`;
          }).join('') : `<tr><td colspan="8" class="empty-state">${t('subNoRequests', 'لا طلبات بعد — اختر خطة بالأعلى للبدء')}</td></tr>`}
        </tbody>
      </table></div>
    </div>`;

  /* ---------- platform focus: back button ---------- */
  const backBtn = content.querySelector('#subBackBtn');
  if (backBtn) backBtn.addEventListener('click', () => {
    focusId = '';
    window.dzposSubFocusId = '';
    window.loadPage('subscription');
  });

  /* ---------- plan cards ---------- */
  function renderPlans() {
    const wrap = content.querySelector('#subPlans');
    if (!wrap) return;
    wrap.innerHTML = catalog.map(p => {
      const isCurrent = p.key === st.plan;
      const price = cycleView === 'yearly' ? p.yearly : p.monthly;
      const ctaKey = isCurrent ? 'subCurrentCta'
        : (st.plan === p.key ? 'subRenewCta'
          : (st.plan === 'trial' ? 'subNewCta'
            : (p.key === 'trial' ? 'subCurrentCta' : 'subUpgradeCta')));
      const disabled = isCurrent || p.key === 'trial' || !!pending || !canRequest;
      const save = cycleView === 'yearly' && p.monthly > 0 ? `<div class="sub-save">💎 ${t('subSaveCalc', 'توفير')} ${fmtMoney(p.monthly * 12 - p.yearly)} DZD</div>` : '';
      return `
        <div class="sub-plan-card ${isCurrent ? 'current' : ''}" data-plan="${p.key}">
          ${isCurrent ? `<div class="sub-plan-tag">${t('subCurrentTag', 'خطتكم الحالية')}</div>` : ''}
          <div class="sub-plan-name">${esc(p.name || lbl(PLAN_LABELS, p.key))}</div>
          <div class="sub-plan-price">${p.key === 'trial' ? t('subFreeTrial', 'مجاناً') : `${fmtMoney(price)} <small>DZD / ${cycleView === 'yearly' ? t('subPerYearShort', 'سنة') : t('subPerMonthShort', 'شهر')}</small>`}</div>
          ${save}
          <ul class="sub-plan-feats">
            <li>👥 ${p.maxUsers} ${t('subUsers', 'المستخدمون')}</li>
            <li>📦 ${p.maxProducts.toLocaleString('en-US')} ${t('subProducts', 'المنتجات')}</li>
            <li>✨ ${p.aiDailyCalls} ${t('subAiCallsDay', 'طلب AI / يوم')}</li>
          </ul>
          <button class="btn ${isCurrent ? 'btn-secondary' : 'btn-primary'} btn-block" data-plan="${p.key}" ${disabled ? 'disabled' : ''}>
            ${isCurrent ? t('subCurrentCta', 'خطتكم الحالية') : pending ? t('subPendingCta', 'طلب قيد المراجعة…') : !canRequest ? (isPlatformFocus ? t('subPlatformManagedCta', 'يُدار من المنصة') : t('subAdminOnlyCta', 'للمدير فقط')) : t(ctaKey, 'طلب الاشتراك')}
          </button>
        </div>`;
    }).join('');
    wrap.querySelectorAll('.sub-plan-card button[data-plan]').forEach(b => {
      b.addEventListener('click', () => openRequestModal(b.dataset.plan));
    });
  }
  renderPlans();

  content.querySelectorAll('.sub-cycle-btn').forEach(b => {
    b.addEventListener('click', () => {
      cycleView = b.dataset.cycle;
      content.querySelectorAll('.sub-cycle-btn').forEach(x => x.classList.toggle('active', x.dataset.cycle === cycleView));
      renderPlans();
    });
  });

  /* ---------- cancel pending ---------- */
  const cancelBtn = content.querySelector('#subCancelReq');
  if (cancelBtn) cancelBtn.addEventListener('click', async () => {
    const ok = await (window.Toast && Toast.confirm ? Toast.confirm(t('subCancelConfirm', 'إلغاء هذا الطلب؟')) : Promise.resolve(window.confirm('cancel?')));
    if (!ok) return;
    try {
      await apiFetch.post('/api/subscription/requests/' + pending._id + '/cancel', {});
      window.Toast && Toast.success(t('subCancelDone', 'تم إلغاء الطلب ✓'));
      window.loadPage('subscription');
    } catch (err) { window.Toast && Toast.error(err.message); }
  });

  /* ---------- request modal ---------- */
  function subModal({ title, body, confirmText, onConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'pf-overlay';
    overlay.innerHTML = `
      <div class="pf-modal" role="dialog" aria-modal="true">
        <div class="pf-modal-head">
          <div><div class="pf-modal-title">${title}</div></div>
          <button class="pf-close" aria-label="close">✕</button>
        </div>
        <div class="pf-modal-body">${body}</div>
        <div class="pf-modal-foot">
          <button class="btn btn-secondary pf-cancel">${t('cancel', 'إلغاء')}</button>
          <button class="btn btn-primary pf-ok">${confirmText || t('save', 'حفظ')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    const close = () => { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.pf-close').addEventListener('click', close);
    overlay.querySelector('.pf-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.pf-ok').addEventListener('click', () => onConfirm(close));
    const first = overlay.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 60);
  }
  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  function openRequestModal(planKey) {
    const p = catalog.find(x => x.key === planKey);
    if (!p) return;
    const isRenewal = planKey === st.plan;
    subModal({
      title: (isRenewal ? '🔄 ' : '🚀 ') + t('subRequestTitle', 'طلب اشتراك'),
      confirmText: t('subSubmit', 'إرسال الطلب'),
      body: `
        <div class="pf-section-title">💼 ${t('subRequestPlan', 'الخطة المطلوبة')}</div>
        <div class="sub-req-summary">
          <span class="badge ${p.badge || 'badge-info'}">${esc(lbl(PLAN_LABELS, planKey))}</span>
          <select class="select" id="subReqCycle" style="max-width:180px">
            <option value="monthly" ${cycleView === 'monthly' ? 'selected' : ''}>${t('subCycleMonthly', 'شهري')} — ${fmtMoney(p.monthly)} DZD</option>
            <option value="yearly" ${cycleView === 'yearly' ? 'selected' : ''}>${t('subCycleYearly', 'سنوي')} — ${fmtMoney(p.yearly)} DZD</option>
          </select>
          <strong id="subReqAmount">${fmtMoney(cycleView === 'yearly' ? p.yearly : p.monthly)} DZD</strong>
        </div>
        <div class="pf-section-title">💳 ${t('subPayMethod', 'طريقة الدفع')}</div>
        <div class="pf-grid">
          <div><label class="pf-label">${t('subPayMethod', 'طريقة الدفع')}</label>
            <select class="select" id="subReqMethod">
              <option value="ccp">${t('payCcp', 'CCP (بريد الجزائر)')}</option>
              <option value="baridimob">${t('payBaridimob', 'BaridiMob')}</option>
              <option value="cash">${t('payCash', 'نقداً (مباشر)')}</option>
              <option value="bank_transfer">${t('payBank', 'تحويل بنكي')}</option>
              <option value="other">${t('payOther', 'أخرى')}</option>
            </select></div>
          <div><label class="pf-label">${t('subPayRef', 'مرجع الدفع')}</label>
            <input class="input" id="subReqRef" placeholder="${t('subPayRefHint', 'رقم الحوالة / المرجع (إن وجد)')}" /></div>
          <div class="pf-span2"><label class="pf-label">${t('subNote', 'ملاحظة للإدارة')}</label>
            <textarea class="input" id="subReqNote" rows="2" placeholder="${t('subNoteHint', 'مثال: تم الدفع عبر BaridiMob يوم …')}" maxlength="500"></textarea></div>
        </div>`,
      onConfirm: async (close) => {
        const cycle = val('subReqCycle') || 'monthly';
        const payload = {
          requestedPlan: planKey,
          billingCycle: cycle,
          paymentMethod: val('subReqMethod') || 'other',
          paymentReference: val('subReqRef'),
          storeNote: val('subReqNote')
        };
        try {
          await apiFetch.post('/api/subscription/requests', payload);
          window.Toast && Toast.success(t('subRequestSent', 'تم إرسال الطلب ✓ — سيتم التفعيل بعد تأكيد الدفع'));
          close(); window.loadPage('subscription');
        } catch (err) { window.Toast && Toast.error(err.message); }
      }
    });
    const cycleSel = document.getElementById('subReqCycle');
    if (cycleSel) cycleSel.addEventListener('change', () => {
      const amount = cycleSel.value === 'yearly' ? p.yearly : p.monthly;
      document.getElementById('subReqAmount').textContent = fmtMoney(amount) + ' DZD';
    });
  }
}
