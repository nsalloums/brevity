#!/usr/bin/env node
// Tests for tools/meter.mjs, on the synthetic transcripts in tools/fixtures/meter/ only:  node --test tools/meter.test.mjs
//
// tools/fixtures/meter/team holds four sessions. "hub" coordinates on claude-opus-5-5 (cache read 0.05): it sends a
// brevity message, a prose one, a send that fails and a delegation prompt, receives a peer message, goes idle for
// 92 minutes, compacts, and is resumed with its compaction copy still in context. "peer" (claude-sonnet-4-5, read 0.1,
// 5-minute writes only) starts from that delegation prompt, gets a hub message and a subagent result while it is busy
// (logged as queued_command attachments), and is resumed past a parent that was never written.
// "fork" continues the hub under a new id. "test" is a claude -p run. Every injected copy is 800 characters, so
// 200 tokens at chars/4, and the skill entry 30. tools/fixtures/meter/late holds one session that sends a brevity
// message before it loads the spec, at a resume. Those copies predate arms: they carry no arm marker.
//
// tools/fixtures/meter/arms holds one session per arm, all on claude-opus-5-5 with 1-hour writes, where each call reads
// the previous call's prompt and writes what is new. "lite" loads the lite arm (a 100-token copy) and sends M1 to
// "terse". "terse" loads the terse arm (80 tokens), receives M1 and answers with M2. "switch" loads lite and sends M3,
// then is resumed 90 minutes later under off (the marker alone, 26 tokens) with the lite copy still in context, and
// sends M4, which has a verb line. "plain" loads nothing.
//
// tools/fixtures/meter/quality holds the quality signals. "lead" (terse) sends "dev" (lite) Q1, which dev asks about
// with "Did you mean"; Q3, whose `tests/cart.test.mjs` dev names in a question; Q5, answered with a question that
// names nothing from it; Q7, which Q8 corrects; and Q13, which dev asks about with "Which one" 5 calls later, outside
// the default window. It sends "ops" (no arm) Q9, then Q10 almost word for word with no reply between, and after
// ops answers, Q12, the same text again. Then a send that fails and its re-send. Dev sends lead Q15, which Q16
// withdraws. Ops logs no msg_id on what it receives, and lead writes to it as "ops [a1b2c3]".
//
// tools/fixtures/meter/linking holds how messages are matched. "orig" sends O1 to "peer" and stops; "cont" continues
// it under a new id (its lines copied) and sends a correction of O1. "x" and "y" send "peer" the same text and log no
// msg_id; peer logs a msg_id for each, and for a third copy from "w", which is not measured. Peer asks y, then w,
// "Which one did you mean".
//
// tools/fixtures/meter/delegation holds the delegation signals (issue #58). "coord" (terse, titled "acme
// coordinator") spawns D1, D2, D3, a spawn that fails (D4), its re-spawn D5 and a second failed spawn of it (D5b),
// then D6 (D1 almost word for word), D7 (D3's text again), and D8 and D9 (the same text twice). "coord2" continues
// coord under a new id, with its lines up to D3 copied. "s1" (lite) starts from D1, reads for 7 calls and asks "Did
// you mean"; coord answers, sends a correction after D6, and coord2 corrects it. "s2" starts from D2 and reports;
// coord thanks it, corrects it, and s2 asks about the correction with a question that also names D2's file. "s3"
// (lite, no title, no msg_id) starts from D3, asks a third session "Did you mean", asks coord leave for its own step,
// and coord2 corrects it by D3's title. "s5" starts from D5; coord2 writes to it before it asks "Did you mean". "s7",
// titled apart from D7, starts from D7 after it was sent; coord corrects it by that title, delivered with no msg_id
// under another name, before s7 asks. "s8" and "s9" both start after D8 and D9; "s9b" continues s9 under a new id and
// receives coord's correction, sent with no msg_id to the title D8 and D9 share. "s0" begins with D2's text before
// coord sent D2.
//
// Every run that checks numbers counts tokens with chars/4: run() takes `count`, and the command line gets
// BREVITY_METER_TOKENIZER=chars/4, so the numbers hold whether or not @anthropic-ai/tokenizer is installed (issue #60).
// Only the tokenizer test runs the command line without it, to check which tokenizer the output names.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run as costModel } from './cost-model.mjs';
import {
  callBill, defaultProjects, isBrevity, isClarification, isCorrection, meter as meterRecords, projectFolder, readPrice, render,
  run, samePeer, similarity, tokenizer, transcripts, writeRate,
} from './meter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tool = join(here, 'meter.mjs');
const team = join(here, 'fixtures', 'meter', 'team');
const late = join(here, 'fixtures', 'meter', 'late');
const armsDir = join(here, 'fixtures', 'meter', 'arms');
const dir = mkdtempSync(join(tmpdir(), 'brevity-meter-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const count = (t) => Math.ceil(t.length / 4);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const meter = (...args) => run(['--project', team, ...args], { count, cwd: dir });
const session = (r, id) => r.team.sessions.find((s) => s.id === id);
const messages = (s, dir_) => s.messages.filter((m) => m.dir === dir_);
// The command line, with chars/4 whatever is installed.
const env = { ...process.env, BREVITY_METER_TOKENIZER: 'chars/4' };
const node = (args, more = {}) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', cwd: dir, env, ...more });
const cli = (...args) => node(['--project', team, ...args]);

// The hub's calls, as the fixture writes them: [input, 5-minute writes, 1-hour writes, cache read, output].
const HUB = [[10, 0, 1000, 3000, 80], [5, 100, 300, 4010, 40], [5, 0, 300, 4415, 30], [5, 0, 4800, 3000, 20],
  [5, 0, 1500, 3000, 20], [5, 0, 100, 4505, 20], [5, 0, 1700, 3000, 20], [5, 0, 50, 4705, 20]];
const usage = ([input, w5, w1h, read, output]) => ({
  input_tokens: input, cache_creation_input_tokens: w5 + w1h, cache_read_input_tokens: read, output_tokens: output,
  cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1h },
});

test('one call spread over several lines is billed once, with the usage of its last line', async () => {
  const hub = session(await meter(), 'hub');
  // 8 message ids in 11 assistant lines, plus a <synthetic> error line that is not a call.
  assert.equal(hub.calls, 8);
  // The first call's lines say output 50, then 80: the bill uses 80.
  assert.equal(callBill(usage(HUB[0]), 'claude-opus-5-5'), 10 + 80 * 5 + 1000 * 2 + 3000 * 0.05);
  close(hub.bill, HUB.reduce((a, u) => a + callBill(usage(u), 'claude-opus-5-5'), 0));
  close(hub.bill, 22401.75);
});

test('5-minute and 1-hour cache writes are priced apart, and cache reads by model', async () => {
  // The hub's second call writes 100 tokens for 5 minutes and 300 for an hour.
  close(writeRate(usage(HUB[1])), (100 * 1.25 + 300 * 2) / 400);
  close(callBill(usage(HUB[1]), 'claude-opus-5-5'), 5 + 40 * 5 + 100 * 1.25 + 300 * 2 + 4010 * 0.05);
  assert.equal(writeRate(usage([5, 0, 0, 100, 1])), 1, 'a call that writes nothing pays input for what it does not read');
  assert.equal(readPrice('claude-opus-5-5'), 0.05);
  assert.equal(readPrice('claude-fable-5-1'), 0.025);
  assert.equal(readPrice('claude-mythos-5-1'), 0.025);
  assert.equal(readPrice('claude-sonnet-4-5'), 0.1);
  assert.equal(readPrice('claude-opus-5-5', { read: 0.2 }), 0.2);
  const r = await meter();
  assert.deepEqual(r.prices.readByModel, { 'claude-opus-5-5': 0.05, 'claude-sonnet-4-5': 0.1 });
  // The peer writes 5-minute entries only: its first copy is written at 1.25, then read at 0.1 on two calls.
  assert.equal(session(r, 'peer').copyCost, 200 * (1.25 + 0.1 + 0.1) + 200 * 1.25);
});

test('flags override the prices', async () => {
  const hub = session(await meter('--read', '0.1', '--write-1h', '3', '--output', '4', '--input', '2'), 'hub');
  const p = { input: 2, output: 4, write5m: 1.25, write1h: 3, read: 0.1 };
  close(hub.bill, HUB.reduce((a, u) => a + callBill(usage(u), 'claude-opus-5-5', p), 0));
});

test('a copy is read while the cache covers it and written again after an idle gap; a compaction re-injects', async () => {
  const hub = session(await meter(), 'hub');
  assert.deepEqual(hub.copyTokens.map((c) => c.tokens), [200, 200, 200]);
  assert.equal(hub.copyTokens[0].spec, 140, 'the SPEC.md part');
  // Copy 1: written at call 1, read at calls 2-3, written again at call 4 (the cache read fell to the system prompt
  // after 92 idle minutes), dropped at the compaction. Copy 2, the hook's re-injection: written at call 5, read at 6,
  // written again at 7 (the resume), read at 8. Copy 3, injected by the resume: written at 7, read at 8.
  close(hub.copyCost, 200 * (2 + 0.05 + 0.05 + 2) + 200 * (2 + 0.05 + 2 + 0.05) + 200 * (2 + 0.05));
  // The skill entry (30 tokens) lives from the first listing to the compaction.
  close(hub.skillCost, 30 * (2 + 0.05 + 0.05 + 2));
  assert.equal(hub.rewrites, 3, 'copy 1 and the skill entry at call 4, copy 2 at call 7');
  close(hub.rewriteCost, 200 * 2 + 30 * 2 + 200 * 2);
  assert.equal(hub.drops.compaction, 1);
  close(hub.specCost, hub.copyCost + hub.skillCost);
});

test('a resume that keeps the old copy duplicates it; one whose chain breaks drops it', async () => {
  const r = await meter();
  const hub = session(r, 'hub');
  assert.equal(hub.duplicates.length, 1);
  const { extra, ...run_ } = hub.duplicates[0];
  assert.deepEqual(run_, { from: '2026-01-05T14:41:00.000Z', to: '2026-01-05T14:42:00.000Z', calls: 2, copies: 2, extraTokens: 200 });
  close(extra, 200 * (2 + 0.05), 1e-9);
  assert.deepEqual(r.duplicates.map((d) => d.session), ['hub']);
  const peer = session(r, 'peer');
  assert.equal(peer.duplicates.length, 0);
  assert.equal(peer.drops.resume, 1);
  assert.equal(peer.copies, 2);
});

test('sent, failed and received messages, with the estimated saving where each one sits', async () => {
  const r = await meter('--saving-ratio', '0.2'); // s = tokens x 0.2 / 0.8 = tokens / 4
  const hub = session(r, 'hub');
  const [m1, m2, m3] = messages(hub, 'sent');
  assert.deepEqual([m1, m2, m3].map((m) => [m.brevity, m.failed, m.tokens]), [[true, false, 50], [false, false, 40], [true, true, 48]]);
  // m1: output 5 at call 1; call 2 writes it to the sender's cache at that call's mix of writes (1.8125); call 3 reads
  // it; call 4 writes it again after the idle gap; the compaction drops it.
  close(m1.saving, (50 / 4) * (5 + 1.8125 + 0.05 + 2));
  assert.equal(m2.saving, 0, 'prose saves nothing');
  // The peer message: written at the call after it arrives, written again at call 4.
  const [r1] = messages(hub, 'received');
  close(r1.saving, (60 / 4) * (2 + 2));
  const [d1] = messages(hub, 'delegation-sent');
  close(d1.saving, (100 / 4) * (5 + 2));
  assert.equal(messages(hub, 'handback').length, 1);
  assert.equal(messages(hub, 'subagent-prompt').length, 1);
  assert.deepEqual(hub.tally, {
    sentBrevity: 2, sentLite: 0, sentTerse: 0, sentProse: 1, failed: 1, deliveredBrevity: 1, deliveredLite: 0, deliveredTerse: 0,
    deliveredProse: 1, delegations: 1, receivedBrevity: 1, receivedLite: 0, receivedTerse: 0, receivedProse: 0, subagentPrompts: 1,
    handbacks: 1, messageTokens: 50 + 40 + 100 + 60, brevityTokens: 50 + 100 + 60, delivered: 2, clarified: 0, corrected: 0, resent: 0,
    delegationsStarted: 1, delegationsClarified: 0, delegationsCorrected: 0, delegationsResent: 0,
  });
  // The peer's first message is the hub's delegation prompt: written at its first call (5-minute, 1.25), read at
  // calls 2 and 3, gone at the resume.
  const peer = session(r, 'peer');
  const [received] = messages(peer, 'delegation-received');
  assert.equal(received.brevity, true);
  close(received.saving, (100 / 4) * (1.25 + 0.1 + 0.1));
  close(r.team.total.saving, r.team.sessions.reduce((a, s) => a + s.messages.reduce((b, m) => b + m.saving, 0), 0));
  close(r.team.total.net, r.team.total.saving - r.team.total.specCost);
});

test('a peer message that arrives while the session is busy is logged as an attachment, and counts once', async () => {
  const peer = session(await meter('--saving-ratio', '0.2'), 'peer');
  // The queued_command attachment and a user line with the same msg_id are one message; the queued subagent result
  // is a handback, not a received message.
  const [q] = messages(peer, 'received');
  assert.equal(messages(peer, 'received').length, 1);
  assert.deepEqual([q.brevity, q.tokens, q.counted], [true, 30, true]);
  assert.equal(messages(peer, 'handback').length, 1);
  // Its own position: call 3 writes it (5-minute writes, 1.25), and the resume drops it.
  close(q.saving, (30 / 4) * 1.25);
  assert.equal(peer.tally.receivedBrevity, 2, 'with the delegation prompt');
  assert.equal(peer.tally.handbacks, 1);
});

test('brevity is a body line that starts with a section 3 verb; anything else is prose', () => {
  assert.ok(isBrevity('#41 is merged.\nMERGED #41 3f9a0c2e1'));
  assert.ok(isBrevity('Two steps.\n1. DO rebase fix/cart'));
  assert.ok(isBrevity('Ask.\n- ASK2 which base?'));
  assert.ok(isBrevity('Reply.\nA1 next'));
  assert.ok(isBrevity('Who.\n@abc123 WILL rebase'));
  assert.ok(isBrevity('\nLeading blank line.\nREPLY none'));
  assert.ok(!isBrevity('DO rebase fix/cart onto main'), 'line 1 is plain language, not the body');
  assert.ok(!isBrevity('Please rebase.\nDo it before noon.'), 'verbs are upper case');
  assert.ok(!isBrevity('Note.\n> DO this is quoted prose'));
  assert.ok(!isBrevity('Note.\nDONT do that\nDOING it'));
  assert.ok(!isBrevity(''));
});

test('claude -p sessions and subagents are reported apart from the team; journals are skipped', async () => {
  const r = await meter();
  assert.deepEqual(r.team.sessions.map((s) => s.id), ['hub', 'peer', 'fork']);
  assert.equal(r.tests.total.sessions, 1);
  assert.equal(r.tests.total.calls, 1);
  assert.equal(r.tests.total.copies, 1);
  assert.equal(r.subagents.total.sessions, 1, 'agent-a1.jsonl; journal.jsonl is not read');
  assert.equal(r.subagents.total.calls, 1);
  assert.equal(r.team.total.calls, 13);
  assert.deepEqual(r.transcripts, { sessions: 4, subagents: 1 });
});

test('a call copied into a later transcript counts once, but what it carries bills the later one', async () => {
  const fork = session(await meter(), 'fork');
  // The fork repeats the hub's resume and its two calls, then makes one call of its own.
  assert.equal(fork.calls, 1);
  assert.equal(fork.copies, 0);
  assert.equal(fork.inheritedCopies, 1);
  close(fork.copyCost, 200 * 0.05);
  assert.equal(fork.duplicates.length, 0, 'the hub\'s compaction copy is not in the fork\'s transcript');
});

test('--since and --until limit the calls counted', async () => {
  const r = await meter('--until', '2026-01-05T12:30:00Z');
  const hub = session(r, 'hub');
  assert.equal(hub.calls, 6);
  assert.equal(hub.duplicates.length, 0);
  assert.equal(session(r, 'peer').calls, 3);
  assert.equal(session(r, 'fork'), undefined, 'no calls in the window');
  assert.equal(r.window.until, '2026-01-05T12:30:00.000Z');
  const late = await meter('--since', '2026-01-05T11:00:00Z');
  assert.equal(session(late, 'hub').calls, 5);
  // Copy 1 was injected before the window; its rewrite at call 4 still counts, inside it.
  close(session(late, 'hub').copyCost, 200 * 2 + 200 * (2 + 0.05 + 2 + 0.05) + 200 * (2 + 0.05));
});

test('--team-json writes sessions that tools/cost-model.mjs reads', async () => {
  const file = join(dir, 'team.json');
  const res = cli('--team-json', file);
  assert.equal(res.status, 0, res.stderr);
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  // Calls from each session's first copy on, and its brevity messages delivered: sent (SendMessage and delegation
  // prompts) and received (peer messages and delegation prompts), with the call at which the first one entered.
  assert.deepEqual(rows, [
    { name: 'hub', turns: 8, sent: 2, received: 1, first: 0 },
    { name: 'peer', turns: 4, sent: 1, received: 2, first: 0 },
    { name: 'fork', turns: 1, sent: 0, received: 0 },
  ]);
  const model = await costModel([file, '--saving', '10', '--load-tokens', '200'], { cwd: dir });
  assert.deepEqual(model.sessions.map((s) => [s.name, s.turns]), [['hub', 8], ['peer', 4], ['fork', 1]]);
  // The printed command names the cost model next to the meter, so it runs from any folder, with the meter's prices.
  const cmd = res.stdout.match(/^ {2}node "([^"]+)" "([^"]+)" (.+)$/m);
  assert.ok(cmd, res.stdout);
  assert.equal(cmd[1], join(here, 'cost-model.mjs'));
  assert.match(cmd[3], /^--saving [\d.]+ --load-tokens \d+ --output 5 --write [\d.]+ --read 0\.05$/);
  const compared = spawnSync(process.execPath, [cmd[1], cmd[2], ...cmd[3].split(' ')], { encoding: 'utf8', cwd: dir });
  assert.equal(compared.status, 0, compared.stderr);
  const priced = cli('--team-json', file, '--input', '2', '--output', '4');
  assert.match(priced.stdout, /--output 4 /);
  assert.match(priced.stdout, /the cost model has no input price, so --input 2 is not passed to it/);
});

test('the shares of the loaded bill count only the calls from each session\'s first copy on', async () => {
  const r = await run(['--project', late, '--saving-ratio', '0.2'], { count, cwd: dir });
  const [s] = r.team.sessions;
  assert.deepEqual([s.calls, s.loadStart, s.callsLoaded], [3, 2, 1]);
  close(s.billLoaded, 5 + 20 * 5 + 300 * 2 + 4225 * 0.05);
  // The copy arrives with the resume, so all of its cost falls on the loaded call.
  close(s.specCostLoaded, 200 * 2);
  close(s.specCost, 200 * 2);
  // The message was sent before: its output and its write at the next call fall outside; only call 3's read counts.
  close(s.saving, (20 / 4) * (5 + 2 + 0.05));
  close(s.savingLoaded, (20 / 4) * 0.05);
  const share = r.team.total.shareOfLoadedBill;
  close(share.specCost, 400 / s.billLoaded);
  close(share.saving, s.savingLoaded / s.billLoaded);
  close(share.net, (s.savingLoaded - 400) / s.billLoaded);
  assert.match(render(r), /on those calls, load cost 400 \(43\.66%\), estimated saving 0 \(0\.03%\), net -400 \(-43\.63%\)/);
});

test('the default folders are the current directory\'s and its worktrees\', also from inside a worktree', () => {
  const root = join(dir, 'projects');
  const repo = join(dir, 'work', 'acme');
  const base = projectFolder(repo);
  for (const name of [base, `${base}--claude-worktrees-blue`, `${base}-other`, projectFolder(join(dir, 'elsewhere'))]) {
    mkdirSync(join(root, name), { recursive: true });
  }
  const want = [base, `${base}--claude-worktrees-blue`].map((n) => join(root, n)).sort();
  assert.deepEqual(defaultProjects(repo, root).sort(), want);
  assert.deepEqual(defaultProjects(join(repo, '.claude', 'worktrees', 'blue'), root).sort(), want);
  assert.ok(/^[A-Za-z0-9-]+$/.test(base));
});

test('on Windows the folder is found whatever case the shell keeps the path in', () => {
  const root = join(dir, 'projects-cased');
  const repo = join(dir, 'Work', 'Acme');
  const base = projectFolder(repo);
  for (const name of [base, `${base}--claude-worktrees-blue`]) mkdirSync(join(root, name), { recursive: true });
  // PowerShell keeps a path as it was typed, in lower case too; the folder is named after the path as the system spells it.
  const lower = repo.toLowerCase();
  assert.equal(defaultProjects(lower, root, 'win32').length, 2);
  assert.equal(defaultProjects(lower, root, 'linux').length, 0, 'elsewhere, folder names are case-sensitive');
});

test('the output is numbers and short ids; titles only with --titles, and never message text', async () => {
  const plain = cli();
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /^hub +brevity +8 /m);
  assert.match(plain.stdout, /sent b\/p/, 'no lite or terse columns without lite or terse messages');
  assert.match(plain.stdout, /duplicated copies \(two or more in one context, issue #39\):\n {2}hub {2}2 copies/);
  assert.match(plain.stdout, /est\. saving is an estimate/);
  assert.match(plain.stdout, /^tokenizer: chars\/4 \(BREVITY_METER_TOKENIZER=chars\/4\)$/m);
  assert.doesNotMatch(plain.stdout, /acme hub \(synthetic\)/);
  const titled = cli('--titles');
  assert.match(titled.stdout, /acme hub \(synthetic\)/);
  const json = cli('--json');
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.team.sessions.length, 3);
  assert.doesNotMatch(json.stdout, /rebase fix\/cart|Synthetic fixture text|acme hub/, 'no message text or title in --json');
  // --json gives 8-character ids and no message times; --titles gives the full ids and the times.
  const lateJson = (...args) => JSON.parse(node(['--project', late, '--json', ...args]).stdout);
  const short = lateJson().team.sessions[0];
  assert.equal(short.id, '11111111');
  assert.equal(short.messages[0].ts, undefined);
  const full = lateJson('--titles').team.sessions[0];
  assert.equal(full.id, '11111111-2222-4333-8444-555555555555');
  assert.equal(full.messages[0].ts, '2026-01-05T09:00:05.000Z');
  const bad = cli('--since', 'yesterday');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--since must be an ISO time/);
  const missing = node(['--project', join(dir, 'nowhere')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such folder/);
});

test('BREVITY_METER_TOKENIZER=chars/4 counts with chars/4 whether or not the tokenizer is installed', async () => {
  const forced = await tokenizer({ BREVITY_METER_TOKENIZER: 'chars/4' });
  assert.deepEqual([forced.name, forced.forced, forced.count('abcde')], ['chars/4', true, 2]);
  await assert.rejects(tokenizer({ BREVITY_METER_TOKENIZER: 'legacy' }), /BREVITY_METER_TOKENIZER must be chars\/4, or unset/);
  // Unset or empty, the meter uses the tokenizer when it is installed, else chars/4 with the hint to install it.
  const found = await tokenizer({});
  assert.equal((await tokenizer({ BREVITY_METER_TOKENIZER: '' })).name, found.name);
  assert.equal(JSON.parse(cli('--json').stdout).tokenizerForced, true);
  const unset = { ...env };
  delete unset.BREVITY_METER_TOKENIZER;
  assert.equal(JSON.parse(node(['--project', team, '--json'], { env: unset }).stdout).tokenizerForced, false);
  const plain = node(['--project', team], { env: unset });
  assert.equal(plain.status, 0, plain.stderr);
  if (found.name === 'chars/4') assert.match(plain.stdout, /^tokenizer: chars\/4 \(for the legacy counts, run npm i -D @anthropic-ai\/tokenizer in the brevity checkout that holds this tool\)$/m);
  else assert.match(plain.stdout, /^tokenizer: @anthropic-ai\/tokenizer$/m);
  const bad = node(['--project', team], { env: { ...env, BREVITY_METER_TOKENIZER: 'legacy' } });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /BREVITY_METER_TOKENIZER must be chars\/4, or unset/);
});

