// Names: display names (incl. polite labels for unknown / withheld names), lineage names, initials,
// Arabic/Latin normalisation and the consonant "skeleton" keys used by fuzzy search.
// Pure ES module — runs unchanged in modern browsers and Node ≥ 20 (no DOM, no fetch, no node: imports).
// See docs/SPEC.md §2.1 (nameStatus) and §4 (names.js API).
//
// Every function accepts the normalized person shape but is defensive about missing optional fields
// (compact stored form), so `p.name`, `p.surname`, `p.nickname`, `p.gender`, `p.nameStatus` may be absent.
//
// The optional `graph` argument is a Graph from graph.js (buildGraph). Only these methods are used, each
// through optional chaining so a partial graph works too: person(id), father(id), mother(id),
// spouses(id) → [{person, union}], children(id).
//
// Auto English (§2.1): English text of a name / surname / nickname is the stored English when someone typed it,
// else the automatic spelling of the Arabic (translit.js englishOf: محمد → Muhammad). Arabic text falls back to
// the stored English when there is no Arabic.

import { englishOf } from './translit.js';

// ---------------------------------------------------------------------------------------------------------
// Small helpers

/** "ar" | "en" (anything else → "ar", the portal's default language). */
function langOf(lang) {
  return lang === 'en' ? 'en' : 'ar';
}

const autoEnglishMemo = new Map(); // `${kind}|${arabic}` → automatic English (names repeat a lot)

/** Automatic English for Arabic text (memoized; never throws). */
function autoEnglishOf(ar, kind) {
  const key = `${kind}|${ar}`;
  let v = autoEnglishMemo.get(key);
  if (v === undefined) {
    try { v = String(englishOf({ ar, en: '' }, kind) || '').trim(); } catch { v = ''; }
    if (autoEnglishMemo.size > 20000) autoEnglishMemo.clear();
    autoEnglishMemo.set(key, v);
  }
  return v || ar;
}

/**
 * Trimmed text of a bilingual field in `lang`. English: stored English, else the automatic spelling of the
 * Arabic (`kind` "given" | "surname"). Arabic: the Arabic, else the stored English.
 */
function biText(obj, lang, kind = 'given') {
  if (!obj || typeof obj !== 'object') return '';
  const ar = typeof obj.ar === 'string' ? obj.ar.trim() : '';
  const en = typeof obj.en === 'string' ? obj.en.trim() : '';
  if (lang === 'en') return en || (ar ? autoEnglishOf(ar, kind) : '');
  return ar || en;
}

function nameStatusOf(p) {
  return p?.nameStatus === 'unknown' || p?.nameStatus === 'withheld' ? p.nameStatus : 'known';
}

/** Accept a person object or an id (looked up in the graph). */
function asPerson(p, graph) {
  if (p && typeof p === 'object') return p;
  if (typeof p === 'string' && graph?.person) return graph.person(p) || null;
  return null;
}

/** The father used by lineage: only a partner of gender "m" (graph.father already guarantees it). */
function maleFather(graph, person) {
  const f = person?.id ? graph?.father?.(person.id) : null;
  return f && f.gender === 'm' ? f : null;
}

// ---------------------------------------------------------------------------------------------------------
// Lineage style (config.lineageStyle)

const LINEAGE_STYLES = ['plain', 'bin'];
let defaultLineageStyle = 'plain';

/** Set the default lineage style: "plain" ("محمد حسن سالم") or "bin" ("محمد بن حسن بن سالم"). Returns the style in use. */
export function setLineageStyle(style) {
  if (LINEAGE_STYLES.includes(style)) defaultLineageStyle = style;
  return defaultLineageStyle;
}

/** The current default lineage style. */
export function getLineageStyle() {
  return defaultLineageStyle;
}

// ---------------------------------------------------------------------------------------------------------
// Person names

