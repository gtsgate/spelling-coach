// App state: configuration, canonical data, the visitor's draft proposal and the "working" graph
// (data + draft applied in preview mode, so pending changes appear everywhere in the UI).
import { buildGraph } from './core/graph.js';
import { applyProposal, newProposal, opRefs } from './core/ops.js';
import { normalizeData } from './core/schema.js';
import { setDigits } from './core/dates.js';
import { setDefaultLang, setArabicDigits } from './i18n.js';

const DRAFT_KEY = 'gft.draft.v1';
const ME_KEY = 'gft.me';

const listeners = { draft: new Set(), data: new Set(), me: new Set() };

function loadJSON(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveJSON(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full / unavailable */ }
}

function emptyDraft() {
  return { ops: [], submitter: { name: '', relation: '', personId: '' }, note: '', counter: 0, updatedAt: '' };
}

export const store = {
  /** @type {object} config.json */
  config: null,
  /** canonical normalized data (family.json) */
  data: null,
  /** Graph of canonical data */
  base: null,
  /** Graph of data + draft (preview). Views should normally read from this. */
  working: null,
  /** Draft proposal being prepared by this visitor */
  draft: emptyDraft(),
  /** ids touched / created by the draft (for "pending" badges) */
  pending: { people: new Set(), unions: new Set(), created: new Set() },
  /** Problems applying the current draft to the latest data (e.g. data changed since drafting) */
  draftErrors: [],
  draftWarnings: [],
  /** Map tempRef → op that declared it (for describing pending people) */
  changelog: null,
  me: null,
  ready: false,

  async init() {
    const [config, data] = await Promise.all([
      fetchJSON('config.json'),
      fetchJSON('data/family.json'),
    ]);
    this.config = config;
    setDefaultLang(config.defaultLanguage || 'ar');
    setArabicDigits(!!config.arabicDigits);
    try { setDigits(config.arabicDigits ? 'arab' : 'latn'); } catch { /* optional */ }
    this.setData(data, { silent: true });
    const saved = loadJSON(DRAFT_KEY);
    if (saved && Array.isArray(saved.ops)) this.draft = { ...emptyDraft(), ...saved, submitter: { ...emptyDraft().submitter, ...(saved.submitter || {}) } };
    this.me = loadJSON(ME_KEY);
    this.recompute();
    this.ready = true;
  },

  /** Replace canonical data (e.g. after load). */
  setData(raw, { silent = false } = {}) {
    this.data = normalizeData(raw);
    this.base = buildGraph(this.data);
    if (!silent) { this.recompute(); this.emit('data'); }
  },

  async loadChangelog() {
    if (this.changelog) return this.changelog;
    try { this.changelog = await fetchJSON('data/changelog.json'); } catch { this.changelog = { entries: [] }; }
    if (!this.changelog || !Array.isArray(this.changelog.entries)) this.changelog = { entries: [] };
    return this.changelog;
  },

  /** The draft as a full proposal envelope. */
  draftProposal() {
    const p = newProposal();
    p.createdAt = this.draft.updatedAt || new Date().toISOString();
    p.baseRevision = this.data?.meta?.revision ?? 0;
    p.submitter = { ...this.draft.submitter };
    p.note = this.draft.note || '';
    p.ops = this.draft.ops.map((o) => structuredClone(o));
    return p;
  },

  /** Re-apply the draft on top of the canonical data. */
  recompute() {
    this.draftErrors = [];
    this.draftWarnings = [];
    this.pending = { people: new Set(), unions: new Set(), created: new Set() };
    if (!this.draft.ops.length) { this.working = this.base; return; }
    const r = applyProposal(this.data, this.draftProposal(), { mode: 'preview', now: new Date().toISOString(), allowDestructive: true });
    if (r.ok) {
      this.working = buildGraph(r.data);
      this.pending = {
        people: new Set(r.touched.people),
        unions: new Set(r.touched.unions),
        created: new Set([...(r.created.people || []), ...(r.created.unions || [])]),
      };
      this.draftWarnings = r.warnings || [];
    } else {
      this.working = this.base;
      this.draftErrors = r.errors || [];
    }
  },

  /** Is this id something that only exists / changed in the draft? */
  isPending(id) { return this.pending.people.has(id) || this.pending.unions.has(id); },
  isCreated(id) { return this.pending.created.has(id); },

  /** Fresh temp refs (never reused within this draft). */
  newRef() { this.draft.counter += 1; this.persistDraft(); return `new${this.draft.counter}`; },
  newUnionRef() { this.draft.counter += 1; this.persistDraft(); return `newu${this.draft.counter}`; },

  /**
   * Try to add ops to the draft. They are trial-applied together with the existing draft; if anything fails,
   * nothing is added and {ok:false, errors} is returned (errors carry `op` indexes relative to the FULL draft).
   */
  addOps(ops) {
    const list = Array.isArray(ops) ? ops : [ops];
    const trial = this.draftProposal();
    trial.ops.push(...list.map((o) => structuredClone(o)));
    const r = applyProposal(this.data, trial, { mode: 'preview', now: new Date().toISOString(), allowDestructive: true });
    if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings };
    this.draft.ops.push(...list.map((o) => structuredClone(o)));
    this.touchDraft();
    return { ok: true, warnings: r.warnings, idMap: r.idMap };
  },

  /**
   * Remove op at index i, plus any later ops that depend on refs it declared (transitively),
   * plus any later ops that no longer apply. Returns the number of ops removed.
   */
  removeOp(i) {
    if (i < 0 || i >= this.draft.ops.length) return 0;
    const before = this.draft.ops.length;
    const dead = new Set(opRefs(this.draft.ops[i]).declares);
    const kept = [];
    this.draft.ops.forEach((op, idx) => {
      if (idx === i) return;
      if (idx > i) {
        const { declares, uses } = opRefs(op);
        if (uses.some((u) => dead.has(u))) { declares.forEach((d) => dead.add(d)); return; }
      }
      kept.push(op);
    });
    // Drop anything that still fails (e.g. reorder that only made sense with the removed op).
    let ops = kept;
    for (let guard = 0; guard < 50; guard++) {
      const p = this.draftProposal();
      p.ops = ops;
      const r = applyProposal(this.data, p, { mode: 'preview', now: new Date().toISOString(), allowDestructive: true });
      if (r.ok) break;
      const bad = new Set((r.errors || []).map((e) => e.op).filter((n) => Number.isInteger(n)));
      if (!bad.size) break;
      const deadRefs = new Set();
      ops.forEach((op, idx) => { if (bad.has(idx)) opRefs(op).declares.forEach((d) => deadRefs.add(d)); });
      ops = ops.filter((op, idx) => !bad.has(idx) && !opRefs(op).uses.some((u) => deadRefs.has(u)));
    }
    this.draft.ops = ops;
    this.touchDraft();
    return before - ops.length;
  },

  /** Replace the whole op list (used by "load proposal into my draft"). */
  replaceDraft(proposal) {
    const d = emptyDraft();
    d.ops = (proposal.ops || []).map((o) => structuredClone(o));
    d.submitter = { ...d.submitter, ...(proposal.submitter || {}) };
    d.note = proposal.note || '';
    // Keep temp-ref counter above any ref used in the loaded ops.
    let max = 0;
    for (const op of d.ops) {
      const { declares, uses } = opRefs(op);
      for (const r of [...declares, ...uses]) {
        const m = /^newu?(\d+)$/.exec(r);
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    d.counter = max;
    this.draft = d;
    this.touchDraft();
  },

  clearDraft() {
    const keepSubmitter = { ...this.draft.submitter };
    this.draft = emptyDraft();
    this.draft.submitter = keepSubmitter;
    this.touchDraft();
  },

  setSubmitter(patch) { Object.assign(this.draft.submitter, patch); this.persistDraft(); },
  setNote(note) { this.draft.note = note; this.persistDraft(); },

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
};

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

// Debug handle (harmless): lets the owner inspect state from the browser console.
globalThis.__gft = store;
