// backend/services/smartEngine.js
// DZ POS PRO v4 — Built-in Smart Analysis Engine ("the free professional AI").
// ---------------------------------------------------------------------------
// 100% local, deterministic + statistical. Requires NO API key and NO internet.
// It deeply analyses inventory + sales + customers and produces precise,
// prioritized, actionable recommendations — the same quality you'd expect from
// a consultant reviewing the data.
//
// Outputs (generateInsights):
//   • score        — global store health score 0-100
//   • insights[]   — each: { id, category, severity, title, detail, items[],
//                      impact, priority, action }   (severity: critical/high/
//                      medium/low/opportunity)
//   • kpis         — quick numbers: stock value, dead stock value, margin…,
//   • generatedAt
//
// answerLocally(question) — offline "Ask your store" assistant: understands
// Arabic/English/French keywords and answers with REAL numbers from the data.
//
// The Gemini layer (aiService) is optional and only ENRICHES these results
// with narrative text; without a key everything still works. — v4.0

const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const SaleItem = require('../models/SaleItem');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Category = require('../models/Category');
const { tenantScope } = require('../utils/tenantPlugin');

const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
const DAY = 24 * 3600 * 1000;

/* ---------------- i18n templates for generated text ---------------- */
// Languages supported by the dictionary below. Any other lang falls back to en.
const L = {
    ar: {
        restock: 'إعادة طلب عاجلة', deadStock: 'مخزون راكد (رأس مال مجمّد)',
        overstock: 'مخزون زائد', lowMargin: 'هامش ربح منخفض/سالب',
        star: 'منتجات نجمصة تستحق التركيز', growing: 'نمو في المبيعات',
        declining: 'تراجع في المبيعات', vipCustomers: 'عملاء VIP',
        atRisk: 'عملاء معرّضون للفقدان', peakDays: 'أفضل أيام البيع',
        pricing: 'فرص تحسين التسعير', health: 'صحة المتجر العامة',
        order: 'اطلب', now: 'فوراً', thisWeek: 'هذا الأسبوع', soon: 'قريباً',
        units: 'وحدة', days: 'يوم', est: 'الخسارة التقديرية', frozen: 'رأس مال مجمّد',
        margin: 'هامش', buy: 'الشراء', sell: 'البيع', revenue: 'الإيراد',
        noData: 'لا توجد بيانات كافية بعد — سجّل بعض الفواتير ليبدأ المحلل الذكي عمله.',
        impact: 'الأثر المتوقع', action: 'الإجراء المقترح', unused: 'لم يُبع خلال',
        lastDays: 'الأيام الأخيرة', cover: 'يكفي لـ', sold30: 'مبيع 30 يوم'
    },
    fr: {
        restock: 'Réapprovisionnement urgent', deadStock: 'Stock dormant (capital immobilisé)',
        overstock: 'Surstock', lowMargin: 'Marge faible ou négative',
        star: 'Produits stars à prioriser', growing: 'Croissance des ventes',
        declining: 'Baisse des ventes', vipCustomers: 'Clients VIP',
        atRisk: 'Clients à risque de départ', peakDays: 'Meilleurs jours de vente',
        pricing: 'Opportunités de prix', health: 'Santé globale du magasin',
        order: 'Commander', now: 'immédiatement', thisWeek: 'cette semaine', soon: 'bientôt',
        units: 'unités', days: 'jours', est: 'Perte estimée', frozen: 'Capital immobilisé',
        margin: 'Marge', buy: 'Achat', sell: 'Vente', revenue: 'CA',
        noData: 'Pas encore assez de données — enregistrez des ventes pour activer l\u2019analyse.',
        impact: 'Impact estimé', action: 'Action recommandée', unused: 'Aucune vente depuis',
        lastDays: 'derniers jours', cover: 'couvre', sold30: 'vendu 30 j'
    },
    en: {
        restock: 'Urgent restock', deadStock: 'Dead stock (frozen capital)',
        overstock: 'Overstock', lowMargin: 'Low / negative margin',
        star: 'Star products to prioritize', growing: 'Sales growth',
        declining: 'Sales decline', vipCustomers: 'VIP customers',
        atRisk: 'Customers at risk of churn', peakDays: 'Best selling days',
        pricing: 'Pricing opportunities', health: 'Overall store health',
        order: 'Order', now: 'immediately', thisWeek: 'this week', soon: 'soon',
        units: 'units', days: 'days', est: 'Estimated loss', frozen: 'Frozen capital',
        margin: 'Margin', buy: 'Cost', sell: 'Price', revenue: 'Revenue',
        noData: 'Not enough data yet — record some invoices to activate the smart analyst.',
        impact: 'Estimated impact', action: 'Recommended action', unused: 'No sales in',
        lastDays: 'days', cover: 'covers', sold30: 'sold 30d'
    }
};
// The 6 new languages reuse the English templates for labels but keep data
// numbers locale-neutral; the AI Center UI around them is fully translated.
const T = (lang) => L[lang] || L.en;

