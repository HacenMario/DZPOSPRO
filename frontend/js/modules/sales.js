/* ============================================================
 * js/modules/sales.js
 * ------------------------------------------------------------
 * Renders the POS / Sales terminal page into #pageContent.
 *
 * Modern POS screen with two panels:
 *   • LEFT  (60%) — product browser: search, category chips,
 *     infinite-scroll grid, barcode-scanner listener.
 *   • RIGHT (40%) — cart / checkout: customer selector,
 *     per-item quantity steppers + line discounts, coupon,
 *     totals (HT / discount / TVA / timbre / TTC), quick-cash
 *     payment pad, payment-method selector (cash / card /
 *     transfer / split), Complete-Sale button.
 *
 * On successful sale a receipt preview modal opens with three
 * actions: Print (window.print + thermal stylesheet), Download
 * PDF (jsPDF + autotable, A4 invoice with French legal words),
 * New Sale (clears the cart and closes the modal).
 *
 * Conventions (mirrors categories.js / products.js):
 *   • All API calls go through window.apiFetch()
 *   • All user-visible strings go through window.t()
 *   • Modals are appended to document.body and removed on close
 *   • Esc closes the topmost modal; F2 focuses the product search
 *   • No emoji in the UI — inline SVG (Lucide / Feather) only
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

/* ============================================================
 * Helpers
 * ============================================================ */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtMoney(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (state.settings.currency || t('currency', 'DZD'));
}

function fmtDate(d, lang) {
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d || '');
    const locale = lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB';
    return dt.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return String(d || ''); }
}

function productName(p) {
  if (!p) return '';
  if (p.displayName) return p.displayName;
  if (p.name && typeof p.name === 'object') return p.name.ar || p.name.en || p.name.fr || '';
  if (typeof p.name === 'string') return p.name;
  return '';
}

function productInitial(p) {
  const n = productName(p) || '?';
  return n.trim().charAt(0).toUpperCase();
}

function categoryName(c) {
  if (!c) return '';
  if (c.displayName) return c.displayName;
  if (c.name && typeof c.name === 'object') return c.name.ar || c.name.en || c.name.fr || '';
  if (typeof c.name === 'string') return c.name;
  return '';
}

function isBarcodeLike(q) {
  return /^[0-9]{4,}$/.test(String(q || '').trim());
}

function debounce(fn, ms) {
  let id = null;
  return function (...args) {
    if (id) clearTimeout(id);
    id = setTimeout(() => { id = null; fn.apply(this, args); }, ms);
  };
}

/* ---------- Customer name resolution (handles {ar,en,fr} object) ---------- */
function resolveCustomerName(cust, fallback) {
  if (!cust) return fallback || '';
  if (typeof cust === 'string') return cust;
  if (typeof cust.displayName === 'string' && cust.displayName) return cust.displayName;
  if (cust.name && typeof cust.name === 'object') return cust.name.ar || cust.name.en || cust.name.fr || '';
  if (typeof cust.name === 'string' && cust.name) return cust.name;
  return fallback || '';
}

/* ---------- Cart persistence in localStorage ---------- */
const SAVED_CART_KEY = 'dzpos_sales_cart';
function loadSavedCart() {
  try {
    const raw = localStorage.getItem(SAVED_CART_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.cart)) return null;
    return obj; // { cart, selectedCustomerId, selectedCustomerName, couponCode, couponDiscount, couponObj, paymentMethod, amountPaid, splitCash, splitCard, activeCustomerId, customerCarts, loyaltyPoints }
  } catch (_) { return null; }
}
function saveCart() {
  try {
    const obj = {
      cart: state.cart,
      selectedCustomerId: state.selectedCustomerId,
      selectedCustomerName: state.selectedCustomerName,
      couponCode: state.couponCode,
      couponDiscount: state.couponDiscount,
      couponObj: state.couponObj,
      paymentMethod: state.paymentMethod,
      amountPaid: state.amountPaid,
      splitCash: state.splitCash,
      splitCard: state.splitCard,
      activeCustomerId: state.activeCustomerId || null,
      customerCarts: state.customerCarts || {},
      loyaltyPoints: state.loyaltyPoints || 0
    };
    localStorage.setItem(SAVED_CART_KEY, JSON.stringify(obj));
  } catch (_) {}
}
function clearSavedCart() {
  try { localStorage.removeItem(SAVED_CART_KEY); } catch (_) {}
}

/* ---------- French number-to-words (legal invoice requirement) ---------- */
function num2frenchwords(n) {
  if (n === undefined || n === null || isNaN(n)) return '';
  n = Math.round(n * 100) / 100;
  const parts = n.toFixed(2).split('.');
  const integerPart = parseInt(parts[0], 10);
  const decimalPart = parseInt(parts[1], 10);

  if (integerPart === 0 && decimalPart === 0) return 'Zéro dinar algérien';

  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];

  function convertChunk(num) {
    if (num === 0) return '';
    let result = '';
    const hundreds = Math.floor(num / 100);
    const remainder = num % 100;

    if (hundreds > 0) {
      if (hundreds === 1) result += 'cent';
      else result += units[hundreds] + ' cent';
      if (remainder === 0) result += 's';
      result += ' ';
    }
    if (remainder === 0) return result.trim();

    if (remainder < 17) {
      result += units[remainder];
    } else if (remainder < 70) {
      const ten = Math.floor(remainder / 10);
      const unit = remainder % 10;
      if (ten === 1) {
        result += 'dix';
        if (unit > 0) result += '-' + units[unit];
      } else if (ten === 7) {
        result += 'soixante';
        if (unit === 1) result += '-onze';
        else if (unit > 1) result += '-' + units[unit + 10];
        else result += '-dix';
      } else {
        result += tens[ten];
        if (unit > 0) result += '-' + units[unit];
      }
    } else if (remainder < 80) {
      const unit = remainder - 70;
      result += 'soixante';
      if (unit === 0) result += '-dix';
      else if (unit === 1) result += '-onze';
      else result += '-' + units[unit + 10];
    } else if (remainder < 90) {
      const unit = remainder - 80;
      result += 'quatre-vingt';
      if (unit > 0) result += '-' + units[unit];
      else result += 's';
    } else {
      const unit = remainder - 90;
      result += 'quatre-vingt';
      if (unit === 0) result += '-dix';
      else if (unit === 1) result += '-onze';
      else result += '-' + units[unit + 10];
    }
    return result.trim();
  }

  function convertBig(num) {
    if (num === 0) return '';
    const millions = Math.floor(num / 1000000);
    const thousands = Math.floor((num % 1000000) / 1000);
    const remainder = num % 1000;
    let result = '';

    if (millions > 0) {
      if (millions === 1) result += 'un million';
      else result += convertChunk(millions) + ' millions';
      if (thousands > 0 || remainder > 0) result += ' ';
    }
    if (thousands > 0) {
      if (thousands === 1) result += 'mille';
      else result += convertChunk(thousands) + ' mille';
      if (remainder > 0) result += ' ';
    }
    if (remainder > 0) result += convertChunk(remainder);
    return result.trim();
  }

  const integerWords = integerPart > 0 ? convertBig(integerPart) : '';
  const decimalWords = decimalPart > 0 ? convertChunk(decimalPart) + (decimalPart === 1 ? ' centime' : ' centimes') : '';

  let result = '';
  if (integerWords) result += integerWords + ' dinar algérien';
  if (decimalWords) {
    if (integerWords) result += ' et ';
    result += decimalWords;
  }
  result = result.replace(/\s+/g, ' ').trim();
  return result.charAt(0).toUpperCase() + result.slice(1);
}

/* ============================================================
 * State
 * ============================================================ */

let state = {
  // product browser
  products: [],
  productsPage: 1,
  productsTotalPages: 1,
  productsTotal: 0,
  productsLoading: false,
  productsExhausted: false,
  search: '',
  selectedCategory: '', // '' = all
  categories: [],

  // customers
  customers: [],
  selectedCustomerId: null,
  selectedCustomerName: '',

  // cart
  cart: [],
  // each cart item: { productId, name, price, quantity, maxStock, discount, timbre, tax, barcode }

  // coupon
  couponCode: '',
  couponExpanded: false,
  couponDiscount: 0,
  couponObj: null,

  // payment
  paymentMethod: 'cash', // 'cash' | 'card' | 'transfer' | 'split'
  amountPaid: 0,
  splitCash: 0,
  splitCard: 0,

  // multi-customer carts (one cart per customer)
  activeCustomerId: null, // null = walk-in, or customer id
  customerCarts: {},      // { [customerId]: { cart, couponCode, couponDiscount, couponObj, paymentMethod, amountPaid, splitCash, splitCard, selectedCustomerId, selectedCustomerName, loyaltyPoints } }
  loyaltyPoints: 0,       // loyalty points of the currently-selected customer (for display)

  // session
  session: null,
  sessionStats: null,

  // settings
  settings: {
    storeName: 'DZ POS PRO',
    currency: 'DZD',
    taxRate: 0,
    invoicePrefix: 'INV-',
    invoiceFooter: '',
    invoiceCustomText: '',
    companyInfo: { rc: '', nif: '', nis: '', art: '', address: '', phone: '', whatsapp: '', email: '' }
  },

  // last completed sale (for receipt modal)
  lastSale: null
};

/* ============================================================
 * CSS injected once per page render (scoped under #pageContent)
 * ============================================================ */

