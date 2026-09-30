---
description: 'Encode a prose message with a PR number, a SHA, a request, a prohibition and a condition (README "Try it", prompt 1).'
expected_outcome: 'A plain first line, then verb lines such as NO edits to docs/CHANGELOG.md and REPLY head WHEN ci=green, keeping #41, 7c1e9a4b2, fix/cart-total and docs/CHANGELOG.md.'
tags: [skill]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

Rewrite this for another agent session in brevity: "Hi! Quick update: PR #41 is merged into main as 7c1e9a4b2. Please rebase your branch fix/cart-total onto main and don't touch docs/CHANGELOG.md, I'm editing it. Send me your head SHA once CI is green. Thanks!"
