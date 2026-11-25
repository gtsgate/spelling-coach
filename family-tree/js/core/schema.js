// Data model of data/family.json: constants, id predicates, normalize (full in-memory shape) ⇄ compact (stored
// shape), canonical serialization and the data invariants (validateData).
// Pure ES module — runs unchanged in modern browsers and Node ≥ 20 (no DOM, no fetch, no node: imports).
// See docs/SPEC.md §2 (data model), §3 (limits, enumerations) and §4 (schema.js API).

import {
  addYearsToDay, canonicalDate, canonicalHijri, dateSpan, fromDayNumber, hijriToGregorian, isValidDate, isValidHijri,
  parseDate, parseHijri, truncateDate,
} from './dates.js';

// =========================================================================================================
// Constants

export const SCHEMA_VERSION = 1;
export const GENDERS = Object.freeze(['m', 'f', '']);
/** Birth-date precision stored & shown. */
export const PRIVACY = Object.freeze(['full', 'year', 'hidden']);
export const NAME_STATUSES = Object.freeze(['known', 'unknown', 'withheld']);
export const UNION_STATUSES = Object.freeze(['married', 'divorced', 'widowed', 'unknown']);
export const TAGS = Object.freeze(['verified', 'needs-info']);
export const MARKS = Object.freeze([
  'deceased', 'living', 'verified', 'unverified', 'needs-info', 'info-complete', 'duplicate', 'not-duplicate', 'private',
]);
export const TIE_TYPES = Object.freeze(['milk-child-of', 'foster-child-of']);
export const REASON_CODES = Object.freeze(['duplicate', 'entered-by-mistake', 'wrong-parents', 'person-requested', 'other']);
export const DESTRUCTIVE_OPS = Object.freeze(['remove-person', 'unlink-spouse', 'detach-person', 'remove-tie', 'merge-person']);
export const OP_TYPES = Object.freeze([
  'add-person', 'edit-person', 'mark', 'link-spouse', 'move-person', 'edit-union', 'reorder-children', 'reorder-spouses',
  'add-tie', 'restore-person', 'restore-union', ...DESTRUCTIVE_OPS,
]);
/** add-person `link.as` values and their options (§3.4). */
export const LINK_TYPES = Object.freeze(['child', 'spouse', 'parent', 'sibling']);
export const PARENT_SCOPES = Object.freeze(['union', 'only']);
export const SIBLING_SHARES = Object.freeze(['both', 'father', 'mother']);

/** Keys allowed in a PersonInput (add-person `person`). */
export const PERSON_INPUT_FIELDS = Object.freeze([
  'name', 'nameStatus', 'surname', 'nickname', 'gender', 'birth', 'deceased', 'death', 'occupation', 'bio', 'photo',
  'privacy', 'needsInfo',
]);
export const PERSON_EDIT_PATHS = Object.freeze([
  'name.ar', 'name.en', 'nameStatus', 'surname.ar', 'surname.en', 'nickname.ar', 'nickname.en', 'gender',
  'birth.date', 'birth.hijri', 'birth.approx', 'birth.place.ar', 'birth.place.en',
  'deceased', 'death.date', 'death.hijri', 'death.approx', 'death.place.ar', 'death.place.en',
  'occupation.ar', 'occupation.en', 'bio.ar', 'bio.en', 'photo', 'privacy',
]);
export const UNION_EDIT_PATHS = Object.freeze([
  'status', 'marriage.date', 'marriage.hijri', 'marriage.approx', 'marriage.place.ar', 'marriage.place.en',
  'divorce.date', 'divorce.hijri', 'divorce.approx', 'note.ar', 'note.en',
]);

/** Person keys in canonical (write) order — §2.1. */
export const PERSON_FIELDS = Object.freeze([
  'id', 'name', 'nameStatus', 'surname', 'nickname', 'gender', 'birth', 'deceased', 'death', 'occupation', 'bio', 'photo',
  'privacy', 'tags', 'needsInfo', 'duplicateOf', 'spouseOrder', 'ties', 'removed', 'history',
]);
/** Union keys in canonical (write) order — §2.2. */
export const UNION_FIELDS = Object.freeze(['id', 'partners', 'children', 'status', 'marriage', 'divorce', 'note', 'removed']);

/**
 * Size limits (§3.1). String limits are UTF-16 lengths per language side.
 *   text: any other free text (occupation, tie note, photo URL, submitter fields…)
 *   code: encoded proposal code (chars) · decodedBytes: decoded proposal JSON (1 MB)
 *   destructive / merges: per proposal · history: entries kept per person · redirectHops: mergedInto chain length
 */
export const LIMITS = Object.freeze({
  ops: 150,
  name: 100,
  surname: 200,
  nickname: 200,
  place: 200,
  text: 2000,
  proposalNote: 2000,
  bio: 4000,
  needsInfo: 300,
  unionNote: 500,
  code: 60000,
  decodedBytes: 1024 * 1024,
  destructive: 3,
  merges: 30,
  history: 20,
  redirectHops: 10,
});

// =========================================================================================================
// Ids & references

export const PERSON_ID_RE = /^p[a-z0-9]{3,24}$/;
export const UNION_ID_RE = /^u[a-z0-9]{3,24}$/;
/** Temp person ref declared by add-person (`ref`). */
export const TEMP_PERSON_RE = /^new[0-9]+$/;
/** Temp union ref bound by an op's `unionRef`. */
export const TEMP_UNION_RE = /^newu[0-9]+$/;
/** Preview-only id of a union created without a unionRef (not referenceable). */
export const PREVIEW_UNION_RE = /^tmpu[0-9]+$/;

const isStr = (s) => typeof s === 'string';
export const isPersonId = (s) => isStr(s) && PERSON_ID_RE.test(s);
export const isUnionId = (s) => isStr(s) && UNION_ID_RE.test(s);
export const isTempPersonRef = (s) => isStr(s) && TEMP_PERSON_RE.test(s);
export const isTempUnionRef = (s) => isStr(s) && TEMP_UNION_RE.test(s);
export const isPreviewUnionId = (s) => isStr(s) && PREVIEW_UNION_RE.test(s);
/** PersonRef = existing-style person id or temp ref. */
export const isPersonRef = (s) => isPersonId(s) || isTempPersonRef(s);
/** UnionRef = existing-style union id or temp union ref. */
export const isUnionRef = (s) => isUnionId(s) || isTempUnionRef(s);

/** n random base36 characters from crypto.getRandomValues (rejection sampling → uniform). */
export function randomBase36(n) {
  let out = '';
  const buf = new Uint8Array(Math.max(8, n * 2));
  while (out.length < n) {
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= 252) continue; // 252 = 7 × 36
      out += (b % 36).toString(36);
      if (out.length === n) break;
    }
  }
  return out;
}

/** Fresh proposal id: 10 random base36 chars (§3.1). */
export function newProposalId() {
  return randomBase36(10);
}

