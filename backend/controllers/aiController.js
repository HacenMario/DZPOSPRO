// backend/controllers/aiController.js
// DZ POS PRO v3 — AI features endpoints (all tenant-scoped).
const aiService = require('../services/aiService');
const gemini = require('../services/geminiService');
const { successResponse, errorResponse } = require('../utils/response');
const { getTranslation } = require('../config/i18n');
const logger = require('../utils/logger');

const errLang = {
    AI_NOT_CONFIGURED: { ar: 'لم يتم ضبط مفتاح Gemini بعد. أضفه من الإعدادات.', fr: 'Clé Gemini non configurée. Ajoutez-la dans les paramètres.', en: 'Gemini key not configured. Add it in Settings.' },
    AI_QUOTA: { ar: 'تم استهلاك حصة الذكاء الاصطناعي لهذا المتجر اليوم. جرّب غداً.', fr: 'Quota IA du magasin épuisé pour aujourd\'hui. Réessayez demain.', en: 'Store AI quota exhausted for today. Try again tomorrow.' },
    AI_UNAVAILABLE: { ar: 'خدمة الذكاء الاصطناعي غير متاحة حالياً. حاول لاحقاً.', fr: 'Service IA indisponible. Réessayez plus tard.', en: 'AI service unavailable. Try again later.' },
    AI_BAD_REQUEST: { ar: 'طلب غير صالح للذكاء الاصطناعي.', fr: 'Requête IA invalide.', en: 'Invalid AI request.' },
    AI_PARSE: { ar: 'تعذر تحليل استجابة الذكاء الاصطناعي.', fr: 'Réponse IA illisible.', en: 'Could not parse AI response.' },
    AI_STORE_LIMIT: { ar: 'تجاوزت الحد اليومي لاستخدام الذكاء الاصطناعي.', fr: 'Limite quotidienne d\'usage IA atteinte.', en: 'Daily AI usage limit reached.' }
};

function aiError(res, err, lang) {
    const code = err.code || 'AI_UNAVAILABLE';
    if (err.code === 'AI_QUOTA_STORE') return errorResponse(res, 429, errLang.AI_STORE_LIMIT[lang] || errLang.AI_STORE_LIMIT.en);
    const msg = errLang[code] ? (errLang[code][lang] || errLang[code].en) : (errLang.AI_UNAVAILABLE[lang] || errLang.AI_UNAVAILABLE.en);
    return errorResponse(res, code === 'AI_NOT_CONFIGURED' ? 400 : 502, msg);
}

// POST /api/ai/ask  { question, lang }
const ask = async (req, res, next) => {
    try {
        const lang = req.body.lang || req.lang || 'ar';
        const question = String(req.body.question || '').trim().slice(0, 500);
        if (!question) return errorResponse(res, 400, getTranslation('missingFields', lang));

        if (!req.isSuper) {
            const quota = await gemini.checkQuota(req.storeId, req.store);
            if (!quota.allowed) { const e = new Error('AI_QUOTA_STORE'); e.code = 'AI_QUOTA_STORE'; throw e; }
        }
        const result = await aiService.askQuestion({
            storeId: req.storeId, userId: req.userId, question, lang, storeDoc: req.store
        });
        return successResponse(res, result);
    } catch (err) {
        if (err.code && err.code.startsWith('AI_')) return aiError(res, err, req.lang || 'ar');
        logger.error('AI ask error:', err.message);
        next(err);
    }
};

