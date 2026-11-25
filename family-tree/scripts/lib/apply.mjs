// The approval queue (docs/SPEC.md §6.3, §6.5, §6.6): owner commands, approver verification, integrity checks,
// one commit per run with a push-retry loop, result comments, Pages build, re-checks of other open proposals.
//
//   runApply(ctx, {eventName, event}) → summary (for logs/tests)
//   ctx = baseContext(...) + {gh, git, branch}; ctx.dryRun → nothing is written (files, git, GitHub writes logged).

import { applyProposal, isDestructive, skipOps } from '../../js/core/ops.js';
import { buildGraph } from '../../js/core/graph.js';
import { normalizeData } from '../../js/core/schema.js';
import { describeProposal, refNames } from '../../js/core/describe.js';
import { formatIssue } from '../../js/core/messages.js';
import { lineageName, fullName } from '../../js/core/names.js';
import { LABELS, APPROVAL_LABELS, MARKERS, hasLabel } from './labels.mjs';
import { parseCommand, isApprover, labelForCommand } from './commands.mjs';
import { parseMarker } from './render.mjs';
import { hashProposal, fpMatches } from './hash.mjs';
import {
  effectiveProposal, correctionIn, appliedEntry, depsFor, findBotComment, botComments, orderByDependencies, openIndex,
} from './proposal.mjs';
import { checkIssue, recheckIssues, issueLines } from './check.mjs';
import { commitAndPush } from './repo.mjs';
import { planUndo } from './undo.mjs';
import {
  appliedComment, whatsappLink, failedComment, needDeletionComment, needFpComment, simpleComment, approvalNote,
  rejectComment, undoneComment, undoRefusedComment,
} from './comments.mjs';

const owners = (ctx) => ({
  owner: ctx.config?.owner?.name?.ar || 'مشرف الشجرة',
  ownerEn: ctx.config?.owner?.name?.en || 'the tree keeper',
});

/** Display names of a person in both languages (lineage when possible). */
export function namesOf(graph, id) {
  const p = graph.person(id) || graph.resolve?.(id) || null;
  const one = (lang) => {
    try { return lineageName(graph, id, lang) || (p ? fullName(p, lang, graph) : id); } catch { return p ? fullName(p, lang, graph) : id; }
  };
  return { ar: one('ar') || id, en: one('en') || id };
}

const commitUrl = (ctx, sha) => `${ctx.serverUrl}/${ctx.slug.owner}/${ctx.slug.name}/commit/${sha}`;

async function isProposalIssue(issue) {
  if (hasLabel(issue, LABELS.FAMILY_TREE)) return true;
  const eff = await effectiveProposal(issue, [], {});
  return !!(eff.proposal || eff.error);
}

// ---------------------------------------------------------------------------------------------------------
// Entry point

export async function runApply(ctx, { eventName, event = {} }) {
  const summary = { event: eventName, command: null, swept: [], queue: null };
  if (eventName === 'issue_comment') summary.command = await handleComment(ctx, event);
  // A pending run can be cancelled by a newer one (GitHub keeps one pending run per concurrency group), so every run
  // also answers approver commands that never got a reply, then processes the whole queue.
  summary.swept = await sweepMissedCommands(ctx);
  const only = eventName === 'workflow_dispatch' ? Number(event.inputs?.issue) || null : null;
  summary.queue = await processQueue(ctx, { only });
  return summary;
}

// ---------------------------------------------------------------------------------------------------------
// Commands in comments

export async function handleComment(ctx, event) {
  const { gh } = ctx;
  const n = Number(event.issue?.number);
  const cid = event.comment?.id;
  if (!n || !cid || event.issue?.pull_request) return { action: 'ignored', reason: 'not-an-issue-comment' };
  let comment;
  try { comment = await gh.getComment(cid); } catch { comment = null; }
  if (!comment) return { action: 'ignored', reason: 'comment-gone' };
  const cmd = parseCommand(comment.body);
  if (!cmd) return { action: 'ignored', reason: 'not-a-command' };
  const issue = await gh.getIssue(n);
  if (issue.pull_request) return { action: 'ignored', reason: 'pull-request' };
  return handleCommand(ctx, issue, comment, cmd);
}

