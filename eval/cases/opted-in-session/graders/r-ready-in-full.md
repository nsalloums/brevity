---
type: regex
# R.ready in DICT.template.md: head pushed; ck.ui pass; OPEN, not draft, CLEAN; head contains current main; the
# owner's command is mcmd N; the sender does not merge. Each lookahead finds one line that gives one part, so parts
# may share a line or a list item: the head pushed; «ui: build + test» (or ck.ui) passes; open, not a draft, and
# CLEAN or free of conflicts; the head, branch or PR contains, includes or is up to date with current main; the owner
# with `gh pr merge N --squash` (or mcmd); the sender, the session or whoever reports it does not or never merges.
pattern: '^(?=[\s\S]*?(?:^|\n)(?=[^\n]*?\b(?:[Hh]ead|commit)\b)(?=[^\n]*?\b(?:[Pp]ush(?:ed|es)?|on the remote|on origin)\b))(?=[\s\S]*?(?:^|\n)(?=[^\n]*?(?:ui: build \+ test|\bck\.ui\b))(?=[^\n]*?\b(?:[Pp]ass(?:es|ed|ing)?|green|succeed(?:s|ed)?|successful(?:ly)?)\b))(?=[\s\S]*?(?:^|\n)(?=[^\n]*?\b(?:OPEN|[Oo]pen)\b)(?=[^\n]*?(?:\bnot\b|n[’'']t\b|\bnon-|\bno\b)[^\n,;]{0,12}?\b[Dd]rafts?\b)(?=[^\n]*?(?:\bCLEAN\b|\b[Cc]lean\b|\bconflict|\bmergeable\b)))(?=[\s\S]*?(?:^|\n)(?=[^\n]*?\b(?:[Hh]ead|[Bb]ranch|PR)\b)(?=[^\n]*?\bmain\b)(?=[^\n]*?(?:\bcontain|\binclud|\b[Uu]p[- ]to[- ]date\b|\bancestor\b|\brebased\b|\bon top of\b))(?=[^\n]*?\b(?:current|latest|tip|newest|[Uu]p[- ]to[- ]date)\b))(?=[\s\S]*?(?:^|\n)(?=[^\n]*?\b[Oo]wner)(?=[^\n]*?(?:gh pr merge \S+ --squash|\bmcmd\b)))(?=[\s\S]*?(?:^|\n)(?=[^\n]*?\b(?:[Ss]ender|[Ss]ending|[Ss]essions?|[Ww]hoever|who reports|[Aa]gent)\b)(?=[^\n]*?(?:(?:\bnot\b|n[’'']t\b|\b[Nn]ever\b|\b[Nn]o\b)[^\n.;]{0,40}?\bmerg(?:e|es|ed|ing)\b|\bself-merg)))'
---
