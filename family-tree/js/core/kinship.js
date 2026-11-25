// Kinship: "what is B to A?" — finds the relationship between two people and names it in Arabic and English.
// Pure ES module — runs unchanged in modern browsers and Node ≥ 20 (no DOM, no fetch, no node: imports).
// See docs/SPEC.md §4 (kinship.js).
//
//   findRelationship(graph, aId, bId) → Relationship (plain data, see below)
//   relationLabel(rel, graph, lang, {you = true, name, showDivorce = false}) → "عمّك" / "your paternal uncle"
//   relationship(graph, aId, bId, lang, opts)  convenience: both in one call
//   pathSteps(rel, graph, lang)                the path person by person, for the "how are we related?" view
//
// Relationship = {
//   type:  "self" | "blood" | "spouse" | "affinal" | "tie" | "none",
//   a, b:  the two person ids ("what is b to a"),
//   up, down: generations from a up to the common ancestor and from it down to b (blood; for affinal: of the first
//          blood segment; 0/0 for self/spouse/tie; null for none),
//   path:  person ids from a to b (inclusive),
//   steps: [{from, to, kind: "parent"|"child"|"spouse"|"tie"}] one per edge of `path`,
//   lca:   the common ancestor (blood) — for full siblings the father (or the first parent),
//   half:  true = the two lines meet in ONE shared parent (half-siblings at the top), false = full, null = unknown
//          (single-parent / parentless family records) or not applicable,
//   via:   "father" | "mother" | null — the shared parent of the two lines when they are not known to be full,
//   side:  "paternal" | "maternal" | null — a's parent on the path (up ≥ 2), or the shared parent of half-siblings,
//   segments: [Segment] from a to b — blood segments, spouse links and tie links (the label is composed from them),
//   union?:     the union of a spouse relationship (type spouse) or of the first marriage link (affinal),
//   spouseVia?: affinal only — "a": b is a blood relative of a's spouse ("your wife's brother");
//               "b": b is the spouse of a's blood relative ("your brother's wife"); "both": anything longer,
//   tie?:       type tie only — {type: "milk-child-of"|"foster-child-of", direction: "to"|"from"|"sibling"}
// }
// Segment = {kind:"blood", from, to, up, down, lca, half, via, side, path}
//         | {kind:"spouse", from, to, union, status}
//         | {kind:"tie", from, to, type, direction, path}
//
// Choosing between several connections ("shortest path"): every edge counts one step; a blood relationship is
// preferred unless an in-law path is more than two steps shorter (so a first cousin who married your brother is
// still "your first cousin", but a fifth cousin who married your brother is "your brother's wife"); milk/foster ties
// count two extra steps. Among blood paths of equal length (cousin marriages, double cousins) the one with the
// nearest common ancestor wins, then the one through a's father, then a male common ancestor.

import { displayName } from './names.js';

// =========================================================================================================
// Small helpers

const langOf = (lang) => (lang === 'en' ? 'en' : 'ar');
const genderOf = (p) => (p && (p.gender === 'm' || p.gender === 'f') ? p.gender : '');

/** A visible person by id (following merges when the graph supports it). */
function personOf(graph, id) {
  if (!graph || id == null) return null;
  return graph.person?.(id) || graph.resolve?.(id) || null;
}

/** Distinct visible partner ids of a union. */
function partnerIds(graph, u) {
  const out = [];
  for (const pid of Array.isArray(u?.partners) ? u.partners : []) {
    if (!out.includes(pid) && personOf(graph, pid)) out.push(pid);
  }
  return out;
}

/** Child ids of x through every union where x is a partner (blood line). */
function childIdsOf(graph, x) {
  const out = [];
  for (const u of graph.unionsOf?.(x) || []) {
    for (const c of graph.childrenOfUnion?.(u.id) || []) out.push(c.id);
  }
  return out;
}

// =========================================================================================================
// Blood relationships

/**
 * Ancestors of `id` (including itself at depth 0) by breadth-first search over parents.
 * Map id → {depth, child} where `child` is the next person toward `id`. Insertion order = by depth, and within a
 * depth the father's side first (graph.parents lists the father first), which gives the paternal preference.
 */
function ancestorTree(graph, id) {
  const out = new Map([[id, { depth: 0, child: null }]]);
  let frontier = [id];
  while (frontier.length) {
    const next = [];
    for (const x of frontier) {
      const depth = out.get(x).depth + 1;
      for (const p of graph.parents?.(x) || []) {
        if (out.has(p.id)) continue;
        out.set(p.id, { depth, child: x });
        next.push(p.id);
      }
    }
    frontier = next;
  }
  return out;
}

