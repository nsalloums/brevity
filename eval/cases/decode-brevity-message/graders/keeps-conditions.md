---
type: llm
---

The user asked for this brevity message to be decoded into what they have to do:

```
#57 must wait for #55, then take changelog entry 12.
HOLD merge of #57 UNTIL #55 lands
FIX entry 11 -> 12 (mine)
IF CI fails THEN REPLY failing check WHEN now ELSE REPLY head WHEN ci=green CLEAN
```

PASS if the reply, in plain language, says all of these:
- #57 must not be merged until #55 has landed (been merged).
- #57 takes changelog entry 12, which corrects an earlier 11. Saying who gave the 11 is optional.
- If CI fails, the reader sends back the failing check right away.
- Otherwise, the reader sends back the head (commit SHA) once CI is green and the pull request is CLEAN. CLEAN may be
  kept as the word or explained as mergeable with no conflicts.

FAIL if any of these is missing, if a condition is dropped or reversed (for example, sending the head without
waiting for green CI, or merging #57 before #55), if it says the reader gave the earlier 11, or if it explains
CLEAN as "up to date with the base branch".
