// Shared helpers for the tests of the GitHub automation (tests/scripts-*.test.mjs). Not a test file itself.
//
//   makePortal({layout})  a temporary git repository (bare "origin" + working clone) holding a small family:
//                         layout "root" (portal at the repository root) or "sub" (portal in family-tree/)
//   makeCtx(portal, gh)   a script context wired to the portal, a fake GitHub, no-op sleep and a fixed clock
//   P.*                   proposal builders · codeBody(proposal) → issue-form body with the change code

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeData, serializeData } from '../js/core/schema.js';
import { encodeProposal } from '../js/core/codec.js';
import { createGit } from '../scripts/lib/repo.mjs';
import { createFiles, baseContext } from '../scripts/lib/context.mjs';
import { createFakeGitHub } from '../scripts/lib/fake-github.mjs';

export const OWNER = 'keeper';
export const CONFIG = {
  repo: { owner: 'fam', name: 'tree', branch: 'main' },
  portalPath: '',
  siteUrl: 'https://fam.github.io/tree/',
  approvers: ['Keeper'],
  owner: { personId: '', name: { ar: 'مشرف الشجرة', en: 'the tree keeper' }, whatsapp: '', email: '' },
};

export function tinyData() {
  return normalizeData({
    schema: 1,
    meta: { title: { ar: 'شجرة', en: 'Tree' }, rootPersonId: 'pgrand01', revision: 5, updatedAt: '2026-01-01T00:00:00Z' },
    people: {
      pgrand01: { id: 'pgrand01', name: { ar: 'سالم' }, surname: { ar: 'عالم' }, gender: 'm', deceased: true },
      pgrandm1: { id: 'pgrandm1', name: { ar: 'فاطمة' }, gender: 'f', deceased: true },
      pahmed01: { id: 'pahmed01', name: { ar: 'أحمد' }, gender: 'm', birth: { date: '1950' } },
      pmona001: { id: 'pmona001', name: { ar: 'منى' }, gender: 'f', birth: { date: '1955' } },
      pwife001: { id: 'pwife001', name: { ar: 'هند' }, gender: 'f' },
      pkid0001: { id: 'pkid0001', name: { ar: 'خالد' }, gender: 'm', birth: { date: '1980' } },
    },
    unions: {
      uroot001: { id: 'uroot001', partners: ['pgrand01', 'pgrandm1'], children: ['pahmed01', 'pmona001'], status: 'married' },
      uahmed01: { id: 'uahmed01', partners: ['pahmed01', 'pwife001'], children: ['pkid0001'], status: 'married' },
    },
  });
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1', HOME: tmpdir(),
};

export function sh(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writePortalFiles(dir, data) {
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(dir, 'data', 'family.json'), serializeData(data));
  writeFileSync(join(dir, 'data', 'changelog.json'), '{\n  "entries": []\n}\n');
  writeFileSync(join(dir, 'data', 'applied.json'), '{}\n');
}

/** A temporary repository with a pushed initial commit. */
export function makePortal({ layout = 'root', data = tinyData() } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'gft-repo-'));
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  sh(base, 'init', '--quiet', '--bare', '-b', 'main', origin);
  sh(base, 'init', '--quiet', '-b', 'main', work);
  const portalDir = layout === 'sub' ? join(work, 'family-tree') : work;
  mkdirSync(portalDir, { recursive: true });
  writePortalFiles(portalDir, data);
  writeFileSync(join(work, 'README.md'), 'other project\n');
  sh(work, 'add', '-A');
  sh(work, 'commit', '--quiet', '-m', 'initial');
  sh(work, 'remote', 'add', 'origin', origin);
  sh(work, 'push', '--quiet', '-u', 'origin', 'main');
  return {
    base, origin, work, portalDir, layout,
    git: createGit({ cwd: portalDir, env: GIT_ENV }),
    files: createFiles(portalDir),
    /** A second clone (a concurrent writer). */
    clone(name = 'other') {
      const dir = join(base, name);
      sh(base, 'clone', '--quiet', origin, dir);
      return { dir, portalDir: layout === 'sub' ? join(dir, 'family-tree') : dir };
    },
    originLog: () => sh(base, '--git-dir', origin, 'log', '--format=%H %s', 'main').trim().split('\n'),
    originShow: (path) => sh(base, '--git-dir', origin, 'show', `main:${layout === 'sub' ? `family-tree/${path}` : path}`),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

let clock = Date.parse('2026-11-25T10:00:00Z');

export function makeCtx(portal, gh, over = {}) {
  return baseContext({
    files: portal.files,
    config: CONFIG,
    env: {},
    gh,
    git: portal.git,
    branch: 'main',
    now: () => new Date((clock += 60000)).toISOString(),
    sleep: async () => {},
    log: () => {},
    backoff: () => 0,
    pagesWait: { timeoutMs: 30, intervalMs: 10 },
    ...over,
  });
}

export const fakeGitHub = (seed) => createFakeGitHub(seed);

let seq = 0;
export function proposal(ops, extra = {}) {
  seq += 1;
  return {
    kind: 'gft-proposal', v: 1, id: `t${String(seq).padStart(9, '0')}`, createdAt: '2026-11-25T08:00:00Z', baseRevision: 5,
    dependsOn: [], submitter: { name: 'سارة', relation: 'حفيدة', personId: '' }, note: '', ops, ...extra,
  };
}

export const P = {
  addChild: (of, name = 'يوسف', ref = 'new1', extra = {}) => ({ op: 'add-person', ref, person: { name: { ar: name }, gender: 'm' }, link: { as: 'child', of }, unionRef: `newu${ref.slice(3)}`, ...extra }),
  edit: (id, set, before) => ({ op: 'edit-person', id, set, ...(before ? { before } : {}) }),
  remove: (id) => ({ op: 'remove-person', id, reasonCode: 'entered-by-mistake' }),
  mark: (id, mark) => ({ op: 'mark', id, mark }),
};

/** Issue-form body holding the proposal's change code. */
export async function codeBody(p, { submitter = 'سارة — حفيدة', note = '' } = {}) {
  const code = await encodeProposal(p);
  return `### رمز التعديلات — لا تغيير فيه · Change code — do not edit\n\n\`\`\`text\n${code}\n\`\`\`\n\n`
    + `### اسمك وصلة القرابة (اختياري) · Your name and relation (optional)\n\n${submitter || '_No response_'}\n\n`
    + `### ملاحظة للمشرف (اختيارية) · Note for the tree keeper (optional)\n\n${note || '_No response_'}`;
}

/** Open an issue in the fake as a relative would (issue form → family-tree label). */
export async function openProposal(gh, p, { login = 'relative', labels = ['family-tree'], number } = {}) {
  return gh.userOpen({ number, title: '🌳 proposal', body: await codeBody(p), login, labels });
}

export const issueEvent = (gh, n, action = 'opened') => ({ action, issue: { number: n, pull_request: undefined }, repository: { default_branch: 'main' } });
export const commentEvent = (n, comment) => ({ action: 'created', issue: { number: n }, comment: { id: comment.id }, repository: { default_branch: 'main' } });
