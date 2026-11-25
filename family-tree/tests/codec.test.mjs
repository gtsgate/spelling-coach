// Tests for js/core/codec.js — proposal codes: round trips (Arabic), tolerant extraction from messages, checksum /
// truncation detection, the 1 MB inflate cap and every error code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

import {
  CODEC_ERROR_CODES, CODE_RE, base64urlDecode, base64urlEncode, crc32, decodeProposal, encodeProposal, extractProposal, findCodes,
} from '../js/core/codec.js';
import { LIMITS } from '../js/core/schema.js';

const SEEN = new Set();

function sample(extra = {}) {
  return {
    kind: 'gft-proposal', v: 1, id: 'k3j9x0a2mq', createdAt: '2026-11-25T12:00:00Z', baseRevision: 12, dependsOn: [],
    submitter: { name: 'سارة محمد', relation: 'حفيدة سالم', personId: 'pg8caja6' },
    note: 'أرجو إضافة عائلتي — شكراً جزيلاً 🌳',
    ops: [
      { op: 'add-person', ref: 'new1', person: { name: { ar: 'عبد الرحمن', en: 'Abdulrahman' }, gender: 'm', birth: { hijri: '1410-10-17' } }, link: { as: 'child', of: 'p6pzol0u' }, unionRef: 'newu2' },
      { op: 'add-person', ref: 'new3', person: { name: { ar: 'نُور' }, nickname: { ar: 'أم خالد' }, gender: 'f' }, link: { as: 'spouse', of: 'new1' }, unionRef: 'newu4' },
      { op: 'edit-person', id: 'pqhtdyl7', set: { 'bio.ar': 'كان تاجراً في مكة المكرمة\nوله أخبار كثيرة "مشهورة"' } },
    ],
    ...extra,
  };
}

/** Assert that `promise` rejects with an Error whose .code is `code`. */
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof Error, 'an Error');
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    SEEN.add(e.code);
    return true;
  });
}

/** A code with a correct checksum around arbitrary payload bytes. */
function forge(version, bytes) {
  const payload = base64urlEncode(bytes);
  return `GFT${version}:${payload}.${crc32(payload).toString(36)}`;
}

// ---------------------------------------------------------------------------------------------------------

test('crc32 and base64url primitives', () => {
  assert.equal(crc32('123456789'), 0xCBF43926);
  assert.equal(crc32(''), 0);
  assert.equal(crc32(new Uint8Array([0x31, 0x32, 0x33])), crc32('123'));
  const bytes = new Uint8Array(70000).map((_, i) => (i * 37) & 0xFF);
  const text = base64urlEncode(bytes);
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(base64urlDecode(text), bytes);
  assert.deepEqual(base64urlDecode(base64urlEncode(new Uint8Array([0xFB, 0xFF]))), new Uint8Array([0xFB, 0xFF]));
  assert.throws(() => base64urlDecode('abcde'));
});

test('round trip with Arabic: GFT1 (deflate-raw) and GFT0', async () => {
  const p = sample();
  const code = await encodeProposal(p);
  assert.match(code, /^GFT1:[A-Za-z0-9_-]+\.[0-9a-z]{1,7}$/);
  assert.deepEqual(code.match(CODE_RE), [code]);
  assert.deepEqual(await decodeProposal(code), p);
  const plain = await encodeProposal(p, { compress: false });
  assert.match(plain, /^GFT0:/);
  assert.deepEqual(await decodeProposal(plain), p);
  assert.ok(code.length < plain.length, 'compression helps');
  // the checksum covers the payload text
  const [payload, crc] = code.slice(5).split('.');
  assert.equal(crc, crc32(payload).toString(36));
  // deterministic for the same proposal
  assert.equal(await encodeProposal(p), code);
});

test('a full 150-op family proposal fits the code limit', async () => {
  const ops = Array.from({ length: LIMITS.ops }, (_, k) => ({
    op: 'add-person', ref: `new${k + 1}`,
    person: { name: { ar: ['محمد', 'فاطمة', 'عبد الله', 'خديجة', 'نور الدين'][k % 5] }, surname: { ar: 'العالم' }, gender: k % 2 ? 'f' : 'm', birth: { date: String(1950 + (k % 60)) } },
    link: { as: 'child', of: k < 5 ? 'p6pzol0u' : `new${k - 4}`, with: null }, unionRef: `newu${1000 + k}`,
  }));
  const code = await encodeProposal(sample({ ops }));
  assert.ok(code.length < LIMITS.code, `code is ${code.length} chars`);
  assert.equal((await decodeProposal(code)).ops.length, LIMITS.ops);
});

