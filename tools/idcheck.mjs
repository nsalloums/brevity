#!/usr/bin/env node
// brevity idcheck: deterministic check that every identifier in an original message
// survives in its encoding. Complements semantic (LLM) review; it proves nothing about meaning.
//
//   node tools/idcheck.mjs <messages.json> <encodings.json> [--dict aliases.json] [--small-numbers] [--legacy]
//        [--verbose]
//
// Checked tokens, extracted from the original:
//   commit SHAs   7-40 hex chars with at least one digit and one letter; the encoding must contain
//                 a prefix of length >= min(9, original length) (or the original's full form)
//   #N refs       PR / issue numbers of any length; also github.com/<o>/<r>/(pull|issues)/N URLs. A one-digit
//                 #N counts unless it follows & (an HTML entity, &#9;), is followed by a letter, digit or _ (a
//                 colour, #3b82f6), by a decimal (#1.5) or by -word (a heading anchor, #3-setup), sits in a
//                 word with :// (a URL fragment), or is #0. Anything else counts, such as an ordinal ("#1
//                 priority") or tool output that numbers its own steps (BuildKit's "#7 [4/5]", CTest's "Test
//                 #3:"). The encoding must keep the number standalone: #2, 2 or PR 2, not 2nd. Outside --legacy,
//                 #N followed by letters also counts as kept, so a colour such as #16a34a copied verbatim passes.
//   file:line     name.ext:N, name.ext:~N or name.ext:N-M -> the line numbers must appear. The extension is 1-8
//                 letters and digits with at least one letter (.py, .go, .rs, .ps1, .f90), so a time, a decimal
//                 or an address such as 12.30:45 or 10.0.0.1:8080 never counts. Beyond .ts .tsx .js .jsx .mjs
//                 .md .sql .json .yaml .yml .css, which always count, a host and port is skipped: inside a URL
//                 (its word has <scheme>:// before it, file:// aside), right after user@, followed by /path, or
//                 with the extension com, net, org, io or internal (example.com:8080). Anything else shaped
//                 like name.ext:N counts, such as a port on another host (db.ci.local:5432) or a dotted key
//                 (server.port:8080).
//   numbers       every integer of two or more digits (10 or more, or zero-padded such as 09) and every
//                 +N/-M diffstat of that size, including the -M; with --small-numbers, of any size. A 20xx
//                 year counts as present when the encoding carries an MM-DD date, since the spec lets the
//                 current year be implied. Outside --legacy, a digit run inside a SHA of the encoding does
//                 not count as the number (3fa4c9e does not keep views.py:4).
//   quoted UI     text inside «...», up to 120 characters, must appear verbatim (either «...» or "..."); a
//                 quote written with edit markup ({old>new}, {+ins}, {-del}) counts for both its old and new text
// Not checked: text in ordinary quotes or a longer «quote»; a number right after a letter, digit, #, ., :, / or
// - (v2, the 30 in 14:30, a port in localhost:3000, the 120 in 118/120, the 10 in 2026-10-11) unless it is a
// file:line or the -M of +N/-M; a number followed in the same word by a letter a-f (hex such as 1234abcd, but
// also 30-day, 512mb or 42-line); a number with a thousands separator, which is read from its last group (1,204
// as 204); a file without an extension (Makefile:12, .env:3); #L42 anchors; owners, conditions and requests.
//
// --legacy runs the coverage of brevity 0.7.0 and earlier, which the published 2,637 identifiers used: #N of two
// or more digits, file:line for the 11 extensions above only, no -M of +N/-M, and none of the "outside --legacy"
// rules above. It cannot be combined with --small-numbers. The summary's "coverage" line says which coverage ran,
// and checkedByKind / missingByKind split the counts by kind. An unknown option stops the run with exit code 2.
// --dict maps long forms to aliases ({"packages/ui/src/pages/CartPage.tsx": "P.Cart"}),
// so an alias counts as the long form (this includes quotes the DICT names, such as a section
// title). `NUM n: #A #B` counts as carrying n, n+1. Numbers inside SHAs, refs or dates are not
// double-counted.

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const KINDS = ['sha', 'ref', 'line', 'num', 'quote'];
// The file types that brevity 0.7.0 and earlier checked; --legacy keeps to them.
const LEGACY_EXT = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'md', 'sql', 'json', 'yaml', 'yml', 'css'];
// Extensions that end a host name, so that api.example.com:8443 reads as a host and port.
const HOST_EXT = ['com', 'net', 'org', 'io', 'internal'];

// The one line that the summary prints as "coverage".
export function coverage({ legacy = false, smallNumbers = false } = {}) {
  if (legacy) {
    return `legacy (brevity 0.7.0): SHAs (9-character prefix), #N of 2+ digits and PR/issue URLs, file:line for .${LEGACY_EXT.join(' .')}, numbers and diffstats of 2+ digits but not the -M of +N/-M, «quotes» of up to 120 characters`;
  }
  const size = smallNumbers ? 'of any size' : 'of 2+ digits';
  return `SHAs (9-character prefix), #N of 1+ digits and PR/issue URLs, file:line for any extension of 1-8 letters and digits except hosts, numbers and +N/-M diffstats ${size}, «quotes» of up to 120 characters`;
}

