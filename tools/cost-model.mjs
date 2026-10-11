#!/usr/bin/env node
// brevity cost model: does the spec save tokens for a team of sessions, and where should it load?
//
//   node tools/cost-model.mjs [sessions.json] (--saving N | --messages messages.json --enc encodings.json)
//        [--turns N] [--threshold N] [--first uniform|start] [--stub N] [--reader-tokens N [--reader-writes]]
//        [--spec SPEC.md] [--dict DICT.md]... [--no-dict] [--load-tokens N]
//        [--model claude-opus-5-5] [--output 5] [--write 2] [--read R]
//        [--reinject N] [--reinject-every N] [--idle-misses R] [--skill-entry N] [--rows] [--rare 5] [--json]
//
// sessions.json: [{ "name": "hub", "turns": 2000, "sent": 158, "received": 110 }, ...]
//   turns = model calls the session makes; sent, received = messages it exchanges with other sessions.
//   Optional "first": the call at which its first message arrives (see --first).
// messages.json, encodings.json: the tools/measure.mjs format. The saving per message is their mean,
//   tokens before minus tokens after; --saving gives it directly.
//
// Everything is in input-token equivalents: one uncached input token = 1, output 5, cache write 2, and a cache
// read at the price of --model: 0.05 on claude-opus-5-5, 0.025 on claude-fable-5-1 and claude-mythos-5-1, 0.1 on
// any other model (Anthropic's prices, as tools/meter.mjs uses them). The default model is claude-opus-5-5, which
// made every call measured in issue #11. The write price is the 1-hour rate, which Claude Code paid for every
// cache write measured there; --write 1.25 gives 5-minute caching. --output, --write and --read override a price.
//
//   net = sum over messages m:  s_m x (output + write + r x R_sender(m) + r x R_receiver(m))
//       - sum over sessions i:  (S + D + E) x (write x (1 + C_i) + r x T_i)
//
// s_m = tokens message m saves; R = model calls left in a session after the message; S + D = the spec
// plus dictionary tokens; E = the skill entry; T_i = calls session i makes after it loads them; C_i = its extra
// copies; r = the read price, raised by idle misses (both below; 0 by default). The sender's own cache write
// of the message is left out, as in eval/RESULTS.md. The sender's terms count towards the sender's
// session and the recipient's towards the recipient's, which gives the net per session.
//
// Costs that the defaults leave out, each an option. tools/meter.mjs measures all of them, call by call, from a
// team's own transcripts, so it is the tool for a real team:
//   --reinject N        N extra copies per session (default 0): the hook loads the spec again after each
//                       compaction and resume. A copy is one more cache write of what the session carries; the
//                       compaction or resume drops the old copy, so the reads do not change. Copies fall evenly
//                       over a session's calls, so one that loads at call F pays N x (T - F) / T of them.
//   --reinject-every N  one extra copy at calls N, 2N, ... before a session's last call (default: none), as when
//                       the context fills every N calls. A session pays those after the call at which it loads.
//   --idle-misses R     the share of calls, 0 to 1, that follow an idle gap longer than the cache lifetime
//                       (default 0: a warm cache). Such a call writes its whole prefix again, so loaded context
//                       and carried messages alike cost r = read + R x (write - read) per call.
//   --skill-entry N     the tokens of the plugin's entry in the skill listing (default 0; 143 in the legacy
//                       count for the Claude Code plugin). The plugin lists the skill in every session, so each
//                       session carries the entry from its first call under every policy, and net 0 means no
//                       plugin. Where a policy carries the stub, the stub is that entry and counts once. The
//                       break-even that makes a session a hub leaves the entry out, since a session pays it
//                       loaded or not; the output adds the break-even against no plugin, with the entry.
// Left out even then: a compaction or resume also drops messages before the session ends, which cuts the saving.
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
//   hub+reader     only with --reader-tokens N: hubs load the spec and dictionaries at their first call;
//                  the other sessions load a reader card of N tokens at the first message they receive,
//                  and carry the stub. A reader card only decodes, so readers write in prose and their
//                  messages save nothing; --reader-writes lets them write brevity too (they then load it at
//                  their first message, sent or received). The output gives the largest card that keeps
//                  hub+reader above 0.
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

