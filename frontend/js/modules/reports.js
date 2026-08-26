/* ============================================================
 * js/modules/reports.js
 * ------------------------------------------------------------
 * Renders the Reports / Insights page into #pageContent.
 *
 * Features:
 *   • Page header: title + subtitle (active date range) +
 *     date-range presets dropdown (Today / Yesterday / Last
 *     7 days / Last 30 days / This month / Last month / This
 *     year / Custom) + custom from/to date inputs + "Apply"
 *     + "Export PDF". Default = last 30 days.
 *   • 6 stat cards (Total sales, Revenue, Profit, Customers,
 *     Products, Low-stock). The low-stock card is clickable
 *     and scrolls to the low-stock section.
 *   • Charts row 1: Sales Trend (line + gradient fill) +
 *     Sales by Category (doughnut, legend on the side).
 *   • Charts row 2: Sales by Payment Method (bar) + Top 5
 *     Products (horizontal bar, revenue on x-axis).
 *   • Tables row: Top Products (rank/name/qty/revenue/profit)
 *     + Top Customers (rank/name/phone/visits/total).
 *   • Low-stock section: card with table (name / current
 *     stock / min stock / deficit) and red badge per item.
 *   • PDF export via jsPDF + autotable plugin. A4 portrait.
 *     Layout: store name + date range header + stat summary +
 *     top products table + top customers table.
 *   • All Chart.js instances are kept in state.charts[] and
 *     destroyed before re-render (prevents the "Canvas is
 *     already in use" error on range/theme change).
 *   • Skeleton loading for cards + spinner overlay on charts.
 *   • Friendly empty state when no sales in the selected range.
 *   • Currency read from /api/settings (fallback 'DZD');
 *     numbers via Intl.NumberFormat. All strings via window.t();
 *     all API calls via window.apiFetch(). No emoji — inline
 *     SVG (Lucide style, stroke-width 2) only.
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  from: '',
  to: '',
  preset: 'last30',
  loading: true,
  summary: null,        // /api/reports/summary → data
  salesReport: null,    // /api/reports/sales → data
  productsReport: [],   // /api/reports/products → data.topProducts
  customersReport: [],  // /api/reports/customers → data.topCustomers
  inventoryReport: null,// /api/reports/inventory → data
  settings: null,       // /api/settings → data.settings
  charts: []
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function currencyCode() {
  return (state.settings && state.settings.currency) || t('currency', 'DZD');
}

function fmtCurrency(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(v) + ' ' + currencyCode();
}

function fmtNumber(n) {
  return new Intl.NumberFormat().format(Number(n || 0));
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return escapeHtml(String(d));
  return dt.toLocaleDateString();
}

function fmtDateShort(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function isoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/* Preset → {from, to} in ISO yyyy-mm-dd */
function presetRange(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(today);
  const to = new Date(today);
  switch (preset) {
    case 'today':
      break;
    case 'yesterday':
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
      break;
    case 'last7':
      from.setDate(from.getDate() - 6);
      break;
    case 'last30':
      from.setDate(from.getDate() - 29);
      break;
    case 'thisMonth':
      from.setDate(1);
      break;
    case 'lastMonth':
      from.setMonth(from.getMonth() - 1);
      from.setDate(1);
      to.setDate(0); // last day of previous month
      break;
    case 'thisYear':
      from.setMonth(0);
      from.setDate(1);
      break;
    default:
      return null; // 'custom'
  }
  return { from: isoDay(from), to: isoDay(to) };
}

function defaultRange() { return presetRange('last30'); }

function activeRangeLabel() {
  return fmtDate(state.from) + ' — ' + fmtDate(state.to);
}

/* ---------- Theme color helpers ---------- */
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chartTextColor() { return cssVar('--text-secondary', '#64748b'); }
function chartGridColor() { return cssVar('--border-color', 'rgba(100,116,139,0.15)'); }
function cardBgColor()    { return cssVar('--bg-card', '#ffffff'); }

const CHART_PALETTE = [
  '#10b981', '#f59e0b', '#06b6d4', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'
];

const PAYMENT_COLORS = {
  cash:     '#10b981',
  card:     '#06b6d4',
  transfer: '#f59e0b',
  other:    '#8b5cf6'
};

