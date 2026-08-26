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
  try { const dt = new Date(d); if (isNaN(dt.getTime())) return ''; return dt.toLocaleDateString(undefined, { year:'numeric', month:'2-digit', day:'2-digit' }); } catch { return ''; }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

/* ---------- Render stat cards ---------- */
function renderStatCards(stats) {
  const cards = [
    { icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
      color: 'green', value: fmtNum(stats.totalProducts), label: t('totalProducts', 'Total products') },
    { icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      color: 'cyan', value: fmtNum(stats.totalCustomers), label: t('totalCustomers', 'Total customers') },
    { icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
      color: 'amber', value: fmtNum(stats.totalSalesToday), label: t('salesToday', 'Sales today') },
    { icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
      color: 'green', value: fmtCurrency(stats.totalRevenueToday), label: t('revenueToday', 'Revenue today') }
  ];
  return `
    <div class="stats-grid">
      ${cards.map(c => `
        <div class="stat-card">
          <div class="stat-icon ${c.color}" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>
          </div>
          <div class="stat-info">
            <div class="stat-value">${c.value}</div>
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
          backgroundColor: 'rgba(' + c.primaryRgb + ',0.12)', fill: true, tension: 0.35, borderWidth: 2,
          pointBackgroundColor: c.primary, pointRadius: 3, pointHoverRadius: 5 },
        { label: t('revenueToday', 'Revenue'), data: revenues, borderColor: c.accent,
          backgroundColor: 'rgba(' + c.accentRgb + ',0.10)', fill: true, tension: 0.35, borderWidth: 2,
          pointBackgroundColor: c.accent, pointRadius: 3, pointHoverRadius: 5,
          yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, labels: { color: c.text, font: { family: 'Tajawal, sans-serif' } } } },
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

/* ---------- Main render ---------- */
export async function renderDashboardPage() {
  destroyCharts();
  renderSkeleton();

  // Fetch dashboard data (parallel). Errors degrade gracefully.
  // Backend uses /api/reports/summary?from=&to= for any range.
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(today.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const fmtDate = (d) => d.toISOString().slice(0, 10);

  const [todayRes, weekRes, invRes, salesRes] = await Promise.allSettled([
    apiFetch.get('/api/reports/summary', { from: fmtDate(startOfToday), to: fmtDate(today) }),
    apiFetch.get('/api/reports/summary', { from: fmtDate(sevenDaysAgo), to: fmtDate(today) }),
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
    const key = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }));
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
    ${renderStatCards(stats)}

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
