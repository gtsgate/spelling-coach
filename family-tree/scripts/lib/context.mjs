// Shared setup of the scripts: where the portal lives, reading/writing the data files, the event, CLI flags.
// Paths are resolved from this file's location (scripts/lib/ → the portal directory), so the scripts work the same
// whether the portal is a sub-folder ("family-tree/") or the root of its own repository.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeData } from '../../js/core/schema.js';
import { BOT_LOGIN } from './labels.mjs';

export const PORTAL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CHANGELOG_MAX = 500;

export function portalPaths(portalDir = PORTAL_DIR) {
  return {
    portalDir,
    config: join(portalDir, 'config.json'),
    dataDir: join(portalDir, 'data'),
    data: join(portalDir, 'data', 'family.json'),
    changelog: join(portalDir, 'data', 'changelog.json'),
    applied: join(portalDir, 'data', 'applied.json'),
    /** Paths relative to the portal directory (for git show / git log). */
    rel: { data: 'data/family.json', changelog: 'data/changelog.json', applied: 'data/applied.json', dataDir: 'data' },
  };
}

const readJSON = (file, fallback) => {
  if (!existsSync(file)) return fallback;
  const text = readFileSync(file, 'utf8');
  return text.trim() ? JSON.parse(text) : fallback;
};

/** Read/write the data files of a portal directory. */
export function createFiles(portalDir = PORTAL_DIR) {
  const p = portalPaths(portalDir);
  return {
    paths: p,
    loadConfig: () => readJSON(p.config, {}),
    loadData: () => readJSON(p.data, null),
    loadChangelog() {
      const c = readJSON(p.changelog, { entries: [] });
      return c && Array.isArray(c.entries) ? c : { entries: [] };
    },
    loadApplied() {
      const a = readJSON(p.applied, {});
      return a && typeof a === 'object' && !Array.isArray(a) ? a : {};
    },
    loadAll() {
      return { data: this.loadData(), changelog: this.loadChangelog(), applied: this.loadApplied() };
    },
    /** Write the three data files (canonical formatting) → the absolute paths written. */
    saveAll({ data, changelog, applied }) {
      const entries = (changelog?.entries || []).slice(0, CHANGELOG_MAX);
      writeFileSync(p.data, serializeData(data));
      writeFileSync(p.changelog, `${JSON.stringify({ entries }, null, 2)}\n`);
      writeFileSync(p.applied, `${JSON.stringify(applied || {}, null, 2)}\n`);
      return [p.data, p.changelog, p.applied];
    },
  };
}

/** Minimal flag parser: --dry-run, --event <file>, --event-name <name>, --issue <n>, --help, --json, --file <f>. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false, help: false, json: false, event: null, eventName: null, issue: null, file: null, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a === '--event') out.event = val();
    else if (a === '--event-name') out.eventName = val();
    else if (a === '--issue') out.issue = Number(val());
    else if (a === '--file') out.file = val();
    else if (a.startsWith('--') && a.includes('=')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (k === 'event') out.event = v;
      else if (k === 'event-name') out.eventName = v;
      else if (k === 'issue') out.issue = Number(v);
      else if (k === 'file') out.file = v;
      else out.rest.push(a);
    } else out.rest.push(a);
  }
  return out;
}

/** The event payload: --event file, else $GITHUB_EVENT_PATH, else {}. */
export function readEvent(args, env = process.env) {
  const file = args.event || env.GITHUB_EVENT_PATH;
  if (!file) return {};
  return JSON.parse(readFileSync(resolve(file), 'utf8'));
}

/** Event name: --event-name, $GITHUB_EVENT_NAME, else guessed from the payload shape. */
export function eventNameOf(args, event, env = process.env) {
  if (args.eventName) return args.eventName;
  if (env.GITHUB_EVENT_NAME && !args.event) return env.GITHUB_EVENT_NAME;
  if (event.comment) return 'issue_comment';
  if (event.issue) return 'issues';
  if (event.schedule) return 'schedule';
  if (event.inputs) return 'workflow_dispatch';
  return env.GITHUB_EVENT_NAME || 'workflow_dispatch';
}

/** owner/name: $GITHUB_REPOSITORY first (the repo the workflow runs in), else config.repo. */
export function repoSlug(config = {}, env = process.env) {
  const [owner, name] = String(env.GITHUB_REPOSITORY || '').split('/');
  if (owner && name) return { owner, name };
  return { owner: config.repo?.owner || 'owner', name: config.repo?.name || 'repo' };
}

/** Public site URL (config.siteUrl, else the GitHub Pages URL of the repository). Always ends with "/". */
export function siteUrlOf(config = {}, slug = repoSlug(config)) {
  let url = String(config.siteUrl || '').trim();
  if (!url) {
    const portal = String(config.portalPath || '').replace(/^\/+|\/+$/g, '');
    url = `https://${slug.owner}.github.io/${slug.name}/${portal ? `${portal}/` : ''}`;
  }
  return url.endsWith('/') ? url : `${url}/`;
}

/** Branch to commit to: the repository's default branch (event payload or REST), else config, else "main". */
export async function defaultBranchOf({ event = {}, gh = null, config = {}, env = process.env } = {}) {
  if (env.GFT_BRANCH) return env.GFT_BRANCH;
  if (event.repository?.default_branch) return event.repository.default_branch;
  if (gh?.getRepo) {
    try {
      const r = await gh.getRepo();
      if (r?.default_branch) return r.default_branch;
    } catch { /* fall through */ }
  }
  return config.repo?.branch || 'main';
}

/** Base context shared by check/apply (everything injectable for tests). */
export function baseContext(over = {}) {
  const files = over.files || createFiles(over.portalDir);
  const config = over.config || files.loadConfig();
  const slug = over.slug || repoSlug(config, over.env || process.env);
  return {
    files,
    config,
    slug,
    approvers: Array.isArray(config.approvers) ? config.approvers : [],
    botLogin: BOT_LOGIN,
    serverUrl: (over.env || process.env).GITHUB_SERVER_URL || 'https://github.com',
    siteUrl: siteUrlOf(config, slug),
    now: () => new Date().toISOString(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (...a) => console.log(...a),
    dryRun: false,
    cache: {},
    ...over,
  };
}

/** Is this module the script being run? (import.meta.url of the caller vs process.argv[1]) */
export function isMain(metaUrl) {
  try {
    return resolve(fileURLToPath(metaUrl)) === resolve(process.argv[1] || '');
  } catch {
    return false;
  }
}
