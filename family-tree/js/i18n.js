// Bilingual (Arabic / English) string registry and language switching.
// Every module registers its own strings at top level:
//   register({ en: { 'tree.title': 'Family tree' }, ar: { 'tree.title': 'شجرة العائلة' } });
// and renders with t('tree.title') or t('person.age', { n: 42 }).

const LANGS = ['ar', 'en'];
const STORAGE_KEY = 'gft.lang';
const dicts = { ar: Object.create(null), en: Object.create(null) };
const listeners = new Set();
const warned = new Set();

let current = initialLang();
let useArabicDigits = false;

function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  const nav = (globalThis.navigator?.language || '').toLowerCase();
  return nav.startsWith('en') ? 'en' : 'ar';
}

/** Merge a module's strings into the registry. */
export function register(bundle) {
  for (const l of LANGS) {
    if (bundle && bundle[l]) Object.assign(dicts[l], bundle[l]);
  }
}

/** Current language: "ar" | "en". */
export function lang() { return current; }

/** Text direction for the current language. */
export function dir() { return current === 'ar' ? 'rtl' : 'ltr'; }

/** The other language. */
export function otherLang() { return current === 'ar' ? 'en' : 'ar'; }

/** Called once at boot with config.defaultLanguage (only used when the visitor never chose). */
export function setDefaultLang(l) {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
  if (!LANGS.includes(saved) && LANGS.includes(l)) {
    const nav = (globalThis.navigator?.language || '').toLowerCase();
    // An English-language browser still gets English; everyone else gets the configured default.
    current = nav.startsWith('en') && l === 'ar' ? 'en' : l;
    applyToDocument();
  }
}

export function setArabicDigits(on) { useArabicDigits = !!on; }
export function arabicDigits() { return useArabicDigits; }

