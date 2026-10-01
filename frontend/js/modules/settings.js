/* ============================================================
 * js/modules/settings.js
 * ------------------------------------------------------------
 * Renders the Settings page into #pageContent (tabbed layout).
 *
 * Tabs:
 *   1. Store Profile   — storeName, currency, taxRate (%),
 *                       invoicePrefix, invoiceFooter (textarea),
 *                       lowStockThreshold, defaultPaymentMethod
 *   2. Company / Fiscal — companyInfo: rc, nif, nis, art,
 *                       address (textarea), phone, email
 *   3. My Profile      — name (editable), email (read-only) +
 *                       Change Password section
 *   4. Appearance      — theme, language, sidebar default
 *                       (all client-side, localStorage)
 *
 * Notes:
 *   • Store Profile and Company tabs are admin-only. Non-admins
 *     see the values read-only with a notice.
 *   • All saves via window.apiFetch() with window.Toast feedback.
 *   • All text via window.t(). Skeleton + Esc-to-close handler
 *     (settings has no modal of its own, but we keep the
 *     convention for the few inline popups).
 * ============================================================ */

const apiFetch = window.apiFetch;
const t = (k, fb) => (typeof window.t === 'function' ? window.t(k, fb) : (fb || k));

let state = {
  settings: null,
  user: null,
  isAdmin: false,
  activeTab: 'store',
  loading: true
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (_) { return null; }
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">${t('settings', 'Settings')}</div>
        <div class="page-subtitle">${t('settingsPageSubtitle', 'Configure your store, company information, profile and appearance')}</div>
      </div>
    </div>
    <div class="tabs">
      <div class="tab-list">
        ${[1,2,3,4].map(() => '<div class="skeleton" style="height:40px;width:140px;border-radius:8px;"></div>').join('')}
      </div>
    </div>
    <div class="card" style="margin-top:1rem;">
      <div class="card-body">
        ${[1,2,3,4,5].map(() => '<div class="skeleton skeleton-line" style="height:40px;margin:0.5rem 0;"></div>').join('')}
      </div>
    </div>`;
}

/* ---------- Tabs ---------- */
function renderTabs() {
  const tabs = [
    { id: 'store',       label: t('storeProfile', 'Store profile'),     icon: '<path d="M3 9l1-5h16l1 5"/><path d="M5 9v11h14V9"/><line x1="9" y1="13" x2="15" y2="13"/>' },
    { id: 'company',     label: t('companyInfo', 'Company / Fiscal'),   icon: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>' },
    { id: 'profile',     label: t('myProfile', 'My profile'),           icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
    { id: 'appearance',  label: t('appearance', 'Appearance'),          icon: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>' },
    // v3 — AI + smart alerts (admin/manager only)
    ...(state.isAdmin ? [
      { id: 'ai',          label: '🤖 ' + t('aiTab', 'الذكاء الاصطناعي'),          icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>' },
      { id: 'alerts',      label: '🔔 ' + t('alertsTab', 'التنبيهات الذكية'),      icon: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>' }
    ] : [])
  ];
  return `
    <div class="tabs">
      <div class="tab-list">
        ${tabs.map(t_ => `
          <button class="tab-item ${state.activeTab === t_.id ? 'active' : ''}" data-tab="${t_.id}" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">${t_.icon}</svg>
            <span>${t_.label}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function renderAdminNotice() {
  if (state.isAdmin) return '';
  return `
    <div class="card" style="margin-bottom:1rem;border-left:3px solid var(--accent, #f59e0b);">
      <div class="card-body" style="display:flex;gap:0.75rem;align-items:center;padding:0.85rem 1rem;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;color:var(--accent, #f59e0b);flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <div>
          <div class="cell-strong">${t('adminOnly', 'Admin only')}</div>
          <div class="cell-muted" style="font-size:0.85rem;">${t('readOnlyNotice', 'You can view these settings but only an administrator can modify them.')}</div>
        </div>
      </div>
    </div>`;
}

function disabledAttr() { return state.isAdmin ? '' : 'disabled'; }

/* ---------- Tab: Store profile ---------- */
function renderStoreTab() {
  const s = state.settings || {};
  const currencies = ['DZD', 'EUR', 'USD', 'MAD', 'TND'];
  const curOpts = currencies.map(c => `<option value="${c}" ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('');
  const payMethods = [
    { id: 'cash',     label: t('cash', 'Cash') },
    { id: 'card',     label: t('card', 'Card') },
    { id: 'transfer', label: t('transfer', 'Transfer') },
    { id: 'split',    label: t('split', 'Split') }
  ];
  const payOpts = payMethods.map(m => `<option value="${m.id}" ${s.defaultPaymentMethod === m.id ? 'selected' : ''}>${m.label}</option>`).join('');

  return `
    <form id="storeSettingsForm">
      ${renderAdminNotice()}
      <div class="card">
        <div class="card-header"><div class="card-title">${t('storeProfile', 'Store profile')}</div></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="storeName">${t('storeName', 'Store name')}</label>
              <input class="input" id="storeName" type="text" ${disabledAttr()} value="${escapeHtml(s.storeName || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="currency">${t('currency', 'Currency')}</label>
              <select class="select" id="currency" ${disabledAttr()}>${curOpts}</select>
            </div>
            <div class="form-group">
              <label class="form-label" for="taxRate">${t('taxRate', 'Tax rate (%)')}</label>
              <input class="input" id="taxRate" type="number" step="0.01" min="0" max="100" ${disabledAttr()} value="${s.taxRate != null ? s.taxRate : 0}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="invoicePrefix">${t('invoicePrefix', 'Invoice prefix')}</label>
              <input class="input" id="invoicePrefix" type="text" ${disabledAttr()} value="${escapeHtml(s.invoicePrefix || '')}" placeholder="INV-" />
            </div>
            <div class="form-group">
              <label class="form-label" for="lowStockThreshold">${t('lowStockThreshold', 'Low stock threshold')}</label>
              <input class="input" id="lowStockThreshold" type="number" step="1" min="0" ${disabledAttr()} value="${s.lowStockThreshold != null ? s.lowStockThreshold : 5}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="defaultPaymentMethod">${t('defaultPaymentMethod', 'Default payment method')}</label>
              <select class="select" id="defaultPaymentMethod" ${disabledAttr()}>${payOpts}</select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="invoiceHeader">${t('invoiceHeader', 'Invoice header text')}</label>
            <input class="input" id="invoiceHeader" type="text" ${disabledAttr()} value="${escapeHtml(s.invoiceHeader || '')}" placeholder="${escapeHtml(t('invoiceHeaderPlaceholder', 'Text shown at the top of the invoice (optional)'))}" />
            <div class="help-text">${t('invoiceHeaderHelp', 'Appears on the invoice PDF right below the company info line')}</div>
          </div>
          <div class="form-group">
            <label class="form-label" for="invoiceFooter">${t('invoiceFooter', 'Invoice footer')}</label>
            <textarea class="textarea" id="invoiceFooter" rows="2" ${disabledAttr()} placeholder="${escapeHtml(t('invoiceFooterPlaceholder', 'Thank you message shown at the bottom of every invoice'))}">${escapeHtml(s.invoiceFooter || '')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label" for="invoiceCustomText">${t('invoiceCustomText', 'Invoice custom text')}</label>
            <textarea class="textarea" id="invoiceCustomText" rows="4" ${disabledAttr()} placeholder="${escapeHtml(t('invoiceCustomTextPlaceholder', 'Text shown on the invoice right below the total-in-words line (e.g. bank details, legal notice, payment terms)'))}">${escapeHtml(s.invoiceCustomText || '')}</textarea>
            <div class="help-text">${t('invoiceCustomTextHelp', 'Appears on the invoice PDF right below the “Arrêté la présente facture…” line')}</div>
          </div>
          <div class="form-group">
            <label class="form-label" for="settingInvoiceColor">${t('invoicePrimaryColor', 'Couleur principale de la facture')}</label>
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <input type="color" id="settingInvoiceColor" value="${escapeHtml(s.invoicePrimaryColor || '#10b981')}" ${disabledAttr()} style="width:48px; height:38px; padding:0; border:1px solid var(--border-color); border-radius:var(--radius-sm); background:var(--bg-input); cursor:pointer;" />
              <input type="text" id="settingInvoiceColorText" class="input" value="${escapeHtml(s.invoicePrimaryColor || '#10b981')}" ${disabledAttr()} style="flex:1; min-width:120px; font-family:var(--font-mono, monospace);" maxlength="7" />
              <span id="settingInvoiceColorPreview" style="display:inline-block; width:38px; height:38px; border-radius:var(--radius-sm); background:${escapeHtml(s.invoicePrimaryColor || '#10b981')}; border:1px solid var(--border-color);"></span>
            </div>
            <div class="help-text">${t('invoicePrimaryColorHelp', 'Couleur utilisée pour les titres, lignes de séparation et montants sur la facture PDF.')}</div>
          </div>
        </div>
        <div class="card-footer" style="display:flex;justify-content:flex-end;gap:0.5rem;">
          <button class="btn btn-primary" type="submit" ${disabledAttr()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>${t('save', 'Save')}</span>
          </button>
        </div>
      </div>
    </form>`;
}

function bindStoreTab() {
  const form = document.getElementById('storeSettingsForm');
  if (!form) return;

  /* ---- Invoice primary color picker: keep color input, hex text
     input and preview swatch in sync. Only admins can edit. ---- */
  const colorInput = document.getElementById('settingInvoiceColor');
  const colorText  = document.getElementById('settingInvoiceColorText');
  const colorPrev  = document.getElementById('settingInvoiceColorPreview');
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  function setPreview(c) { if (colorPrev) colorPrev.style.background = c; }
  if (colorInput && colorText) {
    // Sync text + preview when the native color picker changes
    colorInput.addEventListener('input', () => {
      const v = colorInput.value;
      colorText.value = v;
      setPreview(v);
    });
    // Sync color input + preview when the hex text changes (only on valid hex)
    colorText.addEventListener('input', () => {
      const v = colorText.value.trim();
      if (HEX_RE.test(v)) {
        colorInput.value = v.toLowerCase();
        setPreview(v);
      }
    });
    // On blur, normalize valid hex; revert invalid hex to the color input's value
    colorText.addEventListener('blur', () => {
      const v = colorText.value.trim();
      if (HEX_RE.test(v)) {
        colorText.value = v.toLowerCase();
      } else {
        colorText.value = colorInput.value;
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.isAdmin) return;
    const body = Object.assign({}, state.settings, {
      storeName: document.getElementById('storeName').value.trim(),
      currency: document.getElementById('currency').value,
      taxRate: parseFloat(document.getElementById('taxRate').value) || 0,
      invoicePrefix: document.getElementById('invoicePrefix').value.trim(),
      invoiceHeader: document.getElementById('invoiceHeader').value.trim(),
      invoiceFooter: document.getElementById('invoiceFooter').value.trim(),
      invoiceCustomText: document.getElementById('invoiceCustomText').value.trim(),
      invoicePrimaryColor: (colorInput && HEX_RE.test(colorInput.value)) ? colorInput.value.toLowerCase() : (state.settings && state.settings.invoicePrimaryColor ? state.settings.invoicePrimaryColor : '#10b981'),
      lowStockThreshold: parseInt(document.getElementById('lowStockThreshold').value, 10) || 0,
      defaultPaymentMethod: document.getElementById('defaultPaymentMethod').value
    });
    try {
      const r = await apiFetch.put('/api/settings', body);
      if (r && r.success) {
        state.settings = (r.data && r.data.settings) ? r.data.settings : (r.data || body);
        if (window.Toast) window.Toast.success(t('settingsStoreSaved', 'Store settings saved'));
      } else throw new Error((r && r.message) || 'Failed');
    } catch (err) {
      if (window.Toast) window.Toast.error((err && err.message) || t('error', 'Error'));
    }
  });
}

/* ---------- Tab: Company / Fiscal ---------- */
function renderCompanyTab() {
  const c = (state.settings && state.settings.companyInfo) || {};
  return `
    <form id="companySettingsForm">
      ${renderAdminNotice()}
      <div class="card">
        <div class="card-header"><div class="card-title">${t('companyInfo', 'Company / Fiscal information')}</div></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="companyRc">RC</label>
              <input class="input" id="companyRc" type="text" ${disabledAttr()} value="${escapeHtml(c.rc || '')}" placeholder="Registre de commerce" />
            </div>
            <div class="form-group">
              <label class="form-label" for="companyNif">NIF</label>
              <input class="input" id="companyNif" type="text" ${disabledAttr()} value="${escapeHtml(c.nif || '')}" placeholder="Numéro d'identification fiscale" />
            </div>
            <div class="form-group">
              <label class="form-label" for="companyNis">NIS</label>
              <input class="input" id="companyNis" type="text" ${disabledAttr()} value="${escapeHtml(c.nis || '')}" placeholder="Numéro d'identification statistique" />
            </div>
            <div class="form-group">
              <label class="form-label" for="companyArt">ART</label>
              <input class="input" id="companyArt" type="text" ${disabledAttr()} value="${escapeHtml(c.art || '')}" placeholder="Article d'imposition" />
            </div>
            <div class="form-group">
              <label class="form-label" for="companyPhone">${t('phone', 'Phone')}</label>
              <input class="input" id="companyPhone" type="tel" ${disabledAttr()} value="${escapeHtml(c.phone || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="companyWhatsapp">WhatsApp</label>
              <input class="input" id="companyWhatsapp" type="tel" ${disabledAttr()} value="${escapeHtml(c.whatsapp || '')}" placeholder="ex: 0555 12 34 56" />
            </div>
            <div class="form-group">
              <label class="form-label" for="companyEmail">${t('emailAddress', 'Email')}</label>
              <input class="input" id="companyEmail" type="text" ${disabledAttr()} value="${escapeHtml(c.email || '')}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="companyAddress">${t('address', 'Address')}</label>
            <textarea class="textarea" id="companyAddress" rows="3" ${disabledAttr()} placeholder="${escapeHtml(t('addressPlaceholder', 'Street, city, province'))}">${escapeHtml(c.address || '')}</textarea>
          </div>
        </div>
        <div class="card-footer" style="display:flex;justify-content:flex-end;gap:0.5rem;">
          <button class="btn btn-primary" type="submit" ${disabledAttr()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>${t('save', 'Save')}</span>
          </button>
        </div>
      </div>
    </form>`;
}

function bindCompanyTab() {
  const form = document.getElementById('companySettingsForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.isAdmin) return;
    const companyInfo = {
      rc: document.getElementById('companyRc').value.trim(),
      nif: document.getElementById('companyNif').value.trim(),
      nis: document.getElementById('companyNis').value.trim(),
      art: document.getElementById('companyArt').value.trim(),
      phone: document.getElementById('companyPhone').value.trim(),
      whatsapp: document.getElementById('companyWhatsapp').value.trim(),
      email: document.getElementById('companyEmail').value.trim(),
      address: document.getElementById('companyAddress').value.trim(),
      logo: (state.settings && state.settings.companyInfo && state.settings.companyInfo.logo) || ''
    };
    const body = Object.assign({}, state.settings, { companyInfo });
    try {
      const r = await apiFetch.put('/api/settings', body);
      if (r && r.success) {
        state.settings = (r.data && r.data.settings) ? r.data.settings : (r.data || body);
        if (window.Toast) window.Toast.success(t('settingsCompanySaved', 'Company information saved'));
      } else throw new Error((r && r.message) || 'Failed');
    } catch (err) {
      if (window.Toast) window.Toast.error((err && err.message) || t('error', 'Error'));
    }
  });
}

/* ---------- Tab: My profile ---------- */
function renderProfileTab() {
  const u = state.user || {};
  const email = u.email || '';
  const name = u.name || '';
  return `
    <div class="grid grid-2" style="gap:1rem;">
      <div class="card">
        <div class="card-header"><div class="card-title">${t('myProfile', 'My profile')}</div></div>
        <div class="card-body">
          <form id="profileForm">
            <div class="form-group">
              <label class="form-label" for="profileName">${t('fullName', 'Full name')}</label>
              <input class="input" id="profileName" type="text" required value="${escapeHtml(name)}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="profileEmail">${t('emailAddress', 'Email')}</label>
              <input class="input" id="profileEmail" type="email" value="${escapeHtml(email)}" readonly style="opacity:0.7;cursor:not-allowed;" />
              <div class="help-text">${t('emailCannotBeChanged', 'Email cannot be changed')}</div>
            </div>
            <div class="form-group">
              <label class="form-label">${t('role', 'Role')}</label>
              <div><span class="badge badge-info">${escapeHtml(u.role || '—')}</span></div>
            </div>
            <div style="display:flex;justify-content:flex-end;">
              <button class="btn btn-primary" type="submit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                <span>${t('save', 'Save')}</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">${t('changePassword', 'Change password')}</div></div>
        <div class="card-body">
          <form id="passwordForm">
            <div class="form-group">
              <label class="form-label" for="currentPassword">${t('currentPassword', 'Current password')}</label>
              <input class="input" id="currentPassword" type="password" required autocomplete="current-password" />
            </div>
            <div class="form-group">
              <label class="form-label" for="newPassword">${t('newPassword', 'New password')}</label>
              <input class="input" id="newPassword" type="password" required autocomplete="new-password" />
              <div class="help-text">${t('passwordRules', 'At least 8 characters with at least one letter and one number')}</div>
              <div class="invalid-feedback" id="newPasswordErr" style="display:none;"></div>
            </div>
            <div class="form-group">
              <label class="form-label" for="confirmPassword">${t('confirmPassword', 'Confirm new password')}</label>
              <input class="input" id="confirmPassword" type="password" required autocomplete="new-password" />
              <div class="invalid-feedback" id="confirmPasswordErr" style="display:none;">${t('passwordsDoNotMatch', 'Passwords do not match')}</div>
            </div>
            <div style="display:flex;justify-content:flex-end;">
              <button class="btn btn-secondary" type="submit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span>${t('updatePassword', 'Update password')}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

function bindProfileTab() {
  const profileForm = document.getElementById('profileForm');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('profileName').value.trim();
      if (!name) {
        if (window.Toast) window.Toast.warning(t('nameRequired', 'Name is required'));
        return;
      }
      try {
        const r = await apiFetch.put('/api/auth/profile', { name });
        if (r && r.success) {
          // Update local user
          if (state.user) {
            state.user.name = name;
            try { localStorage.setItem('user', JSON.stringify(state.user)); } catch (_) {}
          }
          // Refresh sidebar/topbar name
          document.querySelectorAll('#sidebarUserName, #topbarUserName').forEach(n => { if (n) n.textContent = name; });
          if (window.Toast) window.Toast.success(t('profileUpdated', 'Profile updated'));
        } else throw new Error((r && r.message) || 'Failed');
      } catch (err) {
        if (window.Toast) window.Toast.error((err && err.message) || t('error', 'Error'));
      }
    });
  }

  const passwordForm = document.getElementById('passwordForm');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cur = document.getElementById('currentPassword').value;
      const neu = document.getElementById('newPassword').value;
      const conf = document.getElementById('confirmPassword').value;
      const neuErr = document.getElementById('newPasswordErr');
      const confErr = document.getElementById('confirmPasswordErr');
      neuErr.style.display = 'none';
      confErr.style.display = 'none';

      if (neu.length < 8 || !/[A-Za-zÀ-ÿ]/.test(neu) || !/[0-9]/.test(neu)) {
        neuErr.textContent = t('passwordNeedsLetterAndNumber', 'Password must be at least 8 characters with a letter and a number');
        neuErr.style.display = 'block';
        if (window.Toast) window.Toast.warning(t('passwordTooShort', 'Password too weak'));
        return;
      }
      if (neu !== conf) {
        confErr.style.display = 'block';
        if (window.Toast) window.Toast.warning(t('passwordsDoNotMatch', 'Passwords do not match'));
        return;
      }
      try {
        const r = await apiFetch.put('/api/auth/change-password', { currentPassword: cur, newPassword: neu });
        if (r && r.success) {
          if (window.Toast) window.Toast.success(t('passwordChanged', 'Password changed'));
          passwordForm.reset();
        } else throw new Error((r && r.message) || 'Failed');
      } catch (err) {
        const msg = (err && err.message) || '';
        if (/current|incorrect|wrong|invalid|actuel|خطأ|غير صحيح/i.test(msg)) {
          if (window.Toast) window.Toast.error(t('currentPasswordWrong', 'Current password is incorrect'));
        } else {
          if (window.Toast) window.Toast.error(msg || t('error', 'Error'));
        }
      }
    });
  }
}

/* ---------- Tab: Appearance ---------- */
function renderAppearanceTab() {
  const curTheme = document.documentElement.getAttribute('data-theme') || (localStorage.getItem('theme') || 'light');
  const curLang = (typeof window.currentLang !== 'undefined' && window.currentLang) || localStorage.getItem('lang') || 'ar';
  const sidebarDefault = localStorage.getItem('sidebarDefault') || 'expanded';
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">${t('appearance', 'Appearance')}</div></div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">${t('theme', 'Theme')}</label>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="btn ${curTheme === 'light' ? 'btn-primary' : 'btn-outline'}" type="button" data-theme-choice="light">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              <span>${t('themeLight', 'Light')}</span>
            </button>
            <button class="btn ${curTheme === 'dark' ? 'btn-primary' : 'btn-outline'}" type="button" data-theme-choice="dark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              <span>${t('themeDark', 'Dark')}</span>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="langSelectSetting">${t('language', 'Language')}</label>
          <select class="select" id="langSelectSetting" style="max-width:240px;">
            <option value="ar" ${curLang === 'ar' ? 'selected' : ''}>العربية</option>
            <option value="en" ${curLang === 'en' ? 'selected' : ''}>English</option>
            <option value="fr" ${curLang === 'fr' ? 'selected' : ''}>Français</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="sidebarDefaultSetting">${t('sidebarDefault', 'Sidebar default state')}</label>
          <select class="select" id="sidebarDefaultSetting" style="max-width:240px;">
            <option value="expanded" ${sidebarDefault === 'expanded' ? 'selected' : ''}>${t('sidebarExpanded', 'Expanded')}</option>
            <option value="collapsed" ${sidebarDefault === 'collapsed' ? 'selected' : ''}>${t('sidebarCollapsed', 'Collapsed')}</option>
          </select>
          <div class="help-text">${t('sidebarDefaultHelp', 'Applied on next page load')}</div>
        </div>
      </div>
      <div class="card-footer" style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" type="button" id="appearanceSaveBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          <span>${t('save', 'Save')}</span>
        </button>
      </div>
    </div>`;
}

function bindAppearanceTab() {
  document.querySelectorAll('[data-theme-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.themeChoice;
      document.documentElement.setAttribute('data-theme', theme);
      try { localStorage.setItem('theme', theme); } catch (_) {}
      // Notify other listeners
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
      // Toggle button styles in place
      document.querySelectorAll('[data-theme-choice]').forEach(b => {
        b.classList.remove('btn-primary', 'btn-outline');
        b.classList.add(b.dataset.themeChoice === theme ? 'btn-primary' : 'btn-outline');
      });
    });
  });
  const langSel = document.getElementById('langSelectSetting');
  if (langSel) {
    langSel.addEventListener('change', () => {
      const lang = langSel.value;
      if (typeof window.setLanguage === 'function') {
        window.setLanguage(lang);
      } else {
        try { localStorage.setItem('lang', lang); } catch (_) {}
      }
    });
  }
  const sbDef = document.getElementById('sidebarDefaultSetting');
  if (sbDef) {
    sbDef.addEventListener('change', () => {
      try { localStorage.setItem('sidebarDefault', sbDef.value); } catch (_) {}
    });
  }
  const saveBtn = document.getElementById('appearanceSaveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      // Everything is persisted on change; just confirm.
      if (window.Toast) window.Toast.success(t('settingsAppearanceSaved', 'Appearance saved'));
    });
  }
}

