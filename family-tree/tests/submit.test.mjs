// js/submit.js — proposal transport (SPEC §5): WhatsApp text & links, GitHub issue-form URL fitting, e-mail, owner URLs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildSubmission, issueUrl, messageText, issueTitle, waUrl, approvalComment, CODE_LABEL, GITHUB_URL_MAX, WHATSAPP_MAX,
} from '../js/submit.js';
import { newProposal, proposalHash } from '../js/core/ops.js';
import { decodeProposal } from '../js/core/codec.js';
import { normalizeData } from '../js/core/schema.js';
import { buildGraph } from '../js/core/graph.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const data = normalizeData(JSON.parse(read('../data/family.json')));
const graph = buildGraph(data);
const anyMan = Object.values(data.people).find((p) => p.gender === 'm' && !p.removed).id;

const CONFIG = {
  repo: { owner: 'octo', name: 'tree', branch: 'main' },
  owner: { name: { ar: 'أبو خالد', en: 'Abu Khalid' }, whatsapp: '+966 50 123 4567', email: '' },
};

function proposal(n = 2, extra = {}) {
  const p = newProposal();
  p.submitter = { name: 'سارة', relation: 'حفيدة حسن', personId: '' };
  p.note = 'ملاحظة';
  for (let i = 0; i < n; i++) {
    p.ops.push({ op: 'add-person', ref: `new${i + 1}`, person: { name: { ar: `ولد${i}` }, gender: 'm' }, link: { as: 'child', of: anyMan, with: null } });
  }
  return Object.assign(p, extra);
}

describe('submit: WhatsApp message', () => {
  test('format: greeting, submitter, numbered lines, id, label line, code alone in fences', async () => {
    const p = proposal(3);
    const s = await buildSubmission(p, { graph, lang: 'ar', config: CONFIG });
    const lines = s.whatsapp.text.split('\n');
    assert.match(lines[0], /السلام عليكم/);
    assert.ok(lines.some((l) => l.includes('سارة — حفيدة حسن')));
    assert.ok(lines.includes(`1. ${s.lines[0]}`));
    assert.ok(lines.some((l) => l.includes(p.id)));
    const i = lines.indexOf(CODE_LABEL);
    assert.ok(i > 0);
    assert.deepEqual(lines.slice(i + 1), ['```', s.code, '```']);
    assert.equal(lines[i - 1], '');
    assert.ok(s.whatsapp.url.startsWith('https://wa.me/966501234567?text='));
    assert.equal(decodeURIComponent(s.whatsapp.url.split('?text=')[1]), s.whatsapp.text);
    assert.equal(s.whatsapp.tooLong, false);
    assert.equal(s.whatsapp.hasNumber, true);
    assert.deepEqual(await decodeProposal(s.whatsapp.text), p);
  });

  test('at most 10 lines then "and N more"; English text', async () => {
    const s = await buildSubmission(proposal(13), { graph, lang: 'en', config: CONFIG });
    assert.ok(s.whatsapp.text.includes('10. '));
    assert.ok(!s.whatsapp.text.includes('\n11. '));
    assert.ok(s.whatsapp.text.includes('…and 3 more'));
    assert.match(s.whatsapp.text, /^Assalamu alaikum/);
    const ar = messageText({ lang: 'ar', lines: Array.from({ length: 25 }, (_, i) => `l${i}`), id: 'x', code: 'GFT1:a.b' });
    assert.ok(ar.includes('…و15 تعديلاً آخر'));
  });

  test('no number → wa.me/?text=; long text → tooLong with a plain link', async () => {
    const cfg = { ...CONFIG, owner: { ...CONFIG.owner, whatsapp: '' } };
    const s = await buildSubmission(proposal(1), { graph, lang: 'ar', config: cfg });
    assert.ok(s.whatsapp.url.startsWith('https://wa.me/?text='));
    assert.equal(s.whatsapp.hasNumber, false);
    assert.equal(waUrl('', ''), 'https://wa.me/');
    const big = proposal(1);
    big.note = 'x'.repeat(10);
    big.submitter.relation = 'ق'.repeat(1500);
    const s2 = await buildSubmission(big, { graph, lang: 'ar', config: CONFIG, code: `GFT1:${'A'.repeat(WHATSAPP_MAX)}.zz` });
    assert.equal(s2.whatsapp.tooLong, true);
    assert.equal(s2.whatsapp.url, 'https://wa.me/966501234567');
  });
});

