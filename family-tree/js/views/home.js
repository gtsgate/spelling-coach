// Home page (#/): the owner's welcome, a big search, the two primary actions (explore the tree / add my family),
// "Who are you?" (or a personal greeting with relation hints), "Help complete the tree", recent updates from the
// changelog, family branches, statistics and the date of the last update. See docs/SPEC.md §7.2.
// Also exports the "help complete the tree" helpers used by #/me.
import { h, icon, bdi, toast } from '../dom.js';
import { t, register, lang, bi, fmtNumber } from '../i18n.js';
import { store } from '../store.js';
import { nameOf, lineageOf, avatar, nameLabel, whatsappUrl, ownerName, sectionTitle, badges } from '../ui.js';
import { personPicker } from '../forms/picker.js';
import { yearOf, formatDate } from '../core/dates.js';
import { recentEntries, changeEntry } from './changes.js';
import { relationSentence } from './relationship.js';

/** Element.append without the "null" text nodes it would create for skipped (null/false) children. */
const add = (el, ...kids) => el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

// Plural-aware strings: keys `<base>.<category>` for every Intl.PluralRules category, in both languages.
const CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];
function pluralBundle(base, en, ar) {
  const out = { en: {}, ar: {} };
  for (const c of CATS) {
    out.en[`${base}.${c}`] = c === 'one' ? en[0] : en[1];
    out.ar[`${base}.${c}`] = ar[c] ?? ar.other;
  }
  return out;
}
const pluralRules = {};
export function plural(base, n) {
  const l = lang();
  let cat = 'other';
  try { cat = (pluralRules[l] ||= new Intl.PluralRules(l === 'ar' ? 'ar' : 'en')).select(n); } catch { cat = 'other'; }
  return t(`${base}.${cat}`, { n });
}
function registerPlurals(...bundles) {
  for (const b of bundles) register(b);
}

