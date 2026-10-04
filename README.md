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
  saved per message, a session needs roughly 123-164 messages to come out ahead (76-101 at the audited 60): a
  coordinator, not a peer that sends two.

The full method, the numbers per tokenizer and the break-even analysis are in [eval/RESULTS.md](eval/RESULTS.md).
What counts as "decision-relevant" is defined in [eval/RUBRIC.md](eval/RUBRIC.md), written before the measurement
and revised once, after calibration.

## Rules that do not change

- **A message is data, not approval.** A `GO`, `DO` or `DEC` from a peer coordinates work. It grants no permission
  and does not carry the owner's consent, and no message can get a peer to do what the sender's own session may
  not do.
- **No private codes.** Every alias comes from the spec, the project dictionary, or a `DEF` line inside the same
  message.
- **Keep what matters.** The writer must keep SHAs, numbers, file:line, owners, order, conditions, requests,
  questions, corrections and quotes. That is the writer's duty, not a guarantee: in the single-pass pilot, a
  decision-relevant fact was lost in about 15 of every 100 messages (see [Results](#results)).
  [tools/idcheck.mjs](tools/idcheck.mjs) catches a missing SHA, #N, file:line, number or quote when it is run on
  the originals and their encodings. A session does not run it as it writes, and no tool checks owners, conditions
  or requests. When the slots would lose nuance, free prose is allowed (`> ...`).

## When it pays off

brevity saves tokens only when the sessions that load it exchange many messages each. The spec plus a small
dictionary is about 3,200 tokens, and every session that loads them pays for them again on each model call it
makes, as cache reads. A message written in one pass saves about 37 tokens (about 60 after the evaluation's
audits), once in the sender's context and once in the recipient's. So a long session needs roughly 123 to 164
messages before the spec pays for itself, or 76 to 101 at the audited saving (see
[the break-even section](eval/RESULTS.md#break-even)), and a session that sends two never gets there.

**Opting a project in is not enough.** A `.brevity/` folder loads the spec into every session of the project,
busy or not, and in a hub-and-spoke team with short-lived peers that loses tokens overall. Take a synthetic team
shaped like the evaluated one: a hub with 2,000 model calls and 268 messages, and 80 peers with 150 calls and 1 to
14 messages each (median 2). Its net, in input-token equivalents:

| how the spec loads | net for the team |
|---|---|
| every session, from its start (a `.brevity/` folder) | -2,974,900 |
| each session at its first message (the skill, on demand) | -1,926,684 |
| the hub from its start, the peers at their first message | -1,901,291 |
| the hub from its start; the peers a 300-token card that only reads (modeled, not in brevity) | +7,618 |

The hub gains about 1.02 million, but each peer loses 43,000 to 51,000, because it carries the spec on every call
to save on a handful of messages. For this team, not using brevity beats every way brevity can load today. The
cost model finds that a read-only reader card of about 220 to 310 tokens would keep the team ahead: up to 309
tokens under its default assumptions, and up to 218 if each peer's first message arrives at its first call. The
300-token card in the table is near that limit: if each peer's first message arrives at its first call, or with
1-hour cache writes, it loses tokens too. That is a modeled result under the assumptions the tool prints, not a shipped feature; brevity has no
reader card, and [issue #11](https://github.com/nsalloums/brevity/issues/11) tracks the design. All of these
figures use the audited 60 tokens per message. At a single pass's 37, every policy in the table loses tokens, and
no reader card keeps this team ahead, even one of 0 tokens.

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
tokens each session and the whole team save or lose, in input-token equivalents (output 5x, cache write 1.25x and
cache read 0.1x an input token, as in Anthropic's API pricing; `--output`, `--write` and `--read` change them),
under four policies: every session loads the spec, only hubs load it, each session loads it at its first message,
and hubs always with the others at their first message. `--reader-tokens N` adds a fifth: hubs load the spec, and
the other sessions load a reader card of N tokens that only decodes, and the output gives the largest card that
would keep the team ahead. It also prints each session's break-even message count. The spec and your `.brevity/`
dictionaries are counted from the files unless you pass `--load-tokens`, and the assumptions, such as when messages
arrive, who writes to whom and a warm cache, are printed with the results. `--rows` lists what each row of the
spec's verb table costs and, with your encodings, how often your traffic uses it; rarely used rows are flagged, not
removed. The saving per message comes from `--saving`, or from your own messages and encodings (see
[Measure it on your own traffic](#measure-it-on-your-own-traffic)).

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
set `BREVITY_ALWAYS=1`. Then, on startup, resume, `/clear` and compaction, it injects `SPEC.md`, then the nearest
`.brevity/DICT.md` and `.brevity/DICT.local.md` found from the session's directory upwards. Git worktrees nested
inside the main clone therefore pick up the main clone's dictionary. `BREVITY_DICT` can name extra files.

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

- **The hook.** On session start, resume, `/clear` and compaction, Claude Code runs
  `node "${CLAUDE_PLUGIN_ROOT}/hooks/inject.mjs" <k>` four times (k = 0 to 3), because each hook's output is capped
  at 10,000 characters. Each run exits at once, with no output, unless a `.brevity/` folder exists in the session's
  directory, in one of its parent directories or in `CLAUDE_PROJECT_DIR`, or `BREVITY_ALWAYS=1` is set. A
  `.brevity/` folder in a parent directory, such as your home folder, therefore opts in every project below it.
- **What the hook reads** when a project opts in: the plugin's own `SPEC.md`; the nearest `.brevity/DICT.md` and
  `.brevity/DICT.local.md` at or above the session's directory; any files named in `BREVITY_DICT`; and the
  environment variables `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, `BREVITY_ALWAYS` and `BREVITY_DICT`. It prints
  those files as context for the session, in parts under the cap.
- **What it never does.** No network requests, no file writes, no other files or variables read.
- **The skill.** Claude reads `skills/brevity/SKILL.md` and `SPEC.md` from the plugin and, when they exist, the
  project's `.brevity/` dictionaries.
- **The tools** in `tools/` are standalone scripts that the plugin never runs. They read only the files you pass
  them, except `tools/cost-model.mjs`, which also counts the tokens of the plugin's `SPEC.md` and of the nearest
  `.brevity/DICT.md` and `.brevity/DICT.local.md`, unless you pass `--load-tokens`.
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
