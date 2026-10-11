#!/usr/bin/env node
// Tests for tools/cost-model.mjs, on synthetic data only:  node tools/cost-model.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  breakEven, copies, DEFAULT_READ, firstCall, held, model, pairs, PRICES, READ_PRICES, readPrice, render, run, tokenizer, uses, verbRows,
} from './cost-model.mjs';
import { DEFAULT_READ as METER_DEFAULT_READ, READ_PRICES as METER_READ_PRICES } from './meter.mjs';

const tool = join(dirname(fileURLToPath(import.meta.url)), 'cost-model.mjs');
const dir = mkdtempSync(join(tmpdir(), 'brevity-cost-model-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (name, data) => { const f = join(dir, name); writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); return f; };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const cli = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', cwd: dir });

test('reproduces the break-even in eval/RESULTS.md: ~3,200 tokens and 200 calls need 64 to 92 messages', () => {
  const at = (sentShare, prices) => breakEven({ load: 3200, saving: 60, turns: 200, sentShare, prices });
  // On claude-opus-5-5 with 1-hour writes, the spec costs 3,200 x (2 + 0.05 x 200) = 38,400; a sent message saves
  // 60 x (5 + 0.05 x 100) = 600, a received one 60 x (2 + 0.05 x 100) = 420.
  assert.deepEqual(PRICES, { output: 5, write: 2, read: 0.05 });
  assert.equal(at(1), Math.ceil(38400 / 600));
  assert.equal(at(0), Math.ceil(38400 / 420));
  assert.equal(at(1), 64, `all sent: ${at(1)}`);
  assert.equal(at(0), 92, `all received: ${at(0)}`);
  assert.ok(at(0.5) > at(1) && at(0.5) < at(0));
  // The prices before #40, 5-minute writes and 0.1 reads, give the 76 to 101 that eval/RESULTS.md labels as such.
  const old = { output: 5, write: 1.25, read: 0.1 };
  assert.deepEqual([at(1, old), at(0, old)], [76, 101]);
});

test('cache reads are priced per model, as tools/meter.mjs prices them', () => {
  assert.deepEqual(READ_PRICES, METER_READ_PRICES);
  assert.equal(DEFAULT_READ, METER_DEFAULT_READ);
  assert.equal(readPrice('claude-opus-5-5'), 0.05);
  assert.equal(readPrice('claude-fable-5-1'), 0.025);
  assert.equal(readPrice('claude-mythos-5-1'), 0.025);
  assert.equal(readPrice('claude-opus-5-5-20261001'), 0.05, 'by id prefix');
  assert.equal(readPrice('claude-sonnet-5-5'), 0.1);
  assert.equal(readPrice(undefined), 0.1);
});

test('always-on equals the formula summed message by message', () => {
  // Two sessions that only write to each other: A sends 3 to B and receives 1 from it. Each message sits at
  // the same rank in both sessions' timelines (the k-th of A's 4 is the k-th of B's 4).
  const A = { name: 'A', turns: 100, sent: 3, received: 1 };
  const B = { name: 'B', turns: 60, sent: 1, received: 3 };
  const load = 1000;
  const s = 40;
  const p = PRICES;
  let net = -load * (p.write + p.read * A.turns) - load * (p.write + p.read * B.turns);
  for (let k = 1; k <= 4; k++) {
    const leftA = A.turns - (A.turns * k) / 5;
    const leftB = B.turns - (B.turns * k) / 5;
    net += s * (p.output + p.write + p.read * leftA + p.read * leftB);
  }
  const r = model([A, B], { load, saving: s });
  close(r.policies.find((x) => x.name === 'always-on').net, net);
  // Per session: the sender keeps output + reads, the recipient cache write + reads.
  const a = r.sessions[0];
  const leftSumA = [1, 2, 3, 4].reduce((acc, k) => acc + A.turns - (A.turns * k) / 5, 0);
  close(a.net['always-on'], s * (3 * p.output + 1 * p.write + p.read * leftSumA) - load * (p.write + p.read * A.turns));
});

