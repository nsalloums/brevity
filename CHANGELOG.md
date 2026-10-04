# Changelog

Every entry follows [RELEASING.md](RELEASING.md): a criticality level, why the release exists, what changed, the
evidence, compatibility and upgrade steps. Versions follow semantic versioning read from the protocol's side.

## [Unreleased]

Changes waiting on `next` for the next release (see [RELEASING.md](RELEASING.md)).

- **#42, high.** README.md, eval/RESULTS.md and docs/costs.md led with the audited 25% saving and no known loss. They
  now give the single-pass pilot from #26 next to it: 15.4% saved (about 37 tokens per message), a decision-relevant
  fact lost in 14.9 messages per 100, and a break-even of 123-164 messages for a 200-call session, not 76-101.
  The README also says that terse English did about as well in the pilot.

## [0.5.0] - 2026-09-30

**Criticality:** normal. Blind decoders kept flagging the same spec points, and three confirmed losses came from
the spec's own wording. The re-measurement also replaced the published savings.

### Why

- **#9, normal.** Blind decoders and a fresh-session pilot found spec points they could not decode with certainty.
  In evaluation passes 5-9, 3 of the 66 confirmed decision-relevant losses came from the spec's wording. In one,
  a `- DO` line under a WILL line was read as the sender's act, because the spec did not say which actor a verb
  on a continuation line takes.
- **#35, normal.** On checkouts with CRLF line endings, Git's default on Windows, the SessionStart hook counted
  each CR toward its 9,300-character part limit and printed it into the session. With the clarified spec, such a
  checkout would have loaded the spec in 2 parts.
- **#32, normal.** The README, `docs/costs.md` and the cost-model test quoted the 0.2.0 measurement, which the
  re-measurement for #9 replaces.
- #10 stays open: no full blind pass has come back clean (see Evidence).

### Changes

- **`SPEC.md` 0.5** gives one reading to each flagged point:
  - who waits in a HOLD on an act: whoever does it;
  - what "lands" means;
  - when a REPLY without WHEN, or a question with no REPLY, is due: once known;
  - `WILL NOT x UNTIL c`;
  - which tree a line number refers to;
  - `n+` numbers not fixed ahead;
  - a body line that restates line 1;
  - `has=#N`;
  - a FIX that does not say whose;
  - `…` in a list;
  - `@Name` for anyone named;
  - `Closes #N` as an issue;
  - `MERGEABLE` next to `CLEAN`;
  - the actor of a verb on a `- ` line.

  The example puts NO on its own line. The spec has 99 lines and 9,185 characters. The Cursor rule and the
  skill's copy of the spec are regenerated from it.
- **Claude Code plugin:** the hook reads every file with LF line endings (#35).
- **README and `docs/costs.md`:** the figures now come from eval/RESULTS.md after #9, and every command output is
  re-run (#32). The README's caveat on the modeled 300-token reader card names both cases in which it loses, as
  `docs/costs.md` does: each peer's first message arriving at its first call, and 1-hour cache writes.
- **Evaluation:** eval/RESULTS.md records passes 5-9, the spec revision each pass used, and the 0.2.0 and current
  numbers side by side. eval/RUBRIC.md points to the right spec section.
- **Tools:** the cost-model test asserts the new break-even, and one error message cites the new saving.

### Evidence

- Passes 5-9 are five more full blind passes over the 268 private messages, with the method in
  [eval/RESULTS.md](eval/RESULTS.md).
  - First-pass confirmed decision-relevant losses: 29 in pass 4, then 9, 19, 13, 12 and 13.
  - Of the 66 in passes 5-9, 58 were encoder errors, 5 decoder errors and 3 came from the spec, each clarified
    here.
  - All were fixed and re-audited, so none is known.
  - A targeted re-check of the 22 messages that use HOLD, on the final text, found none.
- Tokens, all 268 messages, Anthropic legacy tokenizer: 63,861 -> 47,776 (25.2%), median 201 -> 160.5. 0.2.0
  measured 63,861 -> 46,521 (27.2%), median 152. The 2 points are facts that passes 5-9 restored (1,255 tokens),
  not the spec change: the clarifications change no encoding.
- `tools/idcheck.mjs`: 2,637 identifiers, 0 missing.
- Break-even at 200 calls, with `node tools/cost-model.mjs --saving 60 --load-tokens 3200 --turns 200`: 76-101
  messages per session. With 0.2.0's inputs the same tool gives 68-91, which this repository rounded to 70-95.
- Hook: the four `hooks.json` commands were run the way Claude Code runs them, on a CRLF copy of the plugin.
  - Before the fix, the spec was injected as 9,310 characters with 99 CR.
  - After it, as 9,211 characters with no CR, identical to an LF copy. The dictionary went from 15 CR to none.
  - A folder without `.brevity/` gets no output.
- A real `claude -p --plugin-dir` run, with a signed-in CLI and the release commit as the plugin:
  - In a folder with `.brevity/`, the context holds `<!-- brevity SPEC.md -->` followed by
    «# brevity 0.5: short, public, lossless messages between agent sessions», in one part, and the local
    dictionary.
  - In a folder without `.brevity/`, there is no brevity comment, and the skill `brevity:brevity` is available.
- Each output pasted in `docs/costs.md` and the README was re-run and matches line by line.
- Independent reviewers, each with a skeptic, checked #34 twice and #37 once against the files and the tool.
- `claude plugin validate .` passes, as do `node scripts/release-check.mjs --base origin/main`,
  `node tools/build-adapters.mjs --check` and the tools' 21 tests.

### Compatibility

- Protocol: a message written under 0.4 reads the same, with two exceptions.
  - Exception 1: a 0.4 decoder applying "bare #N = pull request" literally reads an unquoted `Closes #N` as a pull
    request. Under 0.5 it reads as an issue, which is what GitHub's closing keyword closes. 7 of the 268 encodings
    carry it, 4 in backticks and 3 unquoted. No blind decoder in passes 2-9 read its target as a pull request.
  - Exception 2: an unquoted `@media` or `@scope/pkg` was unknown content under 0.4, and could now read as a
    `@Name`. Code belongs in backticks: 4 encodings left such a token unquoted, an encoder error, and none of
    their 24 decodings read it as a name.
- Everything else adds a reading where 0.4 had none, or settles an ambiguity:
  - added forms: `@Name`, `has=#N` and `WILL NOT x UNTIL c`;
  - due times for REPLY and ASK;
  - a HOLD on an act, where `HOLD me UNTIL c` still reads as in 0.4;
  - definitions for "lands", `n+`, `…` and `MERGEABLE`;
  - the actor of a verb on a `- ` line, its own default actor;
  - a body line that restates line 1, which adds detail. No such case is known.
- The spec grows from 2,641 to 2,674 tokens (+1.2%) and still fits in one hook part with LF or CRLF line endings.
  The measured saving falls 2 points, to 25.2%, for the reason given under Evidence. RELEASING.md's gate allows a
  drop of more than 1 point when the entry explains it.

### Upgrade

- Claude Code: `/plugin marketplace update brevity`.
- Writers of brevity: put code tokens that start with `@` in backticks, and write `issue #N` (or `Closes #N`) for
  issues.
- Teams using the cost model: re-run it with `--saving 60 --load-tokens 3200`, or with your own measurement.
- Cursor: copy the regenerated `adapters/cursor/brevity.mdc`.
- Agent Skill: copy `skills/brevity/`.
- AGENTS.md readers: re-run `node tools/agents-md.mjs <AGENTS.md>` from a checkout of v0.5.0, since the spec text
  changed.
- Gemini CLI: `gemini extensions update brevity`.

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
