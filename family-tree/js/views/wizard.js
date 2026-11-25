// Add my family (#/add-family?near=<pid>) — the growth flow, docs/SPEC.md §7.7.
//   Step 0 "Who are you?": (a) I'm in the tree → find me; (b) I'm not listed → find my father/mother → add me as
//          son/daughter; (c) I married into the family → find my spouse → add me as spouse.
//   Step 1 spouses of the focus person (confirm / inline rows, "+ another").
//   Step 2 children per union: inline repeatable rows [name · son/daughter · birth year م/هـ · living/deceased] on ONE
//          screen, "+ another child"; Step 3 = per child "add their family" (recursion: steps 1–2 for that child).
//   Step 4 (path c only, optional): your parents and siblings, with the public-data notice.
//   Step 5 review (describe lines) → #/draft for sending.
// Every step: Skip, and "Tell {owner} on WhatsApp instead (voice notes welcome)".
// Each committed row → store.addOps immediately (progress survives reloads). Wizard state lives in module variables
// (re-renders on store events keep input); the step and who-you-are persist in sessionStorage.
import { h, icon, bdi, toast, debounce } from '../dom.js';
import { t, register, lang } from '../i18n.js';
import { store } from '../store.js';
import { nameOf, lineageOf, yearsOf, avatar, badges, ownerName, whatsappUrl } from '../ui.js';
import { personPicker } from '../forms/picker.js';
import { transliterate } from '../core/translit.js';
import { toAsciiDigits, isValidDate, isValidHijri, gregorianToHijri } from '../core/dates.js';
import { skeletonKey, searchKey, looksLikeFullName } from '../core/names.js';
import { formatIssue } from '../core/messages.js';
import { refNames } from '../core/describe.js';
import { LIMITS } from '../core/schema.js';
import { draftSummary, preDraftGraph, opIcon } from './draft.js';
import { aboutText } from '../submit.js';

