#!/usr/bin/env node
// brevity meter: what brevity cost and saved in a project's real Claude Code sessions, read from their transcripts.
//
//   node tools/meter.mjs [--project <dir>]... [--since <ISO time>] [--until <ISO time>] [--saving-ratio 0.154]
//        [--input 1] [--output 5] [--write-5m 1.25] [--write-1h 2] [--read <r>]
//        [--titles] [--json] [--team-json <file>]
//
// Input: Claude Code's transcripts, one JSON object per line, under ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects).
// By default it reads the folder of the current directory, named by the directory's path with every character that
// is not a letter or a digit replaced by "-", plus the folders of that directory's Claude Code worktrees
// (<folder>--claude-worktrees-*). Run from inside a worktree (<repo>/.claude/worktrees/<name>), it starts from <repo>.
// --project names folders instead, and can be repeated. In a folder, each <session id>.jsonl is a session, and
// <session id>/subagents/**/*.jsonl are its subagents: they are reported apart, never in the team totals. Workflow
// journal.jsonl files carry no usage and are skipped. Files are read line by line, so their size does not matter.
// The tool only reads: it uses no network and writes nothing but the --team-json file. It prints numbers and short
// session ids; session titles, which can be private, only with --titles.
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
// - Spec copies. A SessionStart hook injection whose text holds "<!-- brevity SPEC.md -->" is one copy of the spec
//   and the dictionaries injected with it, and costs the tokens of its rendered text. The plugin's "brevity:brevity"
//   line in a skill listing is counted the same way, as the skill entry.
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
// - Messages. Sent: SendMessage calls (a send whose result says success false failed) and delegation prompts
//   (mcp__ccd_session__spawn_task). Received: user lines from a peer (origin.kind "peer"), and a delegation prompt
//   that is a session's first message. Peer lines with handback true are subagent results, and Agent tool prompts go
//   to subagents: both are counted apart. A message is brevity when a line after its first starts with a SPEC.md
//   section 3 verb (DO, NO, REPLY, ASK, ASKn, An, WILL, DONE, IF, HOLD, GO, DEC, FIX, WARN, WHY, CHK, FILES, OWN, TELL,
//   ORDER, NUM, HDR, MERGED, READY, ACK); otherwise it is prose.
// - Savings, an estimate. No prose original exists for a real message, so a brevity message of t tokens is taken to
//   replace prose of t / (1 - r) tokens, r = --saving-ratio (default 0.154: the single-pass pilot in eval/RESULTS.md),
//   and to save s = t x r / (1 - r). The sender saves s x output when it writes the message; then the sender and the
//   receiver each save s x the rate of every call that carries the message, priced like a copy: the write rate where
//   the call writes it to the cache (the receiver's first call, the sender's next call, idle misses), the read price
//   elsewhere. Unlike tools/cost-model.mjs, this includes the sender's own cache write.
//
// Token counts use @anthropic-ai/tokenizer when it is installed (npm i -D @anthropic-ai/tokenizer), the legacy
// tokenizer behind eval/RESULTS.md's counts, and chars/4 otherwise. The output says which ran.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const PRICES = { input: 1, output: 5, write5m: 1.25, write1h: 2 };
export const READ_PRICES = { 'claude-opus-5-5': 0.05, 'claude-fable-5-1': 0.025, 'claude-mythos-5-1': 0.025 };
export const DEFAULT_READ = 0.1;
export const SAVING_RATIO = 0.154;
const VERB_LINE = /^\s*(?:[-*]\s+|\d+\.\s+)?(?:@\S+\s+)?(?:DO|NO|REPLY|ASK\d*|A\d+|WILL|DONE|IF|HOLD|GO|DEC|FIX|WARN|WHY|CHK|FILES|OWN|TELL|ORDER|NUM|HDR|MERGED|READY|ACK)(?=[\s:;]|$)/;
const SPEC_MARK = '<!-- brevity SPEC.md';
const SKILL_ENTRY = /(?:^|\n)(- brevity:brevity\b[^\n]*(?:\n(?!- )[^\n]*)*)/;
const DELEGATION = /(?:^|__)spawn_task$/;

