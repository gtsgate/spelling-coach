// Independent black-box acceptance tests for js/core/codec.js.
//
// Derived ONLY from docs/SPEC.md §4 (codec.js) and §5 (the WhatsApp message format); written without reading
// codec.js. Node's zlib is used to inspect codes and to hand-craft corrupt ones (tests may use node: imports).
//
// The spec says "crc32(payload)" without naming the bytes; the first test accepts the crc32 of the base64url text,
// of the deflated bytes or of the JSON, and the hand-crafted codes below use whichever convention encodeProposal
// actually follows (detected once), so only the documented behaviour is pinned.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import * as CODEC from '../js/core/codec.js';

const SAMPLE = Object.freeze({
  kind: 'gft-proposal',
  v: 1,
  id: 'k3j9x0a2mq',
  createdAt: '2026-11-25T12:00:00.000Z',
  baseRevision: 7,
  dependsOn: [],
  submitter: { name: 'أم خالد', relation: 'زوجة الابن', personId: '' },
  note: 'السلام عليكم — أرجو إضافة أبنائنا 🌳 «شكراً جزيلاً» ‏١٢٣ ۴۵۶',
  ops: [
    {
      op: 'add-person', ref: 'new1',
      person: { name: { ar: 'عبد الرَّحْمَن' }, gender: 'm', birth: { hijri: '1410' } },
      link: { as: 'child', of: 'pdad', with: 'pmom' }, unionRef: 'newu2',
    },
    { op: 'edit-person', id: 'pson', set: { 'occupation.ar': 'مهندس' }, before: { 'occupation.ar': '' } },
  ],
});

const CODE_RE = /^GFT1:([A-Za-z0-9_-]+)\.([0-9a-z]{1,7})$/;

// --- crc32 (IEEE) -------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- helpers -------------------------------------------------------------------------------------------------
const encode = (p) => CODEC.encodeProposal(p);
const decode = (text, opts) => CODEC.decodeProposal(text, opts);

/** Awaits fn(); it must throw/reject an Error whose .code is `expected` (a code or a list of acceptable codes). */
async function rejectsCode(fn, expected) {
  let err = null;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  const list = Array.isArray(expected) ? expected : [expected];
  assert.ok(err, `expected an Error with code ${list.join('|')}, but it succeeded`);
  assert.ok(err instanceof Error, 'must throw an Error object');
  assert.ok(list.includes(err.code), `expected code ${list.join('|')}, got ${err.code} (${err.message})`);
}

/** Which bytes encodeProposal's checksum covers: 'b64' (payload text) | 'deflated' | 'json'. */
let conventionPromise = null;
function crcConvention() {
  conventionPromise ??= (async () => {
    const m = CODE_RE.exec(await encode(SAMPLE));
    if (!m) return 'b64';
    const value = parseInt(m[2], 36);
    const deflated = Buffer.from(m[1], 'base64url');
    let json = Buffer.alloc(0);
    try { json = inflateRawSync(deflated); } catch { /* reported by the format test */ }
    if (crc32(Buffer.from(m[1], 'ascii')) === value) return 'b64';
    if (crc32(deflated) === value) return 'deflated';
    if (crc32(json) === value) return 'json';
    return 'b64';
  })();
  return conventionPromise;
}

/** Hand-made code "<prefix>:<base64url(payloadBytes)>.<crc>" with the implementation's checksum convention. */
async function makeCode(prefix, payloadBytes, jsonBytes) {
  const payload = Buffer.from(payloadBytes).toString('base64url');
  const conv = await crcConvention();
  const source = conv === 'b64' ? Buffer.from(payload, 'ascii') : conv === 'deflated' ? payloadBytes : jsonBytes;
  return `${prefix}:${payload}.${crc32(source).toString(36)}`;
}
const gft1 = (jsonText) => {
  const json = Buffer.from(jsonText, 'utf8');
  return makeCode('GFT1', deflateRawSync(json), json);
};
const gft0 = (jsonText) => {
  const json = Buffer.from(jsonText, 'utf8');
  return makeCode('GFT0', json, json);
};