test('prices can be overridden', () => {
  const cheap = breakEven({ load: 3100, saving: 65, turns: 200, sentShare: 1, prices: { output: 5, write: 2, read: 0.025 } });
  assert.ok(cheap < breakEven({ load: 3100, saving: 65, turns: 200, sentShare: 1 }));
});

test('--model sets the read price, and --read, --write and --output override the defaults', async () => {
  const base = ['--saving', '60', '--load-tokens', '3200', '--turns', '200'];
  const r = await run(base);
  assert.equal(r.model, 'claude-opus-5-5');
  assert.deepEqual(r.prices, { output: 5, write: 2, read: 0.05 });
  assert.deepEqual([r.breakEven.allSent, r.breakEven.allReceived], [64, 92]);
  assert.equal((await run([...base, '--model', 'claude-fable-5-1'])).prices.read, 0.025);
  const other = await run([...base, '--model', 'claude-sonnet-5-5', '--write', '1.25']);
  assert.deepEqual(other.prices, { output: 5, write: 1.25, read: 0.1 });
  assert.deepEqual([other.breakEven.allSent, other.breakEven.allReceived], [76, 101]);
  const read = await run([...base, '--model', 'claude-fable-5-1', '--read', '0.2', '--output', '4']);
  assert.deepEqual(read.prices, { output: 4, write: 2, read: 0.2 });
  // The output says which prices ran, and where each came from.
  const text = render(r);
  assert.match(text, /cache write 2x, cache read 0\.05x an input token/);
  assert.match(text, /cache read for claude-opus-5-5 \(the default; --model names another\), cache write at the 1-hour rate \(--write 1\.25 for 5-minute caching\)/);
  assert.match(render(other), /cache read for claude-sonnet-5-5 \(--model\), cache write from --write/);
  assert.match(render(read), /cache read from --read, cache write at the 1-hour rate .*, output from --output/);
});

test('--reinject and --reinject-every add cache writes of what a session carries', () => {
  // Per session, spread evenly: a session that loads at call 25 of 100 pays 3/4 of 2 copies.
  assert.equal(copies(100, 0, { reinject: 2 }), 2);
  assert.equal(copies(100, 25, { reinject: 2 }), 1.5);
  // Every 40 calls: at calls 40 and 80, before the last call; a load at call 50 pays only the one at 80.
  assert.equal(copies(100, 0, { reinjectEvery: 40 }), 2);
  assert.equal(copies(100, 0, { reinjectEvery: 50 }), 1, 'none at the last call');
  assert.equal(copies(100, 50, { reinjectEvery: 40 }), 1);
  assert.equal(copies(30, 0, { reinjectEvery: 200 }), 0);
  assert.equal(copies(100, 0, { reinject: 1, reinjectEvery: 40 }), 3);
  assert.equal(copies(0, 0, { reinject: 1 }), 0);
  const p = PRICES;
  close(held(1000, 100, 0, p, { reinject: 2 }), 1000 * (p.write * 3 + p.read * 100));
  // The reads do not change: the compaction or resume drops the old copy.
  close(held(1000, 100, 0, p, { reinject: 2 }) - held(1000, 100, 0, p), 2 * 1000 * p.write);
});

test('--idle-misses prices a share of the calls at the write price, for loaded context and messages alike', () => {
  const p = PRICES;
  const r = (x) => p.read + x * (p.write - p.read);
  close(held(1000, 100, 0, p, { idleMisses: 0.1 }), 1000 * (p.write + r(0.1) * 100));
  close(held(1000, 100, 0, p, { idleMisses: 1 }), 1000 * p.write * 101); // every call writes
  const at = (idleMisses) => breakEven({ load: 3200, saving: 60, turns: 200, sentShare: 1, extras: { idleMisses } });
  assert.equal(at(0.05), Math.ceil((3200 * (p.write + r(0.05) * 200)) / (60 * (p.output + r(0.05) * 100))));
  // Carried messages save at the same raised rate.
  const A = { name: 'A', turns: 100, sent: 1, received: 0 };
  const B = { name: 'B', turns: 100, sent: 0, received: 1 };
  const net = (idleMisses) => model([A, B], { load: 0, saving: 10, stub: 0, extras: { idleMisses } }).policies[0].net;
  close(net(0.5) - net(0), 10 * (r(0.5) - p.read) * (50 + 50));
});