const POS_CSS = `
<style id="pos-css">
.pos-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(360px, 1fr);
  gap: 1rem;
  align-items: start;
}

/* ---- Mobile: floating cart FAB + drawer ---- */
.pos-cart-fab {
  display: none;
  position: fixed;
  bottom: 1rem;
  inset-inline-end: 1rem;
  z-index: 100;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  padding: 0.85rem 1.4rem;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-lg);
  align-items: center;
  gap: 0.5rem;
  transition: transform 0.2s;
}
.pos-cart-fab:hover { transform: translateY(-2px); }
.pos-cart-fab:active { transform: translateY(0); }
.pos-cart-fab.has-items { animation: posFabPulse 2s infinite; }
.pos-cart-fab .fab-badge {
  background: rgba(255,255,255,0.25);
  border-radius: var(--radius-full);
  padding: 0.1rem 0.5rem;
  font-size: 0.78rem;
  min-width: 22px;
  text-align: center;
}
.pos-cart-fab svg { width: 20px; height: 20px; }

@media (max-width: 1024px) {
  .pos-layout { grid-template-columns: 1fr; }
  .pos-cart-fab { display: inline-flex; }
  .pos-right {
    position: fixed !important;
    bottom: 0;
    top: auto !important;
    inset-inline: 0;
    max-height: 85vh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0 !important;
    z-index: 101;
    transform: translateY(100%);
    transition: transform 0.3s ease;
    box-shadow: var(--shadow-xl);
  }
  .pos-right.open { transform: translateY(0); }
  .pos-cart-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 100;
  }
  .pos-cart-backdrop.show { display: block; }
}

/* ---- Mobile: customer-first bar ----
 * On phones the customer selector lived INSIDE the cart drawer, so the
 * sale flow was: open cart → pick customer → close cart → add products →
 * re-open cart → pay. The bar below surfaces "select customer" as
 * STEP 1 on the main POS screen (above the product grid), matching the
 * desktop flow — no cart detour needed anymore. */
.pos-customer-bar {
  display: none;
  align-items: center;
  gap: 0.6rem;
  margin: 0.65rem 0.85rem 0;
  padding: 0.6rem 0.8rem;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}
.pos-customer-bar .pos-cb-step {
  width: 26px; height: 26px;
  flex-shrink: 0;
  display: grid; place-items: center;
  background: var(--primary);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 800;
  border-radius: var(--radius-full);
}
.pos-customer-bar .pos-cb-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pos-customer-bar .pos-cb-label { font-size: 0.68rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
.pos-customer-bar .pos-cb-name { font-size: 0.86rem; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pos-customer-bar .pos-cb-btn {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.45rem 0.85rem;
  background: var(--primary-light);
  color: var(--primary-dark);
  font-size: 0.78rem; font-weight: 700;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
}
.pos-customer-bar .pos-cb-btn svg { width: 14px; height: 14px; }
[data-theme="dark"] .pos-customer-bar .pos-cb-btn { color: var(--primary); }
.pos-customer-bar.is-set { border-color: rgba(var(--primary-rgb), 0.45); }
.pos-customer-bar.is-set .pos-cb-step { background: var(--success); }
@media (max-width: 1024px) {
  .pos-customer-bar { display: flex; }
}

@keyframes posFabPulse {
  0% { box-shadow: var(--shadow-lg), 0 0 0 0 rgba(var(--primary-rgb), 0.45); }
  70% { box-shadow: var(--shadow-lg), 0 0 0 12px rgba(var(--primary-rgb), 0); }
  100% { box-shadow: var(--shadow-lg), 0 0 0 0 rgba(var(--primary-rgb), 0); }
}

.pos-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

/* ---- Left: product browser ---- */
.pos-left { display: flex; flex-direction: column; min-height: 60vh; }
.pos-search-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border-color);
  align-items: center;
  flex-wrap: wrap;
}
.pos-search-row .search-box { flex: 1 1 260px; max-width: 460px; }
.pos-search-row .pos-session-chip {
  margin-inline-start: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.35rem 0.7rem;
  border-radius: var(--radius-full);
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.pos-search-row .pos-session-chip.open { background: var(--success-light); color: var(--success); }
.pos-search-row .pos-session-chip.closed { background: var(--danger-light); color: var(--danger); }
.pos-search-row .pos-session-chip svg { width: 12px; height: 12px; }
.pos-session-toggle {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.75rem; font-weight: 600;
  padding: 0.3rem 0.65rem;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer; border: 1px solid var(--border-color);
}
.pos-session-toggle:hover { background: var(--bg-hover-strong, var(--bg-hover)); color: var(--text-primary); }

.pos-cat-chips {
  display: flex;
  gap: 0.4rem;
  padding: 0.65rem 1rem;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-color);
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}
.pos-cat-chips::-webkit-scrollbar { height: 6px; }
.pos-cat-chips::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }
.pos-cat-chip {
  flex-shrink: 0;
  padding: 0.35rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: var(--radius-full);
  background: var(--bg-hover);
  color: var(--text-secondary);
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.pos-cat-chip:hover { color: var(--text-primary); }
.pos-cat-chip.active {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 2px 6px rgba(var(--primary-rgb), 0.3);
}

.pos-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
  padding: 1rem;
  overflow-y: auto;
  max-height: calc(100vh - 280px);
  min-height: 300px;
}
@media (min-width: 1280px) { .pos-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); } }
@media (max-width: 640px) { .pos-grid { grid-template-columns: repeat(2, 1fr); } }

.pos-product {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
  text-align: start;
  font: inherit;
  color: inherit;
}
.pos-product:hover:not(:disabled) {
  border-color: var(--primary);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(var(--primary-rgb), 0.12);
}
.pos-product:disabled { opacity: 0.55; cursor: not-allowed; }
.pos-product-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  display: grid; place-items: center;
  overflow: hidden;
  color: var(--primary);
  font-weight: 800;
  font-size: 1.8rem;
}
.pos-product-img img { width: 100%; height: 100%; object-fit: cover; }
.pos-product-name {
  font-size: 0.83rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.2em;
}
.pos-product-price {
  font-size: 1rem;
  font-weight: 800;
  color: var(--primary);
  letter-spacing: -0.3px;
}
.pos-product-stock {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  align-self: flex-start;
}
.pos-product-stock.in { background: var(--success-light); color: var(--success); }
.pos-product-stock.low { background: var(--warning-light); color: var(--warning); }
.pos-product-stock.out { background: var(--danger-light); color: var(--danger); }
.pos-product-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }

.pos-sentinel { padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.8rem; }

.pos-empty {
  grid-column: 1 / -1;
  padding: 3rem 1.5rem;
  text-align: center;
  color: var(--text-muted);
}
.pos-empty svg { width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 0.5rem; }

/* ---- Right: cart panel ---- */
.pos-right {
  position: sticky;
  top: calc(var(--topbar-height) + 1rem);
  max-height: calc(100vh - var(--topbar-height) - 2rem);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* Cart items area scrolls internally so action buttons always visible */
.pos-cart-items-wrap {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 60px;
  max-height: 100%;
}
.pos-cart-footer {
  flex-shrink: 0;
  padding: 0.6rem 1rem;
  border-top: 2px solid var(--border-color);
  background: var(--bg-card);
}
.pos-cart-close-mobile {
  display: none;
  background: none; border: none; cursor: pointer;
  color: var(--text-secondary); padding: 0.2rem; border-radius: 6px;
}
.pos-cart-close-mobile svg { width: 20px; height: 20px; }
@media (max-width: 1024px) {
  .pos-cart-close-mobile { display: block; }
}
/* ---- Cart tabs (multi-customer) ---- */
.pos-cart-tabs {
  display: flex;
  gap: 0.3rem;
  padding: 0.4rem 0.6rem 0;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-body);
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) transparent;
  min-height: 38px;
}
.pos-cart-tabs::-webkit-scrollbar { height: 6px; }
.pos-cart-tabs::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }
.pos-cart-tab {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.35rem 0.65rem;
  font-size: 0.78rem; font-weight: 600;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer; color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 220px;
  transition: all 0.15s;
  font-family: inherit;
}
.pos-cart-tab:hover { color: var(--text-primary); border-color: var(--primary); }
.pos-cart-tab.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.pos-cart-tab span:first-child {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  vertical-align: middle;
}
.pos-cart-tab-close {
  display: inline-grid; place-items: center;
  width: 18px; height: 18px;
  font-size: 0.9rem; line-height: 1;
  border-radius: 50%;
  background: rgba(0,0,0,0.1);
  cursor: pointer;
  flex-shrink: 0;
}
.pos-cart-tab.active .pos-cart-tab-close { background: rgba(255,255,255,0.25); }
.pos-cart-tab-close:hover { background: var(--danger); color: #fff; }

.pos-cart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid var(--border-color);
}
.pos-cart-header h3 {
  margin: 0; font-size: 1rem; font-weight: 700;
  color: var(--text-primary);
  display: inline-flex; align-items: center; gap: 0.45rem;
}
.pos-cart-header svg { width: 18px; height: 18px; color: var(--primary); }
.pos-cart-count {
  background: var(--primary-light);
  color: var(--primary-dark);
  font-size: 0.75rem; font-weight: 700;
  padding: 0.15rem 0.55rem;
  border-radius: var(--radius-full);
}

.pos-customer-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-body);
}
.pos-customer-btn {
  flex: 1;
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.45rem 0.7rem;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  color: var(--text-primary);
  text-align: start;
  min-width: 0;
}
.pos-customer-btn:hover { border-color: var(--primary); }
.pos-customer-btn svg { width: 16px; height: 16px; color: var(--primary); flex-shrink: 0; }
.pos-customer-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pos-customer-name { font-size: 0.85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pos-customer-meta { font-size: 0.72rem; color: var(--text-muted); }
.pos-customer-clear {
  width: 30px; height: 30px;
  display: grid; place-items: center;
  background: transparent; border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted); cursor: pointer;
}
.pos-customer-clear:hover { color: var(--danger); border-color: var(--danger); }
.pos-customer-clear svg { width: 14px; height: 14px; }

.pos-cart-items {
  padding: 0.5rem 0.65rem;
  background: var(--bg-body);
}
.pos-cart-items::-webkit-scrollbar { width: 8px; }
.pos-cart-items::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 4px; }

.pos-cart-empty {
  padding: 2.5rem 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}
.pos-cart-empty svg { width: 40px; height: 40px; margin-bottom: 0.5rem; }

.pos-cart-item {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.55rem;
  margin-bottom: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.pos-cart-item-row1 {
  display: flex; align-items: flex-start; gap: 0.4rem;
}
.pos-cart-item-name { flex: 1; font-size: 0.83rem; font-weight: 600; color: var(--text-primary); line-height: 1.3; }
.pos-cart-item-remove {
  width: 22px; height: 22px;
  display: grid; place-items: center;
  background: transparent; border: none;
  color: var(--text-muted); cursor: pointer;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.pos-cart-item-remove:hover { color: var(--danger); background: var(--danger-light); }
.pos-cart-item-remove svg { width: 14px; height: 14px; }
.pos-cart-item-row2 {
  display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;
}
.pos-qty {
  display: inline-flex; align-items: center;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.pos-qty button {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  background: var(--bg-hover);
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 1rem; font-weight: 700;
}
.pos-qty button:hover { background: var(--primary); color: #fff; }
.pos-qty input {
  width: 42px; height: 28px;
  text-align: center;
  border: none; border-inline: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 0.82rem; font-weight: 600;
  font-family: inherit;
}
.pos-qty input:focus { outline: 2px solid var(--primary); outline-offset: -2px; }
.pos-cart-item-price { font-size: 0.75rem; color: var(--text-muted); }
.pos-cart-item-total { font-size: 0.92rem; font-weight: 800; color: var(--primary); }
.pos-cart-item-disc {
  display: flex; align-items: center; gap: 0.35rem;
  font-size: 0.72rem; color: var(--text-muted);
}
.pos-cart-item-disc input {
  width: 60px; height: 24px;
  padding: 0 0.35rem;
  font-size: 0.75rem;
  text-align: end;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
}

/* ---- Coupon ---- */
.pos-coupon-row {
  display: flex; gap: 0.4rem;
  padding: 0.55rem 1rem;
  border-top: 1px solid var(--border-color);
  background: var(--bg-body);
}
.pos-coupon-row .input { flex: 1; height: 36px; }
.pos-coupon-chip {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  background: var(--success-light);
  color: var(--success);
  border-radius: var(--radius-full);
  font-size: 0.75rem; font-weight: 600;
  margin: 0.55rem 1rem 0;
}
.pos-coupon-chip button {
  background: transparent; border: none; cursor: pointer;
  color: inherit; display: grid; place-items: center;
  padding: 0;
}
.pos-coupon-chip svg { width: 12px; height: 12px; }

/* Coupon toggle (collapsed state — "Have a coupon?") */
.pos-coupon-toggle {
  display: flex; align-items: center; gap: 0.4rem;
  background: transparent; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 0.78rem; font-weight: 500;
  padding: 0.5rem 1rem; width: 100%; text-align: start;
  transition: color 0.2s;
}
.pos-coupon-toggle:hover { color: var(--primary); }
.pos-coupon-toggle svg { width: 14px; height: 14px; }

/* ---- Totals ---- */
.pos-totals {
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--border-color);
  background: var(--bg-card);
}
.pos-totals-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 0.82rem;
  padding: 0.18rem 0;
  color: var(--text-secondary);
}
.pos-totals-row.total {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text-primary);
  border-top: 1px dashed var(--border-color);
  padding-top: 0.45rem;
  margin-top: 0.3rem;
}
.pos-totals-row.total .pos-totals-val { color: var(--primary); font-size: 1.15rem; }
.pos-totals-row .pos-totals-label { font-weight: 600; }
.pos-totals-row .pos-totals-val { font-weight: 700; color: var(--text-primary); }

/* ---- Payment ---- */
.pos-payment {
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--border-color);
  background: var(--bg-body);
  display: flex; flex-direction: column; gap: 0.5rem;
}
.pos-pay-methods {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4rem;
}
.pos-pay-method {
  padding: 0.45rem 0.3rem;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
  transition: all 0.15s;
}
.pos-pay-method svg { width: 16px; height: 16px; }
.pos-pay-method:hover { border-color: var(--primary); color: var(--text-primary); }
.pos-pay-method.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  box-shadow: 0 2px 6px rgba(var(--primary-rgb), 0.3);
}

.pos-quickcash {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
}
.pos-quickcash-btn {
  padding: 0.45rem 0.3rem;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-primary);
  font-family: inherit;
  transition: all 0.15s;
}
.pos-quickcash-btn:hover { background: var(--primary); color: #fff; border-color: var(--primary); }
.pos-quickcash-btn.exact { background: var(--accent); color: #fff; border-color: var(--accent); }
.pos-quickcash-btn.exact:hover { filter: brightness(1.05); }

.pos-paid-row {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.82rem;
}
.pos-paid-row .input { flex: 1; height: 36px; font-weight: 700; }
.pos-paid-row .pos-change {
  font-weight: 700;
  color: var(--success);
  padding: 0 0.5rem;
  white-space: nowrap;
}
.pos-split-inputs {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem;
}
.pos-split-inputs .form-group { margin: 0; }
.pos-split-inputs label { font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px; display: block; }

.pos-actions {
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--border-color);
  display: flex; flex-direction: column; gap: 0.4rem;
}
.pos-actions .btn { justify-content: center; }
.pos-actions .pos-actions-row { display: flex; gap: 0.4rem; }
.pos-actions .pos-actions-row .btn { flex: 1; }

/* ---- Skeleton ---- */
.pos-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
  padding: 1rem;
}
.pos-skeleton-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  padding: 0.65rem;
  display: flex; flex-direction: column; gap: 0.45rem;
}

/* ---- Receipt (modal + print) ---- */
.receipt-sheet {
  background: #fff;
  color: #111;
  font-family: 'Courier New', monospace;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 1.5rem;
  border-radius: var(--radius);
  font-size: 0.85rem;
  line-height: 1.5;
}
.receipt-sheet .receipt-head { text-align: center; border-bottom: 2px dashed #999; padding-bottom: 0.75rem; margin-bottom: 0.75rem; }
.receipt-sheet .receipt-store { font-size: 1.4rem; font-weight: 800; color: #000; }
.receipt-sheet .receipt-sub { font-size: 0.75rem; color: #444; }
.receipt-sheet .receipt-meta { display: flex; justify-content: space-between; font-size: 0.78rem; margin-bottom: 0.5rem; }
.receipt-sheet table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.receipt-sheet th, .receipt-sheet td { padding: 0.25rem 0.3rem; text-align: start; }
.receipt-sheet th { border-bottom: 2px solid #999; font-weight: 700; }
.receipt-sheet td.num, .receipt-sheet th.num { text-align: end; }
.receipt-sheet .receipt-totals { margin-top: 0.75rem; border-top: 2px dashed #999; padding-top: 0.5rem; }
.receipt-sheet .receipt-totals-row { display: flex; justify-content: space-between; font-size: 0.8rem; padding: 0.1rem 0; }
.receipt-sheet .receipt-totals-row.total { font-size: 1rem; font-weight: 800; border-top: 1px solid #999; margin-top: 0.3rem; padding-top: 0.3rem; }
.receipt-sheet .receipt-foot { text-align: center; margin-top: 0.75rem; font-size: 0.78rem; color: #444; border-top: 2px dashed #999; padding-top: 0.5rem; }
.receipt-sheet .receipt-words { font-style: italic; font-size: 0.74rem; color: #333; margin-top: 0.4rem; }

@media print {
  body.printing-receipt * { visibility: hidden !important; }
  body.printing-receipt #receiptPrintArea,
  body.printing-receipt #receiptPrintArea * { visibility: visible !important; }
  body.printing-receipt #receiptPrintArea {
    position: absolute !important;
    inset: 0 !important;
    margin: 0 !important;
    padding: 8mm !important;
    width: 80mm !important;
    max-width: none !important;
    box-shadow: none !important;
    border: none !important;
    background: #fff !important;
  }
  body.printing-receipt .receipt-sheet { width: 100% !important; max-width: none !important; padding: 0 !important; }
}

/* Desktop: keep cart panel sticky and bounded */
@media (min-width: 1025px) {
  .pos-right { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow-y: auto; }
}

/* ============================================================
   POS UX REDESIGN — mobile-first improvements
   ============================================================ */

/* ---- Mobile customer bar: selecting the customer is the FIRST step,
   reachable without opening the cart drawer (mirrors desktop) ---- */
.pos-mobile-custbar {
  display: none;
}
@media (max-width: 1024px) {
  .pos-mobile-custbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.75rem 1rem 0 1rem;
    padding: 0.7rem 0.9rem;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .pos-mobile-custbar .custbar-icon {
    width: 38px; height: 38px;
    flex-shrink: 0;
    display: grid; place-items: center;
    border-radius: 50%;
    background: var(--primary-light);
    color: var(--primary-dark);
  }
  .pos-mobile-custbar .custbar-icon svg { width: 20px; height: 20px; }
  .pos-mobile-custbar .custbar-texts { min-width: 0; flex: 1; }
  .pos-mobile-custbar .custbar-label {
    font-size: 0.68rem; font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.4px;
  }
  .pos-mobile-custbar .custbar-name {
    font-size: 0.9rem; font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pos-mobile-custbar .custbar-chev { color: var(--text-muted); flex-shrink: 0; }
  .pos-mobile-custbar .custbar-chev svg { width: 18px; height: 18px; }
  .pos-mobile-custbar.step-pulse { animation: custbarPulse 1.2s ease-in-out 3; border-color: var(--primary); }
}
@keyframes custbarPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.35); }
  50% { box-shadow: 0 0 0 8px rgba(var(--primary-rgb), 0); }
}

/* ---- Mobile sticky summary bar (items + total + open cart) ---- */
.pos-mobile-summary {
  display: none;
}
@media (max-width: 1024px) {
  .pos-mobile-summary {
    display: flex;
    position: sticky;
    bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
    z-index: 99;
    margin: 0.75rem 1rem;
    padding: 0.65rem 0.9rem;
    align-items: center;
    gap: 0.75rem;
    background: var(--primary);
    color: #fff;
    border: none;
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-lg);
    cursor: pointer;
    width: calc(100% - 2rem);
    font: inherit;
    -webkit-tap-highlight-color: transparent;
  }
  .pos-mobile-summary .sum-texts { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; flex: 1; }
  .pos-mobile-summary .sum-items { font-size: 0.72rem; font-weight: 600; opacity: 0.85; }
  .pos-mobile-summary .sum-total { font-size: 1rem; font-weight: 800; line-height: 1.2; }
  .pos-mobile-summary .sum-cta {
    flex-shrink: 0;
    background: rgba(255,255,255,0.22);
    border-radius: var(--radius-full);
    padding: 0.4rem 0.9rem;
    font-size: 0.82rem;
    font-weight: 700;
    display: inline-flex; align-items: center; gap: 0.35rem;
  }
  .pos-mobile-summary .sum-cta svg { width: 16px; height: 16px; }
  .pos-mobile-summary.has-items { animation: posFabPulse 2s infinite; }
  /* Hide the old FAB when the richer summary bar is present */
  .pos-cart-fab { display: none !important; }
}

/* ---- Product cards: bigger touch targets + quick-add badge ---- */
@media (max-width: 1024px) {
  .pos-product { padding: 0.55rem; border-radius: var(--radius); }
  .pos-product-name { font-size: 0.8rem; }
  .pos-product-price { font-size: 0.95rem; }
  .pos-grid { gap: 0.55rem; padding: 0.75rem; }
}
.pos-product .pos-add-hint {
  position: absolute;
  top: 0.45rem;
  inset-inline-end: 0.45rem;
  width: 26px; height: 26px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  display: grid; place-items: center;
  opacity: 0;
  transform: scale(0.8);
  transition: all 0.15s;
  box-shadow: 0 2px 8px rgba(var(--primary-rgb), 0.4);
}
.pos-product .pos-add-hint svg { width: 15px; height: 15px; }
.pos-product:hover .pos-add-hint, .pos-product:focus-visible .pos-add-hint { opacity: 1; transform: scale(1); }
@media (max-width: 1024px) {
  .pos-product .pos-add-hint { opacity: 1; transform: scale(1); width: 24px; height: 24px; }
}

/* ---- Cart drawer: customer row emphasized as step 1 ---- */
.pos-customer-row { position: relative; }
@media (max-width: 1024px) {
  .pos-right.open .pos-customer-row { background: var(--primary-light); }
  .pos-cart-header h3 { font-size: 0.95rem; }
}
.pos-step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px; height: 20px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--primary);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 800;
  flex-shrink: 0;
}

/* ---- Touch-friendly cart quantity buttons on phones ---- */
@media (max-width: 768px) {
  .pos-qty button { min-width: 40px; min-height: 40px; font-size: 1.15rem; }
  .pos-qty input { min-height: 40px; }
  .pos-cart-item-remove { min-width: 40px; min-height: 40px; }
  .pos-quickcash-btn { min-height: 40px; }
  .pos-pay-method { padding: 0.55rem 0.4rem; font-size: 0.78rem; }
  .pos-actions-row { gap: 0.4rem; }
  .pos-actions-row .btn { padding: 0.6rem 0.5rem; }
}
</style>
`;

