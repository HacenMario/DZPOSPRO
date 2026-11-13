/* ============================================================
 * js/modules/ai.js — AI Center (v4)
 * ------------------------------------------------------------
 * Tabs:
 *   0. insights  — 🧠 Smart Insights (built-in Smart Engine: 100% free,
 *                  no API key, deep inventory + sales + customers analysis,
 *                  health score, prioritized actionable recommendations)
 *   1. assistant — "اسأل مخزنك" chat (Gemini, local engine fallback)
 *   2. forecast  — sales forecast + restock suggestions table
 *   3. anomalies — security findings + AI interpretation
 *   4. ocr       — supplier invoice photo → products + draft PO
 *   5. summary   — smart daily summary (manual trigger)
 * Insights work for EVERY role; generative tabs stay admin+manager.
 * Exports: renderAiPage({ apiBase })
 * ============================================================ */

export async function renderAiPage(ctx) {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const lang = (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';
  const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : fb);

  content.innerHTML = `
    <div class="ai-page">
      <div class="ai-status-bar" id="aiStatusBar"></div>
      <div class="tabs-bar" id="aiTabs">
        <button class="tab-btn active" data-tab="insights">🧠 ${t('aiInsights', 'التحليل الذكي العميق')}</button>
        <button class="tab-btn" data-tab="assistant">💬 ${t('aiAssistant', 'المساعد الذكي')}</button>
        <button class="tab-btn" data-tab="forecast">📈 ${t('aiForecast', 'التنبؤ وإعادة التخزين')}</button>
        <button class="tab-btn" data-tab="anomalies">🛡️ ${t('aiAnomalies', 'كشف الشواذ')}</button>
        <button class="tab-btn" data-tab="ocr">📸 ${t('aiOcr', 'قراءة فاتورة مورد')}</button>
        <button class="tab-btn" data-tab="summary">🌙 ${t('aiSummary', 'الملخص اليومي')}</button>
      </div>
      <div class="tab-body" id="aiTabBody"></div>
    </div>`;

  // status bar
  // tabs wiring
  content.querySelectorAll('#aiTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('#aiTabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTab(btn.dataset.tab);
    });
  });

  /* ---------- status ---------- */
  async function loadStatusBar() {
    const bar = content.querySelector('#aiStatusBar');
    try {
      const res = await apiFetch.get('/api/ai/status');
      const st = res.data || res;
      const quotaTxt = st.quota && st.quota.limit > 0
        ? `${st.quota.used || 0}/${st.quota.limit}`
        : '∞';
      bar.innerHTML = st.configured
        ? `<span class="ai-chip ok">🤖 Gemini · ${st.model || ''}</span><span class="ai-chip">⚡ ${t('aiQuotaToday', 'استخدام اليوم')}: ${quotaTxt}</span>`
        : `<span class="ai-chip warn">⚠️ ${t('aiNotConfigured', 'أضف مفتاح Gemini من الإعدادات لتفعيل الذكاء الاصطناعي')}</span><a class="ai-chip link" href="#" id="goSettings">${t('settings', 'الإعدادات')} →</a>`;
      const go = bar.querySelector('#goSettings');
      if (go) go.addEventListener('click', (e) => { e.preventDefault(); if (window.loadPage) window.loadPage('settings'); });
    } catch (_) {
      bar.innerHTML = '';
    }
  }

  /* ---------- tab renderer ---------- */
  function renderTab(name) {
    const body = content.querySelector('#aiTabBody');
    if (name === 'insights') renderInsights(body);
    else if (name === 'assistant') renderAssistant(body);
    else if (name === 'forecast') renderForecast(body);
    else if (name === 'anomalies') renderAnomalies(body);
    else if (name === 'ocr') renderOcr(body);
    else if (name === 'summary') renderSummary(body);
  }

  /* ============================================================
   * 0) SMART INSIGHTS — built-in Smart Engine (free, no key needed)
   * Deep inventory + sales + customers analysis with health score
   * and prioritized, actionable recommendations.
   * ============================================================ */
  const INS_SEV = {
    critical:    { cls: 'ins-critical',    badge: 'danger',  label: t('insCritical', 'حرِج') },
    high:        { cls: 'ins-high',        badge: 'warning', label: t('insHigh', 'مرتفع') },
    medium:      { cls: 'ins-medium',      badge: 'warning', label: t('insMedium', 'متوسط') },
    low:         { cls: 'ins-low',         badge: 'info',    label: t('insLow', 'منخفض') },
    info:        { cls: 'ins-info',        badge: 'info',    label: t('insInfo', 'معلومة') },
    opportunity: { cls: 'ins-opportunity', badge: 'success', label: t('insOpportunity', 'فرصة') }
  };

  async function renderInsights(body, keepSpin) {
    if (!keepSpin) body.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>🧠 ${t('insAnalyzing', 'يجري تحليل مخزنك بعمق…')}</span></div>`;
    let d;
    try {
      const res = await apiFetch.get('/api/ai/insights');
      d = res.data || res;
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`;
      return;
    }

    const k = d.kpis || {};
    const list = d.insights || [];
    const score = Number(d.score) || 0;
    const scoreColor = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
    const circ = 2 * Math.PI * 52;
    const off = circ * (1 - score / 100);

    const nf = (v) => Number(v || 0).toLocaleString(lang === 'ar' ? 'ar-DZ' : (lang === 'fr' ? 'fr-DZ' : 'en-US'));

    // per-insight item table columns
    function itemsTable(id, items) {
      if (!items || !items.length) return '';
      const cfg = {
        restock:   { cols: [t('product'), t('stock'), t('insCover', 'الغطاء (يوم)'), t('aiSuggestedQty', 'الكمية المقترحة'), t('urgency', 'الأولوية')],
                     row: r => [esc(pname(r.name)), String(r.stock ?? '—'), String(r.coverDays ?? '—'), `<strong>${r.suggestedQty ?? '—'}</strong> ${esc(r.unit || '')}`,
                                `<span class="badge badge-${({critical:'danger',high:'warning',medium:'info'})[r.urgency] || 'info'}">${esc(({critical:t('urgencyCritical','حرِج'),high:t('urgencyHigh','مرتفع'),medium:t('urgencyMedium','متوسط')})[r.urgency] || r.urgency || '—')}</span>`] },
        deadStock: { cols: [t('product'), t('stock'), t('insValue', 'القيمة (دج)')],
                     row: r => [esc(pname(r.name)), String(r.stock ?? '—'), nf(r.value)] },
        overstock: { cols: [t('product'), t('stock'), t('insCover', 'الغطاء (يوم)'), t('insValue', 'القيمة (دج)')],
                     row: r => [esc(pname(r.name)), String(r.stock ?? '—'), String(r.coverDays ?? '—'), nf(r.value)] },
        margin:    { cols: [t('product'), t('insRevenue', 'الإيراد (دج)'), t('insCost', 'التكلفة (دج)'), t('insMargin', 'الهامش ٪'), t('qty')],
                     row: r => [esc(pname(r.name)), nf(r.revenue), nf(r.cost), `<strong style="color:${(r.marginPct || 0) < 0 ? '#ef4444' : 'inherit'}">${r.marginPct ?? '—'}%</strong>`, String(r.qty ?? '—')] },
        growing:   { cols: [t('product'), t('insChange', 'التغيّر'), t('qty30', 'الكمية (30 يوم)')],
                     row: r => [esc(pname(r.name)), `<span class="badge badge-success">${esc(r.change || 'new')}</span>`, String(r.qty ?? '—')] },
        declining: { cols: [t('product'), t('insChange', 'التغيّر'), t('qty30', 'الكمية (30 يوم)')],
                     row: r => [esc(pname(r.name)), `<span class="badge badge-danger">${esc(r.change || '')}</span>`, String(r.qty ?? '—')] },
        vip:       { cols: [t('customer'), t('phone'), t('insTotalSpent', 'إجمالي الشراء (دج)'), t('insPoints', 'نقاط الولاء')],
                     row: r => [esc(pname(r.name)), esc(r.phone || '—'), nf(r.totalSpent), String(r.points ?? '—')] },
        churn:     { cols: [t('customer'), t('phone'), t('insTotalSpent', 'إجمالي الشراء (دج)'), t('insDaysSince', 'أيام منذ آخر شراء')],
                     row: r => [esc(pname(r.name)), esc(r.phone || '—'), nf(r.spent), String(r.daysSince ?? '—')] },
        peak:      { cols: [t('insDay', 'اليوم'), t('insRevenue', 'الإيراد (دج)'), t('count', 'العدد')],
                     row: r => [esc(pname(r.day)), nf(r.revenue), String(r.count ?? '—')] },
        hours:     { cols: [t('insHour', 'الساعة'), t('count', 'العدد'), t('insRevenue', 'الإيراد (دج)')],
                     row: r => [esc(r.hour || '—'), String(r.count ?? '—'), nf(r.revenue)] },
        pricing:   { cols: [t('product'), t('insCurrentPrice', 'السعر الحالي'), t('insCost', 'التكلفة'), t('insSuggestedPrice', 'السعر المقترح'), t('qty30', 'الكمية (30 يوم)')],
                     row: r => [esc(pname(r.name)), nf(r.current), nf(r.cost), `<strong>${nf(r.suggested)}</strong>`, String(r.qty30 ?? '—')] },
        payments:  { cols: [t('insMethod', 'الطريقة'), t('insRevenue', 'الإيراد (دج)'), '٪', t('count', 'العدد')],
                     row: r => [esc(pname(r.method)), nf(r.revenue), String(r.pct ?? '—'), String(r.count ?? '—')] }
      };
      const c = cfg[id] || { cols: [t('details')], row: r => [esc(truncate(JSON.stringify(r), 120))] };
      return `<div class="table-wrap"><table class="table ins-items-table">
        <thead><tr>${c.cols.map(x => `<th>${x}</th>`).join('')}</tr></thead>
        <tbody>${items.map(r => `<tr>${c.row(r).map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    }

    body.innerHTML = `
      <div class="insights-wrap">
        <div class="insights-top">
          <div class="card ins-score-card">
            <div class="ins-gauge">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(148,163,184,.25)" stroke-width="12"/>
                <circle cx="60" cy="60" r="52" fill="none" stroke="${scoreColor}" stroke-width="12" stroke-linecap="round"
                        stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>
              </svg>
              <div class="ins-score-num" style="color:${scoreColor}">${score}<span>/100</span></div>
            </div>
            <div class="ins-score-meta">
              <h3>🧠 ${t('insHealthScore', 'صحة المتجر العامة')}</h3>
              <p class="ins-verdict">${esc(d.verdict || '')}</p>
              <div class="ins-meta-row">
                <span class="ai-chip ok">⚡ ${esc(d.engine || 'smart-engine')}</span>
                <button class="btn btn-outline btn-sm" id="insRefresh">🔄 ${t('insRefresh', 'تحليل جديد')}</button>
              </div>
              ${d.note ? `<p class="muted ins-note">${esc(d.note)}</p>` : ''}
            </div>
          </div>
        </div>

        <div class="kpi-grid ins-kpis">
          <div class="card kpi-card"><div class="kpi-label">💰 ${t('insRevenue30', 'إيراد 30 يوم')}</div><div class="kpi-value">${nf(k.revenue30)}</div><div class="kpi-sub">DZD</div></div>
          <div class="card kpi-card"><div class="kpi-label">📈 ${t('insGrossProfit', 'الربح الإجمالي')}</div><div class="kpi-value">${nf(k.grossProfit)}</div><div class="kpi-sub">${t('insMargin', 'الهامش')}: ${k.marginPct ?? 0}%</div></div>
          <div class="card kpi-card"><div class="kpi-label">🧾 ${t('insSalesCount', 'عدد الفواتير (30 يوم)')}</div><div class="kpi-value">${nf(k.salesCount)}</div><div class="kpi-sub">${t('insAvgBasket', 'متوسط السلة')}: ${nf(k.avgBasket)} DZD</div></div>
          <div class="card kpi-card"><div class="kpi-label">📦 ${t('insStockValue', 'قيمة المخزون')}</div><div class="kpi-value">${nf(k.stockValue)}</div><div class="kpi-sub">DZD</div></div>
          <div class="card kpi-card"><div class="kpi-label">🧊 ${t('insDeadStock', 'مخزون راكد')}</div><div class="kpi-value">${nf(k.deadStockValue)}</div><div class="kpi-sub">${k.deadStockCount || 0} ${t('insProducts', 'منتج')}</div></div>
          <div class="card kpi-card"><div class="kpi-label">🚨 ${t('insCriticalRestock', 'إعادة طلب حرِجة')}</div><div class="kpi-value">${k.criticalRestock || 0}</div><div class="kpi-sub">${t('insNegMargin', 'منتجات بهامش سالب')}: ${k.negativeMarginCount || 0}</div></div>
        </div>

        <div class="ins-actions-row">
          <h3>🎯 ${t('insRecommendations', 'التوصيات مرتبة حسب الأولوية')} (${list.length})</h3>
          <div class="export-btns">
            <button class="btn btn-secondary btn-sm" id="insXlsx">📊 Excel</button>
            <button class="btn btn-secondary btn-sm" id="insPdf">📄 PDF</button>
          </div>
        </div>

        <div class="insights-list">
          ${list.length ? list.map((ins, idx) => {
            const sev = INS_SEV[ins.severity] || INS_SEV.info;
            return `
            <div class="card ins-card ${sev.cls}" data-ins-idx="${idx}">
              <div class="ins-card-head" role="button" tabindex="0" aria-expanded="false">
                <div class="ins-card-title">
                  <span class="badge badge-${sev.badge}">${sev.label}</span>
                  <strong>${esc(ins.title || '')}</strong>
                </div>
                <svg class="ins-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div class="ins-card-body" hidden>
                <p class="ins-detail">${fmt(ins.detail || '')}</p>
                ${ins.impact ? `<div class="ins-impact">📊 ${t('insImpact', 'الأثر المتوقع')}: ${fmt(ins.impact)}</div>` : ''}
                ${itemsTable(ins.id, ins.items)}
                ${ins.action ? `<div class="ins-action">💡 <strong>${t('insAction', 'الإجراء المقترح')}:</strong> ${fmt(ins.action)}</div>` : ''}
              </div>
            </div>`;
          }).join('') : `<div class="card"><div class="empty-state"><div class="empty-title">✅ ${t('insAllGood', 'لا توصيات حالياً — بياناتك سليمة')}</div></div></div>`}
        </div>
      </div>`;

    // expand/collapse
    body.querySelectorAll('.ins-card-head').forEach(h => {
      const open = () => {
        const card = h.closest('.ins-card');
        const bd = card.querySelector('.ins-card-body');
        bd.hidden = !bd.hidden;
        h.setAttribute('aria-expanded', bd.hidden ? 'false' : 'true');
        card.classList.toggle('open', !bd.hidden);
      };
      h.addEventListener('click', open);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    // open the first (top priority) card by default
    const first = body.querySelector('.ins-card .ins-card-body');
    if (first) { first.hidden = false; first.closest('.ins-card').classList.add('open'); }

    body.querySelector('#insRefresh').addEventListener('click', () => renderInsights(body));

    // export all recommendations flattened
    const flat = [];
    (d.insights || []).forEach(ins => (ins.items || []).forEach(it => {
      flat.push(Object.assign({ category: ins.title || ins.id, severity: ins.severity, action: ins.action || '' }, it));
    }));
    const cols = [
      { label: t('insCategory', 'التصنيف'), key: 'category' },
      { label: t('insSeverity', 'الأولوية'), key: 'severity' },
      { label: t('itemNameRequired', 'الصنف'), value: r => pname(r.name || r.day || r.hour || r.method || '') },
      { label: t('details'), value: r => truncate(Object.keys(r).filter(x => !['category','severity','action'].includes(x)).map(x => `${x}: ${typeof r[x] === 'object' ? '' : r[x]}`).join(' | '), 160) },
      { label: t('insAction', 'الإجراء'), value: r => truncate(r.action, 120) }
    ];
    const xlsxBtn = body.querySelector('#insXlsx');
    const pdfBtn = body.querySelector('#insPdf');
    if (xlsxBtn) xlsxBtn.addEventListener('click', () =>
      window.DZExport.exportToExcel({ columns: cols, rows: flat, filename: 'dzpospro-smart-insights', title: t('aiInsights', 'التحليل الذكي العميق') }));
    if (pdfBtn) pdfBtn.addEventListener('click', () =>
      window.DZExport.exportToPDF({ columns: cols, rows: flat, filename: 'dzpospro-smart-insights', title: t('aiInsights', 'التحليل الذكي العميق'), landscape: true }));
  }

  /* ============================================================
   * 1) ASSISTANT
   * ============================================================ */
  function renderAssistant(body) {
    const quick = lang === 'ar'
      ? ['كم مبيعات هذا الشهر؟', 'أي المنتجات الأكثر مبيعاً؟', 'ما المنتجات قريبة النفاد؟', 'قارن هذا الأسبوع بالماضي']
      : lang === 'fr'
        ? ['Quelles sont les ventes de ce mois ?', 'Quels sont les produits les plus vendus ?', 'Quels produits sont presque épuisés ?', 'Compare cette semaine à la précédente']
        : ['How are this month\'s sales?', 'Which products sell most?', 'Which products are running low?', 'Compare this week with last week'];

    body.innerHTML = `
      <div class="chat-wrap card">
        <div class="chat-messages" id="chatMessages">
          <div class="chat-msg bot"><div class="bubble">${t('aiWelcome', 'مرحباً! اسألني أي شيء عن متجرك: المبيعات، المخزون، العملاء…')} 🤖</div></div>
        </div>
        <div class="chat-quick" id="chatQuick"></div>
        <div class="chat-input-row">
          <input type="text" id="chatInput" class="chat-input" placeholder="${t('aiAskPlaceholder', 'اكتب سؤالك هنا…')}" />
          <button class="btn btn-primary" id="chatSend">${t('send', 'إرسال')}</button>
        </div>
      </div>`;

    const quickEl = body.querySelector('#chatQuick');
    quick.forEach(q => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = q;
      b.addEventListener('click', () => sendQuestion(q));
      quickEl.appendChild(b);
    });

    const input = body.querySelector('#chatInput');
    const sendBtn = body.querySelector('#chatSend');
    sendBtn.addEventListener('click', () => sendQuestion(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') sendQuestion(input.value); });

    async function sendQuestion(q) {
      const question = (q || input.value || '').trim();
      if (!question) return;
      input.value = '';
      const msgs = body.querySelector('#chatMessages');
      msgs.insertAdjacentHTML('beforeend', `<div class="chat-msg me"><div class="bubble">${esc(question)}</div></div>`);
      msgs.insertAdjacentHTML('beforeend', `<div class="chat-msg bot"><div class="bubble typing"><span></span><span></span><span></span></div></div>`);
      msgs.scrollTop = msgs.scrollHeight;
      try {
        const res = await apiFetch.post('/api/ai/ask', { question, lang });
        const answer = (res.data && res.data.answer) || res.answer || '…';
        msgs.querySelector('.typing').parentElement.remove();
        msgs.insertAdjacentHTML('beforeend', `<div class="chat-msg bot"><div class="bubble">${fmt(answer)}</div></div>`);
      } catch (err) {
        msgs.querySelector('.typing')?.parentElement.remove();
        msgs.insertAdjacentHTML('beforeend', `<div class="chat-msg bot"><div class="bubble error">⛔ ${esc(err.message)}</div></div>`);
      }
      msgs.scrollTop = msgs.scrollHeight;
      loadStatusBar();
    }
  }

  /* ============================================================
   * 2) FORECAST
   * ============================================================ */
  async function renderForecast(body) {
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>${t('loading')}</span></div>`;
    let data = null;
    try {
      const res = await apiFetch.get('/api/ai/forecast?coverageDays=30&summary=1');
      data = res.data || res;
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`;
      return;
    }
    const rows = data.rows || [];
    const URGENCY = {
      critical: { cls: 'danger', label: t('urgencyCritical', 'حرِج') },
      high: { cls: 'warning', label: t('urgencyHigh', 'مرتفع') },
      medium: { cls: 'info', label: t('urgencyMedium', 'متوسط') },
      low: { cls: 'success', label: t('urgencyLow', 'منخفض') }
    };

    body.innerHTML = `
      ${data.narrative ? `<div class="card ai-narrative"><strong>🤖</strong><div>${fmt(data.narrative)}</div></div>` : ''}
      <div class="card">
        <div class="card-head-row">
          <h3>📈 ${t('aiForecastTitle', 'توقعات 30 يوماً القادمة')} (${rows.length})</h3>
          <div class="export-btns">
            <button class="btn btn-secondary btn-sm" id="fcXlsx">📊 Excel</button>
            <button class="btn btn-secondary btn-sm" id="fcPdf">📄 PDF</button>
          </div>
        </div>
        <div class="table-wrap"><table class="table" id="fcTable">
          <thead><tr>
            <th>${t('product')}</th><th>${t('stock')}</th><th>${t('aiAvgDaily', 'متوسط يومي')}</th>
            <th>${t('aiCoverDays', 'الغطاء (أيام)')}</th><th>${t('aiRunout', 'النفاد المتوقع')}</th>
            <th>${t('aiSuggestedQty', 'الكمية المقترحة')}</th><th>${t('urgency', 'الأولوية')}</th>
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td>${esc(pname(r.name))}</td>
                <td>${r.stock}</td>
                <td>${r.avgDaily}</td>
                <td>${r.coverDays}</td>
                <td>${r.runoutDate || '—'}</td>
                <td><strong>${r.suggestedQty > 0 ? r.suggestedQty : '—'}</strong> ${r.unit || ''}</td>
                <td><span class="badge badge-${URGENCY[r.urgency].cls}">${URGENCY[r.urgency].label}</span></td>
              </tr>`).join('') : `<tr><td colspan="7" class="empty-state">${t('noData')}</td></tr>`}
          </tbody>
        </table></div>
      </div>`;

    const cols = [
      { label: t('product'), value: r => pname(r.name) },
      { label: t('stock'), key: 'stock' },
      { label: t('aiAvgDaily', 'متوسط يومي'), key: 'avgDaily' },
      { label: t('aiCoverDays', 'الغطاء'), key: 'coverDays' },
      { label: t('aiRunout', 'النفاد المتوقع'), key: 'runoutDate' },
      { label: t('aiSuggestedQty', 'مقترح'), key: 'suggestedQty' },
      { label: t('urgency', 'الأولوية'), key: 'urgency' }
    ];
    body.querySelector('#fcXlsx').addEventListener('click', () =>
      window.DZExport.exportToExcel({ columns: cols, rows, filename: 'dzpospro-forecast', title: t('aiForecast', 'التنبؤ') }));
    body.querySelector('#fcPdf').addEventListener('click', () =>
      window.DZExport.exportToPDF({ columns: cols, rows, filename: 'dzpospro-forecast', title: t('aiForecast', 'التنبؤ'), landscape: true }));
  }

  /* ============================================================
   * 3) ANOMALIES
   * ============================================================ */
  async function renderAnomalies(body) {
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>${t('loading')}</span></div>`;
    let data = null;
    try {
      const res = await apiFetch.get('/api/ai/anomalies?interpret=1');
      data = res.data || res;
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`;
      return;
    }
    const findings = data.findings || [];
    const CODE_LABEL = {
      HEAVY_DISCOUNTS: t('anHeavyDiscounts', 'خصومات كبيرة غير معتادة'),
      RETURN_SPIKE: t('anReturnSpike', 'ارتفاع المرتجعات'),
      ADJUSTMENT_SPIKE: t('anAdjustSpike', 'تعديلات مخزون متكررة'),
      NEGATIVE_MARGIN: t('anNegMargin', 'بيع بخسارة (سعر أقل من التكلفة)'),
      ZERO_SALES_DAY: t('anZeroDay', 'أيام بلا مبيعات')
    };
    const SEV = { high: 'danger', medium: 'warning', low: 'info' };

    body.innerHTML = `
      <div class="ai-scan-row"><button class="btn btn-primary" id="anRescan">🔄 ${t('anRescan', 'إعادة الفحص مع تحليل ذكي')}</button></div>
      ${data.interpretation ? `<div class="card ai-narrative"><strong>🤖</strong><div>${fmt(data.interpretation)}</div></div>` : ''}
      <div class="kpi-grid" id="anCards">
        ${findings.length ? findings.map(f => `
          <div class="card kpi-card">
            <div class="kpi-head"><span class="badge badge-${SEV[f.severity] || 'info'}">${esc(CODE_LABEL[f.code] || f.code)}</span></div>
            <div class="kpi-value">${f.count}</div>
            <div class="kpi-sub">${t('anFindings', 'ملاحظات تحتاج مراجعة')}</div>
          </div>`).join('') : `<div class="card" style="grid-column:1/-1"><div class="empty-state"><div class="empty-title">✅ ${t('anClean', 'لا شواذ مكتشفة — كل شيء طبيعي')}</div></div></div>`}
      </div>
      ${findings.length ? `<div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>${t('aiFinding', 'الملاحظة')}</th><th>${t('count', 'العدد')}</th><th>${t('details', 'التفاصيل')}</th></tr></thead>
        <tbody>${findings.map(f => `
          <tr><td>${esc(CODE_LABEL[f.code] || f.code)}</td><td>${f.count}</td>
          <td><code style="font-size:11px">${esc(truncate(JSON.stringify(f.items || []), 220))}</code></td></tr>`).join('')}</tbody>
      </table></div></div>` : ''}`;

    body.querySelector('#anRescan').addEventListener('click', () => renderAnomalies(body));
  }

  /* ============================================================
   * 4) OCR — supplier invoice photo
   * ============================================================ */
  function renderOcr(body) {
    body.innerHTML = `
      <div class="card">
        <h3>📸 ${t('ocrTitle', 'قراءة فاتورة مورد بالصورة')}</h3>
        <p class="muted">${t('ocrHint', 'صوّر فاتورة المورد (أو حمّل صورتها) وسيتعرف النظام على المنتجات والكميات والأسعار تلقائياً.')}</p>
        <div class="ocr-upload-row">
          <input type="file" id="ocrFile" accept="image/*" capture="environment" hidden />
          <button class="btn btn-primary" id="ocrPick">📷 ${t('ocrPickImage', 'اختيار / تصوير الفاتورة')}</button>
          <img id="ocrPreview" class="ocr-preview" style="display:none" />
        </div>
        <div id="ocrResult"></div>
      </div>`;

    const fileInput = body.querySelector('#ocrFile');
    const pickBtn = body.querySelector('#ocrPick');
    const preview = body.querySelector('#ocrPreview');
    const resultEl = body.querySelector('#ocrResult');
    let currentData = null;

    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      preview.src = URL.createObjectURL(f);
      preview.style.display = 'block';
      runOcr(f);
    });

    async function runOcr(file) {
      resultEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>🤖 ${t('ocrRunning', 'جاري تحليل الفاتورة…')}</span></div>`;
      try {
        const fd = new FormData();
        fd.append('image', file);
        fd.append('lang', lang);
        const res = await apiFetch.post('/api/ai/ocr-invoice', fd);
        currentData = (res.data && res.data.invoice) || res.invoice;
        renderResult(currentData);
        loadStatusBar();
      } catch (err) {
        resultEl.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`;
      }
    }

    function renderResult(inv) {
      const items = (inv && inv.items) || [];
      resultEl.innerHTML = `
        <div class="ocr-meta">
          <div><strong>${t('ocrSupplier', 'المورد')}:</strong> ${esc(inv.supplierName || '—')}</div>
          <div><strong>${t('date')}:</strong> ${esc(inv.date || '—')}</div>
          <div><strong>TTC:</strong> ${inv.totals && inv.totals.ttc ? inv.totals.ttc.toLocaleString() + ' DZD' : '—'}</div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>${t('itemNameRequired', 'الصنف')}</th><th>${t('qty')}</th><th>${t('unitPrice')}</th></tr></thead>
          <tbody>${items.length ? items.map((it, i) => `
            <tr>
              <td><input class="input ocr-edit" data-i="${i}" data-f="designation" value="${esc(it.designation || '')}" /></td>
              <td><input class="input ocr-edit" data-i="${i}" data-f="qty" value="${it.qty ?? ''}" style="width:80px" /></td>
              <td><input class="input ocr-edit" data-i="${i}" data-f="unitPriceHT" value="${it.unitPriceHT ?? ''}" style="width:120px" /></td>
            </tr>`).join('') : `<tr><td colspan="3" class="empty-state">${t('noData')}</td></tr>`}
          </tbody>
        </table></div>
        ${items.length ? `<div class="ocr-actions">
          <button class="btn btn-primary" id="ocrCreatePo">📦 ${t('ocrCreatePO', 'إنشاء أمر شراء من هذه الفاتورة')}</button>
        </div>` : ''}`;

      resultEl.querySelectorAll('.ocr-edit').forEach(inp => {
        inp.addEventListener('change', () => {
          const i = parseInt(inp.dataset.i, 10);
          const f = inp.dataset.f;
          if (currentData.items[i]) {
            currentData.items[i][f] = f === 'designation' ? inp.value : Number(inp.value) || 0;
          }
        });
      });

      const createBtn = resultEl.querySelector('#ocrCreatePo');
      if (createBtn) createBtn.addEventListener('click', () => createDraftPO(currentData));
    }

    async function createDraftPO(inv) {
      try {
        const items = (inv.items || []).filter(i => i.designation && i.qty > 0);
        if (!items.length) return;
        // ensure products exist (auto-create missing ones)
        const productsRes = await apiFetch.get('/api/products?limit=1000');
        const products = (productsRes.data || productsRes) || [];
        const pList = Array.isArray(products) ? products : (products.data || []);
        const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const lineItems = [];
        for (const it of items) {
          let p = pList.find(x => norm(x.name && (x.name.ar || x.name.fr || x.name.en)) === norm(it.designation));
          if (!p) {
            const created = await apiFetch.post('/api/products', {
              name: { ar: it.designation, fr: it.designation, en: it.designation },
              price: Number(it.unitPriceHT) * 1.19 || 0, // rough default price (HT→TTC estimate)
              costPrice: Number(it.unitPriceHT) || 0,
              stock: 0, minStock: 5, unit: 'pcs', status: 'active'
            });
            p = (created.data || created);
          }
          lineItems.push({
            product: p._id || p.id,
            productName: it.designation,
            quantity: Number(it.qty) || 1,
            unitPrice: Number(it.unitPriceHT) || 0
          });
        }
        const orderNumber = 'PO-' + Date.now().toString().slice(-8);
        await apiFetch.post('/api/purchase-orders', {
          orderNumber,
          supplier: null, supplierName: inv.supplierName || '',
          items: lineItems,
          status: 'draft',
          notes: lang === 'ar' ? 'أُنشئ تلقائياً من صورة فاتورة (AI OCR)' : lang === 'fr' ? 'Créé automatiquement depuis une photo (AI OCR)' : 'Auto-created from invoice photo (AI OCR)'
        });
        window.Toast && Toast.success(t('ocrPoCreated', 'تم إنشاء أمر الشراء ✓ راجعه في صفحة أوامر الشراء'));
        if (window.loadPage) window.loadPage('purchaseOrders');
      } catch (err) {
        window.Toast && Toast.error((err && err.message) || 'Error');
      }
    }
  }

  /* ============================================================
   * 5) DAILY SUMMARY
   * ============================================================ */
  async function renderSummary(body) {
    body.innerHTML = `
      <div class="card">
        <div class="card-head-row">
          <h3>🌙 ${t('aiSummaryTitle', 'الملخص اليومي الذكي')}</h3>
          <button class="btn btn-primary btn-sm" id="sumGen">${t('aiGenerateNow', 'توليد الآن')}</button>
        </div>
        <p class="muted">${t('aiSummaryHint', 'يُولَّد تلقائياً كل يوم في الساعة المحددة في إعدادات التنبيهات، ويُرسل إشعاراً للهاتف. يمكنك توليده الآن لأي غرفة.')}</p>
        <div id="sumResult"><div class="empty-state"><div class="empty-title">${t('aiPressGenerate', 'اضغط "توليد الآن" لعرض الملخص')}</div></div></div>
      </div>`;

    body.querySelector('#sumGen').addEventListener('click', async () => {
      const out = body.querySelector('#sumResult');
      out.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>🤖 ${t('loading')}</span></div>`;
      try {
        const res = await apiFetch.post('/api/ai/daily-summary', { lang });
        const data = res.data || res;
        out.innerHTML = `<div class="ai-summary-text">${fmt(data.text || '')}</div>`;
        loadStatusBar();
      } catch (err) {
        out.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${esc(err.message)}</div></div>`;
      }
    });
  }

  /* ---------- helpers ---------- */
  function pname(n) {
    if (n && typeof n === 'object') return n[lang] || n.ar || n.fr || n.en || '';
    return n || '';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function fmt(s) {
    return esc(s).replace(/\n/g, '<br/>').replace(/•/g, '<span style="color:#10b981">•</span>');
  }

  // initial render — after every renderer + constant is defined
  loadStatusBar();
  renderTab('insights');
}
