// Person form (docs/SPEC.md §7.4): add a new person or correct an existing one.
//
//   const form = personForm({ mode: 'add' | 'edit', person, context });
//   form.el          the form element (mount it inside a dialog body)
//   form.validate()  → add:  { ok, value: PersonInput, warnings }
//                      edit: { ok, set, before, warnings }       (set = only the changed paths)
//                      not ok: { ok: false, errors: [message] }  (errors are also shown inline)
//   form.focus()     focus the first useful field
//   form.peek()      current name-ish values without validating ({ ar, en, nickname, gender }) for duplicate checks
//
// context = {
//   relation: 'child' | 'spouse' | 'parent' | 'sibling' | '' — words the gender choice (son/daughter, husband/wife…)
//   gender: 'm' | 'f'          fixed gender (the choice is hidden), e.g. "add a mother"
//   defaultGender: 'm' | 'f'   pre-selected but changeable
//   admin: boolean             show the photo URL field (default: ?admin=1 in the URL or the #/admin route)
//   compact: boolean           hide the "more details" disclosure (quick add)
// }
//
// Auto English: the English name/surname/nickname fills itself from the Arabic (translit.js) until someone edits
// it; on save the English is included only when it differs from the automatic spelling.
// Privacy: living people default to "year only"; minors cannot publish the full date and their personal details
// (place of birth, occupation, bio, photo) are hidden.  Never inserts user data as HTML.
import { h, icon } from '../dom.js';
import { t, register, lang, intlLocale } from '../i18n.js';
import { store } from '../store.js';
import { whatsappUrl, ownerName, lineageOf } from '../ui.js';
import { transliterate } from '../core/translit.js';
import { looksLikeFullName, splitFullName } from '../core/names.js';
import {
  toAsciiDigits, isValidDate, isValidHijri, hijriToGregorian, gregorianToHijri, isMinor,
  HIJRI_MONTHS, LEVANTINE_MONTHS, getMonthNames, yearOf,
} from '../core/dates.js';
import { normalizePerson, LIMITS } from '../core/schema.js';

