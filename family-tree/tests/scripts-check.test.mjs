// The check workflow script (docs/SPEC.md §6.2) on fixture issues with a fake GitHub client.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { checkIssue, formFields } from '../scripts/lib/check.mjs';
import { parseMarker, WJ } from '../scripts/lib/render.mjs';
import { hashProposal } from '../scripts/lib/hash.mjs';
import { main as checkMain } from '../scripts/check-proposal.mjs';
import { makePortal, makeCtx, fakeGitHub, proposal, P, codeBody, openProposal } from './scripts-kit.mjs';

const portal = makePortal();
after(() => portal.cleanup());

const checkOf = (gh, n) => gh.botComments(n).filter((c) => c.body.includes('<!-- gft-bot:check'));

describe('check: one bot comment per proposal', () => {
  test('opened → ✅ comment with marker, numbered changes in both languages, preview link and exact commands', async () => {
    const gh = fakeGitHub();
    const p = proposal([P.addChild('pahmed01', 'يوسف'), P.addChild('pahmed01', 'مريم', 'new2')]);
    const n = await openProposal(gh, p);
    const res = await checkIssue(makeCtx(portal, gh), n);
    assert.equal(res.status, 'checked');
    assert.equal(res.ok, true);
    const [c, ...rest] = checkOf(gh, n);
    assert.equal(rest.length, 0);
    const m = parseMarker(c.body, 'check');
    const { hash, fp } = await hashProposal(p);
    assert.deepEqual([m.hash, m.rev, m.edits, m.src, m.fp], [hash, '5', '0', 'body', fp]);
    assert.match(c.body, /### ✅/);
    assert.match(c.body, /1\. إضافة «يوسف»/);
    assert.match(c.body, /2\. Add “Maryam”/);
    assert.match(c.body, /https:\/\/fam\.github\.io\/tree\/#\/preview\?code=GFT1:/);
    assert.ok(c.body.includes(`\`\`\`\n/approve ${fp}\n\`\`\``));
    assert.ok(c.body.includes(`/approve ${fp} skip 2`));
    assert.ok(c.body.includes('/reject'));
    assert.deepEqual(gh.labelsOf(n), ['family-tree']);
    assert.ok(gh.state.labels.has('approve-deletion'), 'labels are created');
  });

  test('edits: the same comment is updated in place; edits counts body changes of the proposal only', async () => {
    const gh = fakeGitHub();
    const p1 = proposal([P.addChild('pahmed01', 'يوسف')]);
    const n = await openProposal(gh, p1);
    const ctx = makeCtx(portal, gh);
    await checkIssue(ctx, n);
    // edit that keeps the same proposal (note text changes only)
    gh.userEdit(n, `${await codeBody(p1)}\n\nthanks!`);
    await checkIssue(ctx, n);
    assert.equal(parseMarker(checkOf(gh, n)[0].body, 'check').edits, '0');
    // edit that changes the proposal
    const p2 = proposal([P.addChild('pahmed01', 'يونس')]);
    gh.userEdit(n, await codeBody(p2));
    await checkIssue(ctx, n);
    const comments = checkOf(gh, n);
    assert.equal(comments.length, 1);
    const m = parseMarker(comments[0].body, 'check');
    assert.equal(m.edits, '1');
    assert.equal(m.hash, (await hashProposal(p2)).hash);
    // re-running with nothing new does not write
    const writes = gh.calls.length;
    await checkIssue(ctx, n);
    assert.equal(gh.calls.length, writes);
  });

  test('issues without a proposal get no comment and no labels; closed / applied issues are skipped', async () => {
    const gh = fakeGitHub();
    const n = gh.userOpen({ body: 'The spelling app crashes on my phone', labels: [] });
    const res = await checkIssue(makeCtx(portal, gh), n);
    assert.equal(res.status, 'no-proposal');
    assert.equal(gh.calls.length, 0);
    const m = await openProposal(gh, proposal([P.addChild('pahmed01')]), { labels: ['family-tree', 'applied'] });
    assert.equal((await checkIssue(makeCtx(portal, gh), m)).reason, 'applied');
    gh.userClose(n);
    assert.equal((await checkIssue(makeCtx(portal, gh), n)).reason, 'closed');
  });

  test('a damaged code gets a friendly ❌ comment', async () => {
    const gh = fakeGitHub();
    const body = (await codeBody(proposal([P.addChild('pahmed01')]))).replace(/(GFT1:[A-Za-z0-9_-]{20})[A-Za-z0-9_-]+/, '$1');
    const n = gh.userOpen({ body, labels: [] });
    const res = await checkIssue(makeCtx(portal, gh), n);
    assert.equal(res.status, 'bad-code');
    const [c] = checkOf(gh, n);
    assert.match(c.body, /تعذّرت قراءة رمز التعديلات/);
    assert.deepEqual(gh.labelsOf(n), ['family-tree']);
  });

  test('errors: ❌ status, bilingual problems, skip suggestion for the failing change', async () => {
    const gh = fakeGitHub();
    const p = proposal([P.addChild('pahmed01'), P.edit('pnobody1', { 'occupation.ar': 'x' })]);
    const n = await openProposal(gh, p);
    const res = await checkIssue(makeCtx(portal, gh), n);
    assert.equal(res.ok, false);
    const [c] = checkOf(gh, n);
    assert.match(c.body, /### ❌/);
    assert.match(c.body, /ما يمنع التطبيق/);
    assert.match(c.body, /What prevents applying it/);
    assert.ok(c.body.includes(`/approve ${res.fp} skip 2`));
  });

  test('destructive proposals: deletion-request label and the /approve-deletion command', async () => {
    const gh = fakeGitHub();
    const n = await openProposal(gh, proposal([P.remove('pmona001')]));
    const res = await checkIssue(makeCtx(portal, gh), n);
    assert.equal(res.destructive, true);
    assert.deepEqual(gh.labelsOf(n).sort(), ['deletion-request', 'family-tree']);
    assert.ok(checkOf(gh, n)[0].body.includes(`/approve-deletion ${res.fp}`));
  });

  test('identical to another open issue, already applied, depends on a pending proposal', async () => {
    const gh = fakeGitHub();
    const p = proposal([P.addChild('pahmed01', 'سعيد')]);
    const a = await openProposal(gh, p);
    const b = await openProposal(gh, p);
    await checkIssue(makeCtx(portal, gh), b);
    assert.match(checkOf(gh, b)[0].body, new RegExp(`identical to #${a}`));
    const { hash } = await hashProposal(p);
    await checkIssue(makeCtx(portal, gh), a, { applied: { [hash]: { issue: 3, proposalId: p.id, idMap: {}, at: 'x' } } });
    assert.match(checkOf(gh, a)[0].body, /already applied in #3/);

    const first = proposal([P.addChild('pahmed01', 'بدر', 'new7')]);
    const second = proposal([{ op: 'mark', id: 'new7', mark: 'verified' }], { dependsOn: [first.id] });
    const f = await openProposal(gh, first);
    const s = await openProposal(gh, second);
    const res = await checkIssue(makeCtx(portal, gh), s);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.code === 'DEPENDS_ON_PENDING'));
    assert.match(checkOf(gh, s)[0].body, new RegExp(`builds on #${f}`));
  });

  test('untrusted text is escaped: no mentions, no HTML, no issue links', async () => {
    const gh = fakeGitHub();
    const p = proposal([P.addChild('pahmed01', '<img src=x onerror=alert(1)>')], {
      submitter: { name: '@everyone <b>hi</b>', relation: '#1', personId: '' }, note: '[click](javascript:alert(1))',
    });
    const n = await openProposal(gh, p);
    await checkIssue(makeCtx(portal, gh), n);
    const body = checkOf(gh, n)[0].body;
    assert.ok(!body.includes('<img'));
    assert.ok(!body.includes('<b>'));
    assert.ok(body.includes(`@${WJ}everyone`));
    assert.ok(body.includes(`#${WJ}1`));
    assert.ok(!body.includes('[click]('));
  });

  test('form fields are read from the issue-form body', async () => {
    const body = await codeBody(proposal([P.addChild('pahmed01')]), { submitter: 'Sara', note: 'Hello' });
    assert.deepEqual(formFields(body), { submitter: 'Sara', note: 'Hello' });
    assert.deepEqual(formFields('nothing'), { submitter: '', note: '' });
  });

  test('CLI dry run on the bundled fixture prints the comment and writes nothing', async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
      const code = await checkMain(['--dry-run', '--event', new URL('../scripts/fixtures/issue-opened.json', import.meta.url).pathname], {});
      assert.equal(code, 0);
    } finally {
      console.log = orig;
    }
    const out = logs.join('\n');
    assert.match(out, /check #101: \{"status":"checked"/);
    assert.match(out, /\[dry-run\] createComment\(101\)/);
  });
});
