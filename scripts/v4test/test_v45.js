// scripts/v4test/test_v45.js — DZ POS PRO v4.5 backend acceptance suite.
// Boots the REAL server against mongodb-memory-server and exercises every
// v4.5 feature end-to-end: dynamic plans CRUD, subscription flow with the
// dynamic catalog, permissions (grant → access), employees & attendance,
// strict Controlcaisse sessions, cash denominations (admin + applyToAll),
// the AI brain (accurate local answers), and the QR-safe sale endpoint.
process.env.NODE_ENV = 'test';
process.env.PORT = '4600';
process.env.JWT_SECRET = 'test_v45_secret';

const { MongoMemoryServer } = require('mongodb-memory-server');

let PASS = 0, FAIL = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; failures.push(name); console.log('  ✗ FAIL: ' + name); }
}

(async () => {
  const mms = await MongoMemoryServer.create({ instance: { port: 4601, ip: '127.0.0.1' } });
  process.env.MONGO_URI = mms.getUri('dzpos_v45');

  const BASE = 'http://127.0.0.1:4600';
  const server = require('../../backend/server');

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  await sleep(3200);

  const api = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const h = { 'Content-Type': 'application/json', 'Accept-Language': 'ar', 'x-dzpos-lang': 'ar', ...headers };
    if (token) h['Authorization'] = 'Bearer ' + token;
    const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json };
  };

  /* ================= 0. health ================= */
  console.log('\n== Health ==');
  {
    const h = await api('/api/health');
    ok(h.status === 200, 'health 200');
  }

  /* ================= 1. bootstrap accounts ================= */
  console.log('\n== Bootstrap ==');
  const mongoose = require('mongoose');
  const User = require('../../backend/models/User');
  const Store = require('../../backend/models/Store');

  const su = await User.create({
    name: 'Platform Owner', email: 'su@dzpos.dz', password: 'super123',
    role: 'superadmin', storeId: null, isActive: true
  });
  const store = await Store.create({ name: 'Pneu Centre Alger', email: 'store@dz.dz', ownerName: 'Owner', plan: 'trial' });
  const admin = await User.create({
    name: 'Store Admin', email: 'admin@store.dz', password: 'admin123',
    role: 'admin', storeId: store._id, isActive: true
  });
  const cashier = await User.create({
    name: 'Cashier One', email: 'cashier@store.dz', password: 'cash123',
    role: 'cashier', storeId: store._id, isActive: true
  });
  const manager = await User.create({
    name: 'Manager Two', email: 'manager@store.dz', password: 'man123',
    role: 'manager', storeId: store._id, isActive: true
  });

  const login = async (email, password) => {
    const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    return r.json && r.json.data && r.json.data.token;
  };
  const suT = await login('su@dzpos.dz', 'super123');
  const adT = await login('admin@store.dz', 'admin123');
  const caT = await login('cashier@store.dz', 'cash123');
  const maT = await login('manager@store.dz', 'man123');
  ok(!!suT && !!adT && !!caT && !!maT, 'all four accounts log in');

  /* ================= 2. dynamic plan catalog ================= */
  console.log('\n== Plans CRUD (superadmin full control) ==');
  let planId = null, newPlanKey = 'premium2026';
  {
    const list = await api('/api/subscription/admin/plans', { token: suT });
    ok(list.status === 200 && list.json.data.data.length >= 4, 'default catalog seeded (≥4 plans)');
    const trial = list.json.data.data.find(p => p.key === 'trial');
    ok(!!trial && trial.isTrial === true, 'trial plan seeded with isTrial');
    ok(list.json.data.data.find(p => p.key === 'pro').monthly === 5000, 'pro default monthly = 5000');

    const create = await api('/api/subscription/admin/plans', {
      method: 'POST', token: suT,
      body: { key: newPlanKey, name: 'Premium 2026', monthly: 8000, yearly: 80000, maxUsers: 15, maxProducts: 8000, aiDailyCalls: 400, sortOrder: 5, description: 'Test premium' }
    });
    ok(create.status === 201 || create.status === 200, 'create plan 201/200');
    planId = create.json.data.id || create.json.data._id;

    const dup = await api('/api/subscription/admin/plans', { method: 'POST', token: suT, body: { key: newPlanKey, name: 'X', monthly: 1 } });
    ok(dup.status === 400, 'duplicate plan key → 400');

    const forbidden = await api('/api/subscription/admin/plans', { token: adT });
    ok(forbidden.status === 403, 'store admin cannot list plans (403)');

    const upd = await api('/api/subscription/admin/plans/' + planId, { method: 'PUT', token: suT, body: { monthly: 8500, name: 'Premium 2026+' } });
    ok(upd.status === 200 && upd.json.data.monthly === 8500, 'update plan price');

    const mySub = await api('/api/subscription', { token: adT });
    ok(mySub.status === 200, 'store subscription page loads (200, no Required-fields error)');
    const cat = mySub.json.data.catalog || [];
    ok(cat.some(p => p.key === newPlanKey && p.monthly === 8500 && p.name === 'Premium 2026+'), 'store catalog reflects live price+name');

    const req1 = await api('/api/subscription/requests', {
      method: 'POST', token: adT,
      body: { requestedPlan: newPlanKey, billingCycle: 'monthly', paymentMethod: 'ccp', paymentReference: 'CCP-998877', storeNote: 'Paiement fait' }
    });
    ok(req1.status === 201, 'store request created with dynamic plan');
    ok(req1.json.data.amount === 8500, 'request amount uses live catalog price (8500)');

    const reqId = req1.json.data._id;
    const approve = await api('/api/subscription/admin/requests/' + reqId + '/approve', { method: 'POST', token: suT, body: { paidAmount: 8500, periodMonths: 1 } });
    ok(approve.status === 200, 'superadmin approves payment');
    const st2 = await api('/api/subscription', { token: adT });
    ok(st2.json.data.store.plan === newPlanKey, 'store switched to dynamic plan');
    ok(st2.json.data.state === 'active', 'state active');
    ok(st2.json.data.store.limits.maxUsers === 15, 'limits applied from dynamic plan (maxUsers 15)');

    const ov = await api('/api/subscription/admin/overview', { token: suT });
    ok(ov.status === 200 && ov.json.data.revenue.mrr >= 8500, 'overview MRR from dynamic price');
    ok(Array.isArray(ov.json.data.catalog) && ov.json.data.catalog.some(p => p.key === newPlanKey), 'overview carries catalog');

    const del = await api('/api/subscription/admin/plans/' + planId, { method: 'DELETE', token: suT });
    ok(del.status === 200, 'delete plan (in-use → soft-retired)');
    const list2 = await api('/api/subscription/admin/plans', { token: suT });
    const retired = list2.json.data.data.find(p => p.key === newPlanKey);
    ok(retired && retired.active === false, 'in-use plan soft-retired (active=false)');

    const req2 = await api('/api/subscription/requests', { method: 'POST', token: adT, body: { requestedPlan: 'pro', billingCycle: 'monthly', paymentMethod: 'cash' } });
    ok(req2.status === 201, 'second request on static-default plan works');
    await api('/api/subscription/admin/requests/' + req2.json.data._id + '/approve', { method: 'POST', token: suT, body: {} });
  }

  /* ================= 3. permissions ================= */
  console.log('\n== Permissions (grant → access) ==');
  {
    const prod = await api('/api/products', { token: caT });
    ok(prod.status === 200, 'cashier sees products (default)');

    const usersList = await api('/api/users', { token: caT });
    ok(usersList.status === 403, 'cashier blocked from users (default)');

    const cat = await api('/api/permissions', { token: adT });
    ok(cat.status === 200 && cat.json.data.catalog.length >= 20, 'permission catalog exposed (≥20 keys)');

    const grant = await api('/api/users/' + cashier._id, {
      method: 'PUT', token: adT,
      body: { permissions: ['users.manage', 'reports.view'] }
    });
    ok(grant.status === 200, 'admin grants permissions to cashier');

    const usersList2 = await api('/api/users', { token: caT });
    ok(usersList2.status === 200, 'cashier now allowed on /api/users (grant effective)');

    const rep = await api('/api/reports/summary', { token: caT });
    ok(rep.status === 200, 'cashier granted reports.view can read reports');

    const createProd = await api('/api/products', { method: 'POST', token: caT, body: { name: 'X', price: 10 } });
    ok(createProd.status === 403, 'cashier without products.manage still 403 on product create');

    const mEdit = await api('/api/settings', { method: 'PUT', token: maT, body: { storeName: 'Nope' } });
    ok(mEdit.status === 403, 'manager cannot edit settings (default)');

    const aEdit = await api('/api/settings', { method: 'PUT', token: adT, body: { storeName: 'Pneu Centre Alger HQ' } });
    ok(aEdit.status === 200, 'admin edits settings 200');
  }

  /* ================= 4. employees & attendance ================= */
  console.log('\n== Employees & Attendance (دوام) ==');
  let empId = null;
  {
    const denied = await api('/api/employees', { token: caT });
    ok(denied.status === 403, 'cashier blocked from employees (no grant)');

    const create = await api('/api/employees', {
      method: 'POST', token: adT,
      body: { name: 'Ahmed Benali', phone: '0550112233', jobTitle: 'Vendeur', monthlySalary: 45000, weeklyRestDay: 5 }
    });
    ok(create.status === 201 || create.status === 200, 'employee created');
    empId = create.json.data._id;

    const create2 = await api('/api/employees', { method: 'POST', token: adT, body: { name: 'Karim Said', jobTitle: 'Mécanicien', monthlySalary: 52000 } });
    const empId2 = create2.json.data._id;

    const list = await api('/api/employees?active=true', { token: adT });
    ok(list.status === 200 && Array.isArray(list.json.data) && list.json.data.length === 2, 'employees listed (2)');

    const today = new Date();
    const iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const mark = await api('/api/employees/attendance', {
      method: 'POST', token: adT,
      body: { employeeId: empId, date: iso, status: 'present', checkIn: iso + 'T08:00', checkOut: iso + 'T17:30' }
    });
    ok(mark.status === 200 && mark.json.data.workedMinutes === 570, 'attendance marked present (worked 570 min)');
    const mark2 = await api('/api/employees/attendance', { method: 'POST', token: adT, body: { employeeId: empId2, date: iso, status: 'late', checkIn: iso + 'T09:15', checkOut: iso + 'T18:00' } });
    ok(mark2.status === 200, 'second employee marked late');
    const markAgain = await api('/api/employees/attendance', { method: 'POST', token: adT, body: { employeeId: empId, date: iso, status: 'half_day', checkIn: iso + 'T08:00' } });
    ok(markAgain.status === 200 && markAgain.json.data.status === 'half_day', 'attendance upsert (same day updated)');

    const day = await api('/api/employees/attendance?date=' + iso, { token: adT });
    ok(day.status === 200 && day.json.data.data.length === 2, 'day sheet lists active employees');
    const sheetRow = day.json.data.data.find(r => r.employee.id === empId);
    ok(sheetRow && sheetRow.sheet && sheetRow.sheet.status === 'half_day', 'day sheet carries the upserted status');

    const ym = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    const sum = await api('/api/employees/attendance/summary?month=' + ym, { token: adT });
    ok(sum.status === 200 && sum.json.data.data.length === 2, 'monthly summary has 2 employees');
    const row = sum.json.data.data.find(r => r.employee.id === empId);
    ok(row && (row.days.half_day === 1), 'summary counts half_day');

    const mlist = await api('/api/employees', { token: maT });
    ok(mlist.status === 200, 'manager allowed on employees (role default)');
    const clist = await api('/api/employees', { token: caT });
    ok(clist.status === 403, 'cashier still blocked');

    const upd = await api('/api/employees/' + empId2, { method: 'PUT', token: adT, body: { jobTitle: 'Chef mécanicien', monthlySalary: 60000 } });
    ok(upd.status === 200 && upd.json.data.monthlySalary === 60000, 'employee updated');
    const del = await api('/api/employees/' + empId2, { method: 'DELETE', token: adT });
    ok(del.status === 200, 'employee deleted');
  }

  /* ================= 5. cash denominations + strict sessions ================= */
  console.log('\n== Controlcaisse (strict sessions + denominations) ==');
  {
    const noDen = await api('/api/settings/cash-denominations', { token: adT });
    ok(noDen.status === 200 && noDen.json.data.denominations.length === 0, 'no denominations initially');

    const set = await api('/api/settings/cash-denominations', {
      method: 'PUT', token: adT,
      body: { denominations: [{ value: 2000, type: 'bill' }, { value: 1000, type: 'bill' }, { value: 500, type: 'bill' }, { value: 200, type: 'bill' }, { value: 100, type: 'bill' }, { value: 50, type: 'bill' }, { value: 20, type: 'coin' }, { value: 10, type: 'coin' }, { value: 5, type: 'coin' }] }
    });
    ok(set.status === 200 && set.json.data.denominations.length === 9, 'admin saved 9 denominations');

    const get2 = await api('/api/settings/cash-denominations', { token: caT });
    ok(get2.json.data.denominations.length === 9, 'cashier reads denominations (session modal)');

    const openFail = await api('/api/sessions', { method: 'POST', token: caT, body: { openingCash: 5000 } });
    ok(openFail.status === 400, 'session open WITHOUT counts → 400 (strict)');

    const openOk = await api('/api/sessions', {
      method: 'POST', token: caT,
      body: { openingCounts: { '1000': 2, '500': 1, '100': 3 }, notes: 'start of day' }
    });
    ok(openOk.status === 201, 'session open with counts 201');
    ok(openOk.json.data.session.openingBalance === 2800, 'openingBalance computed from counts (2800)');

    const sessionId = openOk.json.data.session._id;

    const closeFail = await api('/api/sessions/' + sessionId + '/close', { method: 'PUT', token: caT, body: { closingCash: 100 } });
    ok(closeFail.status === 400, 'session close WITHOUT counts → 400 (strict)');

    const Product = require('../../backend/models/Product');
    const { runWithTenant } = require('../../backend/services/tenantContext');
    const prodDoc = await runWithTenant({ storeId: store._id, isSuper: false }, () =>
      Product.create({ name: { ar: 'Pneu 185/65 R15', fr: 'Pneu 185/65 R15' }, price: 7800, costPrice: 6000, stock: 20, barcode: '1234567890123' }));
    const sale = await api('/api/sales', {
      method: 'POST', token: caT,
      body: { items: [{ product: prodDoc._id, quantity: 2, price: 7800 }], paymentMethod: 'cash' }
    });
    ok(sale.status === 201, 'sale created (15600 cash)');
    const saleId = sale.json.data.sale._id;
    const saleNumber = sale.json.data.sale.saleNumber;

    const closeOk = await api('/api/sessions/' + sessionId + '/close', {
      method: 'PUT', token: caT,
      body: { closingCounts: { '2000': 9 }, notes: 'end of day' }
    });
    ok(closeOk.status === 200, 'session close with counts 200');
    ok(closeOk.json.data.session.actualCash === 18000, 'actualCash from counts (18000)');
    ok(closeOk.json.data.session.expectedCash === 18400, 'expectedCash = opening + cash sales (18400)');
    ok(closeOk.json.data.session.difference === -400, 'difference = -400');
    ok(closeOk.json.data.session.closingCounts && closeOk.json.data.session.closingCounts['2000'] === 9, 'closingCounts stored');

    const suSet = await api('/api/settings/cash-denominations', {
      method: 'PUT', token: suT,
      body: { denominations: [{ value: 5000, type: 'bill' }, { value: 1000, type: 'bill' }, { value: 500, type: 'bill' }, { value: 100, type: 'coin' }], applyToAll: true }
    });
    ok(suSet.status === 200 && suSet.json.data.appliedToAllStores >= 1, 'superadmin applyToAll pushed to all stores');
    const checkStore = await api('/api/settings/cash-denominations', { token: adT });
    ok(checkStore.json.data.denominations.length === 4 && checkStore.json.data.denominations[0].value === 5000, 'store received platform denominations automatically');

    const detail = await api('/api/sales/' + saleId, { token: caT });
    ok(detail.status === 200 && detail.json.data.sale.saleNumber === saleNumber, 'invoice detail by id (QR target) works');
    const detailSuper = await api('/api/sales/' + saleId, { token: suT });
    ok(detailSuper.status === 200, 'platform owner can open invoice by id');
  }

  /* ================= 6. AI brain (accurate local answers) ================= */
  console.log('\n== AI Assistant brain ==');
  {
    const q1 = await api('/api/ai/ask', { method: 'POST', token: adT, body: { question: 'كم مبيعات اليوم؟', lang: 'ar' } });
    ok(q1.status === 200, 'AI ask 200 (no Gemini key → local engine)');
    const a1 = (q1.json.data && q1.json.data.answer) || '';
    ok(/اليوم/.test(a1), 'today-sales intent answered in Arabic');
    ok(String(a1).includes('15600') || String(a1).includes('15,600'), 'today answer carries the EXACT revenue (15600)');

    const q2 = await api('/api/ai/ask', { method: 'POST', token: adT, body: { question: 'كيف أضيف منتجاً؟', lang: 'ar' } });
    const a2 = (q2.json.data && q2.json.data.answer) || '';
    ok(/المنتجات/.test(a2), 'system how-to answered from KB');

    const q3 = await api('/api/ai/ask', { method: 'POST', token: adT, body: { question: 'ما المنتجات قريبة النفاد؟', lang: 'ar' } });
    ok(q3.json.data.source === 'engine', 'source=engine reported');
    const a3 = (q3.json.data && q3.json.data.answer) || '';
    ok(/نفاد|لا نواقص|المستوى/.test(a3), 'low-stock intent answered');

    const q4 = await api('/api/ai/ask', { method: 'POST', token: adT, body: { question: 'كيف يعمل الدوام؟', lang: 'ar' } });
    const a4 = (q4.json.data && q4.json.data.answer) || '';
    ok(/الموظف/.test(a4), 'attendance KB answered');

    const qCash = await api('/api/ai/ask', { method: 'POST', token: caT, body: { question: 'مبيعات اليوم', lang: 'ar' } });
    ok(qCash.status === 403, 'cashier without ai.use blocked from AI (as before v4.5)');

    const qMan = await api('/api/ai/ask', { method: 'POST', token: maT, body: { question: 'مبيعات اليوم', lang: 'ar' } });
    ok(qMan.status === 200, 'manager can use AI (default)');

    const ins = await api('/api/ai/insights', { token: caT });
    ok(ins.status === 200, 'insights free engine still works for cashier');
  }

  /* ================= 7. offline queue replay safety ================= */
  console.log('\n== Offline queue replay (db.js semantics) ==');
  {
    const Product = require('../../backend/models/Product');
    const { runWithTenant } = require('../../backend/services/tenantContext');
    const p = await runWithTenant({ storeId: store._id, isSuper: false }, () =>
      Product.create({ name: { ar: 'Huile 5L', fr: 'Huile 5L' }, price: 3200, costPrice: 2500, stock: 10 }));
    const QueueBody = { items: [{ product: p._id, quantity: 1, price: 3200 }], paymentMethod: 'cash', offlineSync: true }; // replayed after session close
    const r = await api('/api/sales', { method: 'POST', token: caT, body: QueueBody });
    ok(r.status === 201, 'replayed offline sale accepted by server');
  }

  /* ================= 8. regression — legacy behavior intact ================= */
  console.log('\n== Regression guards ==');
  {
    const suSettings = await api('/api/settings', { token: suT });
    ok(suSettings.status === 200 && suSettings.json.data.settings, 'superadmin reads platform settings doc');

    const notif = await api('/api/notifications', { token: adT });
    ok(notif.status === 200, 'notifications list 200');

    const cust = await api('/api/customers', { method: 'POST', token: caT, body: { name: 'Walk-in VIP', phone: '0555444333' } });
    ok(cust.status === 201, 'customer create 201');
  }

  /* ================= done ================= */
  console.log('\n==============================');
  console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
  if (FAIL) { console.log('FAILED:', failures.join(' | ')); }
  try { await mongoose.connection.close(); } catch (_) {}
  process.exit(FAIL ? 1 : 0);
})().catch(e => {
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
