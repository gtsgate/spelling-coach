// Interactive family tree — #/tree/:id?  ?view=chart|list & dir=down|up & focus=<pid>   (docs/SPEC.md §7.6)
//
//   * Descendants chart (dir=down): each blood descendant is a card with their spouse cards beside it (spouseOrder);
//     every union's children hang under that union with orthogonal SVG connectors. Tidy layout from subtree widths.
//     A spouse's other marriages show as a small "also married to …" link (blood-only descent). A person reachable
//     twice (cousin marriage) is drawn once; the other occurrence is a compact card that jumps to the first.
//   * Ancestors chart (dir=up): pedigree upwards (parents above, then theirs…), same cards.
//   * Outline list (view=list): nested role="tree" with keyboard navigation; only expanded people are rendered.
//   * Pan (drag / touch), zoom (wheel around the cursor, pinch, buttons), keyboard (arrows, + / −, 0 = fit).
//   * Collapsible nodes (hidden-descendant counts), default depth = config.treeDefaultDepth, "expand all" capped at
//     600 people, "paternal line only" toggle, ?focus=<pid> expands the path and centres that person.
// UI state (pan/zoom/expanded per root+direction, paternal toggle) lives in module variables so re-renders
// (language switch, draft changes) keep the view exactly where it was.
import { h, icon, bdi, toast } from '../dom.js';
import { t, register, lang, dir as textDir, fmtNumber, bi } from '../i18n.js';
import { store } from '../store.js';
import { nameOf, nameLabel, avatar, badges, yearsOf, lineageOf, emptyState } from '../ui.js';

register({
  en: {
    'tree.title': 'Family tree',
    'tree.familyOf': 'The family of {name}',
    'tree.ancestorsOf': 'The ancestors of {name}',
    'tree.branch': 'Branch',
    'tree.branchCurrent': 'Shown now: {name}',
    'tree.branchCount': '{name} ({n})',
    'tree.view': 'Display',
    'tree.viewChart': 'Chart',
    'tree.viewList': 'List',
    'tree.direction': 'Direction',
    'tree.down': 'Descendants',
    'tree.up': 'Ancestors',
    'tree.paternal': 'Paternal line only',
    'tree.expandAll': 'Expand all',
    'tree.collapseAll': 'Collapse all',
    'tree.capped': 'Showing {n} people so the tree stays fast. Larger branches stay folded — open them one at a time.',
    'tree.zoomIn': 'Zoom in',
    'tree.zoomOut': 'Zoom out',
    'tree.fit': 'Fit the whole tree on screen',
    'tree.center': 'Back to {name}',
    'tree.chartLabel': 'Family tree chart. Drag to move around; use the zoom buttons, the mouse wheel or the + and − keys to zoom; arrow keys move the view.',
    'tree.chartHint': 'Drag to move · wheel or pinch to zoom · tap a person for options',
    'tree.listLabel': 'Family tree outline',
    'tree.expandNode': 'Show the family of {name}',
    'tree.expandNodeUp': 'Show the parents of {name}',
    'tree.collapseNode': 'Fold the family of {name}',
    'tree.collapseNodeUp': 'Fold the parents of {name}',
    'tree.hidden': ({ n }) => (n === 1 ? '1 more person' : `${fmtNumber(n)} more people`),
    'tree.alsoMarried': 'Also married to',
    'tree.otherChildren': 'Other children',
    'tree.kids': ({ n }) => (n === 1 ? '1 child' : `${fmtNumber(n)} children`),
    'tree.moreMarriages': '+{n} more',
    'tree.elsewhere': 'Also appears elsewhere in the tree',
    'tree.goThere': 'Go there',
    'tree.childrenWith': 'Children with {name}',
    'tree.childrenNoPartner': 'Children (other parent not recorded)',
    'tree.childrenUnder': 'Their children are listed under {name}',
    'tree.marriedTo': 'Married to {names}',
    'tree.openProfile': 'Open profile',
    'tree.focusHere': 'Show the tree from here',
    'tree.showAncestors': 'Show ancestors',
    'tree.showDescendants': 'Show descendants',
    'tree.addChild': 'Add a child',
    'tree.addSpouse': 'Add a spouse',
    'tree.addParent': 'Add a parent',
    'tree.howRelated': 'How are we related?',
    'tree.unavailable': 'This option is not available yet. The profile page has more options.',
    'tree.noChildren': 'No children of {name} are recorded yet.',
    'tree.noParents': 'The parents of {name} are not recorded yet.',
    'tree.empty': 'The tree has no people yet.',
    'tree.root': 'Starting person',
    'tree.pending.draft': 'not sent yet',
    'tree.pending.sent': 'awaiting approval',
  },
  ar: {
    'tree.title': 'شجرة العائلة',
    'tree.familyOf': 'عائلة {name}',
    'tree.ancestorsOf': 'آباء وأجداد {name}',
    'tree.branch': 'الفرع',
    'tree.branchCurrent': 'المعروض الآن: {name}',
    'tree.branchCount': '{name} ({n})',
    'tree.view': 'طريقة العرض',
    'tree.viewChart': 'مخطط',
    'tree.viewList': 'قائمة',
    'tree.direction': 'الاتجاه',
    'tree.down': 'الذرية',
    'tree.up': 'الأجداد',
    'tree.paternal': 'الخط الأبوي فقط',
    'tree.expandAll': 'توسيع الكل',
    'tree.collapseAll': 'طيّ الكل',
    'tree.capped': 'يُعرض {n} شخصاً حفاظاً على سرعة التصفّح، وتبقى الفروع الكبيرة مطويّة لفتحها واحداً تلو الآخر.',
    'tree.zoomIn': 'تكبير',
    'tree.zoomOut': 'تصغير',
    'tree.fit': 'عرض الشجرة كاملة على الشاشة',
    'tree.center': 'العودة إلى {name}',
    'tree.chartLabel': 'مخطط شجرة العائلة. السحب للتنقّل، وللتكبير والتصغير أزرار التكبير أو عجلة الفأرة أو مفتاحا + و −، ومفاتيح الأسهم لتحريك العرض.',
    'tree.chartHint': 'السحب للتنقّل · العجلة أو إصبعان للتكبير · لمسة على الاسم لعرض الخيارات',
    'tree.listLabel': 'قائمة شجرة العائلة',
    'tree.expandNode': 'إظهار عائلة {name}',
    'tree.expandNodeUp': 'إظهار والدَي {name}',
    'tree.collapseNode': 'طيّ عائلة {name}',
    'tree.collapseNodeUp': 'طيّ والدَي {name}',
    'tree.hidden': 'أفراد آخرون: {n}',
    'tree.alsoMarried': 'زواج آخر:',
    'tree.otherChildren': 'أبناء آخرون',
    'tree.kids': 'الأبناء: {n}',
    'tree.moreMarriages': '+{n}',
    'tree.elsewhere': 'يظهر أيضاً في موضع آخر من الشجرة',
    'tree.goThere': 'الانتقال إليه',
    'tree.childrenWith': 'الأبناء من {name}',
    'tree.childrenNoPartner': 'الأبناء (الطرف الآخر غير مسجّل)',
    'tree.childrenUnder': 'أبناؤهما مُدرجون تحت {name}',
    'tree.marriedTo': 'الزواج: {names}',
    'tree.openProfile': 'فتح الصفحة الشخصية',
    'tree.focusHere': 'عرض الشجرة من هنا',
    'tree.showAncestors': 'عرض الآباء والأجداد',
    'tree.showDescendants': 'عرض الأبناء والأحفاد',
    'tree.addChild': 'إضافة ابن أو ابنة',
    'tree.addSpouse': 'إضافة زوج أو زوجة',
    'tree.addParent': 'إضافة أب أو أم',
    'tree.howRelated': 'ما صلة القرابة بيننا؟',
    'tree.unavailable': 'هذا الخيار غير متاح بعد، وفي الصفحة الشخصية خيارات أخرى.',
    'tree.noChildren': 'لم يُسجَّل أبناء لـ{name} بعد.',
    'tree.noParents': 'لم يُسجَّل والدا {name} بعد.',
    'tree.empty': 'لا يوجد أفراد في الشجرة بعد.',
    'tree.root': 'نقطة البداية',
    'tree.pending.draft': 'لم يُرسل بعد',
    'tree.pending.sent': 'بانتظار الموافقة',
  },
});

