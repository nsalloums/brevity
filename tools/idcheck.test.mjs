#!/usr/bin/env node
// Tests for tools/idcheck.mjs, on synthetic messages only:  node --test tools/idcheck.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, coverage, expand, KINDS, parseArgs, present, tokens } from './idcheck.mjs';

const tools = dirname(fileURLToPath(import.meta.url));
const tool = join(tools, 'idcheck.mjs');
const dir = mkdtempSync(join(tmpdir(), 'brevity-idcheck-'));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const file = (data) => { const f = join(dir, `f${n++}.json`); writeFileSync(f, JSON.stringify(data)); return f; };

// Runs the tool on files, as a user would, and splits its output into the summary and the miss lines.
function run(args, script = tool) {
  const res = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const at = res.stdout.indexOf('\n}');
  const summary = at >= 0 ? JSON.parse(res.stdout.slice(0, at + 2)) : null;
  const lines = at >= 0 ? res.stdout.slice(at + 2).split('\n').filter(Boolean) : [];
  return { status: res.status, summary, lines, stderr: res.stderr };
}
// Runs the tool on one message and its encoding.
const cli = (text, enc, ...args) => run([file([{ id: 'm1', text }]), file([{ id: 'm1', enc }]), ...args]);
// The tokens of a text, as kind=value.
const toks = (text, cov) => tokens(text, cov).map((t) => `${t.kind}=${t.v}`);
const lines = (text, cov) => toks(text, cov).filter((t) => t.startsWith('line='));
const refs = (text, cov) => toks(text, cov).filter((t) => t.startsWith('ref='));
// What an encoding misses from its original, as kind=value.
const misses = (text, enc, opts) => check([{ id: 'm', text }], [{ id: 'm', enc }], opts).perMsg.flatMap((p) => p.missing.map((t) => `${t.kind}=${t.v}`));

const ISSUE = 'Fixed #7 in app/views.py:42 and lib/x.go:118, +5/-3';

test("the issue's own example now reports its misses (#56)", () => {
  assert.deepEqual(misses(ISSUE, 'Fixed it'), ['ref=7', 'line=42', 'line=118']);
  assert.deepEqual(misses(ISSUE, 'Fixed it', { smallNumbers: true }), ['ref=7', 'line=42', 'line=118', 'num=5', 'num=3']);
  // The coverage of 0.7.0 checked none of them.
  const legacy = check([{ id: 'm', text: ISSUE }], [{ id: 'm', enc: 'Fixed it' }], { legacy: true }).summary;
  assert.equal(legacy.identifiersChecked, 0);
  // A full encoding passes.
  assert.deepEqual(misses(ISSUE, 'Fixed #7: app/views.py:42, lib/x.go:118, +5/-3', { smallNumbers: true }), []);
  // The issue's control is flagged under every coverage.
  for (const opts of [{}, { smallNumbers: true }, { legacy: true }]) assert.deepEqual(misses('Fixed it in src/total.ts:42', 'Fixed it', opts), ['line=42']);

  const r = cli(ISSUE, 'Fixed it');
  assert.equal(r.status, 1);
  assert.equal(r.summary.identifiersChecked, 3);
  assert.equal(r.summary.missing, 3);
  assert.deepEqual(r.lines, ['m1: ref=7, line=42, line=118']);
  const s = cli(ISSUE, 'Fixed it', '--small-numbers');
  assert.deepEqual(s.lines, ['m1: ref=7, line=42, line=118, num=5, num=3']);
});

