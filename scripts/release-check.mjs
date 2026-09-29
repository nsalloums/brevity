#!/usr/bin/env node
// Release gate for brevity (see RELEASING.md). CI runs it on every pull request; run it before opening one.
//
//   node scripts/release-check.mjs                 check the working tree
//   node scripts/release-check.mjs --base <ref>    also require a version bump when shipped files changed since <ref>
//   node scripts/release-check.mjs --tag vX.Y.Z    also require the tag to match the version
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const json = (rel) => { try { return JSON.parse(read(rel)); } catch (e) { fail(`${rel}: ${e.message}`); return {}; } };
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

// Paths that change nothing users receive: a PR touching only these needs no release.
const PROCESS = [/^RELEASING\.md$/, /^CHANGELOG\.md$/, /^AGENTS\.md$/, /^CLAUDE\.md$/, /^\.github\//, /^scripts\//, /^eval\//, /^\.gitignore$/];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const newer = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

// 1. One version everywhere.
const plugin = json('.claude-plugin/plugin.json');
const version = plugin.version ?? '';
if (!SEMVER.test(version)) fail(`plugin.json version "${version}" is not X.Y.Z`);
const gemini = json('gemini-extension.json');
if (gemini.version !== version) fail(`gemini-extension.json version ${gemini.version} != plugin.json ${version}`);
const title = read('SPEC.md').split('\n')[0];
const specVersion = title.match(/^# brevity (\d+\.\d+):/)?.[1];
if (!specVersion) fail(`SPEC.md title does not start with "# brevity X.Y:": ${title}`);
else if (version && !version.startsWith(`${specVersion}.`)) fail(`SPEC.md is ${specVersion}, plugin.json is ${version}`);
const market = json('.claude-plugin/marketplace.json');
for (const p of market.plugins ?? []) {
  if (p.name !== plugin.name) fail(`marketplace.json lists "${p.name}", plugin.json is "${plugin.name}"`);
  if (p.version && p.version !== version) fail(`marketplace.json version ${p.version} != ${version}`);
}
for (const key of ['name', 'description', 'author', 'license']) if (!plugin[key]) fail(`plugin.json has no ${key}`);
if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(plugin.name ?? '')) fail(`plugin name "${plugin.name}" breaks the directory pattern`);

// 2. The CHANGELOG entry for this version, with every required part.
const changelog = existsSync(join(root, 'CHANGELOG.md')) ? read('CHANGELOG.md') : '';
const head = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
const at = changelog.search(head);
if (at < 0) fail(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" entry`);
else {
  const rest = changelog.slice(at + 1);
  const entry = rest.slice(0, rest.search(/^## \[/m) >= 0 ? rest.search(/^## \[/m) : undefined);
  if (!/^\*\*Criticality:\*\* (critical|high|normal|low)\b/m.test(entry)) fail('CHANGELOG entry has no "**Criticality:** critical|high|normal|low" line');
  for (const part of ['Why', 'Changes', 'Evidence', 'Compatibility', 'Upgrade']) {
    if (!new RegExp(`^### ${part}$`, 'm').test(entry)) fail(`CHANGELOG entry has no "### ${part}" section`);
  }
}

// 3. Generated adapters match SPEC.md.
const adapters = spawnSync(process.execPath, [join(root, 'tools', 'build-adapters.mjs'), '--check'], { encoding: 'utf8' });
if (adapters.status !== 0) fail(`adapters are stale; run node tools/build-adapters.mjs\n${adapters.stderr.trim()}`);

// 4. The spec's size: every session pays for it, and the hook injects it in parts under 10,000 characters.
const spec = read('SPEC.md');
const specLines = spec.trimEnd().split('\n').length;
if (specLines > 100) fail(`SPEC.md has ${specLines} lines; the budget is 100`);
if (spec.length > 9300) warnings.push(`SPEC.md is ${spec.length} characters; the hook will inject it in 2 parts`);

// 5. Hooks: valid, SessionStart only, every command rooted in ${CLAUDE_PLUGIN_ROOT}, one entry per slot.
const hooks = json('hooks/hooks.json').hooks ?? {};
const events = Object.keys(hooks);
if (events.join() !== 'SessionStart') fail(`hooks.json events are [${events}], expected [SessionStart]`);
const commands = (hooks.SessionStart ?? []).flatMap((m) => m.hooks ?? []).map((h) => h.command ?? '');
for (const c of commands) if (!c.includes('${CLAUDE_PLUGIN_ROOT}/')) fail(`hook command not rooted in \${CLAUDE_PLUGIN_ROOT}: ${c}`);
const slots = Number(read('hooks/inject.mjs').match(/const SLOTS = (\d+)/)?.[1]);
if (commands.length !== slots) fail(`hooks.json has ${commands.length} commands, inject.mjs expects SLOTS = ${slots}`);

// 5b. Skills: front matter the directory and Claude Code can load (name = folder, one-line description <= 1024).
for (const dir of existsSync(join(root, 'skills')) ? readdirSync(join(root, 'skills')) : []) {
  const file = join(root, 'skills', dir, 'SKILL.md');
  if (!existsSync(file)) { fail(`skills/${dir} has no SKILL.md`); continue; }
  const fm = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) { fail(`skills/${dir}/SKILL.md has no front matter`); continue; }
  const name = fm[1].match(/^name: (.+)$/m)?.[1].trim();
  const description = fm[1].match(/^description: (.+)$/m)?.[1].trim() ?? '';
  if (name !== dir) fail(`skills/${dir}/SKILL.md name "${name}" != folder "${dir}"`);
  if (!description || description.length > 1024) fail(`skills/${dir}/SKILL.md description must be one line of 1-1024 characters`);
}

// 6. What the Claude plugin directory rejects or holds (pre-submission checklist).
let files = [];
try { files = git('ls-files').split('\n').filter(Boolean); } catch { warnings.push('not a git checkout; file checks skipped'); }
if (files.length > 512) fail(`${files.length} files; the directory holds plugins with more than 512`);
for (const f of files) {
  if (/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/.test(f)) fail(`system file in the repository: ${f}`);
  if (/[:]|[. ]$|(^|\/)(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(f)) fail(`file name invalid on Windows or macOS: ${f}`);
  if (existsSync(join(root, f)) && statSync(join(root, f)).size > 256 * 1024 && !/\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i.test(f)) fail(`${f} is over 256 KiB`);
}
const lower = new Set();
for (const f of files) { const k = f.toLowerCase(); if (lower.has(k)) fail(`two paths differ only by case: ${f}`); lower.add(k); }

// 7. Against a base ref: shipped files changed => the version must go up.
const base = opt('--base');
if (base) {
  // Committed changes since the merge base, plus uncommitted and untracked ones when run locally.
  const changed = [...new Set([
    ...git('diff', '--name-only', git('merge-base', base, 'HEAD')).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ].filter(Boolean))];
  const shipped = changed.filter((f) => !PROCESS.some((re) => re.test(f)));
  let baseVersion = null;
  try { baseVersion = JSON.parse(git('show', `${base}:.claude-plugin/plugin.json`)).version; } catch { /* first release */ }
  if (shipped.length && baseVersion && !newer(version, baseVersion)) {
    fail(`shipped files changed (${shipped.join(', ')}) but the version did not go up from ${baseVersion}: every merge to main that users receive is a release`);
  }
  if (!shipped.length) console.log(`no shipped file changed since ${base}: no release needed`);
}

// 8. A release tag must name this version.
const tag = opt('--tag');
if (tag && tag !== `v${version}`) fail(`tag ${tag} != v${version}`);

for (const w of warnings) console.log(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
console.log(`release check passed for brevity ${version}`);
