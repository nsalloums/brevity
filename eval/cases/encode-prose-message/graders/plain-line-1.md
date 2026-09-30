---
type: llm
---

The user asked for this message to be rewritten in brevity, a compact format for messages between agent sessions:
"Hi! Quick update: PR #41 is merged into main as 7c1e9a4b2. Please rebase your branch fix/cart-total onto main
and don't touch docs/CHANGELOG.md, I'm editing it. Send me your head SHA once CI is green. Thanks!"

Judge only the rewritten message, which is usually in a code block, not any explanation around it. Its line 1 is
meant for a human preview; the lines after it are statements that start with upper-case keywords such as DO, NO,
REPLY or MERGED.

PASS if both hold:
- Line 1 is one plain-language sentence that states a main fact of the message, such as the merge of #41 or the
  rebase request. It does not start with an upper-case keyword and uses no notation such as `->` or `ci=green`.
- Across the whole rewritten message, these facts all survive: #41 was merged into main as 7c1e9a4b2; the reader is
  asked to rebase fix/cart-total onto main; the reader must not edit docs/CHANGELOG.md; the reader must send back
  its head SHA, and only once CI is green. The greeting, the thanks and the reason "I'm editing it" may be dropped.

FAIL if line 1 is a topic label or starts with a keyword, if any fact above is missing or changed, if the request,
the prohibition or the CI condition is dropped, or if the reply contains no rewritten message.
