// My proposal (#/draft) — review & send (docs/SPEC.md §5, §7.3): the numbered list of pending changes (each removable,
// dependants pruned), problems found by the trial apply, "about you", the mandatory public-data notice, the big
// "Send to {owner} on WhatsApp" button and the collapsed other ways (GitHub issue, e-mail, copy code). Every link is
// precomputed by submit.js so click handlers stay synchronous. After a send: a thank-you panel; sent proposals
// awaiting approval are listed below (with "no longer applies" flags). Owner correction mode (draft.source) offers
// "Copy approval comment". Also exports helpers used by the wizard (preDraftGraph, draftSummary, opIcon).
import { h, icon, bdi, toast, modal, confirmDialog, copyText, debounce } from '../dom.js';
import { t, register, lang } from '../i18n.js';
import { store } from '../store.js';
import { personChip, ownerName, nameOf, lineageOf } from '../ui.js';
import { personPicker } from '../forms/picker.js';
import { buildSubmission, summarize } from '../submit.js';
import { formatIssue } from '../core/messages.js';
import { refNames, opCategory } from '../core/describe.js';
import { buildGraph } from '../core/graph.js';
import { LIMITS } from '../core/schema.js';
import { fingerprintOf } from '../core/ops.js';
import { formatDate } from '../core/dates.js';

