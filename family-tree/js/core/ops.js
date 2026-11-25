// Proposals (docs/SPEC.md §3): validation, application in preview and final mode, dependency helpers, hashing.
// Pure ES module — runs unchanged in modern browsers and Node ≥ 20 (no DOM, no fetch, no node: imports).
//
// Exports
//   validateProposal(p, {refMap?})          → {ok, errors, warnings}   shape, types, limits, ref declaration order
//   applyProposal(data, p, opts)            → {ok, data, errors, warnings, idMap, touched, created, destructive, reparent, merges}
//   applyProposals(data, [p…], opts)        → the same, for several proposals in sequence (failing ones are skipped)
//   isDestructive(p) · newProposal() · opRefs(op) → {declares, uses} · proposalHash(p) (async) · skipOps(p, indexes)
//   FP_LENGTH · fingerprintOf(hash)        the approval fingerprint: the first 16 hex chars (64 bits) of proposalHash
//   OPS_ERROR_CODES · OPS_WARNING_CODES · OPS_ISSUE_CODES
//
// Conventions
//   * An op is an object whose `op` key names the operation: {"op":"add-person", "ref":"new1", "person":{…}, …}.
//   * Every problem is an Issue {code, params, op?, path?}; `op` is the 0-based index into proposal.ops,
//     `path` the field inside the proposal ("ops.3.link.of"). Data-level issues found by the post-condition
//     (validateData) carry the data path instead and no `op`.
//   * Person refs: existing id "p…" or temp ref "newN" (declared by add-person `ref`). Union refs: existing id "u…"
//     or temp ref "newuN" (bound by an op's `unionRef`). Preview-only union ids "tmpuN" cannot be referenced.

import {
  DESTRUCTIVE_OPS, GENDERS, LIMITS, LINK_TYPES, MARKS, NAME_STATUSES, OP_TYPES, PARENT_SCOPES, PERSON_EDIT_PATHS,
  PERSON_INPUT_FIELDS, PRIVACY, REASON_CODES, SIBLING_SHARES, TIE_TYPES, UNION_EDIT_PATHS, UNION_STATUSES,
  applyPersonSet, applyUnionSet, isPersonRef, isTempPersonRef, isTempUnionRef, isUnionRef,
  newProposalId, normalizeData, normalizePerson, normalizeUnion, randomId, validateData,
} from './schema.js';
import { canonicalDate, canonicalHijri, isMinor, parseDate } from './dates.js';
import { looksLikeFullName, searchKey } from './names.js';
import { englishOf } from './translit.js';

// =========================================================================================================
// Issue codes

/** Error codes ops.js emits itself (the post-condition can add any schema.js SCHEMA_ERROR_CODES code). */
export const OPS_ERROR_CODES = Object.freeze([
  // envelope & op shape (validateProposal)
  'NOT_A_PROPOSAL', //         {kind?|found?}                 not an object / kind ≠ "gft-proposal"
  'BAD_VERSION', //            {found, expected}              v ≠ 1
  'BAD_TYPE', //               {field, expected}              wrong JSON type / shape
  'MISSING_FIELD', //          {field}                        required field absent or empty
  'BAD_ENUM', //               {field, value, allowed}        value outside its enumeration
  'BAD_DATE', //               {field, value}                 not a real "YYYY[-MM[-DD]]" Gregorian date
  'BAD_HIJRI', //              {field, value}                 not a real Hijri date
  'BAD_PHOTO', //              {field, value}                 not "" / https URL / photos/<pid>.jpg|webp
  'TOO_LONG', //               {field, max, length}           text or list over its limit
  'NO_OPS', //                 {}                             ops empty
  'TOO_MANY_OPS', //           {count, max}                   > LIMITS.ops
  'UNKNOWN_OP', //             {type}                         op name not in OP_TYPES
  'UNKNOWN_FIELD', //          {field}                        key not allowed in an op / PersonInput / set (error there)
  'BAD_REF', //                {field, value, expected}       value is not a person / union reference
  'TEMP_NOT_ALLOWED', //       {field, ref}                   destructive op on a temp ref
  'TOO_MANY_DESTRUCTIVE', //   {count, max}                   > 3 non-merge destructive ops
  'TOO_MANY_MERGES', //        {count, max}                   > 30 merges
  // references
  'DUPLICATE_REF', //          {ref, field}                   temp ref declared twice / unionRef bound to two unions
  'UNKNOWN_REF', //            {ref, field}                   temp ref not declared (before use)
  'UNKNOWN_ID', //             {ref, field}                   id that does not exist
  'DEPENDS_ON_PENDING', //     {proposalId, pending, ref, field}  ref of a dependsOn proposal not applied yet
  'TARGET_REMOVED', //         {id|union, field}              target soft-removed (no mergedInto to follow)
  // operations
  'NAME_REQUIRED', //          {id}                           nameStatus known without name/nickname
  'NAME_SHOULD_BE_EMPTY', //   {id, nameStatus}               unknown/withheld with a name
  'STALE_EDIT', //             {id|union, path, expected, actual}  `before` ≠ current (error in final mode unless force)
  'SAME_PERSON', //            {a, b, union?}                 the same person twice where two are needed
  'DUPLICATE_UNION', //        {union, other?, partners}      an active union with this partner set exists
  'ANCESTOR_LINK', //          {ancestor, descendant, union?} partners would be ancestor/descendant
  'CYCLE', //                  {id, union}                    a person would become their own ancestor
  'INVALID_RELATION', //       {id, union?}                   move a person under a union they are a partner of
  'PARENTS_FULL', //           {id, union}                    add parent: birth union already has 2 partners
  'PARENT_GENDER_CONFLICT', // {id, parent, gender}           add parent: same gender as the existing parent
  'FATHER_UNKNOWN', //         {id}                           add sibling via father: no male parent
  'MOTHER_UNKNOWN', //         {id}                           add sibling via mother: no female parent
  'DUPLICATE_TIE', //          {id, type, person}
  'TIE_NOT_FOUND', //          {id, type, person}             remove-tie: no such tie
  'NOT_REMOVED', //            {id|union}                     restore of something that is not removed
  'RESTORE_CONFLICT', //       {reason, id?|union?, other?}   restore would break invariants 6/9/10 or create a cycle
  'MERGED_USE_UNDO', //        {id|union, mergedInto}         restore of a merged record (use /undo)
  'IS_ROOT', //                {id}
  'HAS_CHILDREN', //           {id|union, children}           active children block the removal
  'ALREADY_REMOVED', //        {id}
  'NOT_A_COUPLE', //           {union, partners}              unlink-spouse on a union without 2 partners
  'NO_PARENTS', //             {id}                           detach-person: no birth union
  'MERGE_SPOUSES', //          {keep, remove, union}          merge two partners of one union
  'GENDER_CONFLICT', //        {keep, remove, keepGender, removeGender}
  'CONFLICTING_PARENTS', //    {keep, remove, keepUnion, removeUnion}  different birth unions, no `parents` choice
  'DESTRUCTIVE_NOT_ALLOWED', //{type, reason?}                destructive op (or REPARENT) without allowDestructive
]);

/** Warning codes ops.js emits itself (the post-condition adds NEW schema.js warnings, e.g. SIBLING_SAME_NAME). */
export const OPS_WARNING_CODES = Object.freeze([
  'UNKNOWN_FIELD', //          {field}                        unknown envelope key (ignored)
  'POSSIBLE_DUPLICATE', //     {id, ref, reason}              an active person looks like the one being added
  'MINOR_DETAIL', //           {id, fields}                   a person under 18 with photo/bio/occupation/birth place/full date
  'NAME_LOOKS_FULL', //        {id, name}                     given name looks like a full name
  'GENDER_MISSING', //         {id}
  'STALE_EDIT', //             (preview mode, or final with force)
  'GENDER_FLIPS_PARENT', //    {id, from, to}
  'REPARENT', //               {id, from, to, droppedParents, descendants}  known parents dropped (destructive)
  'ORDER_IGNORED', //          {union|id, ids}                order entries that are not children / unions of id
  'MERGED_REDIRECT', //        {field, from, to}              ref to a merged record followed to its mergedInto
  'MERGE_FIELD_CONFLICT', //   {path, keep, remove}           merge: both have different values (keep wins)
]);

/** Every code ops.js can emit itself (errors ∪ warnings). */
export const OPS_ISSUE_CODES = Object.freeze([...new Set([...OPS_ERROR_CODES, ...OPS_WARNING_CODES])]);

// =========================================================================================================
// Small helpers

