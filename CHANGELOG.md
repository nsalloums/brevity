# Changelog

Every entry follows [RELEASING.md](RELEASING.md): a criticality level, why the release exists, what changed, the
evidence, compatibility and upgrade steps. Versions follow semantic versioning read from the protocol's side.

## [Unreleased]

Changes waiting on `next` for the next release (see [RELEASING.md](RELEASING.md)).

- **#9, normal.** `SPEC.md` now gives one reading to the points that blind decoders and a fresh-session pilot
  found unclear: who waits in a HOLD on an act (whoever does it), what "lands" means, when a REPLY without WHEN or
  an unanswered question is due (once known), `WILL NOT x UNTIL c`, which tree a line number refers to, `n+`
  numbers not fixed ahead, a body that restates line 1, `has=#N`, a FIX that does not say whose, `…` in a list,
  `@Name` for a person, `Closes #N` as an issue, `MERGEABLE` next to `CLEAN`, and the actor of a verb on a `- `
  line. The spec's example no longer puts a NO on a DO line.
  Evidence (#10, five more full blind passes over the 268 private messages, method in eval/RESULTS.md):
  - First-pass confirmed decision-relevant losses per pass: 29 in pass 4, then 9, 19, 13, 12 and 13 in passes 5-9.
    Of those 66, 58 were encoder errors, 5 decoder errors and 3 came from the spec, each clarified here. All were
    fixed and re-audited, so none is known; #10 stays open because no pass came back clean.
  - Tokens, all 268 messages: 63,861 -> 46,521 (27.2%, median 152) at 0.2.0, and 63,861 -> 47,776 (25.2%, median
    160.5) now. The 2 points are the facts passes 5-9 restored (1,255 tokens), not the spec change: the
    clarifications change no encoding.
  - `tools/idcheck.mjs`: 2,637 identifiers, 0 missing. The spec: 2,641 -> 2,674 tokens (+1.2%), 99 lines, 9,163 ->
    9,185 characters (9,284 with CRLF line endings), one hook part either way.
  - Break-even with `tools/cost-model.mjs` and 200 calls: 76-101 messages per session (`--saving 60 --load-tokens
    3200`). 0.2.0's inputs give 68-91 with the same tool; eval/RESULTS.md said 70-95, a rounded hand estimate.
  - Compatibility: a message written under 0.4 reads the same, with two exceptions.
    - Added forms 0.4 did not define: `@Name`, `has=#N`, `WILL NOT x UNTIL c`.
    - A due time where 0.4 gave none: a REPLY without WHEN, and a question with no REPLY.
    - A reading where 0.4 gave none: a HOLD on an act (`HOLD me UNTIL c` still reads as in 0.4), a FIX without
      whose, a line number with no tree.
    - Terms 0.4 used without defining: lands, `n+`, `…`, `MERGEABLE`.
    - A 0.4 ambiguity settled: a verb on a `- ` line takes its own default actor, not the parent line's; one
      decoder reading the 0.4 wording took the parent's.
    - A reading 0.4 implied, replaced: a body line that restates line 1 adds detail to it, where 0.4's «the body
      does not repeat it» implied a new statement. No such case is known.
    - Exception 1: a 0.4 decoder applying "bare #N = pull request" literally reads an unquoted `Closes #N` as a
      pull request, and now it reads as an issue, which is what GitHub's closing keyword closes. 7 of the 268
      encodings carry it (4 in backticks, 3 unquoted); no blind decoder in passes 2-9 read its target as a pull
      request.
    - Exception 2: an unquoted `@media` or `@scope/pkg` was unknown content under 0.4 and could now read as a
      `@Name`. Code belongs in backticks: 4 final encodings left it unquoted (an encoder error), and none of their
      24 decodings in passes 4-9 read it as a name.
- **#35, normal.** On a checkout with CRLF line endings, Git's default on Windows, the SessionStart hook counted
  each CR toward its 9,300-character part limit and printed it into the session. It now reads every file with LF
  line endings, so a CRLF checkout injects the same text as an LF one. Evidence: a 9,299-character spec (a draft
  of #34) with CRLF took 2 hook parts (9,299 and 178 characters) and now takes 1, identical to the LF result
  (9,325 characters); the LF output is unchanged.

## [0.4.0] - 2026-09-30

**Criticality:** high. The README said that opting a project in was enough, and for a hub-and-spoke team with
short-lived peers that loses tokens overall.

### Why

- **#23, high.** The README's «When it pays off» ended with "Turn it on per project, where agent traffic is heavy".
  A `.brevity/` folder loads the spec into every session of the project. For a synthetic team shaped like the
  evaluated one, a hub and 80 short-lived peers, the cost model gives a net loss of about 2.67 million input-token
  equivalents, and a loss under every way brevity can load today.
- **#11, normal.** Nothing let users check whether brevity pays off for their own team before turning it on. This
  release ships the tool that measures it. The underlying problem, that the spec costs more than it saves in
  sessions that send few messages, is not fixed yet: #11 stays open for the fixes it lists (a reader card,
  loading on first use, a shorter spec).
- **#24, normal.** There was no public guide to the token economics of multi-agent setups.
- **#21, low.** The repository did not say how brevity relates to other formats, research and tools.
- **#5, low.** On Windows checkouts with CRLF line endings, `node tools/build-adapters.mjs --check` reported
  up-to-date adapters as stale.

### Changes

- **README:** «When it pays off» now says that brevity saves tokens only when the sessions that load it exchange
  many messages each, and that opting a project in is not enough. It shows the synthetic team under each loading
  scheme, and gives the reader-card result as modeled, not shipped. «Model it for your team» documents
  `tools/cost-model.mjs`. A new sentence links to `eval/RELATED.md`.
- **Tools:** new `tools/cost-model.mjs`, with 21 tests in `tools/cost-model.test.mjs`. For a file listing a team's
  sessions, it prints the net per session and for the team under four loading policies, and a fifth with
  `--reader-tokens N`: hubs load the spec, and the other sessions a reader card of N tokens. It also prints the
  break-even message count, and with `--rows`, what each row of the verb table costs and how often traffic uses
  it. `tools/build-adapters.mjs` now compares and writes LF, and `scripts/release-check.mjs` reads files as LF.
- **Docs:** new `docs/costs.md`, the cost model in plain words with a cited source for every price and ratio, and
  three synthetic team shapes in `docs/teams/` worked through with their real output.
- **Evaluation:** new `eval/RELATED.md`: 13 related formats, research papers and tools, and how brevity's approach
  differs from each. It compares approaches, not numbers.
- `SPEC.md`: the title becomes 0.4. The text is otherwise unchanged. The Cursor rule and the skill's copy of the
  spec are regenerated from it. The hook and the skill are unchanged.

### Evidence

- `node --test tools/*.test.mjs`: 21 tests, 21 pass. CI now runs the tools' tests on every pull request.
- The cost model reproduces eval/RESULTS.md's break-even: `node tools/cost-model.mjs --saving 65 --load-tokens 3100
  --turns 200` gives 68 messages if a session sends them all and 91 if it receives them all.
- `node tools/cost-model.mjs docs/teams/hub.json --saving 65 --load-tokens 3100 --reader-tokens 300` reproduces the
  README's table: every session from its start -2,672,350; each at its first message -1,663,365; the hub from its
  start and the peers at their first message -1,637,898; the hub plus a 300-token read-only card +117,603. The
  largest card that keeps the team ahead is 442 tokens, and 305 with `--first start`.
- Each of the 5 commands in `docs/costs.md` was run from the repository root, and its pasted output matches the real
  output. Prices and cache multipliers were checked against the Claude API pricing page, and the statements about
  Claude Code against its costs page, on 2026-09-30.
- `eval/RELATED.md`: all 13 entries were checked against their primary sources on 2026-09-30, and a second reviewer
  re-checked 3 of them.
- #5: with `SPEC.md` and both adapters checked out as CRLF, `--check` failed with `stale:
  adapters/cursor/brevity.mdc` before the fix, and passes after it. An LF checkout still passes, and a real change
  to `SPEC.md` is still reported as stale.
- `node scripts/release-check.mjs --base origin/main` and `node tools/build-adapters.mjs --check` pass. `claude
  plugin validate .` passes for the marketplace and the plugin (local CLI 2.1.197), with one warning, about the
  contributors' `CLAUDE.md` at the root, which the plugin does not load.
- The spec's meaning is unchanged, so the 0.2.0 measurement stands: 27.2% fewer tokens with no known
  decision-relevant loss.

### Compatibility

- Protocol: every message written under 0.3 decodes the same under 0.4. The spec's size is unchanged: only the
  version in its title changed.
- The plugin folder gains `docs/` (4 files, about 32 KB), `tools/cost-model.mjs` with its test, and
  `eval/RELATED.md`. None of them loads into a session, so what a session pays does not change.

### Upgrade

- Claude Code: `/plugin marketplace update brevity`. Nothing changes at runtime.
- Projects that opted in with a `.brevity/` folder: list the project's sessions and run `tools/cost-model.mjs` on
  them, as the README's «Model it for your team» describes. If the team loses tokens, keep the folder only where
  every session is busy, or remove it.
- Cursor: copy the regenerated `adapters/cursor/brevity.mdc` (only its title line changed).
- Agent Skill: copy `skills/brevity/` (only the spec's title line changed).
- AGENTS.md readers and Gemini CLI: nothing changes but the version.

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
