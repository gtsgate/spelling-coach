// Tests for js/core/describe.js — describeOp (every op and link variant, both languages, gender agreement),
// refNames, describeProposal.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizeData, OP_TYPES, REASON_CODES, MARKS } from '../js/core/schema.js';
import { buildGraph } from '../js/core/graph.js';
import { describeOp, describeProposal, refNames, opCategory } from '../js/core/describe.js';

const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../data/family.json', import.meta.url)), 'utf8'));
const data = normalizeData(raw);
const g = buildGraph(data);

// Real people used below.
const MUHAMMAD = 'p7cfv90d'; // محمد أحمد عالم (m), husband of زكية, father of هدى, سامي, …
const ZAKIYA = 'pciev8ne'; // زكية إسماعيل قربان (f)
const HUDA = 'pfrgn8rv'; // هدى محمد عالم (f)
const SAMI = 'p1jbadvl'; // سامي محمد عالم (m)
const KHADIJA = 'pr09lmw1'; // خديجة فتة (f)
const IBRAHIM = 'p5auw7sb'; // ابراهيم أحمد عالم (m)
const MAM = 'pptg72ck'; // محمد علي محمود
const IHSAN = 'p8ot12f8'; // إحسان قنديل
const U_MZ = 'ux7te3mf'; // محمد + زكية

const ctxFor = (ops) => ({ graph: g, refNames: refNames(ops, g) });
const both = (op, ctx) => [describeOp(op, ctx, 'ar'), describeOp(op, ctx, 'en')];

/** add-person op of a new person linked to someone. */
const add = (ref, person, link, extra = {}) => ({ op: 'add-person', ref, person, link, ...extra });