/**
 * Random record id: prefix ("p" | "u") + 7 base36 chars, never colliding with `taken`
 * (a Set, an object keyed by id, or a predicate).
 */
export function randomId(prefix, taken) {
  const isTaken = typeof taken === 'function' ? taken
    : taken instanceof Set ? (id) => taken.has(id)
      : taken && typeof taken === 'object' ? (id) => Object.prototype.hasOwnProperty.call(taken, id)
        : () => false;
  for (;;) {
    const id = prefix + randomBase36(7);
    if (!isTaken(id)) return id;
  }
}

// =========================================================================================================
// Small helpers

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ARABIC_SCRIPT_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
/** Deep copy of JSON data (extras we carry along but do not interpret). */
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Trimmed string; finite numbers become strings; anything else "". */
function str(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** {ar, en} with trimmed strings. A bare string is placed by script (Arabic letters → ar, else en). */
function bilingual(v) {
  if (typeof v === 'string') {
    const s = v.trim();
    return ARABIC_SCRIPT_RE.test(s) ? { ar: s, en: '' } : { ar: '', en: s };
  }
  if (!isObj(v)) return { ar: '', en: '' };
  return { ar: str(v.ar), en: str(v.en) };
}

/** Array of trimmed non-empty strings (order kept; non-strings dropped; duplicates dropped when `unique`). */
function strList(v, { unique = true } = {}) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    const s = typeof x === 'string' ? x.trim() : '';
    if (!s || (unique && out.includes(s))) continue;
    out.push(s);
  }
  return out;
}

function emptyDateObj(withPlace) {
  return withPlace ? { date: '', hijri: '', approx: false, place: { ar: '', en: '' } } : { date: '', hijri: '', approx: false };
}

/**
 * Normalize a date object {date, hijri, approx, place?}:
 *   * dates canonicalized ("1950-3-5" / Arabic digits → "1950-03-05"); unparseable text is kept for validation to report;
 *   * hijri set → date derived from it (Umm al-Qura): full → exact; year/month only → day 1 of that period, approx:true;
 *   * birth privacy: "hidden" clears date/hijri; "year" truncates both to the year (see yearPrivacyDates).
 */
function normalizeDateObj(raw, withPlace, privacy = 'full') {
  const o = isObj(raw) ? raw : (typeof raw === 'string' || typeof raw === 'number') ? { date: String(raw) } : {};
  const dateIn = str(o.date);
  const hijriIn = str(o.hijri);
  let date = dateIn ? (canonicalDate(dateIn) ?? dateIn) : '';
  let hijri = hijriIn ? (canonicalHijri(hijriIn) ?? hijriIn) : '';
  let approx = o.approx === true;
  if (privacy === 'hidden') {
    date = '';
    hijri = '';
    approx = false;
  } else if (privacy === 'year') {
    ({ date, hijri, approx } = yearPrivacyDates(date, hijri, approx));
  } else if (hijri) {
    const g = hijriToGregorian(hijri);
    if (g) {
      date = g.date;
      if (g.approx) approx = true;
    }
  }
  const out = { date, hijri, approx };
  if (withPlace) out.place = bilingual(o.place);
  return out;
}

/**
 * Birth dates under privacy "year": both values are stored as years only. A Hijri year straddles two Gregorian years,
 * so the Gregorian year is chosen to stay TRUE and STABLE across re-normalization:
 *   1. a Hijri day/month was given → the Gregorian year of that day (or of day 1 of that month);
 *   2. Hijri year only and the stored Gregorian year falls inside that Hijri year → keep it (it was derived earlier);
 *   3. otherwise → the Gregorian year of 1 Muharram (spec rule "day 1 of that Hijri year").
 */
function yearPrivacyDates(date, hijri, approx) {
  const yearDate = truncateDate(date, 'year');
  if (!hijri) return { date: yearDate, hijri, approx };
  const hp = parseHijri(hijri); // null for a non-existent day; its year may still be valid
  const hijriYear = truncateDate(hijri, 'year', 'hijri');
  const start = hijriToGregorian(hijriYear);
  if (!start) return { date: yearDate, hijri: hijriYear, approx }; // invalid hijri: validateData reports it
  let year = Number(start.date.slice(0, 4));
  if (hp && hp.precision !== 'year') {
    year = Number(hijriToGregorian(hijri).date.slice(0, 4));
  } else {
    const kept = parseDate(yearDate);
    const span = dateSpan({ hijri: hijriYear });
    if (kept && span && kept.year >= fromDayNumber(span.start).year && kept.year <= fromDayNumber(span.end).year) {
      year = kept.year;
    }
  }
  return { date: String(year).padStart(4, '0'), hijri: hijriYear, approx: true };
}

const dateIsEmpty = (d) => !d.date && !d.hijri && !d.approx && (!d.place || (!d.place.ar && !d.place.en));

function normalizeRemoved(raw) {
  if (!isObj(raw)) return null;
  const out = {
    at: str(raw.at),
    reasonCode: str(raw.reasonCode),
    issue: raw.issue ?? null,
    by: str(raw.by),
  };
  if (raw.mergedInto !== undefined) out.mergedInto = str(raw.mergedInto);
  if (raw.with !== undefined) out.with = str(raw.with);
  if (raw.auto !== undefined) out.auto = raw.auto === true;
  if (raw.merge !== undefined) out.merge = clone(raw.merge);
  for (const k of Object.keys(raw)) if (!hasOwn(out, k)) out[k] = clone(raw[k]); // keep unknown extras
  return out;
}

function normalizeHistoryEntry(raw) {
  if (!isObj(raw)) return null;
  const out = { issue: raw.issue ?? null };
  if (raw.rev !== undefined) out.rev = raw.rev;
  out.at = str(raw.at);
  out.action = str(raw.action);
  if (raw.from !== undefined) out.from = raw.from;
  if (raw.index !== undefined) out.index = raw.index;
  for (const k of Object.keys(raw)) if (!hasOwn(out, k)) out[k] = clone(raw[k]);
  return out;
}

function normalizeTie(raw) {
  if (!isObj(raw)) return null;
  return { type: str(raw.type), person: str(raw.person), note: bilingual(raw.note) };
}

// =========================================================================================================
// Person

/** A person in full in-memory shape with every field empty (privacy "full", as a missing stored value means). */
export function emptyPerson(id = '') {
  return {
    id,
    name: { ar: '', en: '' },
    nameStatus: 'known',
    surname: { ar: '', en: '' },
    nickname: { ar: '', en: '' },
    gender: '',
    birth: emptyDateObj(true),
    deceased: false,
    death: emptyDateObj(true),
    occupation: { ar: '', en: '' },
    bio: { ar: '', en: '' },
    photo: '',
    privacy: 'full',
    tags: [],
    needsInfo: '',
    duplicateOf: '',
    spouseOrder: [],
    ties: [],
    removed: null,
    history: [],
  };
}

