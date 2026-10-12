#!/usr/bin/env node
// brevity meter: what brevity cost and saved in a project's real Claude Code sessions, read from their transcripts.
//
//   node tools/meter.mjs [--project <dir>]... [--since <ISO time>] [--until <ISO time>] [--saving-ratio <r>]
//        [--input 1] [--output 5] [--write-5m 1.25] [--write-1h 2] [--read <r>] [--clarify-window 5]
//        [--titles] [--json] [--team-json <file>]
//
// Input: Claude Code's transcripts, one JSON object per line, under ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects).
// By default it reads the folder of the current directory, named by the directory's path with every character that
// is not a letter or a digit replaced by "-", plus the folders of that directory's Claude Code worktrees
// (<folder>--claude-worktrees-*). Run from inside a worktree (<repo>/.claude/worktrees/<name>), it starts from <repo>.
// --project names folders instead, and can be repeated. In a folder, each <session id>.jsonl is a session, and
// <session id>/subagents/**/*.jsonl are its subagents: they are reported apart, never in the team totals. Workflow
// journal.jsonl files carry no usage and are skipped. Files are read line by line, so their size does not matter.
// The tool only reads: it uses no network and writes nothing but the --team-json file. It prints numbers, times and
// 8-character session ids, in the text output and in --json; full session ids, session titles (which can be private)
// and each message's time only with --titles.
//
// Everything is in input-token equivalents: input 1, output 5, cache write 1.25 (5-minute) or 2 (1-hour), cache read
// 0.05 on claude-opus-5-5, 0.025 on claude-fable-5-1 and claude-mythos-5-1, and 0.1 on any other model (Anthropic's
// prices; the flags override each one, --read for every model). What it counts:
//
// - Calls. Assistant lines that share message.id (else requestId) are one API call, billed once with the usage of
//   its last line. Lines with model "<synthetic>" are local errors, not calls. A call that also appears in another
//   transcript (a session continued under a new id copies part of the old one) counts only in the transcript that
//   started first. --since and --until limit the calls counted; the whole file is still read, to follow its state.
// - Sessions. Transcripts whose entrypoint starts with "sdk" (claude -p) are tests, reported apart from the team.
// - Copies. A SessionStart hook injection that holds "<!-- brevity arm: <arm> -->" is one copy of that arm: for
//   brevity the spec and the dictionaries injected with it, for lite and terse their instructions, for off the marker
//   alone. One that holds "<!-- brevity SPEC.md -->" and no arm marker, from before arms, is a brevity copy. A copy
//   costs the tokens of its rendered text. The plugin's "brevity:brevity" line in a skill listing is counted the same
//   way, as the skill entry; spec cost, or load cost per arm, is the copies plus the skill entry.
// - Arms. A session is under the arm of the last copy that its counted calls carried, else of its last copy, or none.
//   The per-arm summary adds up the sessions under each arm.
// - Cost of a copy, call by call. While a copy is in a session's context, each call bills it at the cache read price
//   if the call's cache read reaches past the copy's end in the prompt, and at the call's write rate otherwise: its
//   first call, a call after an idle cache miss, or a rebuilt prefix. The write rate is the call's own mix of 5-minute
//   and 1-hour writes (input, if it wrote nothing). Two spec copies in context at once are both billed, and listed
//   (issue #39).
// - Positions, an approximation. A copy's (or a message's) end in the prompt is estimated once, at the first call
//   after it: that call's prompt (input + cache writes + cache reads) minus the tokens of what was logged between the
//   copy and the call (rendered attachments, user messages, the assistant's text and tool calls; thinking and images
//   are left out). The logged text is counted with the tokenizer below, not the model's, so the estimate can be off by
//   some thousands of tokens. It only has to tell a cache read that covers the copy from one that stops at the
//   system prompt, and those differ by far more.
// - Lifetimes. A copy or a message stays in context until a compaction or /clear, a resume that drops it, or the end
//   of the session. A resume rebuilds the conversation from the transcript, following each line's parentUuid back from
//   the resumed line; the chain can stop at a parent that was never written, and what lies before that break is gone.
//   Where lines carry no parentUuid, and when a prompt shrinks by more than 10% with no compaction or resume, a copy
//   is gone if its end lies past the rebuilt prompt: the first call's prompt minus what was logged since the resume.
// - Messages. Sent: SendMessage calls and delegation prompts (mcp__ccd_session__spawn_task); one whose result says
//   success false, or is an error, failed. Received: messages from a peer (origin.kind "peer"), logged as user lines
//   or, when they arrive while the session is busy, as queued_command attachments, and counted once per msg_id; and a
//   delegation prompt that is a session's first message. That session is the one the prompt started. Sessions take
//   prompts in the order they started, each the newest prompt with its text that was sent before it and that no
//   earlier session took, an original rather than a copy in a continued transcript; a session that finds none started
//   from no prompt, and a transcript that continues or forks a session keeps that session's prompt. Peer messages
//   with handback true are subagent results, and
//   Agent tool prompts go to subagents: both are counted apart. A message is written under the arm of the newest copy
//   in the sender's context. Under lite and terse, every message is that arm's. Otherwise a message is brevity when a
//   line after its first starts with a SPEC.md section 3 verb (DO, NO, REPLY, ASK, ASKn, An, WILL, DONE, IF, HOLD, GO,
//   DEC, FIX, WARN, WHY, CHK, FILES, OWN, TELL, ORDER, NUM, HDR, MERGED, READY, ACK), and prose if not. A received
//   message takes the arm and style of the sent message with the same text, when a measured transcript sent it.
//   A SendMessage with no text, such as a notify_when_idle subscription, is not a message.
//   Tokens (issue #76): msg tokens (messageTokens) adds what a session sent and what it received, so a message between
//   two measured sessions counts at each end, and twice in a total. sent tokens (sentTokens) counts the delivered
//   messages and prompts a session sent, each once; meanSentTokens divides it by how many there were. sentByArm adds
//   them up by the arm each was written under, while the per-arm summary files a session under its own arm (issue #79).
// - Savings, an estimate. No prose original exists for a real message, so a message of t tokens is taken to replace
//   prose of t / (1 - r) tokens and to save s = t x r / (1 - r). r is the ratio of its style, from the single-pass
//   pilot in issue #26: brevity 0.154, lite 0.087, terse 0.102. Prose, and every message written under off, save
//   nothing. --saving-ratio replaces the brevity, lite and terse ratios. The sender saves s x output when it writes
//   the message; then the sender and the receiver each save s x the rate of every call that carries the message,
//   priced like a copy: the write rate where the call writes it to the cache (the receiver's first call, the sender's
//   next call, idle misses), the read price elsewhere. Unlike tools/cost-model.mjs, this includes the sender's own
//   cache write.
// - Quality signals, heuristics (issue #52). No prose original or audit exists for real traffic, so three signals
//   flag delivered SendMessage messages that may not have been understood. A received message is matched to its
//   send by msg_id, else by text: the only send with that text, else the only one whose sender has the name the
//   message gives ("from" or "name"; a session's names are its title and what other sessions call it in linked
//   messages). When that stays ambiguous, the message is not matched and flags nothing. A reply's addressee is matched
//   by the transcript that received it, or by name (SendMessage's "to" against the sender's "from" or "name", without
//   a trailing "[hex]" tag, and a name cut short with "…" matches what it starts). In a transcript that continues a
//   session under a new id or forks it, copied messages are not owned, so their signals go to the original. A
//   message is:
//   - clarified, when the recipient's next message to its sender, sent within the recipient's next --clarify-window
//     calls (5) after the message arrives, asks about it. The reply says "please clarify", "unclear to me" or "not
//     clear to me", or it has a question (a sentence that ends with "?", or an ASK line) that either holds a
//     clarification word (unclear, did you mean, do you mean, what do you mean, which one, clarify, clarification), or
//     names something from the message (a #N, a SHA, a path or file name, a --flag, a vX.Y.Z tag, a quoted or `code`
//     span) or quotes a span of it.
//     A question that asks leave for the recipient's own step ("May I ...", "Can I ...", "Could I ...", "Shall I ...",
//     "OK to ...", or an ASK line "ASK I ...") names nothing. When several messages from the sender arrived since the recipient last wrote to it, the newest
//     one that the reply asks about is the one clarified;
//   - corrected, when its sender's next delivered message to the same recipient corrects or retracts something it
//     sent: "correction", "I was wrong", "disregard my last" or "ignore my previous", "retract", "-> WITHDRAWN", or a
//     FIX line that does not say "your" (one that does corrects the recipient). It can correct an earlier message
//     than this one, and it can be an update of an instruction rather than a mistake;
//   - resent, when it repeats an earlier delivered message to the same recipient, with no message from that recipient
//     in between: a similarity of 0.8 or more (Dice's coefficient over word pairs).
//   A failed send is never one of them. A clarification about a message from a transcript that was not measured is
//   not counted, since that message is not among the delivered ones either. These rules were tuned on brevity's own
//   transcripts, and their precision there (on 2026-10-10, 4 of 5 flagged corrections real, the fifth only using the
//   word; no clarification flagged) is in-sample, not a validation.
// - Delegation signals, heuristics (issue #58), counted apart from the SendMessage ones so that those rates stay
//   comparable. The same three flags apply to delivered delegation prompts, by the same rules for what asks about,
//   corrects or repeats a message. A prompt is:
//   - clarified, when one of the started session's first messages back to the sender asks about it: a message it
//     sends the sender before the sender writes to it again. No call window applies, since a new session reads before
//     it writes: on brevity's own transcripts (2026-10-11), its first message to the sender came 10 or more calls in;
//   - corrected, when the sender's next delivered message to that session corrects or retracts something it sent.
//     That message goes to the transcript that received it (by msg_id, else the only one that received its text), and
//     only when none did, to the session with its name: one of the session's names or the prompt's title. In a
//     transcript that continues or forks the sender, a copied prompt stands for its original;
//   - resent, when it repeats a delivered prompt that the same transcript spawned before it (a similarity of 0.8 or
//     more): the same delegation spawned again.
//   Only a prompt whose session was measured (started) can be clarified or corrected. The rates are per 100 delivered
//   prompts. Nobody has checked these flags by hand: on brevity's own transcripts (2026-10-11), 19 prompts, all
//   started, flagged 1 clarification and no correction or re-send.
//
// Token counts use @anthropic-ai/tokenizer, the legacy tokenizer behind eval/RESULTS.md's counts, when it is installed
// where this file can import it: run npm i -D @anthropic-ai/tokenizer in the brevity checkout that holds this tool,
// not in the project you measure. Otherwise they use chars/4. BREVITY_METER_TOKENIZER=chars/4 in the environment uses
// chars/4 even when the tokenizer is installed; the tests set it, so their numbers do not depend on what is installed.
// The output says which ran.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PRICES = { input: 1, output: 5, write5m: 1.25, write1h: 2 };
export const READ_PRICES = { 'claude-opus-5-5': 0.05, 'claude-fable-5-1': 0.025, 'claude-mythos-5-1': 0.025 };
export const DEFAULT_READ = 0.1;
// The share of a prose message's tokens that each arm's style saves, from the single-pass pilot in issue #26.
export const SAVING_RATIOS = { brevity: 0.154, lite: 0.087, terse: 0.102, off: 0 };
export const SAVING_RATIO = SAVING_RATIOS.brevity;
export const ARMS = Object.keys(SAVING_RATIOS);
const VERB_LINE = /^\s*(?:[-*]\s+|\d+\.\s+)?(?:@\S+\s+)?(?:DO|NO|REPLY|ASK\d*|A\d+|WILL|DONE|IF|HOLD|GO|DEC|FIX|WARN|WHY|CHK|FILES|OWN|TELL|ORDER|NUM|HDR|MERGED|READY|ACK)(?=[\s:;]|$)/;
const SPEC_MARK = '<!-- brevity SPEC.md';
const ARM_MARK = /<!-- brevity arm: (\w+) -->/;
const SKILL_ENTRY = /(?:^|\n)(- brevity:brevity\b[^\n]*(?:\n(?!- )[^\n]*)*)/;
const DELEGATION = /(?:^|__)spawn_task$/;
// The quality signals' defaults (see the header): how many of the recipient's calls a clarification may come within,
// and how alike a re-sent message is.
export const CLARIFY_WINDOW = 5;
export const RESEND_SIMILARITY = 0.8;
const CLARIFY = /\b(?:unclear|did you mean|do you mean|what do you mean|which one|clarify|clarification)\b/i;
const CLARIFY_ASK = /\b(?:please clarify|unclear to me|not clear to me)\b/i;
const LEAD = /^\s*(?:[-*]\s+|\d+\.\s+)?(?:@\S+\s+)?/;
const ASK_LINE = new RegExp(`${LEAD.source}ASK\\d*(?=[\\s:;]|$)`);
// A question that asks leave for the recipient's own next step ("May I add x?", "ASK I add x") asks nothing about
// the message. A prose question that starts with "I" is not one.
const LEAVE = new RegExp(`${LEAD.source}(?:ASK\\d*:?\\s+I\\s|(?:ASK\\d*:?\\s+)?(?:(?:may|can|could|shall)\\s+I\\b|ok(?:ay)?\\s+(?:to|if)\\b))`, 'i');
const FIX_LINE = new RegExp(`${LEAD.source}FIX(?=[\\s:;]|$)`);
const CORRECTION = [
  /\bcorrection\b/i, /\bI was wrong\b/i, /\b(?:disregard|ignore) my (?:last|previous)\b/i, /\bretract(?:s|ed|ing)?\b/i,
  /->\s*WITHDRAWN\b/,
];
// What a question can name from a message: #N, SHAs, paths and branches, file names, --flags, vX.Y.Z tags, quoted spans.
const QUOTED = /`([^`\n]+)`|"([^"\n]{3,})"|“([^”\n]{3,})”|«([^»\n]{3,})»/g;
const NAMED = [
  /#\d+/g, /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, /[\w.-]+(?:\/[\w.-]+)+/g, /\b[\w-]{2,}\.[A-Za-z]{1,5}\b/g,
  /--[a-z][\w-]*/g, /\bv\d+\.\d+\.\d+\b/g,
];

const CHARS4 = (t) => Math.ceil(t.length / 4);

// The tokenizer: @anthropic-ai/tokenizer when it can be imported, else chars/4, or chars/4 when the environment sets
// BREVITY_METER_TOKENIZER=chars/4 (see the header).
export async function tokenizer(env = process.env) {
  const forced = env.BREVITY_METER_TOKENIZER;
  if (forced !== undefined && forced !== '') {
    if (forced !== 'chars/4') throw new Error('BREVITY_METER_TOKENIZER must be chars/4, or unset');
    return { name: 'chars/4', forced: true, count: CHARS4 };
  }
  try {
    const mod = await import('@anthropic-ai/tokenizer');
    const lib = mod.getTokenizer || mod.countTokens ? mod : mod.default;
    // countTokens builds the encoder on every call, which is slow for thousands of short texts: build it once.
    if (lib.getTokenizer) {
      const enc = lib.getTokenizer();
      return { name: '@anthropic-ai/tokenizer', count: (t) => enc.encode(t.normalize('NFKC'), 'all').length };
    }
    return { name: '@anthropic-ai/tokenizer', count: lib.countTokens };
  } catch {
    return { name: 'chars/4', count: CHARS4 };
  }
}

// Whether a message is brevity: a line after its first starts with a section 3 verb.
export function isBrevity(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trimStart().split('\n').slice(1).some((l) => VERB_LINE.test(l));
}

// The questions in a message: its sentences that end with a word and "?" (not code such as `a ?? b`), and its ASK lines.
function questions(text) {
  const out = [];
  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (ASK_LINE.test(line)) out.push(line);
    else for (const s of line.split(/(?<=[.!?])\s+/)) if (/[\p{L}\p{N}`'"»”)\]]\?[)"'`»”]*\s*$/u.test(s)) out.push(s);
  }
  return out;
}

const quoted = (text) => [...String(text).matchAll(QUOTED)].map((m) => m.slice(1).find((x) => x !== undefined).trim()).filter((x) => x.length >= 3);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whether `text` holds `name` as a whole word: #5 is not in #52.
const holds = (text, name) => new RegExp(`(?<![\\w])${escape(name)}(?![\\w])`, 'i').test(text);

// Whether `reply` asks about `received` (see the header): a question with a clarification word, or one that names
// something from it or quotes it and does not ask leave for the recipient's own step.
export function isClarification(reply, received) {
  const r = String(reply ?? '');
  const m = String(received ?? '');
  if (CLARIFY_ASK.test(r)) return true;
  const qs = questions(r);
  if (qs.some((q) => CLARIFY.test(q))) return true;
  const named = NAMED.flatMap((re) => m.match(re) ?? []).map((x) => x.replace(/[.-]+$/, ''));
  const names = [...new Set([...quoted(m), ...named])].filter(Boolean);
  return qs.filter((q) => !LEAVE.test(q))
    .some((q) => names.some((x) => holds(q, x)) || quoted(q).some((x) => m.toLowerCase().includes(x.toLowerCase())));
}

// Whether a message corrects or retracts something its sender sent before: a correction phrase, or a FIX line that
// does not correct the recipient's words ("FIX your ...").
export function isCorrection(text) {
  const t = String(text ?? '');
  return CORRECTION.some((re) => re.test(t)) || t.split(/\r?\n/).some((l) => FIX_LINE.test(l) && !/\byours?\b/i.test(l));
}

// Dice's coefficient over the word pairs of two texts (over the words, for a one-word text): 1 for the same words.
export function similarity(a, b) {
  const pairs = (t) => {
    const w = String(t ?? '').toLowerCase().match(/[\p{L}\p{N}#_/-]+(?:\.[\p{L}\p{N}_/-]+)*/gu) ?? [];
    return new Set(w.length < 2 ? w : w.slice(1).map((x, i) => `${w[i]} ${x}`));
  };
  const A = pairs(a);
  const B = pairs(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return (2 * both) / (A.size + B.size);
}

// Whether two lists of session names (SendMessage's to and recipient, or a peer message's from and name) share one.
// A trailing "[hex]" tag is left out, and a name cut short with "…" matches the names it starts.
export function samePeer(xs, ys) {
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s*\[[0-9a-f]{4,}\]$/, '');
  const cut = (a, b) => /(?:…|\.\.\.)$/.test(a) && b.startsWith(a.replace(/(?:…|\.\.\.)$/, '').trimEnd());
  for (const x of (xs ?? []).map(norm).filter(Boolean)) {
    for (const y of (ys ?? []).map(norm).filter(Boolean)) if (x === y || cut(x, y) || cut(y, x)) return true;
  }
  return false;
}

export function readPrice(model, prices = {}) {
  if (prices.read !== undefined) return prices.read;
  const key = Object.keys(READ_PRICES).find((k) => String(model ?? '').startsWith(k));
  return key ? READ_PRICES[key] : DEFAULT_READ;
}

// The cache writes of a call, split by lifetime; without a split, all are 5-minute writes (the API default).
function writes(u) {
  const total = u.cache_creation_input_tokens ?? 0;
  const c = u.cache_creation;
  if (!c) return { w5: total, w1h: 0 };
  return { w5: c.ephemeral_5m_input_tokens ?? 0, w1h: c.ephemeral_1h_input_tokens ?? 0 };
}

// What a call writes to the cache costs per token: its own mix of 5-minute and 1-hour writes, or input if it wrote none.
export function writeRate(u, p = PRICES) {
  const { w5, w1h } = writes(u);
  return w5 + w1h > 0 ? (w5 * p.write5m + w1h * p.write1h) / (w5 + w1h) : p.input;
}

export function callBill(u, model, p = PRICES) {
  const { w5, w1h } = writes(u);
  return (u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output + w5 * p.write5m + w1h * p.write1h
    + (u.cache_read_input_tokens ?? 0) * readPrice(model, p);
}

const prompt = (u) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
const hash = (t) => createHash('sha256').update(String(t).trim()).digest('hex');
const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

function blockText(b) {
  if (!b || typeof b !== 'object') return '';
  if (b.type === 'text') return b.text ?? '';
  if (b.type === 'tool_use') return JSON.stringify(b.input ?? {});
  if (b.type === 'tool_result') {
    if (typeof b.content === 'string') return b.content;
    return Array.isArray(b.content) ? b.content.map((x) => (x?.type === 'text' ? x.text ?? '' : '')).join('') : '';
  }
  return ''; // thinking, images, documents
}

// The text a line puts into the prompt: an attachment's rendered text, or a message's content.
function lineText(o) {
  if (o.type === 'attachment') return (o.rendered ?? []).map((r) => (typeof r?.content === 'string' ? r.content : '')).join('');
  const c = o.message?.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map(blockText).join('') : '';
}

export function projectFolder(dir) {
  return resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
}

// The Claude Code project folders for `cwd`: its own and its worktrees'. The path is taken as given and as the file
// system spells it (a shell can keep `c:\users\...` in lower case), and on Windows names match in any case.
export function defaultProjects(cwd, root, platform = process.platform) {
  const fold = (name) => (platform === 'win32' ? name.toLowerCase() : name);
  const real = (dir) => { try { return realpathSync.native(dir); } catch { return resolve(dir); } };
  const bases = new Set([resolve(cwd), real(cwd)].map((dir) => {
    const m = dir.match(/^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+/);
    return fold(projectFolder(m ? m[1] : dir));
  }));
  const ours = (name) => [...bases].some((b) => fold(name) === b || fold(name).startsWith(`${b}--claude-worktrees-`));
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && ours(e.name)).map((e) => join(root, e.name));
}

export function transcripts(dirs) {
  const out = [];
  const walk = (dir, parent) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, parent);
      else if (e.name.endsWith('.jsonl') && e.name !== 'journal.jsonl') out.push({ file: p, kind: 'subagent', parent });
    }
  };
  for (const dir of dirs) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl') && e.name !== 'journal.jsonl') out.push({ file: join(dir, e.name), kind: 'session' });
      else if (e.isDirectory() && existsSync(join(dir, e.name, 'subagents'))) walk(join(dir, e.name, 'subagents'), e.name);
    }
  }
  return out;
}

async function* lines(file) {
  const input = createReadStream(file);
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; } // a line cut short by a crash
      yield o;
    }
  } finally {
    rl.close();
    input.destroy();
  }
}

async function firstTimestamp(file) {
  for await (const o of lines(file)) if (o.timestamp) return o.timestamp;
  return '9999';
}

// One transcript, followed line by line: its calls, what is in its context, and what each call bills for it.
class Transcript {
  constructor(id, file, kind, ctx) {
    Object.assign(this, { id, file, kind, ctx });
    this.entrypoint = null;
    this.titles = {};
    this.parents = new Map();
    this.calls = new Map();
    this.counted = 0;
    this.loadStart = null;
    this.items = [];
    this.live = [];
    this.pending = [];
    this.marker = null;
    this.lastPrompt = null;
    this.sinceCall = 0;
    this.droppedSinceCall = false;
    this.tools = new Map();
    this.peerIds = new Set();
    this.firstHuman = null;
    this.dups = [];
    this.dupRun = null;
    this.drops = { compaction: 0, compact: 0, clear: 0, resume: 0 };
  }

  // The arm of the newest copy still in context: what a message written now is written under.
  arm() {
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].kind === 'spec' && !this.items[i].dropped) return this.items[i].arm;
    return null;
  }

  feed(o) {
    if (o.uuid && o.parentUuid !== undefined) this.parents.set(o.uuid, o.parentUuid);
    if (o.entrypoint && !this.entrypoint) this.entrypoint = o.entrypoint;
    if (o.type === 'custom-title' && o.customTitle) this.titles.custom = o.customTitle;
    else if (o.type === 'ai-title' && (o.aiTitle ?? o.title)) this.titles.ai = o.aiTitle ?? o.title;
    else if (o.type === 'assistant') this.assistant(o);
    else if (o.type === 'attachment') this.attachment(o);
    else if (o.type === 'user') this.user(o);
    else if (o.type === 'system' && o.subtype === 'compact_boundary') this.dropAll('compaction');
  }

  // Text logged after pending items moves their end further from the next call's prompt end.
  grow(text) {
    if (!text) return;
    this.sinceCall += text.length;
    if (!this.pending.length && !this.marker) return;
    const t = this.ctx.count(text);
    for (const p of this.pending) p.after += t;
    if (this.marker) this.marker.after += t;
  }

  // The lines a conversation rebuilt from `uuid` holds: `uuid` and its parentUuid chain, or null without one.
  ancestors(uuid) {
    if (!uuid || !this.parents.has(uuid)) return null;
    const seen = new Set();
    for (let cur = uuid; cur && !seen.has(cur); cur = this.parents.get(cur)) seen.add(cur);
    return seen;
  }

  claim(set, key) {
    if (key === undefined || key === null) return true;
    if (set.has(key)) return false;
    set.add(key);
    return true;
  }

  within(ts) {
    if (!ts) return true;
    const t = Date.parse(ts);
    return !(this.ctx.since !== undefined && t < this.ctx.since) && !(this.ctx.until !== undefined && t > this.ctx.until);
  }

  add(item, o) {
    Object.assign(item, {
      uuid: o.uuid, ts: o.timestamp, rate: 0, rateLoaded: 0, outputRateLoaded: 0, billed: 0, rewrites: 0, rewriteRate: 0, dropped: null,
    });
    this.items.push(item);
    this.pending.push({ item, after: 0, beforeMarker: false });
    return item;
  }

  drop(item, reason) {
    item.dropped = reason;
    if (item.kind === 'spec' && reason in this.drops) this.drops[reason]++;
  }

  dropAll(reason) {
    for (const it of this.live) this.drop(it, reason);
    for (const p of this.pending) this.drop(p.item, reason);
    this.live = [];
    this.pending = [];
    this.marker = null;
    this.droppedSinceCall = true;
    this.dupRun = null;
  }

  assistant(o) {
    const m = o.message ?? {};
    if (m.model === '<synthetic>') return;
    const id = m.id ?? o.requestId ?? o.uuid;
    const call = this.calls.get(id);
    if (call) call.usage = m.usage ?? call.usage; // the last line's usage counts
    else this.open(id, o);
    for (const b of Array.isArray(m.content) ? m.content : []) {
      this.grow(blockText(b));
      if (b?.type === 'tool_use') this.toolUse(b, o, this.calls.get(id));
    }
  }

  open(id, o) {
    const u = o.message.usage ?? {};
    const P = prompt(u);
    const read = u.cache_read_input_tokens ?? 0;
    const owned = this.claim(this.ctx.calls, id);
    // `ord` numbers every call in the transcript, counted or not: the quality signals' window counts in it.
    const call = { id, model: o.message.model, usage: u, ts: o.timestamp, counted: owned && this.within(o.timestamp), index: null, ord: this.calls.size };
    this.calls.set(id, call);

    // A resume, or a prompt that shrank without a compaction, rebuilt the conversation.
    const resumed = !!this.marker;
    if (resumed || (this.lastPrompt && P < 0.9 * this.lastPrompt && !this.droppedSinceCall)) {
      const chain = resumed ? this.ancestors(o.uuid) : null;
      let gone;
      if (chain) {
        // A resume rebuilds it from the transcript by following parentUuid back from the resumed line, and that chain
        // can stop at a parent that was never written: what lies before the break is gone, however long the prompt.
        gone = (it) => it.uuid && !chain.has(it.uuid);
      } else {
        // Otherwise: what lay past the end of the rebuilt prompt, the call's prompt minus what was logged since.
        const rebuilt = this.marker ? P - this.marker.after : P - Math.ceil(this.sinceCall / 4);
        const shorter = this.lastPrompt !== null && rebuilt < this.lastPrompt;
        gone = (it, p) => (p ? p.beforeMarker && shorter : it.end > rebuilt);
      }
      this.live = this.live.filter((it) => (gone(it) ? (this.drop(it, 'resume'), false) : true));
      this.pending = this.pending.filter((p) => (gone(p.item, p) ? (this.drop(p.item, 'resume'), false) : true));
    }
    for (const p of this.pending) {
      p.item.end = P - p.after;
      if (p.item.callIndex === undefined) p.item.callIndex = call.counted ? this.counted : null;
      this.live.push(p.item);
    }
    this.pending = [];
    this.marker = null;
    this.sinceCall = 0;
    this.droppedSinceCall = false;
    this.lastPrompt = P;
    if (!call.counted) return;

    call.index = this.counted++;
    // From the session's first call with a spec copy on, brevity is loaded; what those calls bill is also kept apart.
    if (this.loadStart === null && this.live.some((it) => it.kind === 'spec')) this.loadStart = call.index;
    call.loaded = this.loadStart !== null;
    const r = readPrice(call.model, this.ctx.prices);
    const w = writeRate(u, this.ctx.prices);
    const spec = [];
    for (const it of this.live) {
      const writing = read < it.end;
      const rate = writing ? w : r;
      if (writing && it.billed) { it.rewrites++; it.rewriteRate += rate; }
      it.billed++;
      it.rate += rate;
      if (call.loaded) it.rateLoaded += rate;
      if (it.kind === 'spec') spec.push({ it, rate });
    }
    // Every copy after the oldest is a duplicate.
    if (spec.length > 1) {
      if (!this.dupRun) this.dups.push(this.dupRun = { from: call.ts, to: call.ts, calls: 0, copies: 0, extraTokens: 0, extra: 0 });
      const extra = spec.slice(1);
      this.dupRun.to = call.ts;
      this.dupRun.calls++;
      this.dupRun.copies = Math.max(this.dupRun.copies, spec.length);
      this.dupRun.extraTokens = Math.max(this.dupRun.extraTokens, extra.reduce((a, x) => a + x.it.tokens, 0));
      this.dupRun.extra += extra.reduce((a, x) => a + x.it.tokens * x.rate, 0);
    } else this.dupRun = null;
  }

  message(dir, text, key, o, counted) {
    const t = str(text);
    const owned = this.claim(this.ctx.lines, key);
    // What this session writes is written under its arm; what it receives, under the sender's (see settle). The text,
    // the names of the other session and the msg_id serve the quality signals, and are removed with the hash.
    return this.add({
      kind: 'msg', dir, owned, counted: owned && counted, tokens: this.ctx.count(t), brevity: isBrevity(t), hash: hash(t),
      arm: WRITTEN.includes(dir) ? this.arm() : null, outputRate: 0, failed: false, text: t, peer: [], msgId: null, ord: null,
    }, o);
  }

  // A message from a peer session, logged once per msg_id: as a user line, or as a queued_command attachment when it
  // arrived while the session was busy.
  peer(origin, text, o) {
    const id = origin.msg_id;
    if (id !== undefined) {
      if (this.peerIds.has(id)) return;
      this.peerIds.add(id);
    }
    const item = this.message(origin.handback ? 'handback' : 'received', origin.body ?? text, id ?? o.uuid, o, this.within(o.timestamp));
    // It reaches the session's next call.
    Object.assign(item, { peer: [origin.from, origin.name], msgId: id ?? null, ord: this.calls.size });
  }

  toolUse(b, o, call) {
    const name = b.name ?? '';
    // A SendMessage with no text, such as a notify_when_idle subscription, sends no message.
    if (name === 'SendMessage' && !str(b.input?.message ?? b.input?.content).trim()) return;
    let item;
    if (name === 'SendMessage') item = this.message('sent', b.input?.message ?? b.input?.content, b.id, o, call.counted);
    else if (DELEGATION.test(name)) item = this.message('delegation-sent', b.input?.prompt, b.id, o, call.counted);
    else if (name === 'Agent' || name === 'Task') item = this.message('subagent-prompt', b.input?.prompt, b.id, o, call.counted);
    else return;
    // The sender writes it as output in this call, and carries it from the next one.
    item.callIndex = call.index;
    item.ord = call.ord;
    if (name === 'SendMessage') item.peer = [b.input?.to, b.input?.recipient];
    else if (item.dir === 'delegation-sent') {
      item.peer = [b.input?.title]; // the title names the session it starts
      item.key = b.id; // a copy in a transcript that continues or forks this one has the same id
    }
    if (item.counted) item.outputRate = this.ctx.prices.output;
    if (item.counted && call.loaded) item.outputRateLoaded = this.ctx.prices.output;
    this.tools.set(b.id, item);
  }

  attachment(o) {
    const a = o.attachment ?? {};
    const hook = typeof a.hookName === 'string' ? a.hookName : '';
    if (hook === 'SessionStart:resume' && !this.marker) {
      this.marker = { after: 0 };
      for (const p of this.pending) p.beforeMarker = true;
    }
    if ((hook === 'SessionStart:compact' || hook === 'SessionStart:clear') && !this.droppedSinceCall) this.dropAll(hook.slice(13));
    const text = lineText(o);
    this.grow(text);
    if (a.type === 'hook_additional_context') this.injection(o, a, text);
    else if (a.type === 'queued_command' && a.origin?.kind === 'peer') this.peer(a.origin, typeof a.prompt === 'string' ? a.prompt : text, o);
    else if (a.type === 'skill_listing' && typeof a.content === 'string') {
      const entry = a.content.match(SKILL_ENTRY)?.[1];
      if (entry) this.add({ kind: 'skill', tokens: this.ctx.count(entry), owned: this.claim(this.ctx.lines, o.uuid) }, o);
    }
  }

  injection(o, a, rendered) {
    const parts = (Array.isArray(a.content) ? a.content : [a.content]).filter((x) => typeof x === 'string');
    const ours = parts.filter((x) => x.includes('<!-- brevity'));
    if (!ours.length) return;
    const { count } = this.ctx;
    const others = parts.filter((x) => !x.includes('<!-- brevity')).reduce((s, x) => s + count(x), 0);
    const tokens = rendered ? Math.max(0, count(rendered) - others) : ours.reduce((s, x) => s + count(x), 0);
    // `spec` counts the arm's own text (with its marker), `dict` the dictionaries injected with it.
    const own = (x) => ARM_MARK.test(x) || x.includes(SPEC_MARK);
    const spec = ours.filter(own).reduce((s, x) => s + count(x), 0);
    const dict = ours.filter((x) => !own(x)).reduce((s, x) => s + count(x), 0);
    const arm = ours.map((x) => x.match(ARM_MARK)?.[1]).find(Boolean);
    // Parts of one SessionStart that arrive as separate attachments, seconds apart and before any call, are one copy.
    // Only part 0 carries the arm marker, so a marker always starts a copy.
    const last = this.pending.find((p) => p.item.kind === 'spec');
    if (!arm && last && Math.abs(Date.parse(o.timestamp) - Date.parse(last.item.ts)) < 10000) {
      Object.assign(last.item, { tokens: last.item.tokens + tokens, spec: last.item.spec + spec, dict: last.item.dict + dict });
      last.after = 0;
    } else if (spec) this.add({ kind: 'spec', arm: arm ?? 'brevity', tokens, spec, dict, owned: this.claim(this.ctx.lines, o.uuid) }, o);
  }

  user(o) {
    this.grow(lineText(o));
    const origin = o.origin ?? {};
    const blocks = Array.isArray(o.message?.content) ? o.message.content : [];
    if (origin.kind === 'peer') this.peer(origin, lineText(o), o);
    for (const b of blocks) {
      const item = b?.type === 'tool_result' ? this.tools.get(b.tool_use_id) : undefined;
      if (SENT.includes(item?.dir) && (o.toolUseResult?.success === false || b.is_error === true)) item.failed = true;
      else if (item?.dir === 'sent' && o.toolUseResult?.msg_id !== undefined) item.msgId = o.toolUseResult.msg_id;
    }
    const plain = !o.isMeta && !o.isCompactSummary && !blocks.some((b) => b?.type === 'tool_result');
    if (!this.firstHuman && (origin.kind === 'human' || (!o.origin && plain))) {
      // The first message may be a delegation prompt; that is settled once every transcript has been read.
      const c = o.message?.content;
      const texts = typeof c === 'string' ? [c] : blocks.filter((b) => b?.type === 'text').map((b) => b.text ?? '');
      this.firstHuman = this.add({
        kind: 'msg', dir: 'first', owned: this.claim(this.ctx.lines, o.uuid), counted: false, outputRate: 0, failed: false,
        tokens: 0, brevity: false, candidates: texts.map((t) => ({ hash: hash(t), text: t })),
      }, o);
      this.firstHuman.counted = this.firstHuman.owned && this.within(o.timestamp);
    }
  }

  result(prices) {
    const calls = [...this.calls.values()].filter((c) => c.counted);
    const bill = calls.reduce((a, c) => a + callBill(c.usage, c.model, prices), 0);
    const billLoaded = calls.filter((c) => c.loaded).reduce((a, c) => a + callBill(c.usage, c.model, prices), 0);
    const cost = (kind, key = 'rate') => this.items.filter((i) => i.kind === kind).reduce((a, i) => a + i.tokens * i[key], 0);
    const all = this.items.filter((i) => i.kind === 'spec');
    const copies = all.filter((i) => i.billed);
    const msgs = this.items.filter((i) => i.kind === 'msg' && i.dir !== 'first');
    const models = {};
    for (const c of calls) models[c.model] = (models[c.model] ?? 0) + 1;
    const rewrites = this.items.filter((i) => i.kind !== 'msg');
    const written = calls.map((c) => writes(c.usage));
    return {
      id: this.id,
      kind: this.kind === 'subagent' ? 'subagent' : /^sdk/.test(this.entrypoint ?? '') ? 'test' : 'team',
      title: this.titles.custom ?? this.titles.ai ?? null,
      // The arm of the last copy its counted calls carried (else of its last copy), and every arm it had, in order.
      arm: (copies.at(-1) ?? all.at(-1))?.arm ?? 'none',
      arms: [...new Set(all.map((i) => i.arm))],
      calls: calls.length,
      callsLoaded: calls.filter((c) => c.loaded).length,
      bill,
      billLoaded,
      models,
      writes5m: written.reduce((a, w) => a + w.w5, 0),
      writes1h: written.reduce((a, w) => a + w.w1h, 0),
      copies: copies.filter((i) => i.owned).length,
      inheritedCopies: copies.filter((i) => !i.owned).length,
      copyTokens: copies.filter((i) => i.owned).map((i) => ({ arm: i.arm, tokens: i.tokens, spec: i.spec, dict: i.dict })),
      copyCost: cost('spec'),
      skillCost: cost('skill'),
      copyCostLoaded: cost('spec', 'rateLoaded'),
      skillCostLoaded: cost('skill', 'rateLoaded'),
      rewrites: rewrites.reduce((a, i) => a + i.rewrites, 0),
      rewriteCost: rewrites.reduce((a, i) => a + i.tokens * i.rewriteRate, 0),
      drops: this.drops,
      duplicates: this.dups.map((d) => ({ ...d })),
      // The rates and the hash are settled into each message's style and saving, and the text, names, msg_id, call
      // number and a spawn's tool_use id into its quality signals; then all of them are removed (see signals and settle).
      messages: msgs.map((i) => ({
        dir: i.dir, owned: i.owned, counted: i.counted, brevity: i.brevity, arm: i.arm, tokens: i.tokens, failed: i.failed,
        rate: i.rate, outputRate: i.outputRate, rateLoaded: i.rateLoaded, outputRateLoaded: i.outputRateLoaded,
        callIndex: i.callIndex ?? null, ts: i.ts, hash: i.hash, text: i.text, peer: i.peer, msgId: i.msgId, ord: i.ord, key: i.key,
      })),
      first: this.firstHuman ? {
        owned: this.firstHuman.owned, counted: this.firstHuman.counted, rate: this.firstHuman.rate, rateLoaded: this.firstHuman.rateLoaded,
        callIndex: this.firstHuman.callIndex ?? null, candidates: this.firstHuman.candidates, ts: this.firstHuman.ts, uuid: this.firstHuman.uuid,
      } : null,
      loadStart: this.loadStart,
    };
  }
}

// Reads every transcript and returns one record per transcript; see the header for what each number means.
export async function meter(sources, { count, prices = PRICES, ratios, ratio, since, until, clarifyWindow = CLARIFY_WINDOW } = {}) {
  // `ratio`, the single ratio of earlier versions, stands for every compressed style.
  ratios ??= ratio === undefined ? SAVING_RATIOS : { brevity: ratio, lite: ratio, terse: ratio, off: 0 };
  const ctx = { count, prices, since, until, calls: new Set(), lines: new Set() };
  const ordered = [];
  for (const s of sources) ordered.push({ ...s, first: s.kind === 'session' ? await firstTimestamp(s.file) : '9999' });
  // The transcript that started first owns the calls and lines it shares with a later one.
  ordered.sort((a, b) => (a.kind === b.kind ? (a.first < b.first ? -1 : a.first > b.first ? 1 : 0) : a.kind === 'session' ? -1 : 1));
  const records = [];
  for (const s of ordered) {
    const id = basename(s.file, '.jsonl');
    const main = new Transcript(id, s.file, s.kind, ctx);
    let side = null;
    for await (const o of lines(s.file)) {
      // Older Claude Code versions logged subagent turns inline, marked isSidechain.
      if (o.isSidechain === true && s.kind === 'session') (side ??= new Transcript(`${id}-sidechain`, s.file, 'subagent', ctx)).feed(o);
      else main.feed(o);
    }
    for (const t of side ? [main, side] : [main]) {
      const r = t.result(prices);
      r.parent = s.parent ?? (t === side ? id : null);
      records.push(r);
    }
  }
  linkDelegations(records);
  signals(records, clarifyWindow);
  settle(records, ratios);
  return records;
}

// The delegation prompt that started each session (see the header): its first message, when that equals a delivered
// prompt from another transcript. Sessions take prompts in the order they started, each the newest one sent before it
// that no earlier session took, an original rather than a copy; a session that finds none started from no prompt. A
// transcript that continues or forks a session copies its first message, and keeps that session's prompt.
function linkDelegations(records) {
  const byHash = new Map();
  for (const r of records) {
    for (const m of r.messages) if (m.dir === 'delegation-sent' && !m.failed) byHash.set(m.hash, [...(byHash.get(m.hash) ?? []), { m, r }]);
  }
  const time = (ts) => (ts ? Date.parse(ts) : NaN);
  const order = (ts) => time(ts) || 0;
  const firsts = records.filter((r) => r.first?.candidates.some((c) => byHash.has(c.hash)))
    .sort((a, b) => Number(b.first.owned) - Number(a.first.owned) || order(a.first.ts) - order(b.first.ts));
  const taken = new Set();
  const byLine = new Map(); // the uuid of an owned first message to the link of its session
  for (const r of firsts) {
    const f = r.first;
    if (!f.owned && byLine.has(f.uuid)) { Object.assign(f, byLine.get(f.uuid)); continue; }
    const hit = f.candidates.find((c) => byHash.has(c.hash));
    const all = byHash.get(hit.hash).filter((x) => x.r !== r);
    const owned = all.filter((x) => x.m.owned);
    const pool = (owned.length ? owned : all).sort((a, b) => order(a.m.ts) - order(b.m.ts));
    // A prompt with no time, or a session with none, is taken as sent before it.
    const d = pool.filter((x) => !(time(x.m.ts) > time(f.ts)) && !taken.has(x.m)).at(-1);
    if (!d) continue;
    taken.add(d.m);
    const link = { hit, delegation: d.m, delegator: d.r };
    Object.assign(f, link);
    if (f.owned) byLine.set(f.uuid, link);
  }
}

// The quality signals of every delivered SendMessage message (see the header): clarified, corrected and resent.
function signals(records, window) {
  const byId = new Map(); // msg_id to the delivered message
  const byText = new Map(); // text hash to the owned delivered messages with that text
  const senderOf = new Map(); // delivered message to the record that sent it
  const receiverOf = new Map(); // msg_id to the record that received it
  const receivedText = new Map(); // text hash to the records that own a received message with that text
  const names = new Map(); // record to its title and the names that other sessions give it
  // A transcript that continues a session under a new id, or forks it, copies its lines without owning them: the
  // msg_id belongs to the transcript that owns the line.
  const keep = (map, key, value, owned) => {
    const had = map.get(key);
    if (key !== null && key !== undefined && (!had || (owned && !had.owned))) map.set(key, { value, owned });
  };
  const at = (map, key) => (key === null || key === undefined ? undefined : map.get(key)?.value);
  for (const r of records) {
    names.set(r, [r.title]);
    for (const m of r.messages) {
      if (m.dir === 'sent') m.clarified = m.corrected = m.resent = false;
      if (m.dir === 'sent' && !m.failed) {
        senderOf.set(m, r);
        keep(byId, m.msgId, m, m.owned);
        if (m.owned) byText.set(m.hash, [...(byText.get(m.hash) ?? []), m]);
      } else if (m.dir === 'received') {
        keep(receiverOf, m.msgId, r, m.owned);
        if (m.owned) receivedText.set(m.hash, new Set([...(receivedText.get(m.hash) ?? []), r]));
      }
    }
  }
  // What a receiver calls the sender of a message, and what a sender calls its recipient.
  for (const r of records) {
    for (const m of r.messages) {
      if (m.dir === 'received' && at(byId, m.msgId)) names.get(senderOf.get(at(byId, m.msgId))).push(...m.peer);
      if (m.dir === 'sent' && at(receiverOf, m.msgId)) names.get(at(receiverOf, m.msgId)).push(...m.peer);
    }
  }
  // The owned, delivered send that a message is or copies: by msg_id, else the only send with its text, else the only
  // one of those whose sender (for a received message) or recipient (for a sent copy) has the name the message gives.
  const original = (m) => {
    if (at(byId, m.msgId)) return at(byId, m.msgId);
    const all = byText.get(m.hash) ?? [];
    if (all.length === 1) return all[0];
    const fits = all.filter((c) => samePeer(m.dir === 'sent' ? c.peer : names.get(senderOf.get(c)), m.peer));
    return fits.length === 1 ? fits[0] : undefined;
  };
  // Whether a received message comes from the session a sent one goes to.
  const from = (m, n) => {
    const s = senderOf.get(original(m));
    return (!!s && s === at(receiverOf, n.msgId)) || samePeer(m.peer, n.peer);
  };
  const sameTo = (a, b) => {
    const t = at(receiverOf, a.msgId);
    return (!!t && t === at(receiverOf, b.msgId)) || samePeer(a.peer, b.peer);
  };
  const delivered = (m) => m.dir === 'sent' && !m.failed;
  for (const r of records) {
    const ms = r.messages.filter((m) => m.dir === 'sent' || m.dir === 'received');
    ms.forEach((n, j) => {
      if (!delivered(n)) return;
      // Clarified: what n's recipient sent this session since this session last wrote to it, newest first.
      if (n.owned) {
        for (let i = j - 1; i >= 0; i--) {
          const m = ms[i];
          if (delivered(m) && sameTo(m, n)) break;
          if (m.dir !== 'received' || !from(m, n)) continue;
          if (n.ord - m.ord >= window) break;
          const asked = original(m);
          if (asked && isClarification(n.text, m.text)) { asked.clarified = true; break; }
        }
      }
      // Corrected: this session's next delivered message to the same recipient corrects n. In a transcript that
      // continues or forks the session, n is a copy, and the owned original is the one counted.
      const next = ms.slice(j + 1).find((m) => delivered(m) && sameTo(n, m));
      if (next && isCorrection(next.text)) (n.owned ? n : original(n) ?? n).corrected = true;
      // Resent: n repeats an earlier message to the same recipient, with no message from it in between.
      for (let i = j - 1; i >= 0; i--) {
        const m = ms[i];
        if (m.dir === 'received' && from(m, n)) break;
        if (delivered(m) && sameTo(m, n) && similarity(m.text, n.text) >= RESEND_SIMILARITY) { n.resent = true; break; }
      }
    });
  }
  // A delegation signal's message goes to the transcript that received it by msg_id, else the only one that received
  // its text.
  const receiver = (m) => {
    const only = receivedText.get(m.hash);
    return at(receiverOf, m.msgId) ?? (only?.size === 1 ? [...only][0] : undefined);
  };
  delegationSignals(records, { names, senderOf, original, receiver });
}

// The quality signals of every delivered delegation prompt (see the header), kept apart from the SendMessage ones.
// `names`, `senderOf`, `original` and `receiver` are the SendMessage signals' matching.
function delegationSignals(records, { names, senderOf, original, receiver }) {
  const started = new Map(); // prompt to the transcripts of the session it started, with its continuations and forks
  const ownedByKey = new Map();
  for (const r of records) {
    const d = r.first?.delegation;
    if (d) started.set(d, [...(started.get(d) ?? []), r]);
    for (const m of r.messages) {
      if (m.dir !== 'delegation-sent') continue;
      m.started = m.clarified = m.corrected = m.resent = false;
      if (m.owned) ownedByKey.set(m.key, m);
    }
  }
  for (const d of started.keys()) d.started = true;
  // A copy of a prompt in a transcript that continues or forks its sender stands for the original, the prompt with
  // the same tool_use id.
  const originalOf = (d) => (d.owned ? d : ownedByKey.get(d.key) ?? d);
  const delivered = (m) => SENT.includes(m.dir) && !m.failed;
  for (const r of records) {
    // Clarified: the started session's messages to the sender, until the sender writes to it again, ask about the prompt.
    const d = r.first?.delegation;
    if (d) {
      const C = r.first.delegator;
      for (const m of r.messages) {
        if (m.dir === 'received' && (senderOf.get(original(m)) === C || samePeer(m.peer, names.get(C)))) break;
        if (m.dir !== 'sent' || !delivered(m) || !(receiver(m) === C || samePeer(m.peer, names.get(C)))) continue;
        if (m.owned && isClarification(m.text, d.text)) { d.clarified = true; break; }
      }
    }
    const ms = r.messages.filter((m) => m.dir === 'sent' || m.dir === 'delegation-sent');
    ms.forEach((n, j) => {
      if (n.dir !== 'delegation-sent' || !delivered(n)) return;
      const o = originalOf(n);
      // Corrected: the sender's next delivered message to the session the prompt started, matched by the transcript
      // that received it, else, when none did, by that session's names or the prompt's title. A prompt that started
      // none is not checked.
      const rs = started.get(o);
      const toIt = (m) => {
        const t = receiver(m);
        return t ? rs.includes(t) : samePeer(m.peer, [...rs.flatMap((x) => names.get(x)), ...n.peer]);
      };
      const next = rs && ms.slice(j + 1).find((m) => m.dir === 'sent' && delivered(m) && toIt(m));
      if (next && isCorrection(next.text)) o.corrected = true;
      // Resent: it repeats a prompt that this transcript spawned before it.
      if (ms.slice(0, j).some((m) => m.dir === 'delegation-sent' && delivered(m) && similarity(m.text, n.text) >= RESEND_SIMILARITY)) n.resent = true;
    });
  }
}

const SENT = ['sent', 'delegation-sent'];
const RECEIVED = ['received', 'delegation-received'];
// What a session writes itself, under its own arm.
const WRITTEN = [...SENT, 'subagent-prompt'];
// A message that the estimate counts as compressed: written in brevity, lite or terse, and not under off.
const compressed = (m) => m.style !== 'prose' && m.arm !== 'off';

// Each message's style (brevity, lite, terse or prose), ratio and estimated saving. A received message takes the arm
// and style of the sent message with the same text, and a session's first message is a received delegation prompt
// when it is the prompt that started the session (see linkDelegations).
function settle(records, ratios) {
  const style = (m) => (m.arm === 'lite' || m.arm === 'terse' ? m.arm : m.brevity ? 'brevity' : 'prose');
  const sent = new Map();
  for (const r of records) {
    for (const m of r.messages) {
      if (!WRITTEN.includes(m.dir)) continue;
      m.style = style(m);
      if (m.dir === 'sent') sent.set(m.hash, m);
    }
  }
  for (const r of records) {
    for (const m of r.messages) {
      if (WRITTEN.includes(m.dir)) continue;
      const from = m.dir === 'received' ? sent.get(m.hash) : undefined;
      m.arm = from?.arm ?? null;
      m.style = from?.style ?? style(m);
    }
    const f = r.first;
    if (f?.delegation) {
      const from = f.delegation;
      r.messages.push({
        dir: 'delegation-received', owned: f.owned, counted: f.counted, brevity: isBrevity(f.hit.text), arm: from.arm,
        style: from.style, tokens: from.tokens, failed: false, rate: f.rate, outputRate: 0, rateLoaded: f.rateLoaded,
        outputRateLoaded: 0, callIndex: f.callIndex, ts: f.ts,
      });
    }
    for (const m of r.messages) {
      m.ratio = compressed(m) ? ratios[m.style] : 0;
      const s = (m.tokens * m.ratio) / (1 - m.ratio);
      m.saving = s * (m.rate + m.outputRate);
      m.savingLoaded = s * (m.rateLoaded + m.outputRateLoaded);
      // Keep numbers only: no message text, session names or fingerprints leave this function.
      for (const key of ['rate', 'outputRate', 'rateLoaded', 'outputRateLoaded', 'hash', 'text', 'peer', 'msgId', 'ord', 'key']) delete m[key];
    }
    delete r.first;
  }
}

function tally(r) {
  const ms = r.messages.filter((m) => m.counted);
  const of = (dirs, pred = () => true) => ms.filter((m) => dirs.includes(m.dir) && pred(m));
  const delivered = (m) => !m.failed;
  const sent = of(SENT, delivered);
  const received = of(RECEIVED);
  const styled = (list, style) => list.filter((m) => m.style === style).length;
  const deliveries = of(['sent'], delivered);
  const prompts = of(['delegation-sent'], delivered);
  return {
    sentBrevity: styled(sent, 'brevity'),
    sentLite: styled(sent, 'lite'),
    sentTerse: styled(sent, 'terse'),
    sentProse: styled(sent, 'prose'),
    failed: of(SENT, (m) => m.failed).length,
    deliveredBrevity: styled(deliveries, 'brevity'),
    deliveredLite: styled(deliveries, 'lite'),
    deliveredTerse: styled(deliveries, 'terse'),
    deliveredProse: styled(deliveries, 'prose'),
    delegations: prompts.length,
    receivedBrevity: styled(received, 'brevity'),
    receivedLite: styled(received, 'lite'),
    receivedTerse: styled(received, 'terse'),
    receivedProse: styled(received, 'prose'),
    subagentPrompts: of(['subagent-prompt']).length,
    handbacks: of(['handback']).length,
    // A message between two measured sessions is in the sender's tally and the receiver's: messageTokens counts it at
    // each end, so a team total counts it twice (issue #76). sentTokens counts each message once, at the sender.
    messageTokens: [...sent, ...received].reduce((a, m) => a + m.tokens, 0),
    sentTokens: sent.reduce((a, m) => a + m.tokens, 0),
    brevityTokens: [...sent, ...received].filter((m) => m.style === 'brevity').reduce((a, m) => a + m.tokens, 0),
    // The quality signals, heuristics: of the SendMessage deliveries, how many were clarified, corrected or resent.
    delivered: deliveries.length,
    clarified: deliveries.filter((m) => m.clarified).length,
    corrected: deliveries.filter((m) => m.corrected).length,
    resent: deliveries.filter((m) => m.resent).length,
    // The delegation signals, apart: of the delivered delegation prompts, how many started a measured session, and
    // how many were clarified, corrected or resent.
    delegationsStarted: prompts.filter((m) => m.started).length,
    delegationsClarified: prompts.filter((m) => m.clarified).length,
    delegationsCorrected: prompts.filter((m) => m.corrected).length,
    delegationsResent: prompts.filter((m) => m.resent).length,
  };
}

// The mean length of a sent message, or null without any.
const meanSent = (tokens, n) => (n ? tokens / n : null);

const SIGNALS = ['clarified', 'corrected', 'resent'];
// The tally key of each delegation signal.
const DELEGATION_SIGNALS = { clarified: 'delegationsClarified', corrected: 'delegationsCorrected', resent: 'delegationsResent' };
// Each signal per 100 SendMessage deliveries, or null without any.
const per100 = (x) => (x.delivered ? Object.fromEntries(SIGNALS.map((k) => [k, (100 * x[k]) / x.delivered])) : null);
// Each delegation signal per 100 delivered delegation prompts, or null without any.
const delegationPer100 = (x) => (x.delegations
  ? Object.fromEntries(SIGNALS.map((k) => [k, (100 * x[DELEGATION_SIGNALS[k]]) / x.delegations])) : null);

function summarize(records) {
  const sum = (key) => records.reduce((a, r) => a + r[key], 0);
  const t = records.map((r) => r.tally);
  const tsum = (key) => t.reduce((a, x) => a + x[key], 0);
  const out = {
    sessions: records.length, calls: sum('calls'), callsLoaded: sum('callsLoaded'), bill: sum('bill'), billLoaded: sum('billLoaded'),
    copies: sum('copies'), copyCost: sum('copyCost'), skillCost: sum('skillCost'), specCost: sum('specCost'),
    rewrites: sum('rewrites'), rewriteCost: sum('rewriteCost'), saving: sum('saving'), net: sum('net'),
    specCostLoaded: sum('specCostLoaded'), savingLoaded: sum('savingLoaded'), netLoaded: sum('netLoaded'),
  };
  for (const key of Object.keys(t[0] ?? {})) out[key] = tsum(key);
  out.meanSentTokens = meanSent(out.sentTokens, out.sentBrevity + out.sentLite + out.sentTerse + out.sentProse);
  // Each share divides what the calls with an arm loaded billed for it by what those same calls billed in all.
  const b = out.billLoaded;
  out.shareOfLoadedBill = b ? { specCost: out.specCostLoaded / b, saving: out.savingLoaded / b, net: out.netLoaded / b } : null;
  out.per100 = per100({ delivered: out.delivered ?? 0, clarified: out.clarified, corrected: out.corrected, resent: out.resent });
  out.delegationPer100 = delegationPer100(out);
  return out;
}

// The sessions under each arm (see the header) and what they add up to. Each share divides
// by the bill of the arm's sessions.
export function perArm(sessions, ratios) {
  const arms = {};
  const order = [...ARMS, 'none'];
  for (const r of [...sessions].sort((a, b) => (order.indexOf(a.arm) + 1 || 99) - (order.indexOf(b.arm) + 1 || 99))) {
    const t = r.tally;
    const a = (arms[r.arm] ??= {
      ratio: r.arm in ratios ? ratios[r.arm] : null, sessions: [], calls: 0, bill: 0, loadCost: 0, sent: 0, received: 0,
      compressed: 0, saving: 0, net: 0, delivered: 0, clarified: 0, corrected: 0, resent: 0,
      delegations: 0, delegationsStarted: 0, delegationsClarified: 0, delegationsCorrected: 0, delegationsResent: 0,
    });
    a.sessions.push(r.id);
    a.calls += r.calls;
    a.bill += r.bill;
    a.loadCost += r.specCost;
    a.sent += t.sentBrevity + t.sentLite + t.sentTerse + t.sentProse;
    a.received += t.receivedBrevity + t.receivedLite + t.receivedTerse + t.receivedProse;
    a.compressed += r.messages.filter((m) => m.counted && !m.failed && [...SENT, ...RECEIVED].includes(m.dir) && compressed(m)).length;
    a.saving += r.saving;
    a.net += r.net;
    for (const k of ['delivered', ...SIGNALS, 'delegations', 'delegationsStarted', ...Object.values(DELEGATION_SIGNALS)]) a[k] += t[k];
  }
  for (const a of Object.values(arms)) {
    a.shareOfBill = a.bill ? { loadCost: a.loadCost / a.bill, saving: a.saving / a.bill, net: a.net / a.bill } : null;
    a.per100 = per100(a);
    a.delegationPer100 = delegationPer100(a);
  }
  return arms;
}

// The messages the sessions sent, by the arm each was written under (none: no copy in the sender's context), with
// their tokens and mean length. Unlike perArm, a session that switched arms counts under each (issue #79). Every arm in
// `arms` gets a row.
export function sentByArm(sessions, arms = {}) {
  const ms = sessions.flatMap((r) => r.messages.filter((m) => m.counted && !m.failed && SENT.includes(m.dir)));
  const order = [...ARMS, 'none'];
  const keys = [...new Set([...Object.keys(arms), ...ms.map((m) => m.arm ?? 'none')])]
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return Object.fromEntries(keys.map((arm) => {
    const mine = ms.filter((m) => (m.arm ?? 'none') === arm);
    const sentTokens = mine.reduce((a, m) => a + m.tokens, 0);
    return [arm, { sent: mine.length, sentTokens, meanSentTokens: meanSent(sentTokens, mine.length) }];
  }));
}

// The cost-model sessions file: calls and compressed messages from the session's first copy on.
export function teamSessions(team) {
  return team.map((r) => {
    const start = r.loadStart ?? 0;
    const ms = r.messages.filter((m) => m.counted && compressed(m) && !m.failed && (m.callIndex ?? start) >= start);
    const sent = ms.filter((m) => SENT.includes(m.dir)).length;
    const received = ms.filter((m) => RECEIVED.includes(m.dir)).length;
    const row = { name: r.id.slice(0, 8), turns: r.calls - start, sent, received };
    const firsts = ms.filter((m) => SENT.includes(m.dir) || RECEIVED.includes(m.dir)).map((m) => (m.callIndex ?? start) - start);
    if (firsts.length) row.first = Math.min(...firsts);
    return row;
  });
}

function parseArgs(argv) {
  const opts = { project: [] };
  const valued = ['--project', '--since', '--until', '--saving-ratio', '--input', '--output', '--write-5m', '--write-1h', '--read', '--team-json',
    '--clarify-window'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valued.includes(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      if (a === '--project') opts.project.push(argv[++i]);
      else opts[a.slice(2)] = argv[++i];
    } else if (['--json', '--titles'].includes(a)) opts[a.slice(2)] = true;
    else throw new Error(`unknown option ${a}`);
  }
  for (const key of ['since', 'until']) {
    if (opts[key] === undefined) continue;
    const t = Date.parse(opts[key]);
    if (!Number.isFinite(t)) throw new Error(`--${key} must be an ISO time, such as 2026-01-05T12:00:00Z`);
    opts[key] = t;
  }
  for (const key of ['saving-ratio', 'input', 'output', 'write-5m', 'write-1h', 'read']) {
    if (opts[key] === undefined) continue;
    const v = Number(opts[key]);
    if (!Number.isFinite(v) || v < 0 || (key === 'saving-ratio' && v >= 1)) throw new Error(`--${key} must be a number >= 0${key === 'saving-ratio' ? ' and < 1' : ''}`);
    opts[key] = v;
  }
  if (opts['clarify-window'] !== undefined) {
    const v = Number(opts['clarify-window']);
    if (!Number.isInteger(v) || v < 1) throw new Error('--clarify-window must be a whole number of calls >= 1');
    opts['clarify-window'] = v;
  }
  return opts;
}

export async function run(argv, { cwd = process.cwd(), home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), count, env = process.env } = {}) {
  const o = parseArgs(argv);
  const tok = count ? { name: 'given', count } : await tokenizer(env);
  const prices = {
    input: o.input ?? PRICES.input, output: o.output ?? PRICES.output,
    write5m: o['write-5m'] ?? PRICES.write5m, write1h: o['write-1h'] ?? PRICES.write1h, read: o.read,
  };
  // --saving-ratio replaces the ratio of every compressed style; nothing compresses what is written under off.
  const override = o['saving-ratio'];
  const ratios = override === undefined ? { ...SAVING_RATIOS } : { brevity: override, lite: override, terse: override, off: 0 };
  const root = join(home, 'projects');
  const dirs = o.project.length ? o.project.map((d) => resolve(cwd, d)) : defaultProjects(cwd, root);
  for (const d of dirs) if (!existsSync(d)) throw new Error(`no such folder: ${d}`);
  if (!dirs.length) throw new Error(`no Claude Code project folder for ${resolve(cwd)} under ${root}; name one with --project`);
  const sources = transcripts(dirs);
  const clarifyWindow = o['clarify-window'] ?? CLARIFY_WINDOW;
  const records = await meter(sources, { count: tok.count, prices, ratios, since: o.since, until: o.until, clarifyWindow });
  for (const r of records) {
    r.specCost = r.copyCost + r.skillCost;
    r.saving = r.messages.reduce((a, m) => a + m.saving, 0);
    r.net = r.saving - r.specCost;
    r.specCostLoaded = r.copyCostLoaded + r.skillCostLoaded;
    r.savingLoaded = r.messages.reduce((a, m) => a + m.savingLoaded, 0);
    r.netLoaded = r.savingLoaded - r.specCostLoaded;
    r.tally = tally(r);
    // Short ids and no times or titles, unless --titles: they can point at private sessions.
    if (!o.titles) {
      delete r.title;
      r.id = r.id.slice(0, 8);
      if (r.parent) r.parent = r.parent.slice(0, 8);
      for (const m of r.messages) delete m.ts;
    }
  }
  const active = (r) => r.calls > 0 || r.messages.some((m) => m.counted && [...SENT, ...RECEIVED].includes(m.dir));
  const team = records.filter((r) => r.kind === 'team' && active(r));
  const tests = records.filter((r) => r.kind === 'test' && active(r));
  const subagents = records.filter((r) => r.kind === 'subagent' && r.calls > 0);
  const models = {};
  for (const r of team) for (const [m, n] of Object.entries(r.models)) models[m] = (models[m] ?? 0) + n;
  const arms = perArm(team, ratios);
  const result = {
    tokenizer: tok.name,
    tokenizerForced: !!tok.forced,
    prices: { ...prices, read: prices.read ?? 'by model', readByModel: Object.fromEntries(Object.keys(models).map((m) => [m, readPrice(m, prices)])) },
    models,
    // The brevity ratio, or the override: the key earlier versions wrote.
    savingRatio: override ?? ratios.brevity,
    savingRatios: ratios,
    savingRatioOverride: override ?? null,
    window: { since: o.since === undefined ? null : new Date(o.since).toISOString(), until: o.until === undefined ? null : new Date(o.until).toISOString() },
    folders: dirs.length,
    transcripts: { sessions: sources.filter((s) => s.kind === 'session').length, subagents: sources.filter((s) => s.kind === 'subagent').length },
    team: { sessions: team, total: summarize(team), arms, sentByArm: sentByArm(team, arms) },
    tests: { sessions: tests, total: summarize(tests) },
    subagents: { total: summarize(subagents) },
    duplicates: team.flatMap((r) => r.duplicates.map((d) => ({ session: r.id.slice(0, 8), ...d }))),
    // The quality signals are heuristics: their counts are in each tally, total and arm, with per100.
    signals: { heuristic: true, clarifyWindow, resendSimilarity: RESEND_SIMILARITY },
    titles: !!o.titles,
  };
  if (o['team-json']) {
    const rows = teamSessions(team);
    writeFileSync(resolve(cwd, o['team-json']), `${JSON.stringify(rows, null, 2)}\n`);
    const t = result.team.total;
    const saved = team.flatMap((r) => r.messages.filter((m) => m.counted && compressed(m) && !m.failed && [...SENT, ...RECEIVED].includes(m.dir)));
    const meanSaving = saved.length ? saved.reduce((a, m) => a + (m.tokens * m.ratio) / (1 - m.ratio), 0) / saved.length : 0;
    const allCopies = team.flatMap((r) => r.copyTokens);
    const load = allCopies.length ? allCopies.reduce((a, c) => a + c.tokens, 0) / allCopies.length : 0;
    // The team's write price per token, weighted by what its calls wrote, and the read price of its busiest model.
    const w5 = team.reduce((a, r) => a + r.writes5m, 0);
    const w1h = team.reduce((a, r) => a + r.writes1h, 0);
    const w = w5 + w1h ? (w5 * prices.write5m + w1h * prices.write1h) / (w5 + w1h) : prices.write5m;
    const read = readPrice(Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0], prices);
    // The cost model next to this file, so the command runs from any folder. It has no input price.
    const costModel = join(dirname(fileURLToPath(import.meta.url)), 'cost-model.mjs');
    result.teamJson = {
      file: o['team-json'], rows: rows.length,
      compare: `node "${costModel}" "${o['team-json']}" --saving ${+meanSaving.toFixed(1)} --load-tokens ${Math.round(load)} `
        + `--output ${prices.output} --write ${+w.toFixed(2)} --read ${read}`,
      inputIgnored: prices.input !== PRICES.input,
      // The file holds each session's calls and messages from its first copy on: compare the net of those calls.
      measuredNet: t.netLoaded,
    };
  }
  return result;
}

const fmt = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '-');
const signed = (x) => (x > 0 ? `+${fmt(x)}` : fmt(x));
const pct = (x) => `${(100 * x).toFixed(2)}%`;
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
// The first `left` columns are text, aligned left; the rest are numbers.
const table = (rows, left = 1) => {
  const width = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  return rows.map((r) => r.map((v, c) => (c < left ? String(v).padEnd(width[c]) : String(v).padStart(width[c]))).join('  ').trimEnd()).join('\n');
};

const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');

export function render(r) {
  const out = [];
  const p = r.prices;
  const reads = Object.entries(p.readByModel).map(([m, x]) => `${m} ${x} (${plural(r.models[m], 'call')})`).join(', ');
  out.push('brevity meter: what brevity cost and saved in these Claude Code sessions, in input-token equivalents');
  out.push(`prices: input ${p.input}, output ${p.output}, cache write ${p.write5m} (5-minute) or ${p.write1h} (1-hour), `
    + `cache read ${typeof p.read === 'number' ? `${p.read} (--read)` : reads || 'by model'}`);
  out.push(`tokenizer: ${r.tokenizer}${r.tokenizerForced ? ' (BREVITY_METER_TOKENIZER=chars/4)' : r.tokenizer === 'chars/4'
    ? ' (for the legacy counts, run npm i -D @anthropic-ai/tokenizer in the brevity checkout that holds this tool)' : ''}`);
  const win = r.window.since || r.window.until ? `calls from ${r.window.since ?? 'the start'} to ${r.window.until ?? 'the end'}` : 'all calls';
  out.push(`read: ${plural(r.transcripts.sessions, 'session transcript')} and ${plural(r.transcripts.subagents, 'subagent transcript')} `
    + `in ${plural(r.folders, 'folder')}; ${win}`);

  const t = r.team.total;
  out.push('', `team: ${plural(t.sessions, 'session')}`);
  if (t.sessions) {
    // The lite and terse counts show only when some message was written under those arms.
    const styles = t.sentLite + t.sentTerse + t.receivedLite + t.receivedTerse > 0 ? ['Brevity', 'Lite', 'Terse', 'Prose'] : ['Brevity', 'Prose'];
    const split = styles.map((s) => s[0].toLowerCase()).join('/');
    const counts = (m, dir) => styles.map((s) => m[`${dir}${s}`]).join('/');
    const head = ['session', ...(r.titles ? ['title'] : []), 'arm', 'calls', 'bill', 'copies', 'load cost', `sent ${split}`, `received ${split}`,
      'sent tokens', 'msg tokens (both ends)', 'est. saving', 'net'];
    const row = (x, name, title, arm) => {
      const m = x.tally ?? x;
      return [name, ...(r.titles ? [title ?? ''] : []), arm, fmt(x.calls), fmt(x.bill), fmt(x.copies), fmt(x.specCost), counts(m, 'sent'),
        counts(m, 'received'), fmt(m.sentTokens), fmt(m.messageTokens), fmt(x.saving), signed(x.net)];
    };
    out.push(table([head, ...r.team.sessions.map((s) => row(s, s.id.slice(0, 8), s.title, s.arm)), row(t, 'total', '', '')], r.titles ? 3 : 2));
    out.push('arm = the arm of the last copy the session\'s counted calls carried, else of its last copy (none: no copy).');
    out.push(`${split} = ${styles.map((s) => s.toLowerCase()).join('/')}.`);
    out.push('sent = SendMessage deliveries and delegation prompts; received = peer messages and delegation prompts.');
    const sentCount = t.sentBrevity + t.sentLite + t.sentTerse + t.sentProse;
    out.push(`sent tokens = the tokens of the messages sent, each counted once, at its sender: ${sentCount
      ? `the team sent ${fmt(t.sentTokens)} in ${plural(sentCount, 'message')}, a mean length of ${plural(Math.round(t.meanSentTokens), 'token')}`
      : 'no message sent'}.`);
    out.push('msg tokens (both ends) = sent plus received tokens: a message between two measured sessions counts at each end, '
      + 'so the total counts it twice. For message lengths, use sent tokens.');
    if (t.billLoaded) {
      const s = t.shareOfLoadedBill;
      out.push(`with an arm loaded (each session from its first copy on): ${plural(t.callsLoaded, 'call')}, bill ${fmt(t.billLoaded)}; `
        + `on those calls, load cost ${fmt(t.specCostLoaded)} (${pct(s.specCost)}), estimated saving ${fmt(t.savingLoaded)} (${pct(s.saving)}), `
        + `net ${signed(t.netLoaded)} (${pct(s.net)})`);
    }
    out.push(`load cost ${fmt(t.specCost)} = copies ${fmt(t.copyCost)} + skill entry ${fmt(t.skillCost)}; ${plural(t.rewrites, 'time')} a call `
      + `wrote a copy again after an idle cache miss or a rebuild (${fmt(t.rewriteCost)} of the cost)`);
    const delivered = styles.map((s) => `${fmt(t[`delivered${s}`])} ${s.toLowerCase()}`);
    out.push(`messages: ${and(delivered)} SendMessage deliveries, `
      + `${plural(t.failed, 'failed send')}, ${plural(t.delegations, 'delegation prompt')}; to and from subagents: `
      + `${plural(t.subagentPrompts, 'prompt')}, ${plural(t.handbacks, 'result')} (their savings are in est. saving)`);
    const rs = r.savingRatios;
    out.push(`est. saving is an estimate: no prose original exists, so each message is taken to replace prose 1 / (1 - r) times `
      + `its length, with r = ${r.savingRatioOverride === null
        ? `brevity ${rs.brevity}, lite ${rs.lite}, terse ${rs.terse} (the single-pass pilot, issue #26)`
        : `${r.savingRatioOverride} for brevity, lite and terse (--saving-ratio)`}; prose, and what is written under off, saves nothing.`);

    out.push('', 'per arm (each session under its arm, as above, with all it sent, even under an earlier arm, issue #79; '
      + '% = share of those sessions\' bill):');
    const share = (a, key) => (a.shareOfBill ? pct(a.shareOfBill[key]) : '-');
    out.push(table([
      ['arm', 'ratio', 'sessions', 'calls', 'bill', 'load cost', 'load %', 'sent', 'received', 'est. saving', 'saving %', 'net', 'net %'],
      ...Object.entries(r.team.arms).map(([arm, a]) => [arm, a.ratio ?? '-', fmt(a.sessions.length), fmt(a.calls), fmt(a.bill), fmt(a.loadCost),
        share(a, 'loadCost'), fmt(a.sent), fmt(a.received), fmt(a.saving), share(a, 'saving'), signed(a.net), share(a, 'net')]),
    ]));

    out.push('', 'sent messages by the arm each was written under (the newest copy in the sender\'s context; none: no copy), '
      + 'the lengths to compare arms; tokens/sent = sent tokens / sent:');
    out.push(table([
      ['arm', 'sent', 'sent tokens', 'tokens/sent'],
      ...Object.entries(r.team.sentByArm).map(([arm, a]) => [arm, fmt(a.sent), fmt(a.sentTokens), fmt(a.meanSentTokens)]),
    ]));

    const s = r.signals;
    out.push('', 'quality signals, heuristics: SendMessage deliveries that may not have been understood, per arm and for the team '
      + '(n and per 100 delivered):');
    const rate = (x, key) => (x.per100 ? x.per100[key].toFixed(1) : '-');
    const signalRow = (name, x) => [name, fmt(x.delivered), ...SIGNALS.flatMap((k) => [fmt(x[k]), rate(x, k)])];
    out.push(table([
      ['arm', 'delivered', 'clarified', '/100', 'corrected', '/100', 'resent', '/100'],
      ...Object.entries(r.team.arms).map(([arm, a]) => signalRow(arm, a)),
      signalRow('team', t),
    ]));
    out.push(`clarified = the recipient's next message to the sender, within its next ${plural(s.clarifyWindow, 'call')}, asks `
      + 'about it; corrected = the sender\'s next message to the same recipient corrects or retracts it; resent = it repeats an '
      + `earlier message to the same recipient (similarity >= ${s.resendSimilarity}) with no reply in between. The rules are in the `
      + 'header of tools/meter.mjs; they miss some cases and flag others wrongly.');

    out.push('', 'delegation signals, heuristics, apart from the SendMessage ones: delegation prompts (spawn_task) that may not '
      + 'have been understood, per arm and for the team (n and per 100 prompts):');
    const drate = (x, key) => (x.delegationPer100 ? x.delegationPer100[key].toFixed(1) : '-');
    const delegationRow = (name, x) => [name, fmt(x.delegations), fmt(x.delegationsStarted),
      ...SIGNALS.flatMap((k) => [fmt(x[DELEGATION_SIGNALS[k]]), drate(x, k)])];
    out.push(table([
      ['arm', 'prompts', 'started', 'clarified', '/100', 'corrected', '/100', 'resent', '/100'],
      ...Object.entries(r.team.arms).map(([arm, a]) => delegationRow(arm, a)),
      delegationRow('team', t),
    ]));
    out.push('started = the session the prompt started was measured; only those can be clarified or corrected. '
      + 'clarified = that session\'s messages to the sender, before the sender writes to it again, ask about the prompt (no call '
      + 'window: a new session reads before it writes); corrected = the sender\'s next message to that session corrects or '
      + `retracts something; resent = it repeats a prompt the sender spawned before (similarity >= ${s.resendSimilarity}).`);
  }
  out.push('', r.duplicates.length ? 'duplicated copies (two or more in one context, issue #39):' : 'duplicated copies: none');
  for (const d of r.duplicates) {
    out.push(`  ${d.session}  ${d.copies} copies from ${d.from} to ${d.to}: ${plural(d.calls, 'call')}, extra cost ${fmt(d.extra)}`);
  }
  const line = (label, x, unit) => `${label}: ${plural(x.sessions, unit)}, ${plural(x.calls, 'call')}, bill ${fmt(x.bill)}, `
    + `${plural(x.copies, 'copy', 'copies')}, load cost ${fmt(x.specCost)}`;
  out.push('', line('tests (claude -p), apart from the team', r.tests.total, 'session'));
  out.push(line('subagents, apart from the team', r.subagents.total, 'transcript'));
  if (r.teamJson) {
    out.push('', `wrote ${plural(r.teamJson.rows, 'session')} to ${r.teamJson.file}; to compare the cost model with this measurement `
      + `(net with an arm loaded ${signed(r.teamJson.measuredNet)}), run:`, `  ${r.teamJson.compare}`);
    if (r.teamJson.inputIgnored) out.push(`the cost model has no input price, so --input ${p.input} is not passed to it`);
  }
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const r = await run(process.argv.slice(2));
    console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
  } catch (e) {
    console.error(`error: ${e.message}`);
    console.error('usage: meter.mjs [--project dir]... [--since ISO] [--until ISO] [--saving-ratio r] [--clarify-window calls] [--titles] [--json] [--team-json file]; see the header of tools/meter.mjs');
    process.exit(2);
  }
}
