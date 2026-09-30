#!/usr/bin/env node
// brevity cost model: does the spec save tokens for a team of sessions, and where should it load?
//
//   node tools/cost-model.mjs [sessions.json] (--saving N | --messages messages.json --enc encodings.json)
//        [--turns N] [--threshold N] [--first uniform|start] [--stub N]
//        [--spec SPEC.md] [--dict DICT.md]... [--no-dict] [--load-tokens N]
//        [--output 5] [--write 1.25] [--read 0.1] [--rows] [--rare 5] [--json]
//
// sessions.json: [{ "name": "hub", "turns": 2000, "sent": 158, "received": 110 }, ...]
//   turns = model calls the session makes; sent, received = messages it exchanges with other sessions.
//   Optional "first": the call at which its first message arrives (see --first).
// messages.json, encodings.json: the tools/measure.mjs format. The saving per message is their mean,
//   tokens before minus tokens after; --saving gives it directly.
//
// Everything is in input-token equivalents: one uncached input token = 1, output 5, cache write 1.25,
// cache read 0.1 (current Claude pricing; --output, --write and --read change them).
//
//   net = sum over messages m:  s_m x (output + write + read x R_sender(m) + read x R_receiver(m))
//       - sum over sessions i:  (S + D) x (write + read x T_i)
//
// s_m = tokens message m saves; R = model calls left in a session after the message; S + D = the spec
// plus dictionary tokens; T_i = calls session i makes after it loads them. The sender's own cache write
// of the message is left out, as in eval/RESULTS.md. The sender's terms count towards the sender's
// session and the recipient's towards the recipient's, which gives the net per session.
//
// S + D counts SPEC.md (this checkout's, or --spec) plus the nearest .brevity/DICT.md and
// .brevity/DICT.local.md at or above the current directory, as the hook finds them (or the --dict
// files; --load-tokens N skips counting). Token counts use @anthropic-ai/tokenizer when it is installed,
// otherwise chars/4.
//
// Policies:
//   always-on      every session loads at its first call (the hook, in a project that opts in)
//   hub-only       only hubs load, at their first call; the others never do, so a message saves only
//                  between two hubs. A hub has at least --threshold messages (default: its own break-even)
//   first-message  a session loads at its first message, sent or received (the skill, on demand), and
//                  carries only --stub tokens before that, or throughout if it has none (default 138: the
//                  skill's name and description)
//   hub+first      hubs load at their first call, the other sessions at their first message
// --first uniform (default): a session's n messages are spread evenly over its calls, the k-th at call
// T*k/(n+1), so the first arrives at T/(n+1). --first start: the first arrives at call 0 (a session
// started by a delegation prompt). A session's "first" field overrides both.
//
// --rows lists the rows of SPEC.md's verb table with their tokens, their cost in each session that
// loads the spec (at --turns calls) and, with --enc, the share of encodings whose body uses each verb.
// Rows used in fewer than --rare % of encodings are flagged as candidates to move to a project
// dictionary. The flag is not a decision: moving a row is a spec change, and needs the evaluation re-run.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PRICES = { output: 5, write: 1.25, read: 0.1 };
export const STUB = 138;
export const POLICIES = ['always-on', 'hub-only', 'first-message', 'hub+first'];

export async function tokenizer() {
  try {
    const { countTokens } = await import('@anthropic-ai/tokenizer');
    return { name: '@anthropic-ai/tokenizer', count: countTokens };
  } catch {
    return { name: 'chars/4', count: (t) => Math.ceil(t.length / 4) };
  }
}

const lf = (t) => t.replace(/\r\n/g, '\n');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
// Tokens carried from a cache write through `calls` later calls.
const carry = (tokens, calls, p) => tokens * (p.write + p.read * calls);
const messages = (s) => s.sent + s.received;

// The call at which a session's first message arrives, or null if it has none.
export function firstCall(s, first = 'uniform') {
  const n = messages(s);
  if (!n) return null;
  if (s.first !== undefined) return Math.min(Math.max(s.first, 0), s.turns);
  return first === 'start' ? 0 : s.turns / (n + 1);
}

