// Regression tests for the security review of the approval automation (docs/SPEC.md §6.2–§6.6). Each block turns one
// confirmed proof of concept into a test that failed before the fix:
//   1 forgeable fingerprints · 2 /undo inside batch commits · 3 replays inside a batch / after a push that landed
//   4 regex denial of service · 5 approver commands hidden by replies to others · 6 quote-replies dropped by the
//   workflow filter · 7 dependsOn re-targeted through a re-used proposal id · 8 proposal text in commit messages
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runApply, handleComment, sweepMissedCommands } from '../scripts/lib/apply.mjs';
import { checkIssue, formFields } from '../scripts/lib/check.mjs';
import { parseCommand } from '../scripts/lib/commands.mjs';
import { hashProposal, FP_LENGTH } from '../scripts/lib/hash.mjs';
import {
  makePortal, makeCtx, fakeGitHub, proposal, P, codeBody, openProposal, commentEvent, sh,
} from './scripts-kit.mjs';

const portals = [];
const newPortal = (opts) => { const p = makePortal(opts); portals.push(p); return p; };
after(() => portals.forEach((p) => p.cleanup()));

const KEEPER = 'keeper';
const lastBot = (gh, n) => gh.botComments(n).at(-1)?.body || '';
const originData = (portal) => JSON.parse(portal.originShow('data/family.json'));
async function submitted(gh, ctx, p, opts) {
  const n = await openProposal(gh, p, opts);
  await checkIssue(ctx, n);
  return n;
}
async function says(gh, ctx, n, body, login = KEEPER) {
  const c = gh.userComment(n, login, body);
  return runApply(ctx, { eventName: 'issue_comment', event: commentEvent(n, c) });
}
const ms = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
const msAsync = async (fn) => { const t = process.hrtime.bigint(); await fn(); return Number(process.hrtime.bigint() - t) / 1e6; };

