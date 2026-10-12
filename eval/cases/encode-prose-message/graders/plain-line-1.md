---
type: llm
---

The user asked for this message to be rewritten in brevity, a compact format for messages between agent sessions:
"Hi! Quick update: PR #41 is merged into main as 7c1e9a4b2. Please rebase your branch fix/cart-total onto main
and don't touch docs/CHANGELOG.md, I'm editing it. Send me your head SHA once CI is green. Thanks!"

Judge only the rewritten message, which is usually in a code block, not any explanation around it. Its line 1 is
its first line, a plain sentence meant for a human preview. In brevity, what line 1 says counts as said: a fact
stated only in line 1 survives, and the lines after it need not repeat it. Line 1 may be followed by one line such
as `(brevity spec: ...)` that points to the format; the other lines are statements that start with upper-case
keywords such as DO, NO, OWN, REPLY or MERGED. Read them as brevity defines them: `MERGED #41 sha` says #41 landed
as that commit, `DO x` asks the reader to do x, `NO x` forbids x, `OWN me: x` says the sender is editing x, and
`REPLY head WHEN ci=green` asks the reader to send back its head SHA once CI is green.

The `line-1-one-sentence` grader checks the shape of line 1: that it is one sentence, has no keyword or notation,
and has lines after it. Do not judge those here.

PASS if both hold:
- Line 1 is plain language that states a main fact of the message, such as the merge of #41 or the rebase request.
- Across the whole rewritten message, line 1 included, these facts all survive: #41 was merged into main as
  7c1e9a4b2; the reader is asked to rebase fix/cart-total onto main; the reader must not edit docs/CHANGELOG.md; the
  reader must send back its head SHA, and only once CI is green. The greeting, the thanks and the reason "I'm editing
  it" may be dropped or kept.

FAIL if line 1 is a topic label rather than a statement, if any fact above is missing or changed, if the request,
the prohibition or the CI condition is dropped, or if the reply contains no rewritten message.