/* ---------- SVG icons (Lucide style, stroke-width 2) ---------- */
const ICON = {
  chart:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  pie:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>',
  card:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  star:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  users:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  package:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  alert:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  sales:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  dollar:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  trending:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  calendar:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  download:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  check:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  refresh:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  emptyChart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'
};

/* ---------- Skeleton ---------- */
function chartSkeleton() {
  return `<div style="position:relative;height:300px;width:100%;">
    <div class="skeleton" style="height:100%;width:100%;"></div>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
      <div class="spinner" role="status" aria-label="${t('loading', 'Loading...')}"></div>
    </div>
  </div>`;
}

function renderSkeleton() {
  return `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${t('reports', 'Reports')}</h1>
        <div class="page-subtitle">${t('reportsSubtitle', 'Sales insights and KPIs')}</div>
      </div>
      <div class="page-actions">
        <div class="skeleton" style="height:40px;width:160px;"></div>
        <div class="skeleton" style="height:40px;width:140px;"></div>
        <div class="skeleton" style="height:40px;width:140px;"></div>
        <div class="skeleton" style="height:40px;width:130px;"></div>
      </div>
    </div>
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));">
      ${[1,2,3,4,5,6].map(() => `
        <div class="stat-card">
          <div class="skeleton" style="height:52px;width:52px;border-radius:12px;flex-shrink:0;"></div>
          <div style="flex:1;min-width:0;">
            <div class="skeleton skeleton-line" style="height:22px;width:70%;"></div>
            <div class="skeleton skeleton-line" style="height:12px;width:90%;margin-top:6px;"></div>
          </div>
        </div>`).join('')}
    </div>
    <div class="chart-grid">
      ${[1,2].map(() => `
        <div class="card">
          <div class="card-header"><div class="skeleton skeleton-line" style="height:18px;width:40%;"></div></div>
          <div class="card-body">${chartSkeleton()}</div>
        </div>`).join('')}
    </div>
    <div class="chart-grid" style="grid-template-columns:1fr 1fr;">
      ${[1,2].map(() => `
        <div class="card">
          <div class="card-header"><div class="skeleton skeleton-line" style="height:18px;width:40%;"></div></div>
          <div class="card-body">${chartSkeleton()}</div>
        </div>`).join('')}
    </div>`;
}

/* ---------- Toolbar (page header) ---------- */
function renderToolbar() {
  const presets = [
    { v: 'today',      l: t('presetToday', 'Today') },
    { v: 'yesterday',  l: t('presetYesterday', 'Yesterday') },
    { v: 'last7',      l: t('presetLast7', 'Last 7 days') },
    { v: 'last30',     l: t('presetLast30', 'Last 30 days') },
    { v: 'thisMonth',  l: t('presetThisMonth', 'This month') },
    { v: 'lastMonth',  l: t('presetLastMonth', 'Last month') },
    { v: 'thisYear',   l: t('presetThisYear', 'This year') },
    { v: 'custom',     l: t('presetCustom', 'Custom') }
  ];

  return `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title">${ICON.chart}<span style="margin-inline-start:0.5rem;">${t('reports', 'Reports')}</span></h1>
        <div class="page-subtitle">${t('reportsSubtitle', 'Sales insights and KPIs')} · ${escapeHtml(activeRangeLabel())}</div>
      </div>
      <div class="page-actions">
        <select class="select" id="reportPreset" style="height:40px;width:auto;">
          ${presets.map(p => '<option value="' + p.v + '"' + (p.v === state.preset ? ' selected' : '') + '>' + escapeHtml(p.l) + '</option>').join('')}
        </select>
        <div class="flex items-center" style="gap:0.4rem;">
          <label class="form-label" style="margin:0;font-size:0.8rem;" for="reportFrom">${t('fromDate', 'From')}</label>
          <input class="input" id="reportFrom" type="date" value="${state.from}" style="height:40px;width:auto;" />
        </div>
        <div class="flex items-center" style="gap:0.4rem;">
          <label class="form-label" style="margin:0;font-size:0.8rem;" for="reportTo">${t('toDate', 'To')}</label>
          <input class="input" id="reportTo" type="date" value="${state.to}" style="height:40px;width:auto;" />
        </div>
        <button class="btn btn-primary btn-sm" id="reportApplyBtn" type="button">
          ${ICON.check}
          <span>${t('applyRange', 'Apply')}</span>
        </button>
        <button class="btn btn-secondary btn-sm" id="reportExportBtn" type="button">
          ${ICON.download}
          <span>${t('exportPDF', 'Export PDF')}</span>
        </button>
      </div>
    </div>`;
}

