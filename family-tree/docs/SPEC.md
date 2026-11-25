# Grand Family Tree — Technical Specification (v1)

This is the single source of truth for every module. If code and this spec disagree, the spec wins
(or the spec is updated deliberately). Read it fully before writing code.

## 0. Goals

A bilingual (Arabic / English) collaborative family-tree portal:

* Hosted for free on **GitHub Pages**, readable by everyone, no login to browse.
* Anyone can **propose** changes: add people (with spouses, children, parents, siblings), edit info,
  "mark as" (deceased, verified, needs-info, duplicate…), and re-arrange (reorder children/spouses,
  change parents). Proposals never change the live data directly.
* **Only the owner (approvers listed in `config.json`) can approve.** Approval is done on GitHub (label or
  `/approve` comment on the proposal issue); a GitHub Action validates and applies the change to
  `data/family.json`, commits it, and the site updates.
* **Deletion is never casual:** removals are soft (data kept, hidden, restorable), need a written reason,
  typed-name confirmation, are blocked when they would orphan descendants, are limited to 3 per proposal, and
  need a *separate* approval (`approve-deletion`).
* Spouses can add *their own* families (their parents, siblings), so the model is a graph, not a single tree.
* Zero build step, zero runtime dependencies. Plain HTML + CSS + ES modules. Node ≥ 20 for scripts/tests
  (no npm dependencies).

## 1. Repository layout

The portal lives in `family-tree/` inside the repo (so it can be moved to its own repo later unchanged);
automation lives in `.github/`.

```
family-tree/
  index.html                 # SPA entry (hash routing)
  config.json                # site/repo/approver/contact configuration
  package.json               # {"type":"module", scripts: test} — no dependencies
  data/
    family.json              # canonical data (see §2)
    changelog.json           # applied proposals, newest first (see §6.5)
  css/
    base.css                 # tokens, layout, header, buttons, cards, forms, modal, toast, utilities
    tree.css                 # tree chart + outline view
    person.css               # person page
    pages.css                # home, search, draft, wizard, admin, preview, changelog, about, relationship
  js/
    core/                    # PURE logic, no DOM, no fetch. Runs in browser AND Node (ES modules).
      schema.js              # constants, normalize/compact, validateData
      dates.js               # partial dates, hijri, age
      names.js               # display names, lineage (nasab), Arabic normalization, search keys
      graph.js               # buildGraph(data) → query API
      ops.js                 # validateProposal, applyProposal (all operations)
      codec.js               # proposal ⇄ share code (GFT1:...), issue-body extraction
      describe.js            # human-readable bilingual description of ops/proposals
      kinship.js             # relationship between two people + bilingual labels
      messages.js            # bilingual error/warning messages: formatIssue(issue, lang)
    i18n.js                  # t(), register(), lang switching, bi()
    dom.js                   # h(), icons, modal, toast helpers
    store.js                 # loads config+data, draft proposal (localStorage), working graph
    app.js                   # router + app shell (header/nav/footer)
    submit.js                # turn draft into GitHub issue / WhatsApp / email / relay / copy
    views/                   # one module per route (see §7)
    forms/                   # reusable forms & dialogs (person form, add relative, mark, reorder, move, remove…)
  scripts/
    apply-proposal.mjs       # used by GitHub Action: event → apply → write files → outputs
    validate-proposal.mjs    # used by GitHub Action on issue open/edit: dry-run + bot comment text
    validate-data.mjs        # CLI: validate data/family.json (CI on push)
    lib/                     # shared helpers for scripts (event parsing, comment rendering, approver check)
  tests/                     # node --test  (core + scripts). Run: cd family-tree && node --test
  tools/relay/               # optional Google Apps Script relay (no-GitHub-account submissions)
  docs/
    SPEC.md                  # this file
    OWNER-GUIDE.md           # how the owner reviews/approves; setup steps (bilingual)
.github/
  workflows/family-tree-proposal-check.yml   # issues opened/edited → validate + bot comment + labels
  workflows/family-tree-apply.yml            # label / comment approval → apply → commit → close issue
  workflows/family-tree-data-check.yml       # push/PR touching family-tree/data → validate-data
  ISSUE_TEMPLATE/family-tree-proposal.yml    # issue form (prefilled from the site)
```

Live URL (after merge to `main`, GitHub Pages "deploy from branch" root): `https://<owner>.github.io/<repo>/family-tree/`.
All asset/data paths in the site MUST be relative (no leading `/`).

## 2. Data model — `data/family.json`