/* ---------- Render ---------- */
function renderTabContent() {
  switch (state.activeTab) {
    case 'store':      return renderStoreTab();
    case 'company':    return renderCompanyTab();
    case 'profile':    return renderProfileTab();
    case 'appearance': return renderAppearanceTab();
    case 'ai':         return renderAiTab();
    case 'alerts':     return renderAlertsTab();
    default:           return renderStoreTab();
  }
}

function bindTabContent() {
  switch (state.activeTab) {
    case 'store':      bindStoreTab(); break;
    case 'company':    bindCompanyTab(); break;
    case 'profile':    bindProfileTab(); break;
    case 'appearance': bindAppearanceTab(); break;
    case 'ai':         bindAiTab(); break;
    case 'alerts':     bindAlertsTab(); break;
  }
}

function render() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const header = `
    <div class="page-header">
      <div>
        <div class="page-title">${t('settings', 'Settings')}</div>
        <div class="page-subtitle">${t('settingsPageSubtitle', 'Configure your store, company information, profile and appearance')}</div>
      </div>
    </div>`;
  content.innerHTML = header + renderTabs() + '<div id="settingsTabContent" style="margin-top:1rem;">' + renderTabContent() + '</div>';
  bindTabs();
  bindTabContent();
}

function bindTabs() {
  document.querySelectorAll('#pageContent .tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll('#pageContent .tab-item').forEach(b => b.classList.toggle('active', b === btn));
      const c = document.getElementById('settingsTabContent');
      if (c) { c.innerHTML = renderTabContent(); bindTabContent(); }
    });
  });
}

