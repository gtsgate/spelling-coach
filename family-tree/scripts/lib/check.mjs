// Check one proposal issue (docs/SPEC.md §6.2): re-fetch it, find its proposal (body or owner correction), dry-run it
// against the current data in final mode, label it and write ONE bot comment (updated in place).
//
//   checkIssue(ctx, number, {data?, applied?, openIssues?, index?}) → {status, hash?, fp?, edits?, ok?, destructive?}
//     status: "checked" | "bad-code" | "no-proposal" | "skipped"
//   ctx = {gh, config, files, approvers, botLogin, siteUrl, now(), log(), cache}

import { applyProposal } from '../../js/core/ops.js';
import { buildGraph } from '../../js/core/graph.js';
import { normalizeData } from '../../js/core/schema.js';
import { refNames, describeProposal } from '../../js/core/describe.js';
import { formatIssue } from '../../js/core/messages.js';
import { encodeProposal } from '../../js/core/codec.js';
import { LABELS, LABEL_DEFS, MARKERS, hasLabel } from './labels.mjs';
import { parseMarker } from './render.mjs';
import { hashProposal } from './hash.mjs';
import { effectiveProposal, appliedEntry, depsFor, openIndex, findBotComment } from './proposal.mjs';
import { checkComment, badCodeComment, noProposalComment } from './comments.mjs';

export const PREVIEW_CODE_MAX = 30000;