```jsonc
{
  "schema": 1,
  "meta": {
    "title": {"ar": "شجرة العائلة الكبرى", "en": "The Grand Family Tree"},
    "rootPersonId": "pa1b2c3d",          // default focus of the tree
    "revision": 12,                        // +1 on every applied proposal
    "updatedAt": "2026-11-25T10:00:00Z",
    "demo": false                          // true → site shows a "sample data" banner
  },
  "people": { "<personId>": Person, ... },  // object keyed by id; insertion order = creation order
  "unions": { "<unionId>": Union, ... }
}
```

### 2.1 Person (full in-memory shape — produced by `normalizePerson`)

```jsonc
{
  "id": "pa1b2c3d",
  "name":       {"ar": "أحمد", "en": "Ahmed"},     // given name (ism). At least one language REQUIRED.
  "surname":    {"ar": "", "en": ""},             // family / tribe name (optional)
  "nickname":   {"ar": "", "en": ""},             // kunya / laqab, e.g. "أبو خالد"
  "gender":     "m",                              // "m" | "f" | ""
  "birth":      {"date": "1950-03", "approx": false, "place": {"ar": "", "en": ""}},
  "deceased":   false,                            // true if known deceased (date may be unknown)
  "death":      {"date": "", "approx": false, "place": {"ar": "", "en": ""}},
  "occupation": {"ar": "", "en": ""},
  "bio":        {"ar": "", "en": ""},
  "photo":      "",                               // https URL or ""
  "privacy":    "full",                           // birth-date visibility: "full" | "year" | "hidden"
  "tags":       [],                               // marks: "verified", "needs-info"
  "needsInfo":  "",                               // free text: what is missing (set by mark needs-info)
  "duplicateOf": "",                              // personId suspected to be the same person
  "spouseOrder": [],                              // unionIds — display order of this person's marriages
  "removed":    null,                             // soft-delete record (see below) or null
  "history":    []                                // provenance, newest last, max 20: {"issue":12,"at":"ISO","action":"add-person"}
}
```

* **Stored form is compact**: `compactPerson` drops empty strings, empty bilingual objects (`{"ar":"","en":""}`),
  `approx:false`, empty arrays, `null`, `deceased:false`, `privacy:"full"`. `normalizePerson` restores the full shape.
  `id` is always kept. Key order on write is the order shown above (stable diffs).
* `removed` record: `{"at":"ISO","reason":"…","issue":12|null,"by":"login"|"" , "mergedInto":"pid"|undefined}`.
* Rule: if `death.date` is non-empty then `deceased` is `true` (normalize enforces).
* Partial dates: `"YYYY"`, `"YYYY-MM"`, or `"YYYY-MM-DD"` (Gregorian, year 1–9999, must be a real calendar date). `""` = unknown.
* `privacy` controls display of **birth date** only: `full` = whole date; `year` = year only; `hidden` = not shown.
  The UI also refuses to *collect* more than the chosen precision (forms send only the year when `year` is chosen),
  so private detail never enters the public repo. Minors (<18) default to `year` in forms.

### 2.2 Union (a couple and/or a set of children who share parents)

```jsonc
{
  "id": "ux9y8z7w",
  "partners": ["pa1b2c3d", "pq5r6s7t"],   // 0..2 distinct person ids (0 = unknown parents of siblings)
  "children": ["p...", "p..."],            // ORDERED (birth order / as re-arranged)
  "status": "married",                     // "married" | "divorced" | "widowed" | "unknown"
  "marriage": {"date": "", "approx": false, "place": {"ar": "", "en": ""}},
  "removed": null                           // soft delete record or null (same shape as person.removed)
}
```
Compact form drops `marriage` when empty, `status:"unknown"`, empty `children`, `removed:null`.

### 2.3 Invariants — `validateData(data)` → `{ok, errors:[Issue], warnings:[Issue]}`

Errors (data is invalid):
1. `schema === 1`; `people`/`unions` objects; each key equals its object's `id`.
2. Person ids match `/^p[a-z0-9]{3,24}$/`; union ids match `/^u[a-z0-9]{3,24}$/`.
3. Every person has a non-empty `name.ar` or `name.en`.
4. Enumerations valid (gender, privacy, status); dates valid partial dates; photo is `""` or starts with `https://`.
5. Union partners: ≤2, distinct, existing people; children: existing people, no duplicates; no person is both partner and child of the same union.
6. A person is a child in **at most one** non-removed union.
7. No cycles: nobody is their own ancestor (ancestor = partner of birth union, transitively; removed unions ignored).
8. `duplicateOf`, `removed.mergedInto` reference existing people ≠ self.
Warnings (data is valid but suspicious): stale `spouseOrder` entries; `rootPersonId` missing/removed;
death before birth; child born before parent turned 12 or > 1 year after father's death / after mother's death;
two siblings with the same normalized name; union with < 2 members total.