register({
  en: {
    'draft.title': 'My proposal',
    'draft.lead': 'Your changes are kept on this device until you send them to {owner}. Nothing on the tree changes until they are approved.',
    'draft.changes': 'Your changes',
    'draft.changesCount': '{n} in total',
    'draft.remove': 'Remove change {n}',
    'draft.removed': 'Change removed.',
    'draft.removedMore': 'Change removed, together with {n} changes that depended on it.',
    'draft.clearAll': 'Remove all',
    'draft.clearTitle': 'Remove all changes?',
    'draft.clearText': 'All {n} unsent changes will be removed from this device.',
    'draft.errorsTitle': 'Some changes cannot be applied as they are',
    'draft.errorsHint': 'Please remove or correct the changes mentioned before sending.',
    'draft.warningsTitle': 'Worth a second look',
    'draft.aboutYou': 'About you',
    'draft.aboutYouHint': 'So {owner} knows who sent the changes.',
    'draft.name': 'Your name',
    'draft.namePh': 'e.g. Ahmed Muhammad Alam',
    'draft.relation': 'Your relation to the family',
    'draft.relationPh': 'e.g. grandson of Hassan',
    'draft.me': 'You in the tree',
    'draft.meHint': 'Optional — find yourself in the tree',
    'draft.meChange': 'Change',
    'draft.note': 'A note for {owner} (optional)',
    'draft.notePh': 'Anything that helps with the review…',
    'draft.sendTitle': 'Send',
    'draft.publicTitle': 'Before sending',
    'draft.publicText': 'Everything sent from here will be visible to anyone on the internet and stays in GitHub’s public history.',
    'draft.publicAck': 'I understand',
    'draft.publicNeeded': 'Please confirm the notice first.',
    'draft.sendWhatsapp': 'Send to {owner} on WhatsApp',
    'draft.sendWhatsappChoose': 'Send on WhatsApp — choose {owner} there',
    'draft.sendHint': 'WhatsApp opens with the message ready — just press send.',
    'draft.sendHintChoose': 'WhatsApp opens with the message ready; choose {owner} as the recipient, then press send.',
    'draft.otherWays': 'Other ways to send',
    'draft.viaGithub': 'Open a request on GitHub',
    'draft.viaGithubHint': 'Requires a GitHub account.',
    'draft.viaEmail': 'Send by email',
    'draft.viaEmailHint': 'Opens your email app with the message ready.',
    'draft.copyCode': 'Copy the change code',
    'draft.copyCodeHint': 'To paste into any message to {owner}.',
    'draft.preparing': 'Preparing…',
    'draft.codeCopied': 'Code copied. You can paste it into a message to {owner}.',
    'draft.longTitle': 'Message copied',
    'draft.longText': 'The message is too long to open in WhatsApp directly, so it was copied for you.',
    'draft.longStep1': 'Open WhatsApp and the chat with {owner}.',
    'draft.longStep2': 'Paste the message (long-press the text box, then Paste).',
    'draft.longStep3': 'Send it.',
    'draft.openWhatsapp': 'Open WhatsApp',
    'draft.ghTitle': 'Change code copied',
    'draft.ghText': 'The proposal is too large to fill in automatically, so the code was copied. Paste it into the “Change code” box of the GitHub form.',
    'draft.copyFailed': 'Copying did not work on this device. Select the text below and copy it.',
    'draft.sentTitle': 'Thank you! Your changes are on their way',
    'draft.sentText': '{owner} reviews every proposal before it appears on the tree, which can take a few days. Meanwhile your changes show with an “awaiting approval” mark.',
    'draft.sentId': 'Proposal number',
    'draft.sentMe': 'Follow it on my page',
    'draft.sentMore': 'Add more family',
    'draft.sentUndo': 'It was not sent — bring it back',
    'draft.emptyTitle': 'Nothing to send yet',
    'draft.emptyText': 'When you add relatives or correct information, the changes gather here so you can review them and send them to {owner} in one message.',
    'draft.emptyAdd': 'Add my family',
    'draft.emptyTree': 'Explore the tree',
    'draft.sentList': 'Sent — awaiting approval',
    'draft.sentListLead': 'Sent from this device. They show on the tree with an “awaiting approval” mark until {owner} approves them.',
    'draft.sentOn': 'Sent {date} via {via}',
    'draft.sentChanges': '{n} changes',
    'draft.via.whatsapp': 'WhatsApp',
    'draft.via.github': 'GitHub',
    'draft.via.email': 'email',
    'draft.via.copy': 'copied code',
    'draft.stale': 'No longer applies — the tree changed since it was sent. {owner} may ask about it.',
    'draft.resend': 'Send again',
    'draft.copyAgain': 'Copy code',
    'draft.withdraw': 'Withdraw',
    'draft.withdrawTitle': 'Withdraw this proposal?',
    'draft.withdrawText': 'It will be removed from this device. If {owner} already received it, a short message asking to ignore it helps.',
    'draft.bigWarn': 'This proposal is getting large ({n} changes). Sending it now is a good idea — you can keep adding afterwards.',
    'draft.tooBig': 'This proposal is too large to send in one piece (at most 150 changes). Please remove some changes and send them in a second proposal.',
    'draft.blocked': 'Sending is available once the problems above are resolved.',
    'draft.corrTitle': 'Correcting request #{n}',
    'draft.corrTitleCode': 'Correcting a proposal',
    'draft.corrText': 'Adjust the changes, then copy the approval comment and post it on the request — the corrected code replaces the original.',
    'draft.corrTextCode': 'Adjust the changes, then create the request already approved.',
    'draft.corrCopy': 'Copy approval comment',
    'draft.corrCopied': 'Approval comment copied — paste it as a comment on the request.',
    'draft.corrOpen': 'Open request #{n}',
    'draft.corrCreate': 'Create request and approve',
    'draft.corrStop': 'Stop correcting',
    'draft.corrStopText': 'The changes in the draft will be removed.',
    'draft.fp': 'Fingerprint',
    'draft.cat.add': 'Addition',
    'draft.cat.edit': 'Correction',
    'draft.cat.mark': 'Status',
    'draft.cat.arrange': 'Arrangement',
    'draft.cat.remove': 'Removal',
  },
  ar: {
    'draft.title': 'مقترحي',
    'draft.lead': 'تبقى تعديلاتك محفوظة على هذا الجهاز إلى حين إرسالها إلى {owner}، ولا يتغيّر شيء في الشجرة قبل الموافقة عليها.',
    'draft.changes': 'التعديلات',
    'draft.changesCount': 'العدد: {n}',
    'draft.remove': 'حذف التعديل {n}',
    'draft.removed': 'حُذف التعديل.',
    'draft.removedMore': 'حُذف التعديل ومعه {n} من التعديلات المرتبطة به.',
    'draft.clearAll': 'حذف الكل',
    'draft.clearTitle': 'حذف جميع التعديلات؟',
    'draft.clearText': 'ستُحذف التعديلات غير المُرسلة (العدد: {n}) من هذا الجهاز.',
    'draft.errorsTitle': 'بعض التعديلات لا يمكن تطبيقها كما هي',
    'draft.errorsHint': 'يُرجى حذف التعديلات المشار إليها أو تصحيحها قبل الإرسال.',
    'draft.warningsTitle': 'ملاحظات تستحق المراجعة',
    'draft.aboutYou': 'بيانات المُرسِل',
    'draft.aboutYouHint': 'ليعرف {owner} من أرسل التعديلات.',
    'draft.name': 'الاسم',
    'draft.namePh': 'مثال: أحمد محمد عالم',
    'draft.relation': 'صلة القرابة بالعائلة',
    'draft.relationPh': 'مثال: حفيد حسن',
    'draft.me': 'مكانك في الشجرة',
    'draft.meHint': 'اختياري — البحث عن اسمك في الشجرة',
    'draft.meChange': 'تغيير',
    'draft.note': 'ملاحظة إلى {owner} (اختيارية)',
    'draft.notePh': 'أي معلومة تساعد في المراجعة…',
    'draft.sendTitle': 'الإرسال',
    'draft.publicTitle': 'قبل الإرسال',
    'draft.publicText': 'كل ما يُرسَل من هنا سيكون مرئياً لأي شخص على الإنترنت، ويبقى في سجل GitHub العام.',
    'draft.publicAck': 'اطّلعتُ على ذلك وأوافق',
    'draft.publicNeeded': 'يُرجى تأكيد الاطلاع على التنبيه أولاً.',
    'draft.sendWhatsapp': 'إرسال إلى {owner} عبر واتساب',
    'draft.sendWhatsappChoose': 'إرسال عبر واتساب مع اختيار {owner} هناك',
    'draft.sendHint': 'يُفتح واتساب والرسالة جاهزة، ولا يبقى إلا الضغط على زر الإرسال.',
    'draft.sendHintChoose': 'يُفتح واتساب والرسالة جاهزة؛ يكفي اختيار {owner} من جهات الاتصال ثم الإرسال.',
    'draft.otherWays': 'طرق أخرى للإرسال',
    'draft.viaGithub': 'فتح طلب على GitHub',
    'draft.viaGithubHint': 'يتطلّب حساباً على GitHub.',
    'draft.viaEmail': 'الإرسال بالبريد الإلكتروني',
    'draft.viaEmailHint': 'يُفتح تطبيق البريد والرسالة جاهزة.',
    'draft.copyCode': 'نسخ رمز التعديلات',
    'draft.copyCodeHint': 'لإلصاقه في أي رسالة إلى {owner}.',
    'draft.preparing': 'جارٍ التجهيز…',
    'draft.codeCopied': 'نُسخ الرمز، ويمكن إلصاقه الآن في رسالة إلى {owner}.',
    'draft.longTitle': 'نُسخت الرسالة',
    'draft.longText': 'الرسالة أطول من أن تُفتح في واتساب مباشرة، لذا نُسخت تلقائياً.',
    'draft.longStep1': 'فتح واتساب ومحادثة {owner}.',
    'draft.longStep2': 'إلصاق الرسالة (بالضغط المطوّل على مربع الكتابة ثم «لصق»).',
    'draft.longStep3': 'إرسالها.',
    'draft.openWhatsapp': 'فتح واتساب',
    'draft.ghTitle': 'نُسخ رمز التعديلات',
    'draft.ghText': 'المقترح أكبر من أن يُملأ في النموذج تلقائياً، لذا نُسخ الرمز. يكفي إلصاقه في خانة «رمز التعديلات» في نموذج GitHub.',
    'draft.copyFailed': 'تعذّر النسخ على هذا الجهاز. يمكن تحديد النص أدناه ونسخه يدوياً.',
    'draft.sentTitle': 'شكراً لك! تعديلاتك في طريقها',
    'draft.sentText': 'يراجع {owner} كل مقترح قبل ظهوره في الشجرة، وقد يستغرق ذلك بضعة أيام. وحتى ذلك الحين تظهر التعديلات بعلامة «بانتظار الموافقة».',
    'draft.sentId': 'رقم المقترح',
    'draft.sentMe': 'متابعة المقترح في صفحتي',
    'draft.sentMore': 'إضافة المزيد من العائلة',
    'draft.sentUndo': 'لم يُرسَل فعلاً — إعادته إلى المسودة',
    'draft.emptyTitle': 'لا شيء للإرسال بعد',
    'draft.emptyText': 'عند إضافة أقارب أو تصحيح معلومات تُجمع التعديلات هنا، لمراجعتها وإرسالها إلى {owner} في رسالة واحدة.',
    'draft.emptyAdd': 'إضافة عائلتي',
    'draft.emptyTree': 'استكشاف الشجرة',
    'draft.sentList': 'مقترحات مُرسلة بانتظار الموافقة',
    'draft.sentListLead': 'أُرسلت من هذا الجهاز، وتظهر في الشجرة بعلامة «بانتظار الموافقة» إلى أن يوافق عليها {owner}.',
    'draft.sentOn': 'أُرسل في {date} عبر {via}',
    'draft.sentChanges': 'عدد التعديلات: {n}',
    'draft.via.whatsapp': 'واتساب',
    'draft.via.github': 'GitHub',
    'draft.via.email': 'البريد الإلكتروني',
    'draft.via.copy': 'نسخ الرمز',
    'draft.stale': 'لم يعد قابلاً للتطبيق — تغيّرت الشجرة منذ إرساله، وقد يتواصل {owner} بشأنه.',
    'draft.resend': 'إعادة الإرسال',
    'draft.copyAgain': 'نسخ الرمز',
    'draft.withdraw': 'سحب المقترح',
    'draft.withdrawTitle': 'سحب هذا المقترح؟',
    'draft.withdrawText': 'سيُحذف من هذا الجهاز. وإن كان {owner} قد استلمه فمن الأفضل إبلاغه بتجاهله.',
    'draft.bigWarn': 'أصبح المقترح كبيراً (عدد التعديلات: {n}). من الأفضل إرساله الآن ثم متابعة الإضافة بعد ذلك.',
    'draft.tooBig': 'المقترح أكبر من أن يُرسل دفعة واحدة (الحد الأقصى 150 تعديلاً). يُرجى حذف بعض التعديلات وإرسالها لاحقاً في مقترح ثانٍ.',
    'draft.blocked': 'يُتاح الإرسال بعد معالجة المشكلات المذكورة أعلاه.',
    'draft.corrTitle': 'تصحيح الطلب رقم {n}',
    'draft.corrTitleCode': 'تصحيح مقترح',
    'draft.corrText': 'بعد ضبط التعديلات يُنسخ تعليق الموافقة ويُنشر على الطلب، فيحلّ الرمز المصحّح محلّ الأصلي.',
    'draft.corrTextCode': 'بعد ضبط التعديلات يمكن إنشاء الطلب والموافقة عليه مباشرة.',
    'draft.corrCopy': 'نسخ تعليق الموافقة',
    'draft.corrCopied': 'نُسخ تعليق الموافقة، ويكفي إلصاقه تعليقاً على الطلب.',
    'draft.corrOpen': 'فتح الطلب رقم {n}',
    'draft.corrCreate': 'إنشاء الطلب والموافقة عليه',
    'draft.corrStop': 'إنهاء التصحيح',
    'draft.corrStopText': 'ستُحذف التعديلات الموجودة في المسودة.',
    'draft.fp': 'البصمة',
    'draft.cat.add': 'إضافة',
    'draft.cat.edit': 'تصحيح',
    'draft.cat.mark': 'تحديث حالة',
    'draft.cat.arrange': 'ترتيب',
    'draft.cat.remove': 'حذف',
  },
});

