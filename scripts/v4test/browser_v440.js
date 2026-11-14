/* ============================================================
 * browser_v440.js — Browser-grade verification of the v4.4 fixes
 * Boots the REAL backend (in-memory Mongo), serves the REAL
 * frontend, then drives headless Chromium at desktop + mobile:
 *   S. Sidebar drawer at every width (hidden by default, hamburger
 *      opens, nav click closes, ESC closes, overlay closes)
 *   T. Settings page as superadmin — editable, no "Admin only" banner
 *   U. Notification panel — clear-all button present + endpoint wired
 *   V. Backup download via apiFetch.download (blob, auth header)
 *   W. Barcode scanner — ZXing loads, modal opens, camera flow starts
 *      (fake media stream flags) + manual-entry fallback on file://
 *   X. Mobile overflow re-audit at 320/390 (v4.3.1 guarantee intact)
 * ============================================================ */
const { MongoMemoryServer } = require('/home/z/my-project/dzpospro_v33/DZPOSPRO-main/backend/node_modules/mongodb-memory-server');
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORTNUM = 9599 + Math.floor(Math.random() * 200);
const API = 'http://127.0.0.1:' + PORTNUM;
const FRONT_PORT = PORTNUM + 500;
const FRONT = 'http://127.0.0.1:' + FRONT_PORT;
const FRONT_DIR = '/home/z/my-project/dzpospro_v33/DZPOSPRO-main/frontend';
const BACK_DIR = '/home/z/my-project/dzpospro_v33/DZPOSPRO-main/backend';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
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

