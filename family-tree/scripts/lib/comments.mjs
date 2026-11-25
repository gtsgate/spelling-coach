// Bilingual (Arabic first, then English) bot comments. Every piece of user data goes through render.mjs#esc.
// Arabic is warm MSA and gender-neutral toward the reader (no masculine imperatives; "يُرجى", verbal nouns).
// TEXTS is exported so a test can check both languages and the gender-neutral rule.

import { esc, escLine, marker, fitLines, capBody, link, rtl, codeBlock, MAX_COMMENT } from './render.mjs';
import { commandText } from './commands.mjs';
import { MARKERS } from './labels.mjs';
import { FP_LENGTH } from './hash.mjs';

/** Short bilingual strings: [ar, en]. Functions take a params object. */
export const TEXTS = {
  ready: ['المقترح جاهز للمراجعة', 'Ready for review'],
  readyDestructive: ['المقترح جاهز، ويتضمن حذفاً أو دمجاً', 'Ready — includes removals or merges'],
  failing: ['لا يمكن تطبيق المقترح كما هو', 'This proposal can’t be applied as it is'],
  badCode: ['تعذّرت قراءة رمز التعديلات', 'The change code could not be read'],
  badCodeHint: [
    'يبدو أن الرمز نُسخ ناقصاً أو تغيّر أثناء النسخ. يُرجى نسخ الرسالة كاملة من الموقع مرة أخرى ولصقها في المقترح.',
    'The code seems to be cut off or changed while copying. Please copy the whole message from the site again and paste it into the issue.',
  ],
  noProposal: ['لم يعد في هذا المقترح رمز تعديلات', 'This issue no longer contains a change code'],
  from: ['المرسل', 'From'],
  note: ['ملاحظة', 'Note'],
  changes: (p) => [`التعديلات (${p.n})`, `Changes (${p.n})`],
  problems: ['ما يمنع التطبيق', 'What prevents applying it'],
  warnings: ['تنبيهات للمراجعة', 'Worth a look'],
  more: (p) => [`…و${p.n} غيرها — التفاصيل في المعاينة`, `…and ${p.n} more — see the preview`],
  preview: ['معاينة التعديلات على الموقع', 'Preview the changes on the site'],
  sameAsApplied: (p) => [`سبق تطبيق هذه التعديلات نفسها في ${p.ref}.`, `These exact changes were already applied in ${p.ref}.`],
  sameAsOpen: (p) => [`هذه التعديلات مطابقة للمقترح ${p.ref}.`, `These changes are identical to ${p.ref}.`],
  dependsOn: (p) => [`يعتمد هذا المقترح على ${p.ref} — تلزم الموافقة عليه أولاً.`, `This builds on ${p.ref} — approve that one first.`],
  forKeeper: ['للمشرف', 'For the tree keeper'],
  toApprove: ['للموافقة، يكفي تعليق بهذا النص', 'To approve, comment'],
  toApproveDeletion: ['يتضمن المقترح حذفاً أو دمجاً، فتلزمه موافقة الحذف', 'It removes or merges records, so it needs the deletion approval'],
  toSkip: ['للموافقة مع تخطي تعديلات بأرقامها', 'To approve but skip changes by number'],
  toSkipFailing: ['لتطبيق الباقي دون التعديلات التي فيها مشكلة', 'To apply the rest without the changes that have problems'],
  toForce: ['لتطبيقه رغم تغيّر البيانات منذ إعداده', 'To apply it anyway over the newer data'],
  toReject: ['للاعتذار عن المقترح بلطف', 'To decline politely'],
  toIgnore: ['أو إغلاق المقترح لتجاهله دون رد.', 'Or close the issue to ignore it.'],
  labelHint: [
    'إضافة التصنيف approve تكفي أيضاً ما دام المقترح لم يُعدَّل بعد مراجعته.',
    'Adding the approve label also works while the proposal hasn’t been edited since it was checked.',
  ],
  footer: (p) => [`البصمة ${p.fp} · مراجعة البيانات ${p.rev}`, `fingerprint ${p.fp} · data revision ${p.rev}`],

  applied: ['طُبّقت التعديلات على شجرة العائلة', 'Applied to the family tree'],
  appliedSaved: (p) => [`حُفظ التحديث (${p.commit}) — مراجعة البيانات ${p.rev}.`, `Saved as ${p.commit} — data revision ${p.rev}.`],
  appliedDelay: ['قد يستغرق ظهورها على الموقع بضع دقائق.', 'It may take a few minutes to appear on the site.'],
  people: ['الأشخاص', 'People'],
  skipped: (p) => [`التعديلات المتخطّاة: ${p.list}`, `Skipped changes: ${p.list}`],
  tellThem: ['إبلاغ صاحب المقترح عبر واتساب', 'Tell them on WhatsApp'],
  whatsapp: (p) => [
    `السلام عليكم 🌳 أُضيف تحديثكم إلى شجرة العائلة — شكراً جزيلاً! قد يستغرق ظهوره بضع دقائق.\n${p.url}`,
    `Hello! 🌳 Your update is now on the family tree — thank you! It may take a few minutes to appear.\n${p.url}`,
  ],
  failed: ['تعذّر تطبيق المقترح', 'The proposal could not be applied'],
  failedAfter: [
    'لم يتغيّر شيء في الشجرة. بعد التصحيح يمكن الموافقة من جديد.',
    'Nothing in the tree was changed. Once it is corrected, it can be approved again.',
  ],
  needDeletion: ['تلزم موافقة الحذف', 'The deletion approval is needed'],
  needDeletionText: [
    'يتضمن هذا المقترح حذفاً أو دمجاً أو تغييراً للوالدين، فلا تكفي الموافقة العادية. لإتمامه، يكفي تعليق بهذا النص:',
    'This proposal removes, merges or re-parents records, so a regular approval is not enough. To go ahead, comment:',
  ],
  needFp: ['يلزم تأكيد البصمة', 'Please confirm the fingerprint'],
  needFpEdited: [
    'عُدّل المقترح بعد مراجعته الأولى، فلا تكفي الموافقة المجرّدة. للموافقة على النسخة الحالية كما تظهر في تعليق المراجعة أعلاه، يكفي تعليق بهذا النص:',
    'The proposal was edited after it was first checked, so a bare approval is not enough. To approve the current version, as shown in the check comment above, comment:',
  ],
  needFpMismatch: (p) => [
    `البصمة المكتوبة (${p.given}) لا تطابق النسخة الحالية للمقترح (${p.fp}) — ربما عُدّل بعد المراجعة. للموافقة على النسخة الحالية:`,
    `The fingerprint given (${p.given}) doesn’t match the current version (${p.fp}) — it may have been edited after review. To approve the current version:`,
  ],
  needFpShort: (p) => [
    `البصمة المكتوبة (${p.given}) أقصر من اللازم: البصمة ${FP_LENGTH} حرفاً كما تظهر في تعليق المراجعة. للموافقة على النسخة الحالية:`,
    `The fingerprint given (${p.given}) is too short: the fingerprint is the ${FP_LENGTH} characters shown in the check comment. To approve the current version:`,
  ],
  approvalChanged: [
    'تغيّر المقترح بعد تسجيل الموافقة عليه، فلم يُطبَّق. للموافقة على النسخة الحالية كما تظهر في تعليق المراجعة أعلاه، يكفي تعليق بهذا النص:',
    'The proposal changed after the approval was recorded, so it was not applied. To approve the current version, as shown in the check comment above, comment:',
  ],
  idReused: (p) => [
    `رقم هذا المقترح (${p.id}) استُخدم من قبل لمقترح مختلف طُبّق في ${p.ref}، ولا يُقبل مقترحان مختلفان بالرقم نفسه. يُرجى إرسال التعديلات من الموقع من جديد.`,
    `This proposal’s id (${p.id}) was already used by a different proposal, applied in ${p.ref}; two different proposals can’t share an id. Please send the changes again from the site.`,
  ],
  alreadyApplied: (p) => [`ℹ️ سبق تطبيق هذه التعديلات نفسها في ${p.ref}، فلا حاجة إلى تطبيقها مرة أخرى.`, `ℹ️ These exact changes were already applied in ${p.ref}, so there is nothing more to do.`],
  approvalReceived: ['وصلت الموافقة، وجارٍ التطبيق…', 'Approval received — applying now…'],
  correctionReceived: ['وصل المقترح المصحّح، وحُدّثت المراجعة أعلاه.', 'Corrected proposal received — the check above is updated.'],
  correctionBroken: ['تعذّرت قراءة الرمز المصحّح', 'The corrected code could not be read'],
  notApprover: (p) => [
    `شكراً لكم! الموافقة على التعديلات من صلاحيات ${p.owner} فقط، وسيُراجَع المقترح قريباً بإذن الله.`,
    `Thank you! Only ${p.ownerEn} can approve changes; the proposal will be reviewed soon.`,
  ],
  unverifiedLabel: (p) => [
    `ℹ️ أُزيل التصنيف ${p.label} لأن الموافقة من صلاحيات ${p.owner} فقط.`,
    `ℹ️ The ${p.label} label was removed: only ${p.ownerEn} can approve.`,
  ],
  noProposalToApprove: ['ℹ️ لا يوجد في هذا المقترح رمز تعديلات يمكن الموافقة عليه.', 'ℹ️ There is no change code here to approve.'],
  closedIssue: ['ℹ️ هذا المقترح مغلق. لإعادة النظر فيه، يُرجى إعادة فتحه أولاً.', 'ℹ️ This proposal is closed. Reopen it first to approve it.'],
  retryLater: [
    '⏳ تعذّر حفظ التحديث الآن بسبب تحديث آخر في الوقت نفسه، وستُعاد المحاولة تلقائياً خلال ساعات قليلة.',
    '⏳ The update could not be saved just now (another update happened at the same time). It will be retried automatically within a few hours.',
  ],
  reject: [
    'شكراً جزيلاً على مشاركتكم واهتمامكم بشجرة العائلة 🌳 بعد المراجعة، لن يُعتمد هذا المقترح في الوقت الحالي. نقدّر حرصكم كثيراً، ويسعدنا دائماً استقبال أي إضافات أو تصحيحات أخرى.',
    'Thank you so much for taking the time to contribute to the family tree 🌳 After review, this proposal won’t be applied for now. Your care is truly appreciated, and further additions or corrections are always welcome.',
  ],
  undone: (p) => [`تم التراجع عن تطبيق ${p.ref}`, `The changes of ${p.ref} were undone`],
  undoneSaved: (p) => [`حُفظ التراجع (${p.commit}) — مراجعة البيانات ${p.rev}. أُعيدت السجلات إلى ما كانت عليه قبل التطبيق.`, `Saved as ${p.commit} — data revision ${p.rev}. The records are back to how they were before.`],
  undoNothing: ['ℹ️ لا يوجد تطبيق لهذا المقترح يمكن التراجع عنه.', 'ℹ️ There is no applied change of this proposal to undo.'],
  undoAlready: ['ℹ️ سبق التراجع عن هذا المقترح.', 'ℹ️ This proposal was already undone.'],
  undoNotApplied: ['ℹ️ التراجع متاح للمقترحات المطبّقة والمغلقة فقط.', 'ℹ️ Undo works on applied (closed) proposals only.'],
  undoNoCommit: ['ℹ️ تعذّر العثور على التحديث الذي طبّق هذا المقترح في سجل المستودع.', 'ℹ️ The update that applied this proposal could not be found in the repository history.'],
  undoChanged: [
    '❌ تعذّر التراجع، لأن هذه السجلات تغيّرت بعد التطبيق (والتراجع عنها قد يمحو تعديلات لاحقة):',
    '❌ Can’t undo: these records changed after it was applied (undoing would erase later changes):',
  ],
  undoInvalid: ['❌ تعذّر التراجع، لأن النتيجة لن تكون سليمة:', '❌ Can’t undo: the result would not be valid:'],
  undoBatch: (p) => [
    `طُبّق هذا المقترح في التحديث نفسه مع ${p.ref}، وقد عُدّلت فيه السجلات المذكورة أيضاً، لذا لا يمكن التراجع عنه وحده.`,
    `This proposal was saved in the same update as ${p.ref}, which also changed the records listed, so it can’t be undone on its own.`,
  ],
  undoCleanup: [
    'يمكن تصحيح هذه السجلات يدوياً بمقترح جديد من الموقع.',
    'These records can be corrected with a new proposal from the site instead.',
  ],
};