const ACK_KEY = 'gft.publicAck';
const BIG_OPS = 120;
const BIG_CODE = 50000;

// ---------------------------------------------------------------------------------------------------------------
// Module state (survives re-renders)
let ackChecked = readAck();
let justSent = null;          // {id, via} — thank-you panel after a send
let pickingMe = false;        // "change" pressed on the submitter person
let sub = null;               // precomputed submission of the draft
let subKey = '';
let subBuilding = '';
let els = {};                 // live DOM refs of the send controls (updated in place when `sub` arrives)
const sentSubs = new Map();   // `${id}|${lang}` → submission of a sent proposal (resend / copy again)
let lastRoot = null;

function readAck() { try { return localStorage.getItem(ACK_KEY) === '1'; } catch { return false; } }
function writeAck(on) { try { if (on) localStorage.setItem(ACK_KEY, '1'); else localStorage.removeItem(ACK_KEY); } catch { /* ignore */ } }

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers (also used by the wizard)

let preCache = { data: null, key: null, graph: null };
/** Graph of canonical data + sent proposals: the data the draft applies to (describe / issue texts use it). */
export function preDraftGraph() {
  const key = store.sent.map((s) => s.id).join(',');
  if (preCache.data === store.data && preCache.key === key && preCache.graph) return preCache.graph;
  let graph = store.base;
  if (store.sent.length) {
    try {
      const { data } = store.overlay(null);
      graph = data === store.data ? store.base : buildGraph(data);
    } catch { graph = store.working || store.base; }
  }
  preCache = { data: store.data, key, graph };
  return graph;
}

