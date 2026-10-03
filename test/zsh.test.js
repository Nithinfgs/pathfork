import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck } from '../src/check.js';

const zsh = ['/bin/zsh', '/usr/bin/zsh', '/opt/homebrew/bin/zsh'].find((p) => existsSync(p));

/** @param {string} file @param {string} body */
function put(file, body, exec = false) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
  if (exec) chmodSync(file, 0o755);
}

test('zsh: .zshenv reaches every shell, .zshrc only interactive ones', { skip: !zsh }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pf-zsh-'));
  const home = join(root, 'home');
  try {
    put(join(home, 'envbin/pf-everywhere'), '#!/bin/sh\necho "pf 1.0.0"\n', true);
    put(join(home, 'rcbin/pf-interactive'), '#!/bin/sh\necho "pf 2.0.0"\n', true);
    put(join(home, '.zshenv'), 'export PATH="$HOME/envbin:$PATH"\n');
    put(join(home, '.zshrc'), 'export PATH="$HOME/rcbin:$PATH"\n');
    const base = '/usr/bin:/bin';
    const r = await runCheck({
      commands: ['pf-everywhere', 'pf-interactive'], shell: /** @type {string} */ (zsh), platform: 'linux', home,
      env: { HOME: home, USER: 'u' }, guiPath: base, cronPath: base, timeoutMs: 20000,
    });
    const by = Object.fromEntries(r.findings.map((f) => [f.name, f]));

    // .zshenv is read by terminal, login and non-interactive; cron/gui read nothing.
    const everywhere = by['pf-everywhere'].groups.find((g) => g.state === 'found');
    assert.deepEqual(everywhere?.contexts.sort(), ['login', 'non-interactive', 'terminal']);
    assert.match(by['pf-everywhere'].why.join('\n'), /~\/\.zshenv:1/);

    // .zshrc is interactive only.
    const interactive = by['pf-interactive'].groups.find((g) => g.state === 'found');
    assert.deepEqual(interactive?.contexts, ['terminal']);
    assert.match(by['pf-interactive'].why.join('\n'), /~\/\.zshrc:1 adds it/);
    assert.match(by['pf-interactive'].why.join('\n'), /only read by interactive shells/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
