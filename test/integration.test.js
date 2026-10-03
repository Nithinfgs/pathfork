import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { createDemo } from '../src/demo.js';
import { runCheck, worst } from '../src/check.js';
import { parseArgs, main } from '../src/cli.js';

const hasBash = existsSync('/bin/bash') || existsSync('/usr/bin/bash') || existsSync('/opt/homebrew/bin/bash');

/** Run the check against the hermetic demo sandbox. */
async function demoReport() {
  const d = createDemo();
  try {
    return await runCheck({
      commands: d.commands, shell: d.shell, platform: 'darwin', home: d.home, env: d.env,
      project: d.project, cronPath: d.cronPath, guiPath: d.guiPath, timeoutMs: 20000,
    });
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }
}

test('demo sandbox reproduces the classic divergences', { skip: !hasBash }, async () => {
  const r = await demoReport();
  const by = Object.fromEntries(r.findings.map((f) => [f.name, f]));

  assert.equal(by.node.severity, 'error');
  const nodeTerminal = by.node.groups.find((g) => g.contexts.includes('terminal'));
  assert.equal(nodeTerminal?.sample.version, '22.4.0');
  assert.deepEqual(nodeTerminal?.contexts, ['terminal']);

  assert.equal(by.python3.severity, 'warn');
  assert.equal(by.uv.severity, 'error');
  assert.equal(by.cargo.severity, 'error');
  assert.equal(by.git.severity, 'ok');
  assert.equal(worst(r), 3);
});

test('explains the interactive guard in .bashrc', { skip: !hasBash }, async () => {
  const r = await demoReport();
  const why = r.findings.find((f) => f.name === 'node')?.why.join('\n') ?? '';
  assert.match(why, /~\/\.bashrc:\d+ adds it/);
  assert.match(why, /returns early for non-interactive shells/);
  assert.match(why, /nvm has no shims/);
  const uv = r.findings.find((f) => f.name === 'uv')?.why.join('\n') ?? '';
  assert.match(uv, /\.bash_profile/);
  assert.match(uv, /only read by login shells/);
});

test('project requirements are checked per context', { skip: !hasBash }, async () => {
  const r = await demoReport();
  const nvmrc = r.project.find((p) => p.source === '.nvmrc');
  assert.ok(nvmrc);
  const sat = Object.fromEntries(nvmrc.per.map((x) => [x.context, x.satisfied]));
  assert.deepEqual(sat, { terminal: true, login: false, 'non-interactive': false, cron: false, gui: false });
});

test('path diff lists entries with their source file', { skip: !hasBash }, async () => {
  const r = await demoReport();
  const nvm = r.pathDiff.find((e) => e.dir.endsWith('v22.4.0/bin'));
  assert.deepEqual(nvm?.present, ['terminal']);
  assert.match(nvm?.source ?? '', /^~\/\.bashrc:\d+$/);
});

test('cli: --demo exits 1 and prints a report; --json is valid JSON', { skip: !hasBash }, async () => {
  let out = '';
  const io = { stdout: { write: (/** @type {string} */ s) => void (out += s) }, stderr: { write: () => {} }, env: {} };
  assert.equal(await main(['--demo', '--no-color'], io), 1);
  assert.match(out, /✗ node/);
  out = '';
  assert.equal(await main(['--demo', '--json'], io), 1);
  assert.ok(JSON.parse(out).findings.length >= 4);
});

test('cli: argument parsing', () => {
  assert.deepEqual(parseArgs(['node', 'git']).commands, ['node', 'git']);
  assert.equal(parseArgs(['path']).path, true);
  assert.equal(parseArgs(['--project']).project, '.');
  assert.equal(parseArgs(['--project', './x', 'node']).project, './x');
  assert.deepEqual(parseArgs(['--project', 'node']).commands, ['node']);
  assert.equal(parseArgs(['--project=/a']).project, '/a');
  assert.deepEqual(parseArgs(['--contexts', 'cron,gui']).only, ['cron', 'gui']);
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['--contexts', 'bogus']), /Unknown context/);
  assert.throws(() => parseArgs(['--timeout', '0']), /positive/);
});

test('cli: rejects unsafe command names and unsupported shells', async () => {
  let err = '';
  const io = { stdout: { write: () => {} }, stderr: { write: (/** @type {string} */ s) => void (err += s) }, env: { HOME: '/tmp', SHELL: '/bin/sh' } };
  assert.equal(await main(['a;b'], io), 2);
  assert.match(err, /Invalid command name/);
  err = '';
  assert.equal(await main(['node', '--shell', '/usr/bin/fish'], io), 2);
  assert.match(err, /Unsupported shell "fish"/);
});