/* ---------- Load ---------- */
async function loadSettings() {
  try {
    const r = await apiFetch.get('/api/settings');
    if (r && r.success && r.data) {
      // Backend returns { success, data: { settings: {...} } }
      state.settings = (r.data.settings) ? r.data.settings : r.data;
    } else {
      state.settings = state.settings || { companyInfo: {} };
    }
  } catch (err) {
    // 403 means non-admin — but GET should be allowed; still degrade gracefully
    console.warn('[settings] load', err);
    state.settings = state.settings || { companyInfo: {} };
  }
}

async function loadCurrentUser() {
  // Prefer localStorage (already stored at login), refresh from /api/auth/me
  state.user = getCurrentUser();
  state.isAdmin = state.user && (state.user.role === 'admin' || state.user.role === 'manager');
  try {
    const r = await apiFetch.get('/api/auth/me');
    if (r && r.success && (r.data || r.user)) {
      // Backend returns { success, data: { user: {...} } }
      const u = (r.data && r.data.user) ? r.data.user : (r.data || r.user);
      state.user = u;
      try { localStorage.setItem('user', JSON.stringify(state.user)); } catch (_) {}
      state.isAdmin = state.user && (state.user.role === 'admin' || state.user.role === 'manager');
    }
  } catch (err) {
    // /me might fail; rely on localStorage user
    console.warn('[settings] /auth/me', err);
  }
}

