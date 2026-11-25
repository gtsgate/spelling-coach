// Independent black-box acceptance tests for js/core/ops.js.
//
// Derived ONLY from docs/SPEC.md §2–§4 and the calling contract visible in js/store.js; written without reading
// ops.js, so they pin the specification, not one implementation. Every test name cites the section it checks.
//
// Conventions taken from the spec / store.js:
//   * an op is {op: "<type>", …fields of §3.3}; an Issue is {code, params, op?, path?};
//   * Issue.op is the 0-based index of the op in proposal.ops (store.removeOp drops ops by exactly that index);
//   * applyProposal is synchronous (store.recompute reads its result directly);
//   * touched/created may be arrays or Sets (store.js only iterates them), so tests spread them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as OPS from '../js/core/ops.js';
import { normalizeData, validateData, serializeData } from '../js/core/schema.js';
import { hijriToGregorian } from '../js/core/dates.js';
import { buildGraph } from '../js/core/graph.js';

const NOW = '2026-11-25T12:00:00.000Z';
const FINAL_PID = /^p[a-z0-9]{7}$/;
const FINAL_UID = /^u[a-z0-9]{7}$/;

// =========================================================================================================
// Fixture

const REMOVED = (extra = {}) => ({ at: '2026-01-01T00:00:00Z', reasonCode: 'entered-by-mistake', issue: 3, by: 'owner', ...extra });

function P(id, ar, gender, birth, extra = {}) {
  return { id, name: { ar }, gender, ...(birth ? { birth: { date: birth } } : {}), ...extra };
}

/**
 * The test family, in compact stored form:
 *
 *   سالم عالم (pgrandpa, root, d. 1990) ═ آمنة (pgrandma, d. 2005)              [ugrand]
 *     ├─ حسن (pdad) ═ مريم الحربي (pmom)                                         [uparents]
 *     │    ├─ محمد (pson, 1980) ═ سارة القحطاني (pdil)   — childless             [uson]
 *     │    └─ زينب (pdaughter, 1983)
 *     │  حسن (pdad) ═ خديجة (pwife2)        — the father is polygamous            [usecond]
 *     │    └─ علي (phalf)
 *     └─ فاطمة (paunt), husband not recorded                                     [usingle]
 *          ├─ نور (pcousin)
 *          └─ ليلى (pcousin2)
 *   هند (pwidow) → عمر (pkid)                                                    [uwidow]
 *   سلمى (porph1), رقية (porph2): sisters, parents unknown                       [uorphans, 0 partners]
 *   يوسف (plone): no relatives recorded
 *   كمال (pgone): removed by mistake · حسن (pold): merged into pdad
 */
function base() {
  const people = {};
  const put = (p) => { people[p.id] = p; };
  put(P('pgrandpa', 'سالم', 'm', '1920', { surname: { ar: 'عالم' }, deceased: true, death: { date: '1990' } }));
  put(P('pgrandma', 'آمنة', 'f', '1925', { deceased: true, death: { date: '2005' } }));
  put(P('pdad', 'حسن', 'm', '1950', { privacy: 'year' }));
  put(P('paunt', 'فاطمة', 'f', '1955', { privacy: 'year' }));
  put(P('pmom', 'مريم', 'f', '1955', { surname: { ar: 'الحربي' }, privacy: 'year' }));
  put(P('pwife2', 'خديجة', 'f', '1960', { privacy: 'year' }));
  put(P('pson', 'محمد', 'm', '1980', { privacy: 'year' }));
  put(P('pdaughter', 'زينب', 'f', '1983', { privacy: 'year' }));
  put(P('phalf', 'علي', 'm', '1990', { privacy: 'year' }));
  put(P('pdil', 'سارة', 'f', '1985', { surname: { ar: 'القحطاني' }, privacy: 'year' }));
  put(P('pcousin', 'نور', 'f', '1980', { privacy: 'year' }));
  put(P('pcousin2', 'ليلى', 'f', '1982', { privacy: 'year' }));
  put(P('pwidow', 'هند', 'f', '1950', { privacy: 'year' }));
  put(P('pkid', 'عمر', 'm', '1975', { privacy: 'year' }));
  put(P('plone', 'يوسف', 'm', '1970', { privacy: 'year' }));
  put(P('porph1', 'سلمى', 'f', '1940', { deceased: true }));
  put(P('porph2', 'رقية', 'f', '1942', { deceased: true }));
  put(P('pgone', 'كمال', 'm', '', { removed: REMOVED() }));
  put(P('pold', 'حسن', 'm', '1950', { privacy: 'year', removed: REMOVED({ reasonCode: 'duplicate', issue: 4, mergedInto: 'pdad' }) }));
  const unions = {
    ugrand: { id: 'ugrand', partners: ['pgrandpa', 'pgrandma'], children: ['pdad', 'paunt'], status: 'married' },
    uparents: { id: 'uparents', partners: ['pdad', 'pmom'], children: ['pson', 'pdaughter'], status: 'married' },
    usecond: { id: 'usecond', partners: ['pdad', 'pwife2'], children: ['phalf'], status: 'married' },
    uson: { id: 'uson', partners: ['pson', 'pdil'], status: 'married' },
    usingle: { id: 'usingle', partners: ['paunt'], children: ['pcousin', 'pcousin2'] },
    uwidow: { id: 'uwidow', partners: ['pwidow'], children: ['pkid'] },
    uorphans: { id: 'uorphans', partners: [], children: ['porph1', 'porph2'] },
  };
  return {
    schema: 1,
    meta: { title: { ar: 'عائلة الاختبار', en: 'Test family' }, rootPersonId: 'pgrandpa', revision: 7, updatedAt: '2026-01-01T00:00:00Z' },
    people,
    unions,
  };
}

/** Normalized fixture, optionally modified first; throws when the fixture itself is invalid (a test bug). */
function fixture(...mutators) {
  const raw = base();
  for (const m of mutators) m(raw);
  const data = normalizeData(raw);
  const v = validateData(data);
  if (!v.ok) throw new Error(`fixture invalid: ${JSON.stringify(v.errors)}`);
  return data;
}

// --- fixture variants ---------------------------------------------------------------------------------------

/** حسن (pdad2) duplicates pdad; married to pmom again in udup (marriage 1978) with daughter سعاد (pextra). */
const withDadDuplicate = (raw) => {
  raw.people.pdad2 = P('pdad2', 'حسن', 'm', '1950', { privacy: 'year' });
  raw.people.pextra = P('pextra', 'سعاد', 'f', '1988', { privacy: 'year' });
  raw.unions.udup = { id: 'udup', partners: ['pmom', 'pdad2'], children: ['pextra'], status: 'married', marriage: { date: '1978' } };
};
/** محمد (pson2) duplicates pson but was entered as a child of يوسف (uwrong). */
const withSonDuplicateElsewhere = (raw) => {
  raw.people.pson2 = P('pson2', 'محمد', 'm', '1980', { privacy: 'year' });
  raw.unions.uwrong = { id: 'uwrong', partners: ['plone'], children: ['pson2'] };
};
/** محمد (pson2) duplicates pson inside the same union. */
const withSonDuplicateSameUnion = (raw) => {
  raw.people.pson2 = P('pson2', 'محمد', 'm', '1980', { privacy: 'year' });
  raw.unions.uparents.children.push('pson2');
};
/** نور (pnour, no parents, teacher) duplicates pcousin (doctor, verified, milk tie). */
const withCousinDuplicate = (raw) => {
  raw.people.pnour = P('pnour', 'نور', 'f', '', { privacy: 'year', occupation: { ar: 'معلمة' }, duplicateOf: 'pcousin' });
  Object.assign(raw.people.pcousin, {
    occupation: { ar: 'طبيبة' }, tags: ['verified'], ties: [{ type: 'milk-child-of', person: 'pwidow' }],
  });
  raw.people.pcousin2.duplicateOf = 'pcousin';
};
/** سالم (pgp2) duplicates the root person. */
const withRootDuplicate = (raw) => {
  raw.people.pgp2 = P('pgp2', 'سالم', 'm', '', { surname: { ar: 'عالم' } });
};
/** هند (pwidow2) duplicates pwidow, with her own single-parent union (son زيد). */
const withWidowDuplicate = (raw) => {
  raw.people.pwidow2 = P('pwidow2', 'هند', 'f', '1950', { privacy: 'year' });
  raw.people.pkid2 = P('pkid2', 'زيد', 'm', '1978', { privacy: 'year' });
  raw.unions.uwidow2 = { id: 'uwidow2', partners: ['pwidow2'], children: ['pkid2'] };
};
/** محمد (pson) was nursed by خديجة (pwife2). */
const withMilkTie = (raw) => {
  raw.people.pson.ties = [{ type: 'milk-child-of', person: 'pwife2' }];
};
/** n pairs of duplicates pmNNNa / pmNNNb with no relatives. */
const withPairs = (n) => (raw) => {
  for (let i = 0; i < n; i++) {
    const k = String(i).padStart(3, '0');
    raw.people[`pm${k}a`] = P(`pm${k}a`, 'أحمد', 'm');
    raw.people[`pm${k}b`] = P(`pm${k}b`, 'أحمد', 'm');
  }
};

// =========================================================================================================
// Helpers

function proposal(ops, extra = {}) {
  return {
    kind: 'gft-proposal', v: 1, id: 'k3j9x0a2mq', createdAt: NOW, baseRevision: 7, dependsOn: [],
    submitter: { name: 'أحمد', relation: 'حفيد', personId: '' }, note: '', ops, ...extra,
  };
}
/** Preview apply as store.js does it (allowDestructive: true). */
const preview = (data, ops, opts = {}, extra = {}) =>
  OPS.applyProposal(data, proposal(ops, extra), { mode: 'preview', now: NOW, allowDestructive: true, ...opts });
/** Final apply as the GitHub Action does it for a plain /approve. */
const final = (data, ops, opts = {}, extra = {}) =>
  OPS.applyProposal(data, proposal(ops, extra), { mode: 'final', now: NOW, issue: 42, actor: 'owner', allowDestructive: false, force: false, ...opts });
/** Final apply after /approve-deletion. */
const finalDel = (data, ops, opts = {}, extra = {}) => final(data, ops, { allowDestructive: true, ...opts }, extra);

const add = (ref, person, link, extra = {}) => ({ op: 'add-person', ref, person, ...(link ? { link } : {}), ...extra });
const M = (ar, gender = 'm', extra = {}) => ({ name: { ar }, gender, ...extra });
const edit = (id, set, extra = {}) => ({ op: 'edit-person', id, set, ...extra });
const merge = (keep, remove, extra = {}) => ({ op: 'merge-person', keep, remove, reasonCode: 'duplicate', ...extra });
const move = (id, to, extra = {}) => ({ op: 'move-person', id, to, ...extra });

const codes = (list) => (list || []).map((i) => i.code);
const list = (x) => [...(x || [])];
const show = (r) => JSON.stringify({ errors: r.errors, warnings: codes(r.warnings) }).slice(0, 1500);

function ok(r) {
  assert.equal(r.ok, true, `expected ok, got ${show(r)}`);
  assert.deepEqual(codes(r.errors), [], `ok result must carry no errors: ${show(r)}`);
  return r;
}
function fails(r, code, op) {
  assert.equal(r.ok, false, `expected failure with ${code}, got ok (${show(r)})`);
  const hit = r.errors.find((e) => e.code === code && (op === undefined || e.op === op));
  assert.ok(hit, `expected error ${code}${op === undefined ? '' : ` at op ${op}`}, got ${show(r)}`);
  return hit;
}
function failsAny(r, codeList, op) {
  assert.equal(r.ok, false, `expected failure with one of ${codeList}, got ok (${show(r)})`);
  const hit = r.errors.find((e) => codeList.includes(e.code) && (op === undefined || e.op === op));
  assert.ok(hit, `expected one of ${codeList}${op === undefined ? '' : ` at op ${op}`}, got ${show(r)}`);
  return hit;
}
function warns(r, code, op) {
  const hit = (r.warnings || []).find((w) => w.code === code && (op === undefined || w.op === op));
  assert.ok(hit, `expected warning ${code}${op === undefined ? '' : ` at op ${op}`}, got ${show(r)}`);
  return hit;
}
function noWarn(r, code) {
  assert.ok(!codes(r.warnings).includes(code), `did not expect warning ${code}: ${show(r)}`);
}
/** Issue reported as error or warning. */
function reported(r, code) {
  return [...(r.errors || []), ...(r.warnings || [])].find((i) => i.code === code);
}

const active = (data) => Object.values(data.unions).filter((u) => !u.removed);
const sameSet = (a, b) => [...a].sort().join('|') === [...b].sort().join('|');
const activeWithPartners = (data, ids) => active(data).filter((u) => sameSet(u.partners, ids));
const birthUnions = (data, id) => active(data).filter((u) => u.children.includes(id));
const unionCount = (data) => Object.keys(data.unions).length;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// =========================================================================================================
// §3.5 apply contract

