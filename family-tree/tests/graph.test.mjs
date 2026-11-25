// Tests for js/core/graph.js — relations, siblings, ties, ancestry, branches, stats, search, duplicates.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildGraph } from '../js/core/graph.js';
import { lineageName, displayName } from '../js/core/names.js';

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

const REAL_PATH = fileURLToPath(new URL('../data/family.json', import.meta.url));
const realCompact = () => JSON.parse(readFileSync(REAL_PATH, 'utf8'));
const realData = () => fullData(realCompact());
const ids = (list) => list.map((p) => p.id);

// ---------------------------------------------------------------------------------------------------------
// A polygamous family:
//   pf أحمد (m)  ×  pw1 سارة (f)  → pa1 (m, 1960), pa2 (f, ?), pa3 (m, 1950)       [ua]
//   pf           ×  pw2 ليلى (f)  → pb1 (f, 1955)                                   [ub]
//   pw2          ×  ph2 خالد (m)  → pc1 (m)                                         [uc]  (ليلى's other husband)
//   pf alone (mother unknown)     → pd1 (m)                                         [ud]
//   pa1          ×  pin نورة (f, married in, has her own parents pip1/pip2)  → pg1  [ug]
//   pip1 × pip2 → pin                                                               [uin]
function polygamy() {
  const b = builder();
  b.P('pf', 'أحمد', 'Ahmed', 'm', { surname: { ar: 'الحربي', en: 'Al-Harbi' } });
  b.P('pw1', 'سارة', 'Sarah', 'f');
  b.P('pw2', 'ليلى', 'Layla', 'f');
  b.P('ph2', 'خالد', 'Khalid', 'm');
  b.P('pa1', 'محمد', 'Mohammed', 'm', { birth: { date: '1960' } });
  b.P('pa2', 'فاطمة', 'Fatima', 'f');
  b.P('pa3', 'علي', 'Ali', 'm', { birth: { date: '1950-04-02' } });
  b.P('pb1', 'هند', 'Hind', 'f', { birth: { date: '1955' } });
  b.P('pc1', 'سعد', 'Saad', 'm');
  b.P('pd1', 'يوسف', 'Yousef', 'm');
  b.P('pin', 'نورة', 'Noura', 'f');
  b.P('pip1', 'صالح', 'Saleh', 'm');
  b.P('pip2', 'منى', 'Mona', 'f');
  b.P('pg1', 'عمر', 'Omar', 'm');
  b.U('ua', ['pf', 'pw1'], ['pa1', 'pa2', 'pa3']);
  b.U('ub', ['pf', 'pw2'], ['pb1']);
  b.U('uc', ['pw2', 'ph2'], ['pc1']);
  b.U('ud', ['pf'], ['pd1']);
  b.U('ug', ['pa1', 'pin'], ['pg1']);
  b.U('uin', ['pip1', 'pip2'], ['pin']);
  return b;
}