// ---------------------------------------------------------------------------------------------------------
// Module state (survives re-renders)

const CAP = 600;                 // safety cap for automatic expansion ("expand all", default depth)
const MIN_SCALE = 0.12;
const MAX_SCALE = 2.5;
const PATERNAL_KEY = 'gft.tree.paternal';

/** key "<rootId>|<dir>" → { toggled: Map<id, bool>, mode, view: {s,cx,cy}|null, anchor, pendingFocus, … } */
const states = new Map();
let paternalOnly = readPaternal();
let lastFocusHash = null;
const countCache = new WeakMap(); // graph → Map("<dir><id>" → hidden count)

function readPaternal() {
  try { return localStorage.getItem(PATERNAL_KEY) === '1'; } catch { return false; }
}
function writePaternal(on) {
  try { localStorage.setItem(PATERNAL_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

function stateFor(rootId, dir) {
  const key = `${rootId}|${dir}`;
  let st = states.get(key);
  if (!st) {
    st = { key, toggled: new Map(), mode: 'default', view: null, anchor: null, pendingFocus: null, restoreFocus: null };
    states.set(key, st);
  }
  return st;
}

function treeHash(id, { view = null, dir = 'down', focus = null } = {}) {
  const q = new URLSearchParams();
  if (view) q.set('view', view);
  if (dir === 'up') q.set('dir', 'up');
  if (focus) q.set('focus', focus);
  const qs = q.toString();
  return `#/tree/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;
}

function defaultRootId(g) {
  const meta = g.meta || {};
  if (meta.rootPersonId && g.resolve(meta.rootPersonId)) return g.resolve(meta.rootPersonId).id;
  const b = g.branches()[0];
  if (b) return b.person.id;
  return g.people()[0]?.id || null;
}

function resolveRoot(g, params) {
  if (params.id) return g.resolve(params.id);
  const id = defaultRootId(g);
  return id ? g.person(id) : null;
}

function otherPartner(g, union, id) {
  for (const pid of union?.partners || []) {
    if (pid === id) continue;
    const p = g.person(pid);
    if (p) return p;
  }
  return null;
}

function hiddenCount(g, id, dir) {
  let m = countCache.get(g);
  if (!m) { m = new Map(); countCache.set(g, m); }
  const k = dir + id;
  if (!m.has(k)) m.set(k, dir === 'up' ? g.ancestors(id).size : g.descendants(id).size);
  return m.get(k);
}

/** Pre-order walk without recursion. */
function walk(root, fn) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    fn(n);
    const kids = [];
    for (const gr of n.groups) for (const c of gr.children) kids.push(c);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}

/** Expand every node on the blood path root → target (so ?focus / jumps can show it). */
function expandPathTo(g, rootId, targetId, dir, st) {
  if (rootId === targetId) return true;
  const prev = new Map([[rootId, null]]);
  const queue = [rootId];
  const next = (id) => (dir === 'up' ? g.parents(id).map((p) => p.id) : g.children(id).map((p) => p.id));
  let found = null;
  for (let i = 0; i < queue.length && !found; i++) {
    for (const c of next(queue[i])) {
      if (prev.has(c)) continue;
      prev.set(c, queue[i]);
      if (c === targetId) { found = c; break; }
      queue.push(c);
    }
  }
  if (!found && dir === 'down') {
    // A married-in spouse: open the path to their partner (whose couple block shows them).
    for (const { person } of g.spouses(targetId)) {
      if (prev.has(person.id) && person.id !== targetId) { found = person.id; break; }
    }
    if (!found) return false;
  }
  if (!found) return false;
  for (let x = prev.get(found); x; x = prev.get(x)) st.toggled.set(x, true);
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Visible structure: which people are shown (expanded nodes only), shared by the chart and the list.
//   node = { id, person, depth, ref (node drawn elsewhere) | null, unions, groups: [{union, spouse, sharedWith, children}],
//            hasKids, expanded, spouses: [{person, union, ref, refSpouse, also}] }

function buildVisible(g, rootP, dir, st) {
  const depthDefault = Math.max(1, Number(store.config?.treeDefaultDepth) || 3);
  const nodes = [];
  const blood = new Map();
  const placedBy = new Map();
  let count = 0;
  let capped = false;
  let maxDepth = 0;
  // Cards a person brings to the chart: themself plus one card per spouse (descendants view).
  const weight = (p) => (dir === 'down' ? 1 + g.unionsOf(p.id).filter((u) => otherPartner(g, u, p.id)).length : 1);
  const mk = (person, depth, ref = null) => {
    const n = { id: person.id, person, depth, ref, unions: [], groups: [], spouses: [], hasKids: false, expanded: false };
    nodes.push(n);
    count += ref ? 1 : weight(person);
    if (depth > maxDepth) maxDepth = depth;
    if (!ref) blood.set(person.id, n);
    return n;
  };
  const defaultOpen = (n) => {
    if (n.depth > 0 && paternalOnly && n.person.gender === 'f') return false;
    if (st.mode === 'all') return true;
    return n.depth < (st.mode === 'collapsed' ? 1 : depthDefault);
  };
  const root = mk(rootP, 0);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.ref) continue;
    let groups;
    if (dir === 'down') {
      n.unions = g.unionsOf(n.id).map((u) => ({ union: u, spouse: otherPartner(g, u, n.id), kids: g.childrenOfUnion(u.id) }));
      groups = n.unions.filter((x) => x.kids.length);
    } else {
      const ps = g.parents(n.id);
      groups = ps.length ? [{ union: g.birthUnion(n.id), spouse: null, kids: ps }] : [];
    }
    n.hasKids = groups.length > 0;
    if (!n.hasKids) continue;
    const tog = st.toggled.get(n.id);
    if (!(tog !== undefined ? tog : defaultOpen(n))) continue;
    const adding = groups.reduce((a, x) => a + (dir === 'down' && placedBy.has(x.union?.id) ? 0
      : x.kids.reduce((b, p) => b + (blood.has(p.id) ? 1 : weight(p)), 0)), 0);
    if (tog !== true && count + adding > CAP) { capped = true; continue; }
    n.expanded = true;
    for (const x of groups) {
      const uid = x.union?.id;
      if (dir === 'down' && uid && placedBy.has(uid)) {
        n.groups.push({ union: x.union, spouse: x.spouse, sharedWith: placedBy.get(uid), children: [] });
        continue;
      }
      if (dir === 'down' && uid) placedBy.set(uid, n);
      n.groups.push({
        union: x.union,
        spouse: x.spouse,
        sharedWith: null,
        children: x.kids.map((p) => (blood.has(p.id) ? mk(p, n.depth + 1, blood.get(p.id)) : mk(p, n.depth + 1))),
      });
    }
  }
  // Spouse cards, decided in reading (pre-)order: a spouse who is also a shown blood descendant, or who was
  // already drawn beside someone else, becomes a compact card that jumps to that first occurrence.
  if (dir === 'down') {
    const firstSpouse = new Map();
    walk(root, (n) => {
      if (n.ref) return;
      n.spouses = n.unions.filter((x) => x.spouse).map((x) => {
        const s = x.spouse;
        const card = { person: s, union: x.union, ref: null, refSpouse: null, also: [] };
        if (blood.has(s.id)) card.ref = blood.get(s.id);
        else if (firstSpouse.has(s.id)) card.refSpouse = firstSpouse.get(s.id);
        else {
          firstSpouse.set(s.id, n);
          card.also = g.unionsOf(s.id)
            .filter((v) => v.id !== x.union.id)
            .map((v) => ({ union: v, partner: otherPartner(g, v, s.id), n: g.childrenOfUnion(v.id).length }))
            .filter((a) => a.partner || a.n);
        }
        return card;
      });
    });
  }
  return { root, nodes, blood, capped, maxDepth, count, dir };
}

// ---------------------------------------------------------------------------------------------------------
// Layout (logical coordinates, inline-start = 0; mirrored for RTL when drawn)

function dims() {
  let k = 1;
  try { k = parseFloat(getComputedStyle(document.documentElement).fontSize) / 17 || 1; } catch { /* ignore */ }
  k = Math.min(1.3, Math.max(1, k));
  const r = (v) => Math.round(v * k);
  return { CW: r(184), CH: r(92), RH: r(62), SG: r(26), HG: r(22), GG: r(44), VG: r(88), BUS: r(16), PAD: 48, k };
}

function layout(vis, D) {
  const { CW, CH, SG, HG, GG, VG, BUS, PAD } = D;
  const groupsAt = new Array(vis.maxDepth + 1).fill(0); // most union groups hanging from one person, per generation
  const measure = (n) => {
    const cards = n.ref ? 1 : 1 + n.spouses.length;
    n.cw = CW * cards + SG * (cards - 1);
    n.gs = n.groups.filter((gr) => gr.children.length);
    groupsAt[n.depth] = Math.max(groupsAt[n.depth], n.gs.length);
    for (const gr of n.gs) {
      const k = gr.spouse ? n.spouses.findIndex((c) => c.union === gr.union) + 1 : 0;
      gr.px = k > 0 ? CW * k + SG * (k - 1) + SG / 2 : CW / 2;
      for (const c of gr.children) measure(c);
      gr.w = gr.children.reduce((a, c) => a + c.W, 0) + HG * (gr.children.length - 1);
    }
    let end = -Infinity;
    for (const gr of n.gs) {
      let x = gr.px - gr.w / 2;
      if (end > -Infinity) x = Math.max(x, end + GG);
      gr.x = x;
      end = x + gr.w;
    }
    if (n.gs.length > 1) {
      const d = n.gs.reduce((a, gr) => a + (gr.x + gr.w / 2 - gr.px), 0) / n.gs.length;
      for (const gr of n.gs) gr.x -= d;
    }
    let left = 0;
    let right = n.cw;
    for (const gr of n.gs) { left = Math.min(left, gr.x); right = Math.max(right, gr.x + gr.w); }
    n.W = right - left;
    n.off = -left;
    for (const gr of n.gs) gr.rx = gr.x - left;
  };
  measure(vis.root);
  // Vertical gap under each generation: wider where several unions hang from one person, so every union
  // gets its own bus level.
  vis.gapAfter = groupsAt.map((ng) => VG + Math.max(0, ng - 2) * BUS);
  const tops = [];
  if (vis.dir === 'up') {
    for (let d = vis.maxDepth, y = PAD; d >= 0; d--) { tops[d] = y; y += CH + VG; }
  } else {
    for (let d = 0, y = PAD; d <= vis.maxDepth; d++) { tops[d] = y; y += CH + vis.gapAfter[d]; }
  }
  const place = (n, x0) => {
    n.x = x0 + n.off;
    n.y = tops[n.depth];
    for (const gr of n.gs) {
      let cx = x0 + gr.rx;
      for (const c of gr.children) { place(c, cx); cx += c.W + HG; }
    }
  };
  place(vis.root, PAD);
  vis.W = Math.ceil(vis.root.W + 2 * PAD);
  vis.H = Math.ceil(Math.max(...tops) + CH + PAD);
}

// ---------------------------------------------------------------------------------------------------------
// Shared bits

function pendingText(id) {
  const kind = store.pendingKind(id);
  return kind ? t(`tree.pending.${kind}`) : '';
}

function personAria(p) {
  const parts = [nameOf(p)];
  const y = yearsOf(p);
  if (y) parts.push(y);
  const pend = pendingText(p.id);
  if (pend) parts.push(pend);
  if ((p.tags || []).includes('needs-info')) parts.push(t('ui.needsInfo'));
  if ((p.tags || []).includes('verified')) parts.push(t('ui.verified'));
  if (store.me === p.id) parts.push(t('ui.me'));
  return parts.join(lang() === 'ar' ? '، ' : ', ');
}

async function openDialog(fn, ...args) {
  try {
    const mod = await import('../forms/dialogs.js');
    if (typeof mod[fn] === 'function') return await mod[fn](...args);
  } catch (e) {
    console.warn('[tree] dialogs unavailable', e);
  }
  toast(t('tree.unavailable'), { action: { label: t('tree.openProfile'), href: `#/p/${encodeURIComponent(args[0])}` } });
  return false;
}

// Popover (one at a time) -----------------------------------------------------------------------------------
let pop = null; // { el, anchor, close }

function closePopover({ restoreFocus = false } = {}) {
  if (!pop) return;
  const { el, anchor, off } = pop;
  pop = null;
  off();
  el.remove();
  if (anchor && anchor.isConnected) {
    anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus) (anchor.closest('[role="treeitem"]') || anchor).focus({ preventScroll: true });
  }
}

function openPopover(anchor, person, host, ctx) {
  const same = pop && pop.anchor === anchor;
  closePopover();
  if (same || !person) return;
  const id = person.id;
  const lin = lineageOf(person);
  const y = yearsOf(person);
  const items = [
    h('a', { class: 'sheet-item', href: `#/p/${encodeURIComponent(id)}` }, icon('user'), h('span', null, t('tree.openProfile'))),
    id !== ctx.rootId
      ? h('a', { class: 'sheet-item', href: treeHash(id, { view: ctx.explicitView, dir: ctx.dir }) }, icon('tree'), h('span', null, t('tree.focusHere')))
      : h('a', { class: 'sheet-item', href: treeHash(id, { view: ctx.explicitView, dir: ctx.dir === 'up' ? 'down' : 'up' }) },
        icon(ctx.dir === 'up' ? 'arrowDown' : 'arrowUp'), h('span', null, t(ctx.dir === 'up' ? 'tree.showDescendants' : 'tree.showAncestors'))),
    h('button', { type: 'button', class: 'sheet-item', dataset: { pop: 'child' } }, icon('plus'), h('span', null, t('tree.addChild'))),
    h('button', { type: 'button', class: 'sheet-item', dataset: { pop: 'spouse' } }, icon('heart'), h('span', null, t('tree.addSpouse'))),
    ctx.dir === 'up' ? h('button', { type: 'button', class: 'sheet-item', dataset: { pop: 'parent' } }, icon('users'), h('span', null, t('tree.addParent'))) : null,
    store.me && store.me !== id
      ? h('a', { class: 'sheet-item', href: `#/relationship/${encodeURIComponent(store.me)}/${encodeURIComponent(id)}` }, icon('link'), h('span', null, t('tree.howRelated')))
      : null,
  ];
  const el = h('div', { class: 'tree-pop', attrs: { role: 'dialog', 'aria-label': nameOf(person) } },
    h('div', { class: 'tree-pop-head' },
      avatar(person),
      h('div', { class: 'tree-pop-id' },
        nameLabel(person),
        lin && lin !== nameOf(person) ? bdi(lin, { class: 'tree-pop-lineage muted small' }) : null,
        y ? h('span', { class: 'muted small' }, y) : null),
      h('button', { type: 'button', class: 'btn-icon tree-pop-close', attrs: { 'aria-label': t('common.close') }, on: { click: () => closePopover({ restoreFocus: true }) } }, icon('close'))),
    h('div', { class: 'sheet-list tree-pop-list' }, items));
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pop]');
    if (b) {
      e.preventDefault();
      const as = b.dataset.pop;
      closePopover();
      await openDialog('openAddRelative', id, as);
      return;
    }
    if (e.target.closest('a')) closePopover();
  });
  host.appendChild(el);
  // Position: under the anchor (or above when there is no room), clamped inside the host.
  const hr = host.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  const pw = el.offsetWidth;
  const ph = el.offsetHeight;
  const hostH = Math.max(host.clientHeight, host.scrollHeight);
  let top = ar.bottom - hr.top + 8;
  if (top + ph > hostH - 8 && ar.top - hr.top - ph - 8 >= 8) top = ar.top - hr.top - ph - 8;
  top = Math.max(8, Math.min(top, hostH - ph - 8));
  let left = ar.left - hr.left + ar.width / 2 - pw / 2;
  left = Math.max(8, Math.min(left, hr.width - pw - 8));
  const start = textDir() === 'rtl' ? hr.width - left - pw : left; // inline-start offset
  el.style.setProperty('--pop-x', `${Math.round(start)}px`);
  el.style.setProperty('--pop-y', `${Math.round(top)}px`);
  anchor.setAttribute('aria-expanded', 'true');

  const onDown = (e) => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePopover(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover({ restoreFocus: true }); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  pop = {
    el,
    anchor,
    off: () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); },
  };
  const first = el.querySelector('.sheet-item');
  if (first) first.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------------------------------------