const tx = (key, p) => (typeof TEXTS[key] === 'function' ? TEXTS[key](p || {}) : TEXTS[key]);

/** Texts of the issue codes the scripts add themselves (core codes go through messages.formatIssue). */
const SCRIPT_ISSUES = {
  PROPOSAL_ID_REUSED: (params) => tx('idReused', { id: params?.proposalId || '', ref: `#${Number(params?.issue) || '?'}` }),
};

/** Text of a script-level issue in a language, or null when the code is not one of them. */
export function scriptIssueText(issue, lang) {
  const f = SCRIPT_ISSUES[issue?.code];
  return f ? f(issue.params)[lang === 'en' ? 1 : 0] : null;
}
/** "عربي · English" on one line. */
export const bi = (key, p) => { const [ar, en] = tx(key, p); return `${ar} · ${en}`; };
/** Arabic paragraph (RTL) followed by the English one. */
export const biPara = (key, p) => { const [ar, en] = tx(key, p); return `${rtl(ar)}\n\n${en}`; };

const issueRef = (n) => `#${Number(n)}`;
const numbered = (lines) => lines.map((l, i) => `${i + 1}. ${escLine(l, 600)}`);
const bullets = (lines) => lines.map((l) => `- ${escLine(l, 600)}`);

/** Numbered/bulleted list with a character budget and a "…and N more" line. */
function listBlock(rendered, budget, lang) {
  const { shown, more } = fitLines(rendered, budget);
  if (more) shown.push(`- ${tx('more', { n: more })[lang === 'ar' ? 0 : 1]}`);
  return shown.join('\n');
}

