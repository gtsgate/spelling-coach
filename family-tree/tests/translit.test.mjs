import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transliterate, englishOf, isAutoEnglish, autoEnglish } from '../js/core/translit.js';

test('owner-chosen default spelling: محمد → Muhammad (with or without tashkeel)', () => {
  assert.equal(transliterate('محمد'), 'Muhammad');
  assert.equal(transliterate('محمّد'), 'Muhammad');
  assert.equal(transliterate('محمدعلي'), 'Muhammad Ali');
});

test('compounds and particles', () => {
  const cases = {
    'عبد الرحمن': 'Abdulrahman', 'عبدالرحمن': 'Abdulrahman', 'عبد الإله': 'Abdulelah', 'عبدالحليم': 'Abdulhalim',
    'عماد الدين': 'Emad Al-Din', 'نور الدين': 'Nour Al-Din', 'أبو خالد': 'Abu Khalid', 'أم خالد': 'Umm Khalid',
    'محمد بن أحمد': 'Muhammad bin Ahmed', 'فاطمة بنت علي': 'Fatima bint Ali',
  };
  for (const [ar, en] of Object.entries(cases)) assert.equal(transliterate(ar), en, ar);
});

test('family names: dictionary, article, Al prefix, Abu glued', () => {
  assert.equal(transliterate('آل غالب', { kind: 'surname' }), 'Al Ghalib');
  assert.equal(transliterate('الحربي', { kind: 'surname' }), 'Al-Harbi');
  assert.equal(transliterate('الحوَتي', { kind: 'surname' }), 'Al-Hawati');
  assert.equal(transliterate('أبوغلية', { kind: 'surname' }), 'Abu Ghulia');
  assert.equal(transliterate('محمد مكي المرزوقي', { kind: 'surname' }), 'Muhammad Makki Al-Marzouqi');
  assert.match(transliterate('الزبيري', { kind: 'surname' }), /^Al-Z/);
});

test('spelling variants normalize (ة/ه, ى/ي, hamza forms)', () => {
  assert.equal(transliterate('فاطمه'), 'Fatima');
  assert.equal(transliterate('ابراهيم'), 'Ibrahim');
  assert.equal(transliterate('إبراهيم'), 'Ibrahim');
  assert.equal(transliterate('نوره'), 'Noura');
});

test('fallback produces capitalized Latin for unknown names and never throws', () => {
  for (const n of ['زمردة', 'قتيبة', 'شهلاء', 'غيث', 'هزاع', 'ضاري', 'ظافر', 'ء', 'ؤ', 'ـــ']) {
    const r = transliterate(n);
    assert.equal(typeof r, 'string');
    if (r) assert.match(r, /^[A-Z][A-Za-z' -]*$/, `${n} → ${r}`);
  }
  assert.equal(transliterate(''), '');
  assert.equal(transliterate('Mohammed'), 'Mohammed', 'Latin input unchanged');
});

test('stored English wins; auto only fills empty English', () => {
  assert.equal(englishOf({ ar: 'محمد', en: 'Mohamed' }), 'Mohamed');
  assert.equal(englishOf({ ar: 'محمد', en: '' }), 'Muhammad');
  assert.equal(englishOf({ ar: 'محمد' }), 'Muhammad');
  assert.equal(isAutoEnglish({ ar: 'محمد' }), true);
  assert.equal(isAutoEnglish({ ar: 'محمد', en: 'Mohamed' }), false);
  assert.deepEqual(autoEnglish({ name: { ar: 'علي' }, surname: { ar: 'عالم' } }), { name: 'Ali', surname: 'Alem', nickname: '' });
});

test('every name in the real data gets a sensible English spelling', () => {
  const data = JSON.parse(readFileSync(new URL('../data/family.json', import.meta.url), 'utf8'));
  for (const p of Object.values(data.people)) {
    for (const [field, kind] of [['name', 'given'], ['surname', 'surname'], ['nickname', 'given']]) {
      const f = p[field];
      if (!f || !f.ar) continue;
      const en = englishOf(f, kind);
      assert.match(en, /^[A-Z][A-Za-z' -]+$/, `${p.id} ${field} ${f.ar} → ${en}`);
    }
  }
});
