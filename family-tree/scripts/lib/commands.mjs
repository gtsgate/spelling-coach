// Owner commands in issue comments (docs/SPEC.md §6.3) — a lenient parser.
//
//   /approve [fp] [skip 3,5] [force]        aliases: /موافق  /موافقة  /اعتماد
//   /approve-deletion [fp] [skip …] [force] aliases: /approve deletion, /approve_deletion, /موافق-حذف, /موافق حذف
//   /reject                                  alias:   /رفض
//   /undo                                    alias:   /تراجع
//   /correct  (code below; dry-run only)     alias:   /تصحيح
//
// Only the FIRST non-empty, non-quoted line counts; it must start with "/". Case-insensitive; trailing punctuation,
// invisible marks and Arabic-Indic digits are tolerated. "skip" numbers are 1-based as shown in the bot comment
// (ranges "3-5" allowed; separators "," "،" spaces "and" "و"); they are returned 0-based for ops.skipOps.
// A hex word of 6–64 characters is taken as the fingerprint (shorter-than-16 ones are then refused as too short).
//
// Comments are written by anyone, so parsing is bounded: bodies are cut at MAX_BODY (GitHub's own limit) and the
// command line at FIRST_LINE_MAX characters before any of the parsing below; nothing here is worse than linear.

import { toAsciiDigits } from '../../js/core/dates.js';

const INVISIBLE = /[​-‏⁠﻿؜‪-‮⁦-⁩]/g;
const TRAILING_PUNCT = new Set([...'.,!?؟،;:؛…']);

/** Longest body parsed (GitHub limits issue and comment bodies to 65,536 characters). */
export const MAX_BODY = 65536;
/** Longest command line parsed (a full command with a 64-char fingerprint and a skip list fits easily). */
export const FIRST_LINE_MAX = 200;

/** A body as a string, cut at MAX_BODY. */
export const clampBody = (body) => {
  const s = String(body ?? '');
  return s.length > MAX_BODY ? s.slice(0, MAX_BODY) : s;
};

/** Drop trailing whitespace and punctuation (a plain loop: a regex like /[.…]+$/ is quadratic on long runs). */
function stripTrailing(s) {
  let i = s.length;
  while (i > 0 && (TRAILING_PUNCT.has(s[i - 1]) || /\s/.test(s[i - 1]))) i--;
  return s.slice(0, i);
}

const COMMANDS = new Map([
  ['approve', 'approve'], ['approved', 'approve'], ['موافق', 'approve'], ['موافقة', 'approve'], ['اعتماد', 'approve'],
  ['approve-deletion', 'approve-deletion'], ['approve_deletion', 'approve-deletion'], ['approvedeletion', 'approve-deletion'],
  ['approve-delete', 'approve-deletion'], ['موافق-حذف', 'approve-deletion'], ['موافق_حذف', 'approve-deletion'],
  ['موافقة-حذف', 'approve-deletion'], ['موافقة_حذف', 'approve-deletion'],
  ['reject', 'reject'], ['رفض', 'reject'],
  ['undo', 'undo'], ['تراجع', 'undo'],
  ['correct', 'correct'], ['correction', 'correct'], ['تصحيح', 'correct'],
]);
const DELETION_WORDS = new Set(['deletion', 'delete', 'حذف']);
const SKIP_WORDS = new Set(['skip', 'skipping', 'except', 'تخطي', 'تخطّي', 'تجاوز', 'استثناء', 'بدون']);
const FORCE_WORDS = new Set(['force', '--force', 'forced', 'فرض', 'إجبار', 'اجبار']);
const CONNECTORS = new Set(['and', 'و', '&', ',', '،']);

/** The first non-empty line that is not a quote ("> …"), cleaned and cut at FIRST_LINE_MAX characters. */
export function firstLine(body) {
  for (const raw of clampBody(body).split('\n')) {
    const line = raw.replace(INVISIBLE, '').trim();
    if (!line) continue;
    if (line.startsWith('>')) continue;
    return line.slice(0, FIRST_LINE_MAX);
  }
  return '';
}