/* ---------- v3 — AI settings tab ---------- */
function renderAiTab() {
  const isAdmin = state.isAdmin;
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">🤖 ${t('aiTabTitle', 'إعداد Google Gemini (مجاني)')}</div></div>
      <div class="card-body">
        <p class="muted" style="margin-bottom:12px">${t('aiTabHint', 'احصل على مفتاح API مجاني من aistudio.google.com/apikey ثم الصقه هنا لتفعيل كل ميزات الذكاء الاصطناعي: المساعد الذكي، قراءة فواتير الموردين، التنبؤ، كشف الشواذ، والملخص اليومي.')}</p>
        ${isAdmin ? `
        <div class="form-grid">
          <div class="form-field">
            <label>${t('geminiKey', 'مفتاح Gemini API')}</label>
            <input type="password" class="input" id="geminiKeyInput" placeholder="AIza..." autocomplete="off" />
            <small class="muted">${t('geminiKeyStored', 'يُخزَّن في الخادم بأمان (إعدادات المنصة)')}</small>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary" id="saveGeminiKey">💾 ${t('saveKey', 'حفظ المفتاح')}</button>
          <button class="btn btn-secondary" id="testAi">⚡ ${t('testAi', 'اختبار الاتصال')}</button>
        </div>
        <div id="aiTestResult" style="margin-top:10px"></div>` : `<p class="muted">${t('adminOnly', 'Admin only')}</p>`}
        <hr style="margin:16px 0;border-color:var(--border,#e5e7eb)" />
        <h4 style="margin-bottom:8px">📲 ${t('pushSettings', 'إشعارات الهاتف (Web Push)')}</h4>
        <p class="muted" style="margin-bottom:10px">${t('pushHint', 'تعمل الإشعارات في الخلفية حتى لو كان الموقع مغلقاً أو الشاشة مطفأة (ثبّت التطبيق على الهاتف لأفضل نتيجة).')}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="enablePushBtn">🔔 ${t('enablePush', 'تفعيل إشعارات الهاتف')}</button>
          <button class="btn btn-secondary" id="testPushBtn">📨 ${t('testPush', 'إرسال إشعار تجريبي')}</button>
        </div>
      </div>
    </div>`;
}

function bindAiTab() {
  const saveBtn = document.getElementById('saveGeminiKey');
  const testBtn = document.getElementById('testAi');
  const out = document.getElementById('aiTestResult');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const key = document.getElementById('geminiKeyInput').value.trim();
    if (!key) return;
    try {
      await apiFetch.post('/api/settings/gemini-key', { key });
      window.Toast && Toast.success(t('saved', 'تم الحفظ'));
    } catch (err) { window.Toast && Toast.error(err.message); }
  });
  if (testBtn) testBtn.addEventListener('click', async () => {
    if (out) out.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
    try {
      const res = await apiFetch.post('/api/ai/daily-summary', { lang: (window.currentLang || 'ar') });
      const text = (res.data && res.data.text) || '';
      if (out) out.innerHTML = `<div class="ai-narrative card"><strong>✅</strong><div>${String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br/>').slice(0, 600)}</div></div>`;
    } catch (err) {
      if (out) out.innerHTML = `<div class="empty-state"><div class="empty-title">⛔ ${String(err.message).replace(/</g,'&lt;')}</div></div>`;
    }
  });
  const enableBtn = document.getElementById('enablePushBtn');
  if (enableBtn) enableBtn.addEventListener('click', async () => {
    if (window.DZPWA) await window.DZPWA.enablePush(false);
  });
  const testPushBtn = document.getElementById('testPushBtn');
  if (testPushBtn) testPushBtn.addEventListener('click', async () => {
    try {
      const r = await apiFetch.post('/api/push/test');
      const sent = r.data && r.data.sent;
      window.Toast && (sent > 0 ? Toast.success(t('pushSent', 'أُرسل الإشعار ✓ (قد يستغرق ثوانٍ)')) : Toast.warning(t('pushNoDevice', 'لا أجهزة مشتركة — فعّل الإشعارات أولاً')));
    } catch (err) { window.Toast && Toast.error(err.message); }
  });
}