register({
  en: {
    'wiz.title': 'Add my family',
    'wiz.lead': 'A few quick steps: who you are, your spouse, then your children. Each entry is kept on this device as you go — nothing is sent until you choose to.',
    'wiz.step.who': 'Who are you?',
    'wiz.step.spouses': 'Spouse',
    'wiz.step.children': 'Children',
    'wiz.step.parents': 'Parents',
    'wiz.step.review': 'Review',
    'wiz.stepOf': 'Step {n} of {total}',
    'wiz.who.lead': 'Choose what describes you, then we build the family around you.',
    'wiz.who.in': 'I am in the tree',
    'wiz.who.inHint': 'Find my name, then add my spouse and children',
    'wiz.who.child': 'I am not listed yet',
    'wiz.who.childHint': 'My father or mother is in the tree',
    'wiz.who.spouse': 'I married into the family',
    'wiz.who.spouseHint': 'My husband or wife is in the tree',
    'wiz.who.continueAs': 'Continue as {name}',
    'wiz.who.continueHint': 'Add your spouse and children',
    'wiz.who.findSelf': 'Your name in the tree',
    'wiz.who.findParent': 'Your father or mother in the tree',
    'wiz.who.findSpouse': 'Your husband or wife in the tree',
    'wiz.who.notFound': 'Not there? Choose “I am not listed yet”.',
    'wiz.who.childOf': 'Child of',
    'wiz.who.spouseOf': 'Married to',
    'wiz.who.otherParent': 'The other parent',
    'wiz.who.otherUnknown': 'Someone else / not listed',
    'wiz.who.yourDetails': 'Your details',
    'wiz.who.change': 'Change',
    'wiz.who.continue': 'Continue',
    'wiz.who.thatsMe': 'That is me',
    'wiz.who.isThisYou': 'Already in the tree?',
    'wiz.row.nameAr': 'Name in Arabic',
    'wiz.row.nameArPh': 'First name only, e.g. أحمد',
    'wiz.row.nameEn': 'Name in English',
    'wiz.row.nameEnPh': 'English spelling',
    'wiz.row.autoHint': 'English filled in automatically — it can be corrected.',
    'wiz.row.year': 'Birth year',
    'wiz.row.yearPh': 'Year',
    'wiz.row.cal': 'Calendar',
    'wiz.row.cal.g': 'AD',
    'wiz.row.cal.h': 'AH',
    'wiz.row.son': 'Son',
    'wiz.row.daughter': 'Daughter',
    'wiz.row.husband': 'Husband',
    'wiz.row.wife': 'Wife',
    'wiz.row.brother': 'Brother',
    'wiz.row.sister': 'Sister',
    'wiz.row.male': 'Male',
    'wiz.row.female': 'Female',
    'wiz.row.genderLabel': 'Gender',
    'wiz.row.lifeLabel': 'Living or deceased',
    'wiz.row.living.m': 'Living',
    'wiz.row.living.f': 'Living',
    'wiz.row.deceased.m': 'Deceased',
    'wiz.row.deceased.f': 'Deceased',
    'wiz.row.remove': 'Remove this row',
    'wiz.row.number': 'Row {n}',
    'wiz.row.errName': 'A name is needed (or remove the row).',
    'wiz.row.errGender': 'Please choose “{a}” or “{b}”.',
    'wiz.row.errYear': 'The year does not look right.',
    'wiz.row.errLong': 'The name is too long.',
    'wiz.row.fullName': 'Only the first name here — father and family names come from the tree.',
    'wiz.dup.title': 'Is it one of these?',
    'wiz.dup.link': 'Yes, the same person',
    'wiz.dup.already': 'Already listed — this row can be removed.',
    'wiz.dup.linked': 'Linked to the person already in the tree.',
    'wiz.kicker.family': 'Family of',
    'wiz.kicker.nested': 'Now adding the family of',
    'wiz.spouses.title.m': '{name}’s wife',
    'wiz.spouses.title.f': '{name}’s husband',
    'wiz.spouses.title.u': '{name}’s husband or wife',
    'wiz.spouses.lead': 'People already in the tree are shown first. Add anyone missing.',
    'wiz.spouses.another.m': 'Another wife',
    'wiz.spouses.another.f': 'Another husband',
    'wiz.spouses.another.u': 'Another spouse',
    'wiz.children.title': 'Children of {name}',
    'wiz.children.lead': 'One line per child, in birth order if possible. The first name is enough; the rest is optional.',
    'wiz.children.with': 'Children of {a} and {b}',
    'wiz.children.alone': 'Children of {a}',
    'wiz.children.another': 'Another child',
    'wiz.children.addFamily.m': 'Add his family',
    'wiz.children.addFamily.f': 'Add her family',
    'wiz.children.addFamily.u': 'Add their family',
    'wiz.nestedBack': 'Back to the family of {name}',
    'wiz.parents.title': '{name}’s parents and siblings',
    'wiz.parents.lead': 'Optional — your own family, so everyone knows where you come from.',
    'wiz.parents.father': 'Father',
    'wiz.parents.mother': 'Mother',
    'wiz.parents.known': 'In the tree',
    'wiz.parents.siblings': 'Brothers and sisters',
    'wiz.parents.another': 'Brother or sister',
    'wiz.review.title': 'Review',
    'wiz.review.lead': 'Everything in your proposal so far. Nothing has been sent yet.',
    'wiz.review.count': '{n} changes',
    'wiz.review.send': 'Review & send',
    'wiz.review.more': 'Add more',
    'wiz.review.empty': 'Nothing has been added yet.',
    'wiz.restart': 'Start over',
    'wiz.skip': 'Skip',
    'wiz.next': 'Next',
    'wiz.whatsapp': 'Tell {owner} on WhatsApp instead (voice notes welcome)',
    'wiz.reset': 'Your earlier entry is no longer in the proposal, so the steps started again.',
    'wiz.removed': 'Removed from your proposal.',
    'wiz.removedMore': 'Removed, together with {n} changes that depended on it.',
    'wiz.pendingLabel': 'Remove {name} from your proposal',
  },
  ar: {
    'wiz.title': 'إضافة عائلتي',
    'wiz.lead': 'خطوات قليلة وسريعة: من أنت، ثم الزوج أو الزوجة، ثم الأبناء. تُحفظ كل إضافة على هذا الجهاز أولاً بأول، ولا يُرسل شيء إلا عند اختيار الإرسال.',
    'wiz.step.who': 'من أنت؟',
    'wiz.step.spouses': 'الزواج',
    'wiz.step.children': 'الأبناء',
    'wiz.step.parents': 'الوالدان',
    'wiz.step.review': 'المراجعة',
    'wiz.stepOf': 'الخطوة {n} من {total}',
    'wiz.who.lead': 'يكفي اختيار الوصف المناسب، ثم نبني معاً ما حوله من أفراد العائلة.',
    'wiz.who.in': 'اسمي موجود في الشجرة',
    'wiz.who.inHint': 'البحث عن اسمي ثم إضافة الزوج والأبناء',
    'wiz.who.child': 'اسمي غير موجود بعد',
    'wiz.who.childHint': 'أبي أو أمي في الشجرة',
    'wiz.who.spouse': 'صلتي بالعائلة عن طريق الزواج',
    'wiz.who.spouseHint': 'زوجي أو زوجتي في الشجرة',
    'wiz.who.continueAs': 'المتابعة باسم {name}',
    'wiz.who.continueHint': 'إضافة الزوج والأبناء',
    'wiz.who.findSelf': 'اسمك في الشجرة',
    'wiz.who.findParent': 'الأب أو الأم في الشجرة',
    'wiz.who.findSpouse': 'الزوج أو الزوجة في الشجرة',
    'wiz.who.notFound': 'لم يظهر الاسم؟ يمكن اختيار «اسمي غير موجود بعد».',
    'wiz.who.childOf': 'من أبناء',
    'wiz.who.spouseOf': 'الزواج من',
    'wiz.who.otherParent': 'الوالد الآخر',
    'wiz.who.otherUnknown': 'شخص آخر أو غير مذكور',
    'wiz.who.yourDetails': 'بياناتك',
    'wiz.who.change': 'تغيير',
    'wiz.who.continue': 'متابعة',
    'wiz.who.thatsMe': 'هذا أنا',
    'wiz.who.isThisYou': 'موجود في الشجرة مسبقاً؟',
    'wiz.row.nameAr': 'الاسم بالعربية',
    'wiz.row.nameArPh': 'الاسم الأول فقط، مثل: أحمد',
    'wiz.row.nameEn': 'الاسم بالإنجليزية',
    'wiz.row.nameEnPh': 'الكتابة بالإنجليزية',
    'wiz.row.autoHint': 'الكتابة الإنجليزية تلقائية، ويمكن تصحيحها.',
    'wiz.row.year': 'سنة الميلاد',
    'wiz.row.yearPh': 'السنة',
    'wiz.row.cal': 'التقويم',
    'wiz.row.cal.g': 'م',
    'wiz.row.cal.h': 'هـ',
    'wiz.row.son': 'ابن',
    'wiz.row.daughter': 'ابنة',
    'wiz.row.husband': 'زوج',
    'wiz.row.wife': 'زوجة',
    'wiz.row.brother': 'أخ',
    'wiz.row.sister': 'أخت',
    'wiz.row.male': 'ذكر',
    'wiz.row.female': 'أنثى',
    'wiz.row.genderLabel': 'الجنس',
    'wiz.row.lifeLabel': 'على قيد الحياة أو متوفّى',
    'wiz.row.living.m': 'حيّ',
    'wiz.row.living.f': 'حيّة',
    'wiz.row.deceased.m': 'متوفّى',
    'wiz.row.deceased.f': 'متوفّاة',
    'wiz.row.remove': 'حذف هذا السطر',
    'wiz.row.number': 'السطر {n}',
    'wiz.row.errName': 'الاسم مطلوب (أو حذف السطر).',
    'wiz.row.errGender': 'يُرجى اختيار «{a}» أو «{b}».',
    'wiz.row.errYear': 'السنة غير صحيحة.',
    'wiz.row.errLong': 'الاسم أطول من المسموح.',
    'wiz.row.fullName': 'الاسم الأول فقط هنا؛ فاسم الأب واسم العائلة يأتيان من الشجرة.',
    'wiz.dup.title': 'هل هو أحد هؤلاء؟',
    'wiz.dup.link': 'نعم، الشخص نفسه',
    'wiz.dup.already': 'موجود في القائمة — يمكن حذف هذا السطر.',
    'wiz.dup.linked': 'تم الربط بالشخص الموجود في الشجرة.',
    'wiz.kicker.family': 'عائلة',
    'wiz.kicker.nested': 'الآن: إضافة عائلة',
    'wiz.spouses.title.m': 'زوجة {name}',
    'wiz.spouses.title.f': 'زوج {name}',
    'wiz.spouses.title.u': 'زوج {name} أو زوجته',
    'wiz.spouses.lead': 'يظهر أولاً من هو موجود في الشجرة، ويمكن إضافة من لم يُذكر.',
    'wiz.spouses.another.m': 'زوجة أخرى',
    'wiz.spouses.another.f': 'زوج آخر',
    'wiz.spouses.another.u': 'زوج أو زوجة أخرى',
    'wiz.children.title': 'أبناء {name}',
    'wiz.children.lead': 'سطر لكل ابن أو ابنة، بترتيب الولادة إن أمكن. يكفي الاسم الأول، والباقي اختياري.',
    'wiz.children.with': 'أبناء {a} و{b}',
    'wiz.children.alone': 'أبناء {a}',
    'wiz.children.another': 'ابن أو ابنة أخرى',
    'wiz.children.addFamily.m': 'إضافة عائلته',
    'wiz.children.addFamily.f': 'إضافة عائلتها',
    'wiz.children.addFamily.u': 'إضافة عائلته',
    'wiz.nestedBack': 'العودة إلى عائلة {name}',
    'wiz.parents.title': 'الوالدان والإخوة — {name}',
    'wiz.parents.lead': 'اختياري — العائلة الأصلية، ليعرف الجميع النسب والأصل.',
    'wiz.parents.father': 'الأب',
    'wiz.parents.mother': 'الأم',
    'wiz.parents.known': 'في الشجرة',
    'wiz.parents.siblings': 'الإخوة والأخوات',
    'wiz.parents.another': 'أخ أو أخت',
    'wiz.review.title': 'المراجعة',
    'wiz.review.lead': 'كل ما في مقترحك حتى الآن، ولم يُرسل شيء بعد.',
    'wiz.review.count': 'عدد التعديلات: {n}',
    'wiz.review.send': 'المراجعة والإرسال',
    'wiz.review.more': 'إضافة المزيد',
    'wiz.review.empty': 'لم تُضف أي معلومات بعد.',
    'wiz.restart': 'البدء من جديد',
    'wiz.skip': 'تخطّي الخطوة',
    'wiz.next': 'التالي',
    'wiz.whatsapp': 'أو التواصل مع {owner} عبر واتساب بدلاً من ذلك (الرسائل الصوتية مرحّب بها)',
    'wiz.reset': 'لم يعد إدخالك السابق موجوداً في المقترح، لذا بدأت الخطوات من جديد.',
    'wiz.removed': 'حُذف من مقترحك.',
    'wiz.removedMore': 'حُذف ومعه {n} من التعديلات المرتبطة به.',
    'wiz.pendingLabel': 'حذف {name} من مقترحك',
  },
});

