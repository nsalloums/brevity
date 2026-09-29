# Decision-relevance rubric

This rubric decides which facts a brevity encoding must keep. The same text sits, shorter, in section 6 of
[SPEC.md](../SPEC.md). It was written before the measurement run, and every audit prompt in that run quotes it in
full, so a "zero loss" result means zero loss **under this rubric**, which you can read and disagree with.

## The test

A fact is decision-relevant when a recipient holding only the encoding could **act, write, wait, answer or merge
differently** than a recipient holding the original. In doubt, it is decision-relevant.

## KEEP (always decision-relevant)

1. **Identifiers.** Commit SHAs (a prefix of at least 9 hex, or the original length if shorter), PR and issue
   numbers (and which one it is, when the original says), branch names, file paths, file:line ranges, run and job
   ids, CI check names, commands the recipient is asked to run, and code names (keys, functions, classes, env vars)
   that say what is touched, changed, asked about or to be checked.
2. **Numbers.** Every count, diffstat, entry number, error count, line number, date and time. A number may lose
   its narrative, never its value or what it counts.
3. **Statuses.** PR state, merge state, CI state per check, deploy steps and their conclusions, skipped steps.
4. **Findings and verification outcomes.** What was found or checked, on which commit or tree, the result, and
   its counts.
5. **Actors and owners.** Who owns, edits, touches, runs or waits for what.
6. **Decision authors.** Who decided (the owner, the coordinator, a session, jointly), with the date when given.
7. **Order.** Merge order, numbering, step sequences, "before" and "after".
8. **Conditions.** If, unless, until, when, and their exact scope; waits and holds.
9. **Speech acts.** Requests, prohibitions, questions (a question stays a question), answers (to which question),
   commitments, go-aheads, corrections (what is superseded, and the new value), retractions, report-back requests
   (what to send, when), relays (tell X that ...).
10. **Warnings.** Hazards the recipient must know.
11. **Verbatim text.** UI strings, text to find or replace, commit subjects, error lines, anyone's quoted words.
12. **Qualifiers.** Only, all, first, not yet, still, uncommitted, placeholder, approximate, should vs must, and
    stated uncertainty (probably, unverified, unknown).

## MAY DROP (not decision-relevant)

1. Greetings, thanks, apologies, sign-offs, politeness.
2. Sender identity and role framing ("Coordinator:", "I coordinate at the owner's request"): the transport already
   names the sender. An owner's authority behind a specific request is kept as `by=owner`.
3. Read-backs: the recipient's own request echoed back to confirm it (`ACK` replaces them).
4. Standing rules restated as written in the project dictionary: cite them as `R.name`. Whatever differs from the
   rule is kept.
5. Background and rationale that change nothing the recipient does or writes.
6. How a finding was reached: the evidence chain, tools, environment, harness construction, unless the message is
   about the method, disputes it, or asks for a re-check. Numbers inside it stay (KEEP 2); code names inside it
   stay only when KEEP 1 names them.
7. Repetition inside the same message.
8. The source language. Content may be restated in terse English; quoted text stays verbatim (KEEP 11).

## Versions

- **v1** (2026-09-28, before any measurement): used for the 30-message calibration run.
- **v2** (2026-09-28, after calibration, before the full run): code names are KEEP when they say what is touched,
  changed, asked about or to be checked, and may go with a dropped evidence chain; MAY DROP 6 names the evidence
  chain explicitly; MAY DROP 8 added. Reason: v1 read "every code name" literally, which forced whole evidence
  chains into the encoding and kept compression near 20% with no gain for the recipient's decisions. Every
  audit in the full run quotes v2.

## Severity when auditing

- **decision**: the fact is in KEEP, or fails the test above.
- **incidental**: the fact is in MAY DROP, or the auditor can say concretely why no recipient action could depend
  on it. An incidental finding must quote the MAY DROP clause or give that reason.

Loss causes: `encoder-omitted` (not in the encoding), `encoder-altered` (the encoding states it wrongly),
`decoder-misread` (the encoding is right, the blind decoder read it wrong), `spec-ambiguous` (the encoding is
right, but the spec does not let a fresh reader decode it reliably). An added false fact is a loss too.