export async function tokenizer() {
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
    return { name: 'chars/4', count: (t) => Math.ceil(t.length / 4) };
  }
}

// Whether a message is brevity: a line after its first starts with a section 3 verb.
export function isBrevity(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trimStart().split('\n').slice(1).some((l) => VERB_LINE.test(l));
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

// The Claude Code project folders for `cwd`: its own and its worktrees'.
export function defaultProjects(cwd, root) {
  const m = resolve(cwd).match(/^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+/);
  const base = projectFolder(m ? m[1] : cwd);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (e.name === base || e.name.startsWith(`${base}--claude-worktrees-`)))
    .map((e) => join(root, e.name));
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
    this.firstHuman = null;
    this.dups = [];
    this.dupRun = null;
    this.drops = { compaction: 0, compact: 0, clear: 0, resume: 0 };
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
    Object.assign(item, { uuid: o.uuid, ts: o.timestamp, rate: 0, billed: 0, rewrites: 0, rewriteRate: 0, dropped: null });
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
    const call = { id, model: o.message.model, usage: u, ts: o.timestamp, counted: owned && this.within(o.timestamp), index: null };
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
    const r = readPrice(call.model, this.ctx.prices);
    const w = writeRate(u, this.ctx.prices);
    const spec = [];
    for (const it of this.live) {
      const writing = read < it.end;
      const rate = writing ? w : r;
      if (writing && it.billed) { it.rewrites++; it.rewriteRate += rate; }
      it.billed++;
      it.rate += rate;
      if (it.kind === 'spec') spec.push({ it, rate });
    }
    if (this.loadStart === null && spec.length) this.loadStart = call.index;
    call.loaded = this.loadStart !== null;
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
    return this.add({
      kind: 'msg', dir, owned, counted: owned && counted, tokens: this.ctx.count(t), brevity: isBrevity(t), hash: hash(t),
      outputRate: 0, failed: false,
    }, o);
  }

  toolUse(b, o, call) {
    const name = b.name ?? '';
    let item;
    if (name === 'SendMessage') item = this.message('sent', b.input?.message ?? b.input?.content, b.id, o, call.counted);
    else if (DELEGATION.test(name)) item = this.message('delegation-sent', b.input?.prompt, b.id, o, call.counted);
    else if (name === 'Agent' || name === 'Task') item = this.message('subagent-prompt', b.input?.prompt, b.id, o, call.counted);
    else return;
    // The sender writes it as output in this call, and carries it from the next one.
    item.callIndex = call.index;
    if (item.counted) item.outputRate = this.ctx.prices.output;
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
    const spec = ours.filter((x) => x.includes(SPEC_MARK)).reduce((s, x) => s + count(x), 0);
    const dict = ours.filter((x) => !x.includes(SPEC_MARK)).reduce((s, x) => s + count(x), 0);
    // Parts of one SessionStart that arrive as separate attachments, seconds apart and before any call, are one copy.
    const last = this.pending.find((p) => p.item.kind === 'spec');
    if (last && Math.abs(Date.parse(o.timestamp) - Date.parse(last.item.ts)) < 10000) {
      Object.assign(last.item, { tokens: last.item.tokens + tokens, spec: last.item.spec + spec, dict: last.item.dict + dict });
      last.after = 0;
    } else if (spec) this.add({ kind: 'spec', tokens, spec, dict, owned: this.claim(this.ctx.lines, o.uuid) }, o);
  }

  user(o) {
    this.grow(lineText(o));
    const origin = o.origin ?? {};
    const blocks = Array.isArray(o.message?.content) ? o.message.content : [];
    if (origin.kind === 'peer') {
      this.message(origin.handback ? 'handback' : 'received', origin.body ?? lineText(o), o.uuid, o, this.within(o.timestamp));
    }
    for (const b of blocks) {
      const item = b?.type === 'tool_result' ? this.tools.get(b.tool_use_id) : undefined;
      if (item?.dir === 'sent' && (o.toolUseResult?.success === false || b.is_error === true)) item.failed = true;
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

  result(prices, ratio) {
    const calls = [...this.calls.values()].filter((c) => c.counted);
    const bill = calls.reduce((a, c) => a + callBill(c.usage, c.model, prices), 0);
    const billLoaded = calls.filter((c) => c.loaded).reduce((a, c) => a + callBill(c.usage, c.model, prices), 0);
    const cost = (kind) => this.items.filter((i) => i.kind === kind).reduce((a, i) => a + i.tokens * i.rate, 0);
    const copies = this.items.filter((i) => i.kind === 'spec' && i.billed);
    const s = (i) => (i.brevity ? (i.tokens * ratio) / (1 - ratio) : 0);
    const msgs = this.items.filter((i) => i.kind === 'msg' && i.dir !== 'first');
    const models = {};
    for (const c of calls) models[c.model] = (models[c.model] ?? 0) + 1;
    const rewrites = this.items.filter((i) => i.kind !== 'msg');
    const written = calls.map((c) => writes(c.usage));
    return {
      id: this.id,
      kind: this.kind === 'subagent' ? 'subagent' : /^sdk/.test(this.entrypoint ?? '') ? 'test' : 'team',
      title: this.titles.custom ?? this.titles.ai ?? null,
      calls: calls.length,
      callsLoaded: calls.filter((c) => c.loaded).length,
      bill,
      billLoaded,
      models,
      writes5m: written.reduce((a, w) => a + w.w5, 0),
      writes1h: written.reduce((a, w) => a + w.w1h, 0),
      copies: copies.filter((i) => i.owned).length,
      inheritedCopies: copies.filter((i) => !i.owned).length,
      copyTokens: copies.filter((i) => i.owned).map((i) => ({ tokens: i.tokens, spec: i.spec, dict: i.dict })),
      copyCost: cost('spec'),
      skillCost: cost('skill'),
      rewrites: rewrites.reduce((a, i) => a + i.rewrites, 0),
      rewriteCost: rewrites.reduce((a, i) => a + i.tokens * i.rewriteRate, 0),
      drops: this.drops,
      duplicates: this.dups.map((d) => ({ ...d })),
      messages: msgs.map((i) => ({
        dir: i.dir, owned: i.owned, counted: i.counted, brevity: i.brevity, tokens: i.tokens, failed: i.failed,
        saving: s(i) * (i.rate + i.outputRate), callIndex: i.callIndex ?? null, ts: i.ts, hash: i.hash,
      })),
      first: this.firstHuman ? {
        owned: this.firstHuman.owned, counted: this.firstHuman.counted, rate: this.firstHuman.rate,
        callIndex: this.firstHuman.callIndex ?? null, candidates: this.firstHuman.candidates, ts: this.firstHuman.ts,
      } : null,
      loadStart: this.loadStart,
    };
  }
}

// Reads every transcript and returns one record per transcript; see the header for what each number means.
export async function meter(sources, { count, prices = PRICES, ratio = SAVING_RATIO, since, until } = {}) {
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
      const r = t.result(prices, ratio);
      r.parent = s.parent ?? (t === side ? id : null);
      records.push(r);
    }
  }
  settleDelegations(records, ratio);
  return records;
}