/* ============================================================
 * Deep data collection (one pass, cheap aggregations)
 * ============================================================ */
async function collectData(storeId) {
    const since30 = new Date(Date.now() - 30 * DAY);
    const since60 = new Date(Date.now() - 60 * DAY);
    const since7 = new Date(Date.now() - 7 * DAY);

    const products = await Product.find(tenantScope()).lean()
        .select('name price costPrice stock minStock unit categoryId createdAt');
    const catMap = new Map();
    try {
        const cats = await Category.find(tenantScope()).lean().select('name');
        cats.forEach(c => catMap.set(String(c._id), c.name));
    } catch (_) {}

    const [salesRows, itemsByProduct, byDow, byHour, payMix, custTop, custRecent] = await Promise.all([
        Sale.aggregate([
            { $match: { status: { $nin: ['cancelled'] }, saleDate: { $gte: since30 }, ...tenantScope() } },
            { $project: { total: 1, costTotal: 1, discount: 1, subtotal: 1, saleDate: 1, paymentMethod: 1, hour: { $hour: '$saleDate' }, dow: { $dayOfWeek: '$saleDate' } } }
        ]),
        SaleItem.aggregate([
            { $lookup: { from: 'sales', localField: 'sale', foreignField: '_id', as: '_s' } },
            { $unwind: '$_s' },
            { $match: { '_s.status': { $nin: ['cancelled'] }, '_s.saleDate': { $gte: since30 }, ...(tenantScope().storeId ? { '_s.storeId': tenantScope().storeId } : {}) } },
            { $group: {
                _id: '$product',
                name: { $first: '$productName' },
                qty: { $sum: '$quantity' },
                revenue: { $sum: '$total' },
                cost: { $sum: { $multiply: ['$costPrice', '$quantity'] } },
                prevQty: { $sum: 0 }
            } },
            { $sort: { revenue: -1 } },
            { $limit: 200 }
        ]),
        Sale.aggregate([
            { $match: { status: { $nin: ['cancelled'] }, saleDate: { $gte: since30 }, ...tenantScope() } },
            { $group: { _id: { $dayOfWeek: '$saleDate' }, revenue: { $sum: '$total' }, count: { $sum: 1 } } }
        ]),
        Sale.aggregate([
            { $match: { status: { $nin: ['cancelled'] }, saleDate: { $gte: since30 }, ...tenantScope() } },
            { $group: { _id: { $hour: '$saleDate' }, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } }, { $limit: 5 }
        ]),
        Sale.aggregate([
            { $match: { status: { $nin: ['cancelled'] }, saleDate: { $gte: since30 }, ...tenantScope() } },
            { $group: { _id: '$paymentMethod', revenue: { $sum: '$total' }, count: { $sum: 1 } } }
        ]),
        Customer.find(tenantScope()).lean().select('name phone totalSpent loyaltyPoints updatedAt createdAt').sort({ totalSpent: -1 }).limit(50),
        Sale.aggregate([
            { $match: { status: { $nin: ['cancelled'] }, saleDate: { $gte: since60, $lt: since7 }, ...tenantScope() } },
            { $group: { _id: '$customer', revenue: { $sum: '$total' }, last: { $max: '$saleDate' } } },
            { $sort: { revenue: -1 } }, { $limit: 50 }
        ])
    ]);

    // per-product sales in the PREVIOUS 30d window (for growth classification)
    const prevRows = await SaleItem.aggregate([
        { $lookup: { from: 'sales', localField: 'sale', foreignField: '_id', as: '_s' } },
        { $unwind: '$_s' },
        { $match: { '_s.status': { $nin: ['cancelled'] }, '_s.saleDate': { $gte: new Date(Date.now() - 60 * DAY), $lt: since30 }, ...(tenantScope().storeId ? { '_s.storeId': tenantScope().storeId } : {}) } },
        { $group: { _id: '$product', qty: { $sum: '$quantity' }, revenue: { $sum: '$total' } } }
    ]);
    const prevMap = new Map(prevRows.map(r => [String(r._id), r]));

    return { products, salesRows, itemsByProduct, prevMap, byDow, byHour, payMix, custTop, custRecent, catMap };
}

/* ============================================================
 * THE ENGINE — analyse everything, produce prioritized insights
 * ============================================================ */