// Calls left after each of a session's messages, summed: the first arrives at call F and the other
// n - 1 are spread evenly over the calls after it, at F + (T - F) * k / n.
export function callsLeft(s, F) {
  return ((s.turns - F) * (messages(s) + 1)) / 2;
}

// What a session saves on `sent` and `received` of its messages, each `saving` tokens shorter.
function saved(s, F, sent, received, saving, p) {
  const n = messages(s);
  if (!n || F === null) return 0;
  return saving * (sent * p.output + received * p.write + (p.read * callsLeft(s, F) * (sent + received)) / n);
}

// Messages a session with `turns` calls needs before the spec pays for itself, when it loads at its
// first call and its messages are spread evenly (each carried for turns / 2 calls on average).
export function breakEven({ load, saving, turns, sentShare, prices = PRICES }) {
  const perMessage = saving * (sentShare * prices.output + (1 - sentShare) * prices.write + (prices.read * turns) / 2);
  return perMessage > 0 ? Math.ceil(carry(load, turns, prices) / perMessage) : Infinity;
}

// Who sends how many messages to whom, estimated from each session's totals: iterative proportional
// fitting from "everyone writes to everyone", so row i sums to sessions[i].sent, column j sums to
// sessions[j].received, and no session writes to itself. The extra last row and column stand for
// sessions the file does not list: they take what the listed sessions cannot place among themselves.
// It stops once every session's row is within `tolerance` messages of its total.
export function pairs(sessions, { iterations = 20000, tolerance = 0.01 } = {}) {
  const n = sessions.length;
  const EPS = 1e-4;
  const m = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => {
    if (i === j) return 0;
    if (i === n) return sessions[j].received > 0 ? EPS : 0;
    if (j === n) return sessions[i].sent > 0 ? EPS : 0;
    return sessions[i].sent > 0 && sessions[j].received > 0 ? 1 : 0;
  }));
  const sum = (row) => { let a = 0; for (const v of row) a += v; return a; };
  let converged = false;
  for (let it = 0; it < iterations && !converged; it++) {
    for (let i = 0; i < n; i++) {
      const total = sum(m[i]);
      if (total > 0) for (let j = 0; j <= n; j++) m[i][j] *= sessions[i].sent / total;
    }
    const columns = new Array(n + 1).fill(0);
    for (const row of m) for (let j = 0; j <= n; j++) columns[j] += row[j];
    for (const row of m) for (let j = 0; j < n; j++) if (columns[j] > 0) row[j] *= sessions[j].received / columns[j];
    converged = sessions.every((s, i) => Math.abs(sum(m[i]) - s.sent) <= tolerance);
  }
  return { m, converged };
}

