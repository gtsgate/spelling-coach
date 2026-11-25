// Tests for js/core/dates.js — partial dates, Umm al-Qura conversion, formatting (both languages), ages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toAsciiDigits, toArabicDigits, parseDate, canonicalDate, isValidDate, parseHijri, canonicalHijri, isValidHijri,
  hijriToGregorian, gregorianToHijri, compareDates, yearOf, dateSpan, dayNumber, fromDayNumber, addYearsToDay,
  truncateDate, formatDate, formatHijri, setDigits, getDigits, setMonthNames, getMonthNames, age, isMinor, yearsLabel,
  LEVANTINE_MONTHS, HIJRI_MONTHS,
} from '../js/core/dates.js';

/** Run fn with display settings, always restoring the defaults. */
function withSettings({ digits = 'latn', months = 'standard' }, fn) {
  setDigits(digits);
  setMonthNames(months);
  try { return fn(); } finally { setDigits('latn'); setMonthNames('standard'); }
}

test('dates.js is a pure module (no node:, DOM or fetch)', () => {
  const src = readFileSync(new URL('../js/core/dates.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /from\s+['"]node:/);
  assert.doesNotMatch(src, /\b(document|window|fetch|localStorage|require)\b/);
});

test('toAsciiDigits converts Arabic-Indic and Extended Arabic-Indic digits', () => {
  assert.equal(toAsciiDigits('١٩٥٠-٠٣-١٢'), '1950-03-12');
  assert.equal(toAsciiDigits('۱۳۷۰'), '1370');
  assert.equal(toAsciiDigits('عام ١٩٥٠ و 2010'), 'عام 1950 و 2010');
  assert.equal(toAsciiDigits(null), '');
  assert.equal(toAsciiDigits(undefined), '');
  assert.equal(toAsciiDigits(1950), '1950');
  assert.equal(toArabicDigits('12 مارس 1950'), '١٢ مارس ١٩٥٠');
});

test('parseDate: partial Gregorian dates, lenient input, real calendar days only', () => {
  assert.deepEqual(parseDate('1950'), { year: 1950, month: 0, day: 0, precision: 'year' });
  assert.deepEqual(parseDate('1950-03'), { year: 1950, month: 3, day: 0, precision: 'month' });
  assert.deepEqual(parseDate('1950-03-12'), { year: 1950, month: 3, day: 12, precision: 'day' });
  assert.deepEqual(parseDate('1950-3-5'), { year: 1950, month: 3, day: 5, precision: 'day' });
  assert.deepEqual(parseDate(' ١٩٥٠/٣/٥ '), { year: 1950, month: 3, day: 5, precision: 'day' });
  assert.equal(parseDate('2000-02-29').day, 29); // leap (divisible by 400)
  assert.equal(parseDate('1900-02-29'), null); // not leap
  assert.equal(parseDate('1950-02-30'), null);
  assert.equal(parseDate('1950-13'), null);
  assert.equal(parseDate('0'), null);
  assert.equal(parseDate('10000'), null);
  assert.equal(parseDate('12/03/1950'), null); // day-first is not accepted
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('abc'), null);
  assert.equal(parseDate(null), null);
  assert.equal(canonicalDate('622-7-19'), '0622-07-19');
  assert.equal(canonicalDate('nope'), null);
});

test('isValidDate accepts only canonical stored dates', () => {
  for (const ok of ['1950', '1950-03', '1950-03-12', '0622', '9999-12-31']) assert.ok(isValidDate(ok), ok);
  for (const bad of ['', '1950-3-5', '0000', '1950-02-30', '١٩٥٠', 1950, null, '1950-03-12T00:00']) {
    assert.equal(isValidDate(bad), false, String(bad));
  }
});

test('Hijri parsing/validation: year 1–1500, months 1–12, the day must exist', () => {
  assert.ok(isValidHijri('1445'));
  assert.ok(isValidHijri('1445-09'));
  assert.ok(isValidHijri('1445-09-01'));
  assert.ok(isValidHijri('1500-12-29'));
  assert.ok(isValidHijri('0001-01-01'));
  assert.equal(isValidHijri('1445-08-29'), true);
  assert.equal(isValidHijri('1445-08-30'), false, "Sha'ban 1445 has 29 days in Umm al-Qura");
  assert.equal(isValidHijri('1501'), false);
  assert.equal(isValidHijri('0000'), false);
  assert.equal(isValidHijri('1445-13'), false);
  assert.equal(isValidHijri('1445-9-1'), false, 'stored form must be canonical');
  assert.equal(isValidHijri(''), false);
  assert.deepEqual(parseHijri('١٤٤٥-٩-١'), { year: 1445, month: 9, day: 1, precision: 'day' });
  assert.equal(canonicalHijri('1370/5/12'), '1370-05-12');
  assert.equal(canonicalHijri('1445-08-30'), null);
});

test('hijriToGregorian matches known Umm al-Qura pairs', () => {
  assert.deepEqual(hijriToGregorian('1445-09-01'), { date: '2024-03-11', approx: false }); // 1 Ramadan 1445
  assert.deepEqual(hijriToGregorian('1446-01-01'), { date: '2024-07-07', approx: false }); // 1 Muharram 1446
  assert.deepEqual(hijriToGregorian('1448-06-15'), { date: '2026-11-25', approx: false }); // 15 Jumada al-Akhirah 1448
  assert.deepEqual(hijriToGregorian('1445-08-29'), { date: '2024-03-10', approx: false });
  assert.deepEqual(hijriToGregorian('1410-10-17'), { date: '1990-05-12', approx: false });
  assert.deepEqual(hijriToGregorian('١٤٤٥-٠٩-٠١'), { date: '2024-03-11', approx: false });
});

test('hijriToGregorian: year/month only → day 1 of that period, approx', () => {
  assert.deepEqual(hijriToGregorian('1445'), { date: '2023-07-19', approx: true });
  assert.deepEqual(hijriToGregorian('1445-09'), { date: '2024-03-11', approx: true });
  assert.deepEqual(hijriToGregorian('1370'), { date: '1950-10-13', approx: true });
  assert.equal(hijriToGregorian('1445-08-30'), null);
  assert.equal(hijriToGregorian('1600'), null);
  assert.equal(hijriToGregorian(''), null);
});

test('gregorianToHijri: exact for full dates, containing period for partial ones', () => {
  assert.deepEqual(gregorianToHijri('2024-03-11'), { hijri: '1445-09-01', approx: false });
  assert.deepEqual(gregorianToHijri('2026-11-25'), { hijri: '1448-06-15', approx: false });
  assert.deepEqual(gregorianToHijri({ date: '2024-07-07' }), { hijri: '1446-01-01', approx: false });
  assert.deepEqual(gregorianToHijri('1950'), { hijri: '1369', approx: true });
  assert.deepEqual(gregorianToHijri('2024-03'), { hijri: '1445-08', approx: true });
  assert.equal(gregorianToHijri('nope'), null);
});

test('Hijri ⇄ Gregorian round-trips every few days from 1900 to 2075', () => {
  for (let n = dayNumber(1900, 1, 1); n < dayNumber(2075, 1, 1); n += 11) {
    const g = fromDayNumber(n);
    const date = `${g.year}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`;
    const h = gregorianToHijri(date);
    assert.ok(h && isValidHijri(h.hijri), date);
    assert.equal(hijriToGregorian(h.hijri).date, date);
  }
});

test('day arithmetic helpers', () => {
  assert.equal(dayNumber(1970, 1, 1), 0);
  assert.deepEqual(fromDayNumber(dayNumber(2024, 2, 29)), { year: 2024, month: 2, day: 29 });
  assert.deepEqual(fromDayNumber(dayNumber(622, 7, 19)), { year: 622, month: 7, day: 19 });
  assert.deepEqual(fromDayNumber(addYearsToDay(dayNumber(2024, 2, 29), 1)), { year: 2025, month: 2, day: 28 });
  assert.equal(truncateDate('1950-03-12'), '1950');
  assert.equal(truncateDate('1950-03-12', 'month'), '1950-03');
  assert.equal(truncateDate('1370-05-12', 'year', 'hijri'), '1370');
  assert.equal(truncateDate('garbage'), 'garbage');
});

test('dateSpan covers the whole period; a Hijri year straddles two Gregorian years', () => {
  assert.deepEqual(dateSpan('1950'), { start: dayNumber(1950, 1, 1), end: dayNumber(1950, 12, 31) });
  assert.deepEqual(dateSpan('2024-02'), { start: dayNumber(2024, 2, 1), end: dayNumber(2024, 2, 29) });
  const h = dateSpan({ date: '1950-10-13', hijri: '1370', approx: true });
  assert.deepEqual(fromDayNumber(h.start), { year: 1950, month: 10, day: 13 });
  assert.equal(fromDayNumber(h.end).year, 1951);
  assert.equal(dateSpan(''), null);
  assert.equal(dateSpan({ date: '' }), null);
});

test('compareDates orders partial dates; unknown dates sort last', () => {
  assert.ok(compareDates('1950', '1951') < 0);
  assert.ok(compareDates('1950', '1950-03') < 0);
  assert.ok(compareDates('1950-03-12', '1950-03-02') > 0);
  assert.equal(compareDates('1950-03-12', { date: '1950-03-12' }), 0);
  assert.ok(compareDates('', '1950') > 0);
  assert.ok(compareDates('1950', '') < 0);
  assert.equal(compareDates('', ''), 0);
  const sorted = ['', '1990', '1950-05', '1950', '1960-01-02'].sort(compareDates);
  assert.deepEqual(sorted, ['1950', '1950-05', '1960-01-02', '1990', '']);
});

test('yearOf reads date strings and objects, falling back to Hijri', () => {
  assert.equal(yearOf('1950-03-12'), 1950);
  assert.equal(yearOf({ date: '0622' }), 622);
  assert.equal(yearOf({ date: '', hijri: '1370' }), 1950);
  assert.equal(yearOf({ date: '' }), null);
  assert.equal(yearOf(undefined), null);
});

test('formatDate — spec examples in both languages', () => {
  assert.equal(formatDate('1950-03-12', 'ar'), '12 مارس 1950');
  assert.equal(formatDate('1950-03-12', 'en'), '12 Mar 1950');
  assert.equal(formatDate({ date: '1950', approx: true }, 'ar'), 'حوالي 1950');
  assert.equal(formatDate({ date: '1950', approx: true }, 'en'), 'c. 1950');
  const hijriYear = { date: '1950-10-13', hijri: '1370', approx: true };
  assert.equal(formatDate(hijriYear, 'en'), '1370 AH (c. 1950–51)');
  assert.equal(formatDate(hijriYear, 'ar'), '1370 هـ (حوالي 1950–1951)');
});

test('formatDate — precisions, Hijri months and days, calendar option', () => {
  assert.equal(formatDate('1950-03', 'en'), 'Mar 1950');
  assert.equal(formatDate('1950-03', 'ar'), 'مارس 1950');
  assert.equal(formatDate('1950', 'ar'), '1950');
  assert.equal(formatDate('1950-03-12', 'en', { precision: 'year' }), '1950');
  assert.equal(formatDate('1950-03-12', 'en', { precision: 'hidden' }), '');
  assert.equal(formatDate('1950-03-12', 'en', { approx: true }), 'c. 12 Mar 1950');
  assert.equal(formatDate({ hijri: '1370-05-12' }, 'en'), '12 Jumada al-Ula 1370 AH (19 Feb 1951)');
  assert.equal(formatDate({ hijri: '1370-05-12' }, 'ar'), '12 جمادى الأولى 1370 هـ (19 فبراير 1951)');
  assert.equal(formatDate({ hijri: '1370-05' }, 'en'), 'Jumada al-Ula 1370 AH (c. Feb–Mar 1951)');
  assert.equal(formatDate({ hijri: '1445-09-01' }, 'ar', { precision: 'year' }), '1445 هـ (حوالي 2023–2024)');
  assert.equal(formatDate('2024-03-11', 'en', { hijri: '1445-09-01' }), '1 Ramadan 1445 AH (11 Mar 2024)');
  assert.equal(formatDate('1950-03-12', 'en', { calendar: 'hijri' }), '12 Mar 1950 (23 Jumada al-Ula 1369 AH)');
  assert.equal(formatDate('1950', 'ar', { calendar: 'hijri' }), '1950 (1369–1370 هـ)');
  assert.equal(formatDate('', 'en'), '');
  assert.equal(formatDate(null, 'ar'), '');
  assert.equal(formatDate('not a date', 'en'), 'not a date');
  assert.equal(formatHijri('1445-09-01', 'ar'), '1 رمضان 1445 هـ');
  assert.equal(formatHijri('bad', 'ar'), '');
  assert.equal(HIJRI_MONTHS.ar.length, 12);
  assert.equal(HIJRI_MONTHS.en.length, 12);
});

test('formatDate honours Arabic digits and Levantine month names (Arabic only)', () => {
  withSettings({ digits: 'arab' }, () => {
    assert.equal(getDigits(), 'arab');
    assert.equal(formatDate('1950-03-12', 'ar'), '١٢ مارس ١٩٥٠');
    assert.equal(formatDate({ hijri: '1370' }, 'ar'), '١٣٧٠ هـ (حوالي ١٩٥٠–١٩٥١)');
    assert.equal(formatDate('1950-03-12', 'en'), '12 Mar 1950', 'English keeps Western digits');
  });
  withSettings({ months: 'levantine' }, () => {
    assert.equal(getMonthNames(), 'levantine');
    assert.equal(formatDate('1950-03-12', 'ar'), '12 آذار 1950');
    assert.equal(formatDate('1950-01', 'ar'), 'كانون الثاني 1950');
    assert.equal(formatDate({ hijri: '1370-05' }, 'ar'), 'جمادى الأولى 1370 هـ (حوالي شباط–آذار 1951)');
    assert.equal(formatDate('1950-03-12', 'en'), '12 Mar 1950');
  });
  assert.equal(LEVANTINE_MONTHS.length, 12);
  assert.equal(setMonthNames('bogus'), 'standard');
  assert.equal(setDigits('bogus'), 'latn');
  assert.equal(formatDate('1950-03-12', 'ar'), '12 مارس 1950', 'settings restored');
});

test('age: completed years, lower bound for partial dates', () => {
  assert.equal(age('1990-05-01', null, '2026-11-25'), 36);
  assert.equal(age('1990-12-01', null, '2026-11-25'), 35);
  assert.equal(age('2008', null, '2026-11-25'), 17, 'could be born 31 Dec 2008');
  assert.equal(age({ date: '1950-03-12' }, { date: '2010-03-11' }), 59);
  assert.equal(age({ date: '1950' }, { date: '2010' }), 59);
  assert.equal(age('1990', { date: '' }), null, 'death date unknown');
  assert.equal(age('', null, '2026-11-25'), null);
  assert.equal(age('2026-11-25', null, '2026-11-25'), 0);
  assert.equal(age('2027', null, '2026-11-25'), null);
  assert.equal(age('1990-05-01', '', new Date(2026, 10, 25)), 36);
  // Hijri year 1430 runs Dec 2008 – Dec 2009: the latest possible birth is used.
  assert.equal(age({ date: '2008-12-29', hijri: '1430', approx: true }, null, '2026-11-25'), 16);
});

test('isMinor: living people possibly under 18', () => {
  const today = '2026-11-25';
  assert.equal(isMinor({ birth: { date: '2010' } }, today), true);
  assert.equal(isMinor({ birth: { date: '2000-01-01' } }, today), false);
  assert.equal(isMinor({ birth: { date: '2008' } }, today), true, 'conservative for year-only dates');
  assert.equal(isMinor({ birth: { date: '2008-11-24' } }, today), false);
  assert.equal(isMinor({ birth: { date: '2015' }, deceased: true }, today), false);
  assert.equal(isMinor({ birth: { date: '' } }, today), false);
  assert.equal(isMinor({}, today), false);
  assert.equal(isMinor(null, today), false);
});

test('yearsLabel: compact life years, both languages, never a cross', () => {
  const dead = { deceased: true, birth: { date: '1950-03-12' }, death: { date: '2010' } };
  assert.equal(yearsLabel(dead, 'en'), '1950–2010');
  assert.equal(yearsLabel(dead, 'ar'), '1950–2010');
  assert.equal(yearsLabel({ birth: { date: '1990' } }, 'en'), 'b. 1990');
  assert.equal(yearsLabel({ birth: { date: '1990' } }, 'ar'), 'م 1990');
  assert.equal(yearsLabel({ deceased: true, death: { date: '2010' } }, 'en'), 'd. 2010');
  assert.equal(yearsLabel({ deceased: true, death: { date: '2010' } }, 'ar'), 'ت 2010');
  assert.equal(yearsLabel({ deceased: true, birth: { date: '1950' } }, 'en'), '1950–?');
  assert.equal(yearsLabel({ deceased: true, birth: { date: '1950' } }, 'ar'), '1950–؟');
  assert.equal(yearsLabel({ birth: { date: '1990', approx: true } }, 'en'), 'b. c. 1990');
  assert.equal(yearsLabel({ birth: { date: '1990', approx: true } }, 'ar'), 'م حوالي 1990');
  assert.equal(yearsLabel({ birth: { date: '1990' }, privacy: 'hidden' }, 'en'), '');
  assert.equal(yearsLabel({ deceased: true }, 'en'), '');
  assert.equal(yearsLabel({}, 'ar'), '');
  assert.equal(yearsLabel(null, 'ar'), '');
  withSettings({ digits: 'arab' }, () => assert.equal(yearsLabel(dead, 'ar'), '١٩٥٠–٢٠١٠'));
  for (const p of [dead, { deceased: true }, { deceased: true, death: { date: '2010' } }]) {
    for (const lang of ['ar', 'en']) assert.doesNotMatch(yearsLabel(p, lang), /[†✝✞✟]/);
  }
});