/** Is the pair of children (on the two lines below the common ancestor) full, half or unknown siblings? */
function siblingKind(graph, x, y, lcaId) {
  const ux = graph.birthUnion?.(x);
  const uy = graph.birthUnion?.(y);
  if (!ux || !uy) return { half: null, via: null };
  const lca = personOf(graph, lcaId);
  const via = genderOf(lca) === 'm' ? 'father' : genderOf(lca) === 'f' ? 'mother' : null;
  if (ux === uy || ux.id === uy.id) {
    // Same family record: full siblings when it names both parents, else unknown.
    return partnerIds(graph, ux).length === 2 ? { half: false, via: null } : { half: null, via };
  }
  // Different family records sharing the common ancestor: clearly half when both name two parents.
  const clear = partnerIds(graph, ux).length === 2 && partnerIds(graph, uy).length === 2;
  return { half: clear ? true : null, via };
}

/**
 * Blood relationship "what is y to x": the common ancestor minimizing up + down (then smallest up, then x's
 * father's side, then a male ancestor). Returns a blood Segment or null.
 */
function bloodSegment(graph, x, y) {
  if (x === y) return { kind: 'blood', from: x, to: y, up: 0, down: 0, lca: x, half: null, via: null, side: null, path: [x] };
  const ax = ancestorTree(graph, x);
  const ay = ancestorTree(graph, y);
  let best = null;
  for (const [c, ix] of ax) {
    const iy = ay.get(c);
    if (!iy) continue;
    const total = ix.depth + iy.depth;
    if (!best || total < best.total) best = { c, up: ix.depth, down: iy.depth, total };
  }
  if (!best) return null;
  // x … c (follow child pointers of ax from c back to x), then c … y (child pointers of ay).
  const upPath = [];
  for (let cur = best.c; cur != null; cur = ax.get(cur).child) upPath.push(cur);
  upPath.reverse();
  const downPath = [];
  for (let cur = ay.get(best.c).child; cur != null; cur = ay.get(cur).child) downPath.push(cur);
  const path = [...upPath, ...downPath];
  const { up, down } = best;
  let half = null;
  let via = null;
  if (up >= 1 && down >= 1) ({ half, via } = siblingKind(graph, path[up - 1], path[up + 1], best.c));
  let side = null;
  if (up >= 2) {
    const g = genderOf(personOf(graph, path[1]));
    side = g === 'm' ? 'paternal' : g === 'f' ? 'maternal' : null;
  } else if (up === 1 && half !== false && via) {
    side = via === 'father' ? 'paternal' : 'maternal';
  }
  return { kind: 'blood', from: x, to: y, up, down, lca: best.c, half, via, side, path };
}

// Per-graph cache of blood-distance maps (graphs are immutable, so the cache never goes stale).
const distanceCache = new WeakMap();

/**
 * Blood distance (up + down) from `id` to every blood relative: Map id → steps. Multi-source breadth-first
 * search downward from every ancestor, each starting at its own depth. O(people + unions).
 */
function bloodDistances(graph, id) {
  let perGraph = distanceCache.get(graph);
  if (!perGraph) {
    perGraph = new Map();
    try { distanceCache.set(graph, perGraph); } catch { /* not an object: no cache */ }
  }
  if (perGraph.has(id)) return perGraph.get(id);
  const dist = new Map();
  const buckets = [];
  for (const [c, info] of ancestorTree(graph, id)) (buckets[info.depth] ||= []).push(c);
  for (let d = 0; d < buckets.length; d++) {
    for (const x of buckets[d] || []) {
      if (dist.has(x)) continue;
      dist.set(x, d);
      for (const c of childIdsOf(graph, x)) if (!dist.has(c)) (buckets[d + 1] ||= []).push(c);
    }
  }
  if (perGraph.size > 64) perGraph.clear();
  perGraph.set(id, dist);
  return dist;
}

// =========================================================================================================
// Spouse, in-law and tie connections

function spouseSegment(from, to, union) {
  return { kind: 'spouse', from, to, union: union.id, status: union.status || 'unknown' };
}

/** The active union in which a and b are the two partners, or null. */
function unionBetween(graph, a, b) {
  for (const s of graph.spouses?.(a) || []) if (s.person.id === b) return s.union;
  return null;
}

/**
 * Best in-law path, as segments, or null. Two shapes are searched:
 *   one marriage link:  a ~blood~ R = S ~blood~ b   (R or S may be a / b themselves)
 *   two marriage links: a = S1 ~blood~ R2 = b       (spouse of your spouse's relative; co-wives)
 * Cost = number of edges (each marriage link counts one).
 */
