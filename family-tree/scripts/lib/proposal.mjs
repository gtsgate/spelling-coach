// Which proposal an issue carries, and what the ledgers know about proposals (docs/SPEC.md §6.2–§6.6).
//
//   effectiveProposal(issue, comments, {approvers})  the latest owner correction (a "/approve|/approve-deletion|/correct"
//       comment by an approver that contains a code; quoted lines ignored), else the issue body.
//       → {proposal, code, src: "body" | "c<commentId>", comment?} · {proposal: null} · {error} (damaged code in the body)
//   appliedIndex(applied)            proposalId → ledger entry (entries marked `undone` are left out)
//   depsFor(proposal, applied, batch) → {refMap, appliedDeps}  temp refs of dependsOn proposals already applied
//   openIndex(issues)                [{number, hash, proposalId}] of open proposal issues (body codes)
//   findBotComment(comments, kind, botLogin)   the bot's comment carrying <!-- gft-bot:<kind> … -->

import { extractProposal } from '../../js/core/codec.js';
import { parseCommand, isApprover } from './commands.mjs';
import { hashProposal } from './hash.mjs';
import { BOT_LOGIN } from './labels.mjs';

const CORRECTION_COMMANDS = new Set(['approve', 'approve-deletion', 'correct']);

/** A proposal from an owner's command comment (code below the command line), or null. Throws codec errors. */
export async function correctionIn(body) {
  const found = await extractProposal(String(body || ''), { ignoreQuoted: true });
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
    const found = await extractProposal(String(issue?.body || ''), { ignoreQuoted: false });
    if (!found) return { proposal: null };
    return { proposal: found.proposal, code: found.code, src: 'body' };
  } catch (error) {
    return { proposal: null, error };
  }
}

/** proposalId → applied.json entry (+ hash), skipping undone entries; the latest entry wins. */
export function appliedIndex(applied) {
  const byId = new Map();
  for (const [hash, e] of Object.entries(applied || {})) {
    if (!e || typeof e !== 'object' || e.undone || !e.proposalId) continue;
    const prev = byId.get(e.proposalId);
    if (!prev || String(e.at || '') >= String(prev.at || '')) byId.set(e.proposalId, { ...e, hash });
  }
  return byId;
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

/** [{number, hash, proposalId}] for open issues whose body holds a decodable proposal. */
export async function openIndex(issues) {
  const out = [];
  for (const i of issues || []) {
    try {
      const found = await extractProposal(String(i.body || ''), { ignoreQuoted: false });
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