/** A heading + Arabic list (RTL block) + English list. */
function bilingualList(titleAr, titleEn, linesAr, linesEn, { budget = 12000, number = true } = {}) {
  const fmt = number ? numbered : bullets;
  const ar = `**${titleAr}**\n\n${listBlock(fmt(linesAr), budget, 'ar')}`;
  const en = `**${titleEn}**\n\n${listBlock(fmt(linesEn), budget, 'en')}`;
  return `${rtl(ar)}\n\n${en}`;
}

function submitterLine(proposal, formFields) {
  const s = proposal?.submitter || {};
  const name = [s.name, s.relation ? `(${s.relation})` : ''].filter(Boolean).join(' ') || formFields?.submitter || '';
  return name ? `**${bi('from')}:** ${escLine(name, 200)}` : '';
}

function noteLine(proposal, formFields) {
  const note = proposal?.note || formFields?.note || '';
  return note ? `**${bi('note')}:** ${escLine(note, 2000)}` : '';
}

/**
 * The check comment (§6.2). params:
 *   {hash, fp, rev, edits, src, proposal, describe: {ar, en} (lines), errors: {ar, en}, warnings: {ar, en},
 *    ok, destructive, previewUrl, appliedIn, identicalTo: [n], dependsOnIssues: [n], failingOps: [1-based],
 *    staleEdit, formFields}
 */
