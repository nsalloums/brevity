# Related work

brevity is one of several attempts to make the messages agents exchange shorter or more structured. This page
lists the work we know of, grouped by kind: for each entry, what it does and how brevity's approach differs. It
compares approaches, not results. No numbers from these projects appear here: their tokenizers, corpora and
definitions of loss differ from brevity's, so figures side by side would mislead. Each entry was checked against
its primary source on 2026-09-30.

For reference, brevity is a written protocol ([SPEC.md](../SPEC.md)) plus a dictionary per project. The sending
agent writes each message itself, in terse English with fixed verbs after a plain first sentence, and any human or
model holding the spec and the dictionary can decode it.

## Agent-message formats and shorthands

- **[AgentSpeak](https://github.com/yuvalsuede/claude-teams-language-protocol)**: a shorthand for Claude Code
  agent teams, with Greek-letter status codes, action symbols, per-project file shortcodes and task references,
  loaded through `CLAUDE.md`.

  brevity also keeps project aliases in a file that sessions load, but writes requests, conditions and statuses as
  English keywords (`DO`, `IF`, `HOLD`), starts every message with a plain sentence, and lists the facts that must
  survive.
- **[caveman](https://github.com/juliusbrussee/caveman)**: a terse, telegraphic register for coding agents,
  installed as a skill that shortens what the agent writes, plus a local proxy that shortens tool output such as
  logs and diffs; code, paths and commands stay as written.

  brevity covers a different channel, the messages agent sessions send each other, and is a notation of typed
  statements that a reader expands back into full sentences, rather than a register.
- **[DRIXL](https://github.com/SamoTech/DRIXL)**: a protocol for multi-agent systems, with an envelope (recipient,
  sender, message type, priority), a fixed vocabulary of action verbs, and references to stored context by id, in
  a compact form and an XML form.

  brevity has no envelope, since the transport already names sender and recipient. Its verbs are coordination acts
  (request, prohibition, commitment, hold) rather than task actions, and it refers only to what both sides can
  see, such as pull request numbers, SHAs, paths and the public dictionary.
- **[CACP](https://github.com/zenprocess/cacp)** (Compressed Agent Communication Protocol): a line-based
  `FIELD:value` format for an orchestrator's dispatches to coding agents (`TASK`, `SCOPE`, `ACCEPTANCE`) and for
  their replies (`STATUS`, `FILES_MODIFIED`, `TESTS`), which the orchestrator parses.

  brevity is read by a model or a human rather than a parser, so each line is a free statement led by a verb, and
  it covers messages between peers as well as delegations and results.
- **[a2acompress](https://github.com/reh8n/a2acompress)**: a lossless wire format for JSON handed between agents
  (tool catalogs, messages, tool calls and results), with one-character keys, `$N` references to earlier values
  and back-references into the session; it decodes byte for byte.

  brevity rewrites prose, not JSON, and is not byte-exact: it keeps a listed set of decision-relevant facts and may
  drop framing, so its losslessness is checked by audit rather than by round trip.

## Research on agent communication

- **Telegraph English** ([arXiv:2605.04426](https://arxiv.org/abs/2605.04426), 2026): an LLM rewrites a prompt
  into a symbol-rich, formally structured dialect that stays readable, one atomic fact per line; the paper applies
  it to question answering.

  brevity's lines also hold one statement each, but its grammar is built for coordination (who asks, forbids,
  commits to or decides what, under which condition), and the sending agent writes it for another session rather
  than rewriting a prompt.
- **PACT** ([arXiv:2606.05304](https://arxiv.org/abs/2606.05304), 2026): in a multi-agent system, a sender-side
  projection turns each agent output into an action-state record (Action, State, Result) before it enters the
  shared history.

  brevity is a notation the sender writes, for sessions that already talk over their own channel, and it types
  each statement by speech act (request, prohibition, question, commitment, correction) rather than by action,
  state and result.
- **Lossless prompt compression via dictionary encoding**
  ([arXiv:2604.13066](https://arxiv.org/abs/2604.13066), 2026): frequent subsequences of repetitive input, such as
  logs, become meta-tokens, and a dictionary in the system prompt lets the model read them in context, without
  fine-tuning.

  brevity's dictionary also sits in the context, but it is written by hand for a project's names and routines
  (path prefixes, named rules), stays readable to a human, and never redefines an alias, so older messages still
  decode.
- **AutoForm** ([arXiv:2402.18439](https://arxiv.org/abs/2402.18439), 2024): LLMs choose a non-natural-language
  format, such as code or logical expressions, before reasoning or communicating with other agents.

  brevity fixes one public format in advance, so a human or a model that saw none of the earlier traffic can decode
  any message with the spec and the dictionary.
- **Agora** ([arXiv:2410.11905](https://arxiv.org/abs/2410.11905), 2024): a meta-protocol for networks of LLM
  agents, with natural language for rare exchanges, LLM-written routines for frequent ones, and plain-text
  protocol documents that agents agree on and identify by hash.

  brevity has one protocol, published before use and read by the model on every message; nothing is negotiated or
  compiled into code.
- **LatentMAS** ([arXiv:2511.20639](https://arxiv.org/abs/2511.20639), 2025): agents collaborate through
  last-layer hidden states and a shared latent working memory instead of text, without training.

  brevity stays in text so that a human can audit what agents told each other, and it needs no access to a model's
  internals.

## Prompt compression and transport

- **LLMLingua-2** ([arXiv:2403.12968](https://arxiv.org/abs/2403.12968), 2024;
  [code](https://github.com/microsoft/LLMLingua)): task-agnostic prompt compression cast as token classification,
  where a small encoder trained on data distilled from a larger LLM decides which tokens to keep.

  brevity is written by the sending model rather than cut from its text by a separate classifier, so it can
  rewrite and reorder, and it names the facts that must survive instead of scoring tokens.
- **[Agent Exchange (AX)](https://github.com/summationai/agent-exchange)**: local messaging between coding agents
  on one machine, such as Claude Code and Codex CLI, through a broker, a CLI and MCP tools; it defines delivery,
  not a message format.

  brevity is the other layer: a message format with no transport of its own, which can ride on AX or any other
  channel.

The quantitative comparison belongs to the public benchmark
([#26](https://github.com/nsalloums/brevity/issues/26)), where the baselines are measured on the same messages
under the same rubric.