// A hub and its peers: the hub writes 12 messages and gets 7 back; three peers share them, one is idle.
const star = [
  { name: 'hub', turns: 2000, sent: 12, received: 7 },
  { name: 'a', turns: 80, sent: 4, received: 5 },
  { name: 'b', turns: 60, sent: 2, received: 4 },
  { name: 'c', turns: 50, sent: 1, received: 3 },
  { name: 'idle', turns: 40, sent: 0, received: 0 },
];

test('pairs keep every total, to 0.01 messages, and never pair a session with itself', () => {
  const { m, converged } = pairs(star);
  assert.ok(converged);
  star.forEach((s, i) => {
    assert.ok(Math.abs(m[i].reduce((a, b) => a + b, 0) - s.sent) <= 0.01);
    assert.ok(Math.abs(m.reduce((a, row) => a + row[i], 0) - s.received) <= 0.01);
    assert.equal(m[i][i], 0);
  });
  // The hub is the only session the peers can all reach, so almost all traffic goes through it.
  assert.ok(m[0].slice(1, 4).reduce((a, b) => a + b, 0) > 11.9);
});

test('pairs send what the listed sessions cannot place to unlisted sessions', () => {
  const { m, converged } = pairs([{ name: 'hub', turns: 2000, sent: 158, received: 110 }]);
  assert.ok(converged);
  close(m[0][1], 158);
  close(m[1][0], 110);
});

test('hub-only saves nothing with one hub, since its peers cannot read brevity', () => {
  const r = model(star, { load: 3100, saving: 65, threshold: 15 });
  assert.equal(r.hubs, 1);
  const hubOnly = r.policies.find((x) => x.name === 'hub-only');
  assert.ok(hubOnly.saved < 1, `saved ${hubOnly.saved}`);
  assert.ok(hubOnly.net < 0);
  assert.equal(r.sessions[1].net['hub-only'], 0);
});

test('hub-only saves on the messages two hubs exchange', () => {
  const two = [
    { name: 'h1', turns: 1000, sent: 50, received: 50 },
    { name: 'h2', turns: 1000, sent: 50, received: 50 },
  ];
  const r = model(two, { load: 3100, saving: 65, threshold: 10 });
  // Up to a sliver the pair estimate lends to unlisted sessions.
  close(r.policies.find((x) => x.name === 'hub-only').net, r.policies.find((x) => x.name === 'always-on').net, 1e-3);
});

test('first-message spares idle and quiet sessions most of the cost', () => {
  const r = model(star, { load: 3100, saving: 65, threshold: 15 });
  const [hub, a, , , idle] = r.sessions;
  const p = PRICES;
  // Idle: only the stub, 138 x (write + read x 40).
  close(idle.net['first-message'], -138 * (p.write + p.read * 40));
  close(idle.net['always-on'], -3100 * (p.write + p.read * 40));
  // A peer saves the same on its messages, and loads 80/10 = 8 calls later.
  assert.equal(a.firstMessageAt, 8);
  close(a.net['first-message'] - a.net['always-on'], 3100 * p.read * 8 - 138 * (p.write + p.read * 80));
  // hub+first: the hub loads at call 0 and carries no stub; the peers load on demand.
  assert.equal(hub.net['hub+first'], hub.net['always-on']);
  assert.equal(a.net['hub+first'], a.net['first-message']);
});

test('--first start and a session\'s "first" field move the load under first-message', () => {
  const s = [{ name: 'x', turns: 100, sent: 1, received: 1 }];
  const at = (opts, list = s) => model(list, { load: 1000, saving: 50, ...opts }).sessions[0].detail['first-message'].loadsAt;
  assert.equal(at({}), 100 / 3);
  assert.equal(at({ first: 'start' }), 0);
  assert.equal(at({}, [{ ...s[0], first: 70 }]), 70);
});

