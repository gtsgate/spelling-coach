// Git helpers for the apply workflow (docs/SPEC.md §6.3, §6.5).
//
//   const git = createGit({cwd})               cwd = the portal directory (paths are relative to it, never "family-tree/")
//   git.run(args) · git.head() · git.show(rev, relPath) · git.fetch(remote, branch) · git.resetHard(ref)
//   git.add(paths) · git.hasStaged() · git.commit(message) (via `git commit -F <file>`) · git.push(remote, branch)
//   git.commitTrailers(relDir) → Map("apply:<issue>:<rev>" | "undo:<issue>:<rev>" → sha)
//
//   commitAndPush({git, branch, build, attempts = 5, sleep, log, dryRun})
//     build(attempt) writes the files from the CURRENT working tree and returns {message, paths, value}
//     (message null = nothing to commit). Push conflicts never rebase or merge JSON: the loop runs
//     `git fetch <remote> <branch>` + `git reset --hard FETCH_HEAD` and calls build() again on the new base.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BOT_NAME = 'github-actions[bot]';
export const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

export class GitError extends Error {
  constructor(args, stderr, status) {
    super(`git ${args.join(' ')} failed (${status}): ${String(stderr).trim().split('\n').slice(-3).join(' | ')}`);
    this.name = 'GitError';
    this.stderr = String(stderr || '');
    this.status = status;
  }
}

export function createGit({ cwd, env = process.env } = {}) {
  function run(args, { allowFail = false } = {}) {
    try {
      return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      if (allowFail) return null;
      throw new GitError(args, e.stderr || e.message, e.status);
    }
  }
  const identity = () => {
    const name = env.GIT_AUTHOR_NAME || run(['config', 'user.name'], { allowFail: true })?.trim() || BOT_NAME;
    const email = env.GIT_AUTHOR_EMAIL || run(['config', 'user.email'], { allowFail: true })?.trim() || BOT_EMAIL;
    return ['-c', `user.name=${name}`, '-c', `user.email=${email}`];
  };
  return {
    cwd,
    run,
    head: () => run(['rev-parse', 'HEAD']).trim(),
    /** File content at a revision (path relative to cwd), or null when it does not exist there. */
    show(rev, relPath) {
      const out = run(['show', `${rev}:./${relPath.replace(/^\.\//, '')}`], { allowFail: true });
      return out === null ? null : out;
    },
    revExists: (rev) => run(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFail: true }) !== null,
    fetch: (remote, branch) => run(['fetch', '--quiet', remote, branch]),
    resetHard: (ref) => run(['reset', '--hard', '--quiet', ref]),
    add: (paths) => run(['add', '--', ...paths]),
    hasStaged: () => run(['diff', '--cached', '--quiet'], { allowFail: true }) === null,
    commit(message) {
      const dir = mkdtempSync(join(tmpdir(), 'gft-msg-'));
      const file = join(dir, 'COMMIT_MSG');
      try {
        writeFileSync(file, message.endsWith('\n') ? message : `${message}\n`);
        run([...identity(), 'commit', '--quiet', '-F', file]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return run(['rev-parse', 'HEAD']).trim();
    },
    /** → {ok, rejected, stderr} (rejected = the remote moved on: non-fast-forward / fetch first) */
    push(remote, branch) {
      try {
        execFileSync('git', ['push', '--porcelain', remote, `HEAD:refs/heads/${branch}`], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, rejected: false, stderr: '' };
      } catch (e) {
        const text = `${e.stdout || ''}\n${e.stderr || ''}`;
        return { ok: false, rejected: /non-fast-forward|fetch first|rejected|stale info/i.test(text), stderr: text };
      }
    },
    /** Trailers "Gft-Apply: #12 <hash> rev 13" / "Gft-Undo: #12 rev 14" of recent commits touching relDir. */
    commitTrailers(relDir = 'data', max = 400) {
      const out = run(['log', `-n${max}`, '--format=%H%x1f%B%x1e', '--', `./${relDir}`], { allowFail: true }) || '';
      const map = new Map();
      for (const rec of out.split('\x1e')) {
        const [sha, msg] = rec.trim().split('\x1f');
        if (!sha || !msg) continue;
        for (const m of msg.matchAll(/^Gft-Apply: #(\d+) ([0-9a-f]{64}) rev (\d+)\s*$/gm)) {
          if (!map.has(`apply:${m[1]}:${m[3]}`)) map.set(`apply:${m[1]}:${m[3]}`, sha.trim());
        }
        for (const m of msg.matchAll(/^Gft-Undo: #(\d+) rev (\d+)\s*$/gm)) {
          if (!map.has(`undo:${m[1]}:${m[2]}`)) map.set(`undo:${m[1]}:${m[2]}`, sha.trim());
        }
      }
      return map;
    },
  };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build → commit → push, with up to `attempts` tries. On a rejected push: fetch, reset --hard to the remote branch,
 * build again (re-reading the data files), commit, push. → {ok, committed, sha?, attempt, value, error?}
 * (`value` is what the last build() returned, also after the last failed attempt.)
 */
export async function commitAndPush({
  git, branch, remote = 'origin', build, attempts = 5, sleep = defaultSleep, log = () => {}, dryRun = false,
  backoff = (n) => 2000 * 2 ** (n - 1),
}) {
  let last = null;
  let lastValue;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      try {
        git.fetch(remote, branch);
        git.resetHard('FETCH_HEAD');
      } catch (e) {
        log(`fetch/reset failed: ${e.message}`);
        last = e;
        await sleep(backoff(attempt));
        continue;
      }
    }
    const built = await build(attempt);
    lastValue = built?.value;
    if (!built || !built.message || dryRun) {
      return { ok: true, committed: false, attempt, value: built?.value, dryRun, message: built?.message || null };
    }
    git.add(built.paths);
    if (!git.hasStaged()) return { ok: true, committed: false, attempt, value: built.value, message: built.message };
    const sha = git.commit(built.message);
    const pushed = git.push(remote, branch);
    if (pushed.ok) return { ok: true, committed: true, sha, attempt, value: built.value, message: built.message };
    last = new Error(pushed.stderr.trim().split('\n').slice(-2).join(' | '));
    log(`push attempt ${attempt}/${attempts} failed${pushed.rejected ? ' (remote moved on)' : ''}: ${last.message}`);
    if (attempt < attempts) await sleep(backoff(attempt));
  }
  return { ok: false, committed: false, attempt: attempts, error: last, value: lastValue };
}
