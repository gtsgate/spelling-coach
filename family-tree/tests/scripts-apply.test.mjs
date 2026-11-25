// The apply queue (docs/SPEC.md §6.3, §6.5, §6.6) end to end: a fake GitHub, a temporary git repository with a bare
// "origin", real commits and pushes. Covers labels, comments, unauthorized users, destructive gating, fingerprints,
// edited bodies, duplicates, skip, force, dependsOn, reject, push conflicts, undo and the ledgers.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runApply, waitForPages, commitMessage } from '../scripts/lib/apply.mjs';
import { checkIssue } from '../scripts/lib/check.mjs';
import { createGit } from '../scripts/lib/repo.mjs';
import { hashProposal } from '../scripts/lib/hash.mjs';
import { applyProposal } from '../js/core/ops.js';
import { validateData, serializeData } from '../js/core/schema.js';
import { main as applyMain } from '../scripts/apply-proposal.mjs';
import {
  makePortal, makeCtx, fakeGitHub, proposal, P, codeBody, openProposal, commentEvent, sh,
} from './scripts-kit.mjs';

const portals = [];
const newPortal = (opts) => { const p = makePortal(opts); portals.push(p); return p; };
after(() => portals.forEach((p) => p.cleanup()));

const KEEPER = 'keeper'; // config.approvers = ["Keeper"] (case-insensitive)
const labeledEvent = (n, label) => ({ action: 'labeled', issue: { number: n }, label: { name: label }, repository: { default_branch: 'main' } });

/** A relative opens a proposal; the check workflow runs. */
async function submitted(gh, ctx, p, opts) {
  const n = await openProposal(gh, p, opts);
  await checkIssue(ctx, n);
  return n;
}
/** The keeper comments; the apply workflow runs on that comment. */
async function keeperSays(gh, ctx, n, body, login = KEEPER) {
  const c = gh.userComment(n, login, body);
  return runApply(ctx, { eventName: 'issue_comment', event: commentEvent(n, c) });
}
const lastBot = (gh, n) => gh.botComments(n).at(-1)?.body || '';
const issueOf = (gh, n) => gh.state.issues.get(n);

