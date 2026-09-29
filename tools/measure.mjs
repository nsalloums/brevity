#!/usr/bin/env node
// brevity measure: extract agent-to-agent messages from Claude Code transcripts
// and compare token counts before/after encoding.
//
//   node tools/measure.mjs extract <transcript.jsonl>... [--out messages.json]
//   node tools/measure.mjs count <messages.json> [--enc encodings.json] [--rows]
//
// messages.json:  [{ "id": "m001", "dir": "in"|"out", "ts": "...", "peer": "...", "text": "..." }]
// encodings.json: [{ "id": "m001", "enc": "..." }]
//
// Token counts use @anthropic-ai/tokenizer when it is installed
// (npm i -D @anthropic-ai/tokenizer); otherwise they fall back to chars/4.
// Both are approximations of what a current model bills; the output says which one ran.
// Transcripts can contain private data: keep extracted files out of version control.

import { readFileSync, writeFileSync } from 'node:fs';

const ENVELOPE = /<cross-session-message\s+([^>]*)>\n?([\s\S]*?)\n?<\/cross-session-message>/g;

function extract(files) {
  const out = [];
  const seen = new Set();
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const content = e.message?.content;
      if (e.type === 'user') {
        const texts = typeof content === 'string' ? [content]
          : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text) : [];
        for (const t of texts) {
          for (const m of t.matchAll(ENVELOPE)) {
            const peer = m[1].match(/from-name="([^"]*)"/)?.[1] ?? m[1].match(/from="([^"]*)"/)?.[1] ?? '';
            const key = `in|${m[2]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ dir: 'in', ts: e.timestamp, peer, text: m[2] });
          }
        }
      }
      if (e.type === 'assistant' && Array.isArray(content)) {
        for (const b of content) {
          if (b.type !== 'tool_use' || b.name !== 'SendMessage' || !b.input?.message) continue;
          const key = `out|${b.input.message}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ dir: 'out', ts: e.timestamp, peer: b.input.to ?? '', text: b.input.message });
        }
      }
    }
  }
  out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return out.map((m, i) => ({ id: `m${String(i + 1).padStart(3, '0')}`, ...m }));
}

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
    rows.push({ id, dir: m.dir, before, after, saved: 1 - after / before });
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
      console.log(`${r.id} ${r.dir} ${r.before} -> ${r.after} (${(r.saved * 100).toFixed(0)}%)`);
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest.splice(i, 2)[1] : undefined; };
if (cmd === 'extract') {
  const outFile = flag('--out');
  const msgs = extract(rest);
  const json = JSON.stringify(msgs, null, 1);
  if (outFile) writeFileSync(outFile, json); else console.log(json);
  console.error(`${msgs.length} messages (${msgs.filter((m) => m.dir === 'in').length} in, ${msgs.filter((m) => m.dir === 'out').length} out)`);
} else if (cmd === 'count') {
  const showRows = rest.includes('--rows');
  const encFile = flag('--enc');
  await count(rest.filter((x) => x !== '--rows')[0], encFile, showRows);
} else {
  console.error('usage: measure.mjs extract <transcript.jsonl>... [--out file] | count <messages.json> [--enc encodings.json] [--rows]');
  process.exit(2);
}