register({
  en: {
    'pf.givenName': 'First name only',
    'pf.givenNameHint': 'For example: Muhammad, Abdullah, Nour Al-Din. The father’s and family names come from the tree.',
    'pf.arabic': 'Arabic',
    'pf.english': 'English',
    'pf.autoHint': 'Automatic spelling — correct it if needed',
    'pf.fullNameDetected': 'This looks like a full name. Only the first name is needed here: “{given}”.',
    'pf.fullNameFather': 'The father’s name ({father}) comes from the person this entry is linked to.',
    'pf.fullNameFamily': 'The family name ({family}) belongs in the “Family name” field.',
    'pf.useGiven': 'Keep only “{given}”',
    'pf.useGivenFamily': 'Keep “{given}” and move “{family}” to the family name',
    'pf.ns.unknown': 'The name is not known',
    'pf.ns.withheld': 'Prefer not to publish the name',
    'pf.nsHint': 'The tree will show a polite description instead, such as “Wife of Muhammad Hassan”, or the nickname if one is given.',
    'pf.nameRequired': 'Please write the first name, or tick “The name is not known”.',
    'pf.g.child': 'Son or daughter?',
    'pf.g.spouse': 'Husband or wife?',
    'pf.g.parent': 'Father or mother?',
    'pf.g.sibling': 'Brother or sister?',
    'pf.g.self': 'Male or female?',
    'pf.g.child.m': 'Son', 'pf.g.child.f': 'Daughter',
    'pf.g.spouse.m': 'Husband', 'pf.g.spouse.f': 'Wife',
    'pf.g.parent.m': 'Father', 'pf.g.parent.f': 'Mother',
    'pf.g.sibling.m': 'Brother', 'pf.g.sibling.f': 'Sister',
    'pf.g.self.m': 'Male', 'pf.g.self.f': 'Female',
    'pf.genderRequired': 'Please choose one.',
    'pf.surname': 'Family name',
    'pf.surnameHint': 'As the family writes it, e.g. Alem, Al-Harbi. For someone who married into the family: the rest of their full name.',
    'pf.nickname': 'Nickname or kunya',
    'pf.nicknamePh': 'Abu Khalid, Umm Khalid, Al-Hajj',
    'pf.nicknameHint': 'Optional — how the family knows them.',
    'pf.life': 'Living or passed away?',
    'pf.living': 'Living',
    'pf.deceased': 'Passed away',
    'pf.birth': 'Year of birth',
    'pf.death': 'Year of death',
    'pf.dateHint': 'An approximate year is fine.',
    'pf.month': 'Month (optional)',
    'pf.day': 'Day (optional)',
    'pf.monthNone': 'Month —',
    'pf.dayNone': 'Day —',
    'pf.approx': 'Approximate',
    'pf.calendar': 'Calendar',
    'pf.cal.g': 'AD',
    'pf.cal.h': 'AH',
    'pf.cal.gLong': 'Gregorian calendar',
    'pf.cal.hLong': 'Hijri calendar',
    'pf.yearPh': 'e.g. {y}',
    'pf.err.year': 'Please write the year in 4 digits, e.g. {y}.',
    'pf.err.future': 'This year has not come yet.',
    'pf.err.day': 'This day does not exist in that month.',
    'pf.err.deathBeforeBirth': 'The year of death is before the year of birth.',
    'pf.birthPlace': 'Place of birth',
    'pf.deathPlace': 'Place of death',
    'pf.placePh': 'e.g. Makkah',
    'pf.privacy': 'What to publish of the birth date',
    'pf.priv.full': 'Full date',
    'pf.priv.year': 'Year only',
    'pf.priv.hidden': 'Nothing',
    'pf.privHint': 'For living relatives only the year is published by default — everything on this site can be seen by anyone on the internet.',
    'pf.privMinor': 'Under 18: the full birth date and personal details (place, work, bio, photo) are not published.',
    'pf.more': 'More details (optional)',
    'pf.occupation': 'Work or profession',
    'pf.occupationPh': 'e.g. teaching, medicine, trade',
    'pf.bio': 'A few words',
    'pf.bioHint': 'Memories, achievements, what the family remembers. Please keep private matters out.',
    'pf.photo': 'Photo',
    'pf.photoSend': 'Send the photo to {owner} on WhatsApp',
    'pf.photoHint': 'Photos are added by {owner} after review.',
    'pf.photoText': 'A photo for {name} on the family tree: {link}',
    'pf.photoUrl': 'Photo address (owner only)',
    'pf.err.photo': 'Use an https:// link or photos/<id>.jpg',
    'pf.tooLong': 'This is too long (at most {n} characters).',
    'pf.minorNote': 'Personal details are not published for people under 18.',
    'pf.writtenIn': 'Written in {lang}',
    'pf.langAr': 'Arabic',
    'pf.langEn': 'English',
  },
  ar: {
    'pf.givenName': 'الاسم الأول فقط',
    'pf.givenNameHint': 'مثال: محمد، عبد الله، نور الدين. اسم الأب واسم العائلة يأتيان من الشجرة تلقائياً.',
    'pf.arabic': 'بالعربية',
    'pf.english': 'بالإنجليزية',
    'pf.autoHint': 'كتابة تلقائية — يمكن تصحيحها',
    'pf.fullNameDetected': 'يبدو أن هذا اسم كامل، والمطلوب هنا الاسم الأول فقط: «{given}».',
    'pf.fullNameFather': 'اسم الأب ({father}) يُؤخذ من الشخص المرتبط به في الشجرة.',
    'pf.fullNameFamily': 'واسم العائلة ({family}) مكانه حقل «اسم العائلة».',
    'pf.useGiven': 'الاكتفاء بـ«{given}»',
    'pf.useGivenFamily': 'الاكتفاء بـ«{given}» ونقل «{family}» إلى اسم العائلة',
    'pf.ns.unknown': 'الاسم غير معروف',
    'pf.ns.withheld': 'تفضيل عدم نشر الاسم',
    'pf.nsHint': 'ستعرض الشجرة بدلاً منه وصفاً لائقاً مثل «زوجة محمد حسن»، أو الكنية إن وُجدت.',
    'pf.nameRequired': 'يُرجى كتابة الاسم الأول، أو تحديد خيار «الاسم غير معروف».',
    'pf.g.child': 'ابن أم ابنة؟',
    'pf.g.spouse': 'زوج أم زوجة؟',
    'pf.g.parent': 'والد أم والدة؟',
    'pf.g.sibling': 'أخ أم أخت؟',
    'pf.g.self': 'ذكر أم أنثى؟',
    'pf.g.child.m': 'ابن', 'pf.g.child.f': 'ابنة',
    'pf.g.spouse.m': 'زوج', 'pf.g.spouse.f': 'زوجة',
    'pf.g.parent.m': 'الأب', 'pf.g.parent.f': 'الأم',
    'pf.g.sibling.m': 'أخ', 'pf.g.sibling.f': 'أخت',
    'pf.g.self.m': 'ذكر', 'pf.g.self.f': 'أنثى',
    'pf.genderRequired': 'يُرجى الاختيار.',
    'pf.surname': 'اسم العائلة',
    'pf.surnameHint': 'كما تكتبه العائلة، مثل: عالم، الحربي. ولمن دخل العائلة بالزواج: بقية اسمه الكامل.',
    'pf.nickname': 'الكنية أو اللقب',
    'pf.nicknamePh': 'أبو خالد، أم خالد، الحاج',
    'pf.nicknameHint': 'اختياري — الاسم الذي تعرفه به العائلة.',
    'pf.life': 'على قيد الحياة أم في ذمّة الله؟',
    'pf.living': 'على قيد الحياة',
    'pf.deceased': 'في ذمّة الله',
    'pf.birth': 'سنة الميلاد',
    'pf.death': 'سنة الوفاة',
    'pf.dateHint': 'تكفي سنة تقريبية.',
    'pf.month': 'الشهر (اختياري)',
    'pf.day': 'اليوم (اختياري)',
    'pf.monthNone': 'الشهر —',
    'pf.dayNone': 'اليوم —',
    'pf.approx': 'تقريبي',
    'pf.calendar': 'التقويم',
    'pf.cal.g': 'م',
    'pf.cal.h': 'هـ',
    'pf.cal.gLong': 'التقويم الميلادي',
    'pf.cal.hLong': 'التقويم الهجري',
    'pf.yearPh': 'مثال: {y}',
    'pf.err.year': 'يُرجى كتابة السنة بأربعة أرقام، مثل {y}.',
    'pf.err.future': 'هذه السنة لم تأتِ بعد.',
    'pf.err.day': 'هذا اليوم غير موجود في ذلك الشهر.',
    'pf.err.deathBeforeBirth': 'سنة الوفاة قبل سنة الميلاد.',
    'pf.birthPlace': 'مكان الميلاد',
    'pf.deathPlace': 'مكان الوفاة',
    'pf.placePh': 'مثال: مكة المكرمة',
    'pf.privacy': 'ما يُنشر من تاريخ الميلاد',
    'pf.priv.full': 'التاريخ كاملاً',
    'pf.priv.year': 'السنة فقط',
    'pf.priv.hidden': 'لا شيء',
    'pf.privHint': 'للأحياء تُنشر السنة فقط افتراضياً، فكل ما في هذا الموقع يستطيع أي شخص على الإنترنت رؤيته.',
    'pf.privMinor': 'لمن هم دون 18 سنة: لا يُنشر تاريخ الميلاد كاملاً ولا التفاصيل الشخصية (المكان والعمل والنبذة والصورة).',
    'pf.more': 'تفاصيل إضافية (اختيارية)',
    'pf.occupation': 'العمل أو المهنة',
    'pf.occupationPh': 'مثال: التعليم، الطب، التجارة',
    'pf.bio': 'نبذة قصيرة',
    'pf.bioHint': 'ذكريات وإنجازات وما تحفظه العائلة، مع إبقاء الأمور الخاصة بعيداً عن الموقع.',
    'pf.photo': 'الصورة',
    'pf.photoSend': 'إرسال الصورة إلى {owner} عبر واتساب',
    'pf.photoHint': 'يضيف {owner} الصور بعد مراجعتها.',
    'pf.photoText': 'صورة لـ{name} في شجرة العائلة: {link}',
    'pf.photoUrl': 'رابط الصورة (للمشرف فقط)',
    'pf.err.photo': 'يُرجى استخدام رابط يبدأ بـ https:// أو photos/<id>.jpg',
    'pf.tooLong': 'النص أطول من المسموح (الحد الأقصى {n} حرفاً).',
    'pf.minorNote': 'لا تُنشر التفاصيل الشخصية لمن هم دون 18 سنة.',
    'pf.writtenIn': 'بـ{lang}',
    'pf.langAr': 'العربية',
    'pf.langEn': 'الإنجليزية',
  },
});

