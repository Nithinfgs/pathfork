import { mkdirSync, writeFileSync, chmodSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/** @param {string} file @param {string} body */
function write(file, body, exec = false) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  if (exec) chmodSync(file, 0o755);
}

/** @param {string} file @param {string} output */
function fakeBin(file, output) {
  write(file, `#!/bin/sh\necho "${output}"\n`, true);
}

/**
 * Build a throwaway HOME that reproduces the classic mistakes: a version manager
 * initialised behind an interactive-only guard, a login-only PATH export, and an
 * old "system" toolchain. Nothing outside the temp directory is touched.
 *
 * @returns {{root:string, home:string, project:string, shell:string, env:Record<string,string>, commands:string[], cronPath:string, guiPath:string}}
 */
export function createDemo() {
  const root = mkdtempSync(join(tmpdir(), 'pathfork-demo-'));
  const home = join(root, 'home');
  const sys = join(home, 'system', 'bin');
  const project = join(root, 'home', 'work', 'my-app');

  fakeBin(join(sys, 'node'), 'v18.19.1');
  fakeBin(join(sys, 'python3'), 'Python 3.9.6');
  fakeBin(join(sys, 'git'), 'git version 2.39.3');
  fakeBin(join(home, '.nvm/versions/node/v22.4.0/bin/node'), 'v22.4.0');
  fakeBin(join(home, 'brew/bin/python3'), 'Python 3.12.3');
  fakeBin(join(home, '.local/bin/uv'), 'uv 0.4.2');
  fakeBin(join(home, '.cargo/bin/cargo'), 'cargo 1.79.0');

  write(
    join(home, '.bash_profile'),
    `# toolchain baked into the OS image\nexport PATH="$HOME/system/bin:$PATH"\n# login shells\nexport PATH="$HOME/brew/bin:$HOME/.local/bin:$PATH"\n[ -f ~/.bashrc ] && . ~/.bashrc\n`,
  );
  write(
    join(home, '.bashrc'),
    `# If not running interactively, don't do anything\ncase $- in\n  *i*) ;;\n  *) return;;\nesac\n\nexport NVM_DIR="$HOME/.nvm"\nexport PATH="$NVM_DIR/versions/node/v22.4.0/bin:$PATH"\nexport PATH="$HOME/.cargo/bin:$PATH"\n`,
  );
  write(join(project, '.nvmrc'), '22\n');
  write(join(project, 'package.json'), '{ "name": "my-app", "engines": { "node": ">=20" } }\n');

  const bash = ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash'].find((p) => existsSync(p)) ?? '/bin/bash';
  const base = `${sys}:/usr/bin:/bin`;
  return {
    root,
    home,
    project,
    shell: bash,
    env: { HOME: home, USER: 'demo', PATH: base, SHELL: bash },
    commands: ['node', 'python3', 'uv', 'cargo', 'git'],
    cronPath: base,
    guiPath: `${base}:/usr/sbin:/sbin`,
  };
}