/**
 * Full in-memory shape of a person (compact or partial input; never mutated). Missing fields get defaults; values of
 * the wrong JS type are dropped; invalid strings (e.g. gender "x", a bad date) are KEPT so validateData reports them.
 * Enforced here: privacy truncation of the birth date, hijri → Gregorian derivation, death date ⇒ deceased:true,
 * deceased:false (explicit) ⇒ death cleared, history capped to the newest LIMITS.history entries. Unknown keys are dropped.
 */
export function normalizePerson(raw) {
  const src = isObj(raw) ? raw : {};
  const p = emptyPerson(str(src.id));
  p.name = bilingual(src.name);
  p.nameStatus = str(src.nameStatus) || 'known';
  p.surname = bilingual(src.surname);
  p.nickname = bilingual(src.nickname);
  p.gender = str(src.gender).toLowerCase();
  p.privacy = str(src.privacy) || 'full';
  p.birth = normalizeDateObj(src.birth, true, p.privacy);

  // death ⇒ deceased; an explicit deceased:false wins and clears death.* (§2.1).
  const death = normalizeDateObj(src.death, true);
  let deceased = src.deceased === true;
  if (src.deceased !== false && (death.date || death.hijri)) deceased = true;
  p.deceased = deceased;
  p.death = deceased ? death : emptyDateObj(true);

  p.occupation = bilingual(src.occupation);
  p.bio = bilingual(src.bio);
  p.photo = str(src.photo);
  p.tags = strList(src.tags);
  p.needsInfo = str(src.needsInfo);
  p.duplicateOf = str(src.duplicateOf);
  p.spouseOrder = strList(src.spouseOrder);
  p.ties = Array.isArray(src.ties) ? src.ties.map(normalizeTie).filter(Boolean) : [];
  p.removed = normalizeRemoved(src.removed);
  const history = Array.isArray(src.history) ? src.history.map(normalizeHistoryEntry).filter(Boolean) : [];
  p.history = history.slice(-LIMITS.history);
  return p;
}

function compactBi(b) {
  if (!b) return undefined;
  const out = {};
  if (b.ar) out.ar = b.ar;
  if (b.en) out.en = b.en;
  return Object.keys(out).length ? out : undefined;
}

function compactDateObj(d) {
  if (!d || dateIsEmpty(d)) return undefined;
  const out = {};
  if (d.date) out.date = d.date;
  if (d.hijri) out.hijri = d.hijri;
  if (d.approx) out.approx = true;
  const place = compactBi(d.place);
  if (place) out.place = place;
  return out;
}

/** Assign `value` to `key` only when defined (keeps key order = insertion order). */
function put(out, key, value) {
  if (value !== undefined) out[key] = value;
}

/**
 * Stored (compact) form of a person: normalizes first, then drops "", empty bilingual objects/sides, approx:false,
 * empty arrays, null, deceased:false, nameStatus:"known", privacy:"full", empty birth/death. Always keeps id.
 * Key order = §2.1. History entries and removal records are kept verbatim (incl. issue:null).
 */
export function compactPerson(person) {
  const p = normalizePerson(person);
  const out = { id: p.id };
  put(out, 'name', compactBi(p.name));
  if (p.nameStatus !== 'known') out.nameStatus = p.nameStatus;
  put(out, 'surname', compactBi(p.surname));
  put(out, 'nickname', compactBi(p.nickname));
  if (p.gender) out.gender = p.gender;
  put(out, 'birth', compactDateObj(p.birth));
  if (p.deceased) out.deceased = true;
  put(out, 'death', compactDateObj(p.death));
  put(out, 'occupation', compactBi(p.occupation));
  put(out, 'bio', compactBi(p.bio));
  if (p.photo) out.photo = p.photo;
  if (p.privacy !== 'full') out.privacy = p.privacy;
  if (p.tags.length) out.tags = [...p.tags];
  if (p.needsInfo) out.needsInfo = p.needsInfo;
  if (p.duplicateOf) out.duplicateOf = p.duplicateOf;
  if (p.spouseOrder.length) out.spouseOrder = [...p.spouseOrder];
  if (p.ties.length) {
    out.ties = p.ties.map((t) => {
      const tie = { type: t.type, person: t.person };
      put(tie, 'note', compactBi(t.note));
      return tie;
    });
  }
  if (p.removed) out.removed = p.removed;
  if (p.history.length) out.history = p.history;
  return out;
}

/** Set a dotted path ("birth.place.ar") on an object, creating intermediate objects. */
function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isObj(cur[keys[i]])) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * Apply an edit-person `set` ({path: value}, paths from PERSON_EDIT_PATHS; others ignored) with the SETTING semantics
 * of §2.1 that normalize alone cannot infer: setting `birth.date`/`death.date` clears that hijri (unless the same set
 * gives one); setting a non-empty death date/hijri makes the person deceased; setting deceased:false clears death.*.
 * Returns a new normalized person (input not mutated). Value validation is the caller's job.
 */
export function applyPersonSet(person, set) {
  const p = normalizePerson(person);
  const s = isObj(set) ? set : {};
  for (const path of PERSON_EDIT_PATHS) if (hasOwn(s, path)) setPath(p, path, s[path]);
  for (const which of ['birth', 'death']) {
    if (hasOwn(s, `${which}.date`) && !hasOwn(s, `${which}.hijri`)) p[which].hijri = '';
  }
  if (s.deceased === false) {
    p.deceased = false;
    p.death = emptyDateObj(true);
  } else if ((hasOwn(s, 'death.date') || hasOwn(s, 'death.hijri')) && (str(p.death.date) || str(p.death.hijri))) {
    p.deceased = true;
  }
  return normalizePerson(p);
}

// =========================================================================================================
// Union

export function emptyUnion(id = '') {
  return {
    id,
    partners: [],
    children: [],
    status: 'unknown',
    marriage: emptyDateObj(true),
    divorce: emptyDateObj(false),
    note: { ar: '', en: '' },
    removed: null,
  };
}

/**
 * Full in-memory shape of a union (input not mutated). Missing status → "unknown" (compact drops it). Partner/child
 * lists keep order and duplicates (validateData reports duplicates); non-string entries are dropped. Hijri dates derive
 * the Gregorian date as for people.
 */
export function normalizeUnion(raw) {
  const src = isObj(raw) ? raw : {};
  const u = emptyUnion(str(src.id));
  u.partners = strList(src.partners, { unique: false });
  u.children = strList(src.children, { unique: false });
  u.status = str(src.status) || 'unknown';
  u.marriage = normalizeDateObj(src.marriage, true);
  u.divorce = normalizeDateObj(src.divorce, false);
  u.note = bilingual(src.note);
  u.removed = normalizeRemoved(src.removed);
  return u;
}