// Synthetic messages that exercise the rules 0.7.0 applied. LEGACY_OUTPUT is what tools/idcheck.mjs printed for them
// at brevity 0.7.0 (commit d3d4c06), so --legacy must still print it.
const MESSAGES = [
  { id: 'a', text: 'Head abc1234 adds 12 tests and 312 lines' },
  { id: 'b', text: 'Adds 12 tests in src/cart.ts:42-58' },
  { id: 'c', text: 'A 42-line change to app/views.py:42, +12/-57, #7 and #16a34a' },
  { id: 'd', text: 'Rename «Keep what matters» in CartPage.tsx:9' },
  { id: 'e', text: 'Was «ship the big fix», now «ship the fix», due 2026-10-12' },
  { id: 'f', text: 'Rebase #12 on 3fa4c9e2b1, then #214 and #215' },
  { id: 'g', text: 'See github.com/o/r/pull/31 and https://example.dev/src/a.ts:23' },
];
const ENCODINGS = [
  { id: 'a', enc: 'head abc1234: 312 lines' },
  { id: 'b', enc: 'adds 312 tests in P.Cart:42-58' },
  { id: 'c', enc: 'change views +12, #16a34a' },
  { id: 'd', enc: 'rename x.KWM in P.Cart:9' },
  { id: 'e', enc: 'title «ship the {-big }fix», due 10-12' },
  { id: 'f', enc: 'rebase #120 on 3fa4c9e2b, then NUM 214: #214 #215' },
  { id: 'g', enc: 'see pull/31 and a.ts:23' },
];
const DICT = { 'src/cart.ts': 'P.Cart', 'Keep what matters': 'KWM' };
const LEGACY_OUTPUT = {
  status: 1,
  summary: { messages: 7, identifiersChecked: 18, missing: 4, messagesWithMissing: 4 },
  lines: ['b: num=12', 'c: ref=16', 'd: quote=Keep what matters', 'f: ref=12'],
};

test('--legacy prints what 0.7.0 printed', () => {
  const r = run([file(MESSAGES), file(ENCODINGS), '--dict', file(DICT), '--legacy']);
  assert.equal(r.status, LEGACY_OUTPUT.status);
  for (const [k, v] of Object.entries(LEGACY_OUTPUT.summary)) assert.equal(r.summary[k], v, k);
  assert.deepEqual(r.lines, LEGACY_OUTPUT.lines);
  // The default coverage adds the one-digit #7, views.py:42, the 42 of 42-line (#64) and the -57; the colour copied
  // verbatim now passes.
  const d = run([file(MESSAGES), file(ENCODINGS), '--dict', file(DICT)]);
  assert.equal(d.summary.identifiersChecked, 22);
  assert.deepEqual(d.lines, ['b: num=12', 'c: ref=7, line=42, num=42, num=57', 'd: quote=Keep what matters', 'f: ref=12']);
});

test('commit SHAs: the encoding keeps a prefix of 9 characters, or the whole of a shorter SHA', () => {
  const sha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
  assert.equal(sha.length, 40);
  assert.deepEqual(toks(`Merged ${sha}`), [`sha=${sha}`]);
  assert.deepEqual(misses(`Merged ${sha}`, 'Merged a1b2c3d4e'), []);
  assert.deepEqual(misses(`Merged ${sha}`, `Merged ${sha}`), []);
  assert.deepEqual(misses(`Merged ${sha}`, 'Merged a1b2c3d4'), [`sha=${sha}`]);
  assert.deepEqual(misses('Head abc1234', 'head abc1234'), []);
  assert.deepEqual(misses('Head abc1234', 'head abc123'), ['sha=abc1234']);
  // Hex needs a digit and a letter: a word or a plain number is not a SHA.
  assert.deepEqual(toks('deadbeef 12345678'), ['num=12345678']);
  // A number of two or more digits inside a SHA of the original is not counted again.
  assert.deepEqual(toks('Head abc1234 adds 12 tests', { legacy: true }), ['sha=abc1234']);
});