/** Run one parsed command of a comment on an issue (authorization included). */
export async function handleCommand(ctx, issue, comment, cmd) {
  const { gh } = ctx;
  const n = issue.number;
  if (!(await isProposalIssue(issue))) return { action: 'ignored', reason: 'not-a-proposal' };
  const actor = comment.user?.login || '';
  if (!isApprover(actor, ctx.approvers)) {
    await gh.createComment(n, simpleComment('notApprover', owners(ctx), 'not-approver'));
    return { action: 'unauthorized', actor };
  }
  if (cmd.cmd === 'reject') return rejectIssue(ctx, issue);
  if (cmd.cmd === 'undo') return undoIssue(ctx, issue, actor);
  return approveCommand(ctx, issue, comment, cmd);
}

/**
 * Approver commands (approve / approve-deletion / correct / reject) on open proposals that the bot never answered —
 * i.e. no bot comment after them — are handled now. → issue numbers handled.
 */
export async function sweepMissedCommands(ctx, { max = 30 } = {}) {
  const { gh } = ctx;
  const handled = [];
  const open = (await gh.listIssues({ state: 'open', labels: LABELS.FAMILY_TREE })).filter((i) => !hasLabel(i, LABELS.APPLIED));
  for (const listed of open.slice(0, max)) {
    try {
      const comments = await gh.listComments(listed.number);
      let pending = null;
      for (let i = comments.length - 1; i >= 0; i--) {
        const c = comments[i];
        if (c.user?.login === ctx.botLogin) break;
        const cmd = parseCommand(c.body);
        if (cmd && cmd.cmd !== 'undo' && isApprover(c.user?.login, ctx.approvers)) { pending = { c, cmd }; break; }
      }
      if (!pending) continue;
      ctx.log(`#${listed.number}: answering a command that got no reply (comment ${pending.c.id})`);
      const issue = await gh.getIssue(listed.number);
      await handleCommand(ctx, issue, pending.c, pending.cmd);
      handled.push(listed.number);
    } catch (e) {
      ctx.log(`#${listed.number}: sweep failed: ${e.message}`);
    }
  }
  return handled;
}

async function approveCommand(ctx, issue, comment, cmd) {
  const { gh } = ctx;
  const n = issue.number;
  if (issue.state !== 'open') {
    await gh.createComment(n, simpleComment('closedIssue', {}, 'closed'));
    return { action: 'closed' };
  }
  if (hasLabel(issue, LABELS.APPLIED)) {
    await gh.createComment(n, simpleComment('alreadyApplied', { ref: `#${n}` }, 'already-applied'));
    return { action: 'already-applied' };
  }
  let correction = null;
  try {
    correction = await correctionIn(comment.body);
  } catch (e) {
    const issueObj = { code: e.code || 'BAD_CODE', params: {} };
    await gh.createComment(n, [simpleComment('correctionBroken', {}, 'bad-correction').replace('\n\n', '\n\n❌ '),
      `${formatIssue(issueObj, 'ar')} · ${formatIssue(issueObj, 'en')}`].join('\n\n'));
    return { action: 'bad-correction', code: issueObj.code };
  }
  const check = await checkIssue(ctx, n, { issue });
  if (check.status !== 'checked') {
    await gh.createComment(n, simpleComment('noProposalToApprove', {}, 'no-proposal'));
    return { action: 'no-proposal' };
  }
  if (cmd.cmd === 'correct') {
    await gh.createComment(n, `✏️ ${simpleComment('correctionReceived', {}, 'corrected')}`.replace(/^✏️ (<!--[^\n]*-->)/, '$1\n\n✏️'));
    return { action: 'corrected', hash: check.hash };
  }
  const label = labelForCommand(cmd.cmd);
  if (label === LABELS.APPROVE && check.destructive && !cmd.skip.length) {
    // Known now (incl. REPARENT from the dry run): ask for the separate deletion approval straight away.
    await gh.createComment(n, needDeletionComment({ fp: check.fp }));
    if (hasLabel(issue, LABELS.APPROVE)) await gh.removeLabel(n, LABELS.APPROVE);
    return { action: 'needs-deletion-approval', hash: check.hash };
  }
  await gh.createComment(n, approvalNote({
    cmd: label, commentId: comment.id, by: comment.user?.login, fp: cmd.fp, skip: cmd.skipShown, force: cmd.force, correction: !!correction,
  }));
  // Re-add the label so the newest "labeled" event is the bot's (it then points at this comment).
  if (hasLabel(issue, label)) await gh.removeLabel(n, label);
  await gh.addLabels(n, [label]);
  return { action: 'approval-recorded', label, runQueue: true, hash: check.hash, correction: !!correction };
}

