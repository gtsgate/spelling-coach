// Proposal preview (#/preview?code=… and #/preview/:issue) — docs/SPEC.md §7.2: decode a code (or fetch the GitHub
// request anonymously and extract its code), dry-run it against the canonical data in final mode, and show ✅/❌,
// errors & warnings, numbered change lines, submitter, fingerprint; "Load into my draft", "Correct this proposal",
// and for the owner "Create request and approve" (pasted code) or the exact /approve command (request).
// The analysis + report renderer are exported for the owner tools (#/admin).
import { h, icon, bdi, toast, copyText, confirmDialog } from '../dom.js';
import { t, register, lang } from '../i18n.js';
import { store } from '../store.js';
import { personChip, ownerName, spinner } from '../ui.js';
import { decodeProposal, extractProposal, findCodes } from '../core/codec.js';
import { applyProposal, proposalHash } from '../core/ops.js';
import { describeProposal, refNames } from '../core/describe.js';
import { formatIssue } from '../core/messages.js';
import { formatDate } from '../core/dates.js';
import { buildSubmission } from '../submit.js';

register({
  en: {
    'pv.title': 'Proposal preview',
    'pv.lead': 'What this proposal would change, checked against the current tree.',
    'pv.fromIssue': 'Request #{n} on GitHub',
    'pv.fromCode': 'Pasted code',
    'pv.loading': 'Reading the proposal…',
    'pv.fetching': 'Fetching request #{n} from GitHub…',
    'pv.ok': 'Ready to apply',
    'pv.okText': 'Every change applies cleanly to the current tree.',
    'pv.bad': 'Cannot be applied as it is',
    'pv.badText': 'Some changes conflict with the current tree. They can be corrected before approval.',
    'pv.fp': 'Fingerprint',
    'pv.id': 'Proposal id',
    'pv.created': 'Created',
    'pv.revision': 'Tree revision',
    'pv.revisionText': '{n} (current: {m})',
    'pv.submitter': 'Sent by',
    'pv.noSubmitter': 'Not given',
    'pv.note': 'Note from the sender',
    'pv.changes': 'Changes',
    'pv.people': 'People concerned',
    'pv.errors': 'Problems',
    'pv.warnings': 'Worth checking',
    'pv.destructive': 'Includes a removal or a change of parents — it needs the separate “approve-deletion” approval.',
    'pv.applied': 'This proposal was already applied (request #{n}).',
    'pv.appliedNoIssue': 'This proposal was already applied.',
    'pv.depends': 'Builds on {n} earlier proposals from the same device.',
    'pv.load': 'Load into my draft',
    'pv.correct': 'Correct this proposal',
    'pv.replaceTitle': 'Replace your draft?',
    'pv.replaceText': 'Your draft has {n} unsent changes. This proposal will replace them.',
    'pv.replace': 'Replace',
    'pv.loaded': 'Loaded into your draft.',
    'pv.ownerTitle': 'For {owner}',
    'pv.ownerCodeText': 'Creates the request on GitHub already labelled for approval. GitHub honours the labels only for approvers; for anyone else it becomes an ordinary request.',
    'pv.createApprove': 'Create request and approve',
    'pv.createApproveDel': 'Create request and approve the removal',
    'pv.ownerIssueText': 'To approve, post this comment on the request:',
    'pv.copyCommand': 'Copy command',
    'pv.commandCopied': 'Command copied — paste it as a comment on the request.',
    'pv.openIssue': 'Open request #{n}',
    'pv.issueClosed': 'This request is closed.',
    'pv.pasteTitle': 'Preview a proposal',
    'pv.pasteLabel': 'Paste a change code, or a whole WhatsApp message',
    'pv.pastePh': 'GFT1:…',
    'pv.pasteBtn': 'Preview',
    'pv.err.notFound': 'Request #{n} was not found — it may have been deleted, or the number is wrong.',
    'pv.err.rateLimit': 'GitHub limits anonymous requests (60 per hour). Please try again after {time}.',
    'pv.err.rateLimitSoon': 'GitHub limits anonymous requests (60 per hour). Please try again a little later.',
    'pv.err.forbidden': 'GitHub refused the request. Please try again later.',
    'pv.err.network': 'Could not reach GitHub. Please check the connection and try again.',
    'pv.err.http': 'GitHub answered with an error ({status}). Please try again later.',
    'pv.err.noProposal': 'This request does not contain a change code.',
    'pv.err.badNumber': 'That is not a request number.',
    'pv.retry': 'Try again',
    'pv.showAll': 'Show all ({n})',
  },
  ar: {
    'pv.title': 'معاينة المقترح',
    'pv.lead': 'ما الذي سيغيّره هذا المقترح، بعد فحصه على الشجرة الحالية.',
    'pv.fromIssue': 'الطلب رقم {n} على GitHub',
    'pv.fromCode': 'رمز مُلصق',
    'pv.loading': 'جارٍ قراءة المقترح…',
    'pv.fetching': 'جارٍ جلب الطلب رقم {n} من GitHub…',
    'pv.ok': 'جاهز للتطبيق',
    'pv.okText': 'جميع التعديلات تنطبق على الشجرة الحالية دون مشكلات.',
    'pv.bad': 'لا يمكن تطبيقه كما هو',
    'pv.badText': 'بعض التعديلات تتعارض مع الشجرة الحالية، ويمكن تصحيحها قبل الموافقة.',
    'pv.fp': 'البصمة',
    'pv.id': 'رقم المقترح',
    'pv.created': 'تاريخ الإنشاء',
    'pv.revision': 'نسخة الشجرة',
    'pv.revisionText': '{n} (الحالية: {m})',
    'pv.submitter': 'المُرسِل',
    'pv.noSubmitter': 'غير مذكور',
    'pv.note': 'ملاحظة المُرسِل',
    'pv.changes': 'التعديلات',
    'pv.people': 'الأشخاص المعنيّون',
    'pv.errors': 'المشكلات',
    'pv.warnings': 'ملاحظات تستحق المراجعة',
    'pv.destructive': 'يتضمّن حذفاً أو تغييراً للوالدين، لذا يحتاج إلى موافقة الحذف المنفصلة «approve-deletion».',
    'pv.applied': 'طُبّق هذا المقترح من قبل (الطلب رقم {n}).',
    'pv.appliedNoIssue': 'طُبّق هذا المقترح من قبل.',
    'pv.depends': 'يعتمد على مقترحات سابقة من الجهاز نفسه (العدد: {n}).',
    'pv.load': 'تحميله في مسودتي',
    'pv.correct': 'تصحيح هذا المقترح',
    'pv.replaceTitle': 'استبدال المسودة؟',
    'pv.replaceText': 'في مسودتك تعديلات غير مُرسلة (العدد: {n})، وسيحلّ هذا المقترح محلّها.',
    'pv.replace': 'استبدال',
    'pv.loaded': 'حُمّل المقترح في مسودتك.',
    'pv.ownerTitle': 'خاص بـ{owner}',
    'pv.ownerCodeText': 'يُنشئ الطلب على GitHub ومعه وسم الموافقة مباشرة. لا يعتمد GitHub الوسوم إلا للمشرفين، أما لغيرهم فيصبح طلباً عادياً.',
    'pv.createApprove': 'إنشاء الطلب والموافقة عليه',
    'pv.createApproveDel': 'إنشاء الطلب والموافقة على الحذف',
    'pv.ownerIssueText': 'للموافقة يُنشر هذا التعليق على الطلب:',
    'pv.copyCommand': 'نسخ الأمر',
    'pv.commandCopied': 'نُسخ الأمر، ويكفي إلصاقه تعليقاً على الطلب.',
    'pv.openIssue': 'فتح الطلب رقم {n}',
    'pv.issueClosed': 'هذا الطلب مغلق.',
    'pv.pasteTitle': 'معاينة مقترح',
    'pv.pasteLabel': 'لصق رمز التعديلات، أو رسالة واتساب كاملة',
    'pv.pastePh': 'GFT1:…',
    'pv.pasteBtn': 'معاينة',
    'pv.err.notFound': 'لم يُعثر على الطلب رقم {n}؛ ربما حُذف أو أن الرقم غير صحيح.',
    'pv.err.rateLimit': 'يحدّ GitHub عدد الطلبات دون تسجيل دخول (60 طلباً في الساعة). يُرجى المحاولة مجدداً بعد {time}.',
    'pv.err.rateLimitSoon': 'يحدّ GitHub عدد الطلبات دون تسجيل دخول (60 طلباً في الساعة). يُرجى المحاولة مجدداً بعد قليل.',
    'pv.err.forbidden': 'رفض GitHub الطلب. يُرجى المحاولة لاحقاً.',
    'pv.err.network': 'تعذّر الوصول إلى GitHub. يُرجى التحقق من الاتصال والمحاولة مجدداً.',
    'pv.err.http': 'أعاد GitHub خطأً ({status}). يُرجى المحاولة لاحقاً.',
    'pv.err.noProposal': 'لا يحتوي هذا الطلب على رمز تعديلات.',
    'pv.err.badNumber': 'هذا ليس رقم طلب صحيحاً.',
    'pv.retry': 'إعادة المحاولة',
    'pv.showAll': 'عرض الكل ({n})',
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Analysis (shared with #/admin)

function dryRun(proposal) {
  const deps = Array.isArray(proposal?.dependsOn) ? proposal.dependsOn : [];
  return applyProposal(store.data, proposal, {
    mode: 'final',
    allowDestructive: true,
    refMap: store.appliedRefMap(deps),
    appliedDeps: store.appliedDeps(deps),
    now: new Date().toISOString(),
  });
}

/**
 * Decode-independent analysis of a proposal: {proposal, code, hash, fp, result, issue, dataRef, subs}.
 * `issue` = {number, title, url, state, user, labels} when it came from GitHub.
 */
export async function analyzeProposal(proposal, { code = null, issue = null } = {}) {
  const hash = await proposalHash(proposal).catch(() => '');
  const a = { proposal, code, hash, fp: hash.slice(0, 6), issue, result: dryRun(proposal), dataRef: store.data, subs: {} };
  await ensureSubmission(a);
  if (!a.code) a.code = a.subs[lang()]?.code || null;
  return a;
}

/** Re-run the dry run when the canonical data changed since the analysis (e.g. a newer revision was published). */
function freshResult(a) {
  if (a.dataRef !== store.data) { a.result = dryRun(a.proposal); a.dataRef = store.data; a.subs = {}; }
  return a.result;
}

/** Submission (approve URL, code) for the current language; resolves when ready. */
export async function ensureSubmission(a) {
  const l = lang();
  if (a.subs[l]) return a.subs[l];
  const s = await buildSubmission(a.proposal, { graph: store.base, lang: l, destructive: !!a.result?.destructive, code: a.code || null });
  a.subs[l] = s;
  return s;
}

/** Decode every code in a pasted text (or raw JSON). → [{analysis} | {error, code}] */
export async function analyzeText(text) {
  const codes = findCodes(text || '', { ignoreQuoted: false });
  const out = [];
  if (codes.length) {
    for (const code of codes) {
      try {
        const proposal = await decodeProposal(code);
        out.push({ analysis: await analyzeProposal(proposal, { code }) });
      } catch (e) { out.push({ error: e, code }); }
    }
    return out;
  }
  try {
    const proposal = await decodeProposal(text || '');
    out.push({ analysis: await analyzeProposal(proposal) });
  } catch (e) { out.push({ error: e, code: null }); }
  return out;
}

function kindError(kind, extra = {}) {
  const e = new Error(kind);
  e.kind = kind;
  Object.assign(e, extra);
  return e;
}

const issueCache = new Map(); // number → {at, value}

/** Fetch a request anonymously from the GitHub REST API and extract its proposal. Throws Errors with .kind. */
export async function fetchIssue(n, { force = false } = {}) {
  const num = Number(n);
  if (!Number.isInteger(num) || num <= 0) throw kindError('badNumber');
  const cached = issueCache.get(num);
  if (!force && cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
  const { owner, name } = store.config.repo;
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${num}`, { headers: { Accept: 'application/vnd.github+json' } });
  } catch { throw kindError('network'); }
  if (res.status === 404 || res.status === 410) throw kindError('notFound', { number: num });
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
    throw kindError(res.status === 429 || remaining === '0' ? 'rateLimit' : 'forbidden', { reset });
  }
  if (!res.ok) throw kindError('http', { status: res.status });
  const data = await res.json();
  const issue = {
    number: num,
    title: String(data.title || ''),
    url: String(data.html_url || store.repoUrl(`/issues/${num}`)),
    state: String(data.state || ''),
    user: String(data.user?.login || ''),
    labels: (data.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
    createdAt: String(data.created_at || ''),
  };
  const found = await extractProposal(String(data.body || ''), { ignoreQuoted: true });
  if (!found) throw kindError('noProposal', { issue });
  const value = { issue, proposal: found.proposal, code: found.code };
  issueCache.set(num, { at: Date.now(), value });
  return value;
}

/** Localized text of a load / decode error. */
export function errorText(e, n = '') {
  if (!e) return t('common.error');
  if (e.kind === 'rateLimit') {
    if (e.reset) {
      const time = new Date(e.reset * 1000).toLocaleTimeString(lang() === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
      return t('pv.err.rateLimit', { time });
    }
    return t('pv.err.rateLimitSoon');
  }
  if (e.kind === 'notFound') return t('pv.err.notFound', { n: e.number || n });
  if (e.kind === 'http') return t('pv.err.http', { status: e.status });
  if (e.kind) return t(`pv.err.${e.kind}`);
  if (e.code) return formatIssue({ code: e.code, params: {} }, lang());
  return String(e.message || e);
}

// ---------------------------------------------------------------------------------------------------------------
// Report

function dateText(iso) {
  if (!iso || typeof iso !== 'string') return '';
  try { return formatDate(iso.slice(0, 10), lang()) || ''; } catch { return ''; }
}

function issueList(items, cls, max = 8) {
  const ul = h('ul', { class: 'preview-issue-list' });
  const draw = (all) => {
    ul.replaceChildren(...(all ? items : items.slice(0, max)).map((text) => h('li', null, bdi(text))));
    if (!all && items.length > max) {
      ul.append(h('li', { class: 'preview-more' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => draw(true) } }, t('pv.showAll', { n: items.length }))));
    }
  };
  draw(false);
  return h('div', { class: `preview-issues ${cls}` }, ul);
}

async function loadIntoDraft(a, { correct = false } = {}) {
  const n = store.draft.ops.length;
  if (n && !(await confirmDialog({ title: t('pv.replaceTitle'), message: t('pv.replaceText', { n }), confirmLabel: t('pv.replace') }))) return;
  store.replaceDraft(a.proposal, correct ? { source: { issue: a.issue?.number ?? null, hash: a.hash } } : {});
  toast(t('pv.loaded'), { type: 'success' });
  location.hash = '#/draft';
}

/**
 * The report card of an analysis. opts.compact (admin list) hides the long metadata grid.
 */
export function proposalReport(a, { compact = false } = {}) {
  const p = a.proposal;
  const res = freshResult(a);
  const graph = store.base;
  const L = lang();
  const summary = describeProposal(p, graph, L);
  const ctx = { graph, refNames: refNames(p, graph) };
  const destructive = !!(res.destructive || summary.destructive);
  const applied = store.appliedById?.[p.id] || null;
  const owner = ownerName();

  const status = res.ok
    ? h('div', { class: 'preview-status preview-status-ok', attrs: { role: 'status' } },
      h('span', { class: 'preview-status-icon', attrs: { 'aria-hidden': 'true' } }, '✅'),
      h('div', null, h('strong', null, t('pv.ok')), h('p', { class: 'small' }, t('pv.okText'))))
    : h('div', { class: 'preview-status preview-status-bad', attrs: { role: 'status' } },
      h('span', { class: 'preview-status-icon', attrs: { 'aria-hidden': 'true' } }, '❌'),
      h('div', null, h('strong', null, t('pv.bad')), h('p', { class: 'small' }, t('pv.badText'))));

  const sub = p.submitter || {};
  const subPerson = sub.personId ? graph.person(sub.personId) : null;
  const subText = [sub.name, sub.relation].map((x) => String(x || '').trim()).filter(Boolean).join(' — ');
  const meta = h('dl', { class: 'preview-meta' },
    h('div', null, h('dt', null, t('pv.fp')), h('dd', null, h('code', { class: 'preview-fp', dir: 'ltr' }, a.fp))),
    h('div', null, h('dt', null, t('pv.submitter')), h('dd', null, subText ? bdi(subText) : h('span', { class: 'muted' }, t('pv.noSubmitter')), subPerson ? personChip(subPerson, { years: false }) : null)),
    compact ? null : h('div', null, h('dt', null, t('pv.id')), h('dd', null, h('code', { dir: 'ltr' }, String(p.id || '')))),
    compact || !p.createdAt ? null : h('div', null, h('dt', null, t('pv.created')), h('dd', null, dateText(p.createdAt))),
    compact ? null : h('div', null, h('dt', null, t('pv.revision')), h('dd', null, t('pv.revisionText', { n: Number(p.baseRevision) || 0, m: store.data?.meta?.revision ?? 0 }))),
    a.issue ? h('div', null, h('dt', null, 'GitHub'), h('dd', null, h('a', { href: a.issue.url, target: '_blank', rel: 'noopener' }, t('pv.fromIssue', { n: a.issue.number })))) : null);

  const errors = res.errors?.length ? h('section', { class: 'preview-block preview-errors' },
    h('h3', null, icon('warning', { size: 18 }), t('pv.errors')),
    issueList(res.errors.map((e) => formatIssue(e, L, ctx)), 'preview-issues-danger')) : null;
  const warnings = res.warnings?.length ? h('section', { class: 'preview-block preview-warnings' },
    h('h3', null, icon('info', { size: 18 }), t('pv.warnings')),
    issueList(res.warnings.map((w) => formatIssue(w, L, ctx)), 'preview-issues-warning', compact ? 3 : 8)) : null;

  const touched = [...new Set(res.touched?.people || [])].map((id) => graph.person(id)).filter(Boolean).slice(0, 12);
  const changes = h('section', { class: 'preview-block' },
    h('h3', null, t('pv.changes'), ' ', h('span', { class: 'muted small' }, `(${p.ops.length})`)),
    h('ol', { class: 'preview-lines' }, summary.lines.map((line) => h('li', null, bdi(line)))));

  // Actions
  const s = a.subs[L] || null;
  if (!s) ensureSubmission(a).then(() => { a.onReady?.(); }).catch(() => {});
  let ownerBox = null;
  if (a.issue) {
    const cmd = `/${destructive ? 'approve-deletion' : 'approve'} ${a.fp}`;
    ownerBox = h('div', { class: 'preview-owner' },
      h('p', { class: 'preview-owner-title' }, icon('star', { size: 16 }), h('strong', null, t('pv.ownerTitle', { owner }))),
      a.issue.state === 'closed' ? h('p', { class: 'small muted' }, t('pv.issueClosed')) : null,
      h('p', { class: 'small' }, t('pv.ownerIssueText')),
      h('div', { class: 'preview-command' },
        h('code', { dir: 'ltr' }, cmd),
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => copyText(cmd).then((ok) => ok && toast(t('pv.commandCopied'), { type: 'success' })) } }, icon('copy', { size: 16 }), t('pv.copyCommand'))),
      h('a', { class: 'btn btn-sm', href: a.issue.url, target: '_blank', rel: 'noopener' }, icon('github', { size: 16 }), t('pv.openIssue', { n: a.issue.number })));
  } else {
    const create = h('a', {
      class: ['btn', destructive ? 'btn-danger' : 'btn-primary', 'preview-approve'], target: '_blank', rel: 'noopener',
      href: s ? s.approveIssueUrl : undefined, attrs: { 'aria-disabled': s ? null : 'true' },
      on: { click: (e) => { if (!a.subs[lang()]) e.preventDefault(); } },
    }, icon('github', { size: 18 }), destructive ? t('pv.createApproveDel') : t('pv.createApprove'));
    ownerBox = h('div', { class: 'preview-owner' },
      h('p', { class: 'preview-owner-title' }, icon('star', { size: 16 }), h('strong', null, t('pv.ownerTitle', { owner }))),
      h('p', { class: 'small muted' }, t('pv.ownerCodeText')),
      create);
  }

  return h('article', { class: ['card', 'preview-report', res.ok ? 'is-ok' : 'is-bad'] },
    h('header', { class: 'preview-report-head' },
      h('h2', { class: 'preview-report-title' }, bdi(summary.title)),
      h('span', { class: 'preview-source small muted' }, a.issue ? t('pv.fromIssue', { n: a.issue.number }) : t('pv.fromCode'))),
    status,
    applied ? h('div', { class: 'notice notice-success' }, icon('check'), h('p', null, applied.issue ? t('pv.applied', { n: applied.issue }) : t('pv.appliedNoIssue'))) : null,
    destructive ? h('div', { class: 'notice notice-warning' }, icon('warning'), h('p', null, t('pv.destructive'))) : null,
    (p.dependsOn || []).length ? h('p', { class: 'small muted' }, icon('link', { size: 16 }), ' ', t('pv.depends', { n: p.dependsOn.length })) : null,
    meta,
    p.note ? h('blockquote', { class: 'preview-note' }, h('span', { class: 'small muted' }, t('pv.note')), h('p', null, bdi(p.note))) : null,
    errors,
    warnings,
    changes,
    touched.length && !compact ? h('section', { class: 'preview-block' }, h('h3', null, t('pv.people')), h('div', { class: 'chips' }, touched.map((x) => personChip(x)))) : null,
    h('div', { class: 'preview-actions' },
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', on: { click: () => loadIntoDraft(a) } }, icon('download', { size: 18 }), t('pv.load')),
        h('button', { type: 'button', class: 'btn', on: { click: () => loadIntoDraft(a, { correct: true }) } }, icon('edit', { size: 18 }), t('pv.correct'))),
      ownerBox));
}

// ---------------------------------------------------------------------------------------------------------------
// View state

let S = { key: '', status: 'idle', analysis: null, error: null, n: null };
let lastRoot = null;
let lastArgs = [{}, {}];
let pasteText = '';

function rerender() {
  if (lastRoot && lastRoot.isConnected) render(lastRoot, ...lastArgs);
}

function load(key, params, query, { force = false } = {}) {
  S = { key, status: 'loading', analysis: null, error: null, n: params.issue || null };
  const job = params.issue
    ? fetchIssue(params.issue, { force }).then((r) => analyzeProposal(r.proposal, { code: r.code, issue: r.issue }))
    : decodeProposal(query.code).then((p) => analyzeProposal(p, { code: null }));
  job.then((a) => {
    if (S.key !== key) return;
    a.onReady = rerender;
    S = { ...S, status: 'ready', analysis: a };
    rerender();
  }).catch((e) => {
    if (S.key !== key) return;
    S = { ...S, status: 'error', error: e };
    rerender();
  });
}

function pasteBox() {
  const area = h('textarea', {
    id: 'preview-paste', class: 'textarea preview-paste', rows: 5, dir: 'ltr', placeholder: t('pv.pastePh'), value: pasteText, spellcheck: false,
    on: { input: (e) => { pasteText = e.target.value; } },
  });
  area.value = pasteText;
  return h('form', {
    class: 'card stack preview-paste-card',
    on: {
      submit: (e) => {
        e.preventDefault();
        const codes = findCodes(pasteText);
        if (codes.length) location.hash = `#/preview?code=${encodeURIComponent(codes[0])}`;
        else toast(formatIssue({ code: 'NO_PROPOSAL', params: {} }, lang()), { type: 'error' });
      },
    },
  },
  h('h2', null, t('pv.pasteTitle')),
  h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'preview-paste' }, t('pv.pasteLabel')), area),
  h('div', { class: 'row row-end' }, h('button', { type: 'submit', class: 'btn btn-primary' }, icon('eye', { size: 18 }), t('pv.pasteBtn'))));
}