function affinalPath(graph, a, b) {
  const da = bloodDistances(graph, a);
  const db = bloodDistances(graph, b);
  let best = null; // {cost, pref, build}
  const consider = (cost, pref, build) => {
    if (!best || cost < best.cost || (cost === best.cost && pref < best.pref)) best = { cost, pref, build };
  };

  for (const u of graph.unions?.() || []) {
    const ps = partnerIds(graph, u);
    if (ps.length !== 2) continue;
    for (const [R, S] of [[ps[0], ps[1]], [ps[1], ps[0]]]) {
      if (S === a || R === b || (R === a && S === b)) continue;
      const dr = da.get(R);
      const ds = db.get(S);
      if (dr === undefined || ds === undefined) continue;
      // Prefer "b is the spouse of a's relative", then "b is a relative of a's spouse", then longer shapes.
      const pref = S === b ? 0 : R === a ? 1 : 2;
      consider(dr + 1 + ds, pref, () => {
        const segs = [];
        if (R !== a) segs.push(bloodSegment(graph, a, R));
        segs.push(spouseSegment(R, S, u));
        if (S !== b) segs.push(bloodSegment(graph, S, b));
        return segs;
      });
    }
  }

  for (const s1 of graph.spouses?.(a) || []) {
    for (const r2 of graph.spouses?.(b) || []) {
      const S1 = s1.person.id;
      const R2 = r2.person.id;
      if (S1 === b || R2 === a || s1.union === r2.union) continue;
      if (S1 === R2) {
        consider(2, 3, () => [spouseSegment(a, S1, s1.union), spouseSegment(S1, b, r2.union)]);
        continue;
      }
      const seg = bloodSegment(graph, S1, R2);
      if (!seg) continue;
      consider(2 + seg.up + seg.down, 3, () => [spouseSegment(a, S1, s1.union), seg, spouseSegment(R2, b, r2.union)]);
    }
  }
  if (!best) return null;
  const segments = best.build();
  return { cost: best.cost, segments };
}

/** Milk / foster tie between a and b, as a segment, or null. Direct ties first, then milk siblings. */
function tieSegment(graph, a, b) {
  for (const t of graph.ties?.(a) || []) {
    if (t.person?.id === b) return { kind: 'tie', from: a, to: b, type: t.type, direction: t.direction, path: [a, b] };
  }
  const milk = graph.milkSiblings?.(a) || [];
  if (!milk.some((p) => p.id === b)) return null;
  // Find the person who links them: a's milk mother (b is her child or milk child), or a's parent (b is their milk child).
  let link = null;
  const self = personOf(graph, a);
  for (const t of Array.isArray(self?.ties) ? self.ties : []) {
    if (t?.type !== 'milk-child-of') continue;
    const m = t.person;
    const isChild = childIdsOf(graph, m).includes(b);
    const isMilkChild = (personOf(graph, b)?.ties || []).some((x) => x?.type === 'milk-child-of' && x.person === m);
    if (isChild || isMilkChild) { link = m; break; }
  }
  if (!link) {
    const bt = personOf(graph, b)?.ties || [];
    for (const p of graph.parents?.(a) || []) {
      if (bt.some((x) => x?.type === 'milk-child-of' && x.person === p.id)) { link = p.id; break; }
    }
  }
  return { kind: 'tie', from: a, to: b, type: 'milk-child-of', direction: 'sibling', path: link ? [a, link, b] : [a, b] };
}

// =========================================================================================================
// findRelationship

function emptyRel(type, a, b) {
  return {
    type, a, b, up: null, down: null, path: [], steps: [], lca: null, half: null, via: null, side: null, segments: [],
  };
}

/** Edges of a segment as steps. */
function segmentSteps(graph, seg) {
  if (seg.kind === 'spouse') return [{ from: seg.from, to: seg.to, kind: 'spouse' }];
  if (seg.kind === 'tie') {
    const out = [];
    for (let i = 1; i < seg.path.length; i++) out.push({ from: seg.path[i - 1], to: seg.path[i], kind: 'tie' });
    return out;
  }
  const out = [];
  for (let i = 1; i < seg.path.length; i++) {
    out.push({ from: seg.path[i - 1], to: seg.path[i], kind: i <= seg.up ? 'parent' : 'child' });
  }
  return out;
}

/** Assemble a Relationship from segments. */
function fromSegments(graph, type, a, b, segments, extra = {}) {
  const rel = emptyRel(type, a, b);
  rel.segments = segments;
  const path = [a];
  for (const seg of segments) {
    const p = seg.kind === 'spouse' ? [seg.from, seg.to] : seg.path;
    for (let i = 1; i < p.length; i++) path.push(p[i]);
  }
  rel.path = path;
  rel.steps = segments.flatMap((s) => segmentSteps(graph, s));
  const blood = segments.find((s) => s.kind === 'blood');
  if (blood) {
    for (const k of ['up', 'down', 'lca', 'half', 'via', 'side']) rel[k] = blood[k];
  } else {
    rel.up = 0;
    rel.down = 0;
  }
  return Object.assign(rel, extra);
}

/**
 * What is b to a? See the header comment for the result shape and how competing paths are chosen.
 * Unknown / removed ids give type "none".
 */
