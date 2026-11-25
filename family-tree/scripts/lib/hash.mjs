// Proposal fingerprints (docs/SPEC.md §6.2–§6.3).
//   hash = ops.proposalHash(p) — SHA-256 hex of the canonical proposal JSON without createdAt
//   fp   = the first 6 hex characters, typed by the owner in "/approve <fp>"

import { proposalHash } from '../../js/core/ops.js';

export const FP_LENGTH = 6;

/** {hash, fp} of a proposal. */
export async function hashProposal(proposal) {
  const hash = await proposalHash(proposal);
  return { hash, fp: fpOf(hash) };
}

export const fpOf = (hash) => String(hash || '').slice(0, FP_LENGTH);

/** Does a typed fingerprint (≥ 6 hex chars, any case) match the hash? Longer prefixes are accepted too. */
export function fpMatches(fp, hash) {
  const f = String(fp || '').trim().toLowerCase();
  if (!/^[0-9a-f]{6,64}$/.test(f)) return false;
  return String(hash || '').toLowerCase().startsWith(f);
}
