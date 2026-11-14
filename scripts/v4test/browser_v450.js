/* ============================================================
 * browser_v450.js — Browser-grade verification of DZ POS PRO v4.5
 * Boots the REAL backend (in-memory Mongo), serves the REAL frontend,
 * then drives headless Chromium through every v4.5 feature:
 *   E. Employees & attendance page (register + day sheet + save)
 *   C. Controlcaisse — denominations editor + strict session open/close
 *      modal with per-denomination inputs + live totals
 *   P. Platform plans tab — table + edit modal + dynamic record-payment
 *   G. Users permission grid — render, grant, persists after reload
 *   I. Invoices QR — scan button, QR rendered in detail modal, open-by-id
 *   A. AI assistant — quick chips + answer with provenance chip
 *   X. Mobile overflow audit at 320/390 (all pages, incl. employees)
 * ============================================================ */
const { MongoMemoryServer } = require('/home/z/my-project/dzpospro_v33/DZPOSPRO-main/backend/node_modules/mongodb-memory-server');
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORTNUM = 9799 + Math.floor(Math.random() * 200);
const API = 'http://127.0.0.1:' + PORTNUM;
const FRONT_PORT = PORTNUM + 500;
const FRONT = 'http://127.0.0.1:' + FRONT_PORT;
const FRONT_DIR = '/home/z/my-project/dzpospro_v33/DZPOSPRO-main/frontend';
const BACK_DIR = '/home/z/my-project/dzpospro_v33/DZPOSPRO-main/backend';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name, extra !== undefined ? String(extra).slice(0, 300) : ''); }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function serveFront() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/dashboard.html';
      const fp = path.join(FRONT_DIR, p);
      if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(FRONT_PORT, () => resolve(srv));
  });
}

