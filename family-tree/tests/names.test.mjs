// Tests for js/core/names.js — display names, polite labels, lineage, normalisation, skeleton keys.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  personName, displayName, fullName, lineageName, setLineageStyle, getLineageStyle, initials,
  normalizeArabic, searchKey, skeletonKey, skeletonVariants, looksLikeFullName, splitFullName,
} from '../js/core/names.js';
import { buildGraph } from '../js/core/graph.js';

// ---------------------------------------------------------------------------------------------------------
// Local fixture helpers: full-shape people / unions (independent of schema.js).

const bi = (v) => ({ ar: v?.ar ?? '', en: v?.en ?? '' });
const dateObj = (d, withPlace = true) => {
  const o = { date: d?.date ?? '', hijri: d?.hijri ?? '', approx: !!d?.approx };
  if (withPlace) o.place = bi(d?.place);
  return o;
};

function fullPerson(c) {
  return {
    id: c.id,
    name: bi(c.name),
    nameStatus: c.nameStatus ?? 'known',
    surname: bi(c.surname),
    nickname: bi(c.nickname),
    gender: c.gender ?? '',
    birth: dateObj(c.birth),
    deceased: !!(c.deceased || c.death?.date || c.death?.hijri),
    death: dateObj(c.death),
    occupation: bi(c.occupation),
    bio: bi(c.bio),
    photo: c.photo ?? '',
    privacy: c.privacy ?? 'full',
    tags: [...(c.tags ?? [])],
    needsInfo: c.needsInfo ?? '',
    duplicateOf: c.duplicateOf ?? '',
    spouseOrder: [...(c.spouseOrder ?? [])],
    ties: (c.ties ?? []).map((t) => ({ type: t.type, person: t.person, note: bi(t.note) })),
    removed: c.removed ?? null,
    history: [...(c.history ?? [])],
  };
}

function fullUnion(c) {
  const partners = [...(c.partners ?? [])];
  return {
    id: c.id,
    partners,
    children: [...(c.children ?? [])],
    status: c.status ?? (partners.length === 2 ? 'married' : 'unknown'),
    marriage: dateObj(c.marriage),
    divorce: dateObj(c.divorce, false),
    note: bi(c.note),
    removed: c.removed ?? null,
  };
}

function fullData(compact) {
  const people = {};
  const unions = {};
  for (const [k, p] of Object.entries(compact.people || {})) people[k] = fullPerson(p);
  for (const [k, u] of Object.entries(compact.unions || {})) unions[k] = fullUnion(u);
  return { schema: 1, meta: { ...(compact.meta || {}) }, people, unions };
}

/** Tiny builder: P(id, ar, en, gender, extra) / U(id, partners, children, extra). */
function builder() {
  const people = {};
  const unions = {};
  return {
    P(id, ar, en, gender = '', extra = {}) { people[id] = fullPerson({ id, name: { ar, en }, gender, ...extra }); return id; },
    U(id, partners, children = [], extra = {}) { unions[id] = fullUnion({ id, partners, children, ...extra }); return id; },
    people,
    unions,
    data(meta = {}) { return { schema: 1, meta: { rootPersonId: '', revision: 1, ...meta }, people, unions }; },
  };
}

const realData = () => fullData(JSON.parse(readFileSync(fileURLToPath(new URL('../data/family.json', import.meta.url)), 'utf8')));

afterEach(() => setLineageStyle('plain'));

// ---------------------------------------------------------------------------------------------------------

