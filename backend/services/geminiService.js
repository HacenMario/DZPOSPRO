// backend/services/geminiService.js
// DZ POS PRO v3 — Google Gemini (free tier) unified AI client.
// All AI features go through this single service so the provider can be
// swapped later (DeepSeek / OpenAI) without touching feature code.
//
// Key resolution order:
//   1. PlatformSetting key "geminiApiKey" (settable from the admin UI)
//   2. process.env.GEMINI_API_KEY
// Quota: per-store daily limit (Store.limits.aiDailyCalls, default 200).
const axios = require('axios');
const logger = require('../utils/logger');
const PlatformSetting = require('../models/PlatformSetting');
const AIUsage = require('../models/AIUsage');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT = 45000;

/** Resolve the API key (DB first, env fallback). */
async function resolveApiKey() {
    try {
        const key = await PlatformSetting.get('geminiApiKey');
        if (key) return key;
    } catch (_) {}
    return process.env.GEMINI_API_KEY || '';
}

/** Check + record quota usage. Returns { allowed, remaining }. */
async function checkQuota(storeId, storeDoc) {
    try {
        const used = await AIUsage.countToday(storeId);
        const limit = (storeDoc && storeDoc.limits && storeDoc.limits.aiDailyCalls) || 200;
        return { allowed: used < limit, remaining: Math.max(0, limit - used), used, limit };
    } catch (e) {
        logger.warn('AI quota check failed:', e.message);
        return { allowed: true, remaining: -1, used: -1, limit: -1 };
    }
}

async function recordUsage(storeId, userId, feature, model, ok, latencyMs) {
    try {
        await AIUsage.create({ storeId: storeId || null, user: userId || null, feature, model, ok, latencyMs });
    } catch (_) {}
}

/**
 * Core call — text generation.
 * @param {object} opts { prompt, system, storeId, userId, feature, json, temperature, model }
 * @returns {Promise<{text, usage}>}
 */
async function generate(opts) {
    const {
        prompt, system = '', storeId = null, userId = null,
        feature = 'ask', json = false, temperature = 0.4, model = DEFAULT_MODEL,
        images = []   // [{mimeType, data(base64)}] for vision calls
    } = opts;

    const apiKey = await resolveApiKey();
    if (!apiKey) {
        const err = new Error('AI_NOT_CONFIGURED');
        err.code = 'AI_NOT_CONFIGURED';
        throw err;
    }

    const started = Date.now();
    const contents = [];
    const userParts = [];
    if (Array.isArray(images)) {
        for (const img of images.slice(0, 3)) {
            userParts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } });
        }
    }
    userParts.push({ text: prompt });
    contents.push({ role: 'user', parts: userParts });

    const body = {
        contents,
        generationConfig: {
            temperature,
            maxOutputTokens: json ? 4096 : 1200,
            ...(json ? { responseMimeType: 'application/json' } : {})
        }
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const url = `${BASE_URL}/${model}:generateContent?key=${apiKey}`;
    let text = '';
    try {
        const resp = await axios.post(url, body, { timeout: REQUEST_TIMEOUT });
        const cand = resp.data && resp.data.candidates && resp.data.candidates[0];
        if (cand && cand.content && Array.isArray(cand.content.parts)) {
            text = cand.content.parts.map(p => p.text || '').join('').trim();
        }
        if (!text) throw new Error('Empty AI response');
        await recordUsage(storeId, userId, feature, model, true, Date.now() - started);
        return { text, usage: resp.data.usageMetadata || {}, latencyMs: Date.now() - started };
    } catch (err) {
        await recordUsage(storeId, userId, feature, model, false, Date.now() - started);
        if (err.code === 'AI_NOT_CONFIGURED') throw err;
        if (err.response) {
            const status = err.response.status;
            logger.error(`Gemini API error ${status}:`, JSON.stringify(err.response.data).slice(0, 300));
            const mapped = new Error(status === 429 ? 'AI_QUOTA' : status === 400 ? 'AI_BAD_REQUEST' : 'AI_UNAVAILABLE');
            mapped.code = mapped.message;
            throw mapped;
        }
        logger.error('Gemini network error:', err.message);
        const mapped = new Error(err.message === 'AI_NOT_CONFIGURED' ? 'AI_NOT_CONFIGURED' : 'AI_UNAVAILABLE');
        mapped.code = mapped.message;
        throw mapped;
    }
}

/** Convenience: call and parse a strict-JSON response. */
async function generateJson(opts) {
    const r = await generate({ ...opts, json: true });
    let parsed = null;
    try {
        const cleaned = r.text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
        parsed = JSON.parse(cleaned);
    } catch (_) {
        const m = r.text.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch (_) {} }
    }
    if (parsed === null) {
        const err = new Error('AI_PARSE');
        err.code = 'AI_PARSE';
        throw err;
    }
    return { ...r, parsed };
}

module.exports = { generate, generateJson, resolveApiKey, checkQuota, DEFAULT_MODEL };
