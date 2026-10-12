---
type: regex
# Each lookahead finds one line that says one point in plain words, outside `code spans`, so quoting the brevity
# line does not count: the hold on #57 until #55 merges or lands; 11 and 12 (the correction); a failing check sent
# right away; the head or SHA sent once CI is green or passes and the pull request is CLEAN or has no conflicts.
pattern: '^(?=[\s\S]*?(?:^|\n)(?=(?:[^\n`]|`[^`\n]*`)*?\b(?:[Uu]ntil|[Aa]fter|[Oo]nce|[Ww]ait\w*|[Bb]efore|first)\b)(?=(?:[^\n`]|`[^`\n]*`)*?#55\b)(?=(?:[^\n`]|`[^`\n]*`)*?\b(?:[Mm]erg\w*|[Ll]ands?|landed|landing)\b))(?=[\s\S]*?(?:^|\n)(?=(?:[^\n`]|`[^`\n]*`)*?\b11\b)(?=(?:[^\n`]|`[^`\n]*`)*?\b12\b))(?=[\s\S]*?(?:^|\n)(?=(?:[^\n`]|`[^`\n]*`)*?\b[Ff]ail)(?=(?:[^\n`]|`[^`\n]*`)*?\bcheck)(?=(?:[^\n`]|`[^`\n]*`)*?\b(?:right away|immediately|straight away|at once|now)\b))(?=[\s\S]*?(?:^|\n)(?=(?:[^\n`]|`[^`\n]*`)*?(?:\bhead\b|\bSHA\b|latest commit))(?=(?:[^\n`]|`[^`\n]*`)*?\b(?:green|pass\w*)\b)(?=(?:[^\n`]|`[^`\n]*`)*?(?:\bCLEAN\b|\b[Cc]lean|conflict|\bmergeable\b)))'
---