// ---------------------------------------------------------------------------------------------------------------
// State

const SS_KEY = 'gft.wizard.v1';
const STEP = { WHO: 0, SPOUSES: 1, CHILDREN: 2, PARENTS: 4, REVIEW: 5 };

/** Persisted: step, path ('in' | 'child' | 'spouse'), self (person id or temp ref), anchor (parent/spouse picked),
 *  near (?near=), stack (focus ids for "add their family"). */
let W = loadState();
/** Step-0 selections before anything is committed. */
let ui = { choice: null, otherParent: undefined };
/** Uncommitted rows by group key. */
const groups = new Map();
let rowSeq = 0;
let focusRowKey = null;
let lastRoot = null;
let lastQuery = {};
/** id of the wizard input that had the focus — restored after re-renders triggered by store events. */
let lastFocusId = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el && el.id && el.id.startsWith('wiz-r')) lastFocusId = el.id;
    else if (el && el !== document.body) lastFocusId = null;
  });
}

function fresh(near = null) {
  return { step: STEP.WHO, path: null, self: null, anchor: null, near, stack: [] };
}
function loadState() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null');
    if (s && typeof s === 'object' && Number.isInteger(s.step)) return { ...fresh(), ...s, stack: Array.isArray(s.stack) ? s.stack : [] };
  } catch { /* ignore */ }
  return fresh();
}
function saveState() {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(W)); } catch { /* ignore */ }
}
function setState(patch) {
  Object.assign(W, patch);
  saveState();
}

function defaultCal() {
  return store.config?.primaryCalendar === 'hijri' ? 'h' : 'g';
}
function newRow(kind, extra = {}) {
  return { key: `r${++rowSeq}`, kind, ar: '', en: '', enTouched: false, gender: '', year: '', cal: defaultCal(), deceased: false, err: '', ...extra };
}
function rowsOf(key) {
  if (!groups.has(key)) groups.set(key, []);
  return groups.get(key);
}
function isBlank(row) {
  return !row.ar.trim() && !row.en.trim() && !String(row.year).trim() && !row.deceased && !(row.gender && !row.fixedGender);
}

const g = () => store.working;
const focusId = () => (W.stack.length ? W.stack[W.stack.length - 1] : W.self);
const gword = (p) => (p?.gender === 'f' ? 'f' : p?.gender === 'm' ? 'm' : 'u');

/** t() with element substitutes: tNodes('k', {name: bdi(x)}) → [text, node, text]. */
function tNodes(key, nodes) {
  return t(key).split(/(\{\w+\})/).filter(Boolean).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && nodes[m[1]] !== undefined ? nodes[m[1]] : part;
  });
}

function rerender() {
  if (lastRoot && lastRoot.isConnected) render(lastRoot, {}, lastQuery);
}

// ---------------------------------------------------------------------------------------------------------------
// Rows → ops

const ARABIC = /[؀-ۿ]/;
const thisYear = new Date().getFullYear();
let thisHijriYear = 1460;
try { thisHijriYear = Number(String(gregorianToHijri(new Date().toISOString().slice(0, 10))).slice(0, 4)) || 1460; } catch { /* keep */ }

function autoEn(ar) {
  if (!ar || !ARABIC.test(ar)) return '';
  try { return transliterate(ar.trim(), { kind: 'given' }); } catch { return ''; }
}

function personInput(row) {
  let ar = row.ar.trim();
  let en = row.en.trim();
  if (ar && !ARABIC.test(ar) && !en) { en = ar; ar = ''; } // Latin typed into the Arabic box
  const p = { name: {} };
  if (ar) p.name.ar = ar;
  if (en && (!ar || (row.enTouched && en !== autoEn(ar)))) p.name.en = en;
  if (row.gender) p.gender = row.gender;
  const y = toAsciiDigits(String(row.year)).trim();
  if (y) p.birth = row.cal === 'h' ? { hijri: y } : { date: y };
  if (row.deceased) p.deceased = true;
  return p;
}

function genderWords(kind) {
  if (kind === 'child') return ['wiz.row.son', 'wiz.row.daughter'];
  if (kind === 'sibling') return ['wiz.row.brother', 'wiz.row.sister'];
  if (kind === 'spouse') return ['wiz.row.husband', 'wiz.row.wife'];
  return ['wiz.row.male', 'wiz.row.female'];
}

/** '' when valid, else an error text. */
function validateRow(row) {
  const ar = row.ar.trim();
  const en = row.en.trim();
  if (!ar && !en) return t('wiz.row.errName');
  if (ar.length > LIMITS.name || en.length > LIMITS.name) return t('wiz.row.errLong');
  if (!row.gender) {
    const [a, b] = genderWords(row.kind);
    return t('wiz.row.errGender', { a: t(a), b: t(b) });
  }
  const y = toAsciiDigits(String(row.year)).trim();
  if (y) {
    const n = Number(y);
    const ok = /^\d{3,4}$/.test(y) && (row.cal === 'h' ? isValidHijri(y) && n <= thisHijriYear : isValidDate(y) && n <= thisYear && n >= 1000);
    if (!ok) return t('wiz.row.errYear');
  }
  return '';
}

/**
 * Commit the non-blank rows of a group: build one op per row with makeOp(row) and add them to the draft in one go.
 * Returns true when every row was committed (or there was nothing to commit).
 */
function commitGroup(key, makeOp) {
  const rows = rowsOf(key);
  const todo = rows.filter((r) => !isBlank(r));
  let bad = false;
  for (const r of todo) {
    r.err = validateRow(r);
    if (r.err) bad = true;
  }
  if (bad) { focusRowKey = todo.find((r) => r.err)?.key || null; rerender(); return false; }
  if (!todo.length) { groups.set(key, rows.filter((r) => !isBlank(r))); return true; }
  const ops = todo.map((r) => makeOp(r));
  return addOpsFor(ops, todo, () => groups.set(key, []));
}

/** store.addOps with row-level error reporting and duplicate warnings as toasts. */
function addOpsFor(ops, rows, onOk) {
  const base = store.draft.ops.length;
  const res = store.addOps(ops);
  const graph = preDraftGraph();
  const ctx = { graph, refNames: refNames([...store.draft.ops, ...ops], graph) };
  if (!res.ok) {
    const errs = res.errors || [];
    let assigned = false;
    errs.forEach((e) => {
      const i = Number.isInteger(e.op) ? e.op - base : -1;
      const row = rows[i];
      if (row) { row.err = formatIssue(e, lang(), { ...ctx, withOp: false }); assigned = true; }
    });
    if (!assigned && rows[0]) rows[0].err = errs.length ? formatIssue(errs[0], lang(), { ...ctx, withOp: false }) : t('common.error');
    focusRowKey = rows.find((r) => r.err)?.key || null;
    rerender();
    return false;
  }
  onOk?.();
  const fresh = (res.warnings || []).filter((w) => Number.isInteger(w.op) && w.op >= base && ['POSSIBLE_DUPLICATE', 'NAME_LOOKS_FULL'].includes(w.code));
  if (fresh.length) {
    const wctx = { graph: store.working, refNames: refNames(store.draft.ops, store.working) };
    toast(fresh.map((w) => formatIssue(w, lang(), { ...wctx, withOp: false })).join(' · '), { type: 'warning', timeout: 9000 });
  }
  return true;
}