/* ---------- Stat cards ---------- */
function renderStats() {
  const s = state.summary || {};
  const cards = [
    { label: t('totalSales', 'Total sales'),
      value: fmtNumber(s.totalSales),
      icon: ICON.sales, color: 'cyan',
      action: null },
    { label: t('totalRevenue', 'Total revenue'),
      value: fmtCurrency(s.totalRevenue),
      icon: ICON.dollar, color: 'green',
      action: null },
    { label: t('totalProfit', 'Total profit'),
      value: fmtCurrency(s.totalProfit),
      icon: ICON.trending, color: 'amber',
      action: null },
    { label: t('totalCustomers', 'Total customers'),
      value: fmtNumber(s.totalCustomers),
      icon: ICON.users, color: 'cyan',
      action: null },
    { label: t('totalProducts', 'Total products'),
      value: fmtNumber(s.totalProducts),
      icon: ICON.package, color: 'green',
      action: null },
    { label: t('lowStockCount', 'Low stock'),
      value: fmtNumber(s.lowStockCount),
      icon: ICON.alert, color: 'red',
      action: 'scroll-low-stock',
      ariaLabel: t('viewLowStock', 'View low-stock items') }
  ];

  return `<div class="stats-grid" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));">
    ${cards.map(c => `
      <div class="stat-card${c.action ? ' stat-card-clickable' : ''}"
           ${c.action ? 'role="button" tabindex="0" data-action="' + c.action + '" aria-label="' + escapeHtml(c.ariaLabel || c.label) + '"' : ''}
           ${c.action ? ' style="cursor:pointer;"' : ''}>
        <div class="stat-icon ${c.color}" aria-hidden="true">${c.icon}</div>
        <div class="stat-info">
          <div class="stat-value lg">${escapeHtml(c.value)}</div>
          <div class="stat-label">${escapeHtml(c.label)}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

/* ---------- Charts section ---------- */
function renderChartsSection() {
  return `
    <div class="chart-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">${ICON.chart}<span style="margin-inline-start:0.5rem;">${t('salesTrendReport', 'Sales trend')}</span></div>
        </div>
        <div class="card-body" style="position:relative;">
          <div class="chart-canvas-wrap" style="height:300px;"><canvas id="chartSalesTrend"></canvas></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">${ICON.pie}<span style="margin-inline-start:0.5rem;">${t('salesByCategory', 'Sales by category')}</span></div>
        </div>
        <div class="card-body" style="position:relative;">
          <div class="chart-canvas-wrap" style="height:300px;"><canvas id="chartCategory"></canvas></div>
        </div>
      </div>
    </div>
    <div class="chart-grid" style="grid-template-columns:1fr 1fr;">
      <div class="card">
        <div class="card-header">
          <div class="card-title">${ICON.card}<span style="margin-inline-start:0.5rem;">${t('salesByPaymentMethod', 'Sales by payment method')}</span></div>
        </div>
        <div class="card-body" style="position:relative;">
          <div class="chart-canvas-wrap" style="height:300px;"><canvas id="chartPayment"></canvas></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">${ICON.star}<span style="margin-inline-start:0.5rem;">${t('top5Products', 'Top 5 products')}</span></div>
        </div>
        <div class="card-body" style="position:relative;">
          <div class="chart-canvas-wrap" style="height:300px;"><canvas id="chartTopProducts"></canvas></div>
        </div>
      </div>
    </div>`;
}

function destroyCharts() {
  (state.charts || []).forEach(c => { try { c.destroy(); } catch (_) {} });
  state.charts = [];
}

function renderCharts() {
  destroyCharts();
  const s = state.summary || {};
  const txtColor = chartTextColor();
  const gridColor = chartGridColor();
  const cardBg = cardBgColor();
  const ChartCtor = (typeof Chart !== 'undefined') ? Chart : window.Chart;

  if (!ChartCtor) {
    if (window.Toast) window.Toast.error(t('chartLibMissing', 'Charts library not loaded'));
    return;
  }

  ChartCtor.defaults.color = txtColor;
  ChartCtor.defaults.font.family = (getComputedStyle(document.body).fontFamily) || 'system-ui, sans-serif';

  /* --- Sales trend (line + gradient fill) --- */
  const trendCanvas = document.getElementById('chartSalesTrend');
  if (trendCanvas) {
    const days = Array.isArray(s.salesByDay) ? s.salesByDay : [];
    const labels = days.map(d => fmtDateShort(d.date));
    const revenues = days.map(d => Number(d.revenue || 0));
    const counts = days.map(d => Number(d.count || 0));
    const ctx = trendCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(16,185,129,0.35)');
    gradient.addColorStop(1, 'rgba(16,185,129,0.00)');
    state.charts.push(new ChartCtor(trendCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: t('totalRevenue', 'Total revenue'),
          data: revenues,
          borderColor: '#10b981',
          backgroundColor: gradient,
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointBackgroundColor: '#10b981',
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items && items.length ? fmtDate(days[items[0].dataIndex].date) : '',
              label: (c) => fmtCurrency(c.parsed.y),
              afterLabel: (c) => t('qtySold', 'Qty sold') + ': ' + (counts[c.dataIndex] || 0)
            }
          }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: txtColor, callback: (v) => Number(v).toLocaleString() } },
          x: { grid: { display: false }, ticks: { color: txtColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }
        }
      }
    }));
  }

  /* --- Sales by category (doughnut, legend on the side) --- */
  const catCanvas = document.getElementById('chartCategory');
  if (catCanvas) {
    const cats = Array.isArray(s.salesByCategory) ? s.salesByCategory : [];
    const total = cats.reduce((sum, c) => sum + Number(c.revenue || c.total || 0), 0);
    state.charts.push(new ChartCtor(catCanvas, {
      type: 'doughnut',
      data: {
        labels: cats.map(c => c.name || c.category || '—'),
        datasets: [{
          data: cats.map(c => Number(c.revenue || c.total || 0)),
          backgroundColor: CHART_PALETTE,
          borderWidth: 2,
          borderColor: cardBg,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: window.innerWidth < 640 ? 'bottom' : 'right',
            labels: { color: txtColor, padding: 10, boxWidth: 12, font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = Number(c.parsed || 0);
                const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
                return c.label + ': ' + fmtCurrency(v) + ' (' + pct + '%)';
              }
            }
          }
        }
      }
    }));
  }

  /* --- Sales by payment method (vertical bar) --- */
  const payCanvas = document.getElementById('chartPayment');
  if (payCanvas) {
    const pays = Array.isArray(s.salesByPaymentMethod) ? s.salesByPaymentMethod : [];
    const labels = pays.map(p => t((p.method || '').toLowerCase(), p.method || '—'));
    const data = pays.map(p => Number(p.total || 0));
    const colors = pays.map(p => PAYMENT_COLORS[(p.method || '').toLowerCase()] || PAYMENT_COLORS.other);
    state.charts.push(new ChartCtor(payCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: t('totalRevenue', 'Total revenue'),
          data,
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 6,
          maxBarThickness: 56
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => fmtCurrency(c.parsed.y) } }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: txtColor, callback: (v) => Number(v).toLocaleString() } },
          x: { grid: { display: false }, ticks: { color: txtColor } }
        }
      }
    }));
  }

  /* --- Top 5 products (horizontal bar, revenue on x-axis) --- */
  const topCanvas = document.getElementById('chartTopProducts');
  if (topCanvas) {
    const top = (state.productsReport || []).slice(0, 5);
    state.charts.push(new ChartCtor(topCanvas, {
      type: 'bar',
      data: {
        labels: top.map(p => p.name || '—'),
        datasets: [{
          label: t('revenue', 'Revenue'),
          data: top.map(p => Number(p.revenue || 0)),
          backgroundColor: 'rgba(16,185,129,0.75)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 6,
          maxBarThickness: 28
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => fmtCurrency(c.parsed.x) } }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: txtColor, callback: (v) => Number(v).toLocaleString() } },
          y: { grid: { display: false }, ticks: { color: txtColor } }
        }
      }
    }));
  }
}

