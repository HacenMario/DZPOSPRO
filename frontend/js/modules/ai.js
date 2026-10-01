/* ============================================================
 * js/modules/ai.js — AI Center (v3)
 * ------------------------------------------------------------
 * Tabs:
 *   1. assistant  — "اسأل مخزنك" chat (Gemini, store data grounded)
 *   2. forecast   — sales forecast + restock suggestions table
 *   3. anomalies  — security findings + AI interpretation
 *   4. ocr        — supplier invoice photo → products + draft PO
 *   5. summary    — smart daily summary (manual trigger)
 * Roles: admin + manager (route-enforced server side too).
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
        <button class="tab-btn active" data-tab="assistant">💬 ${t('aiAssistant', 'المساعد الذكي')}</button>
        <button class="tab-btn" data-tab="forecast">📈 ${t('aiForecast', 'التنبؤ وإعادة التخزين')}</button>
        <button class="tab-btn" data-tab="anomalies">🛡️ ${t('aiAnomalies', 'كشف الشواذ')}</button>
        <button class="tab-btn" data-tab="ocr">📸 ${t('aiOcr', 'قراءة فاتورة مورد')}</button>
        <button class="tab-btn" data-tab="summary">🌙 ${t('aiSummary', 'الملخص اليومي')}</button>
      </div>
      <div class="tab-body" id="aiTabBody"></div>
    </div>`;

  // status bar
  loadStatusBar();

  // tabs wiring
  content.querySelectorAll('#aiTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('#aiTabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTab(btn.dataset.tab);
    });
  });

  renderTab('assistant');

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
    if (name === 'assistant') renderAssistant(body);
    else if (name === 'forecast') renderForecast(body);
    else if (name === 'anomalies') renderAnomalies(body);
    else if (name === 'ocr') renderOcr(body);
    else if (name === 'summary') renderSummary(body);
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
}
