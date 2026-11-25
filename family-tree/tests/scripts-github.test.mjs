// The REST client (fetch injected), the read-only wrapper, the in-memory fake, and the bilingual bot texts.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createGitHub, readOnlyGitHub, GitHubError, WRITE_METHODS } from '../scripts/lib/github.mjs';
import { createFakeGitHub, fakeFromEvent } from '../scripts/lib/fake-github.mjs';
import { TEXTS, checkComment, appliedComment, whatsappLink } from '../scripts/lib/comments.mjs';
import { MAX_COMMENT } from '../scripts/lib/render.mjs';

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ...init });
    for (const [re, handler] of routes) {
      if (re.test(`${init.method} ${url}`)) {
        const r = typeof handler === 'function' ? handler(url, init, calls) : handler;
        const body = r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        return {
          ok: r.status >= 200 && r.status < 300, status: r.status, statusText: 'x',
          headers: { get: (k) => (r.headers || {})[k.toLowerCase()] ?? null }, text: async () => body,
        };
      }
    }
    throw new Error(`unexpected ${init.method} ${url}`);
  };
  fn.calls = calls;
  return fn;
}

describe('github: REST client', () => {
  test('auth header, JSON body, pagination, PR filtering', async () => {
    const page = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1 }));
    const fetch = fakeFetch([
      [/GET .*\/issues\?.*&page=1$/, { status: 200, body: [...page(99), { number: 100, pull_request: {} }] }],
      [/GET .*\/issues\?.*&page=2$/, { status: 200, body: [{ number: 101 }] }],
      [/POST .*\/issues\/7\/comments$/, (url, init) => ({ status: 201, body: { id: 1, body: JSON.parse(init.body).body } })],
    ]);
    const gh = createGitHub({ token: 'T0K', owner: 'o', repo: 'r', fetch, sleep: async () => {} });
    const list = await gh.listIssues({ labels: 'family-tree' });
    assert.equal(list.length, 100);
    assert.ok(!list.some((i) => i.pull_request));
    assert.match(fetch.calls[0].url, /^https:\/\/api\.github\.com\/repos\/o\/r\/issues\?state=open&labels=family-tree/);
    assert.equal(fetch.calls[0].headers.authorization, 'Bearer T0K');
    assert.equal(fetch.calls[0].headers['x-github-api-version'], '2022-11-28');
    const c = await gh.createComment(7, 'hello');
    assert.equal(c.body, 'hello');
    assert.equal(fetch.calls.at(-1).headers['content-type'], 'application/json');
  });

  test('errors, tolerated statuses and retries', async () => {
    let n = 0;
    const fetch = fakeFetch([
      [/GET .*\/issues\/1$/, () => (++n < 2 ? { status: 502, body: 'bad gateway' } : { status: 200, body: { number: 1 } })],
      [/GET .*\/issues\/2$/, { status: 404, body: { message: 'Not Found' } }],
      [/DELETE .*\/labels\/approve$/, { status: 404, body: { message: 'Label does not exist' } }],
      [/GET .*\/labels/, { status: 200, body: [{ name: 'Family-Tree' }] }],
      [/POST .*\/labels$/, { status: 422, body: { message: 'already_exists' } }],
    ]);
    const gh = createGitHub({ token: 't', owner: 'o', repo: 'r', fetch, sleep: async () => {} });
    assert.equal((await gh.getIssue(1)).number, 1);
    assert.equal(n, 2);
    await assert.rejects(gh.getIssue(2), (e) => e instanceof GitHubError && e.status === 404);
    await gh.removeLabel(5, 'approve');
    const created = await gh.ensureLabels([{ name: 'family-tree', color: '000000' }, { name: 'applied', color: '000000' }]);
    assert.deepEqual(created, ['applied']);
  });

  test('release asset upload goes to the uploads host with the raw body', async () => {
    const fetch = fakeFetch([[/POST https:\/\/uploads\.github\.com\/repos\/o\/r\/releases\/9\/assets\?name=family\.json/, { status: 201, body: { id: 3 } }]]);
    const gh = createGitHub({ token: 't', owner: 'o', repo: 'r', fetch });
    await gh.uploadReleaseAsset({ id: 9 }, 'family.json', Buffer.from('{}'), 'application/json');
    assert.equal(fetch.calls[0].headers['content-type'], 'application/json');
    assert.equal(String(fetch.calls[0].body), '{}');
  });

  test('readOnlyGitHub logs writes and passes reads through', async () => {
    const fake = createFakeGitHub({ issues: [{ number: 1, labels: ['family-tree'] }] });
    const lines = [];
    const ro = readOnlyGitHub(fake, (l) => lines.push(l));
    assert.equal((await ro.getIssue(1)).number, 1);
    for (const m of WRITE_METHODS) assert.equal(typeof ro[m], 'function');
    await ro.createComment(1, 'x');
    await ro.addLabels(1, ['approve']);
    await ro.closeIssue(1);
    assert.equal(fake.calls.length, 0);
    assert.equal(ro.writes.length, 3);
    assert.ok(lines.every((l) => l.startsWith('[dry-run]')));
  });

  test('fake GitHub: labels create events with the actor; fakeFromEvent seeds the issue and comment', async () => {
    const gh = createFakeGitHub({});
    const n = gh.userOpen({ body: 'x', login: 'rel', labels: ['family-tree'] });
    gh.userLabel(n, 'approve', 'keeper');
    await gh.addLabels(n, ['applied']);
    const ev = await gh.listIssueEvents(n);
    assert.deepEqual(ev.map((e) => [e.label.name, e.actor.login]), [['family-tree', 'rel'], ['approve', 'keeper'], ['applied', 'github-actions[bot]']]);
    const g2 = fakeFromEvent({ issue: { number: 4, body: 'b', labels: [{ name: 'family-tree' }] }, comment: { id: 77, body: '/approve', user: { login: 'k' } } });
    assert.equal((await g2.getComment(77)).body, '/approve');
    assert.deepEqual(g2.labelsOf(4), ['family-tree']);
  });
});

