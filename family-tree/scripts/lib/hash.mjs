// Proposal fingerprints (docs/SPEC.md §6.2–§6.3).
//   hash = ops.proposalHash(p) — SHA-256 hex of the canonical proposal JSON without createdAt
//   fp   = the first FP_LENGTH (16) hex characters (64 bits), typed by the owner in "/approve <fp>"
// The fp only has to be typed; the approval itself is bound to the FULL hash (the bot's approval note records it).

import { proposalHash, FP_LENGTH, fingerprintOf } from '../../js/core/ops.js';

export { FP_LENGTH };

/** {hash, fp} of a proposal. */
export async function hashProposal(proposal) {
  const hash = await proposalHash(proposal);
  return { hash, fp: fpOf(hash) };
}

export const fpOf = (hash) => fingerprintOf(hash);

/** Normalized typed fingerprint (trimmed, lower case). */
const norm = (fp) => String(fp || '').trim().toLowerCase();

/** Is a typed fingerprint a hex string shorter than FP_LENGTH (e.g. an old 6-character one)? */
export function fpTooShort(fp) {
  const f = norm(fp);
  return /^[0-9a-f]+$/.test(f) && f.length < FP_LENGTH;
}

/** Does a typed fingerprint (≥ FP_LENGTH hex chars, any case) match the hash? Longer prefixes are accepted too. */
export function fpMatches(fp, hash) {
  const f = norm(fp);
  if (f.length < FP_LENGTH || f.length > 64 || !/^[0-9a-f]+$/.test(f)) return false;
  return String(hash || '').toLowerCase().startsWith(f);
}
