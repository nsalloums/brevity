#!/usr/bin/env node
// Tests for hooks/inject.mjs, the SessionStart hook:  node --test tools/inject.test.mjs
//
// Each test runs the four commands in hooks/hooks.json as Claude Code runs them: the command with ${CLAUDE_PLUGIN_ROOT}
// set to this checkout, the hook input as JSON on stdin, in a synthetic project folder under the system's temp folder.
// Transcripts are synthetic too: a few lines in Claude Code's format, built below.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'brevity-inject-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const lf = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const SPEC = lf(join(repo, 'SPEC.md'));
const LITE = lf(join(repo, 'arms', 'lite.md'));
const TERSE = lf(join(repo, 'arms', 'terse.md'));
const DICT = '# DICT for a synthetic project\nR.ready = open, CLEAN, green\n';

// The hook commands, in order, as hooks.json registers them.
const hooks = JSON.parse(readFileSync(join(repo, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart;
const commands = hooks.flatMap((m) => m.hooks.map((h) => h.command));
// The environment without anything that changes what the hook loads.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BREVITY_|CLAUDE_PROJECT_DIR$|CLAUDE_PLUGIN_ROOT$)/.test(k)));

// Runs every hook command and returns what each part injects ('' for none).
function hook(input, { cwd, extra = {} } = {}) {
  return commands.map((command) => {
    const m = command.replaceAll('${CLAUDE_PLUGIN_ROOT}', repo).match(/^node "([^"]+)" (\d+)$/);
    assert.ok(m, `unexpected hook command: ${command}`);
    const res = spawnSync(process.execPath, [m[1], m[2]], {
      input: JSON.stringify(input), cwd: cwd ?? input.cwd, env: { ...env, CLAUDE_PLUGIN_ROOT: repo, ...extra }, encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    if (!res.stdout) return '';
    const out = JSON.parse(res.stdout).hookSpecificOutput;
    assert.equal(out.hookEventName, 'SessionStart');
    assert.ok(out.additionalContext.length < 10000, `part ${m[2]} is ${out.additionalContext.length} characters`);
    return out.additionalContext;
  });
}

let n = 0;
// A synthetic project: `.brevity/` with an arm file and a dictionary, unless told otherwise.
function project({ arm, dict = true, brevity = true } = {}) {
  const root = join(tmp, `project-${++n}`);
  mkdirSync(join(root, 'src'), { recursive: true });
  if (brevity) mkdirSync(join(root, '.brevity'));
  if (arm !== undefined) writeFileSync(join(root, '.brevity', 'arm'), arm);
  if (dict && brevity) writeFileSync(join(root, '.brevity', 'DICT.md'), DICT);
  return root;
}

// The hook prints each file line by line, so a file that ends with a newline gets one more.
const brevityParts = (root) => [
  `<!-- brevity arm: brevity -->\n<!-- brevity SPEC.md -->\n${SPEC}\n`,
  `<!-- brevity dictionary ${join(root, '.brevity', 'DICT.md')} -->\n${DICT}\n`,
  '', '',
];

test('hooks.json registers four parts on startup, resume, clear and compact', () => {
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].matcher, 'startup|resume|clear|compact');
  assert.equal(commands.length, 4);
});

test('each arm injects its own text after the arm marker, all in part 0 except brevity\'s dictionary', () => {
  const root = project();
  const input = (cwd) => ({ hook_event_name: 'SessionStart', source: 'startup', cwd, session_id: 's-1' });
  // No .brevity/arm: brevity, the spec and the dictionary, exactly as before arms, after the marker.
  assert.deepEqual(hook(input(root)), brevityParts(root));
  writeFileSync(join(root, '.brevity', 'arm'), 'brevity\n');
  assert.deepEqual(hook(input(root)), brevityParts(root));
  writeFileSync(join(root, '.brevity', 'arm'), 'lite\n');
  assert.deepEqual(hook(input(root)), [`<!-- brevity arm: lite -->\n${LITE}\n`, '', '', '']);
  writeFileSync(join(root, '.brevity', 'arm'), 'terse');
  assert.deepEqual(hook(input(root)), [`<!-- brevity arm: terse -->\n${TERSE}\n`, '', '', '']);
  writeFileSync(join(root, '.brevity', 'arm'), 'off');
  assert.deepEqual(hook(input(root)), ['<!-- brevity arm: off -->\n', '', '', '']);
  // From a subfolder, as a session started there finds the project's .brevity/.
  assert.deepEqual(hook(input(join(root, 'src'))), ['<!-- brevity arm: off -->\n', '', '', '']);
});

test('the value is trimmed and read in any case', () => {
  const root = project({ arm: '  Terse \r\n' });
  assert.equal(hook({ source: 'startup', cwd: root })[0], `<!-- brevity arm: terse -->\n${TERSE}\n`);
  writeFileSync(join(root, '.brevity', 'arm'), '﻿LITE\n');
  assert.equal(hook({ source: 'startup', cwd: root })[0], `<!-- brevity arm: lite -->\n${LITE}\n`);
  writeFileSync(join(root, '.brevity', 'arm'), '\n');
  assert.deepEqual(hook({ source: 'startup', cwd: root }), brevityParts(root), 'an empty file is the default');
});

test('an unknown value loads brevity and says so in one marker line', () => {
  const root = project({ arm: 'tersest --> <b>' });
  const parts = hook({ source: 'startup', cwd: root });
  const [first, second, ...rest] = parts[0].split('\n');
  assert.equal(first, '<!-- brevity arm: brevity -->');
  // Only letters, digits, "_", "." and "-" are shown, so the value cannot close the comment.
  assert.equal(second, '<!-- brevity: unknown arm "tersest?--???b?" in .brevity/arm; loaded the default arm, brevity '
    + '(arms: brevity, lite, terse, off) -->');
  assert.equal(rest.join('\n'), brevityParts(root)[0].split('\n').slice(1).join('\n'));
  assert.deepEqual(parts.slice(1), brevityParts(root).slice(1));
  const env_ = hook({ source: 'startup', cwd: root }, { extra: { BREVITY_ARM: 'fast' } })[0].split('\n')[1];
  assert.match(env_, /^<!-- brevity: unknown arm "fast" in BREVITY_ARM; loaded the default arm, brevity /);
});

test('BREVITY_ARM wins over .brevity/arm', () => {
  const root = project({ arm: 'lite' });
  assert.deepEqual(hook({ source: 'startup', cwd: root }, { extra: { BREVITY_ARM: 'off' } }), ['<!-- brevity arm: off -->\n', '', '', '']);
  assert.deepEqual(hook({ source: 'startup', cwd: root }, { extra: { BREVITY_ARM: 'BREVITY' } }), brevityParts(root));
  // Set but empty, it is not set.
  assert.equal(hook({ source: 'startup', cwd: root }, { extra: { BREVITY_ARM: ' ' } })[0], `<!-- brevity arm: lite -->\n${LITE}\n`);
});

// The temp folder may sit under a folder that opts in (a `.brevity/` in the home folder opts in everything below it).
const optedInAbove = (() => {
  for (let d = tmp; ; d = dirname(d)) {
    if (existsSync(join(d, '.brevity'))) return d;
    if (dirname(d) === d) return null;
  }
})();

test('a project that did not opt in gets nothing, whatever the arm', { skip: optedInAbove ? `${optedInAbove} has a .brevity/ folder` : false }, () => {
  const root = project({ brevity: false });
  for (const arm of [undefined, 'brevity', 'lite', 'terse', 'off']) {
    const extra = arm ? { BREVITY_ARM: arm } : {};
    for (const source of ['startup', 'resume', 'clear', 'compact']) assert.deepEqual(hook({ source, cwd: root }, { extra }), ['', '', '', ''], `${arm} ${source}`);
  }
  // BREVITY_ALWAYS=1 opts in without the folder, and the arm still applies.
  assert.deepEqual(hook({ source: 'startup', cwd: root }, { extra: { BREVITY_ALWAYS: '1', BREVITY_ARM: 'off' } }), ['<!-- brevity arm: off -->\n', '', '', '']);
});

// A synthetic transcript in Claude Code's format: one JSON object per line, each with uuid and parentUuid.
function transcript(build) {
  const lines = [];
  let parent = null;
  let k = 0;
  const t = {
    line(o, { root = false } = {}) {
      const uuid = `u-${String(++k).padStart(4, '0')}`;
      lines.push({ parentUuid: root ? null : parent, isSidechain: false, sessionId: 's-1', timestamp: '2026-01-05T10:00:00.000Z', ...o, uuid });
      parent = uuid;
      return uuid;
    },
    // One SessionStart: its hook_success lines, then one attachment that holds what each part printed.
    start(name, parts, ts = '2026-01-05T10:00:00.000Z') {
      t.line({ type: 'attachment', timestamp: ts, attachment: { type: 'hook_success', hookName: `SessionStart:${name}`, hookEvent: 'SessionStart', content: '' } });
      const content = parts.filter(Boolean);
      if (content.length) t.line({ type: 'attachment', timestamp: ts, attachment: { type: 'hook_additional_context', content, hookName: 'SessionStart', hookEvent: 'SessionStart' } });
    },
    user(text) { t.line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }); },
    assistant(text) { t.line({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }] } }); },
    compact() { t.line({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }, { root: true }); },
    orphan(text) { parent = 'u-never-written'; t.user(text); },
    sidechain(text) { lines.push({ parentUuid: null, isSidechain: true, uuid: `side-${++k}`, type: 'user', message: { role: 'user', content: text } }); },
  };
  build(t);
  const file = join(tmp, `transcript-${++n}.jsonl`);
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return file;
}

