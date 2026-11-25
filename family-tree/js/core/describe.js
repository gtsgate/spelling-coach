// Describe: one-line, plain-text descriptions of proposal operations in Arabic and English, and a summary of a
// whole proposal (title, lines, counts). Used by the draft page, the WhatsApp text, the GitHub issue and bot
// comments, and the changelog.
// Pure ES module — runs unchanged in modern browsers and Node ≥ 20 (no DOM, no fetch, no node: imports).
// See docs/SPEC.md §3.3 / §3.4 (operations) and §4 (describe.js).
//
//   describeOp(op, ctx, lang)          ctx = {graph, refNames}; e.g. EN Add “Ahmed” as son of Muhammad Ahmed Alem
//                                                                    AR إضافة «أحمد» ابناً لـ محمد أحمد عالم
//   refNames(proposalOrOps, graph?)    temp refs → what describe needs to name them ("new3" → its PersonInput,
//                                      "newu4" → the partners of the union it binds)
//   describeProposal(p, graph, lang)   → {title, lines, destructive, counts: {add, edit, mark, arrange, remove}}
//   opCategory(type)                   "add" | "edit" | "mark" | "arrange" | "remove" | null
//
// People already in the tree are named by their lineage (given + father + family name); people added by the
// proposal are quoted («أحمد» / “Ahmed”). Arabic agrees with gender (ابناً/ابنةً، زوجاً/زوجةً، والداً/والدةً).
// Removals only ever show the label of their reason code — never free text.

import { fullName } from './names.js';
import { formatDate, yearsLabel } from './dates.js';
import { DESTRUCTIVE_OPS } from './schema.js';
import {
  fieldLabel, findPerson, findUnion, listText, personLabel, quote, reasonLabel, unionLabel, unionPartnerRefs, valueLabel,
} from './messages.js';

// =========================================================================================================
// Helpers

const langOf = (lang) => (lang === 'en' ? 'en' : 'ar');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const isTempRef = (s) => typeof s === 'string' && /^new[0-9]+$/.test(s);

function shorten(s, max = 40) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Append parenthetical notes: "text (a; b)" / "text (أ؛ ب)". */
function withNotes(text, notes, L) {
  const list = notes.filter(Boolean);
  if (!list.length) return text;
  return `${text} (${list.join(L === 'en' ? '; ' : '؛ ')})`;
}