// Net per session and per policy.
export function model(sessions, { load, saving, prices = PRICES, stub = STUB, first = 'uniform', threshold } = {}) {
  const sentShare = (s) => (messages(s) ? s.sent / messages(s) : 0.5);
  const be = sessions.map((s) => breakEven({ load, saving, turns: s.turns, sentShare: sentShare(s), prices }));
  const hub = sessions.map((s, i) => messages(s) >= (threshold ?? be[i]));
  const { m, converged } = pairs(sessions);
  const rows = sessions.map((s, i) => {
    const F = firstCall(s, first);
    const all = { sent: s.sent, received: s.received };
    const withHubs = {
      sent: sessions.reduce((a, _, j) => a + (hub[j] ? m[i][j] : 0), 0),
      received: sessions.reduce((a, _, j) => a + (hub[j] ? m[j][i] : 0), 0),
    };
    const onDemand = { at: F, stub: true, ...all };
    const plans = {
      'always-on': { at: 0, ...all },
      'hub-only': hub[i] ? { at: 0, ...withHubs } : { at: null, sent: 0, received: 0 },
      'first-message': onDemand,
      'hub+first': hub[i] ? { at: 0, ...all } : onDemand,
    };
    const net = {};
    const detail = {};
    for (const policy of POLICIES) {
      // The policy sets when the session loads; its messages arrive when they arrive.
      const plan = plans[policy];
      const cost = (plan.at === null ? 0 : carry(load, s.turns - plan.at, prices)) + (plan.stub ? carry(stub, s.turns, prices) : 0);
      const gain = plan.at === null ? 0 : saved(s, F, plan.sent, plan.received, saving, prices);
      net[policy] = gain - cost;
      detail[policy] = { loadsAt: plan.at, saved: gain, cost, savedMessages: plan.sent + plan.received };
    }
    return { ...s, breakEven: be[i], hub: hub[i], firstMessageAt: F, net, detail };
  });
  const policies = POLICIES.map((name) => ({
    name,
    net: rows.reduce((a, r) => a + r.net[name], 0),
    saved: rows.reduce((a, r) => a + r.detail[name].saved, 0),
    cost: rows.reduce((a, r) => a + r.detail[name].cost, 0),
    loading: rows.filter((r) => r.detail[name].loadsAt !== null).length,
  }));
  return { sessions: rows, policies, hubs: hub.filter(Boolean).length, pairsConverged: converged };
}