/** Stored (compact) form of a union: drops empty children/marriage/divorce/note, status "unknown", removed null. */
export function compactUnion(union) {
  const u = normalizeUnion(union);
  const out = { id: u.id, partners: [...u.partners] };
  if (u.children.length) out.children = [...u.children];
  if (u.status !== 'unknown') out.status = u.status;
  put(out, 'marriage', compactDateObj(u.marriage));
  put(out, 'divorce', compactDateObj(u.divorce));
  put(out, 'note', compactBi(u.note));
  if (u.removed) out.removed = u.removed;
  return out;
}

/** Apply an edit-union `set` (UNION_EDIT_PATHS): setting marriage.date / divorce.date clears that hijri. */
export function applyUnionSet(union, set) {
  const u = normalizeUnion(union);
  const s = isObj(set) ? set : {};
  for (const path of UNION_EDIT_PATHS) if (hasOwn(s, path)) setPath(u, path, s[path]);
  for (const which of ['marriage', 'divorce']) {
    if (hasOwn(s, `${which}.date`) && !hasOwn(s, `${which}.hijri`)) u[which].hijri = '';
  }
  return normalizeUnion(u);
}

// =========================================================================================================
// Whole data file

const META_KEYS = ['title', 'rootPersonId', 'revision', 'updatedAt', 'demo'];

function normalizeMeta(raw) {
  const src = isObj(raw) ? raw : {};
  let revision = 0;
  if (typeof src.revision === 'number' && Number.isFinite(src.revision)) revision = src.revision;
  else if (typeof src.revision === 'string' && /^\d+$/.test(src.revision.trim())) revision = Number(src.revision);
  const out = {
    title: bilingual(src.title),
    rootPersonId: str(src.rootPersonId),
    revision,
    updatedAt: str(src.updatedAt),
    demo: src.demo === true,
  };
  for (const k of Object.keys(src)) if (!META_KEYS.includes(k)) out[k] = clone(src[k]); // keep extras
  return out;
}

function compactMeta(meta) {
  const m = normalizeMeta(meta);
  const out = {};
  put(out, 'title', compactBi(m.title));
  if (m.rootPersonId) out.rootPersonId = m.rootPersonId;
  out.revision = m.revision;
  if (m.updatedAt) out.updatedAt = m.updatedAt;
  if (m.demo) out.demo = true;
  for (const k of Object.keys(m)) if (!META_KEYS.includes(k)) out[k] = m[k];
  return out;
}

/** An empty data file. */
export function emptyData() {
  return {
    schema: SCHEMA_VERSION,
    meta: normalizeMeta({}),
    people: {},
    unions: {},
  };
}

/**
 * Full in-memory shape of the data file (input not mutated). Keys and insertion order of people/unions are kept;
 * a record without an id takes its key. A missing `schema` becomes SCHEMA_VERSION; a different one is kept (reported
 * by validateData). Unknown top-level keys are dropped.
 */
export function normalizeData(raw) {
  const src = isObj(raw) ? raw : {};
  const out = {
    schema: src.schema === undefined ? SCHEMA_VERSION : src.schema,
    meta: normalizeMeta(src.meta),
    people: {},
    unions: {},
  };
  if (isObj(src.people)) {
    for (const [key, value] of Object.entries(src.people)) {
      const p = normalizePerson(value);
      if (!p.id) p.id = key;
      out.people[key] = p;
    }
  }
  if (isObj(src.unions)) {
    for (const [key, value] of Object.entries(src.unions)) {
      const u = normalizeUnion(value);
      if (!u.id) u.id = key;
      out.unions[key] = u;
    }
  }
  return out;
}

/** Stored (compact) form of the whole file: {schema, meta, people, unions}. */
export function compactData(data) {
  const d = normalizeData(data);
  const people = {};
  for (const [key, p] of Object.entries(d.people)) people[key] = compactPerson(p);
  const unions = {};
  for (const [key, u] of Object.entries(d.unions)) unions[key] = compactUnion(u);
  return { schema: d.schema, meta: compactMeta(d.meta), people, unions };
}

/** Canonical file text: compact form, stable key order (§2.1/§2.2), 2-space indent, trailing newline. */
export function serializeData(data) {
  return JSON.stringify(compactData(data), null, 2) + '\n';
}

// =========================================================================================================
// Validation — validateData(data, {allowTempIds}) → {ok, errors, warnings}
//
// Works on the normalized OR the compact stored form (missing fields read as their defaults), so scripts can check a
// raw file before normalization hides anything. Every problem is an Issue {code, params, path}; person issues carry
// params.id, union issues params.union, field-level issues params.field (relative to the record).

/** Error codes validateData can emit. */
export const SCHEMA_ERROR_CODES = Object.freeze([
  'BAD_SCHEMA', //            {found, expected}                         schema !== 1
  'BAD_TYPE', //              {field, expected, id?|union?}             wrong JSON type / structure
  'ID_MISMATCH', //           {key, id, kind}                           record key ≠ its id
  'BAD_ID', //                {id, kind:"person"|"union"}               id does not match the id pattern
  'NAME_REQUIRED', //         {id}                                      nameStatus known but no name/nickname
  'NAME_SHOULD_BE_EMPTY', //  {id, nameStatus}                          unknown/withheld with a name
  'BAD_ENUM', //              {field, value, allowed, id?|union?}       value outside its enumeration
  'BAD_DATE', //              {field, value, id?|union?}                not a real "YYYY[-MM[-DD]]" Gregorian date
  'BAD_HIJRI', //             {field, value, id?|union?}                not a real Hijri date (year 1–1500)
  'BAD_PHOTO', //             {id, value}                               not "" / https URL / photos/<pid>.jpg|webp
  'TOO_LONG', //              {field, max, length, id?|union?}          string / list over its limit
  'TOO_MANY_PARTNERS', //     {union, count}                            > 2 partners
  'DUPLICATE_PARTNER', //     {union, person}                           same partner twice
  'DUPLICATE_CHILD', //       {union, person}                           same child twice
  'PARTNER_IS_CHILD', //      {union, person}                           partner and child of the same union
  'MISSING_PERSON', //        {field, ref, id?|union?}                  reference to a person that does not exist
  'MISSING_UNION', //         {union, field, ref}                       union removed.mergedInto → unknown union
  'SELF_REFERENCE', //        {id?|union?, field}                       duplicateOf / mergedInto / tie / with = self
  'DUPLICATE_TIE', //         {id, type, person}                        same tie twice
  'MULTIPLE_BIRTH_UNIONS', // {id, unions}                              child of > 1 non-removed union
  'CYCLE', //                 {id, cycle}                               person is their own ancestor
  'DUPLICATE_UNION', //       {union, other, partners}                  2 active unions, same partner set
  'ANCESTOR_LINK', //         {union, ancestor, descendant}             partner is an ancestor of the other
  'PRIVATE_DATE_STORED', //   {id, field, privacy, value}               birth detail stored beyond its privacy
]);

