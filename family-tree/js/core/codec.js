// Proposal codes (docs/SPEC.md §4 codec, §5 transport): a proposal travels as text through WhatsApp, e-mail or a
// GitHub issue, so it is packed into one copy-safe token:
//
//   "GFT1:" + base64url(deflate-raw(UTF-8 JSON)) + "." + crc32(payload) in base36
//   "GFT0:" + base64url(UTF-8 JSON)               + "." + crc32(payload)        (when CompressionStream is missing)
//
// The CRC covers the base64url payload text, so a code cut off by a messenger is detected before decoding
// (TRUNCATED_CODE). Decoding is tolerant: the code may sit anywhere in a message, be wrapped over several lines or
// fenced in backticks; raw JSON and ```json fences are accepted too. Inflation stops at LIMITS.decodedBytes (1 MB).
// Pure ES module — browsers and Node ≥ 20 (CompressionStream, btoa/atob, TextEncoder/TextDecoder are globals).

import { LIMITS } from './schema.js';

/** Error codes thrown by decodeProposal (as Error objects with `.code`). */
export const CODEC_ERROR_CODES = Object.freeze(['NO_PROPOSAL', 'BAD_CODE', 'BAD_JSON', 'TRUNCATED_CODE', 'TOO_LARGE']);

/** A code inside text (after whitespace/backticks between code characters were removed). */
export const CODE_RE = /GFT[01]:[A-Za-z0-9_-]+(?:\.[0-9a-z]{1,7})?/g;

/** Largest message text decodeProposal looks at (a code is ≤ 60,000 chars; raw JSON ≤ 1 MB). */
const MAX_TEXT = 4 * LIMITS.decodedBytes;
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁤﻿]/g;

function codecError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------------------------------------------------
// CRC-32 (IEEE 802.3, the zip/PNG polynomial)