let sumCache = { key: '', value: null };
/** describeProposal of the draft in the current language (cached). */
export function draftSummary() {
  const key = `${store.draft.id}|${store.draft.updatedAt}|${store.draft.ops.length}|${lang()}|${store.sent.length}`;
  if (sumCache.key === key) return sumCache.value;
  const value = summarize(store.draftProposal(), preDraftGraph(), lang());
  sumCache = { key, value };
  return value;
}

const CAT_ICON = { add: 'plus', edit: 'edit', mark: 'flag', arrange: 'move', remove: 'trash' };
export function opIcon(op) {
  const cat = opCategory(op?.op) || 'edit';
  return { cat, icon: CAT_ICON[cat] || 'edit' };
}

/** Format draft issues with names (refs named from the draft ops). */
export function formatDraftIssue(issue) {
  const graph = preDraftGraph();
  return formatIssue(issue, lang(), { graph, refNames: refNames(store.draft.ops, graph) });
}

function draftKey() {
  const d = store.draft;
  return JSON.stringify([d.id, d.updatedAt, d.ops.length, d.submitter, d.note, lang(), store.sent.length]);
}

function isReparent() {
  return (store.draftWarnings || []).some((w) => w.code === 'REPARENT');
}

/** Start (or reuse) the submission build for the current draft; returns it when ready for the current key. */
function ensureSubmission() {
  if (!store.draft.ops.length) return null;
  const key = draftKey();
  if (sub && subKey === key) return sub;
  if (subBuilding === key) return null;
  subBuilding = key;
  buildSubmission(store.draftProposal(), { graph: preDraftGraph(), lang: lang(), destructive: isReparent() })
    .then((s) => {
      if (subBuilding !== key) return;
      sub = s;
      subKey = key;
      subBuilding = '';
      applyLinks();
    })
    .catch((e) => { console.error(e); subBuilding = ''; });
  return null;
}
const rebuildSoon = debounce(() => ensureSubmission(), 150);