/** Index in the draft of the add-person op that declared `ref`, or -1. */
function draftOpIndexOf(ref) {
  return store.draft.ops.findIndex((o) => o && o.op === 'add-person' && o.ref === ref);
}

function removeFromDraft(ref) {
  const i = draftOpIndexOf(ref);
  if (i < 0) return;
  const n = store.removeOp(i);
  toast(n > 1 ? t('wiz.removedMore', { n: n - 1 }) : t('wiz.removed'));
}

// ---------------------------------------------------------------------------------------------------------------
// Duplicate suggestions ("Is it one of these?")

function sameGiven(p, typed, { strict = false } = {}) {
  const key = strict ? searchKey : skeletonKey;
  const k = key(typed || '');
  if (!k) return false;
  const n = p?.name || {};
  return [n.ar, n.en].some((x) => x && key(x) === k);
}

/** [{person, action: 'link' | 'already' | 'me' | null}] for a row. ctx = {kind, F, S, anchor}. */
function candidatesFor(row, ctx) {
  const typed = row.ar.trim() || row.en.trim();
  if (typed.length < 2) return [];
  const graph = g();
  const out = [];
  const seen = new Set();
  const push = (p, action) => { if (p && !seen.has(p.id)) { seen.add(p.id); out.push({ person: p, action }); } };
  const genderOk = (p) => !row.gender || !p.gender || p.gender === row.gender;
  if (ctx.kind === 'child') {
    const parents = [ctx.F, ctx.S].filter(Boolean);
    for (const pid of parents) for (const c of graph.children(pid) || []) if (sameGiven(c, typed) && genderOk(c)) push(c, 'already');
    for (const r of graph.search(typed, { limit: 40 }) || []) {
      const p = r.person;
      if (!sameGiven(p, typed) || !genderOk(p) || parents.includes(p.id)) continue;
      if (!graph.parents(p.id).length && !graph.isAncestor(p.id, ctx.F)) push(p, 'link');
    }
  } else if (ctx.kind === 'spouse') {
    const existing = new Set((graph.spouses(ctx.F) || []).map((s) => s.person.id));
    for (const r of graph.search(typed, { limit: 40 }) || []) {
      const p = r.person;
      if (p.id === ctx.F || !sameGiven(p, typed) || !genderOk(p)) continue;
      push(p, existing.has(p.id) ? 'already' : 'link');
    }
  } else if (ctx.kind === 'self-child') {
    for (const c of graph.children(ctx.anchor) || []) if (sameGiven(c, typed) && genderOk(c)) push(c, 'me');
  } else if (ctx.kind === 'self-spouse') {
    for (const s of graph.spouses(ctx.anchor) || []) if (sameGiven(s.person, typed)) push(s.person, 'me');
  } else {
    for (const r of graph.search(typed, { limit: 20 }) || []) if (sameGiven(r.person, typed, { strict: true }) && genderOk(r.person)) push(r.person, null);
  }
  return out.slice(0, 3);
}

function linkExisting(cand, ctx, row) {
  let op;
  if (ctx.kind === 'child') op = { op: 'move-person', id: cand.id, to: { of: ctx.F, with: ctx.S || null }, unionRef: store.newUnionRef() };
  else if (ctx.kind === 'spouse') op = { op: 'link-spouse', a: ctx.F, b: cand.id, unionRef: store.newUnionRef() };
  if (!op) return;
  const ok = addOpsFor([op], [row], () => {
    const rows = rowsOf(ctx.group);
    const i = rows.indexOf(row);
    if (i >= 0) rows.splice(i, 1);
  });
  if (ok) toast(t('wiz.dup.linked'), { type: 'success' });
}

function dupBox(row, ctx) {
  const box = h('div', { class: 'wiz-dup', attrs: { 'aria-live': 'polite' } });
  const fill = () => {
    const list = candidatesFor(row, ctx);
    box.replaceChildren();
    if (!list.length) { box.hidden = true; return; }
    box.hidden = false;
    box.append(h('p', { class: 'wiz-dup-title' }, icon('users', { size: 16 }), h('span', null, ctx.kind.startsWith('self') ? t('wiz.who.isThisYou') : t('wiz.dup.title'))));
    for (const { person, action } of list) {
      box.append(h('div', { class: 'wiz-dup-item' },
        h('a', { class: 'wiz-dup-person', href: `#/p/${encodeURIComponent(person.id)}`, target: '_blank', rel: 'noopener' },
          avatar(person, { size: 'sm' }),
          h('span', { class: 'wiz-dup-text' }, bdi(lineageOf(person), { class: 'wiz-dup-name' }), yearsOf(person) ? h('small', { class: 'muted' }, yearsOf(person)) : null)),
        action === 'link' ? h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => linkExisting(person, ctx, row) } }, icon('link', { size: 16 }), t('wiz.dup.link')) : null,
        action === 'me' ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', on: { click: () => chooseSelf(person, ctx.kind === 'self-spouse' ? 'spouse' : 'in') } }, icon('check', { size: 16 }), t('wiz.who.thatsMe')) : null,
        action === 'already' ? h('small', { class: 'wiz-dup-already' }, t('wiz.dup.already')) : null));
    }
  };
  box.refresh = fill;
  fill();
  return box;
}

// ---------------------------------------------------------------------------------------------------------------
// Row UI

function segmented(label, options, value, onPick, cls = '') {
  const btns = options.map(([v, text]) => h('button', {
    type: 'button', attrs: { 'aria-pressed': String(v === value) }, dataset: { v: String(v) },
    on: {
      click: () => {
        for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.v === String(v)));
        onPick(v);
      },
    },
  }, text));
  return h('div', { class: `segmented ${cls}`.trim(), attrs: { role: 'group', 'aria-label': label } }, btns);
}

/**
 * One inline person row. opts = {kind: 'child'|'spouse'|'sibling'|'parent'|'self', index, ctx (dup context), onRemove,
 * fixedGender, showGender}.
 */