/** The WhatsApp text of §5: greeting, submitter, describe lines, id, blank line, label, fenced code. */
const whatsapp = (code, tail = 'جزاكم الله خيراً') => [
  'السلام عليكم، معكم أم خالد (زوجة الابن)',
  '1. إضافة «عبد الرحمن» ابناً لـ حسن',
  '2. تعديل معلومات محمد: المهنة: «مهندس»',
  'رقم الاقتراح: k3j9x0a2mq',
  '',
  'رمز التعديلات — لا تغيّره / Change code — do not edit',
  '```',
  code,
  '```',
  tail,
].join('\n');

// =========================================================================================================

describe('§4 codec: encodeProposal', () => {
  test('§4 encodeProposal → "GFT1:" + base64url(deflate-raw(UTF-8 JSON)) + "." + crc32 in base36', async () => {
    const code = await encode(SAMPLE);
    assert.equal(typeof code, 'string');
    const m = CODE_RE.exec(code);
    assert.ok(m, `unexpected code shape: ${String(code).slice(0, 80)}`);
    const jsonBytes = inflateRawSync(Buffer.from(m[1], 'base64url'));
    assert.deepEqual(JSON.parse(jsonBytes.toString('utf8')), SAMPLE, 'payload is deflate-raw of the UTF-8 JSON');
    const value = parseInt(m[2], 36);
    const candidates = [Buffer.from(m[1], 'ascii'), Buffer.from(m[1], 'base64url'), jsonBytes].map(crc32);
    assert.ok(candidates.includes(value), 'checksum is the crc32 of the payload');
  });

  test('§4/§8 round trip keeps every character (Arabic, tashkeel, Arabic-Indic digits, emoji, RTL mark)', async () => {
    const decoded = await decode(await encode(SAMPLE));
    assert.deepEqual(decoded, SAMPLE);
    assert.equal(decoded.ops[0].person.name.ar, 'عبد الرَّحْمَن');
    assert.equal(decoded.note, SAMPLE.note);
  });

  test('§4 round trip of a full 150-op proposal; the code is compressed (shorter than the JSON)', async () => {
    const names = ['أحمد', 'فاطمة', 'عبد الله', 'نور الدين', 'خديجة'];
    const big = {
      ...SAMPLE,
      ops: Array.from({ length: 150 }, (_, i) => ({
        op: 'add-person', ref: `new${i + 1}`, person: { name: { ar: names[i % 5] }, gender: i % 2 ? 'f' : 'm' },
        link: { as: 'child', of: 'pdad', with: 'pmom' }, unionRef: `newu${i + 200}`,
      })),
    };
    const code = await encode(big);
    assert.match(code, CODE_RE);
    assert.ok(code.length < JSON.stringify(big).length);
    assert.deepEqual(await decode(code), big);
  });

  test('§4 without CompressionStream the code is "GFT0:" + base64url(JSON) and still decodes', async () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream');
    let code;
    try {
      delete globalThis.CompressionStream;
      code = await encode(SAMPLE);
    } finally {
      if (desc) Object.defineProperty(globalThis, 'CompressionStream', desc);
    }
    const m = /^GFT0:([A-Za-z0-9_-]+)(?:\.[0-9a-z]{1,7})?$/.exec(code);
    assert.ok(m, `unexpected fallback code: ${String(code).slice(0, 80)}`);
    assert.deepEqual(JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')), SAMPLE);
    assert.deepEqual(await decode(code), SAMPLE);
  });
});

