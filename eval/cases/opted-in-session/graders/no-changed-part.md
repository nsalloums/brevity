---
type: regex
# Fails a reply that changes a part of R.ready: a sentence that says the sender or the session merges or runs the
# merge, with no negation in it; a merge command other than `gh pr merge N --squash` (another merge flag, or the
# command closed without --squash); or CLEAN explained as "up to date" (SPEC.md, section 4: CLEAN is no conflict).
pattern: '(?:^|[.!?\n])(?![^.!?\n]*(?:\bnot\b|n[’'']t\b|\b[Nn]ever\b|\b[Nn]o\b|\bnor\b))[^.!?\n]*?\b(?:sender|sending session|reporting session|session)\s+(?:(?:then|also|itself|can|may|should|will|must)\s+)?(?:merges?|runs?\s+(?:`?gh pr merge|`?mcmd|the merge))\b|gh pr merge\b[^\n`]*?--(?:merge|rebase|admin|auto)\b|gh pr merge +(?:N|#?\d+|<[^>\n]+>)\s*`|\bCLEAN\b(?:\s*\(|,?\s+(?:means|meaning|i\.e\.,?|that is,?|which means)\s+)(?![^\n.;)]{0,40}(?:\bnot\b|n[’'']t\b)[^\n.;)]{0,20}\b[Uu]p[- ]to)[^\n.;)]{0,40}\b[Uu]p[- ]to[- ]date\b|\b[Uu]p[- ]to[- ]date\b[^\n.;(]{0,20}\(\s*CLEAN\s*\)'
match: not_contains
---
