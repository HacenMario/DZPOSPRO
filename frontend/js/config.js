// frontend/js/config.js — v3.1 smart API base resolution
// ------------------------------------------------------------
// Priority order:
//   1. localStorage 'dzpos_api_base'      → manual override (highest)
//      e.g. localStorage.setItem('dzpos_api_base', 'https://my-backend.up.railway.app')
//   2. window.DZPOS_API_BASE              → settable before modules load
//   3. page opened from file://           → production backend (Railway)
//   4. page hosted on *.vercel.app        → production backend (Railway, split deploy)
//   5. otherwise                          → '' (same origin: local `npm start`,
//                                            Railway all-in-one, reverse proxy)
// This matches the production topology:
//   Frontend → https://dzpospro.vercel.app
//   Backend  → https://dzpospro-production.up.railway.app
function detectApiBase() {
  var o = '';
  try { o = localStorage.getItem('dzpos_api_base') || window.DZPOS_API_BASE || ''; } catch (e) { /* private mode */ }
  if (o) return String(o).replace(/\/+$/, '');
  if (location.protocol === 'file:') return 'https://dzpospro-production.up.railway.app';
  if (/(^|\.)vercel\.app$/i.test(location.hostname || '')) return 'https://dzpospro-production.up.railway.app';
  return '';
}

const API_BASE = detectApiBase();

// Publish for non-module scripts (api.js / socket.js / pwa.js / app.js / dashboard.js)
if (typeof window !== 'undefined') {
  window.DZPOS_API_BASE = API_BASE;
}

export default API_BASE;
