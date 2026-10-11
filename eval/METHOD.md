# How to measure a compression of agent messages

This guide turns the way brevity was measured into a method anyone can follow, for any way of shortening the
messages coding agents send each other or the prompts they receive: a notation such as brevity, an instruction to
write tersely, or a tool that drops tokens. It says what to fix before measuring, how to run each step, what to
report, and what went wrong here. Its numbers are aggregates from [RESULTS.md](RESULTS.md) and the public issue
comments. Its examples are synthetic.

A compression has to answer two questions:

1. **Does each fact still arrive?** Task accuracy alone hides lost facts. A downstream task often does not need the
   fact that was dropped this time, and a round trip by code checks bytes, not facts ([RELATED.md](RELATED.md)).
   Here each message is decoded by an agent that never saw the original, and auditors check, fact by fact, what the
   decoding lost.
2. **Does it lower the bill?** A shorter message saves tokens, but whatever makes it shorter is loaded into the
   session and paid on every call. The answer is the net across a team's whole bill, not the saving per message.

## The pipeline

| step | who | sees | produces |
|---|---|---|---|
| 1. Rubric | you, before measuring anything | nothing measured yet | what "decision-relevant" means, versioned |
| 2. Corpus | you | traffic you are allowed to use | messages, a holdout, gold facts |
| 3. Encode | one agent per batch | the instruction and the originals | encodings, gated by `tools/idcheck.mjs` |
| 4. Decode | a fresh agent | the instruction and the encodings | every message in full plain English |
| 5. Audit | two lens agents, then a skeptic | the rubric, originals, gold facts, decodings | confirmed losses, with their roots |
| 6. Compare | you | every arm's results | savings at equal loss, against criteria written in advance |
| 7. Bill | `tools/cost-model.mjs`, `tools/meter.mjs` | team shapes, or real transcripts | net tokens per session and per team |

## 1. Fix the rubric first

The unit of loss is a decision-relevant fact. brevity's definition is [RUBRIC.md](RUBRIC.md): a fact is
decision-relevant when a recipient holding only the encoding could act, write, wait, answer or merge differently
from one holding the original, and in doubt it is. The rubric lists what to keep and what may drop, two severities,
and four loss causes. Use it as is, or adapt it to your traffic, but do that before you measure.

- **A rubric written after the results can absorb any loss.** Once you have seen an encoding drop a fact, you can
  always decide the fact did not matter. "Zero loss" means something only under a rubric fixed in advance, and then
  it means zero loss under that rubric, which readers can read and dispute.
- **Calibrate once, then freeze it.** Run the whole pipeline on a small sample to find where the rubric is unclear,
  revise it once, and freeze it before the full run. brevity calibrated on 30 messages and revised the rubric from
  v1 to v2: v1 read "every code name" literally, which forced whole evidence chains into the encodings. Date every
  version and say what changed and why, as the rubric's Versions section does.
- **Quote it in full in every audit and skeptic prompt,** so that every judgment rests on the same text. A rubric
  paraphrased in a prompt drifts from one prompt to the next.
