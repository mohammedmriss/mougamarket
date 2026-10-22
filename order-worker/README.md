# إعداد MougaMarket من البداية

هذا الدليل يجهز المتجر على GitHub Pages، وطلبات Cloudflare Worker المجاني، وGoogle Sheets وTelegram. لا تضع أي سر في `data/config.json` أو صفحات HTML/JavaScript. صفحة الإدارة تحتاج بريد Gmail وكلمة مرور فقط؛ GitHub token وباقي الأسرار تبقى في Cloudflare.

## 1. تجهيز Google Sheet

1. أنشئ Google Sheet جديداً، وانسخ معرّف الجدول من الرابط بين `/d/` و`/edit`.
2. من **Extensions → Apps Script** افتح المشروع، ثم انسخ محتوى `order-worker/Code.gs` إلى `Code.gs` واحفظه.
3. من **Project Settings → Script Properties** أضف:
   - `SPREADSHEET_ID`: معرّف الجدول.
   - `WORKER_SHARED_SECRET`: السر نفسه الذي ستضعه لاحقاً في Cloudflare باسم `SHEETS_WEBHOOK_SECRET`.
4. انشر من **Deploy → New deployment → Web app**، واجعل **Execute as: Me** و**Who has access: Anyone**. التحقق من السر داخل السكريبت يحمي العمليات.
5. انسخ رابط Web app المنتهي بـ `/exec`. لا تنشر `Code.gs` كملف متاح للعامة ولا تشارك السر.

السكريبت ينشئ ورقة `Orders` وعناوين الأعمدة عند أول طلب، ويستعمل `LockService` في إدراج الطلبات وتغيير الحالات.

## 2. إنشاء كلمة المرور والأسرار

تأكد من تثبيت Node.js 20 أو أحدث، ثم من مجلد المشروع شغّل:

```text
node order-worker/hash-password.mjs
```

اكتب كلمة مرور طويلة (12 حرفاً على الأقل) في الطرفية؛ الإدخال مخفي. الأداة تطبع `ADMIN_PASSWORD_HASH` و`SESSION_SECRET` عشوائيين. احتفظ بهما مؤقتاً لإدخالهما في Cloudflare، ولا تضفهما إلى ملفات المشروع أو Git.

أنشئ GitHub fine-grained personal access token من إعدادات GitHub:

1. اختر **Only select repositories** وحدد مستودع `mougamarket` فقط.
2. امنح **Repository permissions → Contents: Read and write**.
3. انسخ الرمز مرة واحدة؛ ستدخله في Cloudflare فقط، وليس في صفحة الإدارة.

## 3. إعداد Cloudflare Worker

ثبت Wrangler أو استعمل `npx`، ثم سجل الدخول:

```text
npx wrangler login
```

عدّل `GITHUB_REPO` و`GITHUB_BRANCH` و`ALLOWED_ORIGINS` في `order-worker/wrangler.toml`. استخدم اسم المستودع `owner/repository`، والفرع المنشور، وأصل الموقع كاملاً دون مسار، مثلاً `https://mougamarket.store,https://www.mougamarket.store`.

أدخل الأسرار التالية واحداً تلو الآخر؛ Wrangler سيطلب القيمة بأمان:

```text
npx wrangler secret put ADMIN_EMAIL --config order-worker/wrangler.toml
npx wrangler secret put ADMIN_PASSWORD_HASH --config order-worker/wrangler.toml
npx wrangler secret put SESSION_SECRET --config order-worker/wrangler.toml
npx wrangler secret put GITHUB_TOKEN --config order-worker/wrangler.toml
npx wrangler secret put SHEETS_WEB_APP_URL --config order-worker/wrangler.toml
npx wrangler secret put SHEETS_WEBHOOK_SECRET --config order-worker/wrangler.toml
npx wrangler secret put TELEGRAM_BOT_TOKEN --config order-worker/wrangler.toml
npx wrangler secret put TELEGRAM_CHAT_ID --config order-worker/wrangler.toml
```

