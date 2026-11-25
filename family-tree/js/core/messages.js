// Messages: human-readable Arabic and English text for every Issue code (validation errors and warnings of the
// data file, proposals, apply, codec), plus shared labels (fields, removal reasons, values) used by describe.js.
// Pure ES module — runs unchanged in modern browsers and Node ≥ 20 (no DOM, no fetch, no node: imports).
// See docs/SPEC.md §2.3 (Issue), §3 (proposal codes), §4 (codec, messages.js) and §6.
//
//   formatIssue(issue, lang, ctx?) → one line of plain text
//     issue = {code, params, op?, path?}; ctx = {graph?, refNames?, withOp = true}
//     With a graph, person ids in params are shown as names (lineage, e.g. "محمد أحمد عالم"); temp refs ("new3")
//     are named from ctx.refNames (describe.js#refNames). Without them the ids are shown.
//     When issue.op is a number the line starts with "Change 3: " / "التعديل 3: " (1-based) unless withOp is false.
//   formatIssues(list, lang, ctx?) → string[]
//   ISSUE_CODES  every code with text in both languages (spec §2.3/§3/§4/§6 + schema.js, ops.js, codec.js codes)
// Shared helpers (also used by describe.js):
//   fieldLabel(path, lang), reasonLabel(code, lang), valueLabel(path, value, lang), personLabel(ref, lang, ctx),
//   unionLabel(uid, lang, ctx), unionPartnerRefs(uid, ctx), findPerson(graph, id), findUnion(graph, id),
//   listText(items, lang, {max}), quote(text, lang)
//
// Arabic copy is natural MSA and gender-neutral toward the reader: no masculine imperatives (أضف، اختر، أرسل…);
// requests use "يُرجى" / verbal nouns. Removal reasons are only ever shown as their code's label.

import { fullName, lineageName } from './names.js';

// =========================================================================================================
// Shared small helpers

const langOf = (lang) => (lang === 'en' ? 'en' : 'ar');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Quote user text: “…” in English, «…» in Arabic. */
export function quote(text, lang = 'ar') {
  return langOf(lang) === 'en' ? `“${text}”` : `«${text}»`;
}

/**
 * Join a list naturally: "A, B and C" / "أ، ب وج". With `max`, the rest is summarised: "… and 3 more" /
 * "… و3 آخرين".
 */
export function listText(items, lang = 'ar', { max = 0 } = {}) {
  const L = langOf(lang);
  let list = (Array.isArray(items) ? items : []).map((x) => String(x ?? '')).filter(Boolean);
  let more = 0;
  if (max > 0 && list.length > max) {
    more = list.length - max;
    list = list.slice(0, max);
  }
  if (more) {
    if (L === 'en') list.push(`${more} more`);
    else list.push(more === 1 ? 'شخص آخر' : more === 2 ? 'شخصين آخرين' : `${more} آخرين`);
  }
  if (list.length <= 1) return list[0] || '';
  const last = list[list.length - 1];
  const head = list.slice(0, -1);
  return L === 'en' ? `${head.join(', ')} and ${last}` : `${head.join('، ')} و${last}`;
}

// Removed people / unions are invisible in a normal graph; describe & messages still need their names.
const removedIndex = new WeakMap();
function removedLookup(graph) {
  if (!graph || typeof graph !== 'object') return { people: new Map(), unions: new Map() };
  let idx = removedIndex.get(graph);
  if (!idx) {
    idx = {
      people: new Map((graph.removedPeople?.() || []).map((p) => [p.id, p])),
      unions: new Map((graph.removedUnions?.() || []).map((u) => [u.id, u])),
    };
    try { removedIndex.set(graph, idx); } catch { /* frozen primitive? no cache */ }
  }
  return idx;
}

/** A person record by id from the graph — visible, merged-into, or removed. */
export function findPerson(graph, id) {
  if (!graph || typeof id !== 'string') return null;
  return graph.person?.(id) || removedLookup(graph).people.get(id) || graph.resolve?.(id) || null;
}

/** A union record by id from the graph — visible or removed. */
export function findUnion(graph, id) {
  if (!graph || typeof id !== 'string') return null;
  return graph.union?.(id) || removedLookup(graph).unions.get(id) || null;
}

/** The entry of a temp ref in refNames (a plain object or a Map). */
function refEntry(refNames, ref) {
  if (!refNames || typeof ref !== 'string') return undefined;
  if (refNames instanceof Map) return refNames.get(ref);
  return Object.prototype.hasOwnProperty.call(refNames, ref) ? refNames[ref] : undefined;
}

/** Text of a refNames entry: a string, {ar, en}, a PersonInput, or {person: PersonInput}. */
function refText(entry, lang) {
  if (entry == null) return '';
  if (typeof entry === 'string') return entry;
  if (!isObj(entry)) return '';
  const input = isObj(entry.person) ? entry.person : entry;
  if (!('name' in input) && !('nickname' in input) && !('nameStatus' in input) && ('ar' in input || 'en' in input)) {
    return String((lang === 'en' ? input.en || input.ar : input.ar || input.en) || '').trim();
  }
  return fullName(input, lang);
}

// Relational labels names.js gives people whose name is unknown or withheld (English).
const EN_LABEL_RE = /^(?:Son|Daughter|Child|Wife|Husband|Spouse|Father|Mother|Parent) of (?=\S)|^Unknown\b/;

/**
 * Name of a person reference for messages: a temp ref → its quoted name from refNames ("«أحمد»"); an existing id →
 * its lineage name (given + father + family name) from the graph; otherwise the id itself.
 */
export function personLabel(ref, lang = 'ar', ctx = {}) {
  const L = langOf(lang);
  if (ref == null || ref === '') return '';
  if (typeof ref !== 'string') return String(ref);
  const entry = refEntry(ctx?.refNames, ref);
  if (entry !== undefined && !(isObj(entry) && Array.isArray(entry.partners))) {
    const t = refText(entry, L);
    return t ? quote(t, L) : (L === 'en' ? `a new person (${ref})` : `فرد جديد (${ref})`);
  }
  const p = findPerson(ctx?.graph, ref);
  if (p) {
    const text = lineageName(ctx.graph, p, L, { depth: 2, style: 'plain' });
    // English relational labels of unnamed people ("Child of X") are used inside sentences: lower-case them.
    if (text) return L === 'en' ? text.replace(EN_LABEL_RE, (m) => m.toLowerCase()) : text;
  }
  if (/^new[0-9]+$/.test(ref)) return L === 'en' ? `a new person (${ref})` : `فرد جديد (${ref})`;
  return ref;
}

/** Partner refs of a union: from the graph, or from refNames for a temp union ref ({partners:[…]}). */
export function unionPartnerRefs(uid, ctx = {}) {
  const entry = refEntry(ctx?.refNames, uid);
  if (isObj(entry) && Array.isArray(entry.partners)) return entry.partners.filter(Boolean);
  const u = findUnion(ctx?.graph, uid);
  return u && Array.isArray(u.partners) ? [...new Set(u.partners)] : null;
}

/** "A and B" / "A وB" for a union; "A" for a single-partner record; a neutral phrase otherwise. */
export function unionLabel(uid, lang = 'ar', ctx = {}) {
  const L = langOf(lang);
  const partners = unionPartnerRefs(uid, ctx);
  if (partners && partners.length) return listText(partners.map((p) => personLabel(p, L, ctx)), L);
  if (partners) {
    // A record with no partners (siblings whose parents are unknown): name its children.
    const u = findUnion(ctx?.graph, uid);
    const kids = (u?.children || []).map((c) => personLabel(c, L, ctx));
    if (kids.length) return L === 'en' ? `the siblings ${listText(kids, L, { max: 3 })}` : `الإخوة ${listText(kids, L, { max: 3 })}`;
  }
  return L === 'en' ? `family record ${uid || ''}`.trim() : `السجل العائلي ${uid || ''}`.trim();
}

// =========================================================================================================
// Field, reason and value labels