/** Warning codes validateData can emit. */
export const SCHEMA_WARNING_CODES = Object.freeze([
  'UNKNOWN_FIELD', //               {field, id?|union?}                 key not in the data model
  'SPOUSE_ORDER_STALE', //          {id, unions}                        spouseOrder lists unions that are not theirs/active
  'ROOT_MISSING', //                {id}                                meta.rootPersonId empty or unknown
  'ROOT_REMOVED', //                {id}                                root person is soft-removed
  'DEATH_BEFORE_BIRTH', //          {id}
  'BORN_BEFORE_PARENT_12', //       {id, parent, union}                 child born before the parent was 12
  'BORN_AFTER_FATHER_DEATH', //     {id, parent, union}                 > 1 year after the father's death
  'BORN_AFTER_MOTHER_DEATH', //     {id, parent, union}
  'SIBLING_SAME_NAME', //           {union, a, b, name}                 two children of a union share a normalized name
  'SAME_GENDER_PARTNERS', //        {union, gender}
  'PARENT_GENDER_UNKNOWN', //       {union, id}                         parent (partner of a union with children) without gender
  'MARRIAGE_BEFORE_12', //          {union, id}
  'MARRIAGE_AFTER_DEATH', //        {union, id}
  'WIDOWED_BUT_LIVING', //          {union}                             status widowed, both partners living
  'CONCURRENT_HUSBANDS', //         {id, unions}                        woman in ≥ 2 "married" unions with living husbands
  'DIVORCE_DATE_WITHOUT_STATUS', // {union, status}                     divorce date but status ≠ divorced
  'SMALL_UNION', //                 {union, members}                    active union with < 2 members
]);

/** Every Issue code validateData can emit (errors + warnings). */
export const SCHEMA_ISSUE_CODES = Object.freeze([...SCHEMA_ERROR_CODES, ...SCHEMA_WARNING_CODES]);