// Masculine imperatives that must not open an Arabic sentence addressed to the reader (same list as messages.test).
const MASCULINE_IMPERATIVES = [
  'أضف', 'اختر', 'أرسل', 'اكتب', 'ابحث', 'اضغط', 'تعرّف', 'تعرف', 'انقر', 'أدخل', 'حدّد', 'حدد', 'راجع', 'تأكد', 'تأكّد',
  'انسخ', 'استخدم', 'قسّم', 'ألصق', 'الصق', 'اطلب', 'افتح', 'احذف', 'غيّر', 'اذهب', 'أعد', 'انتظر', 'تحقق', 'تحقّق',
];
const clauseStarts = (text) => text.split(/(?:^|[.؟!؛:—(]|\s-\s|\n)\s*/u).map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
const SAMPLE = { n: 3, ref: '#12', owner: 'مشرف الشجرة', ownerEn: 'the tree keeper', label: 'approve', fp: 'a1b2c3', given: 'ffffff', rev: 9, commit: 'abc1234', list: '2, 3', url: 'https://x.y/#/p/p1' };

describe('comments: bilingual texts', () => {
  test('every text has Arabic and English, and Arabic never opens with a masculine imperative', () => {
    for (const [key, val] of Object.entries(TEXTS)) {
      const pair = typeof val === 'function' ? val(SAMPLE) : val;
      assert.equal(pair.length, 2, key);
      const [ar, en] = pair;
      assert.match(ar, /[؀-ۿ]/, `${key}: Arabic text`);
      assert.match(en, /[A-Za-z]/, `${key}: English text`);
      for (const w of clauseStarts(ar)) assert.ok(!MASCULINE_IMPERATIVES.includes(w), `${key}: "${w}" opens a clause`);
    }
  });

  test('a huge proposal comment stays under the 60,000-char cap and says "…and N more"', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `Add “${'Abdulrahman '.repeat(20)}${i}” as son of someone`);
    const body = checkComment({
      hash: 'a'.repeat(64), fp: 'aaaaaa', rev: 3, edits: 0, src: 'body', proposal: { submitter: { name: '@everyone' }, note: 'x'.repeat(5000) },
      describe: { ar: lines, en: lines }, errors: { ar: lines, en: lines }, warnings: { ar: lines, en: lines },
      ok: false, destructive: false, previewUrl: 'https://x.y/#/preview/5', identicalTo: [], dependsOnIssues: [], failingOps: [1, 2],
    });
    assert.ok(body.length <= MAX_COMMENT, String(body.length));
    assert.match(body, /and \d+ more — see the preview/);
    assert.match(body, /غيرها — التفاصيل في المعاينة/);
    assert.ok(!body.includes('@everyone'), 'mentions are neutralized');
    assert.match(body, /\/approve aaaaaa skip 1,2/);
  });

  test('success comment links people with ?rev and a WhatsApp link', () => {
    const body = appliedComment({
      commitUrl: 'https://github.com/o/r/commit/abc', commitShort: 'abc', rev: 9, issue: 3,
      people: [{ ar: 'أحمد <b>', en: 'Ahmed [x]', url: 'https://x.y/#/p/p1?rev=9' }], whatsappUrl: whatsappLink('https://x.y/#/p/p1?rev=9'),
      warnings: { ar: [], en: [] }, skipped: [2],
    });
    assert.match(body, /#\/p\/p1\?rev=9/);
    assert.match(body, /https:\/\/wa\.me\/\?text=/);
    assert.ok(body.includes('&lt;b&gt;') && body.includes('\\[x\\]'));
    assert.match(body, /Skipped changes: 2/);
  });
});