function rowEl(row, opts) {
  const { index = 0, ctx = null, onRemove = null } = opts;
  const idBase = `wiz-${row.key}`;
  const err = h('p', { class: 'field-error wiz-row-error', id: `${idBase}-err`, attrs: { 'aria-live': 'polite' } }, row.err || '');
  const fullHint = h('p', { class: 'field-hint wiz-full-hint', hidden: !looksFull(row.ar || row.en) }, t('wiz.row.fullName'));
  const dup = ctx ? dupBox(row, ctx) : null;
  const refreshDup = debounce(() => dup?.refresh(), 250);

  const en = h('input', {
    id: `${idBase}-en`, class: 'input wiz-en', type: 'text', dir: 'ltr', lang: 'en', autocomplete: 'off', spellcheck: false,
    maxLength: LIMITS.name, placeholder: t('wiz.row.nameEnPh'), value: row.en,
    attrs: { 'aria-label': t('wiz.row.nameEn') },
    on: { input: (e) => { row.en = e.target.value; row.enTouched = true; enWrap.classList.remove('is-auto'); refreshDup(); } },
  });
  const ar = h('input', {
    id: `${idBase}-ar`, class: 'input wiz-ar', type: 'text', dir: 'rtl', lang: 'ar', autocomplete: 'off', spellcheck: false,
    maxLength: LIMITS.name, placeholder: t('wiz.row.nameArPh'), value: row.ar,
    attrs: { 'aria-label': `${t('wiz.row.nameAr')} — ${t('wiz.row.number', { n: index + 1 })}`, 'aria-describedby': `${idBase}-err`, enterkeyhint: 'next' },
    on: {
      input: (e) => {
        row.ar = e.target.value;
        if (!row.enTouched) { row.en = autoEn(row.ar); en.value = row.en; }
        if (row.err) { row.err = ''; err.textContent = ''; rowBox.classList.remove('has-error'); }
        fullHint.hidden = !looksFull(row.ar);
        refreshDup();
      },
    },
  });
  const enWrap = h('div', { class: ['wiz-en-wrap', row.enTouched ? '' : 'is-auto'], title: t('wiz.row.autoHint') },
    h('span', { class: 'wiz-en-tag', attrs: { 'aria-hidden': 'true' } }, 'EN'), en);

  // Gender
  const lifeLabels = () => [
    [false, t(`wiz.row.living.${row.gender === 'f' ? 'f' : 'm'}`)],
    [true, t(`wiz.row.deceased.${row.gender === 'f' ? 'f' : 'm'}`)],
  ];
  let life;
  const buildLife = () => segmented(t('wiz.row.lifeLabel'), lifeLabels(), row.deceased, (v) => { row.deceased = v; }, 'wiz-life');
  life = buildLife();
  const [mKey, fKey] = genderWords(opts.kind);
  const gender = opts.fixedGender ? null : segmented(t('wiz.row.genderLabel'), [['m', t(mKey)], ['f', t(fKey)]], row.gender, (v) => {
    row.gender = v;
    if (row.err) { row.err = ''; err.textContent = ''; rowBox.classList.remove('has-error'); }
    const nl = buildLife();
    life.replaceWith(nl);
    life = nl;
    dup?.refresh();
  }, 'wiz-gender');

  // Birth year + calendar
  const year = h('input', {
    id: `${idBase}-year`, class: 'input wiz-year', type: 'text', inputMode: 'numeric', dir: 'ltr', maxLength: 4, autocomplete: 'off',
    placeholder: t('wiz.row.yearPh'), value: row.year, attrs: { 'aria-label': t('wiz.row.year'), inputmode: 'numeric', pattern: '[0-9٠-٩۰-۹]*' },
    on: { input: (e) => { const v = toAsciiDigits(e.target.value).replace(/[^0-9]/g, '').slice(0, 4); if (v !== e.target.value) e.target.value = v; row.year = v; } },
  });
  const cal = segmented(t('wiz.row.cal'), [['g', t('wiz.row.cal.g')], ['h', t('wiz.row.cal.h')]], row.cal, (v) => { row.cal = v; }, 'wiz-cal');

  const remove = onRemove ? h('button', {
    type: 'button', class: 'btn-icon wiz-row-remove', title: t('wiz.row.remove'), attrs: { 'aria-label': t('wiz.row.remove') },
    on: { click: onRemove },
  }, icon('close', { size: 18 })) : null;

  const rowBox = h('div', { class: ['wiz-row', `wiz-row-${opts.kind}`, row.err ? 'has-error' : ''], dataset: { row: row.key } },
    h('div', { class: 'wiz-row-names' },
      h('span', { class: 'wiz-row-num', attrs: { 'aria-hidden': 'true' } }, String(index + 1)),
      h('div', { class: 'wiz-row-namebox' }, ar, enWrap),
      remove),
    fullHint,
    h('div', { class: 'wiz-row-meta' },
      gender,
      h('div', { class: 'wiz-yearbox' }, year, cal),
      life),
    err,
    dup);
  rowBox.focusName = () => ar.focus();
  if (focusRowKey === row.key) {
    // Focus is (re)applied at the end of every render (a store event may re-render right after this one).
    lastFocusId = ar.id;
    requestAnimationFrame(() => {
      if (!ar.isConnected || focusRowKey !== row.key) return;
      focusRowKey = null;
      const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      ar.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    });
  }
  return rowBox;
}

function looksFull(s) {
  try { return !!s && looksLikeFullName(s.trim()); } catch { return false; }
}

/** Group of rows with an "+ another" button. */
function rowGroup({ key, kind, ctx, fixedGender = '', addLabel, autoOne = true, onAnother = null, offset = 0 }) {
  const rows = rowsOf(key);
  if (autoOne && !rows.length) rows.push(newRow(kind, fixedGender ? { gender: fixedGender, fixedGender: true } : {}));
  const box = h('div', { class: 'wiz-rows', dataset: { group: key } });
  const draw = () => {
    box.replaceChildren(...rows.map((r, i) => rowEl(r, {
      kind, index: offset + i, fixedGender, ctx: ctx ? { ...ctx, group: key } : null,
      onRemove: () => {
        const j = rows.indexOf(r);
        if (j >= 0) rows.splice(j, 1);
        draw();
      },
    })));
  };
  draw();
  const another = addLabel ? h('button', {
    type: 'button', class: 'btn wiz-another',
    on: {
      click: () => {
        // Commit what is filled in so far (progress survives reloads), then open a fresh row.
        if (onAnother && !onAnother()) return;
        const fresh = newRow(kind, fixedGender ? { gender: fixedGender, fixedGender: true } : {});
        rowsOf(key).push(fresh);
        focusRowKey = fresh.key;
        rerender();
      },
    },
  }, icon('plus', { size: 18 }), addLabel) : null;
  return h('div', { class: 'wiz-group-rows' }, box, another);
}

// ---------------------------------------------------------------------------------------------------------------
// Existing people (already in the tree or committed to the draft)

function personLine(p, { trailing = null } = {}) {
  const created = store.isCreated(p.id) && draftOpIndexOf(p.id) >= 0;
  return h('li', { class: ['wiz-person', created ? 'is-new' : ''] },
    h('a', { class: 'wiz-person-link', href: `#/p/${encodeURIComponent(p.id)}` },
      avatar(p, { size: 'sm' }),
      h('span', { class: 'wiz-person-text' },
        h('span', { class: 'wiz-person-name' }, bdi(nameOf(p)), ...badges(p, { compact: true })),
        yearsOf(p) ? h('small', { class: 'muted' }, yearsOf(p)) : null)),
    trailing,
    created ? h('button', {
      type: 'button', class: 'btn-icon wiz-person-remove', title: t('wiz.pendingLabel', { name: nameOf(p) }),
      attrs: { 'aria-label': t('wiz.pendingLabel', { name: nameOf(p) }) },
      on: { click: () => removeFromDraft(p.id) },
    }, icon('close', { size: 18 })) : null);
}

// ---------------------------------------------------------------------------------------------------------------
// Steps

function stepsFor() {
  const list = [STEP.WHO, STEP.SPOUSES, STEP.CHILDREN];
  if (W.path === 'spouse') list.push(STEP.PARENTS);
  list.push(STEP.REVIEW);
  return list;
}
const STEP_KEY = { 0: 'who', 1: 'spouses', 2: 'children', 4: 'parents', 5: 'review' };

function stepper() {
  const list = stepsFor();
  const cur = list.indexOf(W.step);
  return h('nav', { class: 'wiz-stepper', attrs: { 'aria-label': t('wiz.stepOf', { n: cur + 1, total: list.length }) } },
    h('ol', null, list.map((s, i) => h('li', {
      class: ['wiz-stepper-item', i < cur ? 'is-done' : '', i === cur ? 'is-current' : ''],
      attrs: { 'aria-current': i === cur ? 'step' : null },
    },
    h('span', { class: 'wiz-stepper-dot', attrs: { 'aria-hidden': 'true' } }, i < cur ? icon('check', { size: 14 }) : String(i + 1)),
    h('span', { class: 'wiz-stepper-label' }, t(`wiz.step.${STEP_KEY[s]}`))))),
    h('p', { class: 'wiz-stepper-count small muted' }, t('wiz.stepOf', { n: cur + 1, total: list.length })));
}

