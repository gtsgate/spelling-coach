// Tests for js/core/schema.js — data model, normalize ⇄ compact, serialization, invariants and warnings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCHEMA_VERSION, GENDERS, PRIVACY, NAME_STATUSES, UNION_STATUSES, TAGS, MARKS, TIE_TYPES, REASON_CODES, DESTRUCTIVE_OPS,
  OP_TYPES, PERSON_INPUT_FIELDS, PERSON_EDIT_PATHS, UNION_EDIT_PATHS, PERSON_FIELDS, UNION_FIELDS, LIMITS,
  isPersonId, isUnionId, isTempPersonRef, isTempUnionRef, isPreviewUnionId, isPersonRef, isUnionRef,
  newProposalId, randomId, randomBase36,
  emptyPerson, emptyUnion, normalizePerson, normalizeUnion, normalizeData, compactPerson, compactUnion, compactData,
  applyPersonSet, applyUnionSet, emptyData, serializeData, validateData,
  SCHEMA_ISSUE_CODES, SCHEMA_ERROR_CODES, SCHEMA_WARNING_CODES,
} from '../js/core/schema.js';

const DATA_FILE = new URL('../data/family.json', import.meta.url);

// ---------------------------------------------------------------------------------------------------------
// Fixtures & helpers

/** A small valid family (compact stored form): grandparents → two children; the son married with one child. */
function fixture() {
  return {
    schema: 1,
    meta: { title: { ar: 'شجرة العائلة', en: 'Family Tree' }, rootPersonId: 'p0001', revision: 3, updatedAt: '2026-01-01T00:00:00Z' },
    people: {
      p0001: { id: 'p0001', name: { ar: 'سالم', en: 'Salem' }, gender: 'm', birth: { date: '1900' }, deceased: true, death: { date: '1970' } },
      p0002: { id: 'p0002', name: { ar: 'فاطمة', en: 'Fatima' }, gender: 'f', birth: { date: '1905' }, deceased: true },
      p0003: { id: 'p0003', name: { ar: 'حسن', en: 'Hassan' }, gender: 'm', birth: { date: '1930' } },
      p0004: { id: 'p0004', name: { ar: 'عائشة', en: 'Aisha' }, gender: 'f', birth: { date: '1932' } },
      p0005: { id: 'p0005', name: { ar: 'زينب', en: 'Zainab' }, gender: 'f' },
      p0006: { id: 'p0006', name: { ar: 'محمد', en: 'Mohammed' }, gender: 'm', birth: { date: '1960' } },
    },
    unions: {
      u0001: { id: 'u0001', partners: ['p0001', 'p0002'], children: ['p0003', 'p0004'], status: 'married' },
      u0002: { id: 'u0002', partners: ['p0003', 'p0005'], children: ['p0006'], status: 'married' },
    },
  };
}

/** Fixture after `mutate(d)`. */
function variant(mutate) {
  const d = fixture();
  mutate(d);
  return d;
}

const addPerson = (d, id, extra = {}) => { d.people[id] = { id, name: { ar: 'خالد', en: 'Khalid' }, gender: 'm', ...extra }; };
const addUnion = (d, id, partners, children = [], extra = {}) => { d.unions[id] = { id, partners, children, ...extra }; };
const removal = (extra = {}) => ({ at: '2026-01-02T00:00:00Z', reasonCode: 'entered-by-mistake', issue: 7, by: 'owner', ...extra });

const emitted = new Set();
const codes = (list) => list.map((i) => i.code);

/** Assert that validating `data` yields error `code`; returns that issue. */
function expectError(data, code, opts) {
  const r = validateData(data, opts);
  codes(r.errors).forEach((c) => emitted.add(c));
  codes(r.warnings).forEach((c) => emitted.add(c));
  const found = r.errors.find((e) => e.code === code);
  assert.ok(found, `expected error ${code}, got ${JSON.stringify(r.errors)}`);
  assert.equal(r.ok, false);
  return found;
}

/** Assert that validating `data` yields warning `code` (and no errors); returns that issue. */
function expectWarning(data, code, opts) {
  const r = validateData(data, opts);
  codes(r.errors).forEach((c) => emitted.add(c));
  codes(r.warnings).forEach((c) => emitted.add(c));
  assert.deepEqual(r.errors, [], `unexpected errors while expecting ${code}`);
  const found = r.warnings.find((w) => w.code === code);
  assert.ok(found, `expected warning ${code}, got ${JSON.stringify(r.warnings)}`);
  return found;
}

function expectNo(data, code, opts) {
  const r = validateData(data, opts);
  assert.ok(![...r.errors, ...r.warnings].some((i) => i.code === code), `did not expect ${code}: ${JSON.stringify([...r.errors, ...r.warnings])}`);
  return r;
}

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ---------------------------------------------------------------------------------------------------------
// Module shape & constants