describe('basic relations', () => {
  const g = buildGraph(polygamy().data());

  test('person, union, people, unions', () => {
    assert.equal(g.person('pf').name.ar, 'أحمد');
    assert.equal(g.person('nope'), null);
    assert.equal(g.person(undefined), null);
    assert.equal(g.union('ua').id, 'ua');
    assert.equal(g.people().length, 14);
    assert.equal(g.unions().length, 6);
  });

  test('birthUnion, parents, father and mother', () => {
    assert.equal(g.birthUnion('pa1').id, 'ua');
    assert.equal(g.birthUnion('pf'), null);
    assert.deepEqual(ids(g.parents('pa1')), ['pf', 'pw1']);
    assert.equal(g.father('pa1').id, 'pf');
    assert.equal(g.mother('pa1').id, 'pw1');
    assert.equal(g.mother('pd1'), null);
    assert.deepEqual(g.parents('pf'), []);
  });

  test('father/mother are by gender only', () => {
    const b = builder();
    b.P('px', 'سامي', 'Sami', '');
    b.P('py', 'هدى', 'Huda', 'f');
    b.P('pz', 'رامي', 'Rami', 'm');
    b.U('u1', ['px', 'py'], ['pz']);
    const g2 = buildGraph(b.data());
    assert.equal(g2.father('pz'), null);
    assert.equal(g2.mother('pz').id, 'py');
    assert.deepEqual(ids(g2.parents('pz')), ['py', 'px']);
  });

  test('unionsOf and spouses (single-partner unions are not spouses)', () => {
    assert.deepEqual(g.unionsOf('pf').map((u) => u.id), ['ua', 'ub', 'ud']);
    assert.deepEqual(g.spouses('pf').map((s) => [s.person.id, s.union.id]), [['pw1', 'ua'], ['pw2', 'ub']]);
    assert.deepEqual(g.spouses('pw2').map((s) => s.person.id), ['pf', 'ph2']);
  });

  test('unionsOf order: spouseOrder, then marriage date, then insertion', () => {
    const b = builder();
    b.P('pm', 'زيد', 'Zaid', 'm');
    b.P('px', 'أ', 'A', 'f');
    b.P('py', 'ب', 'B', 'f');
    b.P('pz', 'ج', 'C', 'f');
    b.U('ux', ['pm', 'px']);
    b.U('uy', ['pm', 'py'], [], { marriage: { date: '1990-05' } });
    b.U('uz', ['pm', 'pz'], [], { marriage: { date: '1980' } });
    assert.deepEqual(buildGraph(b.data()).unionsOf('pm').map((u) => u.id), ['uz', 'uy', 'ux']);
    b.people.pm.spouseOrder = ['ux', 'ugone'];
    assert.deepEqual(buildGraph(b.data()).unionsOf('pm').map((u) => u.id), ['ux', 'uz', 'uy']);
  });

  test('childrenOfUnion keeps the stored order; children(id) sorts by birth year when known', () => {
    assert.deepEqual(ids(g.childrenOfUnion('ua')), ['pa1', 'pa2', 'pa3']);
    // pa3 1950, pb1 1955, pa1 1960, pa2 (unknown → stays after pa1, its preceding sibling), pd1 (no dates in ud)
    assert.deepEqual(ids(g.children('pf')), ['pa3', 'pb1', 'pa1', 'pa2', 'pd1']);
    assert.deepEqual(ids(g.children('pw1')), ['pa3', 'pa1', 'pa2']);
  });

  test('children without any birth years: union order then child order', () => {
    const b = builder();
    b.P('pm', 'زيد', 'Zaid', 'm');
    b.P('pw', 'هند', 'Hind', 'f');
    b.P('pv', 'دعاء', 'Doaa', 'f');
    for (const id of ['pk1', 'pk2', 'pk3', 'pk4']) b.P(id, id, id, 'm');
    b.U('u2', ['pm', 'pv'], ['pk3', 'pk4']);
    b.U('u1', ['pm', 'pw'], ['pk2', 'pk1']);
    b.people.pm.spouseOrder = ['u1', 'u2'];
    assert.deepEqual(ids(buildGraph(b.data()).children('pm')), ['pk2', 'pk1', 'pk3', 'pk4']);
  });

  test('returned arrays are copies; the graph is frozen', () => {
    assert.ok(Object.isFrozen(g));
    g.people().pop();
    g.unionsOf('pf').pop();
    assert.equal(g.people().length, 14);
    assert.equal(g.unionsOf('pf').length, 3);
  });
});

describe('siblings', () => {
  const g = buildGraph(polygamy().data());
  const view = (s) => ({ full: ids(s.full), half: s.half.map((h) => `${h.person.id}/${h.via}`), unspecified: ids(s.unspecified) });

  test('full via the 2-partner birth union, half via the other parent, unspecified via a single-parent union', () => {
    assert.deepEqual(view(g.siblings('pa1')), { full: ['pa2', 'pa3'], half: ['pb1/father'], unspecified: ['pd1'] });
  });
  test('half-siblings via father and via mother (polygamy + remarriage)', () => {
    assert.deepEqual(view(g.siblings('pb1')), {
      full: [],
      half: ['pa1/father', 'pa2/father', 'pa3/father', 'pc1/mother'],
      unspecified: ['pd1'],
    });
    assert.deepEqual(view(g.siblings('pc1')), { full: [], half: ['pb1/mother'], unspecified: [] });
  });
  test('a child of a single-parent union: everyone is unspecified', () => {
    assert.deepEqual(view(g.siblings('pd1')), { full: [], half: [], unspecified: ['pa1', 'pa2', 'pa3', 'pb1'] });
  });
  test('parentless union of siblings and no birth union', () => {
    const b = builder();
    b.P('p1', 'أ', 'A', 'm');
    b.P('p2', 'ب', 'B', 'f');
    b.U('u0', [], ['p1', 'p2']);
    const g2 = buildGraph(b.data());
    assert.deepEqual(view(g2.siblings('p1')), { full: [], half: [], unspecified: ['p2'] });
    assert.deepEqual(view(g.siblings('pf')), { full: [], half: [], unspecified: [] });
  });
});