describe('personName', () => {
  test('English: typed English, else automatic spelling of the Arabic; Arabic falls back to English', () => {
    const p = fullPerson({ id: 'pa1', name: { ar: 'أحمد', en: '' } });
    assert.equal(personName(p, 'ar'), 'أحمد');
    assert.equal(personName(p, 'en'), 'Ahmed');
    assert.equal(personName(fullPerson({ id: 'pa7', name: { ar: 'محمد', en: '' } }), 'en'), 'Muhammad');
    assert.equal(personName(fullPerson({ id: 'pa8', name: { ar: 'محمد', en: 'Mohamed' } }), 'en'), 'Mohamed');
    const q = fullPerson({ id: 'pa2', name: { ar: '', en: 'Ahmed' } });
    assert.equal(personName(q, 'ar'), 'Ahmed');
  });
  test('auto English everywhere a name is shown in English', () => {
    const p = fullPerson({ id: 'pa9', name: { ar: 'خديجة' }, nickname: { ar: 'بيبي' }, surname: { ar: 'آل غالب' } });
    assert.equal(displayName(p, 'en'), 'Khadija (Bibi)');
    assert.equal(fullName(p, 'en'), 'Khadija Al Ghalib (Bibi)');
    assert.equal(fullName(p, 'ar'), 'خديجة آل غالب (بيبي)');
    assert.equal(initials(p, 'en'), 'KG');
  });
  test('never shows a withheld or unknown name, even if present in data', () => {
    assert.equal(personName(fullPerson({ id: 'pa3', nameStatus: 'withheld', name: { ar: 'سرّ' } }), 'ar'), '');
    assert.equal(personName(fullPerson({ id: 'pa4', nameStatus: 'unknown' }), 'en'), '');
    assert.equal(personName(null, 'ar'), '');
  });
  test('works on compact people (missing fields)', () => {
    assert.equal(personName({ id: 'pa5', name: { ar: 'علي' } }, 'en'), 'Ali');
    assert.equal(displayName({ id: 'pa6' }, 'ar'), 'غير معروف');
  });
});