/**
 * Given name (ism) in `lang`: English = stored English or the automatic spelling of the Arabic; Arabic = the
 * Arabic, else the stored English. Empty for unknown / withheld names (a withheld name is never shown, even
 * if one slipped into the data).
 */
export function personName(p, lang = 'ar') {
  if (!p || nameStatusOf(p) !== 'known') return '';
  return biText(p.name, langOf(lang));
}

/** Arabic idafa / "bin" genitive of a kunya: أبو خالد → أبي خالد (English: Abu Khalid → Abi Khalid). */
function genitive(text, lang) {
  if (!text) return text;
  if (lang === 'ar') return text.replace(/^([أا])بو(?=\s|[ء-ي])/, '$1بي');
  return text.replace(/^(a)bu\b/i, (m, a) => `${a}bi`);
}

// Polite relational labels for people whose name is unknown or withheld (§2.1, §4).
const LABELS = {
  ar: {
    son: 'ابن', daughter: 'ابنة', daughterWithheld: 'كريمة', child: 'أحد أبناء',
    wife: 'زوجة', wifeWithheld: 'حرم', husband: 'زوج', spouse: 'زوج',
    father: 'والد', mother: 'والدة', parent: 'أحد والدَي',
    unknown: 'غير معروف',
  },
  en: {
    son: 'Son of', daughter: 'Daughter of', daughterWithheld: 'Daughter of', child: 'Child of',
    wife: 'Wife of', wifeWithheld: 'Wife of', husband: 'Husband of', spouse: 'Spouse of',
    father: 'Father of', mother: 'Mother of', parent: 'Parent of',
    unknown: 'Unknown',
  },
};

/**
 * How a relative is named inside a label ("زوجة <X>"): their short lineage (given + father + family name),
 * or their kunya. Relatives whose own name is unknown/withheld are not used (no "son of the wife of …").
 */
function referenceName(q, lang, graph) {
  if (!q) return '';
  if (!personName(q, lang) && !(nameStatusOf(q) === 'known' && biText(q.nickname, lang))) return '';
  const text = lineageName(graph, q, lang, { depth: 2, style: 'plain' });
  return genitive(text, lang);
}

/**
 * Label for an unknown/withheld person from their closest named relative. Order:
 *   1. child of (father first, then mother) — "ابن/ابنة/كريمة/أحد أبناء X"
 *   2. spouse of (display order of unions) — "زوجة/حرم/زوج X"
 *   3. parent of (first child) — "والد/والدة X"
 *   4. "غير معروف" / "Unknown".
 */
function relationalLabel(p, lang, graph, status) {
  const L = LABELS[lang];
  const withheld = status === 'withheld';
  const g = p.gender === 'm' || p.gender === 'f' ? p.gender : '';
  const id = p.id;
  if (graph && id) {
    for (const parent of [graph.father?.(id), graph.mother?.(id)]) {
      const x = referenceName(parent, lang, graph);
      if (!x) continue;
      const word = g === 'm' ? L.son : g === 'f' ? (withheld ? L.daughterWithheld : L.daughter) : L.child;
      return `${word} ${x}`;
    }
    for (const s of graph.spouses?.(id) || []) {
      const x = referenceName(s?.person, lang, graph);
      if (!x) continue;
      const word = g === 'f' ? (withheld ? L.wifeWithheld : L.wife) : g === 'm' ? L.husband : L.spouse;
      return `${word} ${x}`;
    }
    for (const c of graph.children?.(id) || []) {
      const x = referenceName(c, lang, graph);
      if (!x) continue;
      const word = g === 'm' ? L.father : g === 'f' ? L.mother : L.parent;
      return `${word} ${x}`;
    }
  }
  return L.unknown;
}

/**
 * Name to display for a person.
 *   known    → given name (+ " (nickname)"); a kunya-only person shows the kunya.
 *   unknown / withheld → nickname, else a polite relational label (needs `graph`);
 *              plus their own surname: "أم خالد الحربي", "زوجة محمد علي محمود (داغستاني)".
 */
