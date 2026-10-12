---
type: regex
# A NO line for docs/CHANGELOG.md, and the reply request with its CI condition either as a REPLY ... WHEN line or
# in line 1 (SPEC.md section 2: what line 1 says counts as said). Line 1 is the first line after the reply's first
# ``` fence, or the reply's first line when it has no fence.
pattern: '^(?=[\s\S]*^NO .*docs/CHANGELOG\.md)(?=[\s\S]*^REPLY .*\bWHEN .*(?:ci=green|CI green)|(?<![\s\S])(?:(?:(?!```)[\s\S])*```.*\n|(?![\s\S]*```))(?=.*\bhead\b)(?=.*(?:\bCI\b.*\bgreen\b|ci=green)))'
flags: m
---