function currentSub() {
  return sub && subKey === draftKey() ? sub : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Send actions (synchronous click handlers)

function sendBlocked() {
  return store.draftErrors.length > 0 || store.draft.ops.length > LIMITS.ops;
}

function guard(e, { needAck = true } = {}) {
  if (needAck && !ackChecked) {
    e.preventDefault();
    if (els.ackError) els.ackError.textContent = t('draft.publicNeeded');
    if (els.ack) { els.ack.focus(); els.ackBox?.classList.add('draft-ack-shake'); setTimeout(() => els.ackBox?.classList.remove('draft-ack-shake'), 500); }
    return null;
  }
  const s = currentSub();
  if (!s) { e.preventDefault(); toast(t('draft.preparing')); return null; }
  if (s.tooBig || sendBlocked()) { e.preventDefault(); return null; }
  return s;
}

function afterSend(via) {
  const id = store.draft.id;
  justSent = { id, via };
  // Let the link open first; then move the draft to the sent queue.
  setTimeout(() => { if (store.draft.id === id) store.markSent(via); }, 350);
}

function onWhatsapp(e) {
  const s = guard(e);
  if (!s) return;
  if (s.whatsapp.tooLong) {
    e.preventDefault();
    const copying = copyText(s.whatsapp.text);
    longMessageSteps(s, copying);
  }
  afterSend('whatsapp');
}

function onGithub(e) {
  const s = guard(e);
  if (!s) return;
  if (!s.github.fits) {
    const copying = copyText(s.github.body);
    copiedDialog(t('draft.ghTitle'), t('draft.ghText'), s.github.body, copying);
  }
  afterSend('github');
}

function onEmail(e) {
  if (!guard(e)) return;
  afterSend('email');
}

function onCopy(e) {
  const s = guard(e);
  if (!s) return;
  copyText(s.code).then((ok) => {
    if (ok) toast(t('draft.codeCopied', { owner: ownerName() }), { type: 'success' });
    else copiedDialog(t('draft.copyCode'), t('draft.copyFailed'), s.code, Promise.resolve(false));
  });
  afterSend('copy');
}

function copiedDialog(title, text, value, copying) {
  const failed = h('p', { class: 'notice notice-warning draft-copy-failed', hidden: true }, t('draft.copyFailed'));
  const area = h('textarea', { class: 'textarea draft-copy-area', readOnly: true, rows: 4, dir: 'ltr', attrs: { 'aria-label': title } });
  area.value = value;
  copying.then((ok) => { if (!ok) failed.hidden = false; });
  modal({
    title,
    size: 'sm',
    body: h('div', { class: 'stack stack-sm' }, h('p', null, text), failed, area),
    actions: [{ label: t('common.done'), value: true, variant: 'primary' }],
  });
}

function longMessageSteps(s, copying) {
  const owner = ownerName();
  const failed = h('div', { class: 'notice notice-warning', hidden: true }, icon('warning'), h('p', null, t('draft.copyFailed')));
  const area = h('textarea', { class: 'textarea draft-copy-area', readOnly: true, rows: 4, hidden: true, attrs: { 'aria-label': t('draft.longTitle') } });
  area.value = s.whatsapp.text;
  copying.then((ok) => { if (!ok) { failed.hidden = false; area.hidden = false; } });
  modal({
    title: t('draft.longTitle'),
    size: 'sm',
    body: h('div', { class: 'stack stack-sm' },
      h('p', null, t('draft.longText')),
      h('ol', { class: 'draft-steps' },
        h('li', null, t('draft.longStep1', { owner })),
        h('li', null, t('draft.longStep2')),
        h('li', null, t('draft.longStep3'))),
      failed, area,
      h('a', { class: 'btn btn-primary btn-block draft-wa-btn', href: s.whatsapp.plainUrl, target: '_blank', rel: 'noopener' }, icon('whatsapp'), t('draft.openWhatsapp'))),
    actions: [{ label: t('common.done'), value: true, variant: 'ghost' }],
  });
}

/** Update the hrefs/labels of the live send controls from `sub`. */
function applyLinks() {
  const s = currentSub();
  const ready = !!s && !s.tooBig && !sendBlocked();
  const setLink = (el, url) => {
    if (!el) return;
    if (ready && url) { el.href = url; el.removeAttribute('aria-disabled'); el.classList.remove('is-preparing'); }
    else { el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); el.classList.toggle('is-preparing', !s); }
  };
  setLink(els.wa, s ? s.whatsapp.url : null);
  setLink(els.gh, s ? s.github.url : null);
  setLink(els.email, s && s.email ? s.email.url : null);
  if (els.copy) { els.copy.disabled = !ready; els.copy.classList.toggle('is-preparing', !s); }
  if (els.fp) els.fp.textContent = s ? s.fp : '…';
  if (els.corrCopy) els.corrCopy.disabled = !s;
  if (els.corrCreate) setLinkAlways(els.corrCreate, s ? s.approveIssueUrl : null);
  if (els.big && s) {
    const big = !s.tooBig && (store.draft.ops.length >= BIG_OPS || s.code.length >= BIG_CODE);
    els.big.hidden = !big;
    if (els.tooBig) els.tooBig.hidden = !s.tooBig;
  }
}
function setLinkAlways(el, url) {
  if (url) { el.href = url; el.removeAttribute('aria-disabled'); } else { el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); }
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering

function rerender() {
  if (lastRoot && lastRoot.isConnected) render(lastRoot);
}

function pageHead() {
  return h('header', { class: 'page-head draft-head' },
    h('h1', null, t('draft.title')),
    h('p', { class: 'lead' }, t('draft.lead', { owner: ownerName() })));
}

function thankYou() {
  const entry = store.sent.find((s) => s.id === justSent.id);
  return h('section', { class: 'card draft-thanks', attrs: { 'aria-labelledby': 'draft-thanks-title', role: 'status' } },
    h('div', { class: 'draft-thanks-mark', attrs: { 'aria-hidden': 'true' } }, icon('check', { size: 30 })),
    h('h2', { id: 'draft-thanks-title' }, t('draft.sentTitle')),
    h('p', null, t('draft.sentText', { owner: ownerName() })),
    h('p', { class: 'draft-thanks-id' }, h('span', { class: 'muted' }, t('draft.sentId')), ' ', h('code', { class: 'kbd', dir: 'ltr' }, justSent.id)),
    h('div', { class: 'row draft-thanks-actions' },
      h('a', { class: 'btn btn-primary', href: '#/me' }, icon('user'), t('draft.sentMe')),
      h('a', { class: 'btn', href: '#/add-family' }, icon('plus'), t('draft.sentMore')),
      entry ? h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm draft-thanks-undo',
        on: {
          click: () => {
            const p = entry.proposal;
            justSent = null;
            store.forgetSent(entry.id);
            store.replaceDraft(p);
          },
        },
      }, icon('restore', { size: 16 }), t('draft.sentUndo')) : null));
}

function emptyView() {
  return h('div', { class: 'empty-state draft-empty' },
    h('h2', null, t('draft.emptyTitle')),
    h('p', { class: 'muted' }, t('draft.emptyText', { owner: ownerName() })),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-primary', href: '#/add-family' }, icon('plus'), t('draft.emptyAdd')),
      h('a', { class: 'btn', href: '#/tree' }, icon('tree'), t('draft.emptyTree'))));
}