/* ---------- Tables ---------- */
function renderTables() {
  const topP = state.productsReport || [];
  const topC = state.customersReport || [];

  const topPRows = topP.length ? topP.map((p, i) => `
    <tr>
      <td class="cell-muted">${i + 1}</td>
      <td class="cell-strong">${escapeHtml(p.name || '—')}</td>
      <td>${fmtNumber(p.quantity)}</td>
      <td class="cell-strong">${fmtCurrency(p.revenue)}</td>
      <td>${fmtCurrency(p.profit)}</td>
    </tr>`).join('') : `<tr><td colspan="5" class="cell-muted" style="text-align:center;padding:1.5rem;">${t('noData', 'No data')}</td></tr>`;

  const topCRows = topC.length ? topC.map((c, i) => `
    <tr>
      <td class="cell-muted">${i + 1}</td>
      <td class="cell-strong">${escapeHtml(c.name || '—')}</td>
      <td class="cell-mono">${escapeHtml(c.phone || '—')}</td>
      <td>${fmtNumber(c.count)}</td>
      <td class="cell-strong">${fmtCurrency(c.total)}</td>
    </tr>`).join('') : `<tr><td colspan="5" class="cell-muted" style="text-align:center;padding:1.5rem;">${t('noData', 'No data')}</td></tr>`;

  return `
    <div class="chart-grid" style="grid-template-columns:1fr 1fr;margin-top:1rem;">
      <div class="card">
        <div class="card-header">
          <div class="card-title">${ICON.star}<span style="margin-inline-start:0.5rem;">${t('topProducts', 'Top products')}</span></div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-wrap" style="max-height:none;border:none;box-shadow:none;">
            <table class="table">
              <thead><tr>
                <th>#</th>
                <th>${t('product', 'Product')}</th>
                <th>${t('qtySold', 'Qty sold')}</th>
                <th>${t('revenue', 'Revenue')}</th>
                <th>${t('profit', 'Profit')}</th>
              </tr></thead>
              <tbody>${topPRows}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">${ICON.users}<span style="margin-inline-start:0.5rem;">${t('topCustomers', 'Top customers')}</span></div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-wrap" style="max-height:none;border:none;box-shadow:none;">
            <table class="table">
              <thead><tr>
                <th>#</th>
                <th>${t('customer', 'Customer')}</th>
                <th>${t('phone', 'Phone')}</th>
                <th>${t('visits', 'Visits')}</th>
                <th>${t('totalSpent', 'Total spent')}</th>
              </tr></thead>
              <tbody>${topCRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------- Low-stock section ---------- */
function renderLowStock() {
  const inv = state.inventoryReport || {};
  const items = Array.isArray(inv.lowStock) ? inv.lowStock : [];
  const totalItems = Number(inv.totalItems || 0);
  const stockValue = fmtCurrency(inv.totalStockValue || 0);

  const rows = items.length ? items.map(p => {
    const stock = Number(p.stock || 0);
    const min = Number(p.minStock || 0);
    const deficit = Math.max(0, min - stock);
    return `
      <tr>
        <td class="cell-strong">${escapeHtml(p.name || '—')}</td>
        <td>${escapeHtml(String(p.stock || 0))}</td>
        <td>${escapeHtml(String(p.minStock || 0))}</td>
        <td><span class="badge badge-danger">${deficit}</span></td>
      </tr>`;
  }).join('') : `<tr><td colspan="4" class="cell-muted" style="text-align:center;padding:1.5rem;">${t('allStockOk', 'All products are in stock')}</td></tr>`;

  return `
    <div class="card" id="lowStockSection" style="margin-top:1rem;scroll-margin-top:1rem;">
      <div class="card-header">
        <div class="card-title">${ICON.alert}<span style="margin-inline-start:0.5rem;">${t('lowStockProducts', 'Low-stock products')}</span></div>
        <div class="page-info">
          <span class="badge badge-muted">${items.length} ${t('items', 'items')}</span>
          <span class="badge badge-info" style="margin-inline-start:0.4rem;">${t('totalItems', 'Total items')}: ${fmtNumber(totalItems)}</span>
          <span class="badge badge-success" style="margin-inline-start:0.4rem;">${t('stockValue', 'Stock value')}: ${escapeHtml(stockValue)}</span>
        </div>
      </div>
      <div class="card-body" style="padding:0;">
        <div class="table-wrap" style="max-height:360px;overflow-y:auto;border:none;box-shadow:none;">
          <table class="table">
            <thead><tr>
              <th>${t('product', 'Product')}</th>
              <th>${t('currentStock', 'Current stock')}</th>
              <th>${t('minStock', 'Min stock')}</th>
              <th>${t('deficit', 'Deficit')}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

/* ---------- Empty state ---------- */
function renderEmpty() {
  return `
    <div class="empty-state">
      <div class="empty-icon" aria-hidden="true">${ICON.emptyChart}</div>
      <div class="empty-title">${t('noDataForRange', 'No data for the selected period')}</div>
      <div class="empty-subtitle">${t('noDataForRangeHint', 'Try widening the date range or check back later.')}</div>
      <div class="empty-subtitle" style="margin-top:0.25rem;font-weight:600;">${escapeHtml(activeRangeLabel())}</div>
    </div>`;
}

/* ---------- Fetch ---------- */
async function fetchAll() {
  state.loading = true;
  const qs = { from: state.from, to: state.to };
  try {
    const [sum, prod, cust, inv, settingsRes] = await Promise.all([
      apiFetch.get('/api/reports/summary', qs).catch((e) => { console.warn('[reports] summary', e); return null; }),
      apiFetch.get('/api/reports/products', Object.assign({ limit: 10 }, qs)).catch((e) => { console.warn('[reports] products', e); return null; }),
      apiFetch.get('/api/reports/customers', Object.assign({ limit: 10 }, qs)).catch((e) => { console.warn('[reports] customers', e); return null; }),
      apiFetch.get('/api/reports/inventory', {}).catch((e) => { console.warn('[reports] inventory', e); return null; }),
      apiFetch.get('/api/settings').catch((e) => { console.warn('[reports] settings', e); return null; })
    ]);

    if (sum && sum.success) {
      state.summary = (sum.data || sum.summary) || null;
    } else {
      state.summary = null;
    }

    if (prod && prod.success) {
      const d = prod.data || {};
      state.productsReport = d.topProducts || d.products || d.data || [];
    } else {
      state.productsReport = [];
    }

    if (cust && cust.success) {
      const d = cust.data || {};
      state.customersReport = d.topCustomers || d.customers || d.data || [];
    } else {
      state.customersReport = [];
    }

    if (inv && inv.success) {
      state.inventoryReport = (inv.data || inv) || null;
    } else {
      state.inventoryReport = null;
    }

    if (settingsRes && settingsRes.success) {
      const d = settingsRes.data || {};
      state.settings = d.settings || d || null;
    } else {
      state.settings = null;
    }
  } catch (e) {
    console.error('[reports] fetchAll', e);
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
    state.summary = null;
    state.productsReport = [];
    state.customersReport = [];
    state.inventoryReport = null;
  } finally {
    state.loading = false;
  }
}

/* ---------- Render ---------- */
function hasSalesInRange() {
  const s = state.summary || {};
  return Number(s.totalSales || 0) > 0
      || (Array.isArray(s.salesByDay) && s.salesByDay.length > 0)
      || (state.productsReport && state.productsReport.length > 0)
      || (state.customersReport && state.customersReport.length > 0);
}

function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  // Treat "no summary" as a hard error (network / 500). Treat "summary but
  // zero sales in range" as a soft empty state — still show the low-stock
  // section (which is range-independent) so the page stays useful.
  const hardError = !state.summary;
  const noSales = !hardError && !hasSalesInRange();
  let body;
  if (hardError) {
    body = renderEmpty();
  } else if (noSales) {
    body = renderEmpty() + renderLowStock();
  } else {
    body = renderStats() + renderChartsSection() + renderTables() + renderLowStock();
  }
  content.innerHTML = renderToolbar() + body;
  bindToolbar();
  if (!hardError && !noSales) {
    renderCharts();
  }
}