test('schema.js is a pure module (no node:, DOM or fetch)', () => {
  const src = readFileSync(new URL('../js/core/schema.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /from\s+['"]node:/);
  assert.doesNotMatch(src, /\b(document|window|fetch|localStorage|require)\b/);
});

test('constants match the spec', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual([...GENDERS], ['m', 'f', '']);
  assert.deepEqual([...PRIVACY], ['full', 'year', 'hidden']);
  assert.deepEqual([...NAME_STATUSES], ['known', 'unknown', 'withheld']);
  assert.deepEqual([...UNION_STATUSES], ['married', 'divorced', 'widowed', 'unknown']);
  assert.deepEqual([...TAGS], ['verified', 'needs-info']);
  assert.deepEqual([...TIE_TYPES], ['milk-child-of', 'foster-child-of']);
  assert.deepEqual([...REASON_CODES], ['duplicate', 'entered-by-mistake', 'wrong-parents', 'person-requested', 'other']);
  assert.deepEqual([...DESTRUCTIVE_OPS], ['remove-person', 'unlink-spouse', 'detach-person', 'remove-tie', 'merge-person']);
  assert.equal(MARKS.length, 9);
  for (const m of ['deceased', 'living', 'verified', 'unverified', 'needs-info', 'info-complete', 'duplicate', 'not-duplicate', 'private']) {
    assert.ok(MARKS.includes(m), m);
  }
  assert.equal(OP_TYPES.length, 16);
  assert.equal(PERSON_INPUT_FIELDS.length, 13);
  assert.equal(PERSON_EDIT_PATHS.length, 25);
  assert.ok(PERSON_EDIT_PATHS.includes('birth.place.ar') && PERSON_EDIT_PATHS.includes('privacy'));
  assert.equal(UNION_EDIT_PATHS.length, 11);
  assert.ok(!UNION_EDIT_PATHS.includes('divorce.place.ar'), 'divorce has no place');
  assert.equal(LIMITS.ops, 150);
  assert.equal(LIMITS.name, 100);
  assert.equal(LIMITS.surname, 200);
  assert.equal(LIMITS.bio, 4000);
  assert.equal(LIMITS.needsInfo, 300);
  assert.equal(LIMITS.unionNote, 500);
  assert.equal(LIMITS.code, 60000);
  assert.equal(LIMITS.destructive, 3);
  assert.equal(LIMITS.merges, 30);
  assert.equal(LIMITS.history, 20);
  assert.ok(Object.isFrozen(LIMITS) && Object.isFrozen(MARKS) && Object.isFrozen(PERSON_EDIT_PATHS));
});

test('issue code lists: UPPER_SNAKE, unique, errors + warnings', () => {
  assert.equal(new Set(SCHEMA_ISSUE_CODES).size, SCHEMA_ISSUE_CODES.length);
  for (const c of SCHEMA_ISSUE_CODES) assert.match(c, /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/);
  assert.deepEqual([...SCHEMA_ISSUE_CODES], [...SCHEMA_ERROR_CODES, ...SCHEMA_WARNING_CODES]);
  for (const c of ['NAME_SHOULD_BE_EMPTY', 'NAME_REQUIRED', 'DUPLICATE_UNION', 'ANCESTOR_LINK', 'CYCLE', 'PRIVATE_DATE_STORED']) {
    assert.ok(SCHEMA_ERROR_CODES.includes(c), c);
  }
  for (const c of ['SAME_GENDER_PARTNERS', 'PARENT_GENDER_UNKNOWN', 'MARRIAGE_BEFORE_12', 'MARRIAGE_AFTER_DEATH',
    'WIDOWED_BUT_LIVING', 'CONCURRENT_HUSBANDS', 'DIVORCE_DATE_WITHOUT_STATUS']) {
    assert.ok(SCHEMA_WARNING_CODES.includes(c), c);
  }
});

test('id and ref predicates', () => {
  assert.ok(isPersonId('pa1b2c3d') && isPersonId('p123') && !isPersonId('p12') && !isPersonId('P123') && !isPersonId('u123'));
  assert.ok(!isPersonId('p' + 'a'.repeat(25)) && isPersonId('p' + 'a'.repeat(24)));
  assert.ok(isUnionId('ux9y8z7w') && !isUnionId('newu1') && !isUnionId('pabc'));
  assert.ok(isTempPersonRef('new1') && isTempPersonRef('new42') && !isTempPersonRef('newu1') && !isTempPersonRef('new'));
  assert.ok(isTempUnionRef('newu7') && !isTempUnionRef('new7') && !isTempUnionRef('tmpu1'));
  assert.ok(isPreviewUnionId('tmpu3') && !isPreviewUnionId('newu3'));
  assert.ok(isPersonRef('new3') && isPersonRef('pabcd') && !isPersonRef('newu3'));
  assert.ok(isUnionRef('newu3') && isUnionRef('uabcd') && !isUnionRef('tmpu3'));
  for (const v of [null, undefined, 5, {}]) assert.ok(!isPersonId(v) && !isUnionId(v) && !isTempPersonRef(v) && !isTempUnionRef(v));
});

test('newProposalId: 10 random base36 chars; randomId avoids taken ids', () => {
  const ids = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = newProposalId();
    assert.match(id, /^[0-9a-z]{10}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 2000);
  assert.match(randomBase36(7), /^[0-9a-z]{7}$/);
  const pid = randomId('p');
  assert.ok(isPersonId(pid) && pid.length === 8);
  assert.ok(isUnionId(randomId('u', new Set())));
  let calls = 0;
  const id = randomId('p', () => ++calls < 3); // first two candidates "taken"
  assert.equal(calls, 3);
  assert.ok(isPersonId(id));
  assert.ok(!Object.hasOwn({ a: 1 }, randomId('p', { a: 1 })));
});

// ---------------------------------------------------------------------------------------------------------
// Normalize / compact

test('emptyPerson / normalizePerson: full shape in spec key order', () => {
  const e = emptyPerson('pabc1');
  assert.deepEqual(Object.keys(e), [...PERSON_FIELDS]);
  assert.deepEqual(normalizePerson({ id: 'pabc1' }), e);
  assert.equal(e.privacy, 'full', 'a missing privacy means "full"');
  assert.deepEqual(e.birth, { date: '', hijri: '', approx: false, place: { ar: '', en: '' } });
  assert.deepEqual(Object.keys(emptyUnion('uabc1')), [...UNION_FIELDS]);
  assert.deepEqual(normalizeUnion({ id: 'uabc1' }), emptyUnion('uabc1'));
  assert.deepEqual(emptyUnion().divorce, { date: '', hijri: '', approx: false });
});

test('normalizePerson never mutates input and tolerates garbage', () => {
  const input = deepFreeze({
    id: ' pabc1 ', name: 'أحمد', surname: 'Alem', gender: 'M', tags: ['verified', 'verified', 5, ''], ties: { x: 1 },
    history: 'nope', spouseOrder: ['u1', 'u1'], birth: 1950, removed: false, unknownKey: 1,
  });
  const p = normalizePerson(input);
  assert.equal(p.id, 'pabc1');
  assert.deepEqual(p.name, { ar: 'أحمد', en: '' }, 'bare Arabic string → ar');
  assert.deepEqual(p.surname, { ar: '', en: 'Alem' }, 'bare Latin string → en');
  assert.equal(p.gender, 'm');
  assert.deepEqual(p.tags, ['verified']);
  assert.deepEqual(p.ties, []);
  assert.deepEqual(p.history, []);
  assert.deepEqual(p.spouseOrder, ['u1']);
  assert.equal(p.birth.date, '1950');
  assert.equal(p.removed, null);
  assert.ok(!('unknownKey' in p));
  assert.deepEqual(normalizePerson(null), emptyPerson(''));
  // invalid strings are kept so validateData can report them
  assert.equal(normalizePerson({ id: 'pabc1', gender: 'x' }).gender, 'x');
  assert.equal(normalizePerson({ id: 'pabc1', birth: { date: '1950-02-30' } }).birth.date, '1950-02-30');
});

test('normalizePerson canonicalizes dates (Arabic digits, padding) and trims text', () => {
  const p = normalizePerson({ id: 'pabc1', name: { ar: '  أحمد ' }, birth: { date: '١٩٥٠-٣-٥', place: { ar: ' مكة ' } } });
  assert.equal(p.name.ar, 'أحمد');
  assert.equal(p.birth.date, '1950-03-05');
  assert.equal(p.birth.place.ar, 'مكة');
});

test('privacy truncation is enforced in normalizePerson', () => {
  const year = normalizePerson({ id: 'pabc1', privacy: 'year', birth: { date: '1990-05-12', place: { ar: 'جدة' } } });
  assert.deepEqual(year.birth, { date: '1990', hijri: '', approx: false, place: { ar: 'جدة', en: '' } });
  const hidden = normalizePerson({ id: 'pabc1', privacy: 'hidden', birth: { date: '1990-05-12', hijri: '1410-10-17', approx: true } });
  assert.deepEqual(hidden.birth, { date: '', hijri: '', approx: false, place: { ar: '', en: '' } });
  // Hijri birth date under "year": both stored as years; the Gregorian year is the true one (1410-10-17 = 1990-05-12)
  const h = normalizePerson({ id: 'pabc1', privacy: 'year', birth: { hijri: '1410-10-17' } });
  assert.deepEqual([h.birth.date, h.birth.hijri, h.birth.approx], ['1990', '1410', true]);
  assert.deepEqual(normalizePerson(compactPerson(h)).birth, h.birth, 'stable on re-normalization');
  // Hijri year only → Gregorian year of 1 Muharram (1410 starts 1989-08-03)
  assert.equal(normalizePerson({ id: 'pabc1', privacy: 'year', birth: { hijri: '1410' } }).birth.date, '1989');
  // death dates are never truncated by birth privacy
  const d = normalizePerson({ id: 'pabc1', privacy: 'hidden', death: { date: '2001-02-03' } });
  assert.equal(d.death.date, '2001-02-03');
  // the result always satisfies invariant 11
  const data = variant((x) => { x.people.p0006.privacy = 'year'; x.people.p0006.birth = { date: '1960-04-04', hijri: '1379-10-07' }; });
  assert.ok(!validateData(data).ok);
  assert.ok(validateData(normalizeData(data)).ok);
});

test('hijri → Gregorian derivation in normalize (birth, death, marriage, divorce)', () => {
  const p = normalizePerson({ id: 'pabc1', birth: { hijri: '1445-09-01' }, death: { hijri: '1446-01-01' } });
  assert.deepEqual([p.birth.date, p.birth.approx], ['2024-03-11', false]);
  assert.equal(p.deceased, true, 'death date ⇒ deceased');
  assert.equal(p.death.date, '2024-07-07');
  const y = normalizePerson({ id: 'pabc1', birth: { hijri: '1370', date: '1999-01-01' } });
  assert.deepEqual([y.birth.date, y.birth.approx], ['1950-10-13', true], 'hijri wins; year only → day 1, approx');
  const m = normalizePerson({ id: 'pabc1', birth: { hijri: '1445-09' } });
  assert.deepEqual([m.birth.date, m.birth.approx], ['2024-03-11', true]);
  const arabicDigits = normalizePerson({ id: 'pabc1', birth: { hijri: '١٤٤٨/٦/١٥' } });
  assert.deepEqual([arabicDigits.birth.hijri, arabicDigits.birth.date], ['1448-06-15', '2026-11-25']);
  const u = normalizeUnion({ id: 'uabc1', partners: [], marriage: { hijri: '1446-01-01' }, divorce: { hijri: '1448-06' } });
  assert.equal(u.marriage.date, '2024-07-07');
  assert.deepEqual([u.divorce.date, u.divorce.approx], [normalizeUnion({ divorce: { hijri: '1448-06-01' } }).divorce.date, true]);
  // invalid hijri: left alone for validateData to report
  const bad = normalizePerson({ id: 'pabc1', birth: { hijri: '1445-08-30', date: '2024-03-10' } });
  assert.deepEqual([bad.birth.hijri, bad.birth.date], ['1445-08-30', '2024-03-10']);
});

test('death ⇒ deceased; explicit deceased:false clears death', () => {
  assert.equal(normalizePerson({ id: 'pabc1', death: { date: '1990' } }).deceased, true);
  assert.equal(normalizePerson({ id: 'pabc1', deceased: true }).deceased, true);
  const alive = normalizePerson({ id: 'pabc1', deceased: false, death: { date: '1990', place: { ar: 'مكة' } } });
  assert.equal(alive.deceased, false);
  assert.deepEqual(alive.death, emptyPerson().death);
  // living (deceased missing) with only a death place: cleared — a living person has no death data
  assert.deepEqual(normalizePerson({ id: 'pabc1', death: { place: { en: 'X' } } }).death, emptyPerson().death);
  // deceased without a known date keeps its place
  assert.equal(normalizePerson({ id: 'pabc1', deceased: true, death: { place: { ar: 'مكة' } } }).death.place.ar, 'مكة');
});

test('history is capped to the newest 20 entries; records keep extras', () => {
  const history = Array.from({ length: 25 }, (_, i) => ({ issue: i, rev: i, at: `t${i}`, action: 'edit-person', extra: { n: i } }));
  const p = normalizePerson({
    id: 'pabc1', history,
    removed: { at: 't', reasonCode: 'duplicate', issue: null, by: 'x', mergedInto: 'pabc2', merge: { unions: ['u1'] }, custom: 1 },
  });
  assert.equal(p.history.length, 20);
  assert.equal(p.history[0].issue, 5);
  assert.deepEqual(p.history[19], { issue: 24, rev: 24, at: 't24', action: 'edit-person', extra: { n: 24 } });
  assert.deepEqual(Object.keys(p.removed), ['at', 'reasonCode', 'issue', 'by', 'mergedInto', 'merge', 'custom']);
  assert.equal(p.removed.issue, null);
});

test('compactPerson drops every default and keeps key order', () => {
  assert.deepEqual(compactPerson(emptyPerson('pabc1')), { id: 'pabc1' });
  const full = {
    history: [{ issue: null, at: 'T', action: 'import' }],
    removed: null,
    ties: [{ type: 'milk-child-of', person: 'pabc2', note: { ar: '', en: '' } }],
    spouseOrder: ['uabc1'],
    duplicateOf: '',
    needsInfo: 'سنة الميلاد',
    tags: ['needs-info'],
    privacy: 'year',
    photo: 'photos/pabc1.jpg',
    bio: { ar: 'نبذة', en: '' },
    occupation: { ar: '', en: '' },
    death: { date: '', hijri: '', approx: false, place: { ar: '', en: '' } },
    deceased: false,
    birth: { date: '1990', hijri: '', approx: true, place: { ar: '', en: 'Jeddah' } },
    gender: 'f',
    nickname: { ar: 'أم خالد', en: '' },
    surname: { ar: '', en: '' },
    nameStatus: 'withheld',
    name: { ar: '', en: '' },
    id: 'pabc1',
  };
  const c = compactPerson(full);
  assert.deepEqual(c, {
    id: 'pabc1',
    nameStatus: 'withheld',
    nickname: { ar: 'أم خالد' },
    gender: 'f',
    birth: { date: '1990', approx: true, place: { en: 'Jeddah' } },
    bio: { ar: 'نبذة' },
    photo: 'photos/pabc1.jpg',
    privacy: 'year',
    tags: ['needs-info'],
    needsInfo: 'سنة الميلاد',
    spouseOrder: ['uabc1'],
    ties: [{ type: 'milk-child-of', person: 'pabc2' }],
    history: [{ issue: null, at: 'T', action: 'import' }],
  });
  assert.deepEqual(Object.keys(c), PERSON_FIELDS.filter((k) => k in c), 'key order = spec order');
  assert.deepEqual(normalizePerson(c), normalizePerson(full));
  assert.equal(compactPerson({ id: 'pabc1', privacy: 'full' }).privacy, undefined);
  assert.equal(compactPerson({ id: 'pabc1', nameStatus: 'known', name: { ar: 'علي' } }).nameStatus, undefined);
  assert.equal(compactPerson({ id: 'pabc1', deceased: true }).deceased, true);
});

test('compactUnion drops empty fields and status "unknown"', () => {
  assert.deepEqual(compactUnion(emptyUnion('uabc1')), { id: 'uabc1', partners: [] });
  const u = compactUnion({
    note: { ar: '', en: 'remarried in 1980' }, status: 'divorced', children: ['pabc3'], partners: ['pabc1', 'pabc2'], id: 'uabc1',
    marriage: { date: '1970', place: { ar: 'مكة' } }, divorce: { date: '1975' }, removed: null,
  });
  assert.deepEqual(u, {
    id: 'uabc1', partners: ['pabc1', 'pabc2'], children: ['pabc3'], status: 'divorced',
    marriage: { date: '1970', place: { ar: 'مكة' } }, divorce: { date: '1975' }, note: { en: 'remarried in 1980' },
  });
  assert.deepEqual(Object.keys(u), UNION_FIELDS.filter((k) => k in u));
  assert.equal(normalizeUnion({ partners: ['pabc1'] }).status, 'unknown');
});

test('applyPersonSet: setting semantics of §2.1', () => {
  const base = normalizePerson({ id: 'pabc1', name: { ar: 'علي' }, birth: { hijri: '1410-10-17' } });
  const byDate = applyPersonSet(base, { 'birth.date': '1990-06-01' });
  assert.deepEqual([byDate.birth.date, byDate.birth.hijri], ['1990-06-01', ''], 'setting a date clears hijri');
  const byHijri = applyPersonSet(base, { 'birth.hijri': '1445-09-01' });
  assert.equal(byHijri.birth.date, '2024-03-11');
  const died = applyPersonSet(base, { 'death.date': '2020' });
  assert.equal(died.deceased, true, 'setting a death date makes the person deceased');
  const revived = applyPersonSet(died, { deceased: false });
  assert.equal(revived.deceased, false);
  assert.deepEqual(revived.death, emptyPerson().death);
  const named = applyPersonSet(base, { 'name.en': 'Ali', 'birth.place.ar': 'مكة', 'not.a.path': 1 });
  assert.deepEqual([named.name.en, named.birth.place.ar], ['Ali', 'مكة']);
  assert.equal(base.name.en, '', 'input not mutated');
  const priv = applyPersonSet(normalizePerson({ id: 'pabc1', birth: { date: '1990-05-12' } }), { privacy: 'year' });
  assert.equal(priv.birth.date, '1990');
});

test('applyUnionSet: setting marriage/divorce date clears its hijri', () => {
  const u = normalizeUnion({ id: 'uabc1', partners: ['pabc1', 'pabc2'], marriage: { hijri: '1400' } });
  assert.deepEqual([applyUnionSet(u, { 'marriage.date': '1980-01-01' }).marriage.hijri, u.marriage.hijri], ['', '1400']);
  const d = applyUnionSet(u, { status: 'divorced', 'divorce.hijri': '1410-01-01', 'note.en': 'x' });
  assert.equal(d.status, 'divorced');
  assert.equal(d.divorce.date, hijriDate('1410-01-01'));
  assert.equal(d.note.en, 'x');
});

function hijriDate(h) {
  return normalizeUnion({ marriage: { hijri: h } }).marriage.date;
}

test('normalizeData / compactData / serializeData', () => {
  const raw = fixture();
  raw.extraTopLevel = true;
  const n = normalizeData(deepFreeze(raw));
  assert.deepEqual(Object.keys(n), ['schema', 'meta', 'people', 'unions']);
  assert.deepEqual(Object.keys(n.meta), ['title', 'rootPersonId', 'revision', 'updatedAt', 'demo']);
  assert.deepEqual(Object.keys(n.people), Object.keys(raw.people), 'insertion order kept');
  assert.deepEqual(Object.keys(n.people.p0001), [...PERSON_FIELDS]);
  const text = serializeData(n);
  assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'));
  assert.ok(text.includes('\n  "meta": {\n    "title"'), '2-space indentation');
  assert.equal(serializeData(JSON.parse(text)), text, 'serialization is a fixed point');
  const compact = compactData(n);
  assert.equal(compact.meta.demo, undefined);
  assert.equal(compact.extraTopLevel, undefined);
  assert.deepEqual(compact.people.p0002, raw.people.p0002);
  // a record without id takes its key; meta extras are preserved
  const m = normalizeData({ people: { pabc1: { name: { ar: 'علي' } } }, meta: { revision: '4', lastIssue: 12 } });
  assert.equal(m.people.pabc1.id, 'pabc1');
  assert.equal(m.schema, 1);
  assert.equal(m.meta.revision, 4);
  assert.equal(compactData(m).meta.lastIssue, 12);
  assert.equal(normalizeData({ schema: 2 }).schema, 2, 'a different schema is kept for validateData');
});

test('emptyData is valid', () => {
  const e = emptyData();
  assert.deepEqual(validateData(e), { ok: true, errors: [], warnings: [] });
  assert.equal(serializeData(e), '{\n  "schema": 1,\n  "meta": {\n    "revision": 0\n  },\n  "people": {},\n  "unions": {}\n}\n');
});

// ---------------------------------------------------------------------------------------------------------
// The real data file

test('real data/family.json passes validateData (raw and after normalizeData)', () => {
  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  assert.ok(Object.keys(raw.people).length > 100);
  const n = normalizeData(raw);
  const r = validateData(n);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  for (const w of r.warnings) assert.ok(SCHEMA_WARNING_CODES.includes(w.code));
  assert.deepEqual(validateData(raw).errors, [], 'the stored compact form validates too');
});

test('real data: normalize → compact → normalize round-trip is stable', () => {
  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const n1 = normalizeData(raw);
  const n2 = normalizeData(compactData(n1));
  assert.deepEqual(n2, n1);
  assert.equal(JSON.stringify(n2), JSON.stringify(n1), 'same key order too');
  assert.deepEqual(JSON.parse(serializeData(raw)), raw, 'the stored file is already in compact form');
  const text = serializeData(n1);
  assert.equal(serializeData(normalizeData(JSON.parse(text))), text);
});

// ---------------------------------------------------------------------------------------------------------
// Invariants (errors)

test('fixture is valid with no warnings', () => {
  assert.deepEqual(validateData(fixture()), { ok: true, errors: [], warnings: [] });
  assert.deepEqual(validateData(normalizeData(fixture())), { ok: true, errors: [], warnings: [] });
});

test('invariant 1: schema, structure, keys equal ids', () => {
  expectError(variant((d) => { d.schema = 2; }), 'BAD_SCHEMA');
  expectError(variant((d) => { d.people = []; }), 'BAD_TYPE');
  expectError(variant((d) => { d.unions = null; }), 'BAD_TYPE');
  expectError(variant((d) => { delete d.meta; }), 'BAD_TYPE');
  expectError(variant((d) => { d.meta.revision = -1; }), 'BAD_TYPE');
  expectError(variant((d) => { d.people.p0006.name = 'Mohammed'; }), 'BAD_TYPE');
  expectError(variant((d) => { d.unions.u0002.partners = 'p0003'; }), 'BAD_TYPE');
  expectError(variant((d) => { d.people.p0006.history = [5]; }), 'BAD_TYPE');
  const mm = expectError(variant((d) => { d.people.p0006.id = 'p0007'; }), 'ID_MISMATCH');
  assert.deepEqual(mm.params, { key: 'p0006', id: 'p0007', kind: 'person' });
  expectError(variant((d) => { d.unions.u0002.id = 'u0009'; }), 'ID_MISMATCH');
  assert.equal(validateData(null).ok, false);
});

test('invariant 2: id formats; temp ids only with allowTempIds', () => {
  expectError(variant((d) => addPerson(d, 'x123')), 'BAD_ID');
  expectError(variant((d) => addPerson(d, 'P0007')), 'BAD_ID');
  expectError(variant((d) => addUnion(d, 'z0003', ['p0006'], ['p0004'])), 'BAD_ID');
  const temp = variant((d) => {
    addPerson(d, 'new1');
    addPerson(d, 'new2', { gender: 'f', name: { ar: 'نورة' } });
    addUnion(d, 'newu3', ['p0006', 'new2'], ['new1'], { status: 'married' });
    addPerson(d, 'new4');
    addUnion(d, 'tmpu1', ['new4'], ['p0004']);
    d.unions.u0001.children = ['p0003'];
  });
  const e = expectError(temp, 'BAD_ID');
  assert.equal(e.params.kind, 'person');
  assert.equal(validateData(temp).errors.filter((x) => x.code === 'BAD_ID').length, 5);
  assert.deepEqual(validateData(temp, { allowTempIds: true }).errors, []);
  // a temp PERSON ref is never a valid union key, and vice versa
  expectError(variant((d) => addUnion(d, 'new5', ['p0006'], [])), 'BAD_ID', { allowTempIds: true });
  expectError(variant((d) => addPerson(d, 'newu5')), 'BAD_ID', { allowTempIds: true });
});

test('invariant 3: nameStatus rules', () => {
  expectError(variant((d) => { d.people.p0005.name = { ar: '', en: '' }; }), 'NAME_REQUIRED');
  expectError(variant((d) => { delete d.people.p0005.name; }), 'NAME_REQUIRED');
  // kunya-only is allowed for "known"
  expectNo(variant((d) => { d.people.p0005.name = { ar: '' }; d.people.p0005.nickname = { ar: 'أم محمد' }; }), 'NAME_REQUIRED');
  const e = expectError(variant((d) => { d.people.p0005.nameStatus = 'withheld'; }), 'NAME_SHOULD_BE_EMPTY');
  assert.deepEqual(e.params, { id: 'p0005', nameStatus: 'withheld' });
  expectError(variant((d) => { d.people.p0005.nameStatus = 'unknown'; d.people.p0005.name = { en: 'Zainab' }; }), 'NAME_SHOULD_BE_EMPTY');
  // unknown / withheld without a name is fine (a polite label is displayed)
  assert.ok(validateData(variant((d) => { d.people.p0005.nameStatus = 'unknown'; delete d.people.p0005.name; })).ok);
  assert.ok(validateData(variant((d) => { d.people.p0005.nameStatus = 'withheld'; d.people.p0005.name = { ar: '', en: '' }; })).ok);
});

test('invariant 4: enumerations', () => {
  const g = expectError(variant((d) => { d.people.p0006.gender = 'x'; }), 'BAD_ENUM');
  assert.deepEqual(g.params, { id: 'p0006', field: 'gender', value: 'x', allowed: ['m', 'f', ''] });
  assert.equal(g.path, 'people.p0006.gender');
  expectError(variant((d) => { d.people.p0006.privacy = 'secret'; }), 'BAD_ENUM');
  expectError(variant((d) => { d.people.p0006.nameStatus = 'maybe'; }), 'BAD_ENUM');
  expectError(variant((d) => { d.people.p0006.tags = ['vip']; }), 'BAD_ENUM');
  expectError(variant((d) => { d.people.p0006.ties = [{ type: 'adopted', person: 'p0004' }]; }), 'BAD_ENUM');
  expectError(variant((d) => { d.unions.u0002.status = 'engaged'; }), 'BAD_ENUM');
  expectError(variant((d) => { d.people.p0006.removed = removal({ reasonCode: 'angry' }); }), 'BAD_ENUM');
  expectError(variant((d) => { d.people.p0006.deceased = 'yes'; }), 'BAD_TYPE');
  expectError(variant((d) => { d.people.p0006.birth = { date: '1960', approx: 'no' }; }), 'BAD_TYPE');
  // automatic removals may carry an empty reason code
  expectNo(variant((d) => { addUnion(d, 'u0003', ['p0006'], [], { removed: removal({ reasonCode: '', auto: true }) }); }), 'BAD_ENUM');
});

test('invariant 4: dates, hijri dates, photo format, string limits', () => {
  const bd = expectError(variant((d) => { d.people.p0006.birth = { date: '1960-02-30' }; }), 'BAD_DATE');
  assert.deepEqual(bd.params, { id: 'p0006', field: 'birth.date', value: '1960-02-30' });
  expectError(variant((d) => { d.people.p0006.birth = { date: '1960-2-3' }; }), 'BAD_DATE');
  expectError(variant((d) => { d.people.p0001.death = { date: 'soon' }; }), 'BAD_DATE');
  expectError(variant((d) => { d.unions.u0002.marriage = { date: '0000' }; }), 'BAD_DATE');
  expectError(variant((d) => { d.unions.u0002.divorce = { date: '19800' }; }), 'BAD_DATE');
  expectError(variant((d) => { d.people.p0006.birth = { hijri: '1445-08-30', date: '2024-03-10' }; }), 'BAD_HIJRI');
  expectError(variant((d) => { d.unions.u0002.marriage = { hijri: '1501' }; }), 'BAD_HIJRI');

  for (const photo of ['http://example.com/a.jpg', 'javascript:alert(1)', 'photos/p0006.png', 'photos/../x.jpg',
    'https://exa mple.com/a.jpg', '/photos/p0006.jpg', 'data:image/png;base64,AAAA']) {
    const e = expectError(variant((d) => { d.people.p0006.photo = photo; }), 'BAD_PHOTO');
    assert.equal(e.params.value, photo);
  }
  for (const photo of ['', 'https://example.com/a.jpg', 'photos/p0006.jpg', 'photos/p0001.webp']) {
    assert.ok(validateData(variant((d) => { d.people.p0006.photo = photo; })).ok, photo);
  }

  const long = expectError(variant((d) => { d.people.p0006.name.ar = 'ا'.repeat(101); }), 'TOO_LONG');
  assert.deepEqual(long.params, { id: 'p0006', field: 'name.ar', max: 100, length: 101 });
  assert.ok(validateData(variant((d) => { d.people.p0006.name.ar = 'ا'.repeat(100); })).ok);
  expectError(variant((d) => { d.people.p0006.surname = { en: 'x'.repeat(201) }; }), 'TOO_LONG');
  expectError(variant((d) => { d.people.p0006.nickname = { ar: 'x'.repeat(201) }; }), 'TOO_LONG');
  expectError(variant((d) => { d.people.p0006.birth = { date: '1960', place: { ar: 'x'.repeat(201) } }; }), 'TOO_LONG');
  expectError(variant((d) => { d.people.p0006.occupation = { en: 'x'.repeat(2001) }; }), 'TOO_LONG');
  expectError(variant((d) => { d.people.p0006.bio = { en: 'x'.repeat(4001) }; }), 'TOO_LONG');
  assert.ok(validateData(variant((d) => { d.people.p0006.bio = { en: 'x'.repeat(4000) }; })).ok);
  expectError(variant((d) => { d.people.p0006.needsInfo = 'x'.repeat(301); }), 'TOO_LONG');
  expectError(variant((d) => { d.unions.u0002.note = { ar: 'x'.repeat(501) }; }), 'TOO_LONG');
  expectError(variant((d) => {
    d.people.p0006.history = Array.from({ length: 21 }, () => ({ issue: null, at: 'T', action: 'edit-person' }));
  }), 'TOO_LONG');
});

test('invariant 5: union partners and children', () => {
  const tooMany = expectError(variant((d) => { addPerson(d, 'p0007', { gender: 'f' }); d.unions.u0002.partners.push('p0007'); }), 'TOO_MANY_PARTNERS');
  assert.deepEqual(tooMany.params, { union: 'u0002', count: 3 });
  expectError(variant((d) => { d.unions.u0002.partners = ['p0003', 'p0003']; }), 'DUPLICATE_PARTNER');
  const mp = expectError(variant((d) => { d.unions.u0002.partners = ['p0003', 'p9999']; }), 'MISSING_PERSON');
  assert.deepEqual(mp.params, { union: 'u0002', field: 'partners', ref: 'p9999' });
  const mc = expectError(variant((d) => { d.unions.u0002.children.push('p9998'); }), 'MISSING_PERSON');
  assert.equal(mc.params.field, 'children');
  expectError(variant((d) => { d.unions.u0002.children = ['p0006', 'p0006']; }), 'DUPLICATE_CHILD');
  const pc = expectError(variant((d) => { d.unions.u0002.children.push('p0005'); }), 'PARTNER_IS_CHILD');
  assert.deepEqual(pc.params, { union: 'u0002', person: 'p0005' });
  // 0 partners = siblings with unknown parents: valid
  assert.ok(validateData(variant((d) => {
    addPerson(d, 'p0007'); addPerson(d, 'p0008'); addUnion(d, 'u0003', [], ['p0007', 'p0008']);
  })).ok);
});

test('invariant 6: a person is a child of at most one non-removed union', () => {
  const e = expectError(variant((d) => addUnion(d, 'u0003', ['p0005'], ['p0004'])), 'MULTIPLE_BIRTH_UNIONS');
  assert.deepEqual(e.params, { id: 'p0004', unions: ['u0001', 'u0003'] });
  expectNo(variant((d) => addUnion(d, 'u0003', ['p0005'], ['p0004'], { removed: removal() })), 'MULTIPLE_BIRTH_UNIONS');
});

test('invariant 7: no cycles (active unions only)', () => {
  const e = expectError(variant((d) => { d.unions.u0002.children.push('p0001'); }), 'CYCLE');
  assert.deepEqual([...e.params.cycle].sort(), ['p0001', 'p0003']);
  expectNo(variant((d) => {
    addUnion(d, 'u0003', ['p0006'], ['p0001'], { removed: removal() });
  }), 'CYCLE');
});

test('invariant 8: duplicateOf, removed.mergedInto, ties reference existing people ≠ self', () => {
  expectError(variant((d) => { d.people.p0006.duplicateOf = 'p9999'; }), 'MISSING_PERSON');
  const self = expectError(variant((d) => { d.people.p0006.duplicateOf = 'p0006'; }), 'SELF_REFERENCE');
  assert.deepEqual(self.params, { id: 'p0006', field: 'duplicateOf' });
  assert.ok(validateData(variant((d) => { d.people.p0006.duplicateOf = 'p0004'; })).ok);
  expectError(variant((d) => { d.people.p0004.removed = removal({ reasonCode: 'duplicate', mergedInto: 'p9999' }); }), 'MISSING_PERSON');
  expectError(variant((d) => { d.people.p0004.removed = removal({ reasonCode: 'duplicate', mergedInto: 'p0004' }); }), 'SELF_REFERENCE');
  expectError(variant((d) => { d.people.p0006.ties = [{ type: 'milk-child-of', person: 'p9999' }]; }), 'MISSING_PERSON');
  expectError(variant((d) => { d.people.p0006.ties = [{ type: 'milk-child-of', person: 'p0006' }]; }), 'SELF_REFERENCE');
  const tie = { type: 'foster-child-of', person: 'p0004', note: { ar: 'كفالة' } };
  assert.ok(validateData(variant((d) => { d.people.p0006.ties = [tie]; })).ok);
  expectError(variant((d) => { d.people.p0006.ties = [tie, { ...tie, note: {} }]; }), 'DUPLICATE_TIE');
  // union removal records
  expectError(variant((d) => addUnion(d, 'u0003', ['p0006'], [], { removed: removal({ with: 'p9999', auto: true }) })), 'MISSING_PERSON');
  expectError(variant((d) => addUnion(d, 'u0003', ['p0006'], [], { removed: removal({ mergedInto: 'u0404' }) })), 'MISSING_UNION');
  expectError(variant((d) => addUnion(d, 'u0003', ['p0006'], [], { removed: removal({ mergedInto: 'u0003' }) })), 'SELF_REFERENCE');
});

test('invariant 9: one active union per partner set', () => {
  const e = expectError(variant((d) => addUnion(d, 'u0003', ['p0005', 'p0003'], [])), 'DUPLICATE_UNION');
  assert.deepEqual(e.params, { union: 'u0003', other: 'u0002', partners: ['p0005', 'p0003'] });
  expectNo(variant((d) => addUnion(d, 'u0003', ['p0005', 'p0003'], [], { removed: removal() })), 'DUPLICATE_UNION');
  expectError(variant((d) => {
    addPerson(d, 'p0007'); addPerson(d, 'p0008');
    addUnion(d, 'u0003', ['p0006'], ['p0007']); addUnion(d, 'u0004', ['p0006'], ['p0008']);
  }), 'DUPLICATE_UNION');
  // two parentless sibling groups are allowed
  assert.ok(validateData(variant((d) => {
    addPerson(d, 'p0007'); addPerson(d, 'p0008'); addPerson(d, 'p0009', { name: { ar: 'سعد' } }); addPerson(d, 'p0010', { name: { ar: 'فهد' } });
    addUnion(d, 'u0003', [], ['p0007', 'p0008']); addUnion(d, 'u0004', [], ['p0009', 'p0010']);
  })).ok);
});

test('invariant 10: partners are not ancestor and descendant', () => {
  const e = expectError(variant((d) => addUnion(d, 'u0003', ['p0001', 'p0006'], [], { status: 'married' })), 'ANCESTOR_LINK');
  assert.deepEqual(e.params, { union: 'u0003', ancestor: 'p0001', descendant: 'p0006' });
  const r = expectError(variant((d) => addUnion(d, 'u0003', ['p0006', 'p0002'], [])), 'ANCESTOR_LINK');
  assert.deepEqual([r.params.ancestor, r.params.descendant], ['p0002', 'p0006']);
  // cousins may marry
  assert.ok(validateData(variant((d) => {
    addPerson(d, 'p0007', { gender: 'm', name: { ar: 'عمر' } });
    addUnion(d, 'u0003', ['p0007', 'p0004'], ['p0008'], { status: 'married' });
    addPerson(d, 'p0008', { gender: 'f', name: { ar: 'سارة' } });
    addUnion(d, 'u0004', ['p0006', 'p0008'], [], { status: 'married' });
  })).ok);
});

test('invariant 11: privacy truncation respected (PRIVATE_DATE_STORED)', () => {
  const e = expectError(variant((d) => { d.people.p0006.privacy = 'year'; d.people.p0006.birth = { date: '1960-05-12' }; }), 'PRIVATE_DATE_STORED');
  assert.deepEqual(e.params, { id: 'p0006', field: 'birth.date', privacy: 'year', value: '1960-05-12' });
  expectError(variant((d) => { d.people.p0006.privacy = 'year'; d.people.p0006.birth = { date: '1960', hijri: '1379-11' }; }), 'PRIVATE_DATE_STORED');
  expectError(variant((d) => { d.people.p0006.privacy = 'hidden'; d.people.p0006.birth = { date: '1960' }; }), 'PRIVATE_DATE_STORED');
  assert.ok(validateData(variant((d) => { d.people.p0006.privacy = 'year'; d.people.p0006.birth = { date: '1960', hijri: '1379' }; })).ok);
  assert.ok(validateData(variant((d) => { d.people.p0006.privacy = 'hidden'; d.people.p0006.birth = { place: { ar: 'مكة' } }; })).ok);
});

test('allowTempIds: a preview result with temp people and unions validates', () => {
  const preview = normalizeData(variant((d) => {
    addPerson(d, 'new7', { gender: 'f', name: { ar: 'نورة', en: 'Noura' }, privacy: 'year', birth: { date: '1985-02-02' } });
    addUnion(d, 'newu8', ['p0006', 'new7'], ['new9'], { status: 'married' });
    addPerson(d, 'new9', { name: { ar: 'يوسف' }, birth: { date: '2010' } });
    d.people.p0006.spouseOrder = ['newu8'];
    addPerson(d, 'new10', { name: { ar: 'سلمى' }, gender: 'f' });
    addUnion(d, 'tmpu1', ['new10'], ['p0005']);
  }));
  assert.equal(preview.people.new7.birth.date, '1985', 'privacy enforced on temp people too');
  const r = validateData(preview, { allowTempIds: true });
  assert.deepEqual(r.errors, []);
  assert.ok(!r.warnings.some((w) => w.code === 'SPOUSE_ORDER_STALE'));
  const strict = validateData(preview);
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.every((e) => e.code === 'BAD_ID'));
});

