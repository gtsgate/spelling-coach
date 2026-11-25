// Tests for js/core/kinship.js — findRelationship, relationLabel (Arabic + English), pathSteps.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizeData } from '../js/core/schema.js';
import { buildGraph } from '../js/core/graph.js';
import { findRelationship, relationLabel, relationship, pathSteps } from '../js/core/kinship.js';

// ---------------------------------------------------------------------------------------------------------
// Fixture: a small synthetic family covering every relation kind.
//
//   سالم(gf)+مريم(gm, deceased)        يوسف(mgf)+زينب(mgm)
//     ├─ أحمد(father) ─┬─ +فاطمة(mother) ─ علي(me), نور(sister)          [union uFM]
//     │                └─ +ليلى(w2) ─ سعد (half-brother via father)       [union uFW]
//     ├─ خالد(uncle)+سعاد ─ ماجد ─ باسل                                    (cousins)
//     └─ هند(aunt)+جمال ─ x1 (gender unknown)
//   فاطمة(mother) earlier +طارق (divorced) ─ ريم (half-sister via mother)
//   يوسف+زينب ─ فاطمة, عمر (maternal uncle), سلمى (maternal aunt)
//   علي(me)+هالة ─ زياد+دانة ; هالة's parents حسين+عائشة, brother وليد
//   نور+كمال ─ آدم
//   علي milk-child-of أمينة ; أمينة+منصور ─ رنا (milk sister) ; يتيم foster-child-of كفيل
//   غريب: unrelated

const P = (id, ar, gender, extra = {}) => ({ id, name: { ar }, gender, ...extra });
const U = (id, partners, children = [], extra = {}) => ({ id, partners, children, status: partners.length === 2 ? 'married' : 'unknown', ...extra });

function fixture() {
  const people = [
    P('pgf', 'سالم', 'm'), P('pgm', 'مريم', 'f', { deceased: true }),
    P('pmgf', 'يوسف', 'm'), P('pmgm', 'زينب', 'f'),
    P('pfa', 'أحمد', 'm'), P('pmo', 'فاطمة', 'f'), P('pw2', 'ليلى', 'f'),
    P('pme', 'علي', 'm', { ties: [{ type: 'milk-child-of', person: 'pamina' }] }),
    P('psis', 'نور', 'f'), P('phb', 'سعد', 'm'),
    P('ph1', 'طارق', 'm'), P('phs', 'ريم', 'f'),
    P('puncle', 'خالد', 'm'), P('puw', 'سعاد', 'f'), P('pcous', 'ماجد', 'm'), P('pcson', 'باسل', 'm'),
    P('paunt', 'هند', 'f'), P('pauh', 'جمال', 'm'), P('px1', 'سامر', ''),
    P('pmu', 'عمر', 'm'), P('pma', 'سلمى', 'f'),
    P('pwife', 'هالة', 'f'), P('pwf', 'حسين', 'm'), P('pwm', 'عائشة', 'f'), P('pwb', 'وليد', 'm'),
    P('pson', 'زياد', 'm'), P('psonw', 'دانة', 'f'),
    P('psish', 'كمال', 'm'), P('pneph', 'آدم', 'm'),
    P('pamina', 'أمينة', 'f'), P('pmans', 'منصور', 'm'), P('prana', 'رنا', 'f'),
    P('pkafil', 'كفيل', 'm'), P('pyatim', 'يتيم', 'm', { ties: [{ type: 'foster-child-of', person: 'pkafil' }] }),
    P('pstr', 'غريب', 'm'),
  ];
  const unions = [
    U('ugp', ['pgf', 'pgm'], ['pfa', 'puncle', 'paunt']),
    U('ump', ['pmgf', 'pmgm'], ['pmo', 'pmu', 'pma']),
    U('ufm', ['pfa', 'pmo'], ['pme', 'psis']),
    U('ufw', ['pfa', 'pw2'], ['phb']),
    U('uold', ['ph1', 'pmo'], ['phs'], { status: 'divorced' }),
    U('uun', ['puncle', 'puw'], ['pcous']),
    U('ucs', ['pcous'], ['pcson']),
    U('uau', ['paunt', 'pauh'], ['px1']),
    U('ume', ['pme', 'pwife'], ['pson']),
    U('uwp', ['pwf', 'pwm'], ['pwife', 'pwb']),
    U('uson', ['pson', 'psonw']),
    U('usis', ['psis', 'psish'], ['pneph']),
    U('uam', ['pamina', 'pmans'], ['prana']),
  ];
  return normalizeData({
    schema: 1,
    meta: { rootPersonId: 'pgf', revision: 1 },
    people: Object.fromEntries(people.map((p) => [p.id, p])),
    unions: Object.fromEntries(unions.map((u) => [u.id, u])),
  });
}

const g = buildGraph(fixture());

/** [ar (you), ar (name), en (you), en (name)] labels of "what is b to a". */
function labels(graph, a, b, opts = {}) {
  const rel = findRelationship(graph, a, b);
  return [
    relationLabel(rel, graph, 'ar', { ...opts }),
    relationLabel(rel, graph, 'ar', { ...opts, you: false }),
    relationLabel(rel, graph, 'en', { ...opts }),
    relationLabel(rel, graph, 'en', { ...opts, you: false }),
  ];
}