export function displayName(p, lang = 'ar', graph = null) {
  p = asPerson(p, graph);
  if (!p) return '';
  const L = langOf(lang);
  const given = personName(p, L);
  const nick = biText(p.nickname, L);
  if (given) return nick && nick !== given ? `${given} (${nick})` : given;
  const status = nameStatusOf(p);
  if (status === 'known' && nick) return nick; // kunya-only ("أبو خالد")
  const sur = biText(p.surname, L, 'surname');
  if (nick) return sur ? `${nick} ${sur}` : nick;
  const label = relationalLabel(p, L, graph, status);
  // "(surname)" unless the label already ends with it ("والد غازي عالم", not "والد غازي عالم (عالم)").
  return sur && !label.endsWith(` ${sur}`) ? `${label} (${sur})` : label;
}

/**
 * Display name with the surname, rendered verbatim (never adds آل / Al-): "زكية إسماعيل قربان",
 * "خديجة فتة (بيبي)" (the nickname stays at the end). Unknown/withheld names already carry the surname.
 */
export function fullName(p, lang = 'ar', graph = null) {
  p = asPerson(p, graph);
  if (!p) return '';
  const L = langOf(lang);
  const given = personName(p, L);
  const nick = biText(p.nickname, L);
  const sur = biText(p.surname, L, 'surname');
  if (given) {
    const base = sur ? `${given} ${sur}` : given;
    return nick && nick !== given ? `${base} (${nick})` : base;
  }
  if (nameStatusOf(p) === 'known' && nick) return sur ? `${nick} ${sur}` : nick;
  return displayName(p, L, graph);
}

/** The name a person contributes to a lineage chain: given name, or kunya for kunya-only people. */
function lineagePart(p, lang) {
  if (!p || nameStatusOf(p) !== 'known') return '';
  return personName(p, lang) || biText(p.nickname, lang);
}

/** First non-empty own surname along the whole paternal chain (unbounded, cycle-safe). */
function inheritedSurname(graph, p, lang) {
  const seen = new Set();
  let cur = p;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const s = biText(cur.surname, lang, 'surname');
    if (s) return s;
    cur = maleFather(graph, cur);
  }
  return '';
}

/**
 * Lineage name: given name + father + grandfather … (`depth` names in all) + family name.
 *   plain: "محمد حسن سالم عالم" / "Mohammed Hassan Salem Alam"
 *   bin:   "محمد بن حسن بن سالم عالم" / "Mohammed bin Hassan bin Salem Alam" (بنت/bint after a woman's name;
 *          a kunya after بن is put in the genitive: "بن أبي خالد").
 * Follows ONLY a male father; stops at an unknown/withheld/absent father. The family name is the first
 * non-empty surname along the whole paternal chain (also past unnamed fathers).
 * `id` may be an id or a person object. Unknown/withheld people get their displayName.
 */
export function lineageName(graph, id, lang = 'ar', { depth = 3, style } = {}) {
  const L = langOf(lang);
  const st = LINEAGE_STYLES.includes(style) ? style : defaultLineageStyle;
  const p = asPerson(id, graph);
  if (!p) return '';
  const first = lineagePart(p, L);
  if (!first) return displayName(p, L, graph);
  const parts = [first];
  const seen = new Set([p.id]);
  let cur = p;
  const max = Math.max(1, Number(depth) || 1);
  while (parts.length < max) {
    const f = maleFather(graph, cur);
    if (!f || seen.has(f.id)) break;
    seen.add(f.id);
    const n = lineagePart(f, L);
    if (!n) break;
    parts.push(n);
    cur = f;
  }
  let text = parts[0];
  for (let i = 1; i < parts.length; i++) {
    if (st === 'bin') {
      const female = i === 1 && p.gender === 'f';
      const conn = L === 'ar' ? (female ? 'بنت' : 'بن') : (female ? 'bint' : 'bin');
      text += ` ${conn} ${genitive(parts[i], L)}`;
    } else {
      text += ` ${parts[i]}`;
    }
  }
  const sur = inheritedSurname(graph, p, L);
  return sur ? `${text} ${sur}` : text;
}