describe('§3.5 applyProposal contract', () => {
  test('§3.5 applyProposal is synchronous and returns the documented result shape', () => {
    const r = preview(fixture(), [add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' })]);
    assert.ok(!(r && typeof r.then === 'function'), 'store.js uses the result synchronously');
    ok(r);
    assert.equal(typeof r.data, 'object');
    assert.ok(Array.isArray(r.errors) && Array.isArray(r.warnings));
    assert.equal(typeof r.idMap, 'object');
    for (const k of ['people', 'unions']) {
      assert.ok(r.touched && typeof r.touched[k][Symbol.iterator] === 'function', `touched.${k} iterable`);
      assert.ok(r.created && typeof r.created[k][Symbol.iterator] === 'function', `created.${k} iterable`);
    }
    assert.equal(typeof r.destructive, 'boolean');
    assert.ok(Array.isArray(r.reparent));
    assert.equal(typeof r.merges, 'number');
  });

  test('§3.5 never mutates the input data or proposal (deep-frozen inputs, preview and final)', () => {
    const d = deepFreeze(fixture(withDadDuplicate));
    const snapshot = structuredClone(d);
    const ops = [
      add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' }, { unionRef: 'newu1' }),
      edit('pson', { 'occupation.ar': 'مهندس' }),
      { op: 'mark', id: 'pdaughter', mark: 'verified' },
      merge('pdad', 'pdad2'),
      { op: 'remove-person', id: 'plone', reasonCode: 'entered-by-mistake' },
      { op: 'reorder-children', union: 'newu1', order: ['new1'] },
      move('pkid', { union: 'usecond' }),
    ];
    const p = deepFreeze(proposal(ops));
    const pSnap = structuredClone(p);
    ok(OPS.applyProposal(d, p, { mode: 'preview', now: NOW, allowDestructive: true }));
    ok(OPS.applyProposal(d, p, { mode: 'final', now: NOW, issue: 42, actor: 'owner', allowDestructive: true }));
    assert.deepEqual(d, snapshot);
    assert.deepEqual(p, pSnap);
  });

  test('§3.5 returns a normalized deep copy: changing the result never reaches the input', () => {
    const d = fixture();
    const snapshot = structuredClone(d);
    const r = ok(preview(d, [edit('pson', { 'occupation.ar': 'مهندس' })]));
    assert.deepEqual(r.data, normalizeData(r.data), 'result data is in full normalized shape');
    r.data.people.pdad.name.ar = 'تغيير';
    r.data.unions.uparents.children.push('plone');
    r.data.meta.revision = 999;
    assert.deepEqual(d, snapshot);
  });

  test('§3.5 atomic: any error → ok:false, data unchanged, every failing op listed with its 0-based index', () => {
    const d = fixture();
    const snapshot = structuredClone(d);
    const r = preview(d, [
      add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' }), //  fine
      edit('pnosuch', { 'occupation.ar': 'تاجر' }), //                      UNKNOWN_ID
      edit('pson', { 'occupation.ar': 'مهندس' }), //                        fine
      { op: 'link-spouse', a: 'plone', b: 'plone' }, //                     SAME_PERSON
    ]);
    fails(r, 'UNKNOWN_ID', 1);
    fails(r, 'SAME_PERSON', 3);
    assert.deepEqual(r.data, snapshot, 'data returned unchanged on failure');
    assert.deepEqual(d, snapshot);
  });

  test('§3.5 post-condition: values breaking §2.3 rule 4 are rejected with the schema codes', () => {
    const d = fixture();
    fails(preview(d, [edit('pson', { 'birth.date': '1990-02-30' })]), 'BAD_DATE');
    fails(preview(d, [edit('pson', { gender: 'x' })]), 'BAD_ENUM');
    fails(preview(d, [edit('pson', { privacy: 'secret' })]), 'BAD_ENUM');
    fails(preview(d, [add('new1', M('م'.repeat(101)))]), 'TOO_LONG');
  });
});

// =========================================================================================================
// §3.5 ids in preview and final mode

describe('§3.5 preview vs final ids', () => {
  test('§3.5 preview: person id = its ref, union id = its unionRef; the draft passes validateData(allowTempIds) only', () => {
    const d = fixture();
    const r = ok(preview(d, [
      add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone' }, { unionRef: 'newu2' }),
      add('new3', M('سعيد'), { as: 'child', of: 'plone', with: 'new1' }),
    ]));
    assert.equal(r.data.people.new1?.id, 'new1');
    assert.equal(r.data.people.new3?.id, 'new3');
    assert.ok(r.data.unions.newu2, 'union created with unionRef newu2 has id newu2');
    assert.ok(sameSet(r.data.unions.newu2.partners, ['plone', 'new1']));
    assert.deepEqual(r.data.unions.newu2.children, ['new3'], 'the union created by op 0 is FOUND by op 1');
    assert.equal(unionCount(r.data), unionCount(d) + 1);
    assert.ok(validateData(r.data, { allowTempIds: true }).ok, JSON.stringify(validateData(r.data, { allowTempIds: true }).errors));
    const strict = validateData(r.data);
    assert.equal(strict.ok, false);
    assert.ok(codes(strict.errors).includes('BAD_ID'));
    assert.ok(list(r.created.people).includes('new1') && list(r.created.people).includes('new3'));
    assert.ok(list(r.created.unions).includes('newu2'));
  });

  test('§3.2/§3.5 preview: a union created without unionRef gets id tmpu<n>', () => {
    const r = ok(preview(fixture(), [add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone' })]));
    const unions = Object.values(r.data.unions).filter((u) => u.partners.includes('new1'));
    assert.equal(unions.length, 1);
    assert.match(unions[0].id, /^tmpu[0-9]+$/);
    assert.ok(validateData(r.data, { allowTempIds: true }).ok);
  });

  test('§3.5 final: people get /^p[a-z0-9]{7}$/, unions /^u[a-z0-9]{7}$/, idMap maps refs; strict validateData passes', () => {
    const d = fixture();
    const r = ok(final(d, [
      add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone' }, { unionRef: 'newu2' }),
      add('new3', M('سعيد'), { as: 'child', of: 'plone', with: 'new1' }),
      add('new4', M('زيد'), { as: 'child', of: 'pkid' }), // creates a union without unionRef
    ]));
    for (const ref of ['new1', 'new3', 'new4']) {
      const id = r.idMap[ref];
      assert.match(id ?? '', FINAL_PID, `idMap.${ref}`);
      assert.equal(r.data.people[id]?.id, id);
    }
    assert.equal(new Set([r.idMap.new1, r.idMap.new3, r.idMap.new4]).size, 3);
    for (const key of [...Object.keys(r.data.people), ...Object.keys(r.data.unions)]) {
      assert.ok(!/^(new|tmpu)/.test(key), `temp id ${key} leaked into final data`);
    }
    for (const id of Object.keys(r.data.unions)) if (!d.unions[id]) assert.match(id, FINAL_UID);
    const v = validateData(r.data);
    assert.ok(v.ok, JSON.stringify(v.errors));
    const g = buildGraph(r.data);
    assert.equal(g.mother(r.idMap.new3)?.id, r.idMap.new1);
    assert.equal(g.father(r.idMap.new3)?.id, 'plone');
    assert.equal(g.father(r.idMap.new4)?.id, 'pkid');
  });

  test('§3.5 final: idMap also maps a CREATED union ref (newuN) to its real union id', () => {
    const r = ok(final(fixture(), [
      add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone' }, { unionRef: 'newu2' }),
      { op: 'edit-union', union: 'newu2', set: { 'marriage.date': '1999' } },
    ]));
    const uid = r.idMap.newu2;
    assert.match(uid ?? '', FINAL_UID);
    assert.ok(sameSet(r.data.unions[uid].partners, ['plone', r.idMap.new1]));
    assert.equal(r.data.unions[uid].marriage.date, '1999');
  });

  test('§3.2 a unionRef bound to a FOUND union maps to that existing union in idMap (final and preview — store.overlay relies on it)', () => {
    const ops = [add('new1', M('سعيد'), { as: 'child', of: 'pmom', with: 'pdad' }, { unionRef: 'newu5' })];
    const rf = ok(final(fixture(), ops));
    assert.equal(rf.idMap.newu5, 'uparents');
    const rp = ok(preview(fixture(), ops));
    assert.equal(rp.idMap.newu5, 'uparents');
    assert.equal(rp.data.unions.newu5, undefined, 'no union is created under the ref when one was found');
  });

  test('§3.5 final ids come from opts.idGen(prefix) when given', () => {
    const generated = new Set();
    let n = 0;
    const idGen = (prefix) => {
      const id = `${prefix}t${String(++n).padStart(6, '0')}`;
      generated.add(id);
      return id;
    };
    const r = ok(final(fixture(), [add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone' }, { unionRef: 'newu2' })], { idGen }));
    assert.ok(generated.has(r.idMap.new1), `person id ${r.idMap.new1} from idGen`);
    assert.ok(generated.has(r.idMap.newu2), `union id ${r.idMap.newu2} from idGen`);
  });

  test('§3.5 final ids never collide with existing ids, even when the generator offers one', () => {
    const queue = { p: ['pdad', 'pabcdefg'], u: ['uparents', 'uabcdefg'] };
    const idGen = (prefix) => queue[prefix]?.shift() ?? `${prefix}zzzzzz${Math.floor(Math.random() * 9)}`;
    const d = fixture();
    const r = ok(final(d, [add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone' }, { unionRef: 'newu2' })], { idGen }));
    assert.notEqual(r.idMap.new1, 'pdad');
    assert.notEqual(r.idMap.newu2, 'uparents');
    assert.deepEqual(r.data.people.pdad, d.people.pdad, 'existing person not overwritten');
    assert.ok(sameSet(r.data.unions.uparents.partners, ['pdad', 'pmom']), 'existing union not overwritten');
    assert.equal(r.data.people[r.idMap.new1].name.ar, 'ريم');
  });

  test('§3.5 final: 150 new people all get distinct, well-formed ids', () => {
    const names = ['أحمد', 'خالد', 'سعيد', 'زيد', 'عمر', 'بلال', 'طارق', 'ماجد', 'وليد', 'هشام'];
    const ops = Array.from({ length: 150 }, (_, i) => add(`new${i + 1}`, M(names[i % names.length])));
    const r = ok(final(fixture(), ops));
    const ids = ops.map((o) => r.idMap[o.ref]);
    assert.equal(new Set(ids).size, 150);
    for (const id of ids) assert.match(id, FINAL_PID);
  });
});

// =========================================================================================================
// §3.5 revision & history

describe('§3.5 revision, updatedAt and history', () => {
  test('§3.5 final: meta.revision += 1, updatedAt = now, history {issue, rev, at, action} on touched people', () => {
    const d = fixture();
    const r = ok(final(d, [
      add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' }),
      edit('pson', { 'occupation.ar': 'مهندس' }),
    ]));
    assert.equal(r.data.meta.revision, 8);
    assert.equal(r.data.meta.updatedAt, NOW);
    const h = r.data.people[r.idMap.new1].history.at(-1);
    assert.deepEqual({ issue: h.issue, rev: h.rev, at: h.at, action: h.action }, { issue: 42, rev: 8, at: NOW, action: 'add-person' });
    const hs = r.data.people.pson.history.at(-1);
    assert.deepEqual({ issue: hs.issue, rev: hs.rev, at: hs.at, action: hs.action }, { issue: 42, rev: 8, at: NOW, action: 'edit-person' });
    assert.deepEqual(r.data.people.pgrandma.history, [], 'untouched people get no history');
    assert.ok(list(r.touched.people).includes('pson'));
  });

  test('§3.5 preview: no revision bump, no updatedAt change, no history entries', () => {
    const d = fixture();
    const r = ok(preview(d, [edit('pson', { 'occupation.ar': 'مهندس' })]));
    assert.equal(r.data.people.pson.occupation.ar, 'مهندس');
    assert.equal(r.data.meta.revision, 7);
    assert.equal(r.data.meta.updatedAt, '2026-01-01T00:00:00Z');
    assert.deepEqual(r.data.people.pson.history, []);
  });

  test('§2.1/§3.5 history keeps the newest 20 entries', () => {
    const d = fixture((raw) => {
      raw.people.pson.history = Array.from({ length: 20 }, (_, i) => ({ issue: i + 1, rev: i + 1, at: '2026-01-01T00:00:00Z', action: 'edit-person' }));
    });
    const r = ok(final(d, [edit('pson', { 'occupation.ar': 'مهندس' })]));
    const h = r.data.people.pson.history;
    assert.equal(h.length, 20);
    assert.equal(h.at(-1).issue, 42);
    assert.equal(h[0].issue, 2, 'the oldest entry is dropped');
  });

  test('§2.4/§3.5 final removal record = {at: now, reasonCode, issue: opts.issue, by: opts.actor}', () => {
    const r = ok(finalDel(fixture(), [{ op: 'remove-person', id: 'plone', reasonCode: 'entered-by-mistake' }]));
    const rec = r.data.people.plone.removed;
    assert.ok(rec);
    assert.equal(rec.at, NOW);
    assert.equal(rec.reasonCode, 'entered-by-mistake');
    assert.equal(rec.issue, 42);
    assert.equal(rec.by, 'owner');
  });
});

// =========================================================================================================
// §3.2 references & resolution

describe('§3.2 references and resolution', () => {
  test('§3.2 re-declaring a ref → DUPLICATE_REF', () => {
    fails(preview(fixture(), [add('new1', M('سعيد')), add('new1', M('خالد'))]), 'DUPLICATE_REF', 1);
  });

  test('§3.2 undeclared temp ref → UNKNOWN_REF (also when used before its declaration)', () => {
    const d = fixture();
    fails(preview(d, [edit('new7', { 'occupation.ar': 'تاجر' })]), 'UNKNOWN_REF', 0);
    fails(preview(d, [edit('new1', { 'occupation.ar': 'تاجر' }), add('new1', M('سعيد'))]), 'UNKNOWN_REF', 0);
    fails(preview(d, [{ op: 'reorder-children', union: 'newu9', order: ['pson'] }]), 'UNKNOWN_REF', 0);
  });

  test('§3.2 a real-looking id that does not exist → UNKNOWN_ID (people and unions)', () => {
    const d = fixture();
    fails(preview(d, [edit('pnosuch', { 'occupation.ar': 'تاجر' })]), 'UNKNOWN_ID', 0);
    fails(preview(d, [{ op: 'reorder-children', union: 'unosuch', order: ['pson'] }]), 'UNKNOWN_ID', 0);
    fails(preview(d, [add('new1', M('سعيد'), { as: 'child', of: 'pnosuch' })]), 'UNKNOWN_ID', 0);
  });

  test('§3.2 a merged target is followed with warning MERGED_REDIRECT {from, to}', () => {
    const r = ok(preview(fixture(), [edit('pold', { 'occupation.ar': 'تاجر' })]));
    assert.equal(r.data.people.pdad.occupation.ar, 'تاجر');
    assert.equal(r.data.people.pold.occupation.ar, '');
    const w = warns(r, 'MERGED_REDIRECT', 0);
    assert.equal(w.params.from, 'pold');
    assert.equal(w.params.to, 'pdad');
  });

  test('§3.2 redirects are transitive and apply to link fields too', () => {
    const d = fixture((raw) => {
      raw.people.pold2 = P('pold2', 'حسن', 'm', '1950', { privacy: 'year', removed: REMOVED({ reasonCode: 'duplicate', mergedInto: 'pold' }) });
    });
    const r = ok(preview(d, [
      edit('pold2', { 'occupation.ar': 'تاجر' }),
      add('new1', M('سعيد'), { as: 'child', of: 'pold', with: 'pmom' }),
    ]));
    assert.equal(r.data.people.pdad.occupation.ar, 'تاجر');
    assert.equal(warns(r, 'MERGED_REDIRECT', 0).params.to, 'pdad');
    warns(r, 'MERGED_REDIRECT', 1);
    assert.ok(r.data.unions.uparents.children.includes('new1'), 'child linked to pdad+pmom → existing uparents');
  });

  test('§3.2 redirect chains longer than 10 hops are refused', () => {
    const d = fixture((raw) => {
      for (let i = 1; i <= 12; i++) {
        const id = `pchain${String(i).padStart(2, '0')}`;
        const next = i === 12 ? 'pdad' : `pchain${String(i + 1).padStart(2, '0')}`;
        raw.people[id] = P(id, 'حسن', 'm', '', { removed: REMOVED({ reasonCode: 'duplicate', mergedInto: next }) });
      }
    });
    const r = preview(d, [edit('pchain01', { 'occupation.ar': 'تاجر' })]);
    assert.equal(r.ok, false, '12 hops > 10');
  });

  test('§3.2 a removed target without mergedInto → TARGET_REMOVED', () => {
    const d = fixture();
    fails(preview(d, [edit('pgone', { 'occupation.ar': 'تاجر' })]), 'TARGET_REMOVED', 0);
    fails(preview(d, [{ op: 'link-spouse', a: 'plone', b: 'pgone' }]), 'TARGET_REMOVED', 0);
    fails(preview(d, [add('new1', M('سعيد'), { as: 'child', of: 'pgone' })]), 'TARGET_REMOVED', 0);
    fails(preview(d, [{ op: 'add-tie', id: 'pson', type: 'milk-child-of', person: 'pgone' }]), 'TARGET_REMOVED', 0);
  });

  test('§3.2 final: refs of a dependsOn proposal resolve through opts.refMap', () => {
    const a = final(fixture(), [add('new5', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' })], {}, { id: 'aaaaaaaaaa' });
    ok(a);
    const b = final(a.data, [
      add('new6', M('زيد'), { as: 'child', of: 'new5' }),
      edit('new5', { 'occupation.ar': 'طبيب' }),
    ], { refMap: { ...a.idMap } }, { id: 'bbbbbbbbbb', dependsOn: ['aaaaaaaaaa'] });
    ok(b);
    const realNew5 = a.idMap.new5;
    assert.equal(b.data.people[realNew5].occupation.ar, 'طبيب');
    assert.equal(buildGraph(b.data).father(b.idMap.new6)?.id, realNew5);
    assert.ok(validateData(b.data).ok);
  });

  test('§3.2 final: a ref from a dependency that is not applied yet → DEPENDS_ON_PENDING {proposalId}', () => {
    const r = final(fixture(), [add('new9', M('زيد'), { as: 'child', of: 'new5' })], { refMap: {} }, { dependsOn: ['a1b2c3d4e5'] });
    const e = fails(r, 'DEPENDS_ON_PENDING');
    assert.equal(e.params.proposalId, 'a1b2c3d4e5');
    // …and once the dependency is applied (refMap known) the same proposal applies.
    const r2 = final(fixture(), [add('new9', M('زيد'), { as: 'child', of: 'new5' })], { refMap: { new5: 'pson' } }, { dependsOn: ['a1b2c3d4e5'] });
    ok(r2);
    assert.equal(buildGraph(r2.data).father(r2.idMap.new9)?.id, 'pson');
  });

  test('§3.2/§7.3 preview overlay exactly as store.js builds it: dependent proposal resolves person refs and found/created union refs', () => {
    const a = proposal([
      add('new5', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' }, { unionRef: 'newu6' }), // union FOUND (uparents)
      add('new7', M('ريم', 'f'), { as: 'spouse', of: 'plone' }, { unionRef: 'newu8' }), //         union CREATED
    ], { id: 'aaaaaaaaaa' });
    const ra = ok(OPS.applyProposal(fixture(), a, { mode: 'preview', now: NOW, allowDestructive: true, refMap: {} }));
    // store.overlay: refMap = idMap, then identity for every declared ref not already mapped.
    const refMap = { ...ra.idMap };
    for (const op of a.ops) for (const decl of OPS.opRefs(op).declares) if (!(decl in refMap)) refMap[decl] = decl;
    const b = proposal([
      { op: 'reorder-children', union: 'newu6', order: ['new5'] },
      { op: 'edit-union', union: 'newu8', set: { 'marriage.date': '2001' } },
      edit('new5', { 'occupation.ar': 'طبيب' }),
    ], { id: 'bbbbbbbbbb', dependsOn: ['aaaaaaaaaa'] });
    const rb = ok(OPS.applyProposal(ra.data, b, { mode: 'preview', now: NOW, allowDestructive: true, refMap }));
    assert.equal(rb.data.unions.uparents.children[0], 'new5');
    const created = Object.values(rb.data.unions).find((u) => sameSet(u.partners, ['plone', 'new7']));
    assert.equal(created?.marriage.date, '2001');
    assert.equal(rb.data.people.new5.occupation.ar, 'طبيب');
  });

  test('§3.5 applyProposals applies several proposals in sequence (dependent refs included)', () => {
    const a = proposal([add('new5', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' })], { id: 'aaaaaaaaaa' });
    const b = proposal([edit('new5', { 'occupation.ar': 'طبيب' }), edit('pson', { 'occupation.ar': 'مهندس' })], { id: 'bbbbbbbbbb', dependsOn: ['aaaaaaaaaa'] });
    const out = OPS.applyProposals(fixture(), [a, b], { mode: 'preview', now: NOW, allowDestructive: true });
    const last = Array.isArray(out) ? out.at(-1) : out;
    assert.ok(last && last.data, 'returns the resulting data');
    if ('ok' in last) assert.equal(last.ok, true, show(last));
    const people = Object.values(last.data.people);
    assert.ok(people.some((p) => p.name.ar === 'سعيد' && p.occupation.ar === 'طبيب'));
    assert.equal(last.data.people.pson.occupation.ar, 'مهندس');
  });
});

// =========================================================================================================
// §3.4 links of add-person

describe('§3.4 add-person links', () => {
  test('§3.4 child of {P,Q}: the active union with exactly that partner set is found (any order); none is created', () => {
    const d = fixture();
    for (const [of, w] of [['pdad', 'pmom'], ['pmom', 'pdad']]) {
      const r = ok(preview(d, [add('new1', M('سعيد'), { as: 'child', of, with: w })]));
      assert.ok(r.data.unions.uparents.children.includes('new1'));
      assert.equal(unionCount(r.data), unionCount(d));
    }
  });

  test('§3.4 child of {P} (with null) finds P\'s single-parent union', () => {
    const r = ok(preview(fixture(), [add('new1', M('سعيد'), { as: 'child', of: 'paunt', with: null })]));
    assert.ok(r.data.unions.usingle.children.includes('new1'));
  });

  test('§3.4 child of a polygamous father with null → a NEW single-parent union {father}, status unknown — never one of his marriages', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: null })]));
    assert.deepEqual(r.data.unions.uparents.children, d.unions.uparents.children);
    assert.deepEqual(r.data.unions.usecond.children, d.unions.usecond.children);
    const u = birthUnions(r.data, 'new1');
    assert.equal(u.length, 1);
    assert.deepEqual(u[0].partners, ['pdad']);
    assert.equal(u[0].status, 'unknown');
  });

  test('§3.4 child of {P,Q} with no such union → creates {partners:[P,Q], status:"married"}', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('سعيد'), { as: 'child', of: 'plone', with: 'pcousin2' })]));
    const u = birthUnions(r.data, 'new1');
    assert.equal(u.length, 1);
    assert.ok(sameSet(u[0].partners, ['plone', 'pcousin2']));
    assert.equal(u[0].status, 'married');
    assert.equal(unionCount(r.data), unionCount(d) + 1);
  });

  test('§3.2/§3.4 unionRef on a FOUND union binds the ref to that union (later ops act on it)', () => {
    const r = ok(preview(fixture(), [
      add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' }, { unionRef: 'newu5' }),
      { op: 'reorder-children', union: 'newu5', order: ['new1'] },
      { op: 'edit-union', union: 'newu5', set: { 'marriage.date': '1978' } },
    ]));
    assert.deepEqual(r.data.unions.uparents.children, ['new1', 'pson', 'pdaughter']);
    assert.equal(r.data.unions.uparents.marriage.date, '1978');
    assert.equal(r.data.unions.newu5, undefined);
  });

  test('§3.2/§3.4 unionRef on a CREATED union names the new union (later ops act on it)', () => {
    const r = ok(preview(fixture(), [
      add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone' }, { unionRef: 'newu5' }),
      { op: 'edit-union', union: 'newu5', set: { 'marriage.date': '1999' } },
      add('new2', M('زيد'), { as: 'child', union: 'newu5' }),
    ]));
    const u = r.data.unions.newu5;
    assert.ok(u);
    assert.ok(sameSet(u.partners, ['plone', 'new1']));
    assert.equal(u.marriage.date, '1999');
    assert.deepEqual(u.children, ['new2']);
  });

  test('§3.4 insert position: before the first sibling with a later known birth date', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('سعيد', 'm', { birth: { date: '1982' } }), { as: 'child', of: 'pdad', with: 'pmom' })]));
    assert.deepEqual(r.data.unions.uparents.children, ['pson', 'new1', 'pdaughter']);
    const r2 = ok(preview(d, [add('new1', M('سعيد', 'm', { birth: { date: '1979' } }), { as: 'child', of: 'pdad', with: 'pmom' })]));
    assert.deepEqual(r2.data.unions.uparents.children, ['new1', 'pson', 'pdaughter']);
  });

  test('§3.4 insert position: explicit index wins; no known date → append', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('سعيد', 'm', { birth: { date: '1995' } }), { as: 'child', of: 'pdad', with: 'pmom' }, { index: 0 })]));
    assert.deepEqual(r.data.unions.uparents.children, ['new1', 'pson', 'pdaughter']);
    const r2 = ok(preview(d, [add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' })]));
    assert.deepEqual(r2.data.unions.uparents.children, ['pson', 'pdaughter', 'new1']);
  });

  test('§3.4 child {union: U} inserts into U', () => {
    const r = ok(preview(fixture(), [add('new1', M('سعيد'), { as: 'child', union: 'usecond' })]));
    assert.deepEqual(r.data.unions.usecond.children, ['phalf', 'new1']);
  });

  test('§3.4 spouse link creates [P,new]; status defaults to married, "divorced" kept; marriage stored', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone', marriage: { date: '1995' } })]));
    const u = activeWithPartners(r.data, ['plone', 'new1']);
    assert.equal(u.length, 1);
    assert.equal(u[0].status, 'married');
    assert.equal(u[0].marriage.date, '1995');
    const r2 = ok(preview(d, [add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone', status: 'divorced' })]));
    assert.equal(activeWithPartners(r2.data, ['plone', 'new1'])[0].status, 'divorced');
  });

  test('§3.4 parent scope "union" (default): B with one partner gains the new partner — every child of B gains the parent', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('خالد'), { as: 'parent', of: 'pcousin' })]));
    assert.ok(sameSet(r.data.unions.usingle.partners, ['paunt', 'new1']));
    assert.equal(unionCount(r.data), unionCount(d), 'no union created');
    const g = buildGraph(r.data);
    assert.equal(g.father('pcousin')?.id, 'new1');
    assert.equal(g.father('pcousin2')?.id, 'new1');
  });

  test('§3.4 parent scope "union": B already has 2 partners → PARENTS_FULL', () => {
    fails(preview(fixture(), [add('new1', M('خالد'), { as: 'parent', of: 'pson', scope: 'union' })]), 'PARENTS_FULL', 0);
  });

  test('§3.4 parent scope "union": same non-empty gender as B\'s single partner → PARENT_GENDER_CONFLICT', () => {
    fails(preview(fixture(), [add('new1', M('عائشة', 'f'), { as: 'parent', of: 'pcousin' })]), 'PARENT_GENDER_CONFLICT', 0);
  });

  test('§3.4 parent of someone without a birth union → creates {partners:[new], children:[P]}', () => {
    const r = ok(preview(fixture(), [add('new1', M('عبد الرحمن'), { as: 'parent', of: 'pmom' })]));
    const u = birthUnions(r.data, 'pmom');
    assert.equal(u.length, 1);
    assert.deepEqual(u[0].partners, ['new1']);
    assert.deepEqual(u[0].children, ['pmom']);
  });

  test('§3.4 parent scope "only": P alone moves into {B\'s single partner, new}; siblings stay', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('خالد'), { as: 'parent', of: 'pcousin', scope: 'only' })]));
    const u = birthUnions(r.data, 'pcousin');
    assert.equal(u.length, 1);
    assert.ok(sameSet(u[0].partners, ['paunt', 'new1']));
    assert.deepEqual(r.data.unions.usingle.partners, ['paunt']);
    assert.deepEqual(r.data.unions.usingle.children, ['pcousin2']);
    assert.equal(buildGraph(r.data).father('pcousin2'), null);
  });

  test('§3.4 sibling share "both": appended to P\'s birth union; none → creates {partners:[], children:[P,new]}', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('سعيد'), { as: 'sibling', of: 'pson', share: 'both' })]));
    assert.deepEqual(r.data.unions.uparents.children, ['pson', 'pdaughter', 'new1']);
    const r2 = ok(preview(d, [add('new1', M('سعاد', 'f'), { as: 'sibling', of: 'pmom', share: 'both' })]));
    const u = birthUnions(r2.data, 'pmom');
    assert.equal(u.length, 1);
    assert.deepEqual(u[0].partners, []);
    assert.deepEqual(u[0].children, ['pmom', 'new1']);
  });

  test('§3.4 sibling share "father" on a polygamous father: {child of father, with otherParent ?? null} — not added to either marriage', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('سعيد'), { as: 'sibling', of: 'pson', share: 'father' })]));
    assert.deepEqual(r.data.unions.uparents.children, ['pson', 'pdaughter']);
    assert.deepEqual(r.data.unions.usecond.children, ['phalf']);
    const u = birthUnions(r.data, 'new1');
    assert.equal(u.length, 1);
    assert.deepEqual(u[0].partners, ['pdad']);
    // With the other parent named, the existing marriage is found.
    const r2 = ok(preview(d, [add('new1', M('سعيد'), { as: 'sibling', of: 'pson', share: 'father', otherParent: 'pwife2' })]));
    assert.deepEqual(r2.data.unions.usecond.children, ['phalf', 'new1']);
    assert.equal(unionCount(r2.data), unionCount(d));
  });

  test('§3.4 sibling share "mother" resolves through the mother', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', M('سعيد'), { as: 'sibling', of: 'phalf', share: 'mother' })]));
    const u = birthUnions(r.data, 'new1');
    assert.equal(u.length, 1);
    assert.deepEqual(u[0].partners, ['pwife2']);
    const r2 = ok(preview(d, [add('new1', M('سعيد'), { as: 'sibling', of: 'phalf', share: 'mother', otherParent: 'pdad' })]));
    assert.deepEqual(r2.data.unions.usecond.children, ['phalf', 'new1']);
  });

  test('§3.4 sibling via an unknown parent → FATHER_UNKNOWN / MOTHER_UNKNOWN', () => {
    const d = fixture();
    fails(preview(d, [add('new1', M('سعيد'), { as: 'sibling', of: 'pcousin', share: 'father' })]), 'FATHER_UNKNOWN', 0);
    fails(preview(d, [add('new1', M('سعيد'), { as: 'sibling', of: 'pkid', share: 'father' })]), 'FATHER_UNKNOWN', 0);
    fails(preview(d, [add('new1', M('سعيد'), { as: 'sibling', of: 'pmom', share: 'mother' })]), 'MOTHER_UNKNOWN', 0);
  });
});

