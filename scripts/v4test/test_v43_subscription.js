/* ============================================================
 * test_v43_subscription.js — DZ POS PRO v4.3 subscription flow
 * ------------------------------------------------------------
 * Full end-to-end verification against the REAL server code:
 *   1. store admin sees subscription (trial) + catalog
 *   2. request upgrade (pro/yearly) → 201 + amount 50,000 + type 'new'
 *   3. duplicate request → 400; cashier request → 403
 *   4. super-admin sees queue → approves (payment confirmed)
 *      → store.plan=pro, +12 months, limits=plan defaults
 *   5. renewal request → type 'renewal' → approve → period extends
 *   6. change request → rejected with note → plan unchanged
 *   7. manual apply (enterprise, 2 months) → recorded + applied
 *   8. overview stats: collectedTotal / paymentsCount / MRR / series
 *   9. expiry enforcement: -10 days → 403 subscriptionExpired;
 *      -3 days → grace OK; legacy store (no endsAt) → OK
 * ============================================================ */
const { MongoMemoryServer } = require('/home/z/my-project/dzpospro_v33/DZPOSPRO-main/backend/node_modules/mongodb-memory-server');

const PORTNUM = 9300 + Math.floor(Math.random() * 400);
const BASE = 'http://127.0.0.1:' + PORTNUM;
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}
async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-dzpos-lang': 'ar' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
// login with 429 backoff (rate limiter is strict on repeated logins)
async function login(email, password) {
  for (let i = 0; i < 6; i++) {
    const r = await req('POST', '/api/auth/login', { body: { email, password } });
    if (r.status === 429) { await new Promise(rs => setTimeout(rs, 1500)); continue; }
    const token = r.json && r.json.data && r.json.data.token;
    if (token) return token;
    throw new Error('login failed for ' + email + ': ' + JSON.stringify(r.json).slice(0, 150));
  }
  throw new Error('login rate-limited for ' + email);
}

