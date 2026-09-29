#!/usr/bin/env node
// Regenerate the adapter files that embed SPEC.md, so they never drift from it.
//
//   node tools/build-adapters.mjs          write them
//   node tools/build-adapters.mjs --check  exit 1 if any is stale (for CI)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Git stores these files with LF, but a Windows checkout with core.autocrlf=true has CRLF. Compare and write LF
// only, so the line endings of a checkout never make an adapter look stale.
const lf = (text) => text.replace(/\r\n/g, '\n');
const spec = lf(readFileSync(join(root, 'SPEC.md'), 'utf8'));
const version = spec.match(/^# brevity (\S+):/)?.[1] ?? '?';

const outputs = {
  // Agent Skill (agentskills.io), shipped in the plugin's skills/ folder: SKILL.md reads the copy next to it.
  'skills/brevity/SPEC.md': spec,
  // Cursor project rule, always applied.
  'adapters/cursor/brevity.mdc': [
    '---',
    `description: brevity ${version}, the format for messages between agent sessions (peer messages, delegation prompts, subagent results)`,
    'alwaysApply: true',
    '---',
    '',
    spec,
  ].join('\n'),
};

let stale = 0;
for (const [rel, text] of Object.entries(outputs)) {
  const file = join(root, rel);
  const current = existsSync(file) ? lf(readFileSync(file, 'utf8')) : null;
  if (current === text) continue;
  stale++;
  if (process.argv.includes('--check')) { console.error(`stale: ${rel}`); continue; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${rel}`);
}
if (process.argv.includes('--check')) process.exitCode = stale ? 1 : 0;
else if (!stale) console.log('adapters up to date');
