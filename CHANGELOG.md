# Changelog

Every entry follows [RELEASING.md](RELEASING.md): a criticality level, why the release exists, what changed, the
evidence, compatibility and upgrade steps. Versions follow semantic versioning read from the protocol's side.

## [0.9.0] - 2026-10-12

**Criticality:** normal. The meter no longer reports message sizes twice over, and the identifier check covers
numbers it used to skip.

### Why

- **#76, normal.** The meter's `msg tokens` total counted every message between two measured sessions once at each
  end, and nothing in its output or the README said so. Read as a size, it gave twice the mean length: the cycle-1
  arm comparison on #11 published about 770 tokens per message, where the messages averaged about 385 (corrected on
  #11). The meter also counted a `notify_when_idle` subscription, a SendMessage with no message, as a delivered
  message of 0 tokens.
- **#64, low.** `tools/idcheck.mjs` skipped a number before a unit (`30-day`), the later numbers of `N/M` (`118/120`),
  and read a number grouped in thousands (`1,088`) as its last group, so its default run left out numbers that
  messages carry.

### Changes

- **Tools:**
  - `tools/meter.mjs`:
    - reports `sent tokens`, which counts each message once, at its sender, with the mean length per sent message,
      for the team and by the arm each message was written under (`sentTokens`, `meanSentTokens` and
      `team.sentByArm` in `--json`);
    - relabels the `msg tokens` column `msg tokens (both ends)`. It still counts a message at each end, so a team
      total counts every message between measured sessions twice, and `messageTokens` keeps its meaning;
    - no longer counts a SendMessage with no message, such as a `notify_when_idle` subscription, as a message. Where
      a session subscribed, its sent and delivered counts drop. The quality and delegation signals no longer treat
      the subscription as a message, so their rates and a few clarified or corrected flags can change, and so can
      the `--team-json` sent counts and the `--saving` of its compare command (#76).
  - `tools/idcheck.mjs` also checks, by default:
    - a number before a unit (`30-day`, `512mb`, `8080/tcp`);
    - the later numbers of `N/M` and `N:M`, except times (`118/120`);
    - a number grouped in thousands, as one number (`1,088`, `2.637`), kept with `,`, `.` or no separator.

    `--legacy` is unchanged (#64).
- **Docs:** the README's "Measure your own team" says what each token column counts, and that the per-arm summary
  files a session under its last arm (#79).

### Evidence

- **Identifier check.** On the private evaluation's final encodings, 268 messages:

  | mode | identifiers checked | missing |
  |---|---|---|
  | `--legacy` | 2,637 | 0, identical to the published figure |
  | 0.8.0 default | 2,649 | 0 |
  | new default | 2,686 | 2 |
  | `--small-numbers` | 3,000 | 42 (0.8.0: 2,958 and 40) |

  The 2 are one fact in two related messages: the documented reference value of an `N/M` count, which both encodings
  left out while keeping the measured `N/M`. The two-lens audit had rated that omission incidental in one message and
  did not flag it in the other, so neither is a confirmed decision-relevant loss. On the five pilot arms, the new
  default checks 2,686 identifiers and finds 0 missing in each.
- **Meter.**
  - On this project's transcripts up to 2026-10-04T00:00Z, the 0.8.0 meter and this one report the same totals,
    with the tokenizer and with chars/4: 9 sessions, 1,101 calls, a 38,283,857 bill, 13 copies, and the same spec
    cost, saving and net.
  - Over all of this project's transcripts, the only other differences are the new fields and 3 subscriptions,
    which drop out of the sent and delivered counts and let one more delegation prompt be flagged as corrected.
  - On the two windows in #76, `sentTokens` gives 28,080 tokens in 73 messages (mean 385) and 20,139 in 52 (mean
    387), exactly half of `messageTokens`.
  - The change had three review passes, and its tests catch every mutant they were checked against, among them a
    mean over the wrong count, a subscription counted as a message, and failed sends in the by-arm table.
- **Tests:** `node --test tools/*.test.mjs` gives 96 of 96 without the tokenizer and 96 of 96 with it.
- **Plugin.** Nothing in `hooks/`, `arms/` or the skill changed.
  - `claude plugin validate .` passes.
  - The four hook commands print brevity 9,277 characters in part 0 (as in 0.8.0), lite 1,461, terse 759, off the
    26-character marker, and nothing without `.brevity/`.
  - The real `claude -p --plugin-dir` run was not repeated, because the hook did not change.
- **Spec size:** 99 lines, 9,221 characters, 2,680 legacy tokens; only the version in the title changes.
- **Checks:** `node scripts/release-check.mjs --base origin/main` and `node tools/build-adapters.mjs --check` pass.

### Compatibility

Every message written under 0.8 decodes the same: the spec changes only the version in its title.

The meter's JSON adds `sentTokens`, `meanSentTokens` and `team.sentByArm`, and keeps every earlier key. A script that
reads its text output finds the column renamed `msg tokens (both ends)`. Sent, delivered and signal counts can drop
where a session subscribed. `tools/idcheck.mjs` checks more by default, and no option gives the 0.8.0 default back:
`--legacy` still gives the 0.7.0 coverage.

### Upgrade

- **Claude Code plugin users:** run `/plugin marketplace update brevity`.
- **Meter:** for message lengths, read `sent tokens`, not `msg tokens (both ends)`. To compare arms, read the table
  by the arm each message was written under, or use `--since`/`--until` windows that each hold one arm (#79).
- **Identifier check:** if you run it in a pipeline, check the printed `coverage` line, or pin `--legacy`.
- **Other surfaces:** projects that copy SPEC.md, the Cursor rule or the AGENTS.md block re-copy them.

## [0.8.0] - 2026-10-11

**Criticality:** normal. The identifier check covers what the docs said it covered, the meter's quality signals
reach delegation prompts, and the evaluation method is linked where readers look.

### Why

- **#56, normal.** `tools/idcheck.mjs` is the gate behind every published "identifiers kept" figure. It skipped
  one-digit #N, the second half of small diffstats, and file:line outside eleven web file types, and the docs
  overstated what it covered.
- **#58, low.** The meter's quality signals skipped delegation prompts, which start most sessions in a
  coordinator-and-issues team.
- **#60, low.** One meter test failed when the optional `@anthropic-ai/tokenizer` was installed, the setup the README
  suggests. CI stayed green because it runs without the tokenizer.
- **#27.** eval/METHOD.md shipped in 0.7.0, but nothing linked to it.

### Changes

- **Tools:**
  - `tools/idcheck.mjs` now covers by default:
    - file:line for any extension of 1-8 letters and digits;
    - one-digit #N;
    - both halves of +N/-M.

    A SHA's digits in the encoding no longer count as a kept number. New `--small-numbers` adds numbers and
    diffstats below 10, and `--legacy` gives the exact 0.7.0 coverage. Each run prints the coverage it used, and an
    unknown option stops it with exit code 2. It has its first tests (#56).
  - `tools/meter.mjs`:
    - flags delegation prompts as clarified, corrected or resent, in a table apart from the SendMessage signals;
    - counts a `spawn_task` whose result is an error as a failed send (#58);
    - forces the chars/4 fallback when `BREVITY_METER_TOKENIZER=chars/4`, which its tests now set (#60).
- **Docs:**
  - The README, eval/RESULTS.md and eval/RUBRIC.md link eval/METHOD.md.
  - RESULTS.md's Method section shortens to the steps the run followed, every number kept. RESULTS.md now says, as
    METHOD.md does, that its holdout was not a sealed test (#27).
  - The published identifier figures are labelled with the coverage that produced them (#56).

### Evidence

- **Identifier check.** On the private evaluation's final encodings (aggregates in #56):

  | mode | identifiers checked | missing |
  |---|---|---|
  | `--legacy` | 2,637 | 0, identical to the published figure |
  | new default | 2,649 | 0 |
  | `--small-numbers` | 2,958 | 40, all below 10, about half of them list markers |

  The five pilot arms give the same results in the first two modes. On 50,000 fuzzed pairs, `--legacy` matches the
  0.7.0 tool exactly. The new tests kill 36 of 36 mutants.
- **Meter.** Its earlier results are unchanged: on this project's transcripts up to 2026-10-03 it still reports
  9 sessions, 1,088 calls, a 37,798,511 bill, 13 copies and a 217,372 spec cost. The delegation signals had two review
  passes, and their tests kill 20 of 20 mutants.
- **Tests:** `node --test tools/*.test.mjs` gives 90 of 90 without the tokenizer and 90 of 90 with it.
- **Plugin.**
  - `claude plugin validate .` passes.
  - The four hook commands print what 0.7.0 printed: brevity 9,277 characters in part 0, terse 759, and nothing
    without `.brevity/`.
  - A real `claude -p --plugin-dir` run, with the installed plugin excluded, saw the brevity marker followed by
    `<!-- brevity SPEC.md -->`.
- **Spec size:** 99 lines, 9,221 characters, 2,680 legacy tokens; only the version in the title changes.
- **Checks:** `node scripts/release-check.mjs --base origin/main` and `node tools/build-adapters.mjs --check` pass.

### Compatibility

Every message written under 0.7 decodes the same: the spec changes only the version in its title.

`tools/idcheck.mjs` now checks more by default. A pipeline that compares its counts with figures from 0.7.0 or earlier
passes `--legacy`, and a typo in an option is now an error, not ignored. The meter's JSON adds the delegation fields
and keeps every earlier key.

### Upgrade

- **Claude Code plugin users:** run `/plugin marketplace update brevity`.
- **Identifier check:** if you run it in a pipeline, check the printed `coverage` line, or pin `--legacy`.
- **Other surfaces:** projects that copy SPEC.md, the Cursor rule or the AGENTS.md block re-copy them.

## [0.7.0] - 2026-10-11

**Criticality:** normal. The cost model now prices the spec as Claude Code bills it, forked sessions get the current
copy, and the meter weighs whether sessions understood each other, not only what each arm costs.

### Why

- **#40, normal.** `tools/cost-model.mjs` priced cache reads at 0.1x and writes at the 5-minute rate (1.25x) by
  default. Claude Code on Claude Opus 5.5 bills reads at 0.05x, and in the sessions measured in #11 it wrote every
  cache entry at the 1-hour rate (2x). The model also left out re-injection, idle cache misses and the plugin's skill
  entry, so the published break-even and team figures used prices nobody paid.
- **#6, normal.** Claude Code 2.1.214 and later reports a forked session to SessionStart as `fork`, which the hook's
  matcher left out. Real forks kept the parent's copy, so after a plugin update, a dictionary edit or an arm change
  they went on with the old one.
- **#52, normal.** `tools/meter.mjs` compared arms on cost only, which favours the smallest load by construction.
  What decides between arms is whether the recipient still understands the messages.

### Changes

- **Tools:**
  - `tools/cost-model.mjs` prices cache reads by `--model`, which defaults to `claude-opus-5-5`: 0.05x, 0.025x on
    Claude Fable 5.1 and Claude Mythos 5.1, and 0.1x on other models. Cache writes default to 2x, the 1-hour rate, and
    `--write 1.25` sets 5-minute caching. The tool prints which prices ran.
  - New options add the costs the cost model left out: `--reinject` and `--reinject-every`, `--idle-misses` and
    `--skill-entry`. Their defaults add nothing. The default hub threshold counts only the marginal cost of loading,
    and with `--skill-entry` the tool also prints the break-even against having no plugin (#40).
  - `tools/meter.mjs` counts three heuristic quality signals per arm and for the team, as counts and rates per 100
    delivered messages: clarification requests (`--clarify-window`, 5 calls by default), corrections and re-sends.
    The rules were tuned on this project's own transcripts and are labelled in-sample. Delegation prompts are not
    checked yet (#58) (#52).
- **Claude Code plugin:** the SessionStart matcher adds `fork`, so a forked session gets the current copy of its
  arm, as a resume does (#6).
- **Docs:**
  - Every figure that README.md, `docs/costs.md` and eval/RESULTS.md quote from the cost model is re-run. A 200-call
    session now breaks even at 64-92 messages at 60 tokens saved, not 76-101, and at 104-149 at a single pass's 37,
    not 123-164. The hub team's largest read-only card is 276 tokens, not 309, so the 300-token card now loses.
    Where an old-price figure stays, it is labelled.
  - New eval/METHOD.md writes up the evaluation method for reuse (#27, merged on `main` as #54).

### Evidence

- **Cost model.** Review re-ran every published figure with the new defaults: all reproduce. The old figures
  reproduce exactly with `--model claude-sonnet-5-5 --write 1.25`. The review found 4 defects, all fixed before
  merge, among them a hub threshold that counted the skill entry.
- **Meter.**
  - The earlier results do not change: on this project's own transcripts it still matches the earlier private replay
    (#11) on sessions, calls, bills and copies.
  - Review found 5 defects in the signals, all fixed before merge.
  - On this project's transcripts, 4 of the 5 flagged corrections are real, and no clarification is flagged. This is
    an in-sample check, not a validation.
- **Hook.** The four `hooks.json` commands were run from inside a temp folder per arm, on the sources startup,
  resume, fork and compact. The characters in part 0 were the same on all four sources:

  | arm | part 0 |
  |---|---|
  | brevity, or no arm file | 9,277 |
  | lite | 1,461 |
  | terse | 759 |
  | off | 26 |
  | no `.brevity/` | nothing |

  No part contained a CR.
- **Plugin.**
  - `claude plugin validate .` passes.
  - Real `claude -p --plugin-dir` runs, with a signed-in CLI, the release commit as the plugin and the installed
    plugin excluded (`--setting-sources project,local`):
    - a session in a folder with arm `terse` saw the terse marker and the skill;
    - a fork of it (`--resume <id> --fork-session`) saw the same single copy;
    - after the arm was switched to `lite`, another fork logged `SessionStart:fork` and saw the terse copy followed
      by the lite one;
    - a folder without `.brevity/` saw no marker.
- **Spec size:** 99 lines, 9,221 characters, 2,680 legacy tokens; only the version in the title changes.
- **Checks:**
  - `node scripts/release-check.mjs --base origin/main`, `node tools/build-adapters.mjs --check` and the tools'
    tests (70) pass.
  - One meter test fails when the optional `@anthropic-ai/tokenizer` is installed (#60). CI runs without it.

### Compatibility

Every message written under 0.6 decodes the same: the spec changes only the version in its title. The hook loads
what it loaded before, now also on a fork.

The cost model's defaults change. A script that relied on the old 0.1x reads and 1.25x writes passes
`--model claude-sonnet-5-5 --write 1.25`. The meter's JSON adds the quality-signal fields and keeps every earlier key.

### Upgrade

- **Claude Code plugin users:** run `/plugin marketplace update brevity`.
- **Cost model:** check the printed prices line.
- **Other surfaces:** projects that copy SPEC.md, the Cursor rule or the AGENTS.md block re-copy them.

## [0.6.0] - 2026-10-10

**Criticality:** normal. Two new surfaces measure on real work whether brevity pays: a meter that reads a team's own
transcripts, and a per-project choice of what the hook loads.

### Why

- **#47, normal.** `tools/cost-model.mjs` predicts whether loading brevity pays, but nothing measured what it
  actually cost and saved. A team had to list its sessions by hand, and the model assumed a warm cache, 5-minute
  writes and one copy per session, which measured sessions break (#40).
- **#49, normal.** The hook could load the full spec or nothing. The pilot in #26 measured lighter instructions
  (a 167-token terse instruction ahead on the bill in every team shape tested, and a 333-token lite version that
  lost the fewest facts), but none could be tried on real work.
- **#39** is closed without a hook change. On a resume, Claude Code itself keeps only the hook items whose text
  changed. The second copy that #39 measured was the 0.5 spec arriving after 0.4, which is the copy to load.

### Changes

- **Tools:**
  - New `tools/meter.mjs` reads a project's local Claude Code transcripts and reports, per session, per arm and for
    the team:
    - the bill;
    - each injected copy priced call by call: 1-hour and 5-minute writes, per-model read prices, idle-miss
      rewrites, re-injections and duplicated copies;
    - the messages sent and received;
    - an estimated saving, labelled as an estimate;
    - the net.
  - It uses no network, writes only the `--team-json` file, and prints numbers and 8-character ids (titles only
    with `--titles`). `--team-json` writes the team in `tools/cost-model.mjs`'s format, with the command that
    compares the two (#47).
- **Claude Code plugin:**
  - An opted-in project picks what every session loads with `.brevity/arm` or `BREVITY_ARM`:

    | arm | what each session loads |
    |---|---|
    | `brevity` | the spec and the dictionaries, as before; the default |
    | `lite` | new `arms/lite.md`, 339 legacy tokens |
    | `terse` | new `arms/terse.md`, 167 legacy tokens |
    | `off` | the marker only |

  - Every injection starts with `<!-- brevity arm: X -->`.
  - The file is read in UTF-8 or UTF-16, as Windows PowerShell writes it.
  - Projects without `.brevity/` still get nothing (#49).
- **README:** the arms are documented. "What the plugin runs, reads and sends" adds `.brevity/arm`, `arms/*.md`
  and the meter's reads, and states the lookup order for `.brevity/`. A new section, "Measure your own team",
  covers the meter.

### Evidence

- **Meter.**
  - On this project's own transcripts it matches the earlier private replay (#11) exactly on sessions, calls, bills
    and copies, and within 0.11% on the spec's cost.
  - Review found 7 defects, fixed before merge. One of them overstated the saving's share by about 19%.
- **Hook.** The four `hooks.json` commands were run the way Claude Code runs them, from inside a temp folder per
  arm, with the release commit as the plugin. Characters per part, the same on startup and on resume:
  - brevity, and no arm file: 9,277 in part 0;
  - lite: 1,461;
  - terse: 759;
  - off: 26;
  - no `.brevity/`: nothing;
  - no CR in any part.

  Apart from its marker line, the brevity arm's output is identical to 0.5.1's.
- **Review.** The first version skipped injection on resume when a copy was already there. Review showed that it
  kept stale specs and dictionaries after an update or an edit, so it was removed.
- **Real runs.** `claude plugin validate .` passes. A real `claude -p --plugin-dir` run, with a signed-in CLI and the
  release commit as the plugin, saw:
  - with `.brevity/`: the brevity marker followed by `<!-- brevity SPEC.md -->`;
  - with `.brevity/arm` = terse: the terse marker followed by the terse instruction;
  - without `.brevity/`: neither.

  The skill `brevity:brevity` was available in all three.
- **Spec size:** 99 lines, 9,221 characters, 2,680 legacy tokens; only the version in the title changes.
- **Checks:** `node scripts/release-check.mjs --base origin/main` and `node tools/build-adapters.mjs --check` pass,
  and so do the tools' tests (53).

### Compatibility

Every message written under 0.5 decodes the same: the spec changes only the version in its title. Projects that set
nothing load what they loaded before, plus one marker line (30 characters).

### Upgrade

- **Claude Code plugin users:** run `/plugin marketplace update brevity`. To try a lighter instruction, write `lite`,
  `terse` or `off` to `.brevity/arm` and start a new session. To see what it cost, run
  `node /path/to/brevity/tools/meter.mjs` from the project's folder.
- **Other surfaces:** projects that copy SPEC.md, the Cursor rule or the AGENTS.md block re-copy them.

## [0.5.1] - 2026-10-04

**Criticality:** high. The README promised more than a session gets: a 25% saving with no known loss, and a
lossless format.

### Why

- **#42, high.** The README and eval/RESULTS.md led with about 25% fewer tokens and no known decision-relevant
  loss. That figure comes from encodings repaired over nine rounds of blind decoding and auditing, by encoders
  pushed toward a 50% target. A session writes each message once. A single-pass pilot on the same 268 messages
  (#26) saved 15.4% and lost a decision-relevant fact in 14.9 messages per 100 (95% CI 11.2-19.7). In the same
  pilot, terse English did about as well at equal loss and cost less to load.
- **#44, high.** The README's tagline, its rule «Lossless where it matters» and SPEC.md's title said that every
  message keeps those facts. The single-pass loss rate shows they do not.

### Changes

- **README.md:**
  - The Results section leads with the single-pass figures: about 15% fewer tokens, about 37 per message, and a
    fact lost in roughly 15 of 100 messages. The audited 25% follows as such.
  - A new bullet reports that terse English did about as well in the pilot.
  - The break-even reads 123-164 messages for a 200-call session at 37 tokens per message, next to 76-101 at the
    audited 60.
  - The tagline and the rule now called «Keep what matters» state the goal and the writer's duty, not a guarantee.
  - The README says exactly what `tools/idcheck.mjs` checks (#42, #44).
- **eval/RESULTS.md:** a new section, «Single writing pass (pilot, 2026-10-04)», gives the pilot's table, the
  terse-English comparison and its limits. The audited figures are labelled as audited, and the break-even adds the
  single-pass value (#42).
- **docs/costs.md:** a note says that the worked examples use the audited 60 tokens per message, and that a single
  pass saves about 37 (#42).
- **SPEC.md 0.5:** only the title changes, to «short, public messages between agent sessions that aim to keep every
  decision-relevant fact». No rule, verb or example changes. The Cursor rule and the skill's copy of the spec are
  regenerated from it (#44).

### Evidence

- **Numbers.** The pilot figures are the aggregates published in #26, from one writing pass on the 268 private
  messages of eval/RESULTS.md. That pass used SPEC 0.5 and the evaluation's dictionary, with the same blind decode,
  two-lens audit and skeptic as the evaluation.
- **Break-even:** `node tools/cost-model.mjs --saving 37 --load-tokens 3200 --turns 200` gives 123-164 messages,
  and `--saving 60` gives 76-101.
- **Spec size:** 99 lines and 9,221 characters (was 9,185). 2,680 legacy tokens (was 2,674), +0.2%.
- **Hook:** the four `hooks.json` commands were run the way Claude Code runs them, with the release commit as the
  plugin.
  - In a folder with `.brevity/`, part 0 holds the whole context in one part, 9,446 characters with no CR. The line
    after `<!-- brevity SPEC.md -->` is the new title. Parts 1-3 print nothing.
  - In a folder without `.brevity/`, no part prints anything.
- **Plugin:** `claude plugin validate .` passes. A real `claude -p --plugin-dir` run, with a signed-in CLI and the
  release commit as the plugin, was asked to copy the line after `<!-- brevity SPEC.md -->` and say whether the skill
  `brevity:brevity` is available:
  - in a folder with `.brevity/`, it returned the new title and YES;
  - in a folder without `.brevity/`, it returned NONE and YES.
- **Checks:** `node scripts/release-check.mjs --base origin/main` and `node tools/build-adapters.mjs --check` pass,
  and so do the tools' tests.

### Compatibility

Every message written under 0.5.0 decodes the same: only the spec's title changed, not a rule. The spec grows by 36
characters and 6 tokens.

### Upgrade

Claude Code plugin users run `/plugin marketplace update brevity`; the next session loads the new title. Projects
that copy SPEC.md, the Cursor rule or the AGENTS.md block re-copy them. Nothing else changes.

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