let seq = 0;
const uid = (s) => `pf${++seq}-${s}`;
const PHOTO_RE = /^(https:\/\/\S+|photos\/p[a-z0-9]{3,24}\.(?:jpg|webp))$/;
const trim = (s) => String(s ?? '').trim();

/** Is the owner tooling active? (?admin=1 in the URL, or the #/admin route.) */
export function isAdminMode() {
  try {
    if (/[?&]admin=1\b/.test(location.search) || /[?&]admin=1\b/.test(location.hash)) return true;
    return /^#\/admin\b/.test(location.hash);
  } catch { return false; }
}

// ---------------------------------------------------------------------------------------------------------
// Small building blocks

/** A labelled field: { el, setError(msg), control }. */
function field({ label, control, hint = '', id = control?.id, className = '', labelTag = 'label' }) {
  const errorEl = h('div', { class: 'field-error', id: `${id}-err`, attrs: { 'aria-live': 'polite' } });
  const hintEl = hint ? h('div', { class: 'field-hint', id: `${id}-hint` }, hint) : null;
  const labelEl = label ? h(labelTag, { class: 'field-label', for: labelTag === 'label' ? id : undefined, id: `${id}-label` }, label) : null;
  const el = h('div', { class: ['field', className] }, labelEl, control, hintEl, errorEl);
  return {
    el,
    errorEl,
    hintEl,
    setError(msg) {
      errorEl.textContent = msg || '';
      el.classList.toggle('has-error', !!msg);
      el.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea').forEach((c) => {
        if (msg) c.setAttribute('aria-invalid', 'true');
        else c.removeAttribute('aria-invalid');
      });
    },
  };
}

/** Segmented choice built from radio inputs. options: [{value, label, title?}] → {el, get value, set value, onChange} */
export function segmentedChoice({ name = uid('seg'), options, value = '', label = '', onChange = null, className = '' }) {
  const inputs = [];
  const el = h('div', { class: ['segmented', 'form-segmented', className], attrs: { role: 'radiogroup', 'aria-label': label || null } },
    options.map((o) => {
      const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === value, disabled: !!o.disabled });
      input.addEventListener('change', () => { if (input.checked && onChange) onChange(o.value); });
      inputs.push(input);
      return h('label', { title: o.title || null, attrs: { 'aria-label': o.title || null } }, input, h('span', null, o.label));
    }));
  return {
    el,
    inputs,
    get value() { return (inputs.find((i) => i.checked) || {}).value || ''; },
    set value(v) { inputs.forEach((i) => { i.checked = i.value === v; }); },
    setDisabled(v, disabled) { inputs.forEach((i) => { if (i.value === v) { i.disabled = disabled; i.parentElement.classList.toggle('is-disabled', disabled); } }); },
  };
}

/**
 * Arabic + English inputs side by side. English auto-fills from the Arabic while untouched.
 * value() → {ar, en} where en is '' when it equals the automatic spelling.
 */
function bilingualInputs({ id, value = {}, kind = 'given', maxLength = LIMITS.name, placeholderAr = '', placeholderEn = '', describedBy = '' }) {
  const auto = (s) => transliterate(trim(s), { kind });
  const initialAr = trim(value.ar);
  const initialEn = trim(value.en);
  let touched = !!initialEn && initialEn !== auto(initialAr);
  const ar = h('input', {
    id, class: 'input form-input-ar', type: 'text', dir: 'rtl', lang: 'ar', maxLength, autocomplete: 'off',
    placeholder: placeholderAr, attrs: { 'aria-describedby': describedBy || null, spellcheck: 'false' },
  });
  const en = h('input', {
    id: `${id}-en`, class: 'input form-input-en', type: 'text', dir: 'ltr', lang: 'en', maxLength, autocomplete: 'off',
    placeholder: placeholderEn, attrs: { autocapitalize: 'words', spellcheck: 'false', 'aria-describedby': `${id}-auto` },
  });
  ar.value = initialAr;
  en.value = initialEn || auto(initialAr);
  const autoNote = h('span', { class: 'form-auto-note small', id: `${id}-auto` }, icon('star', { size: 13 }), t('pf.autoHint'));
  const refresh = () => {
    autoNote.hidden = touched || !trim(ar.value);
    en.classList.toggle('is-auto', !touched && !!trim(ar.value));
  };
  ar.addEventListener('input', () => { if (!touched) en.value = auto(ar.value); refresh(); });
  en.addEventListener('input', () => { touched = !!trim(en.value) && trim(en.value) !== auto(ar.value); refresh(); });
  en.addEventListener('blur', () => { if (!trim(en.value)) { touched = false; en.value = auto(ar.value); refresh(); } });
  refresh();
  const el = h('div', { class: 'form-bi' },
    h('div', { class: 'form-bi-col' }, h('span', { class: 'form-lang', attrs: { 'aria-hidden': 'true' } }, t('pf.arabic')), ar),
    h('div', { class: 'form-bi-col' },
      h('label', { class: 'form-lang', for: `${id}-en` }, t('pf.english')),
      en, autoNote));
  return {
    el,
    ar,
    en,
    value() {
      const a = trim(ar.value);
      let e = touched ? trim(en.value) : '';
      if (e && e === auto(a)) e = '';
      return { ar: a, en: e };
    },
    setAr(text) { ar.value = text; if (!touched) en.value = auto(text); refresh(); },
    clear() { ar.value = ''; en.value = ''; touched = false; refresh(); },
    get autoValue() { return auto(ar.value); },
    initialEn,
  };
}

