// Graph: a read-only, indexed view of family data — parents, spouses, children, siblings, ties, ancestors,
// descendants, family branches, statistics, search and duplicate detection.
// Pure ES module — runs unchanged in modern browsers and Node ≥ 20 (no DOM, no fetch, no node: imports).
// See docs/SPEC.md §2 (data model) and §4 (graph.js API).
//
// Works on normalized data (schema.js normalizeData) and, defensively, on the compact stored form
// (missing optional fields are treated as their defaults).
//
// Visibility: soft-removed people and unions (`removed` set) are invisible — person(), union(), people(),
// parents, children, … all skip them — unless the graph is built with {includeRemoved: true}.
// removedPeople() / removedUnions() always list them; resolve(id) follows `removed.mergedInto`.
// Parentage is blood only: ties (milk / foster) never count as parents, ancestors or descendants.

import { lineageName, fullName, searchKey, skeletonKey, tokenSkeletonVariants } from './names.js';

// ---------------------------------------------------------------------------------------------------------
// Date helpers (local, so graph.js does not depend on dates.js)

/** Sortable number for a partial date "YYYY[-MM[-DD]]", or null when absent/invalid. */
function dateNum(s) {
  const m = /^(\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(typeof s === 'string' ? s.trim() : '');
  if (!m) return null;
  return Number(m[1]) * 10000 + (Number(m[2]) || 0) * 100 + (Number(m[3]) || 0);
}

/** Birth year (number) or null. */
function birthYear(p) {
  const m = /^(\d{1,4})/.exec(p?.birth?.date || '');
  return m ? Number(m[1]) : null;
}

const GENDER_RANK = { m: 0, f: 1 };
const genderRank = (p) => GENDER_RANK[p?.gender] ?? 2;

const MAX_MERGE_HOPS = 10;

/** Levenshtein distance (small strings only). */
function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const isArabicText = (s) => /[\u0600-\u06FF]/.test(s);

/** 0–10: how close two same-script spellings are (ranks fuzzy matches: Mohamed → Mohammed before Mahmoud). */
function spellingCloseness(a, b) {
  if (isArabicText(a) !== isArabicText(b)) return 0;
  const len = Math.max(a.length, b.length) || 1;
  return Math.max(0, Math.round(10 * (1 - editDistance(a, b) / len)));
}

// Words that join names in a lineage and are ignored by search ("محمد بن أحمد" ≡ "محمد أحمد").
const SEARCH_CONNECTORS = new Set(['بن', 'بنت', 'ابن', 'bin', 'bint', 'ibn', 'binti']);

// ---------------------------------------------------------------------------------------------------------

/**
 * Build an immutable Graph over `data` ({people, unions, meta}).
 * @param {object} data
 * @param {{includeRemoved?: boolean}} [opts]
 */
export function buildGraph(data, { includeRemoved = false } = {}) {
  const peopleObj = data && typeof data.people === 'object' && data.people ? data.people : {};
  const unionsObj = data && typeof data.unions === 'object' && data.unions ? data.unions : {};
  const meta = data?.meta || {};

  // --- people ---------------------------------------------------------------------------------------
  const byId = new Map(); // every person, removed or not
  const order = new Map(); // id → insertion index
  for (const [key, p] of Object.entries(peopleObj)) {
    if (!p || typeof p !== 'object') continue;
    const id = p.id || key;
    if (byId.has(id)) continue;
    order.set(id, byId.size);
    byId.set(id, p);
  }
  const isVisiblePerson = (p) => !!p && (includeRemoved || !p.removed);
  const visiblePeople = [...byId.values()].filter(isVisiblePerson);
  const removedPeopleList = [...byId.values()].filter((p) => p.removed);
  const getPerson = (id) => {
    const p = id == null ? null : byId.get(id);
    return isVisiblePerson(p) ? p : null;
  };

  // --- unions ---------------------------------------------------------------------------------------
  const unionById = new Map();
  const unionOrder = new Map();
  for (const [key, u] of Object.entries(unionsObj)) {
    if (!u || typeof u !== 'object') continue;
    const id = u.id || key;
    if (unionById.has(id)) continue;
    unionOrder.set(id, unionById.size);
    unionById.set(id, u);
  }
  const isVisibleUnion = (u) => !!u && (includeRemoved || !u.removed);
  const visibleUnions = [...unionById.values()].filter(isVisibleUnion);
  const removedUnionsList = [...unionById.values()].filter((u) => u.removed);
  const getUnion = (id) => {
    const u = id == null ? null : unionById.get(id);
    return isVisibleUnion(u) ? u : null;
  };
  const partnerIds = (u) => [...new Set(Array.isArray(u?.partners) ? u.partners : [])];
  const childIds = (u) => [...new Set(Array.isArray(u?.children) ? u.children : [])];
  const uid = (u) => u.id || '';

  // child → birth union (an active union wins over a removed one when removed ones are visible)
  const birthOf = new Map();
  // person → unions where they are a partner
  const partnerOf = new Map();
  for (const u of visibleUnions) {
    for (const c of childIds(u)) {
      const prev = birthOf.get(c);
      if (!prev || (prev.removed && !u.removed)) birthOf.set(c, u);
    }
    for (const pid of partnerIds(u)) {
      if (!partnerOf.has(pid)) partnerOf.set(pid, []);
      partnerOf.get(pid).push(u);
    }
  }

  // Display order of a person's unions: spouseOrder first, then marriage date (known first), then insertion.
  const sortedUnionsCache = new Map();
  function unionsOfIds(id) {
    if (sortedUnionsCache.has(id)) return sortedUnionsCache.get(id);
    const list = partnerOf.get(id) || [];
    const so = byId.get(id)?.spouseOrder;
    const soIdx = new Map((Array.isArray(so) ? so : []).map((u, i) => [u, i]));
    const keyOf = (u) => [
      soIdx.has(uid(u)) ? soIdx.get(uid(u)) : Number.MAX_SAFE_INTEGER,
      dateNum(u.marriage?.date) ?? Number.MAX_SAFE_INTEGER,
      unionOrder.get(uid(u)) ?? 0,
    ];
    const sorted = list
      .map((u) => ({ u, k: keyOf(u) }))
      .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2])
      .map((x) => x.u);
    sortedUnionsCache.set(id, sorted);
    return sorted;
  }

  // --- basic relations ------------------------------------------------------------------------------
  function birthUnion(id) {
    return birthOf.get(id) || null;
  }

  function parents(id) {
    const b = birthOf.get(id);
    if (!b) return [];
    return partnerIds(b)
      .map(getPerson)
      .filter(Boolean)
      .sort((a, c) => genderRank(a) - genderRank(c));
  }

  function parentOfGender(id, g) {
    const b = birthOf.get(id);
    if (!b) return null;
    for (const pid of partnerIds(b)) {
      const p = getPerson(pid);
      if (p && p.gender === g) return p;
    }
    return null;
  }

  function childrenOfUnion(unionId) {
    const u = getUnion(unionId);
    if (!u) return [];
    return childIds(u).map(getPerson).filter(Boolean);
  }

  function spouses(id) {
    const out = [];
    for (const u of unionsOfIds(id)) {
      for (const pid of partnerIds(u)) {
        if (pid === id) continue;
        const p = getPerson(pid);
        if (p) out.push({ person: p, union: u });
      }
    }
    return out;
  }

  /**
   * Children across all of id's unions. Ordered by birth year when known; a child with no known year
   * stays next to its nearest dated sibling of the same union (else after all dated children), keeping
   * union order then child order as the tie-breaker.
   */
  function children(id) {
    const rows = [];
    let natural = 0;
    for (const u of unionsOfIds(id)) {
      const kids = childIds(u).map(getPerson).filter(Boolean);
      const years = kids.map(birthYear);
      const eff = years.slice();
      let last = null;
      for (let i = 0; i < eff.length; i++) {
        if (eff[i] !== null) last = eff[i];
        else if (last !== null) eff[i] = last;
      }
      let next = null;
      for (let i = eff.length - 1; i >= 0; i--) {
        if (years[i] !== null) next = years[i];
        else if (eff[i] === null && next !== null) eff[i] = next;
      }
      kids.forEach((p, i) => rows.push({ p, y: eff[i] ?? Number.MAX_SAFE_INTEGER, n: natural++ }));
    }
    const seen = new Set();
    return rows
      .sort((a, b) => a.y - b.y || a.n - b.n)
      .map((r) => r.p)
      .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  }

  /**
   * Siblings: full = other children of the same 2-partner birth union; half = children of another union of
   * one parent where that union has a different second partner (via "father"/"mother" by that parent's
   * gender); unspecified = everyone else who shares a parent but where it is unknown whether the other parent
   * is shared too (single-parent or parentless birth unions, a parent's single-partner union, a parent of
   * unknown gender).
   */
  function siblings(id) {
    const res = { full: [], half: [], unspecified: [] };
    const b = birthOf.get(id);
    if (!b) return res;
    const seen = new Set([id]);
    const add = (bucket, p, via) => {
      if (!p || seen.has(p.id)) return;
      seen.add(p.id);
      if (bucket === 'half') res.half.push({ person: p, via });
      else res[bucket].push(p);
    };
    const bPartners = partnerIds(b);
    const own = childIds(b).map(getPerson).filter(Boolean);
    for (const p of own) add(bPartners.length === 2 ? 'full' : 'unspecified', p);
    for (const pid of bPartners) {
      const parent = getPerson(pid);
      if (!parent) continue;
      const via = parent.gender === 'm' ? 'father' : parent.gender === 'f' ? 'mother' : null;
      for (const u of unionsOfIds(pid)) {
        if (u === b) continue;
        const clearlyHalf = bPartners.length === 2 && partnerIds(u).length === 2 && via;
        for (const c of childIds(u).map(getPerson).filter(Boolean)) {
          add(clearlyHalf ? 'half' : 'unspecified', c, via);
        }
      }
    }
    return res;
  }

  // --- ties -----------------------------------------------------------------------------------------
  let incomingTies = null; // target id → [{type, person, note}]
  function incomingTieIndex() {
    if (incomingTies) return incomingTies;
    incomingTies = new Map();
    for (const p of visiblePeople) {
      for (const t of Array.isArray(p.ties) ? p.ties : []) {
        if (!t || !t.person) continue;
        if (!incomingTies.has(t.person)) incomingTies.set(t.person, []);
        incomingTies.get(t.person).push({ type: t.type, person: p, note: t.note });
      }
    }
    return incomingTies;
  }

  /** Non-biological ties. direction "to": id is the child (milk-child-of / foster-child-of person); "from": person is id's milk/foster child. */
  function ties(id) {
    const out = [];
    const p = getPerson(id);
    if (!p) return out;
    for (const t of Array.isArray(p.ties) ? p.ties : []) {
      const other = getPerson(t?.person);
      if (other) out.push({ type: t.type, person: other, direction: 'to', note: t.note || { ar: '', en: '' } });
    }
    for (const t of incomingTieIndex().get(id) || []) {
      out.push({ type: t.type, person: t.person, direction: 'from', note: t.note || { ar: '', en: '' } });
    }
    return out;
  }

  /**
   * Milk siblings (rada'a): the biological and milk children of id's milk parents, and the milk children of
   * id's biological parents. Returns person objects.
   */
  function milkSiblings(id) {
    const self = getPerson(id);
    if (!self) return [];
    const milkChildrenOf = (pid) => (incomingTieIndex().get(pid) || []).filter((t) => t.type === 'milk-child-of').map((t) => t.person);
    const out = [];
    const seen = new Set([id]);
    const add = (p) => { if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); } };
    for (const t of Array.isArray(self.ties) ? self.ties : []) {
      if (t?.type !== 'milk-child-of') continue;
      const m = getPerson(t.person);
      if (!m) continue;
      children(m.id).forEach(add);
      milkChildrenOf(m.id).forEach(add);
    }
    for (const parent of parents(id)) milkChildrenOf(parent.id).forEach(add);
    return out;
  }

  // --- ancestry -------------------------------------------------------------------------------------
  /** Map ancestorId → depth (1 = parent), shortest path, blood only. */
  function ancestors(id) {
    const out = new Map();
    let frontier = [id];
    let depth = 0;
    const seen = new Set([id]);
    while (frontier.length) {
      depth++;
      const next = [];
      for (const x of frontier) {
        for (const p of parents(x)) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          out.set(p.id, depth);
          next.push(p.id);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Children of x through unions where x is a partner (blood line), as ids. */
  function childIdsOf(x) {
    const out = [];
    for (const u of partnerOf.get(x) || []) for (const c of childIds(u)) if (getPerson(c)) out.push(c);
    return out;
  }

  /** Map descendantId → depth (1 = child), shortest path, blood only. */
  function descendants(id) {
    const out = new Map();
    let frontier = [id];
    let depth = 0;
    const seen = new Set([id]);
    while (frontier.length) {
      depth++;
      const next = [];
      for (const x of frontier) {
        for (const c of childIdsOf(x)) {
          if (seen.has(c)) continue;
          seen.add(c);
          out.set(c, depth);
          next.push(c);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Is `a` an ancestor of `b`? */
  function isAncestor(a, b) {
    if (!a || !b || a === b) return false;
    const seen = new Set([b]);
    const stack = [b];
    while (stack.length) {
      const x = stack.pop();
      for (const p of parents(x)) {
        if (p.id === a) return true;
        if (!seen.has(p.id)) { seen.add(p.id); stack.push(p.id); }
      }
    }
    return false;
  }

  // Generations below (and including) a person: 1 = no children, 2 = children only, … (memoized, cycle-safe).
  const genMemo = new Map();
  function generationDepth(id) {
    if (!getPerson(id)) return 0;
    if (genMemo.has(id)) return genMemo.get(id);
    // Iterative post-order DFS so deep trees cannot overflow the stack.
    const onStack = new Set();
    const stack = [[id, false]];
    while (stack.length) {
      const [x, expanded] = stack.pop();
      if (genMemo.has(x) || (!expanded && onStack.has(x))) continue;
      if (expanded) {
        let best = 0;
        for (const c of childIdsOf(x)) best = Math.max(best, genMemo.get(c) || 0);
        genMemo.set(x, best + 1);
        onStack.delete(x);
        continue;
      }
      onStack.add(x);
      stack.push([x, true]);
      for (const c of childIdsOf(x)) if (!genMemo.has(c) && !onStack.has(c)) stack.push([c, false]);
    }
    return genMemo.get(id) || 0;
  }

  // --- branches -------------------------------------------------------------------------------------
  let branchCache = null;
  /**
   * Family branches (§4): parentless active people with descendants, none of whose spouses in child-bearing
   * unions has active parents (so spouses who married into a family are not branches). When both partners of
   * such a union are parentless the union is listed once, represented by the male partner (or partners[0]),
   * labelled "X & Y". Parentless couples linked through further marriages (polygamy, a wife's other husband)
   * form ONE branch, represented by the member with the most such marriages (then male, then most
   * descendants); its partner is null when it groups more than one couple.
   * → [{person, partner|null, label: {ar, en}, count}] where count = distinct blood descendants of the branch.
   * Order: the branch holding meta.rootPersonId first, then by count (desc), then by age in the data.
   */
  function branches() {
    if (branchCache) return branchCache.map((b) => ({ ...b }));
    const hasParents = (pid) => parents(pid).length > 0;
    const childBearing = (u) => childIds(u).some((c) => getPerson(c));
    const qualified = new Set();
    for (const p of visiblePeople) {
      if (hasParents(p.id)) continue;
      const bearing = (partnerOf.get(p.id) || []).filter(childBearing);
      if (!bearing.length) continue;
      const ok = bearing.every((u) => partnerIds(u).every((q) => q === p.id || !getPerson(q) || !hasParents(q)));
      if (ok) qualified.add(p.id);
    }
    // Union-find over qualified people linked by a child-bearing union.
    const parent = new Map([...qualified].map((x) => [x, x]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const degree = new Map();
    for (const u of visibleUnions) {
      if (!childBearing(u)) continue;
      const ps = partnerIds(u).filter((q) => qualified.has(q));
      if (ps.length === 2) {
        parent.set(find(ps[0]), find(ps[1]));
        for (const q of ps) degree.set(q, (degree.get(q) || 0) + 1);
      }
    }
    const groups = new Map();
    for (const x of qualified) {
      const r = find(x);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(x);
    }
    const rootId = meta.rootPersonId || '';
    const list = [];
    for (const members of groups.values()) {
      const desc = new Map();
      const descCount = new Map();
      for (const m of members) {
        const d = descendants(m);
        descCount.set(m, d.size);
        for (const k of d.keys()) desc.set(k, true);
      }
      const rep = members.slice().sort((a, b) =>
        (degree.get(b) || 0) - (degree.get(a) || 0)
        || genderRank(getPerson(a)) - genderRank(getPerson(b))
        || descCount.get(b) - descCount.get(a)
        || order.get(a) - order.get(b))[0];
      let partner = null;
      if (members.length === 2) {
        // Spec: represented by the male partner, or partners[0] of the union.
        const u = (partnerOf.get(rep) || []).find((x) => childBearing(x) && partnerIds(x).length === 2
          && partnerIds(x).every((q) => members.includes(q)));
        let a = rep;
        let b = members.find((m) => m !== rep);
        if (u) {
          const [p0, p1] = partnerIds(u);
          const g0 = getPerson(p0)?.gender;
          const g1 = getPerson(p1)?.gender;
          if (g0 === 'm' || g1 !== 'm') { a = p0; b = p1; } else { a = p1; b = p0; }
        }
        partner = getPerson(b);
        members.splice(0, members.length, a, b);
      }
      const person = getPerson(members.length === 2 ? members[0] : rep);
      const label = {};
      for (const lang of ['ar', 'en']) {
        const x = fullName(person, lang, api);
        if (!partner) label[lang] = x;
        else {
          const y = fullName(partner, lang, api);
          label[lang] = lang === 'ar' ? `${x} و${y}` : `${x} & ${y}`;
        }
      }
      const holdsRoot = !!rootId && (members.includes(rootId) || desc.has(rootId));
      list.push({ person, partner, label, count: desc.size, holdsRoot, ord: order.get(person.id) });
    }
    list.sort((a, b) => (b.holdsRoot - a.holdsRoot) || (b.count - a.count) || (a.ord - b.ord));
    branchCache = list.map(({ person, partner, label, count }) => ({ person, partner, label, count }));
    return branchCache.map((b) => ({ ...b }));
  }

  // --- stats ----------------------------------------------------------------------------------------
  let statsCache = null;
  function stats() {
    if (statsCache) return { ...statsCache };
    let living = 0;
    let deceased = 0;
    let generations = 0;
    for (const p of visiblePeople) {
      if (p.deceased) deceased++;
      else living++;
      if (!parents(p.id).length) generations = Math.max(generations, generationDepth(p.id));
    }
    statsCache = {
      people: visiblePeople.length,
      living,
      deceased,
      unions: visibleUnions.length,
      generations,
      branches: branches().length,
    };
    return { ...statsCache };
  }

  // --- search ---------------------------------------------------------------------------------------
  // Each person is indexed as "slots": slot 0 = given name, slots 1–3 = paternal ancestors' given names
  // (male line, like lineageName), plus nickname, own surname and inherited surname. Every slot holds the
  // Arabic and English spellings as alternatives; each alternative is a list of normalized tokens.
  const tokCache = new Map();
  function tokInfo(t) {
    let info = tokCache.get(t);
    if (!info) {
      const stripped = /^(ال|al|el)./.test(t) && t.length >= (/^ال/.test(t) ? 4 : 5) ? t.slice(2) : t;
      info = { n: t, ns: stripped, sk: new Set(tokenSkeletonVariants(t)) };
      tokCache.set(t, info);
    }
    return info;
  }
  function makeAlts(...texts) {
    const out = [];
    const seen = new Set();
    for (const raw of texts) {
      if (!raw || typeof raw !== 'string') continue;
      const key = searchKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const toks = key.split(' ').filter((t) => !SEARCH_CONNECTORS.has(t)).map(tokInfo);
      if (toks.length) out.push({ raw: raw.trim(), toks });
    }
    return out;
  }
  const knownName = (p, l) => (p && (p.nameStatus || 'known') === 'known' ? (p.name?.[l] || '').trim() : '');
  const kunya = (p, l) => (p && (p.nameStatus || 'known') === 'known' ? (p.nickname?.[l] || '').trim() : '');

  let searchIndex = null;
  function buildSearchIndex() {
    searchIndex = [];
    for (const p of visiblePeople) {
      const slots = [makeAlts(knownName(p, 'ar'), knownName(p, 'en'))];
      // Paternal chain (male fathers only), stopping at an unnamed father.
      let cur = p;
      const seen = new Set([p.id]);
      while (slots.length < 4) {
        const f = parentOfGender(cur.id, 'm');
        if (!f || seen.has(f.id)) break;
        seen.add(f.id);
        const alts = makeAlts(knownName(f, 'ar') || kunya(f, 'ar'), knownName(f, 'en') || kunya(f, 'en'));
        if (!alts.length) break;
        slots.push(alts);
        cur = f;
      }
      // Inherited surname: first non-empty surname along the paternal chain.
      let inherited = [];
      if (!(p.surname?.ar || p.surname?.en)) {
        const seen2 = new Set([p.id]);
        let c = parentOfGender(p.id, 'm');
        while (c && !seen2.has(c.id)) {
          seen2.add(c.id);
          if (c.surname?.ar || c.surname?.en) { inherited = makeAlts(c.surname.ar, c.surname.en); break; }
          c = parentOfGender(c.id, 'm');
        }
      }
      searchIndex.push({
        p,
        ord: order.get(p.id),
        slots,
        nick: makeAlts(p.nickname?.ar, p.nickname?.en),
        sur: makeAlts(p.surname?.ar, p.surname?.en),
        inherited,
      });
    }
    return searchIndex;
  }

  /** Match level of query token q against name token t: 3 normalized, 2 prefix (last token), 1 skeleton, 0 none. */
  function tokLevel(q, t, isLast) {
    if (q.n === t.n || q.n === t.ns || q.ns === t.n) return 3;
    if (isLast && (t.n.startsWith(q.n) || t.ns.startsWith(q.n))) return 2;
    if (q.useSk) for (const k of q.sk) if (t.sk.has(k)) return 1;
    return 0;
  }

  /** Match query tokens from qi against one alternative; partial (prefix) only at the end of the query. */
  function matchAlt(Q, qi, alt, from = 0) {
    let level = 3;
    let used = 0;
    let sim = 0; // closeness of fuzzy (skeleton) matches, to order them within their tier
    for (let j = from; j < alt.toks.length; j++) {
      const k = qi + used;
      if (k >= Q.length) return used ? { level, used, sim, partial: true } : null;
      const lv = tokLevel(Q[k], alt.toks[j], k === Q.length - 1);
      if (!lv) return null;
      if (lv === 1) sim += spellingCloseness(Q[k].n, alt.toks[j].n);
      level = Math.min(level, lv);
      used++;
      if (lv === 2) return { level, used, sim, partial: j < alt.toks.length - 1 || Q[k].n !== alt.toks[j].n };
    }
    return { level, used, sim, partial: false };
  }

  /** Best way to consume Q[qi..] with slots[s..] (skipping slots costs a gap) and an optional final surname. */
  function matchRest(Q, qi, slots, s, surnames) {
    if (qi >= Q.length) return { level: 3, gaps: 0, sim: 0, raws: [], partial: false };
    let best = null;
    const consider = (r) => {
      if (!r) return;
      if (!best || r.level > best.level || (r.level === best.level && (r.gaps < best.gaps
        || (r.gaps === best.gaps && r.sim > best.sim)))) best = r;
    };
    // the rest of the query is the family name
    for (const alt of surnames) {
      const m = matchAlt(Q, qi, alt);
      if (m && qi + m.used === Q.length) consider({ level: m.level, gaps: 0, sim: m.sim, raws: [alt.raw], partial: m.partial });
    }
    if (s < slots.length) {
      for (const alt of slots[s]) {
        const m = matchAlt(Q, qi, alt);
        if (!m) continue;
        const rest = matchRest(Q, qi + m.used, slots, s + 1, surnames);
        if (rest) consider({ level: Math.min(m.level, rest.level), gaps: rest.gaps, sim: m.sim + rest.sim, raws: [alt.raw, ...rest.raws], partial: m.partial || rest.partial });
      }
      const skip = matchRest(Q, qi, slots, s + 1, surnames);
      if (skip) consider({ ...skip, gaps: skip.gaps + 1 });
    }
    return best;
  }

  const rawJoin = (raws) => raws.join(' ').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

  /** Score one indexed person against the query (0 = no match). */
  function scoreEntry(e, Q, rawQ) {
    let best = 0;
    const take = (level, weight, r, complete) => {
      let lv = level;
      if (lv === 3 && !r.partial && rawJoin(r.raws) === rawQ) lv = 4; // exact (as typed, case-insensitive)
      const score = lv * 1000 + weight + (complete ? 60 : 0) - r.gaps * 15 + Math.min(r.raws.length, 5) * 4 + Math.min(r.sim || 0, 30);
      if (score > best) best = score;
    };
    const surnames = [...e.sur, ...e.inherited];
    // 1. given name (+ father, grandfather… + family name)
    for (const alt of e.slots[0] || []) {
      for (let from = 0; from < alt.toks.length; from++) {
        const m = matchAlt(Q, 0, alt, from);
        if (!m) continue;
        const rest = matchRest(Q, m.used, e.slots, 1, surnames);
        if (!rest) continue;
        const r = { gaps: rest.gaps, sim: m.sim + rest.sim, raws: [from ? alt.toks.slice(from).map((t) => t.n).join(' ') : alt.raw, ...rest.raws], partial: m.partial || rest.partial };
        const complete = from === 0 && !m.partial && m.used === alt.toks.length;
        take(Math.min(m.level, rest.level), from === 0 ? 300 : 120, r, complete);
      }
    }
    // 2. nickname (+ family name)
    for (const alt of e.nick) {
      const m = matchAlt(Q, 0, alt);
      if (!m) continue;
      const rest = matchRest(Q, m.used, [], 0, surnames);
      if (rest) take(Math.min(m.level, rest.level), 250, { gaps: 0, sim: m.sim + rest.sim, raws: [alt.raw, ...rest.raws], partial: m.partial || rest.partial }, !m.partial && m.used === alt.toks.length);
    }
    // 3. family name alone (own surname ranks above an inherited one)
    for (const [alts, weight] of [[e.sur, 150], [e.inherited, 40]]) {
      for (const alt of alts) {
        const m = matchAlt(Q, 0, alt);
        if (m && m.used === Q.length) take(m.level, weight, { gaps: 0, sim: m.sim, raws: [alt.raw], partial: m.partial }, !m.partial && m.used === alt.toks.length);
      }
    }
    return best;
  }

  /**
   * Search people by name: exact > normalized > skeleton (fuzzy, cross-script) across Arabic and English given
   * name, nickname, surname and lineage ("محمد احمد" finds محمد بن أحمد). The last word may be a prefix
   * (search-as-you-type). → [{person, score}] best first.
   */
  function search(query, { limit = 30 } = {}) {
    const text = typeof query === 'string' ? query.trim() : '';
    if (!text) return [];
    const out = [];
    const direct = getPerson(text);
    if (direct) out.push({ person: direct, score: 5000 });
    const Q = searchKey(text).split(' ').filter((t) => t && !SEARCH_CONNECTORS.has(t)).map((t) => {
      const info = tokInfo(t);
      // Skeletons of very short words match far too much; use them from 3 letters on.
      return { ...info, useSk: t.length >= 3 && info.sk.size > 0 };
    });
    if (Q.length) {
      const rawQ = text.split(/\s+/).filter((w) => !SEARCH_CONNECTORS.has(searchKey(w))).join(' ').toLowerCase().normalize('NFC');
      for (const e of searchIndex || buildSearchIndex()) {
        if (direct && e.p === direct) continue;
        const score = scoreEntry(e, Q, rawQ);
        if (score > 0) out.push({ person: e.p, score, ord: e.ord });
      }
    }
    out.sort((a, b) => b.score - a.score || (a.ord ?? -1) - (b.ord ?? -1));
    const n = Math.max(0, Number(limit) || 0);
    return out.slice(0, n || out.length).map(({ person, score }) => ({ person, score }));
  }

  // --- duplicates -----------------------------------------------------------------------------------
  /**
   * Pairs of active people that may be the same human: [[a, b, reason]] with reason one of
   *   "marked"            — duplicateOf already points from one to the other
   *   "same-parents"      — same name, same birth union
   *   "same-father" / "same-mother" — same name, same father / mother (different unions)
   *   "same-spouse"       — same name, married to the same person
   *   "same-lineage"      — same name, father's and grandfather's names identical
   *   "same-surname-year" — same name and surname, birth years within 2
   * "Same name" = equal normalized given name (Arabic or English) or, across languages, equal skeleton.
   */
  function duplicatesSuspects() {
    const pairs = new Map();
    const addPair = (a, b, reason) => {
      if (!a || !b || a === b) return;
      const [x, y] = order.get(a.id) <= order.get(b.id) ? [a, b] : [b, a];
      const k = `${x.id}|${y.id}`;
      if (!pairs.has(k)) pairs.set(k, [x, y, reason]);
    };
    const active = visiblePeople.filter((p) => !p.removed);
    for (const p of active) {
      const other = p.duplicateOf ? byId.get(p.duplicateOf) : null;
      if (other && !other.removed) addPair(p, other, 'marked');
    }
    const groups = new Map();
    const put = (k, p) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); };
    for (const p of active) {
      const ar = knownName(p, 'ar');
      const en = knownName(p, 'en');
      if (ar) put(`a:${searchKey(ar)}`, p);
      if (en) put(`e:${searchKey(en)}`, p);
      if (!ar || !en) {
        const sk = skeletonKey(ar || en);
        if (sk) put(`s:${sk}`, p);
      }
    }
    const nameAt = (p, l) => searchKey(knownName(p, l));
    const sameName = (a, b) => {
      for (const l of ['ar', 'en']) {
        const x = nameAt(a, l);
        const y = nameAt(b, l);
        if (x && y) return x === y;
      }
      return skeletonKey(knownName(a, 'ar') || knownName(a, 'en')) === skeletonKey(knownName(b, 'ar') || knownName(b, 'en'));
    };
    const fatherName = (p) => {
      const f = parentOfGender(p.id, 'm');
      return f ? searchKey(knownName(f, 'ar') || knownName(f, 'en')) : '';
    };
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.gender && b.gender && a.gender !== b.gender) continue;
          if (key.startsWith('s:') && !sameName(a, b)) continue;
          const ba = birthOf.get(a.id);
          const bb = birthOf.get(b.id);
          if (ba && ba === bb) { addPair(a, b, 'same-parents'); continue; }
          const fa = parentOfGender(a.id, 'm');
          const fb = parentOfGender(b.id, 'm');
          if (fa && fa === fb) { addPair(a, b, 'same-father'); continue; }
          const ma = parentOfGender(a.id, 'f');
          const mb = parentOfGender(b.id, 'f');
          if (ma && ma === mb) { addPair(a, b, 'same-mother'); continue; }
          const sa = new Set(spouses(a.id).map((s) => s.person.id));
          if (spouses(b.id).some((s) => sa.has(s.person.id))) { addPair(a, b, 'same-spouse'); continue; }
          if (fa && fb) {
            const ga = parentOfGender(fa.id, 'm');
            const gb = parentOfGender(fb.id, 'm');
            if (ga && gb && fatherName(a) && fatherName(a) === fatherName(b) && fatherName(fa) && fatherName(fa) === fatherName(fb)) {
              addPair(a, b, 'same-lineage');
              continue;
            }
          }
          const sur = (p) => searchKey(p.surname?.ar || '') || searchKey(p.surname?.en || '');
          const ya = birthYear(a);
          const yb = birthYear(b);
          if (sur(a) && sur(a) === sur(b) && ya !== null && yb !== null && Math.abs(ya - yb) <= 2) addPair(a, b, 'same-surname-year');
        }
      }
    }
    return [...pairs.values()].sort((p, q) => order.get(p[0].id) - order.get(q[0].id) || order.get(p[1].id) - order.get(q[1].id));
  }

  // --- recently added -------------------------------------------------------------------------------
  /** The n most recently added people (by their creation history entry; ties → later in the data first). */
  function recentlyAdded(n = 10) {
    const rows = visiblePeople.map((p) => {
      const h = Array.isArray(p.history) ? p.history : [];
      const created = h.find((x) => x && (x.action === 'add-person' || x.action === 'import')) || h[0] || null;
      return { p, at: created?.at || '', rev: Number(created?.rev) || 0, ord: order.get(p.id) };
    });
    rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || b.rev - a.rev || b.ord - a.ord);
    return rows.slice(0, Math.max(0, Number(n) || 0)).map((r) => r.p);
  }

  // --- resolve --------------------------------------------------------------------------------------
  /** The person for id, following removed.mergedInto (≤10 hops). Null when missing or removed (unless includeRemoved). */
  function resolve(id) {
    let p = id == null ? null : byId.get(id);
    let hops = 0;
    while (p && p.removed && p.removed.mergedInto && hops < MAX_MERGE_HOPS) {
      const next = byId.get(p.removed.mergedInto);
      if (!next || next === p) break;
      p = next;
      hops++;
    }
    return isVisiblePerson(p) ? p : null;
  }

  const api = Object.freeze({
    /** The data this graph was built from (do not mutate). */
    data,
    meta,
    includeRemoved: !!includeRemoved,
    person: getPerson,
    union: getUnion,
    people: () => visiblePeople.slice(),
    unions: () => visibleUnions.slice(),
    removedPeople: () => removedPeopleList.slice(),
    removedUnions: () => removedUnionsList.slice(),
    resolve,
    birthUnion,
    parents,
    father: (id) => parentOfGender(id, 'm'),
    mother: (id) => parentOfGender(id, 'f'),
    unionsOf: (id) => unionsOfIds(id).slice(),
    spouses,
    childrenOfUnion,
    children,
    siblings,
    ties,
    milkSiblings,
    ancestors,
    descendants,
    isAncestor,
    branches,
    generationDepth,
    stats,
    search,
    duplicatesSuspects,
    recentlyAdded,
    /** Convenience: lineageName(graph, id, lang, opts). */
    lineage: (id, lang, opts) => lineageName(api, id, lang, opts),
  });
  return api;
}