let crcTable = null;
function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 of a string (UTF-8) or a byte array, as an unsigned 32-bit number. */
export function crc32(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const t = table();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------------------------------------------
// base64url

/** Bytes → base64url without padding. */
export function base64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (padding optional) → bytes; throws on malformed input. */
export function base64urlDecode(text) {
  if (text.length % 4 === 1) throw new Error('bad base64 length');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Streams

/** Does this engine support deflate-raw streams? (Some older browsers have the classes but not this format.) */
let rawDeflate = null;
function hasCompression() {
  if (rawDeflate !== null) return rawDeflate;
  try {
    new globalThis.CompressionStream('deflate-raw');
    new globalThis.DecompressionStream('deflate-raw');
    rawDeflate = true;
  } catch {
    rawDeflate = false;
  }
  return rawDeflate;
}

/** Read a stream into one Uint8Array, aborting (TOO_LARGE) past `max` bytes. */
async function readAll(readable, max) {
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw codecError('TOO_LARGE', `decoded proposal exceeds ${max} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Push `bytes` through a (de)compression transform; read the output with a byte cap. */
async function transform(stream, bytes, max) {
  const writer = stream.writable.getWriter();
  // Write errors surface on the readable side; swallow them here so they are never unhandled.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return readAll(stream.readable, max);
}

async function deflateRaw(bytes) {
  return transform(new CompressionStream('deflate-raw'), bytes, Number.MAX_SAFE_INTEGER);
}

async function inflateRaw(bytes, max) {
  return transform(new DecompressionStream('deflate-raw'), bytes, max);
}

// ---------------------------------------------------------------------------------------------------------
// Encode

/**
 * Encode a proposal as a code string (async). Uses GFT1 (deflate-raw) when CompressionStream exists, else GFT0.
 * opts.compress:false forces GFT0. Limits (LIMITS.code) are the caller's concern (the draft page checks them).
 */
export async function encodeProposal(proposal, { compress = true } = {}) {
  const json = new TextEncoder().encode(JSON.stringify(proposal));
  const gz = compress && hasCompression();
  const payload = base64urlEncode(gz ? await deflateRaw(json) : json);
  return `GFT${gz ? 1 : 0}:${payload}.${crc32(payload).toString(36)}`;
}

// ---------------------------------------------------------------------------------------------------------
// Decode

/** Remove invisible marks; drop quoted lines ("> …") when asked. */
function cleanText(text, ignoreQuoted) {
  let t = text.replace(INVISIBLE_RE, '');
  if (ignoreQuoted) t = t.split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join('\n');
  return t;
}

/** Codes in text, in order. Whitespace / backticks between code characters are removed first (wrapped codes). */
export function findCodes(text, { ignoreQuoted = false } = {}) {
  const t = cleanText(String(text ?? ''), ignoreQuoted);
  const joined = t.replace(/(?<=[A-Za-z0-9_.:-])[\s`]+(?=[A-Za-z0-9_.-])/g, '');
  return [...new Set(joined.match(CODE_RE) || [])];
}

/**
 * Decode one code string ("GFT1:…" / "GFT0:…"). → {proposal, code} where code is the canonical form (checksum
 * recomputed, trailing glued characters dropped). Throws coded Errors.
 */
async function decodeCode(code) {
  const m = /^GFT([01]):([A-Za-z0-9_-]+)(?:\.([0-9a-z]{1,7}))?/.exec(code);
  if (!m) throw codecError('BAD_CODE', 'not a proposal code');
  const [, version, payload, crcText] = m;
  if (payload.length > LIMITS.code) throw codecError('TOO_LARGE', `code longer than ${LIMITS.code} characters`);
  // Checksum: the stored value may be followed by letters glued on by whitespace removal (prefix match), or itself
  // be cut short at the very end of a message (the payload is then still checked by decoding).
  let verified = false;
  const expected = crc32(payload).toString(36);
  if (crcText) {
    if (crcText.startsWith(expected)) verified = true;
    else if (!expected.startsWith(crcText)) throw codecError('TRUNCATED_CODE', 'checksum mismatch: the code was cut off or changed');
  }
  const damaged = (msg) => codecError(verified ? 'BAD_CODE' : 'TRUNCATED_CODE', msg);
  let bytes;
  try {
    bytes = base64urlDecode(payload);
  } catch {
    throw damaged('payload is not base64url');
  }
  if (version === '1') {
    if (!hasCompression()) throw codecError('BAD_CODE', 'this browser cannot decompress GFT1 codes');
    try {
      bytes = await inflateRaw(bytes, LIMITS.decodedBytes);
    } catch (e) {
      if (e && e.code === 'TOO_LARGE') throw e;
      throw damaged('compressed data is damaged');
    }
  } else if (bytes.length > LIMITS.decodedBytes) {
    throw codecError('TOO_LARGE', `decoded proposal exceeds ${LIMITS.decodedBytes} bytes`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw damaged('payload is not UTF-8 text');
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw codecError(verified ? 'BAD_JSON' : 'TRUNCATED_CODE', 'payload is not valid JSON');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.kind !== 'gft-proposal') {
    throw codecError('BAD_CODE', 'the code does not contain a family-tree proposal');
  }
  return { proposal: obj, code: `GFT${version}:${payload}.${expected}` };
}

/** Proposal JSON in text: ```json fences, the whole text, or the outermost {...} span. null when none. */
function findJson(text) {
  const candidates = [];
  for (const m of text.matchAll(/```[ \t]*(?:json)?[ \t]*\r?\n?([\s\S]*?)```/gi)) candidates.push(m[1].trim());
  const whole = text.trim();
  if (whole.startsWith('{')) candidates.push(whole);
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
  let broken = false;
  for (const c of candidates) {
    if (!c.startsWith('{')) continue;
    if (new TextEncoder().encode(c).length > LIMITS.decodedBytes) throw codecError('TOO_LARGE', 'proposal JSON exceeds 1 MB');
    let obj;
    try {
      obj = JSON.parse(c);
    } catch {
      if (c.includes('gft-proposal')) broken = true;
      continue;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.kind === 'gft-proposal') return obj;
  }
  if (broken) throw codecError('BAD_JSON', 'the proposal JSON is not valid');
  return null;
}

/**
 * Find and decode a proposal in free text (async): the first code that decodes (whitespace/backticks inside a code
 * are ignored), else raw JSON / a ```json block with kind "gft-proposal". opts.ignoreQuoted skips "> " lines.
 * → {proposal, code} where code is the canonical code found (null for JSON). Throws Error with .code ∈ CODEC_ERROR_CODES.
 */
async function locate(text, { ignoreQuoted = false } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw codecError('NO_PROPOSAL', 'no proposal found');
  if (text.length > MAX_TEXT) throw codecError('TOO_LARGE', 'message too large');
  const codes = findCodes(text, { ignoreQuoted });
  let firstError = null;
  for (const code of codes) {
    try {
      return await decodeCode(code);
    } catch (e) {
      if (!e || !e.code) throw e;
      firstError = firstError || e;
    }
  }
  if (firstError) throw firstError;
  const proposal = findJson(cleanText(text, ignoreQuoted));
  if (proposal) return { proposal, code: null };
  throw codecError('NO_PROPOSAL', 'no proposal found');
}

/** Decode a proposal from text (a code anywhere in it, raw JSON or a ```json block). Throws coded Errors. */
export async function decodeProposal(text, opts = {}) {
  return (await locate(text, opts)).proposal;
}

/**
 * Like decodeProposal but returns {proposal, code} — code = the cleaned code string found (null when the proposal
 * came as JSON) — or null when the text holds no proposal at all. Damaged codes still throw (BAD_CODE, BAD_JSON,
 * TRUNCATED_CODE, TOO_LARGE) so callers can tell the sender.
 */
export async function extractProposal(body, opts = {}) {
  try {
    return await locate(body, opts);
  } catch (e) {
    if (e && e.code === 'NO_PROPOSAL') return null;
    throw e;
  }
}