test('#N references of any length, and PR and issue URLs', () => {
  assert.deepEqual(refs('#214 waits on #7 and github.com/o/r/pull/5, see github.com/o/r/issues/31'), ['ref=5', 'ref=31', 'ref=214', 'ref=7']);
  for (const form of ['(#7)', '#7.', '#7,', "#7's fix", 'o/r#7', 'PR#7', '#7-9', '#7 [4/5] RUN npm ci']) assert.deepEqual(refs(`See ${form}`), ['ref=7'], form);
  assert.deepEqual(refs('See #7-#9'), ['ref=7', 'ref=9']);
  // An HTML entity, a colour, a decimal, a heading anchor, a URL fragment and #0 are not references.
  for (const form of ['&#9;', '#3b82f6', '#1.5', '#0', '#7a', '#7_x', 'SPEC.md#4-edits', 'https://docs.example.org/guide#5']) {
    assert.deepEqual(refs(`See ${form}`), [], form);
  }
  // 0.7.0 checked two digits or more.
  assert.deepEqual(refs('#7 and #12', { legacy: true }), ['ref=12']);
  assert.deepEqual(refs('#7 and #12'), ['ref=12', 'ref=7']);
  // Any standalone form of the number keeps it; a longer number or an ordinal does not.
  for (const enc of ['#7', 'pull/7', 'issues/7', 'PR 7']) assert.deepEqual(misses('Rebase #7', enc), [], enc);
  assert.deepEqual(misses('Rebase #7', 'Rebase it'), ['ref=7']);
  assert.deepEqual(misses('Rebase #7 first', 'Rebase #70 first'), ['ref=7']);
  assert.deepEqual(misses('Rebase #12 first', 'Rebase #120 first', { legacy: true }), ['ref=12']);
  assert.deepEqual(misses('CI attempt #2 failed', 'CI 2nd attempt failed'), ['ref=2']);
  assert.deepEqual(misses('See github.com/o/r/pull/5', 'see #5'), []);
  // `NUM n: #A #B` carries n and n+1 (SPEC section 3).
  assert.deepEqual(misses('41 is #120, 42 is #121', 'NUM 41: #120 #121'), []);
  // A colour of two or more digits is a reference, as in 0.7.0; outside --legacy a verbatim copy keeps it.
  assert.deepEqual(refs('Badge #16a34a'), ['ref=16']);
  assert.deepEqual(misses('Badge #16a34a', 'badge #16a34a'), []);
  assert.deepEqual(misses('Badge #16a34a', 'badge #16a34a', { legacy: true }), ['ref=16']);
  assert.deepEqual(misses('Badge #16a34a', 'badge #160'), ['ref=16']);
});

test('file:line for any extension', () => {
  const text = 'app/views.py:42 lib/x.go:118-120 src/main.rs:~7 tools/build.ps1:3 m.f90:12 c.vue:9 a.json5:4 .env.local:2 README.MD:5';
  assert.deepEqual(lines(text), ['line=42', 'line=118', 'line=120', 'line=7', 'line=3', 'line=12', 'line=9', 'line=4', 'line=2', 'line=5']);
  assert.deepEqual(misses('Broke app/views.py:42-58', 'Broke views.py 42-58'), []);
  assert.deepEqual(misses('Broke app/views.py:42-58', 'Broke views.py 42'), ['line=58']);
  // The extension has 1 to 8 letters and digits.
  assert.deepEqual(lines('docs/guide.markdown:3 ui/Cart.svelte:12 x.c:7'), ['line=3', 'line=12', 'line=7']);
  assert.deepEqual(lines('See x.abcdefghi:4 now'), []);
  // The extensions 0.7.0 checked still count everywhere, even inside a URL, in any case.
  for (const cov of [{}, { legacy: true }]) {
    assert.deepEqual(lines('src/a.ts:12 b.tsx:13 c.mjs:14 d.md:15 e.sql:16 f.yml:17 g.yaml:18 h.json:19 i.css:20 j.jsx:21 k.js:22 https://x.dev/a.ts:23', cov),
      ['line=12', 'line=13', 'line=14', 'line=15', 'line=16', 'line=17', 'line=18', 'line=19', 'line=20', 'line=21', 'line=22', 'line=23']);
  }
  assert.deepEqual(lines('See https://x.dev/README.MD:5 now'), ['line=5']);
  assert.deepEqual(lines('app/views.py:42', { legacy: true }), []);
  // A URL earlier in the message does not hide a later file:line; a mention or a file:// link does not either.
  assert.deepEqual(lines('See https://example.dev/x then fix app/views.py:42'), ['line=42']);
  assert.deepEqual(lines('The bug is in @views.py:42'), ['line=42']);
  assert.deepEqual(lines('file:///home/u/app/views.py:42'), ['line=42']);
  // Anything else shaped like name.ext:N counts, as the header says: a port on another host, a dotted key.
  assert.deepEqual(lines('server.port:8080 and api.example.dev:8443 and db.ci.local:5432'), ['line=8080', 'line=8443', 'line=5432']);
});