// ---------------------------------------------------------------------------------------------------------
// Warnings

test('warnings: unknown fields, stale spouseOrder, root', () => {
  const u = expectWarning(variant((d) => { d.people.p0006.nicknmae = { ar: 'x' }; }), 'UNKNOWN_FIELD');
  assert.deepEqual(u.params, { id: 'p0006', field: 'nicknmae' });
  expectWarning(variant((d) => { d.unions.u0002.colour = 'red'; }), 'UNKNOWN_FIELD');
  const s = expectWarning(variant((d) => { d.people.p0003.spouseOrder = ['u0002', 'u0001', 'u0404']; }), 'SPOUSE_ORDER_STALE');
  assert.deepEqual(s.params, { id: 'p0003', unions: ['u0001', 'u0404'] });
  expectNo(variant((d) => { d.people.p0003.spouseOrder = ['u0002']; }), 'SPOUSE_ORDER_STALE');
  assert.deepEqual(expectWarning(variant((d) => { d.meta.rootPersonId = 'p9999'; }), 'ROOT_MISSING').params, { id: 'p9999' });
  expectWarning(variant((d) => { delete d.meta.rootPersonId; }), 'ROOT_MISSING');
  expectWarning(variant((d) => { d.people.p0001.removed = removal(); }), 'ROOT_REMOVED');
});