`Issue` objects everywhere (errors & warnings) are `{code: "UPPER_SNAKE", params: {...}, op?: number, path?: string}`.
`messages.js#formatIssue(issue, lang)` renders them in `"ar"` or `"en"` (every code MUST have both translations).

## 3. Proposals

### 3.1 Envelope

```jsonc
{
  "kind": "gft-proposal",
  "v": 1,
  "createdAt": "ISO",
  "baseRevision": 12,                    // data revision the proposer saw (informational)
  "submitter": {"name": "", "relation": "", "personId": ""},   // all optional, public!
  "note": "",                            // free text ≤ 2000
  "ops": [Op, ...]                       // 1..200
}
```

### 3.2 References

* `PersonRef` = existing person id **or** a temp ref `/^new[0-9]+$/` declared by an earlier `add-person` op (`ref`).
* `UnionRef`  = existing union id **or** a temp ref `/^newu[0-9]+$/` bound by an earlier op's `unionRef`.
* Temp refs are unique within a proposal (re-declaring = error `DUPLICATE_REF`); using an undeclared ref = `UNKNOWN_REF`.
* Ops that end up *using or creating* a union accept an optional `"unionRef": "newuN"`, which binds that ref to the
  union actually used (found **or** created). (add-person with link, link-spouse, move-person.)

### 3.3 Operations

`PersonInput` = any of: `name, surname, nickname, gender, birth, deceased, death, occupation, bio, photo, privacy`
(same shapes as §2.1; partial objects allowed, missing → empty). Unknown keys → `UNKNOWN_FIELD`.

| op | fields | semantics |
|---|---|---|
| `add-person` | `ref` (required), `person` (PersonInput, needs a name), `link` (optional, below), `unionRef`? | Creates a person. |
| `edit-person` | `id` PersonRef, `set` {path: value}, `before`? {path: value} | Sets fields. Paths: `name.ar name.en surname.ar surname.en nickname.ar nickname.en gender birth.date birth.approx birth.place.ar birth.place.en deceased death.date death.approx death.place.ar death.place.en occupation.ar occupation.en bio.ar bio.en photo privacy`. Values: strings (bools for `*.approx`, `deceased`). Cannot leave both names empty (`NAME_REQUIRED`). If `before[path]` ≠ current value → warning `STALE_EDIT` (still applied). |
| `mark` | `id`, `mark`, `date`?, `of`?, `note`? | `deceased` (deceased=true, death.date=date if given) · `living` (deceased=false, death cleared) · `verified` / `unverified` (tag) · `needs-info` (tag + needsInfo=note) / `info-complete` (remove tag, clear needsInfo) · `duplicate` (duplicateOf=`of`, must be another existing active person) / `not-duplicate` (clear). |
| `link-spouse` | `a`, `b` PersonRef, `status`?, `marriage`?, `unionRef`? | New union [a,b]. Errors: same person `SAME_PERSON`; active union with exactly {a,b} exists `DUPLICATE_UNION`; one is ancestor of the other `ANCESTOR_LINK`. |
| `move-person` | `id`, `to`: `{union: UnionRef}` or `{of: PersonRef, with: PersonRef\|null}`, `unionRef`? | Change parents: remove `id` from its current birth union (if any), add to target (resolved like add-child, §3.4). Errors: target has `id` as partner `INVALID_RELATION`; would create a cycle `CYCLE`. Also used to give parents to someone who has none. |
| `edit-union` | `union` UnionRef, `set` {path:value} | Paths: `status marriage.date marriage.approx marriage.place.ar marriage.place.en`. |
| `reorder-children` | `union`, `order` [PersonRef] | New order = ids of `order` that are current children (in that order) + remaining children in existing order. Unknown ids → warning `ORDER_IGNORED`. |
| `reorder-spouses` | `id`, `order` [UnionRef] | `spouseOrder` = resolved unions that contain `id`, in that order. |
| `restore-person` | `id` (existing, removed) | `removed = null`. Not destructive. |
| **`remove-person`** ⚠ | `id` (existing), `reason` (≥10 chars) | Soft delete: `removed = {at, reason, issue, by}`. Errors: is `meta.rootPersonId` `IS_ROOT`; has any active child in any union where they are a partner `HAS_CHILDREN` (params list the children); already removed `ALREADY_REMOVED`. Links are kept (restorable). |
| **`unlink-spouse`** ⚠ | `union` (existing, 2 partners), `reason` | Soft-delete the union. Error `HAS_CHILDREN` if it has active children. |
| **`detach-person`** ⚠ | `id`, `reason` | Remove `id` from its birth union's children ("those are not the real parents"). History entry records the old union id. |
| **`merge-person`** ⚠ | `keep`, `remove` (existing, different), `reason` | `remove` is the same human as `keep`. Unions where `remove` is partner → `keep` replaces it (if that yields two active unions with identical partner sets, children of the later are appended to the earlier and the later is soft-removed). Birth union: if only `remove` has one → `keep` takes its place in that children list; if both have the same → drop `remove`; if different → error `CONFLICTING_PARENTS`. Empty fields of `keep` are filled from `remove`; tags merged. `remove.removed = {…, mergedInto: keep}`. Errors also: ancestor relation between them `ANCESTOR_LINK`. |