test('file:line still skips URLs, hosts and ports, times and versions', () => {
  const hosts = [
    'https://example.com:8080/x', 'http://build.internal:9000', 'http://h.example.dev:8443/', 'ssh git@build.example.dev:22',
    'deploy@build.lan:22', 'api.example.com:8443', 'db.example.net:5432', 'notes.example.org:80', 'cdn.example.io:443',
    'host.docker.internal:5432', 'host.example.dev:8080/health', '[link](https://ci.example.dev:8443)',
    'redis://cache.example.dev:6379', 'ssh://git.example.dev:2222',
  ];
  const times = ['12.30:45', '10.0.0.1:8080', 'v1.2:30', 'at 14.05:10'];
  for (const form of [...hosts, ...times]) assert.deepEqual(lines(`See ${form} now`), [], form);
});

test('numbers and diffstats of two or more digits by default, of any size with --small-numbers', () => {
  // The -M of +N/-M sits after a slash, which 0.7.0 skipped.
  assert.deepEqual(toks('Diff +12/-34'), ['num=12', 'num=34']);
  assert.deepEqual(toks('Diff +12/-34', { legacy: true }), ['num=12']);
  assert.deepEqual(toks('Diff +12 -34', { legacy: true }), ['num=12', 'num=34']);
  assert.deepEqual(misses('Diff +12/-34', 'Diff +12'), ['num=34']);
  // N and -M follow the rules of other numbers: grouped in thousands, before a unit, not before hex.
  assert.deepEqual(toks('Diff +1,204/-87'), ['num=1,204', 'num=87']);
  assert.deepEqual(toks('Diff +1,204/-87', { legacy: true }), ['num=204']);
  assert.deepEqual(toks('Diff +5/-12,345'), ['num=12,345']);
  assert.deepEqual(toks('Took +12/-34ms'), ['num=12', 'num=34']);
  assert.deepEqual(toks('Took 34ms'), ['num=34']);
  assert.deepEqual(toks('A +12/-34-line diff'), ['num=12', 'num=34']);
  assert.deepEqual(toks('A +12/-34-line diff', { legacy: true }), []);
  assert.deepEqual(toks('Diff +12/-34abcd'), ['num=12']);
  assert.deepEqual(toks('Size v2+12/-34 here'), ['num=12']);
  // Small diffstats and numbers only with the option.
  assert.deepEqual(toks('Diff +5/-3'), []);
  assert.deepEqual(toks('Diff +5/-3', { legacy: true }), []);
  assert.deepEqual(toks('Diff +5/-3', { smallNumbers: true }), ['num=5', 'num=3']);
  assert.deepEqual(toks('Diff +50/-3'), ['num=50']);
  assert.deepEqual(toks('Diff +5/-30'), ['num=30']);
  assert.deepEqual(toks('3 files, 12 tests'), ['num=12']);
  assert.deepEqual(toks('3 files, 12 tests', { smallNumbers: true }), ['num=3', 'num=12']);
  assert.deepEqual(misses('3 files, 12 tests', '12 tests', { smallNumbers: true }), ['num=3']);
  // Two digits count even below 10, as in 0.7.0.
  assert.deepEqual(toks('Retry count 03'), ['num=03']);
  // 0.7.0 skipped a number glued to a unit with a-f, and one after a slash; the default checks both (#64).
  assert.deepEqual(toks('A 30-day window, 512mb, 118/120 green', { legacy: true }), ['num=118']);
  assert.deepEqual(toks('A 30-day window, 512mb, 118/120 green'), ['num=30', 'num=512', 'num=118', 'num=120']);
  // A small number that also sits inside a SHA is still checked; one equal to a reference is checked as the reference.
  assert.deepEqual(toks('abc1234 has 2 fixes', { smallNumbers: true }), ['sha=abc1234', 'num=2']);
  assert.deepEqual(toks('#7 adds 7 files', { smallNumbers: true }), ['ref=7']);
  // A 20xx year is implied by an MM-DD date.
  assert.deepEqual(misses('Due 2026-10-12', 'due 10-12'), []);
  assert.deepEqual(misses('Due 2026-10-12', 'due soon'), ['num=2026']);
  assert.deepEqual(misses('Adds 12 tests', 'adds 312 tests'), ['num=12']);
});