export function findRelationship(graph, aId, bId) {
  const pa = personOf(graph, aId);
  const pb = personOf(graph, bId);
  if (!pa || !pb) return emptyRel('none', pa?.id ?? aId ?? null, pb?.id ?? bId ?? null);
  const a = pa.id;
  const b = pb.id;
  if (a === b) return { ...emptyRel('self', a, b), up: 0, down: 0, path: [a] };

  const union = unionBetween(graph, a, b);
  if (union) {
    const seg = spouseSegment(a, b, union);
    return fromSegments(graph, 'spouse', a, b, [seg], { union: union.id, status: seg.status });
  }

  const blood = bloodSegment(graph, a, b);
  const bloodCost = blood ? blood.up + blood.down - 2 : Infinity; // blood preferred by two steps
  // Close blood relatives cannot be beaten (an in-law path has ≥ 2 edges, a tie costs ≥ 3): skip the searches.
  const affinal = bloodCost > 2 ? affinalPath(graph, a, b) : null;
  const tie = bloodCost > 3 ? tieSegment(graph, a, b) : null;

  const candidates = [];
  if (blood) candidates.push({ cost: bloodCost, rank: 0, make: () => fromSegments(graph, 'blood', a, b, [blood]) });
  if (tie) {
    const cost = (tie.direction === 'sibling' ? 2 : 1) + 2;
    candidates.push({
      cost, rank: 1,
      make: () => fromSegments(graph, 'tie', a, b, [tie], { tie: { type: tie.type, direction: tie.direction } }),
    });
  }
  if (affinal) {
    candidates.push({
      cost: affinal.cost, rank: 2,
      make: () => {
        const segs = affinal.segments;
        const spouses = segs.filter((s) => s.kind === 'spouse');
        const spouseVia = spouses.length > 1 ? 'both'
          : segs[0].kind === 'spouse' ? 'a'
            : segs[segs.length - 1].kind === 'spouse' ? 'b' : 'both';
        return fromSegments(graph, 'affinal', a, b, segs, { spouseVia, union: spouses[0].union });
      },
    });
  }
  if (!candidates.length) return emptyRel('none', a, b);
  candidates.sort((x, y) => x.cost - y.cost || x.rank - y.rank);
  return candidates[0].make();
}

// =========================================================================================================
// Arabic labels
//
// A label is an idafa chain read from b back to a: "ابن ابن عمّ والدك" = b is the son of the son of the paternal
// uncle of your father. Each link is a token {key, g}; the first token is nominative, the others genitive; the
// last one takes the pronoun suffix ("ك") or is followed by the name ("عمّ أحمد"). Modifiers that describe b
// ("الراحل", "من الرضاعة") follow the chain; a side qualifier ("لأبيك") describing the link next to a comes last.

const AR_WORDS = {
  parent: { m: 'والد', f: 'والدة', n: 'أحد والدَي' },
  grandparent: { m: 'جدّ', f: 'جدّة', n: 'أحد أجداد' },
  child: { m: 'ابن', f: 'ابنة', n: 'أحد أبناء' },
  grandchild: { m: 'حفيد', f: 'حفيدة', n: 'أحد أحفاد' },
  sibling: { m: 'أخ', f: 'أخت', n: 'أحد إخوة' },
  fullSibling: { m: 'شقيق', f: 'شقيقة', n: 'أحد أشقاء' },
  uncleP: { m: 'عمّ', f: 'عمّة', n: 'أحد أعمام' },
  uncleM: { m: 'خال', f: 'خالة', n: 'أحد أخوال' },
  spouse: { m: 'زوج', f: 'زوجة', n: 'زوج' },
  widow: { m: 'أرمل', f: 'أرملة', n: 'أرمل' },
  parentInLaw: { m: 'حم', f: 'حماة', n: 'أحد والدَي' },
  milkParent: { m: 'أب', f: 'أم', n: 'أحد والدَي' },
  fosterParent: { m: 'كافل', f: 'كافلة', n: 'كافل' },
  fosterChild: { m: 'مكفول', f: 'مكفولة', n: 'مكفول' },
  relative: { m: 'قريب', f: 'قريبة', n: 'أحد أقارب' },
};

// The "five nouns" change their ending with case: أخو (nominative construct) / أخي (genitive construct).
const FIVE_NOUNS = { 'أخ': ['أخو', 'أخي'], 'أب': ['أبو', 'أبي'], 'حم': ['حمو', 'حمي'] };

const AR_MODIFIERS = {
  late: { m: 'الراحل', f: 'الراحلة', n: 'الراحل' },
  former: { m: 'السابق', f: 'السابقة', n: 'السابق' },
  milk: { m: 'من الرضاعة', f: 'من الرضاعة', n: 'من الرضاعة' },
  inLaw: { m: 'بالمصاهرة', f: 'بالمصاهرة', n: 'بالمصاهرة' },
};

// "لأبيك" = on your father's side (grandparents) / through your father (half-siblings).
const AR_QUALIFIERS = {
  paternal: { you: 'لأبيك', m: 'لأبيه', f: 'لأبيها' },
  maternal: { you: 'لأمك', m: 'لأمه', f: 'لأمها' },
};

const tok = (key, person, extra) => ({ key, g: genderOf(person), ...extra });

/** Attach a pronoun suffix (ك / ه / ها) to the last word of a phrase with Arabic spelling rules. */
function attachSuffix(phrase, suffix) {
  const words = phrase.split(' ');
  let w = words.pop();
  if (w.endsWith('ة')) w = `${w.slice(0, -1)}ت`;
  else if (w.endsWith('اء')) w = `${w.slice(0, -1)}ئ`; // أبناء → أبنائك (genitive after أحد)
  w = w.replace(/َ/g, ''); // والدَي + ك → والديك
  words.push(w + suffix);
  return words.join(' ');
}