/** Month names for the month select. */
function monthNames(calendar) {
  const L = lang();
  if (calendar === 'hijri') return HIJRI_MONTHS[L] || HIJRI_MONTHS.en;
  if (L === 'ar' && getMonthNames() === 'levantine') return LEVANTINE_MONTHS;
  const f = new Intl.DateTimeFormat(intlLocale(), { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(Date.UTC(2001, i, 1))));
}

function currentYears() {
  const now = new Date();
  const gy = now.getUTCFullYear();
  let hy = 1500;
  try { hy = Number(String(gregorianToHijri(now.toISOString().slice(0, 10))?.hijri || '').slice(0, 4)) || 1500; } catch { /* ignore */ }
  return { gy, hy };
}

function splitParts(s) {
  const m = /^(\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(trim(s));
  if (!m) return { y: '', m: '', d: '' };
  return { y: m[1], m: m[2] ? String(Number(m[2])) : '', d: m[3] ? String(Number(m[3])) : '' };
}
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Date input: year (numeric text, Arabic digits accepted) + optional month/day + approximate + calendar م/هـ.
 *   read() → { empty, error, date, hijri, approx, year (Gregorian year for comparisons) }
 *   setDetail(bool) shows/hides month & day (birth-date privacy "year" publishes the year only).
 */
export function dateInput({ value = {}, id = uid('date'), withApprox = true, withDetail = true, onChange = null, labelledBy = '' } = {}) {
  const cfgCal = store.config?.primaryCalendar === 'hijri' ? 'hijri' : 'gregorian';
  let cal = trim(value.hijri) ? 'hijri' : cfgCal;
  const parts = splitParts(cal === 'hijri' ? value.hijri : value.date);
  let detail = withDetail;
  const changed = () => { if (onChange) onChange(); };

  const year = h('input', {
    id, class: 'input form-year', type: 'text', inputMode: 'numeric', autocomplete: 'off', maxLength: 4, dir: 'ltr',
    attrs: { inputmode: 'numeric', pattern: '[0-9٠-٩۰-۹]*', 'aria-describedby': `${id}-err`, 'aria-labelledby': labelledBy || null },
  });
  year.value = parts.y;
  year.addEventListener('input', () => {
    const v = toAsciiDigits(year.value).replace(/\D/g, '').slice(0, 4);
    if (v !== year.value) year.value = v;
    changed();
  });

  const month = h('select', { class: 'select form-month', attrs: { 'aria-label': t('pf.month') } });
  const day = h('select', { class: 'select form-day', attrs: { 'aria-label': t('pf.day') } });
  function fillMonths() {
    const keep = month.value;
    month.replaceChildren(h('option', { value: '' }, t('pf.monthNone')),
      ...monthNames(cal).map((n, i) => h('option', { value: String(i + 1) }, n)));
    month.value = keep;
  }
  function fillDays() {
    const keep = day.value;
    day.replaceChildren(h('option', { value: '' }, t('pf.dayNone')),
      ...Array.from({ length: cal === 'hijri' ? 30 : 31 }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
    day.value = keep;
  }
  fillMonths();
  fillDays();
  month.value = parts.m;
  day.value = parts.d;
  month.addEventListener('change', () => { day.disabled = !month.value; if (!month.value) day.value = ''; changed(); });
  day.addEventListener('change', changed);
  day.disabled = !month.value;

  const approx = h('input', { type: 'checkbox', checked: !!value.approx });
  approx.addEventListener('change', changed);

  const placeholder = () => {
    year.placeholder = t('pf.yearPh', { y: cal === 'hijri' ? '1385' : '1965' });
  };
  placeholder();
  const calSeg = segmentedChoice({
    label: t('pf.calendar'),
    value: cal,
    className: 'form-cal',
    options: [
      { value: 'gregorian', label: t('pf.cal.g'), title: t('pf.cal.gLong') },
      { value: 'hijri', label: t('pf.cal.h'), title: t('pf.cal.hLong') },
    ],
    onChange: (v) => { cal = v; placeholder(); fillMonths(); fillDays(); changed(); },
  });

  const detailRow = h('div', { class: 'form-date-detail' }, month, day);
  const el = h('div', { class: 'form-date' },
    h('div', { class: 'form-date-main' }, year, calSeg.el),
    detailRow,
    withApprox ? h('label', { class: 'check form-approx' }, approx, h('span', null, t('pf.approx'))) : null);
  const setDetail = (on) => { detail = !!on; detailRow.hidden = !detail; };
  setDetail(withDetail);

  function read() {
    const y = trim(year.value);
    if (!y) return { empty: true, date: '', hijri: '', approx: false, year: null };
    const { gy, hy } = currentYears();
    const n = Number(y);
    const sample = cal === 'hijri' ? '1385' : '1965';
    if (!/^\d{3,4}$/.test(y) || n < 1) return { error: t('pf.err.year', { y: sample }) };
    if ((cal === 'hijri' && n > hy) || (cal !== 'hijri' && n > gy)) return { error: t('pf.err.future') };
    let s = pad2(n).padStart(4, '0');
    if (detail && month.value) {
      s += `-${pad2(month.value)}`;
      if (day.value) s += `-${pad2(day.value)}`;
    }
    const ok = cal === 'hijri' ? isValidHijri(s) : isValidDate(s);
    if (!ok) return { error: t('pf.err.day') };
    let gYear = n;
    if (cal === 'hijri') {
      const g = hijriToGregorian(s);
      gYear = g ? yearOf(g.date) : null;
      return { empty: false, date: '', hijri: s, approx: approx.checked, year: gYear, gdate: g ? g.date : '' };
    }
    return { empty: false, date: s, hijri: '', approx: approx.checked, year: gYear, gdate: s };
  }
  return { el, year, read, setDetail, focus: () => year.focus(), get calendar() { return cal; } };
}

// ---------------------------------------------------------------------------------------------------------
// The form

const GENDER_CONTEXTS = ['child', 'spouse', 'parent', 'sibling'];

export function personForm({ mode = 'add', person = null, context = {} } = {}) {
  const isAdd = mode !== 'edit';
  const p = normalizePerson(person || { id: '' });
  const rel = GENDER_CONTEXTS.includes(context.relation) ? context.relation : 'self';
  const fixedGender = context.gender === 'm' || context.gender === 'f' ? context.gender : '';
  const admin = context.admin ?? isAdminMode();
  const L = lang();
  const femaleDefault = store.config?.privacyDefaults?.femaleNameStatus || 'known';

  const state = {
    nameStatus: isAdd ? 'known' : (p.nameStatus || 'known'),
    nsTouched: !isAdd,
    gender: fixedGender || p.gender || context.defaultGender || '',
    deceased: !!p.deceased,
    privacy: isAdd ? (p.deceased ? 'full' : 'year') : (p.privacy || 'full'),
    privTouched: !isAdd,
    minor: false,
  };
  if (isAdd && state.gender === 'f' && femaleDefault !== 'known') state.nameStatus = femaleDefault;

  // --- name --------------------------------------------------------------------------------------------
  const nameId = uid('name');
  const nameBi = bilingualInputs({
    id: nameId, value: p.nameStatus === 'known' ? p.name : {}, kind: 'given', maxLength: LIMITS.name,
    placeholderAr: 'محمد', placeholderEn: 'Muhammad', describedBy: `${nameId}-hint`,
  });
  const fullNameBox = h('div', { class: 'notice notice-info form-fullname', hidden: true, attrs: { role: 'status' } });
  const nsUnknown = h('input', { type: 'checkbox', checked: state.nameStatus === 'unknown' });
  const nsWithheld = h('input', { type: 'checkbox', checked: state.nameStatus === 'withheld' });
  const nsHint = h('p', { class: 'field-hint form-ns-hint' }, t('pf.nsHint'));
  const nameInputs = h('div', { class: 'form-name-inputs' }, nameBi.el, fullNameBox);
  const nameField = field({
    label: t('pf.givenName'), id: nameId, hint: t('pf.givenNameHint'),
    control: h('div', { class: 'form-name' },
      nameInputs,
      h('div', { class: 'form-ns' },
        h('label', { class: 'check' }, nsUnknown, h('span', null, t('pf.ns.unknown'))),
        h('label', { class: 'check' }, nsWithheld, h('span', null, t('pf.ns.withheld')))),
      nsHint),
  });
  // move the hint right under the inputs (before the name-status options)
  if (nameField.hintEl) nameInputs.appendChild(nameField.hintEl);

  function applyNameStatus() {
    nsUnknown.checked = state.nameStatus === 'unknown';
    nsWithheld.checked = state.nameStatus === 'withheld';
    const known = state.nameStatus === 'known';
    nameInputs.hidden = !known;
    nsHint.hidden = known;
    if (!known) nameField.setError('');
  }
  nsUnknown.addEventListener('change', () => { state.nsTouched = true; state.nameStatus = nsUnknown.checked ? 'unknown' : 'known'; applyNameStatus(); });
  nsWithheld.addEventListener('change', () => { state.nsTouched = true; state.nameStatus = nsWithheld.checked ? 'withheld' : 'known'; applyNameStatus(); });

  function checkFullName() {
    const v = trim(nameBi.ar.value) || trim(nameBi.en.value);
    fullNameBox.replaceChildren();
    if (!v || !looksLikeFullName(v)) { fullNameBox.hidden = true; return; }
    const s = splitFullName(v);
    if (!s.given) { fullNameBox.hidden = true; return; }
    const isAr = !!trim(nameBi.ar.value);
    const useGiven = () => {
      if (isAr) nameBi.setAr(s.given); else nameBi.en.value = s.given;
      fullNameBox.hidden = true;
      nameBi.ar.focus();
    };
    const lines = [h('p', null, t('pf.fullNameDetected', { given: s.given }))];
    if (s.father) lines.push(h('p', { class: 'small' }, t('pf.fullNameFather', { father: s.father })));
    if (s.family) lines.push(h('p', { class: 'small' }, t('pf.fullNameFamily', { family: s.family })));
    const btns = h('div', { class: 'row form-fullname-actions' },
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: useGiven } }, t('pf.useGiven', { given: s.given })));
    const surnameEmpty = !trim(surBi.ar.value) && !trim(surBi.en.value);
    if (s.family && surnameEmpty) {
      btns.appendChild(h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost',
        on: { click: () => { if (isAr) surBi.setAr(s.family); else surBi.en.value = s.family; useGiven(); } },
      }, t('pf.useGivenFamily', { given: s.given, family: s.family })));
    }
    fullNameBox.append(icon('info'), h('div', null, ...lines, btns));
    fullNameBox.hidden = false;
  }
  nameBi.ar.addEventListener('blur', checkFullName);
  nameBi.en.addEventListener('blur', checkFullName);
  nameBi.ar.addEventListener('input', () => { nameField.setError(''); if (!fullNameBox.hidden) checkFullName(); });

  // --- gender ------------------------------------------------------------------------------------------
  const genderLabelId = uid('gender');
  const genderSeg = segmentedChoice({
    label: t(`pf.g.${rel}`),
    value: state.gender,
    className: 'form-gender',
    options: [
      { value: 'm', label: t(`pf.g.${rel}.m`) },
      { value: 'f', label: t(`pf.g.${rel}.f`) },
    ],
    onChange: (v) => {
      state.gender = v;
      genderField.setError('');
      if (isAdd && !state.nsTouched) {
        state.nameStatus = v === 'f' ? (femaleDefault === 'withheld' || femaleDefault === 'unknown' ? femaleDefault : 'known') : 'known';
        applyNameStatus();
      }
    },
  });
  genderSeg.el.setAttribute('aria-labelledby', `${genderLabelId}`);
  const genderField = field({ label: t(`pf.g.${rel}`), control: genderSeg.el, id: genderLabelId, labelTag: 'div' });
  genderField.el.classList.add('form-gender-field');
  if (fixedGender) genderField.el.hidden = true;

  // --- family name & nickname --------------------------------------------------------------------------
  const surId = uid('surname');
  const surBi = bilingualInputs({ id: surId, value: p.surname, kind: 'surname', maxLength: LIMITS.surname, placeholderAr: 'عالم', placeholderEn: 'Alem' });
  const surField = field({ label: t('pf.surname'), control: surBi.el, id: surId, hint: t('pf.surnameHint') });
  const nickId = uid('nick');
  const nickBi = bilingualInputs({ id: nickId, value: p.nickname, kind: 'given', maxLength: LIMITS.nickname, placeholderAr: 'أبو خالد', placeholderEn: t('pf.nicknamePh') });
  const nickField = field({ label: t('pf.nickname'), control: nickBi.el, id: nickId, hint: t('pf.nicknameHint') });

  // --- life status ---------------------------------------------------------------------------------------
  const lifeId = uid('life');
  const lifeSeg = segmentedChoice({
    label: t('pf.life'),
    value: state.deceased ? 'dead' : 'alive',
    className: 'form-life',
    options: [{ value: 'alive', label: t('pf.living') }, { value: 'dead', label: t('pf.deceased') }],
    onChange: (v) => {
      state.deceased = v === 'dead';
      if (!state.privTouched) { state.privacy = state.deceased ? 'full' : 'year'; privSeg.value = state.privacy; }
      refresh();
    },
  });
  lifeSeg.el.setAttribute('aria-labelledby', lifeId);
  const lifeField = field({ label: t('pf.life'), control: lifeSeg.el, id: lifeId, labelTag: 'div' });

  // --- birth ---------------------------------------------------------------------------------------------
  const birthId = uid('birth');
  const birthInput = dateInput({ id: birthId, value: p.birth, onChange: () => { birthField.setError(''); refresh(); } });
  const birthField = field({ label: t('pf.birth'), control: birthInput.el, id: birthId, hint: t('pf.dateHint') });
  const privId = uid('privacy');
  const privSeg = segmentedChoice({
    label: t('pf.privacy'),
    value: state.privacy,
    className: 'form-privacy',
    options: ['year', 'full', 'hidden'].map((v) => ({ value: v, label: t(`pf.priv.${v}`) })),
    onChange: (v) => { state.privacy = v; state.privTouched = true; refresh(); },
  });
  privSeg.el.setAttribute('aria-labelledby', privId);
  const privNote = h('p', { class: 'field-hint form-priv-note' });
  const privField = field({ label: t('pf.privacy'), control: h('div', null, privSeg.el, privNote), id: privId, labelTag: 'div' });
  privField.el.classList.add('form-privacy-field');

  // --- death ---------------------------------------------------------------------------------------------
  const deathId = uid('death');
  const deathInput = dateInput({ id: deathId, value: p.death, onChange: () => deathField.setError('') });
  const deathField = field({ label: t('pf.death'), control: deathInput.el, id: deathId, hint: t('pf.dateHint') });
  const deathPlaceId = uid('dplace');
  const deathPlace = h('input', { id: deathPlaceId, class: 'input', type: 'text', maxLength: LIMITS.place, placeholder: t('pf.placePh'), dir: 'auto' });
  deathPlace.value = p.death.place?.[L] || '';
  const deathPlaceField = field({ label: t('pf.deathPlace'), control: deathPlace, id: deathPlaceId });
  const deathGroup = h('div', { class: 'form-group form-death' }, deathField.el, deathPlaceField.el);

  // --- more details ------------------------------------------------------------------------------------
  const birthPlaceId = uid('bplace');
  const birthPlace = h('input', { id: birthPlaceId, class: 'input', type: 'text', maxLength: LIMITS.place, placeholder: t('pf.placePh'), dir: 'auto' });
  birthPlace.value = p.birth.place?.[L] || '';
  const birthPlaceField = field({ label: t('pf.birthPlace'), control: birthPlace, id: birthPlaceId });
  const occId = uid('occ');
  const occupation = h('input', { id: occId, class: 'input', type: 'text', maxLength: LIMITS.text, placeholder: t('pf.occupationPh'), dir: 'auto' });
  occupation.value = p.occupation?.[L] || '';
  const occField = field({ label: t('pf.occupation'), control: occupation, id: occId });
  const bioId = uid('bio');
  const bio = h('textarea', { id: bioId, class: 'textarea', maxLength: LIMITS.bio, rows: 4, dir: 'auto' });
  bio.value = p.bio?.[L] || '';
  const bioField = field({ label: t('pf.bio'), control: bio, id: bioId, hint: t('pf.bioHint') });

  const photoId = uid('photo');
  let photoInput = null;
  let photoField;
  if (admin) {
    photoInput = h('input', { id: photoId, class: 'input', type: 'url', dir: 'ltr', maxLength: LIMITS.text, placeholder: 'https://… / photos/<id>.jpg' });
    photoInput.value = p.photo || '';
    photoField = field({ label: t('pf.photoUrl'), control: photoInput, id: photoId });
  } else {
    const who = p.id ? (lineageOf(p) || '') : '';
    const link = p.id ? store.siteLink(`#/p/${encodeURIComponent(p.id)}`) : store.siteLink('');
    const text = t('pf.photoText', { name: who || '…', link });
    photoField = field({
      label: t('pf.photo'), id: photoId, labelTag: 'div',
      hint: t('pf.photoHint', { owner: ownerName() }),
      control: h('a', {
        id: photoId, class: 'btn btn-sm form-photo-link', target: '_blank', rel: 'noopener',
        href: whatsappUrl(text, store.config?.owner?.whatsapp || ''),
      }, icon('whatsapp', { size: 18 }), t('pf.photoSend', { owner: ownerName() })),
    });
  }
  const minorNote = h('p', { class: 'notice notice-info form-minor-note', hidden: true }, icon('info'), h('span', null, t('pf.minorNote')));
  const moreBody = h('div', { class: 'form-more-body' }, birthPlaceField.el, occField.el, bioField.el, photoField.el);
  const hasMore = !!(birthPlace.value || occupation.value || bio.value || (admin && p.photo));
  const more = h('details', { class: 'form-more', open: !isAdd && hasMore },
    h('summary', { class: 'form-more-summary' }, icon('chevronDown', { size: 18, className: 'form-more-chevron' }), h('span', null, t('pf.more'))),
    moreBody);
  if (context.compact && !hasMore) more.hidden = true;

  // --- reactive bits -----------------------------------------------------------------------------------
  function minorNow() {
    if (state.deceased) return false;
    const b = birthInput.read();
    if (!b || b.empty || b.error || !b.gdate) return false;
    try { return isMinor({ deceased: false, privacy: 'full', birth: { date: b.gdate } }, new Date()); } catch { return false; }
  }
  function refresh() {
    state.minor = minorNow();
    deathGroup.hidden = !state.deceased;
    privField.el.hidden = state.deceased && isAdd;
    // Minors: no full date, no personal details.
    privSeg.setDisabled('full', state.minor);
    if (state.minor && state.privacy === 'full') { state.privacy = 'year'; privSeg.value = 'year'; }
    privNote.textContent = state.minor ? t('pf.privMinor') : t('pf.privHint');
    birthInput.setDetail(state.deceased || state.privacy === 'full');
    more.hidden = state.minor || (context.compact && !hasMore);
    minorNote.hidden = !state.minor;
  }
  applyNameStatus();
  refresh();

  const el = h('div', { class: 'form person-form', dataset: { mode: isAdd ? 'add' : 'edit' } },
    h('div', { class: 'form-section' }, nameField.el, genderField.el),
    h('div', { class: 'form-section' }, surField.el, nickField.el),
    h('div', { class: 'form-section' }, lifeField.el, birthField.el, privField.el, deathGroup),
    minorNote,
    more);

  // --- validate ------------------------------------------------------------------------------------------
  function readAll() {
    const errors = [];
    const fail = (f, msg, focusEl) => { f.setError(msg); errors.push({ msg, focusEl: focusEl || f.el.querySelector('input, select, textarea') }); };
    [nameField, genderField, surField, nickField, birthField, deathField, deathPlaceField, birthPlaceField, occField, bioField, photoField, privField]
      .forEach((f) => f.setError(''));

    const ns = state.nameStatus;
    const name = ns === 'known' ? nameBi.value() : { ar: '', en: '' };
    const nick = nickBi.value();
    const sur = surBi.value();
    if (ns === 'known' && !name.ar && !name.en && !nick.ar && !nick.en) fail(nameField, t('pf.nameRequired'), nameBi.ar);
    if (name.ar.length > LIMITS.name || name.en.length > LIMITS.name) fail(nameField, t('pf.tooLong', { n: LIMITS.name }));
    if (isAdd && !state.gender) fail(genderField, t('pf.genderRequired'), genderSeg.inputs[0]);

    const b = birthInput.read();
    if (b.error) fail(birthField, b.error, birthInput.year);
    let d = null;
    if (state.deceased) {
      d = deathInput.read();
      if (d.error) fail(deathField, d.error, deathInput.year);
      else if (!b.error && b.year && d.year && d.year < b.year) fail(deathField, t('pf.err.deathBeforeBirth'), deathInput.year);
    }
    let photo = p.photo || '';
    if (photoInput) {
      photo = trim(photoInput.value);
      if (photo && !PHOTO_RE.test(photo)) fail(photoField, t('pf.err.photo'), photoInput);
    }
    return { errors, ns, name, nick, sur, b, d, photo };
  }

  function validate() {
    const r = readAll();
    if (r.errors.length) {
      const first = r.errors[0];
      if (first.focusEl) {
        if (more.contains(first.focusEl)) more.open = true;
        first.focusEl.focus({ preventScroll: false });
      }
      return { ok: false, errors: r.errors.map((e) => e.msg) };
    }
    const minor = state.minor;
    const bi = (o) => {
      const out = {};
      if (o.ar) out.ar = o.ar;
      if (o.en) out.en = o.en;
      return Object.keys(out).length ? out : null;
    };
    const side = (v) => (trim(v) ? { [L]: trim(v) } : null);

    if (isAdd) {
      const value = {};
      if (bi(r.name)) value.name = bi(r.name);
      if (r.ns !== 'known') value.nameStatus = r.ns;
      if (bi(r.sur)) value.surname = bi(r.sur);
      if (bi(r.nick)) value.nickname = bi(r.nick);
      value.gender = state.gender;
      const birth = {};
      if (!r.b.empty) {
        if (r.b.hijri) birth.hijri = r.b.hijri; else birth.date = r.b.date;
        if (r.b.approx) birth.approx = true;
      }
      if (!minor && side(birthPlace.value)) birth.place = side(birthPlace.value);
      if (Object.keys(birth).length) value.birth = birth;
      if (state.deceased) {
        value.deceased = true;
        const death = {};
        if (r.d && !r.d.empty) {
          if (r.d.hijri) death.hijri = r.d.hijri; else death.date = r.d.date;
          if (r.d.approx) death.approx = true;
        }
        if (side(deathPlace.value)) death.place = side(deathPlace.value);
        if (Object.keys(death).length) value.death = death;
      }
      if (!minor) {
        if (side(occupation.value)) value.occupation = side(occupation.value);
        if (side(bio.value)) value.bio = side(bio.value);
        if (r.photo) value.photo = r.photo;
      }
      value.privacy = state.deceased && !state.privTouched ? 'full' : state.privacy;
      return { ok: true, value, warnings: [] };
    }

    // edit: diff against the current values
    const cur = flatten(p);
    const next = { ...cur };
    next.nameStatus = r.ns;
    next['name.ar'] = r.name.ar;
    next['name.en'] = r.name.en;
    next['surname.ar'] = r.sur.ar;
    next['surname.en'] = r.sur.en;
    next['nickname.ar'] = r.nick.ar;
    next['nickname.en'] = r.nick.en;
    if (state.gender) next.gender = state.gender;
    next.deceased = state.deceased;
    next.privacy = state.privacy;

    const set = {};
    const put = (path) => { if (!same(next[path], cur[path])) set[path] = next[path]; };
    ['nameStatus', 'name.ar', 'name.en', 'surname.ar', 'surname.en', 'nickname.ar', 'nickname.en', 'gender', 'privacy'].forEach(put);
    // An English spelling stored equal to the automatic one stays (it is not a change).
    for (const k of ['name', 'surname', 'nickname']) {
      if (set[`${k}.en`] === '' && cur[`${k}.ar`] === next[`${k}.ar`] && cur[`${k}.en`] === transliterate(cur[`${k}.ar`], { kind: k === 'surname' ? 'surname' : 'given' })) delete set[`${k}.en`];
    }
    if (set.nameStatus && r.ns !== 'known') { set['name.ar'] = ''; set['name.en'] = ''; if (!cur['name.ar']) delete set['name.ar']; if (!cur['name.en']) delete set['name.en']; }

    dateDiff('birth', r.b, p.birth, set);
    if (state.deceased !== !!p.deceased) set.deceased = state.deceased;
    if (state.deceased && r.d) dateDiff('death', r.d, p.death, set);
    if (state.deceased && !same(trim(deathPlace.value), p.death.place?.[L] || '')) set[`death.place.${L}`] = trim(deathPlace.value);
    if (!minor) {
      if (!same(trim(birthPlace.value), p.birth.place?.[L] || '')) set[`birth.place.${L}`] = trim(birthPlace.value);
      if (!same(trim(occupation.value), p.occupation?.[L] || '')) set[`occupation.${L}`] = trim(occupation.value);
      if (!same(trim(bio.value), p.bio?.[L] || '')) set[`bio.${L}`] = trim(bio.value);
      if (photoInput && !same(r.photo, p.photo || '')) set.photo = r.photo;
    }
    const before = {};
    for (const path of Object.keys(set)) before[path] = getPath(p, path);
    return { ok: true, set, before, warnings: [] };
  }

  function peek() {
    return { ar: trim(nameBi.ar.value), en: trim(nameBi.en.value), nickname: nickBi.value(), gender: state.gender, nameStatus: state.nameStatus };
  }

  function focus() {
    if (state.nameStatus === 'known') nameBi.ar.focus();
    else if (!fixedGender && !state.gender) genderSeg.inputs[0].focus();
    else birthInput.focus();
  }

  return { el, validate, focus, peek };
}