export async function rejectIssue(ctx, issue) {
  const { gh } = ctx;
  const n = issue.number;
  await gh.createComment(n, rejectComment());
  for (const l of APPROVAL_LABELS) if (hasLabel(issue, l)) await gh.removeLabel(n, l);
  if (issue.state === 'open') await gh.closeIssue(n, 'not_planned');
  return { action: 'rejected' };
}

// ---------------------------------------------------------------------------------------------------------
// Approval verification (issue events API)

/**
 * Who set the approval label(s)? → {ok, label, actor, fp, skip, skipShown, force, via, unverified: [labels]}
 * A label counts when its most recent "labeled" event was made by an approver, or by the bot acting on an approver's
 * command comment (the bot's approval note names the comment; fp/skip/force are re-read from that comment).
 */
export function verifyApproval(ctx, issue, events, comments) {
  const present = APPROVAL_LABELS.filter((l) => hasLabel(issue, l));
  const unverified = [];
  let chosen = null;
  for (const label of present) {
    const ev = [...(events || [])].reverse().find((e) => e?.event === 'labeled' && e.label?.name === label);
    let v = null;
    if (ev) {
      const actor = ev.actor?.login || '';
      if (isApprover(actor, ctx.approvers)) {
        v = { label, actor, fp: null, skip: [], skipShown: [], force: false, via: 'label' };
      } else if (actor === ctx.botLogin) {
        const notes = botComments(comments, MARKERS.APPROVAL, ctx.botLogin)
          .map((c) => parseMarker(c.body, MARKERS.APPROVAL))
          .filter((m) => m && m.cmd === label);
        const ref = notes[notes.length - 1];
        const src = ref && (comments || []).find((c) => String(c.id) === String(ref.comment));
        if (src && isApprover(src.user?.login, ctx.approvers)) {
          const cmd = parseCommand(src.body);
          if (cmd && labelForCommand(cmd.cmd) === label) {
            v = { label, actor: src.user.login, fp: cmd.fp, skip: cmd.skip, skipShown: cmd.skipShown, force: cmd.force, via: 'comment', commentId: src.id };
          }
        }
      }
    } else if (isApprover(issue.user?.login, ctx.approvers)) {
      // No event recorded (should not happen): an approver's own issue may carry the label from creation.
      v = { label, actor: issue.user.login, fp: null, skip: [], skipShown: [], force: false, via: 'author' };
    }
    if (v) { if (!chosen) chosen = v; } else unverified.push(label);
  }
  return chosen ? { ok: true, ...chosen, unverified } : { ok: false, unverified };
}

// ---------------------------------------------------------------------------------------------------------
// Queue

async function dropApproval(ctx, n, labels) {
  for (const l of labels) await ctx.gh.removeLabel(n, l);
}