describe('ties and milk siblings', () => {
  const b = polygamy();
  b.P('pt1', 'رضيع', 'Nursling', 'm', { ties: [{ type: 'milk-child-of', person: 'pw1', note: { ar: 'رضاعة', en: '' } }] });
  b.P('pt2', 'رضيعة', 'Nursling2', 'f', { ties: [{ type: 'milk-child-of', person: 'pw1' }] });
  b.P('pk', 'مكفول', 'Ward', 'm', { ties: [{ type: 'foster-child-of', person: 'pf' }] });
  const g = buildGraph(b.data());

  test('ties in both directions', () => {
    assert.deepEqual(g.ties('pt1').map((t) => [t.type, t.person.id, t.direction]), [['milk-child-of', 'pw1', 'to']]);
    assert.equal(g.ties('pt1')[0].note.ar, 'رضاعة');
    assert.deepEqual(g.ties('pw1').map((t) => [t.type, t.person.id, t.direction]), [['milk-child-of', 'pt1', 'from'], ['milk-child-of', 'pt2', 'from']]);
    assert.deepEqual(g.ties('pf').map((t) => [t.type, t.person.id, t.direction]), [['foster-child-of', 'pk', 'from']]);
  });
  test('milk siblings: children and other nurslings of the milk mother; nurslings of one\'s own mother', () => {
    assert.deepEqual(ids(g.milkSiblings('pt1')), ['pa3', 'pa1', 'pa2', 'pt2']);
    assert.deepEqual(ids(g.milkSiblings('pa1')), ['pt1', 'pt2']);
    assert.deepEqual(g.milkSiblings('pk'), []);
  });
  test('ties are never parentage', () => {
    assert.equal(g.ancestors('pt1').size, 0);
    assert.equal(g.descendants('pw1').has('pt1'), false);
    assert.equal(g.isAncestor('pw1', 'pt1'), false);
    assert.equal(g.parents('pk').length, 0);
  });
});

describe('ancestors, descendants, generations', () => {
  const g = buildGraph(polygamy().data());

  test('ancestors: blood only, depth = generations up', () => {
    assert.deepEqual([...g.ancestors('pg1')].sort(), [['pa1', 1], ['pf', 2], ['pin', 1], ['pip1', 2], ['pip2', 2], ['pw1', 2]]);
    assert.equal(g.ancestors('pf').size, 0);
  });
  test('descendants: through unions where the person is a partner (no step-children)', () => {
    assert.deepEqual([...g.descendants('pf')].sort(), [['pa1', 1], ['pa2', 1], ['pa3', 1], ['pb1', 1], ['pd1', 1], ['pg1', 2]]);
    assert.deepEqual([...g.descendants('pw2')].sort(), [['pb1', 1], ['pc1', 1]]);
    assert.equal(g.descendants('ph2').has('pb1'), false);
  });
  test('cousin marriage: shortest depth wins', () => {
    const b = builder();
    b.P('pg', 'جد', 'G', 'm');
    b.P('ps1', 'ابن1', 'S1', 'm');
    b.P('ps2', 'ابنة2', 'S2', 'f');
    b.P('pc1', 'حفيد', 'C1', 'm');
    b.P('pc2', 'حفيدة', 'C2', 'f');
    b.P('pgg', 'ابن الحفيد', 'GG', 'm');
    b.U('u1', ['pg'], ['ps1', 'ps2']);
    b.U('u2', ['ps1'], ['pc1']);
    b.U('u3', ['ps2'], ['pc2']);
    b.U('u4', ['pc1', 'pc2'], ['pgg']);
    const g2 = buildGraph(b.data());
    assert.equal(g2.ancestors('pgg').get('pg'), 3);
    assert.equal(g2.descendants('pg').get('pgg'), 3);
    assert.equal(g2.isAncestor('pg', 'pgg'), true);
  });
  test('isAncestor', () => {
    assert.equal(g.isAncestor('pf', 'pg1'), true);
    assert.equal(g.isAncestor('pip2', 'pg1'), true);
    assert.equal(g.isAncestor('pg1', 'pf'), false);
    assert.equal(g.isAncestor('pw2', 'pg1'), false);
    assert.equal(g.isAncestor('pf', 'pf'), false);
  });
  test('generationDepth = generations from the person down (1 = no children)', () => {
    assert.equal(g.generationDepth('pf'), 3);
    assert.equal(g.generationDepth('pa1'), 2);
    assert.equal(g.generationDepth('pg1'), 1);
    assert.equal(g.generationDepth('nope'), 0);
  });
  test('cycle-safe on invalid data', () => {
    const b = builder();
    b.P('pa', 'أ', 'A', 'm');
    b.P('pb', 'ب', 'B', 'm');
    b.U('u1', ['pa'], ['pb']);
    b.U('u2', ['pb'], ['pa']);
    const g2 = buildGraph(b.data());
    assert.deepEqual([...g2.ancestors('pa')].sort(), [['pb', 1]]);
    assert.ok(g2.generationDepth('pa') >= 1);
    assert.equal(g2.isAncestor('pa', 'pb'), true);
  });
});