// Rows of SPEC.md's verb table (the table whose header starts with "verb"), with the verbs each defines:
// "`ASK x?` / `A1 x`" defines ASK and A1.
export function verbRows(spec) {
  const lines = lf(spec).split('\n');
  const start = lines.findIndex((l) => /^\|\s*verb\s*\|/i.test(l));
  if (start < 0) return [];
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('|')) break;
    if (/^\|[\s|:-]+$/.test(line)) continue;
    const verbs = [...new Set([...line.split('|')[1].matchAll(/`([A-Z][A-Z0-9]*)\b/g)].map((x) => x[1]))];
    if (verbs.length) rows.push({ line, verbs });
  }
  return rows;
}

// Whether an encoding's body (the lines after line 1) has a statement that starts with `verb`: at the
// start of a line (after `- ` or `1. `), after `;`, or after an actor (`@abc123 WILL x`). `> ` prose does
// not count. A1 stands for A1, A2 ...; ASK also matches ASK1, ASK2.
export function uses(enc, verb) {
  const name = /^[A-Z]+\d+$/.test(verb) ? `${verb.match(/^[A-Z]+/)[0]}\\d+` : `${verb}\\d*`;
  const re = new RegExp(`^(?:@(?:«[^»]*»|\\S+)\\s+)?${name}(?![\\w-])`);
  return lf(enc).split('\n').slice(1)
    .filter((l) => !/^\s*>/.test(l))
    .flatMap((l) => l.replace(/^\s*(?:-|\d+\.)\s+/, '').split(';'))
    .some((part) => re.test(part.trim()));
}

export function rowReport(spec, count, { turns, prices = PRICES, encodings, rare = 5, sessions } = {}) {
  return verbRows(spec).map(({ line, verbs }) => {
    const tokens = count(`${line}\n`);
    const row = { verbs, tokens, perSession: carry(tokens, turns, prices) };
    if (sessions?.length) row.team = sessions.reduce((a, s) => a + carry(tokens, s.turns, prices), 0);
    if (encodings) {
      const share = (hit) => (encodings.length ? (100 * encodings.filter(hit).length) / encodings.length : 0);
      row.used = share((e) => verbs.some((v) => uses(e.enc, v)));
      row.byVerb = Object.fromEntries(verbs.map((v) => [v, share((e) => uses(e.enc, v))]));
      row.candidate = row.used < rare;
    }
    return row;
  });
}

// The nearest `rel` at or above `start`, as the hook looks for dictionaries.
function nearest(rel, start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, rel))) return join(dir, rel);
    if (dirname(dir) === dir) return null;
  }
}

function parseArgs(argv) {
  const opts = { dict: [] };
  const positional = [];
  const valued = ['--saving', '--messages', '--enc', '--turns', '--threshold', '--first', '--stub', '--spec', '--dict',
    '--load-tokens', '--output', '--write', '--read', '--rare'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valued.includes(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      const key = a.slice(2);
      if (key === 'dict') opts.dict.push(argv[++i]);
      else opts[key] = argv[++i];
    } else if (['--rows', '--json', '--no-dict'].includes(a)) opts[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else positional.push(a);
  }
  const num = (key, min = 0) => {
    if (opts[key] === undefined) return;
    const v = Number(opts[key]);
    if (!Number.isFinite(v) || v < min) throw new Error(`--${key} must be a number >= ${min}`);
    opts[key] = v;
  };
  for (const key of ['saving', 'turns', 'threshold', 'stub', 'load-tokens', 'output', 'write', 'read', 'rare']) num(key);
  if (opts.first !== undefined && !['uniform', 'start'].includes(opts.first)) throw new Error('--first must be uniform or start');
  if (positional.length > 1) throw new Error(`one sessions file, got ${positional.join(', ')}`);
  return { ...opts, sessionsFile: positional[0] };
}

function readSessions(file) {
  const list = readJson(file);
  if (!Array.isArray(list)) throw new Error(`${file}: expected an array of sessions`);
  return list.map((s, i) => {
    const where = `${file}: session ${s?.name ?? i}`;
    const out = { name: String(s?.name ?? `s${i + 1}`) };
    for (const key of ['turns', 'sent', 'received']) {
      if (!(Number.isFinite(s?.[key]) && s[key] >= 0)) throw new Error(`${where}: "${key}" must be a number >= 0`);
      out[key] = s[key];
    }
    if (s.first !== undefined) {
      if (!(Number.isFinite(s.first) && s.first >= 0)) throw new Error(`${where}: "first" must be a number >= 0`);
      out.first = s.first;
    }
    return out;
  });
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const fmt = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : 'never');
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
const signed = (x) => (x > 0 ? `+${fmt(x)}` : fmt(x));
const pct = (x) => `${x < 1 && x > 0 ? x.toFixed(1) : Math.round(x)}%`;
const table = (rows) => {
  const width = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  return rows.map((r) => r.map((v, c) => (c === 0 ? String(v).padEnd(width[c]) : String(v).padStart(width[c]))).join('  ').trimEnd()).join('\n');
};

export async function run(argv, { cwd = process.cwd() } = {}) {
  const o = parseArgs(argv);
  const tok = await tokenizer();
  const prices = { output: o.output ?? PRICES.output, write: o.write ?? PRICES.write, read: o.read ?? PRICES.read };
  const specFile = o.spec ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'SPEC.md');
  const readSpec = () => lf(readFileSync(specFile, 'utf8'));

  // S + D.
  let load;
  if (o['load-tokens'] !== undefined) load = { tokens: o['load-tokens'], files: [], source: '--load-tokens' };
  else {
    const dicts = o['no-dict'] ? [] : o.dict.length ? o.dict : ['.brevity/DICT.md', '.brevity/DICT.local.md'].map((rel) => nearest(rel, cwd)).filter(Boolean);
    const files = [specFile, ...dicts].map((file) => ({ file, tokens: tok.count(lf(readFileSync(file, 'utf8'))) }));
    load = { tokens: files.reduce((a, f) => a + f.tokens, 0), files, source: 'files' };
  }

  // s.
  let saving;
  let encodings;
  if (o.enc) encodings = readJson(o.enc);
  if (o.messages && !o.enc) throw new Error('--messages needs --enc');
  if (o.saving !== undefined) saving = { tokens: o.saving, source: '--saving' };
  else if (o.messages) {
    const text = new Map(readJson(o.messages).map((m) => [m.id, m.text]));
    const diffs = encodings.filter((e) => text.has(e.id)).map((e) => tok.count(text.get(e.id)) - tok.count(e.enc));
    if (!diffs.length) throw new Error(`no id in ${o.enc} matches ${o.messages}`);
    saving = { tokens: diffs.reduce((a, b) => a + b, 0) / diffs.length, source: 'messages', messages: diffs.length };
  }

  const sessions = o.sessionsFile ? readSessions(o.sessionsFile) : null;
  if (!saving && (sessions || !o.rows)) {
    throw new Error('give the saving per message: --saving N (eval/RESULTS.md measured 65), or --messages and --enc');
  }
  const turns = o.turns ?? (sessions?.length ? median(sessions.map((s) => s.turns)) : 200);
  const result = { tokenizer: tok.name, prices, load, saving, turns };

  if (saving) {
    const at = (sentShare) => breakEven({ load: load.tokens, saving: saving.tokens, turns, sentShare, prices });
    result.breakEven = { turns, allSent: at(1), allReceived: at(0), half: at(0.5) };
  }
  if (sessions && saving) {
    const first = o.first ?? 'uniform';
    const r = model(sessions, { load: load.tokens, saving: saving.tokens, prices, stub: o.stub ?? STUB, first, threshold: o.threshold });
    result.stub = o.stub ?? STUB;
    result.first = first;
    result.threshold = o.threshold ?? 'own break-even';
    Object.assign(result, r);
    result.best = [...r.policies].sort((a, b) => b.net - a.net)[0].name;
  }
  if (o.rows) {
    result.rare = o.rare ?? 5;
    result.rows = rowReport(readSpec(), tok.count, { turns, prices, encodings, rare: result.rare, sessions });
    result.rowsEncodings = encodings?.length;
  }
  result.assumptions = [
    'messages are spread evenly over a session\'s calls: the k-th of n at call T*k/(n+1), so the first at T/(n+1)'
      + ' (a session\'s "first" field or --first start moves the first)',
    'a message saves only when both sessions have loaded the spec; sessions the file does not list load it under'
      + ' every policy except hub-only',
    'hub-only pairs messages in proportion to each session\'s sent and received totals, no session writing to itself;'
      + ' what the listed sessions cannot place among themselves goes to unlisted sessions',
    'the cache stays warm: the spec is written once and read on every later call',
    'the sender\'s own cache write of its message is left out, as in eval/RESULTS.md',
  ];
  return result;
}

export function render(r) {
  const out = [];
  const p = r.prices;
  out.push(`brevity cost model, in input-token equivalents (output ${p.output}x, cache write ${p.write}x, cache read ${p.read}x an input token)`);
  const parts = r.load.files.map((f) => `${basename(f.file)} ${fmt(f.tokens)}`).join(' + ');
  out.push(`loaded per session: ${fmt(r.load.tokens)} tokens${parts ? ` = ${parts} (${r.tokenizer})` : ' (--load-tokens)'}`);
  if (r.saving) {
    const how = r.saving.source === 'messages' ? `mean of ${r.saving.messages} messages, ${r.tokenizer}` : '--saving';
    out.push(`saving per message: ${+r.saving.tokens.toFixed(1)} tokens (${how})`);
  }
  if (r.breakEven) {
    const b = r.breakEven;
    out.push('', `break-even for a session with ${fmt(b.turns)} calls that loads at its first call:`,
      `  ${fmt(b.allSent)} messages if it sends them all, ${fmt(b.allReceived)} if it receives them all, ${fmt(b.half)} half and half`);
  }
  if (r.policies) {
    const n = r.sessions.length;
    const others = n - r.hubs;
    const loads = {
      'always-on': `${n} from call 0`,
      'hub-only': `${r.hubs} from call 0`,
      'first-message': `${r.policies[2].loading} from first message; ${n} carry the stub`,
      'hub+first': `${r.hubs} from call 0, ${r.policies[3].loading - r.hubs} from first message; ${others} carry the stub`,
    };
    const sent = r.sessions.reduce((a, s) => a + s.sent, 0);
    const received = r.sessions.reduce((a, s) => a + s.received, 0);
    out.push('', `team: ${plural(n, 'session')}, ${plural(sent, 'message')} sent, ${fmt(received)} received`);
    if (sent !== received) out.push(`note: sent and received differ by ${fmt(Math.abs(sent - received))}, so some messages ${sent > received ? 'go to' : 'come from'} sessions the file does not list`);
    out.push(`hub: a session with ${typeof r.threshold === 'number' ? `at least ${fmt(r.threshold)} messages` : 'at least its own break-even in messages (--threshold N sets one count)'}; ${r.hubs} of ${n}`);
    out.push(`stub: the ${fmt(r.stub)} tokens a session carries so it can load on its first message (the skill's name and description)`);
    out.push(table([['policy', 'sessions that load', 'saved', 'cost', 'net'],
      ...r.policies.map((x) => [x.name, loads[x.name], fmt(x.saved), fmt(x.cost), signed(x.net)])]));
    const best = r.policies.find((x) => x.name === r.best);
    out.push(best.net > 0
      ? `highest net: ${best.name} (${signed(best.net)}). A model, not a decision: check the assumptions below.`
      : `every policy costs more than it saves: not loading brevity (net 0) beats the best, ${best.name} (${signed(best.net)}).`);
    if (r.hubs < 2) out.push(`hub-only saves nothing with ${r.hubs ? 'one hub' : 'no hubs'}: a message saves only between two sessions that loaded the spec.`);
    out.push('', 'net per session (0 = no brevity):');
    out.push(table([['session', 'calls', 'sent', 'received', 'break-even', 'hub', ...POLICIES],
      ...r.sessions.map((s) => [s.name, fmt(s.turns), fmt(s.sent), fmt(s.received), fmt(s.breakEven), s.hub ? 'yes' : '', ...POLICIES.map((k) => signed(s.net[k]))]),
      ['total', '', '', '', '', '', ...r.policies.map((x) => signed(x.net))]]));
    if (!r.pairsConverged) out.push('warning: the sent and received totals did not settle into pairs; hub-only is approximate');
  }
  if (r.rows) {
    const total = r.rows.reduce((a, x) => a + x.tokens, 0);
    const spec = r.load.files[0]?.tokens;
    out.push('', `SPEC.md verb table: ${r.rows.length} rows, ${fmt(total)} tokens${spec ? ` (${pct((100 * total) / spec)} of SPEC.md)` : ''}; per session = tokens x ${+(p.write + p.read * r.turns).toFixed(2)} at ${fmt(r.turns)} calls`);
    const head = ['row', 'tokens', 'per session', ...(r.rows[0]?.team !== undefined ? ['team, always-on'] : []), ...(r.rowsEncodings !== undefined ? ['used in', ''] : [])];
    out.push(table([head, ...r.rows.map((x) => [
      x.verbs.join(' / '), fmt(x.tokens), fmt(x.perSession),
      ...(x.team !== undefined ? [fmt(x.team)] : []),
      ...(x.used !== undefined ? [x.verbs.length > 1 ? `${pct(x.used)} (${x.verbs.map((v) => `${v} ${pct(x.byVerb[v])}`).join(', ')})` : pct(x.used), x.candidate ? 'candidate: move to a project dictionary?' : ''] : []),
    ])]));
    if (r.rowsEncodings !== undefined) {
      out.push(`used in = share of the ${r.rowsEncodings} encodings whose body has a statement with that verb. Rows under ${r.rare}% are flagged;`,
        'a flag is not a decision: moving a row out of SPEC.md is a spec change and needs the evaluation re-run (AGENTS.md).');
    } else out.push('give --enc encodings.json to see how often each row is used.');
  }
  out.push('', 'assumptions:', ...r.assumptions.map((a) => `- ${a}`));
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const r = await run(process.argv.slice(2));
    console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
  } catch (e) {
    console.error(`error: ${e.message}`);
    console.error('usage: cost-model.mjs [sessions.json] (--saving N | --messages messages.json --enc encodings.json) [--rows] [--json]; see the header of tools/cost-model.mjs');
    process.exit(2);
  }
}