/* ============================================================
 * SVG icon strings (Lucide / Feather style, stroke-width 2)
 * ============================================================ */
const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="5 6 12 3 19 6"/><line x1="4" y1="10" x2="4" y2="21"/><line x1="20" y1="10" x2="20" y2="21"/><line x1="8" y1="14" x2="8" y2="17"/><line x1="12" y1="14" x2="12" y2="17"/><line x1="16" y1="14" x2="16" y2="17"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>',
  split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  package: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>'
};

/* ============================================================
 * Render — skeleton, layout, panels
 * ============================================================ */

function renderSkeleton() {
  return POS_CSS + `
    <div class="pos-layout">
      <div class="pos-panel pos-left">
        <div class="pos-search-row">
          <div class="skeleton" style="height:40px;width:100%;max-width:380px;"></div>
          <div class="skeleton" style="height:32px;width:120px;margin-inline-start:auto;"></div>
        </div>
        <div class="pos-cat-chips">
          ${[1,2,3,4,5].map(() => '<div class="skeleton" style="height:28px;width:80px;border-radius:9999px;"></div>').join('')}
        </div>
        <div class="pos-skeleton-grid">
          ${[1,2,3,4,5,6,7,8].map(() => `
            <div class="pos-skeleton-card">
              <div class="skeleton" style="aspect-ratio:1/1;width:100%;"></div>
              <div class="skeleton skeleton-line" style="height:14px;width:90%;"></div>
              <div class="skeleton skeleton-line" style="height:14px;width:60%;"></div>
            </div>`).join('')}
        </div>
      </div>
      <div class="pos-panel pos-right">
        <div class="pos-cart-header">
          <div class="skeleton" style="height:20px;width:100px;"></div>
          <div class="skeleton" style="height:20px;width:30px;border-radius:9999px;"></div>
        </div>
        <div class="skeleton" style="height:60px;margin:0.65rem 1rem;"></div>
        <div style="padding:0.5rem;">
          ${[1,2].map(() => '<div class="skeleton skeleton-line" style="height:60px;margin-bottom:0.5rem;"></div>').join('')}
        </div>
        <div class="skeleton" style="height:140px;margin:0.65rem 1rem;"></div>
        <div class="skeleton" style="height:48px;margin:0.65rem 1rem;border-radius:var(--radius-sm);"></div>
      </div>
    </div>`;
}

function renderLayout() {
  return POS_CSS + `
    <!-- Mobile: STEP 1 — select customer BEFORE opening the cart -->
    <div class="pos-customer-bar ${state.selectedCustomerId ? 'is-set' : ''}" id="posCustomerBar">
      <span class="pos-cb-step" id="posCbStep">1</span>
      <span class="pos-cb-info">
        <span class="pos-cb-label">${escapeHtml(t('stepSelectCustomer', 'Step 1 — customer'))}</span>
        <span class="pos-cb-name" id="posCbName">${escapeHtml(state.selectedCustomerName || t('noCustomer', 'Walk-in customer'))}</span>
      </span>
      <button class="pos-cb-btn" id="posCbBtn" type="button">${ICON.user}<span>${state.selectedCustomerId ? t('change', 'Change') : t('selectCustomer', 'Select customer')}</span></button>
    </div>
    <div class="pos-layout">
      <!-- LEFT: product browser -->
      <div class="pos-panel pos-left">
        <div class="pos-search-row">
          <div class="search-box">
            <span class="search-icon" aria-hidden="true">${ICON.search}</span>
            <input class="input" id="posSearch" type="search"
                   placeholder="${escapeHtml(t('searchProduct', 'Search by name or barcode...'))}"
                   value="${escapeHtml(state.search)}" autocomplete="off" />
            <button class="pos-scan-btn" id="posScanBtn" type="button"
                    title="${escapeHtml(t('scanBarcode', 'Scan barcode with camera'))}"
                    aria-label="${escapeHtml(t('scanBarcode', 'Scan barcode with camera'))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12" stroke-width="3"/></svg>
            </button>
          </div>
          <span class="pos-session-chip ${state.session ? 'open' : 'closed'}" id="posSessionChip" title="${escapeHtml(state.session ? t('sessionStatusOpen', 'Session open') : t('sessionStatusClosed', 'Session closed'))}">
            ${state.session ? ICON.check : ICON.power}
            <span>${escapeHtml(state.session ? (state.session.userName || t('sessionStatusOpen', 'Open')) : t('sessionStatusClosed', 'Closed'))}</span>
          </span>
          <button class="pos-session-toggle" id="posSessionToggle" type="button">
            ${state.session ? ICON.power : ICON.power}
            <span>${state.session ? t('sessionClose', 'Close session') : t('sessionOpen', 'Open session')}</span>
          </button>
        </div>
        <div class="pos-cat-chips" id="posCatChips">${renderCategoryChips()}</div>
        <div class="pos-grid" id="posGrid">${renderProductsGridInner()}</div>
        <div class="pos-sentinel" id="posSentinel"></div>
      </div>

      <!-- RIGHT: cart / checkout -->
      <div class="pos-panel pos-right" id="posRightPanel">
        <div class="pos-cart-header">
          <h3>${ICON.cart}<span>${t('cart', 'Cart')}</span></h3>
          <span class="pos-cart-count" id="posCartCount">0</span>
          <button class="pos-cart-close-mobile" id="posCartCloseMobile" type="button" aria-label="${escapeHtml(t('close', 'Close'))}">${ICON.close}</button>
        </div>

        <div class="pos-cart-tabs" id="posCartTabs">${renderCartTabs()}</div>

        <div class="pos-customer-row">
          <button class="pos-customer-btn" id="posCustomerBtn" type="button" aria-label="${escapeHtml(t('selectCustomer', 'Select customer'))}">
            ${ICON.user}
            <span class="pos-customer-info">
              <span class="pos-customer-name" id="posCustomerName">${escapeHtml(state.selectedCustomerName || t('noCustomer', 'Walk-in customer'))}</span>
              <span class="pos-customer-meta" id="posCustomerMeta"></span>
            </span>
          </button>
          ${state.selectedCustomerId ? `<button class="pos-customer-clear" id="posCustomerClear" type="button" aria-label="${escapeHtml(t('clear', 'Clear'))}">${ICON.close}</button>` : ''}
        </div>

        <div class="pos-cart-items-wrap">
          <div class="pos-cart-items" id="posCartItems">${renderCartInner()}</div>
          ${renderCouponArea()}
          <div class="pos-totals" id="posTotals">${renderTotalsInner()}</div>

          <div class="pos-payment">
            <div class="pos-pay-methods" id="posPayMethods">
              <button class="pos-pay-method ${state.paymentMethod === 'cash' ? 'active' : ''}" data-method="cash" type="button">${ICON.cash}<span>${t('cash', 'Cash')}</span></button>
              <button class="pos-pay-method ${state.paymentMethod === 'card' ? 'active' : ''}" data-method="card" type="button">${ICON.card}<span>${t('card', 'Card')}</span></button>
              <button class="pos-pay-method ${state.paymentMethod === 'transfer' ? 'active' : ''}" data-method="transfer" type="button">${ICON.bank}<span>${t('transfer', 'Transfer')}</span></button>
              <button class="pos-pay-method ${state.paymentMethod === 'split' ? 'active' : ''}" data-method="split" type="button">${ICON.split}<span>${t('split', 'Split')}</span></button>
            </div>
            <div id="posPayExtra">${renderPayExtra()}</div>
          </div>
        </div>

        <div class="pos-cart-footer">
          <div class="pos-actions">
            <button class="btn btn-primary btn-lg btn-block" id="posCompleteBtn" type="button">
              ${ICON.check}
              <span>${t('completeSale', 'Complete sale')}</span>
            </button>
            <div class="pos-actions-row">
              <button class="btn btn-ghost" id="posClearCartBtn" type="button">${ICON.trash}<span>${t('clearCart', 'Clear cart')}</span></button>
              <button class="btn btn-secondary" id="posRefreshBtn" type="button">${ICON.refresh}<span>${t('refresh', 'Refresh')}</span></button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Mobile: sticky Cart bar — the ALWAYS-VISIBLE cart entry point.
         Without it (and with the FAB hidden by CSS) the cart drawer was
         unreachable on phones, blocking the sale after STEP 1. -->
    <button class="pos-mobile-summary" id="posMobileSummary" type="button" aria-label="${escapeHtml(t('cart', 'Cart'))}">
      <span class="sum-texts">
        <span class="sum-items" id="posSumItems">${t('cartTotal', 'Cart total')}</span>
        <span class="sum-total" id="posSumTotal">${fmtMoney(0)}</span>
      </span>
      <span class="sum-cta">${ICON.cart}<span>${t('cart', 'Cart')}</span></span>
    </button>
    <div class="pos-cart-backdrop" id="posCartBackdrop"></div>
    <button class="pos-cart-fab" id="posCartFab" type="button" aria-label="${escapeHtml(t('cart', 'Cart'))}">
      ${ICON.cart}
      <span>${t('cart', 'Cart')}</span>
      <span class="fab-badge" id="posFabBadge">0</span>
    </button>`;
}

function renderCategoryChips() {
  const all = `<button class="pos-cat-chip ${state.selectedCategory === '' ? 'active' : ''}" data-cat="" type="button">${t('all', 'All')}</button>`;
  const chips = state.categories.map(c => {
    const name = categoryName(c);
    return `<button class="pos-cat-chip ${state.selectedCategory === c._id ? 'active' : ''}" data-cat="${escapeHtml(c._id)}" type="button">${escapeHtml(name)}</button>`;
  }).join('');
  return all + chips;
}

function renderProductsGridInner() {
  if (state.productsLoading && state.products.length === 0) {
    return `
      <div class="pos-skeleton-grid" style="grid-column: 1 / -1;">
        ${[1,2,3,4,5,6,7,8].map(() => `
          <div class="pos-skeleton-card">
            <div class="skeleton" style="aspect-ratio:1/1;width:100%;"></div>
            <div class="skeleton skeleton-line" style="height:14px;width:90%;"></div>
            <div class="skeleton skeleton-line" style="height:14px;width:60%;"></div>
          </div>`).join('')}
      </div>`;
  }
  if (state.products.length === 0) {
    return `
      <div class="pos-empty">
        ${ICON.package}
        <div style="font-size:1rem;font-weight:700;color:var(--text-secondary);">${t('noProductsMatch', 'No matching products')}</div>
        <div style="font-size:0.85rem;margin-top:0.2rem;">${t('noProducts', 'No products found')}</div>
      </div>`;
  }
  return state.products.map(p => {
    const name = productName(p);
    const stock = Number(p.stock || 0);
    const minStock = Number(p.minStock || 0);
    const out = stock <= 0;
    const low = !out && stock <= minStock;
    const stockClass = out ? 'out' : (low ? 'low' : 'in');
    const stockLabel = out ? t('outOfStock', 'Out of stock') : (low ? t('lowStockBadge', 'Low stock') : (t('stock', 'Stock') + ': ' + stock));
    const img = (p.images && p.images.length)
      ? `<img src="${escapeHtml(window.resolveAssetUrl ? window.resolveAssetUrl(p.images[0]) : p.images[0])}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.style.display='none';this.parentNode.innerHTML='${escapeHtml(productInitial(p))}'" />`
      : escapeHtml(productInitial(p));
    return `
      <button class="pos-product" data-id="${escapeHtml(p._id)}" type="button" ${out ? 'disabled' : ''} aria-label="${escapeHtml(name)}">
        <div class="pos-product-img">${img}</div>
        <div class="pos-product-name">${escapeHtml(name)}</div>
        <div class="pos-product-foot">
          <span class="pos-product-price">${fmtMoney(p.price)}</span>
          <span class="pos-product-stock ${stockClass}">${escapeHtml(stockLabel)}</span>
        </div>
      </button>`;
  }).join('');
}

function renderCartInner() {
  if (state.cart.length === 0) {
    return `
      <div class="pos-cart-empty">
        ${ICON.cart}
        <div>${t('noCartItems', 'Cart is empty')}</div>
      </div>`;
  }
  return state.cart.map((item, idx) => {
    const line = item.price * item.quantity - (Number(item.discount) || 0);
    return `
      <div class="pos-cart-item" data-idx="${idx}">
        <div class="pos-cart-item-row1">
          <div class="pos-cart-item-name">${escapeHtml(item.name)}</div>
          <button class="pos-cart-item-remove" data-action="remove" type="button" aria-label="${escapeHtml(t('delete', 'Delete'))}">${ICON.close}</button>
        </div>
        <div class="pos-cart-item-row2">
          <div class="pos-qty">
            <button data-action="dec" type="button" aria-label="−">−</button>
            <input type="number" min="1" max="${item.maxStock}" value="${item.quantity}" data-action="qty" aria-label="${escapeHtml(t('quantity', 'Quantity'))}" />
            <button data-action="inc" type="button" aria-label="+">+</button>
          </div>
          <div class="pos-cart-item-price">${fmtMoney(item.price)} × ${item.quantity}</div>
          <div class="pos-cart-item-total">${fmtMoney(line)}</div>
        </div>
        <div class="pos-cart-item-disc">
          <span>${t('discount', 'Discount')}:</span>
          <input type="number" min="0" step="0.01" value="${item.discount || 0}" data-action="disc" aria-label="${escapeHtml(t('perItemDiscount', 'Per-item discount'))}" />
        </div>
      </div>`;
  }).join('');
}

function renderCouponArea() {
  if (state.couponObj) {
    return `
      <div class="pos-coupon-chip">
        ${ICON.tag}
        <span>${escapeHtml(state.couponObj.code || state.couponCode)} − ${fmtMoney(state.couponDiscount)}</span>
        <button id="posCouponRemove" type="button" aria-label="${escapeHtml(t('clear', 'Clear'))}">${ICON.close}</button>
      </div>`;
  }
  // Collapsible "Have a coupon?" link — NOT always visible.
  // Only shows the input when the user clicks the toggle.
  if (state.couponExpanded) {
    return `
      <div class="pos-coupon-row">
        <input class="input" id="posCouponCode" type="text" placeholder="${escapeHtml(t('couponCode', 'Coupon code'))}" value="${escapeHtml(state.couponCode)}" autocomplete="off" />
        <button class="btn btn-secondary btn-sm" id="posCouponApply" type="button">${t('applyCoupon', 'Apply')}</button>
        <button class="btn btn-ghost btn-sm" id="posCouponCancel" type="button" aria-label="${escapeHtml(t('cancel', 'Cancel'))}">${ICON.close}</button>
      </div>`;
  }
  return `
    <button class="pos-coupon-toggle" id="posCouponToggle" type="button">
      ${ICON.tag}
      <span>${t('haveCoupon', 'Have a coupon code?')}</span>
    </button>`;
}