/**
 * Initials for avatars. Arabic: the first letter of the given name (Arabic letters join, so one letter);
 * Latin: first letter of the given name + first letter of the surname or second word ("MA").
 * Empty when there is no name or kunya.
 */
export function initials(p, lang = 'ar') {
  if (!p) return '';
  const L = langOf(lang);
  const base = personName(p, L) || biText(p.nickname, L);
  if (!base) return '';
  const firstLetter = (s) => (String(s).match(/\p{L}/u) || [''])[0];
  const f = firstLetter(base);
  if (!f) return '';
  if (/[؀-ۿ]/.test(f)) return f;
  const words = base.split(/[\s-]+/).filter(Boolean);
  let second = '';
  const sur = biText(p.surname, L, 'surname').replace(/^(?:al|el)[\s-]+/i, '');
  if (sur && !/[؀-ۿ]/.test(sur)) second = firstLetter(sur);
  else if (words.length > 1) second = firstLetter(words[words.length - 1].replace(/^(?:al|el)-/i, ''));
  return (f + second).toUpperCase();
}

// ---------------------------------------------------------------------------------------------------------
// Normalisation

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g;
const INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/g;

function asciiDigits(s) {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0));
}

/**
 * Arabic normalisation for comparison: strip tashkeel / tatweel / invisible marks; أ إ آ ٱ → ا; ة → ه; ى → ي;
 * ؤ → و; ئ → ي (Persian ک/ی too); collapse spaces; "عبد ال…" ≡ "عبدال…"; "ابو X" ≡ "ابوX".
 * Latin text passes through unchanged (apart from whitespace).
 */
export function normalizeArabic(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱٲٳ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/[یې]/g, 'ي')
    .replace(/[ۀھ]/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^| )عبد ال/g, '$1عبدال')
    .replace(/(^| )ابو (?=\S)/g, '$1ابو');
}

/**
 * Key for "normalized" search matches: lower-case, Latin diacritics removed, Arabic normalized
 * (normalizeArabic), digits → ASCII, punctuation → space, apostrophes dropped; compound names glued the
 * way Arabic writes them: "عبد X" → "عبدX", "abd al rahman"/"abdul rahman" → "abdalrahman"/"abdulrahman",
 * "abu bakr" → "abubakr", and a Latin article sticks to its word like the Arabic one: "al harbi" → "alharbi".
 */
