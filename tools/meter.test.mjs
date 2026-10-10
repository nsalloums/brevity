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
// message before it loads the spec, at a resume.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run as costModel } from './cost-model.mjs';
import { callBill, defaultProjects, isBrevity, projectFolder, readPrice, render, run, writeRate } from './meter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tool = join(here, 'meter.mjs');
const team = join(here, 'fixtures', 'meter', 'team');
const late = join(here, 'fixtures', 'meter', 'late');
const dir = mkdtempSync(join(tmpdir(), 'brevity-meter-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const count = (t) => Math.ceil(t.length / 4);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const meter = (...args) => run(['--project', team, ...args], { count, cwd: dir });
const session = (r, id) => r.team.sessions.find((s) => s.id === id);
const messages = (s, dir_) => s.messages.filter((m) => m.dir === dir_);
const cli = (...args) => spawnSync(process.execPath, [tool, '--project', team, ...args], { encoding: 'utf8', cwd: dir });

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
    sentBrevity: 2, sentProse: 1, failed: 1, deliveredBrevity: 1, deliveredProse: 1, delegations: 1,
    receivedBrevity: 1, receivedProse: 0, subagentPrompts: 1, handbacks: 1, messageTokens: 50 + 40 + 100 + 60, brevityTokens: 50 + 100 + 60,
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
  assert.match(render(r), /on those calls, spec cost 400 \(43\.66%\), estimated saving 0 \(0\.03%\), net -400 \(-43\.63%\)/);
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
  assert.match(plain.stdout, /^hub +8 /m);
  assert.match(plain.stdout, /duplicated spec copies \(two or more in one context, issue #39\):\n {2}hub {2}2 copies/);
  assert.match(plain.stdout, /est\. saving is an estimate/);
  assert.match(plain.stdout, /^tokenizer: /m);
  assert.doesNotMatch(plain.stdout, /acme hub \(synthetic\)/);
  const titled = cli('--titles');
  assert.match(titled.stdout, /acme hub \(synthetic\)/);
  if (/^tokenizer: chars\/4/m.test(plain.stdout)) assert.match(plain.stdout, /in the brevity checkout that holds this tool/);
  const json = cli('--json');
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.team.sessions.length, 3);
  assert.doesNotMatch(json.stdout, /rebase fix\/cart|Synthetic fixture text|acme hub/, 'no message text or title in --json');
  // --json gives 8-character ids and no message times; --titles gives the full ids and the times.
  const lateJson = (...args) => JSON.parse(spawnSync(process.execPath, [tool, '--project', late, '--json', ...args], { encoding: 'utf8', cwd: dir }).stdout);
  const short = lateJson().team.sessions[0];
  assert.equal(short.id, '11111111');
  assert.equal(short.messages[0].ts, undefined);
  const full = lateJson('--titles').team.sessions[0];
  assert.equal(full.id, '11111111-2222-4333-8444-555555555555');
  assert.equal(full.messages[0].ts, '2026-01-05T09:00:05.000Z');
  const bad = cli('--since', 'yesterday');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--since must be an ISO time/);
  const missing = spawnSync(process.execPath, [tool, '--project', join(dir, 'nowhere')], { encoding: 'utf8', cwd: dir });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such folder/);
});

test('a project with no transcripts folder says so', async () => {
  const home = join(dir, 'home');
  mkdirSync(join(home, 'projects'), { recursive: true });
  await assert.rejects(run([], { count, cwd: join(dir, 'nothing-here'), home }), /no Claude Code project folder/);
});
