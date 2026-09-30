# Results

brevity was measured on real agent traffic before release. This page reports aggregate numbers only: the
messages come from a private project, so no message text, name or path from them appears here.

## Summary

| | before | after | saving |
|---|---|---|---|
| Corpus, 229 messages, total tokens | 55,128 | 41,122 | **25.4%** |
| Holdout, 39 messages, total tokens | 8,733 | 6,654 | **23.8%** |
| All 268, total tokens | 63,861 | 47,776 | **25.2%** |
| All 268, median tokens per message | 201 | 160.5 | median per-message saving 23.6% |

- **The 50% target was not reached.** The best result with no known decision-relevant loss is about 25% fewer
  tokens. Encoders that aimed at 50% reached 35% on their first pass and dropped a decision-relevant fact in 111 of
  268 messages (41%); repairing those cost the difference.
- **No known decision-relevant loss.** Each message was blind-decoded and audited in nine full passes. Every loss
  the audits confirmed was fixed and re-audited. The last full pass still found 13 new ones (all fixed), so
  auditing is not proof: expect a few undetected losses.
- **Why this is lower than the 0.2.0 figure.** Until 0.4 this page reported the result of four passes. Five more
  found facts those four had missed, and restoring them cost tokens:

  | All 268 messages | before | after 4 passes (0.2.0) | after 9 passes (now) |
  |---|---|---|---|
  | total tokens | 63,861 | 46,521 (27.2%) | 47,776 (25.2%) |
  | median tokens per message | 201 | 152 | 160.5 |

  Passes 5 to 9 confirmed 66 new decision-relevant losses on their first read: 58 were encoder errors, 5 decoder
  errors and 3 came from the spec, which was clarified each time. The clarifications change no encoding by
  themselves; the 1,255 extra tokens (about 4.7 per message) are the restored facts.