test("a SHA's digits in the encoding do not keep a number, outside --legacy", () => {
  const text = 'Fixed the check at views.ts:4, pushed 3fa4c9e2b1';
  const enc = 'FIX check views.ts; pushed 3fa4c9e2b1';
  assert.deepEqual(misses(text, enc), ['line=4']);
  assert.deepEqual(misses(text, enc, { legacy: true }), []);
  assert.deepEqual(misses('Retried 3 times, deployed 9be3c1f02a', 'retried; deployed 9be3c1f02a', { smallNumbers: true }), ['num=3']);
  // A plain number of seven or more digits is not a SHA, so it still counts.
  assert.deepEqual(misses('Build 1234567 passed', 'build 1234567 ok'), []);
  assert.equal(present({ kind: 'num', v: '4' }, 'a 3fa4c9e b'), false);
  assert.equal(present({ kind: 'num', v: '4' }, 'a 3fa4c9e b', { legacy: true }), true);
  assert.equal(present({ kind: 'num', v: '12' }, 'a 120'), false);
});

const ISSUE_64 = 'Use a 30-day window, a 200-line cap and 512mb; suite at 118/120 green';

test("the issue's own example reports its misses (#64)", () => {
  assert.deepEqual(misses(ISSUE_64, 'Use a window, a cap; suite at 118 green'), ['num=30', 'num=200', 'num=512', 'num=120']);
  assert.deepEqual(misses(ISSUE_64, 'Use a window, a cap; suite at 118 green', { legacy: true }), []);
  assert.deepEqual(misses(ISSUE_64, '30d window, 200-line cap, 512 MB; suite 118/120 green'), []);
  const r = cli(ISSUE_64, 'Use a window, a cap; suite at 118 green');
  assert.equal(r.status, 1);
  assert.deepEqual(r.lines, ['m1: num=30, num=200, num=512, num=120']);
});

test('a number before a unit, glued or after - or /, but not inside hex', () => {
  assert.deepEqual(toks('Keep 14d, 30fps, 8080/tcp, 64kb/s, a 42-line diff, a 90-day-old token, 1,024mb'),
    ['num=14', 'num=30', 'num=8080', 'num=64', 'num=42', 'num=90', 'num=1,024']);
  assert.deepEqual(toks('Keep 14d, 30fps, 8080/tcp, 64kb/s, a 42-line diff', { legacy: true }), []);
  // Kept by the number in any form; dropped when only the unit or a SHA carries it.
  assert.deepEqual(misses('A 30-day window', 'window 30d'), []);
  assert.deepEqual(misses('A 30-day window', 'window: 30 days'), []);
  assert.deepEqual(misses('A 30-day window', 'month-long window'), ['num=30']);
  assert.deepEqual(misses('A 30-day window', 'window 30ab12cd'), ['num=30']);
  // Hex is not a number before a unit: two or more letters a-f glued, letters a-f only after - or /, 0x, a SHA, a UUID.
  for (const text of ['Value 12ab', 'Offset 0xff', 'Head 1234abcd', 'Head 1234567d', 'Key 1234-abcd', 'Id 12345678-1234-5678-9abc-def012345678']) {
    assert.deepEqual(toks(text, { smallNumbers: true }).filter((t) => t.startsWith('num=')), [], text);
  }
  assert.deepEqual(toks('Head 1234abcd'), ['sha=1234abcd']);
});