const FIELD_LABELS = {
  name: { en: 'name', ar: 'الاسم' },
  'name.ar': { en: 'Arabic name', ar: 'الاسم بالعربية' },
  'name.en': { en: 'English name', ar: 'الاسم بالإنجليزية' },
  nameStatus: { en: 'name status', ar: 'حالة الاسم' },
  surname: { en: 'family name', ar: 'اسم العائلة' },
  'surname.ar': { en: 'Arabic family name', ar: 'اسم العائلة بالعربية' },
  'surname.en': { en: 'English family name', ar: 'اسم العائلة بالإنجليزية' },
  nickname: { en: 'nickname', ar: 'الكنية أو اللقب' },
  'nickname.ar': { en: 'Arabic nickname', ar: 'الكنية أو اللقب بالعربية' },
  'nickname.en': { en: 'English nickname', ar: 'الكنية أو اللقب بالإنجليزية' },
  gender: { en: 'gender', ar: 'الجنس' },
  birth: { en: 'birth', ar: 'الميلاد' },
  'birth.date': { en: 'date of birth', ar: 'تاريخ الميلاد' },
  'birth.hijri': { en: 'Hijri date of birth', ar: 'تاريخ الميلاد الهجري' },
  'birth.approx': { en: 'approximate date of birth', ar: 'تقريب تاريخ الميلاد' },
  'birth.place': { en: 'place of birth', ar: 'مكان الميلاد' },
  'birth.place.ar': { en: 'place of birth (Arabic)', ar: 'مكان الميلاد بالعربية' },
  'birth.place.en': { en: 'place of birth (English)', ar: 'مكان الميلاد بالإنجليزية' },
  deceased: { en: 'living or deceased', ar: 'الحياة أو الوفاة' },
  death: { en: 'death', ar: 'الوفاة' },
  'death.date': { en: 'date of death', ar: 'تاريخ الوفاة' },
  'death.hijri': { en: 'Hijri date of death', ar: 'تاريخ الوفاة الهجري' },
  'death.approx': { en: 'approximate date of death', ar: 'تقريب تاريخ الوفاة' },
  'death.place': { en: 'place of death', ar: 'مكان الوفاة' },
  'death.place.ar': { en: 'place of death (Arabic)', ar: 'مكان الوفاة بالعربية' },
  'death.place.en': { en: 'place of death (English)', ar: 'مكان الوفاة بالإنجليزية' },
  occupation: { en: 'occupation', ar: 'المهنة' },
  'occupation.ar': { en: 'occupation (Arabic)', ar: 'المهنة بالعربية' },
  'occupation.en': { en: 'occupation (English)', ar: 'المهنة بالإنجليزية' },
  bio: { en: 'biography', ar: 'النبذة' },
  'bio.ar': { en: 'biography (Arabic)', ar: 'النبذة بالعربية' },
  'bio.en': { en: 'biography (English)', ar: 'النبذة بالإنجليزية' },
  photo: { en: 'photo', ar: 'الصورة' },
  privacy: { en: 'birth-date privacy', ar: 'خصوصية تاريخ الميلاد' },
  tags: { en: 'marks', ar: 'العلامات' },
  needsInfo: { en: 'missing-information note', ar: 'ملاحظة المعلومات الناقصة' },
  duplicateOf: { en: 'duplicate mark', ar: 'علامة التكرار' },
  spouseOrder: { en: 'order of spouses', ar: 'ترتيب الأزواج' },
  ties: { en: 'milk and foster ties', ar: 'روابط الرضاعة والكفالة' },
  removed: { en: 'removal record', ar: 'سجل الحذف' },
  history: { en: 'history', ar: 'السجل التاريخي' },
  id: { en: 'id', ar: 'المعرّف' },
  // unions
  partners: { en: 'spouses', ar: 'الزوجان' },
  children: { en: 'children', ar: 'الأبناء' },
  status: { en: 'marriage status', ar: 'حالة الزواج' },
  marriage: { en: 'marriage', ar: 'الزواج' },
  'marriage.date': { en: 'date of marriage', ar: 'تاريخ الزواج' },
  'marriage.hijri': { en: 'Hijri date of marriage', ar: 'تاريخ الزواج الهجري' },
  'marriage.approx': { en: 'approximate date of marriage', ar: 'تقريب تاريخ الزواج' },
  'marriage.place': { en: 'place of marriage', ar: 'مكان الزواج' },
  'marriage.place.ar': { en: 'place of marriage (Arabic)', ar: 'مكان الزواج بالعربية' },
  'marriage.place.en': { en: 'place of marriage (English)', ar: 'مكان الزواج بالإنجليزية' },
  divorce: { en: 'divorce', ar: 'الطلاق' },
  'divorce.date': { en: 'date of divorce', ar: 'تاريخ الطلاق' },
  'divorce.hijri': { en: 'Hijri date of divorce', ar: 'تاريخ الطلاق الهجري' },
  'divorce.approx': { en: 'approximate date of divorce', ar: 'تقريب تاريخ الطلاق' },
  note: { en: 'note', ar: 'الملاحظة' },
  'note.ar': { en: 'note (Arabic)', ar: 'الملاحظة بالعربية' },
  'note.en': { en: 'note (English)', ar: 'الملاحظة بالإنجليزية' },
  // proposals & operations
  ops: { en: 'changes', ar: 'التعديلات' },
  op: { en: 'kind of change', ar: 'نوع التعديل' },
  kind: { en: 'proposal kind', ar: 'نوع المقترح' },
  v: { en: 'format version', ar: 'إصدار الصيغة' },
  createdAt: { en: 'creation time', ar: 'وقت الإنشاء' },
  baseRevision: { en: 'data revision', ar: 'نسخة البيانات' },
  'submitter.name': { en: 'sender’s name', ar: 'اسم المرسل' },
  'submitter.relation': { en: 'sender’s relation', ar: 'صلة المرسل' },
  'submitter.personId': { en: 'sender in the tree', ar: 'المرسل في الشجرة' },
  ref: { en: 'new person reference', ar: 'مرجع الفرد الجديد' },
  unionRef: { en: 'family record reference', ar: 'مرجع السجل العائلي' },
  index: { en: 'position', ar: 'الترتيب' },
  link: { en: 'relation', ar: 'صلة القرابة' },
  'link.as': { en: 'relation', ar: 'صلة القرابة' },
  'link.of': { en: 'relative', ar: 'القريب' },
  'link.with': { en: 'other parent', ar: 'الوالد الآخر' },
  'link.union': { en: 'parents', ar: 'الوالدان' },
  'link.scope': { en: 'which children', ar: 'الأبناء المعنيون' },
  'link.share': { en: 'shared parents', ar: 'الوالدان المشتركان' },
  'link.otherParent': { en: 'other parent', ar: 'الوالد الآخر' },
  'link.status': { en: 'marriage status', ar: 'حالة الزواج' },
  to: { en: 'new parents', ar: 'الوالدان الجديدان' },
  'to.of': { en: 'new parent', ar: 'الوالد الجديد' },
  'to.with': { en: 'other new parent', ar: 'الوالد الجديد الآخر' },
  'to.union': { en: 'new parents', ar: 'الوالدان الجديدان' },
  order: { en: 'new order', ar: 'الترتيب الجديد' },
  beforeOrder: { en: 'previous order', ar: 'الترتيب السابق' },
  set: { en: 'changes', ar: 'التعديلات' },
  before: { en: 'previous values', ar: 'القيم السابقة' },
  mark: { en: 'mark', ar: 'العلامة' },
  of: { en: 'other person', ar: 'الشخص الآخر' },
  a: { en: 'first spouse', ar: 'الزوج الأول' },
  b: { en: 'second spouse', ar: 'الزوج الثاني' },
  keep: { en: 'person to keep', ar: 'الشخص المُبقى عليه' },
  parents: { en: 'parents to keep', ar: 'الوالدان المعتمدان' },
  redact: { en: 'erase personal details', ar: 'مسح البيانات الشخصية' },
  type: { en: 'kind of tie', ar: 'نوع الرابطة' },
  date: { en: 'date', ar: 'التاريخ' },
  hijri: { en: 'Hijri date', ar: 'التاريخ الهجري' },
  submitter: { en: 'sender', ar: 'المرسل' },
  dependsOn: { en: 'earlier proposals', ar: 'المقترحات السابقة' },
  reasonCode: { en: 'reason', ar: 'السبب' },
  meta: { en: 'tree information', ar: 'معلومات الشجرة' },
  schema: { en: 'data version', ar: 'إصدار البيانات' },
  people: { en: 'people', ar: 'الأفراد' },
  unions: { en: 'marriages', ar: 'الزيجات' },
};