describe('removed people and unions', () => {
  const b = polygamy();
  b.P('pdup', 'محمد', 'Mohammed', 'm', { removed: { at: 'x', reasonCode: 'duplicate', mergedInto: 'pa1' } });
  b.P('pdup2', 'محمد', 'Mohammed', 'm', { removed: { at: 'x', reasonCode: 'duplicate', mergedInto: 'pdup' } });
  b.P('pgone', 'ضائع', 'Gone', 'm', { removed: { at: 'x', reasonCode: 'entered-by-mistake' } });
  b.unions.ua.children.push('pgone');
  b.P('pex', 'سلمى', 'Salma', 'f');
  b.U('uold', ['pf', 'pex'], [], { removed: { at: 'x', reasonCode: 'entered-by-mistake' } });
  const g = buildGraph(b.data());

  test('invisible by default', () => {
    assert.equal(g.person('pgone'), null);
    assert.equal(g.people().some((p) => p.id === 'pgone'), false);
    assert.deepEqual(ids(g.childrenOfUnion('ua')), ['pa1', 'pa2', 'pa3']);
    assert.equal(g.union('uold'), null);
    assert.deepEqual(g.unionsOf('pf').map((u) => u.id), ['ua', 'ub', 'ud']);
    assert.equal(g.spouses('pex').length, 0);
    assert.deepEqual(g.search('ضائع'), []);
  });
  test('listed by removedPeople / removedUnions', () => {
    assert.deepEqual(ids(g.removedPeople()), ['pdup', 'pdup2', 'pgone']);
    assert.deepEqual(g.removedUnions().map((u) => u.id), ['uold']);
  });
  test('resolve follows mergedInto (transitively); removed without merge → null', () => {
    assert.equal(g.resolve('pdup').id, 'pa1');
    assert.equal(g.resolve('pdup2').id, 'pa1');
    assert.equal(g.resolve('pa2').id, 'pa2');
    assert.equal(g.resolve('pgone'), null);
    assert.equal(g.resolve('nope'), null);
  });
  test('includeRemoved shows everything', () => {
    const all = buildGraph(b.data(), { includeRemoved: true });
    assert.equal(all.person('pgone').id, 'pgone');
    assert.deepEqual(ids(all.childrenOfUnion('ua')), ['pa1', 'pa2', 'pa3', 'pgone']);
    assert.deepEqual(all.unionsOf('pf').map((u) => u.id), ['ua', 'ub', 'ud', 'uold']);
    assert.equal(all.resolve('pgone').id, 'pgone');
    assert.equal(all.people().length, g.people().length + 3);
  });
});

describe('branches', () => {
  test('parentless couple → one branch represented by the man, labelled "X & Y"; married-in spouses are not branches', () => {
    const b = polygamy();
    delete b.people.pw2; // keep it simple: ub and uc lose a partner
    b.unions.ub.partners = ['pf'];
    delete b.unions.uc;
    delete b.unions.ud;
    b.unions.ub.children = ['pb1'];
    // pw1 listed first in the union: the man still represents it
    b.unions.ua.partners = ['pw1', 'pf'];
    const g = buildGraph(b.data());
    const br = g.branches();
    // pip1 × pip2 (Noura's parents) is a second parentless couple with descendants
    assert.equal(br.length, 2);
    assert.equal(br[0].person.id, 'pf');
    assert.equal(br[0].partner.id, 'pw1');
    assert.deepEqual(br[0].label, { ar: 'أحمد الحربي وسارة', en: 'Ahmed Al-Harbi & Sarah' });
    assert.equal(br[0].count, 6); // pa1 pa2 pa3 pb1 pg1 pc… (pb1 via ub) + pg1
    assert.equal(br[1].person.id, 'pip1');
    assert.equal(br[1].partner.id, 'pip2');
    // Noura married in: her parents' branch is listed, she is not.
    assert.ok(!br.some((x) => x.person.id === 'pin' || x.partner?.id === 'pin'));
  });

  test('a single parentless ancestor; a woman-only couple uses partners[0]', () => {
    const b = builder();
    b.P('pa', 'سالم', 'Salem', 'm');
    b.P('pk', 'حسن', 'Hassan', 'm');
    b.U('u1', ['pa'], ['pk']);
    b.P('px', 'هند', 'Hind', 'f');
    b.P('py', 'دانة', 'Dana', '');
    b.P('pz', 'لين', 'Leen', 'f');
    b.U('u2', ['px', 'py'], ['pz']);
    const br = buildGraph(b.data()).branches();
    assert.deepEqual(br.map((x) => [x.person.id, x.partner?.id ?? null, x.count]), [['pa', null, 1], ['px', 'py', 1]]);
    assert.deepEqual(br[0].label, { ar: 'سالم', en: 'Salem' });
  });

  test('polygamy and a wife\'s other husband form ONE branch, represented by the man with most marriages', () => {
    const g = buildGraph(polygamy().data());
    const br = g.branches();
    assert.equal(br.length, 2);
    assert.equal(br[0].person.id, 'pf');
    assert.equal(br[0].partner, null);
    assert.equal(br[0].count, 7); // pa1 pa2 pa3 pb1 pd1 pg1 + pc1 (ليلى's son with خالد)
    assert.deepEqual(br[0].label, { ar: 'أحمد الحربي', en: 'Ahmed Al-Harbi' });
  });

  test('the branch holding meta.rootPersonId comes first', () => {
    const b = builder();
    b.P('pa', 'سالم', 'Salem', 'm');
    b.P('pk', 'حسن', 'Hassan', 'm');
    b.U('u1', ['pa'], ['pk']);
    b.P('pb', 'زيد', 'Zaid', 'm');
    b.P('pc1', 'ع', 'A', 'm');
    b.P('pc2', 'غ', 'B', 'm');
    b.U('u2', ['pb'], ['pc1', 'pc2']);
    assert.equal(buildGraph(b.data()).branches()[0].person.id, 'pb');
    assert.equal(buildGraph(b.data({ rootPersonId: 'pk' })).branches()[0].person.id, 'pa');
  });
});

