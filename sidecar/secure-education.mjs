/**
 * Beginner AR/EN explainers for Secure findings (no weaponization steps).
 */

/** @type {Record<string, { en: { title: string, what: string, why: string, fixHint: string }, ar: { title: string, what: string, why: string, fixHint: string } }>} */
export const SECURE_EDUCATION = {
  missing_csp: {
    en: {
      title: "Missing Content-Security-Policy",
      what: "CSP tells the browser which scripts/styles/images are allowed. Without it, injected scripts can run more easily.",
      why: "Attackers who find an XSS hole can load extra malware scripts. CSP reduces blast radius.",
      fixHint: "Add a Content-Security-Policy header (start with default-src 'self'; tighten gradually).",
    },
    ar: {
      title: "سياسة Content-Security-Policy ناقصة",
      what: "CSP تخبر المتصفح أي سكربتات/ستايلات مسموحة. بدونها السكربت المحقون يشتغل أسهل.",
      why: "لو فيه XSS، المهاجم يقدر يحمّل سكربتات إضافية. CSP تقلل الضرر.",
      fixHint: "أضف هيدر Content-Security-Policy (ابدأ بـ default-src 'self' وشدّد تدريجيًا).",
    },
  },
  missing_hsts: {
    en: {
      title: "Missing Strict-Transport-Security (HSTS)",
      what: "HSTS forces browsers to use HTTPS after the first visit.",
      why: "Without it, users can be downgraded to plain HTTP on later visits (MITM risk).",
      fixHint: "Serve Strict-Transport-Security on HTTPS responses (e.g. max-age=31536000; includeSubDomains).",
    },
    ar: {
      title: "هيدر HSTS ناقص",
      what: "HSTS يجبر المتصفح على HTTPS بعد أول زيارة.",
      why: "بدونه ممكن يتنزّل الاتصال لـ HTTP في زيارات لاحقة.",
      fixHint: "أضف Strict-Transport-Security على استجابات HTTPS.",
    },
  },
  missing_xfo: {
    en: {
      title: "Missing X-Frame-Options / frame-ancestors",
      what: "These headers control whether other sites can embed your pages in an iframe.",
      why: "Missing protection enables clickjacking (tricking users into clicking hidden UI).",
      fixHint: "Set X-Frame-Options: DENY (or SAMEORIGIN) or CSP frame-ancestors 'none'|'self'.",
    },
    ar: {
      title: "حماية الـ iframe ناقصة",
      what: "هذول الهيدرز يمنعوا مواقع تانية تحط صفحتك جوه iframe.",
      why: "بدونها ممكن clickjacking — ضغطات وهمية على واجهتك.",
      fixHint: "X-Frame-Options: DENY أو SAMEORIGIN، أو frame-ancestors في CSP.",
    },
  },
  missing_xcto: {
    en: {
      title: "Missing X-Content-Type-Options",
      what: "nosniff stops browsers from guessing MIME types.",
      why: "MIME sniffing can turn uploaded files into executable scripts in some browsers.",
      fixHint: "Add X-Content-Type-Options: nosniff.",
    },
    ar: {
      title: "X-Content-Type-Options ناقص",
      what: "nosniff يمنع المتصفح من تخمين نوع الملف غلط.",
      why: "التخمين ممكن يخلّي ملف مرفوع يتنفّذ كسكربت.",
      fixHint: "أضف X-Content-Type-Options: nosniff.",
    },
  },
  missing_referrer: {
    en: {
      title: "Missing Referrer-Policy",
      what: "Controls how much URL info is sent when users leave your site.",
      why: "Tokens in query strings can leak to third parties via the Referer header.",
      fixHint: "Prefer Referrer-Policy: strict-origin-when-cross-origin or no-referrer.",
    },
    ar: {
      title: "Referrer-Policy ناقص",
      what: "يحدد قد إيه من الرابط يتبعت لما المستخدم يسيب موقعك.",
      why: "لو فيه توكن في الـ query ممكن يتسرب لمواقع تانية.",
      fixHint: "استخدم strict-origin-when-cross-origin أو no-referrer.",
    },
  },
  cookie_flags: {
    en: {
      title: "Cookie security flags",
      what: "Secure / HttpOnly / SameSite protect session cookies from theft and CSRF-ish flows.",
      why: "A missing HttpOnly cookie can be read by XSS; missing Secure can travel over HTTP.",
      fixHint: "Set Secure; HttpOnly; SameSite=Lax (or Strict) on session cookies.",
    },
    ar: {
      title: "أعلام أمان الكوكيز",
      what: "Secure و HttpOnly و SameSite تحمي جلسة المستخدم.",
      why: "بدون HttpOnly الـ XSS يقرأ الكوكي؛ بدون Secure ممكن تمشي على HTTP.",
      fixHint: "Secure; HttpOnly; SameSite=Lax أو Strict لكوكيز الجلسة.",
    },
  },
  mixed_content: {
    en: {
      title: "Mixed content / HTTPS",
      what: "HTTPS pages must not load active HTTP resources.",
      why: "Mixed content can be intercepted or blocked; users lose trust.",
      fixHint: "Serve the site on HTTPS and use relative or https:// asset URLs.",
    },
    ar: {
      title: "محتوى مختلط / HTTPS",
      what: "صفحة HTTPS لازم متسحبش موارد HTTP نشطة.",
      why: "المحتوى المختلط ممكن يتتنصت أو يتعطل.",
      fixHint: "شغّل HTTPS واستخدم روابط نسبية أو https للملفات.",
    },
  },
  dependency_cve: {
    en: {
      title: "Dependency vulnerabilities",
      what: "Known CVEs in npm/pip packages that your app depends on.",
      why: "Attackers exploit public vulns in outdated libraries.",
      fixHint: "Run npm audit / pip-audit and upgrade or replace affected packages.",
    },
    ar: {
      title: "ثغرات في الاعتماديات",
      what: "CVE معروفة في حزم npm/pip اللي مشروعك يعتمد عليها.",
      why: "المهاجمين بيستغلوا مكتبات قديمة فيها ثغرات معلنة.",
      fixHint: "شغّل npm audit / pip-audit وحدّث أو استبدل الحزم.",
    },
  },
  secret_leak: {
    en: {
      title: "Possible secret in workspace",
      what: "Strings that look like API keys or tokens found in project files.",
      why: "Leaked keys in git or client bundles let others use your cloud accounts.",
      fixHint: "Rotate the key, move secrets to env/OS keychain, and scrub git history if committed.",
    },
    ar: {
      title: "احتمال تسريب مفتاح/سر",
      what: "نصوص شبه API keys أو توكنات جوه ملفات المشروع.",
      why: "المفاتيح المتسربة تخلي حد يستخدم حساباتك السحابية.",
      fixHint: "غيّر المفتاح فورًا، انقله لـ env/keychain، ونضّف الجيت لو اتعمل commit.",
    },
  },
  server_banner: {
    en: {
      title: "Verbose server / tech disclosure",
      what: "Response headers reveal exact server or framework versions.",
      why: "Helps attackers pick known exploits for that version.",
      fixHint: "Disable Server/X-Powered-By version banners in production.",
    },
    ar: {
      title: "كشف إصدار السيرفر/الفريمورك",
      what: "هيدرز بتفضح إصدار السيرفر أو الفريمورك.",
      why: "بتساعد المهاجم يختار إكسبلويت معروف للإصدار ده.",
      fixHint: "عطّل Server و X-Powered-By في الإنتاج.",
    },
  },
  sensitive_path: {
    en: {
      title: "Sensitive path exposed",
      what: "A URL that should stay private (.env, .git, backups, source maps) returned content.",
      why: "Leaked config or source helps attackers find credentials and vulns.",
      fixHint: "Block these paths in the web server; never deploy secrets or .git to public roots.",
    },
    ar: {
      title: "مسار حسّاس مكشوف",
      what: "رابط المفروض يبقى خاص (.env / .git / نسخ احتياطية / source maps) رجّع محتوى.",
      why: "التسريب يساعد على سرقة مفاتيح أو فهم الثغرات.",
      fixHint: "امنع المسارات دي في السيرفر؛ متتنشرش أسرار أو .git على الويب.",
    },
  },
  directory_listing: {
    en: {
      title: "Directory listing enabled",
      what: "The server listed folder contents instead of a normal page.",
      why: "Attackers can discover hidden files and backup names.",
      fixHint: "Disable autoindex / directory browsing in nginx/Apache/static hosts.",
    },
    ar: {
      title: "تصفح المجلدات مفعّل",
      what: "السيرفر بيعرض قائمة ملفات المجلد بدل صفحة عادية.",
      why: "يسهّل اكتشاف ملفات مخفية ونسخ احتياطية.",
      fixHint: "عطّل directory listing في إعدادات السيرفر.",
    },
  },
  reflected_xss: {
    en: {
      title: "Possible reflected XSS",
      what: "A unique probe string sent in a query parameter came back unescaped in HTML.",
      why: "If user input is echoed raw, attackers can inject scripts into victims' browsers.",
      fixHint: "Encode output (HTML escape); use a framework templating that auto-escapes; tighten CSP.",
    },
    ar: {
      title: "احتمال XSS منعكس",
      what: "نص تجريبي اتبعت في الـ query ورجع في الـ HTML من غير ترميز.",
      why: "لو مدخلات المستخدم بتترجع خام، ممكن يتحقن سكربت في متصفح الضحية.",
      fixHint: "اعمل HTML encode للمخرجات؛ استخدم قوالب بتأمّن تلقائي؛ شدّد CSP.",
    },
  },
  csrf_form: {
    en: {
      title: "Form may lack CSRF protection",
      what: "A state-changing HTML form had no obvious CSRF token field.",
      why: "Other sites could trick a logged-in user into submitting that form.",
      fixHint: "Add anti-CSRF tokens (or SameSite cookies + framework CSRF middleware).",
    },
    ar: {
      title: "فورم بدون حماية CSRF واضحة",
      what: "فورم بتغيّر حالة من غير حقل توكن CSRF ظاهر.",
      why: "موقع تاني ممكن يخدع مستخدم مسجّل يبعت الفورم.",
      fixHint: "أضف CSRF tokens أو SameSite + middleware الفريمورك.",
    },
  },
  open_admin: {
    en: {
      title: "Admin-like path reachable without auth signal",
      what: "A common admin/dashboard URL returned 200 instead of login/redirect.",
      why: "Unauthenticated admin surfaces are high-value targets.",
      fixHint: "Require auth; return 401/403 or redirect to login for /admin and similar routes.",
    },
    ar: {
      title: "مسار إدارة متاح بدون إشارة تسجيل دخول",
      what: "رابط admin/dashboard رجّع 200 بدل تحويل لصفحة دخول.",
      why: "واجهات الإدارة المفتوحة هدف سهل.",
      fixHint: "افرض مصادقة؛ 401/403 أو redirect للّوجين.",
    },
  },
  verbose_error: {
    en: {
      title: "Verbose error / stack trace",
      what: "The response looks like a framework stack trace or detailed exception page.",
      why: "Stack traces reveal paths, versions, and query details useful to attackers.",
      fixHint: "Show generic error pages in production; log details server-side only.",
    },
    ar: {
      title: "خطأ مفصّل / stack trace",
      what: "الرد شبه صفحة استثناء أو stack trace من الفريمورك.",
      why: "بتفضح مسارات وإصدارات وتفاصيل مفيدة للمهاجم.",
      fixHint: "صفحات خطأ عامة في الإنتاج؛ التفاصيل في اللوج بس.",
    },
  },
};

/**
 * @param {string} category
 * @param {'en'|'ar'} [lang]
 */
export function explainFinding(category, lang = "en") {
  const entry = SECURE_EDUCATION[category];
  if (!entry) {
    return lang === "ar"
      ? {
          title: category,
          what: "مشكلة أمان محتملة.",
          why: "قد تزيد خطر الاختراق.",
          fixHint: "راجع الإعدادات والكود المرتبط.",
        }
      : {
          title: category,
          what: "Potential security issue.",
          why: "May increase attack risk.",
          fixHint: "Review related config and code.",
        };
  }
  return entry[lang] || entry.en;
}
