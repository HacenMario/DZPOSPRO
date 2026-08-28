// backend/utils/csv.js
// Minimal dependency-free CSV helpers shared by the products import/export.
//
// parseCsv(text)  → string[][]  (RFC4180-ish: quoted fields, "" escapes,
//                                 CRLF/LF, UTF-8 BOM, auto , / ; delimiter)
// csvEscape(v)    → string      (quote a single cell when needed)
// toCsv(headers, rows) → string (full CSV body without BOM, CRLF line endings)

function detectDelimiter(text) {
    // Count , and ; on the first (header) line — outside quotes is close
    // enough for header rows, which rarely contain either character.
    let comma = 0, semi = 0, inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === '\n' || ch === '\r') break;
        else if (!inQuotes) {
            if (ch === ',') comma++;
            else if (ch === ';') semi++;
        }
    }
    return semi > comma ? ';' : ',';
}

function parseCsv(text) {
    if (typeof text !== 'string') return [];
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
    if (!text.length) return [];

    const delim = detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const n = text.length;

    while (i < n) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            field += ch; i++; continue;
        }
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === delim) { row.push(field); field = ''; i++; continue; }
        if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field); rows.push(row);
            row = []; field = ''; i++; continue;
        }
        field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

function csvEscape(v) {
    const s = (v === undefined || v === null) ? '' : String(v);
    if (/[",;\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function toCsv(headers, rows) {
    const lines = [headers.map(csvEscape).join(',')];
    (rows || []).forEach(r => lines.push((r || []).map(csvEscape).join(',')));
    return lines.join('\r\n');
}

module.exports = { parseCsv, csvEscape, toCsv };