// Cache-read prices per model, by model id prefix, as in tools/meter.mjs; any other model reads at DEFAULT_READ.
export const READ_PRICES = { 'claude-opus-5-5': 0.05, 'claude-fable-5-1': 0.025, 'claude-mythos-5-1': 0.025 };
export const DEFAULT_READ = 0.1;
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const SKILL_ENTRY = 143;
export const STUB = 138;
export const POLICIES = ['always-on', 'hub-only', 'first-message', 'hub+first'];
export const EXTRAS = { reinject: 0, reinjectEvery: null, idleMisses: 0, skillEntry: 0 };

export function readPrice(model) {
  const key = Object.keys(READ_PRICES).find((k) => String(model ?? '').startsWith(k));
  return key ? READ_PRICES[key] : DEFAULT_READ;
}

export const PRICES = { output: 5, write: 2, read: readPrice(DEFAULT_MODEL) };

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
const messages = (s) => s.sent + s.received;

// What a token in context costs per call: the read price, or the write price on calls after an idle miss.
const perCall = (p, x) => p.read + (x.idleMisses ?? 0) * (p.write - p.read);

// Extra copies in a session with `turns` calls that loads at call `at`: its share of --reinject, and the calls
// N, 2N, ... of --reinject-every that come after `at` and before its last call.
export function copies(turns, at, x = EXTRAS) {
  const spread = x.reinject && turns > 0 ? (x.reinject * (turns - at)) / turns : 0;
  const N = x.reinjectEvery;
  const every = N ? Math.max(0, Math.ceil(turns / N) - 1 - Math.floor(at / N)) : 0;
  return spread + every;
}

// Tokens a session loads at call `at` and carries to its last call: written then and at each extra copy, and
// read on every later call.
export function held(tokens, turns, at, p = PRICES, x = EXTRAS) {
  return tokens * (p.write * (1 + copies(turns, at, x)) + perCall(p, x) * (turns - at));
}

// The call at which a session's first message arrives, or null if it has none.
export function firstCall(s, first = 'uniform') {
  const n = messages(s);
  if (!n) return null;
  if (s.first !== undefined) return Math.min(Math.max(s.first, 0), s.turns);
  return first === 'start' ? 0 : s.turns / (n + 1);
}

// The call at which a session receives its first message, or null if it receives none. Received messages
// are spread like the rest, so the first of r arrives at T/(r+1); --first start and "first" as above.
export function firstReceived(s, first = 'uniform') {
  if (!s.received) return null;
  if (s.first !== undefined) return Math.min(Math.max(s.first, 0), s.turns);
  return first === 'start' ? 0 : s.turns / (s.received + 1);
}

// Calls left after each of a session's messages, summed: the first arrives at call F and the other
// n - 1 are spread evenly over the calls after it, at F + (T - F) * k / n.
export function callsLeft(s, F) {
  return ((s.turns - F) * (messages(s) + 1)) / 2;
}

// What a session saves on `sent` and `received` of its messages, each `saving` tokens shorter.
function saved(s, F, sent, received, saving, p, x) {
  const n = messages(s);
  if (!n || F === null) return 0;
  return saving * (sent * p.output + received * p.write + (perCall(p, x) * callsLeft(s, F) * (sent + received)) / n);
}

