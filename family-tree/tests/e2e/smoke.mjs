#!/usr/bin/env node
// End-to-end smoke test for the Grand Family Tree site (local only — NOT part of `node --test`).
//
//   cd family-tree && node tests/e2e/smoke.mjs [--routes-only | --flows-only] [--shots=<dir>] [--quick]
//
// * Serves this folder with a tiny node:http static server on port 8199 (no python needed).
// * Visits every route in Arabic and English, at 360×740 and 1280×800, light and dark; fails on any console error,
//   page error, failed request (Google Fonts are stubbed so the test works offline), missing i18n string,
//   or horizontal overflow at 360px. Saves a screenshot of every route/viewport.
// * Checks the string registry: every key in both languages; no Arabic string starts with a masculine imperative.
// * Runs the main flows end to end: wizard → draft → WhatsApp code that applies in FINAL mode; person-page dialogs;
//   send via "copy code" → #/me → simulated approval (new family.json + changelog + applied ledger) → toast;
//   admin paste → preview → approve-issue URL.
// Needs Playwright with Chromium (`require('playwright')` must resolve, e.g. via NODE_PATH or a global install).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeProposal, decodeProposal } from '../../js/core/codec.js';
import { applyProposal, newProposal, proposalHash } from '../../js/core/ops.js';
import { normalizeData, serializeData, validateData } from '../../js/core/schema.js';
import { buildGraph } from '../../js/core/graph.js';
import { describeProposal } from '../../js/core/describe.js';
import { lineageName } from '../../js/core/names.js';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Install it (npm i -g playwright && npx playwright install chromium) or set NODE_PATH.');
  process.exit(2);
}

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.GFT_E2E_PORT || 8199);
const ARGS = process.argv.slice(2);
const argVal = (name) => (ARGS.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const SHOTS = path.resolve(argVal('shots') || process.env.GFT_E2E_SHOTS || path.join(os.tmpdir(), 'gft-e2e'));
const ROUTES_ONLY = ARGS.includes('--routes-only');
const FLOWS_ONLY = ARGS.includes('--flows-only');
const QUICK = ARGS.includes('--quick'); // light theme only for the route sweep
fs.mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------
// Static server (root can be switched to a temp copy of the site for the approval simulation; same origin keeps
// localStorage).
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const server = { root: SITE };
const httpServer = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(server.root, `.${rel}`);
    if (!file.startsWith(server.root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
const BASE = `http://localhost:${PORT}/`;

// ---------------------------------------------------------------------------------------------------------------
// Test data
const FAMILY = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'family.json'), 'utf8'));
const DATA = normalizeData(FAMILY);
const G = buildGraph(DATA);
const ROOT = DATA.meta.rootPersonId;
const people = G.people();
const childOfSomeone = (p) => !!G.birthUnion(p.id);
const UNKNOWN_NAME = people.find((p) => p.nameStatus !== 'known')?.id;
const LIVING = people.find((p) => !p.deceased && childOfSomeone(p) && G.children(p.id).length > 0)?.id;
const MARRIED_IN_WIFE = people.find((p) => p.gender === 'f' && !childOfSomeone(p) && G.spouses(p.id).length && G.children(p.id).length)?.id;
const DEEP = people.map((p) => [p.id, G.ancestors(p.id).size]).sort((a, b) => b[1] - a[1])[0]?.[0];
const LEAF = people.find((p) => !p.deceased && childOfSomeone(p) && !G.children(p.id).length && G.father(p.id))?.id;
for (const [k, v] of Object.entries({ ROOT, UNKNOWN_NAME, LIVING, MARRIED_IN_WIFE, DEEP, LEAF })) {
  if (!v) throw new Error(`could not pick a test person for ${k}`);
}

async function sampleCode() {
  const p = newProposal();
  p.submitter = { name: 'Smoke test', relation: 'cousin', personId: '' };
  p.ops = [
    { op: 'add-person', ref: 'new1', person: { name: { ar: 'يوسف' }, gender: 'm', birth: { date: '2015' } }, link: { as: 'child', of: LIVING, with: null }, unionRef: 'newu2' },
    { op: 'mark', id: ROOT, mark: 'verified' },
  ];
  return { code: await encodeProposal(p), proposal: p };
}