const resume = (root, file, extra) => hook({ hook_event_name: 'SessionStart', source: 'resume', cwd: root, transcript_path: file, session_id: 's-1' }, { extra });
const startup = (root, extra) => hook({ source: 'startup', cwd: root }, { extra });

test('a resume whose conversation still holds a copy of the arm injects nothing, in every part', () => {
  const root = project();
  const file = transcript((t) => {
    t.start('startup', startup(root));
    t.user('Synthetic request: rebase fix/cart onto main.');
    t.assistant('Synthetic answer: rebased.');
  });
  assert.deepEqual(resume(root, file), ['', '', '', '']);
  // The same for each arm, and for a resume that follows an earlier resume's copy.
  for (const arm of ['lite', 'terse', 'off']) {
    const again = transcript((t) => {
      t.start('startup', startup(root, { BREVITY_ARM: arm }));
      t.user('Synthetic request.');
      t.assistant('Synthetic answer.');
      t.start('resume', []);
      t.assistant('Synthetic answer after the resume.');
    });
    assert.deepEqual(resume(root, again, { BREVITY_ARM: arm }), ['', '', '', ''], arm);
  }
  // A startup, clear or compact injects whatever the transcript holds.
  assert.deepEqual(hook({ source: 'startup', cwd: root, transcript_path: file }), brevityParts(root));
  assert.deepEqual(hook({ source: 'clear', cwd: root, transcript_path: file }), brevityParts(root));
});