function correctionBanner() {
  const src = store.draft.source || {};
  const issue = Number(src.issue) || null;
  const corrCopy = h('button', {
    type: 'button', class: 'btn btn-primary', disabled: true,
    on: {
      click: () => {
        const s = currentSub();
        if (!s) { toast(t('draft.preparing')); return; }
        copyText(s.approvalComment).then((ok) => {
          if (ok) toast(t('draft.corrCopied'), { type: 'success' });
          else copiedDialog(t('draft.corrCopy'), t('draft.copyFailed'), s.approvalComment, Promise.resolve(false));
        });
      },
    },
  }, icon('copy'), t('draft.corrCopy'));
  const corrCreate = h('a', { class: 'btn btn-primary', target: '_blank', rel: 'noopener', attrs: { 'aria-disabled': 'true' } }, icon('github'), t('draft.corrCreate'));
  els.corrCopy = issue ? corrCopy : null;
  els.corrCreate = issue ? null : corrCreate;
  return h('section', { class: 'notice notice-info draft-correction', attrs: { 'aria-labelledby': 'draft-corr-title' } },
    icon('edit'),
    h('div', { class: 'stack stack-sm' },
      h('h2', { id: 'draft-corr-title', class: 'draft-correction-title' }, issue ? t('draft.corrTitle', { n: issue }) : t('draft.corrTitleCode')),
      h('p', null, issue ? t('draft.corrText') : t('draft.corrTextCode')),
      src.hash ? h('p', { class: 'small muted' }, t('draft.fp'), ': ', h('code', { dir: 'ltr' }, fingerprintOf(src.hash))) : null,
      h('div', { class: 'row' },
        issue ? corrCopy : corrCreate,
        issue ? h('a', { class: 'btn', href: store.repoUrl(`/issues/${issue}`), target: '_blank', rel: 'noopener' }, icon('github'), t('draft.corrOpen', { n: issue })) : null,
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-danger btn-sm',
          on: {
            click: async () => {
              if (await confirmDialog({ title: t('draft.corrStop'), message: t('draft.corrStopText'), confirmLabel: t('draft.corrStop'), danger: true })) store.clearDraft();
            },
          },
        }, t('draft.corrStop')))));
}

function changesCard(summary) {
  const ops = store.draft.ops;
  const errorOps = new Set(store.draftErrors.map((e) => e.op).filter(Number.isInteger));
  const list = h('ol', { class: 'draft-ops' }, ops.map((op, i) => {
    const { cat, icon: ic } = opIcon(op);
    return h('li', { class: ['draft-op', `draft-op-${cat}`, errorOps.has(i) ? 'draft-op-error' : ''] },
      h('span', { class: 'draft-op-num', attrs: { 'aria-hidden': 'true' } }, String(i + 1)),
      h('span', { class: 'draft-op-icon', title: t(`draft.cat.${cat}`), attrs: { 'aria-hidden': 'true' } }, icon(ic, { size: 16 })),
      h('span', { class: 'draft-op-text' }, h('span', { class: 'sr-only' }, `${t(`draft.cat.${cat}`)}: `), bdi(summary.lines[i] || '')),
      h('button', {
        type: 'button', class: 'btn-icon draft-op-del', title: t('draft.remove', { n: i + 1 }),
        attrs: { 'aria-label': t('draft.remove', { n: i + 1 }) },
        on: {
          click: () => {
            const n = store.removeOp(i);
            toast(n > 1 ? t('draft.removedMore', { n: n - 1 }) : t('draft.removed'), { type: 'info' });
          },
        },
      }, icon('trash', { size: 18 })));
  }));

  const errors = store.draftErrors.length
    ? h('div', { class: 'notice notice-danger draft-issues', attrs: { role: 'alert' } }, icon('warning'),
      h('div', null,
        h('p', null, h('strong', null, t('draft.errorsTitle'))),
        h('ul', null, store.draftErrors.map((e) => h('li', null, bdi(formatDraftIssue(e))))),
        h('p', { class: 'small' }, t('draft.errorsHint'))))
    : null;
  const warnings = store.draftWarnings.length
    ? h('div', { class: 'notice notice-warning draft-issues draft-warnings' }, icon('info'),
      h('details', null,
        h('summary', null, h('strong', null, t('draft.warningsTitle')), ' ', h('span', { class: 'draft-warn-count' }, `(${store.draftWarnings.length})`)),
        h('ul', null, store.draftWarnings.map((w) => h('li', null, bdi(formatDraftIssue(w)))))))
    : null;

  return h('section', { class: 'card draft-changes', attrs: { 'aria-labelledby': 'draft-changes-title' } },
    h('div', { class: 'card-header' },
      h('h2', { id: 'draft-changes-title' }, t('draft.changes'), ' ', h('span', { class: 'draft-count' }, t('draft.changesCount', { n: ops.length }))),
      store.draft.source ? null : h('button', {
        type: 'button', class: 'btn btn-ghost btn-danger btn-sm',
        on: {
          click: async () => {
            if (await confirmDialog({ title: t('draft.clearTitle'), message: t('draft.clearText', { n: ops.length }), confirmLabel: t('draft.clearAll'), danger: true })) {
              store.clearDraft();
            }
          },
        },
      }, icon('trash', { size: 16 }), t('draft.clearAll'))),
    summary.title && ops.length > 1 ? h('p', { class: 'draft-summary-title' }, bdi(summary.title)) : null,
    list,
    errors,
    warnings);
}

