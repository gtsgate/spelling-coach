// Dates: partial Gregorian dates, Hijri (Umm al-Qura) conversion, display formatting, ages.
// Pure ES module — runs unchanged in modern browsers and Node ≥ 20 (no DOM, no fetch, no node: imports).
// See docs/SPEC.md §2.1 (date rules) and §4 (dates.js API).
//
// Vocabulary used in this file:
//   * date string  — partial Gregorian "YYYY" | "YYYY-MM" | "YYYY-MM-DD" (year 1–9999) or "".
//   * hijri string — partial Hijri "YYYY" | "YYYY-MM" | "YYYY-MM-DD" (year 1–1500) or "".
//   * date object  — {date, hijri?, approx?, place?} as stored on people/unions.
//   * day number   — integer days since 1970-01-01 (proleptic Gregorian, UTC); used for all arithmetic.
//
// Hijri conversion uses the engine's Intl Umm al-Qura calendar (`islamic-umalqura`) by searching Gregorian
// days — there are no month-length tables in this file. If an engine lacks that calendar we fall back to the
// arithmetic (tabular) Islamic calendar so the app keeps working, slightly less precisely.

// ---------------------------------------------------------------------------------------------------------
// Digits

/** Convert Arabic-Indic (U+0660–0669) and Extended/Persian (U+06F0–06F9) digits to ASCII 0–9. */
export function toAsciiDigits(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0));
}

/** Convert ASCII digits to Arabic-Indic digits (٠–٩). */
export function toArabicDigits(s) {
  return String(s ?? '').replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}

let digitsPref = 'latn';
let monthNamesPref = 'standard';

/** Digits used for Arabic output: "latn" (0–9, default) or "arab" (٠–٩). English output always uses 0–9. */
export function setDigits(digits) {
  digitsPref = digits === 'arab' ? 'arab' : 'latn';
  return digitsPref;
}
export function getDigits() { return digitsPref; }

/**
 * Arabic Gregorian month names: "standard" (يناير، فبراير… from Intl) or "levantine" (كانون الثاني، شباط… static table).
 * Unknown values fall back to "standard".
 */
export function setMonthNames(style) {
  monthNamesPref = style === 'levantine' ? 'levantine' : 'standard';
  return monthNamesPref;
}
export function getMonthNames() { return monthNamesPref; }

/** Levantine (Syriac-derived) Gregorian month names, January … December. */
export const LEVANTINE_MONTHS = Object.freeze([
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
]);

/** Hijri month names (static, so output is identical across engines). */
export const HIJRI_MONTHS = Object.freeze({
  ar: Object.freeze([
    'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
    'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة',
  ]),
  en: Object.freeze([
    'Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula', 'Jumada al-Akhirah',
    'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah',
  ]),
});

// ---------------------------------------------------------------------------------------------------------
// Day-number arithmetic (proleptic Gregorian; algorithms by Howard Hinnant, valid for any year)