register({
  en: {
    'home.title': 'Home',
    'home.eyebrow': 'Family record',
    'home.welcomeFrom': 'A word from {owner}',
    'home.signature': '— {owner}',
    'home.meetOwner': 'Get to know me',
    'home.searchLabel': 'Search the family',
    'home.searchPlaceholder': 'Search for a name…',
    'home.searchBtn': 'Search',
    'home.explore': 'Explore the tree',
    'home.addFamily': 'Add my family',
    'home.whoTitle': 'Who are you?',
    'home.whoText': 'Once your name is chosen from the tree, every page shows how each person is related to you. The choice stays on this device only.',
    'home.whoLabel': 'Your name in the tree',
    'home.whoMissing': 'Not in the tree yet?',
    'home.whoAdd': 'Add yourself and your family',
    'home.meSet': 'Welcome, {name}! Relations are now shown from your point of view.',
    'home.welcomeBack': 'Welcome back, {name}',
    'home.notMe': 'Not me',
    'home.change': 'Change',
    'home.myPage': 'My page',
    'home.howRelated': 'How are we related?',
    'home.helpTitle': 'Help complete the tree',
    'home.helpLeadMe': 'A few relatives close to you whose details are still missing. Anything you know helps.',
    'home.helpLead': 'Some details are still missing. Anything you know helps.',
    'home.helpEmpty': 'Nothing missing nearby — thank you!',
    'home.iKnow': 'I know this',
    'home.ask': 'Ask on WhatsApp',
    'home.gap.needsInfo': 'Details to confirm',
    'home.gap.birthYear': 'Birth year unknown',
    'home.gap.parents': 'Parents not recorded',
    'home.gap.children': 'Children not recorded',
    'home.gap.name': 'Name unknown',
    'home.askText': 'Hello! We are completing our family tree. Do you know anything about {name}? Missing: {missing}.\n{link}',
    'home.dialogsSoon': 'Editing opens on the person’s page.',
    'home.recentTitle': 'Recently added',
    'home.recentEmpty': 'No updates in the last 30 days.',
    'home.recentAll': 'All updates',
    'home.branchesTitle': 'Family branches',
    'home.branchOpen': 'Open this branch',
    'home.statsTitle': 'The family in numbers',
    'home.stat.people': 'People',
    'home.stat.generations': 'Generations',
    'home.stat.families': 'Families',
    'home.stat.branches': 'Branches',
    'home.updated': 'Last updated {date}',
    'home.revision': 'Version {n}',
    'home.pending': 'Your pending changes appear on the tree with a badge until they are approved.',
  },
  ar: {
    'home.title': 'الرئيسية',
    'home.eyebrow': 'سجلّ العائلة',
    'home.welcomeFrom': 'كلمة من {owner}',
    'home.signature': '— {owner}',
    'home.meetOwner': 'التعرّف إليّ',
    'home.searchLabel': 'البحث في العائلة',
    'home.searchPlaceholder': 'البحث عن اسم…',
    'home.searchBtn': 'بحث',
    'home.explore': 'استكشاف الشجرة',
    'home.addFamily': 'إضافة عائلتي',
    'home.whoTitle': 'من أنت؟',
    'home.whoText': 'باختيار اسمك من الشجرة، تُظهر كل صفحة صلة قرابة كل فرد بك. ويُحفظ هذا الاختيار على هذا الجهاز فقط.',
    'home.whoLabel': 'اسمك في الشجرة',
    'home.whoMissing': 'لا يظهر اسمك في الشجرة؟',
    'home.whoAdd': 'إضافة نفسك وعائلتك',
    'home.meSet': 'أهلاً بك يا {name}! تظهر صلات القرابة الآن بالنسبة إليك.',
    'home.welcomeBack': 'أهلاً بعودتك، {name}',
    'home.notMe': 'ليس أنا',
    'home.change': 'تغيير',
    'home.myPage': 'صفحتي',
    'home.howRelated': 'ما صلة القرابة؟',
    'home.helpTitle': 'المساعدة في إكمال الشجرة',
    'home.helpLeadMe': 'أقارب قريبون منك ما زالت بعض معلوماتهم ناقصة. كل معلومة لديك تساعد.',
    'home.helpLead': 'ما زالت بعض المعلومات ناقصة، وكل معلومة لديك تساعد.',
    'home.helpEmpty': 'لا توجد معلومات ناقصة بالقرب منك — شكراً لك!',
    'home.iKnow': 'لديّ المعلومة',
    'home.ask': 'السؤال عبر واتساب',
    'home.gap.needsInfo': 'معلومات بحاجة إلى تأكيد',
    'home.gap.birthYear': 'سنة الميلاد غير معروفة',
    'home.gap.parents': 'الوالدان غير مسجّلَين',
    'home.gap.children': 'الأبناء غير مسجّلين',
    'home.gap.name': 'الاسم غير معروف',
    'home.askText': 'السلام عليكم، نعمل على إكمال شجرة العائلة. هل لديك معلومات عن {name}؟ ينقصنا: {missing}.\n{link}',
    'home.dialogsSoon': 'يتمّ التعديل من صفحة الشخص.',
    'home.recentTitle': 'أُضيف مؤخراً',
    'home.recentEmpty': 'لا توجد تحديثات خلال الثلاثين يوماً الماضية.',
    'home.recentAll': 'كل التحديثات',
    'home.branchesTitle': 'فروع العائلة',
    'home.branchOpen': 'فتح هذا الفرع',
    'home.statsTitle': 'العائلة بالأرقام',
    'home.stat.people': 'الأفراد',
    'home.stat.generations': 'الأجيال',
    'home.stat.families': 'الأسر',
    'home.stat.branches': 'الفروع',
    'home.updated': 'آخر تحديث: {date}',
    'home.revision': 'الإصدار {n}',
    'home.pending': 'تظهر تعديلاتك المعلّقة في الشجرة مع علامة مميِّزة حتى تتمّ الموافقة عليها.',
  },
});

