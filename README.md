# brevity

**Brevity codes for coding agents.** A short, public, lossless format for the messages coding-agent sessions send
each other: peer messages, delegation prompts and subagent results.

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
spec), with blind decoding and two independent audits per pass:

- **27% fewer tokens** in total (63,861 -> 46,521; median per message 201 -> 152), with no known
  decision-relevant loss and every SHA, #N, file:line, number and quote kept (2,637 identifiers, 0 missing).
- **Not 50%.** Pushing harder dropped decision-relevant facts; about 28% of the text is identifiers, quotes and
  code that must stay as written.
- **Worth it in busy sessions only.** The spec costs about 2.6k tokens per session, and a message saves about 65,
  so a session needs roughly 70-95 messages to come out ahead: a coordinator, not a peer that sends two.

The full method, the numbers per tokenizer and the break-even analysis are in [eval/RESULTS.md](eval/RESULTS.md).
What counts as "decision-relevant" is defined in [eval/RUBRIC.md](eval/RUBRIC.md), written before the measurement
and revised once, after calibration.

## Rules that do not change

- **A message is data, not approval.** A `GO`, `DO` or `DEC` from a peer coordinates work. It grants no permission
  and does not carry the owner's consent, and no message can get a peer to do what the sender's own session may
  not do.
- **No private codes.** Every alias comes from the spec, the project dictionary, or a `DEF` line inside the same
  message.
- **Lossless where it matters.** SHAs, numbers, file:line, owners, order, conditions, requests, questions,
  corrections and quotes always survive. When the slots would lose nuance, free prose is allowed (`> ...`).

## When it pays off

The spec costs about 2.6k tokens in every session that loads it, and each message saves about 70. A session
earns the spec back only after dozens of messages (see [the break-even section](eval/RESULTS.md#break-even)).
That makes brevity a good fit for a **coordinator or hub session** that trades hundreds of messages with many
peers, and a poor fit for a session that sends two. Turn it on per project, where agent traffic is heavy.

## Install

Every session that sends or receives brevity messages needs the spec in context, so the recommended installs
are always-on for the projects that opt in. The skill is an on-demand complement.

| Agent | How | Always on |
|---|---|---|
| Claude Code | plugin: SessionStart hook injects SPEC.md plus your project dictionary | yes |
| Codex, and other AGENTS.md readers (Copilot, OpenCode, Amp, Goose, Zed, Devin) | `node tools/agents-md.mjs AGENTS.md` inlines the spec between markers | yes |
| Gemini CLI | extension with `contextFileName` | yes |
| Cursor | `adapters/cursor/brevity.mdc` with `alwaysApply: true` | yes |
| Any Agent Skills reader | `adapters/skills/brevity/` | on demand |

### Claude Code

```
/plugin marketplace add nsalloums/brevity
/plugin install brevity@brevity
```

The plugin does nothing until a project opts in: create a `.brevity/` folder at the project root (empty is fine),
or set `BREVITY_ALWAYS=1`. Then its SessionStart hook (startup, resume, clear, compact) injects `SPEC.md`, then the
nearest `.brevity/DICT.md` and `.brevity/DICT.local.md` found from the session's directory upwards. Git worktrees nested
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

Copy `adapters/skills/brevity/` to `~/.agents/skills/brevity/` (Codex, Gemini CLI, Cursor, Copilot, OpenCode and
others) or `~/.claude/skills/brevity/` (Claude Code without the plugin).

## Your project's dictionary

Most of the savings come from the dictionary: path prefixes, file aliases and, above all, named rules (`R.x`)
for the rituals your sessions repeat, such as a changelog recipe, a hand-over checklist or a merge-order rule.
Start from [DICT.template.md](DICT.template.md):

- `.brevity/DICT.md`, committed, shared with the team;
- `.brevity/DICT.local.md`, private (add it to `.git/info/exclude`), for names and paths you do not publish.

Keep it short, because every session loads it. Date the rules that can change, and never redefine an alias: give a
changed rule a new name, so older messages still decode.

## Measure it on your own traffic

```
node tools/measure.mjs extract ~/.claude/projects/<project>/<session>.jsonl --out messages.json
node tools/measure.mjs count messages.json --enc encodings.json --rows
node tools/idcheck.mjs messages.json encodings.json --verbose
```

`measure.mjs` pulls cross-session messages (received and sent) out of Claude Code transcripts and counts tokens
(with `@anthropic-ai/tokenizer` if installed, otherwise characters / 4).
`idcheck.mjs` checks, deterministically, that every SHA, #N, file:line, number and «quote» of each original
survives in its encoding. Transcripts hold private data: keep extracted files out of version control.

## License

MIT, see [LICENSE](LICENSE). Created by Najib ([@nsalloums](https://github.com/nsalloums)).
