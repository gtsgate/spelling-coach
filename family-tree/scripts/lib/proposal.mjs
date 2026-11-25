// Which proposal an issue carries, and what the ledgers know about proposals (docs/SPEC.md §6.2–§6.6).
//
//   effectiveProposal(issue, comments, {approvers})  the latest owner correction (a "/approve|/approve-deletion|/correct"
//       comment by an approver that contains a code; quoted lines ignored), else the issue body.
//       → {proposal, code, src: "body" | "c<commentId>", comment?} · {proposal: null} · {error} (damaged code in the body)
//   appliedIndex(applied)            proposalId → ledger entry (entries marked `undone` are left out; the FIRST applied
//                                    entry of an id wins — a later proposal re-using a public id never re-targets it)
//   idConflict(applied, proposal, hash, batch)  the applied (or earlier-in-batch) entry that already uses this proposal's
//                                    id under a DIFFERENT hash, or null (such a proposal is refused by check and apply)
//   depsFor(proposal, applied, batch) → {refMap, appliedDeps}  temp refs of dependsOn proposals already applied
//   resolveDependencyRefs(proposal, refMap)  the proposal with dependsOn temp refs replaced by the real ids (for describe)
//   openIndex(issues)                [{number, hash, proposalId}] of open proposal issues (body codes)
//   findBotComment(comments, kind, botLogin)   the bot's comment carrying <!-- gft-bot:<kind> … -->

import { extractProposal } from '../../js/core/codec.js';
import { opRefs } from '../../js/core/ops.js';
import { parseCommand, isApprover, clampBody } from './commands.mjs';
import { hashProposal } from './hash.mjs';
import { BOT_LOGIN } from './labels.mjs';

const CORRECTION_COMMANDS = new Set(['approve', 'approve-deletion', 'correct']);

/** A proposal from an owner's command comment (code below the command line), or null. Throws codec errors. */
export async function correctionIn(body) {
  const found = await extractProposal(clampBody(body), { ignoreQuoted: true });
  return found || null;
}

export async function effectiveProposal(issue, comments, { approvers = [] } = {}) {
  const list = Array.isArray(comments) ? comments : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (!isApprover(c?.user?.login, approvers)) continue;
    const cmd = parseCommand(c.body);
    if (!cmd || !CORRECTION_COMMANDS.has(cmd.cmd)) continue;
    let found = null;
    try { found = await correctionIn(c.body); } catch { found = null; }
    if (found) return { proposal: found.proposal, code: found.code, src: `c${c.id}`, comment: c };
  }
  try {
    const found = await extractProposal(clampBody(issue?.body), { ignoreQuoted: false });
    if (!found) return { proposal: null };
    return { proposal: found.proposal, code: found.code, src: 'body' };
  } catch (error) {
    return { proposal: null, error };
  }
}

/**
 * proposalId → applied.json entry (+ hash), skipping undone entries. The FIRST applied entry of an id wins (earliest
 * `at`, then ledger order): proposal ids are public, so a later proposal re-using one must never re-target the
 * dependants of the original (check and apply also refuse such a proposal — see idConflict).
 */
export function appliedIndex(applied) {
  const byId = new Map();
  for (const [hash, e] of Object.entries(applied || {})) {
    if (!e || typeof e !== 'object' || e.undone || !e.proposalId) continue;
    const prev = byId.get(e.proposalId);
    if (!prev || String(e.at || '') < String(prev.at || '')) byId.set(e.proposalId, { ...e, hash });
  }
  return byId;
}

/**
 * The ledger entry that already uses `proposal.id` under a different hash (applied, not undone), else the earlier
 * proposal of this batch (`batch`: proposalId → {hash, issue}) that does, else null. → {issue, hash, proposalId} | null
 */
export function idConflict(applied, proposal, hash, batch = new Map()) {
  const id = proposal?.id;
  if (!id) return null;
  const e = appliedIndex(applied).get(id);
  if (e && e.hash !== hash) return { issue: e.issue, hash: e.hash, proposalId: id };
  const b = batch.get(id);
  if (b && b.hash && b.hash !== hash) return { issue: b.issue, hash: b.hash, proposalId: id };
  return null;
}

