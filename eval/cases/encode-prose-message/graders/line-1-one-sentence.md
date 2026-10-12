---
type: regex
# The rewritten message is the first fenced code block, or the whole reply when it has none. Its line 1 must be one
# sentence (no ". ", "! " or "? " followed by more text; a semicolon is fine), must not start with a brevity verb
# or hold notation such as -> or ci=green, and must be followed by another non-empty line of the message. A
# message written as one line of several sentences fails.
pattern: '^(?:(?:(?!```)[\s\S])*```[^\n]*\n|\s*(?![\s\S]*```))[ \t]*(?!(?:DO|NO|REPLY|ASK\d?|A\d|WILL|DONE|IF|HOLD|GO|DEC|FIX|WARN|WHY|CHK|FILES|OWN|TELL|ORDER|NUM|HDR|MERGED|READY|ACK)\b)(?![^\n]*(?:->|\w=\w))(?=[^\n]*\S)(?:(?![.!?][^\w\s]*[ \t]+\S)[^\n])*\n[ \t]*(?!```)\S'
---