function computeTotals() {
  const subtotal = state.cart.reduce((s, it) => s + it.price * it.quantity, 0);
  const itemDiscounts = state.cart.reduce((s, it) => s + (Number(it.discount) || 0), 0);
  const cartDiscount = state.couponDiscount || 0;
  const totalDiscount = itemDiscounts + cartDiscount;
  // timbre: unique per product
  const seen = new Set();
  let timbre = 0;
  state.cart.forEach(it => {
    if ((it.timbre || 0) > 0 && !seen.has(it.productId)) {
      timbre += Number(it.timbre) || 0;
      seen.add(it.productId);
    }
  });
  const taxRate = Number(state.settings.taxRate || 0);
  const taxableBase = Math.max(0, subtotal - totalDiscount);
  const tax = taxableBase * (taxRate / 100);
  // Cart total excludes TVA and Timbre — they are computed only in the final invoice.
  const total = Math.max(0, subtotal - totalDiscount);
  return { subtotal, itemDiscounts, cartDiscount, totalDiscount, timbre, tax, taxRate, total };
}

function renderTotalsInner() {
  const tt = computeTotals();
  const rows = [
    `<div class="pos-totals-row"><span class="pos-totals-label">${t('subtotal', 'Subtotal')} (H.T)</span><span class="pos-totals-val">${fmtMoney(tt.subtotal)}</span></div>`
  ];
  if (tt.itemDiscounts > 0) {
    rows.push(`<div class="pos-totals-row"><span class="pos-totals-label">${t('perItemDiscount', 'Item discounts')}</span><span class="pos-totals-val">−${fmtMoney(tt.itemDiscounts)}</span></div>`);
  }
  if (tt.cartDiscount > 0) {
    rows.push(`<div class="pos-totals-row"><span class="pos-totals-label">${t('discount', 'Coupon discount')}</span><span class="pos-totals-val">−${fmtMoney(tt.cartDiscount)}</span></div>`);
  }
  rows.push(`<div class="pos-totals-row total"><span class="pos-totals-label">${t('total', 'Total')}</span><span class="pos-totals-val">${fmtMoney(tt.total)}</span></div>`);
  return rows.join('');
}

function renderPayExtra() {
  const tt = computeTotals();
  if (state.paymentMethod === 'cash') {
    const change = Math.max(0, (state.amountPaid || 0) - tt.total);
    return `
      <div class="pos-quickcash" id="posQuickCash">
        ${[100, 200, 500, 1000, 2000].map(v => `<button class="pos-quickcash-btn" data-quick="${v}" type="button">${v}</button>`).join('')}
        <button class="pos-quickcash-btn exact" data-quick="exact" type="button">${t('exactAmount', 'Exact')}</button>
      </div>
      <div class="pos-paid-row">
        <input class="input" id="posAmountPaid" type="number" min="0" step="0.01" value="${state.amountPaid || ''}" placeholder="${escapeHtml(t('amountPaid', 'Amount paid'))}" aria-label="${escapeHtml(t('amountPaid', 'Amount paid'))}" />
        <span class="pos-change" id="posChange">${change > 0 ? t('changeDue', 'Change due') + ': ' + fmtMoney(change) : ''}</span>
      </div>`;
  }
  if (state.paymentMethod === 'split') {
    const remaining = Math.max(0, tt.total - (state.splitCash + state.splitCard));
    return `
      <div class="pos-split-inputs">
        <div class="form-group">
          <label>${t('cash', 'Cash')}</label>
          <input class="input" id="posSplitCash" type="number" min="0" step="0.01" value="${state.splitCash || ''}" placeholder="0.00" />
        </div>
        <div class="form-group">
          <label>${t('card', 'Card')}</label>
          <input class="input" id="posSplitCard" type="number" min="0" step="0.01" value="${state.splitCard || ''}" placeholder="0.00" />
        </div>
      </div>
      ${remaining > 0 ? `<div class="pos-paid-row" style="color:var(--warning);font-size:0.78rem;">${t('remaining', 'Remaining')}: ${fmtMoney(remaining)}</div>` : ''}`;
  }
  return `<div class="pos-paid-row" style="font-size:0.78rem;color:var(--text-muted);">${t('paymentMethod', 'Payment method')}: ${paymentLabel(state.paymentMethod)}</div>`;
}

function paymentLabel(method) {
  return ({ cash: t('cash', 'Cash'), card: t('card', 'Card'), transfer: t('transfer', 'Transfer'), split: t('split', 'Split') })[method] || method;
}

/* ============================================================
 * Multi-customer carts (one cart per customer)
 * ============================================================ */

function renderCartTabs() {
  const tabs = [];
  const walkinActive = !state.activeCustomerId;
  tabs.push('<button class="pos-cart-tab ' + (walkinActive ? 'active' : '') + '" data-cust="walkin" type="button">' + escapeHtml(t('walkinTab', 'Particulier')) + '</button>');
  const ids = new Set();
  if (state.activeCustomerId) ids.add(state.activeCustomerId);
  Object.keys(state.customerCarts || {}).forEach(k => { if (k !== 'walkin') ids.add(k); });
  ids.forEach(cid => {
    const isActive = state.activeCustomerId === cid;
    const stashed = state.customerCarts[cid];
    const name = isActive ? state.selectedCustomerName : ((stashed && stashed.selectedCustomerName) || cid);
    tabs.push('<button class="pos-cart-tab ' + (isActive ? 'active' : '') + '" data-cust="' + escapeHtml(cid) + '" type="button"><span>' + escapeHtml(name || cid) + '</span><span class="pos-cart-tab-close" data-close="' + escapeHtml(cid) + '" role="button" aria-label="' + escapeHtml(t('close', 'Close')) + '">×</span></button>');
  });
  return tabs.join('');
}

function updateCartTabs() {
  const tabs = document.getElementById('posCartTabs');
  if (tabs) tabs.innerHTML = renderCartTabs();
}

function saveCurrentCartToCarts() {
  const key = state.activeCustomerId || 'walkin';
  state.customerCarts[key] = {
    cart: state.cart.map(it => ({ ...it })),
    couponCode: state.couponCode,
    couponDiscount: state.couponDiscount,
    couponObj: state.couponObj,
    paymentMethod: state.paymentMethod,
    amountPaid: state.amountPaid,
    splitCash: state.splitCash,
    splitCard: state.splitCard,
    selectedCustomerId: state.selectedCustomerId,
    selectedCustomerName: state.selectedCustomerName,
    loyaltyPoints: state.loyaltyPoints || 0
  };
}

function switchCartToCustomer(customerId, customerName, loyaltyPoints) {
  const previousKey = state.activeCustomerId || 'walkin';
  // Stash the live cart under the tab we are leaving (multi-cart invariant)
  saveCurrentCartToCarts();

  const saved = state.customerCarts[customerId];
  if (saved) {
    // Returning to a customer who already had a stashed cart → restore it.
    state.cart = (saved.cart || []).map(it => ({ ...it }));
    state.couponCode = saved.couponCode || '';
    state.couponDiscount = saved.couponDiscount || 0;
    state.couponObj = saved.couponObj || null;
    state.paymentMethod = saved.paymentMethod || 'cash';
    state.amountPaid = saved.amountPaid || 0;
    state.splitCash = saved.splitCash || 0;
    state.splitCard = saved.splitCard || 0;
    delete state.customerCarts[customerId];
  } else {
    // NEW customer cart: CARRY OVER the items that were just added instead
    // of wiping them. Previously selecting a customer emptied the cart,
    // forcing the user to re-add every product (main mobile UX complaint).
    const stash = state.customerCarts[previousKey];
    state.cart = ((stash && stash.cart) || []).map(it => ({ ...it }));
    state.couponCode = '';
    state.couponDiscount = 0;
    state.couponObj = null;
    state.paymentMethod = 'cash';
    state.amountPaid = 0;
    state.splitCash = 0;
    state.splitCard = 0;
  }
  // Items MOVED to the new customer tab → the previous tab must NOT keep
  // a duplicate copy of the carried-over items.
  delete state.customerCarts[previousKey];

  state.activeCustomerId = customerId;
  state.selectedCustomerId = customerId;
  state.selectedCustomerName = customerName || '';
  state.loyaltyPoints = loyaltyPoints || 0;
  refreshCart();
  updateCartTabs();
  updateCustomerDisplay(loyaltyPoints);
  saveCart();
}

function switchCartTab(customerId) {
  saveCurrentCartToCarts();
  state.activeCustomerId = customerId || null;
  const key = customerId || 'walkin';
  const saved = state.customerCarts[key];
  if (saved) {
    state.cart = (saved.cart || []).map(it => ({ ...it }));
    state.couponCode = saved.couponCode || '';
    state.couponDiscount = saved.couponDiscount || 0;
    state.couponObj = saved.couponObj || null;
    state.paymentMethod = saved.paymentMethod || 'cash';
    state.amountPaid = saved.amountPaid || 0;
    state.splitCash = saved.splitCash || 0;
    state.splitCard = saved.splitCard || 0;
    state.selectedCustomerId = saved.selectedCustomerId || null;
    state.selectedCustomerName = saved.selectedCustomerName || '';
    state.loyaltyPoints = saved.loyaltyPoints || 0;
    delete state.customerCarts[key];
  } else {
    state.cart = [];
    state.couponCode = '';
    state.couponDiscount = 0;
    state.couponObj = null;
    state.paymentMethod = 'cash';
    state.amountPaid = 0;
    state.splitCash = 0;
    state.splitCard = 0;
    state.selectedCustomerId = null;
    state.selectedCustomerName = '';
    state.loyaltyPoints = 0;
  }
  refreshCart();
  updateCartTabs();
  updateCustomerDisplay();
  saveCart();
}

function closeCartTab(customerId) {
  if (!customerId) return; // walkin tab cannot be closed
  delete state.customerCarts[customerId];
  if (state.activeCustomerId === customerId) {
    state.activeCustomerId = null;
    state.cart = [];
    state.couponCode = '';
    state.couponDiscount = 0;
    state.couponObj = null;
    state.paymentMethod = 'cash';
    state.amountPaid = 0;
    state.splitCash = 0;
    state.splitCard = 0;
    state.selectedCustomerId = null;
    state.selectedCustomerName = '';
    state.loyaltyPoints = 0;
    refreshCart();
    updateCustomerDisplay();
  }
  updateCartTabs();
  saveCart();
}

function updateCustomerDisplay(loyaltyPoints) {
  const nm = document.getElementById('posCustomerName');
  const mt = document.getElementById('posCustomerMeta');
  const lp = (loyaltyPoints !== undefined ? loyaltyPoints : (state.loyaltyPoints || 0));
  if (nm) nm.textContent = state.selectedCustomerName || t('noCustomer', 'Walk-in customer');
  if (mt) mt.textContent = lp > 0 ? (t('loyaltyPoints', 'Loyalty') + ': ' + lp) : '';
  // Sync the mobile customer-first bar (STEP 1)
  const bar = document.getElementById('posCustomerBar');
  if (bar) {
    bar.classList.toggle('is-set', !!state.selectedCustomerId);
    const cbName = document.getElementById('posCbName');
    if (cbName) cbName.textContent = state.selectedCustomerName || t('noCustomer', 'Walk-in customer');
    const cbBtnText = bar.querySelector('.pos-cb-btn span');
    if (cbBtnText) cbBtnText.textContent = state.selectedCustomerId ? t('change', 'Change') : t('selectCustomer', 'Select customer');
  }
  const existing = document.getElementById('posCustomerClear');
  if (state.selectedCustomerId) {
    if (!existing) {
      const row2 = document.querySelector('.pos-customer-row');
      if (row2) {
        const clr = document.createElement('button');
        clr.className = 'pos-customer-clear';
        clr.id = 'posCustomerClear';
        clr.type = 'button';
        clr.setAttribute('aria-label', t('clear', 'Clear'));
        clr.innerHTML = ICON.close;
        clr.addEventListener('click', () => switchCartTab(null));
        row2.appendChild(clr);
      }
    }
  } else {
    if (existing) existing.remove();
  }
}

/* ============================================================
 * Fetch helpers
 * ============================================================ */

async function fetchSettings() {
  try {
    const r = await apiFetch.get('/api/settings');
    if (r && r.success && r.data && r.data.settings) {
      const s = r.data.settings;
      state.settings = {
        storeName: s.storeName || 'DZ POS PRO',
        currency: s.currency || 'DZD',
        taxRate: Number(s.taxRate || 0),
        invoicePrefix: s.invoicePrefix || 'INV-',
        invoiceFooter: s.invoiceFooter || '',
        // FIX: invoiceHeader was missing from this list, so the value saved
        // in Settings was never propagated to the POS receipt/PDF generated
        // right after a sale was completed. Pull it through from the API
        // payload exactly like the other invoice fields below.
        invoiceHeader: s.invoiceHeader || '',
        invoiceCustomText: s.invoiceCustomText || '',
        // Critical: the primary brand color must be passed through to the
        // invoice PDF (otherwise the PDF always renders with the default
        // emerald-500 color even after the user changes it in Settings).
        invoicePrimaryColor: s.invoicePrimaryColor || '#10b981',
        companyInfo: Object.assign({ rc: '', nif: '', nis: '', art: '', address: '', phone: '', whatsapp: '', email: '' }, s.companyInfo || {})
      };
    }
  } catch (e) { console.warn('[sales] fetchSettings', e); }
}

async function fetchCategories() {
  try {
    const r = await apiFetch.get('/api/categories', { limit: 1000 });
    if (r && r.success) {
      // backend wraps in { categories: [...] } via successResponse
      const data = (r.data && r.data.categories) || r.categories || r.data || [];
      state.categories = Array.isArray(data) ? data : [];
    }
  } catch (e) { console.warn('[sales] fetchCategories', e); state.categories = []; }
}

async function fetchProducts(reset) {
  if (state.productsLoading) return;
  state.productsLoading = true;
  if (reset) {
    state.productsPage = 1;
    state.productsExhausted = false;
    state.products = [];
    updateGrid();
  }
  try {
    const qs = { page: state.productsPage, limit: 60, status: 'active' };
    if (state.search) qs.search = state.search;
    if (state.selectedCategory) qs.category = state.selectedCategory;
    const r = await apiFetch.get('/api/products', qs);
    if (r && r.success) {
      const list = r.data || r.products || [];
      state.products = state.products.concat(list);
      state.productsTotal = r.total || state.products.length;
      state.productsTotalPages = r.totalPages || 1;
      if (list.length === 0 || state.productsPage >= state.productsTotalPages) {
        state.productsExhausted = true;
      } else {
        state.productsPage += 1;
      }
    } else {
      state.productsExhausted = true;
    }
  } catch (e) {
    console.error('[sales] fetchProducts', e);
    if (window.Toast) window.Toast.error((e && e.message) || t('networkError', 'Cannot reach the server'));
    state.productsExhausted = true;
  } finally {
    state.productsLoading = false;
    updateGrid();
    updateSentinel();
  }
}

async function fetchCustomers(search) {
  try {
    const qs = { page: 1, limit: 50 };
    if (search) qs.search = search;
    const r = await apiFetch.get('/api/customers', qs);
    if (r && r.success) {
      return r.data || r.customers || [];
    }
  } catch (e) { console.warn('[sales] fetchCustomers', e); }
  return [];
}

async function fetchSession() {
  try {
    const r = await apiFetch.get('/api/sessions/current');
    if (r && r.success && r.data) {
      state.session = r.data.session || null;
      state.sessionStats = r.data.stats || null;
    } else {
      state.session = null; state.sessionStats = null;
    }
  } catch (e) { console.warn('[sales] fetchSession', e); state.session = null; }
}

async function lookupBarcode(code) {
  try {
    const r = await apiFetch.get('/api/products/barcode/' + encodeURIComponent(code));
    if (r && r.success && r.data && r.data.product) {
      addToCart(r.data.product);
      return true;
    }
  } catch (e) {
    const msg = (e && e.message) || '';
    if (/not found|introuvable|غير موجود/i.test(msg)) {
      if (window.Toast) window.Toast.warning(t('productNotFound', 'Product not found') + ': ' + code);
    } else {
      if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
    }
    return false;
  }
  if (window.Toast) window.Toast.warning(t('productNotFound', 'Product not found') + ': ' + code);
  return false;
}