export function checkComment(p) {
  const head = [];
  head.push(marker(MARKERS.CHECK, { hash: p.hash, rev: p.rev, edits: p.edits, src: p.src, fp: p.fp }));
  const status = !p.ok ? 'failing' : p.destructive ? 'readyDestructive' : 'ready';
  head.push(`### ${{ failing: '❌', readyDestructive: '⚠️', ready: '✅' }[status]} ${bi(status)}`);
  const meta = [submitterLine(p.proposal, p.formFields), noteLine(p.proposal, p.formFields)].filter(Boolean);
  if (meta.length) head.push(meta.join('  \n'));
  if (p.appliedIn) head.push(`ℹ️ ${bi('sameAsApplied', { ref: issueRef(p.appliedIn) })}`);
  for (const n of p.identicalTo || []) head.push(`ℹ️ ${bi('sameAsOpen', { ref: issueRef(n) })}`);
  for (const n of p.dependsOnIssues || []) head.push(`⏳ ${bi('dependsOn', { ref: issueRef(n) })}`);

  const n = p.describe.en.length;
  const tail = [];
  if (p.previewUrl) tail.push(`🔍 **${link(bi('preview'), p.previewUrl)}**`);
  const cmds = [];
  const approveCmd = p.destructive ? 'approve-deletion' : 'approve';
  if (p.ok) {
    cmds.push(`${bi(p.destructive ? 'toApproveDeletion' : 'toApprove')}:\n${codeBlock(commandText(approveCmd, p.fp))}`);
    if (n > 1) cmds.push(`${bi('toSkip')}:\n${codeBlock(commandText(approveCmd, p.fp, { skip: [n] }))}`);
  } else {
    const keep = (p.failingOps || []).length && p.failingOps.length < n;
    if (keep) cmds.push(`${bi('toSkipFailing')}:\n${codeBlock(commandText(approveCmd, p.fp, { skip: p.failingOps }))}`);
    if (p.staleEdit) cmds.push(`${bi('toForce')}:\n${codeBlock(commandText(approveCmd, p.fp, { force: true }))}`);
  }
  cmds.push(`${bi('toReject')}:\n${codeBlock('/reject')}`);
  cmds.push(bi('toIgnore'));
  if (p.ok && !p.destructive) cmds.push(`<sub>${esc(bi('labelHint'))}</sub>`);
  tail.push(`---\n#### ${bi('forKeeper')}\n\n${cmds.join('\n\n')}`);
  tail.push(`<sub>${bi('footer', { fp: p.fp, rev: p.rev })}</sub>`);

  // Share the remaining room between the lists (per language), so the commands at the end are never cut off.
  const fixed = head.join('\n\n').length + tail.join('\n\n').length + 1000;
  const room = Math.max(4000, MAX_COMMENT - fixed);
  const weights = { changes: 3, errors: p.errors.en.length ? 1.5 : 0, warnings: p.warnings.en.length ? 1 : 0 };
  const total = weights.changes + weights.errors + weights.warnings;
  const budget = (k) => Math.floor((room * weights[k]) / total / 2) - 200;

  const body = [];
  const [chAr, chEn] = tx('changes', { n });
  body.push(bilingualList(chAr, chEn, p.describe.ar, p.describe.en, { budget: budget('changes') }));
  if (p.errors.en.length) {
    const [a, e] = tx('problems');
    body.push(bilingualList(`❌ ${a}`, `❌ ${e}`, p.errors.ar, p.errors.en, { budget: budget('errors'), number: false }));
  }
  if (p.warnings.en.length) {
    const [a, e] = tx('warnings');
    body.push(bilingualList(`⚠️ ${a}`, `⚠️ ${e}`, p.warnings.ar, p.warnings.en, { budget: budget('warnings'), number: false }));
  }
  return capBody([...head, ...body, ...tail].join('\n\n'), MAX_COMMENT);
}

