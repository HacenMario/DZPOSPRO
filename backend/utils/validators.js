// ✅ التحقق من رقم الهاتف الجزائري (05xx xx xx xx)
const isValidAlgerianPhone = (phone) => {
    if (!phone) return false;
    // إزالة المسافات والعلامات
    const cleaned = phone.replace(/\s/g, '').replace(/\+213/g, '0');
    // التحقق من الصيغة: 05 أو 06 أو 07 متبوعة بـ 8 أرقام
    const regex = /^(05|06|07)\d{8}$/;
    return regex.test(cleaned);
};

// ✅ التحقق من صيغة الباركود (أرقام فقط وطول مناسب)
const isValidBarcode = (barcode) => {
    if (!barcode) return true; // الباركود ليس إجبارياً
    return /^[0-9]{8,13}$/.test(barcode);
};

// ✅ التحقق من صيغة SKU (حروف وأرقام وشرطات)
const isValidSKU = (sku) => {
    if (!sku) return true;
    return /^[A-Za-z0-9\-_]{3,20}$/.test(sku);
};

// ✅ التحقق من أن التاريخ ليس في الماضي (للكوبونات)
const isFutureDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    return date > now;
};

// ✅ التحقق من أن السعر أكبر من سعر التكلفة (للأرباح)
const isPriceValid = (price, costPrice) => {
    if (price === undefined || costPrice === undefined) return true;
    return parseFloat(price) >= parseFloat(costPrice);
};

// ✅ تنظيف النص من علامات HTML لحماية الـ XSS
const sanitizeText = (text) => {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

module.exports = {
    isValidAlgerianPhone,
    isValidBarcode,
    isValidSKU,
    isFutureDate,
    isPriceValid,
    sanitizeText
};