registerPlurals(
  pluralBundle('home.n.members', ['{n} person', '{n} people'],
    { zero: 'لا أحد', one: 'فرد واحد', two: 'فردان', few: '{n} أفراد', many: '{n} فرداً', other: '{n} فرد' }),
);

// ---------------------------------------------------------------------------------------------------------
// Dialogs (owned by the forms builder) — loaded on demand, with a friendly fallback while they are missing.

/** Call an export of forms/dialogs.js; falls back to opening the person's page. Resolves to a boolean. */
export async function openDialog(fn, personId, ...args) {
  let mod = null;
  try { mod = await import('../forms/dialogs.js'); } catch { mod = null; }
  if (mod && typeof mod[fn] === 'function') {
    try { return !!(await mod[fn](personId, ...args)); } catch (e) { console.error(e); return false; }
  }
  if (personId) location.hash = `#/p/${encodeURIComponent(personId)}`;
  toast(t('home.dialogsSoon'));
  return false;
}

// ---------------------------------------------------------------------------------------------------------
// "Help complete the tree"

function neighbours(graph, id) {
  const out = [];
  const push = (p) => { if (p && p.id) out.push(p.id); };
  for (const p of graph.parents(id) || []) push(p);
  for (const s of graph.spouses(id) || []) push(s.person);
  for (const c of graph.children(id) || []) push(c);
  const sib = graph.siblings(id) || {};
  for (const p of sib.full || []) push(p);
  for (const x of sib.half || []) push(x.person);
  for (const p of sib.unspecified || []) push(p);
  return out;
}

/** What is missing about a person (codes), most useful first. */
export function gapsOf(graph, p) {
  const gaps = [];
  if (p.nameStatus === 'unknown') gaps.push('name');
  if ((p.tags || []).includes('needs-info')) gaps.push('needsInfo');
  if (!(graph.parents(p.id) || []).length) gaps.push('parents');
  const by = yearOf(p.birth);
  if (by === null || by === undefined) gaps.push('birthYear');
  if (!(graph.children(p.id) || []).length && (p.deceased || (by && by <= 1975))) gaps.push('children');
  return gaps;
}

const GAP_WEIGHT = { name: 3, needsInfo: 3, parents: 2, children: 1, birthYear: 1 };

/**
 * Up to `limit` people near `startId` (or the root) with missing details: [{person, gaps, dist}].
 * Ranked by how much is missing, then by closeness.
 */
export function helpTasks(graph, startId, limit = 5) {
  const root = graph.meta?.rootPersonId;
  const start = (startId && graph.person(startId)) ? startId : (root && graph.person(root) ? root : graph.people()[0]?.id);
  if (!start) return [];
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length && dist.size < 400) {
    const id = queue.shift();
    for (const n of neighbours(graph, id)) {
      if (!dist.has(n)) { dist.set(n, dist.get(id) + 1); queue.push(n); }
    }
  }
  const rows = [];
  for (const [id, d] of dist) {
    if (id === store.me) continue;
    const p = graph.person(id);
    if (!p || p.nameStatus === 'withheld' || store.isCreated(id)) continue;
    const gaps = gapsOf(graph, p);
    if (!gaps.length) continue;
    const score = gaps.reduce((s, g) => s + (GAP_WEIGHT[g] || 0), 0);
    rows.push({ person: p, gaps, dist: d, score });
  }
  // Prefer people within a few steps; among those, the most incomplete first.
  rows.sort((a, b) => (Math.min(a.dist, 4) - Math.min(b.dist, 4)) * 2 + (b.score - a.score) || a.dist - b.dist);
  return rows.slice(0, limit);
}

function askText(p, gaps) {
  const missing = gaps.map((g) => t(`home.gap.${g}`)).join(lang() === 'ar' ? '، ' : ', ');
  return t('home.askText', { name: lineageOf(p), missing, link: store.siteLink(`#/p/${encodeURIComponent(p.id)}`) });
}