/** The check comment when the code in the issue is damaged (codec error), and when it no longer holds a code. */
export function badCodeComment({ errorAr, errorEn, edits = 0, src = 'body' }) {
  return [
    marker(MARKERS.CHECK, { hash: 'none', edits, src }),
    `### ❌ ${bi('badCode')}`,
    rtl(`${escLine(errorAr, 500)}\n\n${tx('badCodeHint')[0]}`),
    `${escLine(errorEn, 500)}\n\n${tx('badCodeHint')[1]}`,
  ].join('\n\n');
}

export function noProposalComment({ edits = 0 } = {}) {
  return [marker(MARKERS.CHECK, { hash: 'none', edits, src: 'body' }), `### ℹ️ ${bi('noProposal')}`].join('\n\n');
}

/** Success comment (§6.3). people: [{ar, en, url}] */
export function appliedComment({ commitUrl, commitShort, rev, people = [], warnings = { ar: [], en: [] }, whatsappUrl, skipped = [], issue }) {
  const parts = [marker(MARKERS.RESULT, { status: 'applied', rev, issue })];
  parts.push(`### ✅ ${bi('applied')}`);
  const commitLink = commitUrl ? link(commitShort, commitUrl) : commitShort;
  const [sa, se] = tx('appliedSaved', { commit: commitLink, rev });
  const [da, de] = tx('appliedDelay');
  parts.push(`${rtl(`${sa} ${da}`)}\n\n${se} ${de}`);
  if (people.length) {
    const max = 25;
    const lines = people.slice(0, max).map((x) => `- ${link(`${escLine(x.ar, 150)} · ${escLine(x.en, 150)}`, x.url)}`);
    if (people.length > max) lines.push(`- ${bi('more', { n: people.length - max })}`);
    parts.push(`**${bi('people')}:**\n\n${lines.join('\n')}`);
  }
  if (skipped.length) parts.push(`ℹ️ ${bi('skipped', { list: skipped.join(', ') })}`);
  if (warnings.en.length) {
    const [a, e] = tx('warnings');
    parts.push(bilingualList(`⚠️ ${a}`, `⚠️ ${e}`, warnings.ar, warnings.en, { budget: 5000, number: false }));
  }
  if (whatsappUrl) parts.push(`📲 **${link(bi('tellThem'), whatsappUrl)}**`);
  return capBody(parts.join('\n\n'));
}