/** Render one token: case "nom" | "gen", followed by a suffix (string) or by another word (suffix null). */
function renderToken(t, kase, suffix, beforeName = false) {
  // "زوجة أخي محمد" reads as "my brother Muhammad's wife": a full brother right before a name is شقيق instead.
  const key = beforeName && kase === 'gen' && t.key === 'sibling' && t.full && t.g === 'm' ? 'fullSibling' : t.key;
  let word = AR_WORDS[key][t.g || 'n'];
  const five = FIVE_NOUNS[word];
  if (five) word = five[kase === 'nom' ? 0 : 1];
  return suffix ? attachSuffix(word, suffix) : word;
}

/**
 * Render a token chain. owner = {suffix:"ك"} (you) or {name:"أحمد"}.
 * modifier: key of AR_MODIFIERS (agrees with the head token); qualifier: "paternal" | "maternal" (the pronoun
 * refers to a: لأبيك / لأبيه / لأبيها by a's gender).
 */
function renderArabic(tokens, owner, { modifier = null, qualifier = null, ownerGender = '' } = {}) {
  const parts = tokens.map((t, i) => {
    const last = i === tokens.length - 1;
    return renderToken(t, i === 0 ? 'nom' : 'gen', last && owner.suffix ? owner.suffix : null, last && !owner.suffix);
  });
  let text = parts.join(' ');
  if (!owner.suffix) text += ` ${owner.name}`;
  if (modifier) text += ` ${AR_MODIFIERS[modifier][tokens[0].g || 'n']}`;
  if (qualifier) {
    const q = AR_QUALIFIERS[qualifier];
    text += ` ${owner.suffix ? q.you : ownerGender === 'f' ? q.f : q.m}`;
  }
  return text;
}

/** Tokens describing path[k] (an ancestor) relative to path[0]: والد / جدّ / جدّ والد / جدّ جدّ … */
function ancestorTokens(graph, path, k) {
  const out = [];
  while (k > 0) {
    if (k === 1) {
      out.push(tok('parent', personOf(graph, path[1])));
      k = 0;
    } else {
      out.push(tok('grandparent', personOf(graph, path[k])));
      k -= 2;
    }
  }
  return out;
}

/** Tokens describing the person `n` generations below the anchor: ابن / حفيد / حفيد ابن … (at(j) = person j below). */
function descendantTokens(graph, at, n) {
  const out = [];
  while (n > 0) {
    if (n === 1) {
      out.push(tok('child', personOf(graph, at(1))));
      n = 0;
    } else {
      out.push(tok('grandchild', personOf(graph, at(n))));
      n -= 2;
    }
  }
  return out;
}

const sideOf = (person) => (genderOf(person) === 'm' ? 'paternal' : genderOf(person) === 'f' ? 'maternal' : null);

/**
 * Arabic tokens of a blood segment (b relative to a), plus the side qualifier of the link next to a.
 * isHead: the segment is the whole relationship (pure blood) — a full sibling is then شقيق/شقيقة; inside in-law
 * chains the everyday أخ/أخت reads better ("أخو زوجك").
 */
function bloodTokens(graph, seg, isHead) {
  const { up, down, path } = seg;
  const P = (i) => personOf(graph, path[i]);
  if (down === 0) {
    const tokens = ancestorTokens(graph, path, up);
    const qualifier = up % 2 === 0 ? sideOf(P(1)) : null; // "جدّك لأبيك"
    return { tokens, qualifier };
  }
  if (up === 0) return { tokens: descendantTokens(graph, (j) => path[j], down), qualifier: null };

  const tokens = [];
  for (let j = down; j >= 2; j--) tokens.push(tok('child', P(up + j)));
  const s = P(up + 1); // child of the common ancestor on b's side
  let qualifier = null;
  if (up === 1) {
    tokens.push(tok(isHead && down === 1 && seg.half === false ? 'fullSibling' : 'sibling', s, { full: seg.half === false }));
    if (seg.half === true && seg.via) qualifier = seg.via === 'father' ? 'paternal' : 'maternal';
  } else {
    const t = P(up - 1); // child of the common ancestor on a's side
    const tg = genderOf(t);
    if (tg && genderOf(s)) tokens.push(tok(tg === 'm' ? 'uncleP' : 'uncleM', s));
    else tokens.push(tok('sibling', s), tok('parent', t));
    tokens.push(...ancestorTokens(graph, path, up - 2));
    if (up > 2 && (up - 2) % 2 === 0) qualifier = sideOf(P(1)); // "عمّ جدّك لأبيك"
  }
  return { tokens, qualifier };
}