/** Fields of the issue form ("### Heading\n\nvalue") — submitter and note, best effort (used when the proposal has none). */
export function formFields(body) {
  const out = {};
  const text = String(body || '');
  const grab = (re) => {
    const m = re.exec(text);
    if (!m) return '';
    const v = m[1].trim();
    return v === '_No response_' ? '' : v;
  };
  out.submitter = grab(/###[^\n]*(?:Your name|اسمك)[^\n]*\n+([\s\S]*?)(?=\n###|$)/i);
  out.note = grab(/###[^\n]*(?:Note|ملاحظة)[^\n]*\n+([\s\S]*?)(?=\n###|$)/i);
  return out;
}

/** Bilingual lines for a list of Issues. */
export function issueLines(list, ctx) {
  return {
    ar: list.map((i) => formatIssue(i, 'ar', ctx)),
    en: list.map((i) => formatIssue(i, 'en', ctx)),
  };
}

/** Preview link: <siteUrl>#/preview?code=<code>, or #/preview/<n> when the code is long. */
export async function previewUrl(siteUrl, proposal, code, number) {
  let c = code;
  if (!c) {
    try { c = await encodeProposal(proposal); } catch { c = null; }
  }
  if (c && c.length <= PREVIEW_CODE_MAX) return `${siteUrl}#/preview?code=${c}`;
  return `${siteUrl}#/preview/${number}`;
}

async function ensureLabelsOnce(ctx) {
  if (ctx.cache.labelsEnsured) return;
  await ctx.gh.ensureLabels(LABEL_DEFS);
  ctx.cache.labelsEnsured = true;
}

/** Create or update the bot's check comment (no write when the body is unchanged). */
export async function upsertCheckComment(ctx, number, existing, body) {
  if (existing) {
    if (existing.body === body) return existing;
    return ctx.gh.updateComment(existing.id, body);
  }
  return ctx.gh.createComment(number, body);
}

export async function checkIssue(ctx, number, opts = {}) {
  const { gh } = ctx;
  const issue = opts.issue || await gh.getIssue(number);
  if (!issue || issue.pull_request) return { status: 'skipped', reason: 'not-an-issue' };
  if (issue.state !== 'open') return { status: 'skipped', reason: 'closed' };
  if (hasLabel(issue, LABELS.APPLIED)) return { status: 'skipped', reason: 'applied' };

  const comments = opts.comments || await gh.listComments(number);
  const existing = findBotComment(comments, MARKERS.CHECK, ctx.botLogin);
  const prev = existing ? parseMarker(existing.body, MARKERS.CHECK) : null;
  const eff = await effectiveProposal(issue, comments, { approvers: ctx.approvers });

  if (eff.error) {
    await ensureLabelsOnce(ctx);
    if (!hasLabel(issue, LABELS.FAMILY_TREE)) await gh.addLabels(number, [LABELS.FAMILY_TREE]);
    const issueObj = { code: eff.error.code || 'BAD_CODE', params: {} };
    const body = badCodeComment({
      errorAr: formatIssue(issueObj, 'ar'), errorEn: formatIssue(issueObj, 'en'),
      edits: (Number(prev?.edits) || 0) + (prev && prev.hash !== 'none' ? 1 : 0), src: 'body',
    });
    await upsertCheckComment(ctx, number, existing, body);
    return { status: 'bad-code', code: issueObj.code };
  }
  if (!eff.proposal) {
    if (existing) await upsertCheckComment(ctx, number, existing, noProposalComment({ edits: (Number(prev?.edits) || 0) + (prev && prev.hash !== 'none' ? 1 : 0) }));
    return { status: 'no-proposal' };
  }

  const data = opts.data || ctx.files.loadData();
  const applied = opts.applied || ctx.files.loadApplied();
  const { hash, fp } = await hashProposal(eff.proposal);
  let edits = Number(prev?.edits) || 0;
  if (prev && prev.src === 'body' && eff.src === 'body' && prev.hash && prev.hash !== hash) edits += 1;

  // Other open proposals (identical content, dependencies).
  let index = opts.index;
  if (!index) {
    const open = opts.openIssues || await gh.listIssues({ state: 'open', labels: LABELS.FAMILY_TREE });
    index = await openIndex(open.filter((i) => i.number !== number));
  }
  const others = index.filter((x) => x.number !== number);
  const identicalTo = others.filter((x) => x.hash === hash).map((x) => x.number);
  const done = appliedEntry(applied, hash);

  // Dry run in final mode (destructive allowed, so every problem is listed).
  const { refMap, appliedDeps } = depsFor(eff.proposal, applied);
  const result = applyProposal(data, eff.proposal, {
    mode: 'final', allowDestructive: true, refMap, appliedDeps, issue: number, actor: '', now: ctx.now(),
  });
  const graph = buildGraph(normalizeData(data));
  const names = { graph, refNames: refNames(eff.proposal, graph) };
  const dependsOnIssues = [];
  for (const e of result.errors) {
    if (e.code !== 'DEPENDS_ON_PENDING') continue;
    const pending = [e.params?.proposalId, ...(e.params?.pending || [])].filter(Boolean);
    for (const pid of pending) {
      const hit = others.find((x) => x.proposalId === pid);
      if (hit && !dependsOnIssues.includes(hit.number)) dependsOnIssues.push(hit.number);
    }
    if (dependsOnIssues.length && e.params) e.params = { ...e.params, issue: dependsOnIssues[0] };
  }
  const describe = describeProposal(eff.proposal, graph, 'en');
  const describeAr = describeProposal(eff.proposal, graph, 'ar');
  const destructive = result.ok ? result.destructive : describe.destructive;
  const failingOps = [...new Set(result.errors.filter((e) => Number.isInteger(e.op)).map((e) => e.op + 1))].sort((a, b) => a - b);
  const allOpErrors = result.errors.length > 0 && result.errors.every((e) => Number.isInteger(e.op));

  await ensureLabelsOnce(ctx);
  const want = [];
  if (!hasLabel(issue, LABELS.FAMILY_TREE)) want.push(LABELS.FAMILY_TREE);
  if (destructive && !hasLabel(issue, LABELS.DELETION_REQUEST)) want.push(LABELS.DELETION_REQUEST);
  if (want.length) await gh.addLabels(number, want);
  if (!destructive && hasLabel(issue, LABELS.DELETION_REQUEST)) await gh.removeLabel(number, LABELS.DELETION_REQUEST);

  const body = checkComment({
    hash, fp, rev: data?.meta?.revision ?? 0, edits, src: eff.src, proposal: eff.proposal,
    formFields: eff.src === 'body' ? formFields(issue.body) : {},
    describe: { ar: describeAr.lines, en: describe.lines },
    errors: issueLines(result.errors, names),
    warnings: issueLines(result.warnings, names),
    ok: result.ok, destructive,
    previewUrl: await previewUrl(ctx.siteUrl, eff.proposal, eff.code, number),
    appliedIn: done ? done.issue : null,
    identicalTo,
    dependsOnIssues,
    failingOps: allOpErrors ? failingOps : [],
    staleEdit: result.errors.some((e) => e.code === 'STALE_EDIT'),
  });
  await upsertCheckComment(ctx, number, existing, body);
  return { status: 'checked', hash, fp, edits, ok: result.ok, destructive, src: eff.src, errors: result.errors, warnings: result.warnings };
}

/** Re-check several open issues (after an apply), at most `max`. Errors are logged, never thrown. */
export async function recheckIssues(ctx, numbers, { max = 30, data, applied } = {}) {
  const open = await ctx.gh.listIssues({ state: 'open', labels: LABELS.FAMILY_TREE });
  const index = await openIndex(open);
  const out = [];
  for (const n of numbers.slice(0, max)) {
    try {
      const issue = open.find((i) => i.number === n);
      out.push({ number: n, ...(await checkIssue(ctx, n, { issue, data, applied, index })) });
    } catch (e) {
      ctx.log(`re-check of #${n} failed: ${e.message}`);
      out.push({ number: n, status: 'error', error: e.message });
    }
  }
  return out;
}