describe('§4 codec: decodeProposal finds the proposal', () => {
  test('§4/§5 decodes the code inside the WhatsApp message format', async () => {
    assert.deepEqual(await decode(whatsapp(await encode(SAMPLE))), SAMPLE);
  });

  test('§4 whitespace, line breaks and backticks inside the code are tolerated (phone wrapping)', async () => {
    const code = await encode(SAMPLE);
    const wrapped = code.match(/.{1,30}/g).join('\n ');
    assert.deepEqual(await decode(whatsapp(wrapped)), SAMPLE);
    const ticked = `${code.slice(0, 17)}\`\` ${code.slice(17, 61)}\t\`${code.slice(61)}`;
    assert.deepEqual(await decode(`الرمز:\n${ticked}\n`), SAMPLE);
  });

  test('§4 accepts a code anywhere in the text (inside a sentence, or a preview link)', async () => {
    const code = await encode(SAMPLE);
    assert.deepEqual(await decode(`الرمز هو ${code} وشكراً`), SAMPLE);
    assert.deepEqual(await decode(`https://example.github.io/family-tree/#/preview?code=${code}`), SAMPLE);
  });

  test('§4 a hand-made GFT0 code (base64url of the JSON) decodes', async () => {
    assert.deepEqual(await decode(await gft0(JSON.stringify(SAMPLE))), SAMPLE);
  });

  /** SAMPLE without invisible bidi marks (for the plain acceptance tests of the JSON paths). */
  const PLAIN = { ...SAMPLE, note: SAMPLE.note.replace(/‏/g, '') };

  test('§4 raw JSON with kind "gft-proposal" is accepted', async () => {
    assert.deepEqual(await decode(JSON.stringify(PLAIN)), PLAIN);
    assert.deepEqual(await decode(`\n  ${JSON.stringify(PLAIN, null, 2)}  \n`), PLAIN);
  });

  test('§4 a fenced ```json block with kind "gft-proposal" is accepted', async () => {
    const body = `اقتراح بصيغة JSON:\n\`\`\`json\n${JSON.stringify(PLAIN, null, 2)}\n\`\`\`\nشكراً`;
    assert.deepEqual(await decode(body), PLAIN);
  });

  test('§4 JSON that parses as-is comes back unchanged: characters inside strings (e.g. U+200F) are kept', async () => {
    // Same fidelity as the GFT code path, so the same proposal never gets two different contents (or hashes).
    assert.deepEqual(await decode(JSON.stringify(SAMPLE)), SAMPLE);
    assert.deepEqual(await decode(`\`\`\`json\n${JSON.stringify(SAMPLE, null, 2)}\n\`\`\``), SAMPLE);
  });

  test('§4 codes on quoted lines ("> ") are ignored with {ignoreQuoted:true}; accepted by default', async () => {
    const oldCode = await encode({ ...SAMPLE, id: 'oldoldoldo' });
    const newCode = await encode({ ...SAMPLE, id: 'newnewnewn' });
    const correction = `> ${oldCode}\n\nتصحيح من المالك:\n${newCode}\n`;
    assert.equal((await decode(correction, { ignoreQuoted: true })).id, 'newnewnewn');
    const onlyQuoted = `> الرمز السابق:\n> ${oldCode}\n\n/approve`;
    await rejectsCode(() => decode(onlyQuoted, { ignoreQuoted: true }), 'NO_PROPOSAL');
    assert.equal((await decode(onlyQuoted)).id, 'oldoldoldo');
  });
});

