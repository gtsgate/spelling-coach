// /undo (docs/SPEC.md §6.5): restore the records an applied proposal changed, if nothing changed them since.
//
//   planUndo({git, rel, data, changelog, applied, number, actor, now}) →
//     {ok: true, data, changelog, applied, rev, entry, restored: {people, unions}, deleted: {people, unions}, message}
//     {ok: false, reason: "nothing" | "already" | "no-commit" | "changed" | "invalid", records?, siblings?, errors?}
//
// The changelog entry's `commit` (filled from the commit trailers when empty) gives the versions before (`<commit>^`)
// and after (`<commit>`). Only records listed in the entry's `touched` are considered (batch commits hold several
// proposals). A record is restored only if its current version equals the version of that commit and NO other
// proposal of the same batch commit (earlier or later in it) touched it — `<commit>^` is the state before the whole
// batch, so restoring a shared record would also erase the other proposal's change. Otherwise the undo is refused and
// those records are listed (records: [{kind, id, siblings?: [issue]}], siblings: the batch issues involved).

import { normalizeData, validateData, emptyData } from '../../js/core/schema.js';
import { canonicalJSON } from '../../js/core/ops.js';
import { LIMITS } from '../../js/core/schema.js';

const same = (a, b) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null);
const issueKey = (x) => `${x.code}|${x.path ?? ''}|${JSON.stringify(x.params ?? {})}`;

export function planUndo({ git, rel, data, changelog, applied, number, actor = '', now = new Date().toISOString() }) {
  const entries = changelog.entries || [];
  const idx = entries.findIndex((e) => Number(e?.issue) === Number(number) && (e.action || 'apply') === 'apply');
  if (idx < 0) return { ok: false, reason: 'nothing' };
  if (entries.slice(0, idx).some((e) => e?.action === 'undo' && Number(e.issue) === Number(number))) return { ok: false, reason: 'already' };
  const entry = entries[idx];
  const commit = entry.commit;
  if (!commit || !git.revExists(commit)) return { ok: false, reason: 'no-commit' };
  const afterText = git.show(commit, rel.data);
  if (afterText === null) return { ok: false, reason: 'no-commit' };
  const beforeText = git.revExists(`${commit}^`) ? git.show(`${commit}^`, rel.data) : null;
  const before = normalizeData(beforeText ? JSON.parse(beforeText) : emptyData());
  const after = normalizeData(JSON.parse(afterText));
  const cur = normalizeData(data);

  // Every OTHER proposal of the same commit (a batch, before or after this one in it) that touched the same records
  // blocks their undo.
  const siblings = entries.filter((e, i) => i !== idx && e && e.commit === commit && (e.action || 'apply') === 'apply'
    && Number(e.issue) !== Number(number));
  const blocked = { people: new Map(), unions: new Map() };
  for (const s of siblings) {
    for (const k of ['people', 'unions']) {
      for (const id of s.touched?.[k] || []) {
        if (!blocked[k].has(id)) blocked[k].set(id, []);
        blocked[k].get(id).push(Number(s.issue));
      }
    }
  }

  const kinds = ['people', 'unions'];
  const candidates = {};
  for (const k of kinds) {
    const listed = entry.touched?.[k];
    candidates[k] = Array.isArray(listed)
      ? [...new Set(listed)]
      : [...new Set([...Object.keys(before[k]), ...Object.keys(after[k])])];
  }
  const changes = [];
  const conflicts = [];
  for (const k of kinds) {
    for (const id of candidates[k]) {
      const b = before[k][id];
      const a = after[k][id];
      if (same(a, b)) continue;
      if (blocked[k].has(id)) conflicts.push({ kind: k, id, siblings: blocked[k].get(id) });
      else if (!same(cur[k][id], a)) conflicts.push({ kind: k, id });
      else changes.push({ kind: k, id, value: b });
    }
  }
  if (conflicts.length) {
    const sib = [...new Set(conflicts.flatMap((c) => c.siblings || []))].sort((x, y) => x - y);
    return { ok: false, reason: 'changed', records: conflicts, siblings: sib, entry };
  }
  const rootChanged = after.meta.rootPersonId !== before.meta.rootPersonId && cur.meta.rootPersonId === after.meta.rootPersonId;
  if (!changes.length && !rootChanged) return { ok: false, reason: 'nothing' };

  const next = normalizeData(cur);
  const restored = { people: [], unions: [] };
  const deleted = { people: [], unions: [] };
  for (const c of changes) {
    if (c.value === undefined) {
      delete next[c.kind][c.id];
      deleted[c.kind].push(c.id);
    } else {
      next[c.kind][c.id] = JSON.parse(JSON.stringify(c.value));
      restored[c.kind].push(c.id);
    }
  }
  if (rootChanged) next.meta.rootPersonId = before.meta.rootPersonId;

  const v0 = validateData(cur);
  const v1 = validateData(next);
  const old = new Set(v0.errors.map(issueKey));
  const errors = v1.errors.filter((x) => !old.has(issueKey(x)));
  if (errors.length) return { ok: false, reason: 'invalid', errors, entry };

  const rev = (Number(cur.meta.revision) || 0) + 1;
  next.meta.revision = rev;
  next.meta.updatedAt = now;
  for (const id of restored.people) {
    const p = next.people[id];
    p.history = [...(p.history || []), { issue: Number(number), rev, at: now, action: 'undo' }].slice(-LIMITS.history);
  }

  const undoEntry = {
    issue: Number(number),
    proposalId: entry.proposalId || '',
    hash: entry.hash || '',
    commit: '',
    rev,
    at: now,
    title: `Undo #${number}${entry.title ? `: ${entry.title}` : ''}`.slice(0, 200),
    summary: { en: [`Undo of the changes approved in #${number}`], ar: [`التراجع عن التعديلات المعتمدة في #${number}`] },
    submitter: entry.submitter || null,
    approvedBy: actor,
    people: restored.people.slice(),
    touched: {
      people: [...restored.people, ...deleted.people],
      unions: [...restored.unions, ...deleted.unions],
    },
    destructive: false,
    action: 'undo',
  };
  const nextChangelog = { entries: [undoEntry, ...entries] };
  const nextApplied = { ...applied };
  if (entry.hash && nextApplied[entry.hash] && Number(nextApplied[entry.hash].issue) === Number(number)) {
    nextApplied[entry.hash] = { ...nextApplied[entry.hash], undone: now };
  }
  const message = [
    `family-tree: undo #${number}`,
    '',
    `Restores ${restored.people.length + restored.unions.length} record(s) and removes ${deleted.people.length + deleted.unions.length}`,
    `created by #${number} (commit ${commit.slice(0, 12)}).`,
    '',
    `Gft-Undo: #${number} rev ${rev}`,
  ].join('\n');
  return {
    ok: true, data: next, changelog: nextChangelog, applied: nextApplied, rev, entry, restored, deleted, message,
    before, after,
  };
}
