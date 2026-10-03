import { basename } from 'node:path';

/**
 * @typedef {Object} Context
 * @property {string} id            short name used in output
 * @property {string} title         one-line description of who runs commands this way
 * @property {string} how           the invocation, for display
 * @property {string} cmd           executable to spawn
 * @property {string[]} args        arguments placed before the probe script
 * @property {Record<string,string>} env  complete environment for the child
 * @property {{login:boolean, interactive:boolean, clean:boolean}} props
 */

export const SUPPORTED_SHELLS = ['zsh', 'bash', 'sh', 'dash'];

export const CONTEXT_IDS = ['terminal', 'login', 'non-interactive', 'cron', 'gui'];

/**
 * @param {string} shellPath
 * @returns {string}
 */
export function shellKind(shellPath) {
  return basename(shellPath || '');
}

/**
 * Build the list of shell contexts to probe.
 *
 * @param {Object} o
 * @param {string} o.shell        absolute path to the user's shell
 * @param {string} o.platform     process.platform
 * @param {string} o.home
 * @param {Record<string,string|undefined>} o.env   environment of the current process
 * @param {string} [o.cronPath]   PATH a cron-like environment starts with
 * @param {string} [o.guiPath]    PATH a GUI-launched app starts with; also the PATH every shell starts from
 * @param {boolean} [o.inherit]   let shell contexts inherit the full current environment
 * @param {string[]} [o.only]     restrict to these context ids
 * @returns {Context[]}
 */
export function buildContexts({ shell, platform, home, env, cronPath, guiPath, inherit, only }) {
  const kind = shellKind(shell);
  if (!SUPPORTED_SHELLS.includes(kind)) {
    throw new Error(
      `Unsupported shell "${kind}". pathfork supports ${SUPPORTED_SHELLS.join(', ')}. Pass --shell /path/to/bash to override.`,
    );
  }

  const user = env.USER || env.LOGNAME || 'user';
  const startPath =
    guiPath ?? (platform === 'darwin' ? '/usr/bin:/bin:/usr/sbin:/sbin' : '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');

  // Shells start from what a launcher (Dock, cron, display manager) would hand
  // them, so the result shows what the startup files add and does not depend on
  // where pathfork itself was started.
  /** @type {Record<string,string>} */
  const minimal = { HOME: home, USER: user, LOGNAME: user, SHELL: shell, PATH: startPath, TERM: 'xterm-256color' };
  for (const k of ['LANG', 'LC_ALL', 'TMPDIR']) if (env[k]) minimal[k] = /** @type {string} */ (env[k]);
  const inherited = /** @type {Record<string,string>} */ ({});
  if (inherit) for (const [k, v] of Object.entries(env)) if (v !== undefined) inherited[k] = v;
  const shellEnv = inherit ? inherited : minimal;

  const clean = (/** @type {string} */ path) => ({
    HOME: home,
    USER: user,
    LOGNAME: user,
    SHELL: '/bin/sh',
    PATH: path,
  });

  const terminalLogin = platform === 'darwin';
  /** @type {Context[]} */
  const all = [
    {
      id: 'terminal',
      title: 'the shell you type into (login + interactive)',
      how: `${kind} ${terminalLogin ? '-l -i' : '-i'} -c`,
      cmd: shell,
      args: terminalLogin ? ['-l', '-i', '-c'] : ['-i', '-c'],
      env: shellEnv,
      props: { login: terminalLogin, interactive: true, clean: false },
    },
    {
      id: 'login',
      title: 'login shell, no prompt (ssh host cmd, some CI runners)',
      how: `${kind} -l -c`,
      cmd: shell,
      args: ['-l', '-c'],
      env: shellEnv,
      props: { login: true, interactive: false, clean: false },
    },
    {
      id: 'non-interactive',
      title: 'plain `shell -c` (make, git hooks, editor tasks, many agent tools)',
      how: `${kind} -c`,
      cmd: shell,
      args: ['-c'],
      env: shellEnv,
      props: { login: false, interactive: false, clean: false },
    },
    {
      id: 'cron',
      title: 'cron-like: empty environment, /bin/sh',
      how: 'env -i /bin/sh -c',
      cmd: '/bin/sh',
      args: ['-c'],
      env: clean(cronPath ?? '/usr/bin:/bin'),
      props: { login: false, interactive: false, clean: true },
    },
    {
      id: 'gui',
      title: 'app launched from the Dock / launcher (approximation)',
      how: 'env -i /bin/sh -c',
      cmd: '/bin/sh',
      args: ['-c'],
      env: clean(startPath),
      props: { login: false, interactive: false, clean: true },
    },
  ];

  return only?.length ? all.filter((c) => only.includes(c.id)) : all;
}

/**
 * Startup files a shell reads, and which contexts read them.
 * Clean contexts (cron, gui) read nothing.
 *
 * @param {string} kind
 * @returns {{file:string, reads:(p:Context['props'])=>boolean, why:string}[]}
 */
export function startupFiles(kind) {
  if (kind === 'zsh') {
    return [
      { file: '.zshenv', reads: (p) => !p.clean, why: 'every zsh invocation' },
      { file: '.zprofile', reads: (p) => !p.clean && p.login, why: 'login shells' },
      { file: '.zshrc', reads: (p) => !p.clean && p.interactive, why: 'interactive shells' },
      { file: '.zlogin', reads: (p) => !p.clean && p.login, why: 'login shells' },
    ];
  }
  if (kind === 'bash') {
    return [
      { file: '.bash_profile', reads: (p) => !p.clean && p.login, why: 'login shells' },
      { file: '.bash_login', reads: (p) => !p.clean && p.login, why: 'login shells (if no .bash_profile)' },
      { file: '.profile', reads: (p) => !p.clean && p.login, why: 'login shells (if no .bash_profile)' },
      { file: '.bashrc', reads: (p) => !p.clean && p.interactive && !p.login, why: 'interactive non-login shells (login shells only if a profile file sources it)' },
    ];
  }
  return [{ file: '.profile', reads: (p) => !p.clean && p.login, why: 'login shells' }];
}