/** Where "Next"/"Skip" go from the current step. */
function nextStep() {
  if (W.step === STEP.WHO) return STEP.SPOUSES;
  if (W.step === STEP.SPOUSES) return STEP.CHILDREN;
  if (W.step === STEP.CHILDREN) {
    if (W.stack.length) return 'pop';
    return W.path === 'spouse' ? STEP.PARENTS : STEP.REVIEW;
  }
  return STEP.REVIEW;
}
function go(step) {
  if (step === 'pop') {
    W.stack.pop();
    setState({ step: STEP.CHILDREN, stack: W.stack });
  } else setState({ step });
  lastScrollTop = true;
  rerender();
}
function back() {
  if (W.step === STEP.SPOUSES && W.stack.length) { go('pop'); return; }
  if (W.step === STEP.SPOUSES) { go(STEP.WHO); return; }
  if (W.step === STEP.CHILDREN) { go(STEP.SPOUSES); return; }
  if (W.step === STEP.PARENTS) { go(STEP.CHILDREN); return; }
  if (W.step === STEP.REVIEW) { go(W.path === 'spouse' ? STEP.PARENTS : STEP.CHILDREN); return; }
}
let lastScrollTop = false;

function footer({ onNext, nextLabel = t('wiz.next'), skip = true, showBack = true }) {
  return h('div', { class: 'wiz-footer' },
    showBack ? h('button', { type: 'button', class: 'btn btn-ghost wiz-back', on: { click: back } }, icon('chevronStart', { size: 18, className: 'flip-rtl' }), t('common.back')) : h('span'),
    h('div', { class: 'wiz-footer-main' },
      skip ? h('button', { type: 'button', class: 'btn btn-ghost wiz-skip', on: { click: () => go(nextStep()) } }, t('wiz.skip')) : null,
      h('button', { type: 'button', class: 'btn btn-primary wiz-next', on: { click: onNext } }, nextLabel, icon('chevronEnd', { size: 18, className: 'flip-rtl' }))));
}

function whatsappLink() {
  const graph = g();
  const candidates = [focusId(), W.anchor, W.near, store.me].filter(Boolean);
  const person = candidates.map((id) => store.base.person(id)).find(Boolean) || null;
  const label = person ? lineageOf(graph.person(person.id) || person) : '';
  const link = person ? store.siteLink(`#/p/${encodeURIComponent(person.id)}`) : store.siteLink('#/');
  const text = aboutText(lang(), label || t('app.title'), link);
  return h('a', { class: 'wiz-whatsapp', href: whatsappUrl(text, store.config?.owner?.whatsapp || ''), target: '_blank', rel: 'noopener' },
    icon('whatsapp', { size: 20 }), h('span', null, t('wiz.whatsapp', { owner: ownerName() })));
}

function focusHeader(F) {
  const p = g().person(F);
  if (!p) return null;
  const parentId = W.stack.length ? (W.stack.length > 1 ? W.stack[W.stack.length - 2] : W.self) : null;
  const parent = parentId ? g().person(parentId) : null;
  return h('div', { class: 'wiz-focus' },
    avatar(p),
    h('div', { class: 'wiz-focus-text' },
      h('span', { class: 'wiz-focus-kicker small muted' }, W.stack.length ? t('wiz.kicker.nested') : t('wiz.kicker.family')),
      h('strong', { class: 'wiz-focus-name' }, bdi(lineageOf(p)))),
    parent ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm wiz-focus-back', on: { click: () => go('pop') } },
      icon('chevronStart', { size: 16, className: 'flip-rtl' }), h('span', null, tNodes('wiz.nestedBack', { name: bdi(nameOf(parent)) }))) : null);
}

// Step 0 -------------------------------------------------------------------------------------------------------

function chooseSelf(person, path = 'in') {
  ui = { choice: null, otherParent: undefined };
  groups.delete('self');
  setState({ path, self: person.id, step: STEP.SPOUSES, stack: [] });
  lastScrollTop = true;
  if (store.me !== person.id) store.setMe(person.id); // re-renders
  else rerender();
}

function commitSelf() {
  const anchor = g().person(W.anchor);
  if (!anchor) return;
  const rows = rowsOf('self');
  const row = rows[0];
  row.err = validateRow(row);
  if (row.err) { focusRowKey = row.key; rerender(); return; }
  const ref = store.newRef();
  const person = personInput(row);
  let op;
  if (ui.choice === 'child') {
    const other = ui.otherParent && g().person(ui.otherParent) ? ui.otherParent : null;
    op = { op: 'add-person', ref, person, link: { as: 'child', of: anchor.id, with: other }, unionRef: store.newUnionRef() };
  } else {
    op = { op: 'add-person', ref, person, link: { as: 'spouse', of: anchor.id }, unionRef: store.newUnionRef() };
  }
  const path = ui.choice;
  const typedName = row.ar.trim() || row.en.trim();
  const ok = addOpsFor([op], [row], () => groups.delete('self'));
  if (!ok) return;
  if (!String(store.draft.submitter.name || '').trim() && typedName) store.setSubmitter({ name: typedName });
  ui = { choice: null, otherParent: undefined };
  setState({ path, self: ref, step: STEP.SPOUSES, stack: [] });
  lastScrollTop = true;
  store.setMe(ref);
}

