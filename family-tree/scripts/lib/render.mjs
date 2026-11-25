// Safe Markdown for bot comments (docs/SPEC.md §6.2).
// Everything that came from a proposal, an issue or a person record is passed through `esc()` (or `escLine()`):
// HTML and Markdown syntax are escaped, a WORD JOINER (U+2060) is inserted after "@" and "#" so text never
// mentions users or links issues, bidi overrides are stripped, and auto-links are broken. Bot comments are cut at
// 60,000 characters (GitHub's limit is 65,536).

export const MAX_COMMENT = 60000;
export const WJ = '⁠';

const BIDI_OVERRIDES = /[‪-‮⁦-⁩]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Escape untrusted text for inline Markdown (newlines kept). */
export function esc(text) {
  return String(text ?? '')
    .replace(CONTROL, '')
    .replace(BIDI_OVERRIDES, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]{}|~!])/g, '\\$1')
    .replace(/[@#]/g, (m) => m + WJ)
    .replace(/:\/\//g, `:${WJ}//`)
    .replace(/\bwww\./gi, (m) => `www${WJ}.`);
}

/** Escape untrusted text and fold it onto one line (≤ max chars). */
export function escLine(text, max = 300) {
  let s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return esc(s);
}

/** Text for inside a fenced code block: no fences can be closed early. */
export function codeText(text) {
  return String(text ?? '').replace(/`{3,}/g, (m) => m.split('').join(WJ));
}

/** Hidden marker: <!-- gft-bot:<kind> k=v … --> (values must be simple tokens). */
export function marker(kind, fields = {}) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v).replace(/[^A-Za-z0-9_.,:#-]/g, '')}`);
  return `<!-- gft-bot:${kind}${parts.length ? ` ${parts.join(' ')}` : ''} -->`;
}

/** Parse the first marker of `kind` in a body → {k: v} or null. */
export function parseMarker(body, kind) {
  const m = new RegExp(`<!-- gft-bot:${kind}((?: [A-Za-z0-9_]+=[^\\s>]*)*) -->`).exec(String(body ?? ''));
  if (!m) return null;
  const out = {};
  for (const part of m[1].trim().split(/\s+/).filter(Boolean)) {
    const i = part.indexOf('=');
    out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

/**
 * Fit numbered lines into a character budget. → {shown: string[], more: number}
 * `lines` are already-rendered Markdown lines.
 */
export function fitLines(lines, budget) {
  const shown = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budget) break;
    shown.push(line);
    used += line.length + 1;
  }
  return { shown, more: lines.length - shown.length };
}

/** Hard cap of a whole comment body. */
export function capBody(body, max = MAX_COMMENT, tail = '\n\n…') {
  const s = String(body ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max - tail.length) + tail;
}

/** A Markdown link with an escaped label and a URL that cannot break out of the parentheses. */
export function link(label, url) {
  const safeUrl = String(url ?? '').replace(/[\s()<>"]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  return `[${label}](${safeUrl})`;
}

/** Wrap Arabic Markdown in an RTL block (GitHub keeps the dir attribute). Blank lines keep Markdown active inside. */
export function rtl(markdown) {
  return `<div dir="rtl">\n\n${markdown}\n\n</div>`;
}

/** Fenced code block (for commands the owner copies). */
export function codeBlock(text) {
  return `\`\`\`\n${codeText(text)}\n\`\`\``;
}
