---
description: 'A project opted in with .brevity/DICT.md copied from DICT.template.md (README "Try it", prompt 3). The session hook loads the spec and the dictionary, so Claude answers without opening a file. Needs --scaffold.'
expected_outcome: 'Names .brevity/DICT.md for the synthetic acme-shop project and expands R.ready in full, with no Read or Grep call.'
tags: [hook]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

Which brevity dictionary is loaded, and what does R.ready mean?