/* ============================================================
 * Camera barcode scanner (uses native BarcodeDetector API when
 * supported; otherwise falls back to a manual entry prompt).
 * ============================================================ */
async function openBarcodeCameraScanner() {
  // 1) Check support for the native BarcodeDetector API (Chrome / Edge on
  //    desktop and Android Chrome). Safari/Firefox do not support it yet.
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    // Fallback: ask the user to either use the manual search field or
    // attach a USB barcode scanner (which works as a keyboard wedge).
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: t('scanBarcode', 'Scan barcode'),
        html: '<div style="font-size:0.9rem;line-height:1.5;text-align:' + (document.documentElement.dir === 'rtl' ? 'right' : 'left') + ';">' +
              escapeHtml(t('cameraNotSupported', 'Your browser does not support camera barcode scanning. Please use a USB barcode scanner (works as a keyboard) or type the barcode in the search field and press Enter.')) +
              '</div>' +
              '<input id="manualBarcodeInput" class="input" type="text" placeholder="' + escapeHtml(t('barcode', 'Barcode')) + '" style="margin-top:0.75rem;" autofocus />',
        confirmButtonText: t('search', 'Search'),
        cancelButtonText: t('cancel', 'Cancel'),
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        preConfirm: () => {
          const v = document.getElementById('manualBarcodeInput').value.trim();
          if (!v) { Swal.showValidationMessage(t('barcodeRequired', 'Barcode is required')); return false; }
          return v;
        }
      }).then((res) => {
        if (res && res.isConfirmed && res.value) {
          lookupBarcode(res.value).then(ok => {
            if (ok) {
              const searchInput = document.getElementById('posSearch');
              if (searchInput) { searchInput.value = ''; state.search = ''; fetchProducts(true); }
            }
          });
        }
      });
    } else {
      const code = window.prompt(t('enterBarcode', 'Enter barcode:'));
      if (code) lookupBarcode(code.trim());
    }
    return;
  }

  // 2) Open the camera modal
  let stream = null;
  let detector = null;
  let rafId = null;
  let stopped = false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    detector = new window.BarcodeDetector({
      formats: formats && formats.length ? formats : ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e']
    });
  } catch (e) {
    if (window.Toast) window.Toast.error(t('cameraInitFailed', 'Camera barcode detector failed to initialize'));
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'posCameraScanModal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="modal" role="document" style="max-width:520px;">
      <div class="modal-header">
        <div class="modal-title">${ICON.scan || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12" stroke-width="3"/></svg>'}<span>${t('scanBarcode', 'Scan barcode')}</span></div>
        <button class="modal-close" type="button" aria-label="${escapeHtml(t('close', 'Close'))}">${ICON.close}</button>
      </div>
      <div class="modal-body" style="padding:1rem;text-align:center;">
        <div style="position:relative;width:100%;max-width:480px;margin:0 auto;background:#000;border-radius:8px;overflow:hidden;aspect-ratio:4/3;">
          <video id="posScanVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
          <div style="position:absolute;inset:8%;border:2px solid #10b981;border-radius:8px;pointer-events:none;box-shadow:0 0 0 9999px rgba(0,0,0,0.4);"></div>
        </div>
        <div style="margin-top:0.75rem;font-size:0.85rem;color:var(--text-muted);">
          ${escapeHtml(t('scanBarcodeHint', 'Align the barcode inside the green box'))}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" data-action="cancel">${t('cancel', 'Cancel')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function close() {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      stream = null;
    }
    overlay.remove();
  }

  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  const video = overlay.querySelector('#posScanVideo');
  try {
    // Prefer the back camera on mobile devices
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = stream;
    await new Promise(r => { video.onloadedmetadata = () => { video.play(); r(); }; });
  } catch (e) {
    if (window.Toast) window.Toast.error(t('cameraAccessDenied', 'Camera access denied or unavailable'));
    close();
    return;
  }

  // 3) Start detecting — runs until a code is found or the modal is closed
  async function tick() {
    if (stopped || !video || video.readyState < 2) {
      if (!stopped) rafId = requestAnimationFrame(tick);
      return;
    }
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length > 0) {
        const code = codes[0].rawValue || '';
        if (code) {
          if (window.Toast) window.Toast.success(t('barcodeFound', 'Barcode found') + ': ' + code);
          close();
          // Look up via the backend (same path as the manual scanner)
          await lookupBarcode(code);
          return;
        }
      }
    } catch (_) { /* ignore — transient detection error */ }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

async function applyCoupon() {
  const code = (document.getElementById('posCouponCode') || {}).value;
  if (!code || !code.trim()) {
    if (window.Toast) window.Toast.warning(t('couponEnterCode', 'Please enter a coupon code'));
    return;
  }
  const tt = computeTotals();
  try {
    const r = await apiFetch.post('/api/coupons/validate', { code: code.trim(), cartTotal: tt.subtotal });
    if (r && r.success && r.data && r.data.valid) {
      state.couponCode = code.trim();
      state.couponDiscount = Number(r.data.discount) || 0;
      state.couponObj = r.data.coupon || { code: code.trim() };
      if (window.Toast) window.Toast.success(t('couponApplied', 'Coupon applied') + ': −' + fmtMoney(state.couponDiscount));
      refreshCartTotalsAndPay();
    } else {
      throw new Error((r && r.message) || t('couponInvalid', 'Invalid coupon'));
    }
  } catch (e) {
    state.couponCode = ''; state.couponDiscount = 0; state.couponObj = null;
    if (window.Toast) window.Toast.error((e && e.message) || t('couponInvalid', 'Invalid coupon'));
    refreshCartTotalsAndPay();
  }
}

function removeCoupon() {
  state.couponCode = ''; state.couponDiscount = 0; state.couponObj = null;
  refreshCartTotalsAndPay();
}

async function openSession() {
  const opening = await (window.Toast && window.Toast.prompt
    ? window.Toast.prompt({
        title: t('sessionOpen', 'Open session'),
        message: t('openingCash', 'Opening cash') + ' (' + (state.settings.currency || 'DZD') + '):',
        defaultValue: '0',
        inputType: 'number',
        placeholder: '0.00'
      })
    : Promise.resolve(window.prompt(t('openingCash', 'Opening cash'), '0')));
  if (opening === null) return;
  const openingCash = parseFloat(opening) || 0;
  try {
    const r = await apiFetch.post('/api/sessions', { openingCash });
    if (r && r.success) {
      if (window.Toast) window.Toast.success(t('sessionOpened', 'Session opened'));
      await fetchSession();
      updateSessionChip();
    } else {
      throw new Error((r && r.message) || 'Failed');
    }
  } catch (e) {
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
  }
}

async function closeSession() {
  const ok = await (window.Toast && window.Toast.confirm
    ? window.Toast.confirm(t('sessionCloseConfirm', 'Close the current session?'))
    : Promise.resolve(window.confirm(t('sessionCloseConfirm', 'Close the current session?'))));
  if (!ok) return;
  if (!state.session || !state.session._id) return;
  const closingCash = await (window.Toast && window.Toast.prompt
    ? window.Toast.prompt({
        title: t('sessionClose', 'Close session'),
        message: t('closingCash', 'Counted cash in drawer') + ' (' + (state.settings.currency || 'DZD') + '):',
        defaultValue: String((state.sessionStats && state.sessionStats.expectedCash) || 0),
        inputType: 'number',
        placeholder: '0.00'
      })
    : Promise.resolve(window.prompt(t('closingCash', 'Counted cash in drawer'), '0')));
  if (closingCash === null) return;
  try {
    const r = await apiFetch.put('/api/sessions/' + state.session._id + '/close', { closingCash: parseFloat(closingCash) || 0 });
    if (r && r.success) {
      if (window.Toast) window.Toast.success(t('sessionClosed', 'Session closed'));
      state.session = null; state.sessionStats = null;
      updateSessionChip();
    } else {
      throw new Error((r && r.message) || 'Failed');
    }
  } catch (e) {
    if (window.Toast) window.Toast.error((e && e.message) || t('error', 'Error'));
  }
}

/* ============================================================
 * Cart operations
 * ============================================================ */

function addToCart(product) {
  if (!product) return;
  const stock = Number(product.stock || 0);
  if (stock <= 0) {
    if (window.Toast) window.Toast.warning(t('outOfStockMsg', 'This product is out of stock'));
    return;
  }
  const existing = state.cart.find(it => it.productId === product._id);
  if (existing) {
    if (existing.quantity >= stock) {
      if (window.Toast) window.Toast.warning(t('insufficientStock', 'Quantity exceeds available stock'));
      return;
    }
    existing.quantity += 1;
  } else {
    state.cart.push({
      productId: product._id,
      name: productName(product),
      price: Number(product.price) || 0,
      quantity: 1,
      maxStock: stock,
      discount: 0,
      timbre: Number(product.timbre) || 0,
      tax: Number(product.tax) || 0,
      barcode: product.barcode || ''
    });
  }
  refreshCart();
}

function changeQty(idx, delta) {
  const it = state.cart[idx];
  if (!it) return;
  const newQty = it.quantity + delta;
  if (newQty < 1) {
    state.cart.splice(idx, 1);
  } else if (newQty > it.maxStock) {
    if (window.Toast) window.Toast.warning(t('insufficientStock', 'Quantity exceeds available stock'));
    return;
  } else {
    it.quantity = newQty;
  }
  refreshCart();
}

function setQty(idx, val) {
  const it = state.cart[idx];
  if (!it) return;
  let v = parseInt(val, 10);
  if (isNaN(v) || v < 1) {
    state.cart.splice(idx, 1);
  } else {
    if (v > it.maxStock) {
      if (window.Toast) window.Toast.warning(t('insufficientStock', 'Quantity exceeds available stock'));
      v = it.maxStock;
    }
    it.quantity = v;
  }
  refreshCart();
}

function setItemDiscount(idx, val) {
  const it = state.cart[idx];
  if (!it) return;
  let v = parseFloat(val);
  if (isNaN(v) || v < 0) v = 0;
  const lineMax = it.price * it.quantity;
  if (v > lineMax) v = lineMax;
  it.discount = v;
  refreshCart();
}

function removeItem(idx) {
  state.cart.splice(idx, 1);
  refreshCart();
}

function clearCart() {
  state.cart = [];
  state.selectedCustomerId = null;
  state.selectedCustomerName = '';
  state.couponCode = ''; state.couponDiscount = 0; state.couponObj = null;
  state.amountPaid = 0; state.splitCash = 0; state.splitCard = 0;
  state.paymentMethod = 'cash';
  state.activeCustomerId = null;
  state.loyaltyPoints = 0;
  refreshCart();
  updateCartTabs();
  updateCustomerDisplay();
}

/* ============================================================
 * Refresh / patch DOM
 * ============================================================ */

function updateGrid() {
  const grid = document.getElementById('posGrid');
  if (grid) grid.innerHTML = renderProductsGridInner();
}

function updateSentinel() {
  const s = document.getElementById('posSentinel');
  if (!s) return;
  if (state.productsExhausted) {
    s.textContent = state.products.length ? t('endOfList', 'End of list') : '';
  } else if (state.productsLoading) {
    s.innerHTML = '<div class="spinner sm" style="display:inline-block;vertical-align:middle;"></div> <span style="margin-inline-start:0.4rem;">' + t('loading', 'Loading...') + '</span>';
  } else {
    s.textContent = '';
  }
}

function refreshCart() {
  const items = document.getElementById('posCartItems');
  if (items) items.innerHTML = renderCartInner();
  const totalQty = state.cart.reduce((s, it) => s + it.quantity, 0);
  const count = document.getElementById('posCartCount');
  if (count) count.textContent = String(totalQty);
  const fabBadge = document.getElementById('posFabBadge');
  if (fabBadge) fabBadge.textContent = String(totalQty);
  // Pulse the mobile FAB while the cart has items (draws attention)
  const fab = document.getElementById('posCartFab');
  if (fab) fab.classList.toggle('has-items', totalQty > 0);
  // Keep the mobile sticky Cart bar in sync (items + total + pulse)
  const sumItems = document.getElementById('posSumItems');
  const sumTotal = document.getElementById('posSumTotal');
  const sumBar = document.getElementById('posMobileSummary');
  if (sumItems && sumTotal && sumBar) {
    const st = computeTotals();
    sumItems.textContent = totalQty + ' × ' + t('cartTotal', 'Cart total');
    sumTotal.textContent = fmtMoney(st.total);
    sumBar.classList.toggle('has-items', totalQty > 0);
  }
  refreshCartTotalsAndPay();
  saveCart();
}

function refreshCartTotalsAndPay() {
  const totals = document.getElementById('posTotals');
  if (totals) totals.innerHTML = renderTotalsInner();
  // re-render coupon area + payment extras (in case discount changed)
  // Replace ONLY the coupon element itself, not its parent (which would
  // destroy the cart items, totals, and payment buttons).
  const couponArea = document.querySelector('.pos-coupon-row, .pos-coupon-chip, .pos-coupon-toggle');
  if (couponArea) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderCouponArea();
    const newEl = tmp.firstElementChild;
    if (newEl && couponArea.parentNode) {
      couponArea.parentNode.replaceChild(newEl, couponArea);
    }
  }
  const payExtra = document.getElementById('posPayExtra');
  if (payExtra) payExtra.innerHTML = renderPayExtra();
  bindCartAndPaymentEvents();
}

function updateSessionChip() {
  const chip = document.getElementById('posSessionChip');
  const toggle = document.getElementById('posSessionToggle');
  if (chip) {
    chip.classList.remove('open', 'closed');
    chip.classList.add(state.session ? 'open' : 'closed');
    chip.innerHTML = (state.session ? ICON.check : ICON.power) +
      '<span>' + escapeHtml(state.session ? (state.session.userName || t('sessionStatusOpen', 'Open')) : t('sessionStatusClosed', 'Closed')) + '</span>';
  }
  if (toggle) {
    toggle.innerHTML = ICON.power + '<span>' + (state.session ? t('sessionClose', 'Close session') : t('sessionOpen', 'Open session')) + '</span>';
  }
}

/* ============================================================
 * Event binding
 * ============================================================ */

let listeners = [];
function addListener(target, type, fn, opts) {
  if (!target) return;
  target.addEventListener(type, fn, opts);
  listeners.push({ target, type, fn, opts });
}
function cleanupListeners() {
  listeners.forEach(({ target, type, fn, opts }) => {
    try { target.removeEventListener(type, fn, opts); } catch (_) {}
  });
  listeners = [];
}