// POST /api/ai/ocr-invoice  (multipart: image)
const ocrInvoice = async (req, res, next) => {
    try {
        const lang = req.body.lang || req.lang || 'ar';
        if (!req.file) return errorResponse(res, 400, getTranslation('missingFields', lang));

        if (!req.isSuper) {
            const quota = await gemini.checkQuota(req.storeId, req.store);
            if (!quota.allowed) { const e = new Error('AI_QUOTA_STORE'); e.code = 'AI_QUOTA_STORE'; throw e; }
        }

        const fs = require('fs');
        const b64 = fs.readFileSync(req.file.path).toString('base64');
        const mimeType = req.file.mimetype || 'image/jpeg';

        const system = 'You extract structured data from supplier invoices (tires shop, Algeria). Output STRICT JSON only.';
        const prompt = [
            'Extract from this supplier invoice image and return STRICT JSON:',
            '{"supplierName": string, "date": "YYYY-MM-DD"|null, "items": [{"designation": string, "qty": number, "unitPriceHT": number}], "totals": {"ht": number|null, "tva": number|null, "ttc": number|null}}',
            'Rules: keep item designations exactly as written (French/Arabic as-is); unitPriceHT is the unit price EXCLUDING tax; if a value is unreadable use null. No commentary, JSON only.'
        ].join('\n');

        const r = await gemini.generateJson({
            prompt, system, storeId: req.storeId, userId: req.userId, feature: 'ocr',
            temperature: 0.1, images: [{ mimeType, data: b64 }]
        });

        // clean up temp upload
        fs.unlink(req.file.path, () => {});
        return successResponse(res, { invoice: r.parsed, raw: r.text, latencyMs: r.latencyMs });
    } catch (err) {
        if (err.code && err.code.startsWith('AI_')) return aiError(res, err, req.lang || 'ar');
        logger.error('AI OCR error:', err.message);
        next(err);
    }
};

// GET /api/ai/forecast?coverageDays=30&summary=1
const forecast = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const coverageDays = Math.min(Math.max(parseInt(req.query.coverageDays, 10) || 30, 7), 90);
        const withSummary = ['1', 'true'].includes(String(req.query.summary));
        if (withSummary) {
            const quota = await gemini.checkQuota(req.storeId, req.store);
            if (!quota.allowed) { const e = new Error('AI_QUOTA_STORE'); e.code = 'AI_QUOTA_STORE'; throw e; }
        }
        const result = await aiService.computeForecast({
            storeId: req.storeId, coverageDays, summary: withSummary, lang, userId: req.userId
        });
        return successResponse(res, result);
    } catch (err) {
        if (err.code && err.code.startsWith('AI_')) return aiError(res, err, req.lang || 'ar');
        logger.error('AI forecast error:', err.message);
        next(err);
    }
};

// GET /api/ai/anomalies?interpret=1
const anomalies = async (req, res, next) => {
    try {
        const lang = req.lang || 'ar';
        const interpret = ['1', 'true'].includes(String(req.query.interpret));
        const sensitivity = Math.min(Math.max(parseInt(req.query.sensitivity, 10) || 2, 1), 3);
        if (interpret) {
            const quota = await gemini.checkQuota(req.storeId, req.store);
            if (!quota.allowed) { const e = new Error('AI_QUOTA_STORE'); e.code = 'AI_QUOTA_STORE'; throw e; }
        }
        const result = await aiService.detectAnomalies({
            storeId: req.storeId, userId: req.userId, lang, interpret, sensitivity
        });
        return successResponse(res, result);
    } catch (err) {
        if (err.code && err.code.startsWith('AI_')) return aiError(res, err, req.lang || 'ar');
        logger.error('AI anomalies error:', err.message);
        next(err);
    }
};

// POST /api/ai/daily-summary  (manual trigger for today or ?date=)
const dailySummary = async (req, res, next) => {
    try {
        const lang = req.body.lang || req.lang || 'ar';
        const result = await aiService.buildDailySummary({
            storeId: req.storeId, userId: req.userId, lang, storeDoc: req.store,
            day: req.body.date || null
        });
        return successResponse(res, result);
    } catch (err) {
        if (err.code && err.code.startsWith('AI_')) return aiError(res, err, req.lang || 'ar');
        logger.error('AI summary error:', err.message);
        next(err);
    }
};

// GET /api/ai/status  — is AI configured? quota left?
const status = async (req, res) => {
    const hasKey = !!(await gemini.resolveApiKey());
    const quota = req.isSuper ? { allowed: true, remaining: -1, used: -1, limit: -1 } : await gemini.checkQuota(req.storeId, req.store);
    return successResponse(res, { configured: hasKey, model: gemini.DEFAULT_MODEL, quota });
};

module.exports = { ask, ocrInvoice, forecast, anomalies, dailySummary, status };