/** Verify and prepare one queued issue. → plan item or null (a comment explains why). */
export async function prepareIssue(ctx, number, applied) {
  const { gh } = ctx;
  const issue = await gh.getIssue(number);
  if (issue.state !== 'open' || hasLabel(issue, LABELS.APPLIED)) return null;
  const comments = await gh.listComments(number);
  const events = await gh.listIssueEvents(number);
  const approval = verifyApproval(ctx, issue, events, comments);
  for (const l of approval.unverified) {
    await gh.removeLabel(number, l);
    await gh.createComment(number, simpleComment('unverifiedLabel', { ...owners(ctx), label: l }, 'unverified-label'));
  }
  if (!approval.ok) return null;
  const labelsNow = APPROVAL_LABELS.filter((l) => hasLabel(issue, l) && !approval.unverified.includes(l));
  const cmdName = approval.label === LABELS.APPROVE_DELETION ? 'approve-deletion' : 'approve';

  const eff = await effectiveProposal(issue, comments, { approvers: ctx.approvers });
  if (!eff.proposal) {
    if (eff.error) await checkIssue(ctx, number, { issue, comments });
    await gh.createComment(number, simpleComment('noProposalToApprove', {}, 'no-proposal'));
    await dropApproval(ctx, number, labelsNow);
    return null;
  }
  const { hash, fp } = await hashProposal(eff.proposal);
  const done = appliedEntry(applied, hash);
  if (done) {
    await gh.createComment(number, simpleComment('alreadyApplied', { ref: `#${done.issue}` }, 'duplicate'));
    await gh.addLabels(number, [LABELS.APPLIED, LABELS.DUPLICATE]);
    await gh.closeIssue(number, 'completed');
    return null;
  }
  // Integrity: what is approved must be what the owner saw.
  if (approval.fp) {
    if (!fpMatches(approval.fp, hash)) {
      await gh.createComment(number, needFpComment({ fp, cmd: cmdName, given: approval.fp }));
      await dropApproval(ctx, number, [approval.label]);
      return null;
    }
  } else if (eff.src === 'body' && !isApprover(issue.user?.login, ctx.approvers)) {
    const check = findBotComment(comments, MARKERS.CHECK, ctx.botLogin);
    const m = check ? parseMarker(check.body, MARKERS.CHECK) : null;
    if (!m || Number(m.edits) !== 0 || m.hash !== hash) {
      await gh.createComment(number, needFpComment({ fp, cmd: cmdName }));
      await dropApproval(ctx, number, [approval.label]);
      return null;
    }
  }
  const proposal = approval.skip.length ? skipOps(eff.proposal, approval.skip) : eff.proposal;
  const allowDestructive = approval.label === LABELS.APPROVE_DELETION;
  if (!allowDestructive && isDestructive(proposal)) {
    await gh.createComment(number, needDeletionComment({ fp }));
    await dropApproval(ctx, number, [LABELS.APPROVE]);
    return null;
  }
  return {
    number, issue, proposal, original: eff.proposal, hash, fp, allowDestructive, force: approval.force,
    skipShown: approval.skipShown, actor: approval.actor, cmd: cmdName, labels: labelsNow, src: eff.src,
  };
}