describe('kinship: blood relations (synthetic family)', () => {
  test('parents and children', () => {
    assert.deepEqual(labels(g, 'pme', 'pfa'), ['والدك', 'والد علي', 'your father', "Ali's father"]);
    assert.deepEqual(labels(g, 'pme', 'pmo'), ['والدتك', 'والدة علي', 'your mother', "Ali's mother"]);
    assert.deepEqual(labels(g, 'pfa', 'pme'), ['ابنك', 'ابن أحمد', 'your son', "Ahmed's son"]);
    assert.deepEqual(labels(g, 'pfa', 'psis').slice(0, 3), ['ابنتك', 'ابنة أحمد', 'your daughter']);
    const rel = findRelationship(g, 'pme', 'pfa');
    assert.equal(rel.type, 'blood');
    assert.equal(rel.up, 1);
    assert.equal(rel.down, 0);
    assert.deepEqual(rel.path, ['pme', 'pfa']);
  });

  test('grandparents carry the side (جدّك لأبيك / جدّتك لأمك) and grandchildren', () => {
    assert.deepEqual(labels(g, 'pme', 'pgf'), ['جدّك لأبيك', 'جدّ علي لأبيه', 'your paternal grandfather', "Ali's paternal grandfather"]);
    assert.deepEqual(labels(g, 'pme', 'pmgm'), ['جدّتك لأمك', 'جدّة علي لأمه', 'your maternal grandmother', "Ali's maternal grandmother"]);
    // the pronoun of the qualifier follows a's gender: جدّة نور لأمها
    assert.equal(relationLabel(findRelationship(g, 'psis', 'pmgm'), g, 'ar', { you: false }), 'جدّة نور لأمها');
    assert.deepEqual(labels(g, 'pgf', 'pme').slice(0, 3), ['حفيدك', 'حفيد سالم', 'your grandson']);
    assert.deepEqual(labels(g, 'pmgm', 'psis').slice(0, 3), ['حفيدتك', 'حفيدة زينب', 'your granddaughter']);
    const rel = findRelationship(g, 'pme', 'pgf');
    assert.equal(rel.side, 'paternal');
    assert.equal(findRelationship(g, 'pme', 'pmgf').side, 'maternal');
  });

  test('great-grandparents and great-grandchildren compose chains', () => {
    // باسل → سالم: father ماجد, grandfather خالد, great-grandfather سالم
    assert.deepEqual(labels(g, 'pcson', 'pgf').slice(0, 3), ['جدّ والدك', 'جدّ والد باسل', 'your paternal great-grandfather']);
    assert.deepEqual(labels(g, 'pgf', 'pcson').slice(0, 3), ['حفيد ابنك', 'حفيد ابن سالم', 'your great-grandson']);
  });

  test('siblings: full (شقيق), half via father / mother', () => {
    assert.deepEqual(labels(g, 'pme', 'psis'), ['شقيقتك', 'شقيقة علي', 'your sister', "Ali's sister"]);
    assert.deepEqual(labels(g, 'pme', 'phb'), ['أخوك لأبيك', 'أخو علي لأبيه', 'your half-brother (same father)', "Ali's half-brother (same father)"]);
    assert.deepEqual(labels(g, 'pme', 'phs'), ['أختك لأمك', 'أخت علي لأمه', 'your half-sister (same mother)', "Ali's half-sister (same mother)"]);
    const full = findRelationship(g, 'pme', 'psis');
    assert.equal(full.half, false);
    assert.equal(full.via, null);
    const viaFather = findRelationship(g, 'pme', 'phb');
    assert.equal(viaFather.half, true);
    assert.equal(viaFather.via, 'father');
    assert.equal(viaFather.side, 'paternal');
    const viaMother = findRelationship(g, 'pme', 'phs');
    assert.equal(viaMother.half, true);
    assert.equal(viaMother.via, 'mother');
    assert.equal(viaMother.lca, 'pmo');
    // From the half-sister's side, the pronoun is feminine.
    assert.equal(relationLabel(findRelationship(g, 'phs', 'pme'), g, 'ar', { you: false }), 'أخو ريم لأمها');
  });

  test('uncles and aunts: paternal عمّ/عمّة vs maternal خال/خالة', () => {
    assert.deepEqual(labels(g, 'pme', 'puncle'), ['عمّك', 'عمّ علي', 'your paternal uncle', "Ali's paternal uncle"]);
    assert.deepEqual(labels(g, 'pme', 'paunt').slice(0, 3), ['عمّتك', 'عمّة علي', 'your paternal aunt']);
    assert.deepEqual(labels(g, 'pme', 'pmu').slice(0, 3), ['خالك', 'خال علي', 'your maternal uncle']);
    assert.deepEqual(labels(g, 'pme', 'pma').slice(0, 3), ['خالتك', 'خالة علي', 'your maternal aunt']);
    // great-uncle: باسل → أحمد (brother of his grandfather خالد)
    assert.deepEqual(labels(g, 'pcson', 'pfa').slice(0, 3), ['عمّ والدك', 'عمّ والد باسل', 'your paternal great-uncle']);
  });

  test('nephews, nieces and cousins', () => {
    assert.deepEqual(labels(g, 'pme', 'pneph').slice(0, 3), ['ابن أختك', 'ابن أخت علي', 'your nephew']);
    assert.deepEqual(labels(g, 'puncle', 'pme').slice(0, 3), ['ابن أخيك', 'ابن شقيق خالد', 'your nephew']);
    assert.deepEqual(labels(g, 'pme', 'pcous').slice(0, 3), ['ابن عمّك', 'ابن عمّ علي', 'your first cousin']);
    assert.deepEqual(labels(g, 'pcous', 'psis').slice(0, 3), ['ابنة عمّك', 'ابنة عمّ ماجد', 'your first cousin']);
    assert.deepEqual(labels(g, 'pme', 'pcson').slice(0, 3), ['ابن ابن عمّك', 'ابن ابن عمّ علي', 'your first cousin once removed']);
    assert.deepEqual(labels(g, 'pcson', 'pme').slice(0, 3), ['ابن عمّ والدك', 'ابن عمّ والد باسل', 'your first cousin once removed']);
    // maternal cousin through the aunt: x1 sees علي as the son of his maternal uncle
    assert.equal(relationLabel(findRelationship(g, 'px1', 'pme'), g, 'ar'), 'ابن خالك');
  });

  test('gender-unknown people use neutral forms', () => {
    assert.deepEqual(labels(g, 'pme', 'px1'), ['أحد أبناء عمّتك', 'أحد أبناء عمّة علي', 'your first cousin', "Ali's first cousin"]);
    assert.deepEqual(labels(g, 'paunt', 'px1').slice(0, 3), ['أحد أبنائك', 'أحد أبناء هند', 'your child']);
    assert.deepEqual(labels(g, 'pgf', 'px1').slice(0, 3), ['أحد أحفادك', 'أحد أحفاد سالم', 'your grandchild']);
    // English has no neutral word for nephew/niece or uncle/aunt: a composed chain is used.
    assert.equal(relationLabel(findRelationship(g, 'pfa', 'px1'), g, 'en'), "your sister's child");
    assert.equal(relationLabel(findRelationship(g, 'pfa', 'px1'), g, 'ar'), 'أحد أبناء أختك');
  });

  test('an intermediate parent of unknown gender: composed Arabic chain, no paternal/maternal side', () => {
    const data = normalizeData({
      schema: 1,
      meta: { revision: 1 },
      people: {
        pg0: P('pg0', 'جد', 'm'), pu0: P('pu0', 'مجهول', ''), ps0: P('ps0', 'شقيق', 'm'), ps1: P('ps1', 'شقيقة', 'f'),
        pc1: P('pc1', 'ولد', 'm'), pc2: P('pc2', 'بنت', 'f'),
      },
      unions: {
        ug0: U('ug0', ['pg0'], ['pu0', 'ps0', 'ps1']),
        uu0: U('uu0', ['pu0'], ['pc1', 'pc2']),
      },
    });
    const gg = buildGraph(data);
    const rel = findRelationship(gg, 'pc1', 'ps0');
    assert.equal(rel.side, null);
    assert.equal(relationLabel(rel, gg, 'ar'), 'أخو أحد والديك');
    assert.equal(relationLabel(rel, gg, 'ar', { you: false }), 'أخو أحد والدَي ولد');
    assert.equal(relationLabel(rel, gg, 'en'), 'your uncle');
    assert.equal(relationLabel(findRelationship(gg, 'pc1', 'ps1'), gg, 'ar'), 'أخت أحد والديك');
    assert.equal(relationLabel(findRelationship(gg, 'pc1', 'pu0'), gg, 'ar'), 'أحد والديك');
    assert.equal(relationLabel(findRelationship(gg, 'pc1', 'pu0'), gg, 'en'), 'your parent');
    assert.equal(relationLabel(findRelationship(gg, 'pc1', 'pg0'), gg, 'ar'), 'جدّك'); // side unknown → no لأبيك
    // siblings in a single-parent family record are "unspecified": plain أخ / أخت
    const sib = findRelationship(gg, 'pc1', 'pc2');
    assert.equal(sib.half, null);
    assert.equal(relationLabel(sib, gg, 'ar'), 'أختك');
    assert.equal(relationLabel(sib, gg, 'en'), 'your sister');
  });
});