/** Arabic tokens of a tie segment (b relative to a) and the modifier. */
function tieTokens(graph, seg) {
  const b = personOf(graph, seg.to);
  if (seg.direction === 'sibling') return { tokens: [tok('sibling', b)], modifier: 'milk' };
  const milk = seg.type === 'milk-child-of';
  if (seg.direction === 'to') return milk ? { tokens: [tok('milkParent', b)], modifier: 'milk' } : { tokens: [tok('fosterParent', b)] };
  return milk ? { tokens: [tok('child', b)], modifier: 'milk' } : { tokens: [tok('fosterChild', b)] };
}

/** How a spouse link is qualified: late (b deceased), former (divorced, when shown), widow (a deceased). */
function spouseState(graph, seg, showDivorce) {
  const from = personOf(graph, seg.from);
  const to = personOf(graph, seg.to);
  if (seg.status === 'divorced') return showDivorce ? 'former' : null;
  if (to?.deceased) return 'late';
  if (from?.deceased && (seg.status === 'married' || seg.status === 'widowed')) return 'widow';
  return null;
}

const isBlood = (s, up, down) => s && s.kind === 'blood' && s.up === up && s.down === down;

/** Arabic label of a relationship. */
function arabicLabel(rel, graph, owner, ownerGender, showDivorce) {
  const segs = rel.segments;
  // Build tokens from b back to a. Index i walks the segments from the b end.
  const tokens = [];
  let modifier = null;
  let qualifier = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    const isHead = i === segs.length - 1;
    if (seg.kind === 'blood') {
      // In-law compression: the parent of a spouse is حمو / حماة.
      const prev = segs[i - 1];
      if (isBlood(seg, 1, 0) && prev?.kind === 'spouse' && genderOf(personOf(graph, seg.to))) {
        tokens.push(tok('parentInLaw', personOf(graph, seg.to)));
        i--; // the spouse link is part of the word
        continue;
      }
      const r = bloodTokens(graph, seg, segs.length === 1);
      tokens.push(...r.tokens);
      if (i === 0) qualifier = r.qualifier;
    } else if (seg.kind === 'spouse') {
      const state = isHead ? spouseState(graph, seg, showDivorce) : null;
      if (state === 'widow') tokens.push(tok('widow', personOf(graph, seg.to)));
      else {
        tokens.push(tok('spouse', personOf(graph, seg.to)));
        if (state) modifier = state;
      }
    } else if (seg.kind === 'tie') {
      const r = tieTokens(graph, seg);
      tokens.push(...r.tokens);
      if (isHead && r.modifier) modifier = r.modifier;
    }
  }
  // Very long chains read badly: fall back to "قريبك (الجدّ المشترك: …)" / "قريبك بالمصاهرة".
  if (tokens.length > 7) {
    const b = personOf(graph, rel.b);
    const text = renderArabic([tok('relative', b)], owner, { modifier: rel.type === 'affinal' ? 'inLaw' : null });
    const lca = rel.type === 'blood' ? personOf(graph, rel.lca) : null;
    const lcaName = lca ? displayName(lca, 'ar', graph) : '';
    if (!lcaName) return text;
    return `${text} (${genderOf(lca) === 'f' ? 'الجدّة المشتركة' : 'الجدّ المشترك'}: ${lcaName})`;
  }
  return renderArabic(tokens, owner, { modifier, qualifier, ownerGender });
}

// =========================================================================================================
// English labels

const EN_WORDS = {
  parent: { m: 'father', f: 'mother', n: 'parent' },
  grandparent: { m: 'grandfather', f: 'grandmother', n: 'grandparent' },
  child: { m: 'son', f: 'daughter', n: 'child' },
  grandchild: { m: 'grandson', f: 'granddaughter', n: 'grandchild' },
  sibling: { m: 'brother', f: 'sister', n: 'sibling' },
  uncle: { m: 'uncle', f: 'aunt', n: '' },
  nephew: { m: 'nephew', f: 'niece', n: '' },
  grandnephew: { m: 'grandnephew', f: 'grandniece', n: '' },
  spouse: { m: 'husband', f: 'wife', n: 'spouse' },
  widow: { m: 'widower', f: 'widow', n: 'surviving spouse' },
  parentInLaw: { m: 'father-in-law', f: 'mother-in-law', n: 'parent-in-law' },
  siblingInLaw: { m: 'brother-in-law', f: 'sister-in-law', n: 'sibling-in-law' },
  childInLaw: { m: 'son-in-law', f: 'daughter-in-law', n: 'child-in-law' },
  stepParent: { m: 'stepfather', f: 'stepmother', n: 'step-parent' },
  stepChild: { m: 'stepson', f: 'stepdaughter', n: 'stepchild' },
  milkParent: { m: 'milk father', f: 'milk mother', n: 'milk parent' },
  milkChild: { m: 'milk son', f: 'milk daughter', n: 'milk child' },
  milkSibling: { m: 'milk brother', f: 'milk sister', n: 'milk sibling' },
  fosterParent: { m: 'foster father', f: 'foster mother', n: 'foster parent' },
  fosterChild: { m: 'foster son', f: 'foster daughter', n: 'foster child' },
};

const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const TIMES_WORDS = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times',
  'eight times', 'nine times', 'ten times'];