function render(root, params = {}, query = {}) {
  lastRoot = root;
  lastArgs = [params, query];
  root.replaceChildren();
  const key = params.issue ? `issue:${params.issue}` : query.code ? `code:${query.code}` : '';
  root.append(h('header', { class: 'page-head' }, h('h1', null, t('pv.title')), h('p', { class: 'lead' }, t('pv.lead'))));
  if (!key) { root.append(pasteBox()); return; }
  if (S.key !== key) load(key, params, query);
  if (S.status === 'loading') {
    root.append(h('div', { class: 'card preview-loading' }, spinner(params.issue ? t('pv.fetching', { n: params.issue }) : t('pv.loading'))));
    return;
  }
  if (S.status === 'error') {
    const e = S.error;
    const retry = ['rateLimit', 'network', 'http', 'forbidden'].includes(e?.kind);
    root.append(h('div', { class: 'notice notice-danger preview-error', attrs: { role: 'alert' } }, icon('warning'),
      h('div', null,
        h('p', null, errorText(e, params.issue)),
        retry ? h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => { load(key, params, query, { force: true }); rerender(); } } }, icon('restore', { size: 16 }), t('pv.retry')) : null,
        params.issue ? h('p', { class: 'small' }, h('a', { href: store.repoUrl(`/issues/${encodeURIComponent(params.issue)}`), target: '_blank', rel: 'noopener' }, t('pv.openIssue', { n: params.issue }))) : null)));
    if (!params.issue) root.append(pasteBox());
    return;
  }
  if (S.analysis) root.append(proposalReport(S.analysis));
}

export default {
  title: () => t('pv.title'),
  render,
};