// =========================================================================================================
// §2.1 / §3.3 add-person: the person itself

describe('§2.1/§3.3 add-person input', () => {
  test('§2.1 privacy "year" arriving through add-person truncates a full birth date in storage', () => {
    const r = ok(final(fixture(), [add('new1', {
      name: { ar: 'ريم' }, gender: 'f', privacy: 'year', birth: { date: '1995-04-12', place: { ar: 'جدة' } },
    }, { as: 'child', of: 'pson', with: 'pdil' })]));
    const p = r.data.people[r.idMap.new1];
    assert.equal(p.privacy, 'year');
    assert.equal(p.birth.date, '1995');
    assert.equal(p.birth.place.ar, 'جدة');
    assert.ok(!serializeData(r.data).includes('1995-04'), 'the private detail never reaches the stored file');
  });

  test('§2.1 privacy "hidden" clears the birth date (Gregorian and Hijri)', () => {
    const r = ok(preview(fixture(), [add('new1', {
      name: { ar: 'ريم' }, gender: 'f', privacy: 'hidden', birth: { date: '1995-04-12', hijri: '' },
    })]));
    assert.equal(r.data.people.new1.birth.date, '');
    assert.equal(r.data.people.new1.birth.hijri, '');
  });

  test('§2.1 Hijri birth via add-person: full → exact Gregorian; year only → day 1 of that year, approx', () => {
    const d = fixture();
    const r = ok(preview(d, [add('new1', { name: { ar: 'عبد الله' }, gender: 'm', deceased: true, birth: { hijri: '1370-06-15' } })]));
    assert.equal(r.data.people.new1.birth.hijri, '1370-06-15');
    assert.equal(r.data.people.new1.birth.date, hijriToGregorian('1370-06-15').date);
    const r2 = ok(preview(d, [add('new1', { name: { ar: 'عبد الله' }, gender: 'm', deceased: true, birth: { hijri: '1370' } })]));
    assert.equal(r2.data.people.new1.birth.date, hijriToGregorian('1370').date);
    assert.equal(r2.data.people.new1.birth.approx, true);
  });

  test('§2.1 nameStatus withheld/unknown with a name → NAME_SHOULD_BE_EMPTY', () => {
    const d = fixture();
    fails(preview(d, [add('new1', { name: { ar: 'سارة' }, nameStatus: 'withheld', gender: 'f' }, { as: 'spouse', of: 'plone' })]), 'NAME_SHOULD_BE_EMPTY', 0);
    fails(preview(d, [add('new1', { name: { en: 'Sara' }, nameStatus: 'unknown', gender: 'f' }, { as: 'spouse', of: 'plone' })]), 'NAME_SHOULD_BE_EMPTY', 0);
  });

  test('§2.1 nameStatus known needs a name or nickname (NAME_REQUIRED); kunya-only and withheld+nickname are fine', () => {
    const d = fixture();
    fails(preview(d, [add('new1', { gender: 'm' }, { as: 'child', of: 'pdad', with: 'pmom' })]), 'NAME_REQUIRED', 0);
    ok(preview(d, [add('new1', { nickname: { ar: 'أبو خالد' }, gender: 'm' })]));
    const r = ok(preview(d, [add('new1', { nameStatus: 'withheld', nickname: { ar: 'أم خالد' }, gender: 'f' }, { as: 'spouse', of: 'plone' })]));
    assert.equal(r.data.people.new1.nameStatus, 'withheld');
    assert.deepEqual(r.data.people.new1.name, { ar: '', en: '' });
    ok(preview(d, [add('new1', { nameStatus: 'unknown', gender: 'f' }, { as: 'spouse', of: 'plone' })]));
  });

  test('§3.3 unknown PersonInput keys → UNKNOWN_FIELD, and they never reach the data (no id/removed/history hijack)', () => {
    const d = fixture();
    const r = preview(d, [add('new1', { ...M('سعيد'), favouriteColour: 'أزرق' })]);
    assert.ok(reported(r, 'UNKNOWN_FIELD'), show(r));
    if (r.ok) assert.ok(!('favouriteColour' in r.data.people.new1));
    const r2 = preview(d, [add('new1', { ...M('سعيد'), id: 'pdad', removed: REMOVED(), history: [{ issue: 1, at: NOW, action: 'x' }] }, { as: 'child', of: 'pson', with: 'pdil' })]);
    assert.ok(reported(r2, 'UNKNOWN_FIELD'), show(r2));
    assert.equal(r2.data.people.pdad.name.ar, 'حسن', 'existing person untouched');
    if (r2.ok) {
      assert.equal(r2.data.people.new1.removed, null);
      assert.deepEqual(r2.data.people.new1.history, []);
    }
  });

  test('§3.3 GENDER_MISSING warning when a new person has no gender', () => {
    const d = fixture();
    warns(ok(preview(d, [add('new1', { name: { ar: 'نور' } })])), 'GENDER_MISSING', 0);
    noWarn(ok(preview(d, [add('new1', M('نور', 'f'))])), 'GENDER_MISSING');
  });

  test('§3.3 NAME_LOOKS_FULL for بن/bin or > 2 tokens after joining compounds; compounds alone are fine', () => {
    const d = fixture();
    for (const ar of ['محمد بن حسن', 'محمد حسن سالم']) warns(ok(preview(d, [add('new1', M(ar))])), 'NAME_LOOKS_FULL', 0);
    warns(ok(preview(d, [add('new1', { name: { en: 'Ahmed bin Ali' }, gender: 'm' })])), 'NAME_LOOKS_FULL', 0);
    for (const ar of ['عبد الرحمن', 'نور الدين', 'محمد']) noWarn(ok(preview(d, [add('new1', M(ar))])), 'NAME_LOOKS_FULL');
  });

  test('§3.3 POSSIBLE_DUPLICATE {id}: same normalized name AND same birth union / father / surname+year±2 / spouse surname', () => {
    const d = fixture();
    assert.equal(warns(ok(preview(d, [add('new1', M('محمد'), { as: 'child', of: 'pdad', with: 'pmom' })])), 'POSSIBLE_DUPLICATE', 0).params.id, 'pson');
    assert.equal(warns(ok(preview(d, [add('new1', M('مُحَمَّد'), { as: 'child', of: 'pdad', with: 'pmom' })])), 'POSSIBLE_DUPLICATE', 0).params.id, 'pson');
    assert.equal(warns(ok(preview(d, [add('new1', M('محمد'), { as: 'child', of: 'pdad', with: 'pwife2' })])), 'POSSIBLE_DUPLICATE', 0).params.id, 'pson');
    const sara = { name: { ar: 'سارة' }, surname: { ar: 'القحطاني' }, gender: 'f' };
    assert.equal(warns(ok(preview(d, [add('new1', { ...sara, birth: { date: '1986' } })])), 'POSSIBLE_DUPLICATE', 0).params.id, 'pdil');
    assert.equal(warns(ok(preview(d, [add('new1', sara, { as: 'spouse', of: 'pson' })])), 'POSSIBLE_DUPLICATE', 0).params.id, 'pdil');
    // Same given name without any of the extra conditions is not a suspect.
    noWarn(ok(preview(d, [add('new1', M('محمد'))])), 'POSSIBLE_DUPLICATE');
    noWarn(ok(preview(d, [add('new1', { ...sara, birth: { date: '1995' } })])), 'POSSIBLE_DUPLICATE');
  });

  test('§3.3 MINOR_DETAIL when a person under 18 gets an occupation or a full birth date', () => {
    const d = fixture();
    warns(ok(preview(d, [add('new1', M('ريم', 'f', { birth: { date: '2015' }, privacy: 'year', occupation: { ar: 'طالبة' } }), { as: 'child', of: 'pson', with: 'pdil' })])), 'MINOR_DETAIL', 0);
    warns(ok(preview(d, [add('new1', M('ريم', 'f', { birth: { date: '2015-03-02' }, privacy: 'full' }), { as: 'child', of: 'pson', with: 'pdil' })])), 'MINOR_DETAIL', 0);
    noWarn(ok(preview(d, [add('new1', M('ريم', 'f', { birth: { date: '1990' }, privacy: 'year', occupation: { ar: 'معلمة' } }))])), 'MINOR_DETAIL');
  });
});