function whoStep() {
  const graph = g();
  const me = store.me ? graph.person(store.me) : null;
  const tile = (choice, ic, title, hint) => h('button', {
    type: 'button', class: ['wiz-tile', ui.choice === choice ? 'is-active' : ''], attrs: { 'aria-pressed': String(ui.choice === choice) },
    on: { click: () => { ui = { choice, otherParent: undefined }; setState({ anchor: null }); rerender(); } },
  }, h('span', { class: 'wiz-tile-icon', attrs: { 'aria-hidden': 'true' } }, icon(ic, { size: 24 })),
  h('span', { class: 'wiz-tile-text' }, h('span', { class: 'wiz-tile-title' }, title), h('small', null, hint)));

  const parts = [
    h('h2', { class: 'wiz-step-title' }, t('wiz.step.who')),
    h('p', { class: 'muted wiz-step-lead' }, t('wiz.who.lead')),
  ];
  if (me && !ui.choice) {
    parts.push(h('button', {
      type: 'button', class: 'wiz-tile wiz-tile-me',
      on: { click: () => chooseSelf(me, W.self === me.id && W.path ? W.path : 'in') },
    }, avatar(me), h('span', { class: 'wiz-tile-text' }, h('span', { class: 'wiz-tile-title' }, tNodes('wiz.who.continueAs', { name: bdi(nameOf(me)) })), h('small', null, t('wiz.who.continueHint')))));
  }
  parts.push(h('div', { class: 'wiz-tiles' },
    tile('in', 'user', t('wiz.who.in'), t('wiz.who.inHint')),
    tile('child', 'users', t('wiz.who.child'), t('wiz.who.childHint')),
    tile('spouse', 'heart', t('wiz.who.spouse'), t('wiz.who.spouseHint'))));

  if (ui.choice === 'in') {
    parts.push(h('div', { class: 'wiz-who-pick card' },
      personPicker({ label: t('wiz.who.findSelf'), near: W.near || null, autofocus: true, onPick: (p) => chooseSelf(p) }),
      h('p', { class: 'small muted' }, t('wiz.who.notFound'))));
  } else if (ui.choice === 'child' || ui.choice === 'spouse') {
    const anchor = W.anchor ? graph.person(W.anchor) : null;
    if (!anchor) {
      parts.push(h('div', { class: 'wiz-who-pick card' },
        personPicker({
          label: ui.choice === 'child' ? t('wiz.who.findParent') : t('wiz.who.findSpouse'),
          near: W.near || null,
          autofocus: true,
          onPick: (p) => {
            setState({ anchor: p.id });
            const sp = graph.spouses(p.id) || [];
            ui.otherParent = sp.length === 1 ? sp[0].person.id : '';
            const rows = rowsOf('self');
            if (!rows.length) rows.push(newRow('self'));
            if (ui.choice === 'spouse' && p.gender) rows[0].gender = p.gender === 'm' ? 'f' : 'm';
            focusRowKey = rows[0].key;
            rerender();
          },
        })));
    } else {
      const rows = rowsOf('self');
      if (!rows.length) rows.push(newRow('self', ui.choice === 'spouse' && anchor.gender ? { gender: anchor.gender === 'm' ? 'f' : 'm' } : {}));
      const spouses = graph.spouses(anchor.id) || [];
      const other = ui.choice === 'child' && spouses.length
        ? h('div', { class: 'field wiz-other-parent' },
          h('span', { class: 'field-label' }, t('wiz.who.otherParent')),
          h('div', { class: 'chips', attrs: { role: 'radiogroup', 'aria-label': t('wiz.who.otherParent') } },
            [...spouses.map((s) => [s.person.id, nameOf(s.person)]), ['', t('wiz.who.otherUnknown')]].map(([id, label]) => h('button', {
              type: 'button', class: 'chip', attrs: { role: 'radio', 'aria-checked': String((ui.otherParent ?? '') === id), 'aria-pressed': String((ui.otherParent ?? '') === id) },
              on: { click: () => { ui.otherParent = id; rerender(); } },
            }, bdi(label)))))
        : null;
      parts.push(h('div', { class: 'wiz-who-pick card stack' },
        h('div', { class: 'wiz-anchor' },
          h('span', { class: 'small muted' }, ui.choice === 'child' ? t('wiz.who.childOf') : t('wiz.who.spouseOf')),
          h('span', { class: 'wiz-anchor-person' }, avatar(anchor, { size: 'sm' }), bdi(lineageOf(anchor), { class: 'wiz-anchor-name' })),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { setState({ anchor: null }); rerender(); } } }, t('wiz.who.change'))),
        other,
        h('h3', { class: 'wiz-sub' }, t('wiz.who.yourDetails')),
        rowEl(rows[0], {
          kind: ui.choice === 'child' ? 'child' : 'spouse',
          index: 0,
          ctx: { kind: ui.choice === 'child' ? 'self-child' : 'self-spouse', anchor: anchor.id, group: 'self' },
        }),
        h('div', { class: 'row row-end' },
          h('button', { type: 'button', class: 'btn btn-primary wiz-next', on: { click: commitSelf } }, t('wiz.who.continue'), icon('chevronEnd', { size: 18, className: 'flip-rtl' })))));
    }
  }
  parts.push(h('div', { class: 'wiz-footer wiz-footer-who' },
    h('span'),
    h('button', { type: 'button', class: 'btn btn-ghost wiz-skip', on: { click: () => go(STEP.REVIEW) } }, t('wiz.skip'))));
  return h('div', { class: 'wiz-step wiz-step-who' }, ...parts);
}

// Step 1 -------------------------------------------------------------------------------------------------------

function spousesStep() {
  const F = focusId();
  const graph = g();
  const fp = graph.person(F);
  const w = gword(fp);
  const spouseGender = fp?.gender === 'm' ? 'f' : fp?.gender === 'f' ? 'm' : '';
  const key = `sp:${F}`;
  const existing = graph.spouses(F) || [];
  const makeOp = (r) => ({ op: 'add-person', ref: store.newRef(), person: personInput(r), link: { as: 'spouse', of: F }, unionRef: store.newUnionRef() });
  const commit = () => commitGroup(key, makeOp);
  const group = rowGroup({
    key, kind: 'spouse', fixedGender: spouseGender, ctx: { kind: 'spouse', F }, offset: existing.length,
    addLabel: t(`wiz.spouses.another.${w}`), autoOne: !existing.length, onAnother: commit,
  });
  return h('div', { class: 'wiz-step wiz-step-spouses' },
    focusHeader(F),
    h('h2', { class: 'wiz-step-title' }, tNodes(`wiz.spouses.title.${w}`, { name: bdi(nameOf(fp)) })),
    h('p', { class: 'muted wiz-step-lead' }, t('wiz.spouses.lead')),
    existing.length ? h('ul', { class: 'wiz-people' }, existing.map((s) => personLine(s.person))) : null,
    group,
    footer({ onNext: () => { if (commit()) go(nextStep()); } }));
}

// Step 2 -------------------------------------------------------------------------------------------------------

function childGroups(F) {
  const graph = g();
  const unions = graph.unionsOf(F) || [];
  const list = unions.map((u) => {
    const S = (u.partners || []).find((x) => x !== F) || null;
    // Keyed by partner set (unique among active unions), so a union created by the first committed row keeps its rows.
    return { union: u, S, key: `ch:${F}:${S || '-'}` };
  });
  if (!list.length) list.push({ union: null, S: null, key: `ch:${F}:-` });
  return list;
}

function childrenStep() {
  const F = focusId();
  const graph = g();
  const fp = graph.person(F);
  const groupsList = childGroups(F);
  const makeOpFor = (S) => (r) => ({ op: 'add-person', ref: store.newRef(), person: personInput(r), link: { as: 'child', of: F, with: S || null }, unionRef: store.newUnionRef() });
  const commitAll = () => {
    for (const gr of groupsList) if (!commitGroup(gr.key, makeOpFor(gr.S))) return false;
    return true;
  };
  let firstEmptyAuto = true;
  const cards = groupsList.map((gr) => {
    const kids = gr.union ? graph.childrenOfUnion(gr.union.id) : [];
    const Sp = gr.S ? graph.person(gr.S) : null;
    const title = Sp ? t('wiz.children.with', { a: nameOf(fp), b: nameOf(Sp) }) : t('wiz.children.alone', { a: nameOf(fp) });
    const autoOne = !kids.length && firstEmptyAuto;
    if (autoOne) firstEmptyAuto = false;
    return h('section', { class: 'wiz-union card' },
      h('h3', { class: 'wiz-union-title' }, Sp ? avatar(Sp, { size: 'sm' }) : null, bdi(title)),
      kids.length ? h('ul', { class: 'wiz-people' }, kids.map((c) => personLine(c, {
        trailing: h('button', {
          type: 'button', class: 'btn btn-ghost btn-sm wiz-addfamily',
          on: { click: () => { if (!commitAll()) return; W.stack.push(c.id); setState({ stack: W.stack, step: STEP.SPOUSES }); lastScrollTop = true; rerender(); } },
        }, icon('users', { size: 16 }), t(`wiz.children.addFamily.${gword(c)}`)),
      }))) : null,
      rowGroup({
        key: gr.key, kind: 'child', ctx: { kind: 'child', F, S: gr.S }, offset: kids.length,
        addLabel: t('wiz.children.another'), autoOne, onAnother: () => commitGroup(gr.key, makeOpFor(gr.S)),
      }));
  });
  const nested = W.stack.length > 0;
  return h('div', { class: 'wiz-step wiz-step-children' },
    focusHeader(F),
    h('h2', { class: 'wiz-step-title' }, tNodes('wiz.children.title', { name: bdi(nameOf(fp)) })),
    h('p', { class: 'muted wiz-step-lead' }, t('wiz.children.lead')),
    ...cards,
    footer({
      onNext: () => { if (commitAll()) go(nextStep()); },
      nextLabel: nested ? t('common.done') : t('wiz.next'),
    }));
}

