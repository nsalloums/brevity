---
description: 'An ordinary coding request that mentions a pull request but has nothing to do with brevity. The skill must not load and the reply must not be in brevity.'
expected_outcome: 'A JavaScript function, with no brevity skill call in either arm.'
tags: [skill, negative]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

Write a JavaScript function parsePullRequestUrl(url) that takes a GitHub pull request URL such as https://github.com/acme/shop/pull/41 and returns { owner, repo, number }, or null for any other URL. Reply with the code only.
