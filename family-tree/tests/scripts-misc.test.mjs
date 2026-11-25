// Backup releases (§6.7), data validation (§6.4) and static checks of the workflow / issue-form files (§6.2–§6.4).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBackup, TAG_RE } from '../scripts/backup.mjs';
import { validateAll } from '../scripts/validate-data.mjs';
import { createFakeGitHub } from '../scripts/lib/fake-github.mjs';
import { PORTAL_DIR, siteUrlOf, repoSlug, eventNameOf, parseArgs, defaultBranchOf } from '../scripts/lib/context.mjs';
import { LABELS, LABEL_DEFS } from '../scripts/lib/labels.mjs';
import { makePortal } from './scripts-kit.mjs';

const portal = makePortal();
after(() => portal.cleanup());

describe('backup: weekly data releases', () => {
  test('creates data-YYYY-MM-DD with the three files, never "latest", and keeps the newest 12', async () => {
    const old = Array.from({ length: 13 }, (_, i) => ({ id: 100 + i, tag_name: `data-2026-01-${String(i + 1).padStart(2, '0')}` }));
    const gh = createFakeGitHub({ releases: [...old, { id: 999, tag_name: 'v1.0.0' }] });
    const res = await runBackup({ gh, files: portal.files, date: '2026-11-27', keep: 12, target: 'abc' });
    assert.equal(res.tag, 'data-2026-11-27');
    assert.equal(res.created, true);
    assert.deepEqual(res.uploaded, ['family.json', 'changelog.json', 'applied.json']);
    const created = gh.calls.find((c) => c.method === 'createRelease').args[0];
    assert.equal(created.make_latest, 'false');
    assert.equal(created.target_commitish, 'abc');
    assert.match(created.body, /نسخة احتياطية/);
    assert.deepEqual(res.pruned, ['data-2026-01-02', 'data-2026-01-01']);
    assert.ok(gh.state.releases.some((r) => r.tag_name === 'v1.0.0'), 'other releases are untouched');
    assert.equal(gh.state.releases.filter((r) => TAG_RE.test(r.tag_name)).length, 12);
    // same day again: nothing new
    const again = await runBackup({ gh, files: portal.files, date: '2026-11-27', keep: 12 });
    assert.equal(again.created, false);
  });
});

describe('validate-data', () => {
  test('the real portal data validates', () => {
    const res = validateAll();
    assert.equal(res.ok, true, res.errors.join('\n'));
    assert.ok(res.stats.people > 0);
  });

  test('broken data and ledgers are reported', () => {
    const p = makePortal();
    try {
      const f = join(p.portalDir, 'data', 'family.json');
      const data = JSON.parse(readFileSync(f, 'utf8'));
      data.unions.uroot001.children.push('pmissing');
      writeFileSync(f, JSON.stringify(data));
      writeFileSync(join(p.portalDir, 'data', 'changelog.json'), '[]');
      writeFileSync(join(p.portalDir, 'data', 'applied.json'), '{"nothex": {}}');
      const res = validateAll({ portalDir: p.portalDir });
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.startsWith('family.json: [')));
      assert.ok(res.errors.some((e) => e.startsWith('changelog.json')));
      assert.ok(res.errors.some((e) => e.startsWith('applied.json')));
      writeFileSync(f, '{ not json');
      assert.ok(validateAll({ portalDir: p.portalDir }).errors.some((e) => /not valid JSON/.test(e)));
    } finally {
      p.cleanup();
    }
  });
});