/** Switch language, persist, update <html lang dir>, notify listeners. */
export function setLang(l) {
  if (!LANGS.includes(l) || l === current) return;
  current = l;
  try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  applyToDocument();
  for (const fn of [...listeners]) {
    try { fn(current); } catch (e) { console.error(e); }
  }
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyToDocument() {
  const el = globalThis.document?.documentElement;
  if (!el) return;
  el.lang = current;
  el.dir = dir();
}

/**
 * Translate a key. `vars` interpolates {name} placeholders. Numbers are localized.
 * Missing in current language → falls back to the other language → the key itself.
 */
export function t(key, vars) {
  let s = dicts[current][key];
  if (s === undefined) {
    s = dicts[otherLang()][key];
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing ${current} string: ${key}`);
    }
  }
  if (s === undefined) return key;
  if (typeof s === 'function') return s(vars || {});
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in vars)) return m;
    const v = vars[k];
    return typeof v === 'number' ? fmtNumber(v) : String(v ?? '');
  });
}

/** Snapshot of every registered string (used by the i18n completeness / gender-neutral checks). */
export function dictionaries() {
  return { ar: { ...dicts.ar }, en: { ...dicts.en } };
}

/** Does a key exist (in either language)? */
export function has(key) { return key in dicts.ar || key in dicts.en; }

/**
 * Pick text from a bilingual object {ar, en} for the current language, falling back to the other.
 * Returns '' when both are empty. Pass `l` to force a language.
 */
export function bi(obj, l = current) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  const primary = obj[l];
  if (primary && String(primary).trim()) return String(primary);
  const other = obj[l === 'ar' ? 'en' : 'ar'];
  return other && String(other).trim() ? String(other) : '';
}

/** Localized integer/number formatting honouring the Arabic-digits setting. */
export function fmtNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  const locale = current === 'ar' ? (useArabicDigits ? 'ar' : 'ar-u-nu-latn') : 'en';
  try { return new Intl.NumberFormat(locale).format(n); } catch { return String(n); }
}

/** Locale string for Intl APIs in the current language. */
export function intlLocale() {
  return current === 'ar' ? (useArabicDigits ? 'ar' : 'ar-u-nu-latn') : 'en-GB';
}

applyToDocument();

// Shared strings used by the shell and many views.
register({
  en: {
    'app.title': 'The Grand Family Tree',
    'app.tagline': 'Our family, remembered together',
    'nav.home': 'Home',
    'nav.tree': 'Tree',
    'nav.addFamily': 'Add my family',
    'nav.search': 'Search',
    'nav.relationship': 'How are we related?',
    'nav.changes': 'Updates',
    'nav.about': 'How it works',
    'nav.admin': 'Owner tools',
    'nav.draft': 'My proposal',
    'nav.menu': 'Menu',
    'lang.switch': 'العربية',
    'lang.switchLabel': 'Switch language to Arabic',
    'theme.toggle': 'Toggle dark mode',
    'common.loading': 'Loading…',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.done': 'Done',
    'common.add': 'Add',
    'common.edit': 'Edit',
    'common.remove': 'Remove',
    'common.confirm': 'Confirm',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.search': 'Search',
    'common.searchPlaceholder': 'Search by name…',
    'common.unknown': 'Unknown',
    'common.pending': 'Pending approval',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.notFound': 'Not found',
    'common.personNotFound': 'This person is not in the tree (they may have been merged or removed).',
    'common.goHome': 'Go to the home page',
    'common.error': 'Something went wrong',
    'common.retry': 'Try again',
    'common.viewDraft': 'View my proposal',
    'common.addedToDraft': 'Added to your proposal. Submit it when you are ready.',
    'draft.badge': '{n} pending',
    'footer.text': 'Changes are proposed by family members and reviewed before they appear.',
    'footer.source': 'Data & history on GitHub',
    'error.load': 'Could not load the family data. Please check your connection and try again.',
    'demo.banner': 'This is sample data for trying the site. It will be replaced by the real family tree.',
  },
  ar: {
    'app.title': 'شجرة العائلة الكبرى',
    'app.tagline': 'عائلتنا… نحفظها معاً',
    'nav.home': 'الرئيسية',
    'nav.tree': 'الشجرة',
    'nav.addFamily': 'أضف عائلتك',
    'nav.search': 'بحث',
    'nav.relationship': 'ما صلة القرابة؟',
    'nav.changes': 'آخر التحديثات',
    'nav.about': 'كيف يعمل الموقع',
    'nav.admin': 'أدوات المشرف',
    'nav.draft': 'مقترحي',
    'nav.menu': 'القائمة',
    'lang.switch': 'English',
    'lang.switchLabel': 'التبديل إلى الإنجليزية',
    'theme.toggle': 'تبديل الوضع الليلي',
    'common.loading': 'جارٍ التحميل…',
    'common.save': 'حفظ',
    'common.cancel': 'إلغاء',
    'common.close': 'إغلاق',
    'common.back': 'رجوع',
    'common.next': 'التالي',
    'common.done': 'تم',
    'common.add': 'إضافة',
    'common.edit': 'تعديل',
    'common.remove': 'حذف',
    'common.confirm': 'تأكيد',
    'common.yes': 'نعم',
    'common.no': 'لا',
    'common.search': 'بحث',
    'common.searchPlaceholder': 'ابحث بالاسم…',
    'common.unknown': 'غير معروف',
    'common.pending': 'بانتظار الموافقة',
    'common.copy': 'نسخ',
    'common.copied': 'تم النسخ',
    'common.notFound': 'غير موجود',
    'common.personNotFound': 'هذا الشخص غير موجود في الشجرة (ربما دُمج مع سجل آخر أو أُزيل).',
    'common.goHome': 'العودة إلى الصفحة الرئيسية',
    'common.error': 'حدث خطأ ما',
    'common.retry': 'إعادة المحاولة',
    'common.viewDraft': 'عرض مقترحي',
    'common.addedToDraft': 'أُضيف إلى مقترحك. أرسله متى أصبحت جاهزاً.',
    'draft.badge': '{n} بانتظار الإرسال',
    'footer.text': 'يقترح أفراد العائلة التعديلات، وتُراجَع قبل ظهورها في الشجرة.',
    'footer.source': 'البيانات وسجل التعديلات على GitHub',
    'error.load': 'تعذّر تحميل بيانات العائلة. تحقّق من الاتصال وحاول مجدداً.',
    'demo.banner': 'هذه بيانات تجريبية للتعرّف على الموقع، وستُستبدل بشجرة العائلة الحقيقية.',
  },
});