function ordinalNumber(n) {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix}`;
}

/** "great-" prefixes: 1 → "great-", 2 → "great-great-", 3 → "3rd great-". */
function greats(count) {
  if (count <= 0) return '';
  if (count === 1) return 'great-';
  if (count === 2) return 'great-great-';
  return `${ordinalNumber(count)} great-`;
}

const enWord = (key, person) => EN_WORDS[key][genderOf(person) || 'n'];
const sidePrefix = (side) => (side ? `${side} ` : '');

/**
 * English noun phrases ("units") of a blood segment, joined later as a possessive chain. Usually one unit
 * ("paternal uncle", "second cousin once removed"); two when b's gender is unknown and English has no neutral
 * word ("father" + "sibling" → "your father's sibling").
 */
function bloodUnitsEn(graph, seg) {
  const { up, down, path, side } = seg;
  const P = (i) => personOf(graph, path[i]);
  const b = P(path.length - 1);
  const g = genderOf(b);
  if (down === 0) {
    if (up === 1) return [enWord('parent', b)];
    return [`${sidePrefix(side)}${greats(up - 2)}${enWord('grandparent', b)}`];
  }
  if (up === 0) {
    if (down === 1) return [enWord('child', b)];
    return [`${greats(down - 2)}${enWord('grandchild', b)}`];
  }
  if (up === 1 && down === 1) {
    const w = enWord('sibling', b);
    return [seg.half === true && seg.via ? `half-${w} (same ${seg.via})` : w];
  }
  if (down === 1) {
    // uncle / aunt, great-uncle …; neutral → "your father's sibling"
    if (g) return [`${sidePrefix(side)}${greats(up - 2)}${EN_WORDS.uncle[g]}`];
    const anc = { ...seg, down: 0, up: up - 1, path: path.slice(0, up) };
    return [...bloodUnitsEn(graph, anc), 'sibling'];
  }
  if (up === 1) {
    // nephew / niece, grandnephew …; neutral → "your brother's child"
    if (g) {
      if (down === 2) return [EN_WORDS.nephew[g]];
      return [`${greats(down - 3)}${EN_WORDS.grandnephew[g]}`];
    }
    const s = P(2);
    const desc = down - 1 === 1 ? 'child' : `${greats(down - 3)}grandchild`;
    return [enWord('sibling', s), desc];
  }
  // cousins
  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  const ord = ORDINAL_WORDS[degree] || ordinalNumber(degree);
  const rem = removed ? ` ${TIMES_WORDS[removed] || `${removed} times`} removed` : '';
  return [`${ord} cousin${rem}`];
}

/** English units of a spouse segment (b relative to a). */
function spouseUnitEn(graph, seg, state) {
  const to = personOf(graph, seg.to);
  if (state === 'widow') return enWord('widow', to);
  const w = enWord('spouse', to);
  return state === 'late' ? `late ${w}` : state === 'former' ? `former ${w}` : w;
}

function tieUnitEn(graph, seg) {
  const b = personOf(graph, seg.to);
  if (seg.direction === 'sibling') return enWord('milkSibling', b);
  const milk = seg.type === 'milk-child-of';
  if (seg.direction === 'to') return enWord(milk ? 'milkParent' : 'fosterParent', b);
  return enWord(milk ? 'milkChild' : 'fosterChild', b);
}

/** English label of a relationship. possessor = "your" | "Ahmed's". */
function englishLabel(rel, graph, possessor, showDivorce) {
  const segs = rel.segments;
  // Units from a to b; in-law pairs collapse into one word (father-in-law, brother-in-law, stepson …).
  const units = [];
  let lastIsSpouse = false;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const next = segs[i + 1];
    const isLast = (k) => k === segs.length - 1;
    if (seg.kind === 'spouse' && next?.kind === 'blood') {
      const target = personOf(graph, next.to);
      const pair = isBlood(next, 1, 0) ? 'parentInLaw' : isBlood(next, 1, 1) ? 'siblingInLaw' : isBlood(next, 0, 1) ? 'stepChild' : null;
      if (pair) {
        units.push(enWord(pair, target));
        lastIsSpouse = false;
        i++;
        continue;
      }
    }
    if (seg.kind === 'blood' && next?.kind === 'spouse' && isLast(i + 1)) {
      const target = personOf(graph, next.to);
      const pair = isBlood(seg, 1, 1) ? 'siblingInLaw' : isBlood(seg, 0, 1) ? 'childInLaw' : isBlood(seg, 1, 0) ? 'stepParent' : null;
      if (pair) {
        units.push(enWord(pair, target));
        lastIsSpouse = false;
        i++;
        continue;
      }
    }
    if (seg.kind === 'blood') {
      units.push(...bloodUnitsEn(graph, seg));
      lastIsSpouse = false;
    } else if (seg.kind === 'spouse') {
      const state = isLast(i) ? spouseState(graph, seg, showDivorce) : null;
      // co-wives / co-husbands: "your husband's other wife"
      const prev = segs[i - 1];
      const unit = spouseUnitEn(graph, seg, state);
      units.push(prev?.kind === 'spouse' && prev.from !== seg.to ? `other ${unit}` : unit);
      lastIsSpouse = true;
    } else if (seg.kind === 'tie') {
      units.push(tieUnitEn(graph, seg));
      lastIsSpouse = false;
    }
  }
  if (units.length > 4) return `${possessor} ${rel.type === 'affinal' ? 'relative by marriage' : 'relative'}`;
  const chain = (list) => `${possessor} ${list.join("'s ")}`;
  if (units.length >= 2 && lastIsSpouse && !units[units.length - 1].startsWith('other ')) {
    // "wife of your paternal uncle"
    return `${units[units.length - 1]} of ${chain(units.slice(0, -1))}`;
  }
  return chain(units);
}

// =========================================================================================================
// relationLabel

/**
 * Name a relationship ("what is b to a").
 *   you:true  → EN "your paternal uncle", AR "عمّك" (the suffix ك is the same for both genders when unvowelled)
 *   you:false → EN "Ahmed's paternal uncle", AR "عمّ أحمد"; `name` defaults to a's display name.
 *   showDivorce: say "former" for divorced spouses (config.showDivorce); otherwise they read like any marriage.
 */
export function relationLabel(rel, graph, lang = 'ar', { you = true, name, showDivorce = false } = {}) {
  const L = langOf(lang);
  if (!rel) return '';
  const aPerson = personOf(graph, rel.a);
  const ownerName = you ? '' : (name || displayName(aPerson, L, graph) || (L === 'ar' ? 'غير معروف' : 'Unknown'));
  if (rel.type === 'self') return you ? (L === 'ar' ? 'أنت' : 'you') : ownerName;
  if (rel.type === 'none' || !rel.segments?.length) {
    if (L === 'ar') return you ? 'لا توجد صلة قرابة معروفة' : `لا توجد صلة قرابة معروفة مع ${ownerName}`;
    return you ? 'no known relation' : `no known relation to ${ownerName}`;
  }
  if (L === 'ar') {
    const owner = you ? { suffix: 'ك' } : { name: ownerName };
    return arabicLabel(rel, graph, owner, genderOf(aPerson), showDivorce);
  }
  return englishLabel(rel, graph, you ? 'your' : `${ownerName}'s`, showDivorce);
}

