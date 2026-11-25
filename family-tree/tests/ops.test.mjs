// Tests for js/core/ops.js — proposal validation, every op and link variant, every issue code, atomicity,
// preview vs final ids, dependsOn/refMap, pruning vs soft-removal, merges and redirects, and the real data file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OPS_ERROR_CODES, OPS_WARNING_CODES, OPS_ISSUE_CODES,
  applyProposal, applyProposals, canonicalJSON, isDestructive, newProposal, opRefs, proposalHash, skipOps, validateProposal,
} from '../js/core/ops.js';
import { encodeProposal, decodeProposal } from '../js/core/codec.js';
import { normalizeData, serializeData, validateData, isPersonId, isUnionId, LIMITS } from '../js/core/schema.js';
import { buildGraph } from '../js/core/graph.js';

const DATA_FILE = new URL('../data/family.json', import.meta.url);
const NOW = '2026-11-25T12:00:00Z';

// ---------------------------------------------------------------------------------------------------------
// Fixture: a small family (compact stored form).
//
//   سالم p0001 (root) ═ فاطمة p0002          u0001 → حسن p0003, عائشة p0004
//   حسن p0003 ═ زينب p0005                   u0002 → محمد p0006
//   حسن p0003 ═ خديجة p0007 (second wife)    u0003 → علي p0008 (milk child of زينب)
//   أحمد p0010 (single parent)               u0004 → سعاد p0011
//   (parents unknown)                        u0005 → ليلى p0012, هدى p0013
//   عائشة p0004 ═ عمر p0014                  u0006 (no children)

