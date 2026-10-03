/**
 * @typedef {Object} Group
 * @property {'found'|'missing'} state
 * @property {string[]} contexts   context ids sharing this outcome
 * @property {import('./probe.js').CommandResult} sample
 */

/**
 * @typedef {Object} Analysis
 * @property {string} name
 * @property {Group[]} groups
 * @property {'ok'|'info'|'warn'|'error'|'absent'} severity
 * @property {string} summary
 */

/** @param {string} v */
const parts = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);

/**
 * @param {import('./probe.js').ContextResult[]} results
 * @param {string} name
 * @returns {Analysis}
 */
export function analyze(results, name) {
  /** @type {Map<string, Group>} */
  const byKey = new Map();
  for (const r of results) {
    if (r.error) continue;
    const c = r.commands[name] ?? { name, kind: 'missing' };
    const key =
      c.kind === 'missing' ? 'missing' : `${c.kind === 'file' ? c.real : c.path}|${c.version ?? ''}`;
    const g = byKey.get(key);
    if (g) g.contexts.push(r.ctx.id);
    else byKey.set(key, { state: c.kind === 'missing' ? 'missing' : 'found', contexts: [r.ctx.id], sample: c });
  }
  const groups = [...byKey.values()].sort((a, b) => b.contexts.length - a.contexts.length);
  const found = groups.filter((g) => g.state === 'found');
  const missing = groups.find((g) => g.state === 'missing');

  if (!found.length) {
    return { name, groups, severity: 'absent', summary: 'not found in any context' };
  }
  if (groups.length === 1) {
    return { name, groups, severity: 'ok', summary: `same in all ${groups[0].contexts.length} contexts` };
  }
  if (missing) {
    return {
      name,
      groups,
      severity: 'error',
      summary: `missing in ${missing.contexts.join(', ')}`,
    };
  }
  const versions = found.map((g) => g.sample.version).filter(Boolean);
  const distinct = [...new Set(versions)];
  if (distinct.length > 1) {
    const majors = new Set(distinct.map((v) => parts(/** @type {string} */ (v))[0]));
    return {
      name,
      groups,
      severity: majors.size > 1 ? 'error' : 'warn',
      summary: `${distinct.length} different versions: ${distinct.join(' vs ')}`,
    };
  }
  return { name, groups, severity: 'info', summary: 'same version, different install paths' };
}
