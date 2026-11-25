// Owner commands, fingerprints and safe Markdown of the GitHub automation (docs/SPEC.md §6.2–§6.3).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseCommand, isApprover, commandText, firstLine, labelForCommand } from '../scripts/lib/commands.mjs';
import { fpMatches, fpOf, hashProposal } from '../scripts/lib/hash.mjs';
import { esc, escLine, marker, parseMarker, capBody, fitLines, link, WJ, MAX_COMMENT } from '../scripts/lib/render.mjs';
import { proposal, P } from './scripts-kit.mjs';

describe('commands: parseCommand', () => {
  test('plain commands and aliases', () => {
    assert.equal(parseCommand('/approve').cmd, 'approve');
    assert.equal(parseCommand('/Approve').cmd, 'approve');
    assert.equal(parseCommand('/موافق').cmd, 'approve');
    assert.equal(parseCommand('/موافقة').cmd, 'approve');
    assert.equal(parseCommand('/approve-deletion').cmd, 'approve-deletion');
    assert.equal(parseCommand('/approve deletion a1b2c3').cmd, 'approve-deletion');
    assert.equal(parseCommand('/approve deletion a1b2c3').fp, 'a1b2c3');
    assert.equal(parseCommand('/approve_deletion').cmd, 'approve-deletion');
    assert.equal(parseCommand('/موافق-حذف').cmd, 'approve-deletion');
    assert.equal(parseCommand('/موافق حذف').cmd, 'approve-deletion');
    assert.equal(parseCommand('/reject').cmd, 'reject');
    assert.equal(parseCommand('/رفض').cmd, 'reject');
    assert.equal(parseCommand('/undo').cmd, 'undo');
    assert.equal(parseCommand('/تراجع').cmd, 'undo');
    assert.equal(parseCommand('/correct').cmd, 'correct');
    assert.equal(parseCommand('/تصحيح').cmd, 'correct');
  });

  test('not commands', () => {
    assert.equal(parseCommand(''), null);
    assert.equal(parseCommand('approve'), null);
    assert.equal(parseCommand('Looks good! /approve'), null);
    assert.equal(parseCommand('/shrug'), null);
    assert.equal(parseCommand('/'), null);
    assert.equal(parseCommand(null), null);
  });

  test('first non-empty, non-quoted line only; punctuation, case and invisible marks tolerated', () => {
    assert.equal(parseCommand('\n\n  /APPROVE A1B2C3.  \nthanks').fp, 'a1b2c3');
    assert.equal(parseCommand('> /reject\n/approve').cmd, 'approve');
    assert.equal(parseCommand('> quoted\n\nhello\n/approve'), null);
    assert.equal(parseCommand('‏/موافق!').cmd, 'approve');
    assert.equal(parseCommand('/approve، ').cmd, 'approve');
    assert.equal(firstLine('\n> q\n  x  '), 'x');
  });

  test('fingerprint, skip (1-based → 0-based), ranges, Arabic digits, force', () => {
    const c = parseCommand('/approve a1b2c3 skip 3,5 force');
    assert.deepEqual([c.cmd, c.fp, c.skip, c.skipShown, c.force], ['approve', 'a1b2c3', [2, 4], [3, 5], true]);
    assert.deepEqual(parseCommand('/approve skip 2 and 4 a1b2c3').skipShown, [2, 4]);
    assert.equal(parseCommand('/approve skip 2 and 4 a1b2c3').fp, 'a1b2c3');
    assert.deepEqual(parseCommand('/approve a1b2c3 skip 2-4').skip, [1, 2, 3]);
    assert.deepEqual(parseCommand('/approve a1b2c3 skip=1,2').skip, [0, 1]);
    assert.deepEqual(parseCommand('/موافق a1b2c3 تخطي ٣، ٥').skipShown, [3, 5]);
    assert.deepEqual(parseCommand('/approve a1b2c3 skip 3 , 5').skipShown, [3, 5]);
    assert.equal(parseCommand('/موافق a1b2c3 فرض').force, true);
    assert.equal(parseCommand('/approve fp=ABCDEF12').fp, 'abcdef12');
    assert.equal(parseCommand('/approve 123456').fp, '123456');
    assert.equal(parseCommand('/approve skip 0').skip.length, 0, 'change numbers start at 1');
    assert.equal(parseCommand('/approve please').fp, null);
    assert.deepEqual(parseCommand('/approve please').extra, ['please']);
  });

  test('labels, approvers, command text', () => {
    assert.equal(labelForCommand('approve'), 'approve');
    assert.equal(labelForCommand('approve-deletion'), 'approve-deletion');
    assert.equal(labelForCommand('reject'), null);
    assert.ok(isApprover('GTSgate', ['gtsgate']));
    assert.ok(isApprover('gtsgate', ['@GtsGate ']));
    assert.ok(!isApprover('someone', ['gtsgate']));
    assert.ok(!isApprover('', ['']));
    assert.ok(!isApprover('x', null));
    assert.equal(commandText('approve', 'a1b2c3', { skip: [2, 3], force: true }), '/approve a1b2c3 skip 2,3 force');
    assert.equal(commandText('approve-deletion', 'a1b2c3'), '/approve-deletion a1b2c3');
  });
});

