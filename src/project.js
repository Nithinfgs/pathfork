import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {Object} Requirement
 * @property {string} command   command to probe (node, python3, ...)
 * @property {string} spec      version spec as written
 * @property {string} source    file the requirement came from
 */

const TOOL_VERSIONS_MAP = { nodejs: 'node', node: 'node', python: 'python3', golang: 'go', ruby: 'ruby', java: 'java' };

/** @param {string} file */
function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Read version requirements declared by a project.
 * @param {string} dir
 * @returns {Requirement[]}
 */
export function readRequirements(dir) {
  /** @type {Requirement[]} */
  const reqs = [];
  const add = (/** @type {string} */ command, /** @type {string} */ spec, /** @type {string} */ source) => {
    spec = spec.trim();
    if (spec) reqs.push({ command, spec, source });
  };
  for (const f of ['.nvmrc', '.node-version']) {
    if (existsSync(join(dir, f))) add('node', read(join(dir, f)).split('\n')[0], f);
  }
  if (existsSync(join(dir, '.python-version'))) add('python3', read(join(dir, '.python-version')).split('\n')[0], '.python-version');
  if (existsSync(join(dir, '.ruby-version'))) add('ruby', read(join(dir, '.ruby-version')).split('\n')[0], '.ruby-version');
  if (existsSync(join(dir, '.tool-versions'))) {
    for (const line of read(join(dir, '.tool-versions')).split('\n')) {
      const [tool, ver] = line.replace(/#.*/, '').trim().split(/\s+/);
      const cmd = TOOL_VERSIONS_MAP[/** @type {keyof typeof TOOL_VERSIONS_MAP} */ (tool)];
      if (cmd && ver) add(cmd, ver, '.tool-versions');
    }
  }
  if (existsSync(join(dir, 'package.json'))) {
    try {
      const pkg = JSON.parse(read(join(dir, 'package.json')));
      if (pkg.engines?.node) add('node', String(pkg.engines.node), 'package.json engines.node');
    } catch {
      /* malformed package.json is not our problem */
    }
  }
  const gomod = read(join(dir, 'go.mod')).match(/^go\s+(\d+(?:\.\d+)*)/m);
  if (gomod) add('go', `>=${gomod[1]}`, 'go.mod');
  return reqs;
}

/** @param {string} v */
const nums = (v) => v.split('.').map((n) => (n === 'x' || n === '*' ? NaN : parseInt(n, 10)));

/**
 * @param {number[]} a
 * @param {number[]} b
 */
function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Does `version` satisfy `spec`? Supports exact/prefix ("22", "22.4"), x-ranges,
 * ^, ~, >=, >, <=, <, space-joined AND and `||` OR. Returns null when the spec
 * is something we do not understand (aliases such as lts/*).
 *
 * @param {string} version
 * @param {string} spec
 * @returns {boolean|null}
 */
export function satisfies(version, spec) {
  const v = nums(version);
  const alternatives = spec.split('||');
  let understood = false;
  for (const alt of alternatives) {
    const tokens = alt.trim().replace(/(>=|<=|>|<|\^|~|=)\s+/g, '$1').split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    let all = true;
    let ok = true;
    for (const t of tokens) {
      const r = single(v, t);
      if (r === null) {
        ok = false;
        all = false;
        break;
      }
      if (!r) all = false;
    }
    if (ok) understood = true;
    if (ok && all) return true;
  }
  return understood ? false : null;
}

/**
 * @param {number[]} v
 * @param {string} token
 * @returns {boolean|null}
 */
function single(v, token) {
  const m = token.match(/^(>=|<=|>|<|\^|~|=)?v?(\d+(?:\.(?:\d+|x|\*)){0,2})$/);
  if (!m) return null;
  const op = m[1] ?? '';
  const want = nums(m[2]);
  const concrete = want.filter((n) => !Number.isNaN(n));
  switch (op) {
    case '>=': return cmp(v, concrete) >= 0;
    case '>': return cmp(v, concrete) > 0;
    case '<=': return cmp(v, concrete) <= 0;
    case '<': return cmp(v, concrete) < 0;
    case '^': {
      const major = concrete[0];
      const upper = major > 0 ? [major + 1] : [0, (concrete[1] ?? 0) + 1];
      return cmp(v, concrete) >= 0 && cmp(v, upper) < 0;
    }
    case '~': {
      const upper = concrete.length > 1 ? [concrete[0], concrete[1] + 1] : [concrete[0] + 1];
      return cmp(v, concrete) >= 0 && cmp(v, upper) < 0;
    }
    default:
      return concrete.every((n, i) => v[i] === n);
  }
}