/** Arabic counted noun with correct number agreement. forms = {one, two, few, many}. */
function arCount(n, forms) {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} ${forms.few}`;
  if (r >= 11 && r <= 99) return `${n} ${forms.many}`;
  return `${n} ${forms.hundred || forms.many}`;
}

/** English counted noun. */
const enCount = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Description context: graph, refNames and the language, with naming helpers. */
function makeCtx(ctx, L) {
  const graph = ctx?.graph || null;
  const names = ctx?.refNames || {};
  const c = { graph, refNames: names };
  const entryOf = (ref) => (names instanceof Map ? names.get(ref) : isObj(names) ? names[ref] : undefined);
  const inputOf = (ref) => {
    const e = entryOf(ref);
    if (isObj(e)) return isObj(e.person) ? e.person : ('name' in e || 'gender' in e || 'nameStatus' in e ? e : null);
    return null;
  };
  return {
    L,
    graph,
    c,
    /** Name of any person reference (existing → lineage; new → quoted name). */
    N: (ref) => personLabel(ref, L, c) || (L === 'en' ? 'someone' : 'أحد الأشخاص'),
    /** Short name for lists of siblings / spouses: given name (+ nickname) or the quoted new name. */
    short: (ref) => {
      if (isTempRef(ref)) return personLabel(ref, L, c);
      const p = findPerson(graph, ref);
      if (!p) return personLabel(ref, L, c);
      return fullName(p, L, graph) || personLabel(ref, L, c);
    },
    /** Gender of a person reference: "m" | "f" | "". */
    G: (ref) => {
      const input = inputOf(ref);
      const g = input ? input.gender : findPerson(graph, ref)?.gender;
      return g === 'm' || g === 'f' ? g : '';
    },
    U: (uid) => unionLabel(uid, L, c),
    partnersOf: (uid) => unionPartnerRefs(uid, c),
  };
}

// Relation words in Arabic: accusative (after a verbal noun: "إضافة «أحمد» ابناً") and plain (indefinite
// genitive: "إضافة ابن لـ …"); English nouns. n = gender unknown.
const REL = {
  child: {
    acc: { m: 'ابناً', f: 'ابنةً' }, gen: { m: 'ابن', f: 'ابنة', n: 'فرد' }, group: 'أبناء',
    en: { m: 'son', f: 'daughter', n: 'child' },
  },
  spouse: {
    acc: { m: 'زوجاً', f: 'زوجةً', n: 'زوجاً' }, gen: { m: 'زوج', f: 'زوجة', n: 'زوج' },
    en: { m: 'husband', f: 'wife', n: 'spouse' },
  },
  formerSpouse: {
    acc: { m: 'زوجاً سابقاً', f: 'زوجةً سابقةً', n: 'زوجاً سابقاً' }, gen: { m: 'زوج سابق', f: 'زوجة سابقة', n: 'زوج سابق' },
    en: { m: 'former husband', f: 'former wife', n: 'former spouse' },
  },
  parent: {
    acc: { m: 'والداً', f: 'والدةً' }, gen: { m: 'والد', f: 'والدة', n: 'فرد' }, group: 'والدَي',
    en: { m: 'father', f: 'mother', n: 'parent' },
  },
  sibling: {
    acc: { m: 'أخاً', f: 'أختاً' }, gen: { m: 'أخ', f: 'أخت', n: 'فرد' }, group: 'إخوة',
    en: { m: 'brother', f: 'sister', n: 'sibling' },
  },
  fullSibling: {
    acc: { m: 'شقيقاً', f: 'شقيقةً' }, gen: { m: 'شقيق', f: 'شقيقة', n: 'فرد' }, group: 'أشقاء',
    en: { m: 'brother', f: 'sister', n: 'sibling' },
  },
};

const NAME_NOTE = {
  unknown: { en: 'name not known', ar: 'الاسم غير معروف' },
  withheld: { en: 'name withheld', ar: 'الاسم محجوب' },
};

// =========================================================================================================
// refNames

/**
 * What describe needs to name the temp refs of a proposal (or a list of ops):
 *   "new3"  → {person: PersonInput, link, op}            (declared by add-person)
 *   "newu4" → {partners: [PersonRef…]}                    (bound by an op's unionRef)
 * With a graph, unions found through an existing person (add parent / sibling) get their partners too.
 */
export function refNames(proposalOrOps, graph = null) {
  const ops = Array.isArray(proposalOrOps) ? proposalOrOps : Array.isArray(proposalOrOps?.ops) ? proposalOrOps.ops : [];
  const out = {};
  const birthPartners = (ref) => {
    const b = graph && !isTempRef(ref) ? graph.birthUnion?.(ref) : null;
    return b ? [...new Set(b.partners || [])] : null;
  };
  const parentOf = (ref, g) => (graph && !isTempRef(ref) ? (g === 'm' ? graph.father?.(ref) : graph.mother?.(ref))?.id : null);
  ops.forEach((op, i) => {
    if (!isObj(op)) return;
    if (op.op === 'add-person' && typeof op.ref === 'string') {
      out[op.ref] = { person: isObj(op.person) ? op.person : {}, link: isObj(op.link) ? op.link : null, op: i };
    }
    if (typeof op.unionRef !== 'string' || !op.unionRef) return;
    let partners = null;
    const link = isObj(op.link) ? op.link : null;
    if (op.op === 'link-spouse') partners = [op.a, op.b];
    else if ((op.op === 'edit-union' || op.op === 'reorder-children') && typeof op.union === 'string') {
      partners = unionPartnerRefs(op.union, { graph, refNames: out });
    } else if (op.op === 'move-person' && isObj(op.to)) {
      partners = op.to.union ? unionPartnerRefs(op.to.union, { graph, refNames: out }) : [op.to.of, op.to.with];
    } else if (op.op === 'add-person' && link) {
      if (link.as === 'child') {
        partners = link.union ? unionPartnerRefs(link.union, { graph, refNames: out }) : [link.of, link.with];
      } else if (link.as === 'spouse') partners = [link.of, op.ref];
      else if (link.as === 'parent') {
        const b = birthPartners(link.of) || [];
        partners = link.scope === 'only' ? [b.length === 1 ? b[0] : null, op.ref] : [...b, op.ref];
      } else if (link.as === 'sibling') {
        if (link.share === 'father') partners = [parentOf(link.of, 'm'), link.otherParent];
        else if (link.share === 'mother') partners = [parentOf(link.of, 'f'), link.otherParent];
        else partners = birthPartners(link.of) || [];
      }
    }
    out[op.unionRef] = { partners: (partners || []).filter((x) => typeof x === 'string' && x) };
  });
  return out;
}

// =========================================================================================================
// Values of edits

/** Display text of an edited value, by path. */
function valueText(path, value, L, gender) {
  const leaf = String(path).split('.').pop();
  if (value === '' || value === null || value === undefined) return L === 'en' ? '(cleared)' : '(تُمسح القيمة)';
  if (path === 'deceased') {
    if (value === true) return L === 'en' ? 'deceased' : (gender === 'f' ? 'متوفاة' : 'متوفى');
    return L === 'en' ? 'living' : 'على قيد الحياة';
  }
  const enumLabel = valueLabel(path, value, L);
  if (enumLabel) return enumLabel;
  if (leaf === 'date') return formatDate(String(value), L) || String(value);
  if (leaf === 'hijri') return formatDate({ date: '', hijri: String(value) }, L) || String(value);
  if (path === 'photo') return L === 'en' ? 'new photo' : 'صورة جديدة';
  if (typeof value === 'boolean') return L === 'en' ? (value ? 'yes' : 'no') : (value ? 'نعم' : 'لا');
  return quote(shorten(value), L);
}

/** "date of birth: 12 Mar 1950; occupation: “Teacher”" — at most `max` paths, then "+ n more". */
function changesText(set, L, gender, max = 4) {
  const paths = isObj(set) ? Object.keys(set) : [];
  if (!paths.length) return '';
  const shown = paths.slice(0, max).map((p) => `${fieldLabel(p, L)}: ${valueText(p, set[p], L, gender)}`);
  const more = paths.length - shown.length;
  let text = shown.join(L === 'en' ? '; ' : '؛ ');
  if (more > 0) {
    text += L === 'en' ? `; and ${enCount(more, 'more change', 'more changes')}`
      : `؛ و${arCount(more, { one: 'تعديل آخر', two: 'تعديلان آخران', few: 'تعديلات أخرى', many: 'تعديلاً آخر' })}`;
  }
  return text;
}

// =========================================================================================================
// add-person

/** Quoted name of a new person, or "" when the name is unknown/withheld and there is no nickname. */
function newPersonName(input, L) {
  const p = isObj(input) ? input : {};
  const has = (b) => isObj(b) && !!(str(b.ar).trim() || str(b.en).trim());
  const known = p.nameStatus !== 'unknown' && p.nameStatus !== 'withheld';
  // Unknown / withheld: only a nickname can name them. Without any name fullName() would fall back to a
  // relational label ("غير معروف"), which must not be quoted as if it were a name.
  if (!(has(p.nickname) || (known && has(p.name)))) return '';
  const name = fullName(known ? p : { ...p, nameStatus: 'known', name: { ar: '', en: '' } }, L);
  return name ? quote(name, L) : '';
}

/** Notes about a new person: life years ("b. 1990", "1950–2010") or "deceased" when no year is known. */
function newPersonNotes(input, L) {
  const notes = [];
  const years = (() => { try { return yearsLabel(input || {}, L); } catch { return ''; } })();
  if (years) notes.push(years);
  else if (input?.deceased === true) notes.push(L === 'en' ? 'deceased' : (input.gender === 'f' ? 'متوفاة' : 'متوفى'));
  return notes;
}

/** "Add “X” as son of P" / "إضافة «X» ابناً لـ P" and the unnamed variants. rel = REL key, target = text after لـ / of. */
function addAs(name, rel, g, target, L, notes) {
  const w = REL[rel];
  const nameStatus = notes.nameStatus;
  const extra = [...notes.list];
  if (!name && nameStatus) extra.push(NAME_NOTE[nameStatus]?.[L] || NAME_NOTE.unknown[L]);
  if (L === 'en') {
    const noun = w.en[g || 'n'];
    const text = name ? `Add ${name} as ${noun} of ${target}` : `Add a ${noun} of ${target}`;
    return withNotes(text, extra, L);
  }
  let text;
  if (!g && w.group) {
    // gender unknown: "إضافة «X» إلى أبناء P" / "إضافة فرد إلى أبناء P"
    text = name ? `إضافة ${name} إلى ${w.group} ${target}` : `إضافة فرد إلى ${w.group} ${target}`;
  } else {
    text = name ? `إضافة ${name} ${w.acc[g || 'n'] || w.acc.m} لـ ${target}` : `إضافة ${w.gen[g || 'n']} لـ ${target}`;
  }
  return withNotes(text, extra, L);
}

function describeAddPerson(op, h) {
  const { L } = h;
  const input = isObj(op.person) ? op.person : {};
  const g = input.gender === 'm' || input.gender === 'f' ? input.gender : '';
  const name = newPersonName(input, L);
  const status = input.nameStatus === 'withheld' || input.nameStatus === 'unknown' ? input.nameStatus : (name ? '' : 'unknown');
  const notes = { list: newPersonNotes(input, L), nameStatus: status };
  const link = isObj(op.link) ? op.link : null;

  if (!link) {
    const extra = [...notes.list];
    if (!name) extra.push(NAME_NOTE[status || 'unknown'][L]);
    if (L === 'en') return withNotes(name ? `Add ${name}` : 'Add a person', extra, L);
    return withNotes(name ? `إضافة ${name}` : 'إضافة فرد', extra, L);
  }

  if (link.as === 'child') {
    const parents = link.union ? h.U(link.union) : listText([link.of, link.with].filter(Boolean).map(h.N), L);
    return addAs(name, 'child', g, parents, L, notes);
  }

  if (link.as === 'spouse') {
    const rel = link.status === 'divorced' ? 'formerSpouse' : 'spouse';
    const m = isObj(link.marriage) ? formatDate(link.marriage, L) : '';
    if (m) notes.list.push(L === 'en' ? `married ${m}` : `تاريخ الزواج: ${m}`);
    return addAs(name, rel, g, h.N(link.of), L, notes);
  }

  if (link.as === 'parent') {
    // scope "union" (default): every child of P's birth union gains this parent — list them.
    // scope "only": P alone moves to the new parent; say so when P has siblings.
    let target = h.N(link.of);
    const b = h.graph && !isTempRef(link.of) ? h.graph.birthUnion?.(link.of) : null;
    const others = b ? (b.children || []).filter((c) => c !== link.of && findPerson(h.graph, c)) : [];
    if (others.length && link.scope === 'only') {
      target = L === 'en' ? `${target} only` : `${target} فقط`;
    } else if (others.length) {
      const list = listText(others.map(h.short), L, { max: 5 });
      notes.list.unshift(L === 'en' ? `and also of ${list}` : `وكذلك ${list}`);
    }
    return addAs(name, 'parent', g, target, L, notes);
  }

  if (link.as === 'sibling') {
    const share = link.share === 'father' || link.share === 'mother' ? link.share : 'both';
    const target = h.N(link.of);
    if (share === 'both') {
      if (L === 'en') notes.list.unshift('same father and mother');
      return addAs(name, 'fullSibling', g, target, L, notes);
    }
    const other = link.otherParent ? h.N(link.otherParent) : '';
    if (L === 'en') {
      notes.list.unshift(`same ${share}${other ? `; ${share === 'father' ? 'mother' : 'father'}: ${other}` : ''}`);
      return addAs(name, 'sibling', g, target, L, notes);
    }
    // Arabic: "أخاً لـ P من الأب (والدته Q)"
    const side = share === 'father' ? 'من الأب' : 'من الأم';
    if (other) {
      const word = share === 'father' ? (g === 'f' ? 'والدتها' : 'والدته') : (g === 'f' ? 'والدها' : 'والده');
      notes.list.unshift(`${word} ${other}`);
    }
    return addAs(name, 'sibling', g, `${target} ${side}`, L, notes);
  }

  // Unknown link kind: describe the person only.
  return describeAddPerson({ ...op, link: null }, h);
}

// =========================================================================================================
// Other operations

const MARK_TEXT = {
  deceased: {
    en: (n) => `Mark ${n} as deceased`,
    ar: (n) => `تسجيل وفاة ${n}`,
  },
  living: {
    en: (n) => `Mark ${n} as living`,
    ar: (n) => `تسجيل أن ${n} على قيد الحياة`,
  },
  verified: {
    en: (n) => `Mark the details of ${n} as verified`,
    ar: (n) => `تأكيد صحة بيانات ${n}`,
  },
  unverified: {
    en: (n) => `Remove the verified mark from ${n}`,
    ar: (n) => `إلغاء تأكيد بيانات ${n}`,
  },
  'needs-info': {
    en: (n) => `Ask for missing information about ${n}`,
    ar: (n) => `طلب معلومات ناقصة عن ${n}`,
  },
  'info-complete': {
    en: (n) => `Mark the information about ${n} as complete`,
    ar: (n) => `تسجيل اكتمال معلومات ${n}`,
  },
  duplicate: {
    en: (n, of) => `Mark ${n} as a possible duplicate of ${of}`,
    ar: (n, of) => `تعليم ${n} كتكرار محتمل لـ ${of}`,
  },
  'not-duplicate': {
    en: (n) => `Mark ${n} as not a duplicate`,
    ar: (n) => `إلغاء علامة التكرار عن ${n}`,
  },
  private: {
    en: (n) => `Make ${n} private (name and personal details hidden)`,
    ar: (n, of, g) => `إخفاء اسم ${n} و${g === 'f' ? 'تفاصيلها' : 'تفاصيله'} الشخصية`,
  },
};

const TIE_WORDS = {
  'milk-child-of': { en: 'milk (nursing)', ar: 'الرضاعة' },
  'foster-child-of': { en: 'foster (kafala)', ar: 'الكفالة' },
};

const reasonNote = (code, L) => (L === 'en' ? `reason: ${reasonLabel(code, L)}` : `السبب: ${reasonLabel(code, L)}`);

/** Names of a person's current parents (existing people only). */
function currentParents(h, id) {
  if (!h.graph || isTempRef(id)) return '';
  return listText((h.graph.parents?.(id) || []).map((p) => h.N(p.id)), h.L);
}

/** The resulting order of children after reorder-children (listed current children first, then the rest). */
function reorderedChildren(h, op) {
  const order = Array.isArray(op.order) ? op.order : [];
  const u = findUnion(h.graph, op.union);
  if (!u) return order;
  const current = [...new Set(u.children || [])];
  const listed = order.filter((c) => current.includes(c));
  return [...new Set([...listed, ...current.filter((c) => !listed.includes(c))])];
}

const OPS = {
  'add-person': describeAddPerson,

  'edit-person': (op, h) => {
    const { L } = h;
    const changes = changesText(op.set, L, h.G(op.id));
    if (L === 'en') return `Edit ${h.N(op.id)}${changes ? `: ${changes}` : ''}`;
    return `تعديل بيانات ${h.N(op.id)}${changes ? `: ${changes}` : ''}`;
  },

  mark: (op, h) => {
    const { L } = h;
    const t = MARK_TEXT[op.mark];
    const n = h.N(op.id);
    if (!t) return L === 'en' ? `Mark ${n} (${str(op.mark) || '?'})` : `تعليم ${n} (${str(op.mark) || '؟'})`;
    let text = t[L](n, op.of ? h.N(op.of) : (L === 'en' ? 'another person' : 'شخص آخر'), h.G(op.id));
    const notes = [];
    if (op.mark === 'deceased') {
      const d = formatDate({ date: str(op.date), hijri: str(op.hijri) }, L);
      if (d) notes.push(L === 'en' ? `died ${d}` : `تاريخ الوفاة: ${d}`);
    }
    if (op.mark === 'needs-info' && str(op.note).trim()) text += `: ${quote(shorten(op.note, 60), L)}`;
    return withNotes(text, notes, L);
  },

  'link-spouse': (op, h) => {
    const { L } = h;
    const pair = listText([h.N(op.a), h.N(op.b)], L);
    const notes = [];
    if (op.status === 'divorced') notes.push(L === 'en' ? 'former marriage' : 'زواج سابق');
    const m = isObj(op.marriage) ? formatDate(op.marriage, L) : '';
    if (m) notes.push(L === 'en' ? `married ${m}` : `تاريخ الزواج: ${m}`);
    return withNotes(L === 'en' ? `Link ${pair} as spouses` : `تسجيل زواج ${pair}`, notes, L);
  },

  'move-person': (op, h) => {
    const { L } = h;
    const to = isObj(op.to) ? op.to : {};
    const target = to.union ? h.U(to.union) : listText([to.of, to.with].filter(Boolean).map(h.N), L);
    const now = currentParents(h, op.id);
    const notes = now ? [L === 'en' ? `now: ${now}` : `حالياً: ${now}`] : [];
    return withNotes(L === 'en' ? `Change the parents of ${h.N(op.id)} to ${target}` : `تغيير والدَي ${h.N(op.id)} إلى ${target}`, notes, L);
  },

  'edit-union': (op, h) => {
    const { L } = h;
    const changes = changesText(op.set, L, '');
    const partners = h.partnersOf(op.union) || [];
    const who = h.U(op.union);
    let head;
    if (L === 'en') head = partners.length === 2 ? `Edit the marriage of ${who}` : `Edit the family record of ${who}`;
    else head = partners.length === 2 ? `تعديل بيانات زواج ${who}` : `تعديل بيانات أسرة ${who}`;
    return `${head}${changes ? `: ${changes}` : ''}`;
  },

  'reorder-children': (op, h) => {
    const { L } = h;
    const kids = reorderedChildren(h, op).map(h.short);
    const shown = kids.slice(0, 8).join(L === 'en' ? ', ' : '، ') + (kids.length > 8 ? '…' : '');
    if (L === 'en') return `Reorder the children of ${h.U(op.union)}${shown ? `: ${shown}` : ''}`;
    return `إعادة ترتيب أبناء ${h.U(op.union)}${shown ? `: ${shown}` : ''}`;
  },

  'reorder-spouses': (op, h) => {
    const { L } = h;
    const names = (Array.isArray(op.order) ? op.order : []).map((uid) => {
      const others = (h.partnersOf(uid) || []).filter((x) => x !== op.id);
      return others.length ? h.short(others[0]) : '';
    }).filter(Boolean);
    const shown = names.join(L === 'en' ? ', ' : '، ');
    if (L === 'en') return `Reorder the spouses of ${h.N(op.id)}${shown ? `: ${shown}` : ''}`;
    const word = h.G(op.id) === 'm' ? 'زوجات' : 'أزواج';
    return `إعادة ترتيب ${word} ${h.N(op.id)}${shown ? `: ${shown}` : ''}`;
  },

  'add-tie': (op, h) => {
    const { L } = h;
    const a = h.N(op.id);
    const b = h.N(op.person);
    const g = h.G(op.id);
    if (op.type === 'foster-child-of') {
      if (L === 'en') return `Record ${a} as foster ${REL.child.en[g || 'n']} of ${b} (kafala)`;
      return `تسجيل ${a} في كفالة ${b}`;
    }
    if (L === 'en') return `Record ${a} as milk ${REL.child.en[g || 'n']} of ${b}`;
    if (!g) return `تسجيل ${a} من أبناء ${b} بالرضاعة`;
    return `تسجيل ${a} ${REL.child.acc[g]} لـ ${b} من الرضاعة`;
  },

  'restore-person': (op, h) => (h.L === 'en' ? `Restore ${h.N(op.id)}` : `استعادة ${h.N(op.id)}`),

  'restore-union': (op, h) => (h.L === 'en' ? `Restore the marriage of ${h.U(op.union)}` : `استعادة زواج ${h.U(op.union)}`),

  'remove-person': (op, h) => {
    const { L } = h;
    const n = h.N(op.id);
    const notes = [reasonNote(op.reasonCode, L)];
    if (L === 'en') return withNotes(op.redact === true ? `Remove ${n} and erase their personal details` : `Remove ${n}`, notes, L);
    const own = h.G(op.id) === 'f' ? 'بياناتها' : 'بياناته';
    return withNotes(op.redact === true ? `حذف ${n} مع مسح ${own} الشخصية` : `حذف ${n}`, notes, L);
  },

  'unlink-spouse': (op, h) => {
    const { L } = h;
    const notes = [reasonNote(op.reasonCode, L)];
    if (L === 'en') return withNotes(`Unlink the marriage of ${h.U(op.union)}`, notes, L);
    return withNotes(`فك ارتباط الزواج بين ${h.U(op.union)}`, notes, L);
  },

  'detach-person': (op, h) => {
    const { L } = h;
    const n = h.N(op.id);
    const parents = currentParents(h, op.id);
    const notes = [reasonNote(op.reasonCode, L)];
    if (L === 'en') return withNotes(parents ? `Detach ${n} from the family of ${parents}` : `Detach ${n} from their parents`, notes, L);
    const own = h.G(op.id) === 'f' ? 'والديها' : 'والديه';
    return withNotes(parents ? `فصل ${n} عن أسرة ${parents}` : `فصل ${n} عن ${own}`, notes, L);
  },

  'remove-tie': (op, h) => {
    const { L } = h;
    const tie = (TIE_WORDS[op.type] || TIE_WORDS['milk-child-of'])[L];
    const notes = [reasonNote(op.reasonCode, L)];
    if (L === 'en') return withNotes(`Remove the ${tie} tie between ${h.N(op.id)} and ${h.N(op.person)}`, notes, L);
    return withNotes(`إزالة رابطة ${tie} بين ${h.N(op.id)} و${h.N(op.person)}`, notes, L);
  },

  'merge-person': (op, h) => {
    const { L } = h;
    let keep = h.N(op.keep);
    let remove = h.N(op.remove);
    if (keep === remove) {
      // Same display name (the usual case for duplicates): tell them apart by id.
      keep = `${keep} (${op.keep})`;
      remove = `${remove} (${op.remove})`;
    }
    const notes = [L === 'en' ? 'the same person' : 'الشخص نفسه', reasonNote(op.reasonCode, L)];
    if (op.parents === 'remove' || op.parents === 'keep') {
      const whose = op.parents === 'remove' ? remove : keep;
      notes.push(L === 'en' ? `keeping the parents of ${whose}` : `مع اعتماد والدَي ${whose}`);
    }
    return withNotes(L === 'en' ? `Merge ${remove} into ${keep}` : `دمج ${remove} في ${keep}`, notes, L);
  },
};

/**
 * One-line plain-text description of an operation. ctx = {graph, refNames} (refNames from refNames(proposal));
 * the graph is the data the proposal applies to (people already in the tree are named from it).
 */
export function describeOp(op, ctx = {}, lang = 'ar') {
  const L = langOf(lang);
  const type = isObj(op) ? op.op : undefined;
  const fn = OPS[type];
  if (!fn) return L === 'en' ? `Unknown change (${str(type) || '?'})` : `تعديل غير معروف (${str(type) || '؟'})`;
  try {
    return fn(op, makeCtx(ctx, L)).replace(/\s+/g, ' ').trim();
  } catch {
    return L === 'en' ? `Change of type ${type}` : `تعديل من نوع ${type}`;
  }
}

// =========================================================================================================
// Proposals

const CATEGORY = {
  'add-person': 'add', 'link-spouse': 'add', 'add-tie': 'add', 'restore-person': 'add', 'restore-union': 'add',
  'edit-person': 'edit', 'edit-union': 'edit',
  mark: 'mark',
  'move-person': 'arrange', 'reorder-children': 'arrange', 'reorder-spouses': 'arrange',
  'remove-person': 'remove', 'unlink-spouse': 'remove', 'detach-person': 'remove', 'remove-tie': 'remove',
  'merge-person': 'remove',
};

/** Category of an op type for counts: "add" | "edit" | "mark" | "arrange" | "remove" | null. */
export function opCategory(type) {
  return CATEGORY[type] || null;
}

// Count phrases of the title (English, Arabic with number agreement).
const COUNT_WORDS = {
  people: {
    en: ['new person', 'new people'],
    ar: { one: 'فرد جديد', two: 'فردان جديدان', few: 'أفراد جدد', many: 'فرداً جديداً' },
  },
  links: {
    en: ['new link', 'new links'],
    ar: { one: 'رابط جديد', two: 'رابطان جديدان', few: 'روابط جديدة', many: 'رابطاً جديداً' },
  },
  edit: {
    en: ['correction', 'corrections'],
    ar: { one: 'تصحيح واحد', two: 'تصحيحان', few: 'تصحيحات', many: 'تصحيحاً' },
  },
  mark: {
    en: ['status update', 'status updates'],
    ar: { one: 'تحديث حالة واحد', two: 'تحديثا حالة', few: 'تحديثات حالة', many: 'تحديثاً للحالة' },
  },
  arrange: {
    en: ['rearrangement', 'rearrangements'],
    ar: { one: 'إعادة ترتيب واحدة', two: 'إعادتا ترتيب', few: 'عمليات ترتيب', many: 'عملية ترتيب' },
  },
  remove: {
    en: ['removal', 'removals'],
    ar: { one: 'عملية حذف واحدة', two: 'عمليتا حذف', few: 'عمليات حذف', many: 'عملية حذف' },
  },
};

function countPhrase(key, n, L) {
  const w = COUNT_WORDS[key];
  return L === 'en' ? enCount(n, w.en[0], w.en[1]) : arCount(n, w.ar);
}

/** The existing person most often referred to by the ops (the "family" a proposal is about), or null. */
function focusPerson(ops, graph) {
  if (!graph) return null;
  const tally = new Map();
  const bump = (ref, w = 1) => {
    if (typeof ref !== 'string' || isTempRef(ref) || !findPerson(graph, ref)) return;
    tally.set(ref, (tally.get(ref) || 0) + w);
  };
  for (const op of ops) {
    if (!isObj(op)) continue;
    const link = isObj(op.link) ? op.link : {};
    bump(link.of, 2);
    bump(link.with);
    for (const k of ['id', 'a', 'b', 'keep', 'of']) bump(op[k]);
    const to = isObj(op.to) ? op.to : {};
    bump(to.of);
    for (const uid of [op.union, link.union, to.union]) {
      if (typeof uid !== 'string') continue;
      for (const p of unionPartnerRefs(uid, { graph }) || []) bump(p);
    }
  }
  let best = null;
  for (const [id, n] of tally) if (!best || n > best.n) best = { id, n };
  return best ? best.id : null;
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const TITLE_MAX = 100;

function clip(s, max = TITLE_MAX) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Summary of a proposal: {title, lines, destructive, counts:{add, edit, mark, arrange, remove}}.
 *   lines: describeOp of every op (same order as proposal.ops; numbering is up to the renderer)
 *   destructive: a destructive op is present (static check; a REPARENT is only known after applying)
 *   title: one line ≤ 100 chars, e.g. "Add “Ahmed” and “Sara” to the family of Muhammad Ahmed Alem",
 *          "3 new people, 2 corrections — family of …" / "3 أفراد جدد، تصحيحان — عائلة …"
 */
export function describeProposal(p, graph = null, lang = 'ar') {
  const L = langOf(lang);
  const ops = Array.isArray(p?.ops) ? p.ops : [];
  const ctx = { graph, refNames: refNames(ops, graph) };
  const lines = ops.map((op) => describeOp(op, ctx, L));
  const counts = { add: 0, edit: 0, mark: 0, arrange: 0, remove: 0 };
  for (const op of ops) {
    const c = isObj(op) ? CATEGORY[op.op] : null;
    if (c) counts[c]++;
  }
  const destructive = ops.some((op) => isObj(op) && DESTRUCTIVE_OPS.includes(op.op));

  let title;
  if (!ops.length) title = L === 'en' ? 'Empty proposal' : 'مقترح فارغ';
  else if (ops.length === 1) title = lines[0];
  else {
    const adds = ops.filter((op) => isObj(op) && op.op === 'add-person');
    const focus = focusPerson(ops, graph);
    const focusName = focus ? personLabel(focus, L, ctx) : '';
    const names = adds.map((op) => newPersonName(op.person, L)).filter(Boolean);
    if (adds.length === ops.length && adds.length <= 3 && names.length === adds.length) {
      // "Add “Ahmed” and “Sara” to the family of X"
      const list = listText(names, L);
      if (L === 'en') title = `Add ${list}${focusName ? ` to the family of ${focusName}` : ''}`;
      else title = `إضافة ${list}${focusName ? ` إلى عائلة ${focusName}` : ''}`;
    } else {
      const parts = [];
      if (adds.length) parts.push(countPhrase('people', adds.length, L));
      if (counts.add - adds.length > 0) parts.push(countPhrase('links', counts.add - adds.length, L));
      for (const k of ['edit', 'mark', 'arrange', 'remove']) if (counts[k]) parts.push(countPhrase(k, counts[k], L));
      const summary = L === 'en' ? cap(parts.join(', ')) : parts.join('، ');
      const withFocus = focusName ? `${summary} — ${L === 'en' ? 'family of' : 'عائلة'} ${focusName}` : summary;
      title = withFocus.length <= TITLE_MAX ? withFocus : summary; // drop the focus rather than cut words
    }
  }
  return { title: clip(title), lines, destructive, counts };
}