const PERSON_KEY_SET = new Set(PERSON_FIELDS);
const UNION_KEY_SET = new Set(UNION_FIELDS);
const DATA_KEY_SET = new Set(['schema', 'meta', 'people', 'unions']);
const PHOTO_PATH_RE = /^photos\/p[a-z0-9]{3,24}\.(?:jpg|webp)$/;
const PHOTO_URL_RE = /^https:\/\/[^\s"'<>\\]+$/;
const YEAR_TOLERANCE_DAYS = 366;

/** Loose name key for sibling comparison (tashkeel/tatweel/hamza forms/ة/ى/case/spaces ignored). */
function nameKey(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .toLowerCase()
    .replace(/[\s\-'’`.]+/g, '');
}

const isDeceasedRaw = (p) => p.deceased === true
  || (p.deceased !== false && isObj(p.death) && (str(p.death.date) !== '' || str(p.death.hijri) !== ''));

/** Day span of a date object, widened by a year each side when approximate (heuristic warnings only). */
function tolerantSpan(d) {
  if (!isObj(d)) return null;
  const s = dateSpan(d);
  if (!s) return null;
  return d.approx === true ? { start: s.start - YEAR_TOLERANCE_DAYS, end: s.end + YEAR_TOLERANCE_DAYS } : s;
}

/**
 * Check the invariants of §2.3 (errors 1–11) and the data-quality warnings.
 * allowTempIds (preview mode only) also accepts people "newN" and unions "newuN" / "tmpuN".
 */
export function validateData(data, { allowTempIds = false } = {}) {
  const errors = [];
  const warnings = [];
  const err = (code, params, path) => errors.push(path ? { code, params, path } : { code, params });
  const warn = (code, params, path) => warnings.push(path ? { code, params, path } : { code, params });
  const result = () => ({ ok: errors.length === 0, errors, warnings });

  if (!isObj(data)) {
    err('BAD_TYPE', { field: '', expected: 'object' });
    return result();
  }

  // --- 1. top level -------------------------------------------------------------------------------------
  if (data.schema !== SCHEMA_VERSION) err('BAD_SCHEMA', { found: data.schema ?? null, expected: SCHEMA_VERSION }, 'schema');
  for (const k of Object.keys(data)) if (!DATA_KEY_SET.has(k)) warn('UNKNOWN_FIELD', { field: k }, k);
  const meta = data.meta;
  if (!isObj(meta)) err('BAD_TYPE', { field: 'meta', expected: 'object' }, 'meta');
  else {
    if (meta.revision !== undefined && !(Number.isInteger(meta.revision) && meta.revision >= 0)) {
      err('BAD_TYPE', { field: 'meta.revision', expected: 'integer ≥ 0' }, 'meta.revision');
    }
    for (const k of ['rootPersonId', 'updatedAt']) {
      if (meta[k] !== undefined && !isStr(meta[k])) err('BAD_TYPE', { field: `meta.${k}`, expected: 'string' }, `meta.${k}`);
    }
    if (meta.demo !== undefined && typeof meta.demo !== 'boolean') err('BAD_TYPE', { field: 'meta.demo', expected: 'boolean' }, 'meta.demo');
    if (meta.title !== undefined && !isObj(meta.title)) err('BAD_TYPE', { field: 'meta.title', expected: 'object' }, 'meta.title');
  }
  const peopleOk = isObj(data.people);
  const unionsOk = isObj(data.unions);
  if (!peopleOk) err('BAD_TYPE', { field: 'people', expected: 'object' }, 'people');
  if (!unionsOk) err('BAD_TYPE', { field: 'unions', expected: 'object' }, 'unions');
  const people = peopleOk ? data.people : {};
  const unions = unionsOk ? data.unions : {};
  const person = (id) => (isStr(id) && hasOwn(people, id) && isObj(people[id]) ? people[id] : null);
  const isActivePerson = (id) => { const p = person(id); return !!p && !p.removed; };

  // --- generic field checkers (own = {id} for people, {union} for unions; base = path prefix) -----------
  const typeErr = (own, base, field, expected) => err('BAD_TYPE', { ...own, field, expected }, `${base}.${field}`);

  function checkString(own, base, field, value, max) {
    if (value === undefined) return '';
    if (!isStr(value)) { typeErr(own, base, field, 'string'); return ''; }
    if (max && value.length > max) err('TOO_LONG', { ...own, field, max, length: value.length }, `${base}.${field}`);
    return value;
  }

  function checkBilingual(own, base, field, value, max) {
    if (value === undefined) return;
    if (!isObj(value)) { typeErr(own, base, field, 'object'); return; }
    for (const lang of ['ar', 'en']) checkString(own, base, `${field}.${lang}`, value[lang], max);
  }

  function checkEnum(own, base, field, value, allowed) {
    if (value === undefined) return;
    if (!allowed.includes(value)) err('BAD_ENUM', { ...own, field, value, allowed: [...allowed] }, `${base}.${field}`);
  }

  function checkBool(own, base, field, value) {
    if (value !== undefined && typeof value !== 'boolean') typeErr(own, base, field, 'boolean');
  }

  function checkDateObj(own, base, field, value, withPlace) {
    if (value === undefined) return;
    if (!isObj(value)) { typeErr(own, base, field, 'object'); return; }
    const date = checkString(own, base, `${field}.date`, value.date);
    if (date && !isValidDate(date)) err('BAD_DATE', { ...own, field: `${field}.date`, value: date }, `${base}.${field}.date`);
    const hijri = checkString(own, base, `${field}.hijri`, value.hijri);
    if (hijri && !isValidHijri(hijri)) err('BAD_HIJRI', { ...own, field: `${field}.hijri`, value: hijri }, `${base}.${field}.hijri`);
    checkBool(own, base, `${field}.approx`, value.approx);
    if (withPlace) checkBilingual(own, base, `${field}.place`, value.place, LIMITS.place);
  }

  function checkStringList(own, base, field, value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) { typeErr(own, base, field, 'array'); return []; }
    const out = [];
    value.forEach((x, i) => {
      if (!isStr(x)) typeErr(own, base, `${field}.${i}`, 'string');
      else out.push(x);
    });
    return out;
  }

  function checkRemoved(own, base, value) {
    if (value === undefined || value === null) return null;
    if (!isObj(value)) { typeErr(own, base, 'removed', 'object|null'); return null; }
    // reasonCode may be empty on automatic removals (auto/with); otherwise it must be a known code.
    const rc = checkString(own, base, 'removed.reasonCode', value.reasonCode);
    if (rc) checkEnum(own, base, 'removed.reasonCode', rc, REASON_CODES);
    checkString(own, base, 'removed.at', value.at);
    checkString(own, base, 'removed.by', value.by);
    checkString(own, base, 'removed.mergedInto', value.mergedInto);
    checkString(own, base, 'removed.with', value.with);
    checkBool(own, base, 'removed.auto', value.auto);
    return value;
  }

  /** Invariant 8: a person reference must exist and differ from the owner. */
  function checkPersonRef(id, base, field, ref) {
    if (!isStr(ref) || !ref) return;
    if (ref === id) err('SELF_REFERENCE', { id, field }, `${base}.${field}`);
    else if (!person(ref)) err('MISSING_PERSON', { id, field, ref }, `${base}.${field}`);
  }

  // --- people (invariants 2, 3, 4, 8, 11) -----------------------------------------------------------------
  for (const [id, p] of Object.entries(people)) {
    const base = `people.${id}`;
    const own = { id };
    if (!isObj(p)) { err('BAD_TYPE', { id, field: '', expected: 'object' }, base); continue; }
    if (p.id !== id) err('ID_MISMATCH', { key: id, id: p.id ?? null, kind: 'person' }, `${base}.id`);
    if (!(isPersonId(id) || (allowTempIds && isTempPersonRef(id)))) err('BAD_ID', { id, kind: 'person' }, base);
    for (const k of Object.keys(p)) if (!PERSON_KEY_SET.has(k)) warn('UNKNOWN_FIELD', { id, field: k }, `${base}.${k}`);

    checkBilingual(own, base, 'name', p.name, LIMITS.name);
    checkEnum(own, base, 'nameStatus', p.nameStatus, NAME_STATUSES);
    checkBilingual(own, base, 'surname', p.surname, LIMITS.surname);
    checkBilingual(own, base, 'nickname', p.nickname, LIMITS.nickname);
    checkEnum(own, base, 'gender', p.gender, GENDERS);
    checkDateObj(own, base, 'birth', p.birth, true);
    checkBool(own, base, 'deceased', p.deceased);
    checkDateObj(own, base, 'death', p.death, true);
    checkBilingual(own, base, 'occupation', p.occupation, LIMITS.text);
    checkBilingual(own, base, 'bio', p.bio, LIMITS.bio);
    const photo = checkString(own, base, 'photo', p.photo, LIMITS.text);
    if (photo && !PHOTO_PATH_RE.test(photo) && !(PHOTO_URL_RE.test(photo) && safeUrl(photo))) {
      err('BAD_PHOTO', { id, value: photo }, `${base}.photo`);
    }
    checkEnum(own, base, 'privacy', p.privacy, PRIVACY);
    for (const tag of checkStringList(own, base, 'tags', p.tags)) checkEnum(own, base, 'tags', tag, TAGS);
    checkString(own, base, 'needsInfo', p.needsInfo, LIMITS.needsInfo);
    checkPersonRef(id, base, 'duplicateOf', checkString(own, base, 'duplicateOf', p.duplicateOf));
    checkStringList(own, base, 'spouseOrder', p.spouseOrder);

    if (p.ties !== undefined) {
      if (!Array.isArray(p.ties)) typeErr(own, base, 'ties', 'array');
      else {
        const seen = new Set();
        p.ties.forEach((t, i) => {
          const f = `ties.${i}`;
          if (!isObj(t)) { typeErr(own, base, f, 'object'); return; }
          checkEnum(own, base, `${f}.type`, t.type, TIE_TYPES);
          const ref = checkString(own, base, `${f}.person`, t.person);
          if (!ref) typeErr(own, base, `${f}.person`, 'person id');
          checkPersonRef(id, base, `${f}.person`, ref);
          checkBilingual(own, base, `${f}.note`, t.note, LIMITS.text);
          const key = `${t.type}|${ref}`;
          if (seen.has(key)) err('DUPLICATE_TIE', { id, type: t.type, person: ref }, `${base}.${f}`);
          seen.add(key);
        });
      }
    }

    const removed = checkRemoved(own, base, p.removed);
    if (removed) {
      checkPersonRef(id, base, 'removed.mergedInto', removed.mergedInto);
      checkPersonRef(id, base, 'removed.with', removed.with);
    }

    if (p.history !== undefined) {
      if (!Array.isArray(p.history)) typeErr(own, base, 'history', 'array');
      else {
        if (p.history.length > LIMITS.history) {
          err('TOO_LONG', { id, field: 'history', max: LIMITS.history, length: p.history.length }, `${base}.history`);
        }
        p.history.forEach((h, i) => { if (!isObj(h)) typeErr(own, base, `history.${i}`, 'object'); });
      }
    }

    // 3. nameStatus rules
    const nameStatus = p.nameStatus ?? 'known';
    const nm = isObj(p.name) ? p.name : {};
    const nick = isObj(p.nickname) ? p.nickname : {};
    const hasName = str(nm.ar) !== '' || str(nm.en) !== '';
    if (nameStatus === 'known') {
      if (!hasName && str(nick.ar) === '' && str(nick.en) === '') err('NAME_REQUIRED', { id }, `${base}.name`);
    } else if (NAME_STATUSES.includes(nameStatus) && hasName) {
      err('NAME_SHOULD_BE_EMPTY', { id, nameStatus }, `${base}.name`);
    }

    // 11. privacy truncation respected
    const privacy = p.privacy ?? 'full';
    if (isObj(p.birth) && (privacy === 'year' || privacy === 'hidden')) {
      for (const f of ['date', 'hijri']) {
        const v = p.birth[f];
        if (!isStr(v) || !v) continue;
        if (privacy === 'hidden' || v.includes('-')) {
          err('PRIVATE_DATE_STORED', { id, field: `birth.${f}`, privacy, value: v }, `${base}.birth.${f}`);
        }
      }
    }
  }

  // --- unions (invariants 2, 4, 5) --------------------------------------------------------------------------
  /** Active unions with their checked partner/child lists, for the graph invariants below. */
  const active = [];
  for (const [uid, u] of Object.entries(unions)) {
    const base = `unions.${uid}`;
    const own = { union: uid };
    if (!isObj(u)) { err('BAD_TYPE', { union: uid, field: '', expected: 'object' }, base); continue; }
    if (u.id !== uid) err('ID_MISMATCH', { key: uid, id: u.id ?? null, kind: 'union' }, `${base}.id`);
    if (!(isUnionId(uid) || (allowTempIds && (isTempUnionRef(uid) || isPreviewUnionId(uid))))) {
      err('BAD_ID', { id: uid, kind: 'union' }, base);
    }
    for (const k of Object.keys(u)) if (!UNION_KEY_SET.has(k)) warn('UNKNOWN_FIELD', { union: uid, field: k }, `${base}.${k}`);

    const partners = checkStringList(own, base, 'partners', u.partners);
    const children = checkStringList(own, base, 'children', u.children);
    if (partners.length > 2) err('TOO_MANY_PARTNERS', { union: uid, count: partners.length }, `${base}.partners`);
    const seenP = new Set();
    for (const pid of partners) {
      if (seenP.has(pid)) err('DUPLICATE_PARTNER', { union: uid, person: pid }, `${base}.partners`);
      seenP.add(pid);
      if (!person(pid)) err('MISSING_PERSON', { union: uid, field: 'partners', ref: pid }, `${base}.partners`);
    }
    const seenC = new Set();
    for (const cid of children) {
      if (seenC.has(cid)) err('DUPLICATE_CHILD', { union: uid, person: cid }, `${base}.children`);
      seenC.add(cid);
      if (!person(cid)) err('MISSING_PERSON', { union: uid, field: 'children', ref: cid }, `${base}.children`);
      if (seenP.has(cid)) err('PARTNER_IS_CHILD', { union: uid, person: cid }, `${base}.children`);
    }
    checkEnum(own, base, 'status', u.status, UNION_STATUSES);
    checkDateObj(own, base, 'marriage', u.marriage, true);
    checkDateObj(own, base, 'divorce', u.divorce, false);
    checkBilingual(own, base, 'note', u.note, LIMITS.unionNote);
    const removed = checkRemoved(own, base, u.removed);
    if (removed) {
      // A merged union points at the union it was folded into; an auto-removed one at the removed person.
      const into = removed.mergedInto;
      if (isStr(into) && into) {
        if (into === uid) err('SELF_REFERENCE', { union: uid, field: 'removed.mergedInto' }, `${base}.removed.mergedInto`);
        else if (!isObj(unions[into]) || !hasOwn(unions, into)) {
          err('MISSING_UNION', { union: uid, field: 'removed.mergedInto', ref: into }, `${base}.removed.mergedInto`);
        }
      }
      if (isStr(removed.with) && removed.with && !person(removed.with)) {
        err('MISSING_PERSON', { union: uid, field: 'removed.with', ref: removed.with }, `${base}.removed.with`);
      }
    }
    if (!removed) {
      active.push({
        id: uid,
        u,
        partners: [...new Set(partners)].filter((pid) => person(pid)),
        children: [...new Set(children)].filter((cid) => person(cid) && !seenP.has(cid)),
        rawPartners: partners,
        rawChildren: children,
      });
    }
  }

  // --- 6. at most one non-removed birth union per person ------------------------------------------------------
  const birthUnions = new Map(); // child → [uid]
  for (const a of active) {
    for (const c of a.children) {
      if (!birthUnions.has(c)) birthUnions.set(c, []);
      birthUnions.get(c).push(a.id);
    }
  }
  for (const [cid, uids] of birthUnions) {
    if (uids.length > 1) err('MULTIPLE_BIRTH_UNIONS', { id: cid, unions: uids }, `people.${cid}`);
  }

  // --- 7. no cycles (ancestor = partner of a birth union, active unions only) --------------------------------
  const parentsOf = new Map(); // child → [parent]
  for (const a of active) {
    for (const c of a.children) {
      const list = parentsOf.get(c) || [];
      for (const pid of a.partners) if (pid !== c && !list.includes(pid)) list.push(pid);
      parentsOf.set(c, list);
    }
  }
  for (const cycle of findCycles(parentsOf)) err('CYCLE', { id: cycle[0], cycle }, `people.${cycle[0]}`);

  // --- 9. one active union per partner set ---------------------------------------------------------------------
  const unionByKey = new Map();
  for (const a of active) {
    const ps = [...new Set(a.rawPartners)];
    if (ps.length === 0 || ps.length > 2) continue;
    const key = ps.length === 2 ? [...ps].sort().join('|') : `single:${ps[0]}`;
    if (unionByKey.has(key)) {
      err('DUPLICATE_UNION', { union: a.id, other: unionByKey.get(key), partners: ps }, `unions.${a.id}`);
    } else unionByKey.set(key, a.id);
  }

  // --- 10. partners are not ancestor/descendant of each other ------------------------------------------------
  const ancestorMemo = new Map();
  const ancestorsOf = (id) => {
    let set = ancestorMemo.get(id);
    if (set) return set;
    set = new Set();
    const queue = [...(parentsOf.get(id) || [])];
    while (queue.length) {
      const x = queue.pop();
      if (set.has(x)) continue;
      set.add(x);
      for (const y of parentsOf.get(x) || []) if (!set.has(y)) queue.push(y);
    }
    ancestorMemo.set(id, set);
    return set;
  };
  for (const a of active) {
    if (a.partners.length !== 2) continue;
    const [x, y] = a.partners;
    if (ancestorsOf(y).has(x)) err('ANCESTOR_LINK', { union: a.id, ancestor: x, descendant: y }, `unions.${a.id}`);
    else if (ancestorsOf(x).has(y)) err('ANCESTOR_LINK', { union: a.id, ancestor: y, descendant: x }, `unions.${a.id}`);
  }

  // --- warnings ----------------------------------------------------------------------------------------------
  if (isObj(meta)) {
    const root = isStr(meta.rootPersonId) ? meta.rootPersonId : '';
    if (!root) {
      if (Object.keys(people).length) warn('ROOT_MISSING', { id: '' }, 'meta.rootPersonId');
    } else if (!person(root)) warn('ROOT_MISSING', { id: root }, 'meta.rootPersonId');
    else if (people[root].removed) warn('ROOT_REMOVED', { id: root }, 'meta.rootPersonId');
  }

  const activeById = new Map(active.map((a) => [a.id, a]));
  for (const [id, p] of Object.entries(people)) {
    if (!isObj(p) || p.removed) continue;
    const base = `people.${id}`;
    // stale spouseOrder: entries that are not active unions with this person as partner (or repeated)
    if (Array.isArray(p.spouseOrder) && p.spouseOrder.length) {
      const seen = new Set();
      const stale = p.spouseOrder.filter((uid) => {
        const bad = seen.has(uid) || !activeById.has(uid) || !activeById.get(uid).partners.includes(id);
        seen.add(uid);
        return bad;
      });
      if (stale.length) warn('SPOUSE_ORDER_STALE', { id, unions: stale }, `${base}.spouseOrder`);
    }
    if (isDeceasedRaw(p)) {
      const b = tolerantSpan(p.birth);
      const d = tolerantSpan(p.death);
      if (b && d && d.end < b.start) warn('DEATH_BEFORE_BIRTH', { id }, `${base}.death`);
    }
  }

  const marriedTo = new Map(); // woman → [uid] of "married" unions with a living other partner
  for (const a of active) {
    const { id: uid, u } = a;
    const base = `unions.${uid}`;
    const ps = a.partners.map((pid) => ({ id: pid, p: people[pid] }));
    const status = u.status ?? 'unknown';
    const members = a.rawPartners.length + a.rawChildren.length;
    if (members < 2) warn('SMALL_UNION', { union: uid, members }, base);

    if (ps.length === 2) {
      const [g1, g2] = ps.map((x) => x.p.gender ?? '');
      if (g1 && g1 === g2) warn('SAME_GENDER_PARTNERS', { union: uid, gender: g1 }, `${base}.partners`);
      if (status === 'widowed' && !ps.some((x) => isDeceasedRaw(x.p))) warn('WIDOWED_BUT_LIVING', { union: uid }, `${base}.status`);
      if (status === 'married') {
        for (const [me, other] of [[ps[0], ps[1]], [ps[1], ps[0]]]) {
          if ((me.p.gender ?? '') !== 'f' || me.p.removed || isDeceasedRaw(other.p) || other.p.removed) continue;
          if (!marriedTo.has(me.id)) marriedTo.set(me.id, []);
          marriedTo.get(me.id).push(uid);
        }
      }
    }
    const divorce = isObj(u.divorce) ? u.divorce : {};
    if ((str(divorce.date) || str(divorce.hijri)) && status !== 'divorced') {
      warn('DIVORCE_DATE_WITHOUT_STATUS', { union: uid, status }, `${base}.divorce`);
    }

    const m = tolerantSpan(u.marriage);
    if (m) {
      for (const { id, p } of ps) {
        const b = tolerantSpan(p.birth);
        if (b && m.end < addYearsToDay(b.start, 12)) warn('MARRIAGE_BEFORE_12', { union: uid, id }, `${base}.marriage`);
        const d = isDeceasedRaw(p) ? tolerantSpan(p.death) : null;
        if (d && m.start > d.end) warn('MARRIAGE_AFTER_DEATH', { union: uid, id }, `${base}.marriage`);
      }
    }

    if (!a.children.length) continue;
    for (const { id, p } of ps) {
      if (!p.removed && !(p.gender ?? '')) warn('PARENT_GENDER_UNKNOWN', { union: uid, id }, `${base}.partners`);
    }
    const kids = a.children.filter((cid) => isActivePerson(cid)).map((cid) => ({ id: cid, p: people[cid] }));
    for (const kid of kids) {
      const cb = tolerantSpan(kid.p.birth);
      if (!cb) continue;
      for (const { id: pid, p } of ps) {
        const pb = tolerantSpan(p.birth);
        if (pb && cb.end < addYearsToDay(pb.start, 12)) {
          warn('BORN_BEFORE_PARENT_12', { id: kid.id, parent: pid, union: uid }, `people.${kid.id}.birth`);
        }
        const pd = isDeceasedRaw(p) ? tolerantSpan(p.death) : null;
        if (!pd) continue;
        if (p.gender === 'm' && cb.start > addYearsToDay(pd.end, 1)) {
          warn('BORN_AFTER_FATHER_DEATH', { id: kid.id, parent: pid, union: uid }, `people.${kid.id}.birth`);
        } else if (p.gender === 'f' && cb.start > pd.end) {
          warn('BORN_AFTER_MOTHER_DEATH', { id: kid.id, parent: pid, union: uid }, `people.${kid.id}.birth`);
        }
      }
    }
    // siblings with the same normalized given name: compare Arabic when both have it, else English
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const na = isObj(kids[i].p.name) ? kids[i].p.name : {};
        const nb = isObj(kids[j].p.name) ? kids[j].p.name : {};
        let same = '';
        if (str(na.ar) && str(nb.ar)) same = nameKey(na.ar) === nameKey(nb.ar) ? str(na.ar) : '';
        else if (str(na.en) && str(nb.en)) same = nameKey(na.en) === nameKey(nb.en) ? str(na.en) : '';
        if (same) warn('SIBLING_SAME_NAME', { union: uid, a: kids[i].id, b: kids[j].id, name: same }, `${base}.children`);
      }
    }
  }
  for (const [id, uids] of marriedTo) {
    if (uids.length > 1) warn('CONCURRENT_HUSBANDS', { id, unions: uids }, `people.${id}`);
  }

  return result();
}

/** True when `s` parses as an absolute https URL. */
function safeUrl(s) {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Cycles in a child → parents graph (iterative DFS). Each cycle is reported once, as the list of people on it
 * (starting with the person where the DFS entered it).
 */
function findCycles(parentsOf) {
  const color = new Map(); // undefined = unvisited, 1 = on stack, 2 = done
  const cycles = [];
  const seen = new Set();
  for (const start of parentsOf.keys()) {
    if (color.get(start)) continue;
    const stack = [[start, 0]];
    const path = [start];
    color.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const parents = parentsOf.get(top[0]) || [];
      if (top[1] < parents.length) {
        const next = parents[top[1]++];
        const c = color.get(next);
        if (!c) {
          color.set(next, 1);
          stack.push([next, 0]);
          path.push(next);
        } else if (c === 1) {
          const cycle = path.slice(path.indexOf(next));
          const key = [...cycle].sort().join(',');
          if (!seen.has(key)) { seen.add(key); cycles.push(cycle); }
        }
      } else {
        color.set(top[0], 2);
        stack.pop();
        path.pop();
      }
    }
  }
  return cycles;
}