describe('displayName', () => {
  const b = builder();
  b.P('psalem', 'حسن', 'Hassan', 'm', { surname: { ar: 'عالم', en: 'Alam' } });
  b.P('pmoh', 'محمد', 'Mohammed', 'm');
  b.U('ubirth', ['psalem'], ['pmoh']);
  b.P('pwife', '', '', 'f', { nameStatus: 'unknown', surname: { ar: 'داغستاني', en: 'Daghestani' } });
  b.P('pwife2', '', '', 'f', { nameStatus: 'withheld' });
  b.P('pdw', '', '', 'f', { nameStatus: 'withheld' });
  b.P('pdu', '', '', 'f', { nameStatus: 'unknown' });
  b.P('psu', '', '', 'm', { nameStatus: 'unknown' });
  b.P('pxu', '', '', '', { nameStatus: 'unknown' });
  b.P('pknown', 'خديجة', 'Khadija', 'f', { nickname: { ar: 'بيبي', en: 'Bibi' }, surname: { ar: 'فتة', en: 'Fatta' } });
  b.U('umain', ['pmoh', 'pwife'], ['pdw', 'pdu', 'psu', 'pxu', 'pknown']);
  b.U('usecond', ['pmoh', 'pwife2']);
  // unknown husband of a named woman; unknown father of a named child
  b.P('pnora', 'نورة', 'Noura', 'f');
  b.P('phus', '', '', 'm', { nameStatus: 'unknown', surname: { ar: 'الحربي', en: 'Al-Harbi' } });
  b.U('unh', ['pnora', 'phus']);
  b.P('pdad', '', '', 'm', { nameStatus: 'withheld' });
  b.P('pson', 'سعد', 'Saad', 'm');
  b.U('udad', ['pdad'], ['pson']);
  // kunya-only father
  b.P('pabu', '', '', 'm', { nickname: { ar: 'أبو خالد', en: 'Abu Khalid' } });
  b.P('pkid', '', '', 'm', { nameStatus: 'unknown' });
  b.U('uabu', ['pabu'], ['pkid']);
  // unknown with a kunya-style nickname
  b.P('pumm', '', '', 'f', { nameStatus: 'withheld', nickname: { ar: 'أم خالد', en: 'Umm Khalid' }, surname: { ar: 'الحربي', en: 'Al-Harbi' } });
  const g = buildGraph(b.data());

  test('known: given name, "(nickname)" and kunya-only', () => {
    assert.equal(displayName(g.person('pmoh'), 'ar', g), 'محمد');
    assert.equal(displayName(g.person('pknown'), 'ar', g), 'خديجة (بيبي)');
    assert.equal(displayName(g.person('pknown'), 'en', g), 'Khadija (Bibi)');
    assert.equal(displayName(g.person('pabu'), 'ar', g), 'أبو خالد');
  });
  test('unknown / withheld wife: زوجة / حرم + surname', () => {
    assert.equal(displayName(g.person('pwife'), 'ar', g), 'زوجة محمد حسن عالم (داغستاني)');
    assert.equal(displayName(g.person('pwife'), 'en', g), 'Wife of Mohammed Hassan Alam (Daghestani)');
    assert.equal(displayName(g.person('pwife2'), 'ar', g), 'حرم محمد حسن عالم');
    assert.equal(displayName(g.person('pwife2'), 'en', g), 'Wife of Mohammed Hassan Alam');
  });
  test('children: ابنة / كريمة / ابن / أحد أبناء', () => {
    assert.equal(displayName(g.person('pdw'), 'ar', g), 'كريمة محمد حسن عالم');
    assert.equal(displayName(g.person('pdu'), 'ar', g), 'ابنة محمد حسن عالم');
    assert.equal(displayName(g.person('psu'), 'ar', g), 'ابن محمد حسن عالم');
    assert.equal(displayName(g.person('pxu'), 'ar', g), 'أحد أبناء محمد حسن عالم');
    assert.equal(displayName(g.person('pdu'), 'en', g), 'Daughter of Mohammed Hassan Alam');
    assert.equal(displayName(g.person('psu'), 'en', g), 'Son of Mohammed Hassan Alam');
    assert.equal(displayName(g.person('pxu'), 'en', g), 'Child of Mohammed Hassan Alam');
  });
  test('husband and parent labels, kunya in the genitive', () => {
    assert.equal(displayName(g.person('phus'), 'ar', g), 'زوج نورة (الحربي)');
    assert.equal(displayName(g.person('phus'), 'en', g), 'Husband of Noura (Al-Harbi)');
    assert.equal(displayName(g.person('pdad'), 'ar', g), 'والد سعد');
    assert.equal(displayName(g.person('pdad'), 'en', g), 'Father of Saad');
    assert.equal(displayName(g.person('pkid'), 'ar', g), 'ابن أبي خالد');
    assert.equal(displayName(g.person('pkid'), 'en', g), 'Son of Abi Khalid');
  });
  test('unknown with nickname shows the nickname + surname', () => {
    assert.equal(displayName(g.person('pumm'), 'ar', g), 'أم خالد الحربي');
    assert.equal(displayName(g.person('pumm'), 'en', g), 'Umm Khalid Al-Harbi');
  });
  test('without graph or relatives: غير معروف / Unknown (+ surname)', () => {
    const p = fullPerson({ id: 'px', nameStatus: 'unknown', gender: 'f' });
    assert.equal(displayName(p, 'ar'), 'غير معروف');
    assert.equal(displayName(p, 'en'), 'Unknown');
    assert.equal(displayName(g.person('pwife')), 'غير معروف (داغستاني)');
  });
  test('accepts an id when a graph is given', () => {
    assert.equal(displayName('pmoh', 'en', g), 'Mohammed');
  });
});

describe('fullName', () => {
  test('surname rendered verbatim, never adds آل / Al-', () => {
    assert.equal(fullName(fullPerson({ id: 'p1', name: { ar: 'زكية', en: 'Zakiya' }, surname: { ar: 'إسماعيل قربان', en: 'Ismail Qurban' } }), 'ar'), 'زكية إسماعيل قربان');
    assert.equal(fullName(fullPerson({ id: 'p2', name: { ar: 'محمد', en: 'Mohammed' }, surname: { ar: 'غالب', en: 'Ghalib' } }), 'en'), 'Mohammed Ghalib');
    assert.equal(fullName(fullPerson({ id: 'p3', name: { ar: 'محمد' }, surname: { ar: 'آل غالب' } }), 'ar'), 'محمد آل غالب');
  });
  test('nickname stays at the end; unknown names keep their label', () => {
    const p = fullPerson({ id: 'p4', name: { ar: 'سناء', en: 'Sanaa' }, nickname: { ar: 'كتبي', en: 'Kutbi' }, surname: { ar: 'عارف مرزوقي', en: 'Aref Marzouqi' } });
    assert.equal(fullName(p, 'ar'), 'سناء عارف مرزوقي (كتبي)');
    assert.equal(fullName(fullPerson({ id: 'p5', nameStatus: 'unknown', surname: { ar: 'عالم' } }), 'ar'), 'غير معروف (عالم)');
    assert.equal(fullName(null), '');
  });
});