/** WhatsApp "your update is live" link (bilingual text). */
export function whatsappLink(url) {
  const [ar, en] = tx('whatsapp', { url });
  return `https://wa.me/?text=${encodeURIComponent(`${ar}\n\n${en}`)}`;
}

/** Failure comment: bilingual errors + hints. */
export function failedComment({ errors, fp, cmd = 'approve', failingOps = [], total = 0, staleEdit = false, dependsOnIssues = [] }) {
  const parts = [marker(MARKERS.RESULT, { status: 'failed', fp }), `### ❌ ${bi('failed')}`];
  for (const n of dependsOnIssues) parts.push(`⏳ ${bi('dependsOn', { ref: issueRef(n) })}`);
  const [a, e] = tx('problems');
  parts.push(bilingualList(a, e, errors.ar, errors.en, { budget: 12000, number: false }));
  const hints = [];
  if (failingOps.length && failingOps.length < total) hints.push(`${bi('toSkipFailing')}:\n${codeBlock(commandText(cmd, fp, { skip: failingOps }))}`);
  if (staleEdit) hints.push(`${bi('toForce')}:\n${codeBlock(commandText(cmd, fp, { force: true }))}`);
  if (hints.length) parts.push(hints.join('\n\n'));
  parts.push(biPara('failedAfter'));
  return capBody(parts.join('\n\n'));
}