⚠ = **destructive**. `DESTRUCTIVE_OPS = ["remove-person","unlink-spouse","detach-person","merge-person"]`.
A proposal may contain at most **3** destructive ops (`TOO_MANY_DESTRUCTIVE`). Destructive ops may only target
existing (non-temp) ids (`TEMP_NOT_ALLOWED`).

### 3.4 `link` of `add-person` (and target resolution of `move-person`)

* `{"as":"child","of":P,"with":Q|null}` → find the **active** union whose partner *set* equals `{P,Q}` (or `{P}` when
  `with` is null). Found → append child. Not found → create `{partners:[P,(Q)], children:[new], status: Q ? "married" : "unknown"}`.
* `{"as":"child","union":U}` → append to union U.
* `{"as":"spouse","of":P,"status"?,"marriage"?}` → create union `[P, new]` (status default `"married"`).
* `{"as":"parent","of":P}` → B = birth union of P. If B has < 2 partners → add new as partner. If 2 → error `PARENTS_FULL`.
  If no B → create `{partners:[new], children:[P]}`.
* `{"as":"sibling","of":P}` → B = birth union of P → append new to B.children; if none → create `{partners:[], children:[P,new]}`.

### 3.5 Apply — `applyProposal(data, proposal, opts)`

```
opts = { mode: "final" | "preview", now: ISOString, issue: number|null, actor: string,
         allowDestructive: boolean (default: preview→true, final→false), idGen?: (prefix:"p"|"u") => string }
→ { ok, data, errors:[Issue], warnings:[Issue], idMap:{ref→id}, touched:{people:[ids], unions:[ids]},
    created:{people:[ids], unions:[ids]}, destructive:boolean }
```
* Input `data` is never mutated; returns a normalized deep copy. **Atomic**: any error → `ok:false`, `data` = the
  (normalized) input unchanged, `errors` lists every problem found (each with `op` index).
* Runs `validateProposal` first (structure, types, lengths: names ≤100, other text ≤2000, bio ≤4000, ops ≤200, refs).
* **Preview mode**: created people get id = their temp ref (`new3`); unions with a `unionRef` get that ref as id, others
  `tmpu1`, `tmpu2`… (so the UI can display/link pending items). **Final mode**: random ids `p`+7 / `u`+7 base36
  chars (crypto.getRandomValues), never colliding; `idMap` maps every temp ref to its real id.
* After all ops: prune unions that are not removed and have < 2 members in total (partners + children) —
  except unions bound to a `unionRef`... (no exception: prune them too; they are meaningless).
* Final mode only: `meta.revision += 1`, `meta.updatedAt = now`, append `{issue, at: now, action: op}` to `history` of
  every touched person (cap 20).
* Destructive op present and `allowDestructive` false → error `DESTRUCTIVE_NOT_ALLOWED`.
* Post-condition: `validateData(result).ok` must hold, else `ok:false` with those errors (defence in depth).

## 4. Core module APIs (`js/core/*.js`)

All exports are named; no default exports; no DOM, no `fetch`, no Node-only imports (use `globalThis.crypto`,
`CompressionStream`, `btoa/atob`, `TextEncoder`, `Intl` — available in Node ≥20 and modern browsers).

### schema.js
`SCHEMA_VERSION, GENDERS, PRIVACY, UNION_STATUSES, MARKS, DESTRUCTIVE_OPS, PERSON_EDIT_PATHS, UNION_EDIT_PATHS,
LIMITS, isPersonId(s), isUnionId(s), isTempPersonRef(s), isTempUnionRef(s), emptyPerson(), emptyUnion(),
normalizePerson(p), normalizeUnion(u), normalizeData(data), compactPerson(p), compactUnion(u), compactData(data),
validateData(data), emptyData(title)` · `serializeData(data)` → JSON string of compactData, 2-space indent, trailing newline.