describe('apply: approvals', () => {
  test('approve label by the keeper → one commit pushed, ledgers, comment with ?rev links, applied + closed', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const p = proposal([P.addChild('pahmed01', 'يوسف')]);
    const n = await submitted(gh, ctx, p);
    gh.userLabel(n, 'approve', 'KEEPER');
    const s = await runApply(ctx, { eventName: 'issues', event: labeledEvent(n, 'approve') });
    assert.deepEqual(s.queue.applied, [n]);
    assert.equal(s.queue.pushed, true);

    const log = portal.originLog();
    assert.equal(log.length, 2);
    assert.match(log[0], new RegExp(`family-tree: apply #${n}$`));
    const msg = sh(portal.work, 'log', '-1', '--format=%B');
    const { hash } = await hashProposal(p);
    assert.match(msg, new RegExp(`^#${n} \\(rev 6\\): proposal ${p.id}, 1 change$`, 'm'));
    assert.match(msg, new RegExp(`^Gft-Apply: #${n} ${hash} rev 6$`, 'm'));
    assert.ok(msg.split('\n')[0].length <= 72);

    const data = JSON.parse(portal.originShow('data/family.json'));
    assert.equal(data.meta.revision, 6);
    assert.ok(validateData(data).ok);
    const newId = Object.keys(data.people).find((id) => data.people[id].name?.ar === 'يوسف');
    assert.ok(newId);
    assert.deepEqual(data.people[newId].history.at(-1), { issue: n, rev: 6, at: data.meta.updatedAt, action: 'add-person' });
    const changelog = JSON.parse(portal.originShow('data/changelog.json'));
    const e = changelog.entries[0];
    assert.equal(e.issue, n);
    assert.equal(e.hash, hash);
    assert.equal(e.action, 'apply');
    assert.equal(e.approvedBy, 'KEEPER');
    assert.deepEqual(e.people, [newId]);
    assert.ok(e.summary.ar[0].startsWith('إضافة «يوسف»'));
    const applied = JSON.parse(portal.originShow('data/applied.json'));
    assert.equal(applied[hash].issue, n);
    assert.equal(applied[hash].idMap.new1, newId);

    const body = lastBot(gh, n);
    assert.match(body, /### ✅ طُبّقت التعديلات/);
    assert.ok(body.includes(`https://fam.github.io/tree/#/p/${newId}?rev=6`));
    assert.ok(body.includes(`https://github.com/fam/tree/commit/${portal.git.head()}`));
    assert.match(body, /https:\/\/wa\.me\/\?text=/);
    assert.deepEqual(gh.labelsOf(n).sort(), ['applied', 'approve', 'family-tree']);
    assert.equal(issueOf(gh, n).state, 'closed');
    assert.equal(issueOf(gh, n).state_reason, 'completed');
    assert.equal(gh.state.pagesRequests, 1, 'Pages build requested when it is not building the pushed commit');
  });

  test('/approve <fp> comment → approval note + label, then applied; Arabic alias works too', async () => {
    const portal = newPortal({ layout: 'sub' });
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const p = proposal([P.addChild('pahmed01', 'يوسف')]);
    const n = await submitted(gh, ctx, p);
    const { fp } = await hashProposal(p);
    const s = await keeperSays(gh, ctx, n, `/موافق ${fp}`);
    assert.equal(s.command.action, 'approval-recorded');
    assert.deepEqual(s.queue.applied, [n]);
    assert.ok(gh.botComments(n).some((c) => c.body.includes('<!-- gft-bot:approval cmd=approve')));
    const data = JSON.parse(portal.originShow('data/family.json'));
    assert.equal(data.meta.revision, 6);
    assert.equal(issueOf(gh, n).state, 'closed');
  });

  test('unauthorized commenters and labellers are politely refused; nothing is applied', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const n = await submitted(gh, ctx, proposal([P.addChild('pahmed01')]));
    const s = await keeperSays(gh, ctx, n, '/approve', 'cousin');
    assert.equal(s.command.action, 'unauthorized');
    assert.match(lastBot(gh, n), /من صلاحيات مشرف الشجرة فقط/);
    assert.deepEqual(gh.labelsOf(n), ['family-tree']);
    // a collaborator with triage rights adds the label
    gh.userLabel(n, 'approve', 'triager');
    const s2 = await runApply(ctx, { eventName: 'issues', event: labeledEvent(n, 'approve') });
    assert.deepEqual(s2.queue.applied, []);
    assert.deepEqual(gh.labelsOf(n), ['family-tree']);
    assert.match(lastBot(gh, n), /The approve label was removed/);
    assert.equal(portal.originLog().length, 1);
  });

  test('integrity: a bare approval after the body was edited needs /approve <fp>; a wrong fp is refused', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const n = await submitted(gh, ctx, proposal([P.addChild('pahmed01', 'يوسف')]));
    const p2 = proposal([P.addChild('pahmed01', 'يونس')]);
    gh.userEdit(n, await codeBody(p2));
    await checkIssue(ctx, n); // the "edited" event
    gh.userLabel(n, 'approve', KEEPER);
    let s = await runApply(ctx, { eventName: 'issues', event: labeledEvent(n, 'approve') });
    assert.deepEqual(s.queue.applied, []);
    const { fp } = await hashProposal(p2);
    assert.match(lastBot(gh, n), /Please confirm the fingerprint/);
    assert.ok(lastBot(gh, n).includes(`/approve ${fp}`));
    assert.ok(!gh.labelsOf(n).includes('approve'));

    s = await keeperSays(gh, ctx, n, '/approve 0000000000000000');
    assert.deepEqual(s.queue.applied, []);
    assert.match(lastBot(gh, n), /doesn’t match the current version/);
    // an old-style 6-character fingerprint (even the right one) is refused as too short
    s = await keeperSays(gh, ctx, n, `/approve ${fp.slice(0, 6)}`);
    assert.deepEqual(s.queue.applied, []);
    assert.match(lastBot(gh, n), /is too short/);

    s = await keeperSays(gh, ctx, n, `/approve ${fp}`);
    assert.deepEqual(s.queue.applied, [n]);
    assert.ok(JSON.parse(portal.originShow('data/family.json')).people && /يونس/.test(portal.originShow('data/family.json')));
  });

  test('a body edited after the check (check not yet re-run) is not approved by a bare label', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const n = await submitted(gh, ctx, proposal([P.addChild('pahmed01', 'يوسف')]));
    gh.userEdit(n, await codeBody(proposal([P.addChild('pahmed01', 'شخص آخر')])));
    gh.userLabel(n, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'issues', event: labeledEvent(n, 'approve') });
    assert.deepEqual(s.queue.applied, []);
    assert.match(lastBot(gh, n), /Please confirm the fingerprint/);
  });

  test('destructive proposals need approve-deletion; then they apply', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const p = proposal([P.remove('pmona001')]);
    const n = await submitted(gh, ctx, p);
    const { fp } = await hashProposal(p);
    let s = await keeperSays(gh, ctx, n, `/approve ${fp}`);
    assert.equal(s.command.action, 'needs-deletion-approval');
    assert.deepEqual(s.queue.applied, []);
    assert.match(lastBot(gh, n), /The deletion approval is needed/);
    // the label route is gated in the queue
    gh.userLabel(n, 'approve', KEEPER);
    s = await runApply(ctx, { eventName: 'issues', event: labeledEvent(n, 'approve') });
    assert.deepEqual(s.queue.applied, []);
    assert.match(lastBot(gh, n), /The deletion approval is needed/);
    assert.ok(lastBot(gh, n).includes(`/approve-deletion ${fp}`));
    assert.ok(!gh.labelsOf(n).includes('approve'));
    s = await keeperSays(gh, ctx, n, `/approve-deletion ${fp}`);
    assert.deepEqual(s.queue.applied, [n]);
    const data = JSON.parse(portal.originShow('data/family.json'));
    assert.equal(data.people.pmona001.removed.reasonCode, 'entered-by-mistake');
    assert.equal(JSON.parse(portal.originShow('data/changelog.json')).entries[0].destructive, true);
  });

  test('REPARENT (known only after applying) is gated like a removal', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const p = proposal([{ op: 'move-person', id: 'pkid0001', to: { of: 'pahmed01', with: null }, unionRef: 'newu1' }]);
    const n = await submitted(gh, ctx, p);
    const { fp } = await hashProposal(p);
    // the check's dry run already knows: the comment route asks for approve-deletion at once
    const c = await keeperSays(gh, ctx, n, `/approve ${fp}`);
    assert.equal(c.command.action, 'needs-deletion-approval');
    // a bare label is gated by the queue after trying to apply
    gh.userLabel(n, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'issues', event: labeledEvent(n, 'approve') });
    assert.deepEqual(s.queue.gated, [n]);
    assert.ok(lastBot(gh, n).includes(`/approve-deletion ${fp}`));
    assert.ok(!gh.labelsOf(n).includes('approve'));
    assert.equal(portal.originLog().length, 1);
    const s2 = await keeperSays(gh, ctx, n, `/approve-deletion ${fp}`);
    assert.deepEqual(s2.queue.applied, [n]);
  });

  test('already applied (same hash) → comment, applied + duplicate labels, closed', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const p = proposal([P.addChild('pahmed01', 'يوسف')]);
    const a = await submitted(gh, ctx, p);
    await keeperSays(gh, ctx, a, `/approve ${(await hashProposal(p)).fp}`);
    const b = await submitted(gh, ctx, p);
    gh.userLabel(b, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'issues', event: labeledEvent(b, 'approve') });
    assert.deepEqual(s.queue.applied, []);
    assert.match(lastBot(gh, b), new RegExp(`already applied in #${a}`));
    assert.ok(gh.labelsOf(b).includes('duplicate') && gh.labelsOf(b).includes('applied'));
    assert.equal(issueOf(gh, b).state, 'closed');
    assert.equal(portal.originLog().length, 2);
  });

  test('skip: "/approve fp skip 2" applies the rest and records the skipped numbers', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const p = proposal([P.addChild('pahmed01', 'يوسف'), P.edit('pnobody1', { 'occupation.ar': 'x' })]);
    const n = await submitted(gh, ctx, p);
    const { fp } = await hashProposal(p);
    let s = await keeperSays(gh, ctx, n, `/approve ${fp}`);
    assert.deepEqual(s.queue.failed, [n]);
    assert.ok(gh.labelsOf(n).includes('needs-changes'));
    assert.ok(lastBot(gh, n).includes(`/approve ${fp} skip 2`));
    s = await keeperSays(gh, ctx, n, `/approve ${fp} skip 2`);
    assert.deepEqual(s.queue.applied, [n]);
    assert.ok(!gh.labelsOf(n).includes('needs-changes'));
    const e = JSON.parse(portal.originShow('data/changelog.json')).entries[0];
    assert.deepEqual(e.skipped, [2]);
    assert.match(lastBot(gh, n), /Skipped changes: 2/);
  });

  test('force: STALE_EDIT fails with a hint; "/approve fp force" applies', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const p = proposal([P.edit('pahmed01', { 'occupation.ar': 'مهندس' }, { 'occupation.ar': 'طبيب' })]);
    const n = await submitted(gh, ctx, p);
    const { fp } = await hashProposal(p);
    let s = await keeperSays(gh, ctx, n, `/approve ${fp}`);
    assert.deepEqual(s.queue.failed, [n]);
    assert.ok(lastBot(gh, n).includes(`/approve ${fp} force`));
    s = await keeperSays(gh, ctx, n, `/approve ${fp} force`);
    assert.deepEqual(s.queue.applied, [n]);
    assert.equal(JSON.parse(portal.originShow('data/family.json')).people.pahmed01.occupation.ar, 'مهندس');
  });

  test('dependsOn: "approve #N first"; then refs resolve from applied.json; a batch orders dependencies first', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const first = proposal([P.addChild('pahmed01', 'بدر', 'new7')]);
    const second = proposal([{ op: 'mark', id: 'new7', mark: 'verified' }], { dependsOn: [first.id] });
    const a = await submitted(gh, ctx, first);
    const b = await submitted(gh, ctx, second);
    let s = await keeperSays(gh, ctx, b, `/approve ${(await hashProposal(second)).fp}`);
    assert.deepEqual(s.queue.failed, [b]);
    assert.match(lastBot(gh, b), new RegExp(`builds on #${a}`));
    s = await keeperSays(gh, ctx, a, `/approve ${(await hashProposal(first)).fp}`);
    assert.deepEqual(s.queue.applied, [a]);
    s = await keeperSays(gh, ctx, b, `/approve ${(await hashProposal(second)).fp}`);
    assert.deepEqual(s.queue.applied, [b]);
    const data = JSON.parse(portal.originShow('data/family.json'));
    const badr = Object.values(data.people).find((x) => x.name?.ar === 'بدر');
    assert.deepEqual(badr.tags, ['verified']);

    // batch: the dependant is the OLDER issue; both approved in one run → one commit, dependency first
    const p1 = proposal([P.addChild('pahmed01', 'نور', 'new9')]);
    const p2 = proposal([{ op: 'mark', id: 'new9', mark: 'verified' }], { dependsOn: [p1.id] });
    const older = await submitted(gh, ctx, p2);
    const newer = await submitted(gh, ctx, p1);
    gh.userLabel(older, 'approve', KEEPER);
    gh.userLabel(newer, 'approve', KEEPER);
    s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.queue.applied.sort(), [older, newer].sort());
    const log = portal.originLog();
    assert.match(log[0], new RegExp(`apply #${newer}, #${older}`));
    const msg = sh(portal.work, 'log', '-1', '--format=%B');
    assert.equal((msg.match(/^Gft-Apply:/gm) || []).length, 2);
  });

  test('a command whose run was cancelled (no bot reply) is answered by the next run', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const p = proposal([P.addChild('pahmed01', 'يوسف')]);
    const n = await submitted(gh, ctx, p);
    gh.userComment(n, KEEPER, `/approve ${(await hashProposal(p)).fp}`);
    gh.userComment(n, 'relative', 'thank you!');
    const r = await submitted(gh, ctx, proposal([P.addChild('pmona001', 'ليلى')]));
    gh.userComment(r, KEEPER, '/reject');
    gh.userComment(r, 'cousin', '/approve'); // not an approver: never swept
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.swept, [n, r]);
    assert.deepEqual(s.queue.applied, [n]);
    assert.equal(issueOf(gh, r).state_reason, 'not_planned');
    const again = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(again.swept, []);
  });

  test('/reject posts the fixed thank-you text and closes as not planned', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const n = await submitted(gh, ctx, proposal([P.addChild('pahmed01')]));
    const s = await keeperSays(gh, ctx, n, '/رفض');
    assert.equal(s.command.action, 'rejected');
    assert.match(lastBot(gh, n), /شكراً جزيلاً على مشاركتكم/);
    assert.match(lastBot(gh, n), /Thank you so much/);
    assert.equal(issueOf(gh, n).state_reason, 'not_planned');
  });

  test('owner correction: "/approve" + a corrected code replaces the proposal and is applied', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const n = await submitted(gh, ctx, proposal([P.addChild('pahmed01', 'يوسوف')]));
    const fixed = proposal([P.addChild('pahmed01', 'يوسف')]);
    const s = await keeperSays(gh, ctx, n, `/approve\n\n${await codeBody(fixed)}`);
    assert.equal(s.command.correction, true);
    assert.deepEqual(s.queue.applied, [n]);
    const text = portal.originShow('data/family.json');
    assert.ok(text.includes('"يوسف"') && !text.includes('يوسوف'));
    const { hash } = await hashProposal(fixed);
    assert.ok(JSON.parse(portal.originShow('data/applied.json'))[hash]);
  });

  test('other open proposals are re-checked after an apply (their revision moves on)', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const a = await submitted(gh, ctx, proposal([P.addChild('pahmed01', 'يوسف')]));
    const b = await submitted(gh, ctx, proposal([P.addChild('pmona001', 'ليلى')]));
    assert.match(gh.botComments(b)[0].body, /rev=5/);
    gh.userLabel(a, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'issues', event: labeledEvent(a, 'approve') });
    assert.deepEqual(s.queue.rechecked, [b]);
    assert.match(gh.botComments(b)[0].body, /rev=6/);
  });
});