// A session's first message is a received delegation prompt when it equals one that a session sent.
function settleDelegations(records, ratio) {
  const sent = new Map();
  for (const r of records) for (const m of r.messages) if (m.dir === 'delegation-sent') sent.set(m.hash, m);
  for (const r of records) {
    const f = r.first;
    const hit = f?.candidates.find((c) => sent.has(c.hash));
    if (hit) {
      const brevity = isBrevity(hit.text);
      const tokens = sent.get(hit.hash).tokens;
      const s = brevity ? (tokens * ratio) / (1 - ratio) : 0;
      r.messages.push({
        dir: 'delegation-received', owned: f.owned, counted: f.counted, brevity, tokens, failed: false, saving: s * f.rate,
        callIndex: f.callIndex, ts: f.ts,
      });
    }
    // Keep numbers only: no message text or fingerprints leave this function.
    delete r.first;
    for (const m of r.messages) delete m.hash;
  }
}

const SENT = ['sent', 'delegation-sent'];
const RECEIVED = ['received', 'delegation-received'];

function tally(r) {
  const ms = r.messages.filter((m) => m.counted);
  const of = (dirs, pred = () => true) => ms.filter((m) => dirs.includes(m.dir) && pred(m));
  const delivered = (m) => !m.failed;
  const sent = of(SENT, delivered);
  const received = of(RECEIVED);
  return {
    sentBrevity: sent.filter((m) => m.brevity).length,
    sentProse: sent.filter((m) => !m.brevity).length,
    failed: of(['sent'], (m) => m.failed).length,
    deliveredBrevity: of(['sent'], (m) => delivered(m) && m.brevity).length,
    deliveredProse: of(['sent'], (m) => delivered(m) && !m.brevity).length,
    delegations: of(['delegation-sent']).length,
    receivedBrevity: received.filter((m) => m.brevity).length,
    receivedProse: received.filter((m) => !m.brevity).length,
    subagentPrompts: of(['subagent-prompt']).length,
    handbacks: of(['handback']).length,
    messageTokens: [...sent, ...received].reduce((a, m) => a + m.tokens, 0),
    brevityTokens: [...sent, ...received].filter((m) => m.brevity).reduce((a, m) => a + m.tokens, 0),
  };
}