export function searchKey(s) {
  if (s === null || s === undefined) return '';
  let t = String(s).normalize('NFKC').replace(INVISIBLE, '').toLowerCase();
  t = asciiDigits(t);
  t = t.replace(/['’‘`´ʻʼʿʾ]/g, '');
  t = t.replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ');
  t = normalizeArabic(t);
  t = t.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  t = t.replace(/(^| )عبد (?=\S)/g, '$1عبد');
  t = t.replace(/(^| )ال (?=\S)/g, '$1ال'); // "آل غالب" → "الغالب" (article glued, as Arabic writes it)
  t = t.replace(/\b(abd|abu|abou|abo)\s+(?=[a-z])/g, '$1');
  t = t.replace(/\b(abd[aeiou]l)\s+(?=[a-z])/g, '$1');
  t = t.replace(/\b(al|el)\s+(?=[a-z])/g, '$1');
  return t.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------------------
// Consonant skeletons (fuzzy, cross-script)
//
// Both scripts are reduced to the same small consonant alphabet:
//   b t j h x(خ) d r z s c(ش) f k(ق ك) g(غ) l m n y w, and "a" = a word-initial vowel / alef / ain / hamza.
// Short vowels are not written in Arabic and are unpredictable in Latin transliteration, so all vowels
// (and long ا و ي) are dropped after the first letter; a word-initial vowel is kept as the marker "a" so
// that Ali ≡ علي ≡ 3li and Ahmed ≡ أحمد while محمد (mhmd) ≠ أحمد (ahmd). Initial و / ي (w / y) are
// consonants (Walid ≡ وليد, Yousef ≡ يوسف). Doubles are collapsed after the vowels are dropped
// (Muhammad ≡ Mohamed ≡ محمد).
//
// Ambiguous spellings produce extra *variants* (skeletonVariants): a leading ال / al- that may be part of
// the name (إلهام typed as "الهام", "Alawiya"), and a final h that may be ة or a real ه/ح ("Saleh" ≡ صالح,
// "Fatimah" ≡ فاطمة). The first variant is the canonical skeletonKey.

const AR_CONSONANTS = {
  'ب': 'b', 'ت': 't', 'ث': 't', 'ج': 'j', 'ح': 'h', 'خ': 'x', 'د': 'd', 'ذ': 'd', 'ر': 'r', 'ز': 'z',
  'س': 's', 'ش': 'c', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ك': 'k',
  'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'پ': 'b', 'چ': 'j', 'ڤ': 'f', 'گ': 'j', 'ژ': 'j',
};
const LATIN_CONSONANTS = {
  b: 'b', c: 'k', d: 'd', f: 'f', g: 'j', G: 'g', h: 'h', j: 'j', k: 'k', l: 'l', m: 'm', n: 'n', p: 'b',
  q: 'k', r: 'r', s: 's', t: 't', v: 'f', x: 'x', C: 'c', z: 'z',
};
const LATIN_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', "'"]);

const collapse = (s) => s.replace(/(.)\1+/g, '$1');

function arabicConsonants(word) {
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (ch === 'ا' || ch === 'ع' || ch === 'ء') { if (i === 0) out += 'a'; continue; }
    if (ch === 'و') { if (i === 0) out += 'w'; continue; }
    if (ch === 'ي') { if (i === 0) out += 'y'; continue; }
    const m = AR_CONSONANTS[ch];
    if (m) out += m;
  }
  return collapse(out);
}

function arabicSkeletons(tok) {
  if (tok === 'ال') return []; // a lone article / "آل"
  const bases = tok.length >= 4 && tok.startsWith('ال') ? [tok.slice(2), tok] : [tok];
  const out = [];
  for (const b of bases) {
    if (b.length >= 3 && b.endsWith('ه')) out.push(arabicConsonants(b.slice(0, -1)), arabicConsonants(b));
    else out.push(arabicConsonants(b));
  }
  return out;
}

function latinConsonants(w) {
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    if (LATIN_VOWELS.has(ch)) { if (i === 0) out += 'a'; continue; }
    if (ch === 'y' || ch === 'w') { if (i === 0) out += ch; continue; }
    const m = LATIN_CONSONANTS[ch];
    if (m) out += m;
  }
  return collapse(out);
}

function latinSkeletons(tok) {
  let w = tok.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w || w === 'al' || w === 'el') return [];
  const bases = w.length >= 5 && /^(al|el)/.test(w) ? [w.slice(2), w] : [w];
  const out = [];
  for (let b of bases) {
    // Arabizi: 2 (hamza) and 3 (ain) behave like vowels; 5 kh, 6 t, 7 h, 9 s; other digits are ignored.
    b = b.replace(/x/g, 'ks').replace(/5/g, 'kh').replace(/6/g, 't').replace(/7/g, 'h').replace(/9/g, 's')
      .replace(/[23]/g, "'").replace(/[0-9]/g, '');
    // Digraphs → single symbols (uppercase = internal symbols that cannot clash with plain letters).
    b = b.replace(/kh/g, 'x').replace(/gh/g, 'G').replace(/sh|ch/g, 'C').replace(/th/g, 't').replace(/dh/g, 'd')
      .replace(/ph/g, 'f').replace(/ck/g, 'k');
    if (b.length >= 3 && /[aeiouy]h$/.test(b)) {
      const without = latinConsonants(b.slice(0, -1));
      const withH = latinConsonants(b);
      // "-ah" is usually ة (Fatimah, Sarah, Abdullah); "-eh/-ih/-oh" usually a real ح/ه (Saleh, Wajih).
      out.push(...(/ah$/.test(b) ? [without, withH] : [withH, without]));
    } else {
      out.push(latinConsonants(b));
    }
  }
  return out;
}

