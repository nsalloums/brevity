---
type: llm
---

The user asked which brevity dictionary is loaded and what R.ready means. The loaded dictionary is .brevity/DICT.md,
for a synthetic project called acme-shop. In it, R.ready is defined as: head pushed; check «ui: build + test»
passes; the pull request is OPEN, not a draft, and CLEAN; the head contains current main; the owner's merge command
is `gh pr merge N --squash`; the sender does not merge.

PASS if the reply gives all six parts of R.ready above, in any wording or order.

FAIL if the reply says no dictionary is loaded, leaves out any of the six parts, changes one (for example, says the
sender merges, or names a different check or merge command), or adds a requirement that is not in the definition.
