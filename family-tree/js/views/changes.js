// Updates (#/changes): the changelog of approved proposals, newest first — bilingual summary lines, links to the
// people involved, undo entries and an empty state. See docs/SPEC.md §6.6 (changelog.json) and §7.2.
// Also exports the entry renderer used by the home page ("Recently added").
import { h, icon, bdi } from '../dom.js';
import { t, register, lang, otherLang, intlLocale } from '../i18n.js';
import { store } from '../store.js';
import { personChip, ownerName, spinner } from '../ui.js';
import { formatDate } from '../core/dates.js';

/** Element.append without the "null" text nodes it would create for skipped (null/false) children. */
const add = (el, ...kids) => el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

register({
  en: {
    'changes.title': 'Updates',
    'changes.lead': 'Every change approved by {owner}, newest first.',
    'changes.emptyTitle': 'No updates yet',
    'changes.emptyText': 'Approved changes will appear here, newest first. Every addition and correction by the family is listed with the people it concerns.',
    'changes.addFamily': 'Add my family',
    'changes.undoTitle': 'Update #{n} was undone',
    'changes.undoText': 'The records changed by that update were restored to how they were before.',
    'changes.approvedBy': 'Approved by {name}',
    'changes.proposedBy': 'Proposed by {name}',
    'changes.issue': 'Request #{n}',
    'changes.removal': 'Includes a removal',
    'changes.more': 'and {n} more changes',
    'changes.morePeople': '+{n}',
    'changes.showMore': 'Show older updates',
    'changes.count': '{n} updates',
    'changes.untitled': 'Changes to the tree',
  },
  ar: {
    'changes.title': 'آخر التحديثات',
    'changes.lead': 'كل تعديل وافق عليه {owner}، الأحدث أولاً.',
    'changes.emptyTitle': 'لا توجد تحديثات بعد',
    'changes.emptyText': 'ستظهر هنا التعديلات بعد الموافقة عليها، الأحدث أولاً، مع أسماء من تخصّهم كل إضافة أو تصحيح.',
    'changes.addFamily': 'إضافة عائلتي',
    'changes.undoTitle': 'أُلغي التحديث رقم {n}',
    'changes.undoText': 'أُعيدت السجلات التي غيّرها ذلك التحديث إلى ما كانت عليه.',
    'changes.approvedBy': 'وافق عليه {name}',
    'changes.proposedBy': 'اقترحه {name}',
    'changes.issue': 'الطلب رقم {n}',
    'changes.removal': 'يتضمّن حذفاً',
    'changes.more': 'و{n} تعديلات أخرى',
    'changes.morePeople': '+{n}',
    'changes.showMore': 'عرض التحديثات الأقدم',
    'changes.count': 'عدد التحديثات: {n}',
    'changes.untitled': 'تعديلات على الشجرة',
  },
});

register({
  en: Object.fromEntries(['zero', 'one', 'two', 'few', 'many', 'other'].map((c) => [`changes.n.${c}`, c === 'one' ? '{n} update' : '{n} updates'])),
  ar: {
    'changes.n.zero': 'لا تحديثات',
    'changes.n.one': 'تحديث واحد',
    'changes.n.two': 'تحديثان',
    'changes.n.few': '{n} تحديثات',
    'changes.n.many': '{n} تحديثاً',
    'changes.n.other': '{n} تحديث',
  },
});

/** "{n} updates" with the right plural form for the current language. */
function countText(n) {
  let cat = 'other';
  try { cat = new Intl.PluralRules(lang() === 'ar' ? 'ar' : 'en').select(n); } catch { cat = 'other'; }
  return t(`changes.n.${cat}`, { n });
}

const PAGE = 30;
let shown = PAGE; // module state: how many entries are visible (kept across re-renders)