- `ADMIN_EMAIL`: بريد Gmail الذي ستستعمله للدخول.
- `ADMIN_PASSWORD_HASH` و`SESSION_SECRET`: القيم التي طبعتها أداة كلمة المرور.
- `GITHUB_TOKEN`: fine-grained token السابق.
- `SHEETS_WEB_APP_URL`: رابط Apps Script `/exec`.
- `SHEETS_WEBHOOK_SECRET`: نفس `WORKER_SHARED_SECRET` الموجود في Script Properties.
- `TELEGRAM_BOT_TOKEN` و`TELEGRAM_CHAT_ID`: بيانات البوت والمحادثة. أنشئ البوت عبر BotFather وأرسل له رسالة أولاً كي يظهر chat ID.

### حماية المحاولات والطلبات بـ KV (موصى بها)

أنشئ مساحتي KV:

```text
npx wrangler kv namespace create LOGIN_KV
npx wrangler kv namespace create ORDER_KV
```

انسخ `id` الناتج لكل namespace وأضف bindings في `order-worker/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "LOGIN_KV"
id = "ضع-معرف-login-kv"

[[kv_namespaces]]
binding = "ORDER_KV"
id = "ضع-معرف-order-kv"
```

`LOGIN_KV` يقفل عنوان IP لمدة 15 دقيقة بعد خمس محاولات فاشلة؛ `ORDER_KV` يحد الطلبات لكل IP. إذا لم تضف KV يبقى فحص كلمة المرور بطيئاً، وتظل بقية التحققات فعالة، لكن حد IP لن يعمل.

انشر الـWorker:

```text
npx wrangler deploy --config order-worker/wrangler.toml
```

انسخ عنوان Worker الناتج. ضعه في `order_endpoint` داخل `data/config.json`، ثم انشر التغيير على GitHub. إذا غيّرت الأسرار استخدم `wrangler secret put` مجدداً؛ لا تحفظ القيم في ملفات vars.

## 4. نشر GitHub Pages والنطاق

1. ادفع ملفات المستودع إلى GitHub.
2. من **Repository → Settings → Pages** اختر النشر من الفرع `main` ومجلد `/ (root)`.
3. أدخل `mougamarket.store` في **Custom domain**. يحتوي المستودع على ملف `CNAME` بهذا النطاق. أكمل سجلات DNS المطلوبة لدى مزود النطاق، وفعل **Enforce HTTPS** بعد تحقق DNS.
4. تأكد أن `ALLOWED_ORIGINS` في Worker يحتوي كل أصل ستستخدمه بالضبط.
5. شغّل `node scripts/generate-product-pages.mjs` محلياً بعد تعديل المنتجات لإنشاء صفحات معاينة SEO و`sitemap.xml`. سير العمل في GitHub Actions يجددها تلقائياً بعد تغيير المنتجات أو الإعدادات على الفرع `main`، ثم يضيف التغييرات للمستودع.

## 5. أول دخول وإدارة المتجر

افتح `https://mougamarket.store/admin.html`، ثم أدخل بريد `ADMIN_EMAIL` وكلمة المرور الأصلية التي أنشأت hash لها. الصفحة تحفظ جلسة HMAC موقعة في المتصفح؛ تبقى بين الزيارات وتتجدد عند فتح الإدارة، وتنتهي بعد 14 يوماً دون تجديد. تسجيل الخروج يتم من زر **Log out** ويمسح الجلسة المحفوظة في ذلك المتصفح. لا يوجد حقل GitHub token أو API key في المتصفح؛ عمليات حفظ المنتجات والإعدادات تمر عبر Worker.

إذا ظهرت رسالة تعارض عند حفظ المحتوى، أعد تحميل الإدارة لتحميل نسخة الملف الأحدث. المنتجات بحالة `draft` لا تظهر للزوار، وأي منتج له مقاسات أو ألوان يجب أن يختار الزائر خياراته من صفحة المنتج.

## 6. الاختبار محلياً

```text
npm install
npx playwright install chromium
npm test
```

`npm test` يشغّل اختبارات Worker بمحاكاة GitHub وSheets وTelegram، ثم اختبارات واجهة فعلية عبر Playwright للمتجر ولوحة الإدارة. للتحقق من الصياغة وحدها شغّل `npm run check`.