### dates.js
`parseDate(s)` → `{y,m,d}|null` (null for "" or invalid) · `isValidDate(s)` · `compareDates(a,b)` (partial-aware, ""→null) ·
`formatDate(s, lang, {approx, precision:"full"|"year"|"hidden", hijri:boolean})` → e.g. EN `"12 Mar 1950"`,
AR `"١٢ مارس ١٩٥٠"` or with Western digits per `setDigits("latn"|"arab")` (default `latn`), approx → `"c. 1950"`/`"حوالي 1950"`;
with `hijri:true` and a full date appends Hijri (Umm al-Qura via `Intl` `islamic-umalqura`) e.g. `"(15 جمادى الآخرة 1448 هـ)"` ·
`toHijri(s, lang)` · `hijriToGregorian(y, m?, d?)` → `"YYYY-MM-DD"` (full) or `"YYYY"` approx for year-only, implemented by
searching Gregorian days with Intl (no tables) · `age(birthDate, endDate|null, today)` → integer years | null ·
`isMinor(person, today)` · `yearOf(s)`.

### names.js
`personName(p, lang)` → given name in `lang`, falling back to the other language · `fullName(p, lang)` (name + surname) ·
`displayName(p, lang)` (fullName; if nickname: `"Name (Nickname)"`) · `lineageName(graph, id, lang, {depth:3, surname:true})` →
Arabic `"محمد بن أحمد بن علي آل فلان"` / `"فاطمة بنت أحمد بن علي"`; English `"Mohammed bin Ahmed bin Ali Al-X"` / `"Fatima bint Ahmed…"`
(chain follows the **father** = male partner of birth union, else the single partner; stops when unknown; surname taken from the
first person in the chain who has one) · `initials(p, lang)` · `normalizeArabic(s)` (strip tashkeel & tatweel; أ إ آ ٱ→ا; ة→ه; ى→ي; ؤ→و; ئ→ي) ·
`searchKey(s)` (lowercase, normalizeArabic, collapse spaces, strip "بن/بنت/ابن/bin/bint/ibn/al-/ال" prefixes as separate tokens).

### graph.js
`buildGraph(data, {includeRemoved:false})` → `Graph` (data assumed valid & normalized; builds indexes once; immutable):
```
g.data, g.meta
g.person(id) → Person|null            (null for unknown or removed unless includeRemoved)
g.union(id) → Union|null              (same rule)
g.people() → Person[] (active, insertion order)    g.removedPeople() → Person[]
g.birthUnion(id) → Union|null         g.parents(id) → Person[]   g.father(id)  g.mother(id)
g.unionsOf(id) → Union[]  (active unions where id is partner; order: spouseOrder, then marriage date, then insertion)
g.spouses(id) → [{person, union}]     g.childrenOfUnion(uid) → Person[]   g.children(id) → Person[] (all unions, in order)
g.siblings(id) → {full: Person[], half: Person[]}   (excluding self; half = shares exactly one parent via another union)
g.ancestors(id) → Map<id, depth>      g.descendants(id) → Map<id, depth>   g.isAncestor(a, b) → boolean (a is ancestor of b)
g.roots() → Person[]  (active people with no active parents, who have ≥1 descendant; sorted by descendant count desc)
g.generationDepth(id) → max descendant depth
g.stats() → {people, living, deceased, unions, generations (max depth over roots, root=1), withBirthDate}
g.search(query, {limit:30}) → [{person, score}]  (matches ar/en names, nicknames, surnames, and lineage tokens: "محمد احمد" finds "محمد بن أحمد")
g.duplicatesSuspects() → [[idA, idB], ...]  (same normalized name + same father, or same name+surname+birth year)
```
Removed people/unions are invisible through every method except `includeRemoved:true` and `removedPeople()`.

### ops.js
`validateProposal(proposal)` → `{ok, errors}` · `applyProposal(data, proposal, opts)` (§3.5) · `isDestructive(proposal)` ·
`newProposal()` → empty envelope · `opRefs(op)` → `{declares:[refs], uses:[refs]}` (for draft dependency pruning).