// =========================================================================================================
// §3.3 checks on every path that creates a union or adds a partner

describe('§3.3 union-creation checks (SAME_PERSON, DUPLICATE_UNION, ANCESTOR_LINK, CYCLE)', () => {
  test('§3.3 SAME_PERSON on link-spouse, on a child link with of = with, and on merge', () => {
    const d = fixture();
    fails(preview(d, [{ op: 'link-spouse', a: 'plone', b: 'plone' }]), 'SAME_PERSON', 0);
    fails(preview(d, [add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pdad' })]), 'SAME_PERSON', 0);
    fails(preview(d, [merge('pson', 'pson')]), 'SAME_PERSON', 0);
  });

  test('§2.3 rule 9 / §3.3 DUPLICATE_UNION on link-spouse in either order', () => {
    const d = fixture();
    fails(preview(d, [{ op: 'link-spouse', a: 'pdad', b: 'pmom' }]), 'DUPLICATE_UNION', 0);
    fails(preview(d, [{ op: 'link-spouse', a: 'pmom', b: 'pdad' }]), 'DUPLICATE_UNION', 0);
  });

  test('§3.3 DUPLICATE_UNION against a union created earlier in the same proposal, reported with its op index', () => {
    fails(preview(fixture(), [
      add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone' }, { unionRef: 'newu2' }),
      { op: 'link-spouse', a: 'plone', b: 'new1' },
    ]), 'DUPLICATE_UNION', 1);
  });

  test('§3.3 link-spouse creates [a,b] and binds its unionRef', () => {
    const r = ok(preview(fixture(), [
      { op: 'link-spouse', a: 'plone', b: 'pcousin2', status: 'married', marriage: { date: '2005' }, unionRef: 'newu3' },
      add('new4', M('زيد'), { as: 'child', union: 'newu3' }),
    ]));
    assert.ok(sameSet(r.data.unions.newu3.partners, ['plone', 'pcousin2']));
    assert.equal(r.data.unions.newu3.marriage.date, '2005');
    assert.deepEqual(r.data.unions.newu3.children, ['new4']);
  });

  test('§2.3 rule 10 / §3.3 ANCESTOR_LINK on link-spouse, on add-person (child of {P,Q}) and on move-person', () => {
    const d = fixture();
    fails(preview(d, [{ op: 'link-spouse', a: 'pgrandpa', b: 'pdaughter' }]), 'ANCESTOR_LINK', 0);
    fails(preview(d, [{ op: 'link-spouse', a: 'pdaughter', b: 'pgrandpa' }]), 'ANCESTOR_LINK', 0);
    fails(preview(d, [add('new1', M('سعيد'), { as: 'child', of: 'pson', with: 'pgrandma' })]), 'ANCESTOR_LINK', 0);
    // pdil is married to pson; making her pson's child puts an ancestor in a couple.
    fails(preview(d, [move('pdil', { of: 'pson', with: null })]), 'ANCESTOR_LINK', 0);
  });

  test('§2.3 rule 7 / §3.3 CYCLE when move-person makes someone their own ancestor', () => {
    fails(preview(fixture(), [move('pgrandpa', { of: 'pson', with: null })]), 'CYCLE', 0);
  });

  test('§3.3 move-person into a union where the person is a partner → INVALID_RELATION', () => {
    fails(preview(fixture(), [move('pdad', { union: 'uparents' })]), 'INVALID_RELATION', 0);
  });

  test('§3.4 move-person target {of, with} finds the existing union instead of duplicating it', () => {
    const d = fixture();
    const r = ok(preview(d, [move('pkid', { of: 'pmom', with: 'pdad' })]));
    assert.ok(r.data.unions.uparents.children.includes('pkid'));
    assert.equal(activeWithPartners(r.data, ['pdad', 'pmom']).length, 1);
    assert.equal(unionCount(r.data), unionCount(d), 'no union created (the old one is only soft-removed)');
  });
});

// =========================================================================================================
// §3.3 move-person, REPARENT and destructiveness

describe('§3.3 move-person and REPARENT', () => {
  const reparentOp = () => move('pcousin', { of: 'pdad', with: 'pmom' });

  test('§3.3 dropping a known parent → warning REPARENT {from, droppedParents, descendants} and the proposal is destructive', () => {
    const r = ok(preview(fixture(), [reparentOp()]));
    const w = warns(r, 'REPARENT', 0);
    assert.equal(w.params.from, 'usingle');
    assert.ok(list(w.params.droppedParents).includes('paunt'));
    assert.ok('descendants' in w.params);
    assert.equal(r.destructive, true);
    assert.ok(r.reparent.length >= 1);
    assert.deepEqual(r.data.unions.usingle.children, ['pcousin2']);
    assert.ok(r.data.unions.uparents.children.includes('pcousin'));
  });

  test('§3.5 REPARENT in final mode without allowDestructive → DESTRUCTIVE_NOT_ALLOWED', () => {
    fails(final(fixture(), [reparentOp()]), 'DESTRUCTIVE_NOT_ALLOWED');
  });

  test('§3.3 REPARENT with allowDestructive applies; history {action, from, index}', () => {
    const r = ok(finalDel(fixture(), [reparentOp()]));
    const h = r.data.people.pcousin.history.at(-1);
    assert.equal(h.action, 'move-person');
    assert.equal(h.from, 'usingle');
    assert.equal(h.index, 0);
    assert.equal(r.destructive, true);
  });

  test('§3.3 keeping every known parent is not REPARENT and needs no deletion approval', () => {
    const d = fixture();
    const r = ok(final(d, [move('pcousin', { of: 'paunt', with: 'plone' })]));
    noWarn(r, 'REPARENT');
    assert.equal(r.destructive, false);
    const u = birthUnions(r.data, 'pcousin');
    assert.ok(sameSet(u[0].partners, ['paunt', 'plone']));
    assert.equal(u[0].status, 'married');
  });

  test('§3.3 moving out of a union with no partners drops no parent (not destructive)', () => {
    const r = ok(final(fixture(), [move('porph1', { union: 'uwidow' })]));
    noWarn(r, 'REPARENT');
    assert.equal(r.destructive, false);
    assert.deepEqual(r.data.unions.uorphans.children, ['porph2']);
  });

  test('§3.3/§3.4 move-person honours index', () => {
    const r = ok(preview(fixture(), [move('pkid', { union: 'uparents' }, { index: 1 })]));
    assert.deepEqual(r.data.unions.uparents.children, ['pson', 'pkid', 'pdaughter']);
  });

  test('§3.3 move-person to {of, with} creates the target union and binds unionRef', () => {
    const r = ok(preview(fixture(), [
      move('pkid', { of: 'plone', with: null }, { unionRef: 'newu4' }),
      add('new5', M('زيد'), { as: 'child', union: 'newu4' }),
    ]));
    assert.deepEqual(r.data.unions.newu4.partners, ['plone']);
    assert.deepEqual(r.data.unions.newu4.children, ['pkid', 'new5']);
  });
});

// =========================================================================================================
// §3.5 pruning vs soft-removal

describe('§3.5 pruning vs soft-removal', () => {
  test('§3.5 a union CREATED by this proposal that ends with < 2 members is deleted outright', () => {
    const r = ok(preview(fixture(), [
      add('new1', M('سعاد', 'f'), { as: 'sibling', of: 'pmom', share: 'both' }, { unionRef: 'newu2' }), // {[], [pmom,new1]}
      move('new1', { union: 'uorphans' }),
    ]));
    assert.equal(r.data.unions.newu2, undefined);
    assert.ok(!Object.values(r.data.unions).some((u) => u.children.includes('pmom')), 'pmom is back to no birth union');
    assert.deepEqual(r.data.unions.uorphans.children, ['porph1', 'porph2', 'new1']);
    assert.ok(validateData(r.data, { allowTempIds: true }).ok);
  });

  test('§3.5 a PRE-EXISTING union that drops below 2 members is soft-removed with auto:true (kept in data)', () => {
    const r = ok(preview(fixture(), [move('pkid', { union: 'uparents' })]));
    assert.ok(r.data.unions.uwidow, 'kept');
    assert.equal(r.data.unions.uwidow.removed?.auto, true);
  });

  test('§3.5 soft-removed people still count as members (removing a childless child keeps the birth union active)', () => {
    const r = ok(finalDel(fixture(), [{ op: 'remove-person', id: 'pkid', reasonCode: 'entered-by-mistake' }]));
    assert.ok(r.data.people.pkid.removed);
    assert.equal(r.data.unions.uwidow.removed, null);
    assert.deepEqual(r.data.unions.uwidow.children, ['pkid']);
  });
});

// =========================================================================================================
// §3.3 removals

describe('§3.3 remove-person, unlink-spouse, detach-person, remove-tie', () => {
  test('§3.3 remove-person of the root → IS_ROOT', () => {
    const d = fixture((raw) => { raw.meta.rootPersonId = 'plone'; });
    fails(preview(d, [{ op: 'remove-person', id: 'plone', reasonCode: 'other' }]), 'IS_ROOT', 0);
  });

  test('§3.3 remove-person with active children in any union → HAS_CHILDREN {children}', () => {
    const e = fails(preview(fixture(), [{ op: 'remove-person', id: 'pdad', reasonCode: 'entered-by-mistake' }]), 'HAS_CHILDREN', 0);
    const kids = list(e.params.children);
    for (const id of ['pson', 'pdaughter', 'phalf']) assert.ok(kids.includes(id), `children lists ${id}`);
  });

  test('§3.3 remove-person of an already removed person → ALREADY_REMOVED', () => {
    fails(preview(fixture(), [{ op: 'remove-person', id: 'pgone', reasonCode: 'other' }]), 'ALREADY_REMOVED', 0);
  });

  test('§3.3 remove-person also soft-removes their active childless unions with removed.with = id', () => {
    const r = ok(finalDel(fixture(), [{ op: 'remove-person', id: 'pdil', reasonCode: 'entered-by-mistake' }]));
    assert.equal(r.data.people.pdil.removed.reasonCode, 'entered-by-mistake');
    assert.ok(r.data.unions.uson.removed, 'childless union removed with her');
    assert.equal(r.data.unions.uson.removed.with, 'pdil');
    assert.equal(r.data.people.pson.removed, null);
    assert.ok(validateData(r.data).ok);
  });

  test('§3.3 remove-person redact:true clears every personal field and withholds the name', () => {
    const d = fixture((raw) => {
      Object.assign(raw.people.plone, { surname: { ar: 'الأحمد' }, occupation: { ar: 'تاجر' }, bio: { ar: 'سيرة قصيرة' }, nickname: { ar: 'أبو زيد' } });
    });
    const r = ok(finalDel(d, [{ op: 'remove-person', id: 'plone', reasonCode: 'person-requested', redact: true }]));
    const p = r.data.people.plone;
    assert.ok(p.removed);
    assert.equal(p.nameStatus, 'withheld');
    assert.deepEqual(p.name, { ar: '', en: '' });
    assert.equal(p.occupation.ar, '');
    assert.equal(p.bio.ar, '');
    assert.equal(p.birth.date, '');
    assert.ok(!serializeData(r.data).includes('يوسف'), 'the name is gone from the stored file');
  });

  test('§2.4 remove-person needs a valid reasonCode (no free text)', () => {
    const d = fixture();
    assert.equal(preview(d, [{ op: 'remove-person', id: 'plone', reasonCode: 'he asked me privately' }]).ok, false);
    assert.equal(preview(d, [{ op: 'remove-person', id: 'plone' }]).ok, false);
  });

  test('§3.3 destructive ops on temp refs → TEMP_NOT_ALLOWED', () => {
    const d = fixture();
    fails(preview(d, [add('new1', M('سعيد')), { op: 'remove-person', id: 'new1', reasonCode: 'entered-by-mistake' }]), 'TEMP_NOT_ALLOWED', 1);
    fails(preview(d, [add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' }), { op: 'detach-person', id: 'new1', reasonCode: 'wrong-parents' }]), 'TEMP_NOT_ALLOWED', 1);
    fails(preview(d, [add('new1', M('محمد')), merge('pson', 'new1')]), 'TEMP_NOT_ALLOWED', 1);
  });

  test('§3.3 unlink-spouse soft-removes a childless couple; HAS_CHILDREN when it has active children', () => {
    const d = fixture();
    const r = ok(finalDel(d, [{ op: 'unlink-spouse', union: 'uson', reasonCode: 'entered-by-mistake' }]));
    assert.equal(r.data.unions.uson.removed?.reasonCode, 'entered-by-mistake');
    fails(preview(d, [{ op: 'unlink-spouse', union: 'uparents', reasonCode: 'entered-by-mistake' }]), 'HAS_CHILDREN', 0);
    assert.equal(preview(d, [{ op: 'unlink-spouse', union: 'usingle', reasonCode: 'other' }]).ok, false, 'only 2-partner unions');
  });

  test('§3.3 detach-person: history {from, index}; the union is kept; move-person {union: from, index} undoes it', () => {
    const d = fixture();
    const r = ok(finalDel(d, [{ op: 'detach-person', id: 'pcousin', reasonCode: 'wrong-parents' }]));
    assert.equal(birthUnions(r.data, 'pcousin').length, 0);
    assert.equal(r.data.unions.usingle.removed, null);
    const h = r.data.people.pcousin.history.at(-1);
    assert.equal(h.action, 'detach-person');
    assert.equal(h.from, 'usingle');
    assert.equal(h.index, 0);
    const undo = ok(final(r.data, [move('pcousin', { union: h.from }, { index: h.index })]));
    assert.equal(undo.destructive, false, 'nobody had parents to drop');
    assert.deepEqual(undo.data.unions.usingle.children, d.unions.usingle.children);
  });

  test('§3.3 detach-person emptying a pre-existing union soft-removes it with auto', () => {
    const r = ok(finalDel(fixture(), [{ op: 'detach-person', id: 'pkid', reasonCode: 'wrong-parents' }]));
    assert.ok(r.data.unions.uwidow);
    assert.equal(r.data.unions.uwidow.removed?.auto, true);
  });

  test('§3.3 add-tie / remove-tie, DUPLICATE_TIE, no self tie, unknown tie cannot be removed', () => {
    const d = fixture();
    const tie = { op: 'add-tie', id: 'pson', type: 'milk-child-of', person: 'pwife2', note: { ar: 'أرضعته في صغره' } };
    const r = ok(preview(d, [tie]));
    assert.ok(r.data.people.pson.ties.some((t) => t.type === 'milk-child-of' && t.person === 'pwife2'));
    fails(preview(d, [tie, tie]), 'DUPLICATE_TIE', 1);
    assert.equal(preview(d, [{ op: 'add-tie', id: 'pson', type: 'milk-child-of', person: 'pson' }]).ok, false);
    assert.equal(preview(d, [{ op: 'add-tie', id: 'pson', type: 'adopted-by', person: 'pwife2' }]).ok, false);
    const d2 = fixture(withMilkTie);
    const r2 = ok(finalDel(d2, [{ op: 'remove-tie', id: 'pson', type: 'milk-child-of', person: 'pwife2', reasonCode: 'entered-by-mistake' }]));
    assert.deepEqual(r2.data.people.pson.ties, []);
    assert.equal(preview(d, [{ op: 'remove-tie', id: 'pson', type: 'milk-child-of', person: 'pwife2', reasonCode: 'other' }]).ok, false);
  });

  test('§3.2 add-tie to a merged person is redirected', () => {
    const r = ok(preview(fixture(), [{ op: 'add-tie', id: 'pkid', type: 'foster-child-of', person: 'pold' }]));
    assert.ok(r.data.people.pkid.ties.some((t) => t.person === 'pdad'));
    warns(r, 'MERGED_REDIRECT', 0);
  });
});

// =========================================================================================================
// §3.3 restore

describe('§3.3 restore-person and restore-union', () => {
  test('§3.3 restore-person clears removed and re-activates unions with removed.with === id', () => {
    const removed = ok(finalDel(fixture(), [{ op: 'remove-person', id: 'pdil', reasonCode: 'entered-by-mistake' }]));
    const r = ok(final(removed.data, [{ op: 'restore-person', id: 'pdil' }]));
    assert.equal(r.data.people.pdil.removed, null);
    assert.equal(r.data.unions.uson.removed, null);
    assert.ok(validateData(r.data).ok);
  });

  test('§3.3 restore-union re-activates a removed union', () => {
    const d = fixture((raw) => {
      raw.unions.uformer = { id: 'uformer', partners: ['plone', 'pcousin2'], status: 'divorced', removed: REMOVED({ reasonCode: 'other' }) };
    });
    const r = ok(final(d, [{ op: 'restore-union', union: 'uformer' }]));
    assert.equal(r.data.unions.uformer.removed, null);
  });

  test('§3.3 RESTORE_CONFLICT when restoring would duplicate an active couple (rule 9)', () => {
    const d = fixture((raw) => {
      raw.unions.uoldpair = { id: 'uoldpair', partners: ['pdad', 'pmom'], removed: REMOVED() };
    });
    assert.ok(fails(preview(d, [{ op: 'restore-union', union: 'uoldpair' }]), 'RESTORE_CONFLICT', 0).params);
  });

  test('§3.3 RESTORE_CONFLICT when restoring gives a child a second birth union (rule 6)', () => {
    const d = fixture((raw) => {
      raw.unions.uwrong = { id: 'uwrong', partners: ['plone'], children: ['pson'], removed: REMOVED({ reasonCode: 'wrong-parents' }) };
    });
    fails(preview(d, [{ op: 'restore-union', union: 'uwrong' }]), 'RESTORE_CONFLICT', 0);
  });

  test('§3.3 RESTORE_CONFLICT when restoring would create a cycle or an ancestor couple (rules 7, 10)', () => {
    const d = fixture((raw) => {
      raw.unions.ucyc = { id: 'ucyc', partners: ['pson'], children: ['pgrandpa'], removed: REMOVED() };
      raw.unions.uanc = { id: 'uanc', partners: ['pgrandpa', 'pdaughter'], removed: REMOVED() };
    });
    fails(preview(d, [{ op: 'restore-union', union: 'ucyc' }]), 'RESTORE_CONFLICT', 0);
    fails(preview(d, [{ op: 'restore-union', union: 'uanc' }]), 'RESTORE_CONFLICT', 0);
  });

  test('§3.3 RESTORE_CONFLICT when restore-person re-activates a union that breaks an invariant', () => {
    const d = fixture((raw) => {
      // هدى was entered twice by mistake: as a granddaughter AND as the grandfather's wife; both were removed.
      raw.people.pexwife = P('pexwife', 'هدى', 'f', '1985', { privacy: 'year', removed: REMOVED() });
      raw.unions.uparents.children.push('pexwife');
      raw.unions.uexpair = { id: 'uexpair', partners: ['pgrandpa', 'pexwife'], removed: REMOVED({ reasonCode: '', with: 'pexwife' }) };
    });
    // Restoring her re-activates uexpair, where her grandfather would be her husband (rule 10).
    fails(preview(d, [{ op: 'restore-person', id: 'pexwife' }]), 'RESTORE_CONFLICT', 0);
  });

  test('§3.3 restore-person of a merged person → MERGED_USE_UNDO (no redirect for restore ops)', () => {
    fails(preview(fixture(), [{ op: 'restore-person', id: 'pold' }]), 'MERGED_USE_UNDO', 0);
  });

  test('§3.2 restore ops require a removed target', () => {
    const d = fixture();
    assert.equal(preview(d, [{ op: 'restore-person', id: 'pdad' }]).ok, false);
    assert.equal(preview(d, [{ op: 'restore-union', union: 'uparents' }]).ok, false);
  });
});

// =========================================================================================================
// §3.3 merge-person

describe('§3.3 merge-person', () => {
  test('§3.3 merge: remove → mergedInto keep; a now-duplicate couple collapses into the EARLIER union (children appended, empty fields filled, later soft-removed with mergedInto)', () => {
    const d = fixture(withDadDuplicate);
    const r = ok(preview(d, [merge('pdad', 'pdad2')]));
    assert.equal(r.data.people.pdad2.removed?.mergedInto, 'pdad');
    assert.deepEqual(r.data.unions.uparents.children, ['pson', 'pdaughter', 'pextra']);
    assert.equal(r.data.unions.uparents.marriage.date, '1978');
    assert.equal(r.data.unions.udup.removed?.mergedInto, 'uparents');
    assert.equal(activeWithPartners(r.data, ['pdad', 'pmom']).length, 1);
    assert.equal(r.merges, 1);
    assert.equal(r.destructive, true);
    const v = validateData(r.data);
    assert.ok(v.ok, JSON.stringify(v.errors));
  });

  test('§3.3 merge: single-partner unions collapse too (rule 9 holds afterwards)', () => {
    const r = ok(preview(fixture(withWidowDuplicate), [merge('pwidow', 'pwidow2')]));
    const solo = activeWithPartners(r.data, ['pwidow']);
    assert.equal(solo.length, 1);
    assert.equal(solo[0].id, 'uwidow');
    assert.deepEqual(solo[0].children, ['pkid', 'pkid2']);
    assert.equal(r.data.unions.uwidow2.removed?.mergedInto, 'uwidow');
    assert.ok(validateData(r.data).ok);
  });

  test('§3.3 merge: different birth unions and no parents choice → CONFLICTING_PARENTS', () => {
    fails(preview(fixture(withSonDuplicateElsewhere), [merge('pson', 'pson2')]), 'CONFLICTING_PARENTS', 0);
  });

  test('§3.3 merge parents:"keep" keeps keep\'s birth union', () => {
    const r = ok(preview(fixture(withSonDuplicateElsewhere), [merge('pson', 'pson2', { parents: 'keep' })]));
    assert.deepEqual(birthUnions(r.data, 'pson').map((u) => u.id), ['uparents']);
    assert.ok(!r.data.unions.uwrong.children.includes('pson'));
    assert.ok(validateData(r.data).ok);
  });

  test('§3.3 merge parents:"remove" puts keep into remove\'s birth union (and out of its own)', () => {
    const r = ok(preview(fixture(withSonDuplicateElsewhere), [merge('pson', 'pson2', { parents: 'remove' })]));
    assert.deepEqual(birthUnions(r.data, 'pson').map((u) => u.id), ['uwrong']);
    assert.ok(!r.data.unions.uparents.children.includes('pson'));
    assert.equal(r.data.unions.uwrong.children[0], 'pson');
    assert.ok(validateData(r.data).ok);
  });

  test('§3.3 merge: same birth union → remove is dropped from it, keep keeps its place', () => {
    const r = ok(preview(fixture(withSonDuplicateSameUnion), [merge('pson', 'pson2')]));
    assert.deepEqual(r.data.unions.uparents.children, ['pson', 'pdaughter']);
  });

  test('§3.3 merge: only remove has a birth union → keep takes remove\'s exact slot', () => {
    const r = ok(preview(fixture(withCousinDuplicate), [merge('pnour', 'pcousin')]));
    assert.deepEqual(r.data.unions.usingle.children, ['pnour', 'pcousin2']);
    assert.equal(r.data.people.pcousin.removed?.mergedInto, 'pnour');
  });

  test('§3.3 merge: keep\'s empty fields are filled; differing values → MERGE_FIELD_CONFLICT {path, keep, remove} and keep wins', () => {
    const r = ok(preview(fixture(withCousinDuplicate), [merge('pnour', 'pcousin')]));
    const p = r.data.people.pnour;
    assert.equal(p.occupation.ar, 'معلمة');
    const w = warns(r, 'MERGE_FIELD_CONFLICT', 0);
    assert.deepEqual({ path: w.params.path, keep: w.params.keep, remove: w.params.remove }, { path: 'occupation.ar', keep: 'معلمة', remove: 'طبيبة' });
    assert.equal(p.birth.date, '1980', 'empty birth date filled from remove');
  });

  test('§3.3 merge: tags and ties merged; duplicateOf === remove → keep (cleared on keep itself)', () => {
    const r = ok(preview(fixture(withCousinDuplicate), [merge('pnour', 'pcousin')]));
    const p = r.data.people.pnour;
    assert.ok(p.tags.includes('verified'));
    assert.ok(p.ties.some((t) => t.type === 'milk-child-of' && t.person === 'pwidow'));
    assert.equal(p.duplicateOf, '', 'would point at itself → cleared');
    assert.equal(r.data.people.pcousin2.duplicateOf, 'pnour');
    assert.ok(validateData(r.data).ok);
  });

  test('§3.3 merge: rootPersonId === remove → keep (merging the root is not IS_ROOT)', () => {
    const r = ok(preview(fixture(withRootDuplicate), [merge('pgp2', 'pgrandpa')]));
    assert.equal(r.data.meta.rootPersonId, 'pgp2');
    assert.ok(sameSet(r.data.unions.ugrand.partners, ['pgp2', 'pgrandma']));
    assert.equal(buildGraph(r.data).father('pdad')?.id, 'pgp2');
  });

  test('§3.3 merge: partners of one union → MERGE_SPOUSES', () => {
    // pdil's gender is unknown here so GENDER_CONFLICT cannot pre-empt the check.
    const d = fixture((raw) => { raw.people.pdil.gender = ''; });
    fails(preview(d, [merge('pson', 'pdil')]), 'MERGE_SPOUSES', 0);
  });

  test('§3.3 merge: different known genders → GENDER_CONFLICT; an empty gender is filled instead', () => {
    fails(preview(fixture(), [merge('pson', 'pcousin', { parents: 'keep' })]), 'GENDER_CONFLICT', 0);
    const d = fixture((raw) => { raw.people.pnog = { id: 'pnog', name: { ar: 'نور' } }; });
    const r = ok(preview(d, [merge('pnog', 'pcousin')]));
    assert.equal(r.data.people.pnog.gender, 'f');
  });

  test('§3.3 merge: a removed target → TARGET_REMOVED', () => {
    fails(preview(fixture(), [merge('pdad', 'pgone')]), 'TARGET_REMOVED', 0);
  });

  test('§3.3 merge that would make keep its own ancestor → CYCLE / ANCESTOR_LINK (checked on the result)', () => {
    failsAny(preview(fixture(), [merge('pgrandpa', 'pson')]), ['CYCLE', 'ANCESTOR_LINK'], 0);
  });

  test('§3.2/§3.3 later ops naming the merged person are redirected to keep with MERGED_REDIRECT', () => {
    const r = ok(preview(fixture(withDadDuplicate), [
      merge('pdad', 'pdad2'),
      edit('pdad2', { 'occupation.ar': 'تاجر' }),
      add('new1', M('سعيد'), { as: 'child', of: 'pdad2', with: 'pmom' }),
    ]));
    assert.equal(r.data.people.pdad.occupation.ar, 'تاجر');
    const w = warns(r, 'MERGED_REDIRECT', 1);
    assert.deepEqual({ from: w.params.from, to: w.params.to }, { from: 'pdad2', to: 'pdad' });
    assert.ok(r.data.unions.uparents.children.includes('new1'), 'the collapsed couple union is found');
    assert.equal(activeWithPartners(r.data, ['pdad', 'pmom']).length, 1);
  });
});

// =========================================================================================================
// §3.3 edit-person, edit-union, STALE_EDIT

describe('§3.3 edits and STALE_EDIT', () => {
  const staleOp = () => edit('pson', { 'occupation.ar': 'مهندس' }, { before: { 'occupation.ar': 'طالب' } });

  test('§3.3 STALE_EDIT is an ERROR in final mode', () => {
    fails(final(fixture(), [staleOp()]), 'STALE_EDIT', 0);
  });

  test('§3.3 STALE_EDIT is a WARNING in preview mode (the edit applies)', () => {
    const r = ok(preview(fixture(), [staleOp()]));
    warns(r, 'STALE_EDIT', 0);
    assert.equal(r.data.people.pson.occupation.ar, 'مهندس');
  });

  test('§3.3 STALE_EDIT in final mode is overridden by opts.force', () => {
    const r = ok(final(fixture(), [staleOp()], { force: true }));
    assert.equal(r.data.people.pson.occupation.ar, 'مهندس');
  });

  test('§3.3 a matching before[] is not stale', () => {
    const r = ok(final(fixture(), [edit('pson', { 'occupation.ar': 'مهندس' }, { before: { 'occupation.ar': '' } })]));
    noWarn(r, 'STALE_EDIT');
  });

  test('§3.3 edit-union follows the same STALE_EDIT rule', () => {
    const op = { op: 'edit-union', union: 'uson', set: { status: 'divorced' }, before: { status: 'unknown' } };
    fails(final(fixture(), [op]), 'STALE_EDIT', 0);
    warns(ok(preview(fixture(), [op])), 'STALE_EDIT', 0);
    const r = ok(final(fixture(), [{ op: 'edit-union', union: 'uson', set: { status: 'divorced', 'divorce.date': '2010' }, before: { status: 'married' } }]));
    assert.equal(r.data.unions.uson.status, 'divorced');
    assert.equal(r.data.unions.uson.divorce.date, '2010');
  });

  test('§3.3 reorder-children beforeOrder ≠ current follows the STALE_EDIT rule', () => {
    const op = { op: 'reorder-children', union: 'uparents', order: ['pdaughter'], beforeOrder: ['pdaughter', 'pson'] };
    fails(final(fixture(), [op]), 'STALE_EDIT', 0);
    warns(ok(preview(fixture(), [op])), 'STALE_EDIT', 0);
    ok(final(fixture(), [{ ...op, beforeOrder: ['pson', 'pdaughter'] }]));
  });

  test('§3.3 edit-person result must satisfy nameStatus rules (NAME_REQUIRED)', () => {
    const d = fixture();
    fails(preview(d, [edit('pson', { 'name.ar': '' })]), 'NAME_REQUIRED', 0);
    const r = ok(preview(d, [edit('pson', { nameStatus: 'withheld', 'name.ar': '' })]));
    assert.equal(r.data.people.pson.nameStatus, 'withheld');
  });

  test('§2.1 withholding a name through edit-person never leaves the name in the data (NAME_SHOULD_BE_EMPTY or cleared)', () => {
    // The spec fixes the data rule (withheld ⇒ name empty) but not whether edit-person refuses or clears; both keep
    // the withheld name out of the repository, which is the requirement.
    for (const nameStatus of ['withheld', 'unknown']) {
      const r = final(fixture(), [edit('pson', { nameStatus })]);
      if (r.ok) {
        assert.equal(r.data.people.pson.nameStatus, nameStatus);
        assert.deepEqual(r.data.people.pson.name, { ar: '', en: '' });
        assert.ok(!serializeData(r.data).includes('"محمد"'), 'withheld name not stored');
      } else {
        assert.ok(codes(r.errors).includes('NAME_SHOULD_BE_EMPTY'), show(r));
      }
    }
  });

  test('§2.1 edit-person: a full birth date set on a privacy "year" person is stored as the year', () => {
    const d = fixture();
    const r = ok(final(d, [edit('pson', { 'birth.date': '1980-06-15' })]));
    assert.equal(r.data.people.pson.birth.date, '1980');
    const r2 = ok(final(d, [edit('pson', { privacy: 'full', 'birth.date': '1980-06-15' })]));
    assert.equal(r2.data.people.pson.birth.date, '1980-06-15');
  });

  test('§2.1 edit-person: setting birth.date clears hijri; a death date ⇒ deceased; deceased:false clears death', () => {
    const d = fixture();
    const r = ok(preview(d, [
      add('new1', { name: { ar: 'عبد الله' }, gender: 'm', deceased: true, birth: { hijri: '1370' } }),
      edit('new1', { 'birth.date': '1950' }),
      edit('pdad', { 'death.date': '2020' }),
      edit('pgrandpa', { deceased: false }),
    ]));
    assert.equal(r.data.people.new1.birth.hijri, '');
    assert.equal(r.data.people.new1.birth.date, '1950');
    assert.equal(r.data.people.pdad.deceased, true);
    assert.equal(r.data.people.pgrandpa.deceased, false);
    assert.equal(r.data.people.pgrandpa.death.date, '');
  });

  test('§3.3 changing the gender of a parent → warning GENDER_FLIPS_PARENT', () => {
    const d = fixture();
    warns(ok(preview(d, [edit('pdad', { gender: 'f' })])), 'GENDER_FLIPS_PARENT', 0);
    noWarn(ok(preview(d, [edit('plone', { gender: 'f' })])), 'GENDER_FLIPS_PARENT');
  });

  test('§3.3 edit-person paths outside the list are never applied (no tags/removed/id through edit)', () => {
    const d = fixture();
    const r = preview(d, [edit('pdad', { tags: ['verified'], id: 'pzzzz', 'removed': REMOVED() })]);
    assert.ok([...r.errors, ...r.warnings].length > 0, 'the bad paths are reported');
    const p = r.data.people.pdad;
    assert.ok(p, 'pdad still exists under its id');
    assert.deepEqual(p.tags, []);
    assert.equal(p.removed, null);
    assert.equal(r.data.people.pzzzz, undefined);
  });
});

// =========================================================================================================
// §3.3 mark

describe('§3.3 mark', () => {
  test('§3.3 mark deceased (date → death) and living (death cleared)', () => {
    const d = fixture();
    const r = ok(preview(d, [{ op: 'mark', id: 'pdad', mark: 'deceased', date: '2020-03-01' }, { op: 'mark', id: 'pgrandpa', mark: 'living' }]));
    assert.equal(r.data.people.pdad.deceased, true);
    assert.equal(r.data.people.pdad.death.date, '2020-03-01');
    assert.equal(r.data.people.pgrandpa.deceased, false);
    assert.equal(r.data.people.pgrandpa.death.date, '');
  });

  test('§3.3 mark deceased with a Hijri year derives the Gregorian date (approx)', () => {
    const r = ok(preview(fixture(), [{ op: 'mark', id: 'pdad', mark: 'deceased', hijri: '1441' }]));
    const death = r.data.people.pdad.death;
    assert.equal(death.hijri, '1441');
    assert.equal(death.date, hijriToGregorian('1441').date);
    assert.equal(death.approx, true);
  });

  test('§3.3 mark verified/unverified and needs-info/info-complete', () => {
    const d = fixture();
    const r = ok(preview(d, [
      { op: 'mark', id: 'pson', mark: 'verified' },
      { op: 'mark', id: 'pdaughter', mark: 'needs-info', note: 'تاريخ الميلاد غير معروف' },
    ]));
    assert.ok(r.data.people.pson.tags.includes('verified'));
    assert.ok(r.data.people.pdaughter.tags.includes('needs-info'));
    assert.equal(r.data.people.pdaughter.needsInfo, 'تاريخ الميلاد غير معروف');
    const r2 = ok(preview(r.data, [
      { op: 'mark', id: 'pson', mark: 'unverified' },
      { op: 'mark', id: 'pdaughter', mark: 'info-complete' },
    ]));
    assert.ok(!r2.data.people.pson.tags.includes('verified'));
    assert.ok(!r2.data.people.pdaughter.tags.includes('needs-info'));
    assert.equal(r2.data.people.pdaughter.needsInfo, '');
    fails(preview(d, [{ op: 'mark', id: 'pson', mark: 'needs-info', note: 'ن'.repeat(301) }]), 'TOO_LONG', 0);
  });

  test('§3.3 mark duplicate (of an active other person) / not-duplicate', () => {
    const d = fixture();
    const r = ok(preview(d, [{ op: 'mark', id: 'pcousin2', mark: 'duplicate', of: 'pcousin' }]));
    assert.equal(r.data.people.pcousin2.duplicateOf, 'pcousin');
    const r2 = ok(preview(r.data, [{ op: 'mark', id: 'pcousin2', mark: 'not-duplicate' }]));
    assert.equal(r2.data.people.pcousin2.duplicateOf, '');
    assert.equal(preview(d, [{ op: 'mark', id: 'pcousin2', mark: 'duplicate', of: 'pcousin2' }]).ok, false, 'not self');
    fails(preview(d, [{ op: 'mark', id: 'pcousin2', mark: 'duplicate', of: 'pgone' }]), 'TARGET_REMOVED', 0);
    const r3 = ok(preview(d, [{ op: 'mark', id: 'phalf', mark: 'duplicate', of: 'pold' }]));
    assert.equal(r3.data.people.phalf.duplicateOf, 'pdad');
    warns(r3, 'MERGED_REDIRECT', 0);
  });

  test('§3.3 mark private: privacy year (truncated), places/occupation/bio/photo cleared, name withheld, links kept', () => {
    const d = fixture((raw) => {
      Object.assign(raw.people.pcousin, {
        privacy: 'full', birth: { date: '1980-04-02', place: { ar: 'جدة' } }, occupation: { ar: 'طبيبة' },
        bio: { ar: 'تحب القراءة' }, photo: 'https://example.com/noor.jpg',
      });
    });
    const r = ok(final(d, [{ op: 'mark', id: 'pcousin', mark: 'private' }]));
    const p = r.data.people.pcousin;
    assert.equal(p.privacy, 'year');
    assert.equal(p.birth.date, '1980');
    assert.deepEqual(p.birth.place, { ar: '', en: '' });
    assert.deepEqual(p.occupation, { ar: '', en: '' });
    assert.deepEqual(p.bio, { ar: '', en: '' });
    assert.equal(p.photo, '');
    assert.equal(p.nameStatus, 'withheld');
    assert.deepEqual(p.name, { ar: '', en: '' });
    assert.ok(r.data.unions.usingle.children.includes('pcousin'), 'links kept');
    const text = serializeData(r.data);
    for (const leak of ['1980-04', 'جدة', 'طبيبة', 'noor.jpg']) assert.ok(!text.includes(leak), `${leak} must not be stored`);
  });
});

// =========================================================================================================
// §3.3 reorder

describe('§3.3 reorder-children and reorder-spouses', () => {
  test('§3.3 reorder-children: listed current children first, then the rest in current order', () => {
    const r = ok(preview(fixture(), [
      add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' }), // → [pson, pdaughter, new1]
      { op: 'reorder-children', union: 'uparents', order: ['pdaughter'] },
    ]));
    assert.deepEqual(r.data.unions.uparents.children, ['pdaughter', 'pson', 'new1']);
  });

  test('§3.3 reorder-children: ids that are not children → warning ORDER_IGNORED, the rest still applies', () => {
    const r = ok(preview(fixture(), [{ op: 'reorder-children', union: 'uparents', order: ['plone', 'pdaughter', 'pson'] }]));
    warns(r, 'ORDER_IGNORED', 0);
    assert.deepEqual(r.data.unions.uparents.children, ['pdaughter', 'pson']);
  });

  test('§3.3 reorder-spouses: listed unions containing id first, then the remaining ones in current display order', () => {
    const r = ok(preview(fixture(), [{ op: 'reorder-spouses', id: 'pdad', order: ['usecond'] }]));
    assert.deepEqual(r.data.people.pdad.spouseOrder, ['usecond', 'uparents']);
    const r2 = preview(fixture(), [{ op: 'reorder-spouses', id: 'pdad', order: ['uson', 'usecond'] }]);
    if (r2.ok) assert.deepEqual(r2.data.people.pdad.spouseOrder, ['usecond', 'uparents'], 'a union without pdad is ignored');
  });
});

// =========================================================================================================
// §3.1/§3.3/§3.5 limits and destructive gating

describe('§3.1/§3.3/§3.5 limits and destructive gating', () => {
  const destructiveCases = () => [
    ['remove-person', fixture(), { op: 'remove-person', id: 'plone', reasonCode: 'entered-by-mistake' }],
    ['unlink-spouse', fixture(), { op: 'unlink-spouse', union: 'uson', reasonCode: 'entered-by-mistake' }],
    ['detach-person', fixture(), { op: 'detach-person', id: 'pkid', reasonCode: 'wrong-parents' }],
    ['remove-tie', fixture(withMilkTie), { op: 'remove-tie', id: 'pson', type: 'milk-child-of', person: 'pwife2', reasonCode: 'other' }],
    ['merge-person', fixture(withCousinDuplicate), merge('pnour', 'pcousin')],
  ];

  test('§3.5 every destructive op in final mode without allowDestructive → DESTRUCTIVE_NOT_ALLOWED', () => {
    for (const [name, d, op] of destructiveCases()) {
      const r = final(d, [op]);
      assert.equal(r.ok, false, name);
      assert.ok(codes(r.errors).includes('DESTRUCTIVE_NOT_ALLOWED'), `${name}: ${show(r)}`);
      ok(finalDel(d, [op]));
    }
  });

  test('§3.5 allowDestructive defaults: true in preview, false in final', () => {
    const d = fixture();
    const op = { op: 'remove-person', id: 'plone', reasonCode: 'entered-by-mistake' };
    ok(OPS.applyProposal(d, proposal([op]), { mode: 'preview', now: NOW }));
    fails(OPS.applyProposal(d, proposal([op]), { mode: 'final', now: NOW, issue: 42, actor: 'owner' }), 'DESTRUCTIVE_NOT_ALLOWED');
  });

  test('§3.3 at most 3 non-merge destructive ops: 4 → TOO_MANY_DESTRUCTIVE', () => {
    const d = fixture(withMilkTie);
    const three = [
      { op: 'unlink-spouse', union: 'uson', reasonCode: 'entered-by-mistake' },
      { op: 'detach-person', id: 'pkid', reasonCode: 'wrong-parents' },
      { op: 'remove-person', id: 'plone', reasonCode: 'entered-by-mistake' },
    ];
    ok(finalDel(d, three));
    fails(finalDel(d, [...three, { op: 'remove-tie', id: 'pson', type: 'milk-child-of', person: 'pwife2', reasonCode: 'other' }]), 'TOO_MANY_DESTRUCTIVE');
  });

  test('§3.3 merges and REPARENT do not count toward the destructive cap', () => {
    const d = fixture(withCousinDuplicate);
    const r = ok(finalDel(d, [
      { op: 'unlink-spouse', union: 'uson', reasonCode: 'entered-by-mistake' },
      { op: 'detach-person', id: 'pkid', reasonCode: 'wrong-parents' },
      { op: 'remove-person', id: 'plone', reasonCode: 'entered-by-mistake' },
      merge('pnour', 'pcousin'),
      move('pcousin2', { of: 'pdad', with: 'pmom' }), // REPARENT (paunt dropped)
    ]));
    assert.equal(r.destructive, true);
    assert.equal(r.merges, 1);
    warns(r, 'REPARENT', 4);
  });

  test('§3.3 at most 30 merges: 31 → TOO_MANY_MERGES', () => {
    const d = fixture(withPairs(31));
    const ops = (n) => Array.from({ length: n }, (_, i) => merge(`pm${String(i).padStart(3, '0')}a`, `pm${String(i).padStart(3, '0')}b`));
    const r = ok(finalDel(d, ops(30)));
    assert.equal(r.merges, 30);
    fails(finalDel(d, ops(31)), 'TOO_MANY_MERGES');
  });

  test('§3.1 ops 1..150: 150 apply, 151 and 0 are refused', () => {
    const d = fixture();
    const many = (n) => Array.from({ length: n }, (_, i) => edit('pson', { 'occupation.ar': `مهنة ${i}` }));
    ok(preview(d, many(150)));
    const r = preview(d, many(151));
    failsAny(r, ['TOO_MANY_OPS', 'TOO_LONG']);
    assert.equal(preview(d, []).ok, false);
  });

  test('§3.1 proposal note ≤ 2000 characters', () => {
    const r = preview(fixture(), [edit('pson', { 'occupation.ar': 'مهندس' })], {}, { note: 'ملاحظة '.repeat(300) });
    fails(r, 'TOO_LONG');
  });

  test('§3.5 validateProposal rejects bad envelopes and unknown ops', () => {
    const d = fixture();
    assert.equal(OPS.applyProposal(d, { ...proposal([edit('pson', { 'occupation.ar': 'مهندس' })]), kind: 'something-else' }, { mode: 'preview', now: NOW }).ok, false);
    assert.equal(preview(d, [{ op: 'teleport-person', id: 'pson' }]).ok, false);
    assert.equal(preview(d, [{ op: 'edit-person', id: 'pson' }]).ok, false, 'missing set');
  });

  test('§4 isDestructive(p) looks at static op types only (move-person is not statically destructive)', () => {
    assert.equal(OPS.isDestructive(proposal([edit('pson', { 'occupation.ar': 'مهندس' })])), false);
    assert.equal(OPS.isDestructive(proposal([move('pcousin', { of: 'pdad', with: 'pmom' })])), false);
    for (const [name, , op] of destructiveCases()) assert.equal(OPS.isDestructive(proposal([op])), true, name);
  });
});

// =========================================================================================================
// §4 ops.js helpers

describe('§4 ops.js helpers', () => {
  test('§3.1/§4 newProposal() returns a fresh envelope with a 10-char base36 id', () => {
    const a = OPS.newProposal();
    const b = OPS.newProposal();
    assert.equal(a.kind, 'gft-proposal');
    assert.equal(a.v, 1);
    assert.match(a.id, /^[a-z0-9]{10}$/);
    assert.notEqual(a.id, b.id);
    assert.ok(Array.isArray(a.ops) && a.ops.length === 0);
    assert.ok(Array.isArray(a.dependsOn));
  });

  test('§4 opRefs(op) → {declares, uses}', () => {
    const r = OPS.opRefs(add('new3', M('سعيد'), { as: 'child', of: 'new1', with: 'pdad' }, { unionRef: 'newu4' }));
    assert.ok(r.declares.includes('new3') && r.declares.includes('newu4'));
    assert.ok(r.uses.includes('new1'));
    assert.ok(!r.uses.includes('new3'));
    const r2 = OPS.opRefs({ op: 'reorder-children', union: 'newu4', order: ['new3', 'pson'] });
    assert.ok(r2.uses.includes('newu4') && r2.uses.includes('new3'));
    assert.deepEqual(r2.declares, []);
    const r3 = OPS.opRefs(move('new1', { of: 'new2', with: 'new3' }));
    for (const ref of ['new1', 'new2', 'new3']) assert.ok(r3.uses.includes(ref), ref);
  });

  test('§4 skipOps(p, indexes) drops those ops (0-based, like Issue.op) and every op depending on them', () => {
    const p = proposal([
      add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' }),
      add('new2', M('زيد'), { as: 'child', of: 'new1' }, { unionRef: 'newu7' }),
      { op: 'reorder-children', union: 'newu7', order: ['new2'] },
      edit('pson', { 'occupation.ar': 'مهندس' }),
    ]);
    const snapshot = structuredClone(p);
    const s = OPS.skipOps(p, [0]);
    assert.deepEqual(s.ops, [p.ops[3]]);
    assert.deepEqual(p, snapshot, 'input not mutated');
    assert.deepEqual(OPS.skipOps(p, [3]).ops, p.ops.slice(0, 3));
    ok(preview(fixture(), s.ops));
  });

  test('§4 proposalHash: async sha-256 hex of canonical JSON (sorted keys), ignoring createdAt', async () => {
    const p = proposal([edit('pson', { 'occupation.ar': 'مهندس' })]);
    const h = await OPS.proposalHash(p);
    assert.match(h, /^[0-9a-f]{64}$/);
    const reordered = Object.fromEntries(Object.entries(p).reverse());
    assert.equal(await OPS.proposalHash(reordered), h, 'key order does not matter');
    assert.equal(await OPS.proposalHash({ ...p, createdAt: '2030-01-01T00:00:00Z' }), h, 'createdAt excluded');
    assert.notEqual(await OPS.proposalHash({ ...p, note: 'شكراً' }), h);
    assert.notEqual(await OPS.proposalHash(proposal([edit('pson', { 'occupation.ar': 'طبيب' })])), h);
  });

  test('§3.5 validateProposal(p) accepts a well-formed proposal and rejects malformed ones', () => {
    const isValid = (res) => res === true || res?.ok === true;
    assert.ok(isValid(OPS.validateProposal(proposal([add('new1', M('سعيد'), { as: 'child', of: 'pdad', with: 'pmom' })]))));
    assert.ok(!isValid(OPS.validateProposal(proposal([]))), 'no ops');
    assert.ok(!isValid(OPS.validateProposal({ ...proposal([edit('pson', { 'occupation.ar': 'x' })]), kind: 'other' })), 'kind');
    assert.ok(!isValid(OPS.validateProposal(proposal(Array.from({ length: 151 }, () => edit('pson', { 'occupation.ar': 'x' }))))), '151 ops');
    assert.ok(!isValid(OPS.validateProposal(proposal([add('new1', M('سعيد')), add('new1', M('خالد'))]))), 'DUPLICATE_REF is a shape error');
  });
});

// =========================================================================================================
// Adversarial extras: state carried across ops, union refs, privacy corners

describe('§3 adversarial extras', () => {
  test('§3.3 checks see the state left by earlier ops of the same proposal (PARENTS_FULL, ANCESTOR_LINK, CYCLE)', () => {
    const d = fixture();
    fails(preview(d, [
      add('new1', M('خالد'), { as: 'parent', of: 'pcousin' }), //  usingle becomes [paunt, new1]
      add('new2', M('عمر'), { as: 'parent', of: 'pcousin2' }), //  same union, now full
    ]), 'PARENTS_FULL', 1);
    fails(preview(d, [
      add('new1', M('ريم', 'f'), { as: 'child', of: 'pson', with: 'pdil' }),
      { op: 'link-spouse', a: 'new1', b: 'pgrandpa' }, //            her great-grandfather
    ]), 'ANCESTOR_LINK', 1);
    fails(preview(d, [
      add('new1', M('زيد'), { as: 'child', of: 'pson', with: 'pdil' }),
      move('pson', { of: 'new1', with: null }), //                   pson under his own son
    ]), 'CYCLE', 1);
  });

  test('§3.5 atomic in final mode too: no revision bump, nothing stamped, on failure', () => {
    const d = fixture();
    const r = final(d, [edit('pson', { 'occupation.ar': 'مهندس' }), edit('pnosuch', { 'occupation.ar': 'تاجر' })]);
    fails(r, 'UNKNOWN_ID', 1);
    assert.equal(r.data.meta.revision, 7);
    assert.deepEqual(r.data.people.pson.history, []);
    assert.equal(r.data.people.pson.occupation.ar, '');
  });

  test('§3.2 union refs follow removed.mergedInto too (MERGED_REDIRECT) after a couple collapse', () => {
    const merged = ok(finalDel(fixture(withDadDuplicate), [merge('pdad', 'pdad2')]));
    assert.equal(merged.data.unions.udup.removed?.mergedInto, 'uparents');
    const r = ok(preview(merged.data, [{ op: 'edit-union', union: 'udup', set: { 'note.ar': 'تزوجا مرة ثانية' } }]));
    assert.equal(r.data.unions.uparents.note.ar, 'تزوجا مرة ثانية');
    const w = warns(r, 'MERGED_REDIRECT', 0);
    assert.deepEqual({ from: w.params.from, to: w.params.to }, { from: 'udup', to: 'uparents' });
  });

  test('§3.2 a soft-removed union without mergedInto → TARGET_REMOVED (edit-union, child link, move target)', () => {
    const unlinked = ok(finalDel(fixture(), [{ op: 'unlink-spouse', union: 'uson', reasonCode: 'entered-by-mistake' }]));
    const d = unlinked.data;
    fails(preview(d, [{ op: 'edit-union', union: 'uson', set: { status: 'divorced' } }]), 'TARGET_REMOVED', 0);
    fails(preview(d, [add('new1', M('زيد'), { as: 'child', union: 'uson' })]), 'TARGET_REMOVED', 0);
    fails(preview(d, [move('pkid', { union: 'uson' })]), 'TARGET_REMOVED', 0);
  });

  test('§3.3 destructive ops on a temp union ref → TEMP_NOT_ALLOWED', () => {
    fails(preview(fixture(), [
      add('new1', M('ريم', 'f'), { as: 'spouse', of: 'plone' }, { unionRef: 'newu2' }),
      { op: 'unlink-spouse', union: 'newu2', reasonCode: 'entered-by-mistake' },
    ]), 'TEMP_NOT_ALLOWED', 1);
  });

  test('§2.1 privacy "year" with a full Hijri birth date stores only years (Hijri and Gregorian)', () => {
    const r = ok(final(fixture(), [add('new1', {
      name: { ar: 'ريم' }, gender: 'f', privacy: 'year', birth: { hijri: '1410-10-17' },
    }, { as: 'child', of: 'pson', with: 'pdil' })]));
    const b = r.data.people[r.idMap.new1].birth;
    assert.equal(b.hijri, '1410');
    assert.match(b.date, /^\d{4}$/);
    const text = serializeData(r.data);
    assert.ok(!text.includes('1410-10') && !text.includes('1990-05'), 'no month/day stored');
  });

  test('§2.1 a death date in add-person makes the person deceased', () => {
    const r = ok(preview(fixture(), [add('new1', { name: { ar: 'عبد الله' }, gender: 'm', death: { date: '2000' } })]));
    assert.equal(r.data.people.new1.deceased, true);
    assert.equal(r.data.people.new1.death.date, '2000');
  });

  test('§3.3 MINOR_DETAIL also covers a minor\'s birth place', () => {
    warns(ok(preview(fixture(), [add('new1', M('ريم', 'f', { birth: { date: '2016', place: { ar: 'الرياض' } }, privacy: 'year' }), { as: 'child', of: 'pson', with: 'pdil' })])), 'MINOR_DETAIL', 0);
  });

  test('§3.3 POSSIBLE_DUPLICATE only considers ACTIVE people', () => {
    const d = fixture((raw) => {
      raw.people.pzaid = P('pzaid', 'زيد', 'm', '1986', { privacy: 'year', removed: REMOVED() });
      raw.unions.uparents.children.push('pzaid');
    });
    noWarn(ok(preview(d, [add('new1', M('زيد'), { as: 'child', of: 'pdad', with: 'pmom' })])), 'POSSIBLE_DUPLICATE');
  });
});

// =========================================================================================================
// The real family data

describe('§8 real data', () => {
  const real = () => normalizeData(JSON.parse(readFileSync(new URL('../data/family.json', import.meta.url), 'utf8')));

  test('§3.5 final add-person on the real data: well-formed ids, strict validateData, serializable', () => {
    const d = real();
    const couple = active(d).find((u) => u.partners.length === 2);
    const r = ok(final(d, [add('new1', M('ريم', 'f', { birth: { date: '2001' }, privacy: 'year' }), { as: 'child', of: couple.partners[0], with: couple.partners[1] })], {}, { baseRevision: d.meta.revision }));
    assert.match(r.idMap.new1, FINAL_PID);
    assert.ok(r.data.unions[couple.id].children.includes(r.idMap.new1));
    assert.equal(r.data.meta.revision, d.meta.revision + 1);
    const v = validateData(r.data);
    assert.ok(v.ok, JSON.stringify(v.errors));
    assert.deepEqual(normalizeData(JSON.parse(serializeData(r.data))), normalizeData(r.data));
  });

  test('§3.4/§3.5 a wizard-sized draft (self, spouse, 5 children) previews on the real data and passes validateData(allowTempIds)', () => {
    const d = real();
    const couple = active(d).find((u) => u.partners.length === 2);
    const kids = ['سعيد', 'ريم', 'زيد', 'هند', 'عمر'];
    const ops = [
      add('new1', M('خالد'), { as: 'child', of: couple.partners[0], with: couple.partners[1] }),
      add('new2', M('سارة', 'f'), { as: 'spouse', of: 'new1' }, { unionRef: 'newu3' }),
      // Each op gets a fresh unionRef, as the site's per-browser counter does; every one binds to the FOUND union.
      ...kids.map((ar, i) => add(`new${i + 4}`, M(ar, i % 2 ? 'f' : 'm'), { as: 'child', of: 'new1', with: 'new2' }, { unionRef: `newu${i + 10}` })),
      { op: 'reorder-children', union: 'newu3', order: ['new8', 'new4'] },
    ];
    const r = ok(preview(d, ops));
    assert.deepEqual(r.data.unions.newu3.children, ['new8', 'new4', 'new5', 'new6', 'new7']);
    const v = validateData(r.data, { allowTempIds: true });
    assert.ok(v.ok, JSON.stringify(v.errors));
    const f = ok(final(d, ops));
    assert.ok(validateData(f.data).ok);
    assert.equal(f.data.unions[f.idMap.newu3].children.length, 5);
  });

  test('§3.4 sibling "same father only" on the real polygamous father adds no child to any of his marriages', () => {
    const d = real();
    const g = buildGraph(d);
    const father = g.people().find((p) => p.gender === 'm' && active(d).filter((u) => u.partners.length === 2 && u.partners.includes(p.id) && u.children.length).length >= 2);
    assert.ok(father, 'the real data has a man with children from two wives');
    const child = g.children(father.id)[0];
    const before = Object.fromEntries(active(d).filter((u) => u.partners.includes(father.id)).map((u) => [u.id, [...u.children]]));
    const r = ok(preview(d, [add('new1', M('سعيد'), { as: 'sibling', of: child.id, share: 'father' })]));
    for (const u of active(d).filter((x) => x.partners.length === 2 && x.partners.includes(father.id))) {
      assert.deepEqual(r.data.unions[u.id].children, before[u.id], `marriage ${u.id} unchanged`);
    }
    assert.equal(buildGraph(r.data).father('new1')?.id, father.id);
  });
});
