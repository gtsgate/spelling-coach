// App shell: header / nav / footer, hash router, language + theme switching.
// Views live in js/views/*.js and export default { title(params, query), render(root, params, query) }.
import { h, icon, mount, clear, toast } from './dom.js';
import { t, lang, setLang, onLangChange, bi, applyToDocument, register } from './i18n.js';
import { store } from './store.js';

register({
  en: {
    'shell.unsent': ({ n }) => (n === 1 ? 'You have 1 unsent change' : `You have ${n} unsent changes`),
    'shell.send': 'Review & send',
    'shell.publishing': 'Publishing the latest update… this page will refresh by itself.',
    'shell.publishTimeout': 'The update is taking longer than usual to appear. Please check again in a few minutes.',
    'shell.approved': 'Good news — your changes were approved and are now on the tree.',
    'shell.textSize': 'Text size',
    'shell.me': 'My page',
    'shell.digits': 'Digits',
  },
  ar: {
    'shell.unsent': ({ n }) => (n === 1 ? 'لديك تعديل واحد لم يُرسل بعد'
      : n === 2 ? 'لديك تعديلان لم يُرسلا بعد'
        : n <= 10 ? `لديك ${n} تعديلات لم تُرسل بعد` : `لديك ${n} تعديلاً لم يُرسل بعد`),
    'shell.send': 'مراجعة وإرسال',
    'shell.publishing': 'جارٍ نشر التحديث الأخير… ستتحدّث الصفحة تلقائياً.',
    'shell.publishTimeout': 'يستغرق ظهور التحديث وقتاً أطول من المعتاد. يُرجى التحقق بعد دقائق.',
    'shell.approved': 'بشرى سارّة — تمت الموافقة على تعديلاتك وأصبحت ظاهرة في الشجرة.',
    'shell.textSize': 'حجم الخط',
    'shell.me': 'صفحتي',
    'shell.digits': 'الأرقام',
  },
});

// path pattern → module + param names. First match wins.
const ROUTES = [
  { pattern: [], module: './views/home.js', params: [] },
  { pattern: ['tree'], module: './views/tree.js', params: ['id'] },
  { pattern: ['p'], module: './views/person.js', params: ['id'] },
  { pattern: ['search'], module: './views/search.js', params: [] },
  { pattern: ['add-family'], module: './views/wizard.js', params: [] },
  { pattern: ['draft'], module: './views/draft.js', params: [] },
  { pattern: ['me'], module: './views/me.js', params: [] },
  { pattern: ['relationship'], module: './views/relationship.js', params: ['a', 'b'] },
  { pattern: ['changes'], module: './views/changes.js', params: [] },
  { pattern: ['about'], module: './views/about.js', params: [] },
  { pattern: ['admin'], module: './views/admin.js', params: [] },
  { pattern: ['preview'], module: './views/preview.js', params: ['issue'] },
];

const NAV = [
  { key: 'nav.home', hash: '#/', icon: 'home', match: '' },
  { key: 'nav.tree', hash: '#/tree', icon: 'tree', match: 'tree' },
  { key: 'nav.addFamily', hash: '#/add-family', icon: 'plus', match: 'add-family' },
  { key: 'nav.search', hash: '#/search', icon: 'search', match: 'search' },
  { key: 'nav.relationship', hash: '#/relationship', icon: 'users', match: 'relationship' },
  { key: 'nav.about', hash: '#/about', icon: 'info', match: 'about' },
];

/** Parse location.hash into {segments, params, query, route}. */
export function parseHash(hash = location.hash) {
  let raw = hash.replace(/^#\/?/, '');
  let qs = '';
  const qi = raw.indexOf('?');
  if (qi >= 0) { qs = raw.slice(qi + 1); raw = raw.slice(0, qi); }
  const segments = raw.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const route of ROUTES) {
    const n = route.pattern.length;
    if (segments.length < n) continue;
    if (route.pattern.every((p, i) => segments[i] === p) && (n > 0 || segments.length === 0)) {
      const rest = segments.slice(n);
      if (rest.length > route.params.length) continue;
      const params = {};
      route.params.forEach((name, i) => { params[name] = rest[i]; });
      return { route, segments, params, query };
    }
  }
  return { route: null, segments, params: {}, query };
}

/** Navigate programmatically. */
export function navigate(hash, { replace = false } = {}) {
  if (replace) { history.replaceState(null, '', hash); render(); }
  else if (location.hash === hash) render();
  else location.hash = hash;
}

let main;
let header;
let currentCleanup = null;
let renderSeq = 0;
let lastRouteKey = '';