export function needDeletionComment({ fp }) {
  return [marker(MARKERS.RESULT, { status: 'needs-deletion-approval', fp }), `### ⚠️ ${bi('needDeletion')}`,
    biPara('needDeletionText'), codeBlock(commandText('approve-deletion', fp))].join('\n\n');
}

/**
 * "Please confirm the fingerprint". why: "edited" (bare approval of an edited proposal), "mismatch" (fp of another
 * version), "short" (fewer than FP_LENGTH characters), "changed" (the proposal changed after the approval was recorded).
 */
export function needFpComment({ fp, cmd = 'approve', given = null, why = given ? 'mismatch' : 'edited' }) {
  const body = why === 'short' ? biPara('needFpShort', { given: esc(given) })
    : why === 'mismatch' ? biPara('needFpMismatch', { given: esc(given), fp })
      : why === 'changed' ? biPara('approvalChanged') : biPara('needFpEdited');
  return [marker(MARKERS.RESULT, { status: 'needs-fingerprint', fp }), `### 🔒 ${bi('needFp')}`, body,
    codeBlock(commandText(cmd, fp))].join('\n\n');
}

export function simpleComment(key, params, status = key) {
  return [marker(MARKERS.RESULT, { status }), biPara(key, params)].join('\n\n');
}

/**
 * Hidden record of an approval command (the queue re-reads fp/skip/force from the approver's own comment). `hash` is
 * the FULL hash of the proposal when the command was handled: the queue applies the approval only to that exact version.
 */
export function approvalNote({ cmd, commentId, by, fp = null, skip = [], force = false, correction = false, hash = '' }) {
  return [marker(MARKERS.APPROVAL, { cmd, comment: commentId, by, fp, skip: skip.join(','), force: force ? 1 : 0, hash, for: commentId }),
    correction ? `✏️ ${bi('correctionReceived')}\n\n👍 ${bi('approvalReceived')}` : `👍 ${bi('approvalReceived')}`].join('\n\n');
}

export function rejectComment() {
  return [marker(MARKERS.RESULT, { status: 'rejected' }), biPara('reject')].join('\n\n');
}

export function undoneComment({ issue, commitUrl, commitShort, rev, people = [] }) {
  const parts = [marker(MARKERS.RESULT, { status: 'undone', rev }), `### ↩️ ${bi('undone', { ref: issueRef(issue) })}`];
  parts.push(biPara('undoneSaved', { commit: commitUrl ? link(commitShort, commitUrl) : commitShort, rev }));
  if (people.length) {
    parts.push(`**${bi('people')}:**\n\n${people.slice(0, 25).map((x) => `- ${x.url ? link(`${escLine(x.ar, 150)} · ${escLine(x.en, 150)}`, x.url) : `${escLine(x.ar, 150)} · ${escLine(x.en, 150)}`}`).join('\n')}`);
  }
  return capBody(parts.join('\n\n'));
}

export function undoRefusedComment({ reason, records = [], errors = { ar: [], en: [] }, siblings = [] }) {
  const parts = [marker(MARKERS.RESULT, { status: `undo-${reason}` })];
  if (reason === 'changed') {
    const [a, e] = tx('undoChanged');
    parts.push(bilingualList(a, e, records.map((r) => r.ar), records.map((r) => r.en), { budget: 8000, number: false }));
    if (siblings.length) parts.push(`ℹ️ ${bi('undoBatch', { ref: siblings.map(issueRef).join(', ') })}`);
    parts.push(biPara('undoCleanup'));
  } else if (reason === 'invalid') {
    const [a, e] = tx('undoInvalid');
    parts.push(bilingualList(a, e, errors.ar, errors.en, { budget: 8000, number: false }));
    parts.push(biPara('undoCleanup'));
  } else {
    const key = { nothing: 'undoNothing', already: 'undoAlready', 'not-applied': 'undoNotApplied', 'no-commit': 'undoNoCommit' }[reason] || 'undoNothing';
    parts.push(biPara(key));
  }
  return capBody(parts.join('\n\n'));
}
