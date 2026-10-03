import { readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { CONTEXT_IDS } from './contexts.js';
import { runCheck, worst } from './check.js';
import { renderText, renderPath, renderMarkdown } from './render.js';
import { createDemo } from './demo.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `pathfork ${pkg.version}
Run your tools in every shell context and show where they diverge.

Usage
  pathfork [command...]          check commands (default: common dev tools)
  pathfork path                  show PATH entries that differ between contexts
  pathfork --demo                try it in a throwaway sandbox (touches nothing)

Options
  --project[=dir]       also check .nvmrc, .tool-versions, package.json engines,
                        .python-version, go.mod in dir (default: .)
  --contexts a,b        only these contexts: ${CONTEXT_IDS.join(', ')}
  --shell <path>        shell to test (default: $SHELL)
  --json | --md         machine-readable / paste-into-an-issue output
  --inherit-env         start shells with this process's full environment instead of a
                        minimal one (shows what a child of *this* terminal would see)
  --strict              exit 1 on warnings too (different patch/minor versions)
  --timeout <seconds>   per-context timeout (default 20)
  --no-color            disable colour (also honours NO_COLOR)
  -v, --version  -h, --help

Exit status: 0 consistent, 1 problems found, 2 usage or runtime error.
pathfork runs your shell startup files (read-only); it never edits anything.`;

/**
 * @typedef {Object} Parsed
 * @property {string[]} commands
 * @property {boolean} path
 * @property {boolean} demo
 * @property {boolean} json
 * @property {boolean} md
 * @property {boolean} strict
 * @property {boolean} inherit
 * @property {boolean|undefined} color
 * @property {boolean} help
 * @property {boolean} version
 * @property {string|undefined} project
 * @property {string[]|undefined} only
 * @property {string|undefined} shell
 * @property {number} timeout
 */

/**
 * @param {string[]} argv
 * @returns {Parsed}
 */
export function parseArgs(argv) {
  /** @type {Parsed} */
  const o = {
    commands: [], path: false, demo: false, json: false, md: false, strict: false, inherit: false,
    color: undefined, help: false, version: false, project: undefined, only: undefined, shell: undefined, timeout: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '--json') o.json = true;
    else if (a === '--md') o.md = true;
    else if (a === '--demo') o.demo = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--inherit-env') o.inherit = true;
    else if (a === '--no-color') o.color = false;
    else if (a === '--shell') o.shell = next();
    else if (a === '--timeout') o.timeout = Number(next());
    else if (a === '--contexts') o.only = next().split(',').map((x) => x.trim());
    else if (a === '--project' || a.startsWith('--project=')) {
      const peek = argv[i + 1];
      if (a.includes('=')) o.project = a.slice(a.indexOf('=') + 1);
      else if (peek && (peek === '.' || peek === '..' || (!peek.startsWith('-') && peek.includes('/')))) o.project = argv[++i];
      else o.project = '.';
    } else if (a.startsWith('-')) throw new UsageError(`Unknown option ${a}`);
    else if (a === 'path' && !o.commands.length && !o.path) o.path = true;
    else o.commands.push(a);
  }
  if (!Number.isFinite(o.timeout) || o.timeout <= 0) throw new UsageError('--timeout must be a positive number');
  for (const id of o.only ?? []) if (!CONTEXT_IDS.includes(id)) throw new UsageError(`Unknown context "${id}". Choose from: ${CONTEXT_IDS.join(', ')}`);
  return o;
}

export class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @param {{stdout:{write:(s:string)=>void, isTTY?:boolean}, stderr:{write:(s:string)=>void}, env:Record<string,string|undefined>}} io
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    io.stderr.write(`pathfork: ${/** @type {Error} */ (e).message}\n\n${HELP}\n`);
    return 2;
  }
  if (o.help) return io.stdout.write(`${HELP}\n`), 0;
  if (o.version) return io.stdout.write(`${pkg.version}\n`), 0;

  const color = o.color ?? (!io.env.NO_COLOR && (!!io.env.FORCE_COLOR || (!!io.stdout.isTTY && io.env.TERM !== 'dumb')));
  let demo;
  try {
    /** @type {import('./check.js').Options} */
    let opts;
    if (o.demo) {
      demo = createDemo();
      opts = {
        commands: o.commands.length ? o.commands : demo.commands,
        shell: o.shell ?? demo.shell,
        platform: 'darwin',
        home: demo.home,
        env: demo.env,
        project: demo.project,
        only: o.only,
        timeoutMs: o.timeout * 1000,
        cronPath: demo.cronPath,
        guiPath: demo.guiPath,
      };
      io.stderr.write(`Demo sandbox: a fake HOME with a typical misconfigured setup. Nothing on your machine is read or changed.\n\n`);
    } else {
      const shell = o.shell ?? io.env.SHELL ?? '/bin/sh';
      opts = {
        commands: o.commands,
        shell,
        platform: process.platform,
        home: io.env.HOME ?? homedir(),
        env: io.env,
        project: o.project ? resolve(o.project) : undefined,
        only: o.only,
        timeoutMs: o.timeout * 1000,
        inherit: o.inherit,
      };
    }
    const report = await runCheck(opts);
    if (o.json) io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else if (o.md) io.stdout.write(`${renderMarkdown(report)}\n`);
    else if (o.path) io.stdout.write(`${renderPath(report, { color })}\n`);
    else io.stdout.write(`${renderText(report, { color, version: pkg.version })}\n`);
    const w = worst(report);
    return w >= 3 || (o.strict && w >= 2) ? 1 : 0;
  } catch (e) {
    io.stderr.write(`pathfork: ${/** @type {Error} */ (e).message}\n`);
    return 2;
  } finally {
    if (demo) rmSync(demo.root, { recursive: true, force: true });
  }
}