const hasOwn = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const uniq = (list) => [...new Set(list)];
const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Read a dotted path ("birth.place.ar") of a plain object. */
function getPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Sortable number for "YYYY[-MM[-DD]]" (same rule as graph.js), or null. */
function dateNum(s) {
  const m = /^(\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(isStr(s) ? s.trim() : '');
  if (!m) return null;
  return Number(m[1]) * 10000 + (Number(m[2]) || 0) * 100 + (Number(m[3]) || 0);
}

/** Is date a strictly later than date b, compared at their common precision? (unknown → false) */
function laterThan(a, b) {
  const pa = parseDate(a);
  const pb = parseDate(b);
  if (!pa || !pb) return false;
  if (pa.year !== pb.year) return pa.year > pb.year;
  if (!pa.month || !pb.month || pa.month === pb.month) {
    if (!pa.month || !pb.month) return false;
    if (!pa.day || !pb.day) return false;
    return pa.day > pb.day;
  }
  return pa.month > pb.month;
}

const PHOTO_PATH_RE = /^photos\/p[a-z0-9]{3,24}\.(?:jpg|webp)$/;
const PHOTO_URL_RE = /^https:\/\/[^\s"'<>\\]+$/;
function validPhoto(s) {
  if (s === '' || PHOTO_PATH_RE.test(s)) return true;
  if (!PHOTO_URL_RE.test(s)) return false;
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}

const PROPOSAL_ID_RE = /^[a-z0-9]{4,32}$/;
const members = (u) => u.partners.length + u.children.length;
const emptyBi = () => ({ ar: '', en: '' });

/** Compact comparison key of a name ("عبد الله" ≡ "عبدالله", case/diacritics ignored). */
const nameKey = (s) => searchKey(s).replace(/\s+/g, '');

/** Keys identifying a bilingual name: Arabic key and English key (stored or automatic English). */
function biKeys(field, kind = 'given') {
  const keys = [];
  if (field?.ar) keys.push(`ar:${nameKey(field.ar)}`);
  const en = englishOf(field, kind);
  if (en) keys.push(`en:${nameKey(en)}`);
  return keys.filter((k) => k.length > 3);
}
const sharesKey = (a, b) => a.some((k) => b.includes(k));

// =========================================================================================================
// Op table: allowed fields, reference fields

/** Required / optional fields per op (the `op` key itself is implicit). */
const OP_FIELDS = {
  'add-person': { required: ['ref', 'person'], optional: ['link', 'unionRef', 'index'] },
  'edit-person': { required: ['id', 'set'], optional: ['before'] },
  mark: { required: ['id', 'mark'], optional: ['date', 'hijri', 'of', 'note'] },
  'link-spouse': { required: ['a', 'b'], optional: ['status', 'marriage', 'unionRef'] },
  'move-person': { required: ['id', 'to'], optional: ['unionRef', 'index'] },
  'edit-union': { required: ['union', 'set'], optional: ['before', 'unionRef'] },
  'reorder-children': { required: ['union', 'order'], optional: ['beforeOrder', 'unionRef'] },
  'reorder-spouses': { required: ['id', 'order'], optional: [] },
  'add-tie': { required: ['id', 'type', 'person'], optional: ['note'] },
  'restore-person': { required: ['id'], optional: [] },
  'restore-union': { required: ['union'], optional: [] },
  'remove-person': { required: ['id', 'reasonCode'], optional: ['redact'] },
  'unlink-spouse': { required: ['union', 'reasonCode'], optional: [] },
  'detach-person': { required: ['id', 'reasonCode'], optional: [] },
  'remove-tie': { required: ['id', 'type', 'person', 'reasonCode'], optional: [] },
  'merge-person': { required: ['keep', 'remove', 'reasonCode'], optional: ['parents'] },
};

/** Reference fields per op: [path, kind, isList]. Used by validation and opRefs. */
const REF_FIELDS = {
  'add-person': [['link.of', 'person'], ['link.with', 'person'], ['link.otherParent', 'person'], ['link.union', 'union']],
  'edit-person': [['id', 'person']],
  mark: [['id', 'person'], ['of', 'person']],
  'link-spouse': [['a', 'person'], ['b', 'person']],
  'move-person': [['id', 'person'], ['to.union', 'union'], ['to.of', 'person'], ['to.with', 'person']],
  'edit-union': [['union', 'union']],
  'reorder-children': [['union', 'union'], ['order', 'person', true], ['beforeOrder', 'person', true]],
  'reorder-spouses': [['id', 'person'], ['order', 'union', true]],
  'add-tie': [['id', 'person'], ['person', 'person']],
  'restore-person': [['id', 'person']],
  'restore-union': [['union', 'union']],
  'remove-person': [['id', 'person']],
  'unlink-spouse': [['union', 'union']],
  'detach-person': [['id', 'person']],
  'remove-tie': [['id', 'person'], ['person', 'person']],
  'merge-person': [['keep', 'person'], ['remove', 'person']],
};

const LINK_FIELDS = {
  child: ['as', 'of', 'with', 'union'],
  spouse: ['as', 'of', 'status', 'marriage'],
  parent: ['as', 'of', 'scope'],
  sibling: ['as', 'of', 'share', 'otherParent'],
};

const ENVELOPE_KEYS = ['kind', 'v', 'id', 'createdAt', 'baseRevision', 'dependsOn', 'submitter', 'note', 'ops'];
const NON_MERGE_DESTRUCTIVE = DESTRUCTIVE_OPS.filter((t) => t !== 'merge-person');

/** Value type of an edit path (edit-person `set` / edit-union `set`). */
function pathType(path) {
  if (path === 'nameStatus') return { kind: 'enum', allowed: NAME_STATUSES };
  if (path === 'gender') return { kind: 'enum', allowed: GENDERS };
  if (path === 'privacy') return { kind: 'enum', allowed: PRIVACY };
  if (path === 'status') return { kind: 'enum', allowed: UNION_STATUSES };
  if (path === 'deceased' || path.endsWith('.approx')) return { kind: 'bool' };
  if (path.endsWith('.date')) return { kind: 'date' };
  if (path.endsWith('.hijri')) return { kind: 'hijri' };
  if (path === 'photo') return { kind: 'photo' };
  if (path.includes('.place.')) return { kind: 'text', max: LIMITS.place };
  const head = path.split('.')[0];
  const max = { name: LIMITS.name, surname: LIMITS.surname, nickname: LIMITS.nickname, bio: LIMITS.bio, note: LIMITS.unionNote }[head];
  return { kind: 'text', max: max ?? LIMITS.text };
}

// =========================================================================================================
// Static helpers: newProposal, isDestructive, opRefs, skipOps, proposalHash

/** A fresh, empty proposal envelope (§3.1) with a new random id. Add ops before sending (1..150). */
export function newProposal() {
  return {
    kind: 'gft-proposal',
    v: 1,
    id: newProposalId(),
    createdAt: new Date().toISOString(),
    baseRevision: 0,
    dependsOn: [],
    submitter: { name: '', relation: '', personId: '' },
    note: '',
    ops: [],
  };
}

/** Does the proposal contain a destructive op? (static; a move-person REPARENT is only known after apply) */
export function isDestructive(p) {
  return Array.isArray(p?.ops) && p.ops.some((op) => isObj(op) && DESTRUCTIVE_OPS.includes(op.op));
}

/**
 * References of one op: `declares` = temp refs it introduces (add-person `ref`, and `unionRef` unless the op also
 * uses that union ref explicitly), `uses` = every value of its person/union reference fields (incl. link.of/with/
 * otherParent/union, to.*, order[], beforeOrder[], mark `of`, tie person, keep/remove, a/b).
 */
export function opRefs(op) {
  const declares = [];
  const uses = [];
  if (!isObj(op)) return { declares, uses };
  for (const [path, , list] of REF_FIELDS[op.op] || []) {
    const v = getPath(op, path);
    if (list) {
      if (Array.isArray(v)) for (const x of v) if (isStr(x) && x) uses.push(x);
    } else if (isStr(v) && v) uses.push(v);
  }
  if (op.op === 'add-person' && isStr(op.ref) && op.ref) declares.push(op.ref);
  if (isStr(op.unionRef) && op.unionRef && !uses.includes(op.unionRef)) declares.push(op.unionRef);
  return { declares: uniq(declares), uses: uniq(uses) };
}

/**
 * The proposal without the ops at `indexes` (0-based) and without every later op that depends on a ref they
 * declared (transitively). A union ref bound earlier by a kept op stays alive; a kept op that re-binds a dead union
 * ref revives it. Returns a new proposal (same id); the input is not mutated.
 */
export function skipOps(p, indexes) {
  const skip = new Set((Array.isArray(indexes) ? indexes : [indexes]).map(Number));
  const dead = new Set();
  const alive = new Set();
  const ops = [];
  (Array.isArray(p?.ops) ? p.ops : []).forEach((op, i) => {
    const { declares, uses } = opRefs(op);
    if (skip.has(i) || uses.some((u) => dead.has(u))) {
      for (const d of declares) if (!alive.has(d)) dead.add(d);
      return;
    }
    for (const d of declares) {
      alive.add(d);
      dead.delete(d);
    }
    ops.push(clone(op));
  });
  return { ...clone(p), ops };
}

/** JSON with object keys sorted (recursively); undefined values dropped as JSON.stringify does. */
export function canonicalJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) {
    return `[${v.map((x) => (x === undefined || typeof x === 'function' ? 'null' : canonicalJSON(x))).join(',')}]`;
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== 'function').sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`).join(',')}}`;
}

