#!/usr/bin/env node
// SessionStart hook: puts the brevity spec, and the project's dictionaries if it has them,
// into the session context. Runs on startup, resume, clear and compact, so the spec
// survives context compaction.
//
// It does nothing unless the project opts in (see below).
// Dictionaries: the nearest `.brevity/DICT.md` (versioned, shared with the team) and the nearest
// `.brevity/DICT.local.md` (private, keep it out of git), looked up from the session's cwd
// towards the filesystem root, then from CLAUDE_PROJECT_DIR. A git worktree nested inside the
// main clone therefore finds the main clone's files. BREVITY_DICT may name extra files,
// separated by the platform's path delimiter.
//
// Claude Code caps each hook's additionalContext at 10,000 characters (longer output is saved
// to a file and only a preview reaches the model), so hooks.json registers this script several
// times: `inject.mjs <k>` prints part k of the context, each part under the cap.
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 9500;
const SLOTS = 4; // must match the number of entries in hooks.json
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
const files = [join(root, 'SPEC.md'), ...['.brevity/DICT.md', '.brevity/DICT.local.md'].map((rel) => nearest(rel, starts))];
for (const extra of (process.env.BREVITY_DICT || '').split(delimiter)) if (extra) files.push(resolve(extra));

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
  const label = file === join(root, 'SPEC.md') ? 'brevity SPEC.md' : `brevity dictionary ${file}`;
  pieces.forEach((p, i) => chunks.push(`<!-- ${label}${pieces.length > 1 ? ` (part ${i + 1} of ${pieces.length})` : ''} -->\n${p}`));
}
if (chunks.length > SLOTS && part === SLOTS - 1) {
  chunks[part] = `<!-- brevity: ${chunks.length - SLOTS + 1} more parts did not fit the ${SLOTS} hook slots; shorten the dictionaries -->\n${chunks[part]}`;
}

const text = chunks[part];
if (text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
  }));
}
