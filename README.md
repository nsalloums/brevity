# brevity

**Brevity codes for coding agents.** A short, public format for the messages coding-agent sessions send each
other: peer messages, delegation prompts and subagent results. Its goal is to lose no decision-relevant fact, and
keeping each one is the writer's job, not something the format guarantees: in a pilot where each message was
written once, about 15 of every 100 still lost one (see [Results](#results)).

Military and aviation radio use *brevity codes*: short words, documented in public manuals, that cut airtime without
losing meaning. brevity does the same for agent traffic. It is **compression, not encryption**: anyone holding
[SPEC.md](SPEC.md) and the project's dictionary can decode every message, so a human can still audit what their
agents told each other.

## What a message looks like

A coordinator's prose (synthetic example):

> Coordinator here, at the owner's request. Thanks for the update on #412! Unfortunately it can't take changelog
> entry 12 as I told you: #409 was recorded late, so #412 is now entry 13. Before I can hand the owner the
> merge command, please merge the base branch into fix/login-copy, and please don't edit the «## Unreleased»
> section. If you end up landing after #415, the header count goes from 7 to 9; otherwise #415's session will do
> the sum. Send me the head once CI is green and the PR is CLEAN. Thanks!

The same message in brevity:

```
#412 must take changelog entry 13, not 12, and needs the base merged in before the owner can merge it.
FIX entry 12 -> 13 (mine) by=coord; WHY #409 recorded late
DO merge base into fix/login-copy; NO edits to «## Unreleased»
IF you land after #415 THEN HDR count 7 -> 9 ELSE #415's session sums
REPLY head WHEN ci=green CLEAN
```

Line 1 is plain language, because it is often the only line a human sees in a preview. The body keeps every
identifier, number, owner, condition, request and prohibition, and drops the framing.

## Results

Measured on 268 real messages between Claude Code sessions (229 plus a 39-message holdout written after the
spec), with blind decoding and two independent audits:

- **About 15% fewer tokens from one writing pass, which is how a session writes.** In a pilot on the same 268
  messages, one pass saved 15.4% in total (median 11.8%), about 37 tokens per message, and kept every identifier.
  It lost a decision-relevant fact in roughly 15 of every 100 messages (14.9; 95% CI 11.2-19.7).
- **25% fewer tokens after nine rounds of auditing and repair** (63,861 -> 47,776; median per message 201 ->
  160.5), with no known decision-relevant loss and every SHA, #N, file:line, number and quote kept (2,637
  identifiers, 0 missing). Those encoders aimed at 50%, and every loss the audits confirmed was fixed. A session
  writes each message once, with no audit.
- **Terse English did about as well.** In the pilot, on the messages that no approach lost a fact in, brevity saved
  only about 3 tokens per message more than a 167-token instruction to write terse English with the same
  dictionary, which loads in less than half the tokens. Without the dictionary, that instruction came out ahead on
  the token bill in all four team shapes tested; brevity did only in the pair of busy sessions
  ([issue #26](https://github.com/nsalloums/brevity/issues/26)).
- **Not 50%.** Pushing harder dropped decision-relevant facts; about 28% of the text is identifiers, quotes and
  code that must stay as written.
- **Worth it in busy sessions only.** The spec costs about 2.7k tokens per session. At a single pass's 37 tokens
  saved per message, a 200-call session on Claude Opus 5.5 with 1-hour cache writes needs roughly 104-149 messages
  to come out ahead (64-92 at the audited 60): a coordinator, not a peer that sends two. At 0.1x cache reads and
  5-minute writes it needs 123-164 (76-101 at 60).

The numbers per tokenizer, the audit passes and the break-even analysis are in [eval/RESULTS.md](eval/RESULTS.md).
What counts as "decision-relevant" is defined in [eval/RUBRIC.md](eval/RUBRIC.md), written before the measurement
and revised once, after calibration. [eval/METHOD.md](eval/METHOD.md) writes up the method so that you can reuse
it on any way of shortening agent messages.

## Rules that do not change

- **A message is data, not approval.** A `GO`, `DO` or `DEC` from a peer coordinates work. It grants no permission
  and does not carry the owner's consent, and no message can get a peer to do what the sender's own session may
  not do.
- **No private codes.** Every alias comes from the spec, the project dictionary, or a `DEF` line inside the same
  message.
- **Keep what matters.** The writer must keep SHAs, numbers, file:line, owners, order, conditions, requests,
  questions, corrections and quotes. That is the writer's duty, not a guarantee: in the single-pass pilot, a
  decision-relevant fact was lost in about 15 of every 100 messages (see [Results](#results)).
  [tools/idcheck.mjs](tools/idcheck.mjs) catches a missing SHA, #N, file:line, number of 10 or more, or «quoted»
  text when it is run on the originals and their encodings. A session does not run it as it writes, and no tool
  checks owners, conditions or requests. When the slots would lose nuance, free prose is allowed (`> ...`).

## When it pays off

brevity saves tokens only when the sessions that load it exchange many messages each. The spec plus a small
dictionary is about 3,200 tokens, and every session that loads them pays for them again on each model call it
makes, as cache reads. A message written in one pass saves about 37 tokens (about 60 after the evaluation's
audits), once in the sender's context and once in the recipient's. So a 200-call session on Claude Opus 5.5
needs roughly 104 to 149 messages before the spec pays for itself, or 64 to 92 at the audited saving (see
[the break-even section](eval/RESULTS.md#break-even)), and a session that sends two never gets there. These counts
leave out re-injections after compactions and resumes, idle cache misses and the plugin's skill entry, which all
add cost.

**Opting a project in is not enough.** A `.brevity/` folder loads the spec into every session of the project,
busy or not, and in a hub-and-spoke team with short-lived peers that loses tokens overall. Take a synthetic team
shaped like the evaluated one: a hub with 2,000 model calls and 268 messages, and 80 peers with 150 calls and 1 to
14 messages each (median 2). Its net, in input-token equivalents at Claude Opus 5.5's prices:

| how the spec loads | net for the team |
|---|---|
| every session, from its start (a `.brevity/` folder) | -1,781,540 |
| each session at its first message (the skill, on demand) | -1,272,802 |
| the hub from its start, the peers at their first message | -1,259,916 |
| the hub from its start; the peers a 300-token card that only reads (modeled, not in brevity) | -12,041 |

The hub gains about 0.54 million, but each peer loses 24,000 to 30,000, because it carries the spec on every call
to save on a handful of messages. For this team, not using brevity beats every way brevity can load today. The
cost model finds that a read-only reader card of about 210 to 280 tokens would keep the team ahead: up to 276
tokens under its default assumptions, and up to 209 if each peer's first message arrives at its first call. The
300-token card in the table is past that limit; it would come out ahead only with 5-minute cache writes, with no
stub, or as a card that also writes. The
plugin's skill entry and one re-injection per session lower the limit to 163 tokens. That is a modeled result
under the assumptions the tool prints, not a shipped feature; brevity has no reader card, and
[issue #11](https://github.com/nsalloums/brevity/issues/11) tracks the design. All of these figures use the audited
60 tokens per message. At a single pass's 37, every policy in the table loses tokens, and no reader card keeps this
team ahead, even one of 0 tokens.

Opt a project in only when every session in it will be busy, such as a coordinator and a few long-lived sessions
that trade hundreds of messages, and check your own team with [tools/cost-model.mjs](tools/cost-model.mjs) first.
[docs/costs.md](docs/costs.md) explains the cost model with its sources, and works through three team shapes: two
busy sessions, a hub with short-lived peers, and an orchestrator with fan-out subagents.

### Model it for your team

[tools/cost-model.mjs](tools/cost-model.mjs) works this out for your own sessions. List each one with the model
calls it makes and the messages it sends and receives, and optionally `first`, the call at which its first message
arrives (0 for a subagent that a delegation prompt starts):

```json
[
  { "name": "coordinator", "turns": 1500, "sent": 60, "received": 52 },
  { "name": "api", "turns": 400, "sent": 30, "received": 34 },
  { "name": "docs", "turns": 80, "sent": 2, "received": 6 }
]
```

```
node tools/cost-model.mjs sessions.json --saving 60 --reader-tokens 300
node tools/cost-model.mjs sessions.json --messages messages.json --enc encodings.json --rows
node tools/cost-model.mjs docs/teams/hub.json --saving 60 --load-tokens 3200 --reader-tokens 300
```

The third line reproduces the table above from [docs/teams/hub.json](docs/teams/hub.json). The tool prints the
tokens each session and the whole team save or lose, in input-token equivalents at Anthropic's prices. Output is
5x an input token, and a cache write 2x, the 1-hour rate that Claude Code paid for every write measured in issue #11
(`--write 1.25` for 5-minute caching). A cache read depends on `--model`: 0.05x on `claude-opus-5-5`, the default
and the model of those measured calls, 0.025x on `claude-fable-5-1` and `claude-mythos-5-1`, and 0.1x on other
models. `--output`, `--write` and `--read` override each price, and the output says which prices ran. It compares
four policies: every session loads the spec, only hubs load it, each session loads it at its first message,
and hubs always with the others at their first message. `--reader-tokens N` adds a fifth: hubs load the spec, and
the other sessions load a reader card of N tokens that only decodes, and the output gives the largest card that
would keep the team ahead. It also prints each session's break-even message count. The spec and your `.brevity/`
dictionaries are counted from the files unless you pass `--load-tokens`, and the assumptions, such as when messages
arrive, who writes to whom and a warm cache, are printed with the results. `--rows` lists what each row of the
spec's verb table costs and, with your encodings, how often your traffic uses it; rarely used rows are flagged, not
removed. The saving per message comes from `--saving`, or from your own messages and encodings (see
[Measure it on your own traffic](#measure-it-on-your-own-traffic)).

By default the model leaves out three costs, and options add them. Re-injection: the hook loads the spec again
after each compaction and resume, as `--reinject N` extra copies per session or one every `--reinject-every N`
calls. Idle cache misses: `--idle-misses R`, the share of calls that follow one. The plugin's entry in every
session's skill listing: `--skill-entry 143`. Their defaults add nothing. For a team that already runs,
[tools/meter.mjs](tools/meter.mjs) measures these costs from its transcripts, so use it rather than guessing the
rates.

### Measure your own team

[tools/meter.mjs](tools/meter.mjs) measures what brevity actually cost and saved in your sessions, from the
transcripts Claude Code keeps on your machine. Run it from your project's folder:

```
node /path/to/brevity/tools/meter.mjs
```

It prints a table with one row per session: its arm, its model calls, its bill in input-token equivalents, the
copies that the hook injected, and their load cost. That cost is priced call by call, so it includes copies written
again after an idle cache miss, re-injections after a compaction, and duplicates after a resume. The row also gives
the messages the session sent and received, by style (brevity, lite, terse or prose), their tokens, the estimated
saving and the net. Below the table come the team's shares of the bill, how often and at what cost copies were
written again, a summary per arm (sessions, calls, bill, load cost, messages, estimated saving, net and their shares
of the bill), and each run of duplicated copies; `--json` adds each session's drops by compaction and resume.

The saving is an estimate, because a real message has no prose original to compare with. Each arm's ratio comes
from the single-pass pilot: brevity 0.154, lite 0.087 and terse 0.102. Messages written under off save nothing, and
`--saving-ratio` replaces the other three. `--team-json team.json` writes your sessions in the cost model's format,
and the output gives the command that compares the model with the measurement.

Cost alone favours the smallest load, so the meter also counts three quality signals, per arm and for the team: the
count and the rate per 100 delivered SendMessage messages. They are heuristics, read from the text of the messages
and the replies around them. They miss some cases and flag others wrongly, so treat them as pointers to check by
hand, not as a measure of loss. The rules were tuned on this project's own transcripts. On those, as of 2026-10-10,
4 of the 5 corrections they flag are real (2 fix a mistake, 2 update an instruction; the fifth only uses the word),
and they flag no clarification. That is an in-sample check, not a validation: nothing has measured them on other
traffic yet. A delivered message is:

- **clarified** when the recipient's next message to the sender, sent within its next 5 calls
  (`--clarify-window`), asks about it. That reply asks a question with "did you mean", "which one", "unclear" or
  "clarify", or a question that names something from the message (a `#N`, a SHA, a path, a file, a flag, a tag or a
  quoted span). A question that asks leave for the recipient's own next step, such as "May I add x?", does not count.
- **corrected** when the sender's next message to the same recipient corrects or retracts something it sent:
  "correction", "I was wrong", a `FIX` line, or `-> WITHDRAWN`. An updated instruction counts too.
- **resent** when the sender sends almost the same text to the same recipient again (a similarity of 0.8 or more)
  without a reply in between.

The meter matches each message to its recipient by the `msg_id` that both transcripts log, else by its text. When
two sessions sent the same text, it uses the sender's name, and if that stays ambiguous the message flags nothing.
It matches a reply to its addressee by name. A failed send never counts.

Delegation prompts (`spawn_task`) get the same three signals in a table of their own, per arm and for the team, so
that the SendMessage rates stay comparable. They are heuristics too. A prompt starts the session whose first message
it is, and that session is also known by the prompt's title. When the same text was spawned more than once, each
session takes the newest such prompt sent before it that no earlier session took. A `spawn_task` whose result is an
error counts as a failed send, not as a prompt. Rates are per 100 delivered prompts, and `started` counts the
prompts whose session the meter read: only those can be clarified or corrected. A prompt is:

- **clarified** when one of the started session's first messages back to the sender, sent before the sender writes
  to it again, asks about the prompt. No call window applies, because a new session reads before it writes.
- **corrected** when the sender's next message to that session corrects or retracts something it sent.
- **resent** when the sender spawns almost the same prompt again (a similarity of 0.8 or more).

On this project's transcripts, as of 2026-10-11, 19 prompts all started a measured session, and the rules flagged
1 clarification, no correction and no re-send. Nobody has checked those flags by hand yet.

The exact rules are in the header of [tools/meter.mjs](tools/meter.mjs). Like the rest of the output, the signals are
numbers only: the meter never prints message text, and prints session titles only with `--titles`.

Token counts use `@anthropic-ai/tokenizer` when it is installed in the brevity checkout that holds the meter, else
chars/4, and the output says which. Set `BREVITY_METER_TOKENIZER=chars/4` to use chars/4 even when the tokenizer is installed, for example
to compare with a run on a machine without it. The meter's tests set it, so they pass either way.

## Where it works

| Surface | What loads |
|---|---|
| Claude Code (terminal, IDE extensions, desktop Code tab) | the session hook, in projects that opt in (below), and the `brevity` skill |
| Cowork | the `brevity` skill; the hook also loads there, and needs Node.js and a `.brevity/` folder in the task's folder (not yet tested) |
| Chat (claude.ai on the web, desktop and mobile) | the `brevity` skill only: hooks do not run in chat |
| Codex, Gemini CLI, Cursor and other AGENTS.md readers | the spec, through the adapters under [Install](#install) |

The skill runs when you ask for brevity by name, or when a message you received uses brevity. The hook puts the
spec and your project's dictionary into every session of a project that opts in, so every session can read and
write brevity without being asked.

## Install

| Agent | How | Always on |
|---|---|---|
| Claude Code | plugin: a SessionStart hook injects SPEC.md plus your project dictionary; the skill works on request | yes, in projects that opt in |
| Codex, and other AGENTS.md readers (Copilot, OpenCode, Amp, Goose, Zed, Devin) | `node tools/agents-md.mjs AGENTS.md` inlines the spec between markers | yes |
| Gemini CLI | extension with `contextFileName` | yes |
| Cursor | `adapters/cursor/brevity.mdc` with `alwaysApply: true` | yes |
| Any Agent Skills reader | `skills/brevity/` | on demand |

### Claude Code

```
/plugin marketplace add nsalloums/brevity
/plugin install brevity@brevity
```

The hook needs **Node.js 16.6 or later** on your `PATH`. The skill needs nothing.

The hook does nothing until a project opts in: create a `.brevity/` folder at the project root (empty is fine), or
set `BREVITY_ALWAYS=1`. Then, on startup, resume, fork, `/clear` and compaction, it injects `SPEC.md`, then the
nearest `.brevity/DICT.md` and `.brevity/DICT.local.md` found from the session's directory upwards. Git worktrees
nested inside the main clone therefore pick up the main clone's dictionary. `BREVITY_DICT` can name extra files. On a
resume, the hook injects the current copy, and Claude Code itself keeps only the injected items whose text changed
(observed on real resumes, not documented by Claude Code). A second copy therefore appears only when the copy's
content changed, such as after a plugin update or a dictionary edit, which is what the session should load.

**Choose what the hook loads.** To compare approaches on your own work, an opted-in project can load lighter
instructions than the spec, and [tools/meter.mjs](tools/meter.mjs) reports each one apart. Write one word in
`.brevity/arm`, found the way the dictionaries are, or set `BREVITY_ARM`, which wins over the file:

| arm | what each session loads | tokens loaded | single-pass pilot: saving, messages with a lost fact per 100 |
|---|---|---|---|
| `brevity`, the default | `SPEC.md` and your dictionaries | 2,698, plus the dictionaries | 15.4%, 14.9 (with the evaluation's dictionary) |
| `lite` | [arms/lite.md](arms/lite.md): the spec's KEEP rules in plain terse English, without dictionaries | 348 | 8.7%, 3.0 |
| `terse` | [arms/terse.md](arms/terse.md): one paragraph asking for terse English | 176 | 10.2%, 7.1 |
| `off` | the marker line alone | 8 | nothing to measure |

- **Counts.** Tokens are counted with the legacy tokenizer, `@anthropic-ai/tokenizer`, marker included. The pilot
  figures come from [issue #26](https://github.com/nsalloums/brevity/issues/26): one writing pass on one private
  corpus, with the limits listed there.
- **The marker.** Every injection starts with `<!-- brevity arm: <arm> -->`, which the meter reads.
- **Defaults.** With no value, the hook loads `brevity`. With a value it does not know, it loads `brevity` and adds a
  line that says so.
- **Mixing arms.** lite and terse messages use no aliases or notation, so any session can read them. A session under
  lite, terse or off has no spec, so it may misread a brevity message from a session under brevity.

Without the plugin, add `@/path/to/brevity/SPEC.md` to your `~/.claude/CLAUDE.md` or the project's `CLAUDE.md`.

### Codex and other AGENTS.md readers

AGENTS.md cannot import other files, so the spec is inlined:

```
node tools/agents-md.mjs ~/.codex/AGENTS.md
node tools/agents-md.mjs path/to/project/AGENTS.md --dict path/to/project/.brevity/DICT.md
```

Re-running replaces the block; `--remove` deletes it.

### Gemini CLI

```
gemini extensions install https://github.com/nsalloums/brevity
```

### Cursor

Copy `adapters/cursor/brevity.mdc` to `.cursor/rules/brevity.mdc` in your project.

### Agent Skill

Copy `skills/brevity/` to `~/.agents/skills/brevity/` (Codex, Gemini CLI, Cursor, Copilot, OpenCode and others) or
`~/.claude/skills/brevity/` (Claude Code without the plugin).

## What the plugin runs, reads and sends

- **The hook.** On session start, resume, fork, `/clear` and compaction, Claude Code runs
  `node "${CLAUDE_PLUGIN_ROOT}/hooks/inject.mjs" <k>` four times (k = 0 to 3), because each hook's output is capped
  at 10,000 characters. Each run reads the hook input that Claude Code passes on stdin, for the session's directory.
  It looks for each `.brevity/` path it uses (the folder, and the files listed below) in the session's directory and
  then each parent directory up to the filesystem root; if none has it, in `CLAUDE_PROJECT_DIR` and its parents; then
  in the hook's working directory and its parents. It takes the first it finds. Each run exits at once, with no
  output, unless a `.brevity/` folder is found that way or `BREVITY_ALWAYS=1` is set. A `.brevity/` folder in a
  parent directory, such as your home folder, therefore opts in every project below it.
- **What the hook reads** when a project opts in:
  - the arm, from `BREVITY_ARM`, else from `.brevity/arm`;
  - for the `brevity` arm, the plugin's own `SPEC.md`, `.brevity/DICT.md` and `.brevity/DICT.local.md`, and any
    files named in `BREVITY_DICT`;
  - for the `lite` and `terse` arms, the plugin's own `arms/lite.md` or `arms/terse.md`;
  - the environment variables `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, `BREVITY_ALWAYS`, `BREVITY_DICT` and
    `BREVITY_ARM`.

  It prints the arm's marker and files as context for the session, in parts under the cap, on every session start,
  resume, fork, `/clear` and compaction.
- **What it never does.** No network requests, no file writes, no other files or variables read.
- **The skill.** Claude reads `skills/brevity/SKILL.md` and `SPEC.md` from the plugin and, when they exist, the
  project's `.brevity/` dictionaries.
- **The tools** in `tools/` are standalone scripts that the plugin never runs. They read only the files you pass
  them, with two exceptions. `tools/cost-model.mjs` also counts the tokens of the plugin's `SPEC.md` and of the
  nearest `.brevity/DICT.md` and `.brevity/DICT.local.md`, unless you pass `--load-tokens`. `tools/meter.mjs` reads
  your Claude Code transcripts: the `.jsonl` files under `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects/`)
  for the current directory and its worktrees, or the folders you name with `--project`. It only reads them, on your
  machine, with no network. It prints numbers, times and 8-character session ids, also with `--json`; full session
  ids, session titles and each message's time only with `--titles`. The only file it writes is the one you name with
  `--team-json`.
- **Privacy.** brevity has no server and collects, stores and sends no data. What it loads goes into your Claude
  session like any other context, under your Claude plan's own data terms.
- **Trust.** A repository's `.brevity/DICT.md` enters Claude's context the way its `CLAUDE.md` does. Read it before
  you opt in on a project you do not trust.

## Try it

These run as written. For the third, start Claude Code in a folder set up as described under
[For reviewers](#for-reviewers).

1. **Encode** (any surface). Ask: *Rewrite this for another agent session in brevity: "Hi! Quick update: PR #41 is
   merged into main as 7c1e9a4b2. Please rebase your branch fix/cart-total onto main and don't touch
   docs/CHANGELOG.md, I'm editing it. Send me your head SHA once CI is green. Thanks!"*
   You get a plain first line and then lines such as `MERGED #41 7c1e9a4b2`, `DO rebase fix/cart-total onto main`,
   `NO edits to docs/CHANGELOG.md` and `REPLY head WHEN ci=green`.
2. **Decode** (any surface). Ask *Decode this brevity message and tell me what I have to do*, followed by:

   ```
   #57 must wait for #55, then take changelog entry 12.
   HOLD merge of #57 UNTIL #55 lands
   FIX entry 11 -> 12 (mine)
   IF CI fails THEN REPLY failing check WHEN now ELSE REPLY head WHEN ci=green CLEAN
   ```

   You get a plain-English list: #57 is not merged until #55 is; the sender corrects its own earlier entry number
   from 11 to 12; if CI fails, send the failing check right away, and otherwise send the head once CI is green and
   the PR has no conflicts.
3. **Session context** (Claude Code, opted-in project). Ask *Which brevity dictionary is loaded, and what does
   R.ready mean?* Claude answers without opening any file: `.brevity/DICT.md` for the synthetic "acme-shop"
   project, and R.ready expanded in full (head pushed, check «ui: build + test» passing, open, not draft, CLEAN,
   contains current main, the owner merges with `gh pr merge N --squash`).

### For reviewers

1. Create an empty folder, create `.brevity/` inside it, and copy [DICT.template.md](DICT.template.md) to
   `.brevity/DICT.md`.
2. With Node.js on your `PATH`, start Claude Code in that folder and accept the folder trust prompt.
3. Run the three prompts above. `/hooks` lists the four SessionStart entries, and the first answer to prompt 3
   comes without any file being opened.

## Troubleshooting

- **Nothing is injected in Claude Code.** The project has not opted in: create a `.brevity/` folder at or above
  the session's directory, or set `BREVITY_ALWAYS=1`, then start a new session. Ask Claude whether the brevity spec
  is in its context to check.
- **Four "SessionStart hook error" notices at every session start.** Node.js is not on your `PATH`, and the hook
  runs `node`. Install Node.js 16.6 or later, or disable the plugin in `/plugin`. The skill works without Node.js.
- **"more parts did not fit the 4 hook slots".** Your dictionaries are too long to inject. Shorten them.
- **"unknown arm".** `.brevity/arm` or `BREVITY_ARM` holds a word other than `brevity`, `lite`, `terse` or `off`, so
  the hook loaded `brevity`. Fix the word, then start a new session.
- **In chat, messages that use dictionary aliases do not decode.** Chat has no project folder, so it has no
  dictionary. Paste the dictionary into the conversation, or ask the sender to spell the aliases out.
- **The skill reads SPEC.md again although the hook loaded it.** This is harmless: the skill is told to use the copy
  that is already in context.

## Your project's dictionary

Most of the savings come from the dictionary: path prefixes, file aliases and, above all, named rules (`R.x`) for
the rituals your sessions repeat, such as a changelog recipe, a hand-over checklist or a merge-order rule. Start
from [DICT.template.md](DICT.template.md):

- `.brevity/DICT.md`, committed, shared with the team;
- `.brevity/DICT.local.md`, private (add it to `.git/info/exclude`), for names and paths you do not publish. It is
  still sent to Claude as context, like any other file Claude reads.

Keep it short, because every session loads it. Date the rules that can change, and never redefine an alias: give a
changed rule a new name, so older messages still decode.

## Measure it on your own traffic

```
node tools/measure.mjs count messages.json --enc encodings.json --rows
node tools/idcheck.mjs messages.json encodings.json --verbose
```

Build `messages.json` yourself, from messages you are allowed to use, as `[{"id": "m001", "text": "..."}]`, and
write their encodings as `[{"id": "m001", "enc": "..."}]`. `measure.mjs` counts tokens before and after (with
`@anthropic-ai/tokenizer` if it is installed, otherwise characters / 4). `idcheck.mjs` checks, deterministically,
that every SHA, #N, file:line, number and «quote» of each original survives in its encoding. Keep real messages
out of version control.

To check that each fact still arrives, and to compare approaches on the same messages, follow
[eval/METHOD.md](eval/METHOD.md).

Other formats, research and tools for agent messages, and how brevity's approach differs from each, are listed in
[eval/RELATED.md](eval/RELATED.md).

## Releases

Each release states its criticality, why it exists and the evidence behind it: see [CHANGELOG.md](CHANGELOG.md)
and [RELEASING.md](RELEASING.md). Every commit on `main` is a release.

## Support and security

- Questions, bugs and proposals: [GitHub issues](https://github.com/nsalloums/brevity/issues).
- Security problems: report them privately from the repository's **Security** tab (**Report a vulnerability**). See
  [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). Created by Najib ([@nsalloums](https://github.com/nsalloums)).
