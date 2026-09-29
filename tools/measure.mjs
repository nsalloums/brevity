#!/usr/bin/env node
// brevity measure: compare token counts of messages before and after encoding.
//
//   node tools/measure.mjs count <messages.json> [--enc encodings.json] [--rows]
//
// messages.json:  [{ "id": "m001", "text": "..." }]   (other fields, such as "dir", are ignored)
// encodings.json: [{ "id": "m001", "enc": "..." }]
//
// You build messages.json yourself from messages you are allowed to use; this tool only reads
// the files you pass it and prints numbers.
//
// Token counts use @anthropic-ai/tokenizer when it is installed
// (npm i -D @anthropic-ai/tokenizer); otherwise they fall back to chars/4.
// Both are approximations of what a current model bills; the output says which one ran.

import { readFileSync } from 'node:fs';

async function tokenizer() {
  try {
    const { countTokens } = await import('@anthropic-ai/tokenizer');
    return { name: '@anthropic-ai/tokenizer', count: countTokens };
  } catch {
    return { name: 'chars/4', count: (t) => Math.ceil(t.length / 4) };
  }
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const median = n === 0 ? 0 : n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { n, total: s.reduce((a, b) => a + b, 0), median };
}

async function count(msgFile, encFile, showRows) {
  const tok = await tokenizer();
  const msgs = JSON.parse(readFileSync(msgFile, 'utf8'));
  if (!encFile) {
    const s = stats(msgs.map((m) => tok.count(m.text)));
    console.log(JSON.stringify({ tokenizer: tok.name, messages: s }, null, 2));
    return;
  }
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const rows = [];
  for (const { id, enc } of JSON.parse(readFileSync(encFile, 'utf8'))) {
    const m = byId.get(id);
    if (!m) { console.error(`unknown id ${id}`); continue; }
    const before = tok.count(m.text);
    const after = tok.count(enc);
    rows.push({ id, before, after, saved: 1 - after / before });
  }
  const b = stats(rows.map((r) => r.before));
  const a = stats(rows.map((r) => r.after));
  console.log(JSON.stringify({
    tokenizer: tok.name,
    before: b,
    after: a,
    totalSaving: +(1 - a.total / b.total).toFixed(4),
    medianPerMessageSaving: +stats(rows.map((r) => r.saved)).median.toFixed(4),
  }, null, 2));
  if (showRows) {
    for (const r of rows.sort((x, y) => x.saved - y.saved)) {
      console.log(`${r.id} ${r.before} -> ${r.after} (${(r.saved * 100).toFixed(0)}%)`);
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest.splice(i, 2)[1] : undefined; };
if (cmd === 'count') {
  const showRows = rest.includes('--rows');
  const encFile = flag('--enc');
  await count(rest.filter((x) => x !== '--rows')[0], encFile, showRows);
} else {
  console.error('usage: measure.mjs count <messages.json> [--enc encodings.json] [--rows]');
  process.exit(2);
}
