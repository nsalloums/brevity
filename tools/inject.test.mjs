#!/usr/bin/env node
// Tests for hooks/inject.mjs, the SessionStart hook:  node --test tools/inject.test.mjs
//
// Each test runs the four commands in hooks/hooks.json as Claude Code runs them: the command with ${CLAUDE_PLUGIN_ROOT}
// set to this checkout, the hook input as JSON on stdin, in a synthetic project folder under the system's temp folder.
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

test('.brevity/arm is read whatever wrote it: UTF-16 with a byte order mark, a UTF-8 mark, NULs', () => {
  const root = project();
  const file = join(root, '.brevity', 'arm');
  const lite = [`<!-- brevity arm: lite -->\n${LITE}\n`, '', '', ''];
  // What `"lite" > .brevity\arm` writes in Windows PowerShell 5.1: UTF-16 LE with a mark, and CRLF.
  writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('lite\r\n', 'utf16le')]));
  assert.deepEqual(hook({ source: 'startup', cwd: root }), lite);
  writeFileSync(file, Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('lite\r\n', 'utf16le').swap16()]));
  assert.deepEqual(hook({ source: 'startup', cwd: root }), lite, 'UTF-16 BE');
  writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('lite\n')]));
  assert.deepEqual(hook({ source: 'startup', cwd: root }), lite, 'UTF-8 with a mark');
  writeFileSync(file, Buffer.from('lite\n', 'utf16le'));
  assert.deepEqual(hook({ source: 'startup', cwd: root }), lite, 'UTF-16 LE without a mark');
});

test('every SessionStart injects the current copy: a resume prints exactly what a startup prints', () => {
  for (const arm of ['brevity', 'lite', 'terse', 'off']) {
    const root = project({ arm });
    const startup = hook({ hook_event_name: 'SessionStart', source: 'startup', cwd: root, session_id: 's-1' });
    for (const source of ['resume', 'clear', 'compact']) {
      // The transcript path is passed, as Claude Code passes it, and not read.
      const input = { hook_event_name: 'SessionStart', source, cwd: root, session_id: 's-1', transcript_path: join(root, 'missing.jsonl') };
      assert.deepEqual(hook(input), startup, `${arm} ${source}`);
    }
  }
});