test('a copy from before arms counts as a brevity copy', () => {
  const root = project();
  const file = transcript((t) => {
    t.start('startup', [`<!-- brevity SPEC.md -->\n${SPEC}`, `<!-- brevity dictionary /work/acme/.brevity/DICT.md -->\n${DICT}`]);
    t.user('Synthetic request.');
  });
  assert.deepEqual(resume(root, file), ['', '', '', '']);
  assert.deepEqual(resume(root, file, { BREVITY_ARM: 'lite' }), [`<!-- brevity arm: lite -->\n${LITE}\n`, '', '', '']);
});

test('a resume after a compaction, or past a break in the chain, injects the copy', () => {
  const root = project();
  // The copy lies before the compaction; the compaction's own SessionStart printed nothing.
  const compacted = transcript((t) => {
    t.start('startup', startup(root));
    t.user('Synthetic request.');
    t.assistant('Synthetic answer.');
    t.compact();
    t.start('compact', []);
    t.user('Synthetic summary of the conversation.');
    t.assistant('Synthetic answer after the compaction.');
  });
  assert.deepEqual(resume(root, compacted), brevityParts(root));
  // With the compaction's copy in place, nothing.
  const recopied = transcript((t) => {
    t.start('startup', startup(root));
    t.user('Synthetic request.');
    t.compact();
    t.start('compact', hook({ source: 'compact', cwd: root }));
    t.assistant('Synthetic answer after the compaction.');
  });
  assert.deepEqual(resume(root, recopied), ['', '', '', '']);
  // The last line's parent was never written: Claude Code rebuilds the conversation from there, without the copy.
  const broken = transcript((t) => {
    t.start('startup', startup(root));
    t.user('Synthetic request.');
    t.orphan('Synthetic message after a break.');
    t.assistant('Synthetic answer.');
  });
  assert.deepEqual(resume(root, broken), brevityParts(root));
  // A copy on another branch, which the last line does not descend from, does not count either.
  const branched = transcript((t) => {
    t.user('Synthetic first request.');
    const fork = t.line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Synthetic answer.' }] } });
    t.start('startup', startup(root));
    t.line({ type: 'user', parentUuid: fork, message: { role: 'user', content: [{ type: 'text', text: 'Synthetic edit.' }] } });
  });
  assert.deepEqual(resume(root, branched), brevityParts(root));
});

