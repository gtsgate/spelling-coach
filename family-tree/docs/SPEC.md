# Grand Family Tree — Technical Specification (v2)

Single source of truth for every module. If code and spec disagree, the spec wins (or is changed deliberately).
v2 incorporates an independent design review (UX/culture, GitHub automation/security, genealogy data model).

## 0. Goals

A bilingual (Arabic / English) collaborative family-tree portal:

* Hosted free on **GitHub Pages**, readable by everyone, no login to browse (`noindex` — not listed by search engines).
* Relatives **propose** changes: add people (spouses, children, parents, siblings — whole branches at once), correct info,
  "mark as" (deceased, verified, needs-info, duplicate, private…), re-arrange (order of children/spouses, change parents).
  Proposals never change the live data directly.
* **Only approvers** (the owner; `config.approvers`) can approve, on GitHub (label or `/approve` comment). A GitHub Action
  validates, applies to `data/family.json`, commits, and the site updates.
* **Deletion is never casual**: removals are soft (restorable), need a reason code + typed-name confirmation, are blocked when
  they would orphan descendants, are capped per proposal, and need a *separate* approval (`approve-deletion`). Any approval can be
  undone (`/undo`).
* Spouses who married in can add *their own* families → the model is a graph (unions), not a single tree.
* Most relatives will use **WhatsApp**, not GitHub: WhatsApp-to-owner is the primary send path; GitHub is optional.
* Privacy & culture: living people's birth dates default to year-only and are *stored* truncated; names may be withheld
  (shown as kunya or polite relational label); divorce is not displayed by default; no crosses for the deceased.
* Zero build step, zero runtime dependencies: plain HTML + CSS + ES modules. Node ≥ 20 (CI uses 22) for scripts/tests.

## 1. Repository layout

The portal lives in `family-tree/` (movable to its own repo unchanged). The repo root hosts an unrelated app (Spelling Coach) —
never touch files outside `family-tree/` and `.github/`.

```
family-tree/
  index.html  manifest.json  config.json  package.json
  img/                         # icons, og image
  data/
    family.json                # canonical data (§2)
    changelog.json             # applied proposals, newest first (§6.6)
    applied.json               # permanent ledger of applied proposal hashes (§6.6) — never truncated
    photos/                    # optional person photos  <personId>.jpg|webp
  css/  base.css tree.css person.css forms.css pages.css flows.css
  js/
    core/                      # PURE logic (no DOM/fetch). Browser AND Node ES modules.
      schema.js dates.js names.js graph.js ops.js codec.js describe.js kinship.js messages.js
    i18n.js dom.js store.js app.js ui.js submit.js
    views/   home.js tree.js person.js search.js wizard.js draft.js me.js relationship.js changes.js about.js admin.js preview.js
    forms/   person-form.js dialogs.js picker.js
  scripts/
    apply-proposal.mjs  check-proposal.mjs  validate-data.mjs  import-initial.mjs  backup.mjs(optional)
    lib/  github.mjs labels.mjs commands.mjs render.mjs hash.mjs repo.mjs
  tests/   *.test.mjs (node:test)   e2e/smoke.mjs (Playwright, local only)
  docs/    SPEC.md  OWNER-GUIDE.md
.github/
  workflows/family-tree-check.yml     # issues opened/edited/reopened → dry-run + bot comment
  workflows/family-tree-apply.yml     # approvals queue → apply → commit → comment/close; /reject /undo
  workflows/family-tree-ci.yml        # push/PR touching family-tree/** → tests + validate-data
  workflows/family-tree-backup.yml    # weekly data release
  ISSUE_TEMPLATE/family-tree-proposal.yml
  ISSUE_TEMPLATE/config.yml           # blank_issues_enabled: true (keeps Spelling Coach issues working)
```
Live URL (after merge to `main`; Pages "deploy from branch" root): `https://<owner>.github.io/<repo>/family-tree/`.
All site paths are relative. GitHub automation & the issue form only work once merged to the default branch.

## 2. Data model — `data/family.json`

```jsonc
{
  "schema": 1,
  "meta": { "title": {"ar":"…","en":"…"}, "rootPersonId": "p…", "revision": 12, "updatedAt": "ISO", "demo": false },
  "people": { "<pid>": Person },     // keyed by id, insertion order = creation order
  "unions": { "<uid>": Union }
}
```

### 2.1 Person — full in-memory shape (`normalizePerson`)
```jsonc
{
  "id": "pa1b2c3d",
  "name":       {"ar": "أحمد", "en": "Ahmed"},  // GIVEN name only (ism; compounds like "عبد الله", "عماد الدين" are one name)
  "nameStatus": "known",                       // "known" | "unknown" | "withheld"  (see below)
  "surname":    {"ar": "", "en": ""},          // family/tribe name or rest of a married-in spouse's full name, rendered VERBATIM
  "nickname":   {"ar": "", "en": ""},          // kunya/laqab/other name: "أبو خالد", "بيبي"
  "gender":     "m",                           // "m" | "f" | ""   (UI requires it for new people; data may be "")
  "birth":  {"date": "1950", "hijri": "", "approx": false, "place": {"ar":"","en":""}},
  "deceased":   false,
  "death":  {"date": "", "hijri": "", "approx": false, "place": {"ar":"","en":""}},
  "occupation": {"ar": "", "en": ""},
  "bio":        {"ar": "", "en": ""},
  "photo":      "",                            // "" | "https://…" | "photos/<pid>.jpg|webp"
  "privacy":    "year",                        // birth-date precision STORED & shown: "full" | "year" | "hidden"
  "tags":       [],                            // "verified", "needs-info"
  "needsInfo":  "",                            // what is missing (free text, ≤300)
  "duplicateOf": "",
  "spouseOrder": [],                           // uids: display order of this person's unions
  "ties": [],                                  // non-biological ties, see below
  "removed":    null,                          // soft-delete record (§2.4) or null
  "history":    []                             // newest last, max 20: {"issue":12|null,"rev":13,"at":"ISO","action":"add-person","from"?:uid,"index"?:n}
}
```
* **Auto English** (`js/core/translit.js`): `name.en`, `surname.en`, `nickname.en` are stored ONLY when someone typed or corrected
  them. When empty, the English spelling is generated from the Arabic (`englishOf(field, kind)`; dictionary of preferred spellings —
  the owner chose **Muhammad** for محمد — plus compound rules and a letter-based fallback). Every English display (cards, lineage,
  describe, search index, issue text) uses `englishOf`, never raw Arabic, when the language is English. Forms auto-fill the English
  field live as Arabic is typed until the user edits it; on save the English value is sent only if it differs from the automatic one.
  The person page marks automatic spellings subtly ("automatic spelling — correct it") so each person can choose their own.
* **Compact stored form** (`compactPerson`): drops `""`, empty bilingual objects, `approx:false`, empty arrays, `null`, `deceased:false`,
  `nameStatus:"known"`, `privacy:"full"`; empty `birth`/`death` objects. Always keeps `id`. Key order on write = order above.
  `normalizePerson` restores the full shape. Note: compact drops `privacy:"full"`, so a missing `privacy` means `"full"`.
