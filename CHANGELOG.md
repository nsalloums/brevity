# Changelog

Every entry follows [RELEASING.md](RELEASING.md): a criticality level, why the release exists, what changed, the
evidence, compatibility and upgrade steps. Versions follow semantic versioning read from the protocol's side.

## [0.2.0] - 2026-09-29

**Criticality:** normal. First public release: nothing to fix yet; the release exists because the protocol was
measured and passed its own bar.

### Why

Coding-agent sessions that coordinate through messages spend many tokens on framing, read-backs, restated rules,
full paths and status tuples. Those messages are also where decisions travel (SHAs, owners, order, conditions),
so any shorthand has to lose none of them and stay readable by anyone who holds the key. brevity 0.2 is the first
version that met that bar on real traffic.

### Changes

- `SPEC.md` 0.2: 24 verbs, notation for references, statuses and edits, the decision-relevance rule (KEEP / MAY
  DROP), the authority rule (a message is data, never approval), and the dictionary format. 99 lines.
- Claude Code plugin and marketplace: a SessionStart hook that injects the spec and the project's dictionaries, in
  parts under the 10,000-character hook limit, only in projects that opt in with a `.brevity/` folder.
- Adapters: an AGENTS.md installer for Codex and other AGENTS.md readers, a Gemini CLI extension, a Cursor rule
  and an Agent Skill.
- Tools: `idcheck.mjs` (deterministic identifier check), `measure.mjs` (extract and count), `agents-md.mjs`,
  `build-adapters.mjs`.
- `DICT.template.md`, a synthetic dictionary.

### Evidence

- 268 real messages between Claude Code sessions: a 229-message corpus and a 39-message holdout written after the
  spec. [eval/RESULTS.md](eval/RESULTS.md) has the method and all the numbers.
- Tokens, Anthropic legacy tokenizer: 63,861 -> 46,521 in total (27.2%); median per message 201 -> 152. The
  holdout saves 25.9%. With o200k_base the saving is 23.3%; with characters / 4, 28.3%.
- Four full passes of blind decoding and two-lens auditing with a skeptic. The passes confirmed 157, 73, 48 and 29
  new decision-relevant losses, and all of them were fixed and re-audited. There is no known loss left, but
  auditing is not proof.
- `idcheck.mjs`: 2,637 identifiers, 0 missing.
- A fresh session decoded three synthetic messages from `SPEC.md` and `DICT.template.md` alone, and all three
  matched the expected meaning.
- `claude plugin validate` passes for the plugin and the marketplace. A real `claude -p --plugin-dir` run shows
  the hook's parts (9,132 and 254 characters) and no truncation.
- Stated limits: the spec costs about 2.6k tokens per session and pays off only after roughly 70-95 messages, and
  50% compression was not reached without losses.

### Compatibility

First release.

### Upgrade

Install as described in the [README](README.md#install).