test('a resume where the arm changed injects the new arm, next to the old copy', () => {
  const root = project({ arm: 'lite' });
  const file = transcript((t) => {
    t.start('startup', startup(root));
    t.user('Synthetic request.');
    t.assistant('Synthetic answer.');
  });
  assert.deepEqual(resume(root, file), ['', '', '', '']);
  writeFileSync(join(root, '.brevity', 'arm'), 'terse');
  assert.deepEqual(resume(root, file), [`<!-- brevity arm: terse -->\n${TERSE}\n`, '', '', '']);
  writeFileSync(join(root, '.brevity', 'arm'), 'brevity');
  assert.deepEqual(resume(root, file), brevityParts(root));
  writeFileSync(join(root, '.brevity', 'arm'), 'off');
  assert.deepEqual(resume(root, file), ['<!-- brevity arm: off -->\n', '', '', '']);
});

test('a missing, empty or unreadable transcript injects the copy', () => {
  const root = project();
  assert.deepEqual(resume(root, join(tmp, 'no-such-transcript.jsonl')), brevityParts(root));
  assert.deepEqual(resume(root, undefined), brevityParts(root));
  const empty = join(tmp, 'empty.jsonl');
  writeFileSync(empty, '');
  assert.deepEqual(resume(root, empty), brevityParts(root));
  assert.deepEqual(resume(root, tmp), brevityParts(root), 'a folder, not a file');
  const garbage = join(tmp, 'garbage.jsonl');
  writeFileSync(garbage, 'not json\n{"uuid": 1}\n');
  assert.deepEqual(resume(root, garbage), brevityParts(root));
});

test('lines of this SessionStart, sidechains and cut lines do not count', () => {
  const root = project();
  // A part that finished first may already be logged when another part reads the transcript: it is not a live copy.
  const fresh = transcript((t) => {
    t.user('Synthetic request.');
    t.assistant('Synthetic answer.');
    t.start('resume', startup(root), new Date().toISOString());
  });
  assert.deepEqual(resume(root, fresh), brevityParts(root));
  // The copy is on the main chain; a subagent's sidechain line logged after it is not where the resume starts.
  const side = transcript((t) => {
    t.start('startup', startup(root));
    t.user('Synthetic request.');
    t.sidechain('Synthetic subagent prompt.');
  });
  assert.deepEqual(resume(root, side), ['', '', '', '']);
  const cut = transcript((t) => {
    t.start('startup', startup(root));
    t.user('Synthetic request.');
  });
  writeFileSync(cut, `${readFileSync(cut, 'utf8')}{"parentUuid":"u-0003","uuid":"u-0004","type":"assis`);
  assert.deepEqual(resume(root, cut), ['', '', '', '']);
});

test('a long transcript is read from its end, across lines longer than the read buffer', () => {
  const root = project();
  // 3 MB lines, in multibyte text, so lines and characters straddle the reader's 1 MB chunks.
  const big = 'é€'.repeat(600000);
  const file = transcript((t) => {
    t.user('Synthetic request.');
    t.start('startup', startup(root));
    for (let i = 0; i < 4; i++) {
      t.user(`Synthetic tool output ${i}: ${big}`);
      t.assistant('Synthetic answer.');
    }
  });
  assert.deepEqual(resume(root, file), ['', '', '', '']);
  const before = transcript((t) => {
    t.start('startup', startup(root));
    t.compact();
    for (let i = 0; i < 4; i++) t.user(`Synthetic tool output ${i}: ${big}`);
  });
  assert.deepEqual(resume(root, before), brevityParts(root));
});