// Step 4 (path c) ----------------------------------------------------------------------------------------------

function parentsStep() {
  const F = W.self;
  const graph = g();
  const fp = graph.person(F);
  const father = graph.father(F);
  const mother = graph.mother(F);
  const sibs = graph.siblings(F) || { full: [], half: [], unspecified: [] };
  const sibList = [...sibs.full, ...sibs.half.map((x) => x.person), ...sibs.unspecified];
  const parentOp = (r) => ({ op: 'add-person', ref: store.newRef(), person: personInput(r), link: { as: 'parent', of: F }, unionRef: store.newUnionRef() });
  const sibOp = (r) => ({ op: 'add-person', ref: store.newRef(), person: personInput(r), link: { as: 'sibling', of: F, share: 'both' }, unionRef: store.newUnionRef() });
  const commitAll = () => (father || commitGroup(`par:m:${F}`, parentOp))
    && (mother || commitGroup(`par:f:${F}`, parentOp))
    && commitGroup(`sib:${F}`, sibOp);
  const parentBlock = (gender, person, labelKey) => h('div', { class: 'wiz-parent' },
    h('h3', { class: 'wiz-sub' }, t(labelKey)),
    person
      ? h('ul', { class: 'wiz-people' }, personLine(person))
      : rowGroup({ key: `par:${gender}:${F}`, kind: 'parent', fixedGender: gender, ctx: { kind: 'other' }, autoOne: true }));
  return h('div', { class: 'wiz-step wiz-step-parents' },
    focusHeader(F),
    h('h2', { class: 'wiz-step-title' }, tNodes('wiz.parents.title', { name: bdi(nameOf(fp)) })),
    h('p', { class: 'muted wiz-step-lead' }, t('wiz.parents.lead')),
    h('div', { class: 'notice notice-info wiz-public' }, icon('globe'), h('p', null, t('draft.publicText'))),
    h('div', { class: 'card stack' },
      parentBlock('m', father, 'wiz.parents.father'),
      parentBlock('f', mother, 'wiz.parents.mother')),
    h('section', { class: 'card wiz-siblings' },
      h('h3', { class: 'wiz-sub' }, t('wiz.parents.siblings')),
      sibList.length ? h('ul', { class: 'wiz-people' }, sibList.map((p) => personLine(p))) : null,
      rowGroup({ key: `sib:${F}`, kind: 'sibling', ctx: { kind: 'other' }, offset: sibList.length, addLabel: t('wiz.parents.another'), autoOne: !sibList.length, onAnother: () => commitGroup(`sib:${F}`, sibOp) })),
    footer({ onNext: () => { if (commitAll()) go(STEP.REVIEW); } }));
}

// Step 5 -------------------------------------------------------------------------------------------------------

function reviewStep() {
  const ops = store.draft.ops;
  const summary = ops.length ? draftSummary() : { lines: [], title: '' };
  return h('div', { class: 'wiz-step wiz-step-review' },
    h('h2', { class: 'wiz-step-title' }, t('wiz.review.title')),
    h('p', { class: 'muted wiz-step-lead' }, ops.length ? t('wiz.review.lead') : t('wiz.review.empty')),
    ops.length ? h('section', { class: 'card wiz-review' },
      summary.title && ops.length > 1 ? h('p', { class: 'draft-summary-title' }, bdi(summary.title)) : null,
      h('ol', { class: 'draft-ops wiz-review-list' }, ops.map((op, i) => {
        const { cat, icon: ic } = opIcon(op);
        return h('li', { class: ['draft-op', `draft-op-${cat}`] },
          h('span', { class: 'draft-op-num', attrs: { 'aria-hidden': 'true' } }, String(i + 1)),
          h('span', { class: 'draft-op-icon', attrs: { 'aria-hidden': 'true' } }, icon(ic, { size: 16 })),
          h('span', { class: 'draft-op-text' }, bdi(summary.lines[i] || '')));
      })),
      h('p', { class: 'small muted' }, t('wiz.review.count', { n: ops.length }))) : null,
    h('div', { class: 'wiz-review-actions' },
      ops.length ? h('a', { class: 'btn btn-primary btn-lg btn-block wiz-send', href: '#/draft' }, icon('send', { size: 20 }), t('wiz.review.send')) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', on: { click: () => { W.stack = []; setState({ stack: [] }); go(W.self ? STEP.CHILDREN : STEP.WHO); } } }, icon('plus', { size: 18 }), t('wiz.review.more')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => back() } }, t('common.back')))));
}

// ---------------------------------------------------------------------------------------------------------------

function restart() {
  W = fresh(lastQuery.near || null);
  ui = { choice: null, otherParent: undefined };
  groups.clear();
  saveState();
  lastScrollTop = true;
  rerender();
}

function render(root, params, query = {}) {
  lastRoot = root;
  lastQuery = query || {};
  root.replaceChildren();
  // ?near= scopes the first step's search.
  if (query.near && W.step === STEP.WHO && W.near !== query.near) setState({ near: query.near });
  // The person the steps are about must still exist (the draft may have been cleared or sent and dropped).
  const graph = g();
  let notice = null;
  if (W.step !== STEP.WHO && W.step !== STEP.REVIEW && (!W.self || !graph.person(W.self))) {
    W = fresh(query.near || W.near || null);
    saveState();
    notice = h('div', { class: 'notice notice-info' }, icon('info'), h('p', null, t('wiz.reset')));
  }
  if (W.stack.some((id) => !graph.person(id))) setState({ stack: W.stack.filter((id) => graph.person(id)) });
  if (W.step === STEP.PARENTS && W.path !== 'spouse') setState({ step: STEP.REVIEW });

  let body;
  if (W.step === STEP.WHO) body = whoStep();
  else if (W.step === STEP.SPOUSES) body = spousesStep();
  else if (W.step === STEP.CHILDREN) body = childrenStep();
  else if (W.step === STEP.PARENTS) body = parentsStep();
  else body = reviewStep();

  root.append(...[
    h('header', { class: 'page-head wiz-head' },
      h('div', { class: 'row row-between wiz-head-row' },
        h('h1', null, t('wiz.title')),
        W.step !== STEP.WHO || W.self ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm wiz-restart', on: { click: restart } }, icon('restore', { size: 16 }), t('wiz.restart')) : null),
      W.step === STEP.WHO ? h('p', { class: 'lead' }, t('wiz.lead')) : null),
    stepper(),
    notice,
    h('div', { class: 'wiz-body' }, body),
    h('div', { class: 'wiz-help' }, whatsappLink()),
  ].filter(Boolean));
  if (lastFocusId) {
    const want = lastFocusId;
    requestAnimationFrame(() => {
      const el = document.getElementById(want);
      const cur = document.activeElement;
      if (el && el !== cur && (!cur || cur === document.body || !cur.isConnected)) el.focus({ preventScroll: true });
    });
  }
  if (lastScrollTop) {
    lastScrollTop = false;
    lastFocusId = null;
    requestAnimationFrame(() => { try { window.scrollTo({ top: 0 }); } catch { /* ignore */ } });
  }
}

export default {
  title: () => t('wiz.title'),
  render,
};