- **Identifiers: 0 missing.** A deterministic check ([tools/idcheck.mjs](../tools/idcheck.mjs)) finds 2,637
  identifiers in the originals (SHAs, #N, file:line numbers, numbers >= 10, «quotes»), and all of them are in the
  encodings.
- **The holdout behaves like the corpus** (23.8% vs 25.4%). Its 39 messages were written after the spec and the
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
| Anthropic legacy | 63,861 | 47,776 | 25.2% | 201 -> 160.5 |
| o200k_base | 60,389 | 47,575 | 21.2% | 197.5 -> 157.5 |
| characters / 4 | 55,171 | 40,784 | 26.1% | 178 -> 133.5 |

## Where the saving comes from (Anthropic legacy tokenizer)

| slice | messages | saving |
|---|---|---|
| short (<120 tokens) | 38 | 20.7% |
| medium (120-299) | 162 | 21.5% |
| long (>=300) | 68 | 29.7% |
| received by the coordinator | 110 | 29.5% |
| sent by the coordinator | 158 | 20.6% |
| mostly Spanish (content rewritten in terse English, quotes kept) | 70 | 34.2% |
| mostly English | 198 | 21.0% |

- On average each message saves 60.0 tokens. 18 of 268 messages came out longer than their originals, by 2 to 27
  tokens each (at most 13% of the original; 180 tokens in all). Their originals run from 80 to 325 tokens, so this is not only a
  short-message effect. In these messages, the plain-language line 1 and the explicit slots cost more than dropping
  the framing saved.
- Line 1, the plain sentence a human sees in the preview, is 12.6% of the encoded tokens. Without it the saving
  would be about 35%, but line 1 carries facts that the body does not repeat.
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
7. **Repeat full passes.** Each pass starts from the previous pass's fixed encodings. When a loss came from the
   spec, the spec was clarified before a later pass, not after every pass. The text each pass ran on:
   - passes 1-3: 0.2 revisions 1-3; pass 3's text is the published one minus one clarifying clause;
   - pass 4: 0.2 as published (0.3 and 0.4 kept its text);
   - passes 5 and 6: 0.4 rev. 1, which adds 13 clarifications of points blind decoders had flagged (#9);
   - passes 7 and 8: 0.4 rev. 2, which adds that `MERGEABLE` and `CLEAN` hold together and when an unanswered
     question is due;
   - pass 9: 0.4 rev. 3, which adds that a verb on a `- ` line keeps its default actor.

   The text now published, rev. 4, restores 0.4's `HOLD me UNTIL c` reading, which rev. 1-3 had dropped, and
   shortens wording that no message decodes by. It was not given a full pass: the messages whose encodings use
   HOLD were blind-decoded and audited again on it (see below the table).

| pass | spec | messages | claimed losses | confirmed (messages) | cause: encoder / spec / decoder | total saving after the pass |
|---|---|---|---|---|---|---|
| calibration | 0.2 draft | 30 | 5 | 4 (4) | 3 / 1 / 0 | 21.4% |
| 1 | 0.2 rev. 1 | 268 | 216 | 157 (111) | 143 / 10 / 4 | 35.1% first draft, then fixes |
| 2 | 0.2 rev. 2 | 268 | 95 | 73 (62) | 69 / 4 / 0 | 29.7% |
| 3 | 0.2 rev. 3 | 268 | 64 | 48 (45) | 44 / 2 / 2 | 28.0% |
| 4 | 0.2 (published) | 268 | 38 | 29 (28) | 27 / 1 / 1 | 27.2% |
| 5 | 0.4 rev. 1 | 268 | 11 | 9 (9) | 8 / 1 / 0 | 26.9% |
| 6 | 0.4 rev. 1 | 268 | 21 | 19 (18) | 17 / 1 / 1 | 26.4% |
| 7 | 0.4 rev. 2 | 268 | 16 | 13 (13) | 13 / 0 / 0 | 25.9% |
| 8 | 0.4 rev. 2 | 268 | 15 | 12 (12) | 11 / 1 / 0 | 25.5% |
| 9 | 0.4 rev. 3 | 268 | 18 | 13 (12) | 9 / 0 / 4 | 25.2% |

Losses left after a pass's fix loop (9, 5 and 4 in passes 1-3; 0, 4, 3, 1 and 2 in passes 5-9) were fixed by
hand from the skeptic's notes and re-verified in the next pass. One hand fix after pass 8 stated more than its
original did, and pass 9 caught it. The 4 left after pass 4 and the 2 left after pass 9 were blind-decoded and
audited once more on their own; that check found 2 more in one of the pass-9 messages, fixed and re-audited clean.

On rev. 4, the 22 messages whose final encodings use HOLD were blind-decoded, audited through both lenses and
checked by the skeptic again. There were 0 claimed decision-relevant losses, and both lines in the `HOLD me UNTIL c`
or `HOLD you UNTIL c` form decoded with the right actor. Encodings did not change, so the totals above stand.

## Break-even

The spec is 2,674 tokens (Anthropic legacy tokenizer), and a small dictionary adds about 500. They sit in the
context of every session that loads them. A message saves about 60 tokens twice: in the sender's context and in
the recipient's. On current Claude pricing, output costs 5x input and a cached context read costs 0.1x input, so
for a session making about 200 model calls:

- the spec costs about 3,200 x (1.25 + 0.1 x 200) ≈ 68k input-token equivalents;
- a message the session sends saves about 60 x 5 (output) + 60 x 0.1 x 100 (carried for half the session) ≈ 900;
  one it receives saves about 675.

So a session needs roughly **76-101 messages** before the spec pays for itself
(`node tools/cost-model.mjs --saving 60 --load-tokens 3200 --turns 200`). At 0.2.0, with a 2,641-token spec and
about 65 tokens saved per message, the same tool gives 68-91; this page said 70-95, a rounded hand estimate. In the measured project, the
coordinating session exchanged 268 messages and paid off. The median peer session exchanged 2 and would have lost
tokens. That is why the Claude Code plugin loads the spec only in projects that opt in with a `.brevity/` folder.

## Limitations

- **One project and one coordinator.** Traffic with other habits, such as fewer ledger rituals or more free-form
  discussion, will compress differently.
- **The dictionary author had read the corpus.** The holdout guards against overfitting to specific messages, but
  not against the dictionary fitting this project's rituals well.
- **Same model family.** Encoders, decoders, auditors and skeptics were all Claude agents. A decoder from another
  vendor was not tested.
- **The auditors miss things.** Each new full pass found losses the previous one missed (157, 73, 48, 29, then
  9, 19, 13, 12, 13). After pass 4 the count stopped falling: fresh auditors keep finding a dozen or so per pass.
- **Encoders had help real senders lack.** They had a token counter and the identifier check. Real senders will
  make the pass-1 kind of mistakes more often than the final numbers suggest.
- **Approximate tokenizer.** The Anthropic count uses the legacy tokenizer, not the one current models use.
