// Tests for js/core/messages.js — formatIssue for every Issue code (spec, schema.js, ops.js, codec.js), in Arabic
// and English, gender-neutral Arabic, names from the graph, labels.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ISSUE_CODES, formatIssue, formatIssues, fieldLabel, reasonLabel, valueLabel, listText, quote, personLabel, unionLabel,
} from '../js/core/messages.js';
import {
  SCHEMA_ISSUE_CODES, PERSON_EDIT_PATHS, UNION_EDIT_PATHS, REASON_CODES, normalizeData,
} from '../js/core/schema.js';
import { buildGraph } from '../js/core/graph.js';
import { refNames } from '../js/core/describe.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const real = buildGraph(normalizeData(JSON.parse(read('../data/family.json'))));

// ---------------------------------------------------------------------------------------------------------
// Codes named anywhere in SPEC.md (UPPER_SNAKE tokens that are not constants, plus the one-word codes).

const NOT_ISSUE_CODES = new Set([
  'DESTRUCTIVE_OPS', 'ISSUE_CODES', 'ISSUE_TEMPLATE', 'GITHUB_EVENT_PATH', 'NAME_STATUSES', 'PERSON_EDIT_PATHS',
  'REASON_CODES', 'SCHEMA_VERSION', 'TIE_TYPES', 'UNION_EDIT_PATHS', 'UNION_STATUSES', 'UPPER_SNAKE',
]);
const SPEC = read('../docs/SPEC.md');
const SPEC_CODES = [...new Set([
  ...(SPEC.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) || []).filter((c) => !NOT_ISSUE_CODES.has(c)),
  'CYCLE', 'REPARENT',
])].sort();

const GENERIC = { en: /^Unexpected problem/, ar: /^مشكلة غير متوقعة/ };
const ARABIC = /[؀-ۿ]/;

// Masculine imperatives that must not open an Arabic sentence addressed to the reader (§7.1).
const MASCULINE_IMPERATIVES = [
  'أضف', 'اختر', 'أرسل', 'اكتب', 'ابحث', 'اضغط', 'تعرّف', 'تعرف', 'انقر', 'أدخل', 'حدّد', 'حدد', 'راجع', 'تأكد', 'تأكّد',
  'انسخ', 'استخدم', 'قسّم', 'ألصق', 'الصق', 'اطلب', 'افتح', 'احذف', 'غيّر', 'اذهب', 'أعد', 'انتظر', 'تحقق', 'تحقّق',
];