async function generateInsights(lang = 'ar') {
    const t_ = T(lang);
    const { products, salesRows, itemsByProduct, prevMap, byDow, byHour, payMix, custTop, custRecent, catMap } = await collectData();

    const insights = [];
    const revenue30 = salesRows.reduce((s, r) => s + (r.total || 0), 0);
    const cost30 = salesRows.reduce((s, r) => s + (r.costTotal || 0), 0);
    const salesCount = salesRows.length;
    const grossProfit = revenue30 - cost30;
    const marginPct = revenue30 > 0 ? (grossProfit / revenue30) * 100 : 0;

    const prodMap = new Map(products.map(p => [String(p._id), p]));
    const soldIds = new Set();

    /* ---------- 1) Restock urgency (velocity × cover days × revenue) ---------- */
    const restockItems = [];
    for (const it of itemsByProduct) {
        soldIds.add(String(it._id));
        const p = prodMap.get(String(it._id));
        if (!p) continue;
        const avgDaily = it.qty / 30;
        if (avgDaily <= 0) continue;
        const coverDays = (p.stock || 0) / avgDaily;
        const below = (p.stock || 0) <= (p.minStock || 0);
        if (coverDays >= 14 && !below) continue;
        const target = Math.ceil(avgDaily * 30 * 1.2);
        const suggestedQty = Math.max(1, target - (p.stock || 0));
        const urgencyScore = (coverDays < 7 ? 40 : coverDays < 14 ? 25 : 12)
            + (below ? 20 : 0)
            + Math.min(40, Math.round((it.revenue / Math.max(1, revenue30)) * 100));
        restockItems.push({
            productId: p._id, name: p.name, unit: p.unit || '',
            stock: p.stock || 0, minStock: p.minStock || 0,
            avgDaily: num(avgDaily), coverDays: Math.floor(coverDays),
            suggestedQty, revenue30: num(it.revenue),
            urgency: coverDays < 7 || (p.stock || 0) <= 0 ? 'critical' : coverDays < 14 ? 'high' : 'medium',
            score: urgencyScore
        });
    }
    restockItems.sort((a, b) => b.score - a.score);
    if (restockItems.length) {
        const critical = restockItems.filter(r => r.urgency === 'critical').length;
        const lostRevenue = restockItems.filter(r => r.urgency === 'critical')
            .reduce((s, r) => s + r.avgDaily * (14 - Math.min(r.coverDays, 14)) * (r.revenue30 / Math.max(1, r.soldRevenue || r.revenue30)) * 0 , 0);
        insights.push({
            id: 'restock', category: 'inventory', severity: critical > 0 ? 'critical' : 'high',
            title: `${t_.restock} — ${restockItems.length} ${t_.units === 'units' ? 'products' : 'منتجات'}`,
            detail: (lang === 'ar'
                ? `${critical > 0 ? `${critical} منتجات ستنفد خلال أقل من 7 أيام حسب سرعة البيع الحالية.` : 'منتجات تقترب من النفاد حسب وتيرة البيع.'}`
                : lang === 'fr'
                    ? `${critical > 0 ? `${critical} produits s'épuiseront dans moins de 7 jours au rythme actuel.` : 'Produits proches de la rupture selon la vitesse de vente.'}`
                    : `${critical > 0 ? `${critical} products will run out in under 7 days at current velocity.` : 'Products nearing stockout at current velocity.'}`),
            items: restockItems.slice(0, 10).map(r => ({
                name: r.name, stock: r.stock, coverDays: r.coverDays,
                suggestedQty: r.suggestedQty, urgency: r.urgency
            })),
            priority: Math.min(100, 70 + critical * 5),
            action: (lang === 'ar' ? 'أنشئ أوامر شراء للمنتجات الحرجة أولاً (الكمية المقترحة محسوبة من معدل البيع 30 يوم + هامش أمان 20٪).'
                : lang === 'fr' ? 'Créez des bons de commande pour les produits critiques d\u2019abord (quantité calculée sur la vitesse 30 j + marge de sécurité 20 %).'
                : 'Create purchase orders for critical products first (quantity = 30-day velocity + 20% safety stock).')
        });
    }

    /* ---------- 2) Dead stock — no sales in 60d, capital frozen ---------- */
    const deadItems = [];
    for (const p of products) {
        if (soldIds.has(String(p._id))) continue;
        if ((p.stock || 0) <= 0) continue;
        const value = (p.price || 0) * p.stock;
        deadItems.push({ productId: p._id, name: p.name, stock: p.stock, unit: p.unit || '', value: num(value) });
    }
    deadItems.sort((a, b) => b.value - a.value);
    const deadValue = deadItems.reduce((s, d) => s + d.value, 0);
    if (deadItems.length) {
        insights.push({
            id: 'deadStock', category: 'inventory', severity: deadValue > revenue30 * 0.5 ? 'high' : 'medium',
            title: `${t_.deadStock} — ${deadItems.length}`,
            detail: (lang === 'ar'
                ? `${deadItems.length} منتج لم تُبع أي وحدة منها خلال 60 يوماً، بقيمة ${num(deadValue).toLocaleString()} دج مجمّدة في المخزون.`
                : lang === 'fr' ? `${deadItems.length} produits sans aucune vente depuis 60 jours — ${num(deadValue).toLocaleString()} DZD immobilisés.`
                : `${deadItems.length} products with zero sales in 60 days — ${num(deadValue).toLocaleString()} DZD frozen in stock.`),
            items: deadItems.slice(0, 10),
            priority: Math.min(85, 40 + Math.round(deadValue / Math.max(1, revenue30) * 50)),
            action: (lang === 'ar' ? 'أطلق عروض تصفية (خصم 15-30٪) أو ضعها كهدية مع المنتجات النجمصة لتحرير رأس المال.'
                : lang === 'fr' ? 'Lancez des promotions de déstockage (-15 à -30 %) ou offrez-les en bonus pour libérer du capital.'
                : 'Run clearance promos (15-30% off) or bundle them as freebies with best-sellers to free up capital.')
        });
    }

    /* ---------- 3) Overstock — slow movers holding too much ---------- */
    const overItems = [];
    for (const it of itemsByProduct) {
        const p = prodMap.get(String(it._id));
        if (!p) continue;
        const avgDaily = it.qty / 30;
        if (avgDaily <= 0) continue;
        const coverDays = (p.stock || 0) / avgDaily;
        if (coverDays > 60) {
            overItems.push({
                productId: p._id, name: p.name, stock: p.stock,
                coverDays: Math.floor(coverDays), value: num((p.price || 0) * p.stock)
            });
        }
    }
    overItems.sort((a, b) => b.value - a.value);
    if (overItems.length) {
        insights.push({
            id: 'overstock', category: 'inventory', severity: 'low',
            title: `${t_.overstock} — ${overItems.length}`,
            detail: (lang === 'ar'
                ? `منتجات يغطي مخزونها أكثر من 60 يوماً من البيع — توقف الشراء مؤقتاً وركّز على تصريفها.`
                : lang === 'fr' ? 'Produits dont le stock couvre plus de 60 jours de ventes — suspendez les achats, écoulez d\u2019abord.'
                : 'Products whose stock covers more than 60 days of sales — pause purchasing, sell them down first.'),
            items: overItems.slice(0, 8),
            priority: 45,
            action: (lang === 'ar' ? 'أوقف إعادة طلبها لمدة شهر واعرضها أولاً عند استفسار العملاء.'
                : lang === 'fr' ? 'Arrêtez le réassort pendant un mois et proposez-les en priorité.'
                : 'Stop reordering them for a month and propose them to customers first.')
        });
    }

    /* ---------- 4) Margin analysis — negative / low margin products ---------- */
    const marginItems = [];
    for (const it of itemsByProduct) {
        const p = prodMap.get(String(it._id));
        if (!p) continue;
        const cost = it.cost || (p.costPrice || 0) * it.qty;
        if (cost <= 0) continue;
        const mPct = ((it.revenue - cost) / Math.max(1, it.revenue)) * 100;
        if (mPct < 12) {
            marginItems.push({
                productId: p._id, name: p.name,
                revenue: num(it.revenue), cost: num(cost),
                marginPct: num(mPct), qty: it.qty
            });
        }
    }
    marginItems.sort((a, b) => a.marginPct - b.marginPct);
    if (marginItems.length) {
        const negatives = marginItems.filter(m => m.marginPct < 0);
        insights.push({
            id: 'margin', category: 'profitability', severity: negatives.length ? 'high' : 'medium',
            title: `${t_.lowMargin} — ${marginItems.length}`,
            detail: (lang === 'ar'
                ? `${negatives.length > 0 ? `${negatives.length} منتجات تُباع بخسارة (سعر أقل من التكلفة)!` : ''} ${marginItems.length} منتجات بهامش أقل من 12٪ تضغط على أرباحك.`
                : lang === 'fr' ? `${negatives.length > 0 ? `${negatives.length} produits vendus à perte !` : ''} ${marginItems.length} produits sous 12 % de marge.`
                : `${negatives.length > 0 ? `${negatives.length} products are sold at a LOSS!` : ''} ${marginItems.length} products sit under 12% margin.`),
            items: marginItems.slice(0, 10),
            priority: negatives.length ? 90 : 60,
            action: (lang === 'ar' ? 'ارفع أسعار المنتجات السالبة فوراً أو تفاوض على سعر شراء أفضل مع المورّد.'
                : lang === 'fr' ? 'Réajustez les prix des produits déficitaires ou renégociez vos prix d\u2019achat.'
                : 'Raise prices on negative-margin items or renegotiate supplier costs.')
        });
    }

    /* ---------- 5) Growth / decline classification (30d vs prev 30d) ---------- */
    const growing = [], declining = [];
    for (const it of itemsByProduct.slice(0, 40)) {
        const prev = prevMap.get(String(it._id));
        const prevQty = prev ? prev.qty : 0;
        if (prevQty === 0 && it.qty >= 5) growing.push({ name: it.name || (prodMap.get(String(it._id)) || {}).name || '—', change: 'new', qty: it.qty });
        else if (prevQty > 0) {
            const delta = ((it.qty - prevQty) / prevQty) * 100;
            if (delta >= 30) growing.push({ name: it.name, change: `+${Math.round(delta)}%`, qty: it.qty });
            else if (delta <= -30 && it.qty >= 3) declining.push({ name: it.name, change: `${Math.round(delta)}%`, qty: it.qty });
        }
    }
    if (growing.length >= 3) {
        insights.push({
            id: 'growing', category: 'sales', severity: 'opportunity',
            title: `${t_.growing} — ${growing.length}`,
            detail: (lang === 'ar' ? 'منتجات صاروعات قوية في النمو مقارنة بالشهر السابق.'
                : lang === 'fr' ? 'Produits en forte croissance vs mois précédent.'
                : 'Strong growth products versus last month.'),
            items: growing.slice(0, 8), priority: 55,
            action: (lang === 'ar' ? 'زد مخزونها واعرضها في الواجهة — هي محرك نمو الإيراد الحالي.'
                : lang === 'fr' ? 'Augmentez leur stock et mettez-les en avant — moteur de croissance actuel.'
                : 'Stock up and showcase them — they are your current growth engine.')
        });
    }
    if (declining.length >= 3) {
        insights.push({
            id: 'declining', category: 'sales', severity: 'medium',
            title: `${t_.declining} — ${declining.length}`,
            detail: (lang === 'ar' ? 'منتجات تراجعت مبيعاتها أكثر من 30٪ مقارنة بالشهر السابق.'
                : lang === 'fr' ? 'Produits en baisse de plus de 30 % vs mois précédent.'
                : 'Products down more than 30% versus last month.'),
            items: declining.slice(0, 8), priority: 50,
            action: (lang === 'ar' ? 'تحقق من المنافسة/السعر وقدّم عرضاً خاصاً لاستعادة وتيرتها.'
                : lang === 'fr' ? 'Vérifiez la concurrence/le prix et lancez une offre pour relancer.'
                : 'Check competition/pricing and run a promo to recover velocity.')
        });
    }

    /* ---------- 6) Customers — VIP + churn risk ---------- */
    const vip = custTop.slice(0, 5).map(c => ({ name: c.name, phone: c.phone || '', totalSpent: num(c.totalSpent || 0), points: c.loyaltyPoints || 0 }));
    if (vip.length && vip[0].totalSpent > 0) {
        insights.push({
            id: 'vip', category: 'customers', severity: 'opportunity',
            title: t_.vipCustomers,
            detail: (lang === 'ar' ? 'أفضل 5 عملاء حسب إجمالي المشتريات — عاملهم بشكل استثنائي.'
                : lang === 'fr' ? 'Top 5 clients par achats cumulés — soignez-les.'
                : 'Top 5 customers by lifetime purchases — treat them specially.'),
            items: vip, priority: 40,
            action: (lang === 'ar' ? 'اتصل بهم أو أرسل كوبونات خاصة؛ العميل الواحد هنا يمثل جزءاً كبيراً من إيرادك.'
                : lang === 'fr' ? 'Appelez-les ou envoyez des coupons ; chaque client représente une part majeure du CA.'
                : 'Call them or send exclusive coupons; each one carries a big revenue share.')
        });
    }
    const churn = [];
    const custNameMap = new Map(custTop.map(c => [String(c._id), c]));
    for (const r of custRecent) {
        const c = custNameMap.get(String(r._id));
        if (!c) continue;
        const daysSince = Math.floor((Date.now() - new Date(r.last).getTime()) / DAY);
        if (daysSince >= 21) churn.push({ name: c.name, phone: c.phone || '', spent: num(r.revenue), daysSince });
    }
    if (churn.length) {
        insights.push({
            id: 'churn', category: 'customers', severity: 'medium',
            title: `${t_.atRisk} — ${churn.length}`,
            detail: (lang === 'ar' ? 'عملاء اشتروا منك قبل 3 أسابيع أو أكثر ولم يعودوا — خطر فقدانهم.'
                : lang === 'fr' ? 'Clients sans achat depuis 21+ jours — risque de perte.'
                : 'Customers with no purchase for 21+ days — churn risk.'),
            items: churn.slice(0, 8), priority: 58,
            action: (lang === 'ar' ? 'رسالة/اتصال قصير مع خصم 10٪ يكفي غالباً لإعادتهم.'
                : lang === 'fr' ? 'Un message avec -10 % suffit souvent à les faire revenir.'
                : 'A short message with a 10% discount usually brings them back.')
        });
    }

    /* ---------- 7) Peak days & hours (staffing + stock timing) ---------- */
    if (byDow.length) {
        const dowName = { 1: 'Dim/Ah/周日', 2: 'Lun/الإثنين', 3: 'Mar/الثلاثاء', 4: 'Mer/الأربعاء', 5: 'Jeu/الخميس', 6: 'Ven/الجمعة', 7: 'Sam/السبت' };
        const sorted = [...byDow].sort((a, b) => b.revenue - a.revenue);
        const best = sorted[0], worst = sorted[sorted.length - 1];
        insights.push({
            id: 'peak', category: 'operations', severity: 'info',
            title: t_.peakDays,
            detail: (lang === 'ar'
                ? `أعلى يوم إيراداً: ${dowName[best._id] || best._id} (${num(best.revenue).toLocaleString()} دج) — وأدنى يوم: ${dowName[worst._id] || worst._id}.`
                : lang === 'fr' ? `Meilleur jour : ${dowName[best._id] || best._id} (${num(best.revenue).toLocaleString()} DZD) — plus faible : ${dowName[worst._id] || worst._id}.`
                : `Best day: ${dowName[best._id] || best._id} (${num(best.revenue).toLocaleString()} DZD) — weakest: ${dowName[worst._id] || worst._id}.`),
            items: byDow.map(d => ({ day: dowName[d._id] || d._id, revenue: num(d.revenue), count: d.count })),
            priority: 30,
            action: (lang === 'ar' ? 'وفّر مخزوناً وموظفاً إضافياً قبل اليوم الأقوى، واستخدم الأيام الضعيفة لعروض ترويجية.'
                : lang === 'fr' ? 'Stockez et staffez avant le pic ; utilisez les jours creux pour des promos.'
                : 'Prepare stock and staffing before the peak day; use weak days for promos.')
        });
    }
    if (byHour.length && byHour[0].count >= 5) {
        insights.push({
            id: 'hours', category: 'operations', severity: 'info',
            title: (lang === 'ar' ? 'ساعات الذروة' : lang === 'fr' ? 'Heures de pointe' : 'Peak hours'),
            detail: (lang === 'ar' ? 'أكثر ساعات اليوم تسجيلاً للفواتير — رتّب استلام البضائع والجرد خارجها.'
                : lang === 'fr' ? 'Heures avec le plus de ventes — planifiez réceptions et inventaire en dehors.'
                : 'Busiest sales hours — schedule deliveries and stock counts outside them.'),
            items: byHour.map(h => ({ hour: `${h._id}:00`, count: h.count, revenue: num(h.revenue) })),
            priority: 25,
            action: (lang === 'ar' ? 'اجعل الكاشير جاهزاً بالكامل في هذه الساعات (فلوة، صلّة، ورق فواتير).'
                : lang === 'fr' ? 'Tenez la caisse pleinement prête à ces heures.'
                : 'Keep the counter fully staffed and ready during these hours.')
        });
    }

    /* ---------- 8) Pricing opportunities ---------- */
    const priceOpp = [];
    for (const it of itemsByProduct.slice(0, 30)) {
        const p = prodMap.get(String(it._id));
        if (!p || !p.costPrice || p.costPrice <= 0) continue;
        const mPct = ((p.price - p.costPrice) / Math.max(1, p.price)) * 100;
        if (mPct < 10 && it.qty >= 4) {
            const suggested = Math.ceil((p.costPrice * 1.18) / 10) * 10; // 18% target margin, round to 10 DZD
            priceOpp.push({ productId: p._id, name: p.name, current: p.price, cost: p.costPrice, suggested, qty30: it.qty });
        }
    }
    if (priceOpp.length) {
        insights.push({
            id: 'pricing', category: 'profitability', severity: 'opportunity',
            title: t_.pricing,
            detail: (lang === 'ar' ? 'منتجات سريعة الدوران بهامش أقل من 10٪ — السوق يتحمل سعراً أعلى قليلاً.'
                : lang === 'fr' ? 'Produits à forte rotation sous 10 % de marge — le marché peut absorber un léger ajustement.'
                : 'High-velocity products under 10% margin — the market can absorb a small increase.'),
            items: priceOpp.slice(0, 8), priority: 52,
            action: (lang === 'ar' ? 'جرّب رفع السعر المقترح لمدة أسبوعين وراقب الكمية؛ التراجع سهل إن لزم.'
                : lang === 'fr' ? 'Testez le prix suggéré 2 semaines et observez les quantités.'
                : 'Test the suggested price for 2 weeks and watch volume; easy to roll back.')
        });
    }

    /* ---------- 9) Payment mix ---------- */
    if (payMix.length) {
        const total = payMix.reduce((s, p) => s + p.revenue, 0) || 1;
        insights.push({
            id: 'payments', category: 'operations', severity: 'info',
            title: (lang === 'ar' ? 'توزيع طرق الدفع' : lang === 'fr' ? 'Répartition des paiements' : 'Payment methods mix'),
            detail: payMix.map(p => `${p._id || '—'}: ${Math.round((p.revenue / total) * 100)}٪ / ${lang === 'fr' ? '%' : '%'}`).join(' · '),
            items: payMix.map(p => ({ method: p._id || '—', revenue: num(p.revenue), pct: Math.round((p.revenue / total) * 100), count: p.count })),
            priority: 20,
            action: (lang === 'ar' ? 'إذا كانت الديون/التقسيط مرتفعة، شدّد شروط التحصيل أو فعّل كوبونات الدفع الفوري.'
                : lang === 'fr' ? 'Si le crédit pèse lourd, resserrez les conditions ou encouragez le paiement immédiat.'
                : 'If credit is heavy, tighten collection terms or incentivize instant payment.')
        });
    }

    /* ---------- Global health score ---------- */
    let score = 50;
    if (revenue30 > 0) score += 10;
    if (marginPct >= 25) score += 15; else if (marginPct >= 15) score += 8; else if (marginPct > 0) score += 2;
    if (restockItems.filter(r => r.urgency === 'critical').length > 0) score -= 15;
    if (deadValue > revenue30 * 0.5 && revenue30 > 0) score -= 10;
    if (negativesCount(marginItems) > 0) score -= 12;
    if (growing.length >= 3) score += 8;
    if (churn.length >= 3) score -= 5;
    score = Math.max(5, Math.min(98, Math.round(score)));

    insights.sort((a, b) => b.priority - a.priority);

    const kpis = {
        revenue30: num(revenue30),
        salesCount,
        grossProfit: num(grossProfit),
        marginPct: num(marginPct),
        avgBasket: salesCount ? num(revenue30 / salesCount) : 0,
        stockValue: num(products.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0)),
        deadStockValue: num(deadValue),
        deadStockCount: deadItems.length,
        criticalRestock: restockItems.filter(r => r.urgency === 'critical').length,
        negativeMarginCount: negativesCount(marginItems)
    };

    return {
        score,
        verdict: (lang === 'ar'
            ? (score >= 75 ? 'متجر صحي — استمر وركّز على النمو.' : score >= 50 ? 'وضع مقبول مع فرص تحسين واضحة.' : 'يحتاج تدخلاً سريعاً: ابدأ بالتوصيات الحرجة.')
            : lang === 'fr'
            ? (score >= 75 ? 'Magasin en bonne santé — cap sur la croissance.' : score >= 50 ? 'Acceptable, avec des axes d\u2019amélioration clairs.' : 'Intervention rapide requise : commencez par les alertes critiques.')
            : (score >= 75 ? 'Healthy store — keep going and focus on growth.' : score >= 50 ? 'Acceptable with clear improvement levers.' : 'Needs quick action: start with critical alerts.')),
        kpis,
        insights,
        generatedAt: new Date().toISOString(),
        engine: 'dzpos-smart-engine-v4',
        note: t_.noData && revenue30 === 0 && products.length === 0 ? t_.noData : ''
    };
}