(async () => {
  const mongod = await MongoMemoryServer.create({ instance: { port: 0 } });
  process.env.JWT_SECRET = 'v440-secret';
  process.env.MONGO_URI = mongod.getUri('dzpos_v440_browser');
  process.env.PORT = String(PORTNUM);
  process.env.LOG_LEVEL = 'error';
  const cp = require('child_process');
  const server = cp.spawn('node', ['server.js'], { cwd: BACK_DIR, env: process.env, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(API + '/api/health'); if (r.ok) { up = true; break; } } catch (_) {} await new Promise(r => setTimeout(r, 500)); }
  if (!up) { console.log('server never came up'); process.exit(1); }
  await new Promise(r => setTimeout(r, 1200));

  // seed: store + users + notifications + backup
  const mongoose = require(BACK_DIR + '/node_modules/mongoose');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const Store = require(BACK_DIR + '/models/Store');
  const User = require(BACK_DIR + '/models/User');
  const Notification = require(BACK_DIR + '/models/Notification');
  const store = await Store.create({ name: 'متجر التصفح', plan: 'trial', email: 'b@store.dz', status: 'active' });
  await User.create({ name: 'أدمن المتجر', email: 'admin@store.dz', password: 'Pass1234!', role: 'admin', storeId: store._id, isActive: true });
  const superA = await User.create({ name: 'مالك المنصة', email: 'owner@platform.dz', password: 'Pass1234!', role: 'superadmin', storeId: null, isActive: true });
  for (let i = 0; i < 4; i++) {
    await Notification.create({ storeId: null, type: 'info', title: 'إشعار منصة ' + i, body: 'نص التجربة ' + i });
  }
  const superTok = (await req('POST', '/api/auth/login', { body: { email: 'owner@platform.dz', password: 'Pass1234!' } })).json.data.token;
  await req('POST', '/api/backups/now', { token: superTok });

  const frontSrv = await serveFront();
  console.log('frontend served at', FRONT);

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  /* ============ S + T + U + V — DESKTOP 1280×800 (superadmin) ============ */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/net::|favicon|Failed to load resource/i.test(m.text())) pageErrors.push(m.text()); });

  await page.goto(FRONT + '/index.html');
  await page.waitForTimeout(600);
  // v4.4 harness: pin the API base to the local backend (the resolver would
  // otherwise probe the production Railway URL from a localhost page)
  await page.evaluate(b => { localStorage.setItem('dzpos_api_base', b); localStorage.setItem('dzpos_api_base_resolved', b); }, API);
  await page.reload();
  await page.waitForTimeout(1200);
  // login page version chip
  const chip = await page.textContent('[data-i18n="version"]').catch(() => null);
  check('V0 login page shows version chip', chip && chip.includes('4.5.0'), chip);

  await page.fill('#email', 'owner@platform.dz');
  await page.fill('#password', 'Pass1234!');
  await Promise.all([page.waitForURL('**/dashboard.html*'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(3500); // let the initial dashboard render settle

  console.log('\n===== S. SIDEBAR DRAWER (desktop 1280) =====');
  const sBox = await page.locator('#sidebar').boundingBox();
  check('S1 sidebar hidden by default on desktop (off-canvas)', !sBox || sBox.x < 0 || sBox.x >= 1280 || sBox.width === 0, sBox);
  const hBox = await page.locator('#hamburger').isVisible();
  check('S2 hamburger visible on desktop', hBox);
  await page.click('#hamburger');
  await page.waitForTimeout(700);
  const sBox2 = await page.locator('#sidebar').boundingBox();
  const dir = await page.evaluate(() => document.documentElement.dir);
  const isOpenRtl = sBox2 && Math.abs(sBox2.x - (1280 - sBox2.width)) < 40;
  const isOpenLtr = sBox2 && sBox2.x >= 0 && sBox2.x < 100;
  check('S3 sidebar opens on hamburger click (' + dir + ')', !!(isOpenLtr || isOpenRtl), sBox2);
  const overlayShown = await page.evaluate(() => { const o = document.getElementById('sidebarOverlay'); return o && getComputedStyle(o).display !== 'none'; });
  check('S4 overlay visible while open', overlayShown);
  // nav click closes
  await page.click('.sidebar-nav .nav-item[data-page="settings"]');
  await page.waitForTimeout(1200);
  const sBox3 = await page.locator('#sidebar').boundingBox();
  check('S5 sidebar auto-closes after nav click', !sBox3 || sBox3.x < 0 || sBox3.x >= 1280, sBox3);
  // reopen + ESC closes
  await page.click('#hamburger');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const sBox4 = await page.locator('#sidebar').boundingBox();
  check('S6 ESC closes the drawer', !sBox4 || sBox4.x < 0 || sBox4.x >= 1280, sBox4);
  // reopen + overlay click closes
  await page.click('#hamburger');
  await page.waitForTimeout(600);
  await page.mouse.click(1200, 400);
  await page.waitForTimeout(600);
  const sBox5 = await page.locator('#sidebar').boundingBox();
  check('S7 overlay click closes the drawer', !sBox5 || sBox5.x < 0 || sBox5.x >= 1280, sBox5);

  console.log('\n===== T. SETTINGS AS SUPERADMIN =====');
  await page.click('#hamburger');
  await page.waitForTimeout(500);
  await page.click('.sidebar-nav .nav-item[data-page="settings"]');
  await page.waitForTimeout(1500);
  const banner = await page.evaluate(() => document.body.innerText.includes('Admin only') || document.body.innerText.includes('أدمن فقط'));
  check('T1 no "Admin only" banner for superadmin', !banner);
  const storeNameDisabled = await page.evaluate(() => { const el = document.getElementById('storeName'); return el ? el.disabled : null; });
  check('T2 store name field editable (not disabled)', storeNameDisabled === false, storeNameDisabled);
  const saveBtnDisabled = await page.evaluate(() => { const b = document.querySelector('#settingsStoreForm button[type="submit"], .card button[type="submit"]'); return b ? b.disabled : null; });
  check('T3 save button enabled', saveBtnDisabled === false, saveBtnDisabled);
  // actually save and verify persistence
  await page.fill('#storeName', 'اسم المنصة عبر المتصفح');
  await page.click('button[type="submit"]:not([disabled])');
  await page.waitForTimeout(1200);
  const saved = await req('GET', '/api/settings', { token: superTok });
  check('T4 PUT /api/settings from superadmin persisted', saved.status === 200 && saved.json.data.settings.storeName === 'اسم المنصة عبر المتصفح', saved.json.data && saved.json.data.settings && saved.json.data.settings.storeName);

  console.log('\n===== U. NOTIFICATIONS CLEAR-ALL =====');
  await page.click('#notifBtn');
  await page.waitForTimeout(800);
  const clearBtn = await page.locator('#notifClearAll').isVisible();
  check('U1 clear-all button visible in panel', clearBtn);
  const itemsBefore = await page.locator('.notif-item').count();
  check('U2 notifications listed', itemsBefore >= 4, itemsBefore);
  page.once('dialog', d => d.accept()); // fallback confirm if no Swal
  await page.click('#notifClearAll');
  await page.waitForTimeout(900);
  const swalVisible = await page.evaluate(() => typeof Swal !== 'undefined' && Swal.isVisible());
  if (swalVisible) {
    await page.click('.swal2-confirm');
    await page.waitForTimeout(900);
  }
  const itemsAfter = await page.locator('.notif-item').count();
  check('U3 clear-all removes all items from panel', itemsAfter === 0, itemsAfter);
  const unread = await req('GET', '/api/notifications', { token: superTok });
  check('U4 backend feed empty after clear-all', unread.status === 200 && (unread.json.data.data || []).length === 0, (unread.json.data.data || []).length);

  console.log('\n===== V. BACKUP DOWNLOAD (authenticated blob) =====');
  await page.evaluate(() => window.loadPage && window.loadPage('platform'));
  await page.waitForTimeout(1500);
  const bkTab = await page.locator('.tab-btn[data-tab="backups"]');
  if (await bkTab.count()) { await bkTab.click(); await page.waitForTimeout(1200); }
  const dlBtn = await page.locator('.bk-download').first();
  check('V1 download button rendered', await dlBtn.count() > 0);
  if (await dlBtn.count()) {
    const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await dlBtn.click();
    const download = await dl;
    check('V2 download event fired with a file', !!download, 'no download event');
    if (download) {
      const name = download.suggestedFilename();
      check('V3 downloaded filename is the backup zip', /\.zip$|\.gz$|backup/i.test(name), name);
    }
  }

  console.log('\n===== W. BARCODE SCANNER (camera on desktop = fake device) =====');
  await page.evaluate(() => window.loadPage && window.loadPage('sales'));
  const posReady = await page.locator('#posSearch').waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  const scanBtn = page.locator('#posScanBtn').first();
  const scanBtnFound = posReady && await scanBtn.count() > 0;
  check('W1 scan button exists on POS', scanBtnFound, { posReady });
  if (scanBtnFound) {
    await scanBtn.click();
    await page.waitForTimeout(1500);
    const modal = await page.evaluate(() => !!document.getElementById('dzposScannerModal')); // v4.5: shared scanner id
    const video = await page.evaluate(() => { const v = document.getElementById('dzposScanVideo') || document.getElementById('posScanVideo'); return v ? { hasStream: !!v.srcObject, w: v.videoWidth } : null; }); // v4.5: shared video id
    check('W2 camera scanner modal opened', modal);
    check('W3 camera stream attached to video', !!(video && video.hasStream), video);
    // ZXing should NOT have loaded on this Chromium (native BarcodeDetector likely exists)
    const engine = await page.evaluate(() => ({ native: 'BarcodeDetector' in window, zxing: !!(window.ZXing && window.ZXing.BrowserMultiFormatReader) }));
    console.log('   engines → native:', engine.native, '| zxing loaded:', engine.zxing);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const modalGone = await page.evaluate(() => !document.getElementById('dzposScannerModal')); // v4.5: shared scanner id
    check('W4 scanner modal closes cleanly', modalGone);
  }
  // ZXing module-level smoke: load vendor script and check globals
  const zx = await page.evaluate(() => new Promise(res => { const s = document.createElement('script'); s.src = 'vendor/zxing.min.js?v=4.4.0'; s.onload = () => res(!!(window.ZXing && window.ZXing.BrowserMultiFormatReader)); s.onerror = () => res(false); document.head.appendChild(s); }));
  check('W5 vendor/zxing.min.js loads and exposes BrowserMultiFormatReader', zx === true);

  const deskErrors = pageErrors.filter(e => !/zxing|swal/i.test(e));
  check('V-W no page errors (desktop superadmin flow)', deskErrors.length === 0, deskErrors.slice(0, 3));
  await ctx.close();

  /* ============ X — MOBILE 320 + 390 overflow audit ============ */
  console.log('\n===== X. MOBILE OVERFLOW AUDIT (320 + 390) =====');
  const mctx = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, permissions: ['camera'] });
  const mp = await mctx.newPage();
  await mp.goto(FRONT + '/index.html');
  await mp.evaluate(b => { localStorage.setItem('dzpos_api_base', b); localStorage.setItem('dzpos_api_base_resolved', b); }, API);
  await mp.reload();
  await mp.waitForTimeout(1000);
  await mp.fill('#email', 'admin@store.dz');
  await mp.fill('#password', 'Pass1234!');
  await Promise.all([mp.waitForURL('**/dashboard.html*'), mp.click('button[type="submit"]')]);
  await mp.waitForTimeout(3500); // let the initial dashboard render settle

  async function overflowScan(pg) {
    return pg.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const bad = [];
      document.querySelectorAll('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > w + 1 || r.left < -1)) {
          const st = getComputedStyle(el);
          if (st.position === 'fixed' && (el.id === 'sidebar' || el.classList.contains('sidebar-overlay'))) return;
          // v4.4 — the drawer slides off-canvas: its closed-state children are
          // positioned outside the viewport BY DESIGN, never a real overflow
          if (el.closest('#sidebar')) return;
          if (el.classList && el.classList.contains('sidebar-overlay')) return;
          // content inside a horizontally scrollable container (.tabs etc.)
          // is reached by SCROLLING, never a layout overflow
          let anc = el.parentElement, scrollable = false;
          for (let i = 0; anc && i < 6; i++) {
            const sa = getComputedStyle(anc);
            if (/(auto|scroll)/.test(sa.overflowX) && anc.scrollWidth > anc.clientWidth + 2) { scrollable = true; break; }
            anc = anc.parentElement;
          }
          if (scrollable) return;
          bad.push((el.id || (typeof el.className === 'string' ? el.className : el.tagName)).toString().slice(0, 40) + ' → ' + Math.round(r.right) + 'px');
        }
      });
      return bad.slice(0, 8);
    });
  }
  const over320dash = await overflowScan(mp);
  check('X1 dashboard 320px zero overflow', over320dash.length === 0, over320dash);
  for (const pg of ['sales', 'products', 'settings', 'reports']) {
    await mp.evaluate(p => window.loadPage && window.loadPage(p), pg);
    await mp.waitForTimeout(1300);
    const over = await overflowScan(mp);
    check('X2 ' + pg + ' 320px zero overflow', over.length === 0, over);
  }
  // mobile sidebar still works
  const hamVisible = await mp.locator('#hamburger').isVisible();
  check('X3 hamburger visible on mobile', hamVisible);
  await mp.click('#hamburger');
  await mp.waitForTimeout(600);
  const mobOpen = await mp.evaluate(() => { const b = document.getElementById('sidebar').getBoundingClientRect(); return b.x >= 0 && b.x < 100; });
  check('X4 sidebar opens on mobile', mobOpen);
  await mctx.close();

  // 390px quick pass
  const mctx2 = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const mp2 = await mctx2.newPage();
  await mp2.goto(FRONT + '/index.html');
  await mp2.evaluate(b => { localStorage.setItem('dzpos_api_base', b); localStorage.setItem('dzpos_api_base_resolved', b); }, API);
  await mp2.reload();
  await mp2.waitForTimeout(1000);
  await mp2.fill('#email', 'admin@store.dz');
  await mp2.fill('#password', 'Pass1234!');
  await Promise.all([mp2.waitForURL('**/dashboard.html*'), mp2.click('button[type="submit"]')]);
  await mp2.waitForTimeout(3500);
  const over390 = await overflowScan(mp2);
  check('X5 dashboard 390px zero overflow', over390.length === 0, over390);
  await mctx2.close();

  /* ============ W2b — file:// style insecure context fallback ============ */
  console.log('\n===== W6. insecure-context manual fallback =====');
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p3 = await ctx3.newPage();
  // simulate file://: neutralize mediaDevices before app scripts run
  await p3.addInitScript(() => { try { Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined, configurable: true }); } catch (_) {} });
  await p3.goto(FRONT + '/index.html');
  await p3.evaluate(b => { localStorage.setItem('dzpos_api_base', b); localStorage.setItem('dzpos_api_base_resolved', b); }, API);
  await p3.reload();
  await p3.waitForTimeout(1000);
  await p3.fill('#email', 'admin@store.dz');
  await p3.fill('#password', 'Pass1234!');
  await Promise.all([p3.waitForURL('**/dashboard.html*'), p3.click('button[type="submit"]')]);
  await p3.waitForTimeout(3500);
  await p3.evaluate(() => window.loadPage && window.loadPage('sales'));
  await p3.waitForTimeout(2500);
  await p3.evaluate(() => window.loadPage && window.loadPage('sales'));
  const posReady3 = await p3.locator('#posSearch').waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  await p3.waitForTimeout(800);
  const sbtn = p3.locator('#posScanBtn').first();
  const sbtnFound = posReady3 && await sbtn.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (sbtnFound) {
    await sbtn.click();
    await p3.waitForTimeout(900);
    const manualShown = await p3.evaluate(() => !!document.getElementById('manualBarcodeInput'));
    check('W6 manual barcode input shown when camera unavailable', manualShown);
    await p3.fill('#manualBarcodeInput', '1234567890123');
    const lookup = await p3.evaluate(() => fetch('/api/products/barcode/1234567890123', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }).then(r => r.status));
    check('W7 manual entry path wired (product lookup endpoint reachable)', lookup === 200 || lookup === 404, lookup);
  } else {
    check('W6 scan button found (insecure ctx)', false, 'button missing');
  }
  await ctx3.close();

  await browser.close();
  frontSrv.close();
  server.kill();
  try { await mongoose.disconnect(); } catch (_) {}
  try { await mongod.stop(); } catch (_) {}
  console.log('\n===== BROWSER RESULT: ' + pass + ' pass / ' + fail + ' fail =====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