const norm = (s) => s.replace(/[\u2212\u2013\u2014]/g, '-').replace(/[\u00A0\u202F]/g, ' ');

// Edit markup (SPEC section 4): `{old>new}`, `{+ins}`, `{-del}` inside a quote. The quote's old and
// new texts are both considered present, so «seventy-{seven>eight} PRs» carries both versions.
const EDIT = /\{([^{}>]*)>([^{}]*)\}|\{\+([^{}]*)\}|\{-([^{}]*)\}/g;
const side = (s, which) => s.replace(EDIT, (_, o, n, ins, del) => (o !== undefined ? (which ? n : o) : ins !== undefined ? (which ? ins : '') : (which ? '' : del)));

export function expand(enc, dict = {}) {
  let out = norm(enc);
  if (out.search(EDIT) >= 0) out += `\n${side(out, 0)}\n${side(out, 1)}`;
  // `NUM n: #A #B #C` numbers its entries n, n+1, n+2 (SPEC section 3).
  for (const m of out.matchAll(/NUM (\d+): ((?:#\d+[\s,;]*)+)/g)) {
    const k = (m[2].match(/#\d+/g) || []).length;
    out += `\n${Array.from({ length: k }, (_, i) => +m[1] + i).join(' ')}`;
  }
  for (const [long, alias] of Object.entries(dict)) {
    const word = new RegExp(`(?<![\\w.])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`);
    if (word.test(out)) out += `\n${long}`;
  }
  return out;
}

// The part of the whitespace-separated word that comes before index i.
const wordBefore = (t, i) => t.slice(t.slice(0, i).search(/\S*$/), i);

// Whether a name.ext:N match, outside the legacy extensions, is a file and line rather than a time, a version
// or a host and port.
function fileLine(t, m) {
  const ext = m[1].toLowerCase();
  if (LEGACY_EXT.includes(ext)) return true;
  if (!/[a-z]/.test(ext) || HOST_EXT.includes(ext)) return false;
  if (/\w@$/.test(t.slice(Math.max(0, m.index - 2), m.index)) || t[m.index + m[0].length] === '/') return false;
  const scheme = wordBefore(t, m.index).match(/([a-z][\w+.-]*):\/\//i);
  return !scheme || scheme[1].toLowerCase() === 'file';
}

export function tokens(text, { legacy = false, smallNumbers = false } = {}) {
  const t = norm(text);
  const found = [];
  const shas = new Set();
  for (const m of t.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
    if (/[0-9]/.test(m[0]) && /[a-f]/.test(m[0])) { shas.add(m[0]); found.push({ kind: 'sha', v: m[0] }); }
  }
  const refs = new Set();
  for (const m of t.matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/(\d+)/g)) refs.add(m[1]);
  for (const m of t.matchAll(/#(\d{2,})/g)) refs.add(m[1]);
  if (!legacy) {
    for (const m of t.matchAll(/(?<!&)#([1-9])(?!\w|\.\d|-[A-Za-z])/g)) if (!wordBefore(t, m.index).includes('://')) refs.add(m[1]);
  }
  for (const r of refs) found.push({ kind: 'ref', v: r });
  // The legacy pattern runs unchanged, so that every line it found is still found; the wider one adds the rest.
  for (const m of t.matchAll(/[\w.-]+\.(?:tsx?|jsx?|mjs|md|sql|json|ya?ml|css):~?(\d+)(?:-(\d+))?/g)) {
    found.push({ kind: 'line', v: m[1] });
    if (m[2]) found.push({ kind: 'line', v: m[2] });
  }
  if (!legacy) {
    for (const m of t.matchAll(/[\w.-]+\.([A-Za-z\d]{1,8}):~?(\d+)(?:-(\d+))?/g)) {
      if (!fileLine(t, m)) continue;
      found.push({ kind: 'line', v: m[2] });
      if (m[3]) found.push({ kind: 'line', v: m[3] });
    }
  }
  for (const m of t.matchAll(/«([^»]{1,120})»/g)) found.push({ kind: 'quote', v: m[1] });
  const num = smallNumbers ? /(?<![\w#.:/-])([+-]?\d+)(?![\w:/.-]*[a-f])/g : /(?<![\w#.:/-])([+-]?\d{2,})(?![\w:/.-]*[a-f])/g;
  const nums = [...t.matchAll(num)].map((m) => m[1]);
  // The -M of +N/-M follows a slash, which the pattern above skips. N may have thousands separators.
  if (!legacy) {
    for (const m of t.matchAll(/(?<![\w#.:/-])\+(?:\d{1,3}(?:,\d{3})+|\d+)\/-(\d+)(?!\d|,\d)(?![\w:/.-]*[a-f])/g)) {
      if (smallNumbers || m[1].length >= 2) nums.push(m[1]);
    }
  }
  for (const v of nums) {
    const bare = v.replace(/^[+-]/, '');
    // A one-digit number sits inside most SHAs by chance, so only longer ones are skipped for that.
    if ((bare.length >= 2 && [...shas].some((s) => s.includes(bare))) || refs.has(bare)) continue;
    found.push({ kind: 'num', v: bare });
  }
  const seen = new Set();
  return found.filter((f) => { const k = `${f.kind}:${f.v}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function present(tok, enc, { legacy = false } = {}) {
  switch (tok.kind) {
    case 'sha': {
      const need = tok.v.slice(0, Math.min(9, tok.v.length));
      return enc.includes(need);
    }
    // Outside --legacy, #N followed by letters counts too, so that a colour copied verbatim passes.
    case 'ref': return new RegExp(`(?:#|pull/|issues/|\\b)${tok.v}\\b${legacy ? '' : `|#${tok.v}(?!\\d)`}`).test(enc);
    case 'quote': return enc.includes(tok.v);
    default: {
      // Outside --legacy, a SHA's digits do not count as a number or a line.
      const e = legacy ? enc : enc.replace(/\b[0-9a-f]{7,40}\b/g, (s) => (/[0-9]/.test(s) && /[a-f]/.test(s) ? ' ' : s));
      // A year may be implied by an MM-DD date (the spec lets senders drop the current year).
      if (/^20\d\d$/.test(tok.v) && /\b\d\d-\d\d(?:T|\b)/.test(e)) return true;
      return new RegExp(`(?<!\\d)${tok.v}(?!\\d)`).test(e);
    }
  }
}

// Checks each encoding against its original. Returns the summary that the tool prints, the misses per message,
// and the encoding ids with no original.
export function check(messages, encodings, { dict = {}, legacy = false, smallNumbers = false } = {}) {
  const msgs = new Map(messages.map((m) => [m.id, m.text]));
  const checkedByKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const missingByKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
  let checked = 0; let missing = 0; const perMsg = []; const unknown = [];
  for (const { id, enc } of encodings) {
    const text = msgs.get(id);
    if (text == null) { unknown.push(id); continue; }
    const e = expand(enc, dict);
    const miss = [];
    for (const tok of tokens(text, { legacy, smallNumbers })) {
      checked++; checkedByKind[tok.kind]++;
      if (!present(tok, e, { legacy })) { missing++; missingByKind[tok.kind]++; miss.push(tok); }
    }
    if (miss.length) perMsg.push({ id, missing: miss });
  }
  const summary = {
    coverage: coverage({ legacy, smallNumbers }),
    messages: encodings.length, identifiersChecked: checked, missing, messagesWithMissing: perMsg.length, checkedByKind, missingByKind,
  };
  return { summary, perMsg, unknown };
}

const USAGE = 'usage: node tools/idcheck.mjs <messages.json> <encodings.json> [--dict aliases.json] [--small-numbers] [--legacy] [--verbose]';

export function parseArgs(argv) {
  const o = { verbose: false, legacy: false, smallNumbers: false, dictFile: null, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verbose') o.verbose = true;
    else if (a === '--legacy') o.legacy = true;
    else if (a === '--small-numbers') o.smallNumbers = true;
    else if (a === '--dict') {
      if (o.dictFile != null) throw new Error('--dict given twice');
      o.dictFile = argv[++i];
      if (o.dictFile == null || o.dictFile.startsWith('--')) throw new Error('--dict needs a file');
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.files.push(a);
  }
  if (o.files.length !== 2) throw new Error('give a messages file and an encodings file');
  if (o.legacy && o.smallNumbers) throw new Error('--legacy and --small-numbers cannot be combined');
  return o;
}

// Whether node runs this file itself rather than importing it. Node resolves symlinks and junctions in the main
// module's URL unless --preserve-symlinks-main is set, so both the path as given and its real path are compared.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  const path = resolve(process.argv[1]);
  let real = path;
  try { real = realpathSync(path); } catch { /* keep the path as given */ }
  return [path, real].some((p) => pathToFileURL(p).href === import.meta.url);
}

if (invokedDirectly()) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (err) { console.error(`${err.message}\n${USAGE}`); process.exit(2); }
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const encs = read(o.files[1]);
  const { summary, perMsg, unknown } = check(read(o.files[0]), encs, {
    dict: o.dictFile ? read(o.dictFile) : {}, legacy: o.legacy, smallNumbers: o.smallNumbers,
  });
  for (const id of unknown) console.error(`unknown id ${id}`);
  console.log(JSON.stringify(summary, null, 2));
  for (const p of perMsg) {
    console.log(`${p.id}: ${p.missing.map((m) => `${m.kind}=${m.v}`).join(', ')}`);
    if (o.verbose) console.log(`  ENC: ${encs.find((x) => x.id === p.id).enc.replace(/\n/g, '\n       ')}`);
  }
  process.exitCode = summary.missing ? 1 : 0;
}