* **nameStatus**: `known` → `name.ar` or `name.en` or `nickname.*` non-empty (kunya-only men allowed).
  `unknown` / `withheld` → `name.ar` and `name.en` MUST be empty (`NAME_SHOULD_BE_EMPTY`) so a withheld name never reaches the repo.
  Display for unknown/withheld: nickname if any (e.g. "أم خالد"), else a polite relational label computed by names.js
  (§4 names). Surname may still be shown.
* **Privacy is enforced in storage**: `normalizePerson` truncates `birth.date`/`birth.hijri` to the year when `privacy:"year"` and clears
  them when `"hidden"`. So private detail never reaches the public repo, whatever path the data came from.
  Forms default to `year` for every living person; `full` is the default only for deceased people (or after an explicit warning).
* **Dates**: partial Gregorian `"YYYY" | "YYYY-MM" | "YYYY-MM-DD"` (real calendar dates, year 1–9999) or `""`.
  `hijri` holds the date *as entered* in Hijri (`"YYYY"…`, year 1–1500). When `hijri` is set, `date` is derived from it:
  full → exact Gregorian (Umm al-Qura via Intl); year/month only → Gregorian of day 1 of that Hijri year/month, `approx:true`.
  Setting `date` directly (edit path `birth.date`) clears `hijri`. Display shows the original calendar first.