/** An applied (not undone) ledger entry for this hash, or null. */
export function appliedEntry(applied, hash) {
  const e = applied?.[hash];
  return e && typeof e === 'object' && !e.undone ? e : null;
}

/** refMap + appliedDeps for a proposal's dependsOn (applied.json, then proposals applied earlier in this batch). */
export function depsFor(proposal, applied, batch = new Map()) {
  const index = appliedIndex(applied);
  const refMap = {};
  const appliedDeps = [];
  for (const id of Array.isArray(proposal?.dependsOn) ? proposal.dependsOn : []) {
    const e = batch.get(id) || index.get(id);
    if (!e) continue;
    Object.assign(refMap, e.idMap || {});
    appliedDeps.push(id);
  }
  return { refMap, appliedDeps };
}

/**
 * The proposal with every temp ref it USES (not declares) that `refMap` resolves (refs of dependsOn proposals already
 * applied) replaced by the real id — so describe names the real people the keeper is approving changes to, instead of
 * "a new person (new1)". Only for display: apply always gets the original proposal + refMap.
 */
export function resolveDependencyRefs(proposal, refMap = {}) {
  const ops = Array.isArray(proposal?.ops) ? proposal.ops : [];
  const keys = Object.keys(refMap || {});
  if (!keys.length || !ops.length) return proposal;
  const declared = new Set(ops.flatMap((op) => opRefs(op).declares));
  const SKIP = new Set(['set', 'before']); // edited values are data, never refs
  const swap = (v, uses, key) => {
    if (typeof v === 'string') return uses.has(v) ? refMap[v] : v;
    if (Array.isArray(v)) return v.map((x) => swap(x, uses));
    if (v && typeof v === 'object') {
      if (SKIP.has(key) || key === 'person') return v; // add-person's person input (names), edit values
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x, uses, k)]));
    }
    return v;
  };
  let changed = false;
  const out = ops.map((op) => {
    const uses = new Set(opRefs(op).uses.filter((u) => !declared.has(u) && Object.prototype.hasOwnProperty.call(refMap, u)));
    if (!uses.size) return op;
    changed = true;
    return swap(op, uses, '');
  });
  return changed ? { ...proposal, ops: out } : proposal;
}

/** [{number, hash, proposalId}] for open issues whose body holds a decodable proposal. */
export async function openIndex(issues) {
  const out = [];
  for (const i of issues || []) {
    try {
      const found = await extractProposal(clampBody(i.body), { ignoreQuoted: false });
      if (!found) continue;
      const { hash } = await hashProposal(found.proposal);
      out.push({ number: i.number, hash, proposalId: found.proposal.id });
    } catch { /* damaged code: not comparable */ }
  }
  return out;
}

/** The bot's comment carrying a marker of `kind` (the first one), or null. */
export function findBotComment(comments, kind, botLogin = BOT_LOGIN) {
  const needle = `<!-- gft-bot:${kind}`;
  return (comments || []).find((c) => c?.user?.login === botLogin && String(c.body || '').includes(needle)) || null;
}

/** All bot comments carrying a marker of `kind`, oldest first. */
export function botComments(comments, kind, botLogin = BOT_LOGIN) {
  const needle = `<!-- gft-bot:${kind}`;
  return (comments || []).filter((c) => c?.user?.login === botLogin && String(c.body || '').includes(needle));
}

/** Order a batch so that proposals come after the ones they depend on (stable otherwise). */
export function orderByDependencies(items, idOf = (x) => x.proposal?.id, depsOf = (x) => x.proposal?.dependsOn || []) {
  const byId = new Map(items.map((x) => [idOf(x), x]));
  const out = [];
  const state = new Map();
  const visit = (x) => {
    const s = state.get(x);
    if (s === 'done' || s === 'busy') return;
    state.set(x, 'busy');
    for (const d of depsOf(x)) if (byId.has(d)) visit(byId.get(d));
    state.set(x, 'done');
    out.push(x);
  };
  items.forEach(visit);
  return out;
}