/** Skeleton variants of ONE search token (already passed through searchKey). Primary first, no empties. */
function tokenSkeletons(tok) {
  if (!tok) return [];
  const list = /[؀-ۿ]/.test(tok) ? arabicSkeletons(tok) : latinSkeletons(tok);
  return [...new Set(list.filter(Boolean))];
}

/**
 * All skeleton variants of a string (the canonical key first). Multi-word strings give one key per word
 * joined by spaces; variants change one word at a time (plus all-alternatives), so the list stays short.
 */
export function skeletonVariants(s) {
  // A word-initial hamza before ل (إلهام، ألطاف) is part of the name, not the article: keep it as ء so that
  // normalisation (إ → ا) does not turn it into a strippable "ال".
  const pre = String(s ?? '').normalize('NFC').replace(/(^|[\s\-])[إأ](?=ل)/g, '$1ء');
  const toks = searchKey(pre).split(' ').filter(Boolean).map(tokenSkeletons).filter((v) => v.length);
  if (!toks.length) return [];
  const primary = toks.map((v) => v[0]);
  const out = new Set([primary.join(' ')]);
  toks.forEach((v, i) => {
    for (const alt of v.slice(1)) {
      const copy = primary.slice();
      copy[i] = alt;
      out.add(copy.join(' '));
    }
  });
  out.add(toks.map((v) => v[v.length - 1]).join(' '));
  return [...out];
}

/**
 * Shared consonant skeleton for Arabic, Latin and Arabizi spellings of a name, e.g.
 * Mohamed / Muhammad / محمد → "mhmd"; abdulrahman / عبد الرحمن → "abdlrhmn"; alharbi / الحربي → "hrb";
 * 3li / Ali / علي → "al". See the comment above for the rules.
 */
export function skeletonKey(s) {
  return skeletonVariants(s)[0] || '';
}

/** Skeleton variants of a single already-normalized token (used by graph.js search). */
export function tokenSkeletonVariants(tok) {
  return tokenSkeletons(tok);
}

// ---------------------------------------------------------------------------------------------------------
// Full-name detection (person form hint NAME_LOOKS_FULL) and splitting

const CONNECTOR_KEYS = new Set(['بن', 'بنت', 'ابن', 'bin', 'bint', 'ibn', 'binti']);
// Words that start a compound given name with the following word.
const PREFIX_KEYS = new Set(['عبد', 'ابو', 'ابي', 'ام', 'abd', 'abdul', 'abdel', 'abdal', 'abu', 'abou', 'abo', 'umm', 'um', 'oum']);
// Articles that belong to the following word (Latin "al Din", Arabic lone "آل").
const ARTICLE_KEYS = new Set(['ال', 'al', 'el', 'ul']);
// Second halves of compound given names: عماد الدين، عبد الله، سيف الإسلام، نور الهدى، زين العابدين…
const AR_SUFFIX_KEYS = new Set(['الدين', 'الله', 'الاسلام', 'الهدي', 'الحق', 'النبي', 'الرسول', 'الزمان', 'العابدين', 'الدوله', 'الرحمن', 'الرحيم']);
const LATIN_SUFFIX_RE = /^(?:[aeu][ldnrstz]{1,2})?(?:din|deen|dine|allah|ullah|illah|ollah|alla|islam|huda|hoda|haq|haqq|zaman|abidin|abideen|dawla|dawlah)$/;