// ---------------------------------------------------------------------------------------------------------
// helpers for the edit diff

function getPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur === null || cur === undefined) return '';
    cur = cur[k];
  }
  if (cur === undefined || cur === null) return typeof cur === 'boolean' ? false : '';
  return cur;
}

function flatten(p) {
  const out = {};
  for (const path of ['nameStatus', 'name.ar', 'name.en', 'surname.ar', 'surname.en', 'nickname.ar', 'nickname.en', 'gender', 'privacy']) {
    out[path] = getPath(p, path);
  }
  out.deceased = !!p.deceased;
  return out;
}

const same = (a, b) => (typeof a === 'boolean' || typeof b === 'boolean' ? !!a === !!b : String(a ?? '') === String(b ?? ''));

/** Add `${which}.date|hijri|approx` changes between a dateInput reading and the stored date object. */
function dateDiff(which, r, cur, set) {
  if (!r || r.error) return;
  const curDate = cur?.date || '';
  const curHijri = cur?.hijri || '';
  if (r.empty) {
    if (curDate || curHijri) { set[`${which}.date`] = ''; if (curHijri) set[`${which}.hijri`] = ''; }
    if (cur?.approx) set[`${which}.approx`] = false;
    return;
  }
  if (r.hijri) {
    if (r.hijri !== curHijri) set[`${which}.hijri`] = r.hijri;
  } else if (curHijri || r.date !== curDate) {
    set[`${which}.date`] = r.date;
  }
  if (!!r.approx !== !!cur?.approx) set[`${which}.approx`] = !!r.approx;
}
