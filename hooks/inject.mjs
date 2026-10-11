#!/usr/bin/env node
// SessionStart hook: puts brevity's instructions for writing messages into the session context: by default the spec
// and the project's dictionaries. Runs on startup, resume, clear and compact, so they survive context compaction.
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
// Resume (issue #39): a resumed session can still hold the copy injected earlier. On `resume` only, the hook reads
// the session's own transcript (transcript_path, read-only) from its end and follows each line's parentUuid back from
// the last line, as Claude Code rebuilds the conversation, up to the last compaction or /clear. If that chain holds a
// copy of the same arm, every part prints nothing. A copy of another arm does not count. A missing or unreadable
// transcript, or a chain that breaks first, means the copy is injected: losing it is worse than a duplicate.
//
// Claude Code caps each hook's additionalContext at 10,000 characters (longer output is saved
// to a file and only a preview reaches the model), so hooks.json registers this script several
// times: `inject.mjs <k>` prints part k of the context, each part under the cap.
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 9500;
const SLOTS = 4; // must match the number of entries in hooks.json
const ARMS = ['brevity', 'lite', 'terse', 'off'];
// SessionStart lines logged this recently belong to this SessionStart, should Claude Code log a part that finished
// first before another part reads the transcript. (It runs the parts at once and logs them together, after the
// last.) A resume this soon after the previous SessionStart gets a second copy.
const FRESH_MS = 5000;
const started = Date.now();
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

// The arm, and a note when the value set is not one of ARMS.
function chooseArm() {
  let value = (process.env.BREVITY_ARM ?? '').trim();
  let from = 'BREVITY_ARM';
  if (!value) {
    const file = nearest('.brevity/arm', starts);
    if (!file) return { arm: 'brevity' };
    from = '.brevity/arm'; // not the full path, which could push part 0 past the cap
    try { value = readFileSync(file, 'utf8').trim(); } catch {
      return { arm: 'brevity', note: '<!-- brevity: could not read .brevity/arm; loaded the default arm, brevity -->' };
    }
    if (!value) return { arm: 'brevity' };
  }
  if (ARMS.includes(value.toLowerCase())) return { arm: value.toLowerCase() };
  const shown = value.slice(0, 40).replace(/[^\w.-]/g, '?');
  return { arm: 'brevity', note: `<!-- brevity: unknown arm "${shown}" in ${from}; loaded the default arm, brevity (arms: ${ARMS.join(', ')}) -->` };
}

// The lines of the first `size` bytes of a file, last line first. Lines appended while the hook runs are not read.
function* backwards(fd, size) {
  let pieces = []; // the rest of a line that starts in an earlier chunk, in file order
  for (let pos = size; pos > 0;) {
    const n = Math.min(1 << 20, pos);
    pos -= n;
    const buf = Buffer.allocUnsafe(n);
    for (let got = 0; got < n;) {
      const r = readSync(fd, buf, got, n - got, pos + got);
      if (!r) throw new Error('the transcript shrank');
      got += r;
    }
    let end = n;
    for (let nl = buf.lastIndexOf(10, end - 1); nl >= 0; nl = end > 0 ? buf.lastIndexOf(10, end - 1) : -1) {
      const line = pieces.length ? Buffer.concat([buf.subarray(nl + 1, end), ...pieces]) : buf.subarray(nl + 1, end);
      pieces = [];
      end = nl;
      if (line.length) yield line.toString('utf8');
    }
    if (end > 0) pieces.unshift(buf.subarray(0, end));
  }
  if (pieces.length) yield Buffer.concat(pieces).toString('utf8');
}

// What a transcript line says about a live copy: true for a copy of this arm, false for the start of the context
// (a compaction or /clear), undefined for anything else.
function verdict(o, copy) {
  if (o.type === 'system' && o.subtype === 'compact_boundary') return false;
  if (o.type !== 'attachment') return undefined;
  const a = o.attachment ?? {};
  const hook = typeof a.hookName === 'string' ? a.hookName : '';
  if ((a.hookEvent === 'SessionStart' || hook.startsWith('SessionStart')) && Date.parse(o.timestamp) > started - FRESH_MS) return undefined;
  if (a.type === 'hook_additional_context' && (Array.isArray(a.content) ? a.content : [a.content]).some((x) => typeof x === 'string' && copy.test(x))) return true;
  if (hook === 'SessionStart:compact' || hook === 'SessionStart:clear') return false;
  return undefined;
}

// Whether the conversation that this resume rebuilds holds a copy of `arm`. Copies written before arms existed carry
// only `<!-- brevity SPEC.md -->`, and are brevity copies.
function holdsCopy(path, arm) {
  if (typeof path !== 'string' || !path) return false;
  const copy = new RegExp(`(?:^|\\n)<!-- brevity (?:arm: ${arm} -->${arm === 'brevity' ? '|SPEC\\.md' : ''})`);
  let fd;
  try {
    fd = openSync(path, 'r');
    const lines = new Map(); // uuid -> { parent, verdict }, for lines read before the chain reaches them
    let want; // the uuid the chain needs next: undefined until the last line is read, null at the chain's root
    for (const text of backwards(fd, fstatSync(fd).size)) {
      let o;
      try { o = JSON.parse(text); } catch { continue; } // a line cut short
      if (!o || typeof o.uuid !== 'string' || o.parentUuid === undefined || o.isSidechain === true) continue;
      if (want === undefined) want = o.uuid;
      lines.set(o.uuid, { parent: o.parentUuid, verdict: verdict(o, copy) });
      for (let at = lines.get(want); at; at = lines.get(want)) {
        if (at.verdict !== undefined) return at.verdict;
        lines.delete(want);
        want = at.parent;
      }
      if (!want) return false;
    }
    return false; // the chain stops at a parent that was never written: what lies before it is gone
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const { arm, note } = chooseArm();
if (input.source === 'resume' && holdsCopy(input.transcript_path, arm)) process.exit(0);

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