// Chart

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function cardEl(p, x, y, { spouse = false, isRoot = false, pageDir }) {
  const kind = store.pendingKind(p.id);
  const y2 = yearsOf(p);
  const bs = badges(p, { compact: true });
  // The positioned element lives in the canvas' LTR coordinate space; its content carries the page direction.
  return h('button', {
    type: 'button',
    class: ['tree-card', spouse && 'tree-card-spouse', kind && `is-${kind}`, p.deceased && 'is-deceased', isRoot && 'is-root', store.me === p.id && 'is-me'],
    style: { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` },
    dataset: { act: 'card', pid: p.id },
    attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': personAria(p) },
  },
  h('span', { class: 'tree-in', dir: pageDir },
    avatar(p, { size: 'sm' }),
    h('span', { class: 'tree-card-text' },
      nameLabel(p),
      y2 ? h('span', { class: 'tree-card-years' }, y2) : null),
    bs.length ? h('span', { class: 'tree-card-badges', attrs: { 'aria-hidden': 'true' } }, bs) : null));
}

function refCardEl(p, x, y, targetId, pageDir) {
  return h('button', {
    type: 'button',
    class: 'tree-card tree-card-ref',
    style: { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` },
    dataset: { act: 'jump', target: targetId },
    attrs: { 'aria-label': `${nameOf(p)} — ${t('tree.elsewhere')}. ${t('tree.goThere')}`, title: t('tree.elsewhere') },
  },
  h('span', { class: 'tree-in', dir: pageDir },
    h('span', { class: 'tree-ref-icon', attrs: { 'aria-hidden': 'true' } }, icon('link', { size: 16 })),
    h('span', { class: 'tree-card-text' },
      bdi(nameOf(p), { class: 'tree-ref-name' }),
      h('span', { class: 'tree-ref-note' }, t('tree.goThere')))));
}

