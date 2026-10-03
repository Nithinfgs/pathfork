import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';

const VERSION_FLAG = { go: 'version', java: '-version', javac: '-version' };
const SAFE_NAME = /^[A-Za-z0-9._+-]+$/;

/**
 * @typedef {Object} CommandResult
 * @property {string} name
 * @property {'file'|'alias'|'function'|'missing'} kind
 * @property {string} [path]      path as found on PATH
 * @property {string} [real]      symlink-resolved path
 * @property {string} [version]   first version-looking token in `cmd --version`
 * @property {string} [raw]       first line of version output
 */

/**
 * @typedef {Object} ContextResult
 * @property {import('./contexts.js').Context} ctx
 * @property {string[]} path       PATH entries, in order
 * @property {Record<string, CommandResult>} commands
 * @property {string} [error]      set when the shell failed or timed out
 */

/** @param {string} name */
export function isSafeName(name) {
  return SAFE_NAME.test(name) && !name.startsWith('-');
}

/** @param {string[]} names */
export function buildScript(names) {
  const calls = names
    .map((n) => `probe ${n} ${VERSION_FLAG[/** @type {keyof typeof VERSION_FLAG} */ (n)] ?? '--version'}`)
    .join('\n');
  return `probe() {
  n=$1; f=$2
  p=$(command -v "$n" 2>/dev/null)
  case $p in
    /*) out=$("$p" $f 2>&1 </dev/null | head -n 1) ;;
    "") out="" ;;
    *) out=$("$n" $f 2>&1 </dev/null | head -n 1) ;;
  esac
  printf '@@CMD@@%s\\t%s\\t%s\\n' "$n" "$p" "$out"
}
printf '@@PATH@@%s\\n' "$PATH"
${calls}
`;
}

/**
 * Parse the sentinel-delimited output of the probe script. Anything an rc file
 * prints (banners, fortunes, errors) is ignored because it lacks the sentinels.
 *
 * @param {string} stdout
 * @returns {{path:string[], commands:Record<string,CommandResult>}}
 */
export function parseProbe(stdout) {
  /** @type {string[]} */
  let path = [];
  /** @type {Record<string, CommandResult>} */
  const commands = {};
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('@@');
    if (at === -1) continue;
    const rest = line.slice(at);
    if (rest.startsWith('@@PATH@@')) {
      path = rest.slice(8).split(':').filter(Boolean);
    } else if (rest.startsWith('@@CMD@@')) {
      const [name, found = '', raw = ''] = rest.slice(7).split('\t');
      commands[name] = describe(name, found.trim(), raw.trim());
    }
  }
  return { path, commands };
}

/**
 * @param {string} name
 * @param {string} found
 * @param {string} raw
 * @returns {CommandResult}
 */
function describe(name, found, raw) {
  if (!found) return { name, kind: 'missing' };
  const version = raw.match(/\d+(?:\.\d+)+/)?.[0];
  if (found.startsWith('/')) {
    let real = found;
    try {
      real = realpathSync(found);
    } catch {
      /* dangling symlink: keep the literal path */
    }
    return { name, kind: 'file', path: found, real, version, raw };
  }
  const kind = found.startsWith('alias') ? 'alias' : 'function';
  return { name, kind, path: found, version, raw };
}

/**
 * Run the probe in one context.
 *
 * @param {import('./contexts.js').Context} ctx
 * @param {string[]} names
 * @param {number} timeoutMs
 * @returns {Promise<ContextResult>}
 */
export function probeContext(ctx, names, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(ctx.cmd, [...ctx.args, buildScript(names)], {
      env: ctx.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ctx, path: [], commands: {}, error: err.message });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const parsed = parseProbe(stdout);
      if (timedOut) {
        resolve({ ...parsed, ctx, error: `timed out after ${timeoutMs / 1000}s (a startup file may be waiting for input)` });
      } else if (!parsed.path.length && !Object.keys(parsed.commands).length) {
        const hint = stderr.trim().split('\n').pop() ?? 'no output';
        resolve({ ...parsed, ctx, error: `shell produced no probe output: ${hint}` });
      } else {
        resolve({ ...parsed, ctx });
      }
    });
  });
}

/**
 * @param {import('./contexts.js').Context[]} contexts
 * @param {string[]} names
 * @param {number} [timeoutMs]
 */
export function probeAll(contexts, names, timeoutMs = 20000) {
  return Promise.all(contexts.map((c) => probeContext(c, names, timeoutMs)));
}