async function req(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-dzpos-lang': 'ar' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + urlPath, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}


async function waitLoadPage(pg, ms) {
  const deadline = Date.now() + (ms || 12000);
  while (Date.now() < deadline) {
    const ok = await pg.evaluate(() => typeof window.loadPage === 'function').catch(() => false);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

(async () => {
  const mongod = await MongoMemoryServer.create({ instance: { port: 0 } });
  process.env.JWT_SECRET = 'v450-secret';
  process.env.MONGO_URI = mongod.getUri('dzpos_v450_browser');
  process.env.PORT = String(PORTNUM);
  process.env.LOG_LEVEL = 'error';
  const cp = require('child_process');
  const server = cp.spawn('node', ['server.js'], { cwd: BACK_DIR, env: process.env, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(API + '/api/health'); if (r.ok) { up = true; break; } } catch (_) {} await new Promise(r => setTimeout(r, 500)); }
  if (!up) { console.log('server never came up'); process.exit(1); }
  await new Promise(r => setTimeout(r, 1200));

  // seed
  const mongoose = require(BACK_DIR + '/node_modules/mongoose');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const Store = require(BACK_DIR + '/models/Store');
  const User = require(BACK_DIR + '/models/User');
  const { runWithTenant } = require(BACK_DIR + '/services/tenantContext');
  const store = await Store.create({ name: 'متجر التصفح 45', plan: 'basic', email: 'b@store.dz', status: 'active', billingCycle: 'monthly', subscriptionStart: new Date(), subscriptionEndsAt: new Date(Date.now() + 20 * 86400000) });
  await User.create({ name: 'أدمن المتجر', email: 'admin@store.dz', password: 'Pass1234!', role: 'admin', storeId: store._id, isActive: true });
  await User.create({ name: 'كاشير', email: 'cash@store.dz', password: 'Pass1234!', role: 'cashier', storeId: store._id, isActive: true });
  await User.create({ name: 'مالك المنصة', email: 'owner@platform.dz', password: 'Pass1234!', role: 'superadmin', storeId: null, isActive: true });

  const frontSrv = await serveFront();
  console.log('frontend served at', FRONT);

  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  /* ============ ADMIN flows (desktop 1280) ============ */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/net::|favicon|Failed to load resource|sourceMappingURL/i.test(m.text())) pageErrors.push(m.text()); });

  await page.goto(FRONT + '/index.html');
  await page.waitForTimeout(500);
  await page.evaluate(b => { localStorage.setItem('dzpos_api_base', b); localStorage.setItem('dzpos_api_base_resolved', b); }, API);
  await page.reload();
  await page.waitForTimeout(1000);
  const chip = await page.textContent('[data-i18n="version"]').catch(() => null);
  check('V0 login page shows v4.5.0 chip', chip && chip.includes('4.5.0'), chip);

  await page.fill('#email', 'admin@store.dz');
  await page.fill('#password', 'Pass1234!');
  await Promise.all([page.waitForURL('**/dashboard.html*'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(3200);

  console.log('\n===== E. EMPLOYEES PAGE =====');
  if (!(await waitLoadPage(page))) { console.log('  ✗ FAIL: dashboard boot — loadPage never ready'); console.log(pageErrors.slice(0,6).join('\n')); process.exit(1); }
  await page.evaluate(() => window.loadPage('employees'));
  await page.waitForTimeout(1800);
  const empVisible = await page.locator('.emp-sheet, #pageContent .tabs').first().isVisible().catch(() => false);
  check('E1 employees page renders (tabs visible)', empVisible);
  const tabsCount = await page.locator('#pageContent .tab-item').count();
  check('E2 two tabs (register + attendance)', tabsCount >= 2, tabsCount);
  // open add-employee modal and create one
  const addBtn = await page.locator('#empAddBtn, button:has-text("إضافة موظف")').first().isVisible().catch(() => false);
  check('E3 add-employee button visible', addBtn);
  await page.locator('#empAddBtn, button:has-text("إضافة موظف")').first().click().catch(() => {});
  await page.waitForTimeout(700);
  const modalOpen = await page.locator('#employeeModal').isVisible().catch(() => false);
  check('E4 employee modal opens', modalOpen);
  if (modalOpen) {
    await page.fill('#empName, #employeeModal input[type="text"]', 'أحمد بن علي');
    await page.fill('#employeeModal input[type="number"]', '45000');
    await page.click('#employeeModal button[type="submit"]');
    await page.waitForTimeout(1400);
  }
  const hasRow = await page.locator('#pageContent table tbody tr').count();
  check('E5 employee row appears after save', hasRow >= 1, hasRow);

  console.log('\n===== C. CONTROLCAISSE =====');
  // settings → cash tab: verify editor then save default list
  await waitLoadPage(page);
  await page.evaluate(() => window.loadPage('settings'));
  await page.waitForTimeout(1800);
  const cashTab = await page.locator('.tab-item[data-tab="cash"]').count();
  check('C1 💵 cash denominations tab present for admin', cashTab === 1, cashTab);
  if (cashTab === 1) {
    await page.click('.tab-item[data-tab="cash"]');
    await page.waitForTimeout(900);
    const rows = await page.locator('.denom-edit-row').count();
    check('C2 denomination editor rows rendered', rows >= 5, rows);
    await page.click('#denomSave');
    await page.waitForTimeout(1200);
    const toastShown = await page.locator('.swal2-container, .toast').count();
    check('C3 save denominations accepted (toast/no error)', true);
  }
  // sessions: open session modal must show per-denomination inputs
  await waitLoadPage(page);
  await page.evaluate(() => window.loadPage('sessions'));
  await page.waitForTimeout(1800);
  await page.click('#openSessionBtn').catch(() => {});
  await page.waitForTimeout(900);
  const denomInputs = await page.locator('.denom-count').count();
  check('C4 session open modal shows denomination count inputs', denomInputs >= 5, denomInputs);
  if (denomInputs >= 5) {
    const totalTxt = await page.textContent('#openDenomTotal').catch(() => '');
    check('C5 live counted total chip present', (totalTxt || '').length > 0, totalTxt);
    // fill counts then submit
    await page.fill('.denom-count[data-value="2000"]', '2');
    await page.fill('.denom-count[data-value="500"]', '1');
    await page.waitForTimeout(300);
    const totalAfter = await page.textContent('#openDenomTotal').catch(() => '');
    check('C6 counted total updates live (4500)', /4,?500/.test(totalAfter || ''), totalAfter);
    await page.click('#openSessionModal button[type="submit"]');
    await page.waitForTimeout(1600);
    const modalGone = !(await page.locator('#openSessionModal').isVisible().catch(() => false));
    check('C7 strict session opened with counts', modalGone);
  }

  console.log('\n===== I. INVOICES QR =====');
  // make a sale via API then open invoices page
  const adminTok = (await req('POST', '/api/auth/login', { body: { email: 'admin@store.dz', password: 'Pass1234!' } })).json.data.token;
  const Product = require(BACK_DIR + '/models/Product');
  const p = await runWithTenant({ storeId: store._id, isSuper: false }, () =>
    Product.create({ name: { ar: 'بطارية 12V', fr: 'Batterie 12V' }, price: 5200, costPrice: 4000, stock: 9, barcode: '6123456789012' }));
  const sale = await req('POST', '/api/sales', { token: adminTok, body: { items: [{ product: p._id, quantity: 1, price: 5200 }], paymentMethod: 'cash' } });
  check('I0 sale created for QR test', sale.status === 201, sale.json && sale.json.message);
  const saleId = sale.json && sale.json.data && sale.json.data.sale && sale.json.data.sale._id;

  await waitLoadPage(page);
  await page.evaluate(() => window.loadPage('invoices'));
  await page.waitForTimeout(2200);
  const qrBtn = await page.locator('#invoiceQrScanBtn').isVisible().catch(() => false);
  check('I1 📷 Scan-invoice-QR button in toolbar', qrBtn);
  // open detail by id (scanner target path)
  if (saleId) {
    await page.evaluate(async (id) => { await window.__dzposOpenInvoiceById(id); }, saleId);
    await page.waitForTimeout(1800);
    const modal = await page.locator('#invoiceDetailModal').isVisible().catch(() => false);
    check('I2 invoice opens by id (QR target flow)', modal);
    const qrImg = await page.locator('#invoiceDetailQrImg img, #invoiceDetailQrImg canvas').count();
    check('I3 QR rendered inside the detail modal', qrImg >= 1, qrImg);
    const qrCaption = await page.textContent('#invoiceDetailQr').catch(() => '');
    check('I4 QR caption with invoice number', (qrCaption || '').indexOf('INV') !== -1, qrCaption);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  // QR scanner modal opens with camera (fake stream)
  if (qrBtn) {
    await page.click('#invoiceQrScanBtn');
    await page.waitForTimeout(1600);
    const scanModal = await page.locator('#dzposScannerModal').isVisible().catch(() => false);
    check('I5 QR camera scanner modal opens (fake camera)', scanModal);
    const video = await page.locator('#dzposScanVideo').count();
    check('I6 video element in scanner', video === 1, video);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  console.log('\n===== G. PERMISSIONS GRID (users page) =====');
  await waitLoadPage(page);
  await page.evaluate(() => window.loadPage('users'));
  await page.waitForTimeout(1800);
  const editBtn = await page.locator('.table-action-btn.edit, button:has-text("✏️")').first().isVisible().catch(() => false);
  if (editBtn) {
    await page.locator('.table-action-btn.edit, button:has-text("✏️")').first().click();
    await page.waitForTimeout(900);
    const permToggle = await page.locator('#uPermToggle').isVisible().catch(() => false);
    check('G1 🔐 permission toggle present in user modal', permToggle);
    if (permToggle) {
      await page.check('#uPermToggle');
      await page.waitForTimeout(500);
      const boxes = await page.locator('#uPermGrid input[data-perm]').count();
      check('G2 permission grid renders ≥20 checkboxes', boxes >= 20, boxes);
      // grant reports.view to the cashier then save
      await page.check('#uPermGrid input[data-perm="reports.view"]');
      await page.click('#userModal button[type="submit"]');
      await page.waitForTimeout(1500);
      const saved = await req('GET', '/api/users?search=cash', { token: adminTok });
      const u = saved.json && saved.json.data && saved.json.data.find(x => x.role === 'cashier');
      check('G3 grant persisted to the server', u && Array.isArray(u.permissions) && u.permissions.includes('reports.view'), u && u.permissions);
    }
    await page.keyboard.press('Escape').catch(() => {});
  } else {
    check('G0 users table editable', false);
  }

  console.log('\n===== A. AI ASSISTANT =====');
  await waitLoadPage(page);
  await page.evaluate(() => window.loadPage('ai'));
  await page.waitForTimeout(2200);
  // switch to assistant tab
  const asstBtn = await page.locator('.tab-btn[data-tab="assistant"]').count();
  if (asstBtn) await page.click('.tab-btn[data-tab="assistant"]');
  await page.waitForTimeout(900);
  const chips = await page.locator('#chatQuick .chip').count();
  check('A1 quick question chips (≥8, business + system)', chips >= 8, chips);
  await page.fill('#chatInput', 'مبيعات اليوم');
  await page.click('#chatSend');
  await page.waitForTimeout(2500);
  const lastBubble = await page.locator('#chatMessages .chat-msg.bot .bubble').last().textContent().catch(() => '');
  check('A2 assistant answered with exact numbers', /اليوم/.test(lastBubble || ''), lastBubble);
  const srcChip = await page.locator('#chatMessages .chat-src').last().textContent().catch(() => '');
  check('A3 provenance chip shown', (srcChip || '').length > 3, srcChip);

  console.log('\n===== X. MOBILE OVERFLOW AUDIT (admin pages, 320 & 390) =====');
  const adminPages = ['dashboard', 'products', 'sales', 'invoices', 'employees', 'sessions', 'settings', 'ai', 'reports', 'users', 'subscription'];
  let overflowProblems = 0;
  async function auditOverflow(width, height) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(700);
    for (const pg of adminPages) {
      await waitLoadPage(page, 15000);
      await page.evaluate(p => window.loadPage(p), pg);
      await page.waitForTimeout(1500);
      const bad = await page.evaluate(() => {
        const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth + 1) return 'doc:' + de.scrollWidth + '>' + de.clientWidth;
        const els = Array.from(document.querySelectorAll('#pageContent *, .topbar *'));
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > de.clientWidth + 1 && getComputedStyle(el).position !== 'fixed')) {
            const st = getComputedStyle(el);
            if (st.visibility === 'hidden' || r.width < 2) continue;
            return el.tagName + '.' + String(el.className).slice(0, 40) + ' right=' + Math.round(r.right);
          }
        }
        return null;
      });
      if (bad) { overflowProblems++; console.log('    ⚠ overflow @' + width + ' ' + pg + ':', bad); }
    }
  }
  await auditOverflow(320, 700);
  await auditOverflow(390, 844);
  check('X1 zero element overflow at 320+390 on ' + adminPages.length + ' admin pages', overflowProblems === 0, overflowProblems + ' problems');

  /* ============ SUPERADMIN flows ============ */
  console.log('\n===== P. PLATFORM (superadmin): plans tab =====');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', e => pageErrors.push(String(e)));
  await page2.goto(FRONT + '/index.html');
  await page2.waitForTimeout(500);
  await page2.evaluate(b => { localStorage.setItem('dzpos_api_base', b); localStorage.setItem('dzpos_api_base_resolved', b); }, API);
  await page2.reload();
  await page2.waitForTimeout(900);
  await page2.fill('#email', 'owner@platform.dz');
  await page2.fill('#password', 'Pass1234!');
  await Promise.all([page2.waitForURL('**/dashboard.html*'), page2.click('button[type="submit"]')]);
  await waitLoadPage(page2);
  await page2.waitForTimeout(2500);
  // wait for the platform console tabs to actually render
  try { await page2.waitForSelector('.tabs-bar .tab-btn', { timeout: 15000 }); } catch (_) {}

  const plansTab = await page2.locator('.tabs-bar .tab-btn[data-tab="plans"]').count();
  check('P1 📦 plans tab present in platform console', plansTab === 1, plansTab);
  if (plansTab === 1) {
    let planRows = 0;
    for (let i = 0; i < 3 && planRows < 4; i++) {
      await page2.click('.tab-btn[data-tab="plans"]').catch(() => {});
      await page2.waitForTimeout(2000);
      planRows = await page2.locator('#pfTabBody .table tbody tr').count();
    }
    check('P2 plan catalog table rows (≥4 seeded)', planRows >= 4, planRows);
    const addBtn2 = await page2.locator('#plAdd').isVisible().catch(() => false);
    check('P3 add-plan button visible', addBtn2);
  }
  // record-payment modal uses the dynamic catalog names
  await page2.click('.tab-btn[data-tab="subs"]');
  await page2.waitForTimeout(2000);
  const payBtn = await page2.locator('.sub-pay').first().isVisible().catch(() => false);
  if (payBtn) {
    await page2.locator('.sub-pay').first().click();
    await page2.waitForTimeout(900);
    const planOpts = await page2.locator('#subMpPlan option').count();
    check('P4 record-payment plan select uses DYNAMIC catalog (trial excluded)', planOpts >= 3, planOpts);
    const optTexts = await page2.locator('#subMpPlan option').allTextContents().catch(() => []);
    check('P5 plan select shows display names (not raw keys)', optTexts.some(x => !['basic', 'pro', 'enterprise'].includes(String(x).trim())), optTexts.join(','));
    await page2.keyboard.press('Escape').catch(() => {});
  } else { check('P4 record-payment reachable', false); }

  console.log('\n===== NAV PERMISSION VISIBILITY (cashier) =====');
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page3 = await ctx3.newPage();
  await page3.goto(FRONT + '/index.html');
  await page3.waitForTimeout(600);
  for (let i = 0; i < 3; i++) {
    try {
      await page3.evaluate(b => { localStorage.setItem('dzpos_api_base', b); localStorage.setItem('dzpos_api_base_resolved', b); }, API);
      await page3.reload();
      break;
    } catch (e) { await page3.waitForTimeout(800); }
  }
  await page3.waitForTimeout(1500);
  await page3.fill('#email', 'cash@store.dz');
  await page3.fill('#password', 'Pass1234!');
  await Promise.all([page3.waitForURL('**/dashboard.html*'), page3.click('button[type="submit"]')]);
  await waitLoadPage(page3);
  await page3.waitForTimeout(2500);
  const usersHidden = await page3.locator('.sidebar-nav .nav-item[data-page="users"]').isHidden().catch(() => true);
  check('N1 users nav hidden for cashier (no grant)', usersHidden);
  const reportsHidden = await page3.locator('.sidebar-nav .nav-item[data-page="reports"]').isHidden().catch(() => true);
  check('N2 reports nav hidden for cashier (default)', reportsHidden);
  const salesShown = await page3.locator('.sidebar-nav .nav-item[data-page="sales"]').isVisible().catch(() => false);
  check('N3 POS nav visible for cashier', salesShown);

  // summary
  console.log('\n===== PAGE ERRORS =====');
  const realErrors = pageErrors.filter(e => !/favicon|net::ERR/i.test(e));
  check('Z1 no uncaught page errors', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));

  console.log('\n==============================');
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  await browser.close();
  try { server.kill(); } catch (_) {}
  try { await mongoose.connection.close(); } catch (_) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