describe('stats', () => {
  test('counts', () => {
    const b = polygamy();
    b.people.pf.deceased = true;
    b.P('pgone', 'ضائع', 'Gone', 'm', { removed: { at: 'x', reasonCode: 'other' } });
    const s = buildGraph(b.data()).stats();
    assert.deepEqual(s, { people: 14, living: 13, deceased: 1, unions: 6, generations: 3, branches: 2 });
  });
  test('empty data', () => {
    assert.deepEqual(buildGraph({ schema: 1, meta: {}, people: {}, unions: {} }).stats(),
      { people: 0, living: 0, deceased: 0, unions: 0, generations: 0, branches: 0 });
    assert.equal(buildGraph(null).people().length, 0);
  });
});

describe('search', () => {
  const b = builder();
  b.P('psalem', 'سالم', 'Salem', 'm', { surname: { ar: 'عالم', en: 'Alem' } });
  b.P('pahmed', 'أحمد', 'Ahmed', 'm');
  b.P('pmoh', 'محمد', 'Mohammed', 'm');
  b.P('pmoh2', 'محمد', 'Mohammed', 'm');
  b.P('pmahmoud', 'محمود', 'Mahmoud', 'm');
  b.P('pfaiza', 'فايزة', 'Faiza', 'f', { nickname: { ar: 'فوفو', en: 'Fofo' } });
  b.P('pabd', 'عبد الرحمن', 'Abdulrahman', 'm', { surname: { ar: 'الحربي', en: 'Al-Harbi' } });
  b.P('pali', 'علي', '', 'm');
  b.P('pemad', 'عماد الدين', 'Emad Al-Din', 'm');
  b.U('u1', ['psalem'], ['pahmed']);
  b.U('u2', ['pahmed'], ['pmoh', 'pfaiza', 'pali']);
  b.U('u3', ['pmahmoud'], ['pmoh2']);
  const g = buildGraph(b.data());
  const top = (q, n = 1) => ids(g.search(q).slice(0, n).map((r) => r.person));

  test('exact > normalized > skeleton', () => {
    const r = g.search('محمد');
    assert.deepEqual(ids(r.slice(0, 2).map((x) => x.person)).sort(), ['pmoh', 'pmoh2']);
    const s = Object.fromEntries(r.map((x) => [x.person.id, x.score]));
    assert.ok(s.pmoh > s.pmahmoud, 'محمد before محمود (skeleton)');
    assert.ok(g.search('فايزة')[0].score > g.search('فايزه')[0].score, 'exact beats normalized');
    assert.ok(g.search('فايزه')[0].score > g.search('Fayza')[0].score, 'normalized beats skeleton');
  });
  test('Arabic, English, Arabizi and transliterations', () => {
    assert.deepEqual(top('Faiza'), ['pfaiza']);
    assert.deepEqual(top('فايزه'), ['pfaiza']);
    assert.deepEqual(top('FAIZA'), ['pfaiza']);
    assert.deepEqual(top('Mohamed', 2).sort(), ['pmoh', 'pmoh2']);
    assert.deepEqual(top('Muhammad', 2).sort(), ['pmoh', 'pmoh2']);
    assert.deepEqual(top('abdulrahman'), ['pabd']);
    assert.deepEqual(top('عبدالرحمن'), ['pabd']);
    assert.deepEqual(top('Abdul Rahman'), ['pabd']);
    assert.deepEqual(top('3li'), ['pali']);
    assert.deepEqual(top('Ali'), ['pali']);
    assert.deepEqual(top('emad aldin'), ['pemad']);
  });
  test('nickname, surname and inherited surname', () => {
    assert.deepEqual(top('فوفو'), ['pfaiza']);
    assert.deepEqual(top('alharbi'), ['pabd']);
    assert.deepEqual(top('الحربي'), ['pabd']);
    const alem = g.search('عالم');
    assert.equal(alem[0].person.id, 'psalem'); // own surname first
    assert.ok(ids(alem.map((r) => r.person)).includes('pmoh')); // inherited through the paternal line
    assert.deepEqual(top('عبد الرحمن الحربي'), ['pabd']);
  });
  test('lineage tokens: "محمد احمد" ≡ "محمد بن أحمد"', () => {
    for (const q of ['محمد احمد', 'محمد أحمد', 'محمد بن أحمد', 'Mohammed Ahmed', 'Mohammed bin Ahmed', 'محمد سالم', 'محمد أحمد عالم', 'Mohamed Ahmed Salem Alem']) {
      assert.deepEqual(top(q), ['pmoh'], q);
    }
    assert.ok(g.search('محمد أحمد')[0].score > g.search('محمد سالم')[0].score, 'a skipped generation ranks lower');
    assert.deepEqual(g.search('محمد خالد'), []);
  });
  test('prefix (search as you type), limit, empty query, id lookup', () => {
    assert.deepEqual(top('فاي'), ['pfaiza']);
    assert.deepEqual(top('Abdulr'), ['pabd']);
    assert.equal(g.search('م', { limit: 2 }).length, 2);
    assert.deepEqual(g.search(''), []);
    assert.deepEqual(g.search('   '), []);
    assert.equal(g.search('pfaiza')[0].person.id, 'pfaiza');
  });
  test('unknown-name people are found by surname', () => {
    const c = builder();
    c.P('pw', '', '', 'f', { nameStatus: 'unknown', surname: { ar: 'داغستاني', en: 'Daghestani' } });
    const g2 = buildGraph(c.data());
    assert.deepEqual(ids(g2.search('Daghestani').map((r) => r.person)), ['pw']);
    assert.deepEqual(ids(g2.search('داغستاني').map((r) => r.person)), ['pw']);
  });
});