function fixture() {
  return {
    schema: 1,
    meta: { title: { ar: 'شجرة الاختبار', en: 'Test tree' }, rootPersonId: 'p0001', revision: 3, updatedAt: '2026-01-01T00:00:00Z' },
    people: {
      p0001: { id: 'p0001', name: { ar: 'سالم' }, surname: { ar: 'العالم' }, gender: 'm', birth: { date: '1900' }, deceased: true },
      p0002: { id: 'p0002', name: { ar: 'فاطمة' }, gender: 'f', birth: { date: '1905' }, deceased: true },
      p0003: { id: 'p0003', name: { ar: 'حسن' }, gender: 'm', birth: { date: '1930' } },
      p0004: { id: 'p0004', name: { ar: 'عائشة' }, gender: 'f', birth: { date: '1932' } },
      p0005: { id: 'p0005', name: { ar: 'زينب' }, gender: 'f', birth: { date: '1935' } },
      p0006: { id: 'p0006', name: { ar: 'محمد' }, gender: 'm', birth: { date: '1960' }, privacy: 'year' },
      p0007: { id: 'p0007', name: { ar: 'خديجة' }, gender: 'f', birth: { date: '1940' } },
      p0008: { id: 'p0008', name: { ar: 'علي' }, gender: 'm', birth: { date: '1965' }, ties: [{ type: 'milk-child-of', person: 'p0005' }] },
      p0010: { id: 'p0010', name: { ar: 'أحمد' }, gender: 'm', birth: { date: '1950' } },
      p0011: { id: 'p0011', name: { ar: 'سعاد' }, gender: 'f', birth: { date: '1975' } },
      p0012: { id: 'p0012', name: { ar: 'ليلى' }, gender: 'f' },
      p0013: { id: 'p0013', name: { ar: 'هدى' }, gender: 'f' },
      p0014: { id: 'p0014', name: { ar: 'عمر' }, gender: 'm', birth: { date: '1931' } },
    },
    unions: {
      u0001: { id: 'u0001', partners: ['p0001', 'p0002'], children: ['p0003', 'p0004'], status: 'married' },
      u0002: { id: 'u0002', partners: ['p0003', 'p0005'], children: ['p0006'], status: 'married' },
      u0003: { id: 'u0003', partners: ['p0003', 'p0007'], children: ['p0008'], status: 'married' },
      u0004: { id: 'u0004', partners: ['p0010'], children: ['p0011'] },
      u0005: { id: 'u0005', partners: [], children: ['p0012', 'p0013'] },
      u0006: { id: 'u0006', partners: ['p0004', 'p0014'], status: 'married' },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Helpers. Every issue code seen anywhere is recorded for the coverage test at the end.

const SEEN = new Set();
const record = (r) => {
  for (const x of [...(r.errors || []), ...(r.warnings || [])]) SEEN.add(x.code);
  return r;
};

function proposal(ops, extra = {}) {
  return {
    kind: 'gft-proposal', v: 1, id: 'testprop01', createdAt: NOW, baseRevision: 3, dependsOn: [],
    submitter: { name: 'سارة', relation: 'حفيدة', personId: '' }, note: '', ops, ...extra,
  };
}

/** Deterministic id generator: px000001, ux000001, … */
function seqIds() {
  let n = 0;
  return (prefix) => `${prefix}x${String(++n).padStart(6, '0')}`;
}

const preview = (data, ops, opts = {}) => record(applyProposal(data, proposal(ops, opts.envelope), { mode: 'preview', now: NOW, ...opts }));
const final = (data, ops, opts = {}) => record(applyProposal(data, proposal(ops, opts.envelope), {
  mode: 'final', now: NOW, issue: 12, actor: 'owner', idGen: seqIds(), ...opts,
}));
const vp = (p, opts) => record(validateProposal(p, opts));
const codes = (list) => list.map((x) => x.code);
const errorCodes = (r) => codes(r.errors);
const warningCodes = (r) => codes(r.warnings);
const findIssue = (list, code) => list.find((x) => x.code === code);

function assertOk(r, msg = '') {
  assert.equal(r.ok, true, `${msg} expected ok, got errors ${JSON.stringify(r.errors)}`);
}
function assertError(r, code, op) {
  assert.equal(r.ok, false, `expected ${code}, but the proposal applied`);
  const e = findIssue(r.errors, code);
  assert.ok(e, `expected error ${code}, got ${JSON.stringify(r.errors)}`);
  if (op !== undefined) assert.equal(e.op, op, `${code} op index`);
  return e;
}
function assertWarning(r, code) {
  const w = findIssue(r.warnings, code);
  assert.ok(w, `expected warning ${code}, got ${JSON.stringify(r.warnings)}`);
  return w;
}

const person = (fields, extra = {}) => ({ op: 'add-person', ...extra, person: { gender: 'm', ...fields } });

// =========================================================================================================
// Static helpers

test('fixture is valid data', () => {
  const v = validateData(fixture());
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('issue code lists are consistent', () => {
  for (const c of [...OPS_ERROR_CODES, ...OPS_WARNING_CODES]) assert.match(c, /^[A-Z][A-Z0-9_]+$/);
  assert.deepEqual(new Set(OPS_ISSUE_CODES), new Set([...OPS_ERROR_CODES, ...OPS_WARNING_CODES]));
  for (const c of ['POSSIBLE_DUPLICATE', 'MINOR_DETAIL', 'NAME_LOOKS_FULL', 'GENDER_MISSING', 'REPARENT', 'MERGED_REDIRECT']) {
    assert.ok(OPS_WARNING_CODES.includes(c), c);
  }
  assert.ok(Object.isFrozen(OPS_ERROR_CODES) && Object.isFrozen(OPS_WARNING_CODES) && Object.isFrozen(OPS_ISSUE_CODES));
});

test('newProposal: fresh envelope with a 10-char base36 id', () => {
  const a = newProposal();
  const b = newProposal();
  assert.equal(a.kind, 'gft-proposal');
  assert.equal(a.v, 1);
  assert.match(a.id, /^[a-z0-9]{10}$/);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(a.ops, []);
  assert.deepEqual(a.dependsOn, []);
  assert.deepEqual(a.submitter, { name: '', relation: '', personId: '' });
  assert.equal(typeof a.createdAt, 'string');
  assert.deepEqual(errorCodes(vp(a)), ['NO_OPS']);
});

test('isDestructive is static', () => {
  assert.equal(isDestructive(proposal([{ op: 'mark', id: 'p0003', mark: 'verified' }])), false);
  for (const op of ['remove-person', 'unlink-spouse', 'detach-person', 'remove-tie', 'merge-person']) {
    assert.equal(isDestructive(proposal([{ op }])), true, op);
  }
  assert.equal(isDestructive(null), false);
});

test('opRefs: declares and uses of every op shape', () => {
  assert.deepEqual(opRefs({ op: 'add-person', ref: 'new1', person: {}, link: { as: 'child', of: 'p0003', with: 'new2' }, unionRef: 'newu3' }),
    { declares: ['new1', 'newu3'], uses: ['p0003', 'new2'] });
  // a unionRef that the op also uses explicitly is a use, not a declaration
  assert.deepEqual(opRefs({ op: 'add-person', ref: 'new4', person: {}, link: { as: 'child', union: 'newu3' }, unionRef: 'newu3' }),
    { declares: ['new4'], uses: ['newu3'] });
  assert.deepEqual(opRefs({ op: 'add-person', ref: 'new5', person: {}, link: { as: 'sibling', of: 'p1', share: 'father', otherParent: 'new6' } }).uses, ['p1', 'new6']);
  assert.deepEqual(opRefs({ op: 'move-person', id: 'new1', to: { of: 'p0003', with: 'new2' }, unionRef: 'newu9' }),
    { declares: ['newu9'], uses: ['new1', 'p0003', 'new2'] });
  assert.deepEqual(opRefs({ op: 'move-person', id: 'p1', to: { union: 'newu2' } }).uses, ['p1', 'newu2']);
  assert.deepEqual(opRefs({ op: 'reorder-children', union: 'newu2', order: ['new1', 'new3'], beforeOrder: ['new3', 'new1', 'p9'] }).uses,
    ['newu2', 'new1', 'new3', 'p9']);
  assert.deepEqual(opRefs({ op: 'reorder-spouses', id: 'p0003', order: ['u0003', 'newu2'] }).uses, ['p0003', 'u0003', 'newu2']);
  assert.deepEqual(opRefs({ op: 'mark', id: 'new1', mark: 'duplicate', of: 'p0003' }).uses, ['new1', 'p0003']);
  assert.deepEqual(opRefs({ op: 'add-tie', id: 'new1', type: 'milk-child-of', person: 'new2' }).uses, ['new1', 'new2']);
  assert.deepEqual(opRefs({ op: 'link-spouse', a: 'new1', b: 'p2', unionRef: 'newu5' }), { declares: ['newu5'], uses: ['new1', 'p2'] });
  assert.deepEqual(opRefs({ op: 'merge-person', keep: 'p1', remove: 'p2', reasonCode: 'duplicate' }).uses, ['p1', 'p2']);
  assert.deepEqual(opRefs({ op: 'edit-union', union: 'newu2', set: {} }).uses, ['newu2']);
  assert.deepEqual(opRefs(null), { declares: [], uses: [] });
});

test('skipOps drops ops and their dependants transitively', () => {
  const p = proposal([
    { op: 'add-person', ref: 'new1', person: { name: { ar: 'أ' } }, link: { as: 'spouse', of: 'p0006' }, unionRef: 'newu2' }, // 0
    { op: 'add-person', ref: 'new3', person: { name: { ar: 'ب' } }, link: { as: 'child', of: 'p0006', with: 'new1' }, unionRef: 'newu2' }, // 1
    { op: 'add-person', ref: 'new4', person: { name: { ar: 'ج' } }, link: { as: 'child', of: 'new3' } }, // 2 uses new3
    { op: 'edit-union', union: 'newu2', set: { status: 'divorced' } }, // 3 uses newu2
    { op: 'mark', id: 'p0003', mark: 'verified' }, // 4 independent
    { op: 'reorder-children', union: 'newu2', order: ['new3'] }, // 5 names the skipped child → dropped too
  ]);
  const s1 = skipOps(p, [1]);
  assert.deepEqual(s1.ops.map((o) => o.ref ?? o.op), ['new1', 'edit-union', 'mark']); // newu2 still bound by op 0
  assert.equal(s1.id, p.id);
  assert.equal(p.ops.length, 6, 'input untouched');
  const s0 = skipOps(p, [0]);
  assert.deepEqual(s0.ops.map((o) => o.op), ['mark']);
  assert.deepEqual(skipOps(p, []).ops, p.ops);
  // a kept op re-binding a dead union ref revives it
  const q = proposal([
    { op: 'link-spouse', a: 'p0006', b: 'p0011', unionRef: 'newu7' },
    { op: 'add-person', ref: 'new8', person: { name: { ar: 'د' } }, link: { as: 'child', of: 'p0006', with: 'p0011' }, unionRef: 'newu7' },
    { op: 'edit-union', union: 'newu7', set: { status: 'divorced' } },
  ]);
  assert.equal(skipOps(q, [0]).ops.length, 2);
});

test('canonicalJSON and proposalHash', async () => {
  assert.equal(canonicalJSON({ b: 1, a: [3, { d: 'x', c: null }], u: undefined }), '{"a":[3,{"c":null,"d":"x"}],"b":1}');
  const p = proposal([{ op: 'mark', id: 'p0003', mark: 'verified' }]);
  const h = await proposalHash(p);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await proposalHash({ ...p, createdAt: '1999-01-01T00:00:00Z' }), h, 'createdAt excluded');
  const reordered = Object.fromEntries(Object.entries(p).reverse());
  assert.equal(await proposalHash(reordered), h, 'key order independent');
  assert.notEqual(await proposalHash({ ...p, note: 'x' }), h);
  assert.equal(p.createdAt, NOW, 'input untouched');
});

// =========================================================================================================
// validateProposal

test('validateProposal: envelope errors', () => {
  assert.deepEqual(errorCodes(vp(null)), ['NOT_A_PROPOSAL']);
  assert.deepEqual(errorCodes(vp([])), ['NOT_A_PROPOSAL']);
  const ok = proposal([{ op: 'mark', id: 'p0003', mark: 'verified' }]);
  assert.equal(vp(ok).ok, true);
  assert.ok(errorCodes(vp({ ...ok, kind: 'other' })).includes('NOT_A_PROPOSAL'));
  assert.ok(errorCodes(vp({ ...ok, v: 2 })).includes('BAD_VERSION'));
  assert.ok(errorCodes(vp({ ...ok, id: undefined })).includes('MISSING_FIELD'));
  assert.ok(errorCodes(vp({ ...ok, id: 'NOT VALID' })).includes('BAD_TYPE'));
  assert.ok(errorCodes(vp({ ...ok, baseRevision: -1 })).includes('BAD_TYPE'));
  assert.ok(errorCodes(vp({ ...ok, dependsOn: 'x' })).includes('BAD_TYPE'));
  assert.ok(errorCodes(vp({ ...ok, dependsOn: [ok.id] })).includes('BAD_TYPE'), 'self dependency');
  assert.ok(errorCodes(vp({ ...ok, submitter: 'me' })).includes('BAD_TYPE'));
  assert.ok(errorCodes(vp({ ...ok, submitter: { name: 'x'.repeat(101) } })).includes('TOO_LONG'));
  assert.ok(errorCodes(vp({ ...ok, submitter: { personId: 'bad id' } })).includes('BAD_REF'));
  assert.ok(errorCodes(vp({ ...ok, note: 'x'.repeat(2001) })).includes('TOO_LONG'));
  assert.ok(errorCodes(vp({ ...ok, ops: undefined })).includes('MISSING_FIELD'));
  assert.ok(errorCodes(vp({ ...ok, ops: {} })).includes('BAD_TYPE'));
  assert.deepEqual(errorCodes(vp({ ...ok, ops: [] })), ['NO_OPS']);
  const many = Array.from({ length: LIMITS.ops + 1 }, () => ({ op: 'mark', id: 'p0003', mark: 'verified' }));
  assert.ok(errorCodes(vp({ ...ok, ops: many })).includes('TOO_MANY_OPS'));
  // unknown envelope keys are only a warning
  const w = vp({ ...ok, extra: 1, submitter: { name: '', nick: 'x' } });
  assert.equal(w.ok, true);
  assert.deepEqual(warningCodes(w), ['UNKNOWN_FIELD', 'UNKNOWN_FIELD']);
});

test('validateProposal: op shape errors carry op index and path', () => {
  const r = vp(proposal([
    'not an op', // 0
    { op: 'fly' }, // 1
    { op: 'mark', id: 'p0003', mark: 'verified', extra: true }, // 2
    { op: 'mark', id: 'p0003' }, // 3 missing mark
    { op: 'mark', id: 'p0003', mark: 'famous' }, // 4
    { op: 'edit-person', id: 'nobody', set: { 'name.ar': 'x' } }, // 5 bad ref
    { op: 'edit-person', id: 'p0003', set: { 'name.xx': 'x', gender: 'x', 'birth.date': '1950-13-01', 'birth.hijri': '1445-08-30', 'birth.approx': 'yes', photo: 'ftp://x', 'name.ar': 'x'.repeat(101) } }, // 6
    { op: 'edit-person', id: 'p0003', set: {} }, // 7 empty set
    { op: 'add-person', ref: 'p0099', person: { name: { ar: 'x' } } }, // 8 bad ref name
    { op: 'add-person', ref: 'new1', person: { name: { ar: 'x', fr: 'y' }, color: 'blue', gender: 'x', birth: { date: 'yesterday' }, death: { hijri: '1600' }, photo: 'photos/x.png', needsInfo: 'x'.repeat(301) }, index: -1 }, // 9
    { op: 'add-person', ref: 'new2', person: { name: { ar: 'x' } }, link: { as: 'cousin', of: 'p0003' } }, // 10
    { op: 'add-person', ref: 'new3', person: { name: { ar: 'x' } }, link: { as: 'child' } }, // 11
    { op: 'add-person', ref: 'new4', person: { name: { ar: 'x' } }, link: { as: 'child', union: 'u0002', of: 'p0003' } }, // 12
    { op: 'add-person', ref: 'new5', person: { name: { ar: 'x' } }, link: { as: 'spouse', of: 'p0003', status: 'engaged', marriage: { date: '1990', where: 'x' } }, unionRef: 'u0002' }, // 13
    { op: 'move-person', id: 'p0006', to: {} }, // 14
    { op: 'move-person', id: 'p0006', to: { union: 'u0002', of: 'p0003' } }, // 15
    { op: 'move-person', id: 'p0006', to: 'u0002' }, // 16
    { op: 'reorder-children', union: 'u0002', order: 'p0006' }, // 17
    { op: 'add-tie', id: 'p0006', type: 'cousin-of', person: 'p0008' }, // 18
    { op: 'remove-person', id: 'p0014', reasonCode: 'because' }, // 19
    { op: 'merge-person', keep: 'p0003', remove: 'p0014', reasonCode: 'duplicate', parents: 'both' }, // 20
    { op: 'edit-union', union: 'u0002', set: { status: 'eloped', 'note.ar': 'x'.repeat(501) }, before: { colour: 1 } }, // 21
  ]));
  const at = (i) => r.errors.filter((e) => e.op === i).map((e) => e.code);
  assert.deepEqual(at(0), ['BAD_TYPE']);
  assert.deepEqual(at(1), ['UNKNOWN_OP']);
  assert.deepEqual(at(2), ['UNKNOWN_FIELD']);
  assert.deepEqual(at(3), ['MISSING_FIELD']);
  assert.deepEqual(at(4), ['BAD_ENUM']);
  assert.deepEqual(at(5), ['BAD_REF']);
  assert.deepEqual(new Set(at(6)), new Set(['UNKNOWN_FIELD', 'BAD_ENUM', 'BAD_DATE', 'BAD_HIJRI', 'BAD_TYPE', 'BAD_PHOTO', 'TOO_LONG']));
  assert.deepEqual(at(7), ['MISSING_FIELD']);
  assert.deepEqual(at(8), ['BAD_REF']);
  assert.deepEqual(new Set(at(9)), new Set(['UNKNOWN_FIELD', 'BAD_ENUM', 'BAD_DATE', 'BAD_HIJRI', 'BAD_PHOTO', 'TOO_LONG', 'BAD_TYPE']));
  assert.deepEqual(at(10), ['BAD_ENUM']);
  assert.deepEqual(at(11), ['MISSING_FIELD']);
  assert.deepEqual(at(12), ['BAD_TYPE']);
  assert.deepEqual(new Set(at(13)), new Set(['BAD_ENUM', 'UNKNOWN_FIELD', 'BAD_REF']));
  assert.deepEqual(at(14), ['MISSING_FIELD']);
  assert.deepEqual(at(15), ['BAD_TYPE']);
  assert.deepEqual(at(16), ['BAD_TYPE']);
  assert.deepEqual(at(17), ['BAD_TYPE']);
  assert.deepEqual(at(18), ['BAD_ENUM']);
  assert.deepEqual(at(19), ['BAD_ENUM']);
  assert.deepEqual(at(20), ['BAD_ENUM']);
  assert.deepEqual(new Set(at(21)), new Set(['BAD_ENUM', 'TOO_LONG', 'UNKNOWN_FIELD']));
  const e = r.errors.find((x) => x.op === 6 && x.code === 'BAD_DATE');
  assert.equal(e.path, 'ops.6.set.birth.date');
  assert.deepEqual(e.params, { field: 'set.birth.date', value: '1950-13-01' });
});

test('validateProposal: refs — declaration order, duplicates, temp refs in destructive ops, caps', () => {
  const r = vp(proposal([
    { op: 'add-person', ref: 'new1', person: { name: { ar: 'أ' } }, link: { as: 'child', of: 'new2' } }, // uses new2 before declared
    { op: 'add-person', ref: 'new2', person: { name: { ar: 'ب' } } },
    { op: 'add-person', ref: 'new2', person: { name: { ar: 'ج' } } }, // duplicate
    { op: 'edit-union', union: 'newu5', set: { status: 'divorced' }, unionRef: 'newu5' }, // used before bound
    { op: 'edit-person', id: 'new9', set: { 'name.ar': 'د' } }, // never declared, no dependsOn
    { op: 'remove-person', id: 'new2', reasonCode: 'entered-by-mistake' }, // temp in destructive op
  ]));
  assert.equal(findIssue(r.errors, 'UNKNOWN_REF').op, 0);
  assert.equal(r.errors.filter((e) => e.code === 'UNKNOWN_REF').length, 3);
  assert.equal(findIssue(r.errors, 'DUPLICATE_REF').op, 2);
  assert.deepEqual(findIssue(r.errors, 'TEMP_NOT_ALLOWED').params, { field: 'id', ref: 'new2' });
  // undeclared refs are deferred when dependsOn is set or refMap knows them
  const q = proposal([{ op: 'edit-person', id: 'new9', set: { 'name.ar': 'د' } }]);
  assert.equal(vp({ ...q, dependsOn: ['abcdefghij'] }).ok, true);
  assert.equal(vp(q, { refMap: { new9: 'p0003' } }).ok, true);
  assert.ok(errorCodes(vp(proposal([{ op: 'add-person', ref: 'new9', person: { name: { ar: 'x' } } }]), { refMap: { new9: 'p0003' } })).includes('DUPLICATE_REF'));
  // caps
  const removes = ['p0011', 'p0012', 'p0013', 'p0014'].map((id) => ({ op: 'remove-person', id, reasonCode: 'other' }));
  assert.ok(errorCodes(vp(proposal(removes))).includes('TOO_MANY_DESTRUCTIVE'));
  assert.equal(vp(proposal(removes.slice(0, 3))).ok, true);
  const merges = Array.from({ length: 31 }, () => ({ op: 'merge-person', keep: 'p0012', remove: 'p0013', reasonCode: 'duplicate' }));
  assert.ok(errorCodes(vp(proposal(merges))).includes('TOO_MANY_MERGES'));
  assert.equal(vp(proposal(merges.slice(0, 30))).ok, true, 'merges do not count toward the destructive cap');
});

// =========================================================================================================
// add-person

test('add-person without link: defaults, privacy truncation, warnings', () => {
  const r = preview(fixture(), [
    { op: 'add-person', ref: 'new1', person: { name: { ar: 'نور' }, birth: { date: '1990-05-04', place: { ar: 'جدة' } } } },
    { op: 'add-person', ref: 'new2', person: { name: { ar: 'جدّ' }, gender: 'm', deceased: true, birth: { date: '1880-02-03' } } },
    { op: 'add-person', ref: 'new3', person: { name: { ar: 'سلمى' }, gender: 'f', birth: { hijri: '1410-10-17' }, privacy: 'full' } },
  ]);
  assertOk(r);
  const p1 = r.data.people.new1;
  assert.equal(p1.privacy, 'year', 'living people default to year-only birth dates');
  assert.equal(p1.birth.date, '1990');
  assert.equal(p1.birth.place.ar, 'جدة');
  assert.equal(r.data.people.new2.privacy, 'full', 'deceased people default to full');
  assert.equal(r.data.people.new2.birth.date, '1880-02-03');
  assert.equal(r.data.people.new3.birth.date, '1990-05-12', 'Hijri birth date derives the Gregorian date');
  assert.equal(r.data.people.new3.birth.hijri, '1410-10-17');
  assert.deepEqual(findIssue(r.warnings, 'GENDER_MISSING'), { code: 'GENDER_MISSING', params: { id: 'new1' }, op: 0, path: 'ops.0.person.gender' });
  assert.deepEqual(r.created.people, ['new1', 'new2', 'new3']);
  assert.deepEqual(r.touched.people, ['new1', 'new2', 'new3']);
  assert.equal(r.data.meta.revision, 3, 'preview does not bump the revision');
  assert.deepEqual(r.data.people.new1.history, [], 'preview writes no history');
});

test('add-person: nameStatus rules', () => {
  assertError(preview(fixture(), [{ op: 'add-person', ref: 'new1', person: { gender: 'f' } }]), 'NAME_REQUIRED', 0);
  assertError(preview(fixture(), [{ op: 'add-person', ref: 'new1', person: { name: { ar: 'هند' }, nameStatus: 'withheld' } }]), 'NAME_SHOULD_BE_EMPTY', 0);
  // kunya-only and withheld-with-nickname are fine
  assertOk(preview(fixture(), [
    { op: 'add-person', ref: 'new1', person: { nickname: { ar: 'أبو خالد' }, gender: 'm' } },
    { op: 'add-person', ref: 'new2', person: { nameStatus: 'withheld', nickname: { ar: 'أم خالد' }, gender: 'f' }, link: { as: 'spouse', of: 'new1' } },
    { op: 'add-person', ref: 'new3', person: { nameStatus: 'unknown', gender: 'f' }, link: { as: 'parent', of: 'new1' } },
  ]));
});

test('add-person: NAME_LOOKS_FULL and MINOR_DETAIL', () => {
  const r = preview(fixture(), [
    person({ name: { ar: 'محمد بن حسن' } }, { ref: 'new1' }),
    person({ name: { ar: 'عبد الرحمن' } }, { ref: 'new2' }), // one compound name: fine
    person({ name: { en: 'Ahmed Hassan Salem' } }, { ref: 'new3' }),
    person({ name: { ar: 'ريم' }, gender: 'f', birth: { date: '2015-03-04', place: { ar: 'الرياض' } }, privacy: 'full', occupation: { ar: 'طالبة' }, photo: 'https://example.org/r.jpg' }, { ref: 'new4' }),
  ]);
  assertOk(r);
  const full = r.warnings.filter((w) => w.code === 'NAME_LOOKS_FULL').map((w) => w.params.id);
  assert.deepEqual(full, ['new1', 'new3']);
  const minor = assertWarning(r, 'MINOR_DETAIL');
  assert.deepEqual(minor.params, { id: 'new4', fields: ['photo', 'occupation', 'birth.place', 'birth.date'] });
  // an adult with the same details: no warning
  const adult = preview(fixture(), [person({ name: { ar: 'ريم' }, gender: 'f', birth: { date: '1980-03-04' }, privacy: 'full', occupation: { ar: 'طبيبة' } }, { ref: 'new1' })]);
  assert.equal(findIssue(adult.warnings, 'MINOR_DETAIL'), undefined);
});

test('add-person as child: find-or-create the parents union, insert by birth date or index', () => {
  const data = fixture();
  // existing couple → inserted into u0002 before the later-born sibling
  let r = preview(data, [person({ name: { ar: 'سلمان' }, birth: { date: '1955' } }, { ref: 'new1', link: { as: 'child', of: 'p0005', with: 'p0003' }, unionRef: 'newu2' })]);
  assertOk(r);
  assert.deepEqual(r.data.unions.u0002.children, ['new1', 'p0006']);
  assert.deepEqual(r.idMap, { new1: 'new1', newu2: 'u0002' }, 'unionRef binds to the union actually used');
  assert.deepEqual(r.touched.unions, ['u0002']);
  assert.deepEqual(r.created.unions, []);
  // explicit index wins; unknown birth date appends
  r = preview(data, [
    person({ name: { ar: 'سلمان' }, birth: { date: '1955' } }, { ref: 'new1', link: { as: 'child', union: 'u0002' }, index: 1 }),
    person({ name: { ar: 'رامي' } }, { ref: 'new2', link: { as: 'child', union: 'u0002' } }),
  ]);
  assert.deepEqual(r.data.unions.u0002.children, ['p0006', 'new1', 'new2']);
  // single parent: the existing {p0010} union is found
  r = preview(data, [person({ name: { ar: 'سامي' }, birth: { date: '1970' } }, { ref: 'new1', link: { as: 'child', of: 'p0010', with: null } })]);
  assert.deepEqual(r.data.unions.u0004.children, ['new1', 'p0011']);
  // new couple → union created (married), preview id = unionRef, else tmpuN
  r = preview(data, [
    person({ name: { ar: 'سامي' } }, { ref: 'new1', link: { as: 'child', of: 'p0010', with: 'p0012' }, unionRef: 'newu5' }),
    person({ name: { ar: 'باسم' } }, { ref: 'new2', link: { as: 'child', of: 'p0014' } }),
  ]);
  assertOk(r);
  assert.deepEqual(r.data.unions.newu5.partners, ['p0010', 'p0012']);
  assert.equal(r.data.unions.newu5.status, 'married');
  assert.deepEqual(r.data.unions.tmpu1.partners, ['p0014']);
  assert.equal(r.data.unions.tmpu1.status, 'unknown');
  assert.deepEqual(r.created.unions, ['newu5', 'tmpu1']);
  // the same person twice
  assertError(preview(data, [person({ name: { ar: 'س' } }, { ref: 'new1', link: { as: 'child', of: 'p0010', with: 'p0010' } })]), 'SAME_PERSON', 0);
});

test('add-person as spouse: new union, status and marriage', () => {
  const r = preview(fixture(), [
    person({ name: { ar: 'منى' }, gender: 'f' }, { ref: 'new1', link: { as: 'spouse', of: 'p0006', marriage: { date: '1985', place: { ar: 'مكة' } } }, unionRef: 'newu2' }),
    person({ name: { ar: 'هالة' }, gender: 'f' }, { ref: 'new3', link: { as: 'spouse', of: 'p0006', status: 'divorced' } }),
  ]);
  assertOk(r);
  const u = r.data.unions.newu2;
  assert.deepEqual(u.partners, ['p0006', 'new1']);
  assert.equal(u.status, 'married');
  assert.equal(u.marriage.date, '1985');
  assert.equal(u.marriage.place.ar, 'مكة');
  assert.equal(r.data.unions.tmpu1.status, 'divorced');
  assert.deepEqual(r.idMap.newu2, 'newu2');
});

test('add-person as parent, scope "union": every child of the birth union gains the parent', () => {
  const data = fixture();
  let r = preview(data, [person({ name: { ar: 'آمنة' }, gender: 'f' }, { ref: 'new1', link: { as: 'parent', of: 'p0011' }, unionRef: 'newu2' })]);
  assertOk(r);
  assert.deepEqual(r.data.unions.u0004.partners, ['p0010', 'new1']);
  assert.equal(r.idMap.newu2, 'u0004');
  // siblings with unknown parents: the first parent joins the 0-partner union
  r = preview(data, [person({ name: { ar: 'يوسف' } }, { ref: 'new1', link: { as: 'parent', of: 'p0012', scope: 'union' } })]);
  assert.deepEqual(r.data.unions.u0005.partners, ['new1']);
  assert.deepEqual(r.data.unions.u0005.children, ['p0012', 'p0013']);
  // no birth union → {partners:[new], children:[P]}
  r = preview(data, [person({ name: { ar: 'إبراهيم' } }, { ref: 'new1', link: { as: 'parent', of: 'p0014' }, unionRef: 'newu2' })]);
  assert.deepEqual(r.data.unions.newu2.partners, ['new1']);
  assert.deepEqual(r.data.unions.newu2.children, ['p0014']);
  // errors
  assertError(preview(data, [person({ name: { ar: 'ثالث' } }, { ref: 'new1', link: { as: 'parent', of: 'p0006' } })]), 'PARENTS_FULL', 0);
  const g = assertError(preview(data, [person({ name: { ar: 'رجل' }, gender: 'm' }, { ref: 'new1', link: { as: 'parent', of: 'p0011' } })]), 'PARENT_GENDER_CONFLICT', 0);
  assert.deepEqual(g.params, { id: 'p0011', parent: 'p0010', gender: 'm' });
});

test('add-person as parent, scope "only": the person alone moves to {existing parent, new}', () => {
  const data = fixture();
  data.people.p0015 = { id: 'p0015', name: { ar: 'كريم' }, gender: 'm', birth: { date: '1978' } };
  data.unions.u0004.children.push('p0015'); // أحمد p0010 → سعاد, كريم (mothers unknown)
  const r = preview(data, [person({ name: { ar: 'نادية' }, gender: 'f' }, { ref: 'new1', link: { as: 'parent', of: 'p0015', scope: 'only' }, unionRef: 'newu2' })]);
  assertOk(r);
  assert.deepEqual(r.data.unions.u0004.children, ['p0011'], 'the sibling keeps the old union');
  assert.deepEqual(r.data.unions.newu2.partners, ['p0010', 'new1']);
  assert.deepEqual(r.data.unions.newu2.children, ['p0015']);
  assert.equal(r.data.unions.newu2.status, 'married');
  assert.equal(findIssue(r.warnings, 'REPARENT'), undefined, 'the known father is kept');
  // the only child: the old single-parent union empties to one member → soft-removed (auto)
  const r2 = preview(fixture(), [person({ name: { ar: 'نادية' }, gender: 'f' }, { ref: 'new1', link: { as: 'parent', of: 'p0011', scope: 'only' } })]);
  assertOk(r2);
  assert.equal(r2.data.unions.u0004.removed.auto, true);
  assert.deepEqual(r2.data.unions.tmpu1.children, ['p0011']);
});

test('add-person as sibling: share both / father / mother (polygamy)', () => {
  const data = fixture();
  // both → appended to the birth union
  let r = preview(data, [person({ name: { ar: 'سلوى' }, gender: 'f', birth: { date: '1934' } }, { ref: 'new1', link: { as: 'sibling', of: 'p0003', share: 'both' } })]);
  assert.deepEqual(r.data.unions.u0001.children, ['p0003', 'p0004', 'new1']);
  // both, no birth union → {partners:[], children:[P, new]}
  r = preview(data, [person({ name: { ar: 'خالد' } }, { ref: 'new1', link: { as: 'sibling', of: 'p0014' }, unionRef: 'newu2' })]);
  assert.deepEqual(r.data.unions.newu2.partners, []);
  assert.deepEqual(r.data.unions.newu2.children, ['p0014', 'new1']);
  // father: علي p0008 (son of حسن & خديجة) gets a half-brother through حسن with a third, unknown mother
  r = preview(data, [person({ name: { ar: 'ياسر' } }, { ref: 'new1', link: { as: 'sibling', of: 'p0008', share: 'father' }, unionRef: 'newu2' })]);
  assertOk(r);
  assert.deepEqual(r.data.unions.newu2.partners, ['p0003']);
  let g = buildGraph(r.data);
  assert.equal(g.father('new1').id, 'p0003');
  const sib = g.siblings('new1');
  assert.deepEqual([...sib.full, ...sib.half.map((h) => h.person), ...sib.unspecified].map((x) => x.id).sort(), ['p0006', 'p0008']);
  // father with the other wife as mother → lands in u0002: full sibling of محمد, half of علي
  r = preview(data, [person({ name: { ar: 'ياسر' }, birth: { date: '1962' } }, { ref: 'new1', link: { as: 'sibling', of: 'p0008', share: 'father', otherParent: 'p0005' }, unionRef: 'newu2' })]);
  assert.equal(r.idMap.newu2, 'u0002');
  assert.deepEqual(r.data.unions.u0002.children, ['p0006', 'new1']);
  g = buildGraph(r.data);
  assert.deepEqual(g.siblings('new1').full.map((p) => p.id), ['p0006']);
  // mother → {زينب} single-parent union
  r = preview(data, [person({ name: { ar: 'هاني' } }, { ref: 'new1', link: { as: 'sibling', of: 'p0006', share: 'mother' } })]);
  assert.deepEqual(r.data.unions.tmpu1.partners, ['p0005']);
  // unknown father / mother
  assertError(preview(data, [person({ name: { ar: 'س' } }, { ref: 'new1', link: { as: 'sibling', of: 'p0012', share: 'father' } })]), 'FATHER_UNKNOWN', 0);
  assertError(preview(data, [person({ name: { ar: 'س' } }, { ref: 'new1', link: { as: 'sibling', of: 'p0011', share: 'mother' } })]), 'MOTHER_UNKNOWN', 0);
});

test('add-person: POSSIBLE_DUPLICATE (same birth union / father / surname & year / spouse with same surname)', () => {
  const data = fixture();
  data.people.p0010.surname = { ar: 'الحربي' };
  let r = preview(data, [person({ name: { ar: 'مُحمّد' } }, { ref: 'new1', link: { as: 'child', union: 'u0002' } })]);
  assertOk(r);
  assert.deepEqual(assertWarning(r, 'POSSIBLE_DUPLICATE').params, { id: 'p0006', ref: 'new1', reason: 'same-parents' });
  assertWarning(r, 'SIBLING_SAME_NAME'); // post-condition warning, new relative to the input
  r = preview(data, [person({ name: { ar: 'علي' } }, { ref: 'new1', link: { as: 'child', of: 'p0003' } })]);
  assert.equal(assertWarning(r, 'POSSIBLE_DUPLICATE').params.reason, 'same-father');
  r = preview(data, [person({ name: { ar: 'احمد' }, surname: { ar: 'الحربى' }, birth: { date: '1951' } }, { ref: 'new1' })]);
  assert.equal(assertWarning(r, 'POSSIBLE_DUPLICATE').params.reason, 'same-surname-year');
  r = preview(data, [person({ name: { ar: 'أحمد' }, surname: { ar: 'الحربي' } }, { ref: 'new1', link: { as: 'spouse', of: 'p0013' } })]);
  assert.equal(assertWarning(r, 'POSSIBLE_DUPLICATE').params.reason, 'same-nickname-or-surname');
  // same name but unrelated: no warning
  r = preview(data, [person({ name: { ar: 'أحمد' } }, { ref: 'new1' })]);
  assert.equal(findIssue(r.warnings, 'POSSIBLE_DUPLICATE'), undefined);
});

test('ref resolution: UNKNOWN_ID, TARGET_REMOVED, MERGED_REDIRECT (people and unions)', () => {
  const data = fixture();
  data.people.p0020 = { id: 'p0020', name: { ar: 'حسن' }, gender: 'm', removed: { at: NOW, reasonCode: 'duplicate', issue: 3, by: 'owner', mergedInto: 'p0003' } };
  data.people.p0021 = { id: 'p0021', name: { ar: 'قديم' }, removed: { at: NOW, reasonCode: 'entered-by-mistake', issue: 4, by: 'owner' } };
  data.people.p0022 = { id: 'p0022', name: { ar: 'حسن' }, gender: 'm', removed: { at: NOW, reasonCode: 'duplicate', issue: 5, by: 'owner', mergedInto: 'p0020' } };
  data.unions.u0009 = { id: 'u0009', partners: ['p0020', 'p0005'], removed: { at: NOW, reasonCode: 'duplicate', issue: 3, by: 'owner', mergedInto: 'u0002' } };
  const e = assertError(preview(data, [{ op: 'mark', id: 'p9999', mark: 'verified' }]), 'UNKNOWN_ID', 0);
  assert.deepEqual(e.params, { ref: 'p9999', field: 'id' });
  assertError(preview(data, [{ op: 'edit-union', union: 'u9999', set: { status: 'divorced' } }]), 'UNKNOWN_ID', 0);
  assertError(preview(data, [person({ name: { ar: 'س' } }, { ref: 'new1', link: { as: 'child', of: 'p0021' } })]), 'TARGET_REMOVED', 0);
  // merged person: followed transitively (p0022 → p0020 → p0003)
  const r = preview(data, [
    person({ name: { ar: 'سليم' } }, { ref: 'new1', link: { as: 'child', of: 'p0022', with: 'p0005' } }),
    { op: 'edit-union', union: 'u0009', set: { 'note.ar': 'تزوجا مرتين' } },
  ]);
  assertOk(r);
  assert.deepEqual(r.data.unions.u0002.children, ['p0006', 'new1']);
  assert.deepEqual(r.data.unions.u0002.note.ar, 'تزوجا مرتين');
  const redirects = r.warnings.filter((w) => w.code === 'MERGED_REDIRECT').map((w) => w.params);
  assert.deepEqual(redirects, [{ field: 'link.of', from: 'p0022', to: 'p0003' }, { field: 'union', from: 'u0009', to: 'u0002' }]);
});

// =========================================================================================================
// edit-person / mark

test('edit-person: setting semantics (dates clear hijri, death ⇒ deceased, deceased:false clears death, privacy)', () => {
  const data = fixture();
  data.people.p0003.birth = { date: '1930-02-27', hijri: '1348-10-01' };
  const r = final(data, [
    { op: 'edit-person', id: 'p0003', set: { 'birth.date': '1931', 'surname.ar': 'العالم', 'death.date': '2001-04-05' } },
    { op: 'edit-person', id: 'p0001', set: { deceased: false } },
    { op: 'edit-person', id: 'p0004', set: { 'birth.date': '1932-06-07', privacy: 'year', 'bio.ar': 'معلمة' } },
  ]);
  assertOk(r);
  const p3 = r.data.people.p0003;
  assert.deepEqual([p3.birth.date, p3.birth.hijri, p3.deceased, p3.death.date], ['1931', '', true, '2001-04-05']);
  assert.equal(r.data.people.p0001.deceased, false);
  assert.equal(r.data.people.p0004.birth.date, '1932');
  assert.deepEqual(r.data.people.p0003.history, [{ issue: 12, rev: 4, at: NOW, action: 'edit-person' }]);
  assert.deepEqual(r.touched.people, ['p0003', 'p0001', 'p0004']);
});

test('edit-person: STALE_EDIT is an error in final mode unless force, a warning in preview', () => {
  const data = fixture();
  const ops = [{ op: 'edit-person', id: 'p0003', set: { 'name.ar': 'حسين' }, before: { 'name.ar': 'حسان', 'birth.date': '1930' } }];
  const e = assertError(final(data, ops), 'STALE_EDIT', 0);
  assert.deepEqual(e.params, { id: 'p0003', path: 'name.ar', expected: 'حسان', actual: 'حسن' });
  assert.equal(e.path, 'ops.0.before.name.ar');
  const forced = final(data, ops, { force: true });
  assertOk(forced);
  assertWarning(forced, 'STALE_EDIT');
  const pv = preview(data, ops);
  assertOk(pv);
  assertWarning(pv, 'STALE_EDIT');
  // matching before: no issue (spaces and date spelling normalized)
  assertOk(final(data, [{ op: 'edit-person', id: 'p0003', set: { 'name.ar': 'حسين' }, before: { 'name.ar': ' حسن ', 'birth.date': '١٩٣٠', deceased: false } }]));
});

test('edit-person: nameStatus handling and NAME_REQUIRED', () => {
  const data = fixture();
  assertError(preview(data, [{ op: 'edit-person', id: 'p0003', set: { 'name.ar': '' } }]), 'NAME_REQUIRED', 0);
  let r = preview(data, [{ op: 'edit-person', id: 'p0005', set: { nameStatus: 'withheld', 'nickname.ar': 'أم محمد' } }]);
  assertOk(r);
  assert.deepEqual(r.data.people.p0005.name, { ar: '', en: '' }, 'withholding clears the name');
  assertError(preview(data, [{ op: 'edit-person', id: 'p0005', set: { nameStatus: 'unknown', 'name.ar': 'زينب' } }]), 'NAME_SHOULD_BE_EMPTY', 0);
  data.people.p0012 = { id: 'p0012', nameStatus: 'unknown', gender: 'f' };
  r = preview(data, [{ op: 'edit-person', id: 'p0012', set: { 'name.ar': 'ليلى بنت أحمد' } }]);
  assertOk(r);
  assert.equal(r.data.people.p0012.nameStatus, 'known', 'giving a name makes it known');
  assertWarning(r, 'NAME_LOOKS_FULL');
  // a withheld name is only published with an explicit nameStatus "known"
  data.people.p0013 = { id: 'p0013', nameStatus: 'withheld', nickname: { ar: 'أم سعد' }, gender: 'f' };
  assertError(preview(data, [{ op: 'edit-person', id: 'p0013', set: { 'name.ar': 'هدى' } }]), 'NAME_SHOULD_BE_EMPTY', 0);
  r = preview(data, [{ op: 'edit-person', id: 'p0013', set: { 'name.ar': 'هدى', nameStatus: 'known' } }]);
  assertOk(r);
  assert.equal(r.data.people.p0013.name.ar, 'هدى');
});

test('edit-person: GENDER_FLIPS_PARENT, MINOR_DETAIL, temp refs, TARGET_REMOVED', () => {
  const data = fixture();
  let r = preview(data, [{ op: 'edit-person', id: 'p0003', set: { gender: 'f' } }]);
  assert.deepEqual(assertWarning(r, 'GENDER_FLIPS_PARENT').params, { id: 'p0003', from: 'm', to: 'f' });
  r = preview(data, [{ op: 'edit-person', id: 'p0014', set: { gender: 'f' } }]);
  assert.equal(findIssue(r.warnings, 'GENDER_FLIPS_PARENT'), undefined, 'not a parent');
  r = preview(data, [
    person({ name: { ar: 'جود' }, gender: 'f', birth: { date: '2018' } }, { ref: 'new1' }),
    { op: 'edit-person', id: 'new1', set: { 'bio.ar': 'تحب الرسم' } },
  ]);
  assertOk(r);
  assert.deepEqual(assertWarning(r, 'MINOR_DETAIL').params, { id: 'new1', fields: ['bio'] });
  data.people.p0021 = { id: 'p0021', name: { ar: 'قديم' }, removed: { at: NOW, reasonCode: 'other', issue: 4, by: 'owner' } };
  assertError(preview(data, [{ op: 'edit-person', id: 'p0021', set: { 'name.ar': 'x' } }]), 'TARGET_REMOVED', 0);
});

test('mark: every mark', () => {
  const data = fixture();
  const r = final(data, [
    { op: 'mark', id: 'p0003', mark: 'deceased', date: '2001-4-5' },
    { op: 'mark', id: 'p0004', mark: 'deceased', hijri: '1420' },
    { op: 'mark', id: 'p0001', mark: 'living' },
    { op: 'mark', id: 'p0006', mark: 'verified' },
    { op: 'mark', id: 'p0007', mark: 'needs-info', note: 'سنة الميلاد؟' },
    { op: 'mark', id: 'p0012', mark: 'duplicate', of: 'p0013' },
    { op: 'mark', id: 'p0010', mark: 'private' },
  ]);
  assertOk(r);
  const P = r.data.people;
  assert.deepEqual([P.p0003.deceased, P.p0003.death.date], [true, '2001-04-05']);
  assert.deepEqual([P.p0004.deceased, P.p0004.death.hijri, P.p0004.death.date, P.p0004.death.approx], [true, '1420', '1999-04-17', true]);
  assert.equal(P.p0001.deceased, false);
  assert.deepEqual(P.p0006.tags, ['verified']);
  assert.deepEqual([P.p0007.tags, P.p0007.needsInfo], [['needs-info'], 'سنة الميلاد؟']);
  assert.equal(P.p0012.duplicateOf, 'p0013');
  assert.deepEqual([P.p0010.nameStatus, P.p0010.name.ar, P.p0010.privacy, P.p0010.birth.date], ['withheld', '', 'year', '1950']);
  const r2 = final(r.data, [
    { op: 'mark', id: 'p0006', mark: 'unverified' },
    { op: 'mark', id: 'p0007', mark: 'info-complete' },
    { op: 'mark', id: 'p0012', mark: 'not-duplicate' },
  ]);
  assertOk(r2);
  assert.deepEqual(r2.data.people.p0006.tags, []);
  assert.deepEqual([r2.data.people.p0007.tags, r2.data.people.p0007.needsInfo], [[], '']);
  assert.equal(r2.data.people.p0012.duplicateOf, '');
  assert.equal(r2.data.meta.revision, 5);
  // private clears personal details but keeps links
  data.people.p0010 = { ...data.people.p0010, occupation: { ar: 'مهندس' }, bio: { ar: 'سيرة' }, photo: 'photos/p0010.jpg', birth: { date: '1950-03-02', place: { ar: 'جدة' } } };
  const r3 = preview(data, [{ op: 'mark', id: 'p0010', mark: 'private' }]);
  const p = r3.data.people.p0010;
  assert.deepEqual([p.occupation.ar, p.bio.ar, p.photo, p.birth.place.ar, p.birth.date], ['', '', '', '', '1950']);
  assert.deepEqual(r3.data.unions.u0004.partners, ['p0010']);
  // duplicate errors
  assertError(preview(data, [{ op: 'mark', id: 'p0012', mark: 'duplicate', of: 'p0012' }]), 'SAME_PERSON', 0);
});

// =========================================================================================================
// link-spouse / move-person

test('link-spouse: new union; SAME_PERSON, DUPLICATE_UNION, ANCESTOR_LINK', () => {
  const data = fixture();
  const r = final(data, [{ op: 'link-spouse', a: 'p0006', b: 'p0011', marriage: { date: '1985' }, unionRef: 'newu1' }]);
  assertOk(r);
  const uid = r.idMap.newu1;
  assert.ok(isUnionId(uid));
  assert.deepEqual(r.data.unions[uid].partners, ['p0006', 'p0011']);
  assert.equal(r.data.unions[uid].status, 'married');
  assert.deepEqual(r.created.unions, [uid]);
  assertError(preview(data, [{ op: 'link-spouse', a: 'p0006', b: 'p0006' }]), 'SAME_PERSON', 0);
  const d = assertError(preview(data, [{ op: 'link-spouse', a: 'p0005', b: 'p0003' }]), 'DUPLICATE_UNION', 0);
  assert.equal(d.params.union, 'u0002');
  const a = assertError(preview(data, [{ op: 'link-spouse', a: 'p0001', b: 'p0006' }]), 'ANCESTOR_LINK', 0);
  assert.deepEqual([a.params.ancestor, a.params.descendant], ['p0001', 'p0006']);
});

test('move-person: change parents, REPARENT (destructive), history {from, index}, auto soft-removal', () => {
  const data = fixture();
  const ops = [{ op: 'move-person', id: 'p0011', to: { of: 'p0003', with: 'p0007' } }];
  // destructive: refused in final mode without allowDestructive
  const refused = final(data, ops);
  assert.deepEqual(assertError(refused, 'DESTRUCTIVE_NOT_ALLOWED', 0).params, { type: 'move-person', reason: 'reparent' });
  assert.equal(refused.destructive, false, 'static destructiveness only on failure');
  const r = final(data, ops, { allowDestructive: true });
  assertOk(r);
  assert.deepEqual(r.data.unions.u0003.children, ['p0008', 'p0011']);
  assert.deepEqual(assertWarning(r, 'REPARENT').params, { id: 'p0011', from: 'u0004', to: 'u0003', droppedParents: ['p0010'], descendants: 0 });
  assert.equal(r.destructive, true);
  assert.deepEqual(r.reparent, [{ op: 0, id: 'p0011', from: 'u0004', to: 'u0003', droppedParents: ['p0010'], descendants: 0 }]);
  // the emptied single-parent union is soft-removed (pre-existing), not deleted
  assert.deepEqual(r.data.unions.u0004.removed, { at: NOW, reasonCode: '', issue: 12, by: 'owner', auto: true });
  assert.deepEqual(r.data.people.p0011.history.at(-1), { issue: 12, rev: 4, at: NOW, action: 'move-person', from: 'u0004', index: 0 });
  assert.deepEqual(r.touched.people, ['p0011']);
  assert.deepEqual(r.touched.unions.sort(), ['u0003', 'u0004']);
  // preview allows destructive ops by default
  assertOk(preview(data, ops));
  // the number of descendants affected is reported
  const big = preview(data, [{ op: 'move-person', id: 'p0003', to: { of: 'p0010' } }]);
  assert.deepEqual(assertWarning(big, 'REPARENT').params, { id: 'p0003', from: 'u0001', to: 'u0004', droppedParents: ['p0001', 'p0002'], descendants: 2 });
});

test('move-person: same parents re-position, temp people, created unions pruned', () => {
  const data = fixture();
  // re-position inside the same union
  let r = preview(data, [{ op: 'move-person', id: 'p0004', to: { union: 'u0001' }, index: 0 }]);
  assertOk(r);
  assert.deepEqual(r.data.unions.u0001.children, ['p0004', 'p0003']);
  // moving a person created in this proposal: no REPARENT; the union created for them is pruned when emptied
  r = preview(data, [
    person({ name: { ar: 'أ' } }, { ref: 'new1' }),
    person({ name: { ar: 'ب' } }, { ref: 'new2', link: { as: 'sibling', of: 'new1' }, unionRef: 'newu3' }),
    { op: 'move-person', id: 'new2', to: { union: 'u0005' } },
  ]);
  assertOk(r);
  assert.equal(r.data.unions.newu3, undefined, 'created union with < 2 members is deleted');
  assert.equal(r.idMap.newu3, undefined);
  assert.deepEqual(r.data.unions.u0005.children, ['p0012', 'p0013', 'new2']);
  assert.equal(findIssue(r.warnings, 'REPARENT'), undefined);
  assert.deepEqual(r.created.unions, []);
});

test('move-person errors: INVALID_RELATION, CYCLE, ANCESTOR_LINK', () => {
  const data = fixture();
  assertError(preview(data, [{ op: 'move-person', id: 'p0003', to: { union: 'u0002' } }]), 'INVALID_RELATION', 0);
  assertError(preview(data, [{ op: 'move-person', id: 'p0003', to: { of: 'p0003' } }]), 'INVALID_RELATION', 0);
  // سالم under his grandson's union → his own ancestor
  const c = assertError(preview(data, [{ op: 'move-person', id: 'p0001', to: { union: 'u0002' } }]), 'CYCLE', 0);
  assert.deepEqual(c.params, { id: 'p0001', union: 'u0002' });
  // زينب made a daughter of her own husband
  const a = assertError(preview(data, [{ op: 'move-person', id: 'p0005', to: { of: 'p0003' } }]), 'ANCESTOR_LINK', 0);
  assert.deepEqual(a.params, { union: 'u0002', ancestor: 'p0003', descendant: 'p0005' });
});

// =========================================================================================================
// edit-union / reorder / ties

test('edit-union: set paths, hijri clearing, STALE_EDIT', () => {
  const data = fixture();
  data.unions.u0002.marriage = { hijri: '1375' };
  const r = final(data, [{ op: 'edit-union', union: 'u0002', set: { status: 'divorced', 'divorce.date': '1980', 'marriage.date': '1956-01-02', 'note.ar': 'ثم تزوجا مرة أخرى' }, before: { status: 'married' } }]);
  assertOk(r);
  const u = r.data.unions.u0002;
  assert.deepEqual([u.status, u.divorce.date, u.marriage.date, u.marriage.hijri, u.note.ar], ['divorced', '1980', '1956-01-02', '', 'ثم تزوجا مرة أخرى']);
  assert.deepEqual(r.touched, { people: [], unions: ['u0002'] });
  assertError(final(data, [{ op: 'edit-union', union: 'u0002', set: { status: 'widowed' }, before: { status: 'divorced' } }]), 'STALE_EDIT', 0);
  assertWarning(preview(data, [{ op: 'edit-union', union: 'u0002', set: { status: 'widowed' }, before: { status: 'divorced' } }]), 'STALE_EDIT');
});

test('reorder-children: listed first, unknown ids ignored, beforeOrder', () => {
  const data = fixture();
  let r = preview(data, [{ op: 'reorder-children', union: 'u0001', order: ['p0004', 'p9999', 'p0006'] }]);
  assertOk(r);
  assert.deepEqual(r.data.unions.u0001.children, ['p0004', 'p0003']);
  assert.deepEqual(assertWarning(r, 'ORDER_IGNORED').params, { union: 'u0001', ids: ['p9999', 'p0006'] });
  assertError(final(data, [{ op: 'reorder-children', union: 'u0001', order: ['p0004'], beforeOrder: ['p0004', 'p0003'] }]), 'STALE_EDIT', 0);
  r = final(data, [{ op: 'reorder-children', union: 'u0001', order: ['p0004'], beforeOrder: ['p0003', 'p0004'] }]);
  assertOk(r);
  assert.deepEqual(r.touched, { people: [], unions: ['u0001'] });
  // no change → nothing touched
  r = final(data, [{ op: 'reorder-children', union: 'u0001', order: ['p0003'] }]);
  assert.deepEqual(r.touched, { people: [], unions: [] });
});

test('reorder-spouses: listed unions first, then the current display order', () => {
  const data = fixture();
  const r = final(data, [{ op: 'reorder-spouses', id: 'p0003', order: ['u0003', 'u0001', 'u0009'] }]);
  assertOk(r);
  assert.deepEqual(r.data.people.p0003.spouseOrder, ['u0003', 'u0002']);
  assert.deepEqual(assertWarning(r, 'ORDER_IGNORED').params, { id: 'p0003', ids: ['u0001', 'u0009'] });
  assert.deepEqual(buildGraph(r.data).spouses('p0003').map((s) => s.person.id), ['p0007', 'p0005']);
  // a union created earlier in the proposal can be ordered by its temp ref
  const r2 = preview(data, [
    person({ name: { ar: 'سهى' }, gender: 'f' }, { ref: 'new1', link: { as: 'spouse', of: 'p0003' }, unionRef: 'newu2' }),
    { op: 'reorder-spouses', id: 'p0003', order: ['newu2'] },
  ]);
  assertOk(r2);
  assert.deepEqual(r2.data.people.p0003.spouseOrder, ['newu2', 'u0002', 'u0003']);
});

test('add-tie / remove-tie', () => {
  const data = fixture();
  let r = preview(data, [{ op: 'add-tie', id: 'p0011', type: 'foster-child-of', person: 'p0003', note: { ar: 'كفالة' } }]);
  assertOk(r);
  assert.deepEqual(r.data.people.p0011.ties, [{ type: 'foster-child-of', person: 'p0003', note: { ar: 'كفالة', en: '' } }]);
  assertError(preview(data, [{ op: 'add-tie', id: 'p0008', type: 'milk-child-of', person: 'p0005' }]), 'DUPLICATE_TIE', 0);
  assertError(preview(data, [{ op: 'add-tie', id: 'p0008', type: 'milk-child-of', person: 'p0008' }]), 'SAME_PERSON', 0);
  r = final(data, [{ op: 'remove-tie', id: 'p0008', type: 'milk-child-of', person: 'p0005', reasonCode: 'entered-by-mistake' }], { allowDestructive: true });
  assertOk(r);
  assert.deepEqual(r.data.people.p0008.ties, []);
  assert.equal(r.destructive, true);
  assertError(preview(data, [{ op: 'remove-tie', id: 'p0008', type: 'foster-child-of', person: 'p0005', reasonCode: 'other' }]), 'TIE_NOT_FOUND', 0);
  assertError(final(data, [{ op: 'remove-tie', id: 'p0008', type: 'milk-child-of', person: 'p0005', reasonCode: 'other' }]), 'DESTRUCTIVE_NOT_ALLOWED', 0);
});

// =========================================================================================================
// remove / unlink / detach / restore

test('remove-person: soft delete with its childless unions; redact; guards', () => {
  const data = fixture();
  data.people.p0004.spouseOrder = ['u0006'];
  const r = final(data, [{ op: 'remove-person', id: 'p0014', reasonCode: 'entered-by-mistake' }], { allowDestructive: true });
  assertOk(r);
  assert.deepEqual(r.data.people.p0014.removed, { at: NOW, reasonCode: 'entered-by-mistake', issue: 12, by: 'owner' });
  assert.deepEqual(r.data.unions.u0006.removed, { at: NOW, reasonCode: 'entered-by-mistake', issue: 12, by: 'owner', with: 'p0014' });
  assert.deepEqual(r.data.people.p0004.spouseOrder, [], 'removed union dropped from the spouse order');
  assert.deepEqual(r.touched.people.sort(), ['p0004', 'p0014']);
  assert.equal(buildGraph(r.data).person('p0014'), null);
  // redact: "remove me" clears personal fields
  data.people.p0011 = { ...data.people.p0011, nickname: { ar: 'أم سامي' }, occupation: { ar: 'معلمة' }, birth: { date: '1975', place: { ar: 'جدة' } } };
  const red = preview(data, [{ op: 'remove-person', id: 'p0011', reasonCode: 'person-requested', redact: true }]);
  assertOk(red);
  const p = red.data.people.p0011;
  assert.deepEqual([p.nameStatus, p.name.ar, p.nickname.ar, p.occupation.ar, p.birth.date, p.birth.place.ar, p.privacy, p.gender],
    ['withheld', '', '', '', '', '', 'hidden', 'f']);
  assert.equal(p.removed.reasonCode, 'person-requested');
  assert.equal(red.data.unions.u0004.removed, null, 'birth union kept: the removed person still counts as a member');
  // guards
  assertError(preview(data, [{ op: 'remove-person', id: 'p0001', reasonCode: 'other' }]), 'IS_ROOT', 0);
  assert.deepEqual(assertError(preview(data, [{ op: 'remove-person', id: 'p0003', reasonCode: 'other' }]), 'HAS_CHILDREN', 0).params,
    { id: 'p0003', children: ['p0006', 'p0008'] });
  assertError(preview(r.data, [{ op: 'remove-person', id: 'p0014', reasonCode: 'other' }]), 'ALREADY_REMOVED', 0);
  assertError(preview(data, [{ op: 'remove-person', id: 'p9999', reasonCode: 'other' }]), 'UNKNOWN_ID', 0);
  assertError(final(data, [{ op: 'remove-person', id: 'p0014', reasonCode: 'other' }]), 'DESTRUCTIVE_NOT_ALLOWED', 0);
});

test('restore-person: re-activates unions removed with them; NOT_REMOVED, MERGED_USE_UNDO, RESTORE_CONFLICT', () => {
  const data = fixture();
  const removed = final(data, [{ op: 'remove-person', id: 'p0014', reasonCode: 'other' }], { allowDestructive: true }).data;
  const r = final(removed, [{ op: 'restore-person', id: 'p0014' }]);
  assertOk(r);
  assert.equal(r.data.people.p0014.removed, null);
  assert.equal(r.data.unions.u0006.removed, null);
  assert.equal(r.destructive, false);
  assertError(preview(data, [{ op: 'restore-person', id: 'p0014' }]), 'NOT_REMOVED', 0);
  const merged = fixture();
  merged.people.p0020 = { id: 'p0020', name: { ar: 'حسن' }, removed: { at: NOW, reasonCode: 'duplicate', issue: 3, by: 'owner', mergedInto: 'p0003' } };
  assert.deepEqual(assertError(preview(merged, [{ op: 'restore-person', id: 'p0020' }]), 'MERGED_USE_UNDO', 0).params, { id: 'p0020', mergedInto: 'p0003' });
  // meanwhile another active union with the same couple was created → conflict
  const conflict = structuredClone(removed);
  conflict.unions.u0007 = { id: 'u0007', partners: ['p0004', 'p0014'], status: 'married' };
  const c = assertError(preview(conflict, [{ op: 'restore-person', id: 'p0014' }]), 'RESTORE_CONFLICT', 0);
  assert.equal(c.params.reason, 'duplicate-union');
  // a child of the restored union is now in another active union → birth-union conflict
  const conflict2 = fixture();
  conflict2.people.p0030 = { id: 'p0030', name: { ar: 'ولد' }, gender: 'm', removed: { at: NOW, reasonCode: 'other', issue: 1, by: 'owner' } };
  conflict2.unions.u0008 = { id: 'u0008', partners: ['p0030'], children: ['p0013'], removed: { at: NOW, reasonCode: 'other', issue: 1, by: 'owner', with: 'p0030' } };
  assert.equal(assertError(preview(conflict2, [{ op: 'restore-person', id: 'p0030' }]), 'RESTORE_CONFLICT', 0).params.reason, 'birth-union');
});

test('unlink-spouse and restore-union', () => {
  const data = fixture();
  const r = final(data, [{ op: 'unlink-spouse', union: 'u0006', reasonCode: 'wrong-parents' }], { allowDestructive: true });
  assertOk(r);
  assert.equal(r.data.unions.u0006.removed.reasonCode, 'wrong-parents');
  assert.equal(buildGraph(r.data).spouses('p0004').length, 0);
  assertError(preview(data, [{ op: 'unlink-spouse', union: 'u0002', reasonCode: 'other' }]), 'HAS_CHILDREN', 0);
  assert.deepEqual(assertError(preview(data, [{ op: 'unlink-spouse', union: 'u0004', reasonCode: 'other' }]), 'NOT_A_COUPLE', 0).params,
    { union: 'u0004', partners: ['p0010'] });
  assertError(preview(r.data, [{ op: 'unlink-spouse', union: 'u0006', reasonCode: 'other' }]), 'TARGET_REMOVED', 0);
  // restore
  const back = final(r.data, [{ op: 'restore-union', union: 'u0006' }]);
  assertOk(back);
  assert.equal(back.data.unions.u0006.removed, null);
  assertError(preview(data, [{ op: 'restore-union', union: 'u0006' }]), 'NOT_REMOVED', 0);
  // conflicts: a removed partner; a new union for the same couple
  const withRemoved = final(r.data, [{ op: 'remove-person', id: 'p0014', reasonCode: 'other' }], { allowDestructive: true }).data;
  assert.equal(assertError(preview(withRemoved, [{ op: 'restore-union', union: 'u0006' }]), 'RESTORE_CONFLICT', 0).params.reason, 'partner-removed');
  const relinked = final(r.data, [{ op: 'link-spouse', a: 'p0004', b: 'p0014' }]).data;
  assert.equal(assertError(preview(relinked, [{ op: 'restore-union', union: 'u0006' }]), 'RESTORE_CONFLICT', 0).params.reason, 'duplicate-union');
});

test('detach-person: history {from, index}; move-person {union: from} undoes it', () => {
  const data = fixture();
  const r = final(data, [{ op: 'detach-person', id: 'p0004', reasonCode: 'wrong-parents' }], { allowDestructive: true });
  assertOk(r);
  assert.deepEqual(r.data.unions.u0001.children, ['p0003']);
  const h = r.data.people.p0004.history.at(-1);
  assert.deepEqual(h, { issue: 12, rev: 4, at: NOW, action: 'detach-person', from: 'u0001', index: 1 });
  const undo = final(r.data, [{ op: 'move-person', id: 'p0004', to: { union: h.from }, index: h.index }]);
  assertOk(undo);
  assert.deepEqual(undo.data.unions.u0001.children, ['p0003', 'p0004']);
  assert.equal(findIssue(undo.warnings, 'REPARENT'), undefined);
  // the only child of a single-parent union: the union is soft-removed (auto)
  const solo = final(data, [{ op: 'detach-person', id: 'p0011', reasonCode: 'wrong-parents' }], { allowDestructive: true });
  assert.equal(solo.data.unions.u0004.removed.auto, true);
  assertError(preview(data, [{ op: 'detach-person', id: 'p0014', reasonCode: 'other' }]), 'NO_PARENTS', 0);
  assertError(final(data, [{ op: 'detach-person', id: 'p0004', reasonCode: 'other' }]), 'DESTRUCTIVE_NOT_ALLOWED', 0);
});

// =========================================================================================================
// merge-person

/** Fixture + a duplicate of حسن (p0020) married to زينب again (u0010, with a child) and referenced by others. */
function mergeFixture() {
  const data = fixture();
  data.people.p0020 = {
    id: 'p0020', name: { ar: 'حسن', en: 'Hasan' }, surname: { ar: 'العالم' }, gender: 'm', birth: { date: '1929' }, occupation: { ar: 'تاجر' },
    tags: ['needs-info'], ties: [{ type: 'foster-child-of', person: 'p0010' }], spouseOrder: ['u0010', 'u0011'],
  };
  data.people.p0021 = { id: 'p0021', name: { ar: 'سارة' }, gender: 'f', birth: { date: '1962' } };
  data.people.p0022 = { id: 'p0022', name: { ar: 'نوال' }, gender: 'f', duplicateOf: 'p0020', ties: [{ type: 'milk-child-of', person: 'p0020' }] };
  data.people.p0023 = { id: 'p0023', name: { ar: 'دعاء' }, gender: 'f' };
  data.unions.u0010 = { id: 'u0010', partners: ['p0020', 'p0005'], children: ['p0021'], marriage: { date: '1958', place: { ar: 'مكة' } }, status: 'married' };
  data.unions.u0011 = { id: 'u0011', partners: ['p0020', 'p0023'], status: 'married' };
  return data;
}

test('merge-person: unions rewritten and collapsed, fields filled, references redirected', () => {
  const data = mergeFixture();
  assert.equal(validateData(data).ok, true, JSON.stringify(validateData(data).errors));
  const r = final(data, [{ op: 'merge-person', keep: 'p0003', remove: 'p0020', reasonCode: 'duplicate' }], { allowDestructive: true });
  assertOk(r);
  const U = r.data.unions;
  const P = r.data.people;
  // u0010 {p0020, زينب} became {حسن, زينب} = u0002 → collapsed into the earlier u0002
  assert.deepEqual(U.u0002.children, ['p0006', 'p0021']);
  assert.deepEqual([U.u0002.marriage.date, U.u0002.marriage.place.ar], ['1958', 'مكة'], 'empty marriage fields filled');
  assert.equal(U.u0010.removed.mergedInto, 'u0002');
  assert.deepEqual(U.u0011.partners, ['p0003', 'p0023']);
  // keep's fields
  assert.deepEqual([P.p0003.occupation.ar, P.p0003.name.en, P.p0003.surname.ar], ['تاجر', 'Hasan', 'العالم']);
  assert.deepEqual(P.p0003.tags, ['needs-info']);
  assert.deepEqual(P.p0003.ties, [{ type: 'foster-child-of', person: 'p0010', note: { ar: '', en: '' } }]);
  assert.deepEqual(P.p0003.spouseOrder, ['u0002', 'u0003', 'u0011'], 'remove\'s unions appended after keep\'s');
  assert.deepEqual(assertWarning(r, 'MERGE_FIELD_CONFLICT').params, { path: 'birth.date', keep: '1930', remove: '1929' });
  // others' references
  assert.equal(P.p0022.duplicateOf, 'p0003');
  assert.deepEqual(P.p0022.ties.map((t) => t.person), ['p0003']);
  // remove is now a redirect
  assert.equal(P.p0020.removed.mergedInto, 'p0003');
  assert.equal(P.p0020.removed.reasonCode, 'duplicate');
  assert.equal(r.merges, 1);
  assert.equal(r.destructive, true);
  assert.ok(P.p0003.history.some((h) => h.action === 'merge-person'));
  assert.equal(validateData(r.data).ok, true);
  // later proposals referencing the merged person or union are redirected
  const later = preview(r.data, [
    person({ name: { ar: 'رنا' }, gender: 'f' }, { ref: 'new1', link: { as: 'child', of: 'p0020', with: 'p0005' } }),
    { op: 'reorder-children', union: 'u0010', order: ['p0021'] },
  ]);
  assertOk(later);
  assert.deepEqual(later.data.unions.u0002.children, ['p0021', 'p0006', 'new1']);
  assert.equal(later.warnings.filter((w) => w.code === 'MERGED_REDIRECT').length, 2);
  // a merged union cannot simply be restored
  assertError(preview(r.data, [{ op: 'restore-union', union: 'u0010' }]), 'MERGED_USE_UNDO', 0);
  assertError(preview(r.data, [{ op: 'restore-person', id: 'p0020' }]), 'MERGED_USE_UNDO', 0);
});

test('merge-person: birth unions and the parents choice; root redirect', () => {
  const data = fixture();
  // a second record of عائشة with no parents, married to عمر again
  data.people.p0030 = { id: 'p0030', name: { ar: 'عائشه' }, gender: 'f' };
  let r = preview(data, [{ op: 'merge-person', keep: 'p0030', remove: 'p0004', reasonCode: 'duplicate' }]);
  assertOk(r);
  assert.deepEqual(r.data.unions.u0001.children, ['p0003', 'p0030'], 'keep takes remove\'s slot');
  assert.deepEqual(r.data.unions.u0006.partners, ['p0030', 'p0014']);
  // withholding wins: a withheld duplicate keeps the merged person's name hidden
  const hidden = fixture();
  hidden.people.p0030 = { id: 'p0030', nameStatus: 'withheld', nickname: { ar: 'أم عمر' }, gender: 'f' };
  r = preview(hidden, [{ op: 'merge-person', keep: 'p0004', remove: 'p0030', reasonCode: 'duplicate' }]);
  assertOk(r);
  assert.deepEqual([r.data.people.p0004.nameStatus, r.data.people.p0004.name.ar, r.data.people.p0004.nickname.ar], ['withheld', '', 'أم عمر']);
  assert.deepEqual(assertWarning(r, 'MERGE_FIELD_CONFLICT').params, { path: 'nameStatus', keep: 'known', remove: 'withheld' });
  // both have different parents
  data.unions.u0012 = { id: 'u0012', partners: ['p0013'], children: ['p0030'] };
  assertError(preview(data, [{ op: 'merge-person', keep: 'p0030', remove: 'p0004', reasonCode: 'duplicate' }]), 'CONFLICTING_PARENTS', 0);
  r = preview(data, [{ op: 'merge-person', keep: 'p0030', remove: 'p0004', reasonCode: 'duplicate', parents: 'keep' }]);
  assertOk(r);
  assert.deepEqual(r.data.unions.u0001.children, ['p0003']);
  assert.deepEqual(r.data.unions.u0012.children, ['p0030']);
  r = preview(data, [{ op: 'merge-person', keep: 'p0030', remove: 'p0004', reasonCode: 'duplicate', parents: 'remove' }]);
  assertOk(r);
  assert.deepEqual(r.data.unions.u0001.children, ['p0003', 'p0030']);
  assert.equal(r.data.unions.u0012.removed.auto, true, 'keep\'s old single-parent union emptied → soft-removed');
  // same birth union: remove is dropped
  data.unions.u0001.children.push('p0031');
  data.people.p0031 = { id: 'p0031', name: { ar: 'حسن' }, gender: 'm' };
  r = preview(data, [{ op: 'merge-person', keep: 'p0003', remove: 'p0031', reasonCode: 'duplicate' }]);
  assert.deepEqual(r.data.unions.u0001.children, ['p0003', 'p0004']);
  // root
  const rootData = fixture();
  rootData.people.p0040 = { id: 'p0040', name: { ar: 'سالم' }, gender: 'm' };
  r = final(rootData, [{ op: 'merge-person', keep: 'p0040', remove: 'p0001', reasonCode: 'duplicate' }], { allowDestructive: true });
  assertOk(r);
  assert.equal(r.data.meta.rootPersonId, 'p0040');
  assert.deepEqual(r.data.unions.u0001.partners, ['p0040', 'p0002']);
  assert.equal(r.data.people.p0040.surname.ar, 'العالم');
});

test('merge-person errors', () => {
  const data = mergeFixture();
  assertError(preview(data, [{ op: 'merge-person', keep: 'p0003', remove: 'p0003', reasonCode: 'duplicate' }]), 'SAME_PERSON', 0);
  assertError(preview(data, [{ op: 'merge-person', keep: 'p0003', remove: 'p0004', reasonCode: 'duplicate' }]), 'GENDER_CONFLICT', 0);
  assertError(preview(data, [{ op: 'merge-person', keep: 'p0003', remove: 'p0005', reasonCode: 'duplicate' }]), 'GENDER_CONFLICT', 0);
  const s = fixture();
  s.people.p0005.gender = '';
  assertError(preview(s, [{ op: 'merge-person', keep: 'p0003', remove: 'p0005', reasonCode: 'duplicate' }]), 'MERGE_SPOUSES', 0);
  assertError(preview(data, [{ op: 'merge-person', keep: 'p0001', remove: 'p0006', reasonCode: 'duplicate' }]), 'ANCESTOR_LINK', 0);
  assertError(preview(data, [{ op: 'merge-person', keep: 'p0006', remove: 'p0001', reasonCode: 'duplicate' }]), 'ANCESTOR_LINK', 0);
  const removed = final(fixture(), [{ op: 'remove-person', id: 'p0014', reasonCode: 'other' }], { allowDestructive: true }).data;
  assertError(preview(removed, [{ op: 'merge-person', keep: 'p0010', remove: 'p0014', reasonCode: 'duplicate' }]), 'TARGET_REMOVED', 0);
  assertError(final(data, [{ op: 'merge-person', keep: 'p0003', remove: 'p0020', reasonCode: 'duplicate' }]), 'DESTRUCTIVE_NOT_ALLOWED', 0);
  // on the result: remove is the father of keep's wife → keep would be his wife's father
  const anc = fixture();
  anc.people.p0050 = { id: 'p0050', name: { ar: 'عمر' }, gender: 'm' };
  anc.unions.u0013 = { id: 'u0013', partners: ['p0050'], children: ['p0004'] };
  anc.unions.u0001.children = ['p0003'];
  const e = assertError(preview(anc, [{ op: 'merge-person', keep: 'p0014', remove: 'p0050', reasonCode: 'duplicate' }]), 'ANCESTOR_LINK', 0);
  assert.deepEqual(e.params, { union: 'u0006', ancestor: 'p0014', descendant: 'p0004' });
});

// =========================================================================================================
// Atomicity, preview vs final, dependsOn

test('atomicity: any error → ok:false, data unchanged, all independent errors listed, dependants skipped', () => {
  const data = fixture();
  const snapshot = structuredClone(data);
  const r = preview(data, [
    person({ name: { ar: 'أ' } }, { ref: 'new1', link: { as: 'child', union: 'u0002' } }), // 0 fine
    person({ name: { ar: 'ب' } }, { ref: 'new2', link: { as: 'parent', of: 'p0006' } }), // 1 PARENTS_FULL
    person({ name: { ar: 'ج' } }, { ref: 'new3', link: { as: 'child', of: 'new2' } }), // 2 depends on failed new2 → skipped
    { op: 'link-spouse', a: 'p0003', b: 'p0005' }, // 3 DUPLICATE_UNION
    { op: 'edit-person', id: 'new1', set: { 'name.ar': 'أأ' } }, // 4 fine
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.data, data, 'the input object is returned');
  assert.deepEqual(data, snapshot, 'input never mutated');
  assert.deepEqual(r.errors.map((e) => [e.op, e.code]), [[1, 'PARENTS_FULL'], [3, 'DUPLICATE_UNION']]);
  assert.deepEqual(r.idMap, {});
  // a failing op is rolled back before later ops are judged: op 1 creates a union then fails its check
  const r2 = preview(data, [
    { op: 'move-person', id: 'p0001', to: { of: 'p0006', with: 'p0011' } }, // creates {p0006,p0011}, then CYCLE
    { op: 'link-spouse', a: 'p0006', b: 'p0011' }, // must not see the rolled-back union
  ]);
  assert.deepEqual(r2.errors.map((e) => [e.op, e.code]), [[0, 'CYCLE']]);
  // successful apply never mutates the input either
  const ok = final(data, [{ op: 'detach-person', id: 'p0004', reasonCode: 'other' }], { allowDestructive: true });
  assertOk(ok);
  assert.deepEqual(data, snapshot);
});

test('preview draft: spouse + child via unionRef + reorder on the temp union; validateData(allowTempIds)', () => {
  const data = fixture();
  const ops = [
    person({ name: { ar: 'هند' }, gender: 'f' }, { ref: 'new1', link: { as: 'spouse', of: 'p0006' }, unionRef: 'newu2' }),
    person({ name: { ar: 'زياد' }, birth: { date: '1990' } }, { ref: 'new3', link: { as: 'child', of: 'p0006', with: 'new1' }, unionRef: 'newu2' }),
    person({ name: { ar: 'رهف' }, gender: 'f', birth: { date: '1988' } }, { ref: 'new4', link: { as: 'child', union: 'newu2' }, unionRef: 'newu2' }),
    { op: 'reorder-children', union: 'newu2', order: ['new3', 'new4'] },
    { op: 'edit-union', union: 'newu2', set: { 'marriage.date': '1985' } },
  ];
  const r = preview(data, ops);
  assertOk(r);
  assert.deepEqual(r.data.unions.newu2.partners, ['p0006', 'new1']);
  assert.deepEqual(r.data.unions.newu2.children, ['new3', 'new4']);
  assert.deepEqual(r.idMap, { new1: 'new1', new3: 'new3', new4: 'new4', newu2: 'newu2' });
  assert.equal(validateData(r.data, { allowTempIds: true }).ok, true);
  assert.equal(validateData(r.data).ok, false, 'temp ids are preview-only');
  // final: random ids, idMap maps every ref, no temp id survives
  const f = final(data, ops, { idGen: undefined });
  assertOk(f);
  assert.deepEqual(Object.keys(f.idMap).sort(), ['new1', 'new3', 'new4', 'newu2']);
  for (const ref of ['new1', 'new3', 'new4']) assert.ok(isPersonId(f.idMap[ref]) && /^p[a-z0-9]{7}$/.test(f.idMap[ref]), f.idMap[ref]);
  assert.ok(/^u[a-z0-9]{7}$/.test(f.idMap.newu2));
  assert.equal(new Set(Object.values(f.idMap)).size, 4);
  assert.equal(validateData(f.data).ok, true);
  assert.ok(!serializeData(f.data).includes('"new'), 'no temp ref in the stored file');
  assert.equal(f.data.meta.revision, 4);
  assert.equal(f.data.meta.updatedAt, NOW);
  assert.deepEqual(f.data.people[f.idMap.new3].history, [{ issue: 12, rev: 4, at: NOW, action: 'add-person' }]);
  assert.deepEqual(f.created.people.sort(), [f.idMap.new1, f.idMap.new3, f.idMap.new4].sort());
  // explicit revision
  assert.equal(final(data, ops, { rev: 40 }).data.meta.revision, 40);
  // history keeps the newest 20 entries
  const full = fixture();
  full.people.p0003.history = Array.from({ length: 20 }, (_, k) => ({ issue: k, rev: k, at: NOW, action: 'edit-person' }));
  const h = final(full, [{ op: 'mark', id: 'p0003', mark: 'verified' }]).data.people.p0003.history;
  assert.equal(h.length, 20);
  assert.equal(h[0].issue, 1);
  assert.deepEqual(h.at(-1), { issue: 12, rev: 4, at: NOW, action: 'mark' });
});

test('unionRef binding conflicts → DUPLICATE_REF; preview ref colliding with existing data', () => {
  const data = fixture();
  const r = preview(data, [
    person({ name: { ar: 'أ' } }, { ref: 'new1', link: { as: 'child', union: 'u0002' }, unionRef: 'newu2' }),
    person({ name: { ar: 'ب' } }, { ref: 'new3', link: { as: 'child', union: 'u0003' }, unionRef: 'newu2' }),
  ]);
  assert.deepEqual(assertError(r, 'DUPLICATE_REF', 1).params, { ref: 'newu2', field: 'unionRef', union: 'u0002', used: 'u0003' });
  const overlay = preview(data, [person({ name: { ar: 'أ' } }, { ref: 'new1' })]).data;
  assertError(preview(overlay, [person({ name: { ar: 'ب' } }, { ref: 'new1' })]), 'DUPLICATE_REF', 0);
});

test('dependsOn: refMap in final mode, DEPENDS_ON_PENDING, applyProposals overlay', () => {
  const data = fixture();
  const A = proposal([person({ name: { ar: 'هند' }, gender: 'f' }, { ref: 'new1', link: { as: 'spouse', of: 'p0006' }, unionRef: 'newu2' })], { id: 'aaaaaaaaaa' });
  const B = proposal([
    person({ name: { ar: 'زياد' } }, { ref: 'new3', link: { as: 'child', union: 'newu2' } }),
    { op: 'edit-person', id: 'new1', set: { 'surname.ar': 'الأنصاري' } },
  ], { id: 'bbbbbbbbbb', dependsOn: ['aaaaaaaaaa'] });
  assert.equal(vp(B).ok, true, 'deferred to apply');
  // The site always sets unionRef (§3.2), also on an op that USES a union of a dependsOn proposal: carrying the
  // same ref re-binds it and does not declare it, so it is not "used before declared" (same rule as opRefs).
  const B2 = { ...B, ops: [{ ...B.ops[0], unionRef: 'newu2' }, B.ops[1]] };
  assert.equal(vp(B2).ok, true, 'unionRef equal to the used union ref is not a declaration');
  assert.deepEqual(vp({ ...B2, dependsOn: [] }).errors.map((e) => [e.op, e.code, e.params.ref]),
    [[0, 'UNKNOWN_REF', 'newu2'], [1, 'UNKNOWN_REF', 'new1']]);
  // final: A applied first, B resolves A's refs through refMap (applied.json idMap)
  const ra = record(applyProposal(data, A, { mode: 'final', now: NOW, issue: 1 }));
  assertOk(ra);
  const rb = record(applyProposal(ra.data, B, { mode: 'final', now: NOW, issue: 2, refMap: ra.idMap }));
  assertOk(rb);
  assert.deepEqual(rb.data.unions[ra.idMap.newu2].children, [rb.idMap.new3]);
  assert.equal(rb.data.people[ra.idMap.new1].surname.ar, 'الأنصاري');
  const rb2 = record(applyProposal(ra.data, B2, { mode: 'final', now: NOW, issue: 2, refMap: ra.idMap }));
  assertOk(rb2);
  assert.deepEqual(rb2.data.unions[ra.idMap.newu2].children, [rb2.idMap.new3]);
  const pv2 = applyProposals(data, [A, B2], { mode: 'preview', now: NOW });
  assert.equal(pv2.ok, true, JSON.stringify(pv2.errors));
  assert.deepEqual(pv2.data.unions.newu2.children, ['new3']);
  // A not applied yet
  const pending = record(applyProposal(data, B, { mode: 'final', now: NOW }));
  assert.deepEqual(assertError(pending, 'DEPENDS_ON_PENDING', 0).params, { proposalId: 'aaaaaaaaaa', pending: ['aaaaaaaaaa'], ref: 'newu2', field: 'link.union' });
  // A known to be applied but the ref still missing → UNKNOWN_REF
  const missing = record(applyProposal(data, B, { mode: 'final', now: NOW, appliedDeps: ['aaaaaaaaaa'] }));
  assertError(missing, 'UNKNOWN_REF', 0);
  // preview overlay of sent proposals
  const all = applyProposals(data, [A, B], { mode: 'preview', now: NOW });
  assert.equal(all.ok, true, JSON.stringify(all.errors));
  assert.deepEqual(all.data.unions.newu2.children, ['new3']);
  assert.deepEqual(all.refMap, { new1: 'new1', newu2: 'newu2', new3: 'new3' });
  assert.deepEqual(all.created.people.sort(), ['new1', 'new3']);
  // preview: a sent proposal that no longer applies leaves its dependants pending
  assertError(preview(data, B.ops, { envelope: { dependsOn: ['aaaaaaaaaa'] } }), 'DEPENDS_ON_PENDING', 0);
  // a failing proposal is skipped, the rest still apply
  const bad = proposal([{ op: 'link-spouse', a: 'p0003', b: 'p0005' }], { id: 'cccccccccc' });
  const mixed = applyProposals(data, [A, bad, B], { mode: 'preview', now: NOW });
  assert.equal(mixed.ok, false);
  assert.deepEqual(mixed.errors.map((e) => [e.proposal, e.code]), [[1, 'DUPLICATE_UNION']]);
  assert.deepEqual(mixed.data.unions.newu2.children, ['new3']);
});

test('post-condition: new invariant errors fail; pre-existing problems neither block nor repeat', () => {
  const data = fixture();
  // an id generator producing an invalid id is caught by validateData
  const bad = final(data, [person({ name: { ar: 'أ' } }, { ref: 'new1' })], { idGen: (prefix) => `${prefix}BAD` });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].code, 'BAD_ID');
  // data-quality warnings that are new show up (here: death before birth)
  const w = preview(data, [{ op: 'edit-person', id: 'p0001', set: { 'death.date': '1890' } }]);
  assertOk(w);
  assertWarning(w, 'DEATH_BEFORE_BIRTH');
  // pre-existing error elsewhere: an unrelated fix still applies; old warnings are not repeated
  const broken = fixture();
  broken.people.p0013.birth = { date: '1990-02-31' };
  broken.unions.u0006.status = 'widowed';
  const r = preview(broken, [{ op: 'mark', id: 'p0003', mark: 'verified' }]);
  assertOk(r);
  assert.equal(findIssue(r.warnings, 'WIDOWED_BUT_LIVING'), undefined);
});

// =========================================================================================================
// Real data

test('real data: a realistic "add my family" proposal applies in preview and final mode', async () => {
  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const g = buildGraph(normalizeData(raw));
  // a living man of the youngest generation without a spouse: the visitor
  const me = g.people().find((p) => p.gender === 'm' && !p.deceased && g.spouses(p.id).length === 0 && g.children(p.id).length === 0 && g.parents(p.id).length > 0);
  assert.ok(me, 'a suitable person exists in the real data');
  const ops = [
    { op: 'edit-person', id: me.id, set: { 'birth.date': '1988-07-15', privacy: 'year', 'occupation.ar': 'مهندس' }, before: { 'birth.date': me.birth?.date ?? '' } },
    person({ name: { ar: 'ريم' }, surname: { ar: 'القحطاني' }, gender: 'f', birth: { date: '1991' } }, { ref: 'new1', link: { as: 'spouse', of: me.id, marriage: { date: '2014' } }, unionRef: 'newu2' }),
    person({ name: { ar: 'عبد الله' }, birth: { date: '2015' } }, { ref: 'new3', link: { as: 'child', of: me.id, with: 'new1' }, unionRef: 'newu2' }),
    person({ name: { ar: 'جود' }, gender: 'f', birth: { date: '2017' } }, { ref: 'new4', link: { as: 'child', of: me.id, with: 'new1' }, unionRef: 'newu2' }),
    person({ name: { ar: 'سلطان' }, birth: { hijri: '1442' } }, { ref: 'new5', link: { as: 'child', of: me.id, with: 'new1' }, unionRef: 'newu2' }),
    person({ name: { ar: 'سعد' }, surname: { ar: 'القحطاني' }, birth: { date: '1960' } }, { ref: 'new6', link: { as: 'parent', of: 'new1' }, unionRef: 'newu7' }),
    person({ nameStatus: 'withheld', nickname: { ar: 'أم فهد' }, gender: 'f' }, { ref: 'new8', link: { as: 'parent', of: 'new1' }, unionRef: 'newu7' }),
    person({ name: { ar: 'فهد' }, surname: { ar: 'القحطاني' } }, { ref: 'new9', link: { as: 'sibling', of: 'new1', share: 'both' }, unionRef: 'newu7' }),
    { op: 'reorder-children', union: 'newu2', order: ['new5', 'new4', 'new3'] },
    { op: 'mark', id: me.id, mark: 'verified' },
  ];
  const p = proposal(ops, { id: 'familyadd1' });
  // through the codec, as it travels on WhatsApp
  const decoded = await decodeProposal(`السلام عليكم، هذه عائلتي:\n\`\`\`\n${await encodeProposal(p)}\n\`\`\``);
  assert.deepEqual(decoded, p);

  const pv = record(applyProposal(raw, decoded, { mode: 'preview', now: NOW }));
  assertOk(pv, 'preview');
  assert.equal(validateData(pv.data, { allowTempIds: true }).ok, true);
  const pg = buildGraph(pv.data);
  assert.deepEqual(pg.childrenOfUnion('newu2').map((c) => c.id), ['new5', 'new4', 'new3']);
  assert.deepEqual(pg.parents('new1').map((x) => x.id).sort(), ['new6', 'new8']);
  assert.deepEqual(pg.siblings('new1').full.map((x) => x.id), ['new9']);
  assert.equal(pv.data.people[me.id].birth.date, '1988');
  assert.equal(pv.data.people.new5.birth.date, '2020', 'Hijri year 1442 → 2020 under year privacy');
  assert.deepEqual(pv.touched.people.sort(), [me.id, 'new1', 'new3', 'new4', 'new5', 'new6', 'new8', 'new9'].sort());
  assert.equal(pv.warnings.filter((w) => w.op !== undefined && w.code !== 'GENDER_MISSING').length, 0, JSON.stringify(pv.warnings));

  const fv = record(applyProposal(raw, decoded, { mode: 'final', now: NOW, issue: 42, actor: 'owner' }));
  assertOk(fv, 'final');
  assert.equal(validateData(fv.data).ok, true);
  assert.equal(fv.data.meta.revision, (raw.meta.revision || 0) + 1);
  assert.equal(Object.keys(fv.data.people).length, Object.keys(raw.people).length + 7);
  assert.equal(Object.keys(fv.data.unions).length, Object.keys(raw.unions).length + 2);
  for (const id of Object.values(fv.idMap)) assert.ok(isPersonId(id) || isUnionId(id), id);
  assert.deepEqual(fv.data.people[me.id].history.at(-1), { issue: 42, rev: fv.data.meta.revision, at: NOW, action: 'mark' });
  assert.deepEqual(fv.data.people[me.id].history.slice(-2).map((h) => h.action), ['edit-person', 'mark']);
  const stored = JSON.parse(serializeData(fv.data));
  assert.equal(validateData(stored).ok, true, 'the serialized file validates');
  assert.equal(fv.data.people[fv.idMap.new8].nameStatus, 'withheld');
  assert.equal(fv.data.people[fv.idMap.new8].name.ar, '');
  // the stored input is never touched
  assert.deepEqual(raw, JSON.parse(readFileSync(DATA_FILE, 'utf8')));
});

test('performance: 150 ops on 5,000 people', () => {
  const data = { schema: 1, meta: { rootPersonId: 'p00000', revision: 1 }, people: {}, unions: {} };
  // 50 generations of a wide family: each union has 4 children; ~5,000 people
  let id = 0;
  const pid = () => `p${String(id++).padStart(5, '0')}`;
  const root = pid();
  data.people[root] = { id: root, name: { ar: 'جد' }, gender: 'm' };
  let frontier = [root];
  let u = 0;
  while (id < 5000) {
    const next = [];
    for (const parent of frontier) {
      if (id >= 5000) break;
      const wife = pid();
      data.people[wife] = { id: wife, name: { ar: 'زوجة' }, gender: 'f' };
      const kids = [];
      for (let k = 0; k < 4 && id < 5000; k++) {
        const c = pid();
        data.people[c] = { id: c, name: { ar: ['محمد', 'أحمد', 'فاطمة', 'عائشة'][k] }, gender: k < 2 ? 'm' : 'f' };
        kids.push(c);
      }
      const uid = `u${String(u++).padStart(5, '0')}`;
      data.unions[uid] = { id: uid, partners: [parent, wife], children: kids, status: 'married' };
      next.push(...kids.filter((c) => data.people[c].gender === 'm'));
    }
    frontier = next;
  }
  const leaves = Object.keys(data.people).slice(-200);
  const ops = [];
  for (let k = 0; k < 75; k++) {
    ops.push(person({ name: { ar: 'سعيد' } }, { ref: `new${k}`, link: { as: 'child', of: leaves[k] } }));
    ops.push({ op: 'edit-person', id: leaves[100 + k], set: { 'occupation.ar': 'معلم' } });
  }
  const t0 = performance.now();
  const r = applyProposal(data, proposal(ops), { mode: 'final', now: NOW });
  const ms = performance.now() - t0;
  assertOk(r);
  assert.ok(ms < 3000, `took ${Math.round(ms)} ms`);
});

test('coverage: every ops issue code is produced by some test', () => {
  const missing = OPS_ISSUE_CODES.filter((c) => !SEEN.has(c));
  assert.deepEqual(missing, []);
});