function drawChart(vis, ctx, D) {
  const { CW, CH, RH, SG, VG } = D;
  const rtl = textDir() === 'rtl';
  const pageDir = textDir();
  const W = vis.W;
  const X = (lx, w = 0) => (rtl ? W - lx - w : lx);
  const canvas = h('div', { class: 'tree-canvas', dir: 'ltr', style: { width: `${W}px`, height: `${vis.H}px` } });
  const svg = svgEl('svg', { class: 'tree-lines', width: W, height: vis.H, viewBox: `0 0 ${W} ${vis.H}`, 'aria-hidden': 'true', focusable: 'false' });
  const links = [];
  const couples = [];
  const knots = [];
  const frag = document.createDocumentFragment();
  const pos = new Map(); // pid → logical rect of its full (first) card
  const g = ctx.g;
  const r1 = (v) => Math.round(v) + 0.5;

  walk(vis.root, (n) => {
    const p = n.person;
    if (n.ref) {
      const yy = n.y + (CH - RH) / 2;
      frag.append(refCardEl(p, X(n.x, CW), yy, n.ref.id, pageDir));
      return;
    }
    pos.set(p.id, { x: n.x, y: n.y, w: CW, h: CH });
    frag.append(cardEl(p, X(n.x, CW), n.y, { isRoot: n.depth === 0, pageDir }));

    // spouse cards (+ "also married to" pills)
    n.spouses.forEach((c, i) => {
      const sx = n.x + (CW + SG) * (i + 1);
      if (c.ref || c.refSpouse) {
        frag.append(refCardEl(c.person, X(sx, CW), n.y + (CH - RH) / 2, c.person.id, pageDir));
        return;
      }
      if (!pos.has(c.person.id)) pos.set(c.person.id, { x: sx, y: n.y, w: CW, h: CH });
      frag.append(cardEl(c.person, X(sx, CW), n.y, { spouse: true, pageDir }));
      if (c.also.length) {
        const a = c.also[0];
        const inTree = a.partner && vis.blood.has(a.partner.id);
        const content = h('span', { class: 'tree-in', dir: pageDir },
          icon('heart', { size: 13 }),
          h('span', { class: 'tree-also-text' },
            a.partner ? [t('tree.alsoMarried'), ' ', bdi(nameOf(a.partner))] : t('tree.otherChildren'),
            a.n ? h('span', { class: 'tree-also-n' }, ` · ${t('tree.kids', { n: a.n })}`) : null,
            c.also.length > 1 ? h('span', { class: 'tree-also-n' }, ` ${t('tree.moreMarriages', { n: c.also.length - 1 })}`) : null));
        const style = { transform: `translate(${Math.round(X(sx, CW))}px, ${Math.round(n.y + CH + 6)}px)` };
        frag.append(inTree
          ? h('button', { type: 'button', class: 'tree-also', style, dataset: { act: 'jump', target: a.partner.id } }, content)
          : h('a', { class: 'tree-also', style, href: treeHash(c.person.id, { view: ctx.explicitView, dir: 'down' }) }, content));
      }
    });
    if (n.spouses.length) {
      const yMid = r1(n.y + CH / 2);
      const x1 = n.x + CW;
      const x2 = n.x + n.cw - CW;
      couples.push(`M${r1(X(x1))} ${yMid}H${r1(X(x2))}`);
    }

    // connectors to children (down) / parents (up)
    if (vis.dir === 'down') {
      const ng = n.gs.length;
      const gap = vis.gapAfter[n.depth];
      const first = Math.round(38 * D.k); // clear of the toggle and the "also married" pills
      const step = ng > 1 ? (gap - first - Math.round(22 * D.k)) / (ng - 1) : 0;
      n.gs.forEach((gr, gi) => {
        const px = n.x + gr.px;
        const startY = gr.spouse ? n.y + CH / 2 : n.y + CH;
        // the last union (furthest along the row) gets the highest bus so lines never cross
        const busY = r1(ng > 1 ? n.y + CH + first + (ng - 1 - gi) * step : n.y + CH + gap / 2);
        const centers = gr.children.map((c) => c.x + CW / 2);
        const lo = Math.min(px, ...centers);
        const hi = Math.max(px, ...centers);
        let d = `M${r1(X(px))} ${r1(startY)}V${busY}M${r1(X(lo))} ${busY}H${r1(X(hi))}`;
        for (const c of gr.children) {
          const top = c.ref ? c.y + (CH - RH) / 2 : c.y;
          d += `M${r1(X(c.x + CW / 2))} ${busY}V${r1(top)}`;
        }
        links.push(d);
        if (gr.spouse) knots.push([X(px), n.y + CH / 2]);
      });
    } else if (n.gs.length) {
      const cx = n.x + CW / 2;
      const busY = r1(n.y - VG / 2);
      const kids = n.gs[0].children;
      const centers = kids.map((c) => c.x + CW / 2);
      const lo = Math.min(cx, ...centers);
      const hi = Math.max(cx, ...centers);
      let d = `M${r1(X(cx))} ${r1(n.y)}V${busY}M${r1(X(lo))} ${busY}H${r1(X(hi))}`;
      for (const c of kids) {
        const bottom = c.ref ? c.y + (CH + RH) / 2 : c.y + CH;
        d += `M${r1(X(c.x + CW / 2))} ${busY}V${r1(bottom)}`;
      }
      links.push(d);
    }

    // fold / unfold toggle
    if (n.hasKids) {
      const name = nameOf(p);
      const up = vis.dir === 'up';
      const hidden = n.expanded ? 0 : hiddenCount(g, p.id, vis.dir);
      const label = n.expanded
        ? t(up ? 'tree.collapseNodeUp' : 'tree.collapseNode', { name })
        : `${t(up ? 'tree.expandNodeUp' : 'tree.expandNode', { name })} (${t('tree.hidden', { n: hidden })})`;
      const tx = X(n.x + CW / 2);
      const ty = up ? n.y : n.y + CH;
      frag.append(h('button', {
        type: 'button',
        class: ['tree-toggle', n.expanded ? 'is-open' : 'is-closed'],
        style: { transform: `translate(${Math.round(tx)}px, ${Math.round(ty)}px) translate(-50%, -50%)` },
        dataset: { act: 'toggle', id: p.id },
        attrs: { 'aria-expanded': String(n.expanded), 'aria-label': label, title: label },
      }, n.expanded ? icon('minus', { size: 14 }) : h('span', null, `+${fmtNumber(hidden)}`)));
    }
  });

  if (couples.length) svg.appendChild(svgEl('path', { class: 'tree-couple', d: couples.join('') }));
  if (links.length) svg.appendChild(svgEl('path', { class: 'tree-link', d: links.join('') }));
  for (const [kx, ky] of knots) svg.appendChild(svgEl('circle', { class: 'tree-knot', cx: kx, cy: ky, r: 4 }));
  canvas.append(svg, frag);
  canvas.style.setProperty('--cw', `${CW}px`);
  canvas.style.setProperty('--ch', `${CH}px`);
  canvas.style.setProperty('--rh', `${RH}px`);
  return { canvas, pos, X };
}