function bindToolbar() {
  const presetSel = document.getElementById('reportPreset');
  const from = document.getElementById('reportFrom');
  const to = document.getElementById('reportTo');
  const apply = document.getElementById('reportApplyBtn');
  const exp = document.getElementById('reportExportBtn');

  if (presetSel) {
    presetSel.addEventListener('change', async () => {
      const v = presetSel.value;
      if (v === 'custom') {
        state.preset = 'custom';
        return;
      }
      const r = presetRange(v);
      if (!r) return;
      state.preset = v;
      state.from = r.from;
      state.to = r.to;
      await refresh();
    });
  }

  if (from) from.addEventListener('change', () => {
    state.from = from.value;
    if (state.preset !== 'custom') {
      state.preset = 'custom';
      if (presetSel) presetSel.value = 'custom';
    }
  });
  if (to) to.addEventListener('change', () => {
    state.to = to.value;
    if (state.preset !== 'custom') {
      state.preset = 'custom';
      if (presetSel) presetSel.value = 'custom';
    }
  });

  if (apply) apply.addEventListener('click', async () => {
    const f = from && from.value ? from.value : state.from;
    const tt = to && to.value ? to.value : state.to;
    if (f && tt && new Date(f) > new Date(tt)) {
      if (window.Toast) window.Toast.warning(t('dateRangeInvalid', '"From" must be before "To"'));
      return;
    }
    state.from = f;
    state.to = tt;
    state.preset = 'custom';
    if (presetSel) presetSel.value = 'custom';
    await refresh();
  });

  if (exp) exp.addEventListener('click', () => exportPDF());

  /* Clickable low-stock stat card */
  document.querySelectorAll('.stat-card[data-action="scroll-low-stock"]').forEach(el => {
    const handler = () => {
      const target = document.getElementById('lowStockSection');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

async function refresh() {
  const content = document.getElementById('pageContent');
  if (content) content.innerHTML = renderSkeleton();
  await fetchAll();
  render();
}

/* ---------- PDF export (jsPDF + autotable) ---------- */
function exportPDF() {
  try {
    const lib = window.jspdf || (window.jsPDF ? { jsPDF: window.jsPDF } : null);
    const JsPDF = lib && (lib.jsPDF || lib);
    if (!JsPDF) {
      if (window.Toast) window.Toast.error(t('pdfLibMissing', 'PDF library not loaded'));
      return;
    }
    if (typeof JsPDF.prototype.autoTable !== 'function' && typeof window.jspdfAutoTable !== 'function') {
      // autotable plugin attaches itself to JsPDF.prototype when loaded; warn if missing.
      console.warn('[reports] autotable plugin may not be loaded');
    }

    const s = state.summary || {};
    const storeName = (state.settings && (state.settings.storeName || state.settings.name)) || t('appName', 'DZ POS PRO');
    const doc = new JsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const W = doc.internal.pageSize.getWidth();
    const M = 40;
    let y = 50;

    /* ----- Header band ----- */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(20, 20, 20);
    doc.text(String(storeName), M, y);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(120, 120, 120);
    doc.text(String(t('pdfReportTitle', 'Sales report')), M, y + 16);
    y += 32;

    doc.setFontSize(10);
    doc.text(String(t('reportPeriod', 'Period') + ': ' + fmtDate(state.from) + ' — ' + fmtDate(state.to)), M, y);
    y += 14;
    doc.text(String(t('generatedOn', 'Generated on') + ': ' + new Date().toLocaleString()), M, y);
    y += 12;
    doc.setDrawColor(220);
    doc.line(M, y, W - M, y);
    y += 18;

    /* ----- Stat summary table ----- */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    doc.text(String(t('summary', 'Summary')), M, y);
    y += 8;

    const statBody = [
      [t('totalSales', 'Total sales'),       fmtNumber(s.totalSales)],
      [t('totalRevenue', 'Total revenue'),   fmtCurrency(s.totalRevenue)],
      [t('totalProfit', 'Total profit'),     fmtCurrency(s.totalProfit)],
      [t('totalCustomers', 'Total customers'), fmtNumber(s.totalCustomers)],
      [t('totalProducts', 'Total products'), fmtNumber(s.totalProducts)],
      [t('lowStockCount', 'Low stock'),      fmtNumber(s.lowStockCount)]
    ];
    doc.autoTable({
      startY: y,
      head: [[t('metric', 'Metric'), t('value', 'Value')]],
      body: statBody,
      theme: 'striped',
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 10, cellPadding: 6 },
      columnStyles: { 0: { cellWidth: 250 }, 1: { cellWidth: 'auto', halign: 'right' } },
      margin: { left: M, right: M }
    });
    y = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : (y + statBody.length * 22);
    y += 20;

    /* ----- Top products table ----- */
    if (y > 680) { doc.addPage(); y = 50; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    doc.text(String(t('topProducts', 'Top products')), M, y);
    y += 8;

    const prodRows = (state.productsReport || []).slice(0, 10).map((p, i) => [
      String(i + 1),
      String(p.name || '—'),
      String(p.quantity || 0),
      fmtCurrency(p.revenue),
      fmtCurrency(p.profit)
    ]);
    if (!prodRows.length) prodRows.push(['', String(t('noData', 'No data')), '', '', '']);
    doc.autoTable({
      startY: y,
      head: [['#', t('product', 'Product'), t('qtySold', 'Qty sold'), t('revenue', 'Revenue'), t('profit', 'Profit')]],
      body: prodRows,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: {
        0: { cellWidth: 24, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 60, halign: 'right' },
        3: { cellWidth: 95, halign: 'right' },
        4: { cellWidth: 95, halign: 'right' }
      },
      margin: { left: M, right: M }
    });
    y = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : (y + prodRows.length * 18);
    y += 20;

    /* ----- Top customers table ----- */
    if (y > 680) { doc.addPage(); y = 50; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    doc.text(String(t('topCustomers', 'Top customers')), M, y);
    y += 8;

    const custRows = (state.customersReport || []).slice(0, 10).map((c, i) => [
      String(i + 1),
      String(c.name || '—'),
      String(c.phone || '—'),
      String(c.count || 0),
      fmtCurrency(c.total)
    ]);
    if (!custRows.length) custRows.push(['', String(t('noData', 'No data')), '', '', '']);
    doc.autoTable({
      startY: y,
      head: [['#', t('customer', 'Customer'), t('phone', 'Phone'), t('visits', 'Visits'), t('totalSpent', 'Total spent')]],
      body: custRows,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: {
        0: { cellWidth: 24, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 110 },
        3: { cellWidth: 60, halign: 'right' },
        4: { cellWidth: 100, halign: 'right' }
      },
      margin: { left: M, right: M }
    });
    y = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : (y + custRows.length * 18);

    /* ----- Footer page numbers ----- */
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        String(storeName + ' — ' + t('reports', 'Reports')),
        M, doc.internal.pageSize.getHeight() - 20
      );
      doc.text(
        String(i + ' / ' + pageCount),
        W - M, doc.internal.pageSize.getHeight() - 20,
        { align: 'right' }
      );
    }

    doc.save('report-' + state.from + '-to-' + state.to + '.pdf');
    if (window.Toast) window.Toast.success(t('pdfExported', 'PDF exported'));
  } catch (e) {
    console.error('[reports] exportPDF', e);
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
  }
}

/* ---------- Theme change re-render ---------- */
function onThemeChange() {
  // Re-render charts only (no need to re-fetch). Avoid re-rendering if no summary yet.
  if (!state.summary) return;
  renderCharts();
}

/* ---------- Module-scoped listener handle (avoids leak on re-entry) ---------- */
let _themeHandler = null;

/* ---------- Entry ---------- */
export async function renderReportsPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;

  // Cleanup any previous chart instances + listener
  destroyCharts();
  if (_themeHandler) {
    window.removeEventListener('themechange', _themeHandler);
    _themeHandler = null;
  }

  // Default range = last 30 days
  const r = defaultRange();
  state.from = r.from;
  state.to = r.to;
  state.preset = 'last30';
  state.loading = true;
  state.summary = null;
  state.salesReport = null;
  state.productsReport = [];
  state.customersReport = [];
  state.inventoryReport = null;
  state.settings = null;

  content.innerHTML = renderSkeleton();

  // Listen for theme changes (re-render charts so axis/legend colors refresh)
  _themeHandler = onThemeChange;
  window.addEventListener('themechange', _themeHandler);

  await fetchAll();
  render();

  // Live refresh: re-run on sale:completed or when the tab becomes visible.
  setupLiveRefresh();
  window._lastReportsRender = Date.now();
}

/* ---------- Live refresh on sale:completed / tab focus ---------- */
let _liveRefreshWired = false;
function setupLiveRefresh() {
  if (_liveRefreshWired) return;
  _liveRefreshWired = true;
  // Event from sales module when a sale completes — re-fetch with the
  // currently selected date range (refresh() preserves state.from / state.to).
  window.addEventListener('sale:completed', () => {
    if (window.currentPage === 'reports') {
      refresh().catch(() => {});
    }
  });
  // Also refresh when the tab becomes visible again (user returns from POS).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.currentPage === 'reports') {
      const lastRender = (window._lastReportsRender || 0);
      const lastSale = (window._lastSaleAt || 0);
      if (lastSale > lastRender || Date.now() - lastRender > 15000) {
        refresh().catch(() => {});
      }
    }
  });
}