describe('describeOp: add-person links with gender agreement', () => {
  test('child: ابناً / ابنةً / إلى أبناء; both parents named', () => {
    const ops = [
      add('new1', { name: { ar: 'أحمد' }, gender: 'm' }, { as: 'child', of: MUHAMMAD, with: ZAKIYA }),
      add('new2', { name: { ar: 'سارة' }, gender: 'f' }, { as: 'child', of: MUHAMMAD, with: ZAKIYA }),
      add('new3', { name: { ar: 'رامي' } }, { as: 'child', of: MUHAMMAD }),
    ];
    const ctx = ctxFor(ops);
    assert.deepEqual(both(ops[0], ctx), [
      'إضافة «أحمد» ابناً لـ محمد أحمد عالم وزكية إسماعيل قربان',
      'Add “Ahmed” as son of Muhammad Ahmed Alem and Zakiya Ismail Qurban',
    ]);
    assert.deepEqual(both(ops[1], ctx), [
      'إضافة «سارة» ابنةً لـ محمد أحمد عالم وزكية إسماعيل قربان',
      'Add “Sara” as daughter of Muhammad Ahmed Alem and Zakiya Ismail Qurban',
    ]);
    assert.deepEqual(both(ops[2], ctx), ['إضافة «رامي» إلى أبناء محمد أحمد عالم', 'Add “Rami” as child of Muhammad Ahmed Alem']);
  });

  test('child of a union (existing or created earlier in the proposal via unionRef)', () => {
    const ops = [
      add('new1', { name: { ar: 'أحمد' }, gender: 'm' }, { as: 'child', of: MUHAMMAD, with: ZAKIYA }, { unionRef: 'newu2' }),
      add('new3', { name: { ar: 'سارة' }, gender: 'f' }, { as: 'spouse', of: 'new1' }, { unionRef: 'newu4' }),
      add('new5', { name: { ar: 'ليلى' }, gender: 'f' }, { as: 'child', union: 'newu4' }),
      add('new6', { name: { ar: 'هشام' }, gender: 'm' }, { as: 'child', union: U_MZ }),
    ];
    const ctx = ctxFor(ops);
    assert.deepEqual(both(ops[2], ctx), ['إضافة «ليلى» ابنةً لـ «أحمد» و«سارة»', 'Add “Laila” as daughter of “Ahmed” and “Sara”']);
    assert.deepEqual(both(ops[3], ctx), [
      'إضافة «هشام» ابناً لـ محمد أحمد عالم وزكية إسماعيل قربان',
      'Add “Hisham” as son of Muhammad Ahmed Alem and Zakiya Ismail Qurban',
    ]);
  });

  test('spouse: زوجاً / زوجةً, former spouse, marriage date', () => {
    const ops = [
      add('new1', { name: { ar: 'منى' }, gender: 'f' }, { as: 'spouse', of: SAMI, marriage: { date: '1995' } }),
      add('new2', { name: { ar: 'كمال' }, gender: 'm' }, { as: 'spouse', of: HUDA, status: 'divorced' }),
    ];
    const ctx = ctxFor(ops);
    assert.deepEqual(both(ops[0], ctx), [
      'إضافة «منى» زوجةً لـ سامي محمد عالم (تاريخ الزواج: 1995)',
      'Add “Mona” as wife of Sami Muhammad Alem (married 1995)',
    ]);
    assert.deepEqual(both(ops[1], ctx), ['إضافة «كمال» زوجاً سابقاً لـ هدى محمد عالم', 'Add “Kamal” as former husband of Huda Muhammad Alem']);
  });

  test('parent: والداً / والدةً; scope union lists the siblings who gain the parent; scope only', () => {
    const ops = [
      add('new1', { name: { ar: 'إسماعيل' }, gender: 'm' }, { as: 'parent', of: ZAKIYA }),
      add('new2', { name: { ar: 'نوال' }, gender: 'f' }, { as: 'parent', of: HUDA, scope: 'union' }),
      add('new3', { name: { ar: 'فهد' }, gender: 'm' }, { as: 'parent', of: HUDA, scope: 'only' }),
    ];
    const ctx = ctxFor(ops);
    assert.deepEqual(both(ops[0], ctx), ['إضافة «إسماعيل» والداً لـ زكية إسماعيل قربان', 'Add “Ismail” as father of Zakiya Ismail Qurban']);
    const [ar, en] = both(ops[1], ctx);
    assert.match(ar, /^إضافة «نوال» والدةً لـ هدى محمد عالم \(وكذلك سامي، أحمد، هيفاء، سلوى وهيام\)$/);
    assert.match(en, /^Add “Nawal” as mother of Huda Muhammad Alem \(and also of Sami, Ahmed, Haifa, Salwa and Hiyam\)$/);
    assert.deepEqual(both(ops[2], ctx), ['إضافة «فهد» والداً لـ هدى محمد عالم فقط', 'Add “Fahad” as father of Huda Muhammad Alem only']);
  });

  test('sibling: شقيقاً / شقيقةً (same parents), أخاً / أختاً من الأب / من الأم, other parent', () => {
    const ops = [
      add('new1', { name: { ar: 'منى' }, gender: 'f' }, { as: 'sibling', of: HUDA, share: 'both' }),
      add('new2', { name: { ar: 'كريم' }, gender: 'm' }, { as: 'sibling', of: HUDA, share: 'father' }),
      add('new3', { name: { ar: 'ريم' }, gender: 'f' }, { as: 'sibling', of: HUDA, share: 'mother', otherParent: MAM }),
      add('new4', { name: { ar: 'نادر' } }, { as: 'sibling', of: HUDA, share: 'father', otherParent: KHADIJA }),
    ];
    const ctx = ctxFor(ops);
    assert.deepEqual(both(ops[0], ctx), ['إضافة «منى» شقيقةً لـ هدى محمد عالم', 'Add “Mona” as sister of Huda Muhammad Alem (same father and mother)']);
    assert.deepEqual(both(ops[1], ctx), ['إضافة «كريم» أخاً لـ هدى محمد عالم من الأب', 'Add “Karim” as brother of Huda Muhammad Alem (same father)']);
    assert.deepEqual(both(ops[2], ctx), [
      'إضافة «ريم» أختاً لـ هدى محمد عالم من الأم (والدها محمد علي محمود)',
      'Add “Reem” as sister of Huda Muhammad Alem (same mother; father: Muhammad Ali Mahmoud)',
    ]);
    assert.deepEqual(both(ops[3], ctx), [
      'إضافة «نادر» إلى إخوة هدى محمد عالم من الأب (والدته خديجة فتة)',
      'Add “Nader” as sibling of Huda Muhammad Alem (same father; mother: Khadija Fatta)',
    ]);
  });

  test('no link, years, deceased, unknown and withheld names', () => {
    const ops = [
      add('new1', { name: { ar: 'سالم' }, gender: 'm', birth: { date: '1950' }, deceased: true, death: { date: '2010' } }),
      add('new2', { nameStatus: 'withheld', gender: 'f' }, { as: 'spouse', of: SAMI }),
      add('new3', { nameStatus: 'unknown', gender: 'm' }, { as: 'child', of: MUHAMMAD }),
      add('new4', { nameStatus: 'unknown', nickname: { ar: 'أم خالد' }, gender: 'f' }, { as: 'spouse', of: SAMI }),
      add('new5', { name: { ar: 'جود' }, gender: 'f', deceased: true }),
    ];
    const ctx = ctxFor(ops);
    assert.deepEqual(both(ops[0], ctx), ['إضافة «سالم» (1950–2010)', 'Add “Salem” (1950–2010)']);
    assert.deepEqual(both(ops[1], ctx), ['إضافة زوجة لـ سامي محمد عالم (الاسم محجوب)', 'Add a wife of Sami Muhammad Alem (name withheld)']);
    assert.deepEqual(both(ops[2], ctx), ['إضافة ابن لـ محمد أحمد عالم (الاسم غير معروف)', 'Add a son of Muhammad Ahmed Alem (name not known)']);
    assert.equal(describeOp(ops[3], ctx, 'ar'), 'إضافة «أم خالد» زوجةً لـ سامي محمد عالم');
    assert.deepEqual(both(ops[4], ctx), ['إضافة «جود» (متوفاة)', 'Add “Jood” (deceased)']);
  });
});

