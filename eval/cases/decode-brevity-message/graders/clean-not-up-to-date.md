---
type: regex
# CLEAN means no conflict, not "up to date" (SPEC.md, section 4). Fails a sentence that names CLEAN or clean and
# "up to date" with no negation in it; a note such as "CLEAN does not mean up to date" passes.
pattern: '(?:^|[.!?\n])(?![^.!?\n]*(?:\bnot\b|n[’'']t\b|\bnever\b|\bnor\b|\bwithout\b))(?=[^.!?\n]*(?:\bCLEAN\b|\b[Cc]lean))(?=[^.!?\n]*\b[Uu]p[- ]to[- ]date\b)'
match: not_contains
---