/** Expand "3", "3-5", "3,5" into 1-based numbers (null when the token is not a number list). */
function numbersOf(token) {
  const parts = token.split(/[,،]+/).filter(Boolean);
  if (!parts.length) return [];
  const out = [];
  for (const part of parts) {
    let m;
    if ((m = /^(\d{1,3})$/.exec(part))) out.push(Number(m[1]));
    else if ((m = /^(\d{1,3})[-–](\d{1,3})$/.exec(part))) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (b < a || b - a > 200) return null;
      for (let k = a; k <= b; k++) out.push(k);
    } else return null;
  }
  return out;
}

/**
 * Parse a comment body. → null (not a command) or
 * {cmd: "approve"|"approve-deletion"|"reject"|"undo"|"correct", fp: string|null, skip: number[] (0-based),
 *  skipShown: number[] (1-based), force: boolean, extra: string[] (unrecognised words), line}
 */
export function parseCommand(body) {
  let line = firstLine(body);
  if (!line.startsWith('/')) return null;
  line = stripTrailing(toAsciiDigits(line));
  const tokens = line.slice(1).toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let head = tokens.shift().replace(/[.,!?؟،:]+$/u, '');
  let cmd = COMMANDS.get(head);
  if (!cmd) return null;
  if (cmd === 'approve' && tokens.length && DELETION_WORDS.has(tokens[0])) {
    tokens.shift();
    cmd = 'approve-deletion';
  }
  const res = { cmd, fp: null, skip: [], skipShown: [], force: false, extra: [], line };
  if (cmd === 'reject' || cmd === 'undo' || cmd === 'correct') return res;

  const skip = new Set();
  let inSkip = false;
  for (let raw of tokens) {
    const tok = raw.replace(/^[([{]+|[)\]}]+$/g, '');
    if (!tok) continue;
    if (SKIP_WORDS.has(tok) || tok.startsWith('skip=') || tok.startsWith('skip:')) {
      inSkip = true;
      const rest = tok.replace(/^skip[=:]/, '');
      if (rest !== tok) {
        const nums = numbersOf(rest);
        if (nums) nums.forEach((n) => skip.add(n));
      }
      continue;
    }
    if (FORCE_WORDS.has(tok)) { res.force = true; inSkip = false; continue; }
    if (inSkip) {
      if (CONNECTORS.has(tok)) continue;
      const nums = numbersOf(tok.replace(/^[,،]+|[,،]+$/g, ''));
      if (nums) { nums.forEach((n) => skip.add(n)); continue; }
      inSkip = false;
    }
    const fpTok = tok.replace(/^(?:fp[=:]|#)/, '');
    if (!res.fp && /^[0-9a-f]{6,64}$/.test(fpTok)) { res.fp = fpTok; continue; }
    res.extra.push(tok);
  }
  res.skipShown = [...skip].filter((n) => n >= 1).sort((a, b) => a - b);
  res.skip = res.skipShown.map((n) => n - 1);
  return res;
}

/** Label added for an approval command. */
export const labelForCommand = (cmd) => (cmd === 'approve-deletion' ? 'approve-deletion' : cmd === 'approve' ? 'approve' : null);

/** Is `login` one of config.approvers? (case-insensitive; "@" prefixes ignored; author_association is NOT used) */
export function isApprover(login, approvers) {
  const l = String(login || '').trim().replace(/^@/, '').toLowerCase();
  if (!l) return false;
  return (Array.isArray(approvers) ? approvers : []).some((a) => String(a || '').trim().replace(/^@/, '').toLowerCase() === l);
}

/** The command text the owner should type (shown in code blocks). */
export function commandText(cmd, fp, { skip = [], force = false } = {}) {
  let s = `/${cmd}${fp ? ` ${fp}` : ''}`;
  if (skip.length) s += ` skip ${skip.join(',')}`;
  if (force) s += ' force';
  return s;
}
