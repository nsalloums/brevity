# Results

brevity was measured on real agent traffic before release. This page reports aggregate numbers only: the
messages come from a private project, so no message text, name or path from them appears here.

## Summary

| | before | after | saving |
|---|---|---|---|
| Corpus, 229 messages, total tokens | 55,128 | 40,050 | **27.4%** |
| Holdout, 39 messages, total tokens | 8,733 | 6,471 | **25.9%** |
| All 268, total tokens | 63,861 | 46,521 | **27.2%** |
| All 268, median tokens per message | 201 | 152 | median per-message saving 25.7% |

- **The 50% target was not reached.** The best result with no known decision-relevant loss is about 27% fewer
  tokens. Encoders that aimed at 50% reached 35% on their first pass and dropped a decision-relevant fact in 111 of
  268 messages (41%); repairing those cost the difference.
- **No known decision-relevant loss.** Each message was blind-decoded and audited in four full passes. Every loss
  the audits confirmed was fixed and re-audited. The last full pass still found 29 new ones (all fixed), so
  auditing is not proof: expect a few undetected losses.
- **Identifiers: 0 missing.** A deterministic check ([tools/idcheck.mjs](../tools/idcheck.mjs)) finds 2,637
  identifiers in the originals (SHAs, #N, file:line numbers, numbers >= 10, «quotes»), and all of them are in the
  encodings.
- **The holdout behaves like the corpus** (25.9% vs 27.4%). Its 39 messages were written after the spec and the
  dictionary, and nobody who designed them saw those messages.
- **It pays off only in busy sessions**: see [Break-even](#break-even).

## Data

- **Source.** Cross-session messages, in both directions, of one coordinating Claude Code session that worked with
  10-25 parallel sessions on a private software project over 16 days. They were extracted from its transcript with
  [tools/measure.mjs](../tools/measure.mjs).
- **Corpus.** 229 messages (91 received, 138 sent): 32 short (<120 tokens), 137 medium, 60 long (>=300 tokens),
  and 51 mostly in Spanish.
- **Holdout.** 39 later messages (19 received, 20 sent), 19 of them mostly in Spanish.
- **Dictionary.** The project's dictionary has 21 lines and 1,348 tokens and stays private.
  [DICT.template.md](../DICT.template.md) shows the format with a synthetic project.
- **Gold standard.** 2,537 atomic facts extracted from the corpus in advance, used as a checklist by the auditors.
  The original text was always the authority.

## Tokenizers

The primary count uses `@anthropic-ai/tokenizer` 0.0.4, Anthropic's public tokenizer. It is the legacy one, and
current Claude models tokenize differently, so treat the absolute numbers as approximate. The same encodings were
also counted with `o200k_base` (js-tiktoken) and with characters / 4:

| All 268 messages | before | after | saving | median before -> after |
|---|---|---|---|---|
| Anthropic legacy | 63,861 | 46,521 | 27.2% | 201 -> 152 |
| o200k_base | 60,389 | 46,310 | 23.3% | 197.5 -> 154 |
| characters / 4 | 55,171 | 39,537 | 28.3% | 178 -> 127 |

## Where the saving comes from (Anthropic legacy tokenizer)

| slice | messages | saving |
|---|---|---|
| short (<120 tokens) | 38 | 22.3% |
| medium (120-299) | 162 | 24.2% |
| long (>=300) | 68 | 30.9% |
| received by the coordinator | 110 | 31.1% |
| sent by the coordinator | 158 | 22.9% |
| mostly Spanish (content rewritten in terse English, quotes kept) | 70 | 35.9% |
| mostly English | 198 | 23.1% |

- On average each message saves 64.7 tokens. 13 of 268 messages came out longer than their originals: all were
  short ones, where the plain-language line 1 costs more than the framing it replaces.
- Line 1, the plain sentence a human sees in the preview, is 12.7% of the encoded tokens. Without it the saving
  would be about 36%, but line 1 carries facts that the body does not repeat.
- About 28% of the original tokens are identifiers, verbatim quotes and code, which must survive as written
  (regex estimate).

## Method

1. **Rubric first.** [RUBRIC.md](RUBRIC.md) fixes what "decision-relevant" means: identifiers, numbers,
   statuses, owners, decision authors, order, conditions, requests, questions, corrections, warnings, quotes and
   qualifiers. It was written before any measurement and revised once, after the 30-message calibration; its
   Versions section says what changed and why. Every audit prompt quotes it in full.
2. **Encode.** One agent per batch of 13-14 messages, with only the originals, SPEC.md and the dictionary. The
   batches were interleaved, so no batch held a whole thread. Encoders had to pass the identifier check.
3. **Blind decode.** A fresh agent that sees only SPEC.md, the dictionary and the encodings renders every
   message in full plain English.
4. **Audit through two lenses.** Independent agents compare the original, the gold facts and the blind decoding.
   One lens covers identifiers and quantities, the other meaning and line 1. They report every lost, altered or
   added fact with its rubric clause.
5. **Skeptic.** A separate agent confirms or refutes each claimed decision-relevant loss. It may refute only by
   quoting the decoded text, showing the fact is not in the original, or citing a MAY DROP clause. When uncertain,
   it confirms.
6. **Fix loop.** Confirmed losses are re-encoded, blind-decoded by a new agent, re-audited and re-verified.
7. **Repeat full passes.** Between passes the spec was clarified wherever a loss came from the spec. Pass 4 ran on
   the published spec; pass 3 ran on the same text minus one clarifying clause.

| pass | spec | messages | claimed losses | confirmed (messages) | cause: encoder / spec / decoder | total saving after the pass |
|---|---|---|---|---|---|---|
| calibration | 0.2 draft | 30 | 5 | 4 (4) | 3 / 1 / 0 | 21.4% |
| 1 | 0.2 rev. 1 | 268 | 216 | 157 (111) | 143 / 10 / 4 | 35.1% first draft, then fixes |
| 2 | 0.2 rev. 2 | 268 | 95 | 73 (62) | 69 / 4 / 0 | 29.7% |
| 3 | 0.2 rev. 3 | 268 | 64 | 48 (45) | 44 / 2 / 2 | 28.0% |
| 4 | 0.2 (published) | 268 | 38 | 29 (28) | 27 / 1 / 1 | 27.2% |

Losses left after a pass's fix loop (9, 5 and 4) were fixed by hand from the skeptic's notes and re-verified in
the next pass. The 4 left after pass 4 were blind-decoded and audited once more on their own.

## Break-even

The spec is 2,641 tokens (Anthropic legacy tokenizer), and a small dictionary adds about 500. They sit in the
context of every session that loads them. A message saves about 65 tokens twice: in the sender's context and in
the recipient's. On current Claude pricing, output costs 5x input and a cached context read costs 0.1x input, so
for a session making about 200 model calls:

- the spec costs about 3,100 x (1.25 + 0.1 x 200) ≈ 66k input-token equivalents;
- a message the session sends saves about 65 x 5 (output) + 65 x 0.1 x 100 (carried for half the session) ≈ 975;
  one it receives saves about 700.

So a session needs roughly **70-95 messages** before the spec pays for itself. In the measured project, the
coordinating session exchanged 268 messages and paid off. The median peer session exchanged 2 and would have lost
tokens. That is why the Claude Code plugin loads the spec only in projects that opt in with a `.brevity/` folder.

## Limitations

- **One project and one coordinator.** Traffic with other habits, such as fewer ledger rituals or more free-form
  discussion, will compress differently.
- **The dictionary author had read the corpus.** The holdout guards against overfitting to specific messages, but
  not against the dictionary fitting this project's rituals well.
- **Same model family.** Encoders, decoders, auditors and skeptics were all Claude agents. A decoder from another
  vendor was not tested.
- **The auditors miss things.** Each new full pass found losses the previous one missed (157, 73, 48, 29).
- **Encoders had help real senders lack.** They had a token counter and the identifier check. Real senders will
  make the pass-1 kind of mistakes more often than the final numbers suggest.
- **Approximate tokenizer.** The Anthropic count uses the legacy tokenizer, not the one current models use.