// Messages a session with `turns` calls needs before the spec pays for itself, when it loads at its first call and
// its messages are spread evenly (each carried for turns / 2 calls on average). With extras.skillEntry, the entry
// counts too: that is the break-even against no plugin, not the marginal cost of loading.
export function breakEven({ load, saving, turns, sentShare, prices = PRICES, extras }) {
  const x = { ...EXTRAS, ...extras };
  const perMessage = saving * (sentShare * prices.output + (1 - sentShare) * prices.write + (perCall(prices, x) * turns) / 2);
  return perMessage > 0 ? Math.ceil(held(load + x.skillEntry, turns, 0, prices, x) / perMessage) : Infinity;
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

// Net per session and per policy; with `reader` (tokens), also hub+reader. `extras` holds the costs above that
// the defaults leave out: { reinject, reinjectEvery, idleMisses, skillEntry }.
export function model(sessions, {
  load, saving, prices = PRICES, stub = STUB, first = 'uniform', threshold, reader, readerWrites = false, extras,
} = {}) {
  const x = { ...EXTRAS, ...extras };
  const used = reader === undefined ? POLICIES : [...POLICIES, 'hub+reader'];
  const sentShare = (s) => (messages(s) ? s.sent / messages(s) : 0.5);
  // A hub's messages pay for loading the spec. The skill entry is no part of that: every session carries it, loaded
  // or not.
  const loading = { ...x, skillEntry: 0 };
  const be = sessions.map((s) => breakEven({ load, saving, turns: s.turns, sentShare: sentShare(s), prices, extras: loading }));
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
    if (reader !== undefined) {
      // Hubs write to everyone who can read; a session receives brevity only from hubs, unless readers write.
      const received = readerWrites ? s.received : withHubs.received;
      plans['hub+reader'] = hub[i] ? { at: 0, sent: s.sent, received }
        : readerWrites ? { ...onDemand, tokens: reader }
        : { at: firstReceived(s, first), tokens: reader, stub: true, sent: 0, received };
    }
    const net = {};
    const detail = {};
    for (const policy of used) {
      // The policy sets when the session loads; its messages arrive when they arrive. A session that does not
      // carry the stub still carries the skill entry.
      const plan = plans[policy];
      const cost = (plan.at === null ? 0 : held(plan.tokens ?? load, s.turns, plan.at, prices, x))
        + held(plan.stub ? stub : x.skillEntry, s.turns, 0, prices, x);
      const gain = plan.at === null ? 0 : saved(s, F, plan.sent, plan.received, saving, prices, x);
      net[policy] = gain - cost;
      detail[policy] = { loadsAt: plan.at, saved: gain, cost, savedMessages: plan.sent + plan.received };
    }
    return { ...s, breakEven: be[i], hub: hub[i], firstMessageAt: F, net, detail };
  });
  const policies = used.map((name) => ({
    name,
    net: rows.reduce((a, r) => a + r.net[name], 0),
    saved: rows.reduce((a, r) => a + r.detail[name].saved, 0),
    cost: rows.reduce((a, r) => a + r.detail[name].cost, 0),
    loading: rows.filter((r) => r.detail[name].loadsAt !== null).length,
  }));
  const result = { sessions: rows, policies, hubs: hub.filter(Boolean).length, pairsConverged: converged };
  if (reader !== undefined) {
    // hub+reader's net falls by `perToken` for every token of the card; readerMax is where it reaches 0.
    const perToken = rows.reduce((a, r, i) => {
      const at = r.detail['hub+reader'].loadsAt;
      return a + (hub[i] || at === null ? 0 : held(1, r.turns, at, prices, x));
    }, 0);
    const atZero = policies[policies.length - 1].net + reader * perToken;
    const readerMax = perToken > 0 ? Math.max(0, atZero / perToken) : null; // null: no session loads the card
    Object.assign(result, { reader, readerWrites, readerMax, readerNetAtZero: atZero });
  }
  return result;
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