describe('lineageName', () => {
  const b = builder();
  b.P('pg4', 'عالم', 'Alam', 'm', { surname: { ar: 'العالم', en: 'Al-Alam' } });
  b.P('pg3', 'سالم', 'Salem', 'm');
  b.P('pg2', 'حسن', 'Hassan', 'm');
  b.P('pg1', 'محمد', 'Mohammed', 'm');
  b.P('pg0', 'فاطمة', 'Fatima', 'f');
  b.P('pgm', 'مريم', 'Maryam', 'f');
  b.U('u4', ['pg4'], ['pg3']);
  b.U('u3', ['pg3'], ['pg2']);
  b.U('u2', ['pg2'], ['pg1']);
  b.U('u1', ['pg1', 'pgm'], ['pg0']);
  // kunya-only father
  b.P('pabu', '', '', 'm', { nickname: { ar: 'أبو خالد', en: 'Abu Khalid' }, surname: { ar: 'الحربي', en: 'Al-Harbi' } });
  b.P('pali', 'علي', 'Ali', 'm');
  b.U('uabu', ['pabu'], ['pali']);
  // unknown father with a surname: names stop, surname continues
  b.P('punk', '', '', 'm', { nameStatus: 'unknown', surname: { ar: 'عالم', en: 'Alam' } });
  b.P('pghazi', 'غازي', 'Ghazi', 'm');
  b.U('uunk', ['punk'], ['pghazi']);
  // mother only: never followed
  b.P('pmum', 'سلمى', 'Salma', 'f', { surname: { ar: 'قنديل', en: 'Qandil' } });
  b.P('pnoor', 'نور', 'Noor', 'f');
  b.U('umum', ['pmum'], ['pnoor']);
  // parent of unknown gender: not followed either
  b.P('pnog', 'سامي', 'Sami', '');
  b.P('psami2', 'رامي', 'Rami', 'm');
  b.U('unog', ['pnog'], ['psami2']);
  const g = buildGraph(b.data());

  test('plain style (default) with the first surname along the whole paternal chain', () => {
    assert.equal(lineageName(g, 'pg1', 'ar'), 'محمد حسن سالم العالم');
    assert.equal(lineageName(g, 'pg1', 'en'), 'Mohammed Hassan Salem Al-Alam');
    assert.equal(lineageName(g, 'pg0', 'ar', { depth: 2 }), 'فاطمة محمد العالم');
    assert.equal(lineageName(g, 'pg0', 'ar', { depth: 5 }), 'فاطمة محمد حسن سالم عالم العالم');
    assert.equal(lineageName(g, 'pg0', 'ar', { depth: 1 }), 'فاطمة العالم');
  });
  test('bin style: بن / بنت, bin / bint', () => {
    assert.equal(lineageName(g, 'pg1', 'ar', { style: 'bin' }), 'محمد بن حسن بن سالم العالم');
    assert.equal(lineageName(g, 'pg1', 'en', { style: 'bin' }), 'Mohammed bin Hassan bin Salem Al-Alam');
    assert.equal(lineageName(g, 'pg0', 'ar', { style: 'bin' }), 'فاطمة بنت محمد بن حسن العالم');
    assert.equal(lineageName(g, 'pg0', 'en', { style: 'bin' }), 'Fatima bint Mohammed bin Hassan Al-Alam');
  });
  test('kunya-only ancestor: genitive after بن', () => {
    assert.equal(lineageName(g, 'pali', 'ar', { style: 'bin' }), 'علي بن أبي خالد الحربي');
    assert.equal(lineageName(g, 'pali', 'ar', { style: 'plain' }), 'علي أبو خالد الحربي');
    assert.equal(lineageName(g, 'pali', 'en', { style: 'bin' }), 'Ali bin Abi Khalid Al-Harbi');
  });
  test('stops at an unknown father but still finds the surname', () => {
    assert.equal(lineageName(g, 'pghazi', 'ar'), 'غازي عالم');
    assert.equal(lineageName(g, 'pghazi', 'en', { style: 'bin' }), 'Ghazi Alam');
  });
  test('only a male father is followed', () => {
    assert.equal(lineageName(g, 'pnoor', 'ar'), 'نور');
    assert.equal(lineageName(g, 'psami2', 'ar'), 'رامي');
  });
  test('unknown person → display label', () => {
    assert.equal(lineageName(g, 'punk', 'ar'), 'والد غازي عالم');
    assert.equal(displayName(g.person('punk'), 'en', g), 'Father of Ghazi Alam');
    assert.equal(lineageName(g, 'nobody', 'ar'), '');
  });
  test('setLineageStyle changes the default; invalid values are ignored', () => {
    assert.equal(getLineageStyle(), 'plain');
    setLineageStyle('bin');
    assert.equal(lineageName(g, 'pg1', 'ar'), 'محمد بن حسن بن سالم العالم');
    setLineageStyle('fancy');
    assert.equal(getLineageStyle(), 'bin');
    assert.equal(lineageName(g, 'pg1', 'ar', { style: 'plain' }), 'محمد حسن سالم العالم');
    setLineageStyle('plain');
    assert.equal(lineageName(g, 'pg1', 'ar'), 'محمد حسن سالم العالم');
  });
  test('the real data: the spec example name', () => {
    const rg = buildGraph(realData());
    const moh = rg.people().find((p) => p.name.ar === 'محمد' && rg.father(p.id)?.name.ar === 'حسن' && rg.father(rg.father(p.id).id)?.name.ar === 'سالم');
    assert.ok(moh);
    assert.equal(lineageName(rg, moh.id, 'ar'), 'محمد حسن سالم عالم');
    // English is the automatic spelling (the owner chose "Muhammad" for محمد)
    assert.equal(lineageName(rg, moh.id, 'en'), 'Muhammad Hassan Salem Alam');
    assert.equal(lineageName(rg, moh.id, 'ar', { style: 'bin' }), 'محمد بن حسن بن سالم عالم');
    assert.equal(lineageName(rg, moh.id, 'en', { style: 'bin' }), 'Muhammad bin Hassan bin Salem Alam');
  });
  test('cycle-safe on bad data', () => {
    const c = builder();
    c.P('pa', 'أ', 'A', 'm');
    c.P('pb', 'ب', 'B', 'm');
    c.U('ux', ['pa'], ['pb']);
    c.U('uy', ['pb'], ['pa']);
    const cg = buildGraph(c.data());
    assert.equal(lineageName(cg, 'pa', 'ar', { depth: 10 }), 'أ ب');
  });
});

