---
description: 'Decode a brevity message that uses only spec notation (README "Try it", prompt 2).'
expected_outcome: 'A plain-language list with the hold on #57 until #55 lands, entry 12 replacing 11, and both branches of the CI condition.'
tags: [skill]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

Decode this brevity message and tell me what I have to do:

```
#57 must wait for #55, then take changelog entry 12.
HOLD merge of #57 UNTIL #55 lands
FIX entry 11 -> 12 (mine)
IF CI fails THEN REPLY failing check WHEN now ELSE REPLY head WHEN ci=green CLEAN
```