export function rowReport(spec, count, { turns, prices = PRICES, extras, encodings, rare = 5, sessions } = {}) {
  const x = { ...EXTRAS, ...extras };
  return verbRows(spec).map(({ line, verbs }) => {
    const tokens = count(`${line}\n`);
    const row = { verbs, tokens, perSession: held(tokens, turns, 0, prices, x) };
    if (sessions?.length) row.team = sessions.reduce((a, s) => a + held(tokens, s.turns, 0, prices, x), 0);
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
    '--load-tokens', '--model', '--output', '--write', '--read', '--rare', '--reader-tokens', '--reinject', '--reinject-every',
    '--idle-misses', '--skill-entry'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valued.includes(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      const key = a.slice(2);
      if (key === 'dict') opts.dict.push(argv[++i]);
      else opts[key] = argv[++i];
    } else if (['--rows', '--json', '--no-dict', '--reader-writes'].includes(a)) opts[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else positional.push(a);
  }
  const num = (key, min = 0) => {
    if (opts[key] === undefined) return;
    const v = Number(opts[key]);
    if (!Number.isFinite(v) || v < min) throw new Error(`--${key} must be a number >= ${min}`);
    opts[key] = v;
  };
  for (const key of ['saving', 'turns', 'threshold', 'stub', 'load-tokens', 'output', 'write', 'read', 'rare', 'reader-tokens',
    'reinject', 'reinject-every', 'idle-misses', 'skill-entry']) num(key);
  if (opts['reinject-every'] !== undefined && !(Number.isInteger(opts['reinject-every']) && opts['reinject-every'] > 0)) {
    throw new Error('--reinject-every must be a whole number > 0');
  }
  if (opts['idle-misses'] > 1) throw new Error('--idle-misses is a share of calls, from 0 to 1');
  if (opts.model !== undefined && !opts.model.trim()) throw new Error('--model needs a model id, such as claude-opus-5-5');
  if (opts['reader-writes'] && opts['reader-tokens'] === undefined) throw new Error('--reader-writes needs --reader-tokens');
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
  const modelId = o.model ?? DEFAULT_MODEL;
  const prices = { output: o.output ?? PRICES.output, write: o.write ?? PRICES.write, read: o.read ?? readPrice(modelId) };
  // Where each price came from, for the output.
  const priced = {
    model: o.model === undefined ? 'default' : '--model',
    output: o.output === undefined ? 'default' : '--output',
    write: o.write === undefined ? 'default' : '--write',
    read: o.read === undefined ? 'model' : '--read',
  };
  const extras = {
    reinject: o.reinject ?? EXTRAS.reinject, reinjectEvery: o['reinject-every'] ?? EXTRAS.reinjectEvery,
    idleMisses: o['idle-misses'] ?? EXTRAS.idleMisses, skillEntry: o['skill-entry'] ?? EXTRAS.skillEntry,
  };
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
    throw new Error('give the saving per message: --saving N (eval/RESULTS.md measured 60), or --messages and --enc');
  }
  const turns = o.turns ?? (sessions?.length ? median(sessions.map((s) => s.turns)) : 200);
  const result = { tokenizer: tok.name, model: modelId, prices, priced, extras, load, saving, turns };

  if (saving) {
    const at = (sentShare, e) => breakEven({ load: load.tokens, saving: saving.tokens, turns, sentShare, prices, extras: e });
    const loading = { ...extras, skillEntry: 0 };
    result.breakEven = { turns, allSent: at(1, loading), allReceived: at(0, loading), half: at(0.5, loading) };
    if (extras.skillEntry) result.breakEvenNoPlugin = { allSent: at(1, extras), allReceived: at(0, extras), half: at(0.5, extras) };
  }
  if (sessions && saving) {
    const first = o.first ?? 'uniform';
    const r = model(sessions, {
      load: load.tokens, saving: saving.tokens, prices, stub: o.stub ?? STUB, first, threshold: o.threshold,
      reader: o['reader-tokens'], readerWrites: !!o['reader-writes'], extras,
    });
    result.stub = o.stub ?? STUB;
    result.first = first;
    result.threshold = o.threshold ?? 'own break-even';
    Object.assign(result, r);
    result.best = [...r.policies].sort((a, b) => b.net - a.net)[0].name;
  }
  if (o.rows) {
    result.rare = o.rare ?? 5;
    result.rows = rowReport(readSpec(), tok.count, { turns, prices, extras, encodings, rare: result.rare, sessions });
    result.rowsEncodings = encodings?.length;
  }
  result.assumptions = [
    'messages are spread evenly over a session\'s calls: the k-th of n at call T*k/(n+1), so the first at T/(n+1)'
      + ' (a session\'s "first" field or --first start moves the first)',
    'a message saves only when both sessions have loaded the spec; sessions the file does not list load it under'
      + ' every policy except hub-only',
    `${result.reader === undefined ? 'hub-only pairs' : 'hub-only and hub+reader pair'} messages in proportion to each`
      + ' session\'s sent and received totals, no session writing to itself; what the listed sessions cannot place'
      + ' among themselves goes to unlisted sessions',
    extras.idleMisses || extras.reinject || extras.reinjectEvery
      ? 'loaded context is written when a session loads it and at each extra copy, and read on every later call;'
        + ' carried messages are read the same way, and idle misses raise both to the write price on their share of calls'
      : 'the cache stays warm and a session holds one copy: the spec is written once and read on every later call',
    'messages stay in context to the end of the session: a compaction or resume that drops them sooner cuts the'
      + ' saving, and is left out',
    extras.skillEntry
      ? 'the plugin lists the skill in every session: each carries the skill entry, or the stub in its place, and net 0'
        + ' means no plugin'
      : 'no skill entry: a session that loads nothing carries nothing',
    'the sender\'s own cache write of its message is left out, as in eval/RESULTS.md',
  ];
  if (result.reader !== undefined) {
    result.assumptions.push(result.readerWrites
      ? 'hub+reader: readers read and write brevity with the card, and load it at their first message'
      : 'hub+reader: a reader card only decodes, so readers write in prose; they load it at the first message they'
        + ' receive (the first of r at T/(r+1)), and sessions the file does not list act as readers');
  }
  return result;
}

// Where the prices came from, and which of the costs the defaults leave out this run adds.
function sources(r) {
  const s = r.priced;
  const read = s.read === '--read' ? 'cache read from --read'
    : `cache read for ${r.model} (${s.model === 'default' ? 'the default; --model names another' : '--model'})`;
  const write = s.write === '--write' ? 'cache write from --write' : 'cache write at the 1-hour rate (--write 1.25 for 5-minute caching)';
  return `${read}, ${write}${s.output === '--output' ? ', output from --output' : ''}`;
}

function extraCosts(x) {
  const n = (v) => String(+v.toFixed(3));
  const reinject = x.reinject || x.reinjectEvery
    ? [x.reinject ? `${n(x.reinject)} extra ${x.reinject === 1 ? 'copy' : 'copies'} per session (--reinject)` : '',
      x.reinjectEvery ? `one extra copy every ${fmt(x.reinjectEvery)} calls (--reinject-every)` : ''].filter(Boolean).join(' and ')
    : 'no re-injected copies (--reinject N per session, --reinject-every N calls)';
  const idle = x.idleMisses ? `idle cache misses on ${n(100 * x.idleMisses)}% of calls (--idle-misses)` : 'no idle cache misses (--idle-misses R)';
  const entry = x.skillEntry ? `a ${fmt(x.skillEntry)}-token skill entry in every session (--skill-entry)`
    : `no skill entry (--skill-entry ${SKILL_ENTRY} for the Claude Code plugin)`;
  return `${reinject}, ${idle}, ${entry}`;
}

export function render(r) {
  const out = [];
  const p = r.prices;
  out.push(`brevity cost model, in input-token equivalents (output ${p.output}x, cache write ${p.write}x, cache read ${p.read}x an input token)`);
  out.push(`prices: ${sources(r)}`);
  out.push(`extra costs: ${extraCosts(r.extras)}`);
  out.push('tools/meter.mjs measures these costs from a team\'s own transcripts, call by call: for a real team, use it.');
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
    const e = r.breakEvenNoPlugin;
    if (e) {
      out.push(`  against no plugin, counting the ${fmt(r.extras.skillEntry)}-token skill entry that every session carries: `
        + `${fmt(e.allSent)} if it sends them all, ${fmt(e.allReceived)} if it receives them all, ${fmt(e.half)} half and half`);
    }
  }
  if (r.policies) {
    const n = r.sessions.length;
    const others = n - r.hubs;
    const loads = {
      'always-on': `${n} from call 0`,
      'hub-only': `${r.hubs} from call 0`,
      'first-message': `${r.policies[2].loading} from first message; ${n} carry the stub`,
      'hub+first': `${r.hubs} from call 0, ${r.policies[3].loading - r.hubs} from first message; ${others} carry the stub`,
      'hub+reader': `${r.hubs} from call 0, ${(r.policies[4]?.loading ?? 0) - r.hubs} readers from first ${r.readerWrites ? '' : 'received '}message; ${others} carry the stub`,
    };
    const names = r.policies.map((x) => x.name);
    const sent = r.sessions.reduce((a, s) => a + s.sent, 0);
    const received = r.sessions.reduce((a, s) => a + s.received, 0);
    out.push('', `team: ${plural(n, 'session')}, ${plural(sent, 'message')} sent, ${fmt(received)} received`);
    if (sent !== received) out.push(`note: sent and received differ by ${fmt(Math.abs(sent - received))}, so some messages ${sent > received ? 'go to' : 'come from'} sessions the file does not list`);
    out.push(`hub: a session with ${typeof r.threshold === 'number' ? `at least ${fmt(r.threshold)} messages` : 'at least its own break-even in messages (--threshold N sets one count)'}; ${r.hubs} of ${n}`);
    out.push(`stub: the ${fmt(r.stub)} tokens a session carries so it can load on its first message (the skill's name and description)`);
    if (r.reader !== undefined) {
      out.push(`reader card: ${fmt(r.reader)} tokens (--reader-tokens), ${r.readerWrites ? 'to read and write brevity (--reader-writes)' : 'to read only: readers write in prose'}`);
    }
    out.push(table([['policy', 'sessions that load', 'saved', 'cost', 'net'],
      ...r.policies.map((x) => [x.name, loads[x.name], fmt(x.saved), fmt(x.cost), signed(x.net)])]));
    const best = r.policies.find((x) => x.name === r.best);
    out.push(best.net > 0
      ? `highest net: ${best.name} (${signed(best.net)}). A model, not a decision: check the assumptions below.`
      : `every policy costs more than it saves: not loading brevity (net 0) beats the best, ${best.name} (${signed(best.net)}).`);
    if (r.reader !== undefined) {
      out.push(r.readerMax === null ? 'no session loads the reader card, so its size changes nothing.'
        : r.readerNetAtZero > 0 ? `hub+reader stays above 0 with a reader card of up to ${fmt(Math.ceil(r.readerMax) - 1)} tokens.`
        : `no reader card makes hub+reader positive: even a card of 0 tokens nets ${signed(r.readerNetAtZero)}.`);
    }
    if (r.hubs < 2) out.push(`hub-only saves nothing with ${r.hubs ? 'one hub' : 'no hubs'}: a message saves only between two sessions that loaded the spec.`);
    out.push('', 'net per session (0 = no brevity):');
    out.push(table([['session', 'calls', 'sent', 'received', 'break-even', 'hub', ...names],
      ...r.sessions.map((s) => [s.name, fmt(s.turns), fmt(s.sent), fmt(s.received), fmt(s.breakEven), s.hub ? 'yes' : '', ...names.map((k) => signed(s.net[k]))]),
      ['total', '', '', '', '', '', ...r.policies.map((x) => signed(x.net))]]));
    if (!r.pairsConverged) {
      out.push(`warning: the sent and received totals did not settle into pairs; ${r.reader === undefined ? 'hub-only is' : 'hub-only and hub+reader are'} approximate`);
    }
  }
  if (r.rows) {
    const total = r.rows.reduce((a, x) => a + x.tokens, 0);
    const spec = r.load.files[0]?.tokens;
    out.push('', `SPEC.md verb table: ${r.rows.length} rows, ${fmt(total)} tokens${spec ? ` (${pct((100 * total) / spec)} of SPEC.md)` : ''}; per session = tokens x ${+held(1, r.turns, 0, p, r.extras).toFixed(2)} at ${fmt(r.turns)} calls`);
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