test('warnings: life-date consistency (death before birth, parents too young / already dead)', () => {
  expectWarning(variant((d) => { d.people.p0001.death = { date: '1890' }; }), 'DEATH_BEFORE_BIRTH');
  const young = expectWarning(variant((d) => { d.people.p0006.birth = { date: '1941' }; }), 'BORN_BEFORE_PARENT_12');
  assert.deepEqual(young.params, { id: 'p0006', parent: 'p0003', union: 'u0002' });
  expectNo(variant((d) => { d.people.p0006.birth = { date: '1943' }; }), 'BORN_BEFORE_PARENT_12');
  const father = expectWarning(variant((d) => { d.people.p0003.deceased = true; d.people.p0003.death = { date: '1955' }; }), 'BORN_AFTER_FATHER_DEATH');
  assert.deepEqual(father.params, { id: 'p0006', parent: 'p0003', union: 'u0002' });
  // posthumous birth within a year of the father's death is normal
  expectNo(variant((d) => { d.people.p0003.death = { date: '1959-09' }; d.people.p0006.birth = { date: '1960-05' }; }), 'BORN_AFTER_FATHER_DEATH');
  expectWarning(variant((d) => { d.people.p0005.death = { date: '1958' }; }), 'BORN_AFTER_MOTHER_DEATH');
  expectNo(variant((d) => { d.people.p0005.death = { date: '1960' }; }), 'BORN_AFTER_MOTHER_DEATH');
});