/** Comparison key of one whitespace token (no gluing). */
function tokenKey(raw) {
  return normalizeArabic(raw).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
}

/** Tokens of a typed name with compounds joined: [{raw, key, connector}] */
function nameTokens(s) {
  // Split the text as typed (suggestions keep the person's own spelling); compare with normalized keys.
  const raw = String(s ?? '').normalize('NFC').replace(INVISIBLE, '').trim().split(/\s+/).filter(Boolean);
  // 1. articles stick to the following word
  const step1 = [];
  for (let i = 0; i < raw.length; i++) {
    const key = tokenKey(raw[i]);
    if (!key) continue;
    if (ARTICLE_KEYS.has(key) && i + 1 < raw.length) {
      const next = raw[i + 1];
      step1.push({ raw: `${raw[i]} ${next}`, key: key + tokenKey(next) });
      i++;
      continue;
    }
    step1.push({ raw: raw[i], key });
  }
  // 2. compounds: "عبد X", "ابو X", "X الدين", "Emad Al-Din"
  const out = [];
  for (const t of step1) {
    const connector = CONNECTOR_KEYS.has(t.key);
    const prev = out[out.length - 1];
    const isSuffix = AR_SUFFIX_KEYS.has(t.key) || LATIN_SUFFIX_RE.test(t.key);
    if (prev && !prev.connector && !connector && (PREFIX_KEYS.has(prev.key) || isSuffix)) {
      prev.raw += ` ${t.raw}`;
      prev.key += t.key;
      continue;
    }
    out.push({ raw: t.raw, key: t.key, connector });
  }
  return out;
}

/**
 * Does this text look like a full name rather than a given name? True when it contains بن/بنت/ابن/bin/bint/ibn
 * or has more than 2 words after joining compounds (عبد الرحمن، عماد الدين، أبو بكر count as one).
 */
export function looksLikeFullName(s) {
  const toks = nameTokens(s);
  if (toks.some((t) => t.connector)) return true;
  return toks.length > 2;
}

function looksLikeFamilyName(tok) {
  return /^(ال|abu|abou|abo|ابو|al|el)/.test(tok.key) && tok.key.length >= 4;
}

/**
 * Suggested split of a full name: {given, father, family, grandfathers[]}.
 *   "محمد حسن سالم عالم" → given محمد, father حسن, grandfathers [سالم], family عالم
 *   "محمد بن حسن بن سالم" → given محمد, father حسن, grandfathers [سالم], family ""
 *   "زكية إسماعيل قربان" → given زكية, father إسماعيل, family قربان
 *   two words: "أحمد الحربي" → family; "أحمد حسن" → father.
 * Suggestions only — the form lets the person confirm.
 */
export function splitFullName(s) {
  const toks = nameTokens(s);
  const names = [];
  let afterConnector = false;
  for (const t of toks) {
    if (t.connector) { afterConnector = true; continue; }
    names.push({ ...t, afterConnector });
    afterConnector = false;
  }
  const res = { given: '', father: '', family: '', grandfathers: [] };
  if (!names.length) return res;
  res.given = names[0].raw;
  if (names.length === 1) return res;
  const hasConnector = toks.some((t) => t.connector);
  if (names.length === 2) {
    if (!hasConnector && looksLikeFamilyName(names[1])) res.family = names[1].raw;
    else res.father = names[1].raw;
    return res;
  }
  res.father = names[1].raw;
  const last = names[names.length - 1];
  if (last.afterConnector) {
    res.grandfathers = names.slice(2).map((t) => t.raw);
  } else {
    res.family = last.raw;
    res.grandfathers = names.slice(2, -1).map((t) => t.raw);
  }
  return res;
}
