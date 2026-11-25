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
  }
  for (const combo of combos) {
    const tag = `${combo.lang}-${combo.width}-${combo.theme}`;
    console.log(`• routes ${tag}`);
    const context = await newContext(browser, { ...combo, storage: { 'gft.me': LEAF } });
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
        title: document.title,
        textLen: (document.querySelector('#app')?.innerText || '').trim().length,
        rawKeys: [...(document.querySelector('#app')?.innerText || '').matchAll(/\b[a-z]+\.[a-zA-Z]+(?:\.[a-zA-Z0-9]+)+\b/g)].map((m) => m[0]).filter((s) => !/^(gtsgate|github|wa|api)\./.test(s) && !/\.(com|io|me|json|js|html|jpg|png)$/.test(s)),
      }));
      check(!state.error, where, 'error state rendered');
      check(!state.notFound, where, 'not-found rendered');
      check(state.lang === combo.lang && state.dir === (combo.lang === 'ar' ? 'rtl' : 'ltr'), where, `html lang/dir is ${state.lang}/${state.dir}`);
      check(state.theme === combo.theme, where, `theme is ${state.theme}`);
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
// 3. Flows (filled in below)
const FLOWS = [];

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