describe('duplicatesSuspects', () => {
  test('reasons', () => {
    const b = builder();
    b.P('pf', 'أحمد', 'Ahmed', 'm');
    b.P('pm', 'سارة', 'Sarah', 'f');
    b.P('pm2', 'هند', 'Hind', 'f');
    b.P('pk1', 'محمد', 'Mohammed', 'm');
    b.P('pk2', 'محمّد', '', 'm'); // same parents, tashkeel only
    b.P('pk3', 'محمد', 'Mohamed', 'm'); // same father, other mother
    b.P('pk4', 'محمد', 'Mohammed', 'f'); // different gender → never a pair
    b.U('u1', ['pf', 'pm'], ['pk1', 'pk2', 'pk4']);
    b.U('u2', ['pf', 'pm2'], ['pk3']);
    // same spouse
    b.P('ph', 'زيد', 'Zaid', 'm');
    b.P('pw1', 'ليلى', 'Layla', 'f');
    b.P('pw2', '', 'Layla', 'f');
    b.U('u3', ['ph', 'pw1']);
    b.U('u4', ['ph', 'pw2']);
    // marked
    b.P('px', 'خالد', 'Khalid', 'm');
    b.P('py', 'خليل', 'Khalil', 'm', { duplicateOf: 'px' });
    // same surname, birth years within 2
    b.P('ps1', 'نورة', 'Noura', 'f', { surname: { ar: 'قنديل', en: 'Qandil' }, birth: { date: '1950' } });
    b.P('ps2', 'نوره', '', 'f', { surname: { ar: 'قنديل', en: '' }, birth: { date: '1952' } });
    b.P('ps3', 'نورة', 'Noura', 'f', { surname: { ar: 'قنديل', en: 'Qandil' }, birth: { date: '1990' } });
    const res = buildGraph(b.data()).duplicatesSuspects().map(([a, c, r]) => `${a.id}~${c.id}:${r}`);
    assert.deepEqual(res.sort(), [
      'pk1~pk2:same-parents',
      'pk1~pk3:same-father',
      'pk2~pk3:same-father',
      'ps1~ps2:same-surname-year',
      'pw1~pw2:same-spouse',
      'px~py:marked',
    ].sort());
  });
  test('same lineage in two places of the tree', () => {
    const b = builder();
    b.P('pg1', 'حسن', 'Hassan', 'm');
    b.P('pf1', 'أحمد', 'Ahmed', 'm');
    b.P('pc1', 'محمد', 'Mohammed', 'm');
    b.U('u1', ['pg1'], ['pf1']);
    b.U('u2', ['pf1'], ['pc1']);
    b.P('pg2', 'حسن', 'Hassan', 'm');
    b.P('pf2', 'احمد', 'Ahmed', 'm');
    b.P('pc2', 'محمد', 'Mohammed', 'm');
    b.U('u3', ['pg2'], ['pf2']);
    b.U('u4', ['pf2'], ['pc2']);
    const res = buildGraph(b.data()).duplicatesSuspects().map(([a, c, r]) => `${a.id}~${c.id}:${r}`);
    assert.deepEqual(res, ['pc1~pc2:same-lineage']);
  });
});