test('warnings: ±1 year tolerance for Hijri-year-only dates', () => {
  // father died in 1400 AH (Nov 1979 – Nov 1980); child born mid-1981 is within tolerance, 1983 is not
  const father = (birth) => normalizeData(variant((d) => {
    d.people.p0003.death = { hijri: '1400' };
    d.people.p0006.birth = birth;
  }));
  expectNo(father({ date: '1981-06' }), 'BORN_AFTER_FATHER_DEATH');
  expectWarning(father({ date: '1983' }), 'BORN_AFTER_FATHER_DEATH');
  // mother died 1400 AH, child born 1401 AH (both year-only): could be consistent → no warning
  expectNo(normalizeData(variant((d) => {
    d.people.p0005.death = { hijri: '1400' };
    d.people.p0006.birth = { hijri: '1401' };
  })), 'BORN_AFTER_MOTHER_DEATH');
  expectWarning(normalizeData(variant((d) => {
    d.people.p0005.death = { hijri: '1400-01-01' };
    d.people.p0006.birth = { hijri: '1403' };
  })), 'BORN_AFTER_MOTHER_DEATH');
});

test('warnings: siblings with the same normalized name', () => {
  const w = expectWarning(variant((d) => {
    addPerson(d, 'p0007', { name: { ar: 'عبد الله', en: 'Abdullah' } });
    addPerson(d, 'p0008', { name: { ar: 'عبدالله', en: 'Abdallah' } });
    d.unions.u0002.children.push('p0007', 'p0008');
  }), 'SIBLING_SAME_NAME');
  assert.deepEqual([w.params.union, w.params.a, w.params.b], ['u0002', 'p0007', 'p0008']);
  expectWarning(variant((d) => {
    addPerson(d, 'p0007', { name: { ar: 'أحمد' } });
    addPerson(d, 'p0008', { name: { ar: 'احمد' } });
    d.unions.u0002.children.push('p0007', 'p0008');
  }), 'SIBLING_SAME_NAME');
  // different Arabic names that share a transliteration are not flagged
  expectNo(variant((d) => {
    addPerson(d, 'p0007', { name: { ar: 'حلى', en: 'Hala' } });
    addPerson(d, 'p0008', { name: { ar: 'هالة', en: 'Hala' } });
    d.unions.u0002.children.push('p0007', 'p0008');
  }), 'SIBLING_SAME_NAME');
});