describe('context: portability', () => {
  test('repository from GITHUB_REPOSITORY first, then config; site URL; event names; branch', async () => {
    const cfg = { repo: { owner: 'a', name: 'b' }, portalPath: 'family-tree' };
    assert.deepEqual(repoSlug(cfg, { GITHUB_REPOSITORY: 'fam/family-tree' }), { owner: 'fam', name: 'family-tree' });
    assert.deepEqual(repoSlug(cfg, {}), { owner: 'a', name: 'b' });
    assert.equal(siteUrlOf({ ...cfg, siteUrl: 'https://x.y/z' }), 'https://x.y/z/');
    assert.equal(siteUrlOf({ portalPath: '' }, { owner: 'fam', name: 'family-tree' }), 'https://fam.github.io/family-tree/');
    assert.equal(eventNameOf(parseArgs([]), { comment: {}, issue: {} }, {}), 'issue_comment');
    assert.equal(eventNameOf(parseArgs([]), {}, { GITHUB_EVENT_NAME: 'schedule' }), 'schedule');
    assert.equal(await defaultBranchOf({ event: { repository: { default_branch: 'trunk' } }, env: {} }), 'trunk');
    assert.equal(await defaultBranchOf({ config: cfg, env: {} }), 'main');
    assert.ok(existsSync(join(PORTAL_DIR, 'data', 'family.json')), 'PORTAL_DIR is resolved from the scripts location');
  });

  test('no script hard-codes the "family-tree/" folder', () => {
    const scriptsDir = join(PORTAL_DIR, 'scripts');
    const files = [
      ...readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs') && f !== 'import-initial.mjs').map((f) => join(scriptsDir, f)),
      ...readdirSync(join(scriptsDir, 'lib')).filter((f) => f.endsWith('.mjs')).map((f) => join(scriptsDir, 'lib', f)),
    ];
    for (const f of files) {
      const code = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      assert.ok(!/['"`/]family-tree\//.test(code), `${f} mentions family-tree/`);
    }
  });
});

// The .github folder sits beside the portal folder (or inside it once the portal is its own repository).
const here = dirname(fileURLToPath(import.meta.url));
const ghDir = [join(here, '..', '..', '.github'), join(here, '..', '.github')].find((d) => existsSync(join(d, 'workflows', 'family-tree-apply.yml')));

describe('workflows and issue form', { skip: !ghDir && 'no .github folder found' }, () => {
  const read = (rel) => readFileSync(join(ghDir, rel), 'utf8');
  const WORKFLOWS = ['family-tree-check.yml', 'family-tree-apply.yml', 'family-tree-ci.yml', 'family-tree-backup.yml'];

  test('actions are pinned by commit SHA, Node 22, minimal permissions, PORTAL_DIR defined once', () => {
    for (const w of WORKFLOWS) {
      const text = read(`workflows/${w}`);
      for (const m of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) assert.match(m[1], /@[0-9a-f]{40}$/, `${w}: ${m[1]}`);
      assert.ok(text.includes('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'), w);
      assert.ok(text.includes('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0'), w);
      assert.match(text, /node-version: 22/, w);
      assert.match(text, /^permissions:/m, w);
      assert.ok(!/write-all|read-all/.test(text), w);
      assert.equal((text.match(/^\s+PORTAL_DIR:/gm) || []).length, 1, `${w}: PORTAL_DIR once`);
      assert.match(text, /working-directory: \$\{\{ env\.PORTAL_DIR \}\}/, w);
    }
    assert.match(read('workflows/family-tree-check.yml'), /persist-credentials: false/);
    assert.match(read('workflows/family-tree-check.yml'), /contents: read\n\s+issues: write/);
    assert.match(read('workflows/family-tree-apply.yml'), /contents: write\n\s+issues: write\n\s+pages: write/);
  });

  test('no outsider-controlled ${{ github.event.* }} inside run: blocks', () => {
    for (const w of WORKFLOWS) {
      const lines = read(`workflows/${w}`).split('\n');
      let inRun = false;
      let runIndent = 0;
      for (const line of lines) {
        const indent = line.search(/\S/);
        if (/^\s*-?\s*run:\s*\S/.test(line)) { // a step's command (not `defaults: run:`)
          inRun = true;
          runIndent = indent;
          assert.ok(!/\$\{\{/.test(line), `${w}: ${line}`);
          continue;
        }
        if (inRun && line.trim() && indent <= runIndent) inRun = false;
        if (inRun) assert.ok(!/\$\{\{/.test(line), `${w}: expression inside run: ${line}`);
      }
    }
  });

  test('apply: triggers, job-level if and job-level concurrency', () => {
    const t = read('workflows/family-tree-apply.yml');
    assert.match(t, /issues:\n\s+types: \[labeled, opened\]/);
    assert.match(t, /issue_comment:\n\s+types: \[created\]/);
    assert.match(t, /cron: "23 \*\/6 \* \* \*"/);
    assert.match(t, /workflow_dispatch:/);
    assert.match(t, /\n {4}if: >-/);
    assert.match(t, /github\.event\.issue\.pull_request == null/);
    // quote-replies ("> …\n/approve") must reach the script, which reads the first non-quoted line itself
    assert.match(t, /contains\(github\.event\.comment\.body, '\/'\)/);
    assert.ok(!/startsWith\(github\.event\.comment\.body/.test(t));
    assert.match(t, /\n {4}concurrency:\n {6}group: family-tree-data\n {6}cancel-in-progress: false/);
    assert.ok(!/^concurrency:/m.test(t), 'concurrency is on the job, not the workflow');
    assert.match(read('workflows/family-tree-backup.yml'), /cron: "41 2 \* \* 5"/);
    assert.match(read('workflows/family-tree-check.yml'), /types: \[opened, edited, reopened\]/);
  });

  test('issue form: ids code (required textarea), submitter (input), note (textarea); label family-tree', () => {
    const t = read('ISSUE_TEMPLATE/family-tree-proposal.yml');
    assert.match(t, /^labels: \[family-tree\]$/m);
    assert.match(t, /- type: textarea\n\s+id: code\n[\s\S]*?required: true/);
    assert.match(t, /- type: input\n\s+id: submitter/);
    assert.match(t, /- type: textarea\n\s+id: note/);
    assert.match(read('ISSUE_TEMPLATE/config.yml'), /^blank_issues_enabled: true$/m);
    for (const name of Object.values(LABELS)) assert.ok(LABEL_DEFS.some((d) => d.name === name), name);
    for (const d of LABEL_DEFS) assert.ok(d.description.length <= 100, d.name);
  });
});
