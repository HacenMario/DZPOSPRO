/* ============================================================
 * js/modules/dashboard.js
 * ------------------------------------------------------------
 * Renders the dashboard page into #pageContent.
 *   • 4 stat cards (Total Products, Customers, Sales Today,
 *     Revenue Today)
 *   • Sales trend line chart (last 7 days) — Chart.js
 *   • Top 5 products bar chart
 *   • Sales by category doughnut chart
 *   • Low stock alert list
 *   • Recent sales (last 5)
 *
 * Exposes:
 *   export async function renderDashboardPage()
 *   export async function fetchDashboardStats()  // back-compat
 * ============================================================ */

/* apiFetch is exposed globally by js/api.js as window.apiFetch (with .get/.post/.put/.delete helpers) */
const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let chartInstances = [];

function destroyCharts() {
  chartInstances.forEach(c => { try { c.destroy(); } catch (_) {} });
  chartInstances = [];
}

function fmtCurrency(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + t('currency', 'دج');
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}
function fmtDateShort(d) {
  try { const dt = new Date(d); if (isNaN(dt.getTime())) return ''; const loc = (typeof window !== 'undefined' && typeof window.dzposLocale === 'function') ? window.dzposLocale() : undefined; return dt.toLocaleDateString(loc, { year:'numeric', month:'2-digit', day:'2-digit' }); } catch { return ''; }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- v4.1 — local timezone helpers ----------
 * The old code sent toISOString() (UTC) date strings, so "today" started
 * at 01:00 local time in Algeria and the last hour of each day leaked into
 * the next one server-side → charts/statistics never matched reality.
 * We now send full ISO timestamps with the device UTC offset AND a `tz`
 * parameter so the backend groups days/hours exactly like the user sees.
 */
function tzString() {
  const off = -new Date().getTimezoneOffset();
  const p = n => String(n).padStart(2, '0');
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return sign + p(Math.floor(abs / 60)) + ':' + p(abs % 60);
}
function isoDay(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function isoWithOffset(d, endOfDay) {
  return isoDay(d) + 'T' + (endOfDay ? '23:59:59.999' : '00:00:00.000') + tzString();
}

/* ---------- v4.1 — animated counters ---------- */
function animateValue(el, target, fmt) {
  if (!el) return;
  const num = Number(target) || 0;
  if (!window.requestAnimationFrame || num === 0) { el.textContent = fmt(num); return; }
  const dur = 850;
  const start = performance.now();
  function step(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(num * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = fmt(num);
  }
  requestAnimationFrame(step);
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = `
    <div class="stats-grid">
      ${[1,2,3,4].map(() => `
        <div class="stat-card">
          <div class="skeleton" style="width:52px;height:52px;border-radius:12px;"></div>
          <div style="flex:1;">
            <div class="skeleton skeleton-line" style="height:20px;width:60%;"></div>
            <div class="skeleton skeleton-line" style="height:12px;width:80%;"></div>
          </div>
        </div>`).join('')}
    </div>
    <div class="chart-grid">
      <div class="card">
        <div class="card-header"><div class="skeleton skeleton-line" style="height:16px;width:30%;"></div></div>
        <div class="card-body"><div class="skeleton" style="height:280px;width:100%;"></div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="skeleton skeleton-line" style="height:16px;width:30%;"></div></div>
        <div class="card-body"><div class="skeleton" style="height:280px;width:100%;"></div></div>
      </div>
    </div>
    <div class="dashboard-grid">
      <div class="card">
        <div class="card-header"><div class="skeleton skeleton-line" style="height:16px;width:30%;"></div></div>
        <div class="card-body">
          ${[1,2,3,4].map(() => `<div class="skeleton skeleton-line" style="height:48px;margin-bottom:8px;"></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="skeleton skeleton-line" style="height:16px;width:30%;"></div></div>
        <div class="card-body">
          ${[1,2,3,4,5].map(() => `<div class="skeleton skeleton-line" style="height:36px;margin-bottom:8px;"></div>`).join('')}
        </div>
      </div>
    </div>
  `;
}

/* ---------- Empty state ---------- */
function emptyState(title, sub) {
  return `
    <div class="empty-state">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
      </div>
      <div class="empty-title">${title}</div>
      <div class="empty-subtitle">${sub}</div>
    </div>`;
}

/* ---------- Render stat cards (v4.1: raw values ride along for animation) ---------- */
function renderStatCards(stats) {
  const cards = [
    { icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
      color: 'green', value: fmtNum(stats.totalProducts), raw: stats.totalProducts, fmt: fmtNum, label: t('totalProducts', 'Total products') },
    { icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      color: 'cyan', value: fmtNum(stats.totalCustomers), raw: stats.totalCustomers, fmt: fmtNum, label: t('totalCustomers', 'Total customers') },
    { icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
      color: 'amber', value: fmtNum(stats.totalSalesToday), raw: stats.totalSalesToday, fmt: fmtNum, label: t('salesToday', 'Sales today') },
    { icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
      color: 'green', value: fmtCurrency(stats.totalRevenueToday), raw: stats.totalRevenueToday, fmt: fmtCurrency, label: t('revenueToday', 'Revenue today') }
  ];
  return `
    <div class="stats-grid">
      ${cards.map(c => `
        <div class="stat-card">
          <div class="stat-icon ${c.color}" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>
          </div>
          <div class="stat-info">
            <div class="stat-value" data-raw="${Number(c.raw) || 0}" data-fmt="count">${c.value}</div>
            <div class="stat-label">${c.label}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ---------- Charts ---------- */
function getChartColors() {
  const css = getComputedStyle(document.documentElement);
  return {
    primary: css.getPropertyValue('--primary').trim() || '#10b981',
    primaryRgb: css.getPropertyValue('--primary-rgb').trim() || '16,185,129',
    accent: css.getPropertyValue('--accent').trim() || '#f59e0b',
    accentRgb: css.getPropertyValue('--accent-rgb').trim() || '245,158,11',
    info: css.getPropertyValue('--info').trim() || '#06b6d4',
    infoRgb: css.getPropertyValue('--info-rgb').trim() || '6,182,212',
    danger: css.getPropertyValue('--danger').trim() || '#ef4444',
    dangerRgb: css.getPropertyValue('--danger-rgb').trim() || '239,68,68',
    text: css.getPropertyValue('--text-secondary').trim() || '#475569',
    grid: css.getPropertyValue('--border-color').trim() || '#e2e8f0'
  };
}

/* v4.1 — vertical gradient fill for area/line charts */
function areaGradient(context, rgb, topA, bottomA) {
  const area = context.chart && context.chart.chartArea;
  if (!area) return 'rgba(' + rgb + ',' + (topA || 0.22) + ')';
  const g = context.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, 'rgba(' + rgb + ',' + (topA || 0.22) + ')');
  g.addColorStop(1, 'rgba(' + rgb + ',' + (bottomA == null ? 0.02 : bottomA) + ')');
  return g;
}

function renderSalesTrendChart(labels, counts, revenues) {
  const ctx = document.getElementById('salesTrendChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const c = getChartColors();
  chartInstances.push(new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: t('sales', 'Sales'), data: counts, borderColor: c.primary,
          backgroundColor: (context) => areaGradient(context, c.primaryRgb), fill: true, tension: 0.4, borderWidth: 2.5,
          pointBackgroundColor: c.primary, pointRadius: 3, pointHoverRadius: 6 },
        { label: t('revenueToday', 'Revenue'), data: revenues, borderColor: c.accent,
          backgroundColor: (context) => areaGradient(context, c.accentRgb), fill: true, tension: 0.4, borderWidth: 2.5,
          pointBackgroundColor: c.accent, pointRadius: 3, pointHoverRadius: 6,
          yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, labels: { color: c.text, font: { family: 'Tajawal, sans-serif' }, usePointStyle: true, boxWidth: 8 } } },
      scales: {
        x: { ticks: { color: c.text, font: { family: 'Tajawal, sans-serif' } }, grid: { color: c.grid, drawBorder: false } },
        y: { position: 'start', ticks: { color: c.text, font: { family: 'Tajawal, sans-serif' } }, grid: { color: c.grid, drawBorder: false } },
        y1: { position: 'end', ticks: { color: c.text, font: { family: 'Tajawal, sans-serif' } }, grid: { drawOnChartArea: false } }
      }
    }
  }));
}

function renderTopProductsChart(labels, data) {
  const ctx = document.getElementById('topProductsChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const c = getChartColors();
  chartInstances.push(new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: t('quantity', 'Quantity'),
        data,
        backgroundColor: 'rgba(' + c.primaryRgb + ',0.7)',
        borderColor: c.primary, borderWidth: 1, borderRadius: 6, maxBarThickness: 36
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: c.text, font: { family: 'Tajawal, sans-serif' } }, grid: { color: c.grid, drawBorder: false } },
        y: { ticks: { color: c.text, font: { family: 'Tajawal, sans-serif' } }, grid: { display: false } }
      }
    }
  }));
}

function renderCategoryDoughnut(labels, data) {
  const ctx = document.getElementById('categoryChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const palette = ['#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#22c55e', '#ec4899', '#3b82f6'];
  chartInstances.push(new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: palette, borderColor: 'transparent', borderWidth: 2, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { position: 'bottom', labels: { color: getChartColors().text, font: { family: 'Tajawal, sans-serif' }, padding: 12, usePointStyle: true } } }
    }
  }));
}

/* ---------- Lists ---------- */
function productName(p) {
  if (!p) return '—';
  if (typeof p.name === 'string') return p.name;
  if (p.name && typeof p.name === 'object') return p.name.ar || p.name.en || p.name.fr || '—';
  if (p.displayName) return p.displayName;
  return '—';
}

function customerName(c) {
  if (!c) return t('noCustomer', 'Walk-in');
  if (typeof c.name === 'string') return c.name;
  if (c.name && typeof c.name === 'object') return c.name.ar || c.name.en || c.name.fr || t('noCustomer', 'Walk-in');
  if (c.displayName) return c.displayName;
  return t('noCustomer', 'Walk-in');
}

function renderLowStockList(products) {
  if (!products || !products.length) {
    return emptyState(t('allStockOk', 'All products are in stock'), '');
  }
  return `
    <div class="low-stock-list">
      ${products.map(p => {
        const name = productName(p);
        const stock = p.stock != null ? p.stock : (p.quantity != null ? p.quantity : 0);
        const min = p.minStock != null ? p.minStock : (p.minStockThreshold || 5);
        const pct = min > 0 ? Math.max(5, Math.min(100, (stock / min) * 100)) : 100;
        return `
          <div class="low-stock-item">
            <span class="badge badge-danger">${t('lowStockBadge', 'Low stock')}</span>
            <span class="low-stock-name">${escapeHtml(name)}</span>
            <div class="low-stock-bar" title="${stock} / ${min}"><span style="width:${pct}%;"></span></div>
            <span class="badge badge-muted">${stock} / ${min}</span>
          </div>`;
      }).join('')}
    </div>`;
}

function renderRecentSales(sales) {
  if (!sales || !sales.length) {
    return emptyState(t('noRecentSales', 'No recent sales'), '');
  }
  const visible = sales.slice(0, 5);
  const html = `
    <div class="recent-sales-list">
      ${visible.map(s => {
        const invoiceNo = s.saleNumber || (s._id ? String(s._id).slice(-6).toUpperCase() : '—');
        const cust = customerName(s.customer);
        const amt = fmtCurrency(s.total || s.grandTotal || 0);
        return `
          <div class="recent-sale-item">
            <span class="recent-sale-id">${escapeHtml(invoiceNo)}</span>
            <span class="recent-sale-customer">${escapeHtml(cust)}</span>
            <span class="recent-sale-amount">${amt}</span>
          </div>`;
      }).join('')}
    </div>`;
  if (sales.length > 5) {
    return html + `
      <div style="text-align:center; margin-top:0.75rem;">
        <button class="btn btn-outline btn-sm" id="dashShowAllRecent" type="button">${t('viewAll', 'View all')} (${sales.length})</button>
      </div>`;
  }
  return html;
}

function openAllRecentSalesModal(sales) {
  if (typeof Swal === 'undefined') {
    alert('SweetAlert2 not loaded');
    return;
  }
  const rowsHtml = sales.map((s, i) => {
    const invoiceNo = s.saleNumber || (s._id ? String(s._id).slice(-6).toUpperCase() : '—');
    const cust = customerName(s.customer);
    const amt = fmtCurrency(s.total || s.grandTotal || 0);
    const dt = fmtDateShort(s.saleDate || s.createdAt);
    return `<tr>
      <td style="padding:6px 10px; border-bottom:1px solid #eee;">${i+1}</td>
      <td style="padding:6px 10px; border-bottom:1px solid #eee;">${escapeHtml(invoiceNo)}</td>
      <td style="padding:6px 10px; border-bottom:1px solid #eee;">${escapeHtml(dt)}</td>
      <td style="padding:6px 10px; border-bottom:1px solid #eee;">${escapeHtml(cust)}</td>
      <td style="padding:6px 10px; border-bottom:1px solid #eee; text-align:right;">${amt}</td>
    </tr>`;
  }).join('');
  Swal.fire({
    title: t('recentSales', 'Recent sales'),
    html: `<div style="max-height:70vh; overflow:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
      <thead><tr>
        <th style="padding:6px 10px; text-align:start; border-bottom:2px solid #ddd;">#</th>
        <th style="padding:6px 10px; text-align:start; border-bottom:2px solid #ddd;">${t('invoiceNumber','Invoice #')}</th>
        <th style="padding:6px 10px; text-align:start; border-bottom:2px solid #ddd;">${t('date','Date')}</th>
        <th style="padding:6px 10px; text-align:start; border-bottom:2px solid #ddd;">${t('customer','Customer')}</th>
        <th style="padding:6px 10px; text-align:end; border-bottom:2px solid #ddd;">${t('total','Total')}</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`,
    width: '800px',
    confirmButtonText: t('close', 'Close'),
    confirmButtonColor: '#10b981'
  });
}

/* ---------- v4.1 — dashboard toolbar (refresh + last update + auto) ---------- */
function renderDashToolbar() {
  const auto = (() => { try { return localStorage.getItem('dzpos_dash_auto') === '1'; } catch (_) { return false; } })();
  return `
    <div class="dash-toolbar no-print">
      <div class="dash-updated" id="dashUpdatedWrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>${t('dashLastUpdate', 'آخر تحديث')}: <strong id="dashUpdatedAt">—</strong></span>
      </div>
      <div class="dash-toolbar-actions">
        <label class="dash-auto-toggle" for="dashAutoRefresh" title="${t('dashAutoRefreshTitle', 'تحديث تلقائي كل دقيقة')}">
          <input type="checkbox" id="dashAutoRefresh" ${auto ? 'checked' : ''} />
          <span>${t('dashAutoRefresh', 'تحديث تلقائي')}</span>
        </label>
        <button class="btn btn-secondary btn-sm" id="dashRefreshBtn" type="button" title="${t('dashRefresh', 'تحديث الآن')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>${t('dashRefresh', 'تحديث الآن')}</span>
        </button>
      </div>
    </div>`;
}

let _dashAutoTimer = null;
function manageAutoRefresh() {
  if (_dashAutoTimer) { clearInterval(_dashAutoTimer); _dashAutoTimer = null; }
  let auto = false;
  try { auto = localStorage.getItem('dzpos_dash_auto') === '1'; } catch (_) {}
  if (auto) {
    _dashAutoTimer = setInterval(() => {
      if (window.currentPage === 'dashboard' && !document.hidden) {
        renderDashboardPage().catch(() => {});
      }
    }, 60000);
  }
}

function stampUpdatedAt() {
  const el = document.getElementById('dashUpdatedAt');
  if (!el) return;
  try { el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { el.textContent = ''; }
}

function wireDashToolbar() {
  const btn = document.getElementById('dashRefreshBtn');
  if (btn) btn.addEventListener('click', () => renderDashboardPage().catch(() => {}));
  const cb = document.getElementById('dashAutoRefresh');
  if (cb) cb.addEventListener('change', () => {
    try { localStorage.setItem('dzpos_dash_auto', cb.checked ? '1' : '0'); } catch (_) {}
    manageAutoRefresh();
    if (window.Toast && window.Toast.info) {
      window.Toast.info(cb.checked
        ? t('dashAutoOn', 'تم تفعيل التحديث التلقائي كل دقيقة')
        : t('dashAutoOff', 'تم إيقاف التحديث التلقائي'));
    }
  });
}

/* ---------- v4.2 — What's new (first visit of this version) ---------- */
function maybeShowWhatsNew() {
  try {
    if (localStorage.getItem('dzpos_whatsnew_v42') === '1') return;
    if (typeof Swal === 'undefined') return;
    localStorage.setItem('dzpos_whatsnew_v42', '1');
    const items = [
      t('whatsNew42_1', '🪟 نوافذ التأكيد أصبحت نوافذ حقيقية منبثقة بهوية النظام (كانت تظهر كنص أسفل الصفحة)'),
      t('whatsNew42_2', '🇩🇿 تصحيح علم الجزائر بالتصميم الرسمي المعتمد بالكامل'),
      t('whatsNew42_3', '📱 إصلاح جذري لمشكلة "غير متصل" على الهاتف: يكتشف النظام الخوادم تلقائياً ويعالج الاتصال وحده'),
      t('whatsNew42_4', '🌐 ترجمة شاملة 100%: المساعد الذكي، الإشعارات، والرسائل تتبع لغة التطبيق في كل الصفحات'),
      t('whatsNew42_5', '🔍 فحص اتصال جديد في الإعدادات: اختبار كل الخوادم واختيار الأسرع + تحديد خادم مخصص'),
      t('whatsNew42_6', '📋 صفحة سجل التدقيق محدثة بالكامل: بحث، فلاتر سريعة، إحصائيات، أجهزة، وتفاصيل كل حدث')
    ];
    Swal.fire({
      title: t('whatsNewTitle', 'جديد في الإصدار 4.2'),
      html: '<div class="whats-new-list">' + items.map(i => '<div class="whats-new-item">✅ <span>' + i + '</span></div>').join('') + '</div>',
      confirmButtonText: t('whatsNewOk', 'رائع، لنبدأ!'),
      confirmButtonColor: '#10b981',
      width: 520
    });
  } catch (_) {}
}

/* ---------- Main render ---------- */
export async function renderDashboardPage() {
  destroyCharts();
  renderSkeleton();

  // Fetch dashboard data (parallel). Errors degrade gracefully.
  // Backend uses /api/reports/summary?from=&to= for any range.
  // v4.1 — tz-aware ranges: from/to carry the device UTC offset and the
  // backend groups per-day numbers in the SAME local calendar.
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(today.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const tz = tzString();
  const fmtDate = (d, endOfDay) => isoWithOffset(d, endOfDay);

  const [todayRes, weekRes, invRes, salesRes] = await Promise.allSettled([
    apiFetch.get('/api/reports/summary', { from: fmtDate(startOfToday), to: fmtDate(today, true), tz }),
    apiFetch.get('/api/reports/summary', { from: fmtDate(sevenDaysAgo), to: fmtDate(today, true), tz }),
    apiFetch.get('/api/inventory/summary'),
    apiFetch.get('/api/sales', { page: 1, limit: 100 })
  ]);

  const todayData = todayRes.status === 'fulfilled' && todayRes.value && todayRes.value.success
    ? todayRes.value.data : null;
  const weekData = weekRes.status === 'fulfilled' && weekRes.value && weekRes.value.success
    ? weekRes.value.data : null;
  const invData = invRes.status === 'fulfilled' && invRes.value && invRes.value.success
    ? invRes.value.data : null;
  const recentSales = salesRes.status === 'fulfilled' && salesRes.value && salesRes.value.success
    ? (salesRes.value.data || []) : [];

  if (!todayData && !weekData) {
    const content = document.getElementById('pageContent');
    if (content) {
      content.innerHTML = emptyState(
        t('moduleLoadError', 'Failed to load'),
        t('networkError', 'Cannot reach the server')
      );
    }
    return;
  }

  // Normalize stats for the stat cards
  const stats = {
    totalProducts: (weekData && weekData.totalProducts) || (todayData && todayData.totalProducts) || 0,
    totalCustomers: (weekData && weekData.totalCustomers) || (todayData && todayData.totalCustomers) || 0,
    totalSalesToday: (todayData && todayData.totalSales) || 0,
    totalRevenueToday: (todayData && todayData.totalRevenue) || 0,
    lowStockProducts: (invData && invData.lowStock) || []
  };

  const content = document.getElementById('pageContent');
  if (!content) return;

  // Build 7-day chart data from weekData.salesByDay (fill missing days with 0)
  let labels = [], counts = [], revenues = [];
  const dayMap = {};
  if (weekData && Array.isArray(weekData.salesByDay)) {
    weekData.salesByDay.forEach(d => { dayMap[d.date] = d; });
  }
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = isoDay(d); // v4.1 — local calendar day (matches backend tz grouping)
    labels.push(d.toLocaleDateString((typeof window !== 'undefined' && typeof window.dzposLocale === 'function') ? window.dzposLocale() : undefined, { weekday: 'short', day: 'numeric' }));
    const entry = dayMap[key];
    counts.push(entry ? (entry.count || 0) : 0);
    revenues.push(entry ? (entry.revenue || 0) : 0);
  }

  // Top products (from weekData.topProducts)
  let topLabels = [], topData = [];
  if (weekData && Array.isArray(weekData.topProducts) && weekData.topProducts.length) {
    const top5 = weekData.topProducts.slice(0, 5);
    topLabels = top5.map(p => p.name || '—');
    topData = top5.map(p => p.quantity || 0);
  }

  // Category doughnut from weekData.salesByCategory
  let catLabels = [], catData = [];
  if (weekData && Array.isArray(weekData.salesByCategory) && weekData.salesByCategory.length) {
    catLabels = weekData.salesByCategory.map(c => c.name || c.category || '—');
    catData = weekData.salesByCategory.map(c => c.total || c.revenue || 0);
  } else {
    // Fallback: synthesize from low-stock products grouped by category
    const catAgg = {};
    (stats.lowStockProducts || []).forEach(p => {
      const cat = (p.category && (p.category.displayName || (p.category.name && (p.category.name.ar || p.category.name.en)) || p.category.name)) || t('noParent', 'No parent');
      catAgg[cat] = (catAgg[cat] || 0) + 1;
    });
    catLabels = Object.keys(catAgg);
    catData = Object.values(catAgg);
  }

  content.innerHTML = `
    ${renderDashToolbar()}
    ${renderStatCards(stats)}

    <div id="kpiExecutive"></div>

    <div class="chart-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <span>${t('salesTrend', 'Sales trend (last 7 days)')}</span>
          </div>
        </div>
        <div class="card-body">
          <div class="chart-canvas-wrap"><canvas id="salesTrendChart"></canvas></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            <span>${t('topProducts', 'Top selling products')}</span>
          </div>
        </div>
        <div class="card-body">
          ${topLabels.length
            ? '<div class="chart-canvas-wrap"><canvas id="topProductsChart"></canvas></div>'
            : emptyState(t('noData', 'No data'), t('noRecentSales', 'No recent sales'))}
        </div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>${t('lowStockAlert', 'Low stock alert')}</span>
          </div>
        </div>
        <div class="card-body">${renderLowStockList(stats.lowStockProducts)}</div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${t('recentSales', 'Recent sales')}</span>
          </div>
        </div>
        <div class="card-body">${renderRecentSales(recentSales)}</div>
      </div>
    </div>

    ${catLabels.length ? `
      <div class="card mb-4">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            <span>${t('salesByCategory', 'Sales by category')}</span>
          </div>
        </div>
        <div class="card-body">
          <div class="chart-canvas-wrap" style="height:260px;"><canvas id="categoryChart"></canvas></div>
        </div>
      </div>` : ''}
  `;

  // Render charts (after DOM insertion)
  if (topLabels.length) renderTopProductsChart(topLabels, topData);
  renderSalesTrendChart(labels, counts, revenues);
  if (catLabels.length) renderCategoryDoughnut(catLabels, catData);

  // v4.1 — animate the stat counters, wire the toolbar, stamp the time
  const rawVals = [stats.totalProducts, stats.totalCustomers, stats.totalSalesToday, stats.totalRevenueToday];
  const fmts = [fmtNum, fmtNum, fmtNum, fmtCurrency];
  const valueEls = content.querySelectorAll('.stat-value[data-raw]');
  valueEls.forEach((el, i) => { if (i < 4) animateValue(el, Number(rawVals[i]) || 0, fmts[i]); });
  stampUpdatedAt();
  wireDashToolbar();
  manageAutoRefresh();
  maybeShowWhatsNew();

  // v3 — Executive KPI section (async, degrades silently)
  loadExecutiveKpi();

  // Bind "Show more" recent-sales modal
  const showAllBtn = document.getElementById('dashShowAllRecent');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => openAllRecentSalesModal(recentSales));
  }

  // Listen for sale-completion events to refresh the dashboard live.
  setupLiveRefresh();
  // Record render time so the visibilitychange throttle works
  window._lastDashboardRender = Date.now();
}

/* ---------- v3: Executive KPI ---------- */
const _kpiCharts = [];
async function loadExecutiveKpi() {
  const host = document.getElementById('kpiExecutive');
  if (!host) return;
  try {
    const res = await apiFetch.get('/api/reports/kpi', { days: 30, tz: tzString() });
    const k = res.data || res;
    if (!k || !k.current) return;
    const delta = k.deltas || { revenuePct: 0, countPct: 0 };
    const deltaCls = (v) => v >= 0 ? 'up' : 'down';
    const arrow = (v) => v >= 0 ? '▲' : '▼';

    host.innerHTML = `
      <div class="kpi-exec-grid">
        <div class="card kpi-exec-card">
          <div class="kpi-exec-label">💰 ${t('revenue', 'Revenue')} (30)</div>
          <div class="kpi-exec-value">${(k.current.revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div class="kpi-delta ${deltaCls(delta.revenuePct)}">${arrow(delta.revenuePct)} ${Math.abs(delta.revenuePct)}% ${t('vsLastPeriod', 'vs previous')}</div>
        </div>
        <div class="card kpi-exec-card">
          <div class="kpi-exec-label">🧾 ${t('salesCount', 'Sales count')} (30)</div>
          <div class="kpi-exec-value">${k.current.count || 0}</div>
          <div class="kpi-delta ${deltaCls(delta.countPct)}">${arrow(delta.countPct)} ${Math.abs(delta.countPct)}% ${t('vsLastPeriod', 'vs previous')}</div>
        </div>
        <div class="card kpi-exec-card">
          <div class="kpi-exec-label">🧮 ${t('avgBasket', 'Average basket')}</div>
          <div class="kpi-exec-value">${(k.avgBasket || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div class="kpi-delta">DZD</div>
        </div>
        <div class="card kpi-exec-card">
          <div class="kpi-exec-label">📅 ${t('salesToday', 'Today')} / ${t('yesterday', 'Yesterday')}</div>
          <div class="kpi-exec-value">${(k.today.revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div class="kpi-delta">${t('yesterday', 'Yesterday')}: ${(k.yesterday.revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>
      <div class="card mb-4">
        <div class="card-header"><div class="card-title"><span>📈 ${t('kpiRevenue30', 'Revenue — last 30 days')}</span></div>
          <div class="export-btns">
            <button class="btn btn-secondary btn-sm" id="kpiXlsx">📊 Excel</button>
            <button class="btn btn-secondary btn-sm" id="kpiPdf">📄 PDF</button>
          </div>
        </div>
        <div class="card-body"><div class="chart-canvas-wrap" style="height:240px"><canvas id="kpiSeriesChart"></canvas></div></div>
      </div>
      <div class="card mb-4">
        <div class="card-header"><div class="card-title"><span>⏰ ${t('kpiPeakHours', 'Peak hours (30 days)')}</span></div></div>
        <div class="card-body"><div class="chart-canvas-wrap" style="height:200px"><canvas id="kpiHourChart"></canvas></div></div>
      </div>`;

    // 30-day series chart
    const series = k.series || [];
    const sEl = document.getElementById('kpiSeriesChart');
    if (sEl && typeof Chart !== 'undefined') {
      _kpiCharts.push(new Chart(sEl.getContext('2d'), {
        type: 'line',
        data: {
          labels: series.map(s => s.date.slice(5)),
          datasets: [{ label: t('revenue', 'Revenue'), data: series.map(s => s.revenue), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      }));
    }
    // hour distribution
    const hours = k.byHour || [];
    const hEl = document.getElementById('kpiHourChart');
    if (hEl && typeof Chart !== 'undefined') {
      const hourMap = new Map(hours.map(h => [h.hour, h.revenue]));
      const allHours = Array.from({ length: 24 }, (_, i) => i);
      _kpiCharts.push(new Chart(hEl.getContext('2d'), {
        type: 'bar',
        data: {
          labels: allHours.map(h => String(h).padStart(2, '0') + ':00'),
          datasets: [{ label: t('revenue', 'Revenue'), data: allHours.map(h => hourMap.get(h) || 0), backgroundColor: 'rgba(16,185,129,0.75)', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      }));
    }

    // exports
    const xlsxBtn = document.getElementById('kpiXlsx');
    const pdfBtn = document.getElementById('kpiPdf');
    if (xlsxBtn) xlsxBtn.addEventListener('click', () => window.DZExport && window.DZExport.exportToExcel({
      columns: [{ label: t('date'), key: 'date' }, { label: t('revenue'), key: 'revenue' }, { label: t('salesCount', 'Sales'), key: 'count' }],
      rows: series, filename: 'dzpospro-kpi-30d', title: t('kpiRevenue30', 'Revenue — last 30 days')
    }));
    if (pdfBtn) pdfBtn.addEventListener('click', () => window.DZExport && window.DZExport.exportToPDF({
      columns: [{ label: t('date'), key: 'date' }, { label: t('revenue'), key: 'revenue' }, { label: t('salesCount', 'Sales'), key: 'count' }],
      rows: series, filename: 'dzpospro-kpi-30d', title: t('kpiRevenue30', 'Revenue — last 30 days'), landscape: true
    }));
  } catch (_) { /* silent — KPI is an enhancement */ }
}

/* ---------- Live refresh on sale:completed / tab focus ---------- */
let _liveRefreshWired = false;
function setupLiveRefresh() {
  if (_liveRefreshWired) return;
  _liveRefreshWired = true;
  // Event from sales module when a sale completes
  window.addEventListener('sale:completed', () => {
    if (window.currentPage === 'dashboard') {
      renderDashboardPage().catch(() => {});
    }
  });
  // v4.1 — backend reachable again after an outage → refresh immediately
  window.addEventListener('dzpos:api-online', () => {
    if (window.currentPage === 'dashboard') {
      renderDashboardPage().catch(() => {});
    }
  });
  // Also refresh when the tab becomes visible again (user returns from POS)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.currentPage === 'dashboard') {
      // Refresh on tab refocus after any sale-completion since last render
      const lastRender = (window._lastDashboardRender || 0);
      const lastSale = (window._lastSaleAt || 0);
      if (lastSale > lastRender || Date.now() - lastRender > 15000) {
        renderDashboardPage().catch(() => {});
      }
    }
  });
  // Track when a sale was last completed anywhere in the app — used to refresh
  // the dashboard even if the user navigated away from the POS before the
  // sale:completed event fired.
  window.addEventListener('sale:completed', () => {
    window._lastSaleAt = Date.now();
  });
}

/* ---------- Public refresh entry (called by shell on page re-entry) ---------- */
export async function refreshDashboard() {
  return renderDashboardPage();
}

/* ---------- Back-compat alias ---------- */
export async function fetchDashboardStats() {
  return renderDashboardPage();
}

/* ---------- Re-render on theme change ---------- */
if (typeof window !== 'undefined') {
  window.addEventListener('themechange', () => {
    if (window.currentPage === 'dashboard') {
      // Defer to let CSS vars update first
      setTimeout(() => renderDashboardPage().catch(() => {}), 50);
    }
  });
}
