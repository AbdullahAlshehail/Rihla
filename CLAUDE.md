# رحلة — Rihla Next.js App

> تحويل دليل سفر HTML للريفييرا الفرنسية إلى Next.js + Supabase + Google APIs. Phase 1 MVP منجز ٢ يونيو ٢٠٢٦.

## السكلز اللي تستخدمها هنا

| السكل | متى |
|------|-----|
| **senior-fullstack** | features Next.js — routes، Supabase queries، Google APIs (Maps/Places)، auth flows. |
| **frontend-design** | بطاقات الأماكن (٥٨ مكان)، خرائط، صفحات تفاصيل، خط زمني. |
| **mobile-design** | **iPhone-first إلزامي** — كل تعديل لازم يُختبر على iPhone viewport قبل ما يُحسب منجز. |
| **seo-optimizer** | meta tags لصفحات الأماكن، schema TouristAttraction، hreflang ar-SA + fr-FR + en. |
| **code-reviewer** | قبل أي deploy — تحقق من Google API keys (مقيّدة)، Supabase RLS. |

## قواعد deploy (من الذاكرة)

- **قبل `netlify deploy --no-build`**: انسخ `.next/static→.next/_next/static` و `public/*→.next/` وإلا CSS 404.
- **Google Cloud lockdown**: project `rihlaapp-498219`، مفتاح مقيّد، ١١ API معطّلة، budget $1 alert.
- اسأل قبل أي deploy (Pro plan شامل).