test('the later numbers of N/M and N:M, but not times, URLs or paths', () => {
  assert.deepEqual(toks('Suite at 118/120 green, ratio 16:9, page 3/15'), ['num=118', 'num=120', 'num=16', 'num=15']);
  assert.deepEqual(toks('Suite at 118/120 green, ratio 16:9, page 3/15', { smallNumbers: true }), ['num=118', 'num=120', 'num=16', 'num=9', 'num=3', 'num=15']);
  assert.deepEqual(toks('Suite at 118/120 green, ratio 16:9', { legacy: true }), ['num=118', 'num=16']);
  assert.deepEqual(misses('Suite at 118/120 green', 'suite 118/120'), []);
  assert.deepEqual(misses('Suite at 118/120 green', 'suite 120 of 118'), []);
  assert.deepEqual(misses('Suite at 118/120 green', 'suite 118 green'), ['num=120']);
  assert.deepEqual(misses('Passed 3/5', 'passed 3', { smallNumbers: true }), ['num=5']);
  assert.deepEqual(toks('Passed 3/5'), []);
  // A chain counts each number; a date with slashes is one.
  assert.deepEqual(toks('Due 10/12/2031'), ['num=10', 'num=12', 'num=2031']);
  // A time keeps only its hour, as before: hours up to 24, then two-digit minutes and seconds.
  assert.deepEqual(toks('Standup at 14:30, deploy at 9:05:30, close at 24:00'), ['num=14', 'num=24']);
  assert.deepEqual(toks('Standup at 14:30, deploy at 9:05:30', { smallNumbers: true }), ['num=14', 'num=9']);
  assert.deepEqual(toks('Ran 125:30'), ['num=125', 'num=30']);
  // Inside a URL, before a further path, after a file:line or a word, or with a hex head, the later number is skipped.
  assert.deepEqual(toks('Open https://ci.example.dev/runs?range=12/34 now'), ['num=12']);
  assert.deepEqual(toks('Moved to 2026/10/notes.md'), ['num=2026']);
  assert.deepEqual(toks('Broke app/views.py:42:17'), ['line=42']);
  assert.deepEqual(toks('Serve on localhost:3000 and node:20'), []);
  assert.deepEqual(toks('Card 00:1a:2b:3c:4d:5e', { smallNumbers: true }), []);
  // A SHA after the slash is not a number; the number before it still is.
  assert.deepEqual(toks('Compare 12/3fa4c9e', { smallNumbers: true }), ['sha=3fa4c9e', 'num=12']);
});

test('a number grouped in thousands is one number, kept with either separator or none', () => {
  assert.deepEqual(toks('Scanned 1,088 files and 37,798,511 rows; 2.637 in a dot locale'), ['num=1,088', 'num=37,798,511', 'num=2.637']);
  // 0.7.0 read a grouped number from its last group, or from nothing after a dot.
  assert.deepEqual(toks('Scanned 1,088 files and 37,798,511 rows; 2.637 in a dot locale', { legacy: true }), ['num=088', 'num=37', 'num=798', 'num=511']);
  for (const enc of ['scanned 1,088', 'scanned 1.088', 'scanned 1088']) assert.deepEqual(misses('Scanned 1,088 files', enc), [], enc);
  for (const enc of ['read 2,637 rows', 'read 2637 rows', 'read 2.637 rows']) assert.deepEqual(misses('Read 2.637 rows', enc), [], enc);
  assert.deepEqual(misses('Rows 37,798,511', 'rows 37798511'), []);
  // A plain number of four or more digits is kept by its grouped form too.
  assert.deepEqual(misses('Scanned 1088 files', 'scanned 1,088'), []);
  assert.deepEqual(misses('Build 1234567 passed', 'build 1.234.567 ok'), []);
  // Other digits, a longer number, a rounded decimal or mixed separators do not keep it.
  assert.deepEqual(misses('Scanned 1,088 files', 'scanned 1,000 files'), ['num=1,088']);
  assert.deepEqual(misses('Scanned 1,088 files', 'scanned 1,088,000 files'), ['num=1,088']);
  assert.deepEqual(misses('Scanned 1,088 files', 'scanned 21,088 files'), ['num=1,088']);
  assert.deepEqual(misses('Read 2.637 rows', 'read 2.64 rows'), ['num=2.637']);
  assert.deepEqual(misses('Rows 37,798,511', 'rows 37,798.511'), ['num=37,798,511']);
  assert.deepEqual(misses('Rows 37,798,511', 'rows 37,798'), ['num=37,798,511']);
  // 1,088 and 1088 are one number.
  assert.deepEqual(toks('1088 rows, then 1,088 rows'), ['num=1088']);
  // Groups have exactly three digits and the first is not 0, so versions, addresses, decimals and short lists are not
  // grouped: they read as before.
  for (const text of ['Bump to 1.2.3', 'Host 10.0.0.1', 'Ratio 0.125', 'Took 1,5 s', 'Ids 10,20,30', 'Pick 1,234,56']) {
    assert.deepEqual(toks(text), toks(text, { legacy: true }), text);
  }
});

