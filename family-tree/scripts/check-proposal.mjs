#!/usr/bin/env node
// Check a proposal issue (docs/SPEC.md §6.2) — run by .github/workflows/family-tree-check.yml.
//
//   node scripts/check-proposal.mjs                       # in Actions: reads $GITHUB_EVENT_PATH, $GITHUB_TOKEN
//   node scripts/check-proposal.mjs --issue 12            # re-check one issue (needs GITHUB_TOKEN)
//   node scripts/check-proposal.mjs --dry-run --event scripts/fixtures/issue-opened.json
//                                                         # offline: prints the comment it would post
//
// Never uses outsider-controlled values from the workflow file: the issue is re-fetched through the REST API.

import { checkIssue } from './lib/check.mjs';
import { baseContext, parseArgs, readEvent, eventNameOf, isMain } from './lib/context.mjs';
import { makeClient, printRecorded, runCli } from './lib/cli.mjs';

const USAGE = `Usage: node scripts/check-proposal.mjs [--dry-run] [--event <payload.json>] [--issue <n>]
Checks a family-tree proposal issue: dry-runs it against data/family.json and writes one bot comment.`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) { console.log(USAGE); return 0; }
  const event = readEvent(args, env);
  const eventName = eventNameOf(args, event, env);
  const base = baseContext({ env });
  const { gh, dryRun, offline } = makeClient({ args, event, slug: base.slug, env });
  const ctx = { ...base, gh, dryRun };
  const number = args.issue || Number(event.issue?.number) || Number(event.inputs?.issue) || 0;
  if (!number) { console.log(`No issue number in the ${eventName} event — nothing to check.`); return 0; }
  if (event.issue?.pull_request) { console.log('Pull request — skipped.'); return 0; }
  const res = await checkIssue(ctx, number);
  console.log(`check #${number}: ${JSON.stringify({ status: res.status, reason: res.reason, fp: res.fp, ok: res.ok, edits: res.edits, destructive: res.destructive })}`);
  if (offline) printRecorded(gh);
  return 0;
}

if (isMain(import.meta.url)) runCli(main);