function bindEvents() {
  // Search input (debounced + Enter handling)
  const search = document.getElementById('posSearch');
  if (search) {
    const onInput = debounce(() => {
      state.search = search.value.trim();
      fetchProducts(true);
    }, 350);
    addListener(search, 'input', onInput);
    addListener(search, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = search.value.trim();
        if (!q) return;
        // 1) Exact barcode match in currently loaded products → add instantly
        if (isBarcodeLike(q)) {
          const match = state.products.find(p => p.barcode && p.barcode === q);
          if (match) {
            addToCart(match);
            search.value = '';
            state.search = '';
            fetchProducts(true);
            return;
          }
          // 2) Backend barcode lookup (covers products not yet loaded).
          //    Runs FIRST for barcode-like strings so a scanner typing into
          //    the field always lands the product in the cart — a plain
          //    text search is only the last resort.
          lookupBarcode(q).then(ok => {
            if (ok) { search.value = ''; state.search = ''; fetchProducts(true); }
            else { // 3) not a barcode either → plain text search
              state.search = q; fetchProducts(true);
            }
          });
          return;
        }
        state.search = q;
        fetchProducts(true);
      }
      if (e.key === 'Escape') {
        search.value = '';
        state.search = '';
        fetchProducts(true);
      }
    });
  }

  // Camera barcode scan button (uses native BarcodeDetector when available;
  // falls back to a prompt for manual entry if not supported / no camera).
  const scanBtn = document.getElementById('posScanBtn');
  if (scanBtn) {
    addListener(scanBtn, 'click', openBarcodeCameraScanner);
  }

  // Category chips (event delegation)
  const chips = document.getElementById('posCatChips');
  if (chips) {
    addListener(chips, 'click', (e) => {
      const btn = e.target.closest('.pos-cat-chip');
      if (!btn) return;
      state.selectedCategory = btn.dataset.cat || '';
      // update active class
      chips.querySelectorAll('.pos-cat-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      fetchProducts(true);
    });
  }

  // Products grid (event delegation)
  const grid = document.getElementById('posGrid');
  if (grid) {
    addListener(grid, 'click', (e) => {
      const card = e.target.closest('.pos-product');
      if (!card || card.disabled) return;
      const id = card.dataset.id;
      const p = state.products.find(x => x._id === id);
      if (p) addToCart(p);
    });
  }

  // Infinite scroll via IntersectionObserver on sentinel
  const sentinel = document.getElementById('posSentinel');
  if (sentinel && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        // Hard cap to prevent page overload with very large product catalogs
        if (state.products.length >= 500) { state.productsExhausted = true; return; }
        if (state.productsLoading || state.productsExhausted) return;
        fetchProducts(false);
      });
    }, { root: null, rootMargin: '200px', threshold: 0 });
    io.observe(sentinel);
    listeners.push({ target: io, type: '__io', fn: null, opts: null });
  }

  // Cart items (event delegation)
  bindCartAndPaymentEvents();

  // Customer button
  const custBtn = document.getElementById('posCustomerBtn');
  if (custBtn) addListener(custBtn, 'click', () => openCustomerModal());
  const custClear = document.getElementById('posCustomerClear');
  if (custClear) addListener(custClear, 'click', () => {
    switchCartTab(null);
    if (window.Toast) window.Toast.info(t('customerCleared', 'Customer cleared'));
  });

  // Mobile customer-first bar (STEP 1)
  const cbBtn = document.getElementById('posCbBtn');
  if (cbBtn) addListener(cbBtn, 'click', () => openCustomerModal());

  // Cart tabs (multi-customer) — event delegation
  const tabsEl = document.getElementById('posCartTabs');
  if (tabsEl && !tabsEl.dataset.bound) {
    tabsEl.dataset.bound = '1';
    addListener(tabsEl, 'click', (e) => {
      const closeBtn = e.target.closest('.pos-cart-tab-close');
      if (closeBtn) {
        e.stopPropagation();
        const cid = closeBtn.dataset.close;
        closeCartTab(cid);
        return;
      }
      const tab = e.target.closest('.pos-cart-tab');
      if (!tab) return;
      const cust = tab.dataset.cust;
      if (cust === 'walkin') switchCartTab(null);
      else switchCartTab(cust);
    });
  }

  // Session toggle
  const sessBtn = document.getElementById('posSessionToggle');
  if (sessBtn) addListener(sessBtn, 'click', () => {
    if (state.session) closeSession();
    else openSession();
  });

  // Refresh
  const refreshBtn = document.getElementById('posRefreshBtn');
  if (refreshBtn) addListener(refreshBtn, 'click', () => {
    fetchProducts(true);
    fetchSession().then(updateSessionChip);
  });

  // Clear cart
  const clearBtn = document.getElementById('posClearCartBtn');
  if (clearBtn) addListener(clearBtn, 'click', async () => {
    if (state.cart.length === 0) return;
    const ok = await (window.Toast && window.Toast.confirm
      ? window.Toast.confirm(t('clearCartConfirm', 'Clear the cart?'))
      : Promise.resolve(window.confirm(t('clearCartConfirm', 'Clear the cart?'))));
    if (ok) clearCart();
  });

  // Complete sale
  const completeBtn = document.getElementById('posCompleteBtn');
  if (completeBtn) addListener(completeBtn, 'click', () => completeSale());

  // Mobile cart drawer: FAB open, backdrop + close button
  const cartFab = document.getElementById('posCartFab');
  const cartBackdrop = document.getElementById('posCartBackdrop');
  const cartPanel = document.getElementById('posRightPanel');
  const cartCloseMobile = document.getElementById('posCartCloseMobile');
  function openMobileCart() {
    if (cartPanel) cartPanel.classList.add('open');
    if (cartBackdrop) cartBackdrop.classList.add('show');
  }
  function closeMobileCart() {
    if (cartPanel) cartPanel.classList.remove('open');
    if (cartBackdrop) cartBackdrop.classList.remove('show');
  }
  if (cartFab) addListener(cartFab, 'click', openMobileCart);
  const mobileSummary = document.getElementById('posMobileSummary');
  if (mobileSummary) addListener(mobileSummary, 'click', openMobileCart);
  if (cartBackdrop) addListener(cartBackdrop, 'click', closeMobileCart);
  if (cartCloseMobile) addListener(cartCloseMobile, 'click', closeMobileCart);

  // Barcode scanner (global keydown)
  addListener(document, 'keydown', onScanKeydown);

  // Keyboard shortcuts: F2 = focus search, Esc = clear search / close topmost modal
  addListener(document, 'keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      const s = document.getElementById('posSearch');
      if (s) { s.focus(); s.select(); }
    }
  });
}

function bindCartAndPaymentEvents() {
  // Cart items delegation
  const items = document.getElementById('posCartItems');
  if (items) {
    // remove old listener by cloning? We already clean up via cleanupListeners on page exit.
    // For intra-page refreshes we rely on event delegation, so a single listener is enough —
    // but this function may be called repeatedly. Guard against double-binding.
    if (!items.dataset.bound) {
      items.dataset.bound = '1';
      addListener(items, 'click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const row = e.target.closest('.pos-cart-item');
        if (!row) return;
        const idx = parseInt(row.dataset.idx, 10);
        if (isNaN(idx)) return;
        const action = btn.dataset.action;
        if (action === 'inc') changeQty(idx, +1);
        else if (action === 'dec') changeQty(idx, -1);
        else if (action === 'remove') removeItem(idx);
      });
      addListener(items, 'input', (e) => {
        const inp = e.target.closest('input[data-action]');
        if (!inp) return;
        const row = e.target.closest('.pos-cart-item');
        if (!row) return;
        const idx = parseInt(row.dataset.idx, 10);
        if (isNaN(idx)) return;
        const action = inp.dataset.action;
        // Only update STATE here — never re-render the cart while the user
        // is typing, otherwise the input value is reset to whatever the state
        // was and only one digit can be typed at a time. Re-render is deferred
        // to the `change` event (fires on blur / Enter).
        if (action === 'qty') {
          const it = state.cart[idx];
          if (!it) return;
          let v = parseInt(inp.value, 10);
          if (!isNaN(v) && v >= 1) {
            if (v > it.maxStock) v = it.maxStock;
            it.quantity = v;
            // Update totals only (not the items list)
            refreshCartTotalsAndPay();
            // Update the inline per-item price display
            const priceEl = row.querySelector('.pos-cart-item-price');
            if (priceEl) priceEl.textContent = fmtMoney(it.price) + ' × ' + v;
            const totalEl = row.querySelector('.pos-cart-item-total');
            if (totalEl) totalEl.textContent = fmtMoney(it.price * v - (Number(it.discount) || 0));
          }
        } else if (action === 'disc') {
          const it = state.cart[idx];
          if (!it) return;
          let v = parseFloat(inp.value);
          if (isNaN(v) || v < 0) v = 0;
          const lineMax = it.price * it.quantity;
          if (v > lineMax) v = lineMax;
          it.discount = v;
          refreshCartTotalsAndPay();
          const totalEl = row.querySelector('.pos-cart-item-total');
          if (totalEl) totalEl.textContent = fmtMoney(it.price * it.quantity - v);
        }
      });
      addListener(items, 'change', (e) => {
        const inp = e.target.closest('input[data-action]');
        if (!inp) return;
        const row = e.target.closest('.pos-cart-item');
        if (!row) return;
        const idx = parseInt(row.dataset.idx, 10);
        if (isNaN(idx)) return;
        const action = inp.dataset.action;
        if (action === 'qty') {
          const it = state.cart[idx];
          if (!it) return;
          let v = parseInt(inp.value, 10);
          if (isNaN(v) || v < 1) {
            state.cart.splice(idx, 1);
            refreshCart();
            return;
          }
          if (v > it.maxStock) {
            if (window.Toast) window.Toast.warning(t('insufficientStock', 'Quantity exceeds available stock'));
            v = it.maxStock;
            inp.value = v;
          }
          it.quantity = v;
          refreshCart();
        } else if (action === 'disc') {
          const it = state.cart[idx];
          if (!it) return;
          let v = parseFloat(inp.value);
          if (isNaN(v) || v < 0) v = 0;
          const lineMax = it.price * it.quantity;
          if (v > lineMax) v = lineMax;
          it.discount = v;
          inp.value = v;
          refreshCart();
        }
      });
    }
  }

  // Payment method buttons
  const payMethods = document.getElementById('posPayMethods');
  if (payMethods && !payMethods.dataset.bound) {
    payMethods.dataset.bound = '1';
    addListener(payMethods, 'click', (e) => {
      const btn = e.target.closest('.pos-pay-method');
      if (!btn) return;
      state.paymentMethod = btn.dataset.method || 'cash';
      payMethods.querySelectorAll('.pos-pay-method').forEach(b => b.classList.toggle('active', b === btn));
      const payExtra = document.getElementById('posPayExtra');
      if (payExtra) payExtra.innerHTML = renderPayExtra();
      bindPayExtraEvents();
    });
  }

  bindPayExtraEvents();

  // Coupon
  const couponApply = document.getElementById('posCouponApply');
  if (couponApply && !couponApply.dataset.bound) {
    couponApply.dataset.bound = '1';
    addListener(couponApply, 'click', () => applyCoupon());
  }
  const couponInput = document.getElementById('posCouponCode');
  if (couponInput && !couponInput.dataset.bound) {
    couponInput.dataset.bound = '1';
    addListener(couponInput, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); }
    });
  }
  const couponRemove = document.getElementById('posCouponRemove');
  if (couponRemove && !couponRemove.dataset.bound) {
    couponRemove.dataset.bound = '1';
    addListener(couponRemove, 'click', () => removeCoupon());
  }
  // Coupon toggle (show input) + cancel (hide input)
  const couponToggle = document.getElementById('posCouponToggle');
  if (couponToggle && !couponToggle.dataset.bound) {
    couponToggle.dataset.bound = '1';
    addListener(couponToggle, 'click', () => {
      state.couponExpanded = true;
      refreshCartTotalsAndPay();
      const inp = document.getElementById('posCouponCode');
      if (inp) inp.focus();
    });
  }
  const couponCancel = document.getElementById('posCouponCancel');
  if (couponCancel && !couponCancel.dataset.bound) {
    couponCancel.dataset.bound = '1';
    addListener(couponCancel, 'click', () => {
      state.couponExpanded = false;
      state.couponCode = '';
      refreshCartTotalsAndPay();
    });
  }
}

function bindPayExtraEvents() {
  // Quick-cash buttons
  const qc = document.getElementById('posQuickCash');
  if (qc && !qc.dataset.bound) {
    qc.dataset.bound = '1';
    addListener(qc, 'click', (e) => {
      const btn = e.target.closest('.pos-quickcash-btn');
      if (!btn) return;
      const v = btn.dataset.quick;
      const tt = computeTotals();
      if (v === 'exact') {
        state.amountPaid = tt.total;
      } else {
        state.amountPaid = (state.amountPaid || 0) + parseFloat(v);
      }
      const inp = document.getElementById('posAmountPaid');
      if (inp) inp.value = state.amountPaid;
      const change = Math.max(0, state.amountPaid - tt.total);
      const ch = document.getElementById('posChange');
      if (ch) ch.textContent = change > 0 ? t('changeDue', 'Change due') + ': ' + fmtMoney(change) : '';
    });
  }
  const paid = document.getElementById('posAmountPaid');
  if (paid && !paid.dataset.bound) {
    paid.dataset.bound = '1';
    addListener(paid, 'input', () => {
      state.amountPaid = parseFloat(paid.value) || 0;
      const tt = computeTotals();
      const change = Math.max(0, state.amountPaid - tt.total);
      const ch = document.getElementById('posChange');
      if (ch) ch.textContent = change > 0 ? t('changeDue', 'Change due') + ': ' + fmtMoney(change) : '';
    });
  }
  // Split inputs
  const splitCash = document.getElementById('posSplitCash');
  if (splitCash && !splitCash.dataset.bound) {
    splitCash.dataset.bound = '1';
    addListener(splitCash, 'input', () => {
      state.splitCash = parseFloat(splitCash.value) || 0;
      refreshCartTotalsAndPay();
    });
  }
  const splitCard = document.getElementById('posSplitCard');
  if (splitCard && !splitCard.dataset.bound) {
    splitCard.dataset.bound = '1';
    addListener(splitCard, 'input', () => {
      state.splitCard = parseFloat(splitCard.value) || 0;
      refreshCartTotalsAndPay();
    });
  }
}

/* ============================================================
 * Barcode scanner detection (USB / keyboard-wedge scanners)
 * ------------------------------------------------------------
 * A hardware scanner "types" the code very fast and consistently
 * (inter-key gaps typically < 50ms) and finishes with Enter.
 * We therefore measure the intervals between consecutive keys and
 * treat the input as a scan only when they are uniform and fast —
 * this avoids misfiring on a fast human typist typing a numeric
 * search query. Alphanumeric barcodes (Code39 etc.) are accepted.
 * ============================================================ */

let scanBuffer = '';
let scanTimes = [];       // timestamps of buffered keys

function scanReset() {
  scanBuffer = '';
  scanTimes = [];
}

/* Thresholds are intentionally GENEROUS:
 * programmable scanners ship with inter-character delays of 0–120ms and
 * some models (or Bluetooth wedges) pause up to ~300ms between chars.
 * The old limits (avg ≤ 60ms, maxGap ≤ 160ms) silently rejected those
 * devices, which is why USB scanners "did not work" on desktop while the
 * camera scanner worked on mobile. A fast human typist still averages
 * 150–250ms per key with irregular rhythm, so these limits stay safe. */
function scanLooksLikeScanner() {
  if (scanBuffer.length < 3 || scanTimes.length < 3) return false;
  const intervals = [];
  for (let i = 1; i < scanTimes.length; i++) intervals.push(scanTimes[i] - scanTimes[i - 1]);
  const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const maxGap = Math.max.apply(null, intervals);
  // Scanner: fast average AND no long pause between characters.
  return avg <= 150 && maxGap <= 400;
}

function onScanKeydown(e) {
  // Allow Ctrl/Cmd combos to pass through (Ctrl+P, etc.)
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const now = Date.now();

  // Idle timeout: human typing has natural pauses — reset the buffer.
  const lastTime = scanTimes.length ? scanTimes[scanTimes.length - 1] : 0;
  if (scanBuffer && now - lastTime > 600) scanReset();

  if (e.key === 'Enter') {
    const code = scanBuffer;
    const isScan = scanLooksLikeScanner();
    scanReset();
    if (isScan && code.length >= 3) {
      e.preventDefault();
      e.stopPropagation();
      const searchInput = document.getElementById('posSearch');
      if (searchInput) {
        // Scanner input may also have landed in the focused search field.
        searchInput.value = '';
        searchInput.blur();
      }
      if (state.search) { state.search = ''; fetchProducts(true); }
      lookupBarcode(code);
    }
    return;
  }

  if (e.key && e.key.length === 1) {
    scanBuffer += e.key;
    scanTimes.push(now);
    if (scanBuffer.length > 64) scanReset();
  }
}

/* ============================================================
 * Customer modal
 * ============================================================ */

function openCustomerModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'posCustomerModal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'posCustomerModalTitle');
  overlay.innerHTML = `
    <div class="modal" role="document">
      <div class="modal-header">
        <div class="modal-title" id="posCustomerModalTitle">${ICON.user}<span>${t('selectCustomer', 'Select customer')}</span></div>
        <button class="modal-close" type="button" aria-label="${escapeHtml(t('close', 'Close'))}">${ICON.close}</button>
      </div>
      <div class="modal-body" style="padding:1rem;">
        <div class="search-box" style="width:100%;max-width:none;margin-bottom:0.75rem;">
          <span class="search-icon" aria-hidden="true">${ICON.search}</span>
          <input class="input" id="posCustomerSearch" type="search" placeholder="${escapeHtml(t('searchCustomers', 'Search customers...'))}" autocomplete="off" />
        </div>
        <div id="posCustomerList" style="max-height:50vh;overflow-y:auto;border:1px solid var(--border-color);border-radius:var(--radius-sm);">
          <div class="loading-state" style="padding:1.5rem;"><div class="spinner"></div><span style="margin-inline-start:0.5rem;">${t('loading', 'Loading...')}</span></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" data-action="walkin">${t('noCustomer', 'Walk-in customer')}</button>
        <button class="btn btn-secondary" type="button" data-action="close">${t('close', 'Close')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="close"]').addEventListener('click', close);
  overlay.querySelector('[data-action="walkin"]').addEventListener('click', () => {
    switchCartTab(null);
    if (window.Toast) window.Toast.info(t('customerCleared', 'Customer cleared'));
    close();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const searchInput = overlay.querySelector('#posCustomerSearch');
  const listEl = overlay.querySelector('#posCustomerList');

  async function renderList(query) {
    listEl.innerHTML = '<div class="loading-state" style="padding:1.5rem;"><div class="spinner"></div><span style="margin-inline-start:0.5rem;">' + t('loading', 'Loading...') + '</span></div>';
    const list = await fetchCustomers(query);
    if (!list.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">' + ICON.user + '</div><div class="empty-title">' + t('noCustomers', 'No customers found') + '</div><div class="empty-subtitle">' + t('noCustomersFound', 'Try a different search') + '</div></div>';
      return;
    }
    listEl.innerHTML = list.map(c => {
      const name = resolveCustomerName(c, '—');
      const meta = [c.phone, c.email].filter(Boolean).join(' • ');
      const loyalty = (c.loyaltyPoints || 0) > 0 ? ' • ' + t('loyaltyPoints', 'Loyalty') + ': ' + c.loyaltyPoints : '';
      return `
        <div class="pos-cust-row" data-id="${escapeHtml(c._id)}" data-name="${escapeHtml(name)}" data-loyalty="${escapeHtml(String(c.loyaltyPoints || 0))}" style="padding:0.7rem 0.85rem;border-bottom:1px solid var(--border-color);cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:0.6rem;">
          <div style="min-width:0;">
            <div style="font-weight:600;color:var(--text-primary);font-size:0.88rem;">${escapeHtml(name)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(meta)}${escapeHtml(loyalty)}</div>
          </div>
          ${ICON.check}
        </div>`;
    }).join('');
    listEl.querySelectorAll('.pos-cust-row').forEach(row => {
      row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-hover)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', () => {
        const cid = row.dataset.id;
        const c = list.find(x => x._id === cid);
        const cname = c ? resolveCustomerName(c, '') : (row.dataset.name || '');
        const lp = parseInt(row.dataset.loyalty, 10) || 0;
        switchCartToCustomer(cid, cname, lp);
        if (window.Toast) window.Toast.success(t('customerSelected', 'Customer selected') + ': ' + cname);
        close();
      });
    });
  }

  const debouncedRender = debounce(renderList, 300);
  searchInput.addEventListener('input', () => debouncedRender(searchInput.value.trim()));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); renderList(searchInput.value.trim()); }
  });
  // Esc closes topmost modal
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  setTimeout(() => searchInput.focus(), 50);
  renderList('');
}

/* ============================================================
 * Complete sale
 * ============================================================ */

async function completeSale() {
  if (state.cart.length === 0) {
    if (window.Toast) window.Toast.warning(t('cartEmpty', 'Cart is empty'));
    return;
  }
  // Verify session is open
  if (!state.session || !state.session._id) {
    const ok = await (window.Toast && window.Toast.confirm
      ? window.Toast.confirm(t('sessionRequired', 'A session is required to complete a sale. Open one now?'))
      : Promise.resolve(window.confirm(t('sessionRequired', 'A session is required. Open one now?'))));
    if (ok) {
      await openSession();
      if (state.session) return completeSale();
    }
    return;
  }

  const tt = computeTotals();

  // Validate split payment sums to total
  if (state.paymentMethod === 'split') {
    const sum = (state.splitCash || 0) + (state.splitCard || 0);
    if (Math.abs(sum - tt.total) > 0.01) {
      if (window.Toast) window.Toast.error(t('splitMismatch', 'Cash + Card must equal the total'));
      return;
    }
  }

  // Validate cash payment is sufficient
  if (state.paymentMethod === 'cash') {
    if ((state.amountPaid || 0) < tt.total) {
      const diff = tt.total - (state.amountPaid || 0);
      if (window.Toast) window.Toast.error(
        t('insufficientPayment', 'Montant payé insuffisant') + ' — ' + t('remaining', 'Remaining') + ': ' + fmtMoney(diff)
      );
      return;
    }
  }

  // Choose the invoice print language (FR / EN) right before completing
  // the sale. jsPDF core fonts cannot render Arabic, so the printed
  // invoice is offered in French or English WITHOUT changing the page
  // language. The choice is remembered for next time.
  let invoiceLang = null;
  if (typeof window.chooseInvoiceLanguage === 'function') {
    invoiceLang = await window.chooseInvoiceLanguage();
    if (invoiceLang === null) return; // user cancelled the popup
  }
  state.invoiceLang = invoiceLang || window.getStoredInvoiceLang() || 'fr';

  const items = state.cart.map(it => ({
    product: it.productId,
    quantity: it.quantity,
    price: it.price,
    discount: Number(it.discount) || 0
  }));

  const body = {
    customer: state.selectedCustomerId || null,
    session: state.session._id,
    items,
    paymentMethod: state.paymentMethod,
    discount: 0, // per-item discounts are sent per line; coupon handled by couponCode
    // tax is NOT sent from the frontend — the backend computes it from settings.taxRate
    couponCode: state.couponCode || undefined,
    notes: '',
    splitPayment: state.paymentMethod === 'split'
      ? { cash: state.splitCash || 0, card: state.splitCard || 0, transfer: 0 }
      : undefined
  };

  const btn = document.getElementById('posCompleteBtn');
  const oldHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner sm" style="display:inline-block;vertical-align:middle;"></div> <span style="margin-inline-start:0.4rem;">' + t('loading', 'Loading...') + '</span>'; }

  try {
    const r = await apiFetch.post('/api/sales', body);
    if (r && r.success && r.data && r.data.sale) {
      const sale = r.data.sale;
      state.lastSale = sale;
      if (window.Toast) window.Toast.success(t('saleCompleted', 'Sale completed') + ': ' + (sale.saleNumber || ''));
      // Show change due for cash payment
      if (state.paymentMethod === 'cash') {
        const change = (state.amountPaid || 0) - tt.total;
        if (change > 0 && window.Toast) window.Toast.success(t('changeDue', 'Change due') + ': ' + fmtMoney(change));
      }
      // Broadcast sale-completion so other pages (dashboard, reports) can live-refresh
      try { window.dispatchEvent(new CustomEvent('sale:completed', { detail: { saleId: sale._id, total: sale.total } })); } catch (_) {}
      // Open receipt preview
      openReceiptModal(sale);
      // Clear cart (but keep session + other customers' stashed carts)
      state.cart = [];
      state.selectedCustomerId = null;
      state.selectedCustomerName = '';
      state.couponCode = ''; state.couponDiscount = 0; state.couponObj = null;
      state.amountPaid = 0; state.splitCash = 0; state.splitCard = 0;
      state.paymentMethod = 'cash';
      state.activeCustomerId = null;
      state.loyaltyPoints = 0;
      refreshCart();
      updateCartTabs();
      updateCustomerDisplay();
      // Refresh products (stock has changed)
      fetchProducts(true);
      // Persist the cleared state (preserves customerCarts for other tabs)
      saveCart();
    } else {
      throw new Error((r && r.message) || t('saleFailed', 'Failed to complete sale'));
    }
  } catch (e) {
    if (window.Toast) window.Toast.error((e && e.message) || t('saleFailed', 'Failed to complete sale'));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
  }
}

/* ============================================================
 * Receipt modal + Print + PDF
 * ============================================================ */

function openReceiptModal(sale) {
  const pageLang = (typeof window.currentLang !== 'undefined' && window.currentLang) || (localStorage.getItem('lang') || 'ar');
  // Invoice language chosen in the pre-sale popup (FR/EN) — falls back to
  // the stored preference. The PAGE language stays untouched.
  const invLang = state.invoiceLang || (window.getStoredInvoiceLang ? window.getStoredInvoiceLang() : 'fr');
  const IL = (window.invoiceLabels ? window.invoiceLabels(invLang) : { invoice: 'FACTURE', invoiceNumber: 'N° Facture', date: 'Date', customer: 'Client', walkin: 'Particulier', payment: 'Paiement', cash: 'Espèces', card: 'Carte', transfer: 'Virement', split: 'Mixte', product: 'Produit', unit: 'Unité', qty: 'Qté', unitPriceHT: 'P.Unitaire H.T', amountHT: 'Montant H.T', totalHT: 'Total H.T', itemDiscounts: 'Remises articles', cartDiscount: 'Remise', coupon: 'Coupon', vat: 'TVA', stamp: 'Timbre', totalTTC: 'TOTAL T.T.C', wordsIntro: 'Arrêté la présente facture à la somme de :', thanks: 'Merci de votre confiance' });
  const store = state.settings;
  const headerText = store.invoiceHeader && store.invoiceHeader.trim() ? `
    <div style="font-size:13px;color:var(--text-secondary);text-align:center;margin:4px 0 8px 0;padding:4px 0;border-bottom:1px dashed var(--border-color);line-height:1.5;">
        ${escapeHtml(store.invoiceHeader)}
    </div>
