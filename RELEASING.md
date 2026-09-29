# Releasing brevity

brevity ships a protocol, not just code. A message written under one version of [SPEC.md](SPEC.md) has to decode
the same way under the next, and every session that loads the spec pays for each line of it. So releases are
rare and deliberate, and each one has to justify itself with evidence.

## The rule: every commit on `main` is a release

- `main` holds released versions only. It is protected: no direct pushes, no force-pushes, and every change comes
  in through a pull request that the maintainer merges.
- Work happens on branches. When a set of changes is worth a release, a **release PR** brings it to `main`, and
  that PR bumps the version and adds a [CHANGELOG.md](CHANGELOG.md) entry.
- A PR that touches only process files (`RELEASING.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`, `.github/`,
  `scripts/`, `eval/`) changes nothing users receive, so it needs no release.
- After merging a release PR, the maintainer tags the merge commit `vX.Y.Z` and publishes a GitHub Release whose
  notes are the CHANGELOG entry.

Why `main`: Claude Code installs this marketplace from the default branch and updates a plugin only when its
`version` changes. The Claude plugin directory scans every new commit on the branch it tracks. Keeping `main`
release-only means users and the directory see only versions that were meant to ship.

## Versions

`X.Y.Z` follows semantic versioning, read from the protocol's point of view:

| bump | when | examples |
|---|---|---|
| **major** `X` | a message written under the previous version could decode differently, or no longer decode | a verb changes meaning; a notation is removed; a default actor changes |
| **minor** `Y` | the protocol gains something, and every earlier message still decodes the same | a new verb or status code; a clarification that removes an ambiguity; a new adapter or surface |
| **patch** `Z` | nothing about the protocol's meaning changes | a hook bug; an adapter out of sync; misleading documentation |

`SPEC.md`'s title carries `X.Y`; `.claude-plugin/plugin.json` and `gemini-extension.json` carry `X.Y.Z`.
[scripts/release-check.mjs](scripts/release-check.mjs) checks that they agree.

## Criticality

Every release states one level. The level sets how fast it ships and how much evidence it needs.

| level | meaning | ships |
|---|---|---|
| **critical** | brevity can cause a wrong action or weakens a safeguard: a construct that decodes to the opposite meaning, a change to the authority rules, a hook that injects the wrong content, a failed security scan | as soon as the fix is verified, alone |
| **high** | a class of decision-relevant loss found by an audit or a user, a surface where the plugin fails to load, documentation that misleads | the next release, soon |
| **normal** | a measured improvement: more compression at no new loss, a new surface, a new verb the traffic needs | batched, when the evidence is in |
| **low** | wording, typos, internal cleanups | never alone: they ride along with a release that has a reason |

A change with no reason above does not get a release.

## What a release entry must contain

Each CHANGELOG entry has these parts. The release check fails without them.

- **Criticality**: one level from the table, with the reason in one line.
- **Why**: the problem, with evidence: the failing message pattern, the audit finding, the issue link, or the
  measurement. It says what goes wrong without this release.
- **Changes**: what changed, for each surface affected (Claude Code plugin, AGENTS.md block, Gemini extension,
  Cursor rule, Agent Skill, tools).
- **Evidence**: proof that the change does what it claims and breaks nothing:
  - spec changes: re-run the evaluation (encode, blind decode, two-lens audit, skeptic, as in
    [eval/RESULTS.md](eval/RESULTS.md)). Report total and median token savings before and after, the confirmed
    decision-relevant losses (must be zero after fixes), `tools/idcheck.mjs`, and the spec's own size in tokens
    (it costs every session);
  - plugin changes: `claude plugin validate .` and a real `claude -p --plugin-dir .` run showing the hook output;
  - adapter changes: `node tools/build-adapters.mjs --check`.
- **Compatibility**: whether messages written under the previous version still decode the same (a "no" means a
  major bump), and the change in the spec's size.
- **Upgrade**: what users of each surface do, if anything.

## Gates

A release PR merges only when:

1. `node scripts/release-check.mjs` passes. CI runs it on every PR.
2. The Evidence section is backed by runs, not intentions.
3. A spec change does not grow the spec by more than 5% in tokens, and does not cut measured savings by more than
   1 point, unless the entry explains why the trade is worth it (for example, it removes a loss class).

## Cutting a release

1. On a branch: make the changes, bump `version` in `.claude-plugin/plugin.json` and `gemini-extension.json` (and
   the `X.Y` in `SPEC.md`'s title for a major or minor bump), run `node tools/build-adapters.mjs`, and write the
   CHANGELOG entry.
2. Run `node scripts/release-check.mjs`, then open the release PR against `main`.
3. The maintainer reviews and merges it.
4. Tag and publish:

   ```
   git tag -a vX.Y.Z -m "brevity X.Y.Z" <merge commit>
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "brevity X.Y.Z" --notes-file <the CHANGELOG entry>
   ```

5. The Claude plugin directory picks up the new commit on `main`, scans it and publishes it according to the
   listing's publish setting. Claude Code users receive it through `/plugin` updates, because the version
   changed.

## How each surface gets a release

| surface | how users update |
|---|---|
| Claude Code (marketplace) | `/plugin marketplace update brevity`, or automatic updates |
| Claude plugin directory | picked up from `main` after the scan |
| Codex and other AGENTS.md readers | re-run `node tools/agents-md.mjs <AGENTS.md>` from a checkout of the new tag |
| Gemini CLI | `gemini extensions update brevity`, or install a fixed version with `--ref vX.Y.Z` |
| Cursor | copy the new `adapters/cursor/brevity.mdc` |
| Agent Skill | copy the new `skills/brevity/` |
