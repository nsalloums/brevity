#!/usr/bin/env node
// brevity idcheck: deterministic check that every identifier in an original message
// survives in its encoding. Complements semantic (LLM) review; it proves nothing about meaning.
//
//   node tools/idcheck.mjs <messages.json> <encodings.json> [--dict aliases.json] [--verbose]
//
// Checked tokens, extracted from the original:
//   commit SHAs   7-40 hex chars with at least one digit and one letter; the encoding must contain
//                 a prefix of length >= min(9, original length) (or the original's full form)
//   #N refs       PR / issue numbers; also github.com/<o>/<r>/(pull|issues)/N URLs
//   file:line     name.ext:123 or name.ext:123-456 -> the line numbers must appear
//   numbers       every integer >= 10 and every +N/-N diffstat (a 20xx year counts as present when
//                 the encoding carries an MM-DD date, since the spec lets the current year be implied)
//   quoted UI     text inside «...» must appear verbatim (either «...» or "..."); a quote written
//                 with edit markup ({old>new}, {+ins}, {-del}) counts for both its old and new text
// --dict maps long forms to aliases ({"packages/ui/src/pages/CartPage.tsx": "P.Cart"}),
// so an alias counts as the long form (this includes quotes the DICT names, such as a section
// title). `NUM n: #A #B` counts as carrying n, n+1. Numbers inside SHAs, refs or dates are not
// double-counted.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const dictAt = args.indexOf('--dict');
const dict = dictAt >= 0 ? JSON.parse(readFileSync(args[dictAt + 1], 'utf8')) : {};
const [msgFile, encFile] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--dict');

const msgs = new Map(JSON.parse(readFileSync(msgFile, 'utf8')).map((m) => [m.id, m.text]));
const encs = JSON.parse(readFileSync(encFile, 'utf8'));

const norm = (s) => s.replace(/[\u2212\u2013\u2014]/g, '-').replace(/[\u00A0\u202F]/g, ' ');

// Edit markup (SPEC section 4): `{old>new}`, `{+ins}`, `{-del}` inside a quote. The quote's old and
// new texts are both considered present, so «seventy-{seven>eight} PRs» carries both versions.
const EDIT = /\{([^{}>]*)>([^{}]*)\}|\{\+([^{}]*)\}|\{-([^{}]*)\}/g;
const side = (s, which) => s.replace(EDIT, (_, o, n, ins, del) => (o !== undefined ? (which ? n : o) : ins !== undefined ? (which ? ins : '') : (which ? '' : del)));

function expand(enc) {
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

function tokens(text) {
  const t = norm(text);
  const found = [];
  const shas = new Set();
  for (const m of t.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
    if (/[0-9]/.test(m[0]) && /[a-f]/.test(m[0])) { shas.add(m[0]); found.push({ kind: 'sha', v: m[0] }); }
  }
  const refs = new Set();
  for (const m of t.matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/(\d+)/g)) refs.add(m[1]);
  for (const m of t.matchAll(/#(\d{2,})/g)) refs.add(m[1]);
  for (const r of refs) found.push({ kind: 'ref', v: r });
  for (const m of t.matchAll(/[\w.-]+\.(?:tsx?|jsx?|mjs|md|sql|json|ya?ml|css):~?(\d+)(?:-(\d+))?/g)) {
    found.push({ kind: 'line', v: m[1] });
    if (m[2]) found.push({ kind: 'line', v: m[2] });
  }
  for (const m of t.matchAll(/«([^»]{1,120})»/g)) found.push({ kind: 'quote', v: m[1] });
  for (const m of t.matchAll(/(?<![\w#.:/-])([+-]?\d{2,})(?![\w:/.-]*[a-f])/g)) {
    const v = m[1];
    const bare = v.replace(/^[+-]/, '');
    if ([...shas].some((s) => s.includes(bare)) || refs.has(bare)) continue;
    found.push({ kind: 'num', v: bare });
  }
  const seen = new Set();
  return found.filter((f) => { const k = `${f.kind}:${f.v}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function present(tok, enc) {
  switch (tok.kind) {
    case 'sha': {
      const need = tok.v.slice(0, Math.min(9, tok.v.length));
      return enc.includes(need);
    }
    case 'ref': return new RegExp(`(?:#|pull/|issues/|\\b)${tok.v}\\b`).test(enc);
    case 'quote': return enc.includes(tok.v);
    default:
      // A year may be implied by an MM-DD date (the spec lets senders drop the current year).
      if (/^20\d\d$/.test(tok.v) && /\b\d\d-\d\d(?:T|\b)/.test(enc)) return true;
      return new RegExp(`(?<!\\d)${tok.v}(?!\\d)`).test(enc);
  }
}

let checked = 0; let missing = 0; const perMsg = [];
for (const { id, enc } of encs) {
  const text = msgs.get(id);
  if (text == null) { console.error(`unknown id ${id}`); continue; }
  const e = expand(enc);
  const miss = [];
  for (const tok of tokens(text)) { checked++; if (!present(tok, e)) { missing++; miss.push(tok); } }
  if (miss.length) perMsg.push({ id, missing: miss });
}
console.log(JSON.stringify({ messages: encs.length, identifiersChecked: checked, missing, messagesWithMissing: perMsg.length }, null, 2));
for (const p of perMsg) {
  console.log(`${p.id}: ${p.missing.map((m) => `${m.kind}=${m.v}`).join(', ')}`);
  if (verbose) console.log(`  ENC: ${encs.find((x) => x.id === p.id).enc.replace(/\n/g, '\n       ')}`);
}
process.exitCode = missing ? 1 : 0;
