# Plugin eval suite

These cases run the brevity plugin under [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals), which
scores each case with the plugin loaded and again without it. The Claude plugin directory's pre-submission checklist
asks for that comparison. The cases follow the README's "Try it" prompts, and every message in them is synthetic.

| Case | What it checks |
|---|---|
| `encode-prose-message` | A prose message becomes a plain line 1 and verb lines that keep #41, the SHA, the branch, the file, the prohibition and the CI condition. |
| `decode-brevity-message` | A message that uses only spec notation decodes to plain language, with every condition and request. |
| `ignores-coding-request` | An ordinary coding request does not load the skill, in either arm, and gets no reply in brevity. |
| `opted-in-session` | In a project with `.brevity/DICT.md` copied from [DICT.template.md](../../DICT.template.md), the session hook loads the dictionary, and Claude expands `R.ready` without opening a file. |

## Run it

It needs Claude Code 2.1.269 or later, git 2.31 or later, Node.js on your `PATH` for the hook, and a logged-in
Claude Code. From the repository root:

```
claude plugin eval --eval-dir eval/cases --scaffold
```

- `--scaffold` runs `opted-in-session/scaffold.sh`, which copies DICT.template.md into the run's empty workspace as
  `.brevity/DICT.md`. The script runs as you, outside the run's sandbox. Without the flag, `opted-in-session` has no
  dictionary and fails; `--tag skill` runs only the other three cases.
- Each case runs 3 times with the plugin and 3 times without it, and each `llm` grader asks a judge model 3 times per
  run. All of it counts against your plan's usage or your API bill. To check one case cheaply, add
  `--case <name> --runs 1 --ablation none`.
- Results go to `eval/cases/results/`, which git ignores.
- The default `--threshold` is 1.0, so the command exits 1 when any grader fails in any run.

## Reading the scores

- The `skill-fired` graders show whether the `brevity` skill ran. In a run with and without the plugin they are
  indicators only and do not count toward the score. `skill-not-used` sets `arm: both`, so it counts in both arms.
- brevity is meant to be readable without the spec, so Claude may decode `decode-brevity-message` well without the
  plugin, and its `Δ` can be small.
- The hook looks for a `.brevity/` folder from the run's temporary workspace upwards. If a `.brevity/` folder sits
  above that workspace (on Windows the temporary directory is usually inside your home folder), every case is opted
  in, and the spec loads into all their runs with the plugin.
