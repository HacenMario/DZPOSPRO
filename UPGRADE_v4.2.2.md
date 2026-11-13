# DZPOSPRO v4.2.2 — ثلاثة إصلاحات بعد تحديث v4.2.1

> الواجهة `https://dzpospro.vercel.app` — الخادم `https://dzpospro-production-ec3f34a9.up.railway.app`

## 1) تسجيل الدخول يعمل على رابط Railway ولا يعمل على Vercel
**السبب الجذري (مُثبت بالقياس المباشر على الموقع الحي):** الواجهة v4.2 تُرسل لغة التطبيق مع كل طلب عبر الترويسة المخصصة `x-dzpos-lang`. هذه الترويسة **لم تكن مدرجة** في قائمة `allowedHeaders` بـ CORS على الخادم — فالمتصفح يرفض كل الطلبات العابرة للنطاقات (Vercel → Railway) بخطأ `Failed to fetch` ← «تعذّر الوصول إلى الخادم». أما عندما تفتح النظام من رابط Railway فالواجهة والخادم على **نفس النطاق** ولا يُفعَّل CORS أصلاً — لذلك كان يعمل هناك فقط.

**الإصلاح:** `backend/server.js` أصبح يسمح صراحةً بـ `Accept-Language` و `x-dzpos-lang` إلى جانب Content-Type/Authorization/Accept.

**الدليل:** محاكاة preflight بالمتصفح قبل الإصلاح: `x-dzpos-lang → Failed to fetch`. بعد الإصلاح: الاستجابة تشمل `Access-Control-Allow-Headers: Content-Type,Authorization,Accept,Accept-Language,x-dzpos-lang`.

## 2) صفحة المنتجات لا تفتح: «Failed to load module — does not provide an export named 'default'»
**السبب الجذري:** سطر برمجي خاطئ في `js/modules/products.js`: `import API_BASE from '../config.js'` — بينما `config.js` سكربت تقليدي (IIFE) وليس ES Module، ففشل تحميل الوحدة كلها ومنع فتح الصفحة.

**الإصلاح:** أُزيل الاستيراد، والصفحة تقرأ الرابط لحظياً عبر `window.dzposApiBase()` مثل بقية الصفحات + تُمرَّر لغة التطبيق في كل الطلبات + تنظيف رسائل التصحيح من الكونسول.

## 3) اختبار الإشعارات يعطي «Server error»
**السبب الجذري:** في `backend/services/pushService.js` كان كود تنظيف الاشتراكات المنتهية (404/410) يستدعي `PushSubscription.deleteOne` **بدون استيراد الموديل** ← `ReferenceError` ← خطأ 500 «Server error» عند الاختبار.

**الإصلاح:** إضافة الاستيراد الناقص — الآن التنظيف يعمل والاختبار يعيد `{sent, subscribed}` طبيعياً حتى مع وجود اشتراكات قديمة.

## التحقق
- `node --check` على كل الملفات المعدّلة.
- فحص شامل لكل خدمات الـ backend بحثاً عن نماذج مستخدمة بدون استيراد (لا نتائج أخرى).
- preflight حقيقي بعد الإصلاح: 204 مع كل الترويسات المطلوبة.

## خطوات النشر (مطلوب الاثنان معاً)
1. **Railway**: ارفع مجلد `backend/` (إصلاح CORS + الإشعارات) — إعادة تشغيل تلقائية.
2. **Vercel**: ارفع مجلد `frontend/` (إصلاح صفحة المنتجات).
3. افتح النظام على Vercel مباشرة — تسجيل الدخول سيعمل بدون أي خطوة يدوية.

## الملفات المعدّلة
| ملف | التغيير |
|---|---|
| `backend/server.js` | إضافة `Accept-Language` + `x-dzpos-lang` إلى allowedHeaders |
| `backend/services/pushService.js` | استيراد `PushSubscription` الناقص (إصلاح 500 عند الاختبار) |
| `frontend/js/modules/products.js` | إزالة الاستيراد الخاطئ + live base + تنظيف التصحيح |
| `frontend/index.html` / `dashboard.html` / `register.html` | cache-bust → `?v=4.2.2` |
| `package.json` / `backend/package.json` / `sw.js` | 4.2.2 |