describe('kinship: spouses and in-laws (synthetic family)', () => {
  test('husband and wife', () => {
    assert.deepEqual(labels(g, 'pme', 'pwife'), ['زوجتك', 'زوجة علي', 'your wife', "Ali's wife"]);
    assert.deepEqual(labels(g, 'pwife', 'pme').slice(0, 3), ['زوجك', 'زوج هالة', 'your husband']);
    const rel = findRelationship(g, 'pme', 'pwife');
    assert.equal(rel.type, 'spouse');
    assert.equal(rel.union, 'ume');
  });

  test('late spouse and widow(er)', () => {
    assert.deepEqual(labels(g, 'pgf', 'pgm'), ['زوجتك الراحلة', 'زوجة سالم الراحلة', 'your late wife', "Salem's late wife"]);
    assert.deepEqual(labels(g, 'pgm', 'pgf'), ['أرملك', 'أرمل مريم', 'your widower', "Maryam's widower"]);
  });

  test('"former" only with showDivorce', () => {
    assert.deepEqual(labels(g, 'pmo', 'ph1').slice(0, 3), ['زوجك', 'زوج فاطمة', 'your husband']);
    assert.deepEqual(labels(g, 'pmo', 'ph1', { showDivorce: true }).slice(0, 3), ['زوجك السابق', 'زوج فاطمة السابق', 'your former husband']);
    assert.equal(relationLabel(findRelationship(g, 'ph1', 'pmo'), g, 'ar', { showDivorce: true }), 'زوجتك السابقة');
  });

  test('parents-in-law: حمو / حماة', () => {
    assert.deepEqual(labels(g, 'pme', 'pwf'), ['حموك', 'حمو علي', 'your father-in-law', "Ali's father-in-law"]);
    assert.deepEqual(labels(g, 'pme', 'pwm').slice(0, 3), ['حماتك', 'حماة علي', 'your mother-in-law']);
    assert.deepEqual(labels(g, 'pwife', 'pfa').slice(0, 3), ['حموك', 'حمو هالة', 'your father-in-law']);
    const rel = findRelationship(g, 'pme', 'pwf');
    assert.equal(rel.type, 'affinal');
    assert.equal(rel.spouseVia, 'a');
  });

  test('children-in-law, siblings-in-law: زوجة ابنك، زوج ابنتك، زوجة الأخ، زوج الأخت', () => {
    assert.deepEqual(labels(g, 'pme', 'psonw').slice(0, 3), ['زوجة ابنك', 'زوجة ابن علي', 'your daughter-in-law']);
    assert.deepEqual(labels(g, 'pwf', 'pme').slice(0, 3), ['زوج ابنتك', 'زوج ابنة حسين', 'your son-in-law']);
    assert.deepEqual(labels(g, 'psis', 'pwife').slice(0, 3), ['زوجة أخيك', 'زوجة شقيق نور', 'your sister-in-law']);
    assert.deepEqual(labels(g, 'pme', 'psish').slice(0, 3), ['زوج أختك', 'زوج أخت علي', 'your brother-in-law']);
    const rel = findRelationship(g, 'psis', 'pwife');
    assert.equal(rel.spouseVia, 'b');
  });

  test('relatives of the spouse: "<relation> زوجتك/زوجك"', () => {
    assert.deepEqual(labels(g, 'pme', 'pwb').slice(0, 3), ['أخو زوجتك', 'أخو زوجة علي', 'your brother-in-law']);
    assert.deepEqual(labels(g, 'pwife', 'psis').slice(0, 3), ['أخت زوجك', 'أخت زوج هالة', 'your sister-in-law']);
    assert.deepEqual(labels(g, 'pwife', 'puncle').slice(0, 3), ['عمّ زوجك', 'عمّ زوج هالة', "your husband's paternal uncle"]);
    assert.equal(relationLabel(findRelationship(g, 'pwife', 'pcous'), g, 'ar'), 'ابن عمّ زوجك');
    assert.equal(relationLabel(findRelationship(g, 'pwife', 'pcous'), g, 'en'), "your husband's first cousin");
  });

  test('spouse of a relative: "زوج/زوجة <relation>" / "wife of your …"', () => {
    assert.deepEqual(labels(g, 'pme', 'puw').slice(0, 3), ['زوجة عمّك', 'زوجة عمّ علي', 'wife of your paternal uncle']);
    assert.deepEqual(labels(g, 'pme', 'pauh').slice(0, 3), ['زوج عمّتك', 'زوج عمّة علي', 'husband of your paternal aunt']);
    assert.equal(relationLabel(findRelationship(g, 'pme', 'pauh'), g, 'en', { you: false }), "husband of Ali's paternal aunt");
  });

  test('step relations and co-wives', () => {
    assert.deepEqual(labels(g, 'pme', 'pw2').slice(0, 3), ['زوجة والدك', 'زوجة والد علي', 'your stepmother']);
    assert.deepEqual(labels(g, 'pw2', 'pme').slice(0, 3), ['ابن زوجك', 'ابن زوج ليلى', 'your stepson']);
    assert.deepEqual(labels(g, 'pmo', 'pw2').slice(0, 3), ['زوجة زوجك', 'زوجة زوج فاطمة', "your husband's other wife"]);
    assert.deepEqual(labels(g, 'ph1', 'pme').slice(0, 3), ['ابن زوجتك', 'ابن زوجة طارق', 'your stepson']);
  });

  test('two marriage links: spouse of a spouse’s relative', () => {
    // هالة's brother وليد; his would-be wife: give him one in a copy of the data.
    const data = fixture();
    data.people.pwbw = normalizeData({ people: { pwbw: P('pwbw', 'منى', 'f') } }).people.pwbw;
    data.unions.uwb = normalizeData({ unions: { uwb: U('uwb', ['pwb', 'pwbw']) } }).unions.uwb;
    const gg = buildGraph(data);
    const rel = findRelationship(gg, 'pme', 'pwbw');
    assert.equal(rel.type, 'affinal');
    assert.equal(rel.spouseVia, 'both');
    assert.equal(relationLabel(rel, gg, 'ar'), 'زوجة أخي زوجتك');
    assert.equal(relationLabel(rel, gg, 'en'), 'wife of your brother-in-law');
  });
});

