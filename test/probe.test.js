import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe, buildScript, isSafeName } from '../src/probe.js';
import { analyze } from '../src/compare.js';

test('parseProbe ignores rc-file noise and extracts versions', () => {
  const out = [
    'Welcome back! fortune: stay hungry',
    '@@PATH@@/a/bin:/usr/bin::/bin',
    'banner @@CMD@@node\t/usr/bin/node\tv18.19.1',
    '@@CMD@@go\t/usr/local/go/bin/go\tgo version go1.22.3 darwin/arm64',
    '@@CMD@@nvm\tnvm\t0.39.7',
    '@@CMD@@ghost\t\t',
    '',
  ].join('\n');
  const r = parseProbe(out);
  assert.deepEqual(r.path, ['/a/bin', '/usr/bin', '/bin']);
  assert.equal(r.commands.node.version, '18.19.1');
  assert.equal(r.commands.go.version, '1.22.3');
  assert.equal(r.commands.nvm.kind, 'function');
  assert.equal(r.commands.ghost.kind, 'missing');
});

test('only safe command names are accepted', () => {
  assert.ok(isSafeName('python3.12'));
  assert.ok(isSafeName('g++'));
  for (const bad of ['a b', 'a;b', '$(x)', '-rf', '', 'a/b', "a'b"]) assert.equal(isSafeName(bad), false, bad);
});

test('script uses the right version flag per tool', () => {
  const s = buildScript(['node', 'go', 'java']);
  assert.match(s, /probe node --version/);
  assert.match(s, /probe go version/);
  assert.match(s, /probe java -version/);
});

/** @param {string} id @param {Record<string, object>} commands */
const ctx = (id, commands) => ({ ctx: { id }, path: [], commands });
const file = (path, version) => ({ name: 'x', kind: 'file', path, real: path, version });

test('analyze: consistent / info / warn / error', () => {
  const same = analyze([ctx('a', { x: file('/u/x', '1.0.0') }), ctx('b', { x: file('/u/x', '1.0.0') })], 'x');
  assert.equal(same.severity, 'ok');

  const info = analyze([ctx('a', { x: file('/u/x', '1.0.0') }), ctx('b', { x: file('/v/x', '1.0.0') })], 'x');
  assert.equal(info.severity, 'info');

  const warn = analyze([ctx('a', { x: file('/u/x', '1.0.0') }), ctx('b', { x: file('/v/x', '1.2.0') })], 'x');
  assert.equal(warn.severity, 'warn');

  const major = analyze([ctx('a', { x: file('/u/x', '18.0.0') }), ctx('b', { x: file('/v/x', '22.0.0') })], 'x');
  assert.equal(major.severity, 'error');

  const missing = analyze([ctx('a', { x: file('/u/x', '1.0.0') }), ctx('b', { x: { name: 'x', kind: 'missing' } })], 'x');
  assert.equal(missing.severity, 'error');
  assert.match(missing.summary, /missing in b/);

  const none = analyze([ctx('a', {}), ctx('b', {})], 'x');
  assert.equal(none.severity, 'absent');
});

test('analyze treats symlinks to the same binary as identical', () => {
  const a = { name: 'x', kind: 'file', path: '/bin/x', real: '/real/x', version: '1.0.0' };
  const b = { name: 'x', kind: 'file', path: '/usr/bin/x', real: '/real/x', version: '1.0.0' };
  assert.equal(analyze([ctx('a', { x: a }), ctx('b', { x: b })], 'x').severity, 'ok');
});