/* ---------- v3 — Smart alerts tab ---------- */
const ALERT_DEFS = [
  { type: 'lowStock',     icon: '📦', thLabel: 'lowStockTh',   thHint: 'lowStockThHint' },
  { type: 'zeroSalesDay', icon: '🌤️', thLabel: 'zeroSalesTh',  thHint: 'zeroSalesThHint' },
  { type: 'dailyTarget',  icon: '🎯', thLabel: 'targetTh',     thHint: 'targetThHint' },
  { type: 'anomalyScan',  icon: '🛡️', thLabel: 'anomalyTh',    thHint: 'anomalyThHint' },
  { type: 'dailySummary', icon: '🌙', thLabel: 'summaryTh',    thHint: 'summaryThHint' }
];

function renderAlertsTab() {
  const list = (state.alertConfigs || []).map(c => {
    const def = ALERT_DEFS.find(d => d.type === c.type) || {};
    const roleChecks = ['admin', 'manager', 'cashier'].map(r =>
      `<label style="margin-inline-end:12px"><input type="checkbox" class="alert-role" data-type="${c.type}" value="${r}" ${(c.notifyRoles || []).includes(r) ? 'checked' : ''}/> ${t('role' + r.charAt(0).toUpperCase() + r.slice(1), r)}</label>`
    ).join('');
    return `
      <div class="card" style="margin-bottom:12px">
        <div class="card-body" style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
          <div style="font-size:28px">${def.icon || '🔔'}</div>
          <div style="flex:1;min-width:260px">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
              <strong>${t('alert_' + c.type, c.type)}</strong>
              <label style="margin-inline-start:auto"><input type="checkbox" class="alert-enabled" data-type="${c.type}" ${c.enabled ? 'checked' : ''}/> ${t('active', 'نشط')}</label>
            </div>
            <div class="form-field" style="max-width:280px">
              <label>${t(def.thLabel, 'الحد')}</label>
              <input type="number" class="input alert-th" data-type="${c.type}" value="${c.threshold || 0}" />
              <small class="muted">${t(def.thHint, '')}</small>
            </div>
            <div style="margin-top:6px">${roleChecks}</div>
          </div>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">🔔 ${t('alertsTabTitle', 'التنبيهات الذكية القابلة للتهيئة')}</div></div>
      <div class="card-body">
        <p class="muted" style="margin-bottom:12px">${t('alertsTabHint', 'لكل تنبيه: فعّله، اضبط حدّه، واختر من يستقبل الإشعار (داخل المنصة + إشعار الهاتف).')}</p>
        <div id="alertsList">${list || '<div class="loading-state"><div class="spinner"></div></div>'}</div>
        <button class="btn btn-primary" id="saveAlerts" style="margin-top:12px">💾 ${t('save', 'حفظ')}</button>
      </div>
    </div>`;
}

async function bindAlertsTab() {
  // load configs
  try {
    const r = await apiFetch.get('/api/alerts');
    state.alertConfigs = (r.data && r.data.data) || r.data || [];
    const listEl = document.getElementById('alertsList');
    if (listEl) { listEl.innerHTML = renderAlertsListInner(); }
  } catch (_) {}
  const saveBtn = document.getElementById('saveAlerts');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const types = ALERT_DEFS.map(d => d.type);
    try {
      for (const type of types) {
        const enabledEl = document.querySelector(`.alert-enabled[data-type="${type}"]`);
        const thEl = document.querySelector(`.alert-th[data-type="${type}"]`);
        const roles = Array.from(document.querySelectorAll(`.alert-role[data-type="${type}"]:checked`)).map(c => c.value);
        await apiFetch.put('/api/alerts/' + type, {
          enabled: enabledEl ? enabledEl.checked : undefined,
          threshold: thEl ? Number(thEl.value) || 0 : undefined,
          notifyRoles: roles
        });
      }
      window.Toast && Toast.success(t('saved', 'تم الحفظ ✓'));
    } catch (err) { window.Toast && Toast.error(err.message); }
  });
}

