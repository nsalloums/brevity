import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

function runIdcheck(original, encoding) {
  const dir = mkdtempSync(join(tmpdir(), 'brevity-idcheck-'));
  try {
    const messages = join(dir, 'messages.json');
    const encodings = join(dir, 'encodings.json');
    writeFileSync(messages, JSON.stringify([{ id: 'repro', text: original }]));
    writeFileSync(encodings, JSON.stringify([{ id: 'repro', enc: encoding }]));
    return spawnSync(process.execPath, ['tools/idcheck.mjs', messages, encodings], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function summary(output) {
  return JSON.parse(output.split('\nrepro:')[0]);
}

test('checks one-digit refs, small diffstats, and file:line references in common languages', () => {
  const source = 'Fixed #7 in app/views.py:42 and lib/x.go:118, +5/-3';
  const result = runIdcheck(source, source);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(summary(result.stdout), {
    messages: 1,
    identifiersChecked: 4,
    missing: 0,
    messagesWithMissing: 0,
  });
});

test('reports missing identifiers found with the shorter forms', () => {
  const result = runIdcheck('Fixed #7 in app/views.py:42 and lib/x.go:118, +5/-3', 'Fixed the issue in the source files');
  assert.equal(result.status, 1);
  assert.deepEqual(summary(result.stdout), {
    messages: 1,
    identifiersChecked: 4,
    missing: 4,
    messagesWithMissing: 1,
  });
});