function mountChart(stage, vis, ctx) {
  const D = dims();
  layout(vis, D);
  const { canvas, pos } = drawChart(vis, ctx, D);
  const { st } = ctx;
  const rtl = textDir() === 'rtl';
  const viewport = h('div', {
    class: 'tree-viewport',
    dir: 'ltr', // physical coordinate space for the canvas; every card carries the page direction itself
    tabindex: '0',
    attrs: { role: 'group', 'aria-roledescription': t('tree.viewChart'), 'aria-label': t('tree.chartLabel') },
  }, canvas);

  const rootName = nameOf(ctx.rootP);
  const controls = h('div', { class: 'tree-zoom', attrs: { role: 'toolbar', 'aria-label': t('tree.view') } },
    h('button', { type: 'button', class: 'btn btn-icon', dataset: { zoom: 'in' }, attrs: { 'aria-label': t('tree.zoomIn'), title: t('tree.zoomIn') } }, icon('plus')),
    h('button', { type: 'button', class: 'btn btn-icon', dataset: { zoom: 'out' }, attrs: { 'aria-label': t('tree.zoomOut'), title: t('tree.zoomOut') } }, icon('minus')),
    h('button', { type: 'button', class: 'btn btn-icon', dataset: { zoom: 'fit' }, attrs: { 'aria-label': t('tree.fit'), title: t('tree.fit') } }, icon('fit')),
    h('button', { type: 'button', class: 'btn btn-icon', dataset: { zoom: 'center' }, attrs: { 'aria-label': t('tree.center', { name: rootName }), title: t('tree.center', { name: rootName }) } }, icon('target')));
  const hint = h('p', { class: 'tree-hint', attrs: { 'aria-hidden': 'true' } }, t('tree.chartHint'));
  stage.append(viewport, controls, hint);

  // --- transform state ------------------------------------------------------------------------------
  let s = 1;
  let tx = 0;
  let ty = 0;
  let vw = 0;
  let vh = 0;
  let raf = 0;
  const measureVp = () => { vw = viewport.clientWidth; vh = viewport.clientHeight; };
  const save = () => {
    if (!vw || !vh) return;
    const px = (vw / 2 - tx) / s;
    st.view = { s, cx: rtl ? vis.W - px : px, cy: (vh / 2 - ty) / s };
  };
  const apply = () => {
    raf = 0;
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    save();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
  const clampS = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
  const restore = (v) => {
    s = clampS(v.s);
    tx = vw / 2 - (rtl ? vis.W - v.cx : v.cx) * s;
    ty = vh / 2 - v.cy * s;
  };
  const animate = () => {
    canvas.classList.add('is-animating');
    clearTimeout(animate.timer);
    animate.timer = setTimeout(() => canvas.classList.remove('is-animating'), 320);
  };
  const zoomAt = (f, x, y) => {
    const ns = clampS(s * f);
    const k = ns / s;
    tx = x - (x - tx) * k;
    ty = y - (y - ty) * k;
    s = ns;
    schedule();
  };
  const fit = () => {
    const fs = Math.min((vw - 32) / vis.W, (vh - 32) / vis.H);
    s = clampS(Math.min(1, fs));
    tx = (vw - vis.W * s) / 2;
    ty = (vh - vis.H * s) / 2;
  };
  const centerRoot = (scale = s) => {
    const r = vis.root;
    s = clampS(scale);
    const cx = rtl ? vis.W - (r.x + r.cw / 2) : r.x + r.cw / 2;
    tx = vw / 2 - cx * s;
    ty = vis.dir === 'up' ? vh - 28 - (r.y + D.CH) * s : 60 - r.y * s;
  };
  const initial = () => {
    const fs = Math.min((vw - 32) / vis.W, (vh - 32) / vis.H);
    const minRead = vw < 700 ? 0.68 : 0.78;
    if (fs >= minRead) fit();
    else centerRoot(Math.min(1, Math.max(fs, minRead)));
  };
  let quietFocus = false; // programmatic focus: the view is already placed, do not auto-pan
  const flash = (pid) => {
    const el = canvas.querySelector(`.tree-card[data-pid="${CSS.escape(pid)}"]`);
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 2400);
    quietFocus = true;
    el.focus({ preventScroll: true });
    quietFocus = false;
  };
  const centerOn = (pid, { minScale = 0.85 } = {}) => {
    const r = pos.get(pid);
    if (!r) return false;
    restore({ s: Math.max(s, minScale), cx: r.x + r.w / 2, cy: r.y + r.h / 2 });
    return true;
  };

  measureVp();
  if (st.anchor && st.view) {
    const n = vis.blood.get(st.anchor.id);
    if (n) { st.view.cx += n.x - st.anchor.x; st.view.cy += n.y - st.anchor.y; }
  }
  st.anchor = null;
  if (st.pendingFocus && pos.has(st.pendingFocus)) {
    const pid = st.pendingFocus;
    if (st.view) restore(st.view); else initial();
    centerOn(pid);
    st.pendingFocus = null;
    requestAnimationFrame(() => flash(pid));
  } else if (st.view) restore(st.view);
  else initial();
  st.pendingFocus = null;
  apply();

  // --- pointer: pan & pinch -------------------------------------------------------------------------
  const pts = new Map();
  let start = null;
  let moved = false;
  let suppressClick = false;
  const local = (e) => { const r = viewport.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pinchInfo = () => {
    const [a, b] = [...pts.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  const beginFrom = () => {
    if (pts.size === 1) {
      const [p] = [...pts.values()];
      start = { mode: 'pan', x: p.x, y: p.y, tx, ty };
    } else if (pts.size >= 2) {
      const pi = pinchInfo();
      start = { mode: 'pinch', ...pi, s, tx, ty };
    }
  };
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.tree-zoom')) return;
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) moved = false;
    if (pts.size === 2) { moved = true; closePopover(); try { viewport.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    beginFrom();
  };
  const onMove = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    if (!start) return;
    if (start.mode === 'pan' && pts.size === 1) {
      const [p] = [...pts.values()];
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) > 6) {
        moved = true;
        closePopover();
        viewport.classList.add('is-dragging');
        try { viewport.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      if (moved) { tx = start.tx + dx; ty = start.ty + dy; schedule(); }
    } else if (start.mode === 'pinch' && pts.size >= 2) {
      const pi = pinchInfo();
      const ns = clampS(start.s * (pi.d / start.d));
      const cx = (start.mx - start.tx) / start.s;
      const cy = (start.my - start.ty) / start.s;
      s = ns;
      tx = pi.mx - cx * ns;
      ty = pi.my - cy * ns;
      schedule();
    }
  };
  const onUp = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0) {
      viewport.classList.remove('is-dragging');
      if (moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
      start = null;
    } else beginFrom();
  };
  const onClickCapture = (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  };
  const onWheel = (e) => {
    e.preventDefault();
    closePopover();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= vh;
    const p = local(e);
    zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)), p.x, p.y);
  };
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('.tree-pop')) return;
    const STEP = 80;
    switch (e.key) {
      case 'ArrowLeft': tx += STEP; break;
      case 'ArrowRight': tx -= STEP; break;
      case 'ArrowUp': ty += STEP; break;
      case 'ArrowDown': ty -= STEP; break;
      case '+': case '=': animate(); zoomAt(1.25, vw / 2, vh / 2); e.preventDefault(); return;
      case '-': case '_': animate(); zoomAt(0.8, vw / 2, vh / 2); e.preventDefault(); return;
      case '0': animate(); fit(); schedule(); e.preventDefault(); return;
      default: return;
    }
    e.preventDefault();
    closePopover();
    schedule();
  };
  // Keep keyboard focus visible: pan a focused card into view.
  const onFocusIn = (e) => {
    if (quietFocus || canvas.classList.contains('is-animating')) return;
    const el = e.target.closest('.tree-card, .tree-toggle, .tree-also');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const v = viewport.getBoundingClientRect();
    const m = 24;
    let dx = 0;
    let dy = 0;
    if (r.left < v.left + m) dx = v.left + m - r.left;
    else if (r.right > v.right - m) dx = v.right - m - r.right;
    if (r.top < v.top + m) dy = v.top + m - r.top;
    else if (r.bottom > v.bottom - m) dy = v.bottom - m - r.bottom;
    if (dx || dy) { tx += dx; ty += dy; schedule(); }
  };
  const jump = (pid) => {
    closePopover();
    if (centerOn(pid)) { animate(); schedule(); requestAnimationFrame(() => flash(pid)); }
  };
  const onClick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !canvas.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'card') openPopover(el, ctx.g.person(el.dataset.pid), stage, ctx);
    else if (act === 'jump') jump(el.dataset.target);
    else if (act === 'toggle') {
      const n = vis.blood.get(el.dataset.id);
      if (!n) return;
      closePopover();
      st.anchor = { id: n.id, x: n.x, y: n.y };
      st.toggled.set(n.id, !n.expanded);
      st.restoreFocus = document.activeElement === el ? `.tree-toggle[data-id="${CSS.escape(n.id)}"]` : null;
      ctx.redraw();
    }
  };
  controls.addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (!b) return;
    closePopover();
    animate();
    const z = b.dataset.zoom;
    if (z === 'in') zoomAt(1.3, vw / 2, vh / 2);
    else if (z === 'out') zoomAt(1 / 1.3, vw / 2, vh / 2);
    else if (z === 'fit') { fit(); schedule(); }
    else if (z === 'center') { centerRoot(Math.max(s, 0.85)); schedule(); }
  });

  viewport.addEventListener('pointerdown', onDown);
  viewport.addEventListener('pointermove', onMove);
  viewport.addEventListener('pointerup', onUp);
  viewport.addEventListener('pointercancel', onUp);
  viewport.addEventListener('click', onClickCapture, true);
  viewport.addEventListener('click', onClick);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('keydown', onKey);
  viewport.addEventListener('focusin', onFocusIn);

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      const before = st.view;
      measureVp();
      if (before && vw && vh) { restore(before); schedule(); }
    });
    ro.observe(viewport);
  }
  return () => {
    if (raf) cancelAnimationFrame(raf);
    if (ro) ro.disconnect();
    clearTimeout(animate.timer);
  };
}