function aboutCard() {
  const s = store.draft.submitter;
  const g = store.working;
  const mePerson = s.personId ? g.person(s.personId) : null;
  const nameInput = h('input', {
    id: 'draft-name', class: 'input', type: 'text', dir: 'auto', autocomplete: 'name', maxLength: LIMITS.name,
    placeholder: t('draft.namePh'), value: s.name || '',
    on: { input: (e) => { store.setSubmitter({ name: e.target.value }); rebuildSoon(); } },
  });
  const relInput = h('input', {
    id: 'draft-relation', class: 'input', type: 'text', dir: 'auto', maxLength: 300,
    placeholder: t('draft.relationPh'), value: s.relation || '',
    on: { input: (e) => { store.setSubmitter({ relation: e.target.value }); rebuildSoon(); } },
  });
  const note = h('textarea', {
    id: 'draft-note', class: 'textarea', rows: 3, dir: 'auto', maxLength: LIMITS.proposalNote,
    placeholder: t('draft.notePh'), value: store.draft.note || '',
    on: { input: (e) => { store.setNote(e.target.value); rebuildSoon(); } },
  });
  note.value = store.draft.note || '';

  let meField;
  if (mePerson && !pickingMe) {
    meField = h('div', { class: 'row draft-me' },
      personChip(mePerson, { years: true }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { pickingMe = true; rerender(); } } }, t('draft.meChange')));
  } else {
    meField = personPicker({
      placeholder: t('draft.meHint'),
      near: store.me || null,
      autofocus: pickingMe,
      onPick: (p) => {
        pickingMe = false;
        const patch = { personId: p.id };
        if (!String(s.name || '').trim()) patch.name = lineageOf(p) || nameOf(p);
        store.setSubmitter(patch);
        if (!store.me) store.setMe(p.id); // re-renders
        else rerender();
        rebuildSoon();
      },
    });
  }

  return h('section', { class: 'card draft-about', attrs: { 'aria-labelledby': 'draft-about-title' } },
    h('h2', { id: 'draft-about-title' }, t('draft.aboutYou')),
    h('p', { class: 'muted small draft-about-hint' }, t('draft.aboutYouHint', { owner: ownerName() })),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'draft-name' }, t('draft.name')), nameInput),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'draft-relation' }, t('draft.relation')), relInput),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('draft.me')), meField),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'draft-note' }, t('draft.note', { owner: ownerName() })), note));
}

function sendCard() {
  const owner = ownerName();
  const hasNumber = !!String(store.config?.owner?.whatsapp || '').replace(/[^0-9]/g, '');
  const blocked = sendBlocked();
  const ackError = h('p', { class: 'field-error draft-ack-error', attrs: { 'aria-live': 'polite' } });
  const ack = h('input', {
    type: 'checkbox', id: 'draft-ack', checked: ackChecked,
    on: {
      change: (e) => {
        ackChecked = e.target.checked;
        writeAck(ackChecked);
        ackError.textContent = '';
        sendBox.classList.toggle('is-locked', !ackChecked);
      },
    },
  });
  const ackBox = h('div', { class: 'draft-public' },
    h('p', { class: 'draft-public-title' }, icon('globe', { size: 18 }), h('strong', null, t('draft.publicTitle'))),
    h('p', { class: 'draft-public-text' }, t('draft.publicText')),
    h('label', { class: 'check draft-ack', for: 'draft-ack' }, ack, h('span', null, t('draft.publicAck'))),
    ackError);

  const wa = h('a', {
    class: 'btn btn-primary btn-lg btn-block draft-wa', target: '_blank', rel: 'noopener',
    attrs: { 'aria-disabled': 'true', 'aria-describedby': 'draft-wa-hint' }, on: { click: onWhatsapp },
  }, icon('whatsapp', { size: 22 }), h('span', null, hasNumber ? t('draft.sendWhatsapp', { owner }) : t('draft.sendWhatsappChoose', { owner })));
  const gh = h('a', { class: 'draft-way', target: '_blank', rel: 'noopener', attrs: { 'aria-disabled': 'true' }, on: { click: onGithub } },
    icon('github'), h('span', { class: 'draft-way-text' }, h('span', null, t('draft.viaGithub')), h('small', null, t('draft.viaGithubHint'))));
  const email = store.config?.owner?.email
    ? h('a', { class: 'draft-way', attrs: { 'aria-disabled': 'true' }, on: { click: onEmail } },
      icon('mail'), h('span', { class: 'draft-way-text' }, h('span', null, t('draft.viaEmail')), h('small', null, t('draft.viaEmailHint'))))
    : null;
  const copy = h('button', { type: 'button', class: 'draft-way', disabled: true, on: { click: onCopy } },
    icon('copy'), h('span', { class: 'draft-way-text' }, h('span', null, t('draft.copyCode')), h('small', null, t('draft.copyCodeHint', { owner }))));
  const big = h('div', { class: 'notice notice-warning', hidden: true }, icon('info'), h('p', null, t('draft.bigWarn', { n: store.draft.ops.length })));
  const tooBig = h('div', { class: 'notice notice-danger', hidden: store.draft.ops.length <= LIMITS.ops, attrs: { role: 'alert' } }, icon('warning'), h('p', null, t('draft.tooBig')));
  const fp = h('code', { dir: 'ltr' }, '…');

  const sendBox = h('div', { class: ['draft-send-box', ackChecked ? '' : 'is-locked'] },
    wa,
    h('p', { id: 'draft-wa-hint', class: 'small muted draft-wa-hint' }, hasNumber ? t('draft.sendHint') : t('draft.sendHintChoose', { owner })),
    h('details', { class: 'draft-other' },
      h('summary', null, t('draft.otherWays')),
      h('div', { class: 'draft-ways' }, gh, email, copy)));

  els = { ...els, wa, gh, email, copy, ack, ackBox, ackError, big, tooBig, fp };

  return h('section', { class: 'card card-accent draft-send', attrs: { 'aria-labelledby': 'draft-send-title' } },
    h('h2', { id: 'draft-send-title' }, t('draft.sendTitle')),
    big, tooBig,
    blocked && store.draftErrors.length ? h('p', { class: 'notice notice-danger' }, icon('warning'), h('span', null, t('draft.blocked'))) : null,
    ackBox,
    sendBox,
    h('p', { class: 'draft-fp small muted' }, t('draft.fp'), ': ', fp));
}