/** Fill empty `commit` fields of ledger entries from the commit trailers (they are known only after a commit). */
export function backfillCommits(ctx, changelog, applied) {
  if (!ctx.git) return 0;
  const missing = (changelog.entries || []).some((e) => e && !e.commit) || Object.values(applied || {}).some((e) => e && !e.commit);
  if (!missing) return 0;
  let map;
  try { map = ctx.git.commitTrailers(ctx.files.paths.rel.dataDir); } catch { return 0; }
  let filled = 0;
  for (const e of changelog.entries || []) {
    if (!e || e.commit) continue;
    const sha = map.get(`${e.action === 'undo' ? 'undo' : 'apply'}:${e.issue}:${e.rev}`);
    if (sha) { e.commit = sha; filled++; }
  }
  for (const e of Object.values(applied || {})) {
    if (!e || e.commit || e.rev === undefined) continue;
    const sha = map.get(`apply:${e.issue}:${e.rev}`);
    if (sha) { e.commit = sha; filled++; }
  }
  return filled;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function commitMessage(okOutcomes) {
  const nums = okOutcomes.map((o) => `#${o.item.number}`);
  const title = okOutcomes.length === 1
    ? clip(`family-tree: apply ${nums[0]} - ${oneLine(okOutcomes[0].titleEn)}`, 72)
    : clip(`family-tree: apply ${nums.join(', ')}`, 72);
  const body = [];
  for (const o of okOutcomes) {
    body.push(`#${o.item.number} (rev ${o.rev}): ${clip(oneLine(o.titleEn), 200)}`);
    for (const line of o.linesEn.slice(0, 20)) body.push(`  - ${clip(oneLine(line), 200)}`);
    if (o.linesEn.length > 20) body.push(`  - ... and ${o.linesEn.length - 20} more`);
  }
  const trailers = okOutcomes.map((o) => `Gft-Apply: #${o.item.number} ${o.item.hash} rev ${o.rev}`);
  return `${title}\n\n${body.join('\n')}\n\n${trailers.join('\n')}\n`;
}

/** Apply the whole batch on the data currently on disk → {message, paths, value: {outcomes, data, applied, changelog}} */
export async function buildBatch(ctx, plan) {
  const { data, changelog, applied } = ctx.files.loadAll();
  backfillCommits(ctx, changelog, applied);
  const now = ctx.now();
  let cur = data;
  const batch = new Map();
  const outcomes = [];
  for (const item of plan) {
    const { refMap, appliedDeps } = depsFor(item.proposal, applied, batch);
    const r = applyProposal(cur, item.proposal, {
      mode: 'final', now, issue: item.number, actor: item.actor, allowDestructive: item.allowDestructive,
      force: item.force, refMap, appliedDeps,
    });
    if (!r.ok) {
      outcomes.push({
        item, ok: false, errors: r.errors, warnings: r.warnings, graph: buildGraph(normalizeData(cur)),
        needsDeletion: !item.allowDestructive && r.errors.some((e) => e.code === 'DESTRUCTIVE_NOT_ALLOWED'),
      });
      continue;
    }
    const before = cur;
    cur = r.data;
    batch.set(item.proposal.id, { idMap: r.idMap });
    const gBefore = buildGraph(normalizeData(before));
    const en = describeProposal(item.proposal, gBefore, 'en');
    const ar = describeProposal(item.proposal, gBefore, 'ar');
    outcomes.push({ item, ok: true, result: r, rev: r.data.meta.revision, titleEn: en.title, linesEn: en.lines, linesAr: ar.lines, refNames: refNames(item.proposal, gBefore) });
  }
  const ok = outcomes.filter((o) => o.ok);
  if (!ok.length) return { message: null, value: { outcomes, data: cur, applied, changelog } };

  for (const o of ok) {
    const r = o.result;
    const people = [...new Set([...r.created.people, ...r.touched.people])].filter((id) => cur.people[id] && !cur.people[id].removed);
    const touched = {
      people: [...new Set([...r.touched.people, ...r.created.people])],
      unions: [...new Set([...r.touched.unions, ...r.created.unions])],
    };
    const s = o.item.proposal.submitter || {};
    const entry = {
      issue: o.item.number, proposalId: o.item.proposal.id || '', hash: o.item.hash, commit: '', rev: o.rev, at: now,
      title: o.titleEn, summary: { en: o.linesEn.slice(0, 150), ar: o.linesAr.slice(0, 150) },
      submitter: { name: String(s.name || ''), relation: String(s.relation || '') }, approvedBy: o.item.actor,
      people, touched, destructive: !!r.destructive, action: 'apply',
    };
    if (o.item.skipShown.length) entry.skipped = o.item.skipShown;
    changelog.entries.unshift(entry);
    applied[o.item.hash] = {
      issue: o.item.number, proposalId: o.item.proposal.id || '', commit: '', idMap: r.idMap, at: now, rev: o.rev,
      ...(o.item.skipShown.length ? { skipped: o.item.skipShown } : {}),
    };
    o.people = people;
  }
  const paths = ctx.dryRun ? [] : ctx.files.saveAll({ data: cur, changelog, applied });
  return { message: commitMessage(ok), paths, value: { outcomes, data: cur, applied, changelog } };
}

/** Poll the Pages build of the pushed commit (≤ timeout); request a build when it is not building that commit. */
export async function waitForPages(ctx, sha, { timeoutMs = 90000, intervalMs = 10000 } = {}) {
  const polls = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i <= polls; i++) {
    let b = null;
    try {
      b = await ctx.gh.latestPagesBuild();
    } catch (e) {
      if (e.status === 404) return { status: 'no-pages' };
    }
    if (b && b.commit === sha) return { status: b.status || 'unknown' };
    if (i < polls) await ctx.sleep(intervalMs);
  }
  try {
    await ctx.gh.requestPagesBuild();
    return { status: 'requested' };
  } catch (e) {
    return { status: 'request-failed', error: e.message };
  }
}

