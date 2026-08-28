// backend/config/db.js
// MongoDB connection helper (Mongoose 7 — no deprecated options needed).
const mongoose = require('mongoose');
const logger = require('../utils/logger');

let isConnected = false;

const connectDB = async () => {
    if (!process.env.MONGO_URI) {
        logger.warn('MONGO_URI is not set. Running without a database connection.');
        return null;
    }

    mongoose.set('strictQuery', true);
    // Fail fast on DB-backed operations when MongoDB is unavailable (default is 10s).
    mongoose.set('bufferTimeoutMS', 2000);
    mongoose.set('bufferCommands', true);

    mongoose.connection.on('connected', () => {
        isConnected = true;
        logger.info(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
    });

    mongoose.connection.on('error', (err) => {
        isConnected = false;
        logger.error('MongoDB connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
        isConnected = false;
        logger.warn('MongoDB disconnected');
    });

    try {
        await mongoose.connect(process.env.MONGO_URI);
        return mongoose.connection;
    } catch (error) {
        // Non-fatal: the HTTP server must still start so the frontend can be served.
        logger.error(`Failed to connect to MongoDB: ${error.message}`);
        return null;
    }
};

const getConnectionState = () => {
    return mongoose.connection.readyState === 1;
};

module.exports = { connectDB, getConnectionState, mongoose };
