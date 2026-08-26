// backend/utils/logger.js
// Lightweight structured logger (console + file rotation). No external deps.
const fs = require('fs');
const path = require('path');

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 50 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || LOG_LEVELS.info;

const logsDir = path.join(__dirname, '../../logs');
try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
} catch (e) {
    // Best effort — logs directory may not be writable in some sandboxes.
}

const streams = {
    combined: null,
    error: null
};

try {
    streams.combined = fs.createWriteStream(path.join(logsDir, 'combined.log'), { flags: 'a' });
    streams.error = fs.createWriteStream(path.join(logsDir, 'error.log'), { flags: 'a' });
} catch (e) {
    // File logging disabled; console still works.
}

const COLORS = {
    debug: '\x1b[36m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
};

function serialize(data) {
    if (data === undefined) return '';
    if (data instanceof Error) return data.stack || data.message;
    if (typeof data === 'object') {
        try { return JSON.stringify(data); } catch { return String(data); }
    }
    return String(data);
}

function writeLog(level, message, data = null) {
    if (LOG_LEVELS[level] < CURRENT_LEVEL) return;

    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    const dataStr = data !== null && data !== undefined ? ' ' + serialize(data) : '';

    // Console (with color)
    const color = COLORS[level] || '';
    if (level === 'error') {
        console.error(`${color}${line}${dataStr}${COLORS.reset}`);
    } else if (level === 'warn') {
        console.warn(`${color}${line}${dataStr}${COLORS.reset}`);
    } else {
        console.log(`${color}${line}${dataStr}${COLORS.reset}`);
    }

    // File (JSON lines)
    const entry = JSON.stringify({
        timestamp,
        level,
        message,
        data: data !== null && data !== undefined ? serialize(data) : undefined
    }) + '\n';

    if (streams.combined) streams.combined.write(entry);
    if (level === 'error' && streams.error) streams.error.write(entry);
}

const logger = {
    debug: (msg, data) => writeLog('debug', msg, data),
    info: (msg, data) => writeLog('info', msg, data),
    warn: (msg, data) => writeLog('warn', msg, data),
    error: (msg, data) => writeLog('error', msg, data)
};

module.exports = logger;