test('hub+reader: readers write in prose, so only the hub\'s messages save', () => {
  const r = model(star, { load: 3100, saving: 65, threshold: 15, reader: 500 });
  const [hub, a, , , idle] = r.sessions;
  // The hub saves on all it sends (every peer can read) and on nothing it receives (peers write prose).
  assert.equal(hub.detail['hub+reader'].savedMessages, 12);
  assert.equal(hub.detail['hub+reader'].loadsAt, 0);
  // A peer saves only on what the hub sends it, and loads the card at its first received message: 80/(5+1).
  assert.ok(Math.abs(a.detail['hub+reader'].savedMessages - 5) < 0.05);
  close(a.detail['hub+reader'].loadsAt, 80 / 6);
  const p = PRICES;
  close(a.detail['hub+reader'].cost, 500 * (p.write + p.read * (80 - 80 / 6)) + 138 * (p.write + p.read * 80));
  assert.equal(idle.detail['hub+reader'].loadsAt, null);
  close(idle.net['hub+reader'], -138 * (p.write + p.read * 40));
  // Policies without the card are unchanged.
  assert.deepEqual(r.policies.slice(0, 4), model(star, { load: 3100, saving: 65, threshold: 15 }).policies);
});

test('hub+reader with --reader-writes and a full-size card is hub+first', () => {
  const r = model(star, { load: 3100, saving: 65, threshold: 15, reader: 3100, readerWrites: true });
  for (const s of r.sessions) close(s.net['hub+reader'], s.net['hub+first']);
});

test('readerMax is the card size at which hub+reader nets 0', () => {
  // A hub that writes 150 messages to 10 readers, 15 each.
  const team = [{ name: 'hub', turns: 2000, sent: 150, received: 0 },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `r${i}`, turns: 100, sent: 0, received: 15 }))];
  const opts = { load: 3100, saving: 65, threshold: 100 };
  const r = model(team, { ...opts, reader: 100 });
  assert.ok(r.readerMax > 100);
  const edge = model(team, { ...opts, reader: r.readerMax });
  assert.ok(Math.abs(edge.policies.at(-1).net) < 1e-6 * r.readerNetAtZero);
  assert.ok(model(team, { ...opts, reader: r.readerMax + 1 }).policies.at(-1).net < 0);
  // With the extra costs set, the card still costs a fixed amount per token, and hub+reader nets 0 at readerMax.
  const extras = { reinject: 1, reinjectEvery: 30, idleMisses: 0.05, skillEntry: 143 };
  const rx = model(team, { ...opts, reader: 100, extras });
  assert.ok(rx.readerMax > 0 && rx.readerMax !== r.readerMax);
  assert.ok(Math.abs(model(team, { ...opts, reader: rx.readerMax, extras }).policies.at(-1).net) < 1e-6 * rx.readerNetAtZero);
  // With 12 messages from the hub, no card pays for the hub's own load.
  const none = model(star, { load: 3100, saving: 65, threshold: 15, reader: 100 });
  assert.equal(none.readerMax, 0);
  assert.ok(none.readerNetAtZero < 0);
  // When every session is a hub, no one loads the card.
  const hubs = [{ name: 'h1', turns: 500, sent: 40, received: 40 }, { name: 'h2', turns: 500, sent: 40, received: 40 }];
  assert.equal(model(hubs, { load: 3100, saving: 65, threshold: 10, reader: 300 }).readerMax, null);
});