// ---------------------------------------------------------------------------------------------------------------
describe('security 1: fingerprints cannot be forged', () => {
  // A (what the keeper reviews) and B (hostile) share their first 6 hex chars: the note "x34599927" was ground for
  // this pair in ~40 s (2^24 tries), exactly as the PoC did. With 16-char fingerprints that takes ~2^64 tries.
  const A = () => proposal([P.addChild('pahmed01', 'يوسف')], { id: 'tgrindvictim1' });
  const B = () => proposal([P.edit('pahmed01', { 'name.ar': 'HACKED', 'name.en': 'HACKED' }), P.mark('pmona001', 'private')],
    { id: 'tgrindvictim1', note: 'x34599927' });

  test('the ground pair really collides on 6 hex chars (and not on 16)', async () => {
    const [a, b] = [await hashProposal(A()), await hashProposal(B())];
    assert.equal(a.hash.slice(0, 6), b.hash.slice(0, 6));
    assert.notEqual(a.fp, b.fp);
    assert.equal(FP_LENGTH, 16);
    assert.equal(a.fp.length, 16);
  });

  test('PoC: keeper approves A by its 6-char fp, the body is swapped for B before the run → nothing applied', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const n = await submitted(gh, ctx, A());
    const { hash: hashA, fp: fpA } = await hashProposal(A());
    assert.ok(gh.botComments(n)[0].body.includes(`/approve ${fpA}\n`), 'the check comment shows the 16-char fp');
    const c = gh.userComment(n, KEEPER, `/approve ${hashA.slice(0, 6)}`);
    gh.userEdit(n, await codeBody(B())); // the attacker edits within the seconds before the run fetches the issue
    const s = await runApply(ctx, { eventName: 'issue_comment', event: commentEvent(n, c) });
    assert.deepEqual(s.queue.applied, []);
    assert.equal(portal.originLog().length, 1, 'no commit');
    assert.equal(originData(portal).people.pahmed01.name.ar, 'أحمد');
    assert.match(lastBot(gh, n), /is too short/);
    // the right 16-char fp of A does not match B either
    const s2 = await says(gh, ctx, n, `/approve ${fpA}`);
    assert.deepEqual(s2.queue.applied, []);
    assert.match(lastBot(gh, n), /doesn’t match the current version/);
    assert.equal(portal.originLog().length, 1);
  });

  test('an approval is bound to the full hash recorded when the command was handled', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const a = proposal([P.addChild('pahmed01', 'يوسف')]);
    const b = proposal([P.addChild('pahmed01', 'شخص آخر')]);
    const n = await submitted(gh, ctx, a);
    const { hash: hashA, fp: fpA } = await hashProposal(a);
    const c = gh.userComment(n, KEEPER, `/approve ${fpA}`);
    // The command is handled (approval note + label) but the queue has not run yet (e.g. the push is retried later).
    const r = await handleComment(ctx, commentEvent(n, c));
    assert.equal(r.action, 'approval-recorded');
    const note = gh.botComments(n).find((x) => x.body.includes('<!-- gft-bot:approval'));
    assert.ok(note.body.includes(`hash=${hashA}`), 'the note records the full hash');
    assert.ok(note.body.includes(`for=${c.id}`), 'the note names the command it answers');
    // Meanwhile the proposal becomes B, and the fp in the (edited) command comment now names B: the bot never
    // checked B when the command was handled, so a new approval is required.
    gh.userEdit(n, await codeBody(b));
    await checkIssue(ctx, n);
    gh.userEditComment(c.id, `/approve ${(await hashProposal(b)).fp}`);
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.queue.applied, []);
    assert.match(lastBot(gh, n), /changed after the approval was recorded/);
    assert.ok(lastBot(gh, n).includes(`/approve ${(await hashProposal(b)).fp}`));
    assert.ok(!gh.labelsOf(n).includes('approve'), 'the approval label is removed');
    assert.equal(portal.originLog().length, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('security 2: /undo of one proposal of a batch commit', () => {
  test('PoC: undoing #2 must not wipe #1’s change to the same record → refused, listing it, nothing written', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const n1 = await submitted(gh, ctx, proposal([P.edit('pahmed01', { 'occupation.en': 'Engineer' })]));
    const n2 = await submitted(gh, ctx, proposal([P.edit('pahmed01', { 'name.en': 'Ahmad' })]));
    gh.userLabel(n1, 'approve', KEEPER);
    gh.userLabel(n2, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.queue.applied, [n1, n2]);
    assert.equal(portal.originLog().length, 2, 'one batch commit');

    for (const [n, other] of [[n2, n1], [n1, n2]]) {
      const u = await says(gh, ctx, n, '/undo');
      assert.equal(u.command.action, 'undo-refused');
      assert.equal(u.command.reason, 'changed');
      assert.match(lastBot(gh, n), /these records changed after it was applied/);
      assert.match(lastBot(gh, n), /Ahmad|Ahmed/);
      assert.match(lastBot(gh, n), new RegExp(`same update as #${other}\\b`));
    }
    const d = originData(portal);
    assert.deepEqual(d.people.pahmed01.occupation, { en: 'Engineer' });
    assert.equal(d.people.pahmed01.name.en, 'Ahmad');
    assert.equal(portal.originLog().length, 2, 'no undo commit');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('security 3: no replay inside a batch or after a push that landed', () => {
  test('PoC: the same code in two approved issues → applied once; the second is closed as a duplicate', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const x = proposal([P.addChild('pahmed01', 'سعيد', 'new1')]);
    const n1 = await openProposal(gh, x);
    const n2 = await openProposal(gh, x);
    await checkIssue(ctx, n1);
    await checkIssue(ctx, n2);
    gh.userLabel(n1, 'approve', KEEPER);
    gh.userLabel(n2, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.queue.applied, [n1]);
    assert.deepEqual(s.queue.duplicates, [n2]);
    const d = originData(portal);
    assert.equal(Object.values(d.people).filter((p) => p.name?.ar === 'سعيد').length, 1);
    assert.equal(Object.keys(JSON.parse(portal.originShow('data/applied.json'))).length, 1);
    assert.equal(JSON.parse(portal.originShow('data/changelog.json')).entries.length, 1);
    assert.match(lastBot(gh, n2), new RegExp(`already applied in #${n1}`));
    assert.ok(gh.labelsOf(n2).includes('applied') && gh.labelsOf(n2).includes('duplicate'));
    assert.equal(gh.state.issues.get(n2).state, 'closed');
  });

  test('PoC: a push that landed but was reported as failed is not applied again after fetch + reset', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const realPush = portal.git.push;
    let first = true;
    const git = {
      ...portal.git,
      push(r, b) {
        const res = realPush(r, b);
        if (first) { first = false; return { ok: false, rejected: false, stderr: 'fatal: the remote end hung up unexpectedly' }; }
        return res;
      },
    };
    const ctx = makeCtx(portal, gh, { git });
    const x = proposal([P.addChild('pahmed01', 'سعيد', 'new1')]);
    const n = await submitted(gh, ctx, x);
    gh.userLabel(n, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.equal(s.queue.attempts, 2);
    assert.deepEqual(s.queue.applied, [n]);
    const d = originData(portal);
    assert.equal(Object.values(d.people).filter((p) => p.name?.ar === 'سعيد').length, 1);
    assert.equal(portal.originLog().length, 2, 'exactly one apply commit');
    assert.equal(JSON.parse(portal.originShow('data/changelog.json')).entries.length, 1);
    assert.equal(d.meta.revision, 6);
    assert.match(lastBot(gh, n), /Applied to the family tree/);
    assert.ok(lastBot(gh, n).includes(portal.git.head().slice(0, 7)), 'the comment links the commit that landed');
    assert.equal(gh.state.issues.get(n).state, 'closed');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('security 4: bounded parsing of outsider-controlled text', () => {
  const FAST = 200;

  test('PoC: formFields on "###"/"###Your name" runs is linear (< 200 ms)', () => {
    const inputs = [
      `GFT1:xxx\n${'###'.repeat(8000)}`,
      `GFT1:xxx\n${'###Your name'.repeat(800)}`,
      `GFT1:xxx\n${'###Your name Note'.repeat(3800)}`,
      `GFT1:xxx\n${'### Your name\n'.repeat(4600)}`,
      'x'.repeat(200000),
    ];
    for (const body of inputs) {
      const t = ms(() => formFields(body));
      assert.ok(t < FAST, `${body.length} chars: ${t.toFixed(0)} ms`);
    }
    assert.deepEqual(formFields('### Your name\n\nSara\n\n### Note for the keeper\n\n_No response_'), { submitter: 'Sara', note: '' });
  });

  test('PoC: parseCommand on a long punctuation run is fast (< 200 ms) and the command line is capped', () => {
    for (const body of [`/approve ${'.'.repeat(65000)}x`, `/x ${'.'.repeat(65000)}x`, `/approve ${' .'.repeat(40000)}`, '/'.repeat(300000)]) {
      const t = ms(() => parseCommand(body));
      assert.ok(t < FAST, `${body.length} chars: ${t.toFixed(0)} ms`);
    }
    assert.equal(parseCommand(`/approve ${'.'.repeat(65000)}`).cmd, 'approve');
    assert.ok(parseCommand(`/approve ${'a'.repeat(5000)}`).line.length <= 200);
  });

  test('PoC: the sweep never parses outsiders’ comments (approver check first) — < 200 ms', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const n = await submitted(gh, ctx, proposal([P.addChild('pahmed01', 'سعيد', 'new1')]), { login: 'troll' });
    for (let i = 0; i < 3; i++) gh.userComment(n, 'troll', `/x ${'.'.repeat(65000)}x`);
    const t = await msAsync(() => sweepMissedCommands(ctx));
    assert.ok(t < FAST, `sweep: ${t.toFixed(0)} ms`);
    const t2 = await msAsync(() => says(gh, ctx, n, `/approve ${'.'.repeat(65000)}x`, 'troll'));
    assert.ok(t2 < 2000, `a whole run on such a comment: ${t2.toFixed(0)} ms`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('security 5: an approver command is answered only by a reply that names it', () => {
  test('PoC: an outsider’s "/approve" reply no longer hides the keeper’s unanswered command', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const x = proposal([P.addChild('pahmed01', 'سعيد', 'new1')]);
    const n = await submitted(gh, ctx, x);
    gh.userComment(n, KEEPER, `/approve ${(await hashProposal(x)).fp}`); // its run is cancelled by the next one
    const troll = gh.userComment(n, 'troll', '/approve');
    const s = await runApply(ctx, { eventName: 'issue_comment', event: commentEvent(n, troll) });
    assert.equal(s.command.action, 'unauthorized');
    assert.ok(gh.botComments(n).some((c) => c.body.includes(`for=${troll.id}`)), 'the reply names the comment it answers');
    assert.deepEqual(s.swept, [n]);
    assert.deepEqual(s.queue.applied, [n]);
    const again = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(again.swept, []);
  });

  test('an unanswered /undo on a closed, applied proposal is swept too', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const x = proposal([P.addChild('pahmed01', 'سعيد', 'new1')]);
    const n = await submitted(gh, ctx, x);
    await says(gh, ctx, n, `/approve ${(await hashProposal(x)).fp}`);
    assert.equal(gh.state.issues.get(n).state, 'closed');
    gh.userComment(n, KEEPER, '/undo'); // its run was cancelled
    gh.userComment(n, 'relative', 'thanks!');
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.swept, [n]);
    assert.ok(gh.labelsOf(n).includes('undone'));
    assert.ok(!Object.values(originData(portal).people).some((p) => p.name?.ar === 'سعيد'));
    assert.deepEqual((await runApply(ctx, { eventName: 'schedule', event: {} })).swept, []);
  });

  test('bot replies from before tagging (no "for=") still answer the commands before them', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const n = await submitted(gh, ctx, proposal([P.addChild('pahmed01', 'سعيد', 'new1')]));
    gh.userComment(n, KEEPER, '/correct');
    gh.state.comments.get(n).push({ id: 99999, body: '<!-- gft-bot:result status=corrected -->\n\nok', user: { login: 'github-actions[bot]' }, created_at: '2026-11-25T10:00:00Z' });
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.swept, []);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const ghDir = [join(here, '..', '..', '.github'), join(here, '..', '.github')].find((d) => existsSync(join(d, 'workflows', 'family-tree-apply.yml')));

describe('security 6 + 3: apply workflow filter and checkout', { skip: !ghDir && 'no .github folder found' }, () => {
  const t = () => readFileSync(join(ghDir, 'workflows', 'family-tree-apply.yml'), 'utf8');

  test('quote-replies reach the script: the job filter only needs a "/" somewhere in the comment', async () => {
    assert.match(t(), /contains\(github\.event\.comment\.body, '\/'\)/);
    assert.ok(!/startsWith\(github\.event\.comment\.body/.test(t()));
    assert.match(t(), /github\.event\.issue\.pull_request == null/);
    // and the script handles such a reply
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const x = proposal([P.addChild('pahmed01', 'سعيد', 'new1')]);
    const n = await submitted(gh, ctx, x);
    const s = await says(gh, ctx, n, `> Can I approve this?\n\n/approve ${(await hashProposal(x)).fp}`);
    assert.deepEqual(s.queue.applied, [n]);
  });

  test('scheduled and manual runs check out the default branch by name (its current tip), never github.sha', () => {
    const text = t();
    assert.match(text, /- name: Find the default branch\n\s+id: branch/);
    assert.match(text, /gh api "repos\/\$GITHUB_REPOSITORY" --jq \.default_branch/);
    assert.match(text, /uses: actions\/checkout@[0-9a-f]{40} # v7\.0\.1\n\s+with:\n\s+ref: \$\{\{ steps\.branch\.outputs\.name \}\}\n\s+fetch-depth: 0/);
    assert.match(text, /GFT_BRANCH: \$\{\{ steps\.branch\.outputs\.name \}\}/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('security 7: dependsOn cannot be re-targeted through a re-used proposal id', () => {
  test('PoC: the check names the real person; a proposal re-using an applied id is refused; the dependant applies to the original', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const X = proposal([P.addChild('pahmed01', 'سعيد', 'new1')]);
    const n1 = await submitted(gh, ctx, X);
    gh.userLabel(n1, 'approve', KEEPER);
    await runApply(ctx, { eventName: 'schedule', event: {} });
    const realX = Object.values(JSON.parse(portal.originShow('data/applied.json')))[0].idMap.new1;

    const Z = proposal([P.addChild('pmona001', 'زائر', 'new1')], { id: X.id }); // attacker re-uses X's public id
    const Y = proposal([{ op: 'mark', id: 'new1', mark: 'private' }], { dependsOn: [X.id] });
    const n3 = await submitted(gh, ctx, Y);
    const lines = gh.botComments(n3)[0].body.split('\n').filter((l) => /^1\. /.test(l));
    assert.equal(lines.length, 2);
    for (const l of lines) {
      assert.ok(!l.includes('new1'), `names the resolved person, not the ref: ${l}`);
      assert.ok(l.includes('سعيد') || l.includes('Saeed') || l.includes('Said'), l);
    }

    const n2 = await submitted(gh, ctx, Z);
    const check = gh.botComments(n2)[0].body;
    assert.match(check, /### ❌/);
    assert.match(check, /was already used by a different proposal, applied in #⁠1/);
    assert.match(check, /استُخدم من قبل لمقترح مختلف/);

    gh.userLabel(n2, 'approve', KEEPER);
    gh.userLabel(n3, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.queue.applied, [n3]);
    assert.deepEqual(s.queue.failed, [n2]);
    assert.ok(gh.labelsOf(n2).includes('needs-changes'));
    const d = originData(portal);
    assert.ok(!Object.values(d.people).some((p) => p.name?.ar === 'زائر'), 'Z was not applied');
    assert.equal(d.people[realX].nameStatus, 'withheld', 'Y changed the person of X');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('security 8: commit messages carry no proposal text', () => {
  test('PoC: "Closes #1" / "Fixes #2, resolves @someone" in names never reach the commit message', async () => {
    const portal = newPortal();
    const gh = fakeGitHub();
    const ctx = makeCtx(portal, gh);
    const X = proposal([
      { op: 'add-person', ref: 'new1', person: { name: { ar: 'سعيد', en: 'Closes #1' }, gender: 'm' }, link: { as: 'child', of: 'pahmed01' }, unionRef: 'newu1' },
      P.edit('pkid0001', { 'occupation.en': 'Teacher. Fixes #2, resolves @someone' }),
    ]);
    const n = await submitted(gh, ctx, X);
    gh.userLabel(n, 'approve', KEEPER);
    const s = await runApply(ctx, { eventName: 'schedule', event: {} });
    assert.deepEqual(s.queue.applied, [n]);
    const msg = sh(portal.work, 'log', '-1', '--format=%B').trim();
    assert.ok(!/closes|fixes|resolves|teacher|@/i.test(msg), msg);
    const allowed = [
      /^family-tree: apply #\d+(, #\d+)*$/,
      /^#\d+ \(rev \d+\): proposal [a-z0-9]{4,32}, \d+ changes?(, \d+ skipped)?$/,
      /^Gft-Apply: #\d+ [0-9a-f]{64} rev \d+$/,
      /^$/,
    ];
    for (const line of msg.split('\n')) assert.ok(allowed.some((re) => re.test(line)), `unexpected line: ${line}`);
    // the bilingual description is still in the changelog
    assert.match(JSON.parse(portal.originShow('data/changelog.json')).entries[0].summary.en.join('\n'), /Closes #1/);
  });
});