test('a project with no transcripts folder says so', async () => {
  const home = join(dir, 'home');
  mkdirSync(join(home, 'projects'), { recursive: true });
  await assert.rejects(run([], { count, cwd: join(dir, 'nothing-here'), home }), /no Claude Code project folder/);
});

// The arms fixture, read with chars/4.
const arms = (...args) => run(['--project', armsDir, ...args], { count, cwd: dir });
const wrapped = (t) => `<system-reminder>\nSessionStart hook additional context: ${t}\n</system-reminder>`;
const saved = (tokens, r) => (tokens * r) / (1 - r);

test('copies from before arms are brevity copies', async () => {
  const r = await meter();
  for (const id of ['hub', 'peer', 'fork']) {
    assert.equal(session(r, id).arm, 'brevity', id);
    assert.deepEqual(session(r, id).arms, ['brevity'], id);
  }
  assert.deepEqual(Object.keys(r.team.arms), ['brevity']);
  assert.deepEqual(r.team.arms.brevity.sessions, ['hub', 'peer', 'fork']);
});

test('a lite, terse or off copy is the whole injection after its marker; an off copy is the marker alone', async () => {
  const r = await arms();
  assert.deepEqual(session(r, 'lite').copyTokens, [{ arm: 'lite', tokens: 100, spec: 82, dict: 0 }]);
  assert.deepEqual(session(r, 'terse').copyTokens, [{ arm: 'terse', tokens: 80, spec: 62, dict: 0 }]);
  const off = session(r, 'switch').copyTokens[1];
  assert.equal(off.arm, 'off');
  assert.equal(off.tokens, count(wrapped('<!-- brevity arm: off -->\n')));
  // Written at the first call that carries it, then read.
  close(session(r, 'lite').copyCost, 100 * (2 + 0.05));
  close(session(r, 'terse').copyCost, 80 * (2 + 0.05 + 0.05));
  // The lite copy outlives the resume and is written again after 90 idle minutes; the off copy joins it.
  close(session(r, 'switch').copyCost, 100 * (2 + 0.05 + 2 + 0.05) + 26 * (2 + 0.05));
  assert.deepEqual(r.duplicates.map((d) => [d.session, d.copies, d.calls]), [['switch', 2, 2]]);
});