export async function processQueue(ctx, { only = null } = {}) {
  const { gh } = ctx;
  const open = await gh.listIssues({ state: 'open', labels: LABELS.FAMILY_TREE });
  let queued = open
    .filter((i) => APPROVAL_LABELS.some((l) => hasLabel(i, l)) && !hasLabel(i, LABELS.APPLIED))
    .sort((a, b) => a.number - b.number);
  if (only) queued = queued.filter((i) => i.number === only);
  const summary = { queued: queued.map((i) => i.number), planned: [], applied: [], failed: [], gated: [], pushed: false };
  if (!queued.length) return summary;

  const applied0 = ctx.files.loadApplied();
  const plan = [];
  for (const i of queued) {
    try {
      const item = await prepareIssue(ctx, i.number, applied0);
      if (item) plan.push(item);
    } catch (e) {
      ctx.log(`#${i.number}: could not prepare: ${e.message}`);
    }
  }
  summary.planned = plan.map((p) => p.number);
  if (!plan.length) return summary;
  const ordered = orderByDependencies(plan);

  const res = await commitAndPush({
    git: ctx.git, branch: ctx.branch, build: () => buildBatch(ctx, ordered), sleep: ctx.sleep, log: ctx.log,
    dryRun: ctx.dryRun, attempts: ctx.pushAttempts || 5, backoff: ctx.backoff,
  });
  summary.pushed = res.committed;
  summary.sha = res.sha || null;
  summary.attempts = res.attempt;
  const value = res.value || { outcomes: [] };
  const finalGraph = value.data ? buildGraph(normalizeData(value.data)) : null;
  const open2 = await gh.listIssues({ state: 'open', labels: LABELS.FAMILY_TREE });
  const index = await openIndex(open2);

  for (const o of value.outcomes) {
    const n = o.item.number;
    if (o.ok) {
      if (res.committed || ctx.dryRun) {
        const rev = o.rev;
        const people = (o.people || []).map((id) => ({ ...namesOf(finalGraph, id), url: `${ctx.siteUrl}#/p/${id}?rev=${rev}` }));
        const target = people[0]?.url || `${ctx.siteUrl}#/changes?rev=${rev}`;
        await gh.createComment(n, appliedComment({
          commitUrl: res.sha ? commitUrl(ctx, res.sha) : null, commitShort: res.sha ? res.sha.slice(0, 7) : 'dry-run', rev, people, issue: n,
          warnings: issueLines(o.result.warnings, { graph: finalGraph, refNames: o.refNames }),
          whatsappUrl: whatsappLink(target), skipped: o.item.skipShown,
        }));
        await gh.addLabels(n, [LABELS.APPLIED]);
        if (hasLabel(o.item.issue, LABELS.NEEDS_CHANGES)) await gh.removeLabel(n, LABELS.NEEDS_CHANGES);
        await gh.closeIssue(n, 'completed');
        summary.applied.push(n);
      } else {
        await gh.createComment(n, simpleComment('retryLater', {}, 'retry'));
        summary.failed.push(n);
      }
      continue;
    }
    if (o.needsDeletion) {
      await gh.createComment(n, needDeletionComment({ fp: o.item.fp }));
      await dropApproval(ctx, n, [LABELS.APPROVE]);
      summary.gated.push(n);
      continue;
    }
    const names = { graph: o.graph, refNames: refNames(o.item.proposal, o.graph) };
    const dependsOnIssues = [];
    for (const e of o.errors) {
      if (e.code !== 'DEPENDS_ON_PENDING') continue;
      for (const pid of [e.params?.proposalId, ...(e.params?.pending || [])].filter(Boolean)) {
        const hit = index.find((x) => x.proposalId === pid && x.number !== n);
        if (hit && !dependsOnIssues.includes(hit.number)) dependsOnIssues.push(hit.number);
      }
    }
    const failingOps = o.errors.every((e) => Number.isInteger(e.op))
      ? [...new Set(o.errors.map((e) => e.op + 1))].sort((a, b) => a - b) : [];
    await gh.createComment(n, failedComment({
      errors: issueLines(o.errors, names), fp: o.item.fp, cmd: o.item.cmd, failingOps, total: o.item.proposal.ops?.length || 0,
      staleEdit: o.errors.some((e) => e.code === 'STALE_EDIT'), dependsOnIssues,
    }));
    await gh.addLabels(n, [LABELS.NEEDS_CHANGES]);
    await dropApproval(ctx, n, o.item.labels);
    summary.failed.push(n);
  }
  if (!res.ok) ctx.log(`push failed after ${res.attempt} attempts: ${res.error?.message || ''}`);

  if (res.committed) {
    summary.pages = await waitForPages(ctx, res.sha, ctx.pagesWait || {});
    const others = open2.filter((i) => !summary.applied.includes(i.number) && !hasLabel(i, LABELS.APPLIED)).map((i) => i.number);
    summary.rechecked = (await recheckIssues(ctx, others, { data: value.data, applied: value.applied })).map((r) => r.number);
  }
  return summary;
}

