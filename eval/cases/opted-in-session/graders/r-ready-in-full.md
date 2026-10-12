---
type: llm
---

The user asked which brevity dictionary is loaded and what R.ready means. The loaded dictionary is .brevity/DICT.md,
for a synthetic project called acme-shop. In it, R.ready is defined as: head pushed; check «ui: build + test»
passes; the pull request is OPEN, not a draft, and CLEAN; the head contains current main; the owner's merge command
is `gh pr merge N --squash`; the sender does not merge.

PASS if the reply gives all six parts of R.ready above, in any wording or order. Parts may share a list item or a
sentence, so count the parts, not the items: a list of five items, one of which gives both the owner's merge command
and that the sender does not merge, has all six. Notes on how R.ready is used, such as when a message may claim it,
are not part of the definition.

FAIL if the reply says no dictionary is loaded, leaves out any of the six parts, changes one (for example, says the
sender merges, or names a different check or merge command), or adds to R.ready a requirement that is not in the
definition.