test('--skill-entry: every session carries the entry under every policy, and the stub stands in for it', () => {
  const opts = { load: 3100, saving: 65, threshold: 15 };
  const plain = model(star, opts);
  const entry = model(star, { ...opts, extras: { skillEntry: 143 } });
  const p = PRICES;
  star.forEach((s, i) => {
    const extra = 143 * (p.write + p.read * s.turns);
    close(plain.sessions[i].net['always-on'] - entry.sessions[i].net['always-on'], extra);
    // A non-hub that loads nothing under hub-only still carries the plugin's entry.
    close(plain.sessions[i].net['hub-only'] - entry.sessions[i].net['hub-only'], extra);
    // Sessions that carry the stub carry no second entry.
    assert.equal(entry.sessions[i].net['first-message'], plain.sessions[i].net['first-message']);
  });
  assert.equal(entry.sessions[1].net['hub+first'], plain.sessions[1].net['hub+first']);
  // The break-even against no plugin counts the entry as part of the load.
  assert.equal(breakEven({ load: 3200, saving: 60, turns: 200, sentShare: 1, extras: { skillEntry: 143 } }),
    breakEven({ load: 3343, saving: 60, turns: 200, sentShare: 1 }));
});

test('--skill-entry does not change which sessions are hubs: every session pays it, loaded or not', async () => {
  // 78 messages each: above the break-even of loading (76), below the one against no plugin (79).
  const two = [{ name: 'a', turns: 200, sent: 39, received: 39 }, { name: 'b', turns: 200, sent: 39, received: 39 }];
  const loading = breakEven({ load: 3200, saving: 60, turns: 200, sentShare: 0.5 });
  const noPlugin = breakEven({ load: 3200, saving: 60, turns: 200, sentShare: 0.5, extras: { skillEntry: 143 } });
  assert.deepEqual([loading, noPlugin], [76, 79]);
  const r = model(two, { load: 3200, saving: 60, extras: { skillEntry: 143 } });
  assert.equal(r.hubs, 2);
  assert.deepEqual(r.sessions.map((s) => s.breakEven), [76, 76]);
  const plain = model(two, { load: 3200, saving: 60 });
  close(r.policies[1].net, plain.policies[1].net - 2 * 143 * (PRICES.write + PRICES.read * 200));
  // The CLI prints the break-even of loading, and the one against no plugin, labelled.
  const cliRun = await run(['--saving', '60', '--load-tokens', '3200', '--turns', '200', '--skill-entry', '143']);
  assert.deepEqual([cliRun.breakEven.half, cliRun.breakEvenNoPlugin.half], [76, 79]);
  assert.match(render(cliRun), /against no plugin, counting the 143-token skill entry that every session carries: \d+ if it sends them all, \d+ if it receives them all, 79 half and half/);
  assert.equal((await run(['--saving', '60', '--load-tokens', '3200'])).breakEvenNoPlugin, undefined);
});

test('the extra costs default to 0 and change no result until set', () => {
  const opts = { load: 3100, saving: 65, threshold: 15, reader: 300 };
  assert.deepEqual(model(star, { ...opts, extras: { reinject: 0, reinjectEvery: null, idleMisses: 0, skillEntry: 0 } }), model(star, opts));
});

test('the first message arrives at T/(n+1), at call 0 with --first start, or where the file says', () => {
  const s = { turns: 90, sent: 1, received: 1 };
  assert.equal(firstCall(s), 30);
  assert.equal(firstCall(s, 'start'), 0);
  assert.equal(firstCall({ ...s, first: 45 }, 'start'), 45);
  assert.equal(firstCall({ turns: 90, sent: 0, received: 0 }), null);
});

// A synthetic spec with a verb table, and encodings that use some of its verbs.
const spec = [
  '# brevity 9.9: synthetic',
  '| verb | meaning |',
  '|---|---|',
  '| `DO x` / `NO x` | a request / a prohibition |',
  '| `ASK x?` / `A1 x` | a question / an answer |',
  '| `WILL x` / `DONE x` | a commitment / a completed act |',
  '| `TELL who «x»` | a relay |',
  '',
  'after the table',
].join('\n');
const encodings = [
  { id: 'e1', enc: 'Line 1 says DO and TELL, which does not count.\nDO merge fix/a; NO edits to «x»' },
  { id: 'e2', enc: 'Plain.\n- DONE tests\n@abc123 WILL rebase' },
  { id: 'e3', enc: 'Plain.\nA2 yes\n> TELL is prose here' },
  { id: 'e4', enc: 'Plain.\nCHK x: ok; ASK1 go?' },
];

