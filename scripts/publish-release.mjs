#!/usr/bin/env node
// Publish the release for the version on main: an annotated tag vX.Y.Z on the commit and a GitHub Release whose
// notes are that version's CHANGELOG entry. Run it right after merging a release PR (see RELEASING.md).
// It does nothing when that version is already tagged, so running it after a process-only merge is harmless.
//
//   node scripts/publish-release.mjs                 the current tip of origin/main
//   node scripts/publish-release.mjs --commit <sha>  a specific commit on main
//   node scripts/publish-release.mjs --notes-only    print the notes and exit
//
// Needs git (the tag carries your git identity) and an authenticated gh CLI.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = 'nsalloums/brevity';
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fail(message) { console.error(`publish-release: ${message}`); process.exit(1); }
const git = (...a) => { try { return run('git', a); } catch { return fail(`git ${a.join(' ')} failed`); } };

git('fetch', '-q', 'origin', 'main', '--tags');
const commit = git('rev-parse', '--verify', `${opt('--commit') ?? 'origin/main'}^{commit}`);
try { run('git', ['merge-base', '--is-ancestor', commit, 'origin/main']); } catch { fail(`${commit} is not on origin/main`); }
const version = JSON.parse(git('show', `${commit}:.claude-plugin/plugin.json`)).version;
const tag = `v${version}`;
const published = Boolean(git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`));
if (published && !args.includes('--notes-only')) {
  console.log(`${tag} is already published; nothing to do`);
  process.exit(0);
}

// The CHANGELOG entry for this version, with relative links made absolute to the tagged tree.
let changelog = '';
try { changelog = run('git', ['show', `${commit}:CHANGELOG.md`]); } catch { fail(`${commit.slice(0, 9)} has no CHANGELOG.md`); }
const start = changelog.indexOf(`## [${version}]`);
if (start < 0) fail(`CHANGELOG.md at ${commit.slice(0, 9)} has no entry for ${version}`);
const next = changelog.indexOf('\n## [', start + 1);
const blob = `https://github.com/${REPO}/blob/${tag}/`;
const notes = changelog.slice(start, next < 0 ? undefined : next).split('\n').slice(1).join('\n').trim()
  .replace(/\]\((?!https?:|#)([^)#]+)(#[^)]*)?\)/g, (_, path, hash = '') => `](${blob}${path}${hash})`);
if (args.includes('--notes-only')) { console.log(notes); process.exit(0); }

git('tag', '-a', tag, '-m', `brevity ${version}`, commit);
git('push', '-q', 'origin', tag);
const dir = mkdtempSync(join(tmpdir(), 'brevity-release-'));
try {
  const file = join(dir, 'notes.md');
  writeFileSync(file, `${notes}\n`);
  console.log(run('gh', ['release', 'create', tag, '--repo', REPO, '--verify-tag', '--title', `brevity ${version}`, '--notes-file', file, '--latest']));
} catch {
  fail(`tag ${tag} is pushed, but gh release create failed: create the release by hand`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
