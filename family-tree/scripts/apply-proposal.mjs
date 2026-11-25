#!/usr/bin/env node
// Apply approved proposals (docs/SPEC.md §6.3, §6.5) — run by .github/workflows/family-tree-apply.yml.
//
//   node scripts/apply-proposal.mjs                       # in Actions: event from $GITHUB_EVENT_PATH, $GITHUB_TOKEN
//   node scripts/apply-proposal.mjs --dry-run --event scripts/fixtures/approve-comment.json
//       offline dry run: GitHub is simulated from the event file, the data is applied in memory, nothing is
//       written (no files, no commit, no push) and the comments the bot would post are printed.
//   With GITHUB_TOKEN and --dry-run (or workflow_dispatch dry_run=true) the real issues are read, writes are logged.
//
// Handles: /approve [fp] [skip …] [force], /approve-deletion, /correct, /reject, /undo (+ Arabic aliases),
// approve labels, the schedule and manual runs. One commit per run; push conflicts → fetch + reset --hard + re-apply.

import { runApply } from './lib/apply.mjs';
import { createGit } from './lib/repo.mjs';
import { baseContext, parseArgs, readEvent, eventNameOf, defaultBranchOf, isMain, PORTAL_DIR } from './lib/context.mjs';
import { makeClient, printRecorded, runCli } from './lib/cli.mjs';

const USAGE = `Usage: node scripts/apply-proposal.mjs [--dry-run] [--event <payload.json>] [--event-name <name>] [--issue <n>]
Applies approved family-tree proposals: verifies approvals, commits data/*.json, pushes, comments and closes issues.`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) { console.log(USAGE); return 0; }
  const event = readEvent(args, env);
  const eventName = eventNameOf(args, event, env);
  if (args.issue) event.inputs = { ...(event.inputs || {}), issue: String(args.issue) };
  const base = baseContext({ env });
  const { gh, dryRun, offline } = makeClient({ args, event, slug: base.slug, env });
  let git = null;
  try {
    git = createGit({ cwd: PORTAL_DIR });
    git.head();
  } catch {
    git = null;
  }
  if (!git && !dryRun) throw new Error('not a git checkout');
  const branch = await defaultBranchOf({ event, gh: offline ? null : gh, config: base.config, env });
  const ctx = { ...base, gh, git, branch, dryRun };
  if (dryRun) console.log(`[dry-run] ${eventName} on ${base.slug.owner}/${base.slug.name} (branch ${branch}) — nothing will be written`);
  const summary = await runApply(ctx, { eventName, event });
  console.log(JSON.stringify(summary, null, 2));
  if (offline) printRecorded(gh);
  return 0;
}

if (isMain(import.meta.url)) runCli(main);