/** Human label of a data field / edit path ("birth.date" → "date of birth" / "تاريخ الميلاد"). */
export function fieldLabel(path, lang = 'ar') {
  const L = langOf(lang);
  if (path == null || path === '') return '';
  let p = String(path);
  if (FIELD_LABELS[p]) return FIELD_LABELS[p][L];
  // "people.<id>.birth.date" / "unions.<id>.status" / "ties[2].person" → the record-relative part.
  p = p.replace(/^(?:people|unions)\.[^.]+\./, '').replace(/^ops\.\d+\./, '').replace(/\[\d+\]/g, '').replace(/\.\d+(?=\.|$)/g, '');
  if (FIELD_LABELS[p]) return FIELD_LABELS[p][L];
  // op-relative paths: "person.birth.date", "set.birth.date", "before.status", "link.marriage.date"
  const inner = p.replace(/^(?:person|set|before|link|to)\./, '');
  if (inner !== p && FIELD_LABELS[inner]) return FIELD_LABELS[inner][L];
  // longest known prefix: "ties.person" → "milk and foster ties"
  const parts = p.split('.');
  for (let n = parts.length - 1; n > 0; n--) {
    const k = parts.slice(0, n).join('.');
    if (FIELD_LABELS[k]) return FIELD_LABELS[k][L];
  }
  return String(path);
}

const REASON_LABELS = {
  duplicate: { en: 'duplicate entry', ar: 'إدخال مكرر' },
  'entered-by-mistake': { en: 'entered by mistake', ar: 'إدخال عن طريق الخطأ' },
  'wrong-parents': { en: 'linked to the wrong parents', ar: 'ربط بوالدين غير صحيحين' },
  'person-requested': { en: 'at the person’s own request', ar: 'بطلب من صاحب الشأن' },
  other: { en: 'other reason', ar: 'سبب آخر' },
};

/** Label of a removal reason code. Never free text: an unknown code reads as "other reason". */
export function reasonLabel(code, lang = 'ar') {
  const L = langOf(lang);
  return (REASON_LABELS[code] || REASON_LABELS.other)[L];
}

const VALUE_LABELS = {
  gender: { m: { en: 'male', ar: 'ذكر' }, f: { en: 'female', ar: 'أنثى' }, '': { en: 'not set', ar: 'غير محدد' } },
  nameStatus: {
    known: { en: 'known', ar: 'معروف' },
    unknown: { en: 'not known', ar: 'غير معروف' },
    withheld: { en: 'withheld', ar: 'محجوب' },
  },
  privacy: {
    full: { en: 'full date', ar: 'التاريخ كاملاً' },
    year: { en: 'year only', ar: 'السنة فقط' },
    hidden: { en: 'hidden', ar: 'مخفي' },
  },
  status: {
    married: { en: 'married', ar: 'زواج قائم' },
    divorced: { en: 'divorced', ar: 'طلاق' },
    widowed: { en: 'widowed', ar: 'ترمّل' },
    unknown: { en: 'unknown', ar: 'غير معروفة' },
  },
  deceased: { true: { en: 'deceased', ar: 'متوفى' }, false: { en: 'living', ar: 'على قيد الحياة' } },
  approx: { true: { en: 'approximate', ar: 'تقريبي' }, false: { en: 'exact', ar: 'دقيق' } },
};

/** Label of an enumerated value for a path (gender m → "male" / "ذكر"); null when the path is not enumerated. */
export function valueLabel(path, value, lang = 'ar') {
  const L = langOf(lang);
  const key = String(path || '').split('.').pop();
  const table = VALUE_LABELS[key] || (key === 'approx' ? VALUE_LABELS.approx : null);
  if (!table) return null;
  const entry = table[String(value ?? '')];
  return entry ? entry[L] : null;
}

const TIE_LABELS = {
  'milk-child-of': { en: 'milk (nursing)', ar: 'الرضاعة' },
  'foster-child-of': { en: 'foster (kafala)', ar: 'الكفالة' },
};

const KIND_LABELS = {
  person: { en: 'person', ar: 'شخص' },
  union: { en: 'marriage', ar: 'زواج' },
};

// =========================================================================================================
// Issue templates
//
// Each template is (h) => string, where h gives access to the params with formatting helpers:
//   h.p            raw params
//   h.P(key)       person name of params[key] (id or temp ref)
//   h.L(key, max)  list of person names (array of ids, or a single id)
//   h.U(key)       union label "A and B"
//   h.F(key)       field label of params[key] (a path)
//   h.Q(key)       quoted value · h.V(key) raw value text · h.has(key)
//   h.S()          the record an issue is about: person (params.id) or marriage (params.union) or path, "" if none
//   h.lead()       h.S() + ": " when there is a subject, else ""

/** DUPLICATE_REF / UNKNOWN_REF about a union ref ("newuN" or the unionRef field) rather than a new person. */
const isUnionRefIssue = (h) => h.p.field === 'unionRef' || (typeof h.p.ref === 'string' && /^newu\d+$/.test(h.p.ref));