### codec.js
`encodeProposal(proposal)` → `Promise<string>` `"GFT1:" + base64url(deflate-raw(UTF-8 JSON))`; if `CompressionStream` is missing →
`"GFT0:" + base64url(UTF-8 JSON)` · `decodeProposal(text)` → `Promise<proposal>` accepting a code, raw JSON, or any text that
contains a code (regex `/GFT[01]:[A-Za-z0-9_-]+/`) or a fenced ```json block whose object has `kind:"gft-proposal"`; throws `Error`
with `.code` ∈ `NO_PROPOSAL | BAD_CODE | BAD_JSON` · `extractProposal(issueBody)` = decodeProposal tolerant wrapper →
`{proposal, code}|null`. Codes are line-break tolerant (strip whitespace inside the code when decoding).

### describe.js
`describeOp(op, ctx, lang)` → one-line plain text (no HTML/markdown) e.g.
EN `Add “Ahmed (أحمد)” as son of Mohammed bin Ali` · AR `إضافة «أحمد» ابناً لـ محمد بن علي`;
ctx = `{graph: Graph (before), refNames: Map ref→Person-like}` — temp refs are named from the add-person op that declared them.
`describeProposal(proposal, graph, lang)` → `{title, lines:[string], destructive:boolean, counts:{add, edit, mark, arrange, remove}}`.
Arabic must be natural MSA with correct gender agreement (ابناً/ابنةً، زوجاً/زوجةً، والداً/والدةً).

### kinship.js
`findRelationship(graph, aId, bId)` → `{type:"self"|"blood"|"spouse"|"affinal"|"none", up, down, via:[ids path], lca, half:boolean, side:"paternal"|"maternal"|null, spouseVia?}`
(“what is **b** to **a**”; blood = shortest path through a lowest common ancestor; affinal = b is spouse of a blood relative of a,
or a blood relative of a's spouse; cousin marriages → pick the shortest path) ·
`relationLabel(rel, graph, lang, {you:true})` → e.g. `you:true` EN `"your paternal uncle"`, AR `"عمّك"`; `you:false` with `aName` → `"Ahmed's paternal uncle"` / `"عمّ أحمد"`.
Required vocabulary — EN: father/mother, son/daughter, brother/sister (+half-), grandfather/grandmother (paternal/maternal), grandson/granddaughter,
great-…, uncle/aunt (paternal/maternal), nephew/niece, first cousin, n-th cousin k times removed, husband/wife, former husband/wife,
father/mother/son/daughter/brother/sister-in-law, "spouse of your …", "your spouse's …".
AR: أب/أم، ابن/ابنة، أخ/أخت (شقيق/شقيقة، أخ لأب/لأم)، جد/جدة لأب/لأم، حفيد/حفيدة، عم/عمة/خال/خالة، ابن/ابنة الأخ/الأخت،
ابن/ابنة العم/العمة/الخال/الخالة، composed chains for distant relations ("ابن ابن عمّ والدك"، "عمّ جدّك")، زوج/زوجة، زوج سابق/طليقة،
حمو/حماة (والد/والدة الزوج أو الزوجة)، زوجة الأخ، زوج الأخت، "زوج/زوجة <relation>"، "<relation> زوجتك/زوجك".

### messages.js
`formatIssue(issue, lang)` → string; `ISSUE_CODES` list. Unknown code → generic text including the code.

## 5. Proposal transport (how a proposal reaches the owner)

The site never writes to GitHub itself. The **draft** (§7.3) becomes a proposal; the user chooses:

1. **GitHub issue (preferred)** — opens
   `https://github.com/<owner>/<repo>/issues/new?template=family-tree-proposal.yml&title=<t>&code=<GFT1…>&submitter=<s>&note=<n>`
   (issue-form fields are prefilled by `id`). If the URL would exceed 7,500 chars, drop `note`, then `submitter`; if still too long, copy the
   full issue body to the clipboard and open the form with a short instruction to paste. Requires a GitHub account.
2. **WhatsApp** — `https://wa.me/<number>?text=…` (or `https://wa.me/?text=` if no number configured) with a short bilingual message:
   summary lines + the code. The owner pastes the code into the site's Admin page → preview → "Open as GitHub issue".
3. **Email** — `mailto:` with the same text (only if `config.contact.email` set).
4. **Relay** (optional, `config.relayUrl`) — `fetch(relayUrl, {method:"POST", headers:{"Content-Type":"text/plain"}, body: JSON.stringify({title, code, submitter, note})})`
   → a Google Apps Script creates the issue with a restricted token (`tools/relay/`). No account needed.
5. **Copy code** — always available.

Issue title: `🌳 <describeProposal().title>`; prefix `⚠️ ` when destructive. Body (issue form) has `### Proposal code`, `### Your name and relation`, `### Notes`.

## 6. GitHub automation

### 6.1 `config.json`
```jsonc
{
  "repo": {"owner": "gtsgate", "name": "spelling-coach", "branch": "main"},
  "portalPath": "family-tree",
  "siteUrl": "https://gtsgate.github.io/spelling-coach/family-tree/",
  "approvers": ["gtsgate"],
  "labels": {"proposal": "family-tree", "approve": "approve", "approveDeletion": "approve-deletion",
             "needsChanges": "needs-changes", "applied": "applied", "deletion": "deletion-request"},
  "contact": {"whatsapp": "", "email": ""},
  "relayUrl": "",
  "defaultLanguage": "ar",
  "arabicDigits": false,
  "treeDefaultDepth": 3
}
```