(async () => {
  const mongod = await MongoMemoryServer.create({ instance: { port: 0 } });
  const uri = mongod.getUri('dzpos_v43_sub');
  process.env.JWT_SECRET = 'v43-secret';
  process.env.MONGO_URI = uri;
  process.env.PORT = String(PORTNUM); process.env.LOG_LEVEL = 'error';
  process.env.NODE_ENV = 'development';

  const mongoose = require('/home/z/my-project/dzpospro_v33/DZPOSPRO-main/backend/node_modules/mongoose');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const ROOT = '/home/z/my-project/dzpospro_v33/DZPOSPRO-main/backend';
  const Store = require(ROOT + '/models/Store');
  const User = require(ROOT + '/models/User');

  // ---------- seed ----------
  const store = await Store.create({ name: 'متجر الاختبار', plan: 'trial', email: 't@store.dz' });
  const admin = await User.create({ name: 'Store Admin', email: 'admin@t.dz', password: 'Secret1x', role: 'admin', storeId: store._id });
  const cashier = await User.create({ name: 'Cashier', email: 'cash@t.dz', password: 'Secret1x', role: 'cashier', storeId: store._id });
  const superU = await User.create({ name: 'Super', email: 'super@t.dz', password: 'Secret1x', role: 'superadmin', storeId: null });
  const legacy = await Store.create({ name: 'Legacy Store', plan: 'pro' }); // no subscriptionEndsAt
  const legacyAdmin = await User.create({ name: 'Legacy Admin', email: 'legacy@t.dz', password: 'Secret1x', role: 'admin', storeId: legacy._id });

  // wait for server
  process.env.SEED_DONE = '1';
  require(ROOT + '/server.js');
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/health'); up = r.ok; if (up) break; } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  check('server up', up);

  // ---------- login ----------
  const tokA = await login('admin@t.dz', 'Secret1x');
  check('store admin login', !!tokA);
  const tokS = await login('super@t.dz', 'Secret1x');
  check('super login', !!tokS);
  const tokC = await login('cash@t.dz', 'Secret1x');
  check('cashier login', !!tokC);
  const tokLegacy = await login('legacy@t.dz', 'Secret1x');
  check('legacy admin login', !!tokLegacy);

  // ---------- 1. store admin subscription view ----------
  let r = await req('GET', '/api/subscription', { token: tokA });
  const sub0 = r.json && r.json.data;
  check('GET /api/subscription 200', r.status === 200);
  check('state=trial', sub0 && sub0.state === 'trial');
  check('catalog has 4 plans', sub0 && sub0.catalog && sub0.catalog.length === 4);
  check('pro yearly price 50000', sub0 && sub0.catalog.some(p => p.key === 'pro' && p.yearly === 50000));
  check('usage.users=2 (admin + cashier)', sub0 && sub0.usage && sub0.usage.users === 2, sub0 && sub0.usage);

  // ---------- 2. create upgrade request ----------
  r = await req('POST', '/api/subscription/requests', { token: tokA, body: { requestedPlan: 'pro', billingCycle: 'yearly', paymentMethod: 'baridimob', paymentReference: 'BM-7788', storeNote: 'تم الدفع' } });
  check('create request 201', r.status === 201, r.json);
  const reqId = r.json && r.json.data && r.json.data._id;
  check('amount snapshot 50000', r.json && r.json.data && r.json.data.amount === 50000);
  check('type=new (from trial)', r.json && r.json.data && r.json.data.type === 'new');

  // duplicate guard
  r = await req('POST', '/api/subscription/requests', { token: tokA, body: { requestedPlan: 'pro', billingCycle: 'monthly' } });
  check('duplicate pending → 400', r.status === 400);

  // invalid plan
  r = await req('POST', '/api/subscription/requests', { token: tokA, body: { requestedPlan: 'trial', billingCycle: 'monthly' } });
  check('target trial → 400', r.status === 400);

  // cashier forbidden
  r = await req('POST', '/api/subscription/requests', { token: tokC, body: { requestedPlan: 'basic', billingCycle: 'monthly' } });
  check('cashier POST → 403', r.status === 403);

  // ---------- 4. super-admin queue + approve ----------
  r = await req('GET', '/api/subscription/admin/requests?status=pending', { token: tokS });
  check('admin queue shows 1 pending', r.status === 200 && r.json.data.data.length === 1);
  check('store name populated', r.json.data.data[0].store && r.json.data.data[0].store.name === 'متجر الاختبار');

  r = await req('POST', `/api/subscription/admin/requests/${reqId}/approve`, { token: tokS, body: { paidAmount: 50000, paymentReference: 'BM-7788', adminNote: 'شكراً لكم' } });
  check('approve 200', r.status === 200, r.json);
  const after = await Store.findById(store._id);
  check('plan applied = pro', after.plan === 'pro');
  check('cycle = yearly', after.billingCycle === 'yearly');
  check('subscriptionStart set', !!after.subscriptionStart);
  check('ends ≈ +12 months', after.subscriptionEndsAt && (after.subscriptionEndsAt - after.subscriptionStart) > 330 * 86400000, { ends: after.subscriptionEndsAt });
  check('limits = pro defaults (10 users)', after.limits && after.limits.maxUsers === 10);
  check('planSource=request', after.planSource === 'request');

  // re-approve guard
  r = await req('POST', `/api/subscription/admin/requests/${reqId}/approve`, { token: tokS, body: {} });
  check('re-approve → 400', r.status === 400);

  // ---------- 5. renewal ----------
  r = await req('POST', '/api/subscription/requests', { token: tokA, body: { requestedPlan: 'pro', billingCycle: 'yearly' } });
  check('renewal request type=renewal', r.json && r.json.data && r.json.data.type === 'renewal');
  const renewId = r.json.data._id;
  const before = await Store.findById(store._id);
  r = await req('POST', `/api/subscription/admin/requests/${renewId}/approve`, { token: tokS, body: {} });
  const afterR = await Store.findById(store._id);
  check('renewal extends period', afterR.subscriptionEndsAt - before.subscriptionEndsAt > 350 * 86400000, { before: before.subscriptionEndsAt, after: afterR.subscriptionEndsAt });

  // store view now active
  r = await req('GET', '/api/subscription', { token: tokA });
  check('state=active', r.json.data.state === 'active');
  check('daysLeft ~365', r.json.data.daysLeft > 330, { daysLeft: r.json.data.daysLeft });

  // ---------- 6. reject flow ----------
  r = await req('POST', '/api/subscription/requests', { token: tokA, body: { requestedPlan: 'enterprise', billingCycle: 'monthly' } });
  const rejId = r.json.data._id;
  r = await req('POST', `/api/subscription/admin/requests/${rejId}/reject`, { token: tokS, body: { adminNote: 'المبلغ غير مكتمل' } });
  check('reject 200', r.status === 200);
  const storeNow = await Store.findById(store._id);
  check('plan unchanged after reject', storeNow.plan === 'pro');

  // cancel flow (new request then cancel)
  r = await req('POST', '/api/subscription/requests', { token: tokA, body: { requestedPlan: 'basic', billingCycle: 'monthly' } });
  const canId = r.json.data._id;
  r = await req('POST', `/api/subscription/requests/${canId}/cancel`, { token: tokA, body: {} });
  check('cancel own pending 200', r.status === 200);

  // ---------- 7. manual apply ----------
  const endsBeforeApply = (await Store.findById(store._id)).subscriptionEndsAt;
  r = await req('POST', '/api/subscription/admin/apply', { token: tokS, body: { storeId: String(store._id), plan: 'enterprise', billingCycle: 'monthly', months: 2, paidAmount: 20000, paymentMethod: 'cash', adminNote: 'تسجيل يدوي' } });
  check('manual apply 200', r.status === 200, r.json);
  const afterM = await Store.findById(store._id);
  check('plan=enterprise', afterM.plan === 'enterprise');
  // renewal semantics: extends from the CURRENT period end (no lost days)
  check('ends = old end + 2 months (no lost days)', (new Date(afterM.subscriptionEndsAt) - new Date(endsBeforeApply)) > 55 * 86400000 && (new Date(afterM.subscriptionEndsAt) - new Date(endsBeforeApply)) < 70 * 86400000, { ends: afterM.subscriptionEndsAt, before: endsBeforeApply });
  check('limits=enterprise (30 users)', afterM.limits.maxUsers === 30);

  // ---------- 8. overview stats ----------
  r = await req('GET', '/api/subscription/admin/overview', { token: tokS });
  const ov = r.json.data;
  check('collectedTotal=120000', ov.revenue.collectedTotal === 120000, { got: ov.revenue.collectedTotal });
  check('paymentsCount=3', ov.revenue.paymentsCount === 3);
  // test store: enterprise monthly = 10,000 + legacy pro store (no endsAt) = 5,000
  check('mrr=15000 (enterprise 10000 + legacy pro 5000)', ov.revenue.mrr === 15000, { got: ov.revenue.mrr });
  check('activePaid=2 (test + legacy)', ov.stores.activePaid === 2, { got: ov.stores.activePaid });
  check('monthlySeries 12 entries', ov.monthlySeries.length === 12);
  check('current month collected', ov.monthlySeries[11].total === 120000, { got: ov.monthlySeries[11] });
  check('perStore paidTotal=120000', ov.perStore.find(s => String(s.id) === String(store._id)).paidTotal === 120000);
  check('planDistribution counts', ov.planDistribution.enterprise === 1 && ov.planDistribution.pro === 1);

  // store-side history
  r = await req('GET', '/api/subscription/requests', { token: tokA });
  check('history >= 5 records', r.json.data.data.length >= 5, { n: r.json.data.data.length });

  // ---------- 9. expiry enforcement (fresh stores: the 60s tenant cache
  //              is per-store, so each new store is read fresh) ----------
  const stExp = await Store.create({ name: 'Expired Store', plan: 'basic', subscriptionEndsAt: new Date(Date.now() - 10 * 86400000), billingCycle: 'monthly', subscriptionStart: new Date(Date.now() - 40 * 86400000) });
  const admExp = await User.create({ name: 'Exp Admin', email: 'exp@t.dz', password: 'Secret1x', role: 'admin', storeId: stExp._id });
  const stGrace = await Store.create({ name: 'Grace Store', plan: 'basic', subscriptionEndsAt: new Date(Date.now() - 3 * 86400000), billingCycle: 'monthly', subscriptionStart: new Date(Date.now() - 40 * 86400000) });
  const admGrace = await User.create({ name: 'Grace Admin', email: 'grace@t.dz', password: 'Secret1x', role: 'admin', storeId: stGrace._id });
  // direct JWTs — avoids the auth rate limiter (6+ logins/min) in this short test
  const jwt = require('/home/z/my-project/dzpospro_v33/DZPOSPRO-main/backend/node_modules/jsonwebtoken');
  const tokExp = jwt.sign({ id: admExp._id }, 'v43-secret', { expiresIn: '1h' });
  const tokGrace = jwt.sign({ id: admGrace._id }, 'v43-secret', { expiresIn: '1h' });

  r = await req('GET', '/api/products', { token: tokExp });
  check('expired (10d) → 403 subscriptionExpired', r.status === 403 && /اشتراك|expired/.test(r.json.message || ''), r.json);
  r = await req('GET', '/api/subscription', { token: tokExp });
  check('expired → state=expired', r.json.data.state === 'expired');

  r = await req('GET', '/api/products', { token: tokGrace });
  check('grace (3d) → products OK', r.status === 200);
  r = await req('GET', '/api/subscription', { token: tokGrace });
  check('grace (3d) → state=grace', r.json.data.state === 'grace');

  // legacy store untouched
  r = await req('GET', '/api/products', { token: tokLegacy });
  check('legacy store (no endsAt) → products OK', r.status === 200);

  // superadmin cannot fetch store subscription without storeId
  r = await req('GET', '/api/subscription', { token: tokS });
  check('super without storeId → 200 isPlatform (v4.3.1 fix)', r.status === 200 && r.json && r.json.data && r.json.data.isPlatform === true);

  console.log(`\n======== RESULT: ${pass} passed, ${fail} failed ========`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL', e);
  process.exit(1);
});
