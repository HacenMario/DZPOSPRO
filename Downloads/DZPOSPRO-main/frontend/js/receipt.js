/* ============================================================
 * js/receipt.js — Shared receipt / ticket utilities
 * ------------------------------------------------------------
 * Exposes:
 *   window.invoiceLabels(lang)      — translated invoice strings
 *   window.buildTicketHTML(sale, settings, lang, opts)
 *                                   — 80mm thermal ticket markup
 *   window.printThermalTicket(sale, settings, lang)
 *                                   — print an 80mm ticket
 *   window.chooseInvoiceLanguage()  — Promise<'fr'|'en'|null>
 *                                   — popup to pick print language
 *
 * The A4 invoice (PDF + on-screen receipt sheet) is untouched —
 * this module only ADDS the classic 80mm ticket format used by
 * thermal POS printers.
 * ============================================================ */

(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function t(key, fallback) {
    if (typeof global.t === 'function') {
      const v = global.t(key, fallback);
      return v || fallback || key;
    }
    return fallback || key;
  }

  /* ------------------------------------------------------------
   * Invoice label set — FR (Algerian legal wording) and EN.
   * Arabic is intentionally NOT offered for the printed invoice:
   * jsPDF core fonts cannot render Arabic glyphs (garbled text).
   * ---------------------------------------------------------- */
  const LABELS = {
    fr: {
      invoice: 'FACTURE',
      invoiceNumber: 'N° Facture',
      date: 'Date',
      customer: 'Client',
      walkin: 'Particulier',
      payment: 'Paiement',
      cash: 'Espèces',
      card: 'Carte',
      transfer: 'Virement',
      split: 'Mixte',
      product: 'Produit',
      unit: 'Unité',
      qty: 'Qté',
      unitPriceHT: 'P.Unitaire H.T',
      amountHT: 'Montant H.T',
      totalHT: 'Total H.T',
      itemDiscounts: 'Remises articles',
      cartDiscount: 'Remise',
      coupon: 'Coupon',
      vat: 'TVA',
      stamp: 'Timbre',
      totalTTC: 'TOTAL T.T.C',
      wordsIntro: 'Arrêté la présente facture à la somme de :',
      thanks: 'Merci de votre confiance',
      ticket: 'TICKET',
      tel: 'Tél'
    },
    en: {
      invoice: 'INVOICE',
      invoiceNumber: 'Invoice No.',
      date: 'Date',
      customer: 'Customer',
      walkin: 'Walk-in customer',
      payment: 'Payment',
      cash: 'Cash',
      card: 'Card',
      transfer: 'Transfer',
      split: 'Split',
      product: 'Product',
      unit: 'Unit',
      qty: 'Qty',
      unitPriceHT: 'Unit price (excl.)',
      amountHT: 'Amount (excl.)',
      totalHT: 'Total (excl. tax)',
      itemDiscounts: 'Item discounts',
      cartDiscount: 'Discount',
      coupon: 'Coupon',
      vat: 'VAT',
      stamp: 'Stamp duty',
      totalTTC: 'TOTAL (incl. tax)',
      wordsIntro: 'Invoice total amount:',
      thanks: 'Thank you for your trust',
      ticket: 'RECEIPT',
      tel: 'Tel'
    }
  };

  function invoiceLabels(lang) {
    return (lang === 'en') ? LABELS.en : LABELS.fr;
  }

  function paymentLabelKey(method) {
    switch (String(method || 'cash').toLowerCase()) {
      case 'card': return 'card';
      case 'transfer': return 'transfer';
      case 'split': return 'split';
      default: return 'cash';
    }
  }

  function fmtMoney(v, currency) {
    return Number(v || 0).toFixed(2) + ' ' + (currency || 'DZD');
  }

  function fmtDate(d) {
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d || '');
      const p = (n) => String(n).padStart(2, '0');
      return p(dt.getDate()) + '/' + p(dt.getMonth() + 1) + '/' + dt.getFullYear() +
        ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
    } catch (_) { return String(d || ''); }
  }

  function resolveCustomerName(cust, fallback) {
    if (!cust) return fallback || '';
    if (typeof cust === 'string') return cust;
    if (typeof cust.displayName === 'string' && cust.displayName) return cust.displayName;
    if (cust.name && typeof cust.name === 'object') return cust.name.ar || cust.name.en || cust.name.fr || '';
    if (typeof cust.name === 'string' && cust.name) return cust.name;
    return fallback || '';
  }

  function normalizeItems(sale) {
    return (sale.items || []).map(it => {
      const name = it.productName ||
        (it.product && (typeof it.product.name === 'object'
          ? (it.product.name.ar || it.product.name.en || it.product.name.fr)
          : (it.product.name || it.product))) ||
        it.name || '—';
      const qty = Number(it.quantity) || 0;
      const price = Number(it.price) || 0;
      const discount = Number(it.discount) || 0;
      const total = Number(it.total) || Math.max(0, qty * price - discount);
      return { name, qty, price, discount, total };
    });
  }

  /* ------------------------------------------------------------
   * 80mm thermal ticket markup (printed via printThermalTicket)
   * ---------------------------------------------------------- */
  function buildTicketHTML(sale, settings, lang) {
    const L = invoiceLabels(lang);
    const store = settings || {};
    const company = store.companyInfo || {};
    const currency = store.currency || 'DZD';
    const items = normalizeItems(sale);
    const subtotal = Number(sale.subtotal) || 0;
    const cartDiscount = Number(sale.discount) || 0;
    const couponDiscount = Number(sale.couponDiscount) || 0;
    const itemDiscounts = items.reduce((s, it) => s + (Number(it.discount) || 0), 0);
    const tax = Number(sale.tax) || 0;
    const taxRate = Number(store.taxRate || 0);
    const timbre = Number(sale.timbre) || 0;
    const total = Number(sale.total) || 0;
    const invoiceNo = sale.saleNumber || '';
    const saleDate = fmtDate(sale.saleDate || sale.createdAt || new Date());
    const rawCustomer = resolveCustomerName(sale.customer, '');
    const customerName = rawCustomer || L.walkin;
    const payLabel = L[paymentLabelKey(sale.paymentMethod)] || L.cash;
    const footer = store.invoiceFooter || L.thanks;

    const row = (label, value, strong) =>
      '<div class="tk-row' + (strong ? ' tk-strong' : '') + '"><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(value) + '</span></div>';

    let itemsHtml = '';
    items.forEach(it => {
      itemsHtml +=
        '<div class="tk-item-name">' + escapeHtml(it.name) + '</div>' +
        '<div class="tk-item-line"><span>' + it.qty + ' × ' + escapeHtml(fmtMoney(it.price, currency)) + '</span>' +
        '<span>' + escapeHtml(fmtMoney(it.total, currency)) + '</span></div>';
    });

    return `
<div class="ticket-80">
  <div class="tk-center tk-store">${escapeHtml(store.storeName || 'DZ POS PRO')}</div>
  ${company.address ? `<div class="tk-center tk-small">${escapeHtml(company.address)}</div>` : ''}
  ${company.phone ? `<div class="tk-center tk-small">${escapeHtml(L.tel)}: ${escapeHtml(company.phone)}</div>` : ''}
  ${(company.rc || company.nif) ? `<div class="tk-center tk-tiny">${company.rc ? 'RC: ' + escapeHtml(company.rc) + ' ' : ''}${company.nif ? 'NIF: ' + escapeHtml(company.nif) : ''}</div>` : ''}
  <div class="tk-dashed"></div>
  <div class="tk-row"><span><strong>${escapeHtml(L.ticket)}</strong></span><span>${escapeHtml(invoiceNo)}</span></div>
  <div class="tk-row"><span>${escapeHtml(L.date)}</span><span>${escapeHtml(saleDate)}</span></div>
  <div class="tk-row"><span>${escapeHtml(L.customer)}</span><span>${escapeHtml(customerName)}</span></div>
  <div class="tk-row"><span>${escapeHtml(L.payment)}</span><span>${escapeHtml(payLabel)}</span></div>
  <div class="tk-dashed"></div>
  ${itemsHtml}
  <div class="tk-dashed"></div>
  ${row(L.totalHT, fmtMoney(subtotal, currency))}
  ${itemDiscounts > 0 ? row(L.itemDiscounts, '- ' + fmtMoney(itemDiscounts, currency)) : ''}
  ${cartDiscount > 0 ? row(L.cartDiscount, '- ' + fmtMoney(cartDiscount, currency)) : ''}
  ${couponDiscount > 0 ? row(L.coupon + ' (' + escapeHtml(sale.couponCode || '') + ')', '- ' + fmtMoney(couponDiscount, currency)) : ''}
  ${tax > 0 ? row(L.vat + ' (' + taxRate + '%)', fmtMoney(tax, currency)) : ''}
  ${timbre > 0 ? row(L.stamp, fmtMoney(timbre, currency)) : ''}
  <div class="tk-dashed"></div>
  <div class="tk-row tk-total"><span>${escapeHtml(L.totalTTC)}</span><span>${escapeHtml(fmtMoney(total, currency))}</span></div>
  <div class="tk-dashed"></div>
  <div class="tk-center tk-small">${escapeHtml(footer)}</div>
  <div class="tk-center tk-tiny">DZ POS PRO</div>
</div>`;
  }

  /* ------------------------------------------------------------
   * Print the 80mm ticket. Injects a dedicated print stylesheet,
   * renders the ticket off-screen, calls window.print(), cleans up.
   * ---------------------------------------------------------- */
  function printThermalTicket(sale, settings, lang) {
    const prevArea = document.getElementById('ticketPrintArea');
    if (prevArea) prevArea.remove();
    const prevStyle = document.getElementById('ticketPrintCss');
    if (prevStyle) prevStyle.remove();

    const style = document.createElement('style');
    style.id = 'ticketPrintCss';
    style.textContent = `
      #ticketPrintArea { display: none; }
      @media print {
        body.printing-ticket * { visibility: hidden !important; }
        body.printing-ticket #ticketPrintArea,
        body.printing-ticket #ticketPrintArea * { visibility: visible !important; }
        body.printing-ticket #ticketPrintArea {
          display: block !important;
          position: absolute !important;
          inset-inline-start: 0 !important;
          top: 0 !important;
          width: 72mm !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        @page { size: 80mm auto; margin: 3mm; }
      }
      .ticket-80 {
        font-family: 'JetBrains Mono', 'Courier New', monospace;
        color: #000; background: #fff;
        font-size: 11px; line-height: 1.45;
        width: 72mm; padding: 0 1mm;
      }
      .ticket-80 .tk-center { text-align: center; }
      .ticket-80 .tk-store { font-size: 15px; font-weight: 800; letter-spacing: 0.5px; }
      .ticket-80 .tk-small { font-size: 10px; }
      .ticket-80 .tk-tiny { font-size: 8.5px; color: #333; }
      .ticket-80 .tk-row { display: flex; justify-content: space-between; gap: 4px; font-size: 10.5px; }
      .ticket-80 .tk-row.tk-total { font-size: 13px; font-weight: 800; }
      .ticket-80 .tk-dashed { border-top: 1px dashed #000; margin: 3px 0; }
      .ticket-80 .tk-item-name { font-size: 10.5px; font-weight: 600; margin-top: 2px; word-break: break-word; }
      .ticket-80 .tk-item-line { display: flex; justify-content: space-between; font-size: 10.5px; }
    `;
    document.head.appendChild(style);

    const area = document.createElement('div');
    area.id = 'ticketPrintArea';
    area.innerHTML = buildTicketHTML(sale, settings, lang);
    document.body.appendChild(area);

    document.body.classList.add('printing-ticket');
    setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        console.warn('[receipt] print failed', e);
      } finally {
        setTimeout(() => {
          document.body.classList.remove('printing-ticket');
          if (area.parentNode) area.remove();
          if (style.parentNode) style.remove();
        }, 600);
      }
    }, 120);
  }

  /* ------------------------------------------------------------
   * Language chooser popup shown right before completing a sale.
   * Resolves 'fr' | 'en' | null (cancelled). Remembers the last
   * choice and offers a "don't ask again" toggle.
   * ---------------------------------------------------------- */
  function chooseInvoiceLanguage() {
    const remembered = (() => {
      try { return localStorage.getItem('invoicePrintLang'); } catch (_) { return null; }
    })();
    const skipAsk = (() => {
      try { return localStorage.getItem('invoicePrintLangSkipAsk') === '1'; } catch (_) { return false; }
    })();
    if (remembered && skipAsk) return Promise.resolve(remembered);

    const lang = (typeof global.currentLang !== 'undefined' && global.currentLang) ||
      (localStorage.getItem('lang') || 'ar');
    const ui = {
      ar: { title: 'لغة طباعة الفاتورة', sub: 'اختر لغة الفاتورة المطبوعة (دون تغيير لغة الصفحة)', remember: 'لا تسأل مرة أخرى — استخدم هذا الخيار دائماً', print: 'متابعة', cancel: 'إلغاء' },
      en: { title: 'Invoice print language', sub: 'Choose the language of the printed invoice (page language stays unchanged)', remember: 'Don\'t ask again — always use this choice', print: 'Continue', cancel: 'Cancel' },
      fr: { title: 'Langue d\'impression de la facture', sub: 'Choisissez la langue de la facture imprimée (sans changer la langue de la page)', remember: 'Ne plus demander — toujours utiliser ce choix', print: 'Continuer', cancel: 'Annuler' }
    }[lang] || {};

    if (typeof Swal === 'undefined') {
      return Promise.resolve(remembered || 'fr');
    }

    return Swal.fire({
      title: ui.title,
      html:
        '<div style="font-size:0.85rem;color:#64748b;margin-bottom:0.9rem;">' + (ui.sub || '') + '</div>' +
        '<div style="display:flex;gap:0.75rem;justify-content:center;">' +
          '<button id="invLangFr" type="button" style="flex:1;max-width:160px;padding:1rem 0.5rem;border:2px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer;font-weight:800;font-size:1rem;color:#0f172a;transition:all .15s;" onmouseover="this.style.borderColor=\'#10b981\'" onmouseout="this.style.borderColor=\'#e2e8f0\'">Français</button>' +
          '<button id="invLangEn" type="button" style="flex:1;max-width:160px;padding:1rem 0.5rem;border:2px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer;font-weight:800;font-size:1rem;color:#0f172a;transition:all .15s;" onmouseover="this.style.borderColor=\'#10b981\'" onmouseout="this.style.borderColor=\'#e2e8f0\'">English</button>' +
        '</div>' +
        '<label style="display:flex;align-items:center;gap:0.45rem;justify-content:center;margin-top:1rem;font-size:0.8rem;color:#475569;cursor:pointer;">' +
          '<input type="checkbox" id="invLangRemember" style="width:16px;height:16px;accent-color:#10b981;" /> ' + (ui.remember || '') +
        '</label>',
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: ui.cancel,
      cancelButtonColor: '#64748b',
      allowOutsideClick: false,
      didOpen: () => {
        const pick = (value) => {
          const remember = document.getElementById('invLangRemember');
          if (remember && remember.checked) {
            try {
              localStorage.setItem('invoicePrintLang', value);
              localStorage.setItem('invoicePrintLangSkipAsk', '1');
            } catch (_) {}
          }
          Swal.close({ value });
        };
        const fr = document.getElementById('invLangFr');
        const en = document.getElementById('invLangEn');
        if (fr) fr.addEventListener('click', () => pick('fr'));
        if (en) en.addEventListener('click', () => pick('en'));
        if (remembered) {
          const pre = document.getElementById(remembered === 'en' ? 'invLangEn' : 'invLangFr');
          if (pre) { pre.style.borderColor = '#10b981'; pre.style.background = '#f0fdf4'; }
        }
      }
    }).then(r => (r && r.value) || null);
  }

  function getStoredInvoiceLang() {
    try { return localStorage.getItem('invoicePrintLang') || 'fr'; } catch (_) { return 'fr'; }
  }

  global.invoiceLabels = invoiceLabels;
  global.buildTicketHTML = buildTicketHTML;
  global.printThermalTicket = printThermalTicket;
  global.chooseInvoiceLanguage = chooseInvoiceLanguage;
  global.getStoredInvoiceLang = getStoredInvoiceLang;
})(window);