describe('§4 codec: decodeProposal errors', () => {
  test('§4 no proposal in the text → NO_PROPOSAL (plain text, or JSON that is not a gft-proposal)', async () => {
    await rejectsCode(() => decode('مرحباً، أرجو إضافة ابني أحمد إلى الشجرة'), 'NO_PROPOSAL');
    await rejectsCode(() => decode('```json\n{"kind": "shopping-list", "items": ["خبز"]}\n```'), 'NO_PROPOSAL');
  });

  test('§4 checksum mismatch after the payload was cut → TRUNCATED_CODE', async () => {
    const code = await encode(SAMPLE);
    const [head, crc] = code.split('.');
    await rejectsCode(() => decode(`${head.slice(0, -6)}.${crc}`), 'TRUNCATED_CODE');
  });

  test('§4 a changed checksum digit → TRUNCATED_CODE (the checksum is really verified)', async () => {
    const code = await encode(SAMPLE);
    const [head, crc] = code.split('.');
    const last = crc.at(-1) === '0' ? '1' : '0';
    await rejectsCode(() => decode(`${head}.${crc.slice(0, -1)}${last}`), 'TRUNCATED_CODE');
  });

  test('§4 a message cut inside the checksum never yields a different proposal (TRUNCATED_CODE or the exact original)', async () => {
    // Only the checksum is lost here; the payload is complete. The spec does not say whether a partial checksum
    // must be refused, so either outcome is accepted — but never a silently different proposal.
    const code = await encode(SAMPLE);
    for (let cut = 1; cut <= code.split('.')[1].length; cut++) {
      let result = null;
      let err = null;
      try { result = await decode(code.slice(0, -cut)); } catch (e) { err = e; }
      if (err) assert.equal(err.code, 'TRUNCATED_CODE', `cut ${cut}: ${err.message}`);
      else assert.deepEqual(result, SAMPLE, `cut ${cut}`);
    }
  });

  test('§4 a WhatsApp message cut in the middle of the code is rejected as truncated/bad (never as a valid proposal)', async () => {
    const code = await encode(SAMPLE);
    const cut = whatsapp(code, '').slice(0, -(4 + 1 + 25)); // drop the fence and the last 25 code chars
    await rejectsCode(() => decode(cut), ['TRUNCATED_CODE', 'BAD_CODE']);
    await rejectsCode(() => decode(code.split('.')[0].slice(0, Math.floor(code.length / 2))), ['TRUNCATED_CODE', 'BAD_CODE']);
  });

  test('§4 a corrupted character is detected', async () => {
    const code = await encode(SAMPLE);
    const i = 25;
    const swapped = code[i] === 'A' ? 'B' : 'A';
    await rejectsCode(() => decode(code.slice(0, i) + swapped + code.slice(i + 1)), ['TRUNCATED_CODE', 'BAD_CODE']);
  });

  test('§4 valid checksum but not deflate data → BAD_CODE', async () => {
    const junk = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]); // BTYPE=11: invalid deflate block
    const code = await makeCode('GFT1', junk, Buffer.alloc(0));
    const expected = (await crcConvention()) === 'json' ? ['BAD_CODE', 'TRUNCATED_CODE'] : 'BAD_CODE';
    await rejectsCode(() => decode(code), expected);
  });

  test('§4 valid code whose content is not JSON → BAD_JSON', async () => {
    await rejectsCode(async () => decode(await gft1('{"kind":"gft-proposal","v":1,"ops":[')), 'BAD_JSON');
    await rejectsCode(async () => decode(await gft0('{oops')), 'BAD_JSON');
  });

  test('§3.1/§4 inflating stops at 1 MB of JSON → TOO_LARGE (zip bomb)', async () => {
    for (const size of [2 * 1024 * 1024, 20 * 1024 * 1024]) {
      const bomb = JSON.stringify({ ...SAMPLE, note: ' '.repeat(size) });
      const code = await gft1(bomb);
      assert.ok(code.length < 60000, 'the bomb fits in a normal-sized code');
      await rejectsCode(() => decode(code), 'TOO_LARGE');
    }
  });

  test('§3.1/§4 a proposal just under 1 MB of JSON still decodes', async () => {
    const big = { ...SAMPLE, note: ' '.repeat(980000) };
    assert.ok(Buffer.byteLength(JSON.stringify(big)) < 1000000);
    const decoded = await decode(await encode(big));
    assert.equal(decoded.note.length, 980000);
  });
});

describe('§4 codec: extractProposal', () => {
  test('§4 extractProposal(body) → {proposal, code} with the cleaned code, or null when there is none', async () => {
    const code = await encode(SAMPLE);
    const res = await CODEC.extractProposal(whatsapp(code.match(/.{1,40}/g).join('\n')));
    assert.ok(res, 'found');
    assert.deepEqual(res.proposal, SAMPLE);
    assert.equal(res.code, code);
    assert.equal(await CODEC.extractProposal('لا يوجد اقتراح هنا، شكراً'), null);
    assert.equal(await CODEC.extractProposal(`> ${code}`, { ignoreQuoted: true }), null);
  });
});