describe('initials', () => {
  test('Arabic: first letter; Latin: two letters', () => {
    assert.equal(initials(fullPerson({ id: 'p1', name: { ar: 'سُكَينة', en: 'Sukaina' } }), 'ar'), 'س');
    assert.equal(initials(fullPerson({ id: 'p2', name: { ar: 'محمد علي', en: 'Mohammed Ali' } }), 'en'), 'MA');
    assert.equal(initials(fullPerson({ id: 'p3', name: { ar: 'حسين', en: 'Hussein' }, surname: { en: 'Al-Rayyis', ar: 'الريس' } }), 'en'), 'HR');
    assert.equal(initials(fullPerson({ id: 'p4', name: { en: 'faiza' } }), 'en'), 'F');
    assert.equal(initials(fullPerson({ id: 'p5', nameStatus: 'unknown' }), 'ar'), '');
    assert.equal(initials(fullPerson({ id: 'p6', nickname: { ar: 'أبو خالد' } }), 'ar'), 'أ');
  });
});

describe('normalizeArabic', () => {
  test('tashkeel, tatweel, hamza forms, ta marbuta, alef maqsura', () => {
    assert.equal(normalizeArabic('أَحْمَد'), 'احمد');
    assert.equal(normalizeArabic('إبراهيم'), 'ابراهيم');
    assert.equal(normalizeArabic('آمنة'), 'امنه');
    assert.equal(normalizeArabic('ٱلله'), 'الله');
    assert.equal(normalizeArabic('مصطفى'), 'مصطفي');
    assert.equal(normalizeArabic('مؤمن'), 'مومن');
    assert.equal(normalizeArabic('هيئة'), 'هييه');
    assert.equal(normalizeArabic('محـــمد'), 'محمد');
    assert.equal(normalizeArabic('فاي‏زة'), 'فايزه');
  });
  test('compounds: عبد ال… and أبو …', () => {
    assert.equal(normalizeArabic('عبد الله'), normalizeArabic('عبدالله'));
    assert.equal(normalizeArabic('عبد الرحمن'), 'عبدالرحمن');
    assert.equal(normalizeArabic('أبو بكر'), normalizeArabic('ابوبكر'));
    assert.equal(normalizeArabic('  محمد   علي '), 'محمد علي');
    assert.equal(normalizeArabic(null), '');
  });
});