describe('submit: GitHub issue form', () => {
  test('fields, template, measured on the encoded URL', async () => {
    const p = proposal(2);
    const s = await buildSubmission(p, { graph, lang: 'en', config: CONFIG });
    const u = new URL(s.github.url);
    assert.equal(u.origin + u.pathname, 'https://github.com/octo/tree/issues/new');
    assert.equal(u.searchParams.get('template'), 'family-tree-proposal.yml');
    assert.equal(u.searchParams.get('code'), s.code);
    assert.equal(u.searchParams.get('submitter'), 'سارة — حفيدة حسن');
    assert.equal(u.searchParams.get('note'), 'ملاحظة');
    assert.ok(u.searchParams.get('title').startsWith('🌳 '));
    assert.equal(s.github.fits, true);
    assert.equal(s.hash, await proposalHash(p));
    assert.equal(s.fp, s.hash.slice(0, 6));
  });

  test('drops note, then submitter, then shortens the title, then gives up', () => {
    const title = '🌳 ' + 'ع'.repeat(110);
    const base = { title, submitter: 'س'.repeat(300), note: 'ن'.repeat(400), config: CONFIG };
    const enc = (s) => encodeURIComponent(s).length;
    const fixed = 'https://github.com/octo/tree/issues/new?template=family-tree-proposal.yml&title=&code='.length + enc(title);
    // Room for code + submitter but not the note.
    let code = 'A'.repeat(GITHUB_URL_MAX - fixed - enc(base.submitter) - '&submitter='.length - 10);
    let r = issueUrl({ ...base, code });
    assert.equal(r.fits, true);
    assert.equal(new URL(r.url).searchParams.get('note'), null);
    assert.ok(new URL(r.url).searchParams.get('submitter'));
    code = 'A'.repeat(GITHUB_URL_MAX - fixed - 5);
    r = issueUrl({ ...base, code });
    assert.equal(r.fits, true);
    assert.equal(new URL(r.url).searchParams.get('submitter'), null);
    code = 'A'.repeat(GITHUB_URL_MAX - fixed + 200);
    r = issueUrl({ ...base, code });
    assert.equal(r.fits, true);
    assert.equal([...new URL(r.url).searchParams.get('title')].length, 60);
    r = issueUrl({ ...base, code: 'A'.repeat(GITHUB_URL_MAX) });
    assert.equal(r.fits, false);
    assert.equal(new URL(r.url).searchParams.get('code'), null);
    assert.ok(r.url.length <= GITHUB_URL_MAX);
  });

  test('owner approve URL carries labels; destructive → approve-deletion and ⚠️ title', async () => {
    const s = await buildSubmission(proposal(1), { graph, lang: 'ar', config: CONFIG });
    assert.equal(new URL(s.approveIssueUrl).searchParams.get('labels'), 'family-tree,approve');
    const d = await buildSubmission(proposal(1), { graph, lang: 'ar', config: CONFIG, destructive: true });
    assert.equal(new URL(d.approveIssueUrl).searchParams.get('labels'), 'family-tree,approve-deletion');
    assert.ok(d.title.startsWith('⚠️ 🌳 '));
    assert.ok([...issueTitle('x'.repeat(300))].length <= 120);
    assert.equal(approvalComment('GFT1:abc.1'), '/approve\nGFT1:abc.1');
    assert.equal(approvalComment('GFT1:abc.1', { destructive: true, fp: 'a1b2c3' }), '/approve-deletion a1b2c3\nGFT1:abc.1');
    assert.equal(s.approvalComment, `/approve ${s.fp}\n${s.code}`);
    assert.equal(d.approvalComment, `/approve-deletion ${d.fp}\n${d.code}`);
    const rm = proposal(0);
    rm.ops = [{ op: 'remove-person', id: anyMan, reasonCode: 'duplicate' }];
    const r = await buildSubmission(rm, { graph, lang: 'en', config: CONFIG });
    assert.ok(r.approvalComment.startsWith(`/approve-deletion ${r.fp}\n`));
  });

  test('e-mail only when configured', async () => {
    assert.equal((await buildSubmission(proposal(1), { graph, config: CONFIG })).email, null);
    const s = await buildSubmission(proposal(1), { graph, config: { ...CONFIG, owner: { ...CONFIG.owner, email: 'a@b.org' } } });
    assert.ok(s.email.url.startsWith('mailto:a@b.org?subject='));
  });
});