test('a session is under the arm of the last copy its calls carried; what it sends is written under the newest copy in its context', async () => {
  const r = await arms();
  assert.deepEqual(r.team.sessions.map((s) => [s.id, s.arm, s.arms]), [
    ['lite', 'lite', ['lite']], ['terse', 'terse', ['terse']], ['switch', 'off', ['lite', 'off']], ['plain', 'none', []],
  ]);
  // Under lite and terse every message is that arm's. M1: 25 tokens, its output, then written at the sender's next call.
  const [m1] = messages(session(r, 'lite'), 'sent');
  assert.deepEqual([m1.arm, m1.style, m1.ratio, m1.tokens, m1.brevity], ['lite', 'lite', 0.087, 25, false]);
  close(m1.saving, saved(25, 0.087) * (5 + 2));
  const [m2] = messages(session(r, 'terse'), 'sent');
  assert.deepEqual([m2.arm, m2.style, m2.ratio, m2.tokens], ['terse', 'terse', 0.102, 16]);
  close(m2.saving, saved(16, 0.102) * (5 + 2));
  // M3 went out under lite, before the resume; M4 under off, which saves nothing, though it has a verb line.
  const [m3, m4] = messages(session(r, 'switch'), 'sent');
  assert.deepEqual([m3.arm, m3.style, m3.ratio], ['lite', 'lite', 0.087]);
  close(m3.saving, saved(18, 0.087) * (5 + 2 + 2 + 0.05));
  assert.deepEqual([m4.arm, m4.style, m4.brevity, m4.ratio, m4.saving], ['off', 'brevity', true, 0, 0]);
});