test('quotes must appear verbatim, and edit markup carries both texts', () => {
  assert.deepEqual(toks('Rename to «Keep what matters»'), ['quote=Keep what matters']);
  assert.deepEqual(misses('Rename to «Keep what matters»', 'rename: "Keep what matters"'), []);
  assert.deepEqual(misses('Rename to «Keep what matters»', 'rename: keep what matters'), ['quote=Keep what matters']);
  const text = 'Was «seventy-seven PRs», now «seventy-eight PRs»';
  assert.deepEqual(misses(text, 'title «seventy-{seven>eight} PRs»'), []);
  assert.deepEqual(misses(text, 'title «seventy-eight PRs»'), ['quote=seventy-seven PRs']);
  assert.deepEqual(misses('Was «ship the big fix», now «ship the fix»', 'title «ship the {-big }fix»'), []);
  assert.match(expand('«a{+b}»'), /«ab»/);
  // Up to 120 characters.
  assert.deepEqual(toks(`«${'x'.repeat(120)}»`), [`quote=${'x'.repeat(120)}`]);
  assert.deepEqual(toks(`«${'x'.repeat(121)}»`), []);
});

test('aliases from --dict count as their long forms', () => {
  const dict = { 'packages/ui/src/pages/CartPage.tsx': 'P.Cart', 'Keep what matters': 'KWM', '#214': 'R.cart' };
  const text = 'packages/ui/src/pages/CartPage.tsx:42 breaks «Keep what matters», see #214';
  const enc = 'P.Cart:42 breaks KWM, see R.cart';
  assert.deepEqual(misses(text, enc, { dict }), []);
  assert.deepEqual(misses(text, enc), ['ref=214', 'quote=Keep what matters']);
  // An alias counts only as a whole word, and not after a dot.
  assert.deepEqual(misses(text, 'P.Cart:42 breaks XKWM, see R.carts', { dict }), ['ref=214', 'quote=Keep what matters']);
  assert.deepEqual(misses(text, 'P.Cart:42 breaks x.KWM, see R.cart', { dict }), ['quote=Keep what matters']);
  const r = cli(text, enc, '--dict', file(dict));
  assert.equal(r.status, 0);
  assert.equal(r.summary.missing, 0);
  assert.equal(r.summary.identifiersChecked, 3);
});

test('the output states the coverage the run used', () => {
  const def = cli('#7 at a.py:3', '#7 at a.py:3');
  assert.equal(def.status, 0);
  assert.equal(Object.keys(def.summary)[0], 'coverage');
  assert.equal(def.summary.coverage, 'SHAs (9-character prefix), #N of 1+ digits and PR/issue URLs, file:line for any extension of 1-8 letters and digits except hosts, numbers and +N/-M diffstats of 2+ digits, also before a unit (30-day, 512mb), after N/ or N: except times (118/120) and grouped in thousands (1,088 or 2.637), «quotes» of up to 120 characters');
  assert.equal(cli('x', 'x', '--small-numbers').summary.coverage, 'SHAs (9-character prefix), #N of 1+ digits and PR/issue URLs, file:line for any extension of 1-8 letters and digits except hosts, numbers and +N/-M diffstats of any size, also before a unit (30-day, 512mb), after N/ or N: except times (118/120) and grouped in thousands (1,088 or 2.637), «quotes» of up to 120 characters');
  assert.equal(cli('x', 'x', '--legacy').summary.coverage, 'legacy (brevity 0.7.0): SHAs (9-character prefix), #N of 2+ digits and PR/issue URLs, file:line for .ts .tsx .js .jsx .mjs .md .sql .json .yaml .yml .css, numbers and diffstats of 2+ digits but not the -M of +N/-M, «quotes» of up to 120 characters');
  assert.equal(coverage(), def.summary.coverage);
  // The counts by kind add up, and the misses are told apart from the checks.
  const r = cli(`${ISSUE} «Ship it» abc1234`, 'Fixed #7 abc1234 «Ship it»');
  assert.deepEqual(Object.keys(r.summary.checkedByKind), KINDS);
  assert.deepEqual(r.summary.checkedByKind, { sha: 1, ref: 1, line: 2, num: 0, quote: 1 });
  assert.deepEqual(r.summary.missingByKind, { sha: 0, ref: 0, line: 2, num: 0, quote: 0 });
  assert.equal(Object.values(r.summary.checkedByKind).reduce((a, b) => a + b), r.summary.identifiersChecked);
  assert.equal(Object.values(r.summary.missingByKind).reduce((a, b) => a + b), r.summary.missing);
});

