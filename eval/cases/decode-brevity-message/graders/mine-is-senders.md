---
type: regex
# "(mine)" marks the corrected 11 as the sender's own (SPEC.md, FIX). Fails a line that mentions "mine" and gives it
# to the reader (your job, your PR, yours, belongs to you, you make...), or says the reader gave the 11 or made the
# mistake. A line that also says "not yours", "theirs", "their own" or "their mistake" reads it the right way and
# is skipped.
pattern: '(?:^|\n)(?![^\n]*(?:\bnot yours\b|\btheirs\b|\btheir own\b|\btheir (?:earlier )?(?:mistake|error|number|value)\b|\bsender[’'']s own\b))(?:(?=[^\n]*\b[Mm]ine\b)(?=[^\n]*(?:\b[Yy]our (?:job|PR|pull request|(?:changelog )?entry|edit|fix|change)\b|\byours\b|\bbelongs? to you\b|\bbelonging to you\b|\b[Yy]ou own\b|\b[Yy]ou make\b|\bon you\b|\b[Yy]ou(?:[’'']re| are) the one\b|\b[Yy]ou should make\b))|(?=[^\n]*\b[Yy]ou (?:gave|said|set|picked|chose|wrote)\b[^.\n]*\b11\b)|(?=[^\n]*(?<!\bnot |n[’'']t )\b[Yy]our (?:own )?(?:mistake|error)\b))'
match: not_contains
---