test('verbRows reads the verb table only', () => {
  const rows = verbRows(spec);
  assert.deepEqual(rows.map((r) => r.verbs), [['DO', 'NO'], ['ASK', 'A1'], ['WILL', 'DONE'], ['TELL']]);
});

test('uses finds verbs where a statement starts, and nowhere else', () => {
  assert.ok(uses(encodings[0].enc, 'DO'));
  assert.ok(uses(encodings[0].enc, 'NO'));
  assert.ok(!uses(encodings[0].enc, 'TELL'), 'line 1 does not count');
  assert.ok(uses(encodings[1].enc, 'DONE'), 'after "- "');
  assert.ok(uses(encodings[1].enc, 'WILL'), 'after an actor');
  assert.ok(!uses(encodings[1].enc, 'DO'), 'DONE is not DO');
  assert.ok(uses(encodings[2].enc, 'A1'), 'A2 is an answer');
  assert.ok(!uses(encodings[2].enc, 'TELL'), '> prose does not count');
  assert.ok(uses(encodings[3].enc, 'ASK'), 'ASK1 after ;');
});

test('--rows reports tokens, cost and use per row, and flags rare rows', async () => {
  const tok = await tokenizer();
  const specFile = file('SPEC.md', spec);
  const r = await run(['--rows', '--spec', specFile, '--no-dict', '--enc', file('enc.json', encodings), '--turns', '100', '--rare', '30']);
  assert.equal(r.rows.length, 4);
  const [doNo, askA1, willDone, tell] = r.rows;
  assert.equal(doNo.tokens, tok.count('| `DO x` / `NO x` | a request / a prohibition |\n'));
  close(doNo.perSession, doNo.tokens * (PRICES.write + PRICES.read * 100));
  assert.equal(doNo.used, 25);
  assert.deepEqual(askA1.byVerb, { ASK: 25, A1: 25 });
  assert.equal(askA1.used, 50);
  assert.equal(willDone.used, 25);
  assert.equal(tell.used, 0);
  assert.deepEqual(r.rows.map((x) => x.candidate), [true, false, true, true]);
  assert.equal(r.breakEven, undefined, 'no saving given: rows only');
});

test('S + D is counted from the spec and the dictionaries', async () => {
  const tok = await tokenizer();
  const dict = '# brevity DICT: synthetic\nR.x = a rule\n';
  const r = await run(['--saving', '10', '--spec', file('SPEC.md', spec), '--dict', file('DICT.md', dict)]);
  assert.equal(r.load.tokens, tok.count(spec) + tok.count(dict));
  const override = await run(['--saving', '10', '--load-tokens', '3100']);
  assert.equal(override.load.tokens, 3100);
});

test('the saving per message is the mean over messages.json and encodings.json', async () => {
  const tok = await tokenizer();
  const msgs = [
    { id: 'e1', text: 'Hello! Please merge the branch fix/a, and please do not edit the section «x». Thanks a lot!' },
    { id: 'e2', text: 'I finished the tests. The session abc123 says it will rebase its branch today, as agreed earlier.' },
  ];
  const r = await run(['--messages', file('msgs.json', msgs), '--enc', file('enc.json', encodings), '--load-tokens', '3100']);
  const expected = msgs.reduce((a, m, i) => a + tok.count(m.text) - tok.count(encodings[i].enc), 0) / msgs.length;
  close(r.saving.tokens, expected);
  assert.equal(r.saving.messages, 2);
});

test('the CLI prints the policies, the net per session and the assumptions', () => {
  const sessions = file('sessions.json', star);
  const text = cli(sessions, '--saving', '65', '--load-tokens', '3100', '--threshold', '15');
  assert.equal(text.status, 0, text.stderr);
  for (const s of ['always-on', 'hub-only', 'first-message', 'hub+first', 'net per session', 'assumptions:', 'T*k/(n+1)']) {
    assert.ok(text.stdout.includes(s), `missing ${s}`);
  }
  const json = JSON.parse(cli(sessions, '--saving', '65', '--load-tokens', '3100', '--json').stdout);
  assert.equal(json.sessions.length, star.length);
  assert.equal(json.policies.length, 4);
  assert.ok(json.best);
  assert.ok(!text.stdout.includes('hub+reader'), 'no reader card unless asked');
  const reader = cli(sessions, '--saving', '65', '--load-tokens', '3100', '--threshold', '15', '--reader-tokens', '300');
  assert.equal(reader.status, 0, reader.stderr);
  for (const s of ['hub+reader', 'reader card: 300 tokens', 'readers write in prose']) assert.ok(reader.stdout.includes(s), `missing ${s}`);
});