describe('recentlyAdded', () => {
  test('by creation history, newest first', () => {
    const b = builder();
    b.P('p1', 'أ', 'A', 'm', { history: [{ issue: null, rev: 1, at: '2026-01-01T00:00:00Z', action: 'import' }] });
    b.P('p2', 'ب', 'B', 'm', { history: [{ issue: 3, rev: 4, at: '2026-03-01T00:00:00Z', action: 'add-person' }] });
    b.P('p3', 'ج', 'C', 'm', { history: [{ issue: 2, rev: 2, at: '2026-02-01T00:00:00Z', action: 'add-person' }, { issue: 9, rev: 9, at: '2026-09-01T00:00:00Z', action: 'edit-person' }] });
    b.P('p4', 'د', 'D', 'm');
    const g = buildGraph(b.data());
    assert.deepEqual(ids(g.recentlyAdded(3)), ['p2', 'p3', 'p1']);
    assert.deepEqual(ids(g.recentlyAdded()), ['p2', 'p3', 'p1', 'p4']);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The real family data (data/family.json, 193 people).

describe('real data', () => {
  const g = buildGraph(realData());
  const byName = (ar, pred = () => true) => g.people().filter((p) => p.name.ar === ar && pred(p));
  const head2 = byName('محمد علي', (p) => p.surname.ar === 'محمود')[0];
  const salem = byName('سالم', (p) => !g.parents(p.id).length)[0];
  const faiza = byName('فايزة')[0];
  const hussein = byName('حسين', (p) => g.father(p.id)?.id === head2.id)[0];
  const ali = byName('علي', (p) => g.spouses(p.id).some((s) => s.person.id === faiza.id))[0];

  test('loads and also works on the compact stored form', () => {
    assert.equal(g.people().length, 193);
    const compact = buildGraph(realCompact());
    assert.equal(compact.people().length, 193);
    assert.deepEqual(compact.stats(), g.stats());
    assert.deepEqual(compact.branches().map((x) => x.person.id), g.branches().map((x) => x.person.id));
    assert.equal(compact.search('Faiza')[0].person.id, faiza.id);
    assert.equal(lineageName(compact, faiza.id, 'ar'), 'فايزة محمد علي محمود');
  });

  test('exactly two branches, represented by سالم and محمد علي (not by wives who married in)', () => {
    const br = g.branches();
    assert.equal(br.length, 2);
    assert.deepEqual(br.map((x) => x.person.id), [salem.id, head2.id]);
    for (const x of br) assert.equal(x.person.gender, 'm');
    assert.deepEqual(br[0].label, { ar: 'سالم عالم', en: 'Salem Alem' });
    assert.deepEqual(br[1].label, { ar: 'محمد علي محمود', en: 'Mohammed Ali Mahmoud' });
    assert.ok(br.every((x) => x.count > 40));
  });

  test('stats', () => {
    const s = g.stats();
    assert.equal(s.people, 193);
    assert.equal(s.unions, 60);
    assert.equal(s.branches, 2);
    assert.equal(s.living + s.deceased, 193);
    assert.ok(s.generations >= 5);
  });

  test('search finds فايزة from "Faiza" and "فايزه"', () => {
    assert.equal(g.search('Faiza')[0].person.id, faiza.id);
    assert.equal(g.search('فايزه')[0].person.id, faiza.id);
    assert.equal(g.search('فايزة محمد علي')[0].person.id, faiza.id);
    assert.equal(g.search('faiza bint mohammed ali mahmoud')[0].person.id, faiza.id);
  });

  test('search by lineage, transliteration and surname', () => {
    const r = g.search('محمد احمد');
    assert.equal(lineageName(g, r[0].person.id, 'ar'), 'محمد أحمد محمد عالم');
    assert.ok(g.search('Mohamed').slice(0, 5).every((x) => x.person.name.ar === 'محمد'));
    assert.equal(g.search('abdulrahman')[0].person.name.ar, 'عبدالرحمن');
    assert.equal(g.search('عبد الرحمن')[0].person.name.ar, 'عبدالرحمن');
    assert.equal(g.search('قنديل')[0].person.name.ar, 'إحسان');
    assert.equal(g.search('Bibi')[0].person.nickname.ar, 'بيبي');
  });

  test('children of علي and فايزة descend from both families', () => {
    const kids = g.children(ali.id);
    assert.equal(kids.length, 6);
    assert.deepEqual(kids.map((k) => k.name.ar), ['حسن', 'حسين', 'عصام', 'عادل', 'عماد الدين', 'عواطف']);
    for (const k of kids) {
      const anc = g.ancestors(k.id);
      assert.equal(anc.get(ali.id), 1);
      assert.equal(anc.get(faiza.id), 1);
      assert.equal(anc.get(salem.id), 4);
      assert.equal(anc.get(head2.id), 2);
      assert.ok(g.isAncestor(salem.id, k.id) && g.isAncestor(head2.id, k.id));
    }
    assert.ok(g.descendants(head2.id).has(kids[0].id));
    assert.ok(g.descendants(salem.id).has(kids[0].id));
  });

  test('Hussein (Daghestani wife) and Faiza (Ihsan) are half-siblings via their father', () => {
    const hs = g.siblings(hussein.id);
    assert.deepEqual(hs.full, []);
    assert.ok(hs.half.some((h) => h.person.id === faiza.id && h.via === 'father'));
    const fs = g.siblings(faiza.id);
    assert.ok(fs.half.some((h) => h.person.id === hussein.id && h.via === 'father'));
    // Ihsan's children with السعيد الشربيني are Faiza's half-siblings via her mother
    const viaMother = fs.half.filter((h) => h.via === 'mother').map((h) => h.person.name.ar);
    assert.deepEqual(viaMother, ['إسماعيل', 'حميدة', 'سميرة', 'السيد', 'سلوى']);
    // إبراهيم's mother is not recorded → not claimed as a half-brother
    assert.ok(hs.unspecified.some((p) => p.name.ar === 'إبراهيم'));
    assert.equal(g.father(hussein.id).id, head2.id);
    assert.equal(displayName(g.mother(hussein.id), 'ar', g), 'زوجة محمد علي محمود (داغستاني)');
  });

  test('head of family 2: unions follow spouseOrder', () => {
    assert.deepEqual(g.unionsOf(head2.id).map((u) => u.id), head2.spouseOrder);
    assert.equal(g.spouses(head2.id).length, 5);
    assert.equal(g.children(head2.id).length, 11);
  });

  test('duplicatesSuspects and recentlyAdded run on the real data', () => {
    const d = g.duplicatesSuspects();
    assert.ok(Array.isArray(d));
    for (const [a, b, reason] of d) assert.ok(a.id && b.id && typeof reason === 'string');
    assert.equal(g.recentlyAdded(5).length, 5);
  });
});

describe('performance', () => {
  test('5,000 people: build, search, branches, stats, siblings stay fast', () => {
    const b = builder();
    const names = [['محمد', 'Mohammed'], ['أحمد', 'Ahmed'], ['فاطمة', 'Fatima'], ['علي', 'Ali'], ['خديجة', 'Khadija'], ['حسن', 'Hassan'], ['مريم', 'Maryam'], ['عبد الله', 'Abdullah']];
    let n = 0;
    const person = (gender) => {
      const [ar, en] = names[n % names.length];
      const id = `p${(n++).toString(36).padStart(5, '0')}`;
      b.P(id, ar, en, gender, { birth: { date: String(1900 + (n % 100)) } });
      return id;
    };
    // a wide tree: each couple has 4 children, married-in spouses, until 5,000 people
    let frontier = [person('m')];
    let u = 0;
    while (n < 5000 && frontier.length) {
      const next = [];
      for (const p of frontier) {
        if (n >= 5000) break;
        const spouse = person(b.people[p].gender === 'm' ? 'f' : 'm');
        const kids = [];
        for (let i = 0; i < 4 && n < 5000; i++) kids.push(person(i % 2 ? 'f' : 'm'));
        b.U(`u${(u++).toString(36).padStart(5, '0')}`, [p, spouse], kids);
        next.push(...kids);
      }
      frontier = next;
    }
    const t0 = performance.now();
    const g = buildGraph(b.data());
    const s = g.stats();
    const r1 = g.search('Mohamed');
    const r2 = g.search('محمد احمد');
    g.search('فاط');
    const someone = g.people()[4000].id;
    g.siblings(someone);
    g.ancestors(someone);
    g.descendants(g.people()[0].id);
    g.duplicatesSuspects();
    for (const p of g.people().slice(0, 200)) lineageName(g, p.id, 'ar');
    const ms = performance.now() - t0;
    assert.equal(s.people, 5000);
    assert.equal(s.branches, 1);
    assert.ok(r1.length === 30 && r2.length > 0);
    assert.ok(ms < 4000, `took ${ms.toFixed(0)} ms`);
  });
});