function summarize(records) {
  const sum = (key) => records.reduce((a, r) => a + r[key], 0);
  const t = records.map((r) => r.tally);
  const tsum = (key) => t.reduce((a, x) => a + x[key], 0);
  const out = {
    sessions: records.length, calls: sum('calls'), callsLoaded: sum('callsLoaded'), bill: sum('bill'), billLoaded: sum('billLoaded'),
    copies: sum('copies'), copyCost: sum('copyCost'), skillCost: sum('skillCost'), specCost: sum('specCost'),
    rewrites: sum('rewrites'), rewriteCost: sum('rewriteCost'), saving: sum('saving'), net: sum('net'),
  };
  for (const key of Object.keys(t[0] ?? {})) out[key] = tsum(key);
  out.shareOfLoadedBill = out.billLoaded ? { specCost: out.specCost / out.billLoaded, saving: out.saving / out.billLoaded, net: out.net / out.billLoaded } : null;
  return out;
}

// The cost-model sessions file: calls and brevity messages from the session's first spec copy on.
export function teamSessions(team) {
  return team.map((r) => {
    const start = r.loadStart ?? 0;
    const ms = r.messages.filter((m) => m.counted && m.brevity && !m.failed && (m.callIndex ?? start) >= start);
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
  const valued = ['--project', '--since', '--until', '--saving-ratio', '--input', '--output', '--write-5m', '--write-1h', '--read', '--team-json'];
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
  return opts;
}

export async function run(argv, { cwd = process.cwd(), home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), count } = {}) {
  const o = parseArgs(argv);
  const tok = count ? { name: 'given', count } : await tokenizer();
  const prices = {
    input: o.input ?? PRICES.input, output: o.output ?? PRICES.output,
    write5m: o['write-5m'] ?? PRICES.write5m, write1h: o['write-1h'] ?? PRICES.write1h, read: o.read,
  };
  const ratio = o['saving-ratio'] ?? SAVING_RATIO;
  const root = join(home, 'projects');
  const dirs = o.project.length ? o.project.map((d) => resolve(cwd, d)) : defaultProjects(cwd, root);
  for (const d of dirs) if (!existsSync(d)) throw new Error(`no such folder: ${d}`);
  if (!dirs.length) throw new Error(`no Claude Code project folder for ${resolve(cwd)} under ${root}; name one with --project`);
  const sources = transcripts(dirs);
  const records = await meter(sources, { count: tok.count, prices, ratio, since: o.since, until: o.until });
  for (const r of records) {
    r.specCost = r.copyCost + r.skillCost;
    r.saving = r.messages.reduce((a, m) => a + m.saving, 0);
    r.net = r.saving - r.specCost;
    r.tally = tally(r);
    if (!o.titles) delete r.title;
  }
  const active = (r) => r.calls > 0 || r.tally.sentBrevity + r.tally.sentProse + r.tally.receivedBrevity + r.tally.receivedProse > 0;
  const team = records.filter((r) => r.kind === 'team' && active(r));
  const tests = records.filter((r) => r.kind === 'test' && active(r));
  const subagents = records.filter((r) => r.kind === 'subagent' && r.calls > 0);
  const models = {};
  for (const r of team) for (const [m, n] of Object.entries(r.models)) models[m] = (models[m] ?? 0) + n;
  const result = {
    tokenizer: tok.name,
    prices: { ...prices, read: prices.read ?? 'by model', readByModel: Object.fromEntries(Object.keys(models).map((m) => [m, readPrice(m, prices)])) },
    models,
    savingRatio: ratio,
    window: { since: o.since === undefined ? null : new Date(o.since).toISOString(), until: o.until === undefined ? null : new Date(o.until).toISOString() },
    folders: dirs.length,
    transcripts: { sessions: sources.filter((s) => s.kind === 'session').length, subagents: sources.filter((s) => s.kind === 'subagent').length },
    team: { sessions: team, total: summarize(team) },
    tests: { sessions: tests, total: summarize(tests) },
    subagents: { total: summarize(subagents) },
    duplicates: team.flatMap((r) => r.duplicates.map((d) => ({ session: r.id.slice(0, 8), ...d }))),
    titles: !!o.titles,
  };
  if (o['team-json']) {
    const rows = teamSessions(team);
    writeFileSync(resolve(cwd, o['team-json']), `${JSON.stringify(rows, null, 2)}\n`);
    const t = result.team.total;
    const brevityMsgs = team.flatMap((r) => r.messages.filter((m) => m.counted && m.brevity && !m.failed && [...SENT, ...RECEIVED].includes(m.dir)));
    const meanSaving = brevityMsgs.length ? brevityMsgs.reduce((a, m) => a + (m.tokens * ratio) / (1 - ratio), 0) / brevityMsgs.length : 0;
    const allCopies = team.flatMap((r) => r.copyTokens);
    const load = allCopies.length ? allCopies.reduce((a, c) => a + c.tokens, 0) / allCopies.length : 0;
    // The team's write price per token, weighted by what its calls wrote, and the read price of its busiest model.
    const w5 = team.reduce((a, r) => a + r.writes5m, 0);
    const w1h = team.reduce((a, r) => a + r.writes1h, 0);
    const w = w5 + w1h ? (w5 * prices.write5m + w1h * prices.write1h) / (w5 + w1h) : prices.write5m;
    const read = readPrice(Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0], prices);
    result.teamJson = {
      file: o['team-json'], rows: rows.length,
      compare: `node tools/cost-model.mjs ${o['team-json']} --saving ${+meanSaving.toFixed(1)} --load-tokens ${Math.round(load)} --write ${+w.toFixed(2)} --read ${read}`,
      measuredNet: t.net,
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

export function render(r) {
  const out = [];
  const p = r.prices;
  const reads = Object.entries(p.readByModel).map(([m, x]) => `${m} ${x} (${plural(r.models[m], 'call')})`).join(', ');
  out.push('brevity meter: what brevity cost and saved in these Claude Code sessions, in input-token equivalents');
  out.push(`prices: input ${p.input}, output ${p.output}, cache write ${p.write5m} (5-minute) or ${p.write1h} (1-hour), `
    + `cache read ${typeof p.read === 'number' ? `${p.read} (--read)` : reads || 'by model'}`);
  out.push(`tokenizer: ${r.tokenizer}${r.tokenizer === 'chars/4' ? ' (npm i -D @anthropic-ai/tokenizer for the legacy counts)' : ''}`);
  const win = r.window.since || r.window.until ? `calls from ${r.window.since ?? 'the start'} to ${r.window.until ?? 'the end'}` : 'all calls';
  out.push(`read: ${plural(r.transcripts.sessions, 'session transcript')} and ${plural(r.transcripts.subagents, 'subagent transcript')} `
    + `in ${plural(r.folders, 'folder')}; ${win}`);

  const t = r.team.total;
  out.push('', `team: ${plural(t.sessions, 'session')}`);
  if (t.sessions) {
    const head = ['session', ...(r.titles ? ['title'] : []), 'calls', 'bill', 'copies', 'spec cost', 'sent b/p', 'received b/p', 'msg tokens',
      'est. saving', 'net'];
    const row = (x, name, title) => {
      const m = x.tally ?? x;
      return [name, ...(r.titles ? [title ?? ''] : []), fmt(x.calls), fmt(x.bill), fmt(x.copies), fmt(x.specCost),
        `${m.sentBrevity}/${m.sentProse}`, `${m.receivedBrevity}/${m.receivedProse}`, fmt(m.messageTokens), fmt(x.saving), signed(x.net)];
    };
    out.push(table([head, ...r.team.sessions.map((s) => row(s, s.id.slice(0, 8), s.title)), row(t, 'total', '')], r.titles ? 2 : 1));
    out.push('b/p = brevity/prose. sent = SendMessage deliveries and delegation prompts; received = peer messages and delegation prompts.');
    if (t.billLoaded) {
      const s = t.shareOfLoadedBill;
      out.push(`with brevity loaded (each session from its first spec copy on): ${plural(t.callsLoaded, 'call')}, bill ${fmt(t.billLoaded)}; `
        + `spec cost ${pct(s.specCost)} of it, estimated saving ${pct(s.saving)}, net ${pct(s.net)}`);
    }
    out.push(`spec cost ${fmt(t.specCost)} = copies ${fmt(t.copyCost)} + skill entry ${fmt(t.skillCost)}; ${plural(t.rewrites, 'time')} a call `
      + `wrote a copy again after an idle cache miss or a rebuild (${fmt(t.rewriteCost)} of the cost)`);
    out.push(`messages: ${fmt(t.deliveredBrevity)} brevity and ${fmt(t.deliveredProse)} prose SendMessage deliveries, `
      + `${plural(t.failed, 'failed send')}, ${plural(t.delegations, 'delegation prompt')}; to and from subagents: `
      + `${plural(t.subagentPrompts, 'prompt')}, ${plural(t.handbacks, 'result')} (their savings are in est. saving)`);
    out.push(`est. saving is an estimate: no prose original exists, so each brevity message is taken to replace prose `
      + `${(1 / (1 - r.savingRatio)).toFixed(3)} times its length (--saving-ratio ${r.savingRatio}).`);
  }
  out.push('', r.duplicates.length ? 'duplicated spec copies (two or more in one context, issue #39):' : 'duplicated spec copies: none');
  for (const d of r.duplicates) {
    out.push(`  ${d.session}  ${d.copies} copies from ${d.from} to ${d.to}: ${plural(d.calls, 'call')}, extra cost ${fmt(d.extra)}`);
  }
  const line = (label, x, unit) => `${label}: ${plural(x.sessions, unit)}, ${plural(x.calls, 'call')}, bill ${fmt(x.bill)}, `
    + `${plural(x.copies, 'spec copy', 'spec copies')}, spec cost ${fmt(x.specCost)}`;
  out.push('', line('tests (claude -p), apart from the team', r.tests.total, 'session'));
  out.push(line('subagents, apart from the team', r.subagents.total, 'transcript'));
  if (r.teamJson) {
    out.push('', `wrote ${plural(r.teamJson.rows, 'session')} to ${r.teamJson.file}; to compare the cost model with this measurement `
      + `(net ${signed(r.teamJson.measuredNet)}), run:`, `  ${r.teamJson.compare}`);
  }
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const r = await run(process.argv.slice(2));
    console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
  } catch (e) {
    console.error(`error: ${e.message}`);
    console.error('usage: meter.mjs [--project dir]... [--since ISO] [--until ISO] [--saving-ratio r] [--titles] [--json] [--team-json file]; see the header of tools/meter.mjs');
    process.exit(2);
  }
}