describe('describeOp: every other operation', () => {
  const ops = [
    { op: 'edit-person', id: MUHAMMAD, set: { 'birth.date': '1950-03-12', 'occupation.ar': 'معلم' }, before: { 'birth.date': '' } },
    { op: 'edit-person', id: HUDA, set: { deceased: true, privacy: 'year', gender: 'f', 'birth.approx': true, 'death.hijri': '1440' } },
    { op: 'mark', id: KHADIJA, mark: 'deceased', date: '2001' },
    { op: 'mark', id: KHADIJA, mark: 'living' },
    { op: 'mark', id: KHADIJA, mark: 'verified' },
    { op: 'mark', id: KHADIJA, mark: 'unverified' },
    { op: 'mark', id: KHADIJA, mark: 'needs-info', note: 'سنة الميلاد' },
    { op: 'mark', id: KHADIJA, mark: 'info-complete' },
    { op: 'mark', id: MUHAMMAD, mark: 'duplicate', of: IBRAHIM },
    { op: 'mark', id: MUHAMMAD, mark: 'not-duplicate' },
    { op: 'mark', id: KHADIJA, mark: 'private' },
    { op: 'link-spouse', a: IBRAHIM, b: IHSAN, status: 'divorced', marriage: { date: '1975' } },
    { op: 'move-person', id: IBRAHIM, to: { of: MAM, with: IHSAN } },
    { op: 'move-person', id: IBRAHIM, to: { union: U_MZ } },
    { op: 'edit-union', union: U_MZ, set: { status: 'divorced', 'marriage.date': '1970' } },
    { op: 'reorder-children', union: U_MZ, order: ['pr5msmbf', HUDA] },
    { op: 'reorder-spouses', id: MAM, order: ['ulon6otj', 'udm1aocx'] },
    { op: 'add-tie', id: HUDA, type: 'milk-child-of', person: KHADIJA },
    { op: 'add-tie', id: SAMI, type: 'foster-child-of', person: KHADIJA },
    { op: 'restore-person', id: SAMI },
    { op: 'restore-union', union: U_MZ },
  ];
  const ctx = ctxFor(ops);
  const expected = [
    ['تعديل بيانات محمد أحمد عالم: تاريخ الميلاد: 12 مارس 1950؛ المهنة بالعربية: «معلم»',
      'Edit Muhammad Ahmed Alem: date of birth: 12 Mar 1950; occupation (Arabic): “معلم”'],
    null, // checked separately
    ['تسجيل وفاة خديجة فتة (تاريخ الوفاة: 2001)', 'Mark Khadija Fatta as deceased (died 2001)'],
    ['تسجيل أن خديجة فتة على قيد الحياة', 'Mark Khadija Fatta as living'],
    ['تأكيد صحة بيانات خديجة فتة', 'Mark the details of Khadija Fatta as verified'],
    ['إلغاء تأكيد بيانات خديجة فتة', 'Remove the verified mark from Khadija Fatta'],
    ['طلب معلومات ناقصة عن خديجة فتة: «سنة الميلاد»', 'Ask for missing information about Khadija Fatta: “سنة الميلاد”'],
    ['تسجيل اكتمال معلومات خديجة فتة', 'Mark the information about Khadija Fatta as complete'],
    ['تعليم محمد أحمد عالم كتكرار محتمل لـ ابراهيم أحمد عالم', 'Mark Muhammad Ahmed Alem as a possible duplicate of Ibrahim Ahmed Alem'],
    ['إلغاء علامة التكرار عن محمد أحمد عالم', 'Mark Muhammad Ahmed Alem as not a duplicate'],
    ['إخفاء اسم خديجة فتة وتفاصيلها الشخصية', 'Make Khadija Fatta private (name and personal details hidden)'],
    ['تسجيل زواج ابراهيم أحمد عالم وإحسان قنديل (زواج سابق؛ تاريخ الزواج: 1975)',
      'Link Ibrahim Ahmed Alem and Ihsan Qandil as spouses (former marriage; married 1975)'],
    ['تغيير والدَي ابراهيم أحمد عالم إلى محمد علي محمود وإحسان قنديل (حالياً: أحمد محمد عالم وخديجة فتة)',
      'Change the parents of Ibrahim Ahmed Alem to Muhammad Ali Mahmoud and Ihsan Qandil (now: Ahmed Muhammad Alem and Khadija Fatta)'],
    ['تغيير والدَي ابراهيم أحمد عالم إلى محمد أحمد عالم وزكية إسماعيل قربان (حالياً: أحمد محمد عالم وخديجة فتة)',
      'Change the parents of Ibrahim Ahmed Alem to Muhammad Ahmed Alem and Zakiya Ismail Qurban (now: Ahmed Muhammad Alem and Khadija Fatta)'],
    ['تعديل بيانات زواج محمد أحمد عالم وزكية إسماعيل قربان: حالة الزواج: طلاق؛ تاريخ الزواج: 1970',
      'Edit the marriage of Muhammad Ahmed Alem and Zakiya Ismail Qurban: marriage status: divorced; date of marriage: 1970'],
    ['إعادة ترتيب أبناء محمد أحمد عالم وزكية إسماعيل قربان: سلوى، هدى، سامي، أحمد، هيفاء، هيام',
      'Reorder the children of Muhammad Ahmed Alem and Zakiya Ismail Qurban: Salwa, Huda, Sami, Ahmed, Haifa, Hiyam'],
    ['إعادة ترتيب زوجات محمد علي محمود: عائشة، إحسان قنديل', 'Reorder the spouses of Muhammad Ali Mahmoud: Aisha, Ihsan Qandil'],
    ['تسجيل هدى محمد عالم ابنةً لـ خديجة فتة من الرضاعة', 'Record Huda Muhammad Alem as milk daughter of Khadija Fatta'],
    ['تسجيل سامي محمد عالم في كفالة خديجة فتة', 'Record Sami Muhammad Alem as foster son of Khadija Fatta (kafala)'],
    ['استعادة سامي محمد عالم', 'Restore Sami Muhammad Alem'],
    ['استعادة زواج محمد أحمد عالم وزكية إسماعيل قربان', 'Restore the marriage of Muhammad Ahmed Alem and Zakiya Ismail Qurban'],
  ];
  ops.forEach((op, i) => {
    if (!expected[i]) return;
    test(`${op.op}${op.mark ? ` ${op.mark}` : ''} #${i}`, () => assert.deepEqual(both(op, ctx), expected[i]));
  });

  test('edit values are labelled (enumerations, booleans, Hijri dates) and agree with gender', () => {
    const [ar, en] = both(ops[1], ctx);
    assert.equal(ar, 'تعديل بيانات هدى محمد عالم: الحياة أو الوفاة: متوفاة؛ خصوصية تاريخ الميلاد: السنة فقط؛ الجنس: أنثى؛ تقريب تاريخ الميلاد: تقريبي؛ وتعديل آخر');
    assert.equal(en, 'Edit Huda Muhammad Alem: living or deceased: deceased; birth-date privacy: year only; gender: female; approximate date of birth: approximate; and 1 more change');
    const hijri = describeOp({ op: 'edit-person', id: HUDA, set: { 'death.hijri': '1440-09-01', 'bio.ar': '' } }, ctx, 'ar');
    assert.equal(hijri, 'تعديل بيانات هدى محمد عالم: تاريخ الوفاة الهجري: 1 رمضان 1440 هـ (6 مايو 2019)؛ النبذة بالعربية: (تُمسح القيمة)');
  });

  test('the milk tie of a person of unknown gender stays neutral', () => {
    const op = { op: 'add-tie', id: 'pgza7wp1', type: 'milk-child-of', person: KHADIJA };
    assert.equal(describeOp(op, ctx, 'ar'), 'تسجيل أحد أبناء حسين أصغر من أبناء خديجة فتة بالرضاعة');
    assert.equal(describeOp(op, ctx, 'en'), 'Record child of Hussein Asghar as milk child of Khadija Fatta');
  });
});