### 6.2 Proposal check (`family-tree-proposal-check.yml`, on `issues: [opened, edited, reopened]`)
* Skip unless the body contains a proposal (code or json block). Ensure all labels exist (create with colors/descriptions if missing).
* Add label `family-tree` (+ `deletion-request` if destructive). Dry-run `applyProposal(mode:"final", allowDestructive:true)` on current data.
* Create or update ONE bot comment (marker `<!-- gft-bot:check -->`) containing: status (✅ valid / ❌ problems, with bilingual messages),
  submitter, bilingual change list (`describeProposal` en + ar), a preview link `<siteUrl>#/preview/<issueNumber>`, and owner instructions:
  "comment `/approve` (or add label `approve`) to apply; for removals use `/approve-deletion`; close the issue to reject; `/reject <reason>` closes politely".
* Never interpolate issue text into shell commands (`${{ github.event.issue.body }}` is forbidden in `run:`); scripts read `$GITHUB_EVENT_PATH`.

### 6.3 Apply (`family-tree-apply.yml`, on `issues: [labeled]` and `issue_comment: [created]`)
* `concurrency: {group: family-tree-data, cancel-in-progress: false}`; permissions `contents: write, issues: write, pages: write`.
* Trigger matrix: label `approve` / `approve-deletion`, or comment whose first line is `/approve`, `/approve-deletion`, `/reject …`.
* **Authorization**: actor (`sender.login` for labels, `comment.user.login` for comments) must be in `config.approvers`
  (case-insensitive) — otherwise reply politely and stop. Issue must be open and contain a proposal.
* If the approving comment itself contains a proposal code, that code **replaces** the issue's (owner corrections).
* Destructive proposal + plain `approve` → comment explaining that `approve-deletion` is required; remove the `approve` label; stop.
* `applyProposal(mode:"final", allowDestructive: <approve-deletion>, issue, actor, now)`. Failure → comment errors (bilingual),
  add `needs-changes`, remove the approve label. Success → write `data/family.json` (serializeData) and prepend changelog entry, commit
  `"family-tree: apply #<n> — <title>"` as `github-actions[bot]`, push with rebase-retry (3 attempts; on conflict re-run apply on fresh data),
  then request a Pages build (`POST /repos/{o}/{r}/pages/builds`, continue-on-error), comment ✅ with commit link + links to the
  created/changed people (`<siteUrl>#/p/<id>`), add `applied`, close the issue (state_reason completed).
* `/reject <reason>` → bilingual thank-you/decline comment, close as not planned.

### 6.4 Data check (`family-tree-data-check.yml`) — on push/PR touching `family-tree/**`: `node --test` in `family-tree/` and `node scripts/validate-data.mjs`.

### 6.5 `data/changelog.json`
`{"entries":[{"issue":12,"at":"ISO","title":"…","summary":{"en":["…"],"ar":["…"]},"submitter":"…","approvedBy":"login","people":["pid",…],"destructive":false}]}`
newest first, max 300 entries.

## 7. Front-end

### 7.1 Shell contracts (implemented in `js/i18n.js`, `js/dom.js`, `js/store.js`, `js/app.js` — read those files)

* Every view module: `export default { title(params, query) → string, render(root, params, query) → (cleanup fn | void) }`.
  `root` is an empty `<section>` element; views own its content. Re-render happens on route change, language change, and
  store `draft`/`data`/`me` events (views must be idempotent; persist UI state like zoom in module variables).
* i18n: `register({en:{…}, ar:{…}})` at module top-level; keys are namespaced (`tree.*`, `person.*`, `forms.*`, `draft.*`…).
  `t(key, vars)` with `{name}` interpolation. `bi(obj)` picks `{ar,en}` text for current language with fallback.
  Arabic copy must be natural Modern Standard Arabic written by a fluent speaker (not literal translation), respectful,
  warm. Never use a cross (✝/†) for deceased people; use text (“d. 1990” / “ت 1990”, “رحمه الله/رحمها الله” on the person page).
* Never build HTML from user data with `innerHTML`; use `h()` / `textContent`.
* Direction: `<html dir>` switches between `rtl`/`ltr`; CSS must use logical properties (`margin-inline-start`, `inset-inline-start`, …).
  Names are bidi-isolated (`<bdi>` or `unicode-bidi: isolate`) because Arabic and English names are mixed.

### 7.2 Routes

