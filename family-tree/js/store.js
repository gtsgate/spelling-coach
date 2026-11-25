// App state: configuration, canonical data, the visitor's draft proposal, proposals already sent
// (awaiting approval) and the "working" graph = data + sent proposals + draft, applied in preview mode,
// so pending changes appear everywhere in the UI.  See docs/SPEC.md §7.3.
import { buildGraph } from './core/graph.js';
import { applyProposal, newProposal, opRefs } from './core/ops.js';
import { normalizeData, newProposalId } from './core/schema.js';
import { setDigits, setMonthNames } from './core/dates.js';
import { setLineageStyle } from './core/names.js';
import { setDefaultLang, setArabicDigits } from './i18n.js';

const DRAFT_KEY = 'gft.draft.v1';
const SENT_KEY = 'gft.sent.v1';
const COUNTER_KEY = 'gft.counter.v1';
const ME_KEY = 'gft.me';
const APPROVED_KEY = 'gft.approved.v1';
const DIGITS_KEY = 'gft.digits';

const listeners = { draft: new Set(), sent: new Set(), data: new Set(), me: new Set() };

function loadJSON(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveJSON(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full / unavailable */ }
}

function emptyDraft(submitter) {
  return {
    id: newProposalId(),
    ops: [],
    submitter: { name: '', relation: '', personId: '', ...(submitter || {}) },
    note: '',
    dependsOn: [],
    source: null, // {issue, hash} when the owner is correcting a proposal
    updatedAt: '',
  };
}