describe('describeOp: removals show only the reason-code label', () => {
  const ops = [
    { op: 'remove-person', id: SAMI, reasonCode: 'entered-by-mistake' },
    { op: 'remove-person', id: HUDA, reasonCode: 'person-requested', redact: true },
    { op: 'unlink-spouse', union: 'ug0j2xdv', reasonCode: 'other' },
    { op: 'detach-person', id: IBRAHIM, reasonCode: 'wrong-parents' },
    { op: 'remove-tie', id: HUDA, type: 'milk-child-of', person: KHADIJA, reasonCode: 'duplicate' },
    { op: 'remove-tie', id: SAMI, type: 'foster-child-of', person: KHADIJA, reasonCode: 'other' },
    { op: 'merge-person', keep: MUHAMMAD, remove: 'p9w7ue6t', reasonCode: 'duplicate', parents: 'remove' },
  ];
  const ctx = ctxFor(ops);

  test('every removal op in both languages', () => {
    assert.deepEqual(ops.map((op) => both(op, ctx)), [
      ['حذف سامي محمد عالم (السبب: إدخال عن طريق الخطأ)', 'Remove Sami Muhammad Alem (reason: entered by mistake)'],
      ['حذف هدى محمد عالم مع مسح بياناتها الشخصية (السبب: بطلب من صاحب الشأن)',
        'Remove Huda Muhammad Alem and erase their personal details (reason: at the person’s own request)'],
      ['فك ارتباط الزواج بين مريم محمد عالم وعبدالملك زيني (السبب: سبب آخر)',
        'Unlink the marriage of Maryam Muhammad Alem and Abdulmalik Zaini (reason: other reason)'],
      ['فصل ابراهيم أحمد عالم عن أسرة أحمد محمد عالم وخديجة فتة (السبب: ربط بوالدين غير صحيحين)',
        'Detach Ibrahim Ahmed Alem from the family of Ahmed Muhammad Alem and Khadija Fatta (reason: linked to the wrong parents)'],
      ['إزالة رابطة الرضاعة بين هدى محمد عالم وخديجة فتة (السبب: إدخال مكرر)',
        'Remove the milk (nursing) tie between Huda Muhammad Alem and Khadija Fatta (reason: duplicate entry)'],
      ['إزالة رابطة الكفالة بين سامي محمد عالم وخديجة فتة (السبب: سبب آخر)',
        'Remove the foster (kafala) tie between Sami Muhammad Alem and Khadija Fatta (reason: other reason)'],
      ['دمج محمد صالح أبوغلية في محمد أحمد عالم (الشخص نفسه؛ السبب: إدخال مكرر؛ مع اعتماد والدَي محمد صالح أبوغلية)',
        'Merge Muhammad Saleh Abu Ghulia into Muhammad Ahmed Alem (the same person; reason: duplicate entry; keeping the parents of Muhammad Saleh Abu Ghulia)'],
    ]);
  });

  test('free text smuggled into a removal is never echoed; unknown codes read as "other reason"', () => {
    const secret = 'سبب عائلي خاص جداً';
    const op = { op: 'remove-person', id: SAMI, reasonCode: secret, reason: secret, note: secret };
    for (const lang of ['ar', 'en']) assert.ok(!describeOp(op, ctx, lang).includes(secret));
    assert.equal(describeOp(op, ctx, 'en'), 'Remove Sami Muhammad Alem (reason: other reason)');
    for (const code of REASON_CODES) {
      const text = describeOp({ op: 'unlink-spouse', union: U_MZ, reasonCode: code }, ctx, 'ar');
      assert.ok(!text.includes(code), text);
    }
  });

  test('merging two people with the same display name tells them apart by id', () => {
    const text = describeOp({ op: 'merge-person', keep: HUDA, remove: HUDA, reasonCode: 'duplicate' }, ctx, 'en');
    assert.match(text, /^Merge Huda Muhammad Alem \(pfrgn8rv\) into Huda Muhammad Alem \(pfrgn8rv\)/);
  });
});