- **Say whose rubric it is.** brevity's rubric is the longer form of its own spec's keep list. Arms compared under
  one arm's rubric are judged on that arm's terms (see [Tuning bias](#tuning-bias)).

## 2. Build the corpus

**Real traffic.** Measure on the messages the compression will face in use. brevity's corpus is 229 messages, sent
and received by one coordinating Claude Code session that worked with 10-25 parallel sessions over 16 days. Tag the
slices you will report on: length (short under 120 tokens, long from 300), direction (sent or received) and
language. Real traffic usually cannot be published, so nobody else can rerun the numbers; for that reason the
public benchmark planned in [#26](https://github.com/nsalloums/brevity/issues/26) would generate a synthetic corpus
facts-first from published scenarios.

**Consent and privacy.**

- Use only messages you are allowed to use, with the consent of whoever owns the project and its traffic.
- Keep the corpus, the encodings, the decodings and the audit notes outside the repository: never in a commit, an
  issue or a pull request. Publish aggregate numbers only.
- Write public examples from scratch. Before you publish one, search the private corpus for its distinctive strings
  and expect no hits.
- Remove secrets such as tokens and keys before any agent reads the corpus, and treat the text as unsafe input to
  your tools (see [Corpus text in a shell string](#corpus-text-in-a-shell-string)).

**Files.** The tools read `messages.json`, `[{"id": "m001", "text": "..."}]`, and `encodings.json`,
`[{"id": "m001", "enc": "..."}]`. Keep one id per message across every arm and pass.

**Holdout.** Set aside messages written after the design froze (the instruction, the dictionary and the rubric)
that nobody who designed them has seen. brevity's holdout is 39 later messages, and it saved 23.8% against the
corpus's 25.4%. A holdout catches a design fitted to particular messages. It does not catch a dictionary fitted to
the project's routines, because the same project wrote both. #26 goes further: a sealed holdout, generated after the
spec freeze by a different model family, with its hash and a canary string committed before any run.

**Gold facts.** Before anything is encoded, list each original's atomic facts as a checklist for the auditors.
brevity extracted 2,537 from its 229-message corpus. The original text stays the authority: a fact the list missed
is still a fact. #26 hardens this step: the list is frozen by hash before encoding, two extractors from different
vendors give each fact a verbatim evidence span, exact-answer probe questions are added, and about 10% of the
messages are annotated twice by people.

A synthetic message and its gold facts, with the rubric clause each falls under:

> PR #214 is green, but please don't merge it until #209 lands, since both touch `src/cart/total.ts`. If #209 slips
> past Friday, rebase #214 on main instead and send me its new head.

1. PR #214's CI is green (KEEP 3, statuses).
2. Do not merge #214 until #209 lands (KEEP 9, a prohibition; KEEP 8, its condition).
3. #214 and #209 both touch `src/cart/total.ts` (KEEP 1, a path that says what is touched).
4. If #209 has not landed by Friday, rebase #214 on main (KEEP 8, a condition and its scope).
5. Then send the sender #214's new head (KEEP 9, a report-back request).

## 3. Encode

- **The encoder sees only the instruction and the original.** The instruction is whatever the arm loads in real use:
  a spec and a dictionary, or one paragraph. In a single pass the encoder sees no gold facts, no decodings and no
  audit notes.
- **Batch and interleave.** brevity gave one agent each batch of 13-14 messages, interleaved so that no batch held a
  whole thread. An encoder that reads a thread can lean on earlier messages its recipient may never have seen.
- **Fix the prompt pressure, and say what it was.** Word the encoder's task the same way for every arm, and state
  whether it carries a numeric target. brevity's first encoders aimed at 50%: they reached 35.1% on the first pass
  and dropped a decision-relevant fact in 111 of 268 messages (41%). The pilot in #26 set no target.
- **Gate each pass on identifiers.** [tools/idcheck.mjs](../tools/idcheck.mjs) checks, deterministically, that each
  original's SHAs (a prefix of at least 9 hex characters), #N references, file:line numbers, numbers of 10 or more,
  diffstats and «quoted» text all appear in its encoding. `--dict aliases.json` lets an alias count as the long form
  it stands for. An encoding that fails goes back to its encoder before anything is decoded. Give every arm the same
  retry rule: #26 proposes one gated retry.

  ```
  node tools/idcheck.mjs messages.json encodings.json --verbose
  ```

  The check proves nothing about meaning. This terse encoding of the example keeps #214, #209 and the path, passes
  the check, and still loses the deadline in fact 4:

  ```
  #214 green; do not merge until #209 lands.
  Both touch src/cart/total.ts.
  If #209 slips: rebase #214 on main, send me its new head.
  ```

- **Count tokens** before and after. The tool uses `@anthropic-ai/tokenizer` when it is installed, and characters / 4
  otherwise (see [The legacy tokenizer](#the-legacy-tokenizer)).

  ```
  node tools/measure.mjs count messages.json --enc encodings.json --rows
  ```

**Report the single-pass figure and the audited one, and label each.**

| figure | what it is | what it answers | brevity |
|---|---|---|---|
| single pass | one gated writing pass, decoded and audited; losses counted, not fixed | what a session gets, since it writes each message once and nobody audits it | 15.4% saved (median 11.8%), about 37 tokens per message; a loss in 14.9 messages per 100 |
| audited | the encodings after repeated passes of decoding, auditing and repair | how far the format can go with no known loss | 25.2% saved, about 60 tokens per message, no known loss after nine passes |

Until 0.5.1, brevity led with the audited figure alone. That overstated what a session gets by about 10 points of
saving, and its "no known loss" does not hold for a single pass
([#42](https://github.com/nsalloums/brevity/issues/42)). Every number downstream inherits the choice: at 60 tokens
per message a 200-call session needs 76-101 messages to break even, and at 37 it needs 123-164. The audited encoders
also had help that real senders lack, a token counter and the identifier check.

## 4. Decode blind

- **A fresh agent, with only the instruction and the encodings.** It has not seen the originals, the gold facts,
  earlier decodings or the encoder's work. It writes every message out in full plain English: who asks whom to do
  what, under which condition, with every identifier and number. An agent that has seen the original fills gaps from
  memory, and the real recipient cannot.
- **A new decoder every time.** Each pass and each fix loop gets its own decoder, so that no decoder learns the
  corpus.
- **The same decoder for every arm,** in model and prompt. A decoder stands in for the recipient, and one model
  family shows how that family reads. brevity used Claude decoders only. #26 plans Claude, non-Claude and
  open-weights decoders, and exact-answer probe questions next to the full decodings.
- **A misreading counts.** If the decoder reads a correct encoding wrongly, a recipient may too. The loss counts,
  with its root in the decoder.

The example's encoding, decoded:

> PR #214 has passed CI. Do not merge it until #209 has landed; both change `src/cart/total.ts`. If #209 is delayed,
> rebase #214 onto main and send the sender #214's new head SHA.

## 5. Audit

**Two lenses.** Independent agents compare each original, its gold facts and its blind decoding, with the rubric
quoted in full. One lens reads for identifiers and quantities: SHAs, #N, paths, numbers, dates, statuses and counts.
The other reads for meaning and line 1: requests, prohibitions, conditions, owners, order, questions, corrections
and qualifiers, and, when the format has a plain first line, whether that line carries the main fact. Each reports
every lost, altered or added fact with its rubric clause and severity. A finding marked incidental must quote the
clause that lets it drop, or say concretely why no action could depend on it.

**A skeptic.** A separate agent takes each claimed decision-relevant loss and confirms or refutes it. It may refute
only by:

1. quoting the decoded text that carries the fact;
2. showing that the fact is not in the original;
3. citing the rubric clause that lets the fact drop.

When uncertain, it confirms. The asymmetry is deliberate: an auditor who over-reports is corrected with evidence,
and no loss is waved away by opinion. Report claimed and confirmed losses side by side; in brevity's first full
pass, auditors claimed 216 and the skeptic confirmed 157.

In the example, the meaning lens claims that fact 4 lost its deadline ("slips past Friday" became "is delayed").
The skeptic cannot quote a decoded line that carries Friday, the fact is in the original, and no clause lets a
deadline drop: it confirms, with the root in the encoder. A claim that the report-back request was lost would be
refuted by quoting "send the sender #214's new head SHA".

**Counting.**

- **One loss is one fact** that was lost, altered, or added falsely.
- **Report messages with a loss per 100 messages,** with a 95% interval, next to the count of losses. The pilot's
  brevity arm had 41 confirmed losses in 40 messages: 14.9 per 100 (Wilson interval 11.2-19.7). That is how often a
  recipient gets a broken message.
- **Count incidental findings apart.** They are never losses.
- **Count line-1 failures apart.** When line 1 does not carry the main fact, the body may still hold it, but a human
  who reads only the preview misses it. In the pilot they ranged from 6 to 26 per arm over 268 messages.
- **Report identifier survival** from the identifier check: in brevity's audited encodings, 2,637 identifiers and 0
  missing.

**Roots.** Give every confirmed loss one root. The root decides the fix:

| root | causes in [RUBRIC.md](RUBRIC.md) | what happened | what to do |
|---|---|---|---|
| encoder | `encoder-omitted`, `encoder-altered` | the encoding lacks the fact or states it wrongly | re-encode; a single-pass figure counts it as it stands |
| protocol | `spec-ambiguous` | the encoding is right, but the instruction does not let a fresh reader decode it reliably | clarify the instruction, between passes, and measure again |
| decoder | `decoder-misread` | the encoding is right, and the decoder read it wrongly | count it; when the same construct is misread again, look at the protocol |

brevity's passes 5 to 9 confirmed 66 new losses: 58 from the encoder, 5 from the decoder and 3 from the spec.

**The fix loop, for audited figures only.** Re-encode each confirmed loss, decode it with a new agent, and audit and
verify it again. Start each full pass from the previous pass's fixed encodings, and change the instruction only
between passes. Check the fixes for added facts: one of brevity's hand fixes stated more than its original, and only
the next pass caught it. Publish the pass curve, with claimed and confirmed losses and the saving after each pass, as
[RESULTS.md](RESULTS.md#method) does.

## 6. Compare arms

An arm is one way of writing plus everything it loads. Compare arms on the same messages, at equal loss.

**Hold everything else equal.**

- The same corpus, encoder model, encoder prompt and prompt pressure.
- The same identifier gate and retry rule.
- The same decoder, audit lenses, skeptic and rubric.
- The same tuning budget for every arm, or none.
- Baselines next to the candidates. The prose original, decoded and audited like an encoding, gives the pipeline's
  noise floor. #26 also lists prose with the framing stripped, JSON, and LLMLingua-2 at several rates.

**Compare at equal loss.** A saving bought with lost facts is not a like-for-like saving. Read two things: each
arm's messages with a loss per 100, where overlapping intervals mean the difference is not established; and the
paired saving on the messages that no arm lost a fact in.

**Write the pass criteria before the run.** Set what an arm must reach (a saving floor, a ceiling on messages with a
loss, line-1 failures, a break-even), publish the result whichever way it falls, and follow the rule you wrote.

**Do not re-tune on the test corpus.** An arm changed after failing on these messages, then run on them again,
measures how well it fits them. Send it unchanged to new messages.

### Worked example: the single-pass pilot

The pilot in [#26](https://github.com/nsalloums/brevity/issues/26) ran five arms on brevity's 268 private messages:
one writing pass each, the same encoder model and prompt pressure, no numeric target, the identifier gate, then the
same blind decoding, two-lens audit and skeptic. Loads are in legacy tokens; break-even is for a 200-call session at
Claude Opus 5.5 prices.

| arm | load | saving | on English originals | messages with a loss, per 100 (95% CI) | line-1 failures | break-even |
|---|---|---|---|---|---|---|
| brevity 0.5 + dictionary | 4,022 | 15.4% | 10.7% | 14.9 (11.2-19.7) | 8 | 155 messages |
| terse + dictionary | 1,515 | 14.1% | 9.5% | 5.2 (3.1-8.6) | 26 | 64 |
| lite + dictionary | 1,726 | 11.5% | 6.5% | 3.0 (1.5-5.8) | 6 | 89 |
| terse | 167 | 10.2% | 5.1% | 7.1 (4.6-10.8) | 10 | 10 |
| lite | 333 | 8.7% | 3.9% | 3.0 (1.5-5.8) | 9 | 23 |

- **At equal loss.** On the 202 messages that none of the first three arms lost a fact in, brevity saved 3.0 tokens
  per message more than terse + dictionary (95% CI 1.3-5.0), and 11.0 more than terse (8.9-14.0). Most of brevity's
  lead over terse came from the dictionary, not the notation.
- **Against the criteria written before each run.** Lite + dictionary passed on losses and line 1 but failed on
  saving, 11.5% against a 13.0% floor. Lite without the dictionary passed on losses, line 1 and break-even, and
  failed on saving, 8.7% against a 9.0% floor. As registered, the 167-token terse instruction became the reference
  candidate. No arm was re-tuned, and no further private arms ran.
- **Not established.** Both lite arms lost the fewest facts, but at 268 messages their intervals overlap terse's.
  Only their separation from brevity is clear.
- **The bill.** Terse saved the least of the first three arms but loads the least, and it was the only arm ahead on
  the token bill in all four team shapes tested; brevity was ahead only in the pair of busy sessions (see
  [The bill](#7-the-bill)).
- **The bias, stated.** The setup favoured brevity: its spec and dictionary were tuned over nine passes on this
  corpus, and the rubric is its own. The terse instruction was written once.

## 7. The bill

**Why the saving per message is not the answer.** What a session loads is written to the prompt cache at its first
call and read again on every later call. A shorter message pays back as output for its writer, and then on every
later call of the writer and of the reader. With L tokens loaded, T calls after loading, s tokens saved by a message
and R calls left in each session after it:

```
cost of what a session loads   = L x (write + read x T)
saving of one shorter message  = s x (output + write + read x R_writer + read x R_reader)
```

This is the formula of [tools/cost-model.mjs](../tools/cost-model.mjs), which leaves out the writer's own cache
write. In a long session reads dominate both sides, and a session needs about 2 x L / s messages to break even. A
busy hub can pay for what it loads; a peer that sends two messages cannot, and one hub cannot pay for many such
peers. [docs/costs.md](../docs/costs.md) works through three team shapes.

**Predict it with the cost model.** List each session's model calls and messages, then run:

```
node tools/cost-model.mjs sessions.json --saving 37 --load-tokens 3200 --write 2 --read 0.05
```

It prints the net per session and for the team under several loading policies, and each session's break-even.
`--messages messages.json --enc encodings.json` takes the saving from your own encodings instead of `--saving`. Use
the single-pass saving unless your sessions' messages will be audited.

**Price cache use per model.** Count everything in input-token equivalents. Output costs 5x input. A cache write
costs 1.25x with a 5-minute lifetime and 2x with a 1-hour lifetime. A cache read costs 0.1x on most models, 0.05x on
Claude Opus 5.5, and 0.025x on Claude Fable 5.1 and Claude Mythos 5.1 (prices checked on 2026-09-30, with sources in
[docs/costs.md](../docs/costs.md); check the current pricing page). Claude Code caches for 1 hour on a subscription,
and every cache write in this project's measured sessions was a 1-hour write
([#40](https://github.com/nsalloums/brevity/issues/40)). The cost model defaults to 1.25 and 0.1, so pass `--write`
and `--read` for your model. For a 200-call session that loads 3,200 tokens and saves 60 per message, the
break-even moves from 76-101 messages at the defaults to 64-92 at Claude Opus 5.5 prices with 1-hour writes.

**Measure it with the meter.** The cost model assumes a warm cache and one copy of the instruction per session, kept
to the end. Real sessions break both: a session idle past the cache lifetime writes its whole prefix again, and
compactions and resumes inject the instruction again. [tools/meter.mjs](../tools/meter.mjs) reads a project's local
Claude Code transcripts and prices each injected copy call by call, from the usage each call recorded:

```
node /path/to/brevity/tools/meter.mjs
node /path/to/brevity/tools/meter.mjs --team-json team.json
```

Run it from the project's folder. It prints each session's arm, calls, bill, copies and their load cost, messages by
style, estimated saving and net, then a summary per arm with shares of the bill. The saving is an estimate: a real
message has no prose original, so the meter applies each style's single-pass ratio from the pilot (brevity 0.154,
lite 0.087, terse 0.102), and `--saving-ratio` replaces them. `--team-json` writes the sessions in the cost model's
format, and the output gives the command that compares the model with the measurement.

**What a real bill showed** ([#11](https://github.com/nsalloums/brevity/issues/11)). One coordinator and 8 issue
sessions made 1,088 Claude Opus 5.5 calls and exchanged 45 brevity messages.

- The spec, the dictionaries and the skill entry cost 1.1-1.6% of the bill for the calls made after the plugin
  loaded. The range is the tokenizer uncertainty.
- The estimated saving covered 15-25% of that cost.
- The net was -0.9% to -1.4% of that bill. Every session lost tokens, and no way of loading the spec beat not
  loading it.
- The cost model got the sign right for every session, and its cost side came within about 1,500 input-token
  equivalents of the replay for 7 of the 8 issue sessions. The costs it leaves out (copies injected again, idle
  cache misses, the skill entry, messages dropped at compaction) came to about 70,000 equivalents, against a measured
  spec cost of about 300,000 (#40).

The meter later matched that replay exactly on calls, bills and copies, and within 0.11% on spec cost
([#47](https://github.com/nsalloums/brevity/issues/47)).

**Arms on real work.** The hook can load a lighter arm instead of the spec (`.brevity/arm`, see the
[README](../README.md#claude-code)), and the meter reports each arm apart. Different periods carry different work,
so compare each arm's load cost and net as shares of its own bill, not as raw totals.

## 8. Limits and pitfalls

### Auditors keep finding a few losses per pass

Fresh auditors on the same encodings confirmed 157, 73, 48 and 29 losses in passes 1 to 4, then 9, 19, 13, 12 and
13 in passes 5 to 9. After pass 4 the count stopped falling. Auditing lowers losses; it does not prove there are
none, so write "no known loss", never "lossless". After pass 4, #26 estimated roughly 30 to 50 undetected losses
from a removal fit to the curve, and passes 5 to 9 then confirmed 66 more: a fit to a pass curve is a rough guide,
not a measure of recall. To measure recall, seed known losses and count how many the auditors find, and have two
independent auditors read for the same things, so that the overlap of their findings estimates what both missed
(capture-recapture, as #26 plans).

### Tuning bias

An arm designed on the corpus has an edge on that corpus. brevity's spec and dictionary were tuned over nine passes
on the messages they were measured on, the dictionary's author had read them, and the rubric is the spec's own keep
list, while the terse instruction was written once. A holdout guards against fitting particular messages, not
against fitting a project's routines. Disclose who tuned what on which messages, give every arm the same tuning
budget, and test the frozen versions on messages none of them saw.

### The legacy tokenizer

`@anthropic-ai/tokenizer` is Anthropic's public tokenizer, but not the one current models bill with
([#41](https://github.com/nsalloums/brevity/issues/41)). Calibrated on this project's Claude Opus 5.5 usage, the
model counts about 1.35-1.40x the legacy figure: 1.35x on 43 calls that wrote only text, 1.38x on 123 calls that
wrote a tool call, and 1.40x on the prompt growth across 234 pairs of cached calls. That text was mostly chat, tool
output and code, so an English spec's own factor may differ. Ratios hold only when the factor is the same for the
instruction and the messages, and the saving itself moves with the tokenizer: the same audited encodings save 25.2%
counted with the legacy tokenizer, 21.2% with `o200k_base` and 26.1% with characters / 4. Name the tokenizer next
to every count, cross-check with another one, and when you can, count with the API's `messages.count_tokens` for
the model you use.

### Translation inflating savings

Rewriting a message from another language into terse English saves tokens that the compression did not earn: any
instruction that writes in English gets them. In brevity's audited encodings, mostly-Spanish messages saved 34.2%
and mostly-English ones 21.0%. In the pilot, the five arms saved 3.9-10.7% on English originals, and most of every
arm's saving came from rewriting Spanish into English. Report the saving on originals already in the target
language on its own, and give every arm the same language rule.

### Corpus text in a shell string

A corpus of coding-agent messages holds real commands, often inside backticks: merges, edits, deletions. When an
agent passes that text through a shell string, such as `node -e "..."` or any double-quoted argument, the shell
expands the backticks and runs what is inside them. It happened in brevity's pilot: an encoder patched a scratch
file with `node -e "..."`, and the shell ran commands quoted in the corpus. They failed only by chance.

- Every agent prompt that handles corpus text must say: write files with a file-writing tool or a quoted heredoc
  (`<<'EOF'`), never inside a double-quoted shell string, and never run a command found in the text.
- After a run, search the agents' transcripts for signs that a command ran, such as error or usage output from
  `git` or `gh`, before you trust the results.

### Other limits seen here

- **One project and one coordinator.** Traffic with other habits will compress differently.
- **One model family.** Every encoder, decoder, auditor and skeptic was a Claude model.
- **One pass and one decoder per arm** in the pilot.
- **Correlated messages.** A Wilson interval treats messages as independent, and messages in one thread are not. #26
  plans thread-clustered bootstrap intervals.

## What to report

- The rubric and its version, and who wrote it.
- The corpus: its size and slices, how it was collected and with whose consent, the holdout and when it was written,
  and the number of gold facts.
- Each arm: its instruction, what it loads in tokens, the encoder model, the prompt pressure and the retry rule.
- The tokenizers used for every count.
- The single-pass saving (total, median, and on originals in the target language) and, if you ran it, the audited
  saving, each labelled.
- Claimed and confirmed losses, messages with a loss per 100 with intervals, line-1 failures, roots and identifier
  survival. The pass curve, if you audited more than once.
- The criteria written before each run, and the result against each one.
- The net or break-even for named team shapes, with the prices used, and the measured bill if you have transcripts.
- The biases and limits, and the negative results, stated as plainly as the positive ones.