function viaLabel(via) {
  const key = `draft.via.${via}`;
  return ['whatsapp', 'github', 'email', 'copy'].includes(via) ? t(key) : String(via || '');
}

function sentSubmission(entry) {
  const key = `${entry.id}|${lang()}`;
  if (sentSubs.has(key)) return sentSubs.get(key);
  sentSubs.set(key, null);
  buildSubmission(entry.proposal, { graph: store.base, lang: lang() })
    .then((s) => {
      sentSubs.set(key, s);
      const row = lastRoot?.querySelector(`[data-sent="${CSS.escape(entry.id)}"]`);
      if (row) {
        const a = row.querySelector('.draft-sent-resend');
        if (a) { a.href = s.whatsapp.tooLong ? s.whatsapp.plainUrl : s.whatsapp.url; a.removeAttribute('aria-disabled'); }
        const b = row.querySelector('.draft-sent-copy');
        if (b) b.disabled = false;
      }
    })
    .catch((e) => console.error(e));
  return null;
}

function sentList() {
  if (!store.sent.length) return null;
  const owner = ownerName();
  const items = [...store.sent].reverse().map((entry) => {
    const s = sentSubmission(entry);
    const stale = store.sentStale.has(entry.id);
    const summary = summarize(entry.proposal, store.base, lang());
    const date = (() => { try { return formatDate(String(entry.at || '').slice(0, 10), lang()) || ''; } catch { return ''; } })();
    return h('li', { class: ['draft-sent-item', stale ? 'is-stale' : ''], dataset: { sent: entry.id } },
      h('div', { class: 'draft-sent-main' },
        h('p', { class: 'draft-sent-title' }, bdi(summary.title || entry.id)),
        h('p', { class: 'small muted' },
          t('draft.sentOn', { date, via: viaLabel(entry.via) }), ' · ', t('draft.sentChanges', { n: entry.proposal.ops.length }), ' · ',
          h('code', { dir: 'ltr' }, entry.id)),
        stale ? h('p', { class: 'draft-sent-stale small' }, icon('warning', { size: 16 }), h('span', null, t('draft.stale', { owner }))) : h('span', { class: 'badge badge-sent' }, t('ui.pendingSent'))),
      h('div', { class: 'row draft-sent-actions' },
        h('a', {
          class: 'btn btn-sm draft-sent-resend', target: '_blank', rel: 'noopener', href: s ? (s.whatsapp.tooLong ? s.whatsapp.plainUrl : s.whatsapp.url) : undefined,
          attrs: { 'aria-disabled': s ? null : 'true' },
          on: {
            click: (e) => {
              const cur = sentSubs.get(`${entry.id}|${lang()}`);
              if (!cur) { e.preventDefault(); return; }
              if (cur.whatsapp.tooLong) { e.preventDefault(); longMessageSteps(cur, copyText(cur.whatsapp.text)); }
            },
          },
        }, icon('whatsapp', { size: 16 }), t('draft.resend')),
        h('button', {
          type: 'button', class: 'btn btn-sm draft-sent-copy', disabled: !s,
          on: {
            click: () => {
              const cur = sentSubs.get(`${entry.id}|${lang()}`);
              if (!cur) return;
              copyText(cur.code).then((ok) => (ok ? toast(t('draft.codeCopied', { owner }), { type: 'success' }) : copiedDialog(t('draft.copyAgain'), t('draft.copyFailed'), cur.code, Promise.resolve(false))));
            },
          },
        }, icon('copy', { size: 16 }), t('draft.copyAgain')),
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-danger btn-sm',
          on: {
            click: async () => {
              if (await confirmDialog({ title: t('draft.withdrawTitle'), message: t('draft.withdrawText', { owner }), confirmLabel: t('draft.withdraw'), danger: true })) {
                if (justSent && justSent.id === entry.id) justSent = null;
                store.forgetSent(entry.id);
              }
            },
          },
        }, t('draft.withdraw'))));
  });
  return h('section', { class: 'draft-sent', attrs: { 'aria-labelledby': 'draft-sent-title' } },
    h('div', { class: 'section-title' }, h('h2', { id: 'draft-sent-title' }, t('draft.sentList'))),
    h('p', { class: 'muted small' }, t('draft.sentListLead', { owner })),
    h('ul', { class: 'list draft-sent-list' }, items));
}

function render(root) {
  lastRoot = root;
  root.replaceChildren();
  els = {};
  const hasOps = store.draft.ops.length > 0;
  if (hasOps && justSent && justSent.id !== store.draft.id) justSent = null;
  if (justSent && !hasOps && !store.sent.some((s) => s.id === justSent.id)) justSent = null;
  if (!store.me && !store.draft.submitter.personId) pickingMe = false;

  const parts = [pageHead()];
  if (justSent && !hasOps) parts.push(thankYou());
  if (!hasOps) {
    if (!justSent) parts.push(emptyView());
  } else {
    const summary = draftSummary();
    const side = store.draft.source
      ? h('div', { class: 'draft-side stack' }, aboutCard())
      : h('div', { class: 'draft-side stack' }, aboutCard(), sendCard());
    parts.push(
      store.draft.source ? correctionBanner() : null,
      h('div', { class: 'draft-layout' },
        h('div', { class: 'draft-maincol stack' }, changesCard(summary)),
        side));
    ensureSubmission();
  }
  parts.push(sentList());
  root.append(...parts.filter(Boolean));
  applyLinks();
}

export default {
  title: () => t('draft.title'),
  render: (root) => render(root),
};