describe('hash: fingerprints', () => {
  test('fp is the first 6 hex chars; matching is case-insensitive and prefix-based (≥ 6)', async () => {
    const p = proposal([P.addChild('pahmed01')]);
    const { hash, fp } = await hashProposal(p);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(fp, hash.slice(0, 6));
    assert.equal(fpOf(hash), fp);
    assert.ok(fpMatches(fp.toUpperCase(), hash));
    assert.ok(fpMatches(hash.slice(0, 10), hash));
    assert.ok(!fpMatches(hash.slice(0, 5), hash));
    assert.ok(!fpMatches('zzzzzz', hash));
    assert.ok(!fpMatches(null, hash));
    // createdAt does not change the hash; the content does
    assert.equal((await hashProposal({ ...p, createdAt: '2030-01-01T00:00:00Z' })).hash, hash);
    assert.notEqual((await hashProposal({ ...p, note: 'x' })).hash, hash);
  });
});

describe('render: safe Markdown', () => {
  test('escapes HTML and Markdown, neutralizes mentions, issue refs and links', () => {
    const out = esc('<script>alert(1)</script> **bold** [x](http://evil) @owner #12 `code` | ~ !');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
    assert.ok(out.includes('\\*\\*bold\\*\\*'));
    assert.ok(out.includes('\\[x\\]'));
    assert.ok(out.includes(`@${WJ}owner`));
    assert.ok(out.includes(`#${WJ}12`));
    assert.ok(out.includes(`:${WJ}//evil`));
    assert.ok(out.includes('\\`code\\`'));
    assert.ok(!/[‮]/.test(esc('a‮b')), 'bidi overrides are stripped');
    assert.equal(escLine('a\n\nb   c'), 'a b c');
    assert.equal(escLine('x'.repeat(50), 10).length, 10);
  });

  test('markers round-trip and only accept simple tokens', () => {
    const m = marker('check', { hash: 'abc123', rev: 7, edits: 0, src: 'c42', evil: 'a -->b<' });
    assert.ok(m.startsWith('<!-- gft-bot:check '));
    assert.ok(!m.slice(4, -4).includes('-->'));
    const parsed = parseMarker(`text\n${m}\nmore`, 'check');
    assert.equal(parsed.hash, 'abc123');
    assert.equal(parsed.rev, '7');
    assert.equal(parsed.edits, '0');
    assert.equal(parsed.src, 'c42');
    assert.equal(parseMarker('no marker', 'check'), null);
    assert.equal(parseMarker(m, 'approval'), null);
  });

  test('length limits', () => {
    assert.equal(capBody('x'.repeat(MAX_COMMENT + 100)).length, MAX_COMMENT);
    const { shown, more } = fitLines(['aaaa', 'bbbb', 'cccc'], 10);
    assert.deepEqual([shown, more], [['aaaa', 'bbbb'], 1]);
    assert.equal(link('a', 'https://x.y/a b(c)'), '[a](https://x.y/a%20b%28c%29)');
  });
});