test('warnings: partners and marriages', () => {
  expectWarning(variant((d) => { d.people.p0005.gender = 'm'; }), 'SAME_GENDER_PARTNERS');
  const pg = expectWarning(variant((d) => { d.people.p0005.gender = ''; }), 'PARENT_GENDER_UNKNOWN');
  assert.deepEqual(pg.params, { union: 'u0002', id: 'p0005' });
  expectWarning(variant((d) => { d.unions.u0002.marriage = { date: '1935' }; }), 'MARRIAGE_BEFORE_12');
  expectNo(variant((d) => { d.unions.u0002.marriage = { date: '1955' }; }), 'MARRIAGE_BEFORE_12');
  expectWarning(variant((d) => { d.unions.u0001.marriage = { date: '1975' }; }), 'MARRIAGE_AFTER_DEATH');
  expectWarning(variant((d) => { d.unions.u0002.status = 'widowed'; }), 'WIDOWED_BUT_LIVING');
  expectNo(variant((d) => { d.unions.u0002.status = 'widowed'; d.people.p0003.deceased = true; }), 'WIDOWED_BUT_LIVING');
  const ch = expectWarning(variant((d) => {
    addPerson(d, 'p0009', { name: { ar: 'سعيد' } });
    addUnion(d, 'u0003', ['p0005', 'p0009'], [], { status: 'married' });
  }), 'CONCURRENT_HUSBANDS');
  assert.deepEqual(ch.params, { id: 'p0005', unions: ['u0002', 'u0003'] });
  // a man with two wives, or a widow who remarried, is not flagged
  expectNo(variant((d) => {
    addPerson(d, 'p0009', { name: { ar: 'هند' }, gender: 'f' });
    addUnion(d, 'u0003', ['p0003', 'p0009'], [], { status: 'married' });
  }), 'CONCURRENT_HUSBANDS');
  expectNo(variant((d) => {
    d.people.p0003.deceased = true;
    addPerson(d, 'p0009', { name: { ar: 'سعيد' } });
    addUnion(d, 'u0003', ['p0005', 'p0009'], [], { status: 'married' });
  }), 'CONCURRENT_HUSBANDS');
  const dv = expectWarning(variant((d) => { d.unions.u0002.divorce = { date: '1970' }; }), 'DIVORCE_DATE_WITHOUT_STATUS');
  assert.deepEqual(dv.params, { union: 'u0002', status: 'married' });
  expectNo(variant((d) => { d.unions.u0002.divorce = { date: '1970' }; d.unions.u0002.status = 'divorced'; }), 'DIVORCE_DATE_WITHOUT_STATUS');
  const su = expectWarning(variant((d) => addUnion(d, 'u0003', ['p0006'], [])), 'SMALL_UNION');
  assert.deepEqual(su.params, { union: 'u0003', members: 1 });
});

