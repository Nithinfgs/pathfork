import { dirname } from 'node:path';
import { buildContexts, shellKind } from './contexts.js';
import { probeAll, isSafeName } from './probe.js';
import { analyze } from './compare.js';
import { explainDifference, tilde, findSources } from './explain.js';
import { readRequirements, satisfies } from './project.js';

export const DEFAULT_COMMANDS = ['node', 'npm', 'python3', 'pip3', 'git', 'ruby', 'go', 'java', 'cargo', 'uv', 'pnpm', 'docker'];

/**
 * @typedef {Object} Options
 * @property {string[]} commands      explicit commands (empty = defaults)
 * @property {string} shell
 * @property {string} platform
 * @property {string} home
 * @property {Record<string,string|undefined>} env
 * @property {string} [project]       directory to read version requirements from
 * @property {string[]} [only]        restrict contexts
 * @property {number} [timeoutMs]
 * @property {string} [cronPath]
 * @property {string} [guiPath]
 * @property {boolean} [inherit]       shells inherit the full current environment
 */

/**
 * @param {Options} opts
 */
export async function runCheck(opts) {
  const explicit = opts.commands.length > 0;
  const bad = opts.commands.filter((c) => !isSafeName(c));
  if (bad.length) throw new Error(`Invalid command name: ${bad.join(', ')} (letters, digits, . _ + - only)`);

  const requirements = opts.project ? readRequirements(opts.project) : [];
  const names = [...new Set([...(explicit ? opts.commands : DEFAULT_COMMANDS), ...requirements.map((r) => r.command)])];

  const contexts = buildContexts({
    shell: opts.shell,
    platform: opts.platform,
    home: opts.home,
    env: opts.env,
    cronPath: opts.cronPath,
    guiPath: opts.guiPath,
    inherit: opts.inherit,
    only: opts.only,
  });
  const kind = shellKind(opts.shell);
  const results = await probeAll(contexts, names, opts.timeoutMs);
  const ok = results.filter((r) => !r.error);
  const x = { home: opts.home, kind, contexts };

  let analyses = names.map((n) => analyze(results, n));
  // Default commands that exist nowhere are noise; explicitly requested ones are not.
  analyses = analyses.filter((a) => a.severity !== 'absent' || explicit || requirements.some((r) => r.command === a.name));

  const findings = analyses.map((a) => {
    /** @type {string[]} */
    let why = [];
    /** @type {string|undefined} */
    let manager;
    if (a.severity !== 'ok' && a.severity !== 'absent') {
      const ref = a.groups.find((g) => g.state === 'found' && g.contexts.includes('terminal')) ?? a.groups.find((g) => g.state === 'found');
      const others = a.groups.filter((g) => g !== ref).flatMap((g) => g.contexts);
      if (ref && ref.sample.kind === 'file' && ref.sample.path) {
        ({ lines: why, manager } = explainDifference(dirname(ref.sample.path), ref.contexts, others, x));
      } else if (ref) {
        why = [`${a.name} is a shell ${ref.sample.kind} defined by your startup files, so it only exists where they run.`];
      }
    }
    return { ...a, why, manager };
  });

  const projectChecks = requirements.map((req) => {
    const per = ok.map((r) => {
      const c = r.commands[req.command];
      const version = c?.version;
      return {
        context: r.ctx.id,
        found: !!c && c.kind !== 'missing',
        version,
        satisfied: version ? satisfies(version, req.spec.replace(/^v/, '')) : c && c.kind !== 'missing' ? null : false,
      };
    });
    return { ...req, per };
  });

  return {
    meta: { shell: opts.shell, kind, platform: opts.platform, home: opts.home },
    contexts: results.map((r) => ({ id: r.ctx.id, title: r.ctx.title, how: r.ctx.how, error: r.error, pathEntries: r.path.length })),
    findings,
    project: projectChecks,
    pathDiff: buildPathDiff(ok, x),
  };
}

/**
 * @param {import('./probe.js').ContextResult[]} ok
 * @param {{home:string, kind:string, contexts:import('./contexts.js').Context[]}} x
 */
function buildPathDiff(ok, x) {
  /** @type {string[]} */
  const order = [];
  for (const r of ok) for (const p of r.path) if (!order.includes(p)) order.push(p);
  return order
    .map((dir) => {
      const present = ok.filter((r) => r.path.includes(dir)).map((r) => r.ctx.id);
      const absent = ok.filter((r) => !r.path.includes(dir)).map((r) => r.ctx.id);
      if (!absent.length) return null;
      const src = findSources(dir, x).sources[0];
      return { dir, display: tilde(dir, x.home), present, absent, source: src ? `${src.file}:${src.line}` : undefined };
    })
    .filter((e) => e !== null);
}

/** Highest severity across a report, for exit codes. */
export function worst(/** @type {Awaited<ReturnType<typeof runCheck>>} */ report) {
  const order = { ok: 0, absent: 0, info: 1, warn: 2, error: 3 };
  let w = 0;
  for (const f of report.findings) w = Math.max(w, order[f.severity]);
  for (const p of report.project) if (p.per.some((x) => x.satisfied === false)) w = 3;
  for (const c of report.contexts) if (c.error) w = Math.max(w, 2);
  return w;
}
