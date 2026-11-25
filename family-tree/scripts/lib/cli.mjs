// Command-line plumbing shared by the scripts: picking the GitHub client and printing what a dry run would do.
//
//   GITHUB_TOKEN set            → real client (wrapped read-only with --dry-run / dispatch dry_run)
//   no token and --dry-run      → in-memory client seeded from the event file (+ its optional "_fixture" block)

import { createGitHub, readOnlyGitHub } from './github.mjs';
import { fakeFromEvent } from './fake-github.mjs';

export function makeClient({ args, event, slug, env = process.env, log = console.log }) {
  const dryRun = !!(args.dryRun || isTrue(event?.inputs?.dry_run));
  if (env.GITHUB_TOKEN) {
    const gh = createGitHub({ token: env.GITHUB_TOKEN, owner: slug.owner, repo: slug.name, apiUrl: env.GITHUB_API_URL || undefined });
    return { gh: dryRun ? readOnlyGitHub(gh, log) : gh, dryRun, offline: false };
  }
  if (!dryRun) throw new Error('GITHUB_TOKEN is not set (use --dry-run to try a fixture event offline)');
  const gh = fakeFromEvent(event);
  return { gh, dryRun, offline: true };
}

export const isTrue = (v) => v === true || v === 'true' || v === 1 || v === '1';

/** Print the writes an offline dry run recorded (comments in full, other calls in one line). */
export function printRecorded(gh, log = console.log) {
  if (!Array.isArray(gh.calls)) return;
  if (!gh.calls.length) { log('[dry-run] no GitHub changes'); return; }
  for (const c of gh.calls) {
    if (c.method === 'createComment' || c.method === 'updateComment') {
      log(`\n[dry-run] ${c.method}(${c.args[0]}):\n${'-'.repeat(72)}\n${c.args[1]}\n${'-'.repeat(72)}`);
    } else log(`[dry-run] ${c.method}(${c.args.map((a) => JSON.stringify(a)).join(', ')})`);
  }
}

export async function runCli(main) {
  try {
    const code = await main();
    process.exitCode = code || 0;
  } catch (e) {
    console.error(process.env.GFT_DEBUG || !(e instanceof Error) || e.name !== 'Error' ? e?.stack || String(e) : `error: ${e.message}`);
    process.exitCode = 1;
  }
}