/** SHA-256 hex of the canonical JSON of the proposal without `createdAt` (async, crypto.subtle). */
export async function proposalHash(p) {
  const rest = isObj(p) ? { ...p } : p;
  if (isObj(rest)) delete rest.createdAt;
  const bytes = new TextEncoder().encode(canonicalJSON(rest));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Length of the fingerprint the owner types in "/approve <fp>" (docs/SPEC.md §6.2): 16 hex chars = 64 bits, so no
 * second proposal with the same fingerprint can be ground out (6 chars = 24 bits took seconds).
 */
export const FP_LENGTH = 16;

/** The fingerprint of a proposalHash (its first FP_LENGTH hex chars; '' when there is no hash). */
export const fingerprintOf = (hash) => String(hash || '').slice(0, FP_LENGTH);

// =========================================================================================================
// validateProposal

/**
 * Static checks of a proposal: envelope, op shapes, types, enumerations, dates, limits, destructive caps and the
 * declaration order of temp refs. `refMap` (refs resolvable from dependsOn proposals) only relaxes UNKNOWN_REF:
 * an undeclared temp ref is accepted when refMap has it or dependsOn is non-empty (applyProposal decides then).
 */
export function validateProposal(p, { refMap = null } = {}) {
  const errors = [];
  const warnings = [];
  const push = (list, code, params, op, path) => {
    const issue = { code, params };
    if (op !== undefined) issue.op = op;
    if (path) issue.path = path;
    list.push(issue);
  };
  const E = (code, params, op, path) => push(errors, code, params, op, path);
  const result = () => ({ ok: errors.length === 0, errors, warnings });

  if (!isObj(p)) {
    E('NOT_A_PROPOSAL', { found: typeName(p) });
    return result();
  }
  if (p.kind !== 'gft-proposal') E('NOT_A_PROPOSAL', { kind: p.kind ?? null }, undefined, 'kind');
  if (p.v !== 1) E('BAD_VERSION', { found: p.v ?? null, expected: 1 }, undefined, 'v');
  for (const k of Object.keys(p)) if (!ENVELOPE_KEYS.includes(k)) push(warnings, 'UNKNOWN_FIELD', { field: k }, undefined, k);

  // --- envelope fields --------------------------------------------------------------------------------
  if (p.id === undefined || p.id === '') E('MISSING_FIELD', { field: 'id' }, undefined, 'id');
  else if (!isStr(p.id) || !PROPOSAL_ID_RE.test(p.id)) E('BAD_TYPE', { field: 'id', expected: 'proposal id' }, undefined, 'id');
  if (p.createdAt !== undefined && !isStr(p.createdAt)) E('BAD_TYPE', { field: 'createdAt', expected: 'string' }, undefined, 'createdAt');
  if (p.baseRevision !== undefined && !(Number.isInteger(p.baseRevision) && p.baseRevision >= 0)) {
    E('BAD_TYPE', { field: 'baseRevision', expected: 'integer ≥ 0' }, undefined, 'baseRevision');
  }
  const dependsOn = [];
  if (p.dependsOn !== undefined) {
    if (!Array.isArray(p.dependsOn)) E('BAD_TYPE', { field: 'dependsOn', expected: 'array' }, undefined, 'dependsOn');
    else {
      p.dependsOn.forEach((d, i) => {
        if (!isStr(d) || !PROPOSAL_ID_RE.test(d) || d === p.id) {
          E('BAD_TYPE', { field: `dependsOn.${i}`, expected: 'proposal id' }, undefined, `dependsOn.${i}`);
        } else dependsOn.push(d);
      });
    }
  }
  if (p.submitter !== undefined) {
    const s = p.submitter;
    if (!isObj(s)) E('BAD_TYPE', { field: 'submitter', expected: 'object' }, undefined, 'submitter');
    else {
      for (const k of Object.keys(s)) {
        if (!['name', 'relation', 'personId'].includes(k)) push(warnings, 'UNKNOWN_FIELD', { field: `submitter.${k}` }, undefined, `submitter.${k}`);
      }
      const limits = { name: LIMITS.name, relation: LIMITS.text, personId: 40 };
      for (const k of ['name', 'relation', 'personId']) {
        if (s[k] === undefined) continue;
        if (!isStr(s[k])) E('BAD_TYPE', { field: `submitter.${k}`, expected: 'string' }, undefined, `submitter.${k}`);
        else if (s[k].length > limits[k]) E('TOO_LONG', { field: `submitter.${k}`, max: limits[k], length: s[k].length }, undefined, `submitter.${k}`);
      }
      if (isStr(s.personId) && s.personId && !isPersonRef(s.personId)) {
        E('BAD_REF', { field: 'submitter.personId', value: s.personId, expected: 'person' }, undefined, 'submitter.personId');
      }
    }
  }
  if (p.note !== undefined) {
    if (!isStr(p.note)) E('BAD_TYPE', { field: 'note', expected: 'string' }, undefined, 'note');
    else if (p.note.length > LIMITS.proposalNote) E('TOO_LONG', { field: 'note', max: LIMITS.proposalNote, length: p.note.length }, undefined, 'note');
  }

  // --- ops --------------------------------------------------------------------------------------------
  if (!Array.isArray(p.ops)) {
    E(p.ops === undefined ? 'MISSING_FIELD' : 'BAD_TYPE', p.ops === undefined ? { field: 'ops' } : { field: 'ops', expected: 'array' }, undefined, 'ops');
    return result();
  }
  if (p.ops.length === 0) E('NO_OPS', {}, undefined, 'ops');
  if (p.ops.length > LIMITS.ops) E('TOO_MANY_OPS', { count: p.ops.length, max: LIMITS.ops }, undefined, 'ops');
  p.ops.forEach((op, i) => checkOp(op, i, E));

  // destructive caps
  const destructive = p.ops.filter((op) => isObj(op) && NON_MERGE_DESTRUCTIVE.includes(op.op)).length;
  const merges = p.ops.filter((op) => isObj(op) && op.op === 'merge-person').length;
  if (destructive > LIMITS.destructive) E('TOO_MANY_DESTRUCTIVE', { count: destructive, max: LIMITS.destructive }, undefined, 'ops');
  if (merges > LIMITS.merges) E('TOO_MANY_MERGES', { count: merges, max: LIMITS.merges }, undefined, 'ops');

  // --- temp ref declaration order -----------------------------------------------------------------------
  const declaredAt = new Map(); // person ref → first declaring op
  const boundAt = new Map(); // union ref → first op carrying it as unionRef
  p.ops.forEach((op, i) => {
    if (!isObj(op)) return;
    if (op.op === 'add-person' && isTempPersonRef(op.ref)) {
      if (declaredAt.has(op.ref) || (refMap && hasOwn(refMap, op.ref))) E('DUPLICATE_REF', { ref: op.ref, field: 'ref' }, i, `ops.${i}.ref`);
      else declaredAt.set(op.ref, i);
    }
    // An op that also USES its own unionRef (e.g. {as:"child", union:"newu2"}, unionRef:"newu2") only re-binds a
    // union declared earlier or by a dependsOn proposal; it does not declare it (same rule as opRefs).
    if (isTempUnionRef(op.unionRef) && !boundAt.has(op.unionRef) && opRefs(op).declares.includes(op.unionRef)) {
      boundAt.set(op.unionRef, i);
    }
  });
  const external = (ref) => (refMap && hasOwn(refMap, ref)) || dependsOn.length > 0;
  p.ops.forEach((op, i) => {
    if (!isObj(op)) return;
    for (const [path, kind, list] of REF_FIELDS[op.op] || []) {
      if (list) continue; // order lists: unresolvable entries are ignored with ORDER_IGNORED at apply time
      const v = getPath(op, path);
      const temp = kind === 'person' ? isTempPersonRef(v) : isTempUnionRef(v);
      if (!temp) continue;
      const at = (kind === 'person' ? declaredAt : boundAt).get(v);
      if (at !== undefined ? at >= i : !external(v)) E('UNKNOWN_REF', { ref: v, field: path }, i, `ops.${i}.${path}`);
    }
  });
  return result();
}

/** Shape checks of one op (pushes errors through E with the op index). */
function checkOp(op, i, E) {
  const base = `ops.${i}`;
  const err = (code, params, field) => E(code, params, i, field ? `${base}.${field}` : base);
  if (!isObj(op)) {
    err('BAD_TYPE', { field: '', expected: 'object' });
    return;
  }
  const type = op.op;
  const spec = OP_FIELDS[type];
  if (!spec || !OP_TYPES.includes(type)) {
    err('UNKNOWN_OP', { type: type ?? null }, 'op');
    return;
  }
  const allowed = new Set(['op', ...spec.required, ...spec.optional]);
  for (const k of Object.keys(op)) if (!allowed.has(k)) err('UNKNOWN_FIELD', { field: k }, k);
  for (const k of spec.required) {
    if (op[k] === undefined || op[k] === null || op[k] === '') err('MISSING_FIELD', { field: k }, k);
  }

  // field checkers ------------------------------------------------------------------------------------
  const text = (field, v, max) => {
    if (v === undefined) return;
    if (!isStr(v)) err('BAD_TYPE', { field, expected: 'string' }, field);
    else if (max && v.length > max) err('TOO_LONG', { field, max, length: v.length }, field);
  };
  const enumOf = (field, v, list) => {
    if (v === undefined) return;
    if (!list.includes(v)) err('BAD_ENUM', { field, value: v, allowed: [...list] }, field);
  };
  const bool = (field, v) => {
    if (v !== undefined && typeof v !== 'boolean') err('BAD_TYPE', { field, expected: 'boolean' }, field);
  };
  const date = (field, v) => {
    if (v === undefined) return;
    if (!isStr(v)) err('BAD_TYPE', { field, expected: 'string' }, field);
    else if (v.trim() && canonicalDate(v) === null) err('BAD_DATE', { field, value: v }, field);
  };
  const hijri = (field, v) => {
    if (v === undefined) return;
    if (!isStr(v)) err('BAD_TYPE', { field, expected: 'string' }, field);
    else if (v.trim() && canonicalHijri(v) === null) err('BAD_HIJRI', { field, value: v }, field);
  };
  const photo = (field, v) => {
    if (v === undefined) return;
    text(field, v, LIMITS.text);
    if (isStr(v) && !validPhoto(v.trim())) err('BAD_PHOTO', { field, value: v }, field);
  };
  const keysOnly = (field, obj, keys) => {
    for (const k of Object.keys(obj)) if (!keys.includes(k)) err('UNKNOWN_FIELD', { field: `${field}.${k}` }, `${field}.${k}`);
  };
  const bilingual = (field, v, max) => {
    if (v === undefined) return;
    if (!isObj(v)) { err('BAD_TYPE', { field, expected: 'object {ar, en}' }, field); return; }
    keysOnly(field, v, ['ar', 'en']);
    text(`${field}.ar`, v.ar, max);
    text(`${field}.en`, v.en, max);
  };
  const dateObj = (field, v, withPlace) => {
    if (v === undefined) return;
    if (!isObj(v)) { err('BAD_TYPE', { field, expected: 'object' }, field); return; }
    keysOnly(field, v, withPlace ? ['date', 'hijri', 'approx', 'place'] : ['date', 'hijri', 'approx']);
    date(`${field}.date`, v.date);
    hijri(`${field}.hijri`, v.hijri);
    bool(`${field}.approx`, v.approx);
    if (withPlace) bilingual(`${field}.place`, v.place, LIMITS.place);
  };
  const index = (field, v) => {
    if (v !== undefined && !(Number.isInteger(v) && v >= 0)) err('BAD_TYPE', { field, expected: 'integer ≥ 0' }, field);
  };
  const stringList = (field, v) => {
    if (v === undefined) return;
    if (!Array.isArray(v)) { err('BAD_TYPE', { field, expected: 'array' }, field); return; }
    if (v.length > 1000) err('TOO_LONG', { field, max: 1000, length: v.length }, field);
    v.forEach((x, j) => { if (!isStr(x)) err('BAD_TYPE', { field: `${field}.${j}`, expected: 'string' }, `${field}.${j}`); });
  };
  const editSet = (field, set, paths) => {
    if (set === undefined) return;
    if (!isObj(set)) { err('BAD_TYPE', { field, expected: 'object' }, field); return; }
    if (field === 'set' && Object.keys(set).length === 0) err('MISSING_FIELD', { field }, field);
    for (const [path, v] of Object.entries(set)) {
      const f = `${field}.${path}`;
      if (!paths.includes(path)) { err('UNKNOWN_FIELD', { field: f }, f); continue; }
      if (field !== 'set') continue; // `before` values are compared, not stored
      const t = pathType(path);
      if (t.kind === 'enum') enumOf(f, v, t.allowed);
      else if (t.kind === 'bool') { if (typeof v !== 'boolean') err('BAD_TYPE', { field: f, expected: 'boolean' }, f); }
      else if (t.kind === 'date') { if (!isStr(v)) err('BAD_TYPE', { field: f, expected: 'string' }, f); else date(f, v); }
      else if (t.kind === 'hijri') { if (!isStr(v)) err('BAD_TYPE', { field: f, expected: 'string' }, f); else hijri(f, v); }
      else if (t.kind === 'photo') { if (!isStr(v)) err('BAD_TYPE', { field: f, expected: 'string' }, f); else photo(f, v); }
      else if (!isStr(v)) err('BAD_TYPE', { field: f, expected: 'string' }, f);
      else text(f, v, t.max);
    }
  };

  // reference fields: shape only (resolution happens at apply time) --------------------------------------
  for (const [path, kind, list] of REF_FIELDS[type]) {
    const v = getPath(op, path);
    if (list) { stringList(path, v); continue; }
    if (v === undefined || v === null || v === '') continue;
    const ok = kind === 'person' ? isPersonRef(v) : isUnionRef(v);
    if (!ok) err('BAD_REF', { field: path, value: v, expected: kind }, path);
    else if (DESTRUCTIVE_OPS.includes(type) && (isTempPersonRef(v) || isTempUnionRef(v))) {
      err('TEMP_NOT_ALLOWED', { field: path, ref: v }, path);
    }
  }
  if (op.unionRef !== undefined && !isTempUnionRef(op.unionRef)) {
    err('BAD_REF', { field: 'unionRef', value: op.unionRef, expected: 'newuN' }, 'unionRef');
  }
  if (op.reasonCode !== undefined && op.reasonCode !== '' && op.reasonCode !== null) enumOf('reasonCode', op.reasonCode, REASON_CODES);

  // per-op fields ---------------------------------------------------------------------------------------
  switch (type) {
    case 'add-person': {
      if (op.ref !== undefined && !isTempPersonRef(op.ref)) err('BAD_REF', { field: 'ref', value: op.ref, expected: 'newN' }, 'ref');
      index('index', op.index);
      const person = op.person;
      if (person !== undefined) {
        if (!isObj(person)) err('BAD_TYPE', { field: 'person', expected: 'object' }, 'person');
        else {
          for (const k of Object.keys(person)) {
            if (!PERSON_INPUT_FIELDS.includes(k)) err('UNKNOWN_FIELD', { field: `person.${k}` }, `person.${k}`);
          }
          bilingual('person.name', person.name, LIMITS.name);
          enumOf('person.nameStatus', person.nameStatus, NAME_STATUSES);
          bilingual('person.surname', person.surname, LIMITS.surname);
          bilingual('person.nickname', person.nickname, LIMITS.nickname);
          enumOf('person.gender', person.gender, GENDERS);
          dateObj('person.birth', person.birth, true);
          bool('person.deceased', person.deceased);
          dateObj('person.death', person.death, true);
          bilingual('person.occupation', person.occupation, LIMITS.text);
          bilingual('person.bio', person.bio, LIMITS.bio);
          photo('person.photo', person.photo);
          enumOf('person.privacy', person.privacy, PRIVACY);
          text('person.needsInfo', person.needsInfo, LIMITS.needsInfo);
        }
      }
      const link = op.link;
      if (link !== undefined) {
        if (!isObj(link)) { err('BAD_TYPE', { field: 'link', expected: 'object' }, 'link'); break; }
        if (!LINK_TYPES.includes(link.as)) { err('BAD_ENUM', { field: 'link.as', value: link.as ?? null, allowed: [...LINK_TYPES] }, 'link.as'); break; }
        keysOnly('link', link, LINK_FIELDS[link.as]);
        if (link.as === 'child') {
          if (!link.union && !link.of) err('MISSING_FIELD', { field: 'link.of' }, 'link.of');
          if (link.union && (link.of || link.with)) err('BAD_TYPE', { field: 'link', expected: '{union} or {of, with}' }, 'link');
        } else if (!link.of) err('MISSING_FIELD', { field: 'link.of' }, 'link.of');
        if (link.as === 'spouse') {
          enumOf('link.status', link.status, UNION_STATUSES);
          dateObj('link.marriage', link.marriage, true);
        }
        if (link.as === 'parent') enumOf('link.scope', link.scope, PARENT_SCOPES);
        if (link.as === 'sibling') enumOf('link.share', link.share, SIBLING_SHARES);
      }
      break;
    }
    case 'edit-person':
      editSet('set', op.set, PERSON_EDIT_PATHS);
      editSet('before', op.before, PERSON_EDIT_PATHS);
      break;
    case 'mark':
      enumOf('mark', op.mark, MARKS);
      date('date', op.date);
      hijri('hijri', op.hijri);
      text('note', op.note, LIMITS.needsInfo);
      if (op.mark === 'duplicate' && !op.of) err('MISSING_FIELD', { field: 'of' }, 'of');
      break;
    case 'link-spouse':
      enumOf('status', op.status, UNION_STATUSES);
      dateObj('marriage', op.marriage, true);
      break;
    case 'move-person': {
      index('index', op.index);
      const to = op.to;
      if (to === undefined || to === null) break;
      if (!isObj(to)) { err('BAD_TYPE', { field: 'to', expected: '{union} or {of, with}' }, 'to'); break; }
      keysOnly('to', to, ['union', 'of', 'with']);
      if (to.union && (to.of || to.with)) err('BAD_TYPE', { field: 'to', expected: '{union} or {of, with}' }, 'to');
      else if (!to.union && !to.of) err('MISSING_FIELD', { field: 'to.of' }, 'to.of');
      break;
    }
    case 'edit-union':
      editSet('set', op.set, UNION_EDIT_PATHS);
      editSet('before', op.before, UNION_EDIT_PATHS);
      break;
    case 'add-tie':
    case 'remove-tie':
      enumOf('type', op.type, TIE_TYPES);
      bilingual('note', op.note, LIMITS.text);
      break;
    case 'remove-person':
      bool('redact', op.redact);
      break;
    case 'merge-person':
      enumOf('parents', op.parents, ['keep', 'remove']);
      break;
    default:
      break;
  }
}

// =========================================================================================================
// applyProposal

const ABSENT = Symbol('absent');
/** Thrown to stop the current op after its errors were recorded. */
const ABORT = Object.freeze({ abort: true });
/** Thrown when the current op uses a ref whose declaring op failed: skipped silently (its cause is reported). */
const SKIP = Object.freeze({ skip: true });

/** Cache of validateData results per input data object (so warnings can be diffed cheaply). */
const validationCache = { preview: new WeakMap(), final: new WeakMap() };
function cachedValidation(data, mode) {
  if (!isObj(data)) return validateData(data, { allowTempIds: mode === 'preview' });
  const cache = validationCache[mode];
  let v = cache.get(data);
  if (!v) {
    v = validateData(data, { allowTempIds: mode === 'preview' });
    cache.set(data, v);
  }
  return v;
}
const issueKey = (x) => `${x.code}|${x.path ?? ''}|${JSON.stringify(x.params ?? {})}`;

/**
 * Apply a proposal to data (never mutated). See SPEC §3.5.
 * opts = {mode:"final"|"preview" (default preview), now (ISO), issue, actor, rev?, allowDestructive (preview: true,
 *         final: false), force, refMap {ref → id}, idGen?(prefix), appliedDeps? (ids of dependsOn proposals known to be
 *         applied — narrows DEPENDS_ON_PENDING)}
 * → {ok, data, errors, warnings, idMap, touched:{people,unions}, created:{people,unions}, destructive, reparent, merges}
 * On any error: ok:false, data = the input object (unchanged), every error listed (with `op` when op-specific).
 */
export function applyProposal(data, proposal, opts = {}) {
  const mode = opts.mode === 'final' ? 'final' : 'preview';
  const refMap = isObj(opts.refMap) ? opts.refMap : {};
  const failure = (errors, warnings = []) => ({
    ok: false,
    data,
    errors,
    warnings,
    idMap: {},
    touched: { people: [], unions: [] },
    created: { people: [], unions: [] },
    destructive: isDestructive(proposal),
    reparent: [],
    merges: 0,
  });

  const v = validateProposal(proposal, { refMap });
  if (!v.ok) return failure(v.errors, v.warnings);

  const work = normalizeData(data); // deep copy in full shape
  const s = new Session(data, work, proposal, {
    mode,
    refMap,
    now: isStr(opts.now) && opts.now ? opts.now : new Date().toISOString(),
    issue: opts.issue ?? null,
    actor: isStr(opts.actor) ? opts.actor : '',
    rev: opts.rev,
    allowDestructive: opts.allowDestructive ?? (mode === 'preview'),
    force: opts.force === true,
    idGen: typeof opts.idGen === 'function' ? opts.idGen : null,
    appliedDeps: opts.appliedDeps,
  });
  proposal.ops.forEach((op, i) => s.runOp(op, i));
  const warnings = [...v.warnings, ...s.warnings];
  if (s.errors.length) return failure(s.errors, warnings);

  s.endPass();
  const outcome = s.finish();

  // Post-condition: the result must satisfy the data invariants. Only problems NEW relative to the input count, so
  // a pre-existing defect never blocks the proposal that fixes it (and old warnings are not repeated).
  const before = cachedValidation(data, mode);
  const after = validateData(work, { allowTempIds: mode === 'preview' });
  validationCache[mode].set(work, after);
  const oldErrors = new Set(before.errors.map(issueKey));
  const newErrors = after.errors.filter((x) => !oldErrors.has(issueKey(x)));
  if (newErrors.length) return failure(newErrors, warnings);
  const oldWarnings = new Set(before.warnings.map(issueKey));
  warnings.push(...after.warnings.filter((x) => !oldWarnings.has(issueKey(x))));

  return {
    ok: true,
    data: work,
    errors: [],
    warnings,
    idMap: outcome.idMap,
    touched: outcome.touched,
    created: outcome.created,
    destructive: isDestructive(proposal) || s.reparent.length > 0,
    reparent: s.reparent,
    merges: s.merges,
  };
}

/**
 * Apply several proposals in sequence (e.g. the preview overlay of sent proposals). Refs declared by earlier
 * proposals resolve in later ones (their idMaps feed refMap). A failing proposal is skipped; the others still apply.
 * → {ok (all applied), data, results:[per proposal], errors (with `proposal` index), warnings, idMap, refMap, touched, created}
 */
export function applyProposals(data, proposals, opts = {}) {
  let cur = data;
  const refMap = { ...(isObj(opts.refMap) ? opts.refMap : {}) };
  const results = [];
  const errors = [];
  const warnings = [];
  const idMap = {};
  const touched = { people: new Set(), unions: new Set() };
  const created = { people: new Set(), unions: new Set() };
  (Array.isArray(proposals) ? proposals : []).forEach((p, k) => {
    const r = applyProposal(cur, p, { ...opts, refMap: { ...refMap } });
    results.push(r);
    errors.push(...r.errors.map((x) => ({ ...x, proposal: k })));
    warnings.push(...r.warnings.map((x) => ({ ...x, proposal: k })));
    if (!r.ok) return;
    cur = r.data;
    Object.assign(idMap, r.idMap);
    Object.assign(refMap, r.idMap);
    r.touched.people.forEach((x) => touched.people.add(x));
    r.touched.unions.forEach((x) => touched.unions.add(x));
    r.created.people.forEach((x) => created.people.add(x));
    r.created.unions.forEach((x) => created.unions.add(x));
  });
  return {
    ok: results.every((r) => r.ok),
    data: cur,
    results,
    errors,
    warnings,
    idMap,
    refMap,
    touched: { people: [...touched.people], unions: [...touched.unions] },
    created: { people: [...created.people], unions: [...created.unions] },
  };
}

// =========================================================================================================
// Session: the mutable working state of one applyProposal call.
//
// Every mutation goes through a journal: the state of each record before the proposal (`orig`, to compute what
// changed) and before the current op (`undo`, to roll a failed op back so later ops are judged on a consistent
// state and every error can be listed). Index structures (birth unions, partner unions) are rebuilt lazily after
// structural union changes.

class Session {
  constructor(input, work, proposal, o) {
    this.input = input;
    this.d = work;
    this.p = proposal;
    this.mode = o.mode;
    this.refMap = o.refMap;
    this.now = o.now;
    this.today = /^\d{4}-\d{2}-\d{2}/.test(o.now) ? o.now.slice(0, 10) : undefined;
    this.issue = o.issue;
    this.actor = o.actor;
    this.rev = Number.isInteger(o.rev) ? o.rev : (Number(work.meta.revision) || 0) + 1;
    this.allowDestructive = o.allowDestructive;
    this.force = o.force;
    this.idGen = o.idGen;
    this.appliedDeps = o.appliedDeps ? new Set(o.appliedDeps) : null;

    this.errors = [];
    this.warnings = [];
    this.personRefs = new Map(); // temp person ref → id (declared by committed ops)
    this.unionRefs = new Map(); // temp union ref → union id (bound by committed ops)
    this.failedRefs = new Set(); // refs declared by failed / skipped ops
    this.createdPeople = new Set();
    this.createdUnions = new Set();
    this.orig = new Map(); // "p:<id>" | "u:<id>" | "meta" → JSON before the proposal (null = did not exist)
    this.baseMembers = new Map(); // union id → member count before the proposal
    this.shrunkBy = new Map(); // union id → op that last removed a member
    this.actions = new Map(); // person id → [{action, from?, index?}] (history, final mode)
    this.targets = new Set(); // people an op was explicitly about although their record may not change (move/detach)
    this.reparent = [];
    this.merges = 0;
    this.tmpCounter = 0;
    this._idx = null;
    this._names = null;
    this.action = '';
  }

  // --- issues -------------------------------------------------------------------------------------------
  issueOf(code, params, field) {
    const x = { code, params, op: this.i };
    if (field) x.path = `ops.${this.i}.${field}`;
    return x;
  }
  err(code, params, field) { this.opErrors.push(this.issueOf(code, params, field)); }
  warn(code, params, field) { this.opWarnings.push(this.issueOf(code, params, field)); }
  /** Record an error and stop the op. */
  fail(code, params, field) {
    this.err(code, params, field);
    throw ABORT;
  }
  /** Stop the op if errors were recorded. */
  bail() { if (this.opErrors.length) throw ABORT; }
  /** STALE_EDIT: error in final mode (unless force), warning otherwise. */
  stale(params, field) {
    if (this.mode === 'final' && !this.force) this.err('STALE_EDIT', params, field);
    else this.warn('STALE_EDIT', params, field);
  }

  // --- op lifecycle -------------------------------------------------------------------------------------
  runOp(op, i) {
    this.op = op;
    this.i = i;
    this.action = op.op;
    this.opErrors = [];
    this.opWarnings = [];
    this.undo = new Map();
    this.opDeclares = new Map();
    this.opBinds = new Map();
    this.opActions = [];
    this.opTargets = [];
    this.usedUnion = null;
    this.opReparent = null;
    try {
      HANDLERS[op.op].call(this, op);
      this.bail();
      this.bindUnionRef(op);
      const destructive = DESTRUCTIVE_OPS.includes(op.op) || this.opReparent;
      if (destructive && !this.allowDestructive) {
        this.err('DESTRUCTIVE_NOT_ALLOWED', this.opReparent ? { type: op.op, reason: 'reparent' } : { type: op.op });
      }
      this.bail();
    } catch (e) {
      if (e !== ABORT && e !== SKIP) throw e;
      this.rollback();
      for (const d of opRefs(op).declares) {
        if (!this.personRefs.has(d) && !this.unionRefs.has(d) && !hasOwn(this.refMap, d)) this.failedRefs.add(d);
      }
      if (e === ABORT) this.errors.push(...this.opErrors);
      return;
    }
    // commit
    for (const [ref, id] of this.opDeclares) this.personRefs.set(ref, id);
    for (const [ref, id] of this.opBinds) {
      this.unionRefs.set(ref, id);
      this.failedRefs.delete(ref);
    }
    for (const [id, entry] of this.opActions) {
      if (!this.actions.has(id)) this.actions.set(id, []);
      this.actions.get(id).push(entry);
    }
    for (const id of this.opTargets) this.targets.add(id);
    if (this.opReparent) this.reparent.push(this.opReparent);
    this.warnings.push(...this.opWarnings);
  }

  rollback() {
    for (const [key, val] of this.undo) {
      if (key === 'meta') { this.d.meta = val; continue; }
      const coll = key[0] === 'p' ? this.d.people : this.d.unions;
      const id = key.slice(2);
      if (val === ABSENT) delete coll[id];
      else coll[id] = val;
    }
    this.undo = new Map();
    this._idx = null;
    this._names = null;
  }

  // --- journal & mutation primitives ---------------------------------------------------------------------
  save(kind, id) {
    const key = `${kind}:${id}`;
    const coll = kind === 'p' ? this.d.people : this.d.unions;
    const cur = hasOwn(coll, id) ? coll[id] : undefined;
    if (!this.orig.has(key)) {
      this.orig.set(key, cur ? JSON.stringify(cur) : null);
      if (kind === 'u' && cur) this.baseMembers.set(id, members(cur));
    }
    if (!this.undo.has(key)) this.undo.set(key, cur ? clone(cur) : ABSENT);
  }
  saveMeta() {
    if (!this.orig.has('meta')) this.orig.set('meta', JSON.stringify(this.d.meta));
    if (!this.undo.has('meta')) this.undo.set('meta', clone(this.d.meta));
  }
  /** Mutable person record (journaled; the current op is recorded for history). */
  mp(id, extra) {
    this.save('p', id);
    this.opActions.push([id, { action: this.action, ...(extra || {}) }]);
    return this.d.people[id];
  }
  /** Replace a person record (e.g. with an applyPersonSet result). */
  putPerson(id, record) {
    this.mp(id);
    this.d.people[id] = record;
  }
  /** Mutable union record (journaled). Call dirty() after structural changes (partners, children, removed). */
  mu(uid) {
    this.save('u', uid);
    return this.d.unions[uid];
  }
  dirty() {
    this._idx = null;
  }
  /** History entry with extras (move/detach) for a person whose record itself may not change. */
  target(id, extra) {
    this.opTargets.push(id);
    this.opActions.push([id, { action: this.action, ...(extra || {}) }]);
    this.save('p', id);
  }

  // --- indexes & graph queries ------------------------------------------------------------------------------
  idx() {
    if (this._idx) return this._idx;
    const birthOf = new Map();
    const partnerOf = new Map();
    const order = new Map();
    let n = 0;
    for (const [uid, u] of Object.entries(this.d.unions)) {
      order.set(uid, n++);
      if (u.removed) continue;
      for (const c of u.children) {
        const l = birthOf.get(c);
        if (l) { if (!l.includes(uid)) l.push(uid); } else birthOf.set(c, [uid]);
      }
      for (const pid of u.partners) {
        const l = partnerOf.get(pid);
        if (l) { if (!l.includes(uid)) l.push(uid); } else partnerOf.set(pid, [uid]);
      }
    }
    this._idx = { birthOf, partnerOf, order };
    return this._idx;
  }
  person(id) { return hasOwn(this.d.people, id) ? this.d.people[id] : null; }
  union(uid) { return hasOwn(this.d.unions, uid) ? this.d.unions[uid] : null; }
  isActive(id) { const p = this.person(id); return !!p && !p.removed; }
  /** Active birth unions of id (normally 0 or 1). */
  birthUnions(id) { return (this.idx().birthOf.get(id) || []).map((uid) => this.d.unions[uid]); }
  birthUnion(id) { return this.birthUnions(id)[0] || null; }
  /** Active unions where id is a partner. */
  unionsOf(id) { return (this.idx().partnerOf.get(id) || []).map((uid) => this.d.unions[uid]); }
  parentOfGender(id, gender) {
    const b = this.birthUnion(id);
    if (!b) return null;
    return b.partners.find((pid) => this.person(pid)?.gender === gender) || null;
  }
  father(id) { return this.parentOfGender(id, 'm'); }
  /** Blood ancestors of id via active unions (cycle-safe). */
  ancestors(id) {
    const seen = new Set();
    const stack = [id];
    while (stack.length) {
      const x = stack.pop();
      for (const u of this.birthUnions(x)) {
        for (const pid of u.partners) {
          if (!seen.has(pid)) { seen.add(pid); stack.push(pid); }
        }
      }
    }
    seen.delete(id);
    return seen;
  }
  isAncestor(a, b) { return a !== b && this.ancestors(b).has(a); }
  /** Blood descendants of id via active unions (cycle-safe). */
  descendants(id) {
    const seen = new Set();
    const stack = [id];
    while (stack.length) {
      const x = stack.pop();
      for (const u of this.unionsOf(x)) {
        for (const c of u.children) {
          if (!seen.has(c)) { seen.add(c); stack.push(c); }
        }
      }
    }
    seen.delete(id);
    return seen;
  }
  /** The active union with exactly this partner set (excluding `except`), or null. */
  findUnion(partners, except = null) {
    const set = uniq(partners);
    if (!set.length) return null;
    for (const u of this.unionsOf(set[0])) {
      if (u.id === except) continue;
      const ps = uniq(u.partners);
      if (ps.length === set.length && set.every((x) => ps.includes(x))) return u;
    }
    return null;
  }
  /** id's active unions in display order (graph.js rule): spouseOrder, marriage date, insertion. */
  displayUnions(id) {
    const { order } = this.idx();
    const so = new Map((this.person(id)?.spouseOrder || []).map((u, k) => [u, k]));
    const big = Number.MAX_SAFE_INTEGER;
    return this.unionsOf(id)
      .map((u) => ({ id: u.id, k: [so.has(u.id) ? so.get(u.id) : big, dateNum(u.marriage.date) ?? big, order.get(u.id) ?? 0] }))
      .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2])
      .map((x) => x.id);
  }
  activeChildren(u) { return u.children.filter((c) => this.isActive(c)); }

  // --- reference resolution (§3.2) ------------------------------------------------------------------------
  pendingDeps() {
    const deps = Array.isArray(this.p.dependsOn) ? this.p.dependsOn : [];
    return this.appliedDeps ? deps.filter((d) => !this.appliedDeps.has(d)) : deps;
  }
  /** Temp ref → id (local declaration, then refMap). Real-looking ids pass through. */
  refId(value, kind, field) {
    const temp = kind === 'person' ? isTempPersonRef(value) : isTempUnionRef(value);
    if (!temp) return value;
    const local = (kind === 'person' ? this.personRefs : this.unionRefs).get(value)
      ?? (kind === 'person' ? this.opDeclares : this.opBinds).get(value);
    if (local !== undefined) return local;
    if (this.failedRefs.has(value)) throw SKIP;
    if (hasOwn(this.refMap, value)) return this.refMap[value];
    const pending = this.pendingDeps();
    if (pending.length) this.fail('DEPENDS_ON_PENDING', { proposalId: pending[0], pending, ref: value, field }, field);
    return this.fail('UNKNOWN_REF', { ref: value, field }, field);
  }
  /** Follow removed.mergedInto (≤ LIMITS.redirectHops); returns the active record id or null. */
  followMerged(coll, id) {
    let cur = id;
    for (let hops = 0; hops < LIMITS.redirectHops; hops++) {
      const rec = hasOwn(coll, cur) ? coll[cur] : null;
      if (!rec) return null;
      if (!rec.removed) return cur;
      if (!rec.removed.mergedInto) return null;
      cur = rec.removed.mergedInto;
    }
    const rec = hasOwn(coll, cur) ? coll[cur] : null;
    return rec && !rec.removed ? cur : null;
  }
  /**
   * Resolve a person reference to an active person id. Removed with mergedInto → followed (MERGED_REDIRECT);
   * removed otherwise → TARGET_REMOVED. Throws ABORT on errors, SKIP when its declaring op failed.
   */
  rp(value, field) {
    const id = this.refId(value, 'person', field);
    const p = this.person(id);
    if (!p) this.fail('UNKNOWN_ID', { ref: value, field }, field);
    if (!p.removed) return id;
    const to = p.removed.mergedInto ? this.followMerged(this.d.people, id) : null;
    if (!to) this.fail('TARGET_REMOVED', { id, field }, field);
    this.warn('MERGED_REDIRECT', { field, from: id, to }, field);
    return to;
  }
  /** Resolve a union reference to an active union id (same redirect rules as rp). */
  ru(value, field) {
    const uid = this.refId(value, 'union', field);
    const u = this.union(uid);
    if (!u) this.fail('UNKNOWN_ID', { ref: value, field }, field);
    if (!u.removed) return uid;
    const to = u.removed.mergedInto ? this.followMerged(this.d.unions, uid) : null;
    if (!to) this.fail('TARGET_REMOVED', { union: uid, field }, field);
    this.warn('MERGED_REDIRECT', { field, from: uid, to }, field);
    return to;
  }
  /** Resolve without errors (order lists): returns an active id or null. */
  quiet(value, kind, field) {
    if (!isStr(value)) return null;
    const temp = kind === 'person' ? isTempPersonRef(value) : isTempUnionRef(value);
    let id = value;
    if (temp) {
      id = (kind === 'person' ? this.personRefs : this.unionRefs).get(value) ?? (hasOwn(this.refMap, value) ? this.refMap[value] : null);
      if (!id) return null;
    }
    const coll = kind === 'person' ? this.d.people : this.d.unions;
    const rec = hasOwn(coll, id) ? coll[id] : null;
    if (!rec) return null;
    if (!rec.removed) return id;
    const to = rec.removed.mergedInto ? this.followMerged(coll, id) : null;
    if (to) this.warn('MERGED_REDIRECT', { field, from: id, to }, field);
    return to;
  }

  // --- ids ---------------------------------------------------------------------------------------------
  genId(prefix, coll) {
    if (this.idGen) {
      for (let k = 0; k < 1000; k++) {
        const id = this.idGen(prefix);
        if (isStr(id) && !hasOwn(coll, id)) return id;
      }
      throw new Error(`idGen produced only colliding ids for prefix ${prefix}`);
    }
    return randomId(prefix, coll);
  }
  allocPersonId(ref) {
    if (this.mode === 'final') return this.genId('p', this.d.people);
    if (hasOwn(this.d.people, ref)) this.fail('DUPLICATE_REF', { ref, field: 'ref' }, 'ref');
    return ref;
  }
  unionRefBound(ref) {
    return this.unionRefs.has(ref) || this.opBinds.has(ref) || hasOwn(this.refMap, ref);
  }
  allocUnionId(op) {
    if (this.mode === 'final') return this.genId('u', this.d.unions);
    const ref = op.unionRef;
    if (isTempUnionRef(ref) && !this.unionRefBound(ref) && !hasOwn(this.d.unions, ref)) return ref;
    let id;
    do id = `tmpu${++this.tmpCounter}`; while (hasOwn(this.d.unions, id));
    return id;
  }
  /** Bind the op's unionRef to the union it used or created; an existing binding must name the same union. */
  bindUnionRef(op) {
    const ref = op.unionRef;
    if (!isTempUnionRef(ref) || !this.usedUnion) return;
    let prev = this.unionRefs.get(ref) ?? this.opBinds.get(ref);
    if (prev === undefined && hasOwn(this.refMap, ref)) prev = this.followMerged(this.d.unions, this.refMap[ref]) ?? this.refMap[ref];
    if (prev !== undefined) {
      if (prev !== this.usedUnion) this.err('DUPLICATE_REF', { ref, field: 'unionRef', union: prev, used: this.usedUnion }, 'unionRef');
      return;
    }
    if (this.mode === 'preview' && hasOwn(this.d.unions, ref) && ref !== this.usedUnion) {
      this.err('DUPLICATE_REF', { ref, field: 'unionRef' }, 'unionRef');
      return;
    }
    this.opBinds.set(ref, this.usedUnion);
  }

  // --- structural union edits ---------------------------------------------------------------------------------
  createUnion(fields, op) {
    const id = this.allocUnionId(op);
    const u = normalizeUnion({ ...fields, id });
    this.save('u', id);
    this.d.unions[id] = u;
    this.createdUnions.add(id);
    this.dirty();
    return id;
  }
  /** Insert child at `index`, else before the first sibling with a later known birth date, else at the end. */
  insertChild(uid, cid, index) {
    const u = this.mu(uid);
    if (u.children.includes(cid)) return;
    let pos = u.children.length;
    if (Number.isInteger(index)) pos = Math.max(0, Math.min(index, u.children.length));
    else {
      const b = this.person(cid)?.birth?.date;
      if (b) {
        const k = u.children.findIndex((c) => laterThan(this.person(c)?.birth?.date, b));
        if (k >= 0) pos = k;
      }
    }
    u.children.splice(pos, 0, cid);
    this.dirty();
  }
  removeChild(uid, cid) {
    const u = this.mu(uid);
    const k = u.children.indexOf(cid);
    if (k < 0) return -1;
    u.children.splice(k, 1);
    this.shrunkBy.set(uid, this.action);
    this.dirty();
    return k;
  }
  /** Replace child `from` by `to` in the same slot (drops `from` if `to` is already listed). */
  replaceChild(uid, from, to) {
    const u = this.mu(uid);
    const k = u.children.indexOf(from);
    if (k < 0) return;
    if (u.children.includes(to)) u.children.splice(k, 1);
    else u.children[k] = to;
    this.dirty();
  }
  addPartner(uid, pid) {
    const u = this.mu(uid);
    if (!u.partners.includes(pid)) u.partners.push(pid);
    this.dirty();
  }
  softRemoveUnion(uid, extra) {
    const u = this.mu(uid);
    const { reasonCode = '', ...rest } = extra;
    u.removed = { at: this.now, reasonCode, issue: this.issue, by: this.actor, ...rest };
    this.dirty();
    this.stripSpouseOrder(uid);
  }
  stripSpouseOrder(uid, replacement = null) {
    for (const pid of this.d.unions[uid]?.partners || []) {
      const p = this.person(pid);
      if (!p || !p.spouseOrder.includes(uid)) continue;
      const rec = this.mp(pid);
      rec.spouseOrder = uniq(rec.spouseOrder.map((x) => (x === uid ? replacement : x)).filter(Boolean));
    }
  }

  // --- shared union checks (§3.3: SAME_PERSON, ANCESTOR_LINK, DUPLICATE_UNION, CYCLE on every creating path) ------
  /** Problems of a union's partner set (after creating it or adding a partner). Returns issues [{code, params}]. */
  partnerIssues(uid) {
    const u = this.union(uid);
    const out = [];
    if (!u || u.removed) return out;
    const ps = u.partners;
    if (uniq(ps).length !== ps.length) out.push({ code: 'SAME_PERSON', params: { a: ps[0], b: ps[1], union: uid } });
    for (const pid of ps) if (u.children.includes(pid)) out.push({ code: 'CYCLE', params: { id: pid, union: uid } });
    const twin = this.findUnion(ps, uid);
    if (twin) out.push({ code: 'DUPLICATE_UNION', params: { union: uid, other: twin.id, partners: [...ps] } });
    if (ps.length === 2) {
      if (this.isAncestor(ps[0], ps[1])) out.push({ code: 'ANCESTOR_LINK', params: { union: uid, ancestor: ps[0], descendant: ps[1] } });
      else if (this.isAncestor(ps[1], ps[0])) out.push({ code: 'ANCESTOR_LINK', params: { union: uid, ancestor: ps[1], descendant: ps[0] } });
    }
    return out;
  }
  /**
   * Problems after `childIds` were attached under union uid (or its partners changed): a child that is a partner or
   * an ancestor of a partner (CYCLE); a member of a child's subtree partnered with one of the union's partners or
   * their ancestors (ANCESTOR_LINK).
   */
  attachIssues(uid, childIds) {
    const u = this.union(uid);
    const out = [];
    if (!u || u.removed) return out;
    const ps = u.partners;
    if (!ps.length) return out;
    // everyone who becomes an ancestor of the attached children: the partners and their ancestors
    const newAncestors = new Set(ps);
    for (const pid of ps) for (const a of this.ancestors(pid)) newAncestors.add(a);
    for (const c of childIds) {
      if (newAncestors.has(c)) out.push({ code: 'CYCLE', params: { id: c, union: uid } });
    }
    if (out.length) return out;
    const seenUnions = new Set();
    for (const c of childIds) {
      for (const d of [c, ...this.descendants(c)]) {
        for (const w of this.unionsOf(d)) {
          if (w.partners.length !== 2 || seenUnions.has(w.id)) continue;
          const other = w.partners[0] === d ? w.partners[1] : w.partners[0];
          if (newAncestors.has(other)) {
            seenUnions.add(w.id);
            out.push({ code: 'ANCESTOR_LINK', params: { union: w.id, ancestor: other, descendant: d } });
          }
        }
      }
    }
    return out;
  }
  report(issues) {
    for (const x of issues) this.err(x.code, x.params);
  }

  /** Find the active union with partners exactly {P, Q} (or {P}); create it when missing (§3.4). */
  findOrCreateParents(P, Q, op) {
    if (Q && P === Q) this.fail('SAME_PERSON', { a: P, b: Q });
    const set = Q ? [P, Q] : [P];
    const found = this.findUnion(set);
    if (found) return found.id;
    const uid = this.createUnion({ partners: set, children: [], status: Q ? 'married' : 'unknown' }, op);
    this.report(this.partnerIssues(uid));
    this.bail();
    return uid;
  }

  // --- person checks & warnings ---------------------------------------------------------------------------------
  nameStatusIssues(p) {
    const hasName = !!(p.name.ar || p.name.en);
    if (p.nameStatus === 'known') {
      if (!hasName && !p.nickname.ar && !p.nickname.en) this.err('NAME_REQUIRED', { id: p.id });
    } else if (hasName) this.err('NAME_SHOULD_BE_EMPTY', { id: p.id, nameStatus: p.nameStatus });
  }
  minorDetails(p) {
    if (!isMinor(p, this.today)) return [];
    const f = [];
    if (p.photo) f.push('photo');
    if (p.bio.ar || p.bio.en) f.push('bio');
    if (p.occupation.ar || p.occupation.en) f.push('occupation');
    if (p.birth.place.ar || p.birth.place.en) f.push('birth.place');
    if (p.privacy === 'full' && p.birth.date.includes('-')) f.push('birth.date');
    return f;
  }
  nameLooksFull(p) {
    for (const s of [p.name.ar, p.name.en]) {
      if (s && looksLikeFullName(s)) this.warn('NAME_LOOKS_FULL', { id: p.id, name: s });
    }
  }
  /** Active people indexed by name key (built lazily; new people are added incrementally). */
  names() {
    if (this._names) return this._names;
    const m = new Map();
    for (const p of Object.values(this.d.people)) if (!p.removed) this.indexName(m, p);
    this._names = m;
    return m;
  }
  indexName(m, p) {
    for (const k of biKeys(p.name)) {
      const l = m.get(k);
      if (!l) m.set(k, [p.id]);
      else if (!l.includes(p.id)) l.push(p.id);
    }
  }
  /** POSSIBLE_DUPLICATE (§3.3 add-person): same normalized given name AND a family/identity coincidence. */
  possibleDuplicates(id, ref, link) {
    const p = this.person(id);
    const keys = biKeys(p.name);
    if (!keys.length) return;
    const m = this.names();
    const candidates = uniq(keys.flatMap((k) => m.get(k) || [])).filter((c) => c !== id && this.isActive(c));
    const myBirth = this.birthUnion(id)?.id ?? null;
    const myFather = this.father(id);
    const mySurname = biKeys(p.surname, 'surname');
    const myNick = biKeys(p.nickname);
    const myYear = parseDate(p.birth.date)?.year ?? null;
    const spouseOrParent = link && (link.as === 'spouse' || link.as === 'parent');
    let n = 0;
    for (const cid of candidates) {
      if (n >= 5) break;
      const c = this.person(cid);
      const cSurname = biKeys(c.surname, 'surname');
      const cYear = parseDate(c.birth.date)?.year ?? null;
      let reason = '';
      if (myBirth && this.birthUnion(cid)?.id === myBirth) reason = 'same-parents';
      else if (myFather && this.father(cid) === myFather) reason = 'same-father';
      else if (mySurname.length && sharesKey(mySurname, cSurname) && myYear !== null && cYear !== null && Math.abs(myYear - cYear) <= 2) {
        reason = 'same-surname-year';
      } else if (spouseOrParent && ((myNick.length && sharesKey(myNick, biKeys(c.nickname))) || (mySurname.length && sharesKey(mySurname, cSurname)))) {
        reason = 'same-nickname-or-surname';
      }
      if (reason) {
        this.warn('POSSIBLE_DUPLICATE', { id: cid, ref, reason });
        n++;
      }
    }
  }
  isParent(id) {
    return this.unionsOf(id).some((u) => u.children.length > 0);
  }

  // --- end of proposal ------------------------------------------------------------------------------------
  /**
   * Pruning (§3.5): unions created by this proposal left with < 2 members are deleted; pre-existing unions that
   * dropped below 2 members are soft-removed with auto:true. Soft-removed people count as members.
   */
  endPass() {
    this.undo = new Map();
    this.opActions = [];
    this.opTargets = [];
    for (const key of [...this.orig.keys()]) {
      if (!key.startsWith('u:')) continue;
      const uid = key.slice(2);
      const u = this.union(uid);
      if (!u) continue;
      const n = members(u);
      this.action = this.shrunkBy.get(uid) || 'edit';
      if (this.createdUnions.has(uid)) {
        if (n >= 2) continue;
        this.stripSpouseOrder(uid);
        delete this.d.unions[uid];
        this.createdUnions.delete(uid);
        for (const [ref, id] of this.unionRefs) if (id === uid) this.unionRefs.delete(ref);
        this.dirty();
      } else if (!u.removed && n < 2 && n < (this.baseMembers.get(uid) ?? 0)) {
        this.softRemoveUnion(uid, { auto: true });
      }
    }
    for (const [id, entry] of this.opActions) {
      if (!this.actions.has(id)) this.actions.set(id, []);
      this.actions.get(id).push(entry);
    }
  }

  /** Compute touched/created/idMap; in final mode add history, bump the revision and stamp updatedAt. */
  finish() {
    const touched = { people: [], unions: [] };
    for (const [key, before] of this.orig) {
      if (key === 'meta') continue;
      const id = key.slice(2);
      const coll = key[0] === 'p' ? this.d.people : this.d.unions;
      const now = hasOwn(coll, id) ? JSON.stringify(coll[id]) : null;
      if (now === null && before === null) continue; // created and pruned
      const changed = now !== before || (key[0] === 'p' && this.targets.has(id));
      if (changed) (key[0] === 'p' ? touched.people : touched.unions).push(id);
    }
    const created = {
      people: [...this.createdPeople].filter((id) => hasOwn(this.d.people, id)),
      unions: [...this.createdUnions].filter((id) => hasOwn(this.d.unions, id)),
    };
    const idMap = {};
    for (const [ref, id] of this.personRefs) idMap[ref] = id;
    for (const [ref, id] of this.unionRefs) if (hasOwn(this.d.unions, id)) idMap[ref] = id;

    if (this.mode === 'final') {
      for (const id of touched.people) {
        const p = this.d.people[id];
        const seen = new Set();
        for (const e of this.actions.get(id) || [{ action: 'edit' }]) {
          const entry = { issue: this.issue, rev: this.rev, at: this.now, action: e.action };
          if (e.from !== undefined) entry.from = e.from;
          if (e.index !== undefined) entry.index = e.index;
          const k = JSON.stringify(entry);
          if (seen.has(k)) continue;
          seen.add(k);
          p.history.push(entry);
        }
        if (p.history.length > LIMITS.history) p.history = p.history.slice(-LIMITS.history);
      }
      this.d.meta.revision = this.rev;
      this.d.meta.updatedAt = this.now;
    }
    return { touched, created, idMap };
  }
}