describe('searchKey', () => {
  test('lower-case, diacritics, digits, punctuation', () => {
    assert.equal(searchKey('  FAIZA '), 'faiza');
    assert.equal(searchKey('Émile'), 'emile');
    assert.equal(searchKey('١٩٥٠'), '1950');
    assert.equal(searchKey("Sa'ad"), 'saad');
    assert.equal(searchKey('فايزه'), searchKey('فايزة'));
    assert.equal(searchKey('إلهام'), searchKey('الهام'));
  });
  test('compound and article gluing', () => {
    assert.equal(searchKey('Al-Harbi'), 'alharbi');
    assert.equal(searchKey('al harbi'), 'alharbi');
    assert.equal(searchKey('Abdul Rahman'), 'abdulrahman');
    assert.equal(searchKey('Abd al-Rahman'), 'abdalrahman');
    assert.equal(searchKey('Abu Bakr'), 'abubakr');
    assert.equal(searchKey('عبد الرحمن'), searchKey('عبدالرحمن'));
    assert.equal(searchKey('عبد ربه'), 'عبدربه');
    assert.equal(searchKey('محمد بن أحمد'), 'محمد بن احمد');
  });
});

describe('skeletonKey', () => {
  test('required matches across scripts and spellings', () => {
    const same = [
      ['Mohamed', 'محمد'], ['Muhammad', 'محمد'], ['Mohammed', 'Muhammad'], ['مُحَمَّد', 'محمد'],
      ['abdulrahman', 'عبد الرحمن'], ['Abdul Rahman', 'عبدالرحمن'], ['Abd al-Rahman', 'عبد الرحمن'],
      ['alharbi', 'الحربي'], ['Al-Harbi', 'الحربي'], ['3li', 'علي'], ['Ali', 'علي'],
      ['Ahmed', 'أحمد'], ['Ibrahim', 'إبراهيم'], ['Ilham', 'إلهام'], ['Yousef', 'يوسف'], ['Walid', 'وليد'],
      ['Khadija', 'خديجة'], ['Aisha', 'عائشة'], ['Faiza', 'فايزه'], ['Abdullah', 'عبد الله'],
      ['Emad Al-Din', 'عماد الدين'], ['Qandil', 'قنديل'], ['Daghestani', 'داغستاني'], ['7assan', 'حسن'],
      ['5aled', 'خالد'], ['Ghazi', 'غازي'], ['Shadia', 'شادية'],
    ];
    for (const [a, b] of same) assert.equal(skeletonKey(a), skeletonKey(b), `${a} ≡ ${b}`);
    assert.notEqual(skeletonKey('محمد'), '');
  });
  test('no absurd collisions', () => {
    const differ = [
      ['محمد', 'أحمد'], ['Mohamed', 'Ahmed'], ['Ali', 'Layla'], ['علي', 'ليلى'], ['أحمد', 'حامد'],
      ['Khalid', 'Walid'], ['سالم', 'سلمان'], ['فاطمة', 'فايزة'], ['عصام', 'عماد'], ['يوسف', 'سيف'],
      ['Hassan', 'Ahsan'], ['عبد الله', 'عبد الرحمن'], ['Omar', 'Mohammed'],
    ];
    for (const [a, b] of differ) assert.notEqual(skeletonKey(a), skeletonKey(b), `${a} ≠ ${b}`);
  });
  test('variants cover ambiguous endings and articles', () => {
    const meets = (a, b) => skeletonVariants(a).some((k) => skeletonVariants(b).includes(k));
    assert.ok(meets('Saleh', 'صالح'));
    assert.ok(meets('Salah', 'صلاح'));
    assert.ok(meets('Fatimah', 'فاطمة'));
    assert.ok(meets('Sarah', 'سارة'));
    assert.ok(meets('Elham', 'إلهام'));
    assert.ok(meets('Alawiya', 'علوية'));
    assert.equal(skeletonKey(''), '');
    assert.deepEqual(skeletonVariants('  '), []);
  });
});

