#!/usr/bin/env node
// Tests for tools/cost-model.mjs, on synthetic data only:  node tools/cost-model.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { breakEven, firstCall, model, pairs, PRICES, run, tokenizer, uses, verbRows } from './cost-model.mjs';

const tool = join(dirname(fileURLToPath(import.meta.url)), 'cost-model.mjs');
const dir = mkdtempSync(join(tmpdir(), 'brevity-cost-model-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (name, data) => { const f = join(dir, name); writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); return f; };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const cli = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', cwd: dir });

test('reproduces the break-even in eval/RESULTS.md: ~3,100 tokens and 200 calls need 70 to 95 messages', () => {
  const at = (sentShare) => breakEven({ load: 3100, saving: 65, turns: 200, sentShare });
  // The spec costs 3,100 x (1.25 + 0.1 x 200) = 65,875; a sent message saves 65 x (5 + 0.1 x 100) = 975,
  // a received one 65 x (1.25 + 0.1 x 100) = 731.
  assert.equal(at(1), Math.ceil(65875 / 975));
  assert.equal(at(0), Math.ceil(65875 / 731.25));
  assert.ok(at(1) >= 65 && at(1) <= 75, `all sent: ${at(1)}`);
  assert.ok(at(0) >= 85 && at(0) <= 95, `all received: ${at(0)}`);
  assert.ok(at(0.5) > at(1) && at(0.5) < at(0));
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
  const cheap = breakEven({ load: 3100, saving: 65, turns: 200, sentShare: 1, prices: { output: 5, write: 1.25, read: 0.05 } });
  assert.ok(cheap < breakEven({ load: 3100, saving: 65, turns: 200, sentShare: 1 }));
});

test('the first message arrives at T/(n+1), at call 0 with --first start, or where the file says', () => {
  const s = { turns: 90, sent: 1, received: 1 };
  assert.equal(firstCall(s), 30);
  assert.equal(firstCall(s, 'start'), 0);
  assert.equal(firstCall({ ...s, first: 45 }, 'start'), 45);
  assert.equal(firstCall({ turns: 90, sent: 0, received: 0 }), null);
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
  // Idle: only the stub, 138 x (1.25 + 0.1 x 40).
  close(idle.net['first-message'], -138 * (1.25 + 0.1 * 40));
  close(idle.net['always-on'], -3100 * (1.25 + 0.1 * 40));
  // A peer saves the same on its messages, and loads 80/10 = 8 calls later.
  assert.equal(a.firstMessageAt, 8);
  close(a.net['first-message'] - a.net['always-on'], 3100 * 0.1 * 8 - 138 * (1.25 + 0.1 * 80));
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
  close(doNo.perSession, doNo.tokens * (1.25 + 0.1 * 100));
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
});

test('the CLI refuses bad input', () => {
  assert.equal(cli(file('s.json', star), '--load-tokens', '3100').status, 2, 'no saving');
  assert.equal(cli(file('bad.json', [{ name: 'x', turns: -1, sent: 0, received: 0 }]), '--saving', '65', '--load-tokens', '1').status, 2);
  assert.equal(cli('--saving', 'lots', '--load-tokens', '1').status, 2);
  assert.equal(cli('--saving', '65', '--load-tokens', '1', '--first', 'late').status, 2);
});

test('the verb table of this checkout\'s SPEC.md parses', () => {
  const rows = verbRows(readFileSync(join(dirname(tool), '..', 'SPEC.md'), 'utf8'));
  assert.ok(rows.length >= 10, `${rows.length} rows`);
  assert.deepEqual(rows[0].verbs.slice(0, 1), ['DO']);
});
