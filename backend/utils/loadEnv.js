// backend/utils/loadEnv.js — v3.1 robust .env loading
// ------------------------------------------------------------
// Loads backend/.env FIRST (it wins), then the project-root .env
// for any variable still unset. dotenv never overrides variables
// that are already set, so real environment variables (Railway,
// Heroku…) always keep the highest priority.
// Safe to call from anywhere regardless of process.cwd() — fixes
// "npm run migrate-saas" being run from the project root.
const fs = require('fs');
const path = require('path');

function loadEnv() {
    const localEnv = path.join(__dirname, '..', '.env');        // backend/.env
    const rootEnv = path.join(__dirname, '..', '..', '.env');   // <project root>/.env
    if (fs.existsSync(localEnv)) require('dotenv').config({ path: localEnv });
    if (fs.existsSync(rootEnv)) require('dotenv').config({ path: rootEnv });
}

module.exports = loadEnv;