describe('apply: pushing', () => {
  test('a concurrent push is handled: fetch + reset --hard + re-apply + push (never a merge)', async () => {
    const portal = newPortal();
    const other = portal.clone();
    const gh = fakeGitHub();
    const realPush = portal.git.push;
    let calls = 0;
    const git = {
      ...portal.git,
      push(remote, branch) {
        calls += 1;
        if (calls === 1) {
          // someone else applies a change and pushes first
          const file = join(other.portalDir, 'data', 'family.json');
          const cur = JSON.parse(sh(other.dir, 'show', 'HEAD:data/family.json'));
          const r = applyProposal(cur, proposal([P.addChild('pmona001', 'ليلى')]), { mode: 'final', now: '2026-11-25T11:00:00Z', issue: 999 });
          writeFileSync(file, serializeData(r.data));
          sh(other.dir, 'commit', '--quiet', '-am', 'family-tree: concurrent change');
          sh(other.dir, 'push', '--quiet', 'origin', 'main');
        }
        return realPush(remote, branch);
      },
    };
    const ctx = makeCtx(portal, gh, { git });
    const n = await submitted(gh, ctx, proposal([P.addChild('pahmed01', 'يوسف')]));
    gh.userLabel(n, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'issues', event: labeledEvent(n, 'approve') });
    assert.equal(s.queue.attempts, 2);
    assert.deepEqual(s.queue.applied, [n]);
    const log = portal.originLog();
    assert.equal(log.length, 3);
    assert.match(log[1], /concurrent change/);
    const data = JSON.parse(portal.originShow('data/family.json'));
    assert.equal(data.meta.revision, 7);
    const names = Object.values(data.people).map((x) => x.name?.ar);
    assert.ok(names.includes('ليلى') && names.includes('يوسف'));
    assert.ok(validateData(data).ok);
    const merges = sh(portal.base, '--git-dir', portal.origin, 'log', '--merges', '--format=%H', 'main').trim();
    assert.equal(merges, '');
  });

  test('after 5 failed pushes: "will retry automatically", labels kept, issue open', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const git = { ...portal.git, push: () => ({ ok: false, rejected: true, stderr: '! [rejected] (fetch first)' }) };
    const ctx = makeCtx(portal, gh, { git });
    const n = await submitted(gh, ctx, proposal([P.addChild('pahmed01')]));
    gh.userLabel(n, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'issues', event: labeledEvent(n, 'approve') });
    assert.equal(s.queue.attempts, 5);
    assert.equal(s.queue.pushed, false);
    assert.match(lastBot(gh, n), /retried automatically/);
    assert.ok(gh.labelsOf(n).includes('approve'));
    assert.equal(issueOf(gh, n).state, 'open');
    assert.equal(portal.originLog().length, 1);
  });

  test('Pages: polls the latest build; requests one only when the pushed commit is not building; 404 tolerated', async () => {
    const gh = fakeGitHub({ pages: { status: 'building', commit: 'abc' } });
    const ctx = { gh, sleep: async () => {} };
    assert.deepEqual(await waitForPages(ctx, 'abc', { timeoutMs: 20, intervalMs: 10 }), { status: 'building' });
    assert.equal(gh.state.pagesRequests, 0);
    assert.deepEqual(await waitForPages(ctx, 'def', { timeoutMs: 20, intervalMs: 10 }), { status: 'requested' });
    assert.equal(gh.state.pagesRequests, 1);
    const none = fakeGitHub({ pages: null });
    assert.deepEqual(await waitForPages({ gh: none, sleep: async () => {} }, 'x'), { status: 'no-pages' });
  });

  test('commit message: title ≤ 72 chars (issue numbers only), one line per issue, trailers per issue', () => {
    const o = (n) => ({ item: { number: n, hash: 'f'.repeat(64), proposal: { id: 'abcd1234', ops: [{}, {}] }, skipShown: [] }, rev: n, titleEn: 'Add “A” '.repeat(30), linesEn: ['line'] });
    const msg = commitMessage([o(1)]);
    assert.ok(msg.split('\n')[0].length <= 72);
    assert.match(msg, /^family-tree: apply #1\n\n#1 \(rev 1\): proposal abcd1234, 2 changes\n/);
    assert.match(msg, /^Gft-Apply: #1 f{64} rev 1$/m);
    assert.match(commitMessage([o(1), o(2)]), /^family-tree: apply #1, #2\n/);
    assert.ok(commitMessage(Array.from({ length: 40 }, (_, i) => o(i + 100))).split('\n')[0].length <= 72);
  });

  test('offline CLI dry run on the bundled fixture: applies in memory, writes nothing', async () => {
    const before = sh(new URL('..', import.meta.url).pathname, 'status', '--porcelain', '--', 'data');
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
      await applyMain(['--dry-run', '--event', new URL('../scripts/fixtures/approve-comment.json', import.meta.url).pathname], {});
    } finally {
      console.log = orig;
    }
    const out = logs.join('\n');
    assert.match(out, /"applied": \[\s*101\s*\]/);
    assert.match(out, /طُبّقت التعديلات/);
    assert.equal(sh(new URL('..', import.meta.url).pathname, 'status', '--porcelain', '--', 'data'), before);
  });
});

