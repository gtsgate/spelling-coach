// Integration tests: the core modules working together the way the browser (js/store.js) and the GitHub scripts
// use them (docs/SPEC.md §2–§5, §7.3, §8).
//
//   (a) every Issue code that schema.js / ops.js / codec.js can emit has Arabic and English text in messages.js;
//   (b) describeOp describes every op type (and every mark and link variant) in both languages;
//   (c) the real data/family.json normalizes, validates, builds a graph, and has the two expected branches;
//   (d) a browser-like flow: a "sent" proposal overlaid by the real store, a draft depending on it (refMap /
//       dependsOn), both travelling as codes, then applied in final mode with refMap from the first idMap;
//   (e) the final data serializes, re-validates and is a fixed point of normalize → serialize;
//   (f) performance on a synthetic 5,000-person tree.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  SCHEMA_ISSUE_CODES, OP_TYPES, MARKS, normalizeData, validateData, serializeData, compactData, isPersonId, isUnionId,
} from '../js/core/schema.js';
import { OPS_ISSUE_CODES, applyProposal, applyProposals, validateProposal, proposalHash } from '../js/core/ops.js';
import { CODEC_ERROR_CODES, encodeProposal, decodeProposal, extractProposal } from '../js/core/codec.js';
import { ISSUE_CODES, formatIssue } from '../js/core/messages.js';
import { describeOp, describeProposal, refNames } from '../js/core/describe.js';
import { buildGraph } from '../js/core/graph.js';
import { personName } from '../js/core/names.js';
import { findRelationship, relationLabel } from '../js/core/kinship.js';
import { store } from '../js/store.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const RAW_TEXT = read('../data/family.json');
const rawData = () => JSON.parse(RAW_TEXT);

const NOW = '2026-11-25T12:00:00.000Z';
const ARABIC = /[؀-ۿ]/;
const GENERIC = { en: /^Unexpected problem/, ar: /^مشكلة غير متوقعة/ };
const DESCRIBE_FALLBACK = /^(Unknown change|Change of type|تعديل غير معروف|تعديل من نوع)/;

/** A proposal envelope (§3.1). */
function proposal(id, ops, extra = {}) {
  return {
    kind: 'gft-proposal', v: 1, id, createdAt: NOW, baseRevision: 1, dependsOn: [],
    submitter: { name: 'أم خالد', relation: 'زوجة الابن', personId: '' }, note: '', ops, ...extra,
  };
}

const codesOf = (list) => (list || []).map((i) => i.code);

/**
 * A living man of the youngest generation with parents and no spouse or children: the visitor. Chosen by
 * structure, so the tests survive re-imports of the real data.
 */
function pickVisitor(g) {
  const me = g.people().find((p) => p.gender === 'm' && !p.deceased && p.nameStatus === 'known'
    && g.spouses(p.id).length === 0 && g.children(p.id).length === 0 && g.father(p.id) && g.mother(p.id));
  assert.ok(me, 'a suitable visitor exists in the real data');
  return me;
}

// =========================================================================================================
// (a) Every emitted Issue code has Arabic and English text