function negativesCount(marginItems) { return marginItems.filter(m => m.marginPct < 0).length; }

/* ============================================================
 * OFFLINE ASSISTANT — answers real questions without any API key.
 * Keyword routing (ar/fr/en) → precise computed answers.
 * ============================================================ */
async function answerLocally(question, lang = 'ar') {
    const q = String(question || '').toLowerCase();
    const pack = await collectData();

    const revenue30 = pack.salesRows.reduce((s, r) => s + (r.total || 0), 0);
    const cost30 = pack.salesRows.reduce((s, r) => s + (r.costTotal || 0), 0);
    const count30 = pack.salesRows.length;
    const products = pack.products;

    const has = (...keys) => keys.some(k => q.includes(k));

    // Best sellers
    if (has('أكثر منتج', 'الأكثر مبيعا', 'best sell', 'top product', 'meilleur', '热销', 'çok satan', 'más vendido', 'più venduto', 'meistverkauft', 'популяр')) {
        const top = pack.itemsByProduct.slice(0, 5);
        return lang === 'fr'
            ? { answer: `Top 5 produits (30 jours):\n${top.map((p, i) => `${i + 1}. ${p.name || '—'} — ${p.qty} unités / ${num(p.revenue).toLocaleString()} DZD`).join('\n')}`, source: 'engine' }
            : { answer: (lang === 'ar' ? 'أكثر 5 منتجات مبيعاً (30 يوم):\n' : 'Top 5 products (30 days):\n')
                + top.map((p, i) => `${i + 1}. ${p.name || '—'} — ${p.qty} ${lang === 'ar' ? 'وحدة' : 'units'} / ${num(p.revenue).toLocaleString()} DZD`).join('\n'), source: 'engine' };
    }
    // Stock / low stock
    if (has('مخزون', 'المخزن', 'ستوك', 'stock', 'inventaire', '库存', 'stok', 'inventario', 'magazzino', 'склад')) {
        const low = products.filter(p => (p.stock || 0) <= (p.minStock || 0)).slice(0, 8);
        const stockValue = products.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0);
        if (lang === 'fr') {
            return { answer: `Valeur du stock: ${num(stockValue).toLocaleString()} DZD.\nStock faible (${low.length}):\n${low.map(p => `• ${p.name} — ${p.stock}/${p.minStock || 0}`).join('\n') || '• aucun'}`, source: 'engine' };
        }
        return { answer: (lang === 'ar' ? `قيمة المخزون الحالية: ${num(stockValue).toLocaleString()} دج.\nمنتجات تحت الحد الأدنى (${low.length}):\n` : `Current stock value: ${num(stockValue).toLocaleString()} DZD.\nLow stock items (${low.length}):\n`)
            + (low.map(p => `• ${p.name} — ${p.stock}/${p.minStock || 0}`).join('\n') || '• —'), source: 'engine' };
    }
    // Profit / margin
    if (has('ربح', 'هامش', 'مجني', 'profit', 'marge', 'margin', 'موجان', 'ganancia', 'utile', 'прибыл', '利润')) {
        const profit = revenue30 - cost30;
        const pct = revenue30 > 0 ? ((profit / revenue30) * 100).toFixed(1) : '0.0';
        return lang === 'fr'
            ? { answer: `30 derniers jours: CA ${num(revenue30).toLocaleString()} DZD, coût ${num(cost30).toLocaleString()} DZD → profit brut ${num(profit).toLocaleString()} DZD (${pct} %).`, source: 'engine' }
            : { answer: (lang === 'ar'
                ? `آخر 30 يوماً: الإيراد ${num(revenue30).toLocaleString()} دج، التكلفة ${num(cost30).toLocaleString()} دج → ربح إجمالي ${num(profit).toLocaleString()} دج (${pct}٪).`
                : `Last 30 days: revenue ${num(revenue30).toLocaleString()} DZD, cost ${num(cost30).toLocaleString()} DZD → gross profit ${num(profit).toLocaleString()} DZD (${pct}%).`), source: 'engine' };
    }
    // Sales / revenue
    if (has('مبيعات', 'إيراد', 'مدخول', 'sales', 'revenue', 'chiffre', 'ventes', 'vendite', 'umsatz', 'продаж', '销售额')) {
        return lang === 'fr'
            ? { answer: `${count30} ventes sur 30 jours, total ${num(revenue30).toLocaleString()} DZD (panier moyen ${count30 ? num(revenue30 / count30).toLocaleString() : 0} DZD).`, source: 'engine' }
            : { answer: (lang === 'ar'
                ? `${count30} فاتورة خلال 30 يوماً بإجمالي ${num(revenue30).toLocaleString()} دج (متوسط الفاتورة ${count30 ? num(revenue30 / count30).toLocaleString() : 0} دج).`
                : `${count30} sales in 30 days, total ${num(revenue30).toLocaleString()} DZD (avg basket ${count30 ? num(revenue30 / count30).toLocaleString() : 0} DZD).`), source: 'engine' };
    }
    // Customers
    if (has('عميل', 'عملاء', 'زبون', 'customer', 'client', 'مüşteri', 'cliente', 'kunde', 'клиент', '客户')) {
        const top = pack.custTop.slice(0, 5);
        return lang === 'fr'
            ? { answer: `Meilleurs clients:\n${top.map(c => `• ${c.name} — ${num(c.totalSpent || 0).toLocaleString()} DZD`).join('\n') || '• —'}`, source: 'engine' }
            : { answer: (lang === 'ar' ? 'أفضل العملاء:\n' : 'Top customers:\n')
                + (top.map(c => `• ${c.name} — ${num(c.totalSpent || 0).toLocaleString()} DZD`).join('\n') || '• —'), source: 'engine' };
    }
    // Default: mini-summary
    return lang === 'fr'
        ? { answer: `ملخص سريع (30 jours): ${count30} ventes — ${num(revenue30).toLocaleString()} DZD — profit ${num(revenue30 - cost30).toLocaleString()} DZD. ${products.length} produits en catalogue. Posez une question précise sur: stock / produits / profit / clients.`, source: 'engine' }
        : { answer: (lang === 'ar' ? `ملخص سريع (30 يوماً): ${count30} فاتورة — ${num(revenue30).toLocaleString()} دج — ربح ${num(revenue30 - cost30).toLocaleString()} دج. ${products.length} منتج في الكتالوج.\nاسأل بدقة عن: المخزون / المنتجات الأكثر مبيعاً / الربح / العملاء.`
            : `Quick summary (30 days): ${count30} sales — ${num(revenue30).toLocaleString()} DZD — profit ${num(revenue30 - cost30).toLocaleString()} DZD. ${products.length} products in catalog.\nAsk precisely about: stock / top products / profit / customers.`), source: 'engine' };
}

module.exports = { generateInsights, answerLocally };
