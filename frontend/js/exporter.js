/* ============================================================
 * js/exporter.js — Professional Excel / PDF export (v3)
 * ------------------------------------------------------------
 * Exposes window.DZExport:
 *   exportToExcel({ columns, rows, filename, title, meta })
 *   exportToPDF({ columns, rows, filename, title, meta, landscape })
 *   exportTableToExcel(tableEl, filename)  — any existing <table>
 *
 * Excel: SheetJS (vendored xlsx.full.min.js) → real .xlsx
 * PDF:   jsPDF + autotable (already loaded in dashboard.html)
 * Both render RTL-friendly headers + store name + timestamp.
 * ============================================================ */

(function (global) {
  'use strict';

  function t(key, fb) { return (typeof window.t === 'function') ? window.t(key, fb) : fb; }

  function getStoreName() {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      return u.store ? u.store.name : (u.name || 'DZ POS PRO');
    } catch (_) { return 'DZ POS PRO'; }
  }

  function pickName(v, lang) {
    if (v && typeof v === 'object') return v[lang] || v.ar || v.en || v.fr || '';
    return v;
  }

  /* ---------------- Excel ---------------- */
  async function exportToExcel(opts) {
    const { columns, rows, filename, title, meta } = normalize(opts);
    if (typeof XLSX === 'undefined') { alert(t('xlsxLibMissing', 'مكتبة Excel غير محملة')); return; }

    const header = columns.map(c => c.label);
    const body = rows.map(r => columns.map(c => {
      const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
      return v === undefined || v === null ? '' : v;
    }));

    const wsData = [];
    wsData.push([getStoreName()]);
    if (title) wsData.push([title]);
    wsData.push([t('generatedOn', 'تاريخ الإنشاء') + ': ' + new Date().toLocaleString()]);
    if (meta) wsData.push([meta]);
    wsData.push([]);
    wsData.push(header);
    body.forEach(r => wsData.push(r));

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // column widths
    ws['!cols'] = columns.map((c, i) => ({
      wch: Math.min(Math.max(
        String(header[i]).length + 4,
        ...body.map(r => String(r[i] == null ? '' : r[i]).length + 2)
      ), 45)
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (title || 'Export').slice(0, 30));
    XLSX.writeFile(wb, (filename || 'export') + '.xlsx');
  }

  /* ---------------- PDF ---------------- */
  async function exportToPDF(opts) {
    const { columns, rows, filename, title, meta, landscape } = normalize(opts);
    if (!global.jspdf || !global.jspdf.jsPDF) { alert(t('pdfLibraryMissing', 'مكتبة PDF غير محملة')); return; }

    const jsPDF = global.jspdf.jsPDF;
    const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });

    const lang = (typeof window.currentLang !== 'undefined' && window.currentLang) || 'ar';
    const isRTL = lang === 'ar';

    // header
    doc.setFontSize(16);
    doc.text(getStoreName(), 14, 15);
    doc.setFontSize(11);
    if (title) doc.text(String(title), 14, 22);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(t('generatedOn', 'تاريخ الإنشاء') + ': ' + new Date().toLocaleString(), 14, 28);
    if (meta) doc.text(String(meta), 14, 33);
    doc.setTextColor(0);

    const head = [columns.map(c => c.label)];
    const body = rows.map(r => columns.map(c => {
      const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
      return v === undefined || v === null ? '' : (typeof v === 'object' ? pickName(v, lang) : String(v));
    }));

    if (global.autoTable) {
      global.autoTable(doc, {
        head, body,
        startY: meta ? 38 : 33,
        styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak', halign: isRTL ? 'right' : 'left' },
        headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 248, 247] },
        margin: { left: 14, right: 14 }
      });
    } else {
      doc.text(body.map(r => r.join(' | ')).join('\n'), 14, 40);
    }

    // footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text('DZ POS PRO — ' + i + '/' + pageCount, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 8);
    }

    doc.save((filename || 'export') + '.pdf');
  }

  /* ---------------- generic table ---------------- */
  function exportTableToExcel(tableEl, filename, title) {
    if (!tableEl) return;
    const headCells = Array.from(tableEl.querySelectorAll('thead th'));
    const columns = headCells.map((th, i) => ({
      label: th.textContent.trim(),
      value: (row) => row['__c' + i]
    }));
    const rows = Array.from(tableEl.querySelectorAll('tbody tr')).map(tr => {
      const o = {};
      Array.from(tr.children).forEach((td, i) => { o['__c' + i] = td.textContent.trim(); });
      return o;
    });
    return exportToExcel({ columns, rows, filename, title });
  }

  function normalize(opts) {
    return Object.assign({ columns: [], rows: [], filename: 'dzpospro-export', title: '', meta: '', landscape: false }, opts || {});
  }

  global.DZExport = { exportToExcel, exportToPDF, exportTableToExcel };
})(window);