function buildHeader() {
  const title = bi(store.data?.meta?.title) || t('app.title');
  const active = parseHash().segments[0] || '';
  const draftCount = store.draft.ops.length;
  const navLinks = NAV.map((n) => h('a', {
    href: n.hash,
    class: ['nav-link', active === n.match ? 'active' : ''],
    attrs: { 'aria-current': active === n.match ? 'page' : null },
  }, icon(n.icon, { size: 18 }), h('span', null, t(n.key))));

  const menuBtn = h('button', {
    type: 'button', class: 'btn-icon nav-toggle', attrs: { 'aria-label': t('nav.menu'), 'aria-expanded': 'false', 'aria-controls': 'main-nav' },
    on: {
      click: () => {
        const open = header.classList.toggle('nav-open');
        menuBtn.setAttribute('aria-expanded', String(open));
      },
    },
  }, icon('menu'));

  return [
    h('div', { class: 'header-inner' },
      menuBtn,
      h('a', { class: 'brand', href: '#/' },
        h('span', { class: 'brand-mark', attrs: { 'aria-hidden': 'true' } }, icon('tree', { size: 22 })),
        h('span', { class: 'brand-text' }, h('span', { class: 'brand-title' }, title), h('span', { class: 'brand-tagline' }, t('app.tagline')))),
      h('div', { class: 'header-actions' },
        draftCount
          ? h('a', { class: 'draft-pill', href: '#/draft', attrs: { 'aria-label': t('nav.draft') } }, icon('send', { size: 16 }), h('span', null, t('draft.badge', { n: draftCount })))
          : null,
        store.me
          ? h('a', { class: 'btn-icon me-link', href: '#/me', attrs: { 'aria-label': t('shell.me'), title: t('shell.me') } }, icon('user'))
          : null,
        h('button', {
          type: 'button', class: 'btn-icon text-size-toggle', attrs: { 'aria-label': t('shell.textSize'), title: t('shell.textSize') },
          on: { click: cycleTextSize },
        }, h('span', { class: 'text-size-glyph', attrs: { 'aria-hidden': 'true' } }, textSizeGlyph())),
        h('button', {
          type: 'button', class: 'btn-icon theme-toggle', attrs: { 'aria-label': t('theme.toggle') },
          on: { click: toggleTheme },
        }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')),
        h('button', {
          type: 'button', class: 'lang-toggle', attrs: { 'aria-label': t('lang.switchLabel'), lang: lang() === 'ar' ? 'en' : 'ar' },
          on: { click: () => setLang(lang() === 'ar' ? 'en' : 'ar') },
        }, icon('globe', { size: 16 }), h('span', null, t('lang.switch'))))),
    h('nav', { id: 'main-nav', class: 'main-nav', attrs: { 'aria-label': t('nav.menu') } }, navLinks),
  ];
}

function buildFooter() {
  return h('div', { class: 'footer-inner' },
    h('p', null, t('footer.text')),
    h('p', { class: 'footer-links' },
      h('a', { href: '#/changes' }, t('nav.changes')),
      ' · ',
      h('a', { href: '#/about' }, t('nav.about')),
      ' · ',
      h('a', { href: store.repoUrl(), target: '_blank', rel: 'noopener' }, t('footer.source')),
      ' · ',
      h('a', { href: '#/admin', class: 'muted' }, t('nav.admin'))));
}

function refreshChrome() {
  mount(header, ...buildHeader());
  mount(document.getElementById('app-footer'), buildFooter());
  const banner = document.getElementById('demo-banner');
  if (banner) {
    banner.hidden = !store.data?.meta?.demo;
    banner.textContent = t('demo.banner');
  }
  const bar = document.getElementById('draft-bar');
  if (bar) {
    const n = store.draft.ops.length;
    const onDraft = (parseHash().segments[0] || '') === 'draft';
    bar.hidden = !n || onDraft;
    document.body.classList.toggle('has-draft-bar', !!n && !onDraft);
    if (n && !onDraft) {
      mount(bar, h('div', { class: 'draft-bar-inner' },
        icon('send', { size: 18 }),
        h('span', { class: 'draft-bar-text' }, t('shell.unsent', { n })),
        h('a', { class: 'btn btn-primary btn-sm', href: '#/draft' }, t('shell.send'))));
    } else clear(bar);
  }
}

// ---------------------------------------------------------------------------
// Text size (A / A+ / A++) for older eyes
const SIZE_KEY = 'gft.textSize';
const SIZES = ['md', 'lg', 'xl'];
function initTextSize() {
  let s = null;
  try { s = localStorage.getItem(SIZE_KEY); } catch { /* ignore */ }
  document.documentElement.dataset.textSize = SIZES.includes(s) ? s : 'md';
}
function textSizeGlyph() {
  const s = document.documentElement.dataset.textSize || 'md';
  return s === 'md' ? 'A' : s === 'lg' ? 'A+' : 'A++';
}
function cycleTextSize() {
  const cur = document.documentElement.dataset.textSize || 'md';
  const next = SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length];
  document.documentElement.dataset.textSize = next;
  try { localStorage.setItem(SIZE_KEY, next); } catch { /* ignore */ }
  refreshChrome();
}