test('tolerant extraction: WhatsApp message, wrapped lines, backticks, invisible marks, glued text', async () => {
  const p = sample();
  const code = await encodeProposal(p);
  const wrapped = code.match(/.{1,40}/g).join('\n');
  const whatsapp = [
    'السلام عليكم يا أبا خالد،',
    'أنا سارة (حفيدة سالم). أرسلت لك تعديلات على شجرة العائلة:',
    '• إضافة «عبد الرحمن» ابناً لـ محمد حسن',
    'رقم الاقتراح: k3j9x0a2mq',
    '',
    'رمز التعديلات — لا تغيّره / Change code — do not edit',
    '```',
    wrapped,
    '```',
    'شكراً 🌹',
  ].join('\n');
  assert.deepEqual(await decodeProposal(whatsapp), p);
  // spaces, a right-to-left mark and backticks inside the code; the checksum glued to the next word
  const messy = `‏${code.slice(0, 25)} \`${code.slice(25, 60)}​\n  ${code.slice(60)}thanks a lot`;
  assert.deepEqual(await decodeProposal(messy), p);
  // GitHub issue-form body
  const issueBody = `### Submitter\n\nسارة\n\n### Change code\n\n\`\`\`text\n${code}\n\`\`\`\n\n### Note\n\n_No response_`;
  const found = await extractProposal(issueBody);
  assert.deepEqual(found, { proposal: p, code });
  assert.deepEqual(findCodes(`a ${code} b`), [code]);
});

test('the canonical code is returned even when the checksum absorbed trailing letters or was cut short', async () => {
  const p = sample();
  const code = await encodeProposal(p);
  const glued = await extractProposal(`${code}\nabc`);
  assert.equal(glued.code, code);
  // a code whose checksum was cut short at the end of a message still decodes (payload verified by decoding)
  const short = code.slice(0, code.indexOf('.') + 2);
  assert.deepEqual((await extractProposal(short)).proposal, p);
  // no checksum at all (hand-made / old code): accepted when it decodes
  const bare = code.slice(0, code.indexOf('.'));
  assert.deepEqual((await extractProposal(bare)).code, code);
});

test('ignoreQuoted skips codes on quoted lines; the first valid code wins', async () => {
  const a = sample();
  const b = sample({ id: 'bbbbbbbbbb' });
  const codeA = await encodeProposal(a);
  const codeB = await encodeProposal(b);
  const comment = `> earlier message:\n> ${codeA}\n\n/approve`;
  assert.deepEqual(await decodeProposal(comment), a);
  await rejectsWith(decodeProposal(comment, { ignoreQuoted: true }), 'NO_PROPOSAL');
  assert.equal(await extractProposal(comment, { ignoreQuoted: true }), null);
  const correction = `> ${codeA}\n\nCorrected:\n${codeB}`;
  assert.deepEqual(await decodeProposal(correction, { ignoreQuoted: true }), b);
  // a damaged first code does not hide a valid second one
  const damaged = codeA.slice(0, 30) + (codeA[30] === 'A' ? 'B' : 'A') + codeA.slice(31);
  assert.deepEqual(await decodeProposal(`${damaged}\n\n${codeB}`), b);
});

test('raw JSON, ```json fences and embedded JSON', async () => {
  const p = sample();
  const json = JSON.stringify(p, null, 2);
  assert.deepEqual(await decodeProposal(json), p);
  assert.deepEqual(await decodeProposal(`Here it is:\n\`\`\`json\n${json}\n\`\`\`\nbye`), p);
  assert.deepEqual(await decodeProposal(`proposal: ${JSON.stringify(p)} -- end`), p);
  assert.deepEqual(await extractProposal(json), { proposal: p, code: null });
  // JSON that is not a proposal is ignored
  await rejectsWith(decodeProposal('{"kind":"something-else","v":1}'), 'NO_PROPOSAL');
  // broken proposal JSON
  await rejectsWith(decodeProposal('```json\n{"kind":"gft-proposal", "ops": [\n```'), 'BAD_JSON');
});