// ---------------------------------------------------------------------------------------------------------------
// Failure bookkeeping
const failures = [];
let checks = 0;
function fail(where, msg) {
  failures.push(`${where}: ${msg}`);
  console.log(`  ✗ ${where}: ${msg}`);
}
function check(cond, where, msg) {
  checks++;
  if (!cond) fail(where, msg);
  return !!cond;
}

const IGNORED_HOSTS = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

/** New context with language/theme preset, external calls stubbed, and error collectors attached. */
async function newContext(browser, { lang = 'ar', theme = 'light', width = 360, height = 740, storage = null } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme, locale: lang === 'ar' ? 'ar-SA' : 'en-GB',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(({ lang, theme, storage }) => {
    try {
      if (!sessionStorage.getItem('gft.e2e.init')) {
        sessionStorage.setItem('gft.e2e.init', '1');
        if (storage) for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
      }
      localStorage.setItem('gft.lang', lang);
      localStorage.setItem('gft.theme', theme);
    } catch { /* ignore */ }
  }, { lang, theme, storage });
  // Fonts: stub (works offline, deterministic). GitHub REST: no network in tests.
  await context.route((url) => IGNORED_HOSTS.test(url.hostname), (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route((url) => url.hostname === 'api.github.com', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  return context;
}

/** Attach collectors; returns an array that receives problem strings. */
function watch(page) {
  const problems = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') problems.push(`console error: ${text}`);
    else if (msg.type() === 'warning' && /\[i18n\] missing/.test(text)) problems.push(`i18n: ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('requestfailed', (req) => {
    const u = new URL(req.url());
    if (IGNORED_HOSTS.test(u.hostname)) return;
    problems.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  return problems;
}

let navSeq = 0;
/** Full page load of a hash route (cache-busting query forces a real reload, so init scripts run). */
async function load(page, hash) {
  await page.goto(`${BASE}?v=${++navSeq}${hash}`, { waitUntil: 'load' });
  await page.waitForSelector('#app section.view, #app .error-state, #app .empty-state', { timeout: 15000 });
  await settle(page);
}
async function settle(page, ms = 150) {
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* keep going */ }
  await page.waitForTimeout(ms);
}
/** In-app navigation by hash (no reload). */
async function go(page, hash) {
  await page.evaluate((hsh) => { location.hash = hsh; }, hash);
  await page.waitForFunction((hsh) => location.hash === hsh, hash);
  await settle(page);
}

async function overflowAt(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement;
    if (se.scrollWidth <= innerWidth + 1) return null;
    // Find the widest offenders to make the report useful.
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 1 || r.left < -1)) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed') continue;
        out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
      if (out.length > 6) break;
    }
    return `scrollWidth ${se.scrollWidth} > ${innerWidth}: ${out.join(' | ')}`;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Route sweep
async function routeSweep(browser) {
  const { code } = await sampleCode();
  const routes = [
    ['home', '#/'],
    ['tree', '#/tree'],
    ['tree-chart', `#/tree/${ROOT}?view=chart`],
    ['tree-list', `#/tree/${ROOT}?view=list`],
    ['tree-up', `#/tree/${DEEP}?dir=up`],
    ['p-root', `#/p/${ROOT}`],
    ['p-unknown', `#/p/${UNKNOWN_NAME}`],
    ['p-living', `#/p/${LIVING}`],
    ['p-wife', `#/p/${MARRIED_IN_WIFE}`],
    ['search-ar', `#/search?q=${encodeURIComponent('محمد')}`],
    ['search-en', '#/search?q=Muhammad'],
    ['add-family', '#/add-family'],
    ['draft', '#/draft'],
    ['me', '#/me'],
    ['relationship', `#/relationship/${LEAF}/${MARRIED_IN_WIFE}`],
    ['changes', '#/changes'],
    ['about', '#/about'],
    ['admin', '#/admin'],
    ['preview', `#/preview?code=${encodeURIComponent(code)}`],
  ];
  const combos = [];
  for (const lang of ['ar', 'en']) {
    for (const [width, height] of [[360, 740], [1280, 800]]) {
      for (const theme of QUICK ? ['light'] : ['light', 'dark']) combos.push({ lang, width, height, theme });
    }
    // Largest text size (A++) on a phone: the most likely place for overflow.
    combos.push({ lang, width: 360, height: 740, theme: 'light', textSize: 'xl' });
  }
  for (const combo of combos) {
    const tag = `${combo.lang}-${combo.width}-${combo.theme}${combo.textSize ? `-${combo.textSize}` : ''}`;
    console.log(`• routes ${tag}`);
    const storage = { 'gft.me': JSON.stringify(LEAF), ...(combo.textSize ? { 'gft.textSize': combo.textSize } : {}) };
    const context = await newContext(browser, { ...combo, storage });
    const page = await context.newPage();
    const problems = watch(page);
    for (const [name, hash] of routes) {
      problems.length = 0;
      const where = `${tag} ${name}`;
      try {
        await load(page, hash);
      } catch (e) {
        fail(where, `did not render: ${e.message.split('\n')[0]}`);
        continue;
      }
      const state = await page.evaluate(() => ({
        error: !!document.querySelector('#app .error-state'),
        notFound: !!document.querySelector('#app h1') && /not found|غير موجود/i.test(document.querySelector('#app h1')?.textContent || ''),
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        theme: document.documentElement.dataset.theme,
        me: globalThis.__gft?.me || null,
        title: document.title,
        textLen: (document.querySelector('#app')?.innerText || '').trim().length,
        rawKeys: [...(document.querySelector('#app')?.innerText || '').matchAll(/\b[a-z]+\.[a-zA-Z]+(?:\.[a-zA-Z0-9]+)+\b/g)].map((m) => m[0]).filter((s) => !/^(gtsgate|github|wa|api)\./.test(s) && !/\.(com|io|me|json|js|html|jpg|png)$/.test(s)),
      }));
      check(!state.error, where, 'error state rendered');
      check(!state.notFound, where, 'not-found rendered');
      check(state.lang === combo.lang && state.dir === (combo.lang === 'ar' ? 'rtl' : 'ltr'), where, `html lang/dir is ${state.lang}/${state.dir}`);
      check(state.theme === combo.theme, where, `theme is ${state.theme}`);
      check(state.me === LEAF, where, `"me" is ${state.me}, expected ${LEAF}`);
      check(state.textLen > 20, where, 'page looks empty');
      check(!state.rawKeys.length, where, `raw i18n keys visible: ${state.rawKeys.slice(0, 5).join(', ')}`);
      if (combo.width === 360) {
        const over = await overflowAt(page);
        check(!over, where, `horizontal overflow — ${over}`);
      }
      for (const p of problems) fail(where, p);
      await page.screenshot({ path: path.join(SHOTS, `route-${tag}-${name}.png`), fullPage: combo.width === 360 });
    }
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 2. i18n registry
const IMPERATIVES = ['أضف', 'اختر', 'أرسل', 'اكتب', 'ابحث', 'اضغط', 'تعرّف', 'تعرف', 'ادخل', 'أدخل'];
async function i18nCheck(browser) {
  console.log('• i18n registry');
  const context = await newContext(browser, { lang: 'ar' });
  const page = await context.newPage();
  const problems = watch(page);
  await load(page, '#/about');
  const result = await page.evaluate(async () => {
    const mods = ['home', 'tree', 'person', 'search', 'wizard', 'draft', 'me', 'relationship', 'changes', 'about', 'admin', 'preview']
      .map((m) => `./js/views/${m}.js`).concat(['./js/forms/dialogs.js', './js/forms/person-form.js', './js/forms/picker.js', './js/ui.js', './js/submit.js', './js/app.js']);
    for (const m of mods) await import(new URL(m, location.href).href);
    const i18n = await import(new URL('./js/i18n.js', location.href).href);
    const d = i18n.dictionaries();
    const vars = new Proxy({}, { get: (_, k) => (k === 'n' || k === 'count' || k === 'total' ? 3 : typeof k === 'string' ? 'X' : undefined), has: () => true });
    const sample = (v) => {
      if (typeof v !== 'function') return String(v);
      const outs = [];
      for (const n of [0, 1, 2, 3, 11]) {
        try { outs.push(String(v(new Proxy({}, { get: (_, k) => (k === 'n' || k === 'count' || k === 'total' ? n : typeof k === 'string' ? 'X' : undefined), has: () => true })))); } catch { /* ignore */ }
      }
      try { outs.push(String(v(vars))); } catch { /* ignore */ }
      return outs.join('\n');
    };
    const arKeys = Object.keys(d.ar);
    const enKeys = Object.keys(d.en);
    return {
      total: new Set([...arKeys, ...enKeys]).size,
      missingAr: enKeys.filter((k) => !(k in d.ar)),
      missingEn: arKeys.filter((k) => !(k in d.en)),
      emptyAr: arKeys.filter((k) => typeof d.ar[k] === 'string' && !d.ar[k].trim()),
      emptyEn: enKeys.filter((k) => typeof d.en[k] === 'string' && !d.en[k].trim()),
      ar: Object.fromEntries(arKeys.map((k) => [k, sample(d.ar[k])])),
    };
  });
  console.log(`  ${result.total} keys`);
  check(result.total > 300, 'i18n', `only ${result.total} keys registered`);
  check(!result.missingAr.length, 'i18n', `missing Arabic: ${result.missingAr.join(', ')}`);
  check(!result.missingEn.length, 'i18n', `missing English: ${result.missingEn.join(', ')}`);
  check(!result.emptyAr.length && !result.emptyEn.length, 'i18n', `empty strings: ${[...result.emptyAr, ...result.emptyEn].join(', ')}`);
  const bad = [];
  for (const [k, v] of Object.entries(result.ar)) {
    for (const line of v.split('\n')) {
      const first = line.trim().replace(/^[\s«"“(\[•·\-–—:!؟?.،]+/, '').split(/[\s،,.:!؟?»”)]+/)[0] || '';
      // Drop tatweel and harakat except shadda (تعرّف) and damma: "أُرسل" (passive, "was sent") is fine; "أرسل"/"أَرسِل" is not.
      const plain = first.replace(/\u0640/g, '').replace(/[\u064B-\u0652]/g, (m) => (m === '\u0651' || m === '\u064F' ? m : ''));
      if (IMPERATIVES.includes(plain) || IMPERATIVES.includes(plain.replace(/\u0651/g, ''))) bad.push(`${k}: ${line.slice(0, 40)}`);
    }
  }
  check(!bad.length, 'i18n', `Arabic strings starting with a masculine imperative: ${[...new Set(bad)].join(' | ')}`);
  for (const p of problems) fail('i18n', p);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Flows
const FLOWS = [];
const flow = (name, fn) => FLOWS.push([name, fn]);

// A father in the tree with exactly one wife and children (wizard "I'm not listed" path), and a father whose
// children have no listed mother (person-page dialogs).
const WIZ_FATHER = people.find((p) => p.gender === 'm' && G.spouses(p.id).length === 1 && G.children(p.id).length >= 2 && G.father(p.id))?.id;
const DLG_PERSON = people.find((p) => p.gender === 'm' && p.id !== WIZ_FATHER && G.children(p.id).length >= 3 && G.father(p.id) && !p.deceased)?.id;
if (!WIZ_FATHER || !DLG_PERSON) throw new Error('could not pick flow test people');

const draftOps = (page) => page.evaluate(() => globalThis.__gft.draft.ops.map((o) => JSON.parse(JSON.stringify(o))));
const modalOpen = async (page) => { await page.waitForSelector('dialog.modal[open]', { timeout: 5000 }); await page.waitForTimeout(250); }; // let the sheet animation finish
const modalClosed = (page) => page.waitForFunction(() => !document.querySelector('dialog.modal[open]'), null, { timeout: 5000 });
async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `flow-${name}.png`), fullPage: false });
}
function problemsOf(where, problems) { for (const p of problems) fail(where, p); problems.length = 0; }

/** Decode every GFT code inside a wa.me / GitHub URL and return the proposal. */
async function proposalFromUrl(href) {
  const u = new URL(href);
  const text = [...u.searchParams.values()].join('\n');
  return decodeProposal(text);
}

flow('wizard → draft → WhatsApp code applies in final mode (ar, 360px)', async (browser) => {
  const W = 'wizard';
  const context = await newContext(browser, { lang: 'ar', width: 360, height: 740 });
  const page = await context.newPage();
  const problems = watch(page);
  await load(page, '#/add-family');
  await page.locator('.wiz-tile').nth(1).click(); // "I am not listed yet"
  await page.fill('.picker-input', lineageName(G, WIZ_FATHER, 'ar'));
  await page.waitForSelector('.picker-option');
  await page.locator('.picker-option').first().click();
  await page.waitForSelector('.wiz-other-parent .chip');
  await page.locator('.wiz-other-parent .chip').first().click(); // his wife = my mother
  const self = page.locator('.wiz-step-who .wiz-row').first();
  await self.locator('.wiz-ar').fill('سلمان');
  check(/salman/i.test(await self.locator('.wiz-en').inputValue()), W, 'English name is not filled in automatically');
  await self.locator('.wiz-gender button[data-v="m"]').click();
  await self.locator('.wiz-year').fill('١٩٩٠'); // Arabic-Indic digits are accepted
  await shot(page, 'wizard-1-self');
  await page.locator('.wiz-step-who .wiz-next').click();
  await page.waitForSelector('.wiz-step-spouses');
  check((await draftOps(page)).length === 1, W, 'self was not added to the draft');
  const wife = page.locator('.wiz-step-spouses .wiz-row').last();
  await wife.locator('.wiz-ar').fill('نورة');
  if (await wife.locator('.wiz-gender button[data-v="f"]').count()) await wife.locator('.wiz-gender button[data-v="f"]').click();
  await page.locator('.wiz-step-spouses .wiz-next').click();
  await page.waitForSelector('.wiz-step-children');
  const kids = [['ريم', 'f', '2015'], ['فيصل', 'm', '2017'], ['لمى', 'f', '2020']];
  for (let i = 0; i < kids.length; i++) {
    const union = page.locator('.wiz-union').first();
    if (i > 0) { await union.locator('.wiz-another').click(); await page.waitForTimeout(150); }
    const row = page.locator('.wiz-union').first().locator('.wiz-row').last();
    await row.locator('.wiz-ar').fill(kids[i][0]);
    await row.locator(`.wiz-gender button[data-v="${kids[i][1]}"]`).click();
    await row.locator('.wiz-year').fill(kids[i][2]);
  }
  await shot(page, 'wizard-2-children');
  await page.locator('.wiz-step-children .wiz-footer .wiz-next').click();
  await page.waitForSelector('.wiz-step-review');
  const lines = await page.locator('.wiz-review-list li').allInnerTexts();
  check(lines.length === 5, W, `review lists ${lines.length} changes, expected 5`);
  check(lines.some((l) => l.includes('سلمان')) && lines.some((l) => l.includes('لمى')), W, 'review lines do not name the new people');
  check(await page.locator('.wiz-whatsapp').count() === 1, W, 'no "tell the owner on WhatsApp" link');
  await shot(page, 'wizard-3-review');
  await page.locator('.wiz-send').click();
  await page.waitForSelector('.view-draft .draft-changes .draft-ops');
  check((await page.locator('.draft-changes .draft-ops li').count()) === 5, W, 'draft page does not list the 5 changes');
  // Public-data acknowledgement unlocks the send links.
  await page.check('#draft-ack');
  await page.waitForFunction(() => /GFT[01]:/.test(decodeURIComponent(document.querySelector('.draft-wa')?.getAttribute('href') || '')), null, { timeout: 10000 });
  const wa = await page.locator('.draft-wa').getAttribute('href');
  check(/^https:\/\/wa\.me\//.test(wa), W, `WhatsApp href is ${wa.slice(0, 40)}`);
  const ghHref = await page.locator('a.draft-way').first().getAttribute('href');
  check(ghHref && ghHref.includes('template=family-tree-proposal.yml') && /GFT[01]/.test(decodeURIComponent(ghHref)), W, 'GitHub issue link has no template/code');
  await shot(page, 'wizard-4-draft');
  const proposal = await proposalFromUrl(wa);
  check(proposal.ops.length === 5, W, `decoded proposal has ${proposal.ops.length} ops`);
  const r = applyProposal(DATA, proposal, { mode: 'final', now: new Date().toISOString(), issue: 1, actor: 'e2e' });
  check(r.ok, W, `proposal does not apply in final mode: ${JSON.stringify(r.errors).slice(0, 300)}`);
  if (r.ok) {
    check(r.created.people.length === 5, W, `created ${r.created.people.length} people`);
    check(validateData(r.data).ok, W, 'result does not validate');
    const gg = buildGraph(r.data);
    const salman = r.idMap[proposal.ops[0].ref];
    check(gg.father(salman)?.id === WIZ_FATHER, W, 'self is not a child of the chosen father');
    check(gg.children(salman).length === 3, W, 'self does not have 3 children');
    check(gg.person(salman).birth.date === '1990', W, `birth year stored as ${gg.person(salman).birth.date}`);
  }
  problemsOf(W, problems);
  await context.close();
});

/** Open "More options" and pick an item by its label. */
async function moreOption(page, label) {
  await page.click('.person-btn-more');
  await modalOpen(page);
  await page.locator('dialog.modal[open] .sheet-item', { hasText: label }).first().click();
  await page.waitForTimeout(150);
  await modalOpen(page);
}
/** Radios in dialogs are styled labels: click the label that wraps the input. */
async function pickRadio(page, value) {
  await page.locator(`dialog.modal[open] label:has(input[type="radio"][value="${value}"])`).first().click();
  check(await page.locator(`dialog.modal[open] input[type="radio"][value="${value}"]`).first().isChecked(), 'dialogs', `radio ${value} not checked`);
}
const primaryAction = (page) => page.locator('dialog.modal[open] .modal-actions .btn-primary').last();

let SENT_STATE = null; // handed from the dialogs flow to the approval flow

flow('person-page dialogs (en, 360px)', async (browser) => {
  const W = 'dialogs';
  const context = await newContext(browser, { lang: 'en', width: 360, height: 740 });
  const page = await context.newPage();
  const problems = watch(page);
  await load(page, `#/p/${DLG_PERSON}`);
  // (1) add a child
  await page.click('.person-btn-add');
  await modalOpen(page);
  await shot(page, 'dialogs-1-sheet');
  await page.click('dialog.modal[open] .dlg-tile-child');
  await page.waitForSelector('dialog.dlg-add-child[open]');
  await page.locator('dialog.modal[open] input.form-input-ar[id$="-name"]').fill('يوسف');
  await pickRadio(page, 'm');
  await page.locator('dialog.modal[open] input.form-year').first().fill('2019');
  await shot(page, 'dialogs-2-add-child');
  await primaryAction(page).click();
  await modalClosed(page);
  let ops = await draftOps(page);
  check(ops.length === 1 && ops[0].op === 'add-person' && ops[0].link?.as === 'child' && ops[0].link?.of === DLG_PERSON, W, `add child produced ${JSON.stringify(ops).slice(0, 200)}`);
  await settle(page);
  check(await page.locator('.draft-bar:not([hidden])').count() === 1, W, 'sticky "unsent changes" bar is not shown');
  check((await page.locator('#app').innerText()).includes('Yousef'), W, 'new child is not shown on the person page');
  // (2) mark the father as deceased
  const fatherId = G.father(DLG_PERSON).id;
  await load(page, `#/p/${fatherId}`);
  await moreOption(page, 'Mark as');
  await pickRadio(page, 'deceased');
  await page.waitForTimeout(100);
  await shot(page, 'dialogs-3-mark');
  await primaryAction(page).click();
  await modalClosed(page);
  ops = await draftOps(page);
  check(ops.length === 2 && ops[1].op === 'mark' && ops[1].mark === 'deceased' && ops[1].id === fatherId, W, `mark produced ${JSON.stringify(ops[1])}`);
  await settle(page);
  check(/may god have mercy|رحمه الله|rahimahu/i.test(await page.locator('#app').innerText()), W, 'deceased person page has no "may God have mercy" line');
  check(!/[✝†✞]/.test(await page.locator('#app').innerText()), W, 'a cross symbol is shown for the deceased');
  // (3) re-arrange children
  await load(page, `#/p/${DLG_PERSON}`);
  await moreOption(page, 'Re-arrange children');
  await page.locator('dialog.modal[open] .dlg-order-down').first().click();
  await shot(page, 'dialogs-4-reorder');
  await primaryAction(page).click();
  await modalClosed(page);
  ops = await draftOps(page);
  check(ops.length === 3 && ops[2].op === 'reorder-children', W, `reorder produced ${JSON.stringify(ops[2])}`);
  // (4) request removal is blocked for a person with children
  await moreOption(page, 'Request removal');
  const blocked = await page.locator('dialog.modal[open] .notice-danger').count();
  const removeBtn = await page.locator('dialog.modal[open] .modal-actions .btn-danger').count();
  check(blocked === 1 && removeBtn === 0, W, 'removal of a person with children is not blocked');
  await shot(page, 'dialogs-5-remove-blocked');
  await page.click('dialog.modal[open] .modal-close');
  await modalClosed(page);
  check((await draftOps(page)).length === 3, W, 'blocked removal changed the draft');
  // (5) the draft page lists the three changes; send via "copy code"
  await load(page, '#/draft');
  check((await page.locator('.draft-changes .draft-ops li').count()) === 3, W, 'draft does not list 3 changes');
  await page.check('#draft-ack');
  await page.locator('details.draft-other > summary').click();
  await page.waitForFunction(() => !document.querySelector('button.draft-way')?.disabled, null, { timeout: 10000 });
  await shot(page, 'dialogs-6-draft');
  const draftId = await page.evaluate(() => globalThis.__gft.draft.id);
  await page.locator('button.draft-way').click();
  await page.waitForFunction(() => globalThis.__gft.sent.length === 1 && globalThis.__gft.draft.ops.length === 0, null, { timeout: 5000 });
  await settle(page);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(/^GFT[01]:/.test(clip), W, `clipboard holds ${clip.slice(0, 20)}`);
  check(await page.locator('.draft-thanks').count() === 1, W, 'no thank-you card after sending');
  await shot(page, 'dialogs-7-sent');
  const sent = await page.evaluate(() => globalThis.__gft.sent[0]);
  check(sent.id === draftId && sent.via === 'copy', W, `sent entry ${sent.id}/${sent.via}`);
  if (clip) {
    const decoded = await decodeProposal(clip);
    check(decoded.id === draftId && decoded.ops.length === 3, W, 'copied code does not decode to the draft');
  }
  // #/me shows it as sent
  await load(page, '#/me');
  check(await page.locator('.me-prop-sent').count() === 1, W, '#/me does not list the sent proposal');
  await shot(page, 'dialogs-8-me');
  problemsOf(W, problems);
  SENT_STATE = { context, page, sent, problems };
});

flow('approval simulation → toast, sent proposal disappears (en, 360px)', async () => {
  const W = 'approval';
  if (!SENT_STATE) { fail(W, 'needs the dialogs flow'); return; }
  const { context, page, sent, problems } = SENT_STATE;
  const proposal = sent.proposal;
  const now = new Date().toISOString();
  const r = applyProposal(DATA, proposal, { mode: 'final', now, issue: 4242, actor: 'gtsgate' });
  check(r.ok, W, `sent proposal does not apply in final mode: ${JSON.stringify(r.errors).slice(0, 300)}`);
  if (!r.ok) return;
  const hash = await proposalHash(proposal);
  const en = describeProposal(proposal, G, 'en');
  const ar = describeProposal(proposal, G, 'ar');
  const changelog = { entries: [{
    issue: 4242, proposalId: proposal.id, hash, commit: 'abc1234', rev: r.data.meta.revision, at: now, title: en.title,
    summary: { en: en.lines, ar: ar.lines }, submitter: { name: proposal.submitter?.name || '', relation: proposal.submitter?.relation || '' },
    approvedBy: 'gtsgate', people: [...new Set([...r.created.people, ...r.touched.people])],
    touched: { people: [...new Set([...r.touched.people, ...r.created.people])], unions: [...new Set([...r.touched.unions, ...r.created.unions])] },
    destructive: false, action: 'apply',
  }] };
  const applied = { [hash]: { issue: 4242, proposalId: proposal.id, commit: 'abc1234', idMap: r.idMap, at: now, rev: r.data.meta.revision } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gft-site-'));
  for (const entry of ['index.html', 'manifest.json', 'config.json', 'css', 'js', 'img', 'data']) fs.cpSync(path.join(SITE, entry), path.join(tmp, entry), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'data', 'family.json'), serializeData(r.data));
  fs.writeFileSync(path.join(tmp, 'data', 'changelog.json'), `${JSON.stringify(changelog, null, 2)}\n`);
  fs.writeFileSync(path.join(tmp, 'data', 'applied.json'), `${JSON.stringify(applied, null, 2)}\n`);
  server.root = tmp;
  try {
    await load(page, '#/');
    const toast = page.locator('.toast-success');
    check(await toast.count() >= 1, W, 'no "your changes were approved" toast');
    check(/approved/i.test(await toast.first().innerText().catch(() => '')), W, 'toast text does not say approved');
    await shot(page, 'approval-1-toast');
    const st = await page.evaluate(() => ({ sent: globalThis.__gft.sent.length, approved: globalThis.__gft.approved.length, rev: globalThis.__gft.data.meta.revision }));
    check(st.sent === 0, W, `${st.sent} proposals still in the sent queue`);
    check(st.approved === 1, W, 'approved history not recorded');
    check(st.rev === DATA.meta.revision + 1, W, `revision ${st.rev}`);
    await load(page, '#/me');
    check(await page.locator('.me-prop-sent').count() === 0, W, '#/me still lists the proposal as sent');
    check(await page.locator('.me-prop-approved').count() === 1, W, '#/me does not list the approved proposal');
    await shot(page, 'approval-2-me');
    const newChild = r.idMap[proposal.ops[0].ref];
    await load(page, `#/p/${newChild}`);
    const txt = await page.locator('#app').innerText();
    check(/Yousef/.test(txt) && !/Not sent yet|awaiting approval/i.test(txt), W, 'approved child page wrong or still pending');
    await load(page, '#/changes');
    check(/#?4242/.test(await page.locator('#app').innerText()) || (await page.locator('#app .change-entry, #app li').count()) > 0, W, 'changes page does not show the approved entry');
    await shot(page, 'approval-3-changes');
  } finally {
    server.root = SITE;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  problemsOf(W, problems);
  await context.close();
});

flow('admin paste → preview ✅ → approve-issue URL (ar, 1280px)', async (browser) => {
  const W = 'admin';
  const context = await newContext(browser, { lang: 'ar', width: 1280, height: 800 });
  const page = await context.newPage();
  const problems = watch(page);
  const { code } = await sampleCode();
  await load(page, '#/admin');
  const message = `السلام عليكم\nهذه تعديلاتي\n\nرمز التعديلات — لا تغيّره / Change code — do not edit\n\`\`\`\n${code}\n\`\`\``;
  await page.fill('#admin-paste', message);
  await page.locator('.admin-section .btn-primary', { hasText: 'معاينة' }).first().click();
  await page.waitForSelector('.preview-status', { timeout: 10000 });
  check(await page.locator('.preview-status-ok').count() === 1, W, 'preview does not show ✅');
  check((await page.locator('.preview-status-ok').innerText()).includes('✅'), W, 'no ✅ mark');
  await page.waitForFunction(() => !!document.querySelector('.preview-approve')?.getAttribute('href'), null, { timeout: 10000 });
  const href = await page.locator('.preview-approve').getAttribute('href');
  const u = new URL(href);
  check(u.searchParams.get('labels') === 'family-tree,approve', W, `labels=${u.searchParams.get('labels')}`);
  check(u.searchParams.get('template') === 'family-tree-proposal.yml', W, 'approve URL without the issue template');
  check(/GFT[01]:/.test(u.searchParams.get('code') || ''), W, 'approve URL without the code');
  await shot(page, 'admin-1-preview');
  // A removal request needs the separate deletion approval label.
  const del = newProposal();
  del.ops = [{ op: 'remove-person', id: LEAF, reasonCode: 'entered-by-mistake' }];
  await page.fill('#admin-paste', await encodeProposal(del));
  await page.locator('.admin-section .btn-primary', { hasText: 'معاينة' }).first().click();
  await page.waitForFunction(() => /approve-deletion/.test(decodeURIComponent(document.querySelector('.preview-approve')?.getAttribute('href') || '')), null, { timeout: 10000 });
  const delHref = new URL(await page.locator('.preview-approve').getAttribute('href'));
  check(delHref.searchParams.get('labels') === 'family-tree,approve-deletion', W, `deletion labels=${delHref.searchParams.get('labels')}`);
  await shot(page, 'admin-2-deletion');
  // The preview route itself (link from the bot comment)
  await load(page, `#/preview?code=${encodeURIComponent(code)}`);
  check(await page.locator('.preview-status-ok').count() === 1, W, '#/preview?code= does not show ✅');
  problemsOf(W, problems);
  await context.close();
});

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(PORT, '127.0.0.1', resolve); });
  const browser = await chromium.launch();
  const started = Date.now();
  try {
    if (!FLOWS_ONLY) {
      await i18nCheck(browser);
      await routeSweep(browser);
    }
    if (!ROUTES_ONLY) {
      for (const [name, fn] of FLOWS) {
        console.log(`• flow ${name}`);
        try { await fn(browser); } catch (e) { fail(`flow ${name}`, e.stack || e.message); }
      }
    }
  } finally {
    await browser.close();
    httpServer.close();
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\nScreenshots: ${SHOTS}`);
  if (failures.length) {
    console.log(`\nFAILED — ${failures.length} problem(s) in ${checks} checks (${secs}s):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\nOK — ${checks} checks passed (${secs}s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