| hash | view module | purpose |
|---|---|---|
| `#/` | `views/home.js` | hero, search, quick actions, stats, family branches (roots), recent changes, birthdays this month, "Who are you?" prompt, demo banner |
| `#/tree/:id?` (`?view=chart\|list&dir=down\|up`) | `views/tree.js` | interactive descendants chart (default), ancestors chart (`dir=up`), outline list (`view=list`) |
| `#/p/:id` | `views/person.js` | profile + relatives + all actions (edit, add relative, mark, re-arrange, move, link, merge, request removal) |
| `#/search?q=` | `views/search.js` | full search results |
| `#/add-family` | `views/wizard.js` | guided "Add my family" flow |
| `#/draft` | `views/draft.js` | review pending changes, submitter info, submit options |
| `#/relationship/:a?/:b?` | `views/relationship.js` | "How are we related?" |
| `#/changes` | `views/changes.js` | changelog |
| `#/about` | `views/about.js` | how it works, privacy, deletion policy |
| `#/admin` | `views/admin.js` | owner tools: paste code → preview → open issue; open proposals list (GitHub API); removed people + restore; data health; download JSON |
| `#/preview/:issue` and `#/preview?code=` | `views/preview.js` | fetch issue (public GitHub REST API) or code → decode → dry-run → summary, errors, "load into my draft to explore" |

### 7.3 Draft (the "basket")
The user accumulates ops in a local draft (`localStorage['gft.draft.v1']`). `store.working` is the graph of
`applyProposal(data, draft, {mode:"preview"})` so pending people appear everywhere (badge "pending / بانتظار الموافقة", dashed outline).
Temp refs come from `store.newRef()` / `store.newUnionRef()` (monotonic counter saved with the draft, never reused).
`store.addOps(ops)` trial-applies and refuses ops that fail (returns the errors to show the user).
Removing an op also removes later ops that no longer apply (dependency pruning, user is told how many).

### 7.4 Forms & dialogs (`js/forms/`)
* `person-form.js`: bilingual name fields side by side (Arabic `dir=rtl`, English `dir=ltr`), surname, nickname, gender, birth (partial date
  input: year/month/day selects + "approximate" + calendar switch Gregorian/Hijri converting via `hijriToGregorian`), living/deceased
  + death date/place, occupation, bio, photo URL (advanced), birth-date privacy (full / year only / hidden; minors default year-only).
  At least one name required; dates validated; returns PersonInput or edit `set` diff with `before`.
* Dialogs: edit person, add child/spouse/parent/sibling (child: choose the other parent among spouses or "unknown"),
  link existing person as spouse/parent/child (person picker with search), mark as…, reorder children (drag + up/down buttons,
  keyboard accessible), reorder spouses, change parents (move), merge duplicate, request removal (destructive: shows consequences,
  blocks when HAS_CHILDREN/IS_ROOT, requires reason ≥10 chars and typing the person's name).
* Every dialog ends by calling `store.addOps([...])` and showing a toast with a link to the draft.

### 7.5 Tree view
* Descendants chart: node = person card + their spouse cards side by side; each union's children hang below that union.
  Tidy layout (subtree widths), SVG connectors under absolutely-positioned HTML cards, pan (pointer drag/touch), zoom (wheel, pinch,
  +/- buttons), "fit", "center on person". Collapsible nodes; default depth `config.treeDefaultDepth`; "expand all" with a safety cap.
  RTL mirrors the layout (first child on the right). A person reachable twice (cousin marriage) is rendered once fully; the second
  occurrence is a compact "linked" card that navigates to the first.
* Ancestors chart (`dir=up`): pedigree upward from the person.
* Outline list (`view=list`): nested, expandable, fast for thousands of people, the best mobile view.
* Toggle "paternal line only / الخط الأبوي فقط": children of female descendants collapsed (still expandable).
* Cards: avatar (photo or initials; subtle gender tint), name in current language (other language small), years (`1950–2010`,
  respecting privacy), badges (pending, needs-info, verified). Click → small action popover: open profile, focus tree here, add child/spouse.

### 7.6 Personalization
`store.me` (localStorage) = "this is me". Person pages show "He is your paternal uncle / هو عمّك" via kinship; home greets the user.

### 7.7 Accessibility & quality
Keyboard reachable, visible focus, `aria-label`s on icon buttons, color contrast AA, `prefers-reduced-motion`, dark mode
(`prefers-color-scheme` + manual toggle stored in localStorage), mobile-first (360px wide works), no console errors.

## 8. Testing
* `family-tree/tests/*.test.mjs` with `node:test` + `node:assert/strict`; run `cd family-tree && node --test`.
* Core: every op incl. error codes, atomicity, preview vs final ids, pruning, validateData invariants, codec round-trip
  (Arabic text), describe (both languages), kinship labels (both languages), dates (partial, hijri), names (lineage, normalization, search).
* Scripts: apply-proposal on fixture events (label/comment/unauthorized/destructive/needs-changes) with a fake GitHub client.
* E2E (local only, not CI): Playwright smoke via `family-tree/tests/e2e/smoke.mjs` (serves the folder, visits every route in both
  languages, adds a person through the UI, checks the draft and generated GitHub URL, asserts no console errors).