test('options: a typo or a contradiction stops the run', () => {
  for (const args of [['--small-number'], ['--legacy', '--small-numbers'], ['--dict'], ['--dict', '--legacy'], ['--dict', 'x.json', '--dict', 'y.json']]) {
    const r = cli('x', 'x', ...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage: node tools\/idcheck\.mjs/);
  }
  assert.throws(() => parseArgs(['only-one.json']), /messages file and an encodings file/);
  assert.deepEqual(parseArgs(['a.json', '--dict', 'd.json', 'b.json', '--verbose']), {
    verbose: true, legacy: false, smallNumbers: false, dictFile: 'd.json', files: ['a.json', 'b.json'],
  });
});

test('--verbose prints the failing encoding, and unknown ids go to stderr', () => {
  const r = cli('Rebase #7', 'Rebase it', '--verbose');
  assert.deepEqual(r.lines, ['m1: ref=7', '  ENC: Rebase it']);
  const u = run([file([{ id: 'm1', text: '#12' }]), file([{ id: 'm2', enc: '#12' }])]);
  assert.equal(u.status, 0);
  assert.match(u.stderr, /unknown id m2/);
});

test('the tool runs when it is reached through a symlink or a junction', (t) => {
  const link = join(dir, 'linked-tools');
  try { symlinkSync(tools, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch (err) { t.skip(`cannot link: ${err.code}`); return; }
  const r = run([file([{ id: 'm1', text: ISSUE }]), file([{ id: 'm1', enc: 'Fixed it' }])], join(link, 'idcheck.mjs'));
  assert.equal(r.status, 1);
  assert.deepEqual(r.lines, ['m1: ref=7, line=42, line=118']);
});

test('the default coverage adds to the legacy one and never drops a token', () => {
  const texts = [
    ...MESSAGES.map((m) => m.text), ISSUE, ISSUE_64, 'See https://example.com:8080/src/a.ts:9 and #1234',
    'Head abc1234, 3 tests, v1.2.3 and 2026-10-12 at 14:30', 'foo.py:12.ts:34 and «q 5»', 'C#7 &#39; #3b82f6 #12ab34',
    'Keep 14d, 8080/tcp, 12ab, 0xff, 3/5 and 16:9 at 9:05:30', 'Id 12345678-1234-5678-9abc-def012345678 on 10.0.0.1:8080/health',
  ];
  for (const text of texts) {
    const legacy = toks(text, { legacy: true });
    const def = toks(text);
    const small = toks(text, { smallNumbers: true });
    for (const t of legacy) assert.ok(def.includes(t), `${text}: default lost ${t}`);
    for (const t of def) assert.ok(small.includes(t), `${text}: --small-numbers lost ${t}`);
  }
  // The one exception: a grouped number replaces the last group that 0.7.0 read.
  assert.deepEqual(toks('Scanned 4,215 files', { legacy: true }), ['num=215']);
  assert.deepEqual(toks('Scanned 4,215 files'), ['num=4,215']);
});