test('the CLI names the extra costs it adds and leaves out, and points to tools/meter.mjs', () => {
  const sessions = file('sessions.json', star);
  const plain = cli(sessions, '--saving', '65', '--load-tokens', '3100');
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /extra costs: no re-injected copies \(--reinject N per session, --reinject-every N calls\), no idle cache misses \(--idle-misses R\), no skill entry \(--skill-entry 143 for the Claude Code plugin\)/);
  assert.match(plain.stdout, /tools\/meter\.mjs measures these costs from a team's own transcripts, call by call: for a real team, use it\./);
  assert.match(plain.stdout, /the cache stays warm and a session holds one copy/);
  const set = cli(sessions, '--saving', '65', '--load-tokens', '3100', '--reinject', '1.5', '--reinject-every', '400', '--idle-misses', '0.02', '--skill-entry', '143');
  assert.equal(set.status, 0, set.stderr);
  assert.match(set.stdout, /extra costs: 1\.5 extra copies per session \(--reinject\) and one extra copy every 400 calls \(--reinject-every\), idle cache misses on 2% of calls \(--idle-misses\), a 143-token skill entry in every session \(--skill-entry\)/);
  assert.match(set.stdout, /idle misses raise both to the write price/);
  assert.match(set.stdout, /net 0 means no plugin/);
  const json = JSON.parse(cli(sessions, '--saving', '65', '--load-tokens', '3100', '--idle-misses', '0.02', '--json').stdout);
  assert.deepEqual(json.extras, { reinject: 0, reinjectEvery: null, idleMisses: 0.02, skillEntry: 0 });
  assert.equal(json.model, 'claude-opus-5-5');
});

test('the CLI refuses bad input', () => {
  assert.equal(cli('--saving', '65', '--load-tokens', '1', '--idle-misses', '1.5').status, 2, 'a share is at most 1');
  assert.equal(cli('--saving', '65', '--load-tokens', '1', '--reinject-every', '0').status, 2);
  const fraction = cli('--saving', '65', '--load-tokens', '1', '--reinject-every', '2.5');
  assert.equal(fraction.status, 2, 'calls are whole');
  assert.match(fraction.stderr, /--reinject-every must be a whole number > 0/);
  assert.equal(cli('--saving', '65', '--load-tokens', '1', '--reinject', '-1').status, 2);
  assert.equal(cli('--saving', '65', '--load-tokens', '1', '--model', ' ').status, 2);
  assert.equal(cli('--saving', '65', '--load-tokens', '1', '--model').status, 2, '--model needs a value');
  assert.equal(cli(file('s.json', star), '--load-tokens', '3100').status, 2, 'no saving');
  assert.equal(cli(file('bad.json', [{ name: 'x', turns: -1, sent: 0, received: 0 }]), '--saving', '65', '--load-tokens', '1').status, 2);
  assert.equal(cli('--saving', 'lots', '--load-tokens', '1').status, 2);
  assert.equal(cli('--saving', '65', '--load-tokens', '1', '--first', 'late').status, 2);
  assert.equal(cli('--saving', '65', '--load-tokens', '1', '--reader-writes').status, 2, '--reader-writes needs a card');
});

test('the verb table of this checkout\'s SPEC.md parses', () => {
  const rows = verbRows(readFileSync(join(dirname(tool), '..', 'SPEC.md'), 'utf8'));
  assert.ok(rows.length >= 10, `${rows.length} rows`);
  assert.deepEqual(rows[0].verbs.slice(0, 1), ['DO']);
});