/** Convenience: findRelationship + relationLabel. */
export function relationship(graph, aId, bId, lang = 'ar', opts = {}) {
  const rel = findRelationship(graph, aId, bId);
  return { rel, label: relationLabel(rel, graph, lang, opts) };
}

// =========================================================================================================
// Path steps (for the relationship view)

// Stand-alone role words (no possessor follows, so the neutral Arabic forms differ from AR_WORDS).
const ROLE_WORDS = {
  ar: {
    parent: { m: 'والد', f: 'والدة', n: 'أحد الوالدين' },
    child: { m: 'ابن', f: 'ابنة', n: 'من الأبناء' },
    spouse: { m: 'زوج', f: 'زوجة', n: 'زوج' },
    milkParent: { m: 'أب من الرضاعة', f: 'أم من الرضاعة', n: 'من الرضاعة' },
    milkChild: { m: 'ابن من الرضاعة', f: 'ابنة من الرضاعة', n: 'من الرضاعة' },
    fosterParent: AR_WORDS.fosterParent,
    fosterChild: AR_WORDS.fosterChild,
  },
  en: EN_WORDS,
};

/** What `to` is to `from` along one edge of a path: parent / child / spouse / milk or foster parent / child. */
function stepKey(graph, step) {
  if (step.kind !== 'tie') return step.kind;
  const from = personOf(graph, step.from);
  const to = personOf(graph, step.to);
  const tieTo = (x, y) => (Array.isArray(x?.ties) ? x.ties : []).find((t) => t?.person === y?.id);
  const up = tieTo(from, to); // `to` nursed / raised `from`
  if (up) return up.type === 'foster-child-of' ? 'fosterParent' : 'milkParent';
  const down = tieTo(to, from); // `from` nursed / raised `to`
  if (down) return down.type === 'foster-child-of' ? 'fosterChild' : 'milkChild';
  // A biological link inside a milk-sibling path.
  return (graph.parents?.(step.from) || []).some((p) => p.id === step.to) ? 'parent' : 'child';
}

/**
 * The path person by person: [{id, person, role}] where role says what this person is to the previous one
 * ("father", "daughter", "wife", "milk mother" / "والد", "ابنة", "زوجة", "أم من الرضاعة"); the first has role "".
 */
export function pathSteps(rel, graph, lang = 'ar') {
  const L = langOf(lang);
  if (!rel?.path?.length) return [];
  const out = [{ id: rel.path[0], person: personOf(graph, rel.path[0]), role: '' }];
  for (const step of rel.steps || []) {
    const p = personOf(graph, step.to);
    const role = ROLE_WORDS[L][stepKey(graph, step)][genderOf(p) || 'n'];
    out.push({ id: step.to, person: p, role });
  }
  return out;
}