/** "I know this": open the dialog that fills the most important gap (parents / children → add them; else correct info). */
function knowThis(p, gaps) {
  const first = gaps[0];
  if (first === 'parents') return openDialog('openAddRelative', p.id, 'parent');
  if (first === 'children') return openDialog('openAddRelative', p.id, 'child');
  return openDialog('openEditPerson', p.id);
}

/** The "help complete the tree" list (cards with "I know this" / "Ask on WhatsApp"). */
export function helpList(graph, startId, { limit = 5 } = {}) {
  const tasks = helpTasks(graph, startId, limit);
  if (!tasks.length) {
    return h('p', { class: 'home-help-empty muted' }, icon('check', { size: 18 }), h('span', null, t('home.helpEmpty')));
  }
  return h('ul', { class: 'home-help-list' }, tasks.map(({ person: p, gaps }) => h('li', { class: 'home-help-item' },
    h('a', { class: 'home-help-person', href: `#/p/${encodeURIComponent(p.id)}` },
      avatar(p),
      h('span', { class: 'home-help-text' },
        nameLabel(p, { other: false }),
        lineageOf(p) !== nameOf(p) ? bdi(lineageOf(p), { class: 'home-help-lineage muted small' }) : null)),
    h('div', { class: 'home-help-gaps' }, gaps.slice(0, 3).map((g) => h('span', { class: `home-gap home-gap-${g}` }, t(`home.gap.${g}`)))),
    h('div', { class: 'home-help-actions' },
      h('button', {
        type: 'button', class: 'btn btn-sm btn-primary',
        on: { click: () => knowThis(p, gaps) },
      }, icon('edit', { size: 16 }), t('home.iKnow')),
      h('a', {
        class: 'btn btn-sm home-wa', href: whatsappUrl(askText(p, gaps)), target: '_blank', rel: 'noopener',
      }, icon('whatsapp', { size: 16 }), t('home.ask'))))));
}

// ---------------------------------------------------------------------------------------------------------
// Sections

function hero() {
  const meta = store.data?.meta || {};
  const owner = store.config?.owner || {};
  const welcome = bi(owner.welcome);
  const ownerPerson = owner.personId ? store.working.person(owner.personId) : null;

  const picker = personPicker({
    placeholder: t('home.searchPlaceholder'),
    onPick: (p) => { location.hash = `#/p/${encodeURIComponent(p.id)}`; },
    near: store.me || null,
  });
  const input = picker.querySelector('input');
  input?.classList.add('input-lg');
  input?.setAttribute('aria-label', t('home.searchLabel'));
  input?.setAttribute('enterkeyhint', 'search');

  const form = h('form', {
    class: 'home-search', role: 'search',
    on: {
      submit: (e) => {
        e.preventDefault();
        const q = picker.value.trim();
        location.hash = q ? `#/search?q=${encodeURIComponent(q)}` : '#/search';
      },
    },
  }, picker, h('button', { type: 'submit', class: 'btn btn-primary home-search-btn' }, icon('search'), h('span', null, t('home.searchBtn'))));

  return h('section', { class: 'home-hero', attrs: { 'aria-labelledby': 'home-title' } },
    h('div', { class: 'home-hero-inner' },
      h('p', { class: 'home-eyebrow' }, h('span', null, t('home.eyebrow'))),
      h('h1', { id: 'home-title', class: 'home-title' }, bi(meta.title) || t('app.title')),
      h('p', { class: 'home-tagline' }, t('app.tagline')),
      welcome ? h('figure', { class: 'home-welcome' },
        h('blockquote', { class: 'home-welcome-text' }, h('p', null, welcome)),
        h('figcaption', { class: 'home-welcome-by' },
          ownerPerson ? avatar(ownerPerson, { size: 'sm' }) : null,
          h('span', null, t('home.signature', { owner: ownerName() })),
          ownerPerson ? h('a', { class: 'home-meet', href: `#/p/${encodeURIComponent(ownerPerson.id)}` }, t('home.meetOwner'), icon('chevronEnd', { size: 16, className: 'flip-rtl' })) : null))
        : null,
      form,
      h('div', { class: 'home-cta' },
        h('a', { class: 'btn btn-primary btn-lg', href: store.me ? `#/tree/${encodeURIComponent(store.me)}` : '#/tree' }, icon('tree', { size: 20 }), t('home.explore')),
        h('a', { class: 'btn btn-lg home-cta-add', href: store.me ? `#/add-family?near=${encodeURIComponent(store.me)}` : '#/add-family' }, icon('plus', { size: 20 }), t('home.addFamily')))));
}