function renderAlertsListInner() {
  state.alertConfigs = state.alertConfigs || [];
  const tmp = renderAlertsTab;
  // reuse the same markup minus the outer card/save button
  const list = (state.alertConfigs || []).map(c => {
    const def = ALERT_DEFS.find(d => d.type === c.type) || {};
    const roleChecks = ['admin', 'manager', 'cashier'].map(r =>
      `<label style="margin-inline-end:12px"><input type="checkbox" class="alert-role" data-type="${c.type}" value="${r}" ${(c.notifyRoles || []).includes(r) ? 'checked' : ''}/> ${t('role' + r.charAt(0).toUpperCase() + r.slice(1), r)}</label>`
    ).join('');
    return `
      <div class="card" style="margin-bottom:12px">
        <div class="card-body" style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
          <div style="font-size:28px">${def.icon || '🔔'}</div>
          <div style="flex:1;min-width:260px">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
              <strong>${t('alert_' + c.type, c.type)}</strong>
              <label style="margin-inline-start:auto"><input type="checkbox" class="alert-enabled" data-type="${c.type}" ${c.enabled ? 'checked' : ''}/> ${t('active', 'نشط')}</label>
            </div>
            <div class="form-field" style="max-width:280px">
              <label>${t(def.thLabel, 'الحد')}</label>
              <input type="number" class="input alert-th" data-type="${c.type}" value="${c.threshold || 0}" />
              <small class="muted">${t(def.thHint, '')}</small>
            </div>
            <div style="margin-top:6px">${roleChecks}</div>
          </div>
        </div>
      </div>`;
  }).join('');
  void tmp;
  return list;
}

/* ---------- Entry ---------- */
export async function renderSettingsPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  state.activeTab = 'store';
  state.loading = true;
  content.innerHTML = renderSkeleton();
  await Promise.all([loadSettings(), loadCurrentUser()]);
  state.loading = false;
  render();
}