// ---------------------------------------------------------------------------------------------------------
// List (outline)

function mountList(stage, vis, ctx) {
  const { st, g } = ctx;
  const rtl = textDir() === 'rtl';
  const up = vis.dir === 'up';
  const tree = h('ul', { class: 'tree-list', attrs: { role: 'tree', 'aria-label': t('tree.listLabel') } });

  const row = (n, level, posIn, size, parentId) => {
    const p = n.person;
    const kind = store.pendingKind(p.id);
    const key = n.ref ? `ref:${parentId}:${p.id}` : p.id;
    const y = yearsOf(p);
    const spouseNames = n.spouses.map((c) => nameOf(c.person));
    const kidsN = !up && !n.ref ? g.children(p.id).length : 0;
    const expandable = n.hasKids && !n.ref;
    const aria = [personAria(p)];
    if (spouseNames.length) aria.push(t('tree.marriedTo', { names: spouseNames.join(lang() === 'ar' ? '، ' : ', ') }));
    if (kidsN) aria.push(t('tree.kids', { n: kidsN }));
    if (n.ref) aria.push(t('tree.elsewhere'));
    const li = h('li', {
      class: 'tree-li',
      dataset: n.ref ? { key, id: p.id, ref: n.ref.id } : { key, id: p.id },
      attrs: {
        role: 'treeitem',
        tabindex: '-1',
        'aria-level': level,
        'aria-setsize': size,
        'aria-posinset': posIn,
        'aria-expanded': expandable ? String(n.expanded) : null,
        'aria-label': aria.join(lang() === 'ar' ? '، ' : ', '),
      },
    });
    const meta = [];
    if (y) meta.push(h('span', null, y));
    if (kidsN) meta.push(h('span', { class: 'tree-row-count' }, t('tree.kids', { n: kidsN })));
    const r = h('div', {
      class: ['tree-row', kind && `is-${kind}`, p.deceased && 'is-deceased', n.depth === 0 && 'is-root', n.ref && 'is-ref'],
      dataset: { act: 'row' },
    },
    expandable
      ? h('button', {
        type: 'button',
        class: ['tree-row-toggle', n.expanded ? 'is-open' : ''],
        tabindex: '-1',
        dataset: { act: 'toggle' },
        attrs: { 'aria-hidden': 'true', title: t(n.expanded ? (up ? 'tree.collapseNodeUp' : 'tree.collapseNode') : (up ? 'tree.expandNodeUp' : 'tree.expandNode'), { name: nameOf(p) }) },
      }, icon(n.expanded ? 'chevronDown' : 'chevronEnd', { size: 18, className: n.expanded ? '' : 'flip-rtl' }))
      : h('span', { class: 'tree-row-toggle is-leaf', attrs: { 'aria-hidden': 'true' } }),
    avatar(p, { size: 'sm' }),
    h('span', { class: 'tree-row-main' },
      h('span', { class: 'tree-row-title' }, nameLabel(p), ...badges(p, { compact: true })),
      spouseNames.length
        ? h('span', { class: 'tree-row-spouses' }, icon('heart', { size: 13 }),
          n.spouses.map((c, i) => [i ? (lang() === 'ar' ? '، ' : ', ') : null, bdi(nameOf(c.person))]))
        : null,
      meta.length ? h('span', { class: 'tree-row-meta' }, meta.map((m, i) => [i ? ' · ' : null, m])) : null),
    n.ref
      ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost tree-row-jump', tabindex: '-1', dataset: { act: 'jump', target: n.ref.id } }, icon('link', { size: 16 }), t('tree.goThere'))
      : null);
    li.appendChild(r);
    if (n.expanded) {
      const grp = h('ul', { class: 'tree-group', attrs: { role: 'group' } });
      const total = n.groups.reduce((a, gr) => a + gr.children.length, 0);
      const labelled = !up && (n.groups.length > 1 || n.groups.some((gr) => gr.sharedWith));
      let k = 0;
      for (const gr of n.groups) {
        if (labelled) {
          const sp = gr.spouse ? nameOf(gr.spouse) : '';
          grp.appendChild(h('li', { class: 'tree-group-label', attrs: { role: 'none' } },
            icon(gr.spouse ? 'heart' : 'users', { size: 14 }),
            h('span', null, gr.spouse ? t('tree.childrenWith', { name: sp }) : t('tree.childrenNoPartner')),
            gr.sharedWith
              ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', tabindex: '-1', dataset: { act: 'jump', target: gr.sharedWith.id } },
                t('tree.childrenUnder', { name: nameOf(gr.sharedWith.person) }))
              : null));
        }
        for (const c of gr.children) grp.appendChild(row(c, level + 1, ++k, total, p.id));
      }
      li.appendChild(grp);
    }
    return li;
  };
  tree.appendChild(row(vis.root, 1, 1, 1, ''));
  stage.appendChild(tree);

  const items = () => [...tree.querySelectorAll('[role="treeitem"]')];
  const setActive = (li, { focus = true } = {}) => {
    if (!li) return;
    for (const x of tree.querySelectorAll('[role="treeitem"][tabindex="0"]')) x.setAttribute('tabindex', '-1');
    li.setAttribute('tabindex', '0');
    st.listKey = li.dataset.key;
    if (focus) li.focus({ preventScroll: false });
  };
  const byKey = (key) => (key ? tree.querySelector(`[role="treeitem"][data-key="${CSS.escape(key)}"]`) : null);
  setActive(byKey(st.listKey) || tree.querySelector('[role="treeitem"]'), { focus: false });

  const toggle = (li) => {
    const id = li.dataset.id;
    const n = vis.blood.get(id);
    if (!n || li.dataset.ref) return;
    closePopover();
    st.toggled.set(id, !n.expanded);
    st.listKey = li.dataset.key;
    st.restoreFocus = tree.contains(document.activeElement) ? `[role="treeitem"][data-key="${CSS.escape(li.dataset.key)}"]` : null;
    ctx.redraw();
  };
  const jump = (pid) => {
    const li = byKey(pid);
    if (!li) return;
    closePopover();
    setActive(li, { focus: false });
    li.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    li.focus({ preventScroll: true });
    const r = li.querySelector('.tree-row');
    r.classList.remove('is-flash');
    void r.offsetWidth;
    r.classList.add('is-flash');
    setTimeout(() => r.classList.remove('is-flash'), 2400);
  };

  tree.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const li = e.target.closest('[role="treeitem"]');
    if (!act || !li) return;
    if (act.dataset.act === 'toggle') { toggle(li); return; }
    if (act.dataset.act === 'jump') { jump(act.dataset.target); return; }
    setActive(li, { focus: false });
    li.focus({ preventScroll: true });
    openPopover(li.querySelector('.tree-row'), g.person(li.dataset.id), stage, ctx);
  });
  tree.addEventListener('keydown', (e) => {
    const li = e.target.closest('[role="treeitem"]');
    if (!li || e.target !== li || e.ctrlKey || e.metaKey || e.altKey) return;
    const inward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const outward = rtl ? 'ArrowRight' : 'ArrowLeft';
    const list = items();
    const i = list.indexOf(li);
    const exp = li.getAttribute('aria-expanded');
    switch (e.key) {
      case 'ArrowDown': setActive(list[i + 1]); break;
      case 'ArrowUp': setActive(list[i - 1]); break;
      case 'Home': setActive(list[0]); break;
      case 'End': setActive(list[list.length - 1]); break;
      case inward:
        if (exp === 'false') toggle(li);
        else if (exp === 'true') setActive(li.querySelector(':scope > ul > [role="treeitem"]'));
        break;
      case outward:
        if (exp === 'true') toggle(li);
        else setActive(li.parentElement.closest('[role="treeitem"]'));
        break;
      case 'Enter':
      case ' ':
        if (li.dataset.ref) jump(li.dataset.ref);
        else openPopover(li.querySelector('.tree-row'), g.person(li.dataset.id), stage, ctx);
        break;
      default: return;
    }
    e.preventDefault();
  });

  if (st.pendingFocus) {
    const pid = st.pendingFocus;
    st.pendingFocus = null;
    requestAnimationFrame(() => jump(pid));
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// View

function build(root, params, query) {
  const g = store.working;
  if (!g) return null;
  const rootP = resolveRoot(g, params);
  if (!rootP) {
    root.replaceChildren(params.id
      ? emptyState(t('common.notFound'), t('common.personNotFound'), h('a', { class: 'btn btn-primary', href: '#/tree' }, icon('tree'), t('tree.title')))
      : emptyState(t('tree.empty'), '', h('a', { class: 'btn btn-primary', href: '#/add-family' }, icon('plus'), t('nav.addFamily'))));
    return null;
  }
  const rootId = rootP.id;
  const dir = query.dir === 'up' ? 'up' : 'down';
  const explicitView = query.view === 'list' || query.view === 'chart' ? query.view : null;
  const view = explicitView || (window.innerWidth < 700 ? 'list' : 'chart');
  if (params.id && params.id !== rootId) {
    // merged person → show the surviving record and fix the address quietly
    try { history.replaceState(history.state, '', treeHash(rootId, { view: explicitView, dir, focus: query.focus })); } catch { /* ignore */ }
  }
  const st = stateFor(rootId, dir);

  // ?focus=<pid>: expand the path and centre that person (once per address).
  if (query.focus && location.hash !== lastFocusHash) {
    lastFocusHash = location.hash;
    const target = g.resolve(query.focus);
    if (target && expandPathTo(g, rootId, target.id, dir, st)) st.pendingFocus = target.id;
  }

  const ctx = { g, rootP, rootId, dir, view, explicitView, st, redraw: null };
  const vis = buildVisible(g, rootP, dir, st);

  // --- header & toolbar -------------------------------------------------------------------------------
  const setQuery = (patch) => {
    const next = { view: explicitView, dir, ...patch };
    try { history.replaceState(history.state, '', treeHash(rootId, next)); } catch { /* ignore */ }
    ctx.redraw({ query: { ...(next.view ? { view: next.view } : {}), ...(next.dir === 'up' ? { dir: 'up' } : {}) } });
  };
  const branches = (() => { try { return g.branches(); } catch { return []; } })();
  const inBranches = branches.some((b) => b.person.id === rootId);
  const branchSelect = branches.length > 1 || (branches.length && !inBranches)
    ? h('label', { class: 'tree-branch' },
      h('span', { class: 'tree-branch-label' }, t('tree.branch')),
      h('select', {
        class: 'select',
        on: { change: (e) => { if (e.target.value && e.target.value !== rootId) location.hash = treeHash(e.target.value, { view: explicitView, dir }); } },
      },
      inBranches ? null : h('option', { value: rootId, selected: true }, t('tree.branchCurrent', { name: nameOf(rootP) })),
      branches.map((b) => h('option', { value: b.person.id, selected: b.person.id === rootId }, t('tree.branchCount', { name: bi(b.label) || nameOf(b.person), n: b.count })))))
    : null;

  const seg = (label, cls, items) => h('div', { class: ['segmented', 'tree-seg', cls], attrs: { role: 'group', 'aria-label': label } },
    items.map((it) => h('button', {
      type: 'button',
      attrs: { 'aria-pressed': String(it.on), 'aria-label': it.label, title: it.label },
      on: { click: () => { if (!it.on) it.go(); } },
    }, icon(it.icon, { size: 16 }), h('span', { class: 'tree-seg-label' }, it.label))));
  const allOpen = st.mode === 'all';

  const toolbar = h('div', { class: 'tree-toolbar' },
    seg(t('tree.view'), 'tree-seg-view', [
      { label: t('tree.viewChart'), icon: 'chart', on: view === 'chart', go: () => setQuery({ view: 'chart' }) },
      { label: t('tree.viewList'), icon: 'list', on: view === 'list', go: () => setQuery({ view: 'list' }) },
    ]),
    seg(t('tree.direction'), 'tree-seg-dir', [
      { label: t('tree.down'), icon: 'arrowDown', on: dir === 'down', go: () => setQuery({ dir: 'down', view: explicitView }) },
      { label: t('tree.up'), icon: 'arrowUp', on: dir === 'up', go: () => setQuery({ dir: 'up', view: explicitView }) },
    ]),
    h('div', { class: 'tree-actions' },
      h('button', {
        type: 'button',
        class: 'chip tree-paternal',
        attrs: { 'aria-pressed': String(paternalOnly) },
        on: {
          click: () => {
            paternalOnly = !paternalOnly;
            writePaternal(paternalOnly);
            for (const s2 of states.values()) {
              for (const id of [...s2.toggled.keys()]) if (g.person(id)?.gender === 'f') s2.toggled.delete(id);
            }
            ctx.redraw();
          },
        },
      }, h('span', { class: 'tree-check', attrs: { 'aria-hidden': 'true' } }, paternalOnly ? icon('check', { size: 14 }) : null), t('tree.paternal')),
      h('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost tree-expand',
        on: {
          click: () => {
            st.mode = allOpen ? 'collapsed' : 'all';
            st.toggled.clear();
            if (allOpen) st.view = null;
            ctx.redraw();
          },
        },
      }, icon(allOpen ? 'minus' : 'plus', { size: 16 }), t(allOpen ? 'tree.collapseAll' : 'tree.expandAll'))));

  const head = h('div', { class: 'tree-head' },
    h('div', { class: 'tree-heading' },
      h('p', { class: 'tree-eyebrow' }, icon('tree', { size: 16 }), t('tree.title')),
      h('h1', null, t(dir === 'up' ? 'tree.ancestorsOf' : 'tree.familyOf', { name: nameOf(rootP) }))),
    branchSelect);

  const notices = [];
  if (vis.capped) notices.push(h('p', { class: 'notice notice-info tree-notice', attrs: { role: 'status' } }, icon('info'), h('span', null, t('tree.capped', { n: vis.count }))));
  if (!vis.root.hasKids) {
    const as = dir === 'up' ? 'parent' : 'child';
    notices.push(h('div', { class: 'notice notice-info tree-notice' }, icon('info'),
      h('div', { class: 'tree-notice-body' },
        h('span', null, t(dir === 'up' ? 'tree.noParents' : 'tree.noChildren', { name: nameOf(rootP) })),
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => openDialog('openAddRelative', rootId, as) } },
          icon('plus', { size: 16 }), t(dir === 'up' ? 'tree.addParent' : 'tree.addChild')))));
  }

  const stage = h('div', { class: ['tree-stage', `tree-stage-${view}`] });
  root.classList.add('tree-view');
  root.classList.toggle('tree-is-chart', view === 'chart');
  root.classList.toggle('tree-is-list', view === 'list');
  root.replaceChildren(head, toolbar, ...notices, stage);

  if (view === 'chart') sizeStage(stage);
  const cleanup = view === 'chart' ? mountChart(stage, vis, ctx) : mountList(stage, vis, ctx);
  return { ctx, cleanup };
}