describe('kinship: milk and foster ties', () => {
  test('milk mother, milk child, milk sibling', () => {
    assert.deepEqual(labels(g, 'pme', 'pamina'), ['أمك من الرضاعة', 'أم علي من الرضاعة', 'your milk mother', "Ali's milk mother"]);
    assert.deepEqual(labels(g, 'pamina', 'pme').slice(0, 3), ['ابنك من الرضاعة', 'ابن أمينة من الرضاعة', 'your milk son']);
    assert.deepEqual(labels(g, 'pme', 'prana').slice(0, 3), ['أختك من الرضاعة', 'أخت علي من الرضاعة', 'your milk sister']);
    const rel = findRelationship(g, 'pme', 'prana');
    assert.equal(rel.type, 'tie');
    assert.deepEqual(rel.tie, { type: 'milk-child-of', direction: 'sibling' });
    assert.deepEqual(rel.path, ['pme', 'pamina', 'prana']);
  });

  test('foster (kafala): كافل / مكفول', () => {
    const foster = labels(g, 'pyatim', 'pkafil');
    assert.deepEqual(foster.slice(0, 3), ['كافلك', 'كافل يتيم', 'your foster father']);
    assert.match(foster[3], /^\S+'s foster father$/);
    assert.deepEqual(labels(g, 'pkafil', 'pyatim').slice(0, 3), ['مكفولك', 'مكفول كفيل', 'your foster son']);
  });

  test('a blood relation wins over a tie to the same person', () => {
    const data = fixture();
    data.people.pme.ties.push({ type: 'milk-child-of', person: 'paunt', note: { ar: '', en: '' } });
    const gg = buildGraph(data);
    assert.equal(relationLabel(findRelationship(gg, 'pme', 'paunt'), gg, 'ar'), 'عمّتك');
  });
});

describe('kinship: path choice, self, none, steps', () => {
  test('self and no relation', () => {
    assert.equal(findRelationship(g, 'pme', 'pme').type, 'self');
    assert.equal(relationLabel(findRelationship(g, 'pme', 'pme'), g, 'ar'), 'أنت');
    assert.equal(relationLabel(findRelationship(g, 'pme', 'pme'), g, 'en'), 'you');
    const none = findRelationship(g, 'pme', 'pstr');
    assert.equal(none.type, 'none');
    assert.deepEqual(none.path, []);
    assert.equal(relationLabel(none, g, 'ar'), 'لا توجد صلة قرابة معروفة');
    assert.equal(relationLabel(none, g, 'ar', { you: false }), 'لا توجد صلة قرابة معروفة مع علي');
    assert.equal(relationLabel(none, g, 'en', { you: false }), 'no known relation to Ali');
    assert.equal(findRelationship(g, 'pme', 'pmissing').type, 'none');
  });

  test('cousin marriage: the shortest blood path wins, spouse beats blood', () => {
    // G → A1, A2; A1 → S; A2 → D; S + D → K; S2 is S's brother.
    const data = normalizeData({
      schema: 1,
      meta: { revision: 1 },
      people: Object.fromEntries([
        P('pg', 'جد', 'm'), P('pa1', 'أول', 'm'), P('pa2', 'ثان', 'm'), P('ps', 'سامي', 'm'), P('ps2', 'سمير', 'm'),
        P('pd', 'دعاء', 'f'), P('pk', 'كريم', 'm'),
      ].map((p) => [p.id, p])),
      unions: Object.fromEntries([
        U('ug', ['pg'], ['pa1', 'pa2']), U('ua1', ['pa1'], ['ps', 'ps2']), U('ua2', ['pa2'], ['pd']),
        U('usd', ['ps', 'pd'], ['pk']),
      ].map((u) => [u.id, u])),
    });
    const gg = buildGraph(data);
    // K → A2: maternal grandfather (2 steps) rather than his father's uncle (3 + 1).
    const r1 = findRelationship(gg, 'pk', 'pa2');
    assert.equal(r1.up, 2);
    assert.equal(r1.down, 0);
    assert.equal(relationLabel(r1, gg, 'ar'), 'جدّك لأمك');
    // S → D: spouse, not cousin.
    assert.equal(findRelationship(gg, 'ps', 'pd').type, 'spouse');
    // S2 → D: first cousin (blood) is kept even though "brother's wife" is one step shorter.
    const r2 = findRelationship(gg, 'ps2', 'pd');
    assert.equal(r2.type, 'blood');
    assert.equal(relationLabel(r2, gg, 'ar'), 'ابنة عمّك');
  });

  test('a distant blood relation gives way to a much closer in-law path', () => {
    // G0 → B1, B2; B1 → C1 → X, X2; B2 → C2 → Y; X2 + Y. From X, Y is a second cousin (6 steps) and the wife of
    // his brother (3 steps).
    const data = normalizeData({
      schema: 1,
      meta: { revision: 1 },
      people: Object.fromEntries([
        P('pg0', 'جد', 'm'), P('pb1', 'ب1', 'm'), P('pb2', 'ب2', 'm'), P('pc1', 'ج1', 'm'), P('pc2', 'ج2', 'm'),
        P('px', 'خالد', 'm'), P('px2', 'خليل', 'm'), P('py', 'ياسمين', 'f'),
      ].map((p) => [p.id, p])),
      unions: Object.fromEntries([
        U('ug0', ['pg0'], ['pb1', 'pb2']), U('ub1', ['pb1'], ['pc1']), U('ub2', ['pb2'], ['pc2']),
        U('uc1', ['pc1'], ['px', 'px2']), U('uc2', ['pc2'], ['py']), U('uxy', ['px2', 'py']),
      ].map((u) => [u.id, u])),
    });
    const gg = buildGraph(data);
    const rel = findRelationship(gg, 'px', 'py');
    assert.equal(rel.type, 'affinal');
    assert.equal(relationLabel(rel, gg, 'ar'), 'زوجة أخيك');
    assert.equal(relationLabel(rel, gg, 'en'), 'your sister-in-law');
  });

  test('pathSteps names each step', () => {
    const rel = findRelationship(g, 'pme', 'pcous');
    const ar = pathSteps(rel, g, 'ar');
    assert.deepEqual(ar.map((s) => s.id), ['pme', 'pfa', 'pgf', 'puncle', 'pcous']);
    assert.deepEqual(ar.map((s) => s.role), ['', 'والد', 'والد', 'ابن', 'ابن']);
    assert.deepEqual(pathSteps(rel, g, 'en').map((s) => s.role), ['', 'father', 'father', 'son', 'son']);
    const milk = pathSteps(findRelationship(g, 'pme', 'prana'), g, 'en');
    assert.deepEqual(milk.map((s) => s.role), ['', 'milk mother', 'daughter']);
    const inLaw = pathSteps(findRelationship(g, 'pme', 'pwf'), g, 'ar');
    assert.deepEqual(inLaw.map((s) => s.role), ['', 'زوجة', 'والد']);
    assert.deepEqual(pathSteps(findRelationship(g, 'pme', 'pstr'), g, 'ar'), []);
  });

  test('relationship() convenience', () => {
    const { rel, label } = relationship(g, 'pme', 'puncle', 'ar');
    assert.equal(rel.type, 'blood');
    assert.equal(label, 'عمّك');
  });

  test('steps and path agree for every pair in the fixture', () => {
    const ids = g.people().map((p) => p.id);
    for (const a of ids) {
      for (const b of ids) {
        const rel = findRelationship(g, a, b);
        if (rel.type === 'none' || rel.type === 'self') continue;
        assert.equal(rel.path[0], a);
        assert.equal(rel.path[rel.path.length - 1], b);
        assert.equal(rel.steps.length, rel.path.length - 1, `${a}→${b}`);
        for (const lang of ['ar', 'en']) {
          for (const you of [true, false]) {
            const text = relationLabel(rel, g, lang, { you });
            assert.ok(text && !/undefined|null|NaN/.test(text), `${a}→${b} ${lang}: ${text}`);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// The real family data (data/family.json)

const realRaw = JSON.parse(readFileSync(fileURLToPath(new URL('../data/family.json', import.meta.url)), 'utf8'));
const real = buildGraph(normalizeData(realRaw));

// People of the real data used below (id: name).
const R = {
  ali: 'ptcm5xwt', // علي، son of محمد عالم
  faiza: 'p10p5jzy', // فايزة، daughter of محمد علي محمود and إحسان قنديل; wife of علي
  hassan: 'papzakd5', // حسن، son of علي and فايزة
  mam: 'pptg72ck', // محمد علي محمود (several wives)
  ihsan: 'p8ot12f8', // إحسان قنديل (wife of محمد علي محمود, later of السعيد الشربيني)
  alawiya: 'p4outfh5', // علوية مراد (wife of محمد علي محمود)
  jamil: 'p5jf0cnf', // جميل، son of محمد علي محمود and علوية مراد
  ibrahim: 'p2zdrzmh', // إبراهيم، son of محمد علي محمود (mother not recorded)
  hussein: 'pi7sbkc7', // حسين، son of محمد علي محمود and the Daghestani wife
  ismail: 'pqlhshcp', // إسماعيل، son of إحسان قنديل and السعيد الشربيني
  ghaida: 'pc4noxka', // غيداء، granddaughter of محمد علي محمود (through بثينة)
  suhail: 'p3qm2qm0', // سهيل، son of جميل
  waseem: 'pfdvv5mw', // وسيم، son of سهيل
  samir: 'pexymrzt', // سمير، son of خديجة (daughter of حسين)
  khadijaFatta: 'pr09lmw1', // خديجة فتة، wife of أحمد
  ahmad: 'prp3ai84', // أحمد، brother of علي
  huda: 'pfrgn8rv', // هدى، daughter of محمد (son of أحمد and خديجة فتة)
  sulaiman: 'p90rpcpo', // سليمان، son of فاطمة (daughter of أحمد and خديجة فتة)
  zakiya: 'pciev8ne', // زكية إسماعيل قربان، wife of محمد (son of خديجة فتة)
  muhammad: 'p7cfv90d', // محمد، son of أحمد and خديجة فتة
  ilham: 'p4uhuquy', // إلهام حسن كابلي، wife of ابراهيم (son of خديجة فتة)
  saleh: 'pd1pphkw', // صالح أبوغلية، husband of فاطمة (daughter of خديجة فتة)
  salem: 'pg8caja6', // سالم عالم (root)
  alaa: 'po3uyog1', // علاء (gender not recorded), son of محمدعلي
  asim: 'pu0pvl94', // عاصم، brother of محمدعلي
};

describe('kinship: real family data', () => {
  test('a child of علي & فايزة and grandchildren of محمد علي محمود (maternal half-cousins)', () => {
    const rel = findRelationship(real, R.hassan, R.ghaida);
    assert.equal(rel.type, 'blood');
    assert.equal(rel.up, 2);
    assert.equal(rel.down, 2);
    assert.equal(rel.lca, R.mam);
    assert.equal(rel.side, 'maternal');
    assert.equal(rel.half, true); // فايزة and بثينة are half-sisters (same father)
    assert.equal(rel.via, 'father');
    assert.deepEqual(labels(real, R.hassan, R.ghaida), ['ابنة خالتك', 'ابنة خالة حسن', 'your first cousin', "Hassan's first cousin"]);
    assert.equal(relationLabel(findRelationship(real, R.ghaida, R.hassan), real, 'ar'), 'ابن خالتك');
    assert.equal(relationLabel(findRelationship(real, R.hassan, R.suhail), real, 'ar'), 'ابن خالك');
    assert.equal(relationLabel(findRelationship(real, R.suhail, R.hassan), real, 'ar'), 'ابن عمّتك');
    assert.deepEqual(labels(real, R.hassan, R.waseem).slice(0, 3), ['ابن ابن خالك', 'ابن ابن خال حسن', 'your first cousin once removed']);
  });

  test('children of different wives of محمد علي محمود are half-siblings through the father', () => {
    assert.deepEqual(labels(real, R.faiza, R.jamil), ['أخوك لأبيك', 'أخو فايزة لأبيها', 'your half-brother (same father)', "Faiza's half-brother (same father)"]);
    assert.deepEqual(labels(real, R.jamil, R.faiza).slice(0, 3), ['أختك لأبيك', 'أخت جميل لأبيه', 'your half-sister (same father)']);
    assert.equal(relationLabel(findRelationship(real, R.faiza, R.hussein), real, 'ar'), 'أخوك لأبيك');
    // إسماعيل shares only the mother (إحسان قنديل)
    assert.deepEqual(labels(real, R.faiza, R.ismail).slice(0, 3), ['أخوك لأمك', 'أخو فايزة لأمها', 'your half-brother (same mother)']);
    // إبراهيم's mother is not recorded: unspecified sibling
    const rel = findRelationship(real, R.faiza, R.ibrahim);
    assert.equal(rel.half, null);
    assert.equal(relationLabel(rel, real, 'ar'), 'أخوك');
  });

  test('خديجة فتة and her grandchildren', () => {
    assert.deepEqual(labels(real, R.khadijaFatta, R.huda).slice(0, 3), ['حفيدتك', 'حفيدة خديجة', 'your granddaughter']);
    assert.deepEqual(labels(real, R.huda, R.khadijaFatta), ['جدّتك لأبيك', 'جدّة هدى لأبيها', 'your paternal grandmother', "Huda's paternal grandmother"]);
    assert.deepEqual(labels(real, R.sulaiman, R.khadijaFatta).slice(0, 3), ['جدّتك لأمك', 'جدّة سليمان لأمه', 'your maternal grandmother']);
  });

  test('in-laws in the real data', () => {
    assert.deepEqual(labels(real, R.zakiya, R.khadijaFatta).slice(0, 3), ['حماتك', 'حماة زكية', 'your mother-in-law']);
    assert.deepEqual(labels(real, R.zakiya, R.ahmad).slice(0, 3), ['حموك', 'حمو زكية', 'your father-in-law']);
    assert.deepEqual(labels(real, R.khadijaFatta, R.zakiya).slice(0, 3), ['زوجة ابنك', 'زوجة ابن خديجة', 'your daughter-in-law']);
    assert.deepEqual(labels(real, R.ilham, R.muhammad).slice(0, 3), ['أخو زوجك', 'أخو زوج إلهام', 'your brother-in-law']);
    assert.deepEqual(labels(real, R.muhammad, R.ilham).slice(0, 3), ['زوجة أخيك', 'زوجة شقيق محمد', 'your sister-in-law']);
    assert.equal(relationLabel(findRelationship(real, R.muhammad, R.saleh), real, 'ar'), 'زوج أختك');
    // the two families joined by علي & فايزة
    assert.deepEqual(labels(real, R.ali, R.mam).slice(0, 3), ['حموك', 'حمو علي', 'your father-in-law']);
    assert.deepEqual(labels(real, R.mam, R.ali).slice(0, 3), ['زوج ابنتك', 'زوج ابنة محمد علي', 'your son-in-law']);
    assert.equal(relationLabel(findRelationship(real, R.faiza, R.ahmad), real, 'ar'), 'أخو زوجك');
    // co-wives and step-relations of محمد علي محمود
    assert.deepEqual(labels(real, R.ihsan, R.alawiya).slice(0, 3), ['زوجة زوجك', 'زوجة زوج إحسان', "your husband's other wife"]);
    assert.deepEqual(labels(real, R.mam, R.ismail).slice(0, 3), ['ابن زوجتك', 'ابن زوجة محمد علي', 'your stepson']);
    assert.deepEqual(labels(real, R.ismail, R.mam).slice(0, 3), ['زوج والدتك', 'زوج والدة إسماعيل', 'your stepfather']);
    assert.equal(relationLabel(findRelationship(real, R.ali, R.faiza), real, 'ar'), 'زوجتك');
  });

  test('distant relations: composed Arabic chains, n-th cousins in English', () => {
    assert.deepEqual(labels(real, R.samir, R.suhail).slice(0, 3), ['ابن عمّ والدتك', 'ابن عمّ والدة سمير', 'your first cousin once removed']);
    assert.deepEqual(labels(real, R.samir, R.waseem).slice(0, 3), ['ابن ابن عمّ والدتك', 'ابن ابن عمّ والدة سمير', 'your second cousin']);
    assert.deepEqual(labels(real, R.hassan, R.salem).slice(0, 3), ['جدّ جدّك لأبيك', 'جدّ جدّ حسن لأبيه', 'your paternal great-great-grandfather']);
    assert.equal(relationLabel(findRelationship(real, R.salem, R.hassan), real, 'en'), 'your great-great-grandson');
    assert.equal(relationLabel(findRelationship(real, R.hassan, R.huda), real, 'ar'), 'ابنة ابن عمّك');
    assert.equal(relationLabel(findRelationship(real, R.huda, R.hassan), real, 'ar'), 'ابن عمّ والدك');
  });

  test('gender-unknown people in the real data', () => {
    assert.deepEqual(labels(real, R.mam, R.alaa).slice(0, 3), ['أحد أحفادك', 'أحد أحفاد محمد علي', 'your grandchild']);
    assert.equal(relationLabel(findRelationship(real, R.alaa, R.asim), real, 'ar'), 'عمّك');
    assert.deepEqual(labels(real, R.asim, R.alaa).slice(0, 3), ['أحد أبناء أخيك', 'أحد أبناء شقيق عاصم', "your brother's child"]);
  });

  test('every pair from a sample of the real data gets a clean label', () => {
    const ids = real.people().map((p) => p.id).filter((_, i) => i % 4 === 0);
    let related = 0;
    for (const a of ids) {
      for (const b of ids) {
        const rel = findRelationship(real, a, b);
        if (rel.type !== 'none') related++;
        for (const lang of ['ar', 'en']) {
          const text = relationLabel(rel, real, lang, { you: a === ids[0] });
          assert.ok(text && !/undefined|null|NaN|\s{2}/.test(text), `${a}→${b}: ${text}`);
          if (lang === 'ar') assert.ok(!/[A-Za-z]/.test(text), `Arabic label with Latin text: ${text}`);
        }
      }
    }
    assert.ok(related > ids.length * 2);
  });
});

describe('kinship: distant relations', () => {
  // جد → two lines of 8 generations (all men except pb3, a woman).
  const NAMES = {
    a: ['أحمد', 'بكر', 'جابر', 'داود', 'هاني', 'وائل', 'زاهر', 'حامد'],
    b: ['طلال', 'يحيى', 'كامل', 'لبنى', 'مازن', 'نبيل', 'سامر', 'عادل'],
  };
  const people = { pr: P('pr', 'جد', 'm') };
  const unions = {};
  let n = 0;
  for (const L of ['a', 'b']) {
    let prev = 'pr';
    for (let i = 0; i < 8; i++) {
      const id = `p${L}${i}`;
      people[id] = P(id, NAMES[L][i], L === 'b' && i === 3 ? 'f' : 'm');
      const uid = `uu${n++}`;
      unions[uid] = U(uid, [prev], [id]);
      prev = id;
    }
  }
  const dg = buildGraph(normalizeData({ schema: 1, meta: { revision: 1 }, people, unions }));
  const lab = (a, b, lang) => relationLabel(findRelationship(dg, a, b), dg, lang);

  test('English: n-th cousins k times removed, great- prefixes, grand-nephews', () => {
    assert.equal(lab('pa2', 'pb4', 'en'), 'your second cousin twice removed');
    assert.equal(lab('pa4', 'pb4', 'en'), 'your fourth cousin');
    assert.equal(lab('pa7', 'pb7', 'en'), 'your seventh cousin');
    assert.equal(lab('pa5', 'pr', 'en'), 'your paternal 4th great-grandfather');
    assert.equal(lab('pr', 'pa6', 'en'), 'your 5th great-grandson');
    assert.equal(lab('pa0', 'pb3', 'en'), 'your great-grandniece');
    assert.equal(lab('pb4', 'pa0', 'en'), 'your maternal 3rd great-uncle');
  });

  test('Arabic: composed chains, and a named common ancestor when the chain gets too long', () => {
    assert.equal(lab('pa2', 'pb4', 'ar'), 'ابن ابنة ابن ابن عمّ والدك');
    assert.equal(lab('pa0', 'pb3', 'ar'), 'ابنة ابن ابن أخيك');
    assert.equal(lab('pb4', 'pa0', 'ar'), 'عمّ جدّ والدتك');
    assert.equal(lab('pa6', 'pr', 'ar'), 'جدّ جدّ جدّ والدك');
    assert.equal(lab('pa6', 'pb6', 'ar'), 'قريبك (الجدّ المشترك: جد)');
    assert.equal(relationLabel(findRelationship(dg, 'pa6', 'pb6'), dg, 'ar', { you: false }), 'قريب زاهر (الجدّ المشترك: جد)');
  });
});

describe('kinship: performance', () => {
  test('5,000 people: relationships stay fast', () => {
    // A clan of 5,000: each person (from the 2nd generation) is a child of a couple from the previous one.
    const people = {};
    const unions = {};
    let n = 0;
    const person = (gender) => {
      const id = `pp${(n++).toString(36)}`;
      people[id] = { id, name: { ar: gender === 'm' ? 'محمد' : 'فاطمة' }, gender };
      return id;
    };
    let gen = [person('m'), person('m'), person('m')];
    let u = 0;
    while (n < 5000) {
      const next = [];
      for (const parent of gen) {
        if (n >= 5000) break;
        const wife = person('f');
        const kids = [];
        for (let k = 0; k < 3 && n < 5000; k++) kids.push(person(k % 2 ? 'f' : 'm'));
        unions[`uu${(u++).toString(36)}`] = { id: `uu${(u - 1).toString(36)}`, partners: [parent, wife], children: kids, status: 'married' };
        next.push(...kids.filter((id) => people[id].gender === 'm'));
      }
      gen = next;
    }
    const big = buildGraph(normalizeData({ schema: 1, meta: { revision: 1 }, people, unions }));
    const ids = Object.keys(people);
    const t0 = performance.now();
    let found = 0;
    for (let i = 0; i < 200; i++) {
      const a = ids[(i * 7919) % ids.length];
      const b = ids[(i * 104729 + 13) % ids.length];
      const rel = findRelationship(big, a, b);
      relationLabel(rel, big, 'ar');
      relationLabel(rel, big, 'en');
      if (rel.type !== 'none') found++;
    }
    const ms = performance.now() - t0;
    assert.ok(found > 0);
    assert.ok(ms < 8000, `200 relationships took ${ms.toFixed(0)} ms`);
  });
});