/** Deep-copy `value`, replacing every string that is a key of `map` (temp refs → other refs / real ids). */
function rewriteRefs(value, map) {
  if (typeof value === 'string') return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value;
  if (Array.isArray(value)) return value.map((v) => rewriteRefs(v, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteRefs(v, map);
    return out;
  }
  return value;
}

const PREVIEW = () => ({ mode: 'preview', now: new Date().toISOString(), allowDestructive: true });

export const store = {
  /** config.json */
  config: null,
  /** canonical normalized data (family.json) */
  data: null,
  /** Graph of canonical data only */
  base: null,
  /** Graph of data + sent (unapproved) proposals + draft. Views normally read from this. */
  working: null,
  draft: emptyDraft(),
  /** [{id, at, via, proposal}] proposals the visitor sent that are not yet approved */
  sent: [],
  /** ids of sent proposals that no longer apply to the latest data */
  sentStale: new Set(),
  /** Sent proposals that the changelog now lists as applied (filled on load; views may toast them) */
  justApproved: [],
  /** This visitor's proposals that were approved (local history, newest first, max 30): {id, at, via, ops, approvedAt, issue} — listed on #/me */
  approved: [],
  /** id sets for badges: draft-only vs sent-awaiting-approval */
  pending: { draft: new Set(), sent: new Set(), created: new Set() },
  draftErrors: [],
  draftWarnings: [],
  changelog: null,
  /** applied.json ledger: proposalId → {idMap} for proposals already approved (resolves refs of dependants) */
  appliedById: {},
  me: null,
  ready: false,

  async init() {
    const [config, data] = await Promise.all([fetchJSON('config.json'), fetchJSON('data/family.json')]);
    this.config = config;
    setDefaultLang(config.defaultLanguage || 'ar');
    const digits = loadJSON(DIGITS_KEY);
    this.setDigitsPref(digits === 'arab' || digits === 'latn' ? digits : (config.arabicDigits ? 'arab' : 'latn'), { silent: true });
    try { setMonthNames(config.arabicMonthNames || 'standard'); } catch { /* optional */ }
    try { setLineageStyle(config.lineageStyle || 'plain'); } catch { /* optional */ }
    this.setData(data, { silent: true });

    const savedDraft = loadJSON(DRAFT_KEY);
    if (savedDraft && Array.isArray(savedDraft.ops)) {
      this.draft = { ...emptyDraft(), ...savedDraft, submitter: { ...emptyDraft().submitter, ...(savedDraft.submitter || {}) } };
      if (!this.draft.id) this.draft.id = newProposalId();
      if (!Array.isArray(this.draft.dependsOn)) this.draft.dependsOn = [];
    }
    const savedSent = loadJSON(SENT_KEY);
    if (Array.isArray(savedSent)) this.sent = savedSent.filter((s) => s && s.proposal && Array.isArray(s.proposal.ops));
    const savedApproved = loadJSON(APPROVED_KEY);
    if (Array.isArray(savedApproved)) this.approved = savedApproved.filter((a) => a && a.id);
    const savedMe = loadJSON(ME_KEY);
    this.me = savedMe ? (this.base.resolve ? this.base.resolve(savedMe)?.id || savedMe : savedMe) : null;

    // Drop sent proposals the changelog says were applied; learn their real ids.
    await Promise.all([this.loadChangelog().catch(() => null), this.loadApplied().catch(() => null)]);
    this.remapTempIds();
    this.reconcileSent();
    this.recompute();
    this.ready = true;
    // Another tab changed the draft / sent queue / "me" → adopt it (the same visitor uses several tabs).
    try {
      globalThis.addEventListener?.('storage', (e) => {
        if (![DRAFT_KEY, SENT_KEY, ME_KEY, APPROVED_KEY].includes(e.key)) return;
        if (this.syncFromStorage()) { this.recompute(); this.emit('draft'); this.emit('sent'); this.emit('me'); }
      });
    } catch { /* no window */ }
  },

  /**
   * Re-read draft, sent queue, approved list and "me" from localStorage (another tab may have changed them).
   * Returns true when anything differed. A draft whose id was already sent gets a fresh id.
   */
  syncFromStorage() {
    let changed = false;
    const d = loadJSON(DRAFT_KEY);
    if (d && Array.isArray(d.ops) && JSON.stringify(d) !== JSON.stringify(this.draft)) {
      this.draft = { ...emptyDraft(), ...d, submitter: { ...emptyDraft().submitter, ...(d.submitter || {}) } };
      if (!this.draft.id) this.draft.id = newProposalId();
      if (!Array.isArray(this.draft.dependsOn)) this.draft.dependsOn = [];
      changed = true;
    }
    const sent = loadJSON(SENT_KEY);
    if (Array.isArray(sent) && JSON.stringify(sent) !== JSON.stringify(this.sent)) {
      this.sent = sent.filter((x) => x && x.proposal && Array.isArray(x.proposal.ops));
      changed = true;
    }
    const approved = loadJSON(APPROVED_KEY);
    if (Array.isArray(approved) && JSON.stringify(approved) !== JSON.stringify(this.approved)) { this.approved = approved; changed = true; }
    const me = loadJSON(ME_KEY);
    if ((me || null) !== (this.me || null)) { this.me = me || null; changed = true; }
    if (this.sent.some((x) => x.id === this.draft.id)) {
      // This draft was already sent (from another tab): its changes live in the sent queue now.
      this.draft = emptyDraft(this.draft.submitter);
      this.persistDraft();
      changed = true;
    }
    return changed;
  },

  /** Replace canonical data (initial load or "publishing…" refresh). */
  setData(raw, { silent = false } = {}) {
    this.data = normalizeData(raw);
    this.base = buildGraph(this.data);
    if (!silent) {
      this.changelog = null;
      Promise.all([this.loadChangelog(), this.loadApplied()])
        .then(() => { this.reconcileSent(); this.remapTempIds(); this.recompute(); this.emit('data'); })
        .catch(() => { this.recompute(); this.emit('data'); });
    }
  },

  async refreshData() {
    const raw = await fetchJSON('data/family.json');
    if ((raw?.meta?.revision ?? 0) !== (this.data?.meta?.revision ?? 0)) this.setData(raw);
    return raw?.meta?.revision ?? 0;
  },

  async loadChangelog() {
    if (this.changelog) return this.changelog;
    try { this.changelog = await fetchJSON('data/changelog.json'); } catch { this.changelog = { entries: [] }; }
    if (!this.changelog || !Array.isArray(this.changelog.entries)) this.changelog = { entries: [] };
    return this.changelog;
  },

  async loadApplied() {
    let ledger = {};
    try { ledger = await fetchJSON('data/applied.json'); } catch { ledger = {}; }
    const byId = {};
    for (const entry of Object.values(ledger || {})) {
      // Proposals later reverted with /undo no longer resolve their temp refs.
      if (entry && entry.proposalId && !entry.undone) byId[entry.proposalId] = { idMap: entry.idMap || {}, issue: entry.issue ?? null };
    }
    this.appliedById = byId;
    return byId;
  },

  /** "This is me" / submitter set to a person who was pending (temp ref) → their real id once approved. */
  remapTempIds() {
    const real = (ref) => {
      if (!ref || !/^new\d+$/.test(ref)) return ref;
      for (const entry of Object.values(this.appliedById)) if (entry.idMap && entry.idMap[ref]) return entry.idMap[ref];
      return ref;
    };
    const me = real(this.me);
    if (me !== this.me) { this.me = me; saveJSON(ME_KEY, me); }
    const sub = real(this.draft.submitter.personId);
    if (sub !== this.draft.submitter.personId) { this.draft.submitter.personId = sub; this.persistDraft(); }
    // Draft ops built on people of a proposal that is now approved: use the real ids, drop the dependency.
    const deps = this.draft.dependsOn || [];
    const done = deps.filter((id) => this.appliedById[id]);
    if (done.length) {
      const map = this.appliedRefMap(done);
      this.draft.ops = rewriteRefs(this.draft.ops, map);
      this.draft.dependsOn = deps.filter((id) => !this.appliedById[id]);
      this.persistDraft();
    }
  },

  /** refMap seeded with real ids of temp refs declared by already-applied proposals this one depends on. */
  appliedRefMap(dependsOn = []) {
    const map = {};
    for (const id of dependsOn || []) Object.assign(map, this.appliedById[id]?.idMap || {});
    return map;
  },

  /** Ids of dependsOn proposals that are already applied. */
  appliedDeps(dependsOn = []) {
    return (dependsOn || []).filter((id) => this.appliedById[id]);
  },

  reconcileSent() {
    const applied = new Set((this.changelog?.entries || []).map((e) => e.proposalId).filter(Boolean));
    const still = [];
    for (const s of this.sent) {
      if (applied.has(s.id)) { this.justApproved.push(s); this.rememberApproved(s); }
      else still.push(s);
    }
    if (still.length !== this.sent.length) { this.sent = still; saveJSON(SENT_KEY, this.sent); }
  },

  /** The draft as a full proposal envelope. */
  draftProposal() {
    const p = newProposal();
    p.id = this.draft.id;
    p.createdAt = this.draft.updatedAt || new Date().toISOString();
    p.baseRevision = this.data?.meta?.revision ?? 0;
    p.dependsOn = [...(this.draft.dependsOn || [])];
    p.submitter = { ...this.draft.submitter };
    p.note = this.draft.note || '';
    p.ops = this.draft.ops.map((o) => structuredClone(o));
    return p;
  },

  /**
   * Apply sent proposals (that still apply) then `draftOps` on top of canonical data in preview mode.
   * Returns { data, refMap, sentResults, draftResult }.
   */
  overlay(draftProposal) {
    let data = this.data;
    const refMap = {};
    const sentTouched = new Set();
    const created = new Set();
    this.sentStale = new Set();
    for (const s of this.sent) {
      const deps = s.proposal.dependsOn || [];
      const r = applyProposal(data, s.proposal, { ...PREVIEW(), refMap: { ...this.appliedRefMap(deps), ...refMap }, appliedDeps: this.appliedDeps(deps) });
      if (!r.ok) { this.sentStale.add(s.id); continue; }
      data = r.data;
      for (const ref of Object.keys(r.idMap || {})) refMap[ref] = r.idMap[ref];
      for (const op of s.proposal.ops) for (const d of opRefs(op).declares) if (!(d in refMap)) refMap[d] = d;
      r.touched.people.forEach((id) => sentTouched.add(id));
      r.touched.unions.forEach((id) => sentTouched.add(id));
      [...(r.created.people || []), ...(r.created.unions || [])].forEach((id) => created.add(id));
    }
    let draftResult = null;
    if (draftProposal && draftProposal.ops.length) {
      const deps = draftProposal.dependsOn || [];
      draftResult = applyProposal(data, draftProposal, { ...PREVIEW(), refMap: { ...this.appliedRefMap(deps), ...refMap }, appliedDeps: this.appliedDeps(deps) });
    }
    return { data, refMap, sentTouched, created, draftResult };
  },

  /** Re-apply sent proposals + draft on top of the canonical data. */
  recompute() {
    this.draftErrors = [];
    this.draftWarnings = [];
    this.pending = { draft: new Set(), sent: new Set(), created: new Set() };
    if (!this.sent.length && !this.draft.ops.length) { this.working = this.base; return; }
    const { data, sentTouched, created, draftResult } = this.overlay(this.draftProposal());
    this.pending.sent = sentTouched;
    this.pending.created = created;
    let finalData = data;
    if (draftResult) {
      if (draftResult.ok) {
        finalData = draftResult.data;
        draftResult.touched.people.forEach((id) => this.pending.draft.add(id));
        draftResult.touched.unions.forEach((id) => this.pending.draft.add(id));
        [...(draftResult.created.people || []), ...(draftResult.created.unions || [])].forEach((id) => this.pending.created.add(id));
        this.draftWarnings = draftResult.warnings || [];
      } else {
        this.draftErrors = draftResult.errors || [];
      }
    }
    this.working = finalData === this.data ? this.base : buildGraph(finalData);
  },

  /** 'draft' | 'sent' | null — for "not sent yet" / "awaiting approval" badges. */
  pendingKind(id) {
    if (this.pending.draft.has(id)) return 'draft';
    if (this.pending.sent.has(id)) return 'sent';
    return null;
  },
  isPending(id) { return this.pendingKind(id) !== null; },
  isCreated(id) { return this.pending.created.has(id); },

  /** Fresh temp refs from a per-browser counter that never resets (refs stay unique across proposals). */
  nextCounter() {
    const n = (Number(loadJSON(COUNTER_KEY)) || 0) + 1;
    saveJSON(COUNTER_KEY, n);
    return n;
  },
  newRef() { return `new${this.nextCounter()}`; },
  newUnionRef() { return `newu${this.nextCounter()}`; },

  /** Which sent proposals declared these refs? (for automatic dependsOn) */
  sentProposalsDeclaring(refs) {
    const ids = new Set();
    for (const s of this.sent) {
      for (const op of s.proposal.ops) {
        if (opRefs(op).declares.some((d) => refs.includes(d))) ids.add(s.id);
      }
    }
    return [...ids];
  },

  /**
   * Try to add ops to the draft. They are trial-applied with the existing draft (on top of sent proposals);
   * if anything fails nothing is added and {ok:false, errors} is returned (op indexes are relative to the FULL draft).
   */
  addOps(ops) {
    if (this.syncFromStorage()) this.recompute();
    const list = (Array.isArray(ops) ? ops : [ops]).map((o) => structuredClone(o));
    const trial = this.draftProposal();
    trial.ops.push(...list);
    // Refs used but not declared in the draft must come from sent proposals → dependsOn.
    const declared = new Set(trial.ops.flatMap((o) => opRefs(o).declares));
    const foreign = [...new Set(trial.ops.flatMap((o) => opRefs(o).uses))].filter((r) => /^newu?\d+$/.test(r) && !declared.has(r));
    const deps = new Set([...(trial.dependsOn || []), ...this.sentProposalsDeclaring(foreign)]);
    trial.dependsOn = [...deps];
    const { draftResult } = this.overlay(trial);
    if (!draftResult || !draftResult.ok) return { ok: false, errors: draftResult ? draftResult.errors : [], warnings: draftResult ? draftResult.warnings : [] };
    this.draft.ops.push(...list);
    this.draft.dependsOn = trial.dependsOn;
    this.touchDraft();
    return { ok: true, warnings: draftResult.warnings, idMap: draftResult.idMap };
  },

  /**
   * Remove op at index i, plus later ops that depend on refs it declared (transitively),
   * plus later ops that no longer apply. Returns the number of ops removed.
   */
  removeOp(i) {
    // The list on screen may be stale if another tab changed the draft: refresh instead of removing the wrong change.
    if (this.syncFromStorage()) { this.recompute(); this.emit('draft'); return 0; }
    if (i < 0 || i >= this.draft.ops.length) return 0;
    const before = this.draft.ops.length;
    const dead = new Set(opRefs(this.draft.ops[i]).declares);
    let ops = [];
    this.draft.ops.forEach((op, idx) => {
      if (idx === i) return;
      if (idx > i) {
        const { declares, uses } = opRefs(op);
        if (uses.some((u) => dead.has(u))) { declares.forEach((d) => dead.add(d)); return; }
      }
      ops.push(op);
    });
    for (let guard = 0; guard < 50; guard++) {
      const p = this.draftProposal();
      p.ops = ops;
      const { draftResult } = this.overlay(p);
      if (!draftResult || draftResult.ok) break;
      const bad = new Set((draftResult.errors || []).map((e) => e.op).filter((n) => Number.isInteger(n)));
      if (!bad.size) break;
      const deadRefs = new Set();
      ops.forEach((op, idx) => { if (bad.has(idx)) opRefs(op).declares.forEach((d) => deadRefs.add(d)); });
      ops = ops.filter((op, idx) => !bad.has(idx) && !opRefs(op).uses.some((u) => deadRefs.has(u)));
    }
    this.draft.ops = ops;
    this.touchDraft();
    return before - ops.length;
  },

  /** Replace the draft with a proposal (admin "correct this proposal" / preview "load into my draft"). */
  replaceDraft(proposal, { source = null } = {}) {
    this.syncFromStorage();
    const d = emptyDraft(this.draft.submitter);
    // Rename every temp ref the loaded proposal declares to a fresh ref of THIS browser, so it cannot collide
    // with refs of proposals this visitor already sent (every browser starts at new1).
    const renames = {};
    for (const op of proposal.ops || []) {
      for (const r of opRefs(op).declares) {
        if (renames[r]) continue;
        renames[r] = /^newu\d+$/.test(r) ? this.newUnionRef() : this.newRef();
      }
    }
    d.ops = rewriteRefs(proposal.ops || [], renames);
    d.submitter = { ...d.submitter, ...rewriteRefs(proposal.submitter || {}, renames) };
    d.note = proposal.note || '';
    d.dependsOn = [...(proposal.dependsOn || [])];
    d.source = source;
    if (source && proposal.id) d.id = proposal.id;
    // Keep the global ref counter above any ref used in the loaded ops.
    let max = 0;
    for (const op of d.ops) {
      const { declares, uses } = opRefs(op);
      for (const r of [...declares, ...uses]) {
        const m = /^newu?(\d+)$/.exec(r);
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    if (max > (Number(loadJSON(COUNTER_KEY)) || 0)) saveJSON(COUNTER_KEY, max);
    this.draft = d;
    this.touchDraft();
  },

  clearDraft() {
    this.syncFromStorage();
    this.draft = emptyDraft(this.draft.submitter);
    this.touchDraft();
  },

  /** Called when the visitor sends the draft (WhatsApp / GitHub / email / copy). Moves it to the sent queue. */
  markSent(via) {
    if (this.syncFromStorage()) this.recompute();
    if (!this.draft.ops.length) return null;
    const proposal = this.draftProposal();
    const entry = { id: proposal.id, at: new Date().toISOString(), via, proposal };
    // Write the fresh empty draft BEFORE the sent queue, so other tabs never see the old draft as unsent.
    this.draft = emptyDraft(this.draft.submitter);
    this.persistDraft();
    this.sent = [...this.sent.filter((s) => s.id !== entry.id), entry];
    saveJSON(SENT_KEY, this.sent);
    this.recompute();
    this.emit('sent');
    this.emit('draft');
    return entry;
  },

  /** Remember an approved proposal of this visitor (small summary only; the changelog holds the text). */
  rememberApproved(s) {
    if (!s || this.approved.some((a) => a.id === s.id)) return;
    const entry = (this.changelog?.entries || []).find((e) => e.proposalId === s.id) || null;
    const item = { id: s.id, at: s.at || '', via: s.via || '', ops: s.proposal?.ops?.length || 0, approvedAt: entry?.at || new Date().toISOString(), issue: entry?.issue ?? null };
    this.approved = [item, ...this.approved].slice(0, 30);
    saveJSON(APPROVED_KEY, this.approved);
  },

  /** Drop an approved proposal from the local history (#/me "forget"). */
  forgetApproved(id) {
    this.approved = this.approved.filter((a) => a.id !== id);
    saveJSON(APPROVED_KEY, this.approved);
    this.emit('sent');
  },

  /** Forget a sent proposal (e.g. the owner rejected it, or the visitor withdraws it). */
  forgetSent(id) {
    this.sent = this.sent.filter((s) => s.id !== id);
    saveJSON(SENT_KEY, this.sent);
    this.recompute();
    this.emit('sent');
  },

  setSubmitter(patch) { this.syncFromStorage(); Object.assign(this.draft.submitter, patch); this.persistDraft(); },
  setNote(note) { this.syncFromStorage(); this.draft.note = note; this.persistDraft(); },

  touchDraft() {
    this.draft.updatedAt = new Date().toISOString();
    this.persistDraft();
    this.recompute();
    this.emit('draft');
  },
  persistDraft() { saveJSON(DRAFT_KEY, this.draft); },

  setMe(id) {
    this.me = id || null;
    saveJSON(ME_KEY, this.me);
    if (this.me && !this.draft.submitter.personId) this.setSubmitter({ personId: this.me });
    this.emit('me');
  },

  /** Viewer preference for Arabic-Indic (arab) vs Western (latn) digits. */
  digits: 'latn',
  setDigitsPref(d, { silent = false } = {}) {
    this.digits = d === 'arab' ? 'arab' : 'latn';
    setArabicDigits(this.digits === 'arab');
    try { setDigits(this.digits); } catch { /* optional */ }
    if (!silent) { saveJSON(DIGITS_KEY, this.digits); this.emit('data'); }
  },

  on(evt, fn) {
    listeners[evt].add(fn);
    return () => listeners[evt].delete(fn);
  },
  emit(evt) {
    for (const fn of [...listeners[evt]]) {
      try { fn(); } catch (e) { console.error(e); }
    }
  },

  /** Links to the GitHub repository. */
  repoUrl(path = '') {
    const { owner, name } = this.config.repo;
    return `https://github.com/${owner}/${name}${path}`;
  },
  /** Absolute site URL + hash route, for sharing. */
  siteLink(hash = '') {
    const base = this.config.siteUrl || (location.origin + location.pathname);
    return base.replace(/#.*$/, '') + hash;
  },
};

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

// Debug handle (harmless): lets the owner inspect state from the browser console.
globalThis.__gft = store;