// ---------------------------------------------------------------------------------------------------------
// Undo

export async function undoIssue(ctx, issue, actor) {
  const { gh } = ctx;
  const n = issue.number;
  if (issue.state !== 'closed' || !hasLabel(issue, LABELS.APPLIED)) {
    await gh.createComment(n, undoRefusedComment({ reason: 'not-applied' }));
    return { action: 'undo-refused', reason: 'not-applied' };
  }
  if (!ctx.git) throw new Error('undo needs a git checkout');
  const res = await commitAndPush({
    git: ctx.git, branch: ctx.branch, sleep: ctx.sleep, log: ctx.log, dryRun: ctx.dryRun,
    attempts: ctx.pushAttempts || 5, backoff: ctx.backoff,
    build: async () => {
      const { data, changelog, applied } = ctx.files.loadAll();
      backfillCommits(ctx, changelog, applied);
      const plan = planUndo({ git: ctx.git, rel: ctx.files.paths.rel, data, changelog, applied, number: n, actor, now: ctx.now() });
      if (!plan.ok) return { message: null, value: plan };
      const paths = ctx.dryRun ? [] : ctx.files.saveAll(plan);
      return { message: plan.message, paths, value: plan };
    },
  });
  const plan = res.value;
  if (!res.ok) {
    await gh.createComment(n, simpleComment('retryLater', {}, 'retry'));
    return { action: 'undo-retry' };
  }
  if (!plan?.ok) {
    let records = [];
    let errors = { ar: [], en: [] };
    if (plan?.reason === 'changed') {
      const g = buildGraph(normalizeData(ctx.files.loadData()), { includeRemoved: true });
      records = plan.records.map((r) => (r.kind === 'people' ? namesOf(g, r.id) : { ar: `أسرة ${r.id}`, en: `family record ${r.id}` }));
    } else if (plan?.reason === 'invalid') {
      errors = issueLines(plan.errors, { graph: buildGraph(normalizeData(ctx.files.loadData())) });
    }
    await gh.createComment(n, undoRefusedComment({ reason: plan?.reason || 'nothing', records, errors }));
    return { action: 'undo-refused', reason: plan?.reason };
  }
  const gNow = buildGraph(normalizeData(plan.data));
  const gAfter = buildGraph(plan.after, { includeRemoved: true });
  const people = [
    ...plan.restored.people.filter((id) => gNow.person(id)).map((id) => ({ ...namesOf(gNow, id), url: `${ctx.siteUrl}#/p/${id}?rev=${plan.rev}` })),
    ...plan.deleted.people.map((id) => ({ ...namesOf(gAfter, id), url: null })),
  ];
  await gh.createComment(n, undoneComment({
    issue: n, commitUrl: res.sha ? commitUrl(ctx, res.sha) : null, commitShort: res.sha ? res.sha.slice(0, 7) : 'dry-run', rev: plan.rev, people,
  }));
  await gh.addLabels(n, [LABELS.UNDONE]);
  await gh.removeLabel(n, LABELS.APPLIED);
  const summary = { action: 'undone', rev: plan.rev, sha: res.sha || null, restored: plan.restored, deleted: plan.deleted };
  if (res.committed) {
    summary.pages = await waitForPages(ctx, res.sha, ctx.pagesWait || {});
    const open = await gh.listIssues({ state: 'open', labels: LABELS.FAMILY_TREE });
    summary.rechecked = (await recheckIssues(ctx, open.filter((i) => !hasLabel(i, LABELS.APPLIED)).map((i) => i.number),
      { data: plan.data, applied: plan.applied })).map((r) => r.number);
  }
  return summary;
}