const T = {
  // ---------------------------------------------------------------- data file: errors (schema.js)
  BAD_SCHEMA: {
    en: (h) => `The data file has format version ${h.V('found') || '?'}; version ${h.V('expected') || 1} was expected.`,
    ar: (h) => `إصدار تنسيق ملف البيانات ${h.V('found') || '؟'}، والمتوقع الإصدار ${h.V('expected') || 1}.`,
  },
  BAD_TYPE: {
    en: (h) => `${h.lead()}${h.F('field') ? `the “${h.F('field')}” value` : 'a value'} has the wrong type${h.has('expected') ? ` (expected ${h.V('expected')})` : ''}.`,
    ar: (h) => `${h.lead()}${h.F('field') ? `قيمة «${h.F('field')}»` : 'إحدى القيم'} من نوع غير صحيح${h.has('expected') ? ` (المتوقع: ${h.V('expected')})` : ''}.`,
  },
  ID_MISMATCH: {
    en: (h) => (h.has('key') ? `The record stored under “${h.V('key')}” has a different id (“${h.V('id')}”).` : 'A record is stored under a key that differs from its id.'),
    ar: (h) => (h.has('key') ? `السجل المحفوظ تحت المفتاح «${h.V('key')}» يحمل معرّفاً مختلفاً («${h.V('id')}»).` : 'أحد السجلات محفوظ تحت مفتاح يختلف عن معرّفه.'),
  },
  BAD_ID: {
    en: (h) => `${h.has('id') ? `“${h.V('id')}”` : 'This'} is not a valid ${KIND_LABELS[h.p.kind]?.en || 'record'} id.`,
    ar: (h) => `${h.has('id') ? `«${h.V('id')}»` : 'هذا'} ليس معرّف ${KIND_LABELS[h.p.kind]?.ar || 'سجل'} صالحاً.`,
  },
  NAME_REQUIRED: {
    en: (h) => `${h.lead()}a name or a nickname is required (or the name can be marked as not known).`,
    ar: (h) => `${h.lead()}يلزم ذكر الاسم أو الكنية (أو تحديد أن الاسم غير معروف).`,
  },
  NAME_SHOULD_BE_EMPTY: {
    en: (h) => `${h.lead()}the name must stay empty when it is marked as ${h.p.nameStatus === 'withheld' ? 'withheld' : 'not known'}.`,
    ar: (h) => `${h.lead()}يجب أن يبقى الاسم فارغاً ما دام ${h.p.nameStatus === 'withheld' ? 'محجوباً' : 'مسجّلاً كغير معروف'}.`,
  },
  BAD_ENUM: {
    en: (h) => `${h.lead()}${h.has('value') ? h.Q('value') : 'this value'} is not allowed${h.F('field') ? ` for the ${h.F('field')}` : ''}.`,
    ar: (h) => `${h.lead()}${h.has('value') ? h.Q('value') : 'هذه القيمة'} غير مسموح بها${h.F('field') ? ` في «${h.F('field')}»` : ''}.`,
  },
  BAD_DATE: {
    en: (h) => `${h.lead()}${h.has('value') ? `${h.Q('value')} is not a valid date` : 'the date is not valid'}${h.F('field') ? ` (${h.F('field')})` : ''} — dates are written as a year, year-month or year-month-day, e.g. 1950-03-12.`,
    ar: (h) => `${h.lead()}${h.has('value') ? `${h.Q('value')} ليس تاريخاً صحيحاً` : 'التاريخ غير صحيح'}${h.F('field') ? ` (${h.F('field')})` : ''} — يُكتب التاريخ سنةً، أو سنة-شهر، أو سنة-شهر-يوم، مثل 1950-03-12.`,
  },
  BAD_HIJRI: {
    en: (h) => `${h.lead()}${h.has('value') ? `${h.Q('value')} is not a valid Hijri date` : 'the Hijri date is not valid'} (year 1–1500, e.g. 1370 or 1370-09-01).`,
    ar: (h) => `${h.lead()}${h.has('value') ? `${h.Q('value')} ليس تاريخاً هجرياً صحيحاً` : 'التاريخ الهجري غير صحيح'} (السنة من 1 إلى 1500، مثل 1370 أو 1370-09-01).`,
  },
  BAD_PHOTO: {
    en: (h) => `${h.lead()}the photo must be an https link or a file in the photos folder.`,
    ar: (h) => `${h.lead()}يجب أن تكون الصورة رابطاً يبدأ بـ https أو ملفاً في مجلد الصور.`,
  },
  TOO_LONG: {
    en: (h) => `${h.lead()}the ${h.F('field') || 'text'} is too long${h.has('max') ? ` (at most ${h.V('max')}${h.has('length') ? `, now ${h.V('length')}` : ''})` : ''}.`,
    ar: (h) => `${h.lead()}«${h.F('field') || 'النص'}» أطول من المسموح${h.has('max') ? ` (الحد الأقصى ${h.V('max')}${h.has('length') ? `، والحالي ${h.V('length')}` : ''})` : ''}.`,
  },
  TOO_MANY_PARTNERS: {
    en: () => 'A marriage record can have at most two spouses.',
    ar: () => 'لا يمكن أن يضم سجل الزواج أكثر من زوجين.',
  },
  DUPLICATE_PARTNER: {
    en: (h) => `${h.P('person') || 'A person'} is listed twice in the same marriage.`,
    ar: (h) => `${h.P('person') || 'أحد الأشخاص'} مُدرج مرتين في الزواج نفسه.`,
  },
  DUPLICATE_CHILD: {
    en: (h) => `${h.P('person') || 'A child'} is listed twice among the same parents’ children.`,
    ar: (h) => `${h.P('person') || 'أحد الأبناء'} مُدرج مرتين بين أبناء الوالدين أنفسهم.`,
  },
  PARTNER_IS_CHILD: {
    en: (h) => `${h.P('person') || 'A person'} cannot be both a parent and a child in the same family record.`,
    ar: (h) => `لا يمكن أن يكون ${h.P('person') || 'الشخص'} من الوالدين ومن الأبناء في السجل العائلي نفسه.`,
  },
  MISSING_PERSON: {
    en: (h) => `${h.lead()}refers to a person who is not in the tree${h.has('ref') ? ` (${h.V('ref')})` : ''}.`,
    ar: (h) => `${h.lead()}يشير إلى شخص غير موجود في الشجرة${h.has('ref') ? ` (${h.V('ref')})` : ''}.`,
  },
  MISSING_UNION: {
    en: (h) => `${h.lead()}refers to a marriage record that does not exist${h.has('ref') ? ` (${h.V('ref')})` : ''}.`,
    ar: (h) => `${h.lead()}يشير إلى سجل زواج غير موجود${h.has('ref') ? ` (${h.V('ref')})` : ''}.`,
  },
  SELF_REFERENCE: {
    en: (h) => `${h.lead()}the ${h.F('field') || 'link'} cannot point to the same record.`,
    ar: (h) => `${h.lead()}لا يمكن أن يشير «${h.F('field') || 'الربط'}» إلى السجل نفسه.`,
  },
  DUPLICATE_TIE: {
    en: (h) => `This ${TIE_LABELS[h.p.type]?.en || 'milk/foster'} tie${h.two('id', 'person', 'en', ' between ')} is already recorded.`,
    ar: (h) => `رابطة ${TIE_LABELS[h.p.type]?.ar || 'الرضاعة أو الكفالة'}${h.two('id', 'person', 'ar', ' بين ')} مسجّلة من قبل.`,
  },
  MULTIPLE_BIRTH_UNIONS: {
    en: (h) => `${h.P('id') || 'A person'} is listed as a child of more than one set of parents.`,
    ar: (h) => `${h.P('id') || 'أحد الأشخاص'} مُدرج ضمن أبناء أكثر من أسرة واحدة.`,
  },
  CYCLE: {
    en: (h) => `This would make ${h.P('id') || 'someone'} their own ancestor, which is impossible.`,
    ar: (h) => `يؤدي هذا إلى أن يصبح ${h.P('id') || 'أحد الأشخاص'} من أسلاف نفسه، وهذا غير ممكن.`,
  },
  DUPLICATE_UNION: {
    en: (h) => (h.pair().length >= 2 ? `${listText(h.pair(), 'en')} are already linked as spouses.`
      : h.pair().length === 1 ? `${h.pair()[0]} already has a family record without a second parent.`
        : 'This couple is already linked as spouses.'),
    ar: (h) => (h.pair().length >= 2 ? `الزواج بين ${listText(h.pair(), 'ar')} مسجّل من قبل.`
      : h.pair().length === 1 ? `لدى ${h.pair()[0]} من قبل سجل عائلي لا يضم والداً آخر.`
        : 'هذا الزواج مسجّل من قبل.'),
  },
  ANCESTOR_LINK: {
    en: (h) => (h.P('ancestor') && h.P('descendant')
      ? `${h.P('ancestor')} is an ancestor of ${h.P('descendant')}, so they cannot be linked as spouses.`
      : 'One of them is an ancestor of the other, so they cannot be linked as spouses.'),
    ar: (h) => (h.P('ancestor') && h.P('descendant')
      ? `لا يمكن ربط ${h.P('ancestor')} و${h.P('descendant')} بزواج، لأن الأول من أصول الثاني.`
      : 'لا يمكن ربطهما بزواج، لأن أحدهما من أصول الآخر.'),
  },
  PRIVATE_DATE_STORED: {
    en: (h) => `${h.lead()}the date of birth is stored in more detail than its privacy setting allows.`,
    ar: (h) => `${h.lead()}تاريخ الميلاد محفوظ بتفصيل أكثر مما يسمح به إعداد الخصوصية.`,
  },

  // ---------------------------------------------------------------- data file: warnings (schema.js)
  UNKNOWN_FIELD: {
    en: (h) => `${h.lead()}${h.has('field') || h.has('key') ? `“${h.V('field') || h.V('key')}” is not a recognised field` : 'a field is not recognised'}.`,
    ar: (h) => `${h.lead()}${h.has('field') || h.has('key') ? `«${h.V('field') || h.V('key')}» ليس حقلاً معروفاً` : 'أحد الحقول غير معروف'}.`,
  },
  SPOUSE_ORDER_STALE: {
    en: (h) => `${h.lead()}the saved order of spouses mentions marriages that no longer apply.`,
    ar: (h) => `${h.lead()}ترتيب الأزواج المحفوظ يذكر زيجات لم تعد قائمة.`,
  },
  ROOT_MISSING: {
    en: () => 'The person the tree starts from is not set or no longer exists.',
    ar: () => 'الشخص الذي تبدأ منه الشجرة غير محدد أو لم يعد موجوداً.',
  },
  ROOT_REMOVED: {
    en: (h) => `The person the tree starts from${h.paren('id')} has been removed.`,
    ar: (h) => `تم حذف الشخص الذي تبدأ منه الشجرة${h.paren('id')}.`,
  },
  DEATH_BEFORE_BIRTH: {
    en: (h) => `${h.lead()}the date of death is before the date of birth.`,
    ar: (h) => `${h.lead()}تاريخ الوفاة يسبق تاريخ الميلاد.`,
  },
  BORN_BEFORE_PARENT_12: {
    en: (h) => `${h.P('id') || 'A child'} is recorded as born before ${h.P('parent') || 'a parent'} was 12 years old — please check the dates.`,
    ar: (h) => `تاريخ ميلاد ${h.P('id') || 'أحد الأبناء'} يسبق بلوغ ${h.P('parent') || 'أحد الوالدين'} سن الثانية عشرة — يُرجى التحقق من التواريخ.`,
  },
  BORN_AFTER_FATHER_DEATH: {
    en: (h) => `${h.P('id') || 'A child'} is recorded as born more than a year after the death of the father${h.paren('parent')}.`,
    ar: (h) => `تاريخ ميلاد ${h.P('id') || 'أحد الأبناء'} بعد وفاة الأب${h.paren('parent')} بأكثر من سنة.`,
  },
  BORN_AFTER_MOTHER_DEATH: {
    en: (h) => `${h.P('id') || 'A child'} is recorded as born after the death of the mother${h.paren('parent')}.`,
    ar: (h) => `تاريخ ميلاد ${h.P('id') || 'أحد الأبناء'} بعد وفاة الأم${h.paren('parent')}.`,
  },
  SIBLING_SAME_NAME: {
    en: (h) => `${h.two('a', 'b', 'en') || 'Two children'} are children of the same parents with the same name — is one of them a duplicate?`,
    ar: (h) => `${h.two('a', 'b', 'ar') || 'اثنان'} من أبناء الوالدين أنفسهم بالاسم نفسه — هل أحدهما مكرر؟`,
  },
  SAME_GENDER_PARTNERS: {
    en: (h) => `${h.U() ? `The spouses ${h.U()} are` : 'The two spouses are'} recorded with the same gender — please check.`,
    ar: (h) => `الزوجان${h.U() ? ` ${h.U()}` : ''} مسجّلان بالجنس نفسه — يُرجى التحقق.`,
  },
  PARENT_GENDER_UNKNOWN: {
    en: (h) => `The gender of a parent in the tree is not set${h.P('id') ? `: ${h.P('id')}` : ''}.`,
    ar: (h) => `لم يُحدَّد جنس أحد الوالدين في الشجرة${h.P('id') ? `: ${h.P('id')}` : ''}.`,
  },
  MARRIAGE_BEFORE_12: {
    en: (h) => `${h.marriage('en', true)} is dated before ${h.P('id') || 'one spouse'} was 12 years old — please check the dates.`,
    ar: (h) => `تاريخ ${h.marriage('ar')} يسبق بلوغ ${h.P('id') || 'أحد الزوجين'} سن الثانية عشرة — يُرجى التحقق من التواريخ.`,
  },
  MARRIAGE_AFTER_DEATH: {
    en: (h) => `${h.marriage('en', true)} is dated after the death of ${h.P('id') || 'one spouse'}.`,
    ar: (h) => `تاريخ ${h.marriage('ar')} بعد وفاة ${h.P('id') || 'أحد الزوجين'}.`,
  },
  WIDOWED_BUT_LIVING: {
    en: (h) => `${h.marriage('en', true)} is marked as widowed, but both spouses are recorded as living.`,
    ar: (h) => `${h.marriage('ar', true)} مسجّل كترمّل، لكن الزوجين كليهما مسجّلان على قيد الحياة.`,
  },
  CONCURRENT_HUSBANDS: {
    en: (h) => `${h.P('id') || 'A woman'} is recorded as currently married to more than one living husband — did an earlier marriage end?`,
    ar: (h) => `${h.P('id') || 'إحدى السيدات'} مسجّلة متزوجة حالياً من أكثر من زوج على قيد الحياة — هل انتهى زواج سابق؟`,
  },
  DIVORCE_DATE_WITHOUT_STATUS: {
    en: (h) => `${h.marriage('en', true)} has a divorce date but is not marked as divorced.`,
    ar: (h) => `${h.marriage('ar', true)} له تاريخ طلاق، لكنه غير مسجّل كطلاق.`,
  },
  SMALL_UNION: {
    en: (h) => `${h.U() ? `The family record of ${h.U()}` : 'A family record'} has fewer than two people.`,
    ar: (h) => `${h.U() ? `السجل العائلي لـ ${h.U()}` : 'أحد السجلات العائلية'} يضم أقل من شخصين.`,
  },

  // ---------------------------------------------------------------- proposals: references (§3.2)
  // Both codes also concern union refs (newuN): a unionRef bound to two different unions, or a union ref used
  // before any op created or found that union.
  DUPLICATE_REF: {
    en: (h) => (isUnionRefIssue(h)
      ? `The family reference${h.has('ref') ? ` “${h.V('ref')}”` : ''} is linked to two different families in this proposal.`
      : `The new person${h.has('ref') ? ` “${h.V('ref')}”` : ''} is declared twice in this proposal.`),
    ar: (h) => (isUnionRefIssue(h)
      ? `مرجع الأسرة${h.has('ref') ? ` «${h.V('ref')}»` : ''} مرتبط بأسرتين مختلفتين في هذا المقترح.`
      : `الفرد الجديد${h.has('ref') ? ` «${h.V('ref')}»` : ''} مُعرَّف مرتين في هذا المقترح.`),
  },
  UNKNOWN_REF: {
    en: (h) => (isUnionRefIssue(h)
      ? `${h.has('ref') ? `“${h.V('ref')}”` : 'A reference'} points to a new family (a couple or their children) that is not added earlier in this proposal.`
      : `${h.has('ref') ? `“${h.V('ref')}”` : 'A reference'} points to a new person who is not added earlier in this proposal.`),
    ar: (h) => (isUnionRefIssue(h)
      ? `${h.has('ref') ? `«${h.V('ref')}»` : 'أحد المراجع'} يشير إلى أسرة جديدة (زوجين أو أبنائهما) لم تسبق إضافتها في هذا المقترح.`
      : `${h.has('ref') ? `«${h.V('ref')}»` : 'أحد المراجع'} يشير إلى فرد جديد لم تسبق إضافته في هذا المقترح.`),
  },
  DEPENDS_ON_PENDING: {
    en: (h) => `This proposal builds on an earlier proposal${h.has('issue') ? ` (#${h.V('issue')})` : h.has('proposalId') ? ` (${h.V('proposalId')})` : ''} that has not been approved yet — that one needs approval first.`,
    ar: (h) => `يعتمد هذا المقترح على مقترح سابق${h.has('issue') ? ` (#${h.V('issue')})` : h.has('proposalId') ? ` (${h.V('proposalId')})` : ''} لم تتم الموافقة عليه بعد — تلزم الموافقة عليه أولاً.`,
  },
  UNKNOWN_ID: {
    en: (h) => `There is no person or record with the id${h.has('id') || h.has('ref') ? ` “${h.V('id') || h.V('ref')}”` : ' given'} in the tree.`,
    ar: (h) => `لا يوجد في الشجرة شخص أو سجل بالمعرّف${h.has('id') || h.has('ref') ? ` «${h.V('id') || h.V('ref')}»` : ' المذكور'}.`,
  },
  MERGED_REDIRECT: {
    en: (h) => (h.R('to') ? `${h.R('from') || 'This record'} was merged into ${h.R('to')}, so the change applies to ${h.R('to')}.`
      : 'This record was merged into another one, so the change applies to the merged record.'),
    ar: (h) => (h.R('to') ? `دُمج ${h.R('from') || 'هذا السجل'} مع ${h.R('to')}، فيُطبَّق التعديل على ${h.R('to')}.`
      : 'دُمج هذا السجل مع سجل آخر، فيُطبَّق التعديل على السجل المدموج فيه.'),
  },
  TARGET_REMOVED: {
    en: (h) => `${h.S() || 'This record'} has been removed from the tree.`,
    ar: (h) => `تم حذف ${h.S() || 'هذا السجل'} من الشجرة.`,
  },

  // ---------------------------------------------------------------- proposals: operations (§3.3 / §3.4)
  POSSIBLE_DUPLICATE: {
    en: (h) => `${h.P('ref') || 'This person'} may already be in the tree${h.P('id') ? ` as ${h.P('id')}` : ''}${DUP_REASONS[h.p.reason] ? ` (${DUP_REASONS[h.p.reason].en})` : ''} — please check before adding.`,
    ar: (h) => `قد ${h.his('ref', 'يكون', 'تكون')} ${h.P('ref') || 'هذا الشخص'} ${h.his('ref', 'موجوداً', 'موجودةً')} في الشجرة من قبل${h.P('id') ? ` باسم ${h.P('id')}` : ''}${DUP_REASONS[h.p.reason] ? ` (${DUP_REASONS[h.p.reason].ar})` : ''} — يُرجى التحقق قبل الإضافة.`,
  },
  MINOR_DETAIL: {
    en: (h) => `${h.subjectOr('This person')} is under 18: photo, biography, occupation, place of birth and the full date of birth are not published for minors.`,
    ar: (h) => `${h.subjectOr('هذا الشخص')} دون الثامنة عشرة: لا تُنشر للقاصرين الصورة والنبذة والمهنة ومكان الميلاد وتاريخ الميلاد الكامل.`,
  },
  NAME_LOOKS_FULL: {
    en: (h) => `${h.has('name') ? h.Q('name') : 'The name'} looks like a full name — the name field takes the first name only (e.g. Muhammad, Abdullah, Nour al-Din).`,
    ar: (h) => `${h.has('name') ? h.Q('name') : 'الاسم المدخل'} يبدو اسماً كاملاً — يُكتب في هذا الحقل الاسم الأول فقط (مثل: محمد، عبد الله، نور الدين).`,
  },
  GENDER_MISSING: {
    en: (h) => `The gender of ${h.subjectOr('the new person')} is not set.`,
    ar: (h) => `لم يُحدَّد جنس ${h.subjectOr('الفرد الجديد')}.`,
  },
  STALE_EDIT: {
    en: (h) => `${h.subjectOr('This record')} has changed since this proposal was prepared${h.F('path') || h.F('field') ? ` (${h.F('path') || h.F('field')})` : ''} — please review the change.`,
    ar: (h) => `تغيّرت بيانات ${h.subjectOr('هذا السجل')} منذ إعداد هذا المقترح${h.F('path') || h.F('field') ? ` (${h.F('path') || h.F('field')})` : ''} — يُرجى مراجعة التعديل.`,
  },
  GENDER_FLIPS_PARENT: {
    en: (h) => `Changing the gender of ${h.subjectOr('this person')} also changes how they appear as a parent (father or mother).`,
    ar: (h) => `تغيير جنس ${h.subjectOr('هذا الشخص')} يغيّر أيضاً ${h.his('id', 'صفته', 'صفتها')} بين الوالدين (أب أو أم).`,
  },
  SAME_PERSON: {
    en: () => 'A person cannot be linked to themselves.',
    ar: () => 'لا يمكن ربط الشخص بنفسه.',
  },
  INVALID_RELATION: {
    en: (h) => `${h.subjectOr('This person')} is one of the parents in that family, so cannot also be moved in as their child.`,
    ar: (h) => `${h.subjectOr('هذا الشخص')} من الوالدين في تلك الأسرة، فلا يمكن ${h.his('id', 'نقله', 'نقلها')} إلى أبنائها.`,
  },
  ORDER_IGNORED: {
    en: () => 'Some names in the new order are not part of this list and were ignored.',
    ar: () => 'تم تجاهل بعض الأسماء في الترتيب الجديد لأنها ليست ضمن هذه القائمة.',
  },
  RESTORE_CONFLICT: {
    en: (h) => `${h.p.reason === 'partner-removed' ? h.marriage('en', true) : (h.S() || 'This record')} cannot be restored: ${h.reason('en')}.`,
    ar: (h) => `لا يمكن استعادة ${h.p.reason === 'partner-removed' ? h.marriage('ar') : (h.S() || 'هذا السجل')}: ${h.reason('ar')}.`,
  },
  MERGED_USE_UNDO: {
    en: (h) => `${h.S() || 'This record'} was merged into ${h.R('mergedInto') || 'another record'}; a merge is reversed by the owner with /undo on the original proposal.`,
    ar: (h) => `تم دمج ${h.S() || 'هذا السجل'} مع ${h.R('mergedInto') || 'سجل آخر'}؛ والتراجع عن الدمج يكون من المشرف بالأمر ‎/undo على المقترح الأصلي.`,
  },
  IS_ROOT: {
    en: (h) => `${h.subjectOr('This person')} is the person the tree starts from and cannot be removed.`,
    ar: (h) => `${h.subjectOr('هذا الشخص')} هو الشخص الذي تبدأ منه الشجرة، ولا يمكن حذفه.`,
  },
  HAS_CHILDREN: {
    en: (h) => (h.has('union') && !h.has('id')
      ? `This marriage cannot be removed while it has children in the tree${h.kids('en')}.`
      : `${h.subjectOr('This person')} cannot be removed while they have children in the tree${h.kids('en')}.`),
    ar: (h) => (h.has('union') && !h.has('id')
      ? `لا يمكن إلغاء هذا الزواج لوجود أبناء منه في الشجرة${h.kids('ar')}.`
      : `لا يمكن حذف ${h.subjectOr('هذا الشخص')} لوجود أبناء ${h.his('id', 'له', 'لها')} في الشجرة${h.kids('ar')}.`),
  },
  ALREADY_REMOVED: {
    en: (h) => `${h.subjectOr('This record')} has already been removed.`,
    ar: (h) => `تم حذف ${h.subjectOr('هذا السجل')} من قبل.`,
  },
  MERGE_SPOUSES: {
    en: (h) => `${h.two('keep', 'remove', 'en') || 'These two people'} are married to each other, so they cannot be the same person.`,
    ar: (h) => `${h.two('keep', 'remove', 'ar') || 'هذان الشخصان'} زوجان، فلا يمكن أن يكونا الشخص نفسه.`,
  },
  GENDER_CONFLICT: {
    en: (h) => `${h.two('keep', 'remove', 'en') || 'These two people'} have different genders, so they cannot be merged.`,
    ar: (h) => `لا يمكن دمج ${h.two('keep', 'remove', 'ar') || 'هذين الشخصين'} لاختلاف الجنس.`,
  },
  CONFLICTING_PARENTS: {
    en: (h) => `${h.two('keep', 'remove', 'en') || 'These two people'} have different parents — the merge needs to say whose parents to keep.`,
    ar: (h) => (h.P('keep') && h.P('remove')
      ? `والدا ${h.P('keep')} غير والدَي ${h.P('remove')} — يلزم تحديد أيّ الوالدين يُعتمدان.`
      : 'لهذين الشخصين والدان مختلفان — يلزم تحديد أيّ الوالدين يُعتمدان.'),
  },
  MERGE_FIELD_CONFLICT: {
    en: (h) => `Merge: ${h.F('path') ? `the ${h.F('path')}` : 'a detail'} differs${h.has('keep') || h.has('remove') ? ` (${h.Q('keep')} and ${h.Q('remove')})` : ''}; the kept person’s value stays.`,
    ar: (h) => `عند الدمج: ${h.F('path') ? `«${h.F('path')}»` : 'إحدى المعلومات'} مختلفة${h.has('keep') || h.has('remove') ? ` (${h.Q('keep')} و${h.Q('remove')})` : ''}، وتبقى قيمة الشخص الذي يُحتفظ به.`,
  },
  TOO_MANY_DESTRUCTIVE: {
    en: (h) => `A proposal can include at most ${h.V('max') || 3} removals${h.has('count') ? ` (this one has ${h.V('count')})` : ''} — please send the rest in another proposal.`,
    ar: (h) => `الحد الأقصى لعمليات الحذف في المقترح الواحد ${h.V('max') || 3}${h.has('count') ? ` (وفي هذا المقترح ${h.V('count')})` : ''} — يُرجى إرسال الباقي في مقترح آخر.`,
  },
  TOO_MANY_MERGES: {
    en: (h) => `A proposal can include at most ${h.V('max') || 30} merges${h.has('count') ? ` (this one has ${h.V('count')})` : ''} — please send the rest in another proposal.`,
    ar: (h) => `الحد الأقصى لعمليات الدمج في المقترح الواحد ${h.V('max') || 30}${h.has('count') ? ` (وفي هذا المقترح ${h.V('count')})` : ''} — يُرجى إرسال الباقي في مقترح آخر.`,
  },
  TEMP_NOT_ALLOWED: {
    en: () => 'Removals and merges can only refer to people already in the tree, not to people added in this proposal.',
    ar: () => 'الحذف والدمج لا يكونان إلا لأشخاص موجودين في الشجرة، لا لمن أُضيفوا في هذا المقترح.',
  },
  PARENTS_FULL: {
    en: (h) => `${h.subjectOr('This person')} already has two parents recorded.`,
    ar: (h) => `لدى ${h.subjectOr('هذا الشخص')} والدان مسجّلان من قبل.`,
  },
  PARENT_GENDER_CONFLICT: {
    en: (h) => `${h.subjectOr('This person')} already has a ${h.p.gender === 'f' ? 'mother' : h.p.gender === 'm' ? 'father' : 'parent of that gender'} recorded; the new parent must be the other one.`,
    ar: (h) => `لدى ${h.subjectOr('هذا الشخص')} ${h.p.gender === 'f' ? 'أم مسجّلة' : h.p.gender === 'm' ? 'أب مسجّل' : 'والد من الجنس نفسه مسجّل'} من قبل؛ فيجب أن يكون الوالد الجديد من الجنس الآخر.`,
  },
  FATHER_UNKNOWN: {
    en: (h) => `${h.subjectOr('This person')} has no father recorded, so a sibling through the father cannot be added.`,
    ar: (h) => `لا يوجد أب مسجّل لـ ${h.subjectOr('هذا الشخص')}، فلا يمكن إضافة أخ أو أخت من جهة الأب.`,
  },
  MOTHER_UNKNOWN: {
    en: (h) => `${h.subjectOr('This person')} has no mother recorded, so a sibling through the mother cannot be added.`,
    ar: (h) => `لا توجد أم مسجّلة لـ ${h.subjectOr('هذا الشخص')}، فلا يمكن إضافة أخ أو أخت من جهة الأم.`,
  },
  REPARENT: {
    en: (h) => `Changing the parents of ${h.subjectOr('this person')} removes ${h.L('droppedParents') || 'a recorded parent'} as a parent${h.desc('en')}. This needs the separate deletion approval.`,
    ar: (h) => `تغيير والدَي ${h.subjectOr('هذا الشخص')} يلغي ${h.his('id', 'ارتباطه', 'ارتباطها')} بـ ${h.L('droppedParents') || 'أحد الوالدين المسجّلين'}${h.desc('ar')}، ويحتاج ذلك إلى موافقة الحذف المنفصلة.`,
  },
  DESTRUCTIVE_NOT_ALLOWED: {
    en: (h) => (h.p.reason === 'reparent'
      ? 'This change of parents drops a recorded parent, so it needs the separate deletion approval (approve-deletion).'
      : 'This proposal removes, unlinks or merges records, so it needs the separate deletion approval (approve-deletion).'),
    ar: (h) => (h.p.reason === 'reparent'
      ? 'تغيير الوالدين هذا يلغي ارتباطاً بأحد الوالدين المسجّلين، فيحتاج إلى موافقة الحذف المنفصلة (approve-deletion).'
      : 'يتضمن هذا المقترح حذفاً أو فك ارتباط أو دمجاً، فيحتاج إلى موافقة الحذف المنفصلة (approve-deletion).'),
  },

  // ---------------------------------------------------------------- proposal shape (validateProposal; generic)
  UNKNOWN_OP: {
    en: (h) => `Unknown kind of change${h.has('type') ? ` “${h.V('type')}”` : ''}.`,
    ar: (h) => `نوع تعديل غير معروف${h.has('type') ? ` «${h.V('type')}»` : ''}.`,
  },
  MISSING_FIELD: {
    en: (h) => `Required information is missing${h.F('field') ? `: ${h.F('field')}` : ''}.`,
    ar: (h) => `معلومات مطلوبة غير موجودة${h.F('field') ? `: ${h.F('field')}` : ''}.`,
  },
  BAD_REF: {
    en: (h) => `${h.has('value') ? h.Q('value') : 'This'} is not a valid reference to ${h.p.expected === 'union' ? 'a marriage record' : h.p.expected === 'person' ? 'a person' : 'a person or marriage'}${h.F('field') ? ` (${h.F('field')})` : ''}.`,
    ar: (h) => `${h.has('value') ? h.Q('value') : 'هذا'} ليس مرجعاً صالحاً ${h.p.expected === 'union' ? 'لسجل زواج' : h.p.expected === 'person' ? 'لشخص' : 'لشخص أو زواج'}${h.F('field') ? ` (${h.F('field')})` : ''}.`,
  },
  NOT_A_PROPOSAL: {
    en: () => 'This is not a family-tree proposal.',
    ar: () => 'هذا ليس مقترحاً لشجرة العائلة.',
  },
  BAD_VERSION: {
    en: (h) => `This proposal uses an unsupported format${h.has('found') ? ` (version ${h.V('found')})` : ''}; version ${h.V('expected') || 1} is expected.`,
    ar: (h) => `صيغة هذا المقترح غير مدعومة${h.has('found') ? ` (الإصدار ${h.V('found')})` : ''}؛ والمتوقع الإصدار ${h.V('expected') || 1}.`,
  },
  TIE_NOT_FOUND: {
    en: (h) => `There is no ${TIE_LABELS[h.p.type]?.en || 'milk/foster'} tie${h.two('id', 'person', 'en', ' between ')} to remove.`,
    ar: (h) => `لا توجد رابطة ${TIE_LABELS[h.p.type]?.ar || 'رضاعة أو كفالة'}${h.two('id', 'person', 'ar', ' بين ')} لإزالتها.`,
  },
  NOT_REMOVED: {
    en: (h) => `${h.S() || 'This record'} is not removed, so there is nothing to restore.`,
    ar: (h) => `لم يُحذف ${h.S() || 'هذا السجل'}، فلا حاجة إلى الاستعادة.`,
  },
  NOT_A_COUPLE: {
    en: () => 'This family record does not link two spouses, so there is no marriage to unlink.',
    ar: () => 'هذا السجل العائلي لا يضم زوجين، فلا يوجد زواج لفك ارتباطه.',
  },
  NO_PARENTS: {
    en: (h) => `${h.subjectOr('This person')} is not linked to any parents, so there is nothing to detach.`,
    ar: (h) => `لا يوجد والدان مسجّلان لـ ${h.subjectOr('هذا الشخص')}، فلا يوجد ما يُفصل.`,
  },
  NO_OPS: {
    en: () => 'This proposal contains no changes.',
    ar: () => 'لا يتضمن هذا المقترح أي تعديلات.',
  },
  TOO_MANY_OPS: {
    en: (h) => `A proposal can include at most ${h.V('max') || 150} changes${h.has('count') ? ` (this one has ${h.V('count')})` : ''} — please send the rest in another proposal.`,
    ar: (h) => `الحد الأقصى للتعديلات في المقترح الواحد ${h.V('max') || 150}${h.has('count') ? ` (وفي هذا المقترح ${h.V('count')})` : ''} — يُرجى إرسال الباقي في مقترح آخر.`,
  },

  // ---------------------------------------------------------------- codec (§4 codec.js)
  NO_PROPOSAL: {
    en: () => 'No proposal code was found in this text.',
    ar: () => 'لم يُعثر على رمز مقترح في هذا النص.',
  },
  BAD_CODE: {
    en: () => 'The proposal code is damaged — please copy it again in full, exactly as it was sent.',
    ar: () => 'رمز المقترح تالف — يُرجى نسخه مرة أخرى كاملاً كما أُرسل.',
  },
  BAD_JSON: {
    en: () => 'The proposal data could not be read.',
    ar: () => 'تعذّرت قراءة بيانات المقترح.',
  },
  TRUNCATED_CODE: {
    en: () => 'The proposal code is cut off (part of it is missing) — please copy the whole code again.',
    ar: () => 'رمز المقترح مقطوع (جزء منه مفقود) — يُرجى نسخ الرمز كاملاً مرة أخرى.',
  },
  TOO_LARGE: {
    en: () => 'The proposal is larger than allowed — please send it as several smaller proposals.',
    ar: () => 'المقترح أكبر من الحجم المسموح — يُرجى إرساله على شكل مقترحات أصغر.',
  },
};

/** Every Issue code with text in both languages. */
export const ISSUE_CODES = Object.freeze(Object.keys(T));

// Reasons of RESTORE_CONFLICT (codes of the broken invariant, or short words).
const RESTORE_REASONS = {
  MULTIPLE_BIRTH_UNIONS: { en: 'the person now has other parents in the tree', ar: 'للشخص الآن والدان آخران في الشجرة' },
  'birth-union': { en: 'the person now has other parents in the tree', ar: 'للشخص الآن والدان آخران في الشجرة' },
  parents: { en: 'the person now has other parents in the tree', ar: 'للشخص الآن والدان آخران في الشجرة' },
  DUPLICATE_UNION: { en: 'the same couple is already linked again', ar: 'الزوجان نفساهما مرتبطان بزواج آخر حالياً' },
  'duplicate-union': { en: 'the same couple is already linked again', ar: 'الزوجان نفساهما مرتبطان بزواج آخر حالياً' },
  ANCESTOR_LINK: { en: 'one spouse is now an ancestor of the other', ar: 'أحد الزوجين صار من أصول الآخر' },
  'ancestor-link': { en: 'one spouse is now an ancestor of the other', ar: 'أحد الزوجين صار من أصول الآخر' },
  CYCLE: { en: 'it would make someone their own ancestor', ar: 'سيجعل ذلك أحد الأشخاص من أسلاف نفسه' },
  cycle: { en: 'it would make someone their own ancestor', ar: 'سيجعل ذلك أحد الأشخاص من أسلاف نفسه' },
  'partner-removed': { en: 'a spouse in that marriage is removed', ar: 'أحد الزوجين في هذا الزواج محذوف' },
  'not-removed': { en: 'it is not removed', ar: 'السجل غير محذوف أصلاً' },
  'same-person': { en: 'it would link a person to themselves', ar: 'سيربط ذلك الشخص بنفسه' },
};

// Why add-person suspects a duplicate (ops.js POSSIBLE_DUPLICATE reason).
const DUP_REASONS = {
  'same-parents': { en: 'same name and same parents', ar: 'الاسم نفسه والوالدان أنفسهما' },
  'same-father': { en: 'same name and same father', ar: 'الاسم نفسه والأب نفسه' },
  'same-surname-year': { en: 'same name, family name and year of birth', ar: 'الاسم واسم العائلة وسنة الميلاد متقاربة' },
  'same-nickname-or-surname': { en: 'same name and nickname or family name', ar: 'الاسم نفسه والكنية أو اسم العائلة' },
};

// =========================================================================================================
// formatIssue

function valueText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (Array.isArray(v)) return v.map(valueText).join(', ');
  if (isObj(v)) {
    if ('ar' in v || 'en' in v) return String(v.ar || v.en || '');
    if ('date' in v || 'hijri' in v) return String(v.date || v.hijri || '');
    try { return JSON.stringify(v); } catch { return ''; }
  }
  return String(v);
}

function shorten(s, max = 60) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Helpers handed to templates (see the comment above T). */
function helpers(issue, L, ctx) {
  const p = isObj(issue.params) ? issue.params : {};
  // A param is present when it has a usable value (not empty, not NaN, not an empty list, not an empty object).
  const has = (k) => {
    const v = p[k];
    if (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (isObj(v)) return valueText(v) !== '';
    return true;
  };
  /** The id held by params[k] (a string, or the first string of a list), or null. */
  const idOf = (k) => {
    const v = Array.isArray(p[k]) ? p[k][0] : p[k];
    return typeof v === 'string' && v ? v : null;
  };
  const P = (k) => (idOf(k) ? personLabel(idOf(k), L, ctx) : '');
  const ids = (k) => (Array.isArray(p[k]) ? p[k] : has(k) ? [p[k]] : []).filter((x) => typeof x === 'string');
  const h = {
    p,
    has,
    P,
    L: (k, max = 5) => listText(ids(k).map((x) => personLabel(x, L, ctx)), L, { max }),
    /** Union label "A and B", or "" when the union is not given / not resolvable. */
    U: (k = 'union') => {
      if (typeof p[k] !== 'string' || !p[k]) return '';
      const refs = unionPartnerRefs(String(p[k]), ctx);
      return refs && refs.length ? unionLabel(String(p[k]), L, ctx) : '';
    },
    /** Label of a record id that may be a person or a union (MERGED_REDIRECT, MERGED_USE_UNDO). */
    R: (k) => {
      if (!has(k) || typeof p[k] !== 'string') return '';
      const id = p[k];
      const isUnion = findUnion(ctx?.graph, id) || /^(?:u|newu|tmpu)[a-z0-9]+$/.test(id);
      if (!isUnion) return P(k);
      const label = unionPartnerRefs(id, ctx)?.length ? unionLabel(id, L, ctx) : '';
      if (L === 'en') return label ? `the marriage of ${label}` : `marriage record ${id}`;
      return label ? `زواج ${label}` : `سجل الزواج ${id}`;
    },
    /** "A and B" for two person params (with a leading joiner, e.g. " between "), or "" if either is missing. */
    two: (k1, k2, lang, joiner = '') => (P(k1) && P(k2) ? `${joiner}${listText([P(k1), P(k2)], lang)}` : ''),
    /** " (name)" for an optional person param. */
    paren: (k) => (P(k) ? ` (${P(k)})` : ''),
    /** "the marriage of A and B" / "زواج A وB", or a neutral "this marriage". cap: sentence start. */
    marriage: (lang, cap = false) => {
      const u = h.U();
      if (lang === 'en') return u ? `${cap ? 'The' : 'the'} marriage of ${u}` : `${cap ? 'This' : 'this'} marriage`;
      return u ? `زواج ${u}` : 'هذا الزواج';
    },
    F: (k = 'field') => (typeof p[k] === 'string' && p[k] ? fieldLabel(p[k], L) : ''),
    V: (k) => (has(k) ? shorten(valueText(p[k])) : ''),
    Q: (k) => quote(has(k) ? shorten(valueText(p[k]), 40) : '', L),
    /** The record the issue is about: person (id / ref / person) or marriage (union). */
    S: () => {
      for (const k of ['id', 'ref', 'person']) if (typeof p[k] === 'string' && p[k]) return P(k);
      if (h.U()) return L === 'en' ? `the marriage of ${h.U()}` : `زواج ${h.U()}`;
      return '';
    },
    subjectOr: (fallback) => h.S() || fallback,
    /** Arabic third-person form agreeing with the gender of params[k] (masculine when unknown). */
    his: (k, m, f) => {
      const id = has(k) && typeof p[k] === 'string' ? p[k] : null;
      const entry = id ? refEntry(ctx?.refNames, id) : undefined;
      const g = (isObj(entry) ? (isObj(entry.person) ? entry.person.gender : entry.gender) : null) ?? findPerson(ctx?.graph, id)?.gender;
      return g === 'f' ? f : m;
    },
    lead: () => {
      const s = h.S();
      if (s) return `${s}: `;
      return issue.path && !has('field') ? `${fieldLabel(issue.path, L)}: ` : '';
    },
    /** The two people of a DUPLICATE_UNION (partners param, else the union's partners). */
    pair: () => {
      const list = ids('partners');
      const refs = list.length ? list : (has('union') ? unionPartnerRefs(String(p.union), ctx) || [] : []);
      return refs.map((x) => personLabel(x, L, ctx));
    },
    kids: (lang) => {
      const names = ids('children').map((x) => personLabel(x, L, ctx));
      if (!names.length) return '';
      return ` (${listText(names, lang, { max: 5 })})`;
    },
    desc: (lang) => {
      const d = p.descendants;
      const n = Array.isArray(d) ? d.length : Number.isFinite(d) ? d : 0;
      if (!n) return '';
      return lang === 'en' ? ` (${n} ${n === 1 ? 'descendant moves' : 'descendants move'} with them)` : ` (عدد الذرية المتأثرة: ${n})`;
    },
    reason: (lang) => {
      const r = p.reason;
      if (RESTORE_REASONS[r]) return RESTORE_REASONS[r][lang];
      if (typeof r === 'string' && T[r]) return T[r][lang](helpers({ code: r, params: {} }, lang, ctx)).replace(/\.$/, '');
      return lang === 'en' ? 'it would conflict with the tree as it is now' : 'يتعارض ذلك مع الشجرة بوضعها الحالي';
    },
  };
  return h;
}

/**
 * Plain-text message for an Issue in "ar" or "en". Unknown codes get a generic message that names the code.
 * ctx = {graph, refNames, withOp = true}.
 */
export function formatIssue(issue, lang = 'ar', ctx = {}) {
  const L = langOf(lang);
  if (!issue || typeof issue !== 'object') return '';
  const code = String(issue.code || '');
  const tpl = T[code];
  let text;
  if (tpl) {
    try {
      text = tpl[L](helpers(issue, L, ctx || {}));
    } catch {
      text = '';
    }
  }
  if (!text) {
    text = L === 'en' ? `Unexpected problem (${code || 'unknown'}).` : `مشكلة غير متوقعة (${code || 'غير معروفة'}).`;
  }
  text = text.replace(/\s+/g, ' ').trim();
  // English sentences may start with a lower-case phrase ("the marriage of …: …").
  if (L === 'en') {
    text = text.replace(/^(?:the|a|an|this|(?:son|daughter|child|wife|husband|spouse|father|mother|parent) of|unknown)\b/,
      (m) => m[0].toUpperCase() + m.slice(1));
  }
  if (ctx?.withOp !== false && Number.isInteger(issue.op) && issue.op >= 0) {
    text = L === 'en' ? `Change ${issue.op + 1}: ${text}` : `التعديل ${issue.op + 1}: ${text}`;
  }
  return text;
}

/** formatIssue over a list. */
export function formatIssues(list, lang = 'ar', ctx = {}) {
  return (Array.isArray(list) ? list : []).map((i) => formatIssue(i, lang, ctx));
}