describe('apply: undo', () => {
  async function appliedIssue(portal, gh, ctx, p) {
    const n = await submitted(gh, ctx, p);
    await keeperSays(gh, ctx, n, `/approve ${(await hashProposal(p)).fp}`);
    assert.equal(issueOf(gh, n).state, 'closed');
    return n;
  }

  test('/undo restores the records, marks the ledgers, labels undone; the commit field is backfilled', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const p = proposal([P.addChild('pahmed01', 'يوسف'), P.edit('pahmed01', { 'occupation.ar': 'مهندس' })]);
    const n = await appliedIssue(portal, gh, ctx, p);
    const applySha = portal.git.head();
    const s = await keeperSays(gh, ctx, n, '/تراجع');
    assert.equal(s.command.action, 'undone');
    const data = JSON.parse(portal.originShow('data/family.json'));
    assert.equal(data.meta.revision, 7);
    assert.ok(!Object.values(data.people).some((x) => x.name?.ar === 'يوسف'));
    assert.equal(data.people.pahmed01.occupation, undefined);
    assert.equal(data.people.pahmed01.history.at(-1).action, 'undo');
    assert.deepEqual(data.unions.uahmed01.children, ['pkid0001']);
    assert.ok(validateData(data).ok);
    const changelog = JSON.parse(portal.originShow('data/changelog.json'));
    assert.equal(changelog.entries[0].action, 'undo');
    assert.equal(changelog.entries[0].issue, n);
    assert.equal(changelog.entries[1].commit, applySha, 'the apply entry got its commit from the trailers');
    const { hash } = await hashProposal(p);
    const applied = JSON.parse(portal.originShow('data/applied.json'));
    assert.ok(applied[hash].undone);
    assert.equal(applied[hash].commit, applySha);
    assert.match(portal.originLog()[0], new RegExp(`family-tree: undo #${n}$`));
    assert.ok(gh.labelsOf(n).includes('undone') && !gh.labelsOf(n).includes('applied'));
    assert.match(lastBot(gh, n), /The changes of #\d+ were undone/);

    // a second /undo: the issue is no longer "applied"
    await keeperSays(gh, ctx, n, '/undo');
    assert.match(lastBot(gh, n), /Undo works on applied/);
    // after an undo the same proposal can be approved again (reopen + approve)
    gh.state.issues.get(n).state = 'open';
    gh.userUnlabel(n, 'undone', KEEPER);
    const s2 = await keeperSays(gh, ctx, n, `/approve ${(await hashProposal(p)).fp}`);
    assert.deepEqual(s2.queue.applied, [n]);
  });

  test('/undo is refused (listing the records) when they changed afterwards; /undo needs an approver', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const a = await appliedIssue(portal, gh, ctx, proposal([P.edit('pahmed01', { 'occupation.ar': 'مهندس' })]));
    await appliedIssue(portal, gh, ctx, proposal([P.edit('pahmed01', { 'bio.ar': 'سيرة' })]));
    const s = await keeperSays(gh, ctx, a, '/undo');
    assert.equal(s.command.action, 'undo-refused');
    assert.equal(s.command.reason, 'changed');
    assert.match(lastBot(gh, a), /these records changed after it was applied/);
    assert.match(lastBot(gh, a), /Ahmed/);
    assert.equal(portal.originLog().length, 3);
    const s2 = await keeperSays(gh, ctx, a, '/undo', 'cousin');
    assert.equal(s2.command.action, 'unauthorized');
  });

  test('undo of one proposal in a batch commit only restores its own records', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const a = await submitted(gh, ctx, proposal([P.addChild('pahmed01', 'يوسف')]));
    const b = await submitted(gh, ctx, proposal([P.edit('pmona001', { 'occupation.ar': 'معلمة' })]));
    gh.userLabel(a, 'approve', KEEPER);
    gh.userLabel(b, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.queue.applied, [a, b]);
    const s2 = await keeperSays(gh, ctx, a, '/undo');
    assert.equal(s2.command.action, 'undone');
    const data = JSON.parse(portal.originShow('data/family.json'));
    assert.ok(!Object.values(data.people).some((x) => x.name?.ar === 'يوسف'));
    assert.equal(data.people.pmona001.occupation.ar, 'معلمة', 'the other proposal of the batch stays');
  });
});

describe('repo: git helpers', () => {
  test('show / trailers / revExists work with paths relative to the portal folder', () => {
    const portal = newPortal({ layout: 'sub' });
    const git = createGit({ cwd: portal.portalDir });
    assert.ok(git.show('HEAD', 'data/family.json').includes('"schema": 1'));
    assert.equal(git.show('HEAD', 'data/nope.json'), null);
    assert.ok(git.revExists('HEAD'));
    assert.ok(!git.revExists('HEAD^'));
    assert.equal(git.commitTrailers('data').size, 0);
  });
});