test('warnings skip soft-removed people and unions', () => {
  expectNo(variant((d) => addUnion(d, 'u0003', ['p0006'], [], { removed: removal({ auto: true, with: 'p0006' }) })), 'SMALL_UNION');
  expectNo(variant((d) => { d.people.p0001.death = { date: '1890' }; d.people.p0001.removed = removal(); d.meta.rootPersonId = 'p0003'; }), 'DEATH_BEFORE_BIRTH');
});

test('normalizePerson is idempotent and survives compact for every date/privacy/deceased combination', () => {
  const hijris = ['', '1445-08-30', '1410-10-17', '1410', '1410-02', 'abc', '١٤٤٥/٩/١', '1600', '1370-05-12'];
  const dates = ['', '1990-05-12', '1990', '1990-02-30', 'x', '١٩٩٠-٥-١', '1989'];
  const deaths = [{}, { hijri: '1400' }, { date: '2001-01-01' }];
  for (const hijri of hijris) {
    for (const date of dates) {
      for (const privacy of [undefined, 'full', 'year', 'hidden', 'secret']) {
        for (const deceased of [undefined, true, false]) {
          for (const death of deaths) {
            const raw = { id: 'pabc1', name: { ar: 'علي' }, privacy, birth: { date, hijri }, deceased, death };
            const a = normalizePerson(raw);
            const label = JSON.stringify(raw);
            assert.equal(JSON.stringify(normalizePerson(a)), JSON.stringify(a), label);
            assert.equal(JSON.stringify(normalizePerson(compactPerson(a))), JSON.stringify(a), label);
          }
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------------------
// Scale

test('5,000 people: normalize + validate + serialize stay fast', () => {
  const data = { schema: 1, meta: { rootPersonId: 'p00000', revision: 1 }, people: {}, unions: {} };
  let n = 0;
  let u = 0;
  const person = (gender, year) => {
    const id = `p${String(n++).padStart(5, '0')}`;
    data.people[id] = { id, name: { ar: `اسم${n}`, en: `Name${n}` }, gender, birth: { date: String(year) }, privacy: 'year' };
    return id;
  };
  let generation = [person('m', 1850)];
  let year = 1850;
  while (n < 5000) {
    year += 25;
    const next = [];
    for (const parent of generation) {
      if (n >= 5000) break;
      const spouse = person(data.people[parent].gender === 'm' ? 'f' : 'm', year - 25);
      const uid = `u${String(u++).padStart(5, '0')}`;
      const children = [];
      for (let k = 0; k < 3 && n < 5000; k++) children.push(person(k % 2 ? 'f' : 'm', year + k));
      data.unions[uid] = { id: uid, partners: [parent, spouse], children, status: 'married' };
      next.push(...children);
    }
    generation = next;
  }
  const t0 = performance.now();
  const norm = normalizeData(data);
  const r = validateData(norm);
  const text = serializeData(norm);
  const ms = performance.now() - t0;
  assert.deepEqual(r.errors, []);
  assert.ok(text.length > 0);
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`);
});

// ---------------------------------------------------------------------------------------------------------
// Coverage of the code list (runs last: node:test runs a file's top-level tests in order)

test('every code emitted by these tests is declared, and every declared code was exercised', () => {
  for (const c of emitted) assert.ok(SCHEMA_ISSUE_CODES.includes(c), `undeclared code ${c}`);
  const missing = SCHEMA_ISSUE_CODES.filter((c) => !emitted.has(c));
  assert.deepEqual(missing, [], 'codes never produced by a test');
});