/** Let the chart fill the rest of the screen (above the phone tab bar / draft bar). */
function sizeStage(stage) {
  const top = stage.getBoundingClientRect().top + window.scrollY;
  stage.style.setProperty('--tree-top', `${Math.max(0, Math.round(top))}px`);
}

let session = null; // { root, params, query, cleanup }

function draw(root, params, query) {
  closePopover();
  if (session && session.cleanup) { try { session.cleanup(); } catch (e) { console.error(e); } }
  const res = build(root, params, query);
  session = { root, params, query, cleanup: res?.cleanup || null };
  if (res) {
    res.ctx.redraw = ({ query: q } = {}) => {
      const sel = res.ctx.st.restoreFocus;
      res.ctx.st.restoreFocus = null;
      draw(root, params, q || query);
      if (sel) {
        const el = root.querySelector(sel);
        if (el) {
          if (el.getAttribute('role') === 'treeitem') {
            for (const x of root.querySelectorAll('[role="treeitem"][tabindex="0"]')) x.setAttribute('tabindex', '-1');
            el.setAttribute('tabindex', '0');
          }
          el.focus({ preventScroll: true });
        }
      }
    };
  }
}

export default {
  title(params = {}) {
    const g = store.working;
    const p = g ? resolveRoot(g, params) : null;
    return p ? `${t('tree.title')} · ${nameOf(p)}` : t('tree.title');
  },
  render(root, params = {}, query = {}) {
    draw(root, params, query);
    const onResize = () => {
      const stage = root.querySelector('.tree-stage-chart');
      if (stage) sizeStage(stage);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      closePopover();
      if (session && session.root === root) {
        if (session.cleanup) { try { session.cleanup(); } catch (e) { console.error(e); } }
        session = null;
      }
      if (!location.hash.startsWith('#/tree')) lastFocusHash = null;
    };
  },
};