test('truncation and corruption are detected', async () => {
  const p = sample();
  const code = await encodeProposal(p);
  const dot = code.indexOf('.');
  // cut inside the payload (the checksum is gone with it)
  await rejectsWith(decodeProposal(code.slice(0, Math.floor(dot / 2))), 'TRUNCATED_CODE');
  // payload shortened but checksum kept (a line lost in the middle)
  await rejectsWith(decodeProposal(code.slice(0, 40) + code.slice(80)), 'TRUNCATED_CODE');
  // one character changed
  const i = 50;
  await rejectsWith(decodeProposal(code.slice(0, i) + (code[i] === 'x' ? 'y' : 'x') + code.slice(i + 1)), 'TRUNCATED_CODE');
  // GFT0 cut short
  const plain = await encodeProposal(p, { compress: false });
  await rejectsWith(decodeProposal(plain.slice(0, plain.indexOf('.') - 10)), 'TRUNCATED_CODE');
  // extractProposal reports damage instead of "nothing found"
  await rejectsWith(extractProposal(`please apply ${code.slice(0, 60)}`), 'TRUNCATED_CODE');
});

test('BAD_CODE and BAD_JSON with a correct checksum', async () => {
  // not deflate data
  await rejectsWith(decodeProposal(forge(1, new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x01]))), 'BAD_CODE');
  // valid JSON that is not a proposal
  await rejectsWith(decodeProposal(forge(0, new TextEncoder().encode('{"kind":"other"}'))), 'BAD_CODE');
  await rejectsWith(decodeProposal(forge(1, deflateRawSync(Buffer.from('[1,2,3]')))), 'BAD_CODE');
  // invalid UTF-8
  await rejectsWith(decodeProposal(forge(0, new Uint8Array([0x7B, 0xC3, 0x28, 0x7D]))), 'BAD_CODE');
  // not JSON
  await rejectsWith(decodeProposal(forge(0, new TextEncoder().encode('مرحبا، هذا ليس JSON'))), 'BAD_JSON');
  await rejectsWith(decodeProposal(forge(1, deflateRawSync(Buffer.from('{"kind":"gft-proposal",')))), 'BAD_JSON');
});

test('TOO_LARGE: decompression bomb, oversized proposal, oversized code', async () => {
  // 20 MB of zeros compresses to ~20 KB: the inflater must stop at 1 MB
  const bomb = forge(1, deflateRawSync(Buffer.alloc(20 * 1024 * 1024)));
  assert.ok(bomb.length < LIMITS.code);
  const t0 = performance.now();
  await rejectsWith(decodeProposal(bomb), 'TOO_LARGE');
  assert.ok(performance.now() - t0 < 2000);
  // a genuine proposal over 1 MB once decoded
  const big = await encodeProposal(sample({ note: 'ا'.repeat(600 * 1024) }));
  assert.ok(big.length < LIMITS.code);
  await rejectsWith(decodeProposal(big), 'TOO_LARGE');
  // GFT0 payload over 1 MB is refused by its length already
  await rejectsWith(decodeProposal(forge(0, new Uint8Array(LIMITS.code))), 'TOO_LARGE');
  // a code over the 60,000-character limit
  await rejectsWith(decodeProposal(`GFT1:${'A'.repeat(LIMITS.code + 10)}`), 'TOO_LARGE');
  // raw JSON over 1 MB
  await rejectsWith(decodeProposal(JSON.stringify(sample({ note: 'x'.repeat(LIMITS.decodedBytes) }))), 'TOO_LARGE');
});

test('NO_PROPOSAL', async () => {
  for (const input of ['', '   ', 'hello there', 'GFT2:abc', '{"a":1}', null, undefined, 42]) {
    await rejectsWith(decodeProposal(input), 'NO_PROPOSAL');
    assert.equal(await extractProposal(input), null);
  }
});

test('core sources stay browser-safe (no node: imports, DOM, fetch or storage)', () => {
  for (const file of ['../js/core/codec.js', '../js/core/ops.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /from\s+['"]node:|require\(/, file);
    assert.doesNotMatch(src, /\b(document|window|localStorage|sessionStorage|fetch|XMLHttpRequest)\b/, file);
    assert.doesNotMatch(src, /^export default/m, `${file}: named exports only`);
  }
});

test('coverage: every codec error code is exercised', () => {
  assert.deepEqual(CODEC_ERROR_CODES.filter((c) => !SEEN.has(c)), []);
});