describe('looksLikeFullName / splitFullName', () => {
  test('detects full names', () => {
    for (const s of ['محمد حسن سالم عالم', 'محمد بن حسن', 'فاطمة بنت علي', 'Mohammed Ali Mahmoud', 'Ahmed bin Saeed', 'زكية إسماعيل قربان']) {
      assert.equal(looksLikeFullName(s), true, s);
    }
  });
  test('compound given names are one name', () => {
    for (const s of ['عبد الله', 'عبد الرحمن', 'عماد الدين', 'نور الهدى', 'أبو بكر', 'Abdul Rahman', 'Emad Al-Din', 'Emad Al Din', 'محمد علي', 'Salem', '']) {
      assert.equal(looksLikeFullName(s), false, s);
    }
    assert.equal(looksLikeFullName('عبد الرحمن محمد'), false);
    assert.equal(looksLikeFullName('عبد الرحمن محمد عالم'), true);
  });
  test('splits into given / father / family suggestions, keeping the original spelling', () => {
    assert.deepEqual(splitFullName('محمد حسن سالم عالم'), { given: 'محمد', father: 'حسن', family: 'عالم', grandfathers: ['سالم'] });
    assert.deepEqual(splitFullName('زكية إسماعيل قربان'), { given: 'زكية', father: 'إسماعيل', family: 'قربان', grandfathers: [] });
    assert.deepEqual(splitFullName('محمد بن حسن بن سالم'), { given: 'محمد', father: 'حسن', family: '', grandfathers: ['سالم'] });
    assert.deepEqual(splitFullName('عبد الله بن عمر'), { given: 'عبد الله', father: 'عمر', family: '', grandfathers: [] });
    assert.deepEqual(splitFullName('أحمد الحربي'), { given: 'أحمد', father: '', family: 'الحربي', grandfathers: [] });
    assert.deepEqual(splitFullName('Emad Al-Din Ali Ashour'), { given: 'Emad Al-Din', father: 'Ali', family: 'Ashour', grandfathers: [] });
    assert.deepEqual(splitFullName(''), { given: '', father: '', family: '', grandfathers: [] });
  });
});

describe('real data labels', () => {
  test('every unknown-name person gets a polite relational label', () => {
    const g = buildGraph(realData());
    const unknown = g.people().filter((p) => p.nameStatus === 'unknown');
    assert.equal(unknown.length, 4);
    for (const p of unknown) {
      for (const lang of ['ar', 'en']) {
        const d = displayName(p, lang, g);
        assert.ok(d && !d.startsWith('غير معروف') && !d.startsWith('Unknown'), `${p.id}: ${d}`);
      }
    }
    const dagh = unknown.find((p) => p.surname.ar === 'داغستاني');
    assert.equal(displayName(dagh, 'ar', g), 'زوجة محمد علي محمود (داغستاني)');
    assert.equal(displayName(dagh, 'en', g), 'Wife of Muhammad Ali Mahmoud (Daghestani)');
    const alem = unknown.find((p) => p.surname.ar === 'عالم');
    assert.equal(displayName(alem, 'ar', g), 'زوج علوية مراد (عالم)');
    const kids = unknown.filter((p) => !p.gender).map((p) => displayName(p, 'ar', g)).sort();
    assert.deepEqual(kids, ['أحد أبناء حسين أصغر', 'أحد أبناء علوية مراد']);
  });
});