test('a received message takes the arm and style of the sent message with the same text', async () => {
  const r = await arms();
  const [got] = messages(session(r, 'terse'), 'received');
  assert.deepEqual([got.arm, got.style, got.ratio, got.tokens, got.brevity], ['lite', 'lite', 0.087, 25, false]);
  // Written at the receiver's next call, read at the one after.
  close(got.saving, saved(25, 0.087) * (2 + 0.05));
  assert.deepEqual(session(r, 'terse').tally, {
    sentBrevity: 0, sentLite: 0, sentTerse: 1, sentProse: 0, failed: 0, deliveredBrevity: 0, deliveredLite: 0, deliveredTerse: 1,
    deliveredProse: 0, delegations: 0, receivedBrevity: 0, receivedLite: 1, receivedTerse: 0, receivedProse: 0, subagentPrompts: 0,
    handbacks: 0, messageTokens: 16 + 25, brevityTokens: 0, delivered: 1, clarified: 0, corrected: 0, resent: 0,
    delegationsStarted: 0, delegationsClarified: 0, delegationsCorrected: 0, delegationsResent: 0,
  });
});

test('the per-arm summary adds up the sessions under each arm', async () => {
  const r = await arms();
  const a = r.team.arms;
  assert.deepEqual(Object.keys(a), ['lite', 'terse', 'off', 'none']);
  assert.deepEqual(Object.values(a).map((x) => [x.ratio, x.sessions, x.sent, x.received]), [
    [0.087, ['lite'], 1, 0], [0.102, ['terse'], 1, 1], [0, ['switch'], 2, 0], [null, ['plain'], 0, 0],
  ]);
  for (const [arm, x] of Object.entries(a)) {
    const ss = r.team.sessions.filter((s) => s.arm === arm);
    close(x.calls, ss.reduce((t, s) => t + s.calls, 0));
    close(x.bill, ss.reduce((t, s) => t + s.bill, 0));
    close(x.loadCost, ss.reduce((t, s) => t + s.specCost, 0));
    close(x.saving, ss.reduce((t, s) => t + s.saving, 0));
    close(x.net, x.saving - x.loadCost);
    close(x.shareOfBill.net, x.net / x.bill);
  }
  // lite: 2 calls, 2,355 + 455.25.
  close(a.lite.bill, 2810.25);
  close(a.lite.saving, saved(25, 0.087) * 7);
  close(a.lite.shareOfBill.loadCost, 205 / 2810.25);
  assert.equal(a.off.compressed, 1, 'M3, written under lite before the switch');
  const text = render(r);
  assert.match(text, /^session +arm +calls +bill +copies +load cost +sent b\/l\/t\/p +received b\/l\/t\/p/m);
  assert.match(text, /^terse +terse +3 +3,222 +1 +168 +0\/0\/1\/0 +0\/1\/0\/0 /m);
  assert.match(text, /^arm = the arm of the last copy the session's counted calls carried, else of its last copy/m);
  assert.match(text, /^per arm \(each session under its arm, as above/m);
  assert.match(text, /^lite +0\.087 +1 +2 +2,810 +205 +7\.29% +1 +0 +17 +0\.59% +-188 +-6\.70%$/m);
  assert.match(text, /^none +- +1 +1 +1,255 +0 /m);
  assert.match(text, /with r = brevity 0\.154, lite 0\.087, terse 0\.102 \(the single-pass pilot, issue #26\)/);
  assert.match(text, /messages: 1 brevity, 2 lite, 1 terse and 0 prose SendMessage deliveries/);
});

test('--saving-ratio replaces the ratio of every arm, and off still saves nothing', async () => {
  const r = await arms('--saving-ratio', '0.2');
  assert.deepEqual(r.savingRatios, { brevity: 0.2, lite: 0.2, terse: 0.2, off: 0 });
  assert.equal(r.savingRatioOverride, 0.2);
  assert.equal(r.savingRatio, 0.2, 'the key earlier versions wrote');
  const [m1] = messages(session(r, 'lite'), 'sent');
  close(m1.saving, saved(25, 0.2) * 7);
  assert.equal(messages(session(r, 'switch'), 'sent')[1].saving, 0);
  assert.equal(r.team.arms.lite.ratio, 0.2);
  assert.match(render(r), /with r = 0\.2 for brevity, lite and terse \(--saving-ratio\)/);
  const plain = await arms();
  assert.deepEqual(plain.savingRatios, { brevity: 0.154, lite: 0.087, terse: 0.102, off: 0 });
  assert.equal(plain.savingRatioOverride, null);
  assert.equal(plain.savingRatio, 0.154);
  // The exported meter() still takes the single `ratio` of earlier versions.
  const records = await meterRecords(transcripts([armsDir]), { count, ratio: 0.2 });
  const lite = records.find((x) => x.id === 'lite').messages[0];
  assert.deepEqual([lite.ratio, lite.saving], [0.2, saved(25, 0.2) * 7]);
  assert.equal(records.find((x) => x.id === 'switch').messages[1].ratio, 0, 'off still saves nothing');});

test('--team-json counts the messages that save, each at its own ratio', async () => {
  const file = join(dir, 'arms.json');
  const res = node(['--project', armsDir, '--team-json', file]);
  assert.equal(res.status, 0, res.stderr);
  // M4, written under off, is not one of them.
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).map((x) => [x.name, x.sent, x.received]), [
    ['lite', 1, 0], ['terse', 1, 1], ['switch', 1, 0], ['plain', 0, 0],
  ]);
  const mean = (saved(25, 0.087) + saved(16, 0.102) + saved(25, 0.087) + saved(18, 0.087)) / 4;
  assert.match(res.stdout, new RegExp(`--saving ${+mean.toFixed(1)} `));
});

// The quality fixture, read with chars/4.
const qualityDir = join(here, 'fixtures', 'meter', 'quality');
const quality = (...args) => run(['--project', qualityDir, ...args], { count, cwd: dir });
// Each sent message's signals, in order: "-" for none, "failed" for a send that failed.
const signalsOf = (s) => messages(s, 'sent').map((m) => (m.failed ? 'failed'
  : ['clarified', 'corrected', 'resent'].filter((k) => m[k]).join('+') || '-'));

test('a clarification is a question with a clarification word, or one that names or quotes the message', () => {
  const got = 'Rebase feat/cart on next before you push.\nThe base moved at 9c1e2a7f0.';
  assert.ok(isClarification('Did you mean feat/cart or feat/cart-v2?', got));
  assert.ok(isClarification('Which one: next or main?', 'Rebase on the new base.'));
  assert.ok(isClarification('Got it.\nASK which one: next or main', 'Rebase on the new base.'), 'an ASK line is a question');
  assert.ok(!isClarification('Got it.\nASK which base: next or main', 'Rebase on the new base.'), 'that names nothing from it');
  assert.ok(isClarification('Please clarify the base.', got), 'a request to clarify needs no question mark');
  assert.ok(isClarification('Is 9c1e2a7f0 the old base or the new one?', got), 'a question that names a SHA from it');
  assert.ok(isClarification('Is feat/cart the branch to rebase?', got), 'or a branch');
  assert.ok(isClarification('Does "the base moved" mean next moved?', got), 'or quotes it');
  assert.ok(!isClarification('Should I also update the docs?', got), 'a question that names nothing from it');
  assert.ok(!isClarification('Rebased feat/cart on 9c1e2a7f0.', got), 'no question');
  assert.ok(!isClarification('Rebased feat/cart. The release is a clarification of 0.4.', got), 'a clarification word outside a question');
  assert.ok(!isClarification('May I also rebase feat/cart-v2 on 9c1e2a7f0?', got), 'leave for its own step');
  assert.ok(!isClarification('ASK I rebase feat/cart now', got), 'leave, as an ASK line');
  assert.ok(isClarification('I rebased feat/cart; is 9c1e2a7f0 the base you meant?', got), 'a prose question that starts with I');
  assert.ok(!isClarification('Rebased feat/cart; it keeps `a ?? b` as is.', got), 'code is not a question');
  assert.ok(!isClarification('Is #5 merged?', 'Merge #52 first.'), '#5 is not #52');
});

test('a correction is a correction phrase, a withdrawal, or a FIX line about the sender\'s own words', () => {
  assert.ok(isCorrection('Correction: #43 then #41.'));
  assert.ok(isCorrection('I was wrong about the base: it is next.'));
  assert.ok(isCorrection('Please disregard my last message.'));
  assert.ok(isCorrection('3f9a0c2e1 failed -> WITHDRAWN, the runner was down.'));
  assert.ok(isCorrection('The size was off.\nFIX «20 KB» -> 32 KB (mine)'));
  assert.ok(!isCorrection('Thanks.\nFIX your «12 tests» -> 14 tests'), 'a FIX of the recipient\'s words');
  assert.ok(!isCorrection('Fix the rounding in src/cart.ts.'), 'a request to fix something');
  assert.ok(!isCorrection('Merge order: #41 then #43.'));
});

test('a re-send is a message almost word for word; names match without a tag or past a cut', () => {
  assert.equal(similarity('Please report the CI status of #44.', 'Please report the CI status of #44.'), 1);
  close(similarity('Please report the CI status of #44.', 'Please report the CI status of #44 now.'), 12 / 13);
  assert.ok(similarity('Merge order: #41 then #43.', 'Correction: #43 then #41.') < 0.8);
  assert.equal(similarity('', 'x y'), 0);
  assert.ok(samePeer(['ops [a1b2c3]'], ['uds:fixture-ops', 'ops']), 'a trailing tag is left out');
  assert.ok(samePeer(['Fix the cart rounding (#12) and open…'], [null, 'Fix the cart rounding (#12) and open a PR']), 'a cut name');
  assert.ok(samePeer(['uds:fixture-ops'], ['uds:fixture-ops', 'ops']));
  assert.ok(!samePeer(['dev'], ['uds:fixture-ops', 'ops']));
  assert.ok(!samePeer([undefined], [undefined]));
});

test('each delivered message is clarified, corrected or resent by the rules; a failed send never is', async () => {
  const r = await quality();
  // Q1 Q3 Q5 Q7 Q8 Q9 Q10 Q12, the failed send, its re-send, Q13.
  assert.deepEqual(signalsOf(session(r, 'lead')), ['clarified', 'clarified', '-', 'corrected', '-', '-', 'resent', '-', 'failed', '-', '-']);
  // Q2 Q4 Q6, the reply to Q8, Q14, Q15 (withdrawn by Q16), Q16.
  assert.deepEqual(signalsOf(session(r, 'dev')), ['-', '-', '-', '-', '-', 'corrected', '-']);
  assert.deepEqual(signalsOf(session(r, 'ops')), ['-']);
  const lead = session(r, 'lead').tally;
  assert.deepEqual([lead.delivered, lead.clarified, lead.corrected, lead.resent], [10, 2, 1, 1]);
});

test('a clarification counts only within the window of the recipient\'s calls', async () => {
  // Dev asks about Q13 at its 6th call after Q13 arrives: 5 calls later, outside the default window of 5.
  assert.equal((await quality()).signals.clarifyWindow, 5);
  const wide = await quality('--clarify-window', '6');
  assert.equal(signalsOf(session(wide, 'lead')).at(-1), 'clarified');
  assert.equal(wide.team.total.clarified, 3);
  // Dev asks about Q1 and Q3 at the first call after each arrives, inside the smallest window.
  assert.equal((await quality('--clarify-window', '1')).team.total.clarified, 2);
  for (const bad of ['0', '2.5', 'soon']) {
    const res = node(['--project', qualityDir, '--clarify-window', bad]);
    assert.equal(res.status, 2, bad);
    assert.match(res.stderr, /--clarify-window must be a whole number of calls >= 1/);
  }
});

test('the signals are counted per arm and for the team, per 100 SendMessage deliveries', async () => {
  const r = await quality();
  const a = r.team.arms;
  assert.deepEqual(Object.keys(a), ['lite', 'terse', 'none']);
  assert.deepEqual(['lite', 'terse', 'none'].map((k) => [a[k].delivered, a[k].clarified, a[k].corrected, a[k].resent]), [
    [7, 0, 1, 0], [10, 2, 1, 1], [1, 0, 0, 0],
  ]);
  assert.deepEqual(a.terse.per100, { clarified: 20, corrected: 10, resent: 10 });
  close(a.lite.per100.corrected, 100 / 7);
  const t = r.team.total;
  assert.deepEqual([t.delivered, t.clarified, t.corrected, t.resent], [18, 2, 2, 1]);
  close(t.per100.clarified, 200 / 18);
  assert.deepEqual(r.signals, { heuristic: true, clarifyWindow: 5, resendSimilarity: 0.8 });
  // With no delivery, no rate.
  assert.equal((await arms()).team.arms.none.per100, null);
  const text = render(r);
  assert.match(text, /^quality signals, heuristics: /m);
  assert.match(text, /^arm +delivered +clarified +\/100 +corrected +\/100 +resent +\/100$/m);
  assert.match(text, /^terse +10 +2 +20\.0 +1 +10\.0 +1 +10\.0$/m);
  assert.match(text, /^lite +7 +0 +0\.0 +1 +14\.3 +0 +0\.0$/m);
  assert.match(text, /^team +18 +2 +11\.1 +2 +11\.1 +1 +5\.6$/m);
  assert.match(text, /within its next 5 calls, asks about it/);
});

const linkingDir = join(here, 'fixtures', 'meter', 'linking');
const linking = () => run(['--project', linkingDir], { count, cwd: dir });

test('a correction sent after a session continues under a new id counts on the original message', async () => {
  const r = await linking();
  // O1 is owned by orig; cont's copy of it is not, and cont's correction flags the original.
  assert.deepEqual(signalsOf(session(r, 'orig')), ['corrected']);
  assert.deepEqual(messages(session(r, 'cont'), 'sent').map((m) => [m.owned, m.counted, m.corrected]), [[false, false, false], [true, true, false]]);
  assert.deepEqual([session(r, 'orig').tally.corrected, session(r, 'cont').tally.delivered], [1, 1]);
});

test('a received message is matched by text when its msg_id is not a send\'s, and by sender name when two sent that text', async () => {
  const r = await linking();
  // Peer's "Which one" goes to y: the clarification lands on y's message, not on x's with the same text.
  assert.deepEqual(signalsOf(session(r, 'y')), ['clarified']);
  assert.deepEqual(signalsOf(session(r, 'x')), ['-']);
  // The copy from w names a session that sent nothing measured: ambiguous, so it flags nothing.
  assert.equal(r.team.total.clarified, 1);
});

test('the signals leave no message text or session names in the output', async () => {
  const json = node(['--project', qualityDir, '--json']);
  assert.equal(json.status, 0, json.stderr);
  assert.doesNotMatch(json.stdout, /feat\/cart|tests\/cart|Correction|WITHDRAWN|runner|uds:|a1b2c3|"(?:text|peer|msgId|ord)"/);
  const text = node(['--project', qualityDir]);
  assert.doesNotMatch(text.stdout, /feat\/cart|uds:|a1b2c3/);
  const records = await meterRecords(transcripts([qualityDir]), { count });
  for (const m of records.flatMap((x) => x.messages)) for (const key of ['text', 'peer', 'msgId', 'ord', 'hash']) assert.ok(!(key in m), key);
});

const delegationDir = join(here, 'fixtures', 'meter', 'delegation');
const delegation = (...args) => run(['--project', delegationDir, ...args], { count, cwd: dir });
// Each delegation prompt's signals, in order: "-" for none, "failed" for a spawn that failed.
const delegationSignalsOf = (s) => messages(s, 'delegation-sent').map((m) => (m.failed ? 'failed'
  : ['clarified', 'corrected', 'resent'].filter((k) => m[k]).join('+') || '-'));

test('a delegation prompt starts the session whose first message it is: one each, the newest original sent before it', async () => {
  const r = await delegation();
  const coord = session(r, 'coord');
  // D1 D2 D3 D4 D5 D5b D6 D7 D8 D9. D3 and D7 have the same text: s3 started before D7 was sent, s7 after. s5 takes
  // D5, not D5b, which failed after it. s8 and s9 both started after D8 and D9: s8, first, takes the newer D9, and s9
  // takes D8. s9b, which continues s9, keeps s9's prompt. s0 began with D2's text before D2 was sent: no prompt
  // started it, and D2 is s2's.
  assert.deepEqual(messages(coord, 'delegation-sent').map((m) => m.started),
    [true, true, true, false, true, false, false, true, true, true]);
  for (const id of ['s1', 's2', 's3', 's5', 's7', 's8', 's9']) assert.equal(messages(session(r, id), 'delegation-received').length, 1, id);
  assert.deepEqual(messages(session(r, 's9b'), 'delegation-received').map((m) => [m.owned, m.counted]), [[false, false]]);
  assert.equal(messages(session(r, 's0'), 'delegation-received').length, 0);
  assert.equal(session(r, 's0').tally.receivedProse + session(r, 's0').tally.receivedTerse, 0);
  // coord2's copies of D1, D2 and D3 are not owned: the originals in coord are the ones started and counted.
  assert.deepEqual(messages(session(r, 'coord2'), 'delegation-sent').map((m) => [m.owned, m.counted, m.started]),
    [[false, false, false], [false, false, false], [false, false, false]]);
  // A spawn whose result is an error failed: it is neither sent nor a delegation prompt.
  assert.deepEqual([coord.tally.failed, coord.tally.delegations, coord.tally.delegationsStarted], [2, 8, 7]);
  assert.equal(coord.tally.sentTerse, 8 + 8, 'eight SendMessage deliveries and eight delegation prompts');
});

test('each delivered delegation prompt is clarified, corrected or resent by the rules; a failed spawn never is', async () => {
  const r = await delegation();
  // D1: s1 asks "Did you mean" 7 calls in; coord answers plainly, and coord2's correction counts on the original.
  // D2: s2's question names D2's file, but only after coord wrote to it again. D3: s3's "Did you mean" goes to a third
  // session and its question to coord asks leave; coord2 corrects it by D3's title, and its copy of D3 stands for the
  // original although D7 has the same text. D5: coord2 writes to s5 before s5 asks, under coord's name. D6 repeats D1
  // and started nothing, so coord's correction to D1's session after it is not D6's. D7 repeats D3; coord corrects s7
  // by s7's own title, and that correction reaches s7, matched by its text, before s7 asks. D8: coord's correction,
  // with no msg_id and addressed by the title D8 and D9 share, reaches s9b, which continues D8's session: it is
  // matched by the transcript that received its text, so it is not D9's. D9 repeats D8.
  assert.deepEqual(delegationSignalsOf(session(r, 'coord')),
    ['clarified+corrected', '-', 'corrected', 'failed', '-', 'failed', 'resent', 'corrected+resent', 'corrected', 'resent']);
  // No call window applies to a delegation prompt, whatever --clarify-window says.
  assert.equal(delegationSignalsOf(session(await delegation('--clarify-window', '1'), 'coord'))[0], 'clarified+corrected');
  const t = session(r, 'coord').tally;
  assert.deepEqual([t.delegations, t.delegationsStarted, t.delegationsClarified, t.delegationsCorrected, t.delegationsResent], [8, 7, 1, 4, 3]);
});

test('the delegation signals are counted apart from the SendMessage ones, per arm and for the team', async () => {
  const r = await delegation();
  // The SendMessage signals: coord's correction after D6 corrects its answer to s1, s2's question clarifies coord's
  // correction, which corrects coord's thanks, and s5's question clarifies what coord2 wrote to it. The prompts are
  // not among them.
  assert.deepEqual(signalsOf(session(r, 'coord')), ['corrected', 'corrected', 'clarified', '-', '-', '-', '-', '-']);
  assert.deepEqual(signalsOf(session(r, 'coord2')), ['-', '-', 'clarified']);
  const t = r.team.total;
  assert.deepEqual([t.delivered, t.clarified, t.corrected, t.resent], [18, 2, 2, 0]);
  assert.deepEqual([t.delegations, t.delegationsStarted, t.delegationsClarified, t.delegationsCorrected, t.delegationsResent], [8, 7, 1, 4, 3]);
  assert.deepEqual(t.delegationPer100, { clarified: 12.5, corrected: 50, resent: 37.5 });
  const a = r.team.arms;
  assert.deepEqual(Object.keys(a), ['lite', 'terse', 'none']);
  assert.deepEqual(['lite', 'terse', 'none'].map((k) => [a[k].delegations, a[k].delegationsStarted, a[k].delegationsClarified,
    a[k].delegationsCorrected, a[k].delegationsResent]), [[0, 0, 0, 0, 0], [8, 7, 1, 4, 3], [0, 0, 0, 0, 0]]);
  assert.equal(a.lite.delegationPer100, null, 'with no prompt, no rate');
  assert.deepEqual([a.terse.delivered, a.terse.clarified, a.terse.corrected], [11, 2, 2]);
  const text = render(r);
  assert.match(text, /^delegation signals, heuristics, apart from the SendMessage ones: /m);
  assert.match(text, /^arm +prompts +started +clarified +\/100 +corrected +\/100 +resent +\/100$/m);
  assert.match(text, /^terse +8 +7 +1 +12\.5 +4 +50\.0 +3 +37\.5$/m);
  assert.match(text, /^lite +0 +0 +0 +- +0 +- +0 +-$/m);
  assert.match(text, /^team +8 +7 +1 +12\.5 +4 +50\.0 +3 +37\.5$/m);
  assert.match(text, /^team +18 +2 +11\.1 +2 +11\.1 +0 +0\.0$/m, 'the SendMessage table');
  assert.match(text, /no call window: a new session reads before it writes/);
});

test('the delegation signals leave no prompt text or session names in the output', async () => {
  const json = node(['--project', delegationDir, '--json']);
  assert.equal(json.status, 0, json.stderr);
  assert.doesNotMatch(json.stdout, /cart|acme|Synthetic|uds:|"(?:text|peer|msgId|ord|hash|title|key)"/);
  const text = node(['--project', delegationDir]);
  assert.equal(text.status, 0, text.stderr);
  assert.doesNotMatch(text.stdout, /cart|acme|Synthetic|uds:/);
  const records = await meterRecords(transcripts([delegationDir]), { count });
  for (const m of records.flatMap((x) => x.messages)) for (const key of ['text', 'peer', 'msgId', 'ord', 'hash', 'key']) assert.ok(!(key in m), key);
  for (const x of records) assert.ok(!('first' in x));
});