function whoCard() {
  const graph = store.working;
  const me = store.me ? graph.person(store.me) : null;
  if (!me) {
    const picker = personPicker({
      label: t('home.whoLabel'),
      onPick: (p) => {
        store.setMe(p.id);
        toast(t('home.meSet', { name: nameOf(p) }), { type: 'success' });
      },
    });
    return h('section', { class: 'card card-accent home-who', attrs: { 'aria-labelledby': 'home-who-title' } },
      h('div', { class: 'home-who-intro' },
        h('span', { class: 'home-who-icon', attrs: { 'aria-hidden': 'true' } }, icon('user', { size: 26 })),
        h('div', null,
          h('h2', { id: 'home-who-title' }, t('home.whoTitle')),
          h('p', { class: 'muted' }, t('home.whoText')))),
      picker,
      h('p', { class: 'home-who-missing small' },
        h('span', { class: 'muted' }, t('home.whoMissing')), ' ',
        h('a', { href: '#/add-family' }, t('home.whoAdd'))));
  }

  const hints = [];
  const root = graph.meta?.rootPersonId;
  const ownerId = store.config?.owner?.personId;
  for (const id of [ownerId, root]) {
    if (!id || id === me.id || !graph.person(id) || hints.some((x) => x.id === id)) continue;
    const s = relationSentence(graph, me.id, id, { you: true });
    if (s.text && s.type !== 'none' && s.type !== 'self') hints.push({ id, text: s.text, person: graph.person(id) });
  }

  return h('section', { class: 'card card-accent home-who is-me', attrs: { 'aria-labelledby': 'home-who-title' } },
    h('div', { class: 'home-me' },
      avatar(me, { size: 'lg' }),
      h('div', { class: 'home-me-text' },
        h('h2', { id: 'home-who-title' }, t('home.welcomeBack', { name: '' }), bdi(nameOf(me), { class: 'home-me-name' })),
        lineageOf(me) !== nameOf(me) ? bdi(lineageOf(me), { class: 'muted home-me-lineage' }) : null,
        h('div', { class: 'home-me-badges' }, ...badges(me).filter((b) => !b.classList.contains('badge-me'))))),
    hints.length ? h('ul', { class: 'home-hints' }, hints.map((x) => h('li', null,
      h('a', { href: `#/relationship/${encodeURIComponent(me.id)}/${encodeURIComponent(x.id)}` },
        avatar(x.person, { size: 'sm' }), bdi(x.text))))) : null,
    h('div', { class: 'home-me-actions row' },
      h('a', { class: 'btn btn-sm', href: '#/me' }, icon('user', { size: 16 }), t('home.myPage')),
      h('a', { class: 'btn btn-sm', href: `#/relationship/${encodeURIComponent(me.id)}` }, icon('users', { size: 16 }), t('home.howRelated')),
      h('a', { class: 'btn btn-sm btn-ghost', href: '#/me' }, t('home.change')),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => store.setMe(null) } }, t('home.notMe'))));
}

function helpCard() {
  const graph = store.working;
  const near = store.me && graph.person(store.me) ? store.me : null;
  return h('section', { class: 'card home-help', attrs: { 'aria-labelledby': 'home-help-title' } },
    h('div', { class: 'card-header' }, h('h2', { id: 'home-help-title' }, t('home.helpTitle'))),
    h('p', { class: 'muted small home-help-lead' }, near ? t('home.helpLeadMe') : t('home.helpLead')),
    helpList(graph, near));
}