describe('describeOp: coverage, robustness, plain text', () => {
  const sample = {
    'add-person': add('new1', { name: { ar: 'أحمد' }, gender: 'm' }, { as: 'child', of: MUHAMMAD }),
    'edit-person': { op: 'edit-person', id: MUHAMMAD, set: { 'name.en': 'Mohamed' } },
    mark: { op: 'mark', id: MUHAMMAD, mark: 'verified' },
    'link-spouse': { op: 'link-spouse', a: MUHAMMAD, b: KHADIJA },
    'move-person': { op: 'move-person', id: SAMI, to: { of: MAM } },
    'edit-union': { op: 'edit-union', union: 'u5naa4pt', set: { 'note.ar': 'ملاحظة' } },
    'reorder-children': { op: 'reorder-children', union: U_MZ, order: [] },
    'reorder-spouses': { op: 'reorder-spouses', id: HUDA, order: [] },
    'add-tie': { op: 'add-tie', id: SAMI, type: 'milk-child-of', person: KHADIJA },
    'restore-person': { op: 'restore-person', id: SAMI },
    'restore-union': { op: 'restore-union', union: U_MZ },
    'remove-person': { op: 'remove-person', id: SAMI, reasonCode: 'other' },
    'unlink-spouse': { op: 'unlink-spouse', union: U_MZ, reasonCode: 'other' },
    'detach-person': { op: 'detach-person', id: SAMI, reasonCode: 'other' },
    'remove-tie': { op: 'remove-tie', id: SAMI, type: 'milk-child-of', person: KHADIJA, reasonCode: 'other' },
    'merge-person': { op: 'merge-person', keep: MUHAMMAD, remove: SAMI, reasonCode: 'duplicate' },
  };

  test('every op type of schema.js has a description in both languages', () => {
    for (const type of OP_TYPES) {
      assert.ok(sample[type], `no sample for ${type}`);
      for (const lang of ['ar', 'en']) {
        const text = describeOp(sample[type], { graph: g }, lang);
        assert.ok(text.length > 5, `${type} ${lang}`);
        assert.ok(!/^Unknown change|^تعديل غير معروف/.test(text), `${type} ${lang}: ${text}`);
      }
    }
    assert.ok(MARKS.length === 9);
  });

  test('plain text only: no HTML/markdown introduced, no undefined, single line', () => {
    const all = [...Object.values(sample),
      { op: 'mark', id: 'pnobody', mark: 'deceased' },
      add('new9', {}, { as: 'parent', of: 'new8' }),
      { op: 'edit-union', union: 'newu7', set: {} },
      { op: 'move-person', id: 'new2', to: { union: 'newu3' } }];
    for (const op of all) {
      for (const lang of ['ar', 'en']) {
        for (const ctx of [{ graph: g }, {}, { graph: null, refNames: null }]) {
          const text = describeOp(op, ctx, lang);
          assert.ok(!/[<>*_`#\n]|undefined|null|\[object/.test(text), `${op.op} ${lang}: ${text}`);
        }
      }
    }
  });

  test('unknown or malformed ops do not throw', () => {
    assert.equal(describeOp({ op: 'bogus' }, {}, 'en'), 'Unknown change (bogus)');
    assert.equal(describeOp({ op: 'bogus' }, {}, 'ar'), 'تعديل غير معروف (bogus)');
    assert.equal(describeOp(null, {}, 'en'), 'Unknown change (?)');
    assert.equal(describeOp({ op: 'add-person', link: 'nope' }, {}, 'en'), 'Add a person (name not known)');
    assert.equal(describeOp({ op: 'mark', id: MUHAMMAD, mark: 'shiny' }, { graph: g }, 'en'), 'Mark Muhammad Ahmed Alem (shiny)');
  });

  test('temp refs without refNames still read as new people', () => {
    assert.equal(describeOp({ op: 'mark', id: 'new4', mark: 'verified' }, { graph: g }, 'en'), 'Mark the details of a new person (new4) as verified');
    assert.equal(describeOp({ op: 'mark', id: 'new4', mark: 'verified' }, { graph: g }, 'ar'), 'تأكيد صحة بيانات فرد جديد (new4)');
  });

  test('opCategory', () => {
    assert.equal(opCategory('add-person'), 'add');
    assert.equal(opCategory('edit-union'), 'edit');
    assert.equal(opCategory('mark'), 'mark');
    assert.equal(opCategory('reorder-spouses'), 'arrange');
    assert.equal(opCategory('merge-person'), 'remove');
    assert.equal(opCategory('nope'), null);
  });
});

describe('refNames', () => {
  test('names temp people and the partners of temp unions', () => {
    const ops = [
      add('new1', { name: { ar: 'أحمد' }, gender: 'm' }, { as: 'child', of: MUHAMMAD, with: ZAKIYA }, { unionRef: 'newu2' }),
      add('new3', { name: { ar: 'سارة' }, gender: 'f' }, { as: 'spouse', of: 'new1' }, { unionRef: 'newu4' }),
      add('new5', { name: { ar: 'عمر' }, gender: 'm' }, { as: 'parent', of: HUDA }, { unionRef: 'newu6' }),
      add('new7', { name: { ar: 'رنا' }, gender: 'f' }, { as: 'sibling', of: HUDA, share: 'father', otherParent: 'new3' }, { unionRef: 'newu8' }),
      { op: 'link-spouse', a: SAMI, b: 'new3', unionRef: 'newu9' },
      { op: 'move-person', id: IBRAHIM, to: { of: 'new1', with: 'new3' }, unionRef: 'newu10' },
    ];
    const names = refNames({ ops }, g);
    assert.deepEqual(names.new1.person, ops[0].person);
    assert.equal(names.new1.op, 0);
    assert.deepEqual(names.newu2.partners, [MUHAMMAD, ZAKIYA]);
    assert.deepEqual(names.newu4.partners, ['new1', 'new3']);
    assert.deepEqual(names.newu6.partners, [MUHAMMAD, ZAKIYA, 'new5']);
    assert.deepEqual(names.newu8.partners, [MUHAMMAD, 'new3']);
    assert.deepEqual(names.newu9.partners, [SAMI, 'new3']);
    assert.deepEqual(names.newu10.partners, ['new1', 'new3']);
    // a Map works as refNames too
    const ctx = { graph: g, refNames: new Map(Object.entries(names)) };
    assert.equal(describeOp({ op: 'mark', id: 'new3', mark: 'verified' }, ctx, 'ar'), 'تأكيد صحة بيانات «سارة»');
  });
});

describe('describeProposal', () => {
  test('title, lines, counts and destructive', () => {
    const p = {
      ops: [
        add('new1', { name: { ar: 'أحمد' }, gender: 'm' }, { as: 'child', of: MUHAMMAD, with: ZAKIYA }, { unionRef: 'newu2' }),
        add('new3', { name: { ar: 'سارة' }, gender: 'f' }, { as: 'child', union: 'newu2' }),
      ],
    };
    const ar = describeProposal(p, g, 'ar');
    const en = describeProposal(p, g, 'en');
    assert.equal(ar.title, 'إضافة «أحمد» و«سارة» إلى عائلة محمد أحمد عالم');
    assert.equal(en.title, 'Add “Ahmed” and “Sara” to the family of Muhammad Ahmed Alem');
    assert.deepEqual(en.lines, [
      'Add “Ahmed” as son of Muhammad Ahmed Alem and Zakiya Ismail Qurban',
      'Add “Sara” as daughter of Muhammad Ahmed Alem and Zakiya Ismail Qurban',
    ]);
    assert.deepEqual(en.counts, { add: 2, edit: 0, mark: 0, arrange: 0, remove: 0 });
    assert.equal(en.destructive, false);
  });

  test('mixed proposals: counted summary with Arabic number agreement', () => {
    const base = [
      { op: 'edit-person', id: HUDA, set: { 'birth.date': '1980' } },
      { op: 'mark', id: HUDA, mark: 'verified' },
      { op: 'mark', id: HUDA, mark: 'needs-info', note: 'x' },
      { op: 'remove-person', id: SAMI, reasonCode: 'duplicate' },
    ];
    const r = describeProposal({ ops: base }, g, 'ar');
    assert.equal(r.title, 'تصحيح واحد، تحديثا حالة، عملية حذف واحدة — عائلة هدى محمد عالم');
    assert.equal(r.destructive, true);
    assert.deepEqual(r.counts, { add: 0, edit: 1, mark: 2, arrange: 0, remove: 1 });
    assert.equal(describeProposal({ ops: base }, g, 'en').title, '1 correction, 2 status updates, 1 removal — family of Huda Muhammad Alem');

    const many = [];
    for (let i = 1; i <= 12; i++) many.push(add(`new${i}`, { name: { ar: `ابن${i}` }, gender: 'm' }, { as: 'child', of: MUHAMMAD }));
    many.push({ op: 'edit-person', id: HUDA, set: { 'birth.date': '1980' } }, { op: 'edit-person', id: SAMI, set: { 'birth.date': '1981' } },
      { op: 'edit-person', id: MUHAMMAD, set: { 'birth.date': '1950' } });
    assert.equal(describeProposal({ ops: many }, g, 'ar').title, '12 فرداً جديداً، 3 تصحيحات — عائلة محمد أحمد عالم');
    assert.equal(describeProposal({ ops: many }, g, 'en').title, '12 new people, 3 corrections — family of Muhammad Ahmed Alem');
    assert.equal(describeProposal({ ops: many.slice(0, 5).concat(many.slice(12, 14)) }, g, 'ar').title,
      '5 أفراد جدد، تصحيحان — عائلة محمد أحمد عالم');
  });

  test('a single op uses its line as the title; empty proposals; titles are capped', () => {
    const one = describeProposal({ ops: [{ op: 'mark', id: HUDA, mark: 'verified' }] }, g, 'en');
    assert.equal(one.title, 'Mark the details of Huda Muhammad Alem as verified');
    assert.equal(describeProposal({ ops: [] }, g, 'ar').title, 'مقترح فارغ');
    assert.equal(describeProposal(null, g, 'en').title, 'Empty proposal');
    const long = { ops: [{ op: 'edit-person', id: HUDA, set: { 'bio.ar': 'نص طويل '.repeat(30), 'occupation.ar': 'م'.repeat(80) } }] };
    const t = describeProposal(long, g, 'ar').title;
    assert.ok(t.length <= 100, t);
    assert.ok(t.endsWith('…'));
  });

  test('works without a graph (names fall back to ids / quoted new names)', () => {
    const r = describeProposal({ ops: [add('new1', { name: { en: 'Omar' }, gender: 'm' }, { as: 'child', of: 'pabcdef1' })] }, null, 'en');
    assert.equal(r.title, 'Add “Omar” as son of pabcdef1');
  });
});