* `death.date` or `death.hijri` non-empty ⇒ `deceased:true`. Setting `deceased:false` clears `death.*`.
* **ties** (never parentage — excluded from ancestors, cycles, lineage, branches, generations, invariant 6):
  `{"type": "milk-child-of" | "foster-child-of", "person": "<pid>", "note": {"ar":"","en":""}}` stored on the child;
  milk-child-of = nursed by (rada'a); foster-child-of = raised under kafala by.

### 2.2 Union — a couple and/or a set of children sharing parents
```jsonc
{
  "id": "ux9y8z7w",
  "partners": ["p…", "p…"],          // 0..2 distinct (0 = siblings with unknown parents)
  "children": ["p…", "p…"],          // ORDERED (birth order / as re-arranged)
  "status":   "married",             // "married" | "divorced" | "widowed" | "unknown"
  "marriage": {"date": "", "hijri": "", "approx": false, "place": {"ar":"","en":""}},
  "divorce":  {"date": "", "hijri": "", "approx": false},
  "note":     {"ar": "", "en": ""},  // ≤500, e.g. "remarried in 1980"
  "removed":  null
}
```
Compact drops empty `marriage`/`divorce`/`note`, `status:"unknown"`, empty `children`, `removed:null`.
Remarriage to the same person = the same union (status back to `married`; earlier divorce in `note`).
Widowhood is *derived*: status `married` + a deceased partner → UI shows أرملة/أرمل (widow/widower), kinship says "late husband".
`config.showDivorce` (default `false`): when false, divorced unions display like any marriage and kinship never says "former".

### 2.3 Invariants — `validateData(data, {allowTempIds = false})` → `{ok, errors:[Issue], warnings:[Issue]}`
Errors:
1. `schema === 1`; `people`/`unions` are objects; keys equal ids.
2. ids: people `/^p[a-z0-9]{3,24}$/`, unions `/^u[a-z0-9]{3,24}$/`. With `allowTempIds` (preview mode only) also people `/^new[0-9]+$/`,
   unions `/^newu[0-9]+$/` and `/^tmpu[0-9]+$/`.
3. nameStatus rules (§2.1). 4. Enumerations, dates (incl. hijri), photo format, string limits.
5. Union partners ≤2, distinct, existing; children existing, no duplicates; nobody is partner and child of the same union.
6. A person is a child of **at most one** non-removed union.
7. No cycles (ancestor = partner of birth union, transitively, active unions only).
8. `duplicateOf`, `removed.mergedInto`, `ties[].person` reference existing people ≠ self.
9. At most one active union per 2-partner set, and at most one active single-partner union per person (`DUPLICATE_UNION`).
10. In an active 2-partner union neither partner is an ancestor of the other (`ANCESTOR_LINK`).
11. `privacy` truncation respected (`PRIVATE_DATE_STORED`).
Warnings: stale `spouseOrder`; root missing/removed; death before birth; child born before parent aged 12 / >1y after father's death /
after mother's death (±1y tolerance for Hijri-year-only dates); siblings with the same normalized name; `SAME_GENDER_PARTNERS`;
`PARENT_GENDER_UNKNOWN`; `MARRIAGE_BEFORE_12`; `MARRIAGE_AFTER_DEATH`; `WIDOWED_BUT_LIVING`; `CONCURRENT_HUSBANDS`;
`DIVORCE_DATE_WITHOUT_STATUS`; union with < 2 members.

`Issue` = `{code: "UPPER_SNAKE", params: {...}, op?: number, path?: string}`; `messages.js#formatIssue(issue, lang)` renders every code in `ar` and `en`.

### 2.4 Removal records
`removed = {at, reasonCode, issue, by, mergedInto?, with?, auto?, merge?}` where
`reasonCode ∈ "duplicate" | "entered-by-mistake" | "wrong-parents" | "person-requested" | "other"` — **no free text** (sensitive
family matters stay private; "other" → the UI asks the user to explain to the owner on WhatsApp).
`with: pid` = union auto-removed because that person was removed; `auto: true` = removed because it became empty.

## 3. Proposals

### 3.1 Envelope
```jsonc
{ "kind": "gft-proposal", "v": 1,
  "id": "k3j9x0a2mq",                 // 10 random base36 chars, stable for this proposal
  "createdAt": "ISO", "baseRevision": 12,
  "dependsOn": ["<proposalId>", …],   // earlier proposals (same browser) whose temp refs this one uses
  "submitter": {"name": "", "relation": "", "personId": ""},
  "note": "",                          // ≤2000
  "ops": [Op, …] }                     // 1..150
```
LIMITS: ops ≤150; names ≤100; surname/nickname/place ≤200; other text ≤2000; bio ≤4000; needsInfo ≤300; union note ≤500;
encoded code ≤ 60,000 chars; decoded JSON ≤ 1 MB; destructive ≤3 + merges ≤30 per proposal.

### 3.2 References & resolution
* `PersonRef` = existing person id, or temp ref `/^new[0-9]+$/` declared by an `add-person` (`ref`) earlier in this proposal **or** in a
  proposal listed in `dependsOn`. `UnionRef` = existing union id or `/^newu[0-9]+$/` bound by an op's `unionRef`.
* Temp refs come from a per-browser monotonic counter (never reused, even across drafts), so refs are unique across one person's proposals.
* Re-declaring a ref → `DUPLICATE_REF`; undeclared temp ref → `UNKNOWN_REF` (in final mode refs from `dependsOn` resolve via `opts.refMap`;
  a missing dependency → `DEPENDS_ON_PENDING {proposalId}`); a real-looking id that does not exist → `UNKNOWN_ID`.
* Resolving any ref field (id, of, with, a, b, union, keep, remove, mark `of`, `order[]`, tie person): if the target exists but is removed
  and has `removed.mergedInto` → follow it (transitively, ≤10 hops), warning `MERGED_REDIRECT {from,to}`; removed without mergedInto →
  `TARGET_REMOVED` (except restore ops, which require a removed target).
* Ops that use **or** create a union carry `"unionRef":"newuN"` (the site always sets it), binding the ref to the union actually used.
  Without it, a created union gets preview id `tmpu<n>` (not referenceable).

### 3.3 Operations
`PersonInput` = any of `name, nameStatus, surname, nickname, gender, birth, deceased, death, occupation, bio, photo, privacy, needsInfo`.
Unknown keys → `UNKNOWN_FIELD`.

| op | fields | semantics |
|---|---|---|
| `add-person` | `ref`, `person`, `link`?, `unionRef`?, `index`? | Create person (nameStatus rules apply). Warning `POSSIBLE_DUPLICATE {id}` when an active person has the same normalized given name AND (same target birth union \| same father \| same normalized surname & birth year ±2 \| link is spouse/parent and same nickname or surname). Warning `MINOR_DETAIL` if a person under 18 has photo/bio/occupation/birth place or a full birth date. Warning `NAME_LOOKS_FULL` (name contains بن/بنت/ابن/bin/bint/ibn or > 2 tokens after joining compounds). Warning `GENDER_MISSING`. |
| `edit-person` | `id`, `set` {path:value}, `before`? | Paths: `name.ar name.en nameStatus surname.ar surname.en nickname.ar nickname.en gender birth.date birth.hijri birth.approx birth.place.ar birth.place.en deceased death.date death.hijri death.approx death.place.ar death.place.en occupation.ar occupation.en bio.ar bio.en photo privacy`. Result must satisfy nameStatus rules (`NAME_REQUIRED`). `before[path]` ≠ current → `STALE_EDIT`: **error in final mode** unless `opts.force`, warning in preview. Changing gender of a parent → warning `GENDER_FLIPS_PARENT`. |
| `mark` | `id`, `mark`, `date`?, `hijri`?, `of`?, `note`? | `deceased` (deceased=true; date/hijri → death) · `living` (deceased=false, death cleared) · `verified`/`unverified` · `needs-info` (tag + needsInfo=note) / `info-complete` · `duplicate` (duplicateOf=`of`, active other person) / `not-duplicate` · `private` (privacy→year with truncation, clears places, occupation, bio, photo, sets nameStatus `withheld` and clears name — for people who ask to be hidden; links kept). |
| `link-spouse` | `a`, `b`, `status`?, `marriage`?, `unionRef`? | New union [a,b]. Errors `SAME_PERSON`, `DUPLICATE_UNION`, `ANCESTOR_LINK`. |
| `move-person` | `id`, `to`: `{union}` \| `{of, with}`, `unionRef`?, `index`? | Change parents (remove from current birth union, add to target resolved as in §3.4). Errors `INVALID_RELATION` (target has id as partner), `CYCLE`, `ANCESTOR_LINK`. If a known parent (an active partner of the old birth union not in the target) is dropped → warning `REPARENT {from, droppedParents, descendants}` and the proposal becomes destructive (needs approve-deletion; does not count toward the cap). History `{action, from, index}`. |
| `edit-union` | `union`, `set`, `before`? | Paths: `status marriage.date marriage.hijri marriage.approx marriage.place.ar marriage.place.en divorce.date divorce.hijri divorce.approx note.ar note.en`. STALE_EDIT as edit-person. |
| `reorder-children` | `union`, `order`, `beforeOrder`? | New order = listed current children in that order + the rest in current order. Unknown ids → warning `ORDER_IGNORED`. `beforeOrder` ≠ current → STALE_EDIT rule. |
| `reorder-spouses` | `id`, `order` [UnionRef] | spouseOrder = listed unions containing id, then the remaining ones in current display order. |
| `add-tie` | `id`, `type`, `person`, `note`? | Add a milk/foster tie (no duplicates `DUPLICATE_TIE`, not self). |
| `restore-person` | `id` | `removed=null`; re-activates unions with `removed.with===id`. Errors `RESTORE_CONFLICT {reason}` (would break invariants 6/9/10 or create a cycle); merged person → `MERGED_USE_UNDO`. |
| `restore-union` | `union` | Re-activate a removed union (same conflict checks). |
| **`remove-person`** ⚠ | `id`, `reasonCode`, `redact`? | Soft delete. Errors `IS_ROOT`, `HAS_CHILDREN {children}` (active children in any of their unions), `ALREADY_REMOVED`. Also soft-removes their active childless unions (`removed.with=id`). `redact:true` additionally clears every personal field (nameStatus withheld) — for "remove me" requests. |
| **`unlink-spouse`** ⚠ | `union`, `reasonCode` | Soft-remove a 2-partner union; `HAS_CHILDREN` if it has active children. |
| **`detach-person`** ⚠ | `id`, `reasonCode` | Remove id from its birth union's children (UI label: "linked to the wrong parents"). Union kept (soft-removed with `auto` if emptied). History `{from, index}` so `move-person {union: from}` undoes it. |
| **`remove-tie`** ⚠ | `id`, `type`, `person`, `reasonCode` | Remove a tie. |
| **`merge-person`** ⚠ | `keep`, `remove`, `reasonCode`, `parents`? (`"keep"\|"remove"`) | `remove` is the same human as `keep`. Errors: `SAME_PERSON`, `TARGET_REMOVED`, `MERGE_SPOUSES` (they are partners in one union), `GENDER_CONFLICT`, `ANCESTOR_LINK`, `CYCLE` (checked on result), `CONFLICTING_PARENTS` (different birth unions and no `parents` choice). Unions where `remove` is partner → `keep` replaces it; if that yields two active unions with the same partner set, the later one's children are appended to the earlier, empty marriage/status fields filled, and the later is soft-removed with `mergedInto`. Birth union: `parents` decides; same union → drop remove; only remove has one → keep takes its slot. Empty fields of keep filled from remove; differing non-empty fields → warning `MERGE_FIELD_CONFLICT {path, keep, remove}` (keep wins). Tags/ties merged; others' `duplicateOf===remove` → keep (cleared if self); `rootPersonId===remove` → keep; remove's unions appended to keep.spouseOrder. `remove.removed = {…, mergedInto: keep}`. Undo is via `/undo` (§6.5). |

⚠ destructive. `DESTRUCTIVE_OPS = remove-person, unlink-spouse, detach-person, remove-tie, merge-person`; plus move-person with REPARENT.
Max 3 non-merge destructive (`TOO_MANY_DESTRUCTIVE`) and 30 merges (`TOO_MANY_MERGES`). Destructive ops need existing ids (`TEMP_NOT_ALLOWED`).

**Every path that creates a union or adds a partner** (add-person links, link-spouse, move-person, merge, restores) runs
`SAME_PERSON`, `ANCESTOR_LINK`, `DUPLICATE_UNION` and `CYCLE` checks and reports them with its op index.

### 3.4 Links of `add-person` (and target resolution of `move-person`)
* `{"as":"child","of":P,"with":Q|null}` → active union whose partner set is exactly `{P,Q}` (or `{P}`); found → insert child; else create
  `{partners:[P,(Q)], status: Q ? "married" : "unknown"}`. `{"as":"child","union":U}` → insert into U.
  Insert position: `index` if given, else before the first sibling with a later known birth date, else append.
* `{"as":"spouse","of":P,"status"?,"marriage"?}` → create `[P,new]` (status default `married`; the UI's "former spouse" sends `divorced`).
* `{"as":"parent","of":P,"scope":"union"|"only"}` (default union) → B = birth union of P.
  `union`: B has <2 partners → add new as partner (every child of B gains this parent — describeOp lists them); 2 partners → `PARENTS_FULL`;
  same non-empty gender as B's single partner → `PARENT_GENDER_CONFLICT`; no B → create `{partners:[new], children:[P]}`.
  `only`: move P alone into find-or-create union {B's single partner (if any), new}.
* `{"as":"sibling","of":P,"share":"both"|"father"|"mother","otherParent"?:Q|null}` → `both`: append to P's birth union (create
  `{partners:[], children:[P,new]}` if none); `father`: resolve as `{as:"child", of: father(P), with: otherParent ?? null}`
  (`FATHER_UNKNOWN` if P has no male parent); `mother` likewise (`MOTHER_UNKNOWN`).

### 3.5 Apply — `applyProposal(data, proposal, opts)`
```
opts = { mode: "final"|"preview", now, issue, actor, rev?, allowDestructive (preview: true, final: false),
         force: false, refMap: {ref→id} (final: temp refs of dependsOn proposals), idGen?(prefix) }
→ { ok, data, errors, warnings, idMap, touched:{people,unions}, created:{people,unions}, destructive, reparent:[…], merges:n }
```
* Never mutates input; returns normalized deep copy. **Atomic**: any error → `ok:false`, data unchanged, all errors listed (with `op`).
* `validateProposal` first (shape, types, limits, ref declaration order).
* Preview: created people get id = their ref; unions get their `unionRef` (or `tmpu<n>`). Final: random ids `p`/`u` + 7 base36
  (crypto.getRandomValues), never colliding; `idMap` maps refs → real ids.
* Pruning: only unions **created by this proposal** left with <2 members are deleted. Pre-existing unions that drop below 2 members are
  soft-removed (`auto:true`). Soft-removed people count as members.
* Final: `meta.revision += 1`, `meta.updatedAt = now`, history entries `{issue, rev, at, action}` on touched people (cap 20).
* Destructive (incl. REPARENT) and `!allowDestructive` → `DESTRUCTIVE_NOT_ALLOWED`.
* Post-condition: `validateData(result, {allowTempIds: mode==="preview"}).ok`, else `ok:false` with those errors.
* `applyProposals(data, [proposal…], opts)` helper applies several in sequence (preview overlay of sent proposals).

## 4. Core module APIs (`js/core/*.js`)
Named exports only; no DOM/fetch/Node-only imports (`globalThis.crypto`, `CompressionStream`/`DecompressionStream`, `btoa/atob`,
`TextEncoder`, `Intl` exist in Node ≥20 and browsers).

**schema.js** — constants (`SCHEMA_VERSION, GENDERS, PRIVACY, NAME_STATUSES, UNION_STATUSES, MARKS, TIE_TYPES, REASON_CODES,
DESTRUCTIVE_OPS, PERSON_EDIT_PATHS, UNION_EDIT_PATHS, LIMITS`), id/ref predicates, `emptyPerson emptyUnion normalizePerson
normalizeUnion normalizeData compactPerson compactUnion compactData validateData(data,{allowTempIds}) emptyData serializeData`
(compact, 2-space, trailing newline), `newProposalId()`.

**dates.js** — `toAsciiDigits(s)` (U+0660–0669, U+06F0–06F9 → 0–9) · `parseDate` · `isValidDate` · `isValidHijri` · `compareDates` ·
`yearOf` · `hijriToGregorian(h)` ("YYYY[-MM[-DD]]" Hijri → {date, approx}) by searching Gregorian days with
`Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn')` (no tables) · `gregorianToHijri(date)` · `formatDate(dateObj|string, lang,
{precision:"full"|"year"|"hidden", approx, hijri, calendar:"gregorian"|"hijri"})` → AR `"12 مارس 1950"`, EN `"12 Mar 1950"`, approx
`"حوالي 1950"`/`"c. 1950"`, Hijri-entered `"1370 هـ (حوالي 1950)"` / `"1370 AH (c. 1950–51)"` · `setDigits("latn"|"arab")` ·
`setMonthNames("standard"|"levantine")` (levantine: كانون الثاني…, static table) · `age(birth, end, today)` · `isMinor(person, today)` ·
`yearsLabel(person, lang)` (e.g. "1950–2010", "b. 1990"/"م 1990", "d. 2010"/"ت 2010" — never a cross). Locales are pinned:
`ar-u-ca-gregory-nu-latn|nu-arab`, `en-GB-u-ca-gregory`, Hijri via `-u-ca-islamic-umalqura`.

**translit.js** (exists) — `transliterate(ar, {kind:"given"|"surname"})`, `englishOf(field, kind)`, `isAutoEnglish(field)`,
`autoEnglish(person)`, `normalizeForTranslit`.

**names.js** — `personName(p, lang)` (given name; for `en` uses `englishOf(name)` so Arabic-only names get auto English; for `ar` falls
back to the English text) · `displayName(p, lang, graph?)`: known → name (+ " (nickname)");
unknown/withheld → nickname, else a polite relational label using graph: wife "زوجة X"/"Wife of X" (withheld wife: "حرم X"), daughter
"ابنة X" (withheld: "كريمة X"), son "ابن X", unknown gender "أحد أبناء X"/"Child of X", else "غير معروف"/"Unknown"; plus surname
when present · `fullName(p, lang, graph?)` (displayName + surname verbatim, never adds آل/Al-) · `lineageName(graph, id, lang,
{depth:3, style})`: style `"plain"` (default from `config.lineageStyle`) → "محمد حسن سالم عالم" / "Mohammed Hassan Salem Alam";
`"bin"` → "محمد بن حسن بن سالم عالم" / "Mohammed bin Hassan bin Salem Alam" (بنت/bint for women; kunya-only ancestor in genitive
after بن: أبو→أبي). Follows ONLY a male father (gender m); stops at unknown/withheld/absent father; surname = the first non-empty
surname along the whole paternal chain (unbounded) · `initials` · `normalizeArabic` (strip tashkeel/tatweel; أإآٱ→ا; ة→ه; ى→ي; ؤ→و;
ئ→ي; "عبد ال"≡"عبدال"; "ابو "≡"ابو") · `searchKey(s)` · `skeletonKey(s)`: shared consonant skeleton for Arabic, Latin and Arabizi
(Latin: lowercase, strip diacritics, Arabizi 2→'' 3→'' 5→kh 6→t 7→h 9→s, drop al/el tokens or glued prefix on words ≥5, drop vowels
a e i o u y w after the first letter, collapse doubles; Arabic: normalize, strip leading ال on tokens ≥4, transliterate consonants with
a static table, drop ا و ي ى and final ة/ه) so `Mohamed`, `Muhammad`, `محمد` share a key; `abdulrahman`↔`عبد الرحمن`; `alharbi`↔`الحربي`;
`3li`↔`علي` · `looksLikeFullName(s)` · `splitFullName(s)` → {given, father, family} suggestions · `setLineageStyle(style)`.

**graph.js** — `buildGraph(data, {includeRemoved:false})` → immutable `Graph`:
```
person(id) union(id) people() removedPeople() removedUnions() resolve(id) (follows mergedInto)
birthUnion(id) parents(id) father(id) mother(id)        // father/mother by gender only (null if gender "")
unionsOf(id)   // active unions where id is partner: spouseOrder first, then marriage date, then insertion
spouses(id) → [{person, union}]   childrenOfUnion(uid)   children(id) (by birth year when known, else union order then child order)
siblings(id) → {full:[], half:[{person, via:"father"|"mother"}], unspecified:[]}   // full only via one 2-partner union
ties(id) → [{type, person, direction:"to"|"from"}]   milkSiblings(id)
ancestors(id) → Map<id,depth>   descendants(id) → Map<id,depth> (blood only: unions where the focal person is partner)
isAncestor(a,b)   branches() → [{person, partner|null, label, count}]   // §4 below   generationDepth(id)
stats() → {people, living, deceased, unions, generations, branches}
search(query, {limit:30}) → [{person, score}]   // exact > normalized > skeleton; ar + en (stored OR auto English) name, nickname, surname, lineage tokens
duplicatesSuspects() → [[a,b,reason]]   recentlyAdded(n) (by history)
```
`branches()`: parentless active people with descendants, none of whose spouses in child-bearing unions has active parents; when both
partners of a union are parentless, the union is listed once, represented by the male partner (or partners[0]) and labelled "X & Y".

**ops.js** — `validateProposal(p)` · `applyProposal` · `applyProposals` · `isDestructive(p)` (static ops only; REPARENT known after apply) ·
`newProposal()` (with fresh id) · `opRefs(op)` → {declares, uses} · `proposalHash(p)` (sha-256 hex of canonical JSON with sorted keys,
excluding `createdAt`; async, `crypto.subtle`) · `skipOps(p, indexes)` → proposal without those ops and every op depending on them.

**codec.js** — `encodeProposal(p)` → `"GFT1:" + base64url(deflate-raw(UTF-8 JSON)) + "." + crc32(payload) in base36`
(`GFT0:` + base64url(JSON) when CompressionStream is missing) · `decodeProposal(text)`: accepts a code anywhere in text (regex
`/GFT[01]:[A-Za-z0-9_-]+(?:\.[0-9a-z]{1,7})?/`, whitespace/backticks inside are stripped first), raw JSON, or a fenced ```json block with
`kind:"gft-proposal"`; ignores codes on quoted lines (`> `) when `{ignoreQuoted:true}`; stops inflating at 1 MB; throws Error with
`.code ∈ NO_PROPOSAL | BAD_CODE | BAD_JSON | TRUNCATED_CODE | TOO_LARGE` · `extractProposal(body, opts)` → `{proposal, code}|null` (async).

**describe.js** — `describeOp(op, ctx, lang)` one-line plain text (no HTML/markdown), e.g. EN `Add “Ahmed” as son of Mohammed Hassan`,
AR `إضافة «أحمد» ابناً لـ محمد حسن`; ctx = `{graph, refNames}` (temp refs named from their add-person op) ·
`describeProposal(p, graph, lang)` → `{title, lines, destructive, counts:{add, edit, mark, arrange, remove}}` · Arabic is natural MSA with
gender agreement (ابناً/ابنةً، زوجاً/زوجةً، والداً/والدةً); never echo removal reasons beyond the reason-code label.

**kinship.js** — `findRelationship(graph, aId, bId)` → `{type:"self"|"blood"|"spouse"|"affinal"|"tie"|"none", up, down, path, lca,
half, via, side:"paternal"|"maternal"|null, spouseVia?, tie?}` ("what is b to a"; shortest path; cousin marriages → shortest) ·
`relationLabel(rel, graph, lang, {you:true, name})`: EN "your paternal uncle" / "Ahmed's paternal uncle"; AR "عمّك" / "عمّ أحمد".
Vocabulary — EN: father/mother, son/daughter, brother/sister (half-brother via father/mother), grandfather/grandmother (paternal/maternal),
grandson/granddaughter, great-…, uncle/aunt (paternal/maternal), great-uncle, nephew/niece, first cousin, n-th cousin k times removed,
husband/wife (late husband/wife; "former" only when showDivorce), *-in-law, "spouse of your …", "your spouse's …", milk mother/brother,
foster parent/child. AR: أب/أم، ابن/ابنة، أخ/أخت شقيق/شقيقة، أخ لأب/لأم، أخ (unspecified)، جد/جدة لأب/لأم، حفيد/حفيدة، عم/عمة/خال/خالة،
ابن/ابنة الأخ/الأخت، ابن/ابنة العم/العمة/الخال/الخالة، composed chains for distant relations ("ابن ابن عمّ والدك"، "عمّ جدّك")، زوج/زوجة،
زوجها الراحل، حمو/حماة، زوجة الأخ، زوج الأخت، "زوج/زوجة <relation>"، "<relation> زوجتك/زوجك"، أم/أخ من الرضاعة، كافل/مكفول.
Gender-unknown people use neutral forms ("قريب/Relative" fallback with a path description).

**messages.js** — `formatIssue(issue, lang)`; `ISSUE_CODES`. Every code has ar+en text; unknown → generic text with code.

## 5. Proposal transport (how a proposal reaches the owner)
The site never writes to GitHub. `submit.js` precomputes (on every draft/sent change) the code and every target URL, and renders each
option as a plain `<a href>`; click handlers do no async work (iOS/in-app browsers block windows/clipboard after awaits).
Before any send, a mandatory notice: "Everything you send will be public on the internet and stays in GitHub's public history /
كل ما ترسله سيكون مرئياً لأي شخص على الإنترنت ويبقى في سجل GitHub العام" (checkbox acknowledgement, remembered).

1. **Primary: "Send to {owner.name} on WhatsApp"** — `https://wa.me/<owner.whatsapp>?text=…` (digits only). If no number is configured the
   button opens `https://wa.me/?text=…` and the label says "choose {owner.name} in WhatsApp" (never presented as automatic).
   Text: greeting; submitter name & relation; up to 10 describe lines (+ "…and {n} more"); proposal id; blank line;
   "رمز التعديلات — يُرجى عدم تغييره / Change code — do not edit"; the code alone on its own line inside ``` fences. If the text exceeds
   4,000 chars → copy to clipboard (precomputed, synchronous) and show paste instructions instead of opening wa.me.
2. **Other ways** (collapsed): **GitHub issue** (labelled "requires a GitHub account") →
   `https://github.com/<o>/<r>/issues/new?template=family-tree-proposal.yml&title=…&code=…&submitter=…&note=…` measured on the fully
   encoded URL ≤ 7,500 chars (drop note, then submitter, then shorten title to 60; then clipboard fallback); **Email** (if `owner.email`);
   **Copy code**.
3. After sending, the draft moves to the **sent queue** (§7.3).
Issue title: `🌳 <describe title>` (prefix `⚠️ ` when destructive), ≤ 120 chars. Relay services are out of scope for v1.

## 6. GitHub automation

### 6.1 `config.json`
```jsonc
{ "repo": {"owner":"gtsgate","name":"spelling-coach","branch":"main"}, "portalPath":"family-tree",
  "siteUrl":"https://gtsgate.github.io/spelling-coach/family-tree/",
  "approvers":["gtsgate"],
  "owner": {"personId":"", "name":{"ar":"…","en":"…"}, "welcome":{"ar":"","en":""}, "whatsapp":"", "email":""},
  "defaultLanguage":"ar", "arabicDigits":false, "arabicMonthNames":"standard", "primaryCalendar":"gregorian",
  "lineageStyle":"plain", "showDivorce":false, "treeDefaultDepth":3,
  "privacyDefaults": {"femaleNameStatus":"known", "photos":"all"} }
```
Label names are constants in `scripts/lib/labels.mjs` (not config): `family-tree, approve, approve-deletion, needs-changes, applied,
deletion-request, duplicate, undone`.

### 6.2 Check (`family-tree-check.yml`): `issues: [opened, edited, reopened]` + `workflow_dispatch {issue}`
* permissions `contents: read, issues: write`; checkout `persist-credentials: false`; Node 22; actions pinned.
* Re-fetch the issue via REST (never trust event payload state). Skip closed / `applied` issues and issues without a proposal
  (no comment, no labels). Ensure labels exist. Add `family-tree` (+ `deletion-request` when destructive).
* proposalHash; fingerprint `fp` = first 16 hex chars (`fingerprintOf` in ops.js). If the hash is in `applied.json` or equals another open issue → say
  "identical to #N". Dry-run `applyProposal(mode:"final", allowDestructive:true)` with `refMap` from applied.json for `dependsOn`.
* ONE bot comment (found by marker `<!-- gft-bot:check … -->` AND author `github-actions[bot]`), updated in place, containing: status
  ✅/❌, bilingual errors & warnings, submitter, numbered change lines (1-based op index) in English and Arabic, preview link
  `<siteUrl>#/preview?code=<code>` (fallback `#/preview/<n>` when code > 30,000 chars), and owner instructions with the exact commands
  in code blocks: `/approve <fp>` (or `/approve-deletion <fp>`), `/approve <fp> skip 3,5`, `/reject`, close to ignore.
  Marker stores `hash=<full> rev=<revision> edits=<n>`; `edits` increments on every `edited` event where the hash changed.
* Untrusted text: never interpolate `${{ github.event.* }}` outsider-controlled values (issue title/body, comment body, label name) in
  `run:`; scripts read `$GITHUB_EVENT_PATH` / REST. Rendered comments escape markdown/HTML, insert U+2060 after `@` and `#`, are cut at
  60,000 chars ("…and N more — see preview").

### 6.3 Apply (`family-tree-apply.yml`)
Triggers: `issues: [labeled, opened]`, `issue_comment: [created]`, `schedule: "23 */6 * * *"`, `workflow_dispatch {issue?, dry_run?}`.
Job-level `if:` only passes for: labeled with `approve`/`approve-deletion`; opened with one of those labels; comments on issues (not PRs:
`github.event.issue.pull_request == null`) whose body starts with `/`; schedule; dispatch. `concurrency: {group: family-tree-data,
cancel-in-progress: false}` is on the **job**. permissions `contents: write, issues: write, pages: write`.
* **Commands** (first non-empty line, case-insensitive, trailing punctuation stripped; quoted lines ignored):
  `/approve [fp] [skip 3,5] [force]`, `/approve-deletion [fp] …`, `/reject`, `/undo`; Arabic aliases `/موافق`, `/موافق-حذف`, `/رفض`, `/تراجع`.
  Comment author must be in `config.approvers` (case-insensitive; `author_association` is not trusted) — else a polite reply.
  An approve comment adds the matching label via API (recording fp/skip/force in a hidden bot note), then the queue runs.
  A comment may contain a corrected proposal code (owner correction): it replaces the issue's proposal; it is dry-run and the result posted.
* **Queue**: every run lists open issues labelled `family-tree` + (`approve` | `approve-deletion`) without `applied`, oldest first, and for
  each re-fetches the issue and verifies via the issue events API that the actor of the most recent approve label was an approver (or the
  bot acting on an approver's comment). A cancelled/failed run therefore loses nothing; the schedule picks up stragglers.
* **Integrity**: recompute the hash from the current body (or correction). A label/bare `/approve` is accepted only if the body was never
  edited after the first check (`edits==0`) or the issue author is the approver; otherwise `/approve <fp>` with the current fp is required
  (reply with the exact command, remove label). If the hash is in `applied.json` → comment "already applied in #N", labels
  `applied`,`duplicate`, close.
* Destructive (incl. REPARENT) without `approve-deletion` → comment with the exact `/approve-deletion <fp>`; remove `approve`; skip.
* Apply all queued proposals in order into ONE commit: `applyProposal(mode:"final", allowDestructive, force, refMap, issue, actor, now)`.
  Failure → bilingual errors comment, label `needs-changes`, remove approve label (others in the batch still apply).
  `DEPENDS_ON_PENDING` → "approve #N first".
* Write `family.json` (serializeData), prepend changelog entries, add `applied.json` entries `{hash: {issue, proposalId, commit,
  idMap, at}}`; commit message built in Node (≤72-char English title) via `git commit -F`; checkout `ref: main`, push loop ≤5 attempts
  with backoff; on non-fast-forward: `git fetch && git reset --hard origin/main`, reload, re-apply the batch, commit, push. Never
  rebase/merge JSON. After 5 failures: comment "will retry automatically", leave labels.
* Pages: poll `GET /pages/builds/latest` ≤90 s; `POST /pages/builds` only if it is not building the pushed SHA (continue-on-error).
* Success comment: ✅ commit link; links `<siteUrl>#/p/<id>?rev=<N>` for created/changed people; warnings (bilingual); a "tell them on
  WhatsApp" link (`https://wa.me/?text=` bilingual "your update is now on the family tree … it may take a few minutes to appear");
  then label `applied`, close (completed). Afterwards re-run the check on other open family-tree issues (≤30) so their comments are current.
* `/reject` → fixed polite bilingual thank-you/decline text (never echoes a reason), close as not planned.

### 6.4 CI (`family-tree-ci.yml`): push/PR touching `family-tree/**` → `node --test` in `family-tree/`, `node scripts/validate-data.mjs`.
### 6.5 Undo: `/undo` (approver, on a closed `applied` issue). Using the changelog entry's `commit`: load family.json at `<commit>^` and
`<commit>`; for each person/union that commit changed: if current == `<commit>` version → restore `<commit>^` version (delete if it did
not exist); if any changed since → refuse, listing them. Commit `family-tree: undo #N`, changelog entry `{action:"undo", issue:N}`, label
`undone`, revision +1. (Batch commits: restore only records listed for that issue in the changelog entry's `touched`.)
### 6.6 Ledgers
`changelog.json`: `{"entries":[{"issue","proposalId","hash","commit","rev","at","title","summary":{"en":[],"ar":[]},"submitter",
"approvedBy","people":[ids],"touched":{"people":[],"unions":[]},"destructive","action":"apply"|"undo"}]}` newest first, max 500.
`applied.json`: `{"<hash>": {"issue","proposalId","commit","idMap","at"}}`, never truncated.
### 6.7 Backup (`family-tree-backup.yml`): weekly (`41 2 * * 5`) + dispatch: release `data-YYYY-MM-DD` with family.json, changelog.json,
applied.json attached; keep the latest 12 data releases.

## 7. Front-end

### 7.1 Contracts (read `js/i18n.js`, `js/dom.js`, `js/store.js`, `js/app.js`, `js/ui.js`)
* View module: `export default { title(params, query) → string, render(root, params, query) → cleanup|void }`. Re-render happens on
  route change, language change and store `draft`/`sent`/`data`/`me` events — keep UI state (zoom, wizard step, open panels) in module
  variables so re-renders are seamless.
* i18n: each module `register({en:{…}, ar:{…}})` at top level; namespaced keys; `t(key, vars)`; `bi(obj)`. Arabic copy is natural MSA,
  warm, respectful and **gender-neutral when addressing the user**: buttons/headings use verbal nouns (إضافة فرد، تعديل المعلومات،
  إرسال، بحث، اختيار) never masculine imperatives (أضف، اختر، أرسل، اكتب، ابحث، اضغط، تعرّف); sentences use forms valid for both
  genders (لديك، عائلتك). A test enforces this. Never use a cross for deceased; use "رحمه الله / رحمها الله" on person pages.
* Never build HTML from user data (`innerHTML`); use `h()`/text. Logical CSS properties only; names in `<bdi>`.
* Mobile-first: works at 360px; base font 17px; Arabic line-height ≥1.7; tap targets ≥44px; text-size control (A / A+ / A++) in header;
  dark mode; `prefers-reduced-motion`; keyboard accessible; AA contrast; no console errors.
* Base CSS component classes (base.css provides; everyone uses): `.btn .btn-primary .btn-ghost .btn-danger .btn-sm .btn-lg .btn-block
  .btn-icon .card .card-header .stack .row .grid .chip .chip-link .badge .badge-pending .badge-sent .badge-verified .badge-needs-info
  .badge-deceased .avatar .avatar-sm .avatar-lg .avatar-m .avatar-f .avatar-u .field .field-label .field-hint .field-error .input .select
  .textarea .check .radio-group .segmented .notice .notice-info .notice-warning .notice-danger .muted .small .empty-state .spinner .sheet
  .tabs .list .list-item .section-title .kbd .sr-only .modal… .toast…` (see dom.js for modal/toast markup).

### 7.2 Routes
| hash | module | purpose |
|---|---|---|
| `#/` | home | owner welcome (config.owner) + "get to know me" link; search; primary actions (Explore tree, Add my family); "Who are you?" (set me); "Help complete the tree" (≤5 people near me/root with needs-info, missing birth year, no parents, no children; buttons "I know this" / "Ask on WhatsApp"); "Recently added" (changelog, last 30 days); family branches; stats; last updated. No birthdays. |
| `#/tree/:id?` `?view=chart\|list&dir=down\|up` | tree | descendants chart, ancestors (`dir=up`), outline list (default when width < 700px) |
| `#/p/:id` | person | family card (§7.5) |
| `#/search?q=` | search | results with lineage & years |
| `#/add-family?near=<pid>` | wizard | §7.7 |
| `#/draft` | draft | review & send (§5, §7.3) |
| `#/me` | me | who I am, my sent proposals & status, my close family, tasks near me |
| `#/relationship/:a?/:b?` | relationship | "How are we related?" with path visualization |
| `#/changes` | changes | changelog |
| `#/about` | about | how it works, privacy ("to hide yourself message {owner}"), deletion policy, public-data notice |
| `#/admin` | admin | §7.8 |
| `#/preview?code=` / `#/preview/:issue` | preview | decode (or fetch issue via public REST) → dry-run → summary, errors, "Correct this proposal", "Load into my draft" |
Any route with `?rev=N` where N > loaded `meta.revision` shows "Publishing your update… / جارٍ نشر التحديث…" and re-fetches every 20 s for
≤5 min (handled by app.js). `#/p/<merged id>` redirects to its `mergedInto`.

### 7.3 Draft, sent queue, overlay
* Draft (`localStorage gft.draft.v1`): ops + submitter + note + proposal id + `dependsOn`. `store.addOps()` trial-applies; failing ops are
  refused with messages. Removing an op prunes dependants (opRefs) and anything that no longer applies (user told how many).
* On any send action the draft becomes a **sent** proposal (`gft.sent.v1`: `[{id, at, via, proposal}]`) and a new empty draft starts
  (counter continues). `store.working` = preview-apply of sent proposals not yet in the changelog, then the draft. Sent people show badge
  "sent — awaiting approval / أُرسل — بانتظار الموافقة"; draft people "not sent yet / لم يُرسل بعد". New ops that use refs from a sent
  proposal automatically add it to `dependsOn`.
* When the changelog lists a sent proposal id → drop it from the queue and toast "your changes were approved" with links. A sent proposal
  that no longer applies is hidden from the overlay and flagged on `#/me`.
* Sticky bottom bar on every route while the draft is non-empty: "You have {n} unsent changes — Send / لديك {n} تعديلات لم تُرسل — إرسال".
* Large drafts: when ops > 150 or the code > 60,000 chars, the draft page asks to send what exists first (continuing is possible thanks to
  dependsOn).

### 7.4 Forms & dialogs (`js/forms/`)
* `person-form.js`: English name/surname/nickname fields auto-fill from the Arabic (translit.js) while untouched (shown with an
  "automatic" hint); once edited they keep the user's spelling; the value is included only when it differs from the automatic one.
  Given-name field labelled "الاسم الأول فقط (مثال: محمد، عبد الله، نور الدين)" with `NAME_LOOKS_FULL` hint offering
  to split into given/father/family; Arabic `dir=rtl` and English `dir=ltr` side by side (English optional; a "suggest" transliteration
  button is NOT required); "Name not known" and "Prefer not to publish the name" options (nameStatus) — prefilled from
  `privacyDefaults.femaleNameStatus` for women; surname; nickname (placeholder "أبو خالد، أم خالد، الحاج"); gender as
  ابن/ابنة (son/daughter) or زوج/زوجة wording by context, required for new people; birth date = year text input
  (`inputmode=numeric`, `toAsciiDigits`) + optional month/day + approximate + calendar switch م/هـ (stores `hijri` when هـ); living/deceased +
  death date/place; birth-date privacy (living → year by default; minors cannot choose full); occupation, bio, photo hidden for minors;
  photo → "send the photo to {owner} on WhatsApp" link for members (URL field only in admin). Returns PersonInput or an edit `set` diff with `before`.
* `picker.js`: person search-as-you-type picker (uses graph.search incl. skeleton keys; shows lineage + years; keyboard accessible).
* `dialogs.js`: edit person; add child (asks ابن/ابنة; other parent = one of the spouses, "another mother/father", or unknown; kind:
  biological / raised under kafala / nursed (rada'a) → tie); add spouse (first searches existing people: "already in the tree → link";
  current/former); add parent (scope question when siblings exist); add sibling ("same father and mother / same father only / same mother
  only"); link existing; mark as…; reorder children (drag + up/down, keyboard); reorder spouses; change parents (move); merge duplicate;
  request removal (reason code select, consequences, HAS_CHILDREN/IS_ROOT blocks, type the name to confirm; "other" → WhatsApp explanation).
  Before any add, a quick duplicate check shows "Is it one of these?" matches. Each dialog ends with `store.addOps([...])` + toast linking to the draft.

### 7.5 Person page (family card)
Order: avatar, display name (other language small), lineage name, nickname, badges, "رحمه الله/رحمها الله" if deceased, relation to me;
then Parents (chips), Spouses (status per showDivorce; widow/er derived), Children grouped per spouse, Siblings (full / via father / via
mother / unspecified), Ties; then details (dates in both calendars, places, occupation, bio, needs-info). Exactly three primary buttons:
"إضافة قريب / Add a relative" (sheet with 4 big tiles child/spouse/parent/sibling), "تصحيح المعلومات / Correct info", "هذا أنا / This is me".
"خيارات أخرى / More options": mark as…, re-arrange, change parents, link existing person, merge duplicate, share on WhatsApp, invite a
relative (`siteUrl#/add-family?near=<id>`), view in tree, how are we related; and last, set apart in red, "request removal".

### 7.6 Tree view
* Descendants chart: node = person card + spouse cards; each union's children hang below that union. Tidy layout (subtree widths), SVG
  connectors under absolutely positioned HTML cards, pan (pointer/touch), zoom (wheel, pinch, buttons), fit, center. Collapsible; default
  depth `config.treeDefaultDepth`; expand-all with a safety cap (e.g. 600 nodes). RTL mirrors (first child on the right). Blood-only: a
  spouse's other unions appear as "also married to Y (n children)" links. A person reachable twice (cousin marriage) is drawn once; the
  other occurrence is a compact linked card.
* Ancestors chart (`dir=up`). Outline list (`view=list`): nested, expandable, virtual-friendly (thousands of people), default on phones.
* Toggle "paternal line only / الخط الأبوي فقط" (children of female descendants collapsed, expandable).
* Card: avatar (photo per privacyDefaults.photos, never for minors; else initials with subtle gender tint), display name, years label,
  badges (draft/sent pending, needs-info, verified). Tap → popover: open profile, focus tree here, add child/spouse.

### 7.7 Wizard `#/add-family` (the growth flow; state in module variables; each committed row → `store.addOps` immediately)
Step 0 "من أنت؟ / Who are you?": (a) "I'm in the tree" → search (scoped near `?near=`) → set me; (b) "I'm not listed" → find father or
mother → add self as son/daughter; (c) "I married into the family" → find spouse → add self as spouse. Step 1 spouses: confirm/add,
"+ another spouse". Step 2 children per union: inline repeatable rows [name · ابن/ابنة toggle · birth year with م/هـ · living/deceased]
with "+ another child" on ONE screen (no modal per child). Step 3 (optional per child row "add their family"): spouse & children (recursive).
Step 4 (path c only, optional): your parents and siblings, with the public-data notice. Step 5: review describe lines → send (§5).
Every step: Skip, and "Tell {owner} on WhatsApp instead (voice notes welcome)" → wa.me with "بخصوص: <lineageName> <siteUrl>#/p/<id>".
Acceptance: self + spouse + 5 children in ≤3 screens and ≤25 taps at 360px. Duplicate check on each row.

### 7.8 Admin `#/admin` (static tools; real power is GitHub permissions)
Paste code(s) → preview → **"Create issue and approve"** (issue-form URL with `&labels=family-tree,approve` or `approve-deletion` — GitHub
honours labels only for users with triage rights) · "Correct this proposal" → loads into draft with `source:{issue, hash}`; the draft page
then offers "Copy approval comment" (`/approve` + new code) · open proposals list (public REST, handles rate-limit errors) · removed people
& unions with restore buttons · data health (validateData warnings, duplicatesSuspects) · after approval: "copy thank-you message" (bilingual,
links) and "weekly family news" generator from the changelog · photo tool: pick image → canvas resize 400px JPEG → download `<pid>.jpg` → open
`https://github.com/<o>/<r>/upload/<branch>/family-tree/data/photos` · download family.json.

### 7.9 Personalization
`store.me` (localStorage; rewritten through mergedInto on load). Person pages show "He is your paternal uncle / هو عمّك"; home greets.

## 8. Testing
* `family-tree/tests/*.test.mjs` with `node:test` + `node:assert/strict`; `cd family-tree && node --test`.
* Core: every op + error code, atomicity, preview vs final ids (preview drafts with add-person pass validateData with allowTempIds; a later
  reorder on a `newuK` union resolves), pruning vs soft-removal, merge (incl. union collapse, redirect), restore conflicts, sibling share,
  parent scope, privacy truncation, hijri derivation, STALE_EDIT final vs preview, dependsOn/refMap, codec round-trip with Arabic, CRC
  truncation detection, 1 MB inflate cap, describe both languages, kinship both languages (polygamy half-siblings, cousins, in-laws,
  milk ties), names (lineage plain/bin, withheld labels, normalization, skeleton search: Mohamed→محمد, Muhammad, abdulrahman→عبد الرحمن,
  alharbi→الحربي, 3li→علي), dates (partial, hijri, digits), branches, the real data file validates.
* i18n: every registered key exists in both languages; no Arabic string starts with a masculine imperative (§7.1).
* Scripts: check & apply on fixture events with a fake GitHub client: label/comment/unauthorized/destructive/fp mismatch/edited body/
  duplicate hash/skip/force/dependsOn/undo/reject/push conflict retry.
* E2E (local): `tests/e2e/smoke.mjs` — serve folder, visit every route in both languages at 360px and 1280px, add a family through the
  wizard, check the draft, the WhatsApp/GitHub URLs, and that there are no console errors.
