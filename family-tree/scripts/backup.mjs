#!/usr/bin/env node
// Weekly data backup (docs/SPEC.md §6.7) — run by .github/workflows/family-tree-backup.yml.
// Creates the release "data-YYYY-MM-DD" with family.json, changelog.json and applied.json attached, and keeps only
// the latest 12 data releases (older ones and their tags are deleted). Data releases are never marked "latest",
// so they do not replace the releases of any other project in the repository.
//
//   node scripts/backup.mjs [--dry-run] [--keep 12] [--date 2026-11-27]

import { readFileSync } from 'node:fs';
import { createFiles, parseArgs, baseContext, isMain } from './lib/context.mjs';
import { makeClient, printRecorded, runCli } from './lib/cli.mjs';

export const TAG_RE = /^data-(\d{4}-\d{2}-\d{2})$/;

/** → {tag, created, uploaded: [names], pruned: [tags]} */
export async function runBackup({ gh, files, date, keep = 12, target, log = () => {} }) {
  const tag = `data-${date}`;
  const releases = await gh.listReleases();
  const existing = releases.find((r) => r.tag_name === tag);
  const out = { tag, created: false, uploaded: [], pruned: [] };
  const data = files.loadData();
  const changelog = files.loadChangelog();
  if (!existing) {
    const people = Object.keys(data?.people || {}).length;
    const body = [
      `نسخة احتياطية لبيانات شجرة العائلة بتاريخ ${date} — ${people} فرداً، مراجعة البيانات ${data?.meta?.revision ?? 0}.`,
      '',
      `Family tree data backup of ${date} — ${people} people, data revision ${data?.meta?.revision ?? 0}, ${changelog.entries.length} changelog entries.`,
      '',
      'To restore: replace data/family.json (and the two ledgers) with the attached files and commit.',
    ].join('\n');
    const rel = await gh.createRelease({
      tag_name: tag, target_commitish: target, name: `Family tree data ${date}`, body, draft: false, prerelease: false,
      make_latest: 'false',
    });
    out.created = true;
    for (const [name, file] of [['family.json', files.paths.data], ['changelog.json', files.paths.changelog], ['applied.json', files.paths.applied]]) {
      await gh.uploadReleaseAsset(rel, name, readFileSync(file), 'application/json');
      out.uploaded.push(name);
    }
    log(`created release ${tag}`);
  } else {
    log(`release ${tag} already exists — not replaced`);
  }
  const data2 = (await gh.listReleases()).filter((r) => TAG_RE.test(r.tag_name || ''))
    .sort((a, b) => String(b.tag_name).localeCompare(String(a.tag_name)));
  for (const r of data2.slice(keep)) {
    await gh.deleteRelease(r.id);
    await gh.deleteTag(r.tag_name);
    out.pruned.push(r.tag_name);
  }
  if (out.pruned.length) log(`removed old data releases: ${out.pruned.join(', ')}`);
  return out;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const keepIdx = args.rest.indexOf('--keep');
  const keep = keepIdx >= 0 ? Number(args.rest[keepIdx + 1]) || 12 : 12;
  const dateIdx = args.rest.indexOf('--date');
  const date = dateIdx >= 0 ? args.rest[dateIdx + 1] : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad --date ${date}`);
  const base = baseContext({ env });
  const { gh, offline } = makeClient({ args, event: {}, slug: base.slug, env });
  const res = await runBackup({ gh, files: createFiles(), date, keep, target: env.GITHUB_SHA || undefined, log: console.log });
  console.log(JSON.stringify(res));
  if (offline) printRecorded(gh);
  return 0;
}

if (isMain(import.meta.url)) runCli(main);