describe('(a) messages cover every code the core can emit', () => {
  const EMITTED = [...new Set([...SCHEMA_ISSUE_CODES, ...OPS_ISSUE_CODES, ...CODEC_ERROR_CODES])].sort();

  test('the exported code lists are non-trivial and UPPER_SNAKE', () => {
    assert.ok(SCHEMA_ISSUE_CODES.length > 30 && OPS_ISSUE_CODES.length > 40 && CODEC_ERROR_CODES.length === 5);
    for (const c of EMITTED) assert.match(c, /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/, c);
  });

  test('every code literal in schema.js / ops.js / codec.js is declared in their exported lists', () => {
    // Guards against a code being emitted without being exported (and so never checked below).
    const declared = new Set(EMITTED);
    const NOT_CODES = new Set(['NFKD']); // String.prototype.normalize form
    for (const file of ['schema.js', 'ops.js', 'codec.js']) {
      const src = read(`../js/core/${file}`);
      const literals = [...src.matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)'/g)].map((m) => m[1]).filter((c) => !NOT_CODES.has(c));
      const undeclared = [...new Set(literals)].filter((c) => !declared.has(c));
      assert.deepEqual(undeclared, [], `${file} uses undeclared codes`);
    }
  });

  test('ISSUE_CODES lists every emitted code', () => {
    const missing = EMITTED.filter((c) => !ISSUE_CODES.includes(c));
    assert.deepEqual(missing, []);
  });

  test('ref errors about a union ref (newuN / unionRef) are not worded as a "new person"', () => {
    for (const lang of ['ar', 'en']) {
      const person = formatIssue({ code: 'UNKNOWN_REF', params: { ref: 'new9', field: 'id' } }, lang);
      const union = formatIssue({ code: 'UNKNOWN_REF', params: { ref: 'newu9', field: 'link.union' } }, lang);
      const bound = formatIssue({ code: 'DUPLICATE_REF', params: { ref: 'newu2', field: 'unionRef', union: 'u1', used: 'u2' } }, lang);
      const declared = formatIssue({ code: 'DUPLICATE_REF', params: { ref: 'new2', field: 'ref' } }, lang);
      const PERSON = lang === 'en' ? /new person/ : /فرد جديد|الفرد الجديد/;
      assert.match(person, PERSON);
      assert.match(declared, PERSON);
      assert.doesNotMatch(union, PERSON, union);
      assert.doesNotMatch(bound, PERSON, bound);
    }
  });

  for (const lang of ['ar', 'en']) {
    test(`formatIssue gives specific ${lang} text for every emitted code (empty params, no leaked placeholders)`, () => {
      for (const code of EMITTED) {
        const text = formatIssue({ code, params: {} }, lang);
        assert.ok(text && text.length > 8, `${code}: empty text`);
        assert.doesNotMatch(text, GENERIC[lang], `${code} falls back to the generic text`);
        assert.doesNotMatch(text, /\{|\}|undefined|null|NaN|\[object/, `${code}: ${text}`);
        if (lang === 'ar') assert.match(text, ARABIC, `${code}: Arabic text expected`);
        else assert.doesNotMatch(text, ARABIC, `${code}: English text must not contain Arabic: ${text}`);
        // with an op index the 1-based prefix is added (§6.2 numbered change lines)
        const withOp = formatIssue({ code, params: {}, op: 2 }, lang);
        assert.ok(withOp.startsWith(lang === 'en' ? 'Change 3: ' : 'التعديل 3: '), withOp);
      }
    });
  }
});

// =========================================================================================================
// (b) describeOp covers every op type

describe('(b) describeOp covers every op type in both languages', () => {
  const data = normalizeData(rawData());
  const g = buildGraph(data);
  const me = pickVisitor(g);
  const father = g.father(me.id);
  const mother = g.mother(me.id);
  const birth = g.birthUnion(me.id);
  const couple = g.unions().find((u) => u.partners.length === 2 && u.children.length > 0);
  const other = g.people().find((p) => p.id !== me.id && p.id !== father.id && p.gender === 'm' && !p.deceased);
  const add = (person, link, extra = {}) => ({ op: 'add-person', ref: 'new1', person: { gender: 'f', ...person }, link, ...extra });

  // One sample per op type; extra variants (links, marks) are added below.
  const SAMPLES = {
    'add-person': add({ name: { ar: 'نورة' } }, { as: 'child', of: father.id, with: mother.id }, { unionRef: 'newu2' }),
    'edit-person': { op: 'edit-person', id: me.id, set: { 'occupation.en': 'Engineer', privacy: 'year' }, before: { 'occupation.en': '' } },
    mark: { op: 'mark', id: me.id, mark: 'verified' },
    'link-spouse': { op: 'link-spouse', a: me.id, b: other.id, status: 'married', unionRef: 'newu3' },
    'move-person': { op: 'move-person', id: me.id, to: { of: father.id, with: null }, unionRef: 'newu4' },
    'edit-union': { op: 'edit-union', union: couple.id, set: { status: 'divorced', 'marriage.date': '1980' } },
    'reorder-children': { op: 'reorder-children', union: birth.id, order: [...birth.children].reverse() },
    'reorder-spouses': { op: 'reorder-spouses', id: couple.partners[0], order: [couple.id] },
    'add-tie': { op: 'add-tie', id: me.id, type: 'milk-child-of', person: mother.id },
    'restore-person': { op: 'restore-person', id: other.id },
    'restore-union': { op: 'restore-union', union: couple.id },
    'remove-person': { op: 'remove-person', id: me.id, reasonCode: 'entered-by-mistake' },
    'unlink-spouse': { op: 'unlink-spouse', union: couple.id, reasonCode: 'other' },
    'detach-person': { op: 'detach-person', id: me.id, reasonCode: 'wrong-parents' },
    'remove-tie': { op: 'remove-tie', id: me.id, type: 'foster-child-of', person: father.id, reasonCode: 'person-requested' },
    'merge-person': { op: 'merge-person', keep: me.id, remove: other.id, reasonCode: 'duplicate', parents: 'keep' },
  };
  const VARIANTS = [
    ...Object.values(SAMPLES),
    add({ name: { ar: 'سلمى' } }, { as: 'child', union: birth.id }),
    add({ name: { ar: 'سلمى' } }, { as: 'spouse', of: other.id, status: 'divorced' }),
    add({ name: { ar: 'خالد' }, gender: 'm' }, { as: 'parent', of: me.id, scope: 'only' }),
    add({ name: { ar: 'هند' } }, { as: 'parent', of: me.id, scope: 'union' }),
    ...['both', 'father', 'mother'].map((share) => add({ name: { ar: 'ليلى' } }, { as: 'sibling', of: me.id, share })),
    add({ nameStatus: 'withheld' }, { as: 'spouse', of: other.id }),
    add({ nameStatus: 'unknown', gender: '' }, { as: 'child', of: me.id }),
    add({ name: { ar: 'فاطمة' }, deceased: true, death: { date: '1990' } }),
    ...MARKS.map((mark) => ({ op: 'mark', id: me.id, mark, ...(mark === 'duplicate' ? { of: other.id } : {}),
      ...(mark === 'needs-info' ? { note: 'birth year' } : {}), ...(mark === 'deceased' ? { date: '2020' } : {}) })),
  ];

  test('the samples cover exactly OP_TYPES (a new op type must get a description)', () => {
    assert.deepEqual(Object.keys(SAMPLES).sort(), [...OP_TYPES].sort());
  });

  for (const lang of ['ar', 'en']) {
    test(`every op type, link variant and mark has a specific one-line ${lang} description`, () => {
      const ctx = { graph: g, refNames: refNames(VARIANTS, g) };
      const seen = new Set();
      for (const op of VARIANTS) {
        const text = describeOp(op, ctx, lang);
        assert.ok(text && text.length > 6, `${op.op}: empty`);
        assert.doesNotMatch(text, DESCRIBE_FALLBACK, `${op.op} has no description: ${text}`);
        assert.doesNotMatch(text, /[<>*`\n]|undefined|null|NaN|\[object/, `${op.op}: ${text}`);
        if (lang === 'ar') assert.match(text, ARABIC, `${op.op}: ${text}`);
        // English display never shows raw Arabic names (§2.1 auto English); these samples carry no Arabic free text.
        else assert.doesNotMatch(text, ARABIC, `${op.op}: ${text}`);
        seen.add(text);
      }
      assert.ok(seen.size >= VARIANTS.length - 2, 'variants get distinct descriptions');
    });
  }

  test('describeProposal counts every op and flags destructive proposals', () => {
    const p = proposal('describeall', Object.values(SAMPLES));
    for (const lang of ['ar', 'en']) {
      const d = describeProposal(p, g, lang);
      assert.equal(d.lines.length, p.ops.length);
      assert.equal(Object.values(d.counts).reduce((a, b) => a + b, 0), p.ops.length);
      assert.equal(d.destructive, true);
      assert.ok(d.title.length > 0 && d.title.length <= 100, d.title);
    }
    assert.equal(describeProposal(proposal('describeone', [SAMPLES.mark]), g, 'en').destructive, false);
  });
});

// =========================================================================================================
// (c) The real data file

describe('(c) the real data/family.json', () => {
  test('normalizes, validates (stored and normalized forms), builds a graph; branches are سالم and محمد علي', () => {
    const raw = rawData();
    assert.equal(raw.schema, 1);
    const vRaw = validateData(raw);
    assert.equal(vRaw.ok, true, JSON.stringify(vRaw.errors.slice(0, 5)));
    const data = normalizeData(raw);
    const v = validateData(data);
    assert.equal(v.ok, true, JSON.stringify(v.errors.slice(0, 5)));
    assert.deepEqual(v.errors, []);
    // the warnings are data-quality hints only, never invariant errors
    for (const w of v.warnings) assert.ok(SCHEMA_ISSUE_CODES.includes(w.code), w.code);
    // compact ↔ normalized is lossless
    assert.deepEqual(normalizeData(compactData(data)), data);

    const g = buildGraph(data);
    assert.equal(g.people().length, Object.keys(raw.people).length);
    const branches = g.branches();
    assert.equal(branches.length, 2);
    assert.deepEqual(branches.map((b) => personName(b.person, 'ar')), ['سالم', 'محمد علي']);
    assert.equal(branches[0].person.id, raw.meta.rootPersonId, 'the root person’s branch comes first');
    for (const b of branches) {
      assert.equal(b.person.gender, 'm');
      assert.ok(b.label.ar && b.label.en && !ARABIC.test(b.label.en), JSON.stringify(b.label));
      assert.ok(b.count > 0);
    }
    const s = g.stats();
    assert.equal(s.people, g.people().length);
    assert.equal(s.branches, 2);
    // the two families meet: someone has an ancestor in each branch
    const meet = g.people().find((p) => branches.every((b) => g.isAncestor(b.person.id, p.id)));
    assert.ok(meet, 'a grandchild of both branches exists');
    const rel = findRelationship(g, meet.id, branches[1].person.id);
    assert.equal(rel.type, 'blood');
    assert.ok(relationLabel(rel, g, 'ar').length > 0 && relationLabel(rel, g, 'en').length > 0);
    // search finds the branch heads from typed Arabic and English
    assert.ok(g.search('محمد علي').some((r) => r.person.id === branches[1].person.id));
    assert.ok(g.search('Salem').some((r) => r.person.id === branches[0].person.id));
  });
});

// =========================================================================================================
// (d) + (e) Browser-like flow: sent proposal → dependent draft → final apply → serialized file

describe('(d)(e) browser flow: sent proposal, dependent draft, final apply, serialized file', () => {
  const raw = rawData();
  const g0 = buildGraph(normalizeData(raw));
  const me = pickVisitor(g0);

  // The proposal the visitor already sent on WhatsApp: a wife and a first child (refs from the browser counter).
  const SENT = proposal('sentprop01', [
    { op: 'add-person', ref: 'new101', person: { name: { ar: 'ريم' }, surname: { ar: 'القحطاني' }, gender: 'f', birth: { date: '1991' } },
      link: { as: 'spouse', of: me.id, marriage: { date: '2014' } }, unionRef: 'newu102' },
    { op: 'add-person', ref: 'new103', person: { name: { ar: 'عبد الله' }, gender: 'm', birth: { date: '2015' } },
      link: { as: 'child', of: me.id, with: 'new101' }, unionRef: 'newu102' },
  ], { submitter: { name: 'سامي', relation: 'حفيد', personId: me.id } });

  // The new draft: uses the sent proposal's refs (new101, new103, newu102).
  const DRAFT_OPS = [
    { op: 'add-person', ref: 'new104', person: { name: { ar: 'جود' }, gender: 'f', birth: { hijri: '1438' } },
      link: { as: 'child', union: 'newu102' }, unionRef: 'newu102' },
    { op: 'edit-person', id: 'new101', set: { 'occupation.ar': 'طبيبة' }, before: { 'occupation.ar': '' } },
    { op: 'reorder-children', union: 'newu102', order: ['new104', 'new103'] },
    { op: 'mark', id: me.id, mark: 'verified' },
  ];

  let draft = null; // the draft proposal as the store builds it
  let finalSent = null;
  let finalDraft = null;

  test('(d) the real store overlays the sent proposal and accepts a dependent draft (dependsOn added automatically)', () => {
    store.setData(raw, { silent: true });
    store.sent = [{ id: SENT.id, at: NOW, via: 'whatsapp', proposal: SENT }];
    store.clearDraft();
    // working graph = data + sent proposal (preview ids = refs)
    assert.ok(store.working.person('new101'), 'sent people appear in the working graph');
    assert.deepEqual(store.working.childrenOfUnion('newu102').map((p) => p.id), ['new103']);
    assert.equal(store.pendingKind('new101'), 'sent');
    assert.equal(store.isCreated('new103'), true);
    assert.equal(store.sentStale.size, 0);
    assert.equal(store.base.person('new101'), null, 'the canonical graph is untouched');

    // an op using an undeclared ref is refused and the draft stays empty
    const bad = store.addOps({ op: 'mark', id: 'new999', mark: 'verified' });
    assert.equal(bad.ok, false);
    assert.ok(codesOf(bad.errors).includes('UNKNOWN_REF'), JSON.stringify(bad.errors));
    assert.equal(store.draft.ops.length, 0);

    const r = store.addOps(DRAFT_OPS);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(store.draft.dependsOn, [SENT.id], 'refs of a sent proposal add it to dependsOn');
    assert.equal(store.draftErrors.length, 0);
    assert.deepEqual(store.working.childrenOfUnion('newu102').map((p) => p.id), ['new104', 'new103']);
    assert.equal(store.pendingKind('new104'), 'draft');
    assert.equal(store.working.person('new101').occupation.ar, 'طبيبة');
    assert.equal(store.working.person('new104').birth.date, '2016', 'Hijri 1438 → Gregorian year under year privacy');
    draft = store.draftProposal();
    assert.equal(validateProposal(draft, { refMap: { new101: 'new101', new103: 'new103', newu102: 'newu102' } }).ok, true);

    // The draft page describes the draft against the graph it applies to (data + sent proposals): people added
    // by the sent proposal are named, never shown as raw refs.
    const { data: base } = store.overlay(null);
    const g = buildGraph(base);
    const ctx = { graph: g, refNames: refNames(draft, g) };
    const ar = draft.ops.map((op) => describeOp(op, ctx, 'ar'));
    const en = draft.ops.map((op) => describeOp(op, ctx, 'en'));
    assert.match(ar[0], /«جود»/);
    assert.match(ar[1], /ريم/);
    assert.match(en[1], /Reem/);
    for (const line of [...ar, ...en]) assert.doesNotMatch(line, /\bnewu?\d+\b/, line);

    // removing the first draft op prunes the ops that depend on it (reorder names new104)
    const removed = store.removeOp(0);
    assert.equal(removed, 2);
    assert.deepEqual(store.draft.ops.map((o) => o.op), ['edit-person', 'mark']);
    store.clearDraft();
    assert.equal(store.working.person('new104'), null);
  });

  test('(d) the draft alone (sent proposal not applied) reports DEPENDS_ON_PENDING, rendered in both languages', () => {
    const r = applyProposal(raw, draft, { mode: 'preview', now: NOW });
    assert.equal(r.ok, false);
    const dep = r.errors.find((e) => e.code === 'DEPENDS_ON_PENDING');
    assert.ok(dep, JSON.stringify(r.errors));
    assert.equal(dep.params.proposalId, SENT.id);
    assert.equal(r.data, raw, 'atomic: data unchanged on failure');
    for (const lang of ['ar', 'en']) assert.doesNotMatch(formatIssue(dep, lang), GENERIC[lang]);
  });

  test('(d) both proposals travel as codes in one WhatsApp thread and keep their hashes', async () => {
    const codeA = await encodeProposal(SENT);
    const codeB = await encodeProposal(draft);
    const thread = `> ${codeA}\n\nوهذه الإضافة الثانية:\n\`\`\`\n${codeB.match(/.{1,40}/g).join('\n')}\n\`\`\``;
    const found = await extractProposal(thread, { ignoreQuoted: true });
    assert.deepEqual(found.proposal, draft);
    assert.equal(found.code, codeB);
    assert.equal(await proposalHash(found.proposal), await proposalHash(draft));
    // the same proposal pasted as raw JSON hashes the same as its code
    const viaJson = await decodeProposal(JSON.stringify(SENT, null, 2));
    assert.equal(await proposalHash(viaJson), await proposalHash(await decodeProposal(codeA)));
  });

  test('(d) final mode: the sent proposal, then the draft with refMap from the first idMap', () => {
    let n = 0;
    const idGen = (prefix) => `${prefix}int${String(++n).padStart(4, '0')}`;
    finalSent = applyProposal(raw, SENT, { mode: 'final', now: NOW, issue: 101, actor: 'owner', idGen });
    assert.equal(finalSent.ok, true, JSON.stringify(finalSent.errors));
    for (const ref of ['new101', 'new103', 'newu102']) assert.ok(ref in finalSent.idMap, ref);
    assert.ok(isPersonId(finalSent.idMap.new101) && isUnionId(finalSent.idMap.newu102));

    // without refMap the dependency is pending
    const pending = applyProposal(finalSent.data, draft, { mode: 'final', now: NOW, issue: 102 });
    assert.equal(pending.ok, false);
    assert.ok(codesOf(pending.errors).includes('DEPENDS_ON_PENDING'));

    finalDraft = applyProposal(finalSent.data, draft, {
      mode: 'final', now: NOW, issue: 102, actor: 'owner', idGen, refMap: { ...finalSent.idMap },
    });
    assert.equal(finalDraft.ok, true, JSON.stringify(finalDraft.errors));
    const wife = finalSent.idMap.new101;
    const union = finalSent.idMap.newu102;
    const jood = finalDraft.idMap.new104;
    assert.ok(isPersonId(jood));
    assert.deepEqual(finalDraft.data.unions[union].children, [jood, finalSent.idMap.new103]);
    assert.equal(finalDraft.data.people[wife].occupation.ar, 'طبيبة');
    assert.equal(finalDraft.data.meta.revision, raw.meta.revision + 2);
    assert.equal(finalDraft.data.people[me.id].history.at(-1).issue, 102);
    assert.equal(validateData(finalDraft.data).ok, true, 'strict validation: no temp ids remain');

    // the helper does the same chaining
    const both = applyProposals(raw, [SENT, draft], { mode: 'final', now: NOW });
    assert.equal(both.ok, true, JSON.stringify(both.errors));
    const u = both.refMap.newu102;
    assert.deepEqual(both.data.unions[u].children, [both.refMap.new104, both.refMap.new103]);

    // kinship over the final data
    const g = buildGraph(finalDraft.data);
    assert.equal(relationLabel(findRelationship(g, me.id, jood), g, 'ar'), 'ابنتك');
    assert.equal(relationLabel(findRelationship(g, jood, wife), g, 'en'), 'your mother');
  });

  test('(e) serializeData(final) re-validates and is stable', () => {
    const text = serializeData(finalDraft.data);
    assert.ok(text.endsWith('}\n'));
    assert.doesNotMatch(text, /"newu?\d+"|"tmpu\d+"/, 'no temp refs reach the file');
    const stored = JSON.parse(text);
    const v = validateData(stored);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.deepEqual(normalizeData(stored), finalDraft.data, 'serialize → normalize round-trips');
    assert.equal(serializeData(normalizeData(stored)), text, 'serialize is a fixed point');
    assert.equal(serializeData(finalDraft.data), text, 'deterministic');
    // living people's birth dates are stored with year precision only (privacy:"year" default)
    for (const ref of ['new101', 'new103']) assert.match(stored.people[finalSent.idMap[ref]].birth.date, /^\d{4}$/);
    // the stored (compact) file builds a graph with the new family in place
    const g = buildGraph(stored);
    assert.deepEqual(g.spouses(me.id).map((s) => s.person.id), [finalSent.idMap.new101]);
  });
});

// =========================================================================================================
// (f) Performance at 5,000 people

describe('(f) performance at 5,000 people', () => {
  const GIVEN_M = ['محمد', 'أحمد', 'عبد الله', 'خالد', 'سالم', 'حسن', 'علي', 'عمر', 'يوسف', 'إبراهيم', 'عبد الرحمن', 'سعيد'];
  const GIVEN_F = ['فاطمة', 'عائشة', 'مريم', 'نورة', 'هند', 'سارة', 'ليلى', 'زينب', 'خديجة', 'ريم'];
  const SURNAMES = ['الحربي', 'القحطاني', 'العتيبي', 'الشهري', 'الغامدي', 'الزهراني'];

  /** A wide synthetic family: each married man has a wife from outside and up to 4 children. */
  function synthetic(total = 5000) {
    const data = { schema: 1, meta: { rootPersonId: 'p00000', revision: 1 }, people: {}, unions: {} };
    let k = 0;
    let u = 0;
    const cycle = { m: 0, f: 0, surname: 0 }; // every name and surname is used many times
    const pid = () => `p${String(k++).padStart(5, '0')}`;
    const add = (gender, extra = {}) => {
      const id = pid();
      const names = gender === 'm' ? GIVEN_M : GIVEN_F;
      const name = names[cycle[gender]++ % names.length];
      data.people[id] = { id, name: { ar: name }, gender, birth: { date: String(1900 + (k % 120)) }, privacy: 'year', ...extra };
      return id;
    };
    const root = add('m', { surname: { ar: 'عالم' } });
    let frontier = [root];
    while (k < total && frontier.length) {
      const next = [];
      for (const man of frontier) {
        if (k >= total) break;
        const wife = add('f', { surname: { ar: SURNAMES[cycle.surname++ % SURNAMES.length] } });
        const kids = [];
        for (let c = 0; c < 4 && k < total; c++) kids.push(add(c % 2 ? 'f' : 'm'));
        const uid = `u${String(u++).padStart(5, '0')}`;
        data.unions[uid] = { id: uid, partners: [man, wife], children: kids, status: 'married' };
        next.push(...kids.filter((c) => data.people[c].gender === 'm'));
      }
      frontier = next;
    }
    return data;
  }

  const data = synthetic();
  const ms = (fn) => {
    const t0 = performance.now();
    const out = fn();
    return [out, performance.now() - t0];
  };

  test('buildGraph, search and a 50-op applyProposal each take < 1.5 s', () => {
    assert.ok(Object.keys(data.people).length >= 4990);
    const [g, buildMs] = ms(() => buildGraph(data));
    assert.ok(buildMs < 1500, `buildGraph took ${Math.round(buildMs)} ms`);
    assert.equal(g.people().length, Object.keys(data.people).length);

    const [hits, searchMs] = ms(() => [g.search('محمد'), g.search('Abdulrahman'), g.search('3li'), g.search('alharbi'), g.search('نوره')]);
    assert.ok(searchMs < 1500, `search took ${Math.round(searchMs)} ms`);
    for (const list of hits) assert.ok(list.length > 0 && list.length <= 30);

    const leaves = Object.keys(data.people).filter((id) => !g.children(id).length && g.person(id).gender === 'm').slice(0, 60);
    const ops = [];
    for (let i = 0; i < 20; i++) {
      ops.push({ op: 'add-person', ref: `new${i * 2 + 1}`, person: { name: { ar: 'غدير' }, gender: 'f', birth: { date: '2010' } },
        link: { as: 'spouse', of: leaves[i] }, unionRef: `newu${i * 2 + 2}` });
    }
    for (let i = 0; i < 15; i++) {
      ops.push({ op: 'add-person', ref: `new${100 + i}`, person: { name: { ar: 'تميم' }, gender: 'm' },
        link: { as: 'child', of: leaves[i], with: `new${i * 2 + 1}` }, unionRef: `newu${i * 2 + 2}` });
    }
    for (let i = 20; i < 30; i++) ops.push({ op: 'edit-person', id: leaves[i], set: { 'occupation.ar': 'معلم' } });
    for (let i = 30; i < 35; i++) ops.push({ op: 'mark', id: leaves[i], mark: 'verified' });
    assert.equal(ops.length, 50);
    const p = proposal('perfprop50', ops);
    for (const mode of ['preview', 'final']) {
      const [r, applyMs] = ms(() => applyProposal(data, p, { mode, now: NOW }));
      assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 3)));
      assert.ok(applyMs < 1500, `applyProposal (${mode}) took ${Math.round(applyMs)} ms`);
    }
  });
});

// =========================================================================================================
// (g) Core modules run unchanged in browsers and Node (§4): no Node-only imports, no DOM, no network, no storage

describe('(g) js/core is pure, portable ES modules', () => {
  const dir = new URL('../js/core/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();

  test('the spec’s core modules all exist', () => {
    for (const f of ['schema.js', 'dates.js', 'names.js', 'graph.js', 'ops.js', 'codec.js', 'describe.js', 'kinship.js', 'messages.js', 'translit.js']) {
      assert.ok(files.includes(f), f);
    }
  });

  for (const f of files) {
    test(`${f}: relative imports only, no Node/DOM/network/storage APIs, named exports only`, async () => {
      const src = readFileSync(new URL(f, dir), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '') // comments may mention these words
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      for (const m of src.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)) {
        assert.match(m[1], /^\.\/[a-z-]+\.js$/, `${f} imports ${m[1]}`);
        assert.ok(files.includes(m[1].slice(2)), `${f} imports missing ${m[1]}`);
      }
      assert.doesNotMatch(src, /\bimport\s*\(/, `${f}: no dynamic imports`);
      assert.doesNotMatch(src, /\brequire\s*\(|['"]node:/, `${f}: no Node modules`);
      assert.doesNotMatch(src, /\b(?:document|window|navigator|location|localStorage|sessionStorage|indexedDB|XMLHttpRequest)\b/, `${f}: no DOM/storage`);
      assert.doesNotMatch(src, /\bfetch\s*\(|\bprocess\.|\bBuffer\b|\b__dirname\b/, `${f}: no network/Node globals`);
      assert.doesNotMatch(src, /\bexport\s+default\b/, `${f}: named exports only`);
      const mod = await import(new URL(f, dir));
      assert.ok(Object.keys(mod).length > 0, `${f} exports something`);
    });
  }
});
