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

// v4 — model fallback chain: try next model on 404 (model unavailable for
// this key) so ANY valid Gemini key works out of the box.
const MODEL_CHAIN = [DEFAULT_MODEL, 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b']
    .filter((m, i, a) => a.indexOf(m) === i);

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

    // v4 — resilient call: walks the model chain, retries transient errors.
    const tryModels = MODEL_CHAIN.includes(model) ? MODEL_CHAIN : [model, ...MODEL_CHAIN];
    let lastErr = null;

    for (const m of tryModels) {
        const url = `${BASE_URL}/${m}:generateContent?key=${apiKey}`;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const resp = await axios.post(url, body, { timeout: REQUEST_TIMEOUT });
                const cand = resp.data && resp.data.candidates && resp.data.candidates[0];
                let text = '';
                if (cand && cand.content && Array.isArray(cand.content.parts)) {
                    text = cand.content.parts.map(p => p.text || '').join('').trim();
                }
                if (!text) throw new Error('Empty AI response');
                await recordUsage(storeId, userId, feature, m, true, Date.now() - started);
                return { text, model: m, usage: resp.data.usageMetadata || {}, latencyMs: Date.now() - started };
            } catch (err) {
                lastErr = err;
                const status = err.response ? err.response.status : null;
                const msg = status ? JSON.stringify(err.response.data || {}).slice(0, 200) : err.message;
                logger.warn(`Gemini ${m} attempt ${attempt + 1} failed (${status || 'net'}): ${msg}`);

                // 404 / NOT_FOUND for this model → try the next model in the chain
                if (status === 404) break;
                // invalid key / bad request → no point retrying anything
                if (status === 400 || status === 401 || status === 403) {
                    const mapped = new Error(status === 400 ? 'AI_BAD_REQUEST' : 'AI_UNAVAILABLE');
                    mapped.code = mapped.message;
                    throw mapped;
                }
                // 429 / 5xx / network → backoff then retry same model
                if (attempt < 2) {
                    await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
                    continue;
                }
                break; // give up on this model, try next
            }
        }
    }

    await recordUsage(storeId, userId, feature, model, false, Date.now() - started);
    const status = lastErr && lastErr.response ? lastErr.response.status : null;
    const mapped = new Error(status === 429 ? 'AI_QUOTA' : 'AI_UNAVAILABLE');
    mapped.code = mapped.message;
    throw mapped;
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

module.exports = { generate, generateJson, resolveApiKey, checkQuota, DEFAULT_MODEL, MODEL_CHAIN };