// =========================================================================================================
// Op handlers (called with `this` = Session). Each checks first, then mutates; checks that need the result run
// after the mutation and fail the op (the journal rolls it back).

const isDeceasedInput = (p) => p.deceased === true
  || (p.deceased !== false && isObj(p.death) && ((isStr(p.death.date) && p.death.date.trim()) || (isStr(p.death.hijri) && p.death.hijri.trim())));

const HANDLERS = {
  'add-person'(op) {
    const ref = op.ref;
    if (this.personRefs.has(ref) || hasOwn(this.refMap, ref)) this.fail('DUPLICATE_REF', { ref, field: 'ref' }, 'ref');
    const id = this.allocPersonId(ref);
    const input = clone(op.person);
    // Living people default to year-only birth dates (§0, §2.1); deceased people to full.
    if (!hasOwn(input, 'privacy')) input.privacy = isDeceasedInput(input) ? 'full' : 'year';
    const person = normalizePerson({ ...input, id });
    this.nameStatusIssues(person);
    this.bail();
    this.save('p', id);
    this.d.people[id] = person;
    this.opActions.push([id, { action: 'add-person' }]);
    this.createdPeople.add(id);
    this.opDeclares.set(ref, id);

    if (op.link) LINKS[op.link.as].call(this, op, id, person);
    this.bail();

    // warnings
    this.possibleDuplicates(id, ref, op.link);
    if (this._names) this.indexName(this._names, person);
    const minor = this.minorDetails(person);
    if (minor.length) this.warn('MINOR_DETAIL', { id, fields: minor }, 'person');
    this.nameLooksFull(person);
    if (!person.gender) this.warn('GENDER_MISSING', { id }, 'person.gender');
  },

  'edit-person'(op) {
    const id = this.rp(op.id, 'id');
    const cur = this.person(id);
    if (isObj(op.before)) {
      for (const [path, expected] of Object.entries(op.before)) {
        const actual = getPath(cur, path);
        if (!sameValue(expected, actual, path)) this.stale({ id, path, expected, actual }, `before.${path}`);
      }
    }
    const set = { ...op.set };
    const nameGiven = ['name.ar', 'name.en'].some((k) => isStr(set[k]) && set[k].trim());
    if (hasOwn(set, 'nameStatus') && set.nameStatus !== 'known') {
      // Withholding / unknown: the name must not be stored (a withheld name never reaches the repo).
      if (nameGiven) this.fail('NAME_SHOULD_BE_EMPTY', { id, nameStatus: set.nameStatus }, 'set.nameStatus');
      set['name.ar'] = '';
      set['name.en'] = '';
    } else if (!hasOwn(set, 'nameStatus') && nameGiven && cur.nameStatus === 'unknown') {
      set.nameStatus = 'known'; // a name that was unknown is now known
    }
    // A withheld name is only published by an explicit nameStatus:"known" (otherwise NAME_SHOULD_BE_EMPTY below).
    const next = applyPersonSet(cur, set);
    this.nameStatusIssues(next);
    this.bail();
    if (hasOwn(set, 'gender') && cur.gender && next.gender !== cur.gender && this.isParent(id)) {
      this.warn('GENDER_FLIPS_PARENT', { id, from: cur.gender, to: next.gender }, 'set.gender');
    }
    this.putPerson(id, next);
    const detailPaths = ['photo', 'bio.ar', 'bio.en', 'occupation.ar', 'occupation.en', 'birth.place.ar', 'birth.place.en', 'birth.date', 'privacy'];
    if (detailPaths.some((k) => hasOwn(set, k))) {
      const minor = this.minorDetails(next);
      if (minor.length) this.warn('MINOR_DETAIL', { id, fields: minor }, 'set');
    }
    if (hasOwn(set, 'name.ar') || hasOwn(set, 'name.en')) {
      this.nameLooksFull(next);
      this._names = null;
    }
  },

  mark(op) {
    const id = this.rp(op.id, 'id');
    const cur = this.person(id);
    let next;
    switch (op.mark) {
      case 'deceased': {
        const set = { deceased: true };
        if (isStr(op.date) && op.date.trim()) set['death.date'] = canonicalDate(op.date);
        if (isStr(op.hijri) && op.hijri.trim()) set['death.hijri'] = canonicalHijri(op.hijri);
        next = applyPersonSet(cur, set);
        break;
      }
      case 'living':
        next = applyPersonSet(cur, { deceased: false });
        break;
      case 'verified':
      case 'unverified':
        next = clone(cur);
        next.tags = op.mark === 'verified' ? uniq([...next.tags, 'verified']) : next.tags.filter((t) => t !== 'verified');
        break;
      case 'needs-info':
        next = clone(cur);
        next.tags = uniq([...next.tags, 'needs-info']);
        if (isStr(op.note)) next.needsInfo = op.note.trim();
        break;
      case 'info-complete':
        next = clone(cur);
        next.tags = next.tags.filter((t) => t !== 'needs-info');
        next.needsInfo = '';
        break;
      case 'duplicate': {
        const of = this.rp(op.of, 'of');
        if (of === id) this.fail('SAME_PERSON', { a: id, b: of }, 'of');
        next = clone(cur);
        next.duplicateOf = of;
        break;
      }
      case 'not-duplicate':
        next = clone(cur);
        next.duplicateOf = '';
        break;
      case 'private':
        // For people who ask to be hidden: links kept, personal details cleared, name withheld.
        next = clone(cur);
        next.privacy = cur.privacy === 'hidden' ? 'hidden' : 'year';
        next.birth.place = emptyBi();
        next.death.place = emptyBi();
        next.occupation = emptyBi();
        next.bio = emptyBi();
        next.photo = '';
        next.nameStatus = 'withheld';
        next.name = emptyBi();
        next = normalizePerson(next);
        this._names = null;
        break;
      default:
        this.fail('BAD_ENUM', { field: 'mark', value: op.mark, allowed: [...MARKS] }, 'mark');
    }
    this.putPerson(id, next);
  },

  'link-spouse'(op) {
    const a = this.rp(op.a, 'a');
    const b = this.rp(op.b, 'b');
    if (a === b) this.fail('SAME_PERSON', { a, b }, 'b');
    const existing = this.findUnion([a, b]);
    if (existing) this.fail('DUPLICATE_UNION', { union: existing.id, partners: [a, b] });
    const uid = this.createUnion({
      partners: [a, b],
      children: [],
      status: op.status || 'married',
      marriage: op.marriage ? clone(op.marriage) : undefined,
    }, op);
    this.report(this.partnerIssues(uid));
    this.usedUnion = uid;
  },

  'move-person'(op) {
    const id = this.rp(op.id, 'id');
    let target;
    if (op.to.union) target = this.ru(op.to.union, 'to.union');
    else {
      const P = this.rp(op.to.of, 'to.of');
      const Q = op.to.with ? this.rp(op.to.with, 'to.with') : null;
      if (P === id || Q === id) this.fail('INVALID_RELATION', { id }, P === id ? 'to.of' : 'to.with');
      target = this.findOrCreateParents(P, Q, op);
    }
    const T = this.union(target);
    if (T.partners.includes(id)) this.fail('INVALID_RELATION', { id, union: target }, 'to');
    const B = this.birthUnion(id);
    this.usedUnion = target;
    if (B && B.id === target) {
      // Same parents: only re-position when an index is given.
      if (Number.isInteger(op.index)) {
        const from = this.removeChild(target, id);
        this.shrunkBy.delete(target);
        this.insertChild(target, id, op.index);
        this.target(id, { from: target, index: from });
      }
      return;
    }
    let from = null;
    let fromIndex = null;
    if (B) {
      from = B.id;
      fromIndex = this.removeChild(B.id, id);
    }
    this.insertChild(target, id, op.index);
    this.report(this.attachIssues(target, [id]));
    this.bail();
    if (from !== null) this.target(id, { from, index: fromIndex });
    else this.target(id);
    // REPARENT: a known parent (partner of the old birth union in the input data) is dropped.
    if (B) {
      const base = isObj(this.input?.unions) ? this.input.unions[B.id] : null;
      const known = base && !base.removed && Array.isArray(base.children) && base.children.includes(id)
        ? (Array.isArray(base.partners) ? base.partners : []) : [];
      const dropped = B.partners.filter((pid) => known.includes(pid) && !T.partners.includes(pid));
      if (dropped.length) {
        const descendants = this.descendants(id).size;
        const info = { id, from: B.id, to: target, droppedParents: dropped, descendants };
        this.warn('REPARENT', info, 'to');
        this.opReparent = { op: this.i, ...info };
      }
    }
  },

  'edit-union'(op) {
    const uid = this.ru(op.union, 'union');
    const cur = this.union(uid);
    if (isObj(op.before)) {
      for (const [path, expected] of Object.entries(op.before)) {
        const actual = getPath(cur, path);
        if (!sameValue(expected, actual, path)) this.stale({ union: uid, path, expected, actual }, `before.${path}`);
      }
    }
    const next = applyUnionSet(cur, op.set);
    this.mu(uid);
    this.d.unions[uid] = next;
    this.usedUnion = uid;
  },

  'reorder-children'(op) {
    const uid = this.ru(op.union, 'union');
    const u = this.union(uid);
    if (Array.isArray(op.beforeOrder)) {
      const before = op.beforeOrder.map((r) => this.quiet(r, 'person', 'beforeOrder') ?? r);
      if (before.length !== u.children.length || before.some((x, k) => x !== u.children[k])) {
        this.stale({ union: uid, path: 'children', expected: [...op.beforeOrder], actual: [...u.children] }, 'beforeOrder');
      }
    }
    const listed = [];
    const ignored = [];
    for (const r of op.order) {
      const pid = this.quiet(r, 'person', 'order');
      if (pid && u.children.includes(pid) && !listed.includes(pid)) listed.push(pid);
      else ignored.push(r);
    }
    if (ignored.length) this.warn('ORDER_IGNORED', { union: uid, ids: ignored }, 'order');
    const next = [...listed, ...u.children.filter((c) => !listed.includes(c))];
    if (next.some((c, k) => c !== u.children[k])) this.mu(uid).children = next;
    this.usedUnion = uid;
  },

  'reorder-spouses'(op) {
    const id = this.rp(op.id, 'id');
    const current = this.displayUnions(id);
    const listed = [];
    const ignored = [];
    for (const r of op.order) {
      const uid = this.quiet(r, 'union', 'order');
      if (uid && current.includes(uid) && !listed.includes(uid)) listed.push(uid);
      else ignored.push(r);
    }
    if (ignored.length) this.warn('ORDER_IGNORED', { id, ids: ignored }, 'order');
    const next = [...listed, ...current.filter((u) => !listed.includes(u))];
    const p = this.person(id);
    if (next.length !== p.spouseOrder.length || next.some((u, k) => u !== p.spouseOrder[k])) this.mp(id).spouseOrder = next;
  },

  'add-tie'(op) {
    const id = this.rp(op.id, 'id');
    const other = this.rp(op.person, 'person');
    if (id === other) this.fail('SAME_PERSON', { a: id, b: other }, 'person');
    const p = this.person(id);
    if (p.ties.some((t) => t.type === op.type && t.person === other)) this.fail('DUPLICATE_TIE', { id, type: op.type, person: other });
    const note = isObj(op.note) ? { ar: (op.note.ar || '').trim(), en: (op.note.en || '').trim() } : emptyBi();
    this.mp(id).ties.push({ type: op.type, person: other, note });
  },

  'restore-person'(op) {
    const id = this.refId(op.id, 'person', 'id');
    const p = this.person(id);
    if (!p) this.fail('UNKNOWN_ID', { ref: op.id, field: 'id' }, 'id');
    if (!p.removed) this.fail('NOT_REMOVED', { id }, 'id');
    if (p.removed.mergedInto) this.fail('MERGED_USE_UNDO', { id, mergedInto: p.removed.mergedInto }, 'id');
    this.mp(id).removed = null;
    // Re-activate the unions removed together with this person (other partners must be active).
    const unions = Object.values(this.d.unions).filter((u) => u.removed && u.removed.with === id && !u.removed.mergedInto
      && u.partners.every((pid) => pid === id || this.isActive(pid)));
    for (const u of unions) this.mu(u.id).removed = null;
    this.dirty();
    const issues = [];
    for (const x of uniq([id, ...unions.flatMap((u) => u.children)])) {
      if (this.birthUnions(x).length > 1) issues.push({ code: 'MULTIPLE_BIRTH_UNIONS', params: { id: x } });
    }
    for (const u of unions) issues.push(...this.partnerIssues(u.id), ...this.attachIssues(u.id, u.children));
    for (const x of issues) this.err('RESTORE_CONFLICT', conflictParams(x));
  },

  'restore-union'(op) {
    const uid = this.refId(op.union, 'union', 'union');
    const u = this.union(uid);
    if (!u) this.fail('UNKNOWN_ID', { ref: op.union, field: 'union' }, 'union');
    if (!u.removed) this.fail('NOT_REMOVED', { union: uid }, 'union');
    if (u.removed.mergedInto) this.fail('MERGED_USE_UNDO', { union: uid, mergedInto: u.removed.mergedInto }, 'union');
    const removedPartner = u.partners.find((pid) => !this.isActive(pid));
    if (removedPartner) this.fail('RESTORE_CONFLICT', { reason: 'partner-removed', union: uid, id: removedPartner });
    this.mu(uid).removed = null;
    this.dirty();
    const issues = [];
    for (const c of u.children) {
      if (this.birthUnions(c).length > 1) issues.push({ code: 'MULTIPLE_BIRTH_UNIONS', params: { id: c, union: uid } });
    }
    issues.push(...this.partnerIssues(uid), ...this.attachIssues(uid, u.children));
    for (const x of issues) this.err('RESTORE_CONFLICT', conflictParams(x));
  },

  'remove-person'(op) {
    const id = op.id;
    const p = this.person(id);
    if (!p) this.fail('UNKNOWN_ID', { ref: id, field: 'id' }, 'id');
    if (p.removed) this.fail('ALREADY_REMOVED', { id }, 'id');
    if (id === this.d.meta.rootPersonId) this.fail('IS_ROOT', { id }, 'id');
    const unions = this.unionsOf(id);
    const children = uniq(unions.flatMap((u) => this.activeChildren(u)));
    if (children.length) this.fail('HAS_CHILDREN', { id, children }, 'id');
    this.mp(id).removed = { at: this.now, reasonCode: op.reasonCode, issue: this.issue, by: this.actor };
    for (const u of unions) this.softRemoveUnion(u.id, { reasonCode: op.reasonCode, with: id });
    if (op.redact === true) {
      // "Remove me": clear every personal field; keep only structure (gender, ties, links) and the records.
      const cur = this.person(id);
      this.putPerson(id, normalizePerson({
        id,
        nameStatus: 'withheld',
        gender: cur.gender,
        privacy: 'hidden',
        duplicateOf: cur.duplicateOf,
        spouseOrder: cur.spouseOrder,
        ties: cur.ties,
        removed: cur.removed,
        history: cur.history,
      }));
    }
    this._names = null;
  },

  'unlink-spouse'(op) {
    const uid = this.ru(op.union, 'union');
    const u = this.union(uid);
    if (u.partners.length !== 2) this.fail('NOT_A_COUPLE', { union: uid, partners: [...u.partners] }, 'union');
    const children = this.activeChildren(u);
    if (children.length) this.fail('HAS_CHILDREN', { union: uid, children }, 'union');
    this.softRemoveUnion(uid, { reasonCode: op.reasonCode });
  },

  'detach-person'(op) {
    const id = this.rp(op.id, 'id');
    const B = this.birthUnion(id);
    if (!B) this.fail('NO_PARENTS', { id }, 'id');
    const index = this.removeChild(B.id, id);
    this.target(id, { from: B.id, index });
  },

  'remove-tie'(op) {
    const id = this.rp(op.id, 'id');
    const other = this.rp(op.person, 'person');
    const k = this.person(id).ties.findIndex((t) => t.type === op.type && t.person === other);
    if (k < 0) this.fail('TIE_NOT_FOUND', { id, type: op.type, person: other });
    this.mp(id).ties.splice(k, 1);
  },

  'merge-person'(op) {
    const keep = this.rp(op.keep, 'keep');
    const rem = this.rp(op.remove, 'remove');
    if (keep === rem) this.fail('SAME_PERSON', { a: keep, b: rem }, 'remove');
    const K = this.person(keep);
    const R = this.person(rem);
    if (K.gender && R.gender && K.gender !== R.gender) {
      this.fail('GENDER_CONFLICT', { keep, remove: rem, keepGender: K.gender, removeGender: R.gender });
    }
    const shared = this.unionsOf(keep).find((u) => u.partners.includes(rem));
    if (shared) this.fail('MERGE_SPOUSES', { keep, remove: rem, union: shared.id });
    if (this.isAncestor(keep, rem)) this.fail('ANCESTOR_LINK', { ancestor: keep, descendant: rem });
    if (this.isAncestor(rem, keep)) this.fail('ANCESTOR_LINK', { ancestor: rem, descendant: keep });
    const kb = this.birthUnion(keep);
    const rb = this.birthUnion(rem);
    const keepDisplay = this.displayUnions(keep);
    const remDisplay = this.displayUnions(rem);
    if (kb && rb && kb.id !== rb.id && !op.parents) {
      this.fail('CONFLICTING_PARENTS', { keep, remove: rem, keepUnion: kb.id, removeUnion: rb.id });
    }
    const touchedUnions = new Set();

    // 1. Birth union: `parents` decides; same union → drop remove; only remove has one → keep takes its slot.
    if (rb) {
      touchedUnions.add(rb.id);
      if (kb && kb.id === rb.id) this.removeChild(rb.id, rem);
      else if (!kb) this.replaceChild(rb.id, rem, keep);
      else if (op.parents === 'keep') this.removeChild(rb.id, rem);
      else {
        touchedUnions.add(kb.id);
        this.removeChild(kb.id, keep);
        this.replaceChild(rb.id, rem, keep);
      }
    }

    // 2. Unions where remove is a partner: keep replaces it; two active unions with the same partner set collapse.
    const remUnions = this.unionsOf(rem).map((u) => u.id);
    for (const uid of remUnions) {
      const u = this.mu(uid);
      u.partners = u.partners.map((x) => (x === rem ? keep : x));
      touchedUnions.add(uid);
    }
    this.dirty();
    const { order } = this.idx();
    const redirect = new Map();
    for (const uid of remUnions) {
      const u = this.union(uid);
      if (u.removed) continue;
      const twin = this.findUnion(u.partners, uid);
      if (!twin) continue;
      const [early, late] = (order.get(twin.id) ?? 0) < (order.get(uid) ?? 0) ? [twin.id, uid] : [uid, twin.id];
      collapseUnion.call(this, early, late, op.reasonCode);
      redirect.set(late, early);
      touchedUnions.add(early);
    }
    const mapU = (uid) => redirect.get(uid) ?? uid;

    // 3. spouseOrder: remove's unions appended after keep's (only when either had an explicit order — otherwise the
    //    default marriage-date order applies to all); other partners follow collapsed unions.
    const wantOrder = K.spouseOrder.length > 0 || R.spouseOrder.length > 0;
    const keepOrder = !wantOrder ? [] : uniq([...keepDisplay, ...remDisplay].map(mapU))
      .filter((uid) => { const u = this.union(uid); return u && !u.removed && u.partners.includes(keep); });
    for (const late of redirect.keys()) this.stripSpouseOrder(late, redirect.get(late));

    // 4. Fields: empty fields of keep filled from remove; differing values → MERGE_FIELD_CONFLICT (keep wins).
    const next = mergeFields.call(this, this.person(keep), R);
    next.spouseOrder = keepOrder;
    if (next.duplicateOf === rem) next.duplicateOf = '';
    this.putPerson(keep, normalizePerson(next));

    // 5. Others' references to remove → keep.
    for (const x of Object.values(this.d.people)) {
      if (x.removed || x.id === rem) continue;
      const dupe = x.duplicateOf === rem;
      const tie = x.ties.some((t) => t.person === rem);
      if (!dupe && !tie) continue;
      const rec = this.mp(x.id);
      if (dupe) rec.duplicateOf = x.id === keep ? '' : keep;
      if (tie) {
        const seen = new Set();
        rec.ties = rec.ties.map((t) => (t.person === rem ? { ...t, person: keep } : t)).filter((t) => {
          const k = `${t.type}|${t.person}`;
          if (t.person === x.id || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
    }
    if (this.d.meta.rootPersonId === rem) {
      this.saveMeta();
      this.d.meta.rootPersonId = keep;
    }

    // 6. remove becomes a redirect to keep.
    this.mp(rem).removed = {
      at: this.now,
      reasonCode: op.reasonCode,
      issue: this.issue,
      by: this.actor,
      mergedInto: keep,
      merge: { unions: remUnions, birthUnion: rb ? rb.id : null, parents: op.parents ?? null },
    };
    this._names = null;

    // 7. Result checks (CYCLE, ANCESTOR_LINK, DUPLICATE_UNION) on every union touched.
    const issues = [];
    for (const uid of touchedUnions) issues.push(...this.partnerIssues(uid));
    if (rb && this.union(rb.id)?.children.includes(keep)) issues.push(...this.attachIssues(rb.id, [keep]));
    for (const uid of touchedUnions) {
      const u = this.union(uid);
      if (u && !u.removed && u.partners.includes(keep)) issues.push(...this.attachIssues(uid, u.children));
    }
    const seen = new Set();
    for (const x of issues) {
      const k = issueKey(x);
      if (!seen.has(k)) { seen.add(k); this.err(x.code, x.params); }
    }
    this.bail();
    this.merges++;
  },
};

/** Params of RESTORE_CONFLICT from a check issue: {reason, …params}. */
function conflictParams(x) {
  const reason = {
    MULTIPLE_BIRTH_UNIONS: 'birth-union', DUPLICATE_UNION: 'duplicate-union', ANCESTOR_LINK: 'ancestor-link',
    CYCLE: 'cycle', SAME_PERSON: 'same-person',
  }[x.code] || x.code.toLowerCase();
  return { reason, ...x.params };
}

/** Equality for STALE_EDIT: strings trimmed (dates canonical), booleans strict, missing = "" / false. */
function sameValue(expected, actual, path) {
  if (typeof actual === 'boolean' || typeof expected === 'boolean') return !!expected === !!actual;
  const norm = (v) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (path.endsWith('.date')) return canonicalDate(s) ?? s;
    if (path.endsWith('.hijri')) return canonicalHijri(s) ?? s;
    return s;
  };
  return norm(expected) === norm(actual);
}

/** Merge union `late` into `early` (same partner set after a person merge). */
function collapseUnion(early, late, reasonCode) {
  const E = this.mu(early);
  const L = this.mu(late);
  for (const c of L.children) if (!E.children.includes(c) && !E.partners.includes(c)) E.children.push(c);
  if (E.status === 'unknown' && L.status !== 'unknown') E.status = L.status;
  for (const which of ['marriage', 'divorce']) {
    if (!E[which].date && !E[which].hijri && (L[which].date || L[which].hijri)) {
      E[which].date = L[which].date;
      E[which].hijri = L[which].hijri;
      E[which].approx = L[which].approx;
    }
  }
  for (const lang of ['ar', 'en']) {
    if (!E.marriage.place[lang] && L.marriage.place[lang]) E.marriage.place[lang] = L.marriage.place[lang];
    if (!E.note[lang] && L.note[lang]) E.note[lang] = L.note[lang];
  }
  L.removed = { at: this.now, reasonCode: reasonCode || 'duplicate', issue: this.issue, by: this.actor, mergedInto: early };
  this.dirty();
}

/** Keep's record with empty fields filled from remove (warnings for conflicts). Returns a new object. */
function mergeFields(K, R) {
  const next = clone(K);
  const conflict = (path, a, b) => this.warn('MERGE_FIELD_CONFLICT', { path, keep: a, remove: b });
  const fillText = (path) => {
    const a = getPath(next, path);
    const b = getPath(R, path);
    if (!b) return;
    if (!a) setPathValue(next, path, b);
    else if (String(a).trim() !== String(b).trim()) conflict(path, a, b);
  };
  // names: a withheld name is never filled and withholding wins (either record may carry the family's request to
  // hide the name); an unknown name becomes known when remove knows it
  if (R.nameStatus === 'withheld' && next.nameStatus !== 'withheld') {
    conflict('nameStatus', next.nameStatus, R.nameStatus);
    next.nameStatus = 'withheld';
    next.name = emptyBi();
  } else if (next.nameStatus !== 'withheld' && R.nameStatus === 'known') {
    if (next.nameStatus === 'unknown' && (R.name.ar || R.name.en)) {
      next.nameStatus = 'known';
      next.name = { ...R.name };
    } else if (next.nameStatus === 'known') {
      fillText('name.ar');
      fillText('name.en');
    }
  }
  for (const f of ['surname', 'nickname', 'occupation', 'bio']) {
    fillText(`${f}.ar`);
    fillText(`${f}.en`);
  }
  if (!next.gender && R.gender) next.gender = R.gender;
  fillText('photo');
  if (!next.needsInfo && R.needsInfo) next.needsInfo = R.needsInfo;
  if (R.deceased && !next.deceased) next.deceased = true;
  for (const which of ['birth', 'death']) {
    const a = next[which];
    const b = R[which];
    if (!a.date && !a.hijri) {
      if (b.date || b.hijri) {
        a.date = b.date;
        a.hijri = b.hijri;
        a.approx = b.approx;
      }
    } else if ((b.date || b.hijri) && (a.date !== b.date || a.hijri !== b.hijri)) {
      conflict(`${which}.${a.hijri && b.hijri ? 'hijri' : 'date'}`, a.hijri && b.hijri ? a.hijri : a.date, a.hijri && b.hijri ? b.hijri : b.date);
    }
    fillText(`${which}.place.ar`);
    fillText(`${which}.place.en`);
  }
  // privacy: the more private choice wins
  const rank = { full: 0, year: 1, hidden: 2 };
  if ((rank[R.privacy] ?? 0) > (rank[next.privacy] ?? 0)) next.privacy = R.privacy;
  next.tags = uniq([...next.tags, ...R.tags]);
  const seen = new Set(next.ties.map((t) => `${t.type}|${t.person}`));
  next.ties = next.ties.filter((t) => t.person !== R.id);
  for (const t of R.ties) {
    const k = `${t.type}|${t.person}`;
    if (t.person === K.id || t.person === R.id || seen.has(k)) continue;
    seen.add(k);
    next.ties.push(clone(t));
  }
  if (!next.duplicateOf && R.duplicateOf && R.duplicateOf !== K.id) next.duplicateOf = R.duplicateOf;
  return next;
}

function setPathValue(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let k = 0; k < keys.length - 1; k++) cur = cur[keys[k]];
  cur[keys[keys.length - 1]] = value;
}

// --- add-person links (§3.4) -------------------------------------------------------------------------------

const LINKS = {
  child(op, id) {
    const L = op.link;
    let uid;
    if (L.union) uid = this.ru(L.union, 'link.union');
    else {
      const P = this.rp(L.of, 'link.of');
      const Q = L.with ? this.rp(L.with, 'link.with') : null;
      uid = this.findOrCreateParents(P, Q, op);
    }
    this.insertChild(uid, id, op.index);
    this.report(this.attachIssues(uid, [id]));
    this.usedUnion = uid;
  },

  spouse(op, id) {
    const L = op.link;
    const P = this.rp(L.of, 'link.of');
    const uid = this.createUnion({
      partners: [P, id],
      children: [],
      status: L.status || 'married',
      marriage: L.marriage ? clone(L.marriage) : undefined,
    }, op);
    this.report(this.partnerIssues(uid));
    this.usedUnion = uid;
  },

  parent(op, id, person) {
    const L = op.link;
    const P = this.rp(L.of, 'link.of');
    const scope = L.scope || 'union';
    const B = this.birthUnion(P);
    if (!B) {
      const uid = this.createUnion({ partners: [id], children: [P], status: 'unknown' }, op);
      this.report([...this.partnerIssues(uid), ...this.attachIssues(uid, [P])]);
      this.usedUnion = uid;
      return;
    }
    if (B.partners.length >= 2) this.fail('PARENTS_FULL', { id: P, union: B.id }, 'link.of');
    const single = B.partners.length === 1 ? B.partners[0] : null;
    const g = single ? this.person(single)?.gender : '';
    if (g && person.gender && g === person.gender) this.fail('PARENT_GENDER_CONFLICT', { id: P, parent: single, gender: g }, 'link.of');
    if (scope === 'union') {
      // every child of B gains this parent
      this.addPartner(B.id, id);
      this.report([...this.partnerIssues(B.id), ...this.attachIssues(B.id, B.children)]);
      this.usedUnion = B.id;
    } else {
      // only P: move P alone into find-or-create {B's single partner, new}
      const target = single ? this.findOrCreateParents(single, id, op) : this.findOrCreateParents(id, null, op);
      this.removeChild(B.id, P);
      this.insertChild(target, P);
      this.report(this.attachIssues(target, [P]));
      this.usedUnion = target;
    }
  },

  sibling(op, id) {
    const L = op.link;
    const P = this.rp(L.of, 'link.of');
    const share = L.share || 'both';
    let uid;
    if (share === 'both') {
      const B = this.birthUnion(P);
      uid = B ? B.id : this.createUnion({ partners: [], children: [P], status: 'unknown' }, op);
    } else {
      const parent = this.parentOfGender(P, share === 'father' ? 'm' : 'f');
      if (!parent) this.fail(share === 'father' ? 'FATHER_UNKNOWN' : 'MOTHER_UNKNOWN', { id: P }, 'link.of');
      const Q = L.otherParent ? this.rp(L.otherParent, 'link.otherParent') : null;
      uid = this.findOrCreateParents(parent, Q, op);
    }
    this.insertChild(uid, id, op.index);
    this.report(this.attachIssues(uid, [id]));
    this.usedUnion = uid;
  },
};
