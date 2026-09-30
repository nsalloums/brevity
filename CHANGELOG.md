# Changelog

Every entry follows [RELEASING.md](RELEASING.md): a criticality level, why the release exists, what changed, the
evidence, compatibility and upgrade steps. Versions follow semantic versioning read from the protocol's side.

## [Unreleased]

Changes waiting on `next` for the next release (see [RELEASING.md](RELEASING.md)).

- **#5, low.** `tools/build-adapters.mjs` now compares and writes LF, so a Windows checkout with CRLF line endings
  (`core.autocrlf=true`) no longer reports the adapters as stale. Evidence:
  - With `SPEC.md` and both adapters checked out as CRLF, `--check` failed with
    `stale: adapters/cursor/brevity.mdc` before the fix, and passes after it.
  - Write mode leaves the files alone.
  - An LF checkout still passes, and a real change to `SPEC.md` is still reported as stale.
  - `scripts/release-check.mjs` also reads files as LF, so sizes and comparisons match what git stores.
- **#11, normal.** New `tools/cost-model.mjs` shows whether the spec saves tokens for a team, and where to load it:
  the net per session and for the team under four loading policies, the break-even message count, and, with
  `--rows`, each verb-table row's cost and use. `--reader-tokens N` models hubs with the full spec and a reader
  card of N tokens elsewhere (#23). It reproduces eval/RESULTS.md's break-even (68 to 91 messages at
  3,100 tokens and 200 calls); tests: `node tools/cost-model.test.mjs`.
- **#21, low.** The README links to the new `eval/RELATED.md`, which lists related formats, research and tools
  for agent messages, each checked against its primary source, and how brevity's approach differs from each.

## [0.3.0] - 2026-09-29

**Criticality:** high. A review against the Claude plugin directory's pre-submission checklist and Software
Directory Policy found policy risks and a surface where the plugin did nothing.

### Why

Three independent reviewers and a skeptic checked the repository against the directory's checklist, the policy
and the platform-support table. Nothing blocks automated validation, but these findings would hold or reject a
listing, or mislead users:

- `tools/measure.mjs extract` read Claude Code transcripts and shipped inside the plugin folder. The policy says
  software "must not query or extract data from Claude's memory, chat history ...". The plugin never ran it, but
  everything in the plugin folder is installed and scanned.
- In claude.ai chat the plugin loaded nothing: hooks are ignored there, and the skill sat outside `skills/`.
- The listing description said the spec loads "at session start", while the hook only works in projects that
  opt in. The policy requires descriptions to "precisely match actual functionality".
- The README lacked what the policy and the security scan ask for: what the plugin runs, reads and sends; a
  support and security channel; troubleshooting; and three working examples.
- Without Node.js, the hook fails with four notices at every session start, and nothing said so.

### Changes

- **Claude Code plugin:** the `brevity` skill now ships in `skills/brevity/`, so chat and Cowork load it, and
  Claude Code has it on request. Its description fires only on explicit brevity requests, messages that already
  use brevity, or a `.brevity/` folder. `plugin.json` gets an accurate description and `displayName`. The
  marketplace descriptions match. The hook is unchanged.
- **Agent Skill:** moved from `adapters/skills/brevity/` to `skills/brevity/`. It now names the right SPEC section,
  uses the spec already in context when the hook loaded it, and suggests a human-readable spec link instead of a
  link for the recipient to fetch.
- **Tools:** `measure.mjs` keeps `count` and drops `extract`; it now reads only the files you pass it.
- **README:** new sections: Where it works, What the plugin runs, reads and sends (with privacy and trust notes),
  Try it (three examples and a reviewer setup), Troubleshooting (including Node.js 16.6 or later for the hook),
  Releases, and Support and security.
- **SECURITY.md:** private reporting through GitHub's Report a vulnerability, which is now enabled on the
  repository.
- `SPEC.md`: the title becomes 0.3. The text is otherwise unchanged. The Cursor rule and the skill's copy of the
  spec are regenerated from it.

### Evidence

- A directory review workflow: 3 reviewers (checklist rows, policy and security scan, surfaces and runtime) and a
  skeptic per reviewer. Of the 36 checklist rows that apply, none blocks, holds or warns. The policy findings above
  were all confirmed, and every one is addressed here.
- A real `claude -p --plugin-dir .` run in an opted-in folder with `DICT.template.md` as `.brevity/DICT.md`: 4
  hooks registered, parts of 9,189 and 1,783 characters injected, no truncation, and skill `brevity:brevity`
  loaded. In a folder without `.brevity/`, the 4 hooks run with no output and the skill still loads.
- `claude plugin validate` passes for the marketplace and `plugin.json` (local CLI 2.1.197; the portal's Validate
  is the authority). `node tools/build-adapters.mjs --check` passes. `node scripts/release-check.mjs` passes,
  including the new skill front-matter check.
- `measure.mjs count` and `idcheck.mjs` run on a synthetic pair of files; `measure.mjs extract` now prints usage.
- The spec's meaning is unchanged, so the 0.2.0 measurement stands: 27.2% fewer tokens with no known
  decision-relevant loss.

### Compatibility

- Protocol: every message written under 0.2 decodes the same under 0.3. The spec's size is unchanged (2,641 tokens
  on the Anthropic legacy tokenizer).
- New cost: the skill's name and description add about 138 tokens to every Claude Code session where the plugin is
  enabled, whether or not the project opts in.
- Breaking for tool users: `measure.mjs extract` is gone. Build `messages.json` yourself, as the README describes.

### Upgrade

- Claude Code: `/plugin marketplace update brevity`. The `brevity` skill appears. Projects that opted in keep
  working as before.
- Agent Skill: copy `skills/brevity/` instead of `adapters/skills/brevity/`.
- Cursor: copy the regenerated `adapters/cursor/brevity.mdc` (only its title line changed).
- AGENTS.md readers and Gemini CLI: nothing changes but the version; re-run `tools/agents-md.mjs` or update the
  extension when convenient.

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