// ---------------------------------------------------------------------------
// "?rev=N" — the owner/relative followed a link to a just-approved change that GitHub Pages may not serve yet.
let publishTimer = null;
function watchRevision(query) {
  const want = Number(query.rev);
  const have = store.data?.meta?.revision ?? 0;
  const note = document.getElementById('publish-note');
  if (!Number.isFinite(want) || want <= have) {
    if (note) note.hidden = true;
    if (publishTimer) { clearInterval(publishTimer); publishTimer = null; }
    return;
  }
  if (note) { note.hidden = false; note.textContent = t('shell.publishing'); }
  if (publishTimer) return;
  const started = Date.now();
  publishTimer = setInterval(async () => {
    if (Date.now() - started > 5 * 60 * 1000) {
      clearInterval(publishTimer); publishTimer = null;
      if (note) note.textContent = t('shell.publishTimeout');
      return;
    }
    try {
      const rev = await store.refreshData();
      if (rev >= want) { clearInterval(publishTimer); publishTimer = null; if (note) note.hidden = true; }
    } catch { /* keep polling */ }
  }, 20000);
}

async function render() {
  const seq = ++renderSeq;
  const parsed = parseHash();
  const routeKey = location.hash;
  refreshChrome();
  header.classList.remove('nav-open');
  watchRevision(parsed.query);

  if (currentCleanup) { try { currentCleanup(); } catch (e) { console.error(e); } currentCleanup = null; }

  if (!parsed.route) {
    mount(main, notFound());
    document.title = `${t('common.notFound')} · ${t('app.title')}`;
    return;
  }

  let mod;
  try {
    mod = (await import(parsed.route.module)).default;
  } catch (e) {
    console.error(e);
    if (seq !== renderSeq) return;
    mount(main, errorBox(e));
    return;
  }
  if (seq !== renderSeq) return; // a newer navigation started

  const section = h('section', { class: `view view-${parsed.segments[0] || 'home'}` });
  clear(main);
  main.appendChild(section);
  try {
    const cleanup = mod.render(section, parsed.params, parsed.query);
    if (typeof cleanup === 'function') currentCleanup = cleanup;
    const title = mod.title ? mod.title(parsed.params, parsed.query) : '';
    const siteTitle = bi(store.data?.meta?.title) || t('app.title');
    document.title = title ? `${title} · ${siteTitle}` : siteTitle;
  } catch (e) {
    console.error(e);
    mount(main, errorBox(e));
  }
  if (routeKey !== lastRouteKey) {
    const firstRender = lastRouteKey === '';
    lastRouteKey = routeKey;
    window.scrollTo(0, 0);
    // Move focus to the main region for screen-reader users on navigation — but not on the initial
    // page load, so the first Tab still reaches the skip link and the header.
    if (!firstRender) main.focus({ preventScroll: true });
  }
}

function notFound() {
  return h('div', { class: 'empty-state' },
    h('h1', null, t('common.notFound')),
    h('p', null, h('a', { href: '#/' }, t('common.goHome'))));
}

function errorBox(e) {
  return h('div', { class: 'empty-state error-state', attrs: { role: 'alert' } },
    h('h1', null, t('common.error')),
    h('p', { class: 'muted' }, String(e && e.message ? e.message : e)),
    h('p', null, h('button', { type: 'button', class: 'btn', on: { click: () => location.reload() } }, t('common.retry'))));
}

// ---------------------------------------------------------------------------
// Theme
const THEME_KEY = 'gft.theme';
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  else if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
  else document.documentElement.dataset.theme = 'light';
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  refreshChrome();
}

// ---------------------------------------------------------------------------
async function boot() {
  initTheme();
  initTextSize();
  applyToDocument();
  header = document.getElementById('app-header');
  main = document.getElementById('app');
  try {
    await store.init();
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('div', { class: 'empty-state error-state', attrs: { role: 'alert' } },
      h('h1', null, t('common.error')),
      h('p', null, t('error.load')),
      h('p', { class: 'muted' }, String(e.message || e)),
      h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => location.reload() } }, t('common.retry'))));
    return;
  }
  document.body.classList.remove('booting');
  window.addEventListener('hashchange', render);
  onLangChange(render);
  store.on('draft', render);
  store.on('data', render);
  store.on('me', render);
  store.on('sent', render);
  await render();
  if (store.justApproved.length) {
    toast(t('shell.approved'), { type: 'success', timeout: 9000, action: { label: t('nav.changes'), href: '#/changes' } });
    store.justApproved = [];
  }
}

boot();