/** Day number (days since 1970-01-01) of a Gregorian y-m-d. */
export function dayNumber(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of dayNumber → {year, month, day}. */
export function fromDayNumber(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days in a Gregorian month. */
export function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Add whole years to a day number (29 Feb → 28 Feb in non-leap years). */
export function addYearsToDay(n, years) {
  const c = fromDayNumber(n);
  const y = c.year + years;
  return dayNumber(y, c.month, Math.min(c.day, daysInMonth(y, c.month)));
}

const pad = (n, w) => String(n).padStart(w, '0');

function ymdString(year, month, day) {
  let s = pad(year, 4);
  if (month) s += '-' + pad(month, 2);
  if (month && day) s += '-' + pad(day, 2);
  return s;
}

// ---------------------------------------------------------------------------------------------------------
// Parsing & validation

// Lenient shape: year first, 1–4 digit year, 1–2 digit month/day, separators - / . (Arabic digits accepted).
const LENIENT_RE = /^(\d{1,4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?$/;
// Canonical stored shape.
const CANONICAL_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

function lenientParts(s) {
  if (typeof s !== 'string' && typeof s !== 'number') return null;
  const m = LENIENT_RE.exec(toAsciiDigits(s).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] === undefined ? 0 : Number(m[2]);
  const day = m[3] === undefined ? 0 : Number(m[3]);
  return { year, month, day, precision: day ? 'day' : month ? 'month' : 'year' };
}

/**
 * Parse a (partial) Gregorian date. Lenient: Arabic digits, unpadded parts and / or . separators are accepted
 * ("1950-3-5", "١٩٥٠"). Returns {year, month, day, precision:"year"|"month"|"day"} (month/day 0 when absent)
 * or null when empty, malformed or not a real calendar date (year 1–9999).
 */
export function parseDate(s) {
  const p = lenientParts(s);
  if (!p) return null;
  if (p.year < 1 || p.year > 9999) return null;
  if (p.month && (p.month < 1 || p.month > 12)) return null;
  if (p.day && (p.day < 1 || p.day > daysInMonth(p.year, p.month))) return null;
  return p;
}

/** Canonical "YYYY[-MM[-DD]]" for a parseable Gregorian date, else null. */
export function canonicalDate(s) {
  const p = parseDate(s);
  return p ? ymdString(p.year, p.month, p.day) : null;
}

/** Strict check of a stored Gregorian date: canonical "YYYY" | "YYYY-MM" | "YYYY-MM-DD", real date, year 1–9999. "" is not a date. */
export function isValidDate(s) {
  return typeof s === 'string' && CANONICAL_RE.test(s) && parseDate(s) !== null;
}

/**
 * Parse a (partial) Hijri date, same leniency as parseDate. Year 1–1500, month 1–12, day 1–30 and the day must
 * exist in that Umm al-Qura month (29- or 30-day months). Returns {year, month, day, precision} or null.
 */
export function parseHijri(s) {
  const p = lenientParts(s);
  if (!p) return null;
  if (p.year < 1 || p.year > 1500) return null;
  if (p.month && (p.month < 1 || p.month > 12)) return null;
  if (p.day && (p.day < 1 || p.day > 30)) return null;
  if (p.day && hijriToDay(p.year, p.month, p.day) === null) return null;
  return p;
}

/** Canonical "YYYY[-MM[-DD]]" for a parseable Hijri date, else null. */
export function canonicalHijri(s) {
  const p = parseHijri(s);
  return p ? ymdString(p.year, p.month, p.day) : null;
}

/** Strict check of a stored Hijri date (canonical form, year 1–1500, existing day). "" is not a date. */
export function isValidHijri(s) {
  return typeof s === 'string' && CANONICAL_RE.test(s) && parseHijri(s) !== null;
}

/** Truncate a date / hijri string to the requested precision ("year" | "month" | "day"); unparseable input is returned as is. */
export function truncateDate(s, precision = 'year', calendar = 'gregorian') {
  const p = calendar === 'hijri' ? lenientParts(s) : parseDate(s);
  if (!p) return typeof s === 'string' ? s : '';
  if (precision === 'year') return ymdString(p.year, 0, 0);
  if (precision === 'month') return ymdString(p.year, p.month, 0);
  return ymdString(p.year, p.month, p.day);
}

// ---------------------------------------------------------------------------------------------------------
// Hijri (Umm al-Qura via Intl)

const HIJRI_EPOCH_DAY = dayNumber(622, 7, 19); // 1 Muharram 1 AH (civil epoch, proleptic Gregorian)
let hijriFormatter; // lazily created; null when Intl lacks islamic-umalqura

function getHijriFormatter() {
  if (hijriFormatter !== undefined) return hijriFormatter;
  hijriFormatter = null;
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
    });
    if (f.resolvedOptions().calendar === 'islamic-umalqura') hijriFormatter = f;
  } catch { /* no Intl calendar support → arithmetic fallback */ }
  return hijriFormatter;
}

/** Arithmetic (tabular, civil) Islamic calendar — fallback only (formulas from "Calendrical Calculations"). */
function tabularDay(y, m, d) {
  return HIJRI_EPOCH_DAY - 1 + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 29 * (m - 1) + Math.floor(m / 2) + d;
}
function tabularHijriAtDay(n) {
  const year = Math.floor((30 * (n - HIJRI_EPOCH_DAY) + 10646) / 10631);
  const month = Math.min(12, Math.floor((11 * (n - tabularDay(year, 1, 1)) + 330) / 325));
  return { year, month, day: n - tabularDay(year, month, 1) + 1 };
}

/** Hijri {year, month, day} of a day number. */
function hijriAtDay(n) {
  const f = getHijriFormatter();
  if (!f) return tabularHijriAtDay(n);
  const out = { year: NaN, month: NaN, day: NaN };
  for (const part of f.formatToParts(new Date(n * 86400000))) {
    if (part.type === 'year' || part.type === 'relatedYear') out.year = Number(toAsciiDigits(part.value));
    else if (part.type === 'month') out.month = Number(toAsciiDigits(part.value));
    else if (part.type === 'day') out.day = Number(toAsciiDigits(part.value));
  }
  return out;
}

const cmpYMD = (a, b) => (a.year - b.year) || (a.month - b.month) || (a.day - b.day);
const hijriDayCache = new Map();

/**
 * Day number of Hijri y-m-d, or null when that day does not exist (e.g. 30th of a 29-day month).
 * Searches Gregorian days: start from the mean-calendar estimate, then step by the estimated difference.
 */
function hijriToDay(year, month, day) {
  const key = year * 10000 + month * 100 + day;
  if (hijriDayCache.has(key)) return hijriDayCache.get(key);
  const target = { year, month, day };
  let n = HIJRI_EPOCH_DAY + Math.floor((year - 1) * 354.36667 + (month - 1) * 29.5306) + day - 1;
  let result = null;
  for (let i = 0; i < 60; i++) {
    const h = hijriAtDay(n);
    const cmp = cmpYMD(h, target);
    if (Number.isNaN(cmp)) break;
    if (cmp === 0) { result = n; break; }
    let step = Math.round((year - h.year) * 354.36667 + (month - h.month) * 29.5306 + (day - h.day));
    if (step === 0) step = cmp < 0 ? 1 : -1;
    if (Math.abs(step) === 1) {
      // Close: if the neighbour overshoots the target, the target day does not exist.
      const next = hijriAtDay(n + step);
      const cmp2 = cmpYMD(next, target);
      if (cmp2 === 0) { result = n + step; break; }
      if (Math.sign(cmp2) !== Math.sign(cmp)) break;
    }
    n += step;
  }
  if (hijriDayCache.size > 20000) hijriDayCache.clear();
  hijriDayCache.set(key, result);
  return result;
}

/** Inclusive day-number span {start, end} of a (partial) Hijri date, or null. */
function hijriSpan(p) {
  const start = hijriToDay(p.year, p.month || 1, p.day || 1);
  if (start === null) return null;
  if (p.precision === 'day') return { start, end: start };
  const next = p.precision === 'month'
    ? (p.month === 12 ? hijriToDay(p.year + 1, 1, 1) : hijriToDay(p.year, p.month + 1, 1))
    : hijriToDay(p.year + 1, 1, 1);
  return { start, end: next === null ? start + (p.precision === 'month' ? 29 : 353) : next - 1 };
}

/**
 * Hijri "YYYY[-MM[-DD]]" → {date:"YYYY-MM-DD" Gregorian, approx}. A full Hijri date converts exactly (approx false);
 * year-only / month-only converts the 1st day of that Hijri year / month (approx true). Null when invalid.
 */
export function hijriToGregorian(h) {
  const p = parseHijri(h);
  if (!p) return null;
  const n = hijriToDay(p.year, p.month || 1, p.day || 1);
  if (n === null) return null;
  const g = fromDayNumber(n);
  return { date: ymdString(g.year, g.month, g.day), approx: p.precision !== 'day' };
}

/**
 * Gregorian date → {hijri, approx}. A full date converts exactly ("YYYY-MM-DD", approx false); a year/month-only
 * date gives the Hijri year/month containing its first day (approx true). Null when invalid.
 */
export function gregorianToHijri(date) {
  const p = parseDate(typeof date === 'object' && date ? date.date : date);
  if (!p) return null;
  const h = hijriAtDay(dayNumber(p.year, p.month || 1, p.day || 1));
  if (!Number.isFinite(h.year)) return null;
  if (p.precision === 'day') return { hijri: ymdString(h.year, h.month, h.day), approx: false };
  if (p.precision === 'month') return { hijri: ymdString(h.year, h.month, 0), approx: true };
  return { hijri: ymdString(h.year, 0, 0), approx: true };
}

// ---------------------------------------------------------------------------------------------------------
// Spans, comparison, years

function asDateObj(d) {
  if (d && typeof d === 'object') return d;
  return { date: typeof d === 'string' ? d : '' };
}

/** Inclusive day-number span of a Gregorian (partial) date string, or null. */
function gregorianSpan(p) {
  if (p.precision === 'day') { const n = dayNumber(p.year, p.month, p.day); return { start: n, end: n }; }
  if (p.precision === 'month') {
    return { start: dayNumber(p.year, p.month, 1), end: dayNumber(p.year, p.month, daysInMonth(p.year, p.month)) };
  }
  return { start: dayNumber(p.year, 1, 1), end: dayNumber(p.year, 12, 31) };
}

/**
 * The range of days a date can denote: {start, end} (inclusive day numbers) or null when unknown.
 * Accepts a date string or a date object; when the object carries a valid `hijri` the Hijri period is used
 * (a Hijri year straddles two Gregorian years). `approx` is NOT applied here (callers decide the tolerance).
 */
export function dateSpan(d) {
  const o = asDateObj(d);
  if (o.hijri) {
    const hp = parseHijri(o.hijri);
    if (hp) { const s = hijriSpan(hp); if (s) return s; }
  }
  const p = parseDate(o.date);
  return p ? gregorianSpan(p) : null;
}

/**
 * Compare two Gregorian dates (strings or date objects): negative / 0 / positive. Missing month/day count as 0, so
 * "1950" sorts before "1950-03"; empty or invalid dates sort after all known dates (two unknown dates compare 0).
 */
export function compareDates(a, b) {
  const pa = parseDate(asDateObj(a).date);
  const pb = parseDate(asDateObj(b).date);
  if (!pa || !pb) return (pa ? 0 : 1) - (pb ? 0 : 1);
  return (pa.year - pb.year) || (pa.month - pb.month) || (pa.day - pb.day);
}

/** Gregorian year of a date string or object (falls back to the Hijri value), or null. */
export function yearOf(d) {
  const o = asDateObj(d);
  const p = parseDate(o.date);
  if (p) return p.year;
  if (o.hijri) {
    const g = hijriToGregorian(o.hijri);
    if (g) return Number(g.date.slice(0, 4));
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Ages

/** "today" as a day number: Date (local calendar day), "YYYY-MM-DD" string, or now. */
function todayDay(today) {
  if (typeof today === 'string') {
    const p = parseDate(today);
    if (p) return dayNumber(p.year, p.month || 1, p.day || 1);
  }
  const d = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
  return dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function fullYearsBetween(fromDay, toDay) {
  const a = fromDayNumber(fromDay);
  const b = fromDayNumber(toDay);
  return b.year - a.year - (b.month < a.month || (b.month === a.month && b.day < a.day) ? 1 : 0);
}

/**
 * Age in completed years — the LOWER bound when dates are partial (latest possible birth, earliest possible end),
 * so privacy checks err on the side of "younger".
 * birth / end: date strings or objects. end null / undefined / "" → today; an end date OBJECT without a date → null
 * (e.g. deceased with unknown death date). today: Date | "YYYY-MM-DD" | undefined (now). Returns null when unknown.
 */
export function age(birth, end, today) {
  const b = dateSpan(birth);
  if (!b) return null;
  let endDay;
  if (end === null || end === undefined || end === '') endDay = todayDay(today);
  else {
    const e = dateSpan(end);
    if (!e) return null;
    endDay = e.start;
  }
  if (endDay < b.end) return endDay < b.start ? null : 0;
  return fullYearsBetween(b.end, endDay);
}

/** True when a living person is (or may be, given a partial birth date) under 18. Unknown birth → false. */
export function isMinor(person, today) {
  if (!person || person.deceased) return false;
  if (person.privacy === 'hidden') return false;
  const a = age(person.birth || {}, null, today);
  return a !== null && a < 18;
}

// ---------------------------------------------------------------------------------------------------------
// Formatting

const formatterCache = new Map();
function dtf(locale, options) {
  const key = locale + JSON.stringify(options);
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
    formatterCache.set(key, f);
  }
  return f;
}

const isAr = (lang) => lang === 'ar';
/** Apply the Arabic digit preference to a finished Arabic string. */
const arDigits = (s) => (digitsPref === 'arab' ? toArabicDigits(s) : s);
const APPROX = { ar: 'حوالي ', en: 'c. ' };
const HIJRI_ERA = { ar: ' هـ', en: ' AH' };

function utcDate(y, m, d) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  return dt;
}

/** Gregorian date parts {year, month, day} at the given precision → localized text (pinned locales). */
function formatGregorianParts(p, lang) {
  if (p.precision === 'year') return String(p.year);
  const date = utcDate(p.year, p.month, p.day || 1);
  const withDay = p.precision === 'day';
  if (isAr(lang)) {
    const f = dtf(`ar-u-ca-gregory-nu-${digitsPref}`, { year: 'numeric', month: 'long', ...(withDay ? { day: 'numeric' } : {}) });
    return f.formatToParts(date)
      .map((part) => (part.type === 'month' && monthNamesPref === 'levantine' ? LEVANTINE_MONTHS[p.month - 1] : part.value))
      .join('');
  }
  const f = dtf('en-GB-u-ca-gregory', { year: 'numeric', month: 'short', ...(withDay ? { day: 'numeric' } : {}) });
  return f.format(date);
}

/** Month name + year of a day number (for Gregorian ranges of Hijri months). */
function monthYearOfDay(n, lang) {
  const c = fromDayNumber(n);
  return formatGregorianParts({ ...c, precision: 'month' }, lang);
}

/** Hijri parts at a precision → "12 رمضان 1445 هـ" / "12 Ramadan 1445 AH". */
function formatHijriParts(p, lang) {
  const L = isAr(lang) ? 'ar' : 'en';
  const bits = [];
  if (p.precision === 'day') bits.push(String(p.day));
  if (p.precision !== 'year') bits.push(HIJRI_MONTHS[L][p.month - 1]);
  bits.push(String(p.year));
  return bits.join(' ') + HIJRI_ERA[L];
}

/** Format a Hijri string alone ("1370 هـ"). Returns "" when invalid. */
export function formatHijri(h, lang = 'en') {
  const p = parseHijri(h);
  if (!p) return '';
  const s = formatHijriParts(p, lang);
  return isAr(lang) ? arDigits(s) : s;
}

/** Gregorian rendering of a whole Hijri period (year or month) — e.g. "1950–51" / "Feb–Mar 1951". */
function formatGregorianSpan(span, precision, lang) {
  const a = fromDayNumber(span.start);
  const b = fromDayNumber(span.end);
  if (precision === 'month') {
    if (a.year === b.year && a.month === b.month) return monthYearOfDay(span.start, lang);
    if (a.year === b.year) {
      const first = formatGregorianParts({ ...a, precision: 'month' }, lang).replace(/\s*\S+$/, '');
      return `${first}–${monthYearOfDay(span.end, lang)}`;
    }
    return `${monthYearOfDay(span.start, lang)}–${monthYearOfDay(span.end, lang)}`;
  }
  if (a.year === b.year) return String(a.year);
  // English abbreviates the second year within the same century ("1950–51"); Arabic writes it in full.
  if (!isAr(lang) && Math.floor(a.year / 100) === Math.floor(b.year / 100)) return `${a.year}–${pad(b.year % 100, 2)}`;
  return `${a.year}–${b.year}`;
}

function capPrecision(p, cap) {
  if (cap !== 'year' || p.precision === 'year') return p;
  return { ...p, month: 0, day: 0, precision: 'year' };
}

/**
 * Format a date for display.
 *   input: date string ("1950-03-12") or date object {date, hijri?, approx?}.
 *   lang:  "ar" | "en".
 *   opts:  precision "full" (default) | "year" | "hidden" — display cap (the person's birth privacy);
 *          approx — override the object's flag; hijri — override the object's Hijri value;
 *          calendar "gregorian" (default) | "hijri" — "hijri" also shows the Hijri equivalent of a Gregorian-entered date.
 * Dates entered in Hijri always show the Hijri first and the Gregorian in parentheses:
 *   "12 مارس 1950" · "12 Mar 1950" · "حوالي 1950" · "c. 1950" · "1370 هـ (حوالي 1950–1951)" · "1370 AH (c. 1950–51)".
 * Arabic output honours setDigits / setMonthNames. Returns "" for no date (invalid input is returned unchanged).
 */
export function formatDate(input, lang = 'en', opts = {}) {
  const o = asDateObj(input);
  const cap = opts.precision || 'full';
  if (cap === 'hidden') return '';
  const L = isAr(lang) ? 'ar' : 'en';
  const approx = opts.approx !== undefined ? !!opts.approx : o.approx === true;
  const hijri = opts.hijri !== undefined ? opts.hijri : o.hijri;
  let out = '';

  const hp = hijri ? parseHijri(hijri) : null;
  if (hp) {
    const p = capPrecision(hp, cap);
    const primary = (approx && p.precision === 'day' ? APPROX[L] : '') + formatHijriParts(p, L);
    const span = hijriSpan(p);
    let secondary = '';
    if (span) {
      secondary = p.precision === 'day'
        ? formatGregorianParts({ ...fromDayNumber(span.start), precision: 'day' }, L)
        : APPROX[L] + formatGregorianSpan(span, p.precision, L);
    }
    out = secondary ? `${primary} (${secondary})` : primary;
  } else {
    const raw = typeof o.date === 'string' ? o.date.trim() : '';
    if (!raw) return '';
    const gp = parseDate(raw);
    if (!gp) return raw;
    const p = capPrecision(gp, cap);
    out = (approx ? APPROX[L] : '') + formatGregorianParts(p, L);
    if (opts.calendar === 'hijri') {
      const span = gregorianSpan(p);
      if (p.precision === 'day') {
        const h = hijriAtDay(span.start);
        if (Number.isFinite(h.year)) out += ` (${formatHijriParts({ ...h, precision: 'day' }, L)})`;
      } else {
        const a = hijriAtDay(span.start);
        const b = hijriAtDay(span.end);
        if (Number.isFinite(a.year) && Number.isFinite(b.year)) {
          const years = a.year === b.year ? String(a.year) : `${a.year}–${b.year}`;
          out += ` (${years}${HIJRI_ERA[L]})`;
        }
      }
    }
  }
  return L === 'ar' ? arDigits(out) : out;
}

/**
 * Compact life-years label for cards and lists — never uses a cross (†):
 *   "1950–2010" · "b. 1990" / "م 1990" · "d. 2010" / "ت 2010" · "1950–?" (deceased, death year unknown) · "" (nothing known).
 * Approximate years get "c. " / "حوالي ". Respects birth privacy "hidden".
 */
export function yearsLabel(person, lang = 'en') {
  if (!person) return '';
  const L = isAr(lang) ? 'ar' : 'en';
  const birth = person.birth || {};
  const death = person.death || {};
  const by = person.privacy === 'hidden' ? null : yearOf(birth);
  const dy = person.deceased ? yearOf(death) : null;
  const b = by === null ? '' : (birth.approx ? APPROX[L] : '') + by;
  const d = dy === null ? '' : (death.approx ? APPROX[L] : '') + dy;
  let out = '';
  if (person.deceased) {
    if (b && d) out = `${b}–${d}`;
    else if (d) out = (L === 'ar' ? 'ت ' : 'd. ') + d;
    else if (b) out = `${b}–${L === 'ar' ? '؟' : '?'}`;
  } else if (b) {
    out = (L === 'ar' ? 'م ' : 'b. ') + b;
  }
  return L === 'ar' ? arDigits(out) : out;
}
