#!/usr/bin/env node
// SessionStart hook: puts brevity's instructions for writing messages into the session context: by default the spec
// and the project's dictionaries. Runs on startup, resume, fork, clear and compact, so they survive compaction.
//
// It does nothing unless the project opts in (see below).
// Arms: what the hook loads comes from BREVITY_ARM if it is set, else from the nearest `.brevity/arm` file, which
// holds one word (trimmed, any case):
//   brevity  SPEC.md and the dictionaries: the default, also when nothing is set or the value is unknown
//   lite     arms/lite.md only
//   terse    arms/terse.md only
//   off      nothing but the marker
// Every injection starts with `<!-- brevity arm: <arm> -->`, so tools/meter.mjs can report per arm. An unknown value
// loads brevity and adds a line that says so.
// Dictionaries (brevity only): the nearest `.brevity/DICT.md` (versioned, shared with the team) and the nearest
// `.brevity/DICT.local.md` (private, keep it out of git), looked up from the session's cwd towards the filesystem
// root, then from CLAUDE_PROJECT_DIR. A git worktree nested inside the main clone therefore finds the main clone's
// files. BREVITY_DICT may name extra files, separated by the platform's path delimiter.
//
// Resume: every SessionStart injects the current arm's copy, resume included. On a resume, Claude Code itself keeps
// only the injected items whose text changed (observed on real resumes, not documented by Claude Code), so a second
// copy appears only when the copy's content changed, such as after a plugin update or a dictionary edit.
//
// Claude Code caps each hook's additionalContext at 10,000 characters (longer output is saved
// to a file and only a preview reaches the model), so hooks.json registers this script several
// times: `inject.mjs <k>` prints part k of the context, each part under the cap.
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 9500;
const SLOTS = 4; // must match the number of entries in hooks.json
const ARMS = ['brevity', 'lite', 'terse', 'off'];
const part = Number(process.argv[2] ?? 0);
const root = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* no stdin */ }

function nearest(rel, starts) {
  for (const start of starts) {
    for (let dir = resolve(start); ; dir = dirname(dir)) {
      const file = join(dir, rel);
      if (existsSync(file)) return file;
      if (dirname(dir) === dir) break;
    }
  }
  return null;
}

const starts = [input.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean);
// Opt-in per project: the spec costs ~2.7k tokens in every session that loads it, which only pays
// off where sessions exchange many messages. Inject only when the project has a `.brevity/` folder
// (it may be empty) or BREVITY_ALWAYS=1 is set.
if (!nearest('.brevity', starts) && process.env.BREVITY_ALWAYS !== '1') process.exit(0);

// The text of `.brevity/arm`, whatever wrote it: `"lite" > .brevity\arm` in Windows PowerShell 5.1 writes UTF-16 LE
// with a byte order mark. UTF-16 with a mark is decoded as such; otherwise a UTF-8 mark and NULs are dropped.
function armText(file) {
  const b = readFileSync(file);
  let text;
  if (b[0] === 0xff && b[1] === 0xfe) text = b.subarray(2, b.length - (b.length % 2)).toString('utf16le');
  else if (b[0] === 0xfe && b[1] === 0xff) text = Buffer.from(b.subarray(2, b.length - (b.length % 2))).swap16().toString('utf16le');
  else text = b.toString('utf8');
  // trim() also drops a UTF-8 mark, which decodes to U+FEFF.
  return text.replace(/\0/g, '').trim();
}

// The arm, and a note when the value set is not one of ARMS.
function chooseArm() {
  let value = (process.env.BREVITY_ARM ?? '').trim();
  let from = 'BREVITY_ARM';
  if (!value) {
    const file = nearest('.brevity/arm', starts);
    if (!file) return { arm: 'brevity' };
    from = '.brevity/arm'; // not the full path, which could push part 0 past the cap
    try { value = armText(file); } catch {
      return { arm: 'brevity', note: '<!-- brevity: could not read .brevity/arm; loaded the default arm, brevity -->' };
    }
    if (!value) return { arm: 'brevity' };
  }
  if (ARMS.includes(value.toLowerCase())) return { arm: value.toLowerCase() };
  const shown = value.slice(0, 40).replace(/[^\w.-]/g, '?');
  return { arm: 'brevity', note: `<!-- brevity: unknown arm "${shown}" in ${from}; loaded the default arm, brevity (arms: ${ARMS.join(', ')}) -->` };
}

const { arm, note } = chooseArm();

const files = [];
if (arm === 'brevity') {
  files.push(join(root, 'SPEC.md'), ...['.brevity/DICT.md', '.brevity/DICT.local.md'].map((rel) => nearest(rel, starts)));
  for (const extra of (process.env.BREVITY_DICT || '').split(delimiter)) if (extra) files.push(resolve(extra));
} else if (arm !== 'off') files.push(join(root, 'arms', `${arm}.md`));

// One chunk per file, split at line boundaries when a file is longer than LIMIT.
// Git stores these files with LF, but a Windows checkout with core.autocrlf=true has CRLF. Read LF only, so the
// line endings of a checkout never change what the hook counts or prints.
const chunks = [];
const seen = new Set();
for (const file of files) {
  if (!file || seen.has(file) || !existsSync(file)) continue;
  seen.add(file);
  const pieces = [''];
  for (const line of readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    if (pieces.at(-1).length + line.length + 1 > LIMIT - 200 && pieces.at(-1)) pieces.push('');
    pieces[pieces.length - 1] += `${line}\n`;
  }
  // The arm marker names the lite and terse files; the spec and each dictionary get their own.
  const label = arm !== 'brevity' ? '' : file === join(root, 'SPEC.md') ? 'brevity SPEC.md' : `brevity dictionary ${file}`;
  pieces.forEach((p, i) => chunks.push(label ? `<!-- ${label}${pieces.length > 1 ? ` (part ${i + 1} of ${pieces.length})` : ''} -->\n${p}` : p));
}
chunks[0] = `<!-- brevity arm: ${arm} -->\n${note ? `${note}\n` : ''}${chunks[0] ?? ''}`;
if (chunks.length > SLOTS && part === SLOTS - 1) {
  chunks[part] = `<!-- brevity: ${chunks.length - SLOTS + 1} more parts did not fit the ${SLOTS} hook slots; shorten the dictionaries -->\n${chunks[part]}`;
}

const text = chunks[part];
if (text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
  }));
}