/** First word of every clause (start, after . ؟ ! ؛ : — and opening brackets). */
function clauseStarts(text) {
  return text.split(/(?:^|[.؟!؛:—(]|\s-\s)\s*/u).map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
}

// Parameter sets: empty, typical (ids from the real data), and hostile types.
const TYPICAL = {
  id: 'p7cfv90d', person: 'pfrgn8rv', parent: 'pr09lmw1', a: 'p7cfv90d', b: 'pciev8ne', union: 'ux7te3mf',
  keep: 'p7cfv90d', remove: 'p9w7ue6t', ancestor: 'p7cfv90d', descendant: 'pfrgn8rv', children: ['pfrgn8rv', 'p1jbadvl'],
  droppedParents: ['pr09lmw1'], descendants: 4, field: 'birth.date', path: 'birth.date', value: '19x', ref: 'new3',
  type: 'milk-child-of', reason: 'cycle', max: 3, count: 5, found: 2, expected: 1, from: 'p9w7ue6t', to: 'p7cfv90d',
  proposalId: 'k3j9x0a2mq', partners: ['p7cfv90d', 'pciev8ne'], gender: 'f', name: 'محمد بن أحمد', mergedInto: 'p7cfv90d',
};
const HOSTILE = {
  id: 42, person: null, union: { x: 1 }, children: 'p7cfv90d', droppedParents: [null, 3], descendants: 'many',
  field: ['a', 'b'], value: { ar: 'قيمة' }, ref: undefined, max: NaN, count: null, partners: [], name: '',
};

describe('messages: coverage of every code', () => {
  test('SPEC.md names the codes we expect (sanity of the extraction)', () => {
    for (const c of ['DUPLICATE_REF', 'HAS_CHILDREN', 'TRUNCATED_CODE', 'CONCURRENT_HUSBANDS', 'REPARENT', 'CYCLE']) {
      assert.ok(SPEC_CODES.includes(c), c);
    }
    assert.ok(SPEC_CODES.length >= 50, `only ${SPEC_CODES.length} codes found`);
  });

  test('every code in SPEC.md has its own Arabic and English text', () => {
    for (const code of SPEC_CODES) {
      assert.ok(ISSUE_CODES.includes(code), `ISSUE_CODES misses ${code}`);
      const ar = formatIssue({ code, params: {} }, 'ar');
      const en = formatIssue({ code, params: {} }, 'en');
      assert.ok(!GENERIC.ar.test(ar) && ARABIC.test(ar), `${code} ar: ${ar}`);
      assert.ok(!GENERIC.en.test(en) && !ARABIC.test(en), `${code} en: ${en}`);
      assert.notEqual(ar, en);
    }
  });

  test('every code schema.js can emit is covered', () => {
    for (const code of SCHEMA_ISSUE_CODES) assert.ok(ISSUE_CODES.includes(code), code);
  });

  test('every code ops.js and codec.js can emit is covered', async (t) => {
    let ops;
    let codec;
    try {
      ops = await import('../js/core/ops.js');
      codec = await import('../js/core/codec.js');
    } catch (e) {
      t.skip(`ops.js / codec.js not loadable yet: ${e.message}`);
      return;
    }
    for (const code of ops.OPS_ISSUE_CODES || []) assert.ok(ISSUE_CODES.includes(code), `ops: ${code}`);
    for (const code of codec.CODEC_ERROR_CODES || []) assert.ok(ISSUE_CODES.includes(code), `codec: ${code}`);
    // and nothing in ISSUE_CODES is dead: each code is in the spec or emitted by a module
    const known = new Set([...SPEC_CODES, ...SCHEMA_ISSUE_CODES, ...(ops.OPS_ISSUE_CODES || []), ...(codec.CODEC_ERROR_CODES || [])]);
    for (const code of ISSUE_CODES) assert.ok(known.has(code), `unused message: ${code}`);
  });

  test('unknown codes get a generic message naming the code', () => {
    assert.equal(formatIssue({ code: 'WHATEVER_ELSE', params: {} }, 'en'), 'Unexpected problem (WHATEVER_ELSE).');
    assert.equal(formatIssue({ code: 'WHATEVER_ELSE' }, 'ar'), 'مشكلة غير متوقعة (WHATEVER_ELSE).');
    assert.equal(formatIssue({}, 'en'), 'Unexpected problem (unknown).');
    assert.equal(formatIssue(null, 'en'), '');
  });
});

describe('messages: quality of the text', () => {
  test('Arabic addressed to the reader is gender-neutral (no masculine imperative opens a sentence)', () => {
    for (const code of ISSUE_CODES) {
      for (const params of [{}, TYPICAL]) {
        const text = formatIssue({ code, params, op: 0 }, 'ar', { graph: real });
        for (const w of clauseStarts(text)) {
          assert.ok(!MASCULINE_IMPERATIVES.includes(w), `${code}: "${w}" in ${text}`);
        }
      }
    }
  });

  test('no placeholders leak (undefined, null, NaN, [object Object], empty quotes, double spaces)', () => {
    for (const code of ISSUE_CODES) {
      for (const params of [{}, TYPICAL, HOSTILE, undefined]) {
        for (const lang of ['ar', 'en']) {
          for (const ctx of [{}, { graph: real }]) {
            const text = formatIssue({ code, params }, lang, ctx);
            assert.ok(text.length > 10, `${code} ${lang}: ${text}`);
            assert.ok(!/undefined|\bnull\b|NaN|\[object|“”|«»|\(\)|\s{2}| [.,،؛]/.test(text), `${code} ${lang}: ${text}`);
          }
        }
      }
    }
  });

  test('every message ends with sentence punctuation', () => {
    for (const code of ISSUE_CODES) {
      for (const lang of ['ar', 'en']) {
        const text = formatIssue({ code, params: TYPICAL }, lang, { graph: real });
        assert.match(text, /[.?؟]$/, `${code} ${lang}: ${text}`);
      }
    }
  });
});

describe('messages: params rendered with names', () => {
  test('person ids become lineage names with a graph, ids without', () => {
    const issue = { code: 'IS_ROOT', params: { id: 'pg8caja6' } };
    assert.equal(formatIssue(issue, 'ar', { graph: real }), 'سالم عالم هو الشخص الذي تبدأ منه الشجرة، ولا يمكن حذفه.');
    assert.equal(formatIssue(issue, 'en', { graph: real }), 'Salem Alem is the person the tree starts from and cannot be removed.');
    assert.equal(formatIssue(issue, 'en'), 'pg8caja6 is the person the tree starts from and cannot be removed.');
  });

  test('HAS_CHILDREN lists the children and agrees with the person’s gender', () => {
    const he = formatIssue({ code: 'HAS_CHILDREN', params: { id: 'p7cfv90d', children: ['pfrgn8rv', 'p1jbadvl'] } }, 'ar', { graph: real });
    assert.equal(he, 'لا يمكن حذف محمد أحمد عالم لوجود أبناء له في الشجرة (هدى محمد عالم وسامي محمد عالم).');
    const she = formatIssue({ code: 'HAS_CHILDREN', params: { id: 'pr09lmw1', children: ['p7cfv90d'] } }, 'ar', { graph: real });
    assert.equal(she, 'لا يمكن حذف خديجة فتة لوجود أبناء لها في الشجرة (محمد أحمد عالم).');
    const union = formatIssue({ code: 'HAS_CHILDREN', params: { union: 'ux7te3mf', children: ['pfrgn8rv'] } }, 'en', { graph: real });
    assert.equal(union, 'This marriage cannot be removed while it has children in the tree (Huda Muhammad Alem).');
  });

  test('marriages are named by their partners', () => {
    const t = formatIssue({ code: 'WIDOWED_BUT_LIVING', params: { union: 'ux7te3mf' } }, 'ar', { graph: real });
    assert.equal(t, 'زواج محمد أحمد عالم وزكية إسماعيل قربان مسجّل كترمّل، لكن الزوجين كليهما مسجّلان على قيد الحياة.');
    assert.equal(formatIssue({ code: 'DUPLICATE_UNION', params: { union: 'uxx', partners: ['p7cfv90d', 'pciev8ne'] } }, 'en', { graph: real }),
      'Muhammad Ahmed Alem and Zakiya Ismail Qurban are already linked as spouses.');
    assert.equal(unionLabel('ux7te3mf', 'en', { graph: real }), 'Muhammad Ahmed Alem and Zakiya Ismail Qurban');
  });

  test('temp refs are named from refNames (quoted); unknown temp refs read as new people', () => {
    const ops = [{ op: 'add-person', ref: 'new3', person: { name: { ar: 'سارة' }, gender: 'f' } }];
    const ctx = { graph: real, refNames: refNames(ops, real) };
    assert.equal(formatIssue({ code: 'GENDER_MISSING', params: { id: 'new3' } }, 'ar', ctx), 'لم يُحدَّد جنس «سارة».');
    assert.equal(formatIssue({ code: 'GENDER_MISSING', params: { id: 'new3' } }, 'en', ctx), 'The gender of “Sara” is not set.');
    assert.equal(personLabel('new9', 'en', ctx), 'a new person (new9)');
    assert.equal(formatIssue({ code: 'POSSIBLE_DUPLICATE', params: { id: 'pfrgn8rv', ref: 'new3', reason: 'same-parents' } }, 'ar', ctx),
      'قد تكون «سارة» موجودةً في الشجرة من قبل باسم هدى محمد عالم (الاسم نفسه والوالدان أنفسهما) — يُرجى التحقق قبل الإضافة.');
  });

  test('merged records: a person or a marriage', () => {
    assert.equal(formatIssue({ code: 'MERGED_REDIRECT', params: { field: 'id', from: 'p9w7ue6t', to: 'p7cfv90d' } }, 'en', { graph: real }),
      'Muhammad Saleh Abu Ghulia was merged into Muhammad Ahmed Alem, so the change applies to Muhammad Ahmed Alem.');
    assert.equal(formatIssue({ code: 'MERGED_USE_UNDO', params: { union: 'ux7te3mf', mergedInto: 'u8leuyay' } }, 'en', { graph: real }),
      'The marriage of Muhammad Ahmed Alem and Zakiya Ismail Qurban was merged into the marriage of Ibrahim Ahmed Alem and Ilham Hassan Kabli; a merge is reversed by the owner with /undo on the original proposal.');
  });

  test('RESTORE_CONFLICT explains the reason; DESTRUCTIVE_NOT_ALLOWED distinguishes a change of parents', () => {
    assert.equal(formatIssue({ code: 'RESTORE_CONFLICT', params: { reason: 'duplicate-union', id: 'p7cfv90d' } }, 'en', { graph: real }),
      'Muhammad Ahmed Alem cannot be restored: the same couple is already linked again.');
    assert.equal(formatIssue({ code: 'RESTORE_CONFLICT', params: { reason: 'partner-removed', union: 'ux7te3mf', id: 'p7cfv90d' } }, 'ar', { graph: real }),
      'لا يمكن استعادة زواج محمد أحمد عالم وزكية إسماعيل قربان: أحد الزوجين في هذا الزواج محذوف.');
    assert.match(formatIssue({ code: 'DESTRUCTIVE_NOT_ALLOWED', params: { type: 'move-person', reason: 'reparent' } }, 'en'), /change of parents/);
  });

  test('field paths are shown as labels, also inside op paths', () => {
    assert.equal(formatIssue({ code: 'BAD_DATE', params: { field: 'person.birth.date', value: '1950-13-01' }, op: 1, path: 'ops.1.person.birth.date' }, 'en'),
      'Change 2: “1950-13-01” is not a valid date (date of birth) — dates are written as a year, year-month or year-month-day, e.g. 1950-03-12.');
    assert.equal(formatIssue({ code: 'TOO_LONG', params: { field: 'note', max: 2000, length: 2100 } }, 'ar'),
      '«الملاحظة» أطول من المسموح (الحد الأقصى 2000، والحالي 2100).');
    assert.equal(formatIssue({ code: 'STALE_EDIT', params: { id: 'pfrgn8rv', path: 'birth.date', expected: '1980', actual: '1981' } }, 'ar', { graph: real }),
      'تغيّرت بيانات هدى محمد عالم منذ إعداد هذا المقترح (تاريخ الميلاد) — يُرجى مراجعة التعديل.');
  });

  test('op prefix is 1-based and can be turned off; formatIssues maps a list', () => {
    const issue = { code: 'SAME_PERSON', params: {}, op: 4 };
    assert.equal(formatIssue(issue, 'en'), 'Change 5: A person cannot be linked to themselves.');
    assert.equal(formatIssue(issue, 'ar'), 'التعديل 5: لا يمكن ربط الشخص بنفسه.');
    assert.equal(formatIssue(issue, 'en', { withOp: false }), 'A person cannot be linked to themselves.');
    assert.deepEqual(formatIssues([issue, { code: 'NO_OPS' }], 'en', { withOp: false }),
      ['A person cannot be linked to themselves.', 'This proposal contains no changes.']);
  });

  test('real apply results from ops.js read naturally', async (t) => {
    let ops;
    try { ops = await import('../js/core/ops.js'); } catch (e) { t.skip(e.message); return; }
    const data = normalizeData(JSON.parse(read('../data/family.json')));
    const p = ops.newProposal();
    p.ops = [
      { op: 'add-person', ref: 'new1', person: { name: { ar: 'هدى' }, gender: 'f' }, link: { as: 'child', of: 'p7cfv90d', with: 'pciev8ne' } },
      { op: 'remove-person', id: 'p7cfv90d', reasonCode: 'other' },
    ];
    const r = ops.applyProposal(data, p, { mode: 'preview', now: '2026-11-25T00:00:00Z', allowDestructive: true });
    const ctx = { graph: real, refNames: refNames(p, real) };
    const texts = [...r.errors, ...r.warnings].map((i) => formatIssue(i, 'ar', ctx));
    assert.ok(texts.some((x) => x.startsWith('التعديل 2: لا يمكن حذف محمد أحمد عالم لوجود أبناء له في الشجرة')), texts.join('\n'));
    for (const i of [...r.errors, ...r.warnings]) {
      assert.ok(ISSUE_CODES.includes(i.code), i.code);
      assert.ok(!GENERIC.en.test(formatIssue(i, 'en', ctx)));
    }
  });
});

describe('messages: labels', () => {
  test('every edit path has a human label in both languages', () => {
    for (const path of [...PERSON_EDIT_PATHS, ...UNION_EDIT_PATHS]) {
      for (const lang of ['ar', 'en']) {
        const label = fieldLabel(path, lang);
        assert.ok(label && !label.includes('.'), `${path} ${lang}: ${label}`);
        assert.equal(ARABIC.test(label), lang === 'ar', `${path} ${lang}: ${label}`);
      }
    }
    assert.equal(fieldLabel('people.pabc.birth.date', 'en'), 'date of birth');
    assert.equal(fieldLabel('ops.3.set.marriage.place.ar', 'ar'), 'مكان الزواج بالعربية');
    assert.equal(fieldLabel('something.odd', 'en'), 'something.odd');
  });

  test('reason labels: every reason code, never free text', () => {
    for (const code of REASON_CODES) {
      for (const lang of ['ar', 'en']) {
        const label = reasonLabel(code, lang);
        assert.ok(label && label !== code, `${code} ${lang}`);
      }
    }
    assert.equal(reasonLabel('my private story', 'en'), 'other reason');
    assert.equal(reasonLabel(undefined, 'ar'), 'سبب آخر');
  });

  test('value labels', () => {
    assert.equal(valueLabel('gender', 'f', 'ar'), 'أنثى');
    assert.equal(valueLabel('privacy', 'year', 'en'), 'year only');
    assert.equal(valueLabel('status', 'widowed', 'ar'), 'ترمّل');
    assert.equal(valueLabel('birth.approx', true, 'en'), 'approximate');
    assert.equal(valueLabel('occupation.ar', 'x', 'en'), null);
  });

  test('listText and quote', () => {
    assert.equal(listText(['أ', 'ب', 'ج'], 'ar'), 'أ، ب وج');
    assert.equal(listText(['A', 'B', 'C'], 'en'), 'A, B and C');
    assert.equal(listText(['A'], 'en'), 'A');
    assert.equal(listText([], 'en'), '');
    assert.equal(listText(['A', 'B', 'C', 'D'], 'en', { max: 2 }), 'A, B and 2 more');
    assert.equal(listText(['أ', 'ب', 'ج'], 'ar', { max: 2 }), 'أ، ب وشخص آخر');
    assert.equal(listText(['أ', 'ب', 'ج', 'د', 'هـ'], 'ar', { max: 2 }), 'أ، ب و3 آخرين');
    assert.equal(quote('أحمد', 'ar'), '«أحمد»');
    assert.equal(quote('Ahmed', 'en'), '“Ahmed”');
  });
});

describe('core purity of kinship.js, describe.js, messages.js', () => {
  test('no node: imports, DOM, fetch or storage (they run unchanged in browsers)', () => {
    for (const f of ['kinship.js', 'describe.js', 'messages.js']) {
      const src = read(`../js/core/${f}`);
      assert.ok(!/from\s+['"]node:|require\(/.test(src), `${f} imports node modules`);
      assert.ok(!/\b(document|window|localStorage|sessionStorage|fetch)\s*[.(]/.test(src), `${f} uses browser/network APIs`);
      assert.ok(!/^export\s+default/m.test(src), `${f} has a default export`);
    }
  });
});