` : '';
  const company = store.companyInfo || {};
  const taxRate = Number(store.taxRate || 0);
  const saleDate = fmtDate(sale.saleDate || sale.createdAt || new Date(), pageLang);
  const rawCustomer = resolveCustomerName(sale.customer, state.selectedCustomerName || '');
  const customerName = rawCustomer && rawCustomer !== t('noCustomer', 'Walk-in customer') && rawCustomer !== 'Walk-in customer'
    ? rawCustomer : IL.walkin;
  const items = (sale.items || []).map(it => {
    const name = it.productName || (it.product && (productName(it.product) || it.product.name)) || it.name || '—';
    const qty = Number(it.quantity) || 0;
    const price = Number(it.price) || 0;
    const discount = Number(it.discount) || 0;
    const total = Number(it.total) || Math.max(0, qty * price - discount);
    const unit = it.productUnit || (it.product && it.product.unit) || it.unit || 'pcs';
    return { name, qty, price, discount, total, unit };
  });
  const subtotal = Number(sale.subtotal) || 0;
  const cartDiscount = Number(sale.discount) || 0;
  const couponDiscount = Number(sale.couponDiscount) || 0;
  const itemDiscounts = items.reduce((s, it) => s + (Number(it.discount) || 0), 0);
  const tax = Number(sale.tax) || 0;
  const timbre = Number(sale.timbre) || 0;
  const total = Number(sale.total) || 0;
  const totalWords = invLang === 'en' ? '' : num2frenchwords(total);
  const currency = store.currency || 'DZD';
  const payMethod = sale.paymentMethod || 'cash';
  const payLabel = IL[paymentLabel(payMethod)] ? IL[paymentLabel(payMethod)] : paymentLabel(payMethod);
  const invoiceNo = sale.saleNumber || '';
  const customText = (store.invoiceCustomText || '').trim();

  const html = `
    <div class="modal-overlay" id="posReceiptModal" role="dialog" aria-modal="true" aria-labelledby="posReceiptTitle">
      <div class="modal modal-lg" role="document" style="max-width:780px;">
        <div class="modal-header">
          <div class="modal-title" id="posReceiptTitle">${ICON.check}<span>${t('saleCompleted', 'Sale completed')}</span></div>
          <button class="modal-close" type="button" aria-label="${escapeHtml(t('close', 'Close'))}">${ICON.close}</button>
        </div>
        <div class="modal-body" style="padding:1rem;background:var(--bg-body);">
          <div id="receiptPrintArea">
            <div class="receipt-sheet">
              <div class="receipt-head" style="text-align:center;">
                <div class="receipt-store" style="font-size:1.6rem;font-weight:800;color:${(store.invoicePrimaryColor || '#10b981')};">${escapeHtml(store.storeName || 'DZ POS PRO')}</div>
                <div class="receipt-contact" style="margin-top:0.3rem;font-size:0.8rem;color:var(--text-secondary);line-height:1.6;">
                  ${company.address ? `<div>${escapeHtml(company.address)}</div>` : ''}
                  ${company.phone ? `<div>Tel: ${escapeHtml(company.phone)}</div>` : ''}
                  ${company.whatsapp ? `<div>WhatsApp: ${escapeHtml(company.whatsapp)}</div>` : ''}
                  ${company.email ? `<div>${escapeHtml(company.email)}</div>` : ''}
                </div>
                ${(company.rc || company.nif || company.nis || company.art) ? `
                  <div class="receipt-fiscal" style="margin-top:0.4rem;font-size:0.72rem;font-weight:600;color:var(--text-secondary);">
                    ${company.rc ? `<div>RC: ${escapeHtml(company.rc)}</div>` : ''}
                    ${company.nif ? `<div>NIF: ${escapeHtml(company.nif)}</div>` : ''}
                    ${company.nis ? `<div>NIS: ${escapeHtml(company.nis)}</div>` : ''}
                    ${company.art ? `<div>ART: ${escapeHtml(company.art)}</div>` : ''}
                  </div>` : ''}
              </div>
              <hr style="border:none;border-top:2px solid ${(store.invoicePrimaryColor || '#10b981')};margin:0.6rem 0;" />
              <div class="receipt-meta">
                <div><strong>${escapeHtml(IL.invoice)}</strong></div>
                <div><strong>${escapeHtml(IL.invoiceNumber)}:</strong> ${escapeHtml(invoiceNo)}</div>
                <div><strong>${escapeHtml(IL.date)}:</strong> ${escapeHtml(saleDate)}</div>
              </div>
              <div class="receipt-meta">
                <div><strong>${escapeHtml(IL.customer)}:</strong> ${escapeHtml(customerName)}</div>
                <div><strong>${escapeHtml(IL.payment)}:</strong> ${escapeHtml(payLabel)}</div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>${escapeHtml(IL.product)}</th>
                    <th>${escapeHtml(IL.unit)}</th>
                    <th class="num">${escapeHtml(IL.qty)}</th>
                    <th class="num">${escapeHtml(IL.unitPriceHT)}</th>
                    <th class="num">${escapeHtml(IL.amountHT)}</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map((it, i) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${escapeHtml(it.name)}</td>
                      <td>${escapeHtml(it.unit || '—')}</td>
                      <td class="num">${it.qty}</td>
                      <td class="num">${it.price.toFixed(2)}</td>
                      <td class="num">${it.total.toFixed(2)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
              <div class="receipt-totals">
                <div class="receipt-totals-row"><span>${escapeHtml(IL.totalHT)}</span><span>${subtotal.toFixed(2)} ${currency}</span></div>
                ${itemDiscounts > 0 ? `<div class="receipt-totals-row"><span>${escapeHtml(IL.itemDiscounts)}</span><span>−${itemDiscounts.toFixed(2)} ${currency}</span></div>` : ''}
                ${cartDiscount > 0 ? `<div class="receipt-totals-row"><span>${escapeHtml(IL.cartDiscount)}</span><span>−${cartDiscount.toFixed(2)} ${currency}</span></div>` : ''}
                ${couponDiscount > 0 ? `<div class="receipt-totals-row"><span>${escapeHtml(IL.coupon)}</span><span>−${couponDiscount.toFixed(2)} ${currency}</span></div>` : ''}
                ${tax > 0 ? `<div class="receipt-totals-row"><span>${escapeHtml(IL.vat)} (${taxRate} %)</span><span>${tax.toFixed(2)} ${currency}</span></div>` : ''}
                ${timbre > 0 ? `<div class="receipt-totals-row"><span>${escapeHtml(IL.stamp)}</span><span>${timbre.toFixed(2)} ${currency}</span></div>` : ''}
                <div class="receipt-totals-row total"><span>${escapeHtml(IL.totalTTC)}</span><span>${total.toFixed(2)} ${currency}</span></div>
                ${totalWords ? `<div class="receipt-words">${escapeHtml(IL.wordsIntro)} ${escapeHtml(totalWords)}.</div>` : ''}
                ${customText ? `<div class="receipt-custom-text" style="margin-top:0.5rem;font-size:0.78rem;color:var(--text-primary);white-space:pre-wrap;">${escapeHtml(customText)}</div>` : ''}
              </div>
              <div class="receipt-foot">
                ${escapeHtml(store.invoiceFooter || IL.thanks)}
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" type="button" data-action="new">${t('newSale', 'New sale')}</button>
          <button class="btn btn-outline" type="button" data-action="ticket" title="${escapeHtml(t('printTicket80', 'Print ticket 80mm'))}">${ICON.print}<span style="margin-inline-start:0.3rem;">${t('ticket80', 'Ticket 80mm')}</span></button>
          <button class="btn btn-secondary" type="button" data-action="pdf">${ICON.download}<span style="margin-inline-start:0.3rem;">${t('downloadPdf', 'Download PDF')}</span></button>
          <button class="btn btn-primary" type="button" data-action="print">${ICON.print}<span style="margin-inline-start:0.3rem;">${t('print', 'Print')}</span></button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('posReceiptModal');

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="new"]').addEventListener('click', close);
  overlay.querySelector('[data-action="print"]').addEventListener('click', () => printReceipt());
  overlay.querySelector('[data-action="pdf"]').addEventListener('click', () => generateInvoicePDF(sale));
  overlay.querySelector('[data-action="ticket"]').addEventListener('click', () => {
    if (window.printThermalTicket) window.printThermalTicket(sale, state.settings, invLang);
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}

function printReceipt() {
  // Add a class to <body> that scopes the @media print rules
  document.body.classList.add('printing-receipt');
  // Defer to let the class apply
  setTimeout(() => {
    try {
      window.print();
    } catch (e) {
      console.warn('[sales] print failed', e);
    } finally {
      // Remove the class after printing (after a short delay for the dialog to close)
      setTimeout(() => document.body.classList.remove('printing-receipt'), 500);
    }
  }, 100);
}

function generateInvoicePDF(sale) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (window.Toast) window.Toast.error(t('pdfLibraryMissing', 'PDF library not loaded'));
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    let y = margin;
    const store = state.settings;
    const company = store.companyInfo || {};
    const currency = store.currency || 'DZD';
    const taxRate = Number(store.taxRate || 0);
    const pageLang = (typeof window.currentLang !== 'undefined' && window.currentLang) || (localStorage.getItem('lang') || 'ar');
    // Invoice language (FR/EN) chosen in the pre-sale popup — NOT the page language
    const invLang = state.invoiceLang || (window.getStoredInvoiceLang ? window.getStoredInvoiceLang() : 'fr');
    const IL = window.invoiceLabels ? window.invoiceLabels(invLang) : {};
    const saleDate = fmtDate(sale.saleDate || sale.createdAt || new Date(), pageLang);
    // Walk-in customer → localized label
    const rawCustomer = resolveCustomerName(sale.customer, state.selectedCustomerName || '');
    const customerName = rawCustomer && rawCustomer !== t('noCustomer', 'Walk-in customer') && rawCustomer !== 'Walk-in customer'
      ? rawCustomer : (IL.walkin || 'Particulier');
    const items = (sale.items || []).map(it => {
      const name = it.productName || (it.product && (productName(it.product) || it.product.name)) || it.name || '—';
      const qty = Number(it.quantity) || 0;
      const price = Number(it.price) || 0;
      const discount = Number(it.discount) || 0;
      const total = Number(it.total) || Math.max(0, qty * price - discount);
      const unit = it.productUnit || (it.product && (it.product.unit || (it.product.unit))) || (it.unit) || 'pcs';
      return { name, qty, price, discount, total, unit };
    });
    const subtotal = Number(sale.subtotal) || 0;
    const cartDiscount = Number(sale.discount) || 0;
    const couponDiscount = Number(sale.couponDiscount) || 0;
    const itemDiscounts = items.reduce((s, it) => s + (Number(it.discount) || 0), 0);
    const tax = Number(sale.tax) || 0;
    const timbre = Number(sale.timbre) || 0;
    const total = Number(sale.total) || 0;
    const totalWords = invLang === 'en' ? '' : num2frenchwords(total);
    const payMethod = sale.paymentMethod || 'cash';
    const payLabel = (IL && IL[paymentLabel(payMethod)]) ? IL[paymentLabel(payMethod)] : paymentLabel(payMethod);
    const invoiceNo = sale.saleNumber || '';
    const rightX = pageWidth - margin;
    const centerX = pageWidth / 2;

    // Primary brand color (from settings — admin can override the default emerald)
    const pcHex = (store.invoicePrimaryColor || '#10b981').trim();
    const pcMatch = /^#?([0-9a-f]{6})$/i.exec(pcHex);
    const pcInt = pcMatch ? parseInt(pcMatch[1], 16) : 0x10b981;
    const prR = (pcInt >> 16) & 255;
    const prG = (pcInt >> 8) & 255;
    const prB = pcInt & 255;

    // ===== HEADER: Store name (large, centered, prominent) =====
    doc.setFontSize(26);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(prR, prG, prB);
    doc.text(store.storeName || 'DZ POS PRO', centerX, y + 8, { align: 'center' });
    y += 14;

    // Contact info (centered, each on its own line)
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(70, 70, 70);
    if (company.address) { doc.text(company.address, centerX, y, { align: 'center' }); y += 4.5; }
    if (company.phone) { doc.text('Tel: ' + company.phone, centerX, y, { align: 'center' }); y += 4.5; }
    if (company.whatsapp) { doc.text('WhatsApp: ' + company.whatsapp, centerX, y, { align: 'center' }); y += 4.5; }
    if (company.email) { doc.text(company.email, centerX, y, { align: 'center' }); y += 4.5; }

    // ===== Fiscal info: each on its own line, centered =====
    if (company.rc || company.nif || company.nis || company.art) {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(50, 50, 50);
      const fiscalLines = [];
      if (company.rc)  fiscalLines.push('RC: ' + company.rc);
      if (company.nif) fiscalLines.push('NIF: ' + company.nif);
      if (company.nis) fiscalLines.push('NIS: ' + company.nis);
      if (company.art) fiscalLines.push('ART: ' + company.art);
      fiscalLines.forEach(line => {
        doc.text(line, centerX, y, { align: 'center' });
        y += 4.5;
      });
      y += 2;
    }

    // ===== النص الترويسي في PDF =====
const headerText = (store.invoiceHeader || '').trim();
if (headerText) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const splitHeader = doc.splitTextToSize(headerText, pageWidth - 2 * margin);
    splitHeader.forEach(line => {
        doc.text(line, centerX, y, { align: 'center' });
        y += 5;
    });
    y += 2;
}

    // ===== Separator line =====
    doc.setDrawColor(prR, prG, prB);
    doc.setLineWidth(0.6);
    doc.line(margin, y, rightX, y);
    y += 6;

    // ===== Invoice meta (two columns) =====
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text(IL.invoice || 'FACTURE', margin, y);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text((IL.invoiceNumber || 'N° Facture') + ': ' + invoiceNo, rightX, y, { align: 'right' });
    y += 5;
    doc.text((IL.date || 'Date') + ': ' + saleDate, rightX, y, { align: 'right' });
    y += 6;

    // Customer + Payment
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    // Customer block (left) — label then value, no big gap
    doc.setFont('helvetica', 'bold');
    doc.text((IL.customer || 'Client') + ':', margin, y);
    const custLabelWidth = doc.getTextWidth((IL.customer || 'Client') + ':') + 2;
    doc.setFont('helvetica', 'normal');
    doc.text(customerName, margin + custLabelWidth, y);

    // Payment block (right) — label then value, no big gap
    doc.setFont('helvetica', 'bold');
    const payLabelText = (IL.payment || 'Paiement') + ':';
    const payValueText = payLabel;
    const payValueWidth = doc.getTextWidth(payValueText);
    const payLabelWidth = doc.getTextWidth(payLabelText);
    const payBlockWidth = payLabelWidth + 3 + payValueWidth;
    const payStartX = rightX - payBlockWidth;
    doc.text(payLabelText, payStartX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(payValueText, payStartX + payLabelWidth + 3, y);
    y += 7;

    // ===== Items table =====
    const head = [[
      '#',
      IL.product || 'Produit',
      IL.unit || 'Unité',
      IL.qty || 'Qté',
      IL.unitPriceHT || 'P.Unitaire H.T',
      IL.amountHT || 'Montant H.T'
    ]];
    const body = items.map((it, i) => [
      String(i + 1),
      it.name,
      it.unit || '—',
      String(it.qty),
      it.price.toFixed(2) + ' ' + currency,
      it.total.toFixed(2) + ' ' + currency
    ]);

    if (typeof doc.autoTable === 'function') {
      doc.autoTable({
        startY: y,
        head,
        body,
        theme: 'grid',
        headStyles: { fillColor: [prR, prG, prB], textColor: [255, 255, 255], fontSize: 8.5, halign: 'center', fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, halign: 'center', textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 'auto', halign: 'left' },
          2: { cellWidth: 22, halign: 'center' },
          3: { cellWidth: 22, halign: 'center' },
          4: { cellWidth: 30, halign: 'right' },
          5: { cellWidth: 30, halign: 'right' }
        },
        margin: { left: margin, right: margin }
      });
      y = doc.lastAutoTable.finalY + 12;
    } else {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(head[0].join('   |   '), margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      body.forEach(r => { doc.text(r.join('   |   '), margin, y); y += 5; });
      y += 4;
    }

    // ===== Totals (right-aligned block) =====
    const labelX = pageWidth - margin - 75;
    const valueX = pageWidth - margin;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text('Total H.T :', labelX, y);
    doc.text(subtotal.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    if (itemDiscounts > 0) {
      doc.text((IL.itemDiscounts || 'Remises articles') + ' :', labelX, y);
      doc.text('-' + itemDiscounts.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    if (cartDiscount > 0) {
      doc.text((IL.cartDiscount || 'Remise') + ' :', labelX, y);
      doc.text('-' + cartDiscount.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    if (couponDiscount > 0) {
      doc.text((IL.coupon || 'Coupon') + ' :', labelX, y);
      doc.text('-' + couponDiscount.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    if (tax > 0) {
      doc.text((IL.vat || 'TVA') + ' (' + taxRate + ' %) :', labelX, y);
      doc.text(tax.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    if (timbre > 0) {
      doc.text((IL.stamp || 'Timbre') + ' :', labelX, y);
      doc.text(timbre.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 6;
    }
    y += 4;
    doc.setDrawColor(prR, prG, prB);
    doc.setLineWidth(0.4);
    doc.line(labelX, y - 2, valueX, y - 2);
    y += 5;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(prR, prG, prB);
    doc.text((IL.totalTTC || 'TOTAL T.T.C') + ' :', labelX, y);
    doc.text(total.toFixed(2) + ' ' + currency, valueX, y, { align: 'right' }); y += 10;

    // ===== Total in words (French legal requirement — FR only) =====
    if (totalWords) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(70, 70, 70);
      const wordsLabel = IL.wordsIntro || 'Arrêté la présente facture à la somme de :';
      const fullText = wordsLabel + ' ' + totalWords + '.';
      const splitText = doc.splitTextToSize(fullText, pageWidth - 2 * margin);
      splitText.forEach(line => {
        doc.text(line, margin, y);
        y += 5;
      });
    }

    // ===== Custom invoice text (from settings) =====
    const customText = (store.invoiceCustomText || '').trim();
    if (customText) {
      y += 2;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 30, 30);
      const splitCustom = doc.splitTextToSize(customText, pageWidth - 2 * margin);
      splitCustom.forEach(line => {
        doc.text(line, margin, y);
        y += 5;
      });
    }

    // ===== Footer =====
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140, 140, 140);
    const footer = store.invoiceFooter || (IL.thanks || t('thanks', 'Thank you for your trust'));
    doc.text(footer, centerX, pageHeight - 10, { align: 'center' });

    doc.save('invoice-' + invoiceNo + '.pdf');
    if (window.Toast) window.Toast.success(t('invoiceGenerated', 'Invoice generated') + ': ' + invoiceNo);
  } catch (e) {
    console.error('[sales] generateInvoicePDF', e);
    if (window.Toast) window.Toast.error((e && e.message) || t('pdfFailed', 'Failed to generate PDF'));
  }
}

/* ============================================================
 * Entry
 * ============================================================ */

export async function renderSalesPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;

  // Reset module state on every entry
  state = {
    products: [], productsPage: 1, productsTotalPages: 1, productsTotal: 0,
    productsLoading: false, productsExhausted: false,
    search: '', selectedCategory: '', categories: [],
    customers: [], selectedCustomerId: null, selectedCustomerName: '',
    cart: [],
    couponCode: '', couponExpanded: false, couponDiscount: 0, couponObj: null,
    paymentMethod: 'cash', amountPaid: 0, splitCash: 0, splitCard: 0,
    activeCustomerId: null, customerCarts: {}, loyaltyPoints: 0,
    session: null, sessionStats: null,
    settings: {
      storeName: 'DZ POS PRO', currency: 'DZD', taxRate: 0, invoicePrefix: 'INV-', invoiceFooter: '', invoiceCustomText: '',
      companyInfo: { rc: '', nif: '', nis: '', art: '', address: '', phone: '', whatsapp: '', email: '' }
    },
    lastSale: null
  };

  // Restore saved cart from localStorage (cart persistence across navigation)
  const saved = loadSavedCart();
  if (saved) {
    state.cart = Array.isArray(saved.cart) ? saved.cart : [];
    state.selectedCustomerId = saved.selectedCustomerId || null;
    state.selectedCustomerName = saved.selectedCustomerName || '';
    state.couponCode = saved.couponCode || '';
    state.couponDiscount = saved.couponDiscount || 0;
    state.couponObj = saved.couponObj || null;
    state.paymentMethod = saved.paymentMethod || 'cash';
    state.amountPaid = saved.amountPaid || 0;
    state.splitCash = saved.splitCash || 0;
    state.splitCard = saved.splitCard || 0;
    state.activeCustomerId = saved.activeCustomerId || null;
    state.customerCarts = (saved.customerCarts && typeof saved.customerCarts === 'object') ? saved.customerCarts : {};
    state.loyaltyPoints = saved.loyaltyPoints || 0;
  }

  // Clean up any previous listeners
  cleanupListeners();
  // Remove any leftover modals from previous visits
  document.querySelectorAll('#posCustomerModal, #posReceiptModal').forEach(el => el.remove());
  // Remove printing class if lingering
  document.body.classList.remove('printing-receipt');

  // Render skeleton immediately
  content.innerHTML = renderSkeleton();

  // Fetch everything in parallel
  await Promise.all([
    fetchSettings(),
    fetchCategories(),
    fetchSession()
  ]);

  // Render the actual layout
  content.innerHTML = renderLayout();

  // Bind events
  bindEvents();

  // Refresh cart display (in case a saved cart was restored)
  refreshCart();

  // Initial product fetch
  fetchProducts(true);
}

/* Alias for dashboards that use a different name */
export { renderSalesPage as renderPosPage };
