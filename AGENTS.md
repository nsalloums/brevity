# Working on brevity

brevity is a protocol, [SPEC.md](SPEC.md), plus the adapters that load it into coding agents. These rules apply
to anyone changing this repository, human or agent.

## Layout

- `SPEC.md` is the source of truth. `skills/brevity/SPEC.md` and `adapters/cursor/brevity.mdc` are generated from
  it by `node tools/build-adapters.mjs`: never edit them by hand.
- `skills/brevity/SKILL.md`: the skill, written by hand.
- `hooks/`: the Claude Code SessionStart hook. `.claude-plugin/`: the plugin and marketplace manifests.
  `gemini-extension.json`: the Gemini CLI extension.
- `tools/`: standalone scripts that users run. `scripts/`: maintainer scripts. `eval/`: results and the rubric.

## Releases

- Every commit on `main` is a release. `main` is protected: changes arrive by pull request, and the maintainer
  merges them.
- A PR that changes anything users receive bumps the version (`.claude-plugin/plugin.json`,
  `gemini-extension.json`, and the `X.Y` in `SPEC.md`'s title). It also adds a [CHANGELOG.md](CHANGELOG.md) entry
  with Criticality, Why, Changes, Evidence, Compatibility and Upgrade. [RELEASING.md](RELEASING.md) defines each
  part and the criticality levels.
- Versions follow semver read from the protocol: major when a message written under the previous version could
  decode differently, minor when the protocol or its surfaces gain something, patch when meaning is unchanged.
- Before opening a PR, run `node scripts/release-check.mjs --base origin/main`. CI runs the same check.

## Changing the spec

- Every line costs every session that loads it. Keep `SPEC.md` within 100 lines and about 9,300 characters, so
  the hook injects it in one part.
- A change to meaning needs the evaluation re-run with the method in [eval/RESULTS.md](eval/RESULTS.md). Its
  numbers go in the CHANGELOG entry: token savings, confirmed decision-relevant losses (zero after fixes),
  `tools/idcheck.mjs`, and the spec's own size.
- Examples in the spec, README and templates are synthetic. Never commit or quote real messages, transcripts,
  names or paths from other projects.

## The plugin and the hook

- The hook may read only the files that the README section "What the plugin runs, reads and sends" lists, and
  print them. It uses no network, writes no files and has no dependencies. Each hook's output stays under 10,000
  characters (`inject.mjs` splits it).
- Keep that README section accurate. The Claude plugin directory reviews it against the code.
- To test, run `claude plugin validate .`, then `claude -p --plugin-dir .` in a folder with `.brevity/` and in
  one without.

## Issues

- Every problem you find gets a GitHub issue, unless the same PR fixes it. That covers bugs, documentation
  errors, spec ambiguities, audit findings, a surface that fails, work only the maintainer can do, and ideas with
  evidence. Search the open issues first, and add to an existing one instead of opening a duplicate.
- The title names the problem, not the fix. The body says what happens, the evidence or steps to reproduce it,
  the surfaces affected and, when known, the fix.
- Give it one criticality label from [RELEASING.md](RELEASING.md): `criticality: critical`, `criticality: high`,
  `criticality: normal` or `criticality: low`.
- Give it one kind label: `bug`, `spec`, `surface`, `documentation`, `process`, `enhancement`, or `owner` (work
  that needs the maintainer's accounts).
- The PR that fixes it says `Closes #N`. When the fix ships in a release, that release's CHANGELOG entry cites `#N`
  under Why. A process-only PR has no entry.
- Security problems never go in a public issue: report them as [SECURITY.md](SECURITY.md) says.
- Issues are public. Keep examples synthetic. Never quote private messages, transcripts, session titles, message
  ids, names or paths, and give only aggregate numbers about private data.

## Writing

- Public files are in English, plain and concrete. A commit subject says what changed, in the imperative, and
  its body says why.