function statsCard() {
  const graph = store.working;
  let s = {};
  try { s = graph.stats(); } catch { s = {}; }
  const meta = store.data?.meta || {};
  let updated = '';
  if (meta.updatedAt) {
    try { updated = formatDate(String(meta.updatedAt).slice(0, 10), lang()); } catch { updated = ''; }
  }
  const tile = (n, key, ic) => h('div', { class: 'home-stat' },
    h('span', { class: 'home-stat-icon', attrs: { 'aria-hidden': 'true' } }, icon(ic, { size: 18 })),
    h('span', { class: 'home-stat-num' }, fmtNumber(Number(n) || 0)),
    h('span', { class: 'home-stat-label' }, t(key)));
  return h('section', { class: 'card home-stats', attrs: { 'aria-labelledby': 'home-stats-title' } },
    h('div', { class: 'card-header' }, h('h2', { id: 'home-stats-title' }, t('home.statsTitle'))),
    h('div', { class: 'home-stat-grid' },
      tile(s.people, 'home.stat.people', 'users'),
      tile(s.generations, 'home.stat.generations', 'tree'),
      tile(s.unions, 'home.stat.families', 'heart'),
      tile(s.branches, 'home.stat.branches', 'chart')),
    updated ? h('p', { class: 'home-updated muted small' }, icon('calendar', { size: 16 }), h('span', null, t('home.updated', { date: updated }))) : null,
    store.sent.length || store.draft.ops.length ? h('p', { class: 'home-pending-note small muted' }, t('home.pending')) : null);
}

function branchesSection() {
  let list = [];
  try { list = store.working.branches() || []; } catch { list = []; }
  if (!list.length) return null;
  return h('section', { class: 'home-branches', attrs: { 'aria-labelledby': 'home-branches-title' } },
    h('div', { class: 'section-title' }, h('h2', { id: 'home-branches-title' }, t('home.branchesTitle'))),
    h('div', { class: 'home-branch-grid' }, list.map((b) => h('a', { class: 'card home-branch', href: `#/tree/${encodeURIComponent(b.person.id)}` },
      h('span', { class: 'home-branch-avatars', attrs: { 'aria-hidden': 'true' } },
        avatar(b.person), b.partner ? avatar(b.partner) : null),
      h('span', { class: 'home-branch-text' },
        bdi(bi(b.label) || nameOf(b.person), { class: 'home-branch-name' }),
        h('span', { class: 'home-branch-count muted small' }, plural('home.n.members', Number(b.count) || 0))),
      h('span', { class: 'home-branch-go', attrs: { 'aria-hidden': 'true' } }, icon('chevronEnd', { size: 20, className: 'flip-rtl' })),
      h('span', { class: 'sr-only' }, t('home.branchOpen'))))));
}

function recentSection() {
  const entries = store.changelog ? recentEntries(30).slice(0, 5) : [];
  return h('section', { class: 'home-recent', attrs: { 'aria-labelledby': 'home-recent-title' } },
    sectionTitle(t('home.recentTitle'), h('a', { class: 'btn btn-sm btn-ghost', href: '#/changes' }, t('home.recentAll'), icon('chevronEnd', { size: 16, className: 'flip-rtl' }))),
    entries.length
      ? h('div', { class: 'card home-recent-list changes-list' }, entries.map((e) => changeEntry(e, { compact: true })))
      : h('div', { class: 'card home-recent-empty' }, h('p', { class: 'muted' }, icon('calendar', { size: 18 }), h('span', null, t('home.recentEmpty')))));
}

function render(root) {
  const recent = recentSection();
  recent.querySelector('.section-title h2')?.setAttribute('id', 'home-recent-title');
  add(root, 
    hero(),
    whoCard(),
    h('div', { class: 'home-grid' },
      helpCard(),
      statsCard()),
    branchesSection(),
    recent);
}

export default {
  title: () => '',
  render(root) {
    render(root);
  },
};