/** Changelog entries newest first (empty array while the changelog is unknown). */
export function changelogEntries() {
  const list = Array.isArray(store.changelog?.entries) ? store.changelog.entries.filter((e) => e && typeof e === 'object') : [];
  return list.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

/** Entries of the last `days` days (newest first). */
export function recentEntries(days = 30, now = Date.now()) {
  const since = now - days * 864e5;
  return changelogEntries().filter((e) => {
    const ts = Date.parse(e.at || '');
    return Number.isFinite(ts) && ts >= since;
  });
}

function dateText(at) {
  if (!at || typeof at !== 'string') return '';
  try { return formatDate(at.slice(0, 10), lang()) || ''; } catch { return ''; }
}

function personName(x) {
  if (!x) return '';
  if (typeof x === 'string') return x;
  return String(x.name || x.login || '').trim();
}

function findPerson(id) {
  if (typeof id !== 'string' || !id) return null;
  const g = store.working;
  let p = g.person(id);
  if (!p && g.resolve) {
    try { p = g.resolve(id); } catch { p = null; }
    if (p && p.removed) p = null;
  }
  return p || null;
}

function summaryLines(entry) {
  const s = entry.summary || {};
  const own = Array.isArray(s[lang()]) ? s[lang()] : [];
  const other = Array.isArray(s[otherLang()]) ? s[otherLang()] : [];
  const lines = (own.length ? own : other).filter((x) => typeof x === 'string' && x.trim());
  if (lines.length) return lines;
  return [typeof entry.title === 'string' && entry.title.trim() ? entry.title.replace(/^[^\p{L}\p{N}]+/u, '') : t('changes.untitled')];
}

/**
 * One changelog entry as an <article>.
 *   compact: fewer lines/people (home page).
 */
export function changeEntry(entry, { compact = false } = {}) {
  const isUndo = entry.action === 'undo';
  const when = dateText(entry.at);
  const time = when ? h('time', { class: 'changes-date', datetime: String(entry.at || '') }, when) : null;

  if (isUndo) {
    return h('article', { class: 'changes-entry changes-entry-undo' },
      h('span', { class: 'changes-dot', attrs: { 'aria-hidden': 'true' } }, icon('restore', { size: 16 })),
      h('div', { class: 'changes-body' },
        h('div', { class: 'changes-head' },
          h('h3', { class: 'changes-title' }, t('changes.undoTitle', { n: Number(entry.issue) || 0 })),
          time),
        compact ? null : h('p', { class: 'muted small' }, t('changes.undoText'))));
  }

  const lines = summaryLines(entry);
  const maxLines = compact ? 3 : 12;
  const rest = lines.length - maxLines;
  const ids = Array.isArray(entry.people) ? entry.people : [];
  const people = [];
  const seen = new Set();
  for (const id of ids) {
    const p = findPerson(id);
    if (p && !seen.has(p.id)) { seen.add(p.id); people.push(p); }
  }
  const maxPeople = compact ? 4 : 16;
  const submitter = personName(entry.submitter);
  const approver = personName(entry.approvedBy);
  const issue = Number(entry.issue);
  const lineLang = Array.isArray(entry.summary?.[lang()]) && entry.summary[lang()].length ? lang() : otherLang();

  return h('article', { class: ['changes-entry', entry.destructive ? 'is-destructive' : ''] },
    h('span', { class: 'changes-dot', attrs: { 'aria-hidden': 'true' } }, icon(entry.destructive ? 'flag' : 'check', { size: 16 })),
    h('div', { class: 'changes-body' },
      h('div', { class: 'changes-head' },
        time,
        entry.destructive ? h('span', { class: 'badge badge-needs-info' }, t('changes.removal')) : null),
      h('ul', { class: 'changes-lines', lang: lineLang, dir: lineLang === 'ar' ? 'rtl' : 'ltr' },
        lines.slice(0, maxLines).map((line) => h('li', null, bdi(line)))),
      rest > 0 ? h('p', { class: 'changes-more muted small' }, t('changes.more', { n: rest })) : null,
      people.length
        ? h('div', { class: 'changes-people chips' },
          people.slice(0, maxPeople).map((p) => personChip(p, { years: false })),
          people.length > maxPeople ? h('span', { class: 'chip changes-more-chip' }, t('changes.morePeople', { n: people.length - maxPeople })) : null)
        : null,
      compact ? null : h('p', { class: 'changes-meta muted small' },
        submitter ? h('span', null, t('changes.proposedBy', { name: '' }), bdi(submitter)) : null,
        submitter && approver ? h('span', { attrs: { 'aria-hidden': 'true' } }, ' · ') : null,
        approver ? h('span', null, t('changes.approvedBy', { name: '' }), bdi(approver)) : null,
        (submitter || approver) && Number.isFinite(issue) && issue > 0 ? h('span', { attrs: { 'aria-hidden': 'true' } }, ' · ') : null,
        Number.isFinite(issue) && issue > 0 && store.config?.repo
          ? h('a', { href: store.repoUrl(`/issues/${issue}`), target: '_blank', rel: 'noopener' }, t('changes.issue', { n: issue }))
          : null)));
}

/** Group entries by calendar month → [{key, label, entries}] */
function byMonth(entries) {
  const groups = [];
  let fmt = null;
  try {
    fmt = new Intl.DateTimeFormat(intlLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch { fmt = null; }
  for (const e of entries) {
    const d = new Date(e.at || '');
    const key = Number.isFinite(d.getTime()) ? `${d.getUTCFullYear()}-${d.getUTCMonth()}` : 'unknown';
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: key === 'unknown' || !fmt ? '' : fmt.format(d), entries: [] };
      groups.push(g);
    }
    g.entries.push(e);
  }
  return groups;
}

function render(root) {
  const head = h('header', { class: 'page-head changes-head-block' },
    h('h1', null, t('changes.title')),
    h('p', { class: 'lead' }, t('changes.lead', { owner: ownerName() })));

  if (!store.changelog) {
    add(root, head, spinner());
    store.loadChangelog().then(() => { if (root.isConnected) { root.replaceChildren(); render(root); } }).catch(() => {});
    return;
  }

  const entries = changelogEntries();
  if (!entries.length) {
    add(root, head, h('div', { class: 'card changes-empty' },
      h('div', { class: 'empty-state' },
        h('h2', null, t('changes.emptyTitle')),
        h('p', { class: 'muted' }, t('changes.emptyText')),
        h('a', { class: 'btn btn-primary', href: '#/add-family' }, icon('plus'), t('changes.addFamily')))));
    return;
  }

  const visible = entries.slice(0, shown);
  const timeline = h('div', { class: 'changes-timeline' },
    byMonth(visible).map((g) => h('section', { class: 'changes-month', attrs: { 'aria-label': g.label || null } },
      g.label ? h('h2', { class: 'changes-month-title' }, g.label) : null,
      h('div', { class: 'changes-list' }, g.entries.map((e) => changeEntry(e))))));

  add(root, head,
    h('p', { class: 'changes-count muted small' }, countText(entries.length)),
    timeline,
    entries.length > shown
      ? h('div', { class: 'changes-more-row' }, h('button', {
        type: 'button', class: 'btn',
        on: { click: () => { shown += PAGE; root.replaceChildren(); render(root); } },
      }, icon('chevronDown'), t('changes.showMore')))
      : null);
}

export default {
  title: () => t('changes.title'),
  render(root) {
    render(root);
  },
};

