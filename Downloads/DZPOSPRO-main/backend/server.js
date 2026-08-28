// backend/server.js
// DZ POS PRO — Express + Mongoose API server.
// Serves the ../frontend SPA statically + JSON API under /api.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// Optional security / perf middleware (graceful if a dep is missing)
let helmet, compression, morgan, mongoSanitize;
try { helmet = require('helmet'); } catch (e) { /* not installed */ }
try { compression = require('compression'); } catch (e) { /* not installed */ }
try { morgan = require('morgan'); } catch (e) { /* not installed */ }
try { mongoSanitize = require('express-mongo-sanitize'); } catch (e) { /* not installed */ }

const { connectDB, getConnectionState, mongoose } = require('./config/db');
const { getTranslation } = require('./config/i18n');
const logger = require('./utils/logger');
const languageMiddleware = require('./middleware/language');
const { generalLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFound, asyncHandler } = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT, 10) || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS allow-list (never '*' with credentials)
const corsOrigins = (process.env.CORS_ORIGINS || 'dzpospro-production.up.railway.app,https://dzpospro.vercel.app,https://dzpospro.vercel.app')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const corsOptions = {
    origin(origin, cb) {
        // allow same-origin / curl (no Origin header) and any allow-listed origin
        if (!origin || corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Authorization']
};

// ----- core middleware (order matters) -----
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

if (helmet) {
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
          'https://cdn.socket.io'
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'http:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"]
      }
    }
  }));
}
if (compression) app.use(compression());
if (mongoSanitize) app.use(mongoSanitize());
if (morgan) app.use(morgan(NODE_ENV === 'development' ? 'dev' : 'combined'));

// Language detection — must run BEFORE route handlers so req.lang is always set.
app.use(languageMiddleware);

// Global rate limiter on /api
app.use('/api', generalLimiter);

// Static: frontend SPA + uploads
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ----- API routes -----
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            db: getConnectionState() ? 'connected' : 'disconnected'
        }
    });
});

app.get('/api', (req, res) => {
    res.json({
        success: true,
        data: {
            name: 'DZ POS PRO API',
            version: '2.0.0',
            status: 'online',
            time: new Date().toISOString(),
            docs: '/api/health'
        },
        message: getTranslation('welcome', req.lang || 'ar')
    });
});

// ===== مسار التسجيل =====
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        
        // تحقق من وجود جميع الحقول
        if (!name || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'جميع الحقول مطلوبة' 
            });
        }

        // هنا أضف منطق التسجيل الخاص بك
        // مثال: التحقق من وجود المستخدم، تشفير كلمة المرور، حفظ في قاعدة البيانات
        
        // استجابة نجاح
        res.status(201).json({ 
            success: true, 
            message: 'تم إنشاء الحساب بنجاح' 
        });
        
    } catch (error) {
        console.error('Error in register:', error);
        res.status(500).json({ 
            success: false, 
            message: 'حدث خطأ في الخادم' 
        });
    }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/products', require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/coupons', require('./routes/coupons'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/returns', require('./routes/returns'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/purchase-orders', require('./routes/purchaseOrders'));

// ----- 404 (JSON for API) -----
app.use('/api', notFound);

// ----- SPA catch-all (after API routes, before errorHandler) -----
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, '../frontend/index.html'), (err) => {
        if (err) next(err);
    });
});

// ----- central error handler (last) -----
app.use(errorHandler);

// ----- HTTP server + Socket.io (same port) -----
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin(origin, cb) {
            if (!origin || corsOrigins.includes(origin)) return cb(null, true);
            return cb(new Error('Not allowed by CORS'));
        },
        methods: ['GET', 'POST'],
        credentials: true
    }
});

io.on('connection', (socket) => {
    logger.info(`Socket.io client connected: ${socket.id}`);

    socket.on('join', (userId) => {
        if (userId) {
            socket.join(`user_${userId}`);
            logger.debug(`User ${userId} joined their room`);
        }
    });

    socket.on('disconnect', () => {
        logger.debug(`Socket.io client disconnected: ${socket.id}`);
    });
});

global.sendNotification = (userId, notification) => {
    io.to(`user_${userId}`).emit('notification', notification);
};
global.broadcastNotification = (notification) => {
    io.emit('notification', notification);
};

// ----- boot -----
(async () => {
    try {
        await connectDB();
    } catch (e) {
        logger.warn(`DB unavailable at boot — continuing without it: ${e.message}`);
    }

    server.listen(PORT, () => {
        logger.info(`DZ POS PRO API listening on port ${PORT} (${NODE_ENV})`);
        logger.info(`Socket.io attached to same port`);
        logger.info(`CORS origins: ${corsOrigins.join(', ')}`);
        logger.info(`Languages: ar / en / fr`);
    });
})();

// ----- graceful shutdown -----
const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully...`);
    server.close(async () => {
        logger.info('HTTP server closed.');
        try {
            await mongoose.connection.close(false);
            logger.info('MongoDB connection closed.');
        } catch (e) {
            logger.warn(`Error closing MongoDB: ${e.message}`);
        }
        process.exit(0);
    });
    // Hard exit after 10s if graceful shutdown stalls
    setTimeout(() => {
        logger.warn('Forcing exit after 10s timeout.');
        process.exit(1);
    }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err.message);
    logger.error(err.stack || '');
});

module.exports = app;
