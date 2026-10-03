import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { satisfies, readRequirements } from '../src/project.js';

test('prefix specs', () => {
  assert.equal(satisfies('22.4.0', '22'), true);
  assert.equal(satisfies('22.4.0', '22.4'), true);
  assert.equal(satisfies('22.4.0', '22.3'), false);
  assert.equal(satisfies('18.19.1', '22'), false);
  assert.equal(satisfies('22.4.0', 'v22.4.0'), true);
});

test('comparators and ranges', () => {
  assert.equal(satisfies('18.19.1', '>=20'), false);
  assert.equal(satisfies('20.0.0', '>=20'), true);
  assert.equal(satisfies('24.1.0', '>=18 <22'), false);
  assert.equal(satisfies('20.1.0', '>=18 <22'), true);
  assert.equal(satisfies('16.0.0', '^18 || ^20'), false);
  assert.equal(satisfies('20.5.1', '^18 || ^20'), true);
  assert.equal(satisfies('1.2.9', '~1.2.3'), true);
  assert.equal(satisfies('1.3.0', '~1.2.3'), false);
  assert.equal(satisfies('3.12.1', '3.12.x'), true);
});

test('unknown specs return null instead of guessing', () => {
  assert.equal(satisfies('22.0.0', 'lts/*'), null);
  assert.equal(satisfies('22.0.0', 'system'), null);
});

test('reads requirements from common files', () => {
  const d = mkdtempSync(join(tmpdir(), 'pf-proj-'));
  writeFileSync(join(d, '.nvmrc'), 'v20.11.0\n');
  writeFileSync(join(d, '.tool-versions'), 'python 3.12.1 # comment\nnodejs 22.1.0\nterraform 1.8\n');
  writeFileSync(join(d, 'package.json'), '{"engines":{"node":">=18"}}');
  writeFileSync(join(d, 'go.mod'), 'module x\n\ngo 1.22\n');
  const reqs = readRequirements(d).map((r) => `${r.command}:${r.spec}:${r.source}`);
  const expected = [
    'go:>=1.22:go.mod',
    'node:>=18:package.json engines.node',
    'node:22.1.0:.tool-versions',
    'node:v20.11.0:.nvmrc',
    'python3:3.12.1:.tool-versions',
  ];
  assert.deepEqual([...reqs].sort(), [...expected].sort());
});
