import { tilde } from './explain.js';

/** @param {boolean} on */
function palette(on) {
  const w = (/** @type {string} */ c) => (/** @type {string} */ s) => (on ? `\x1b[${c}m${s}\x1b[0m` : s);
  return { bold: w('1'), dim: w('2'), red: w('31'), green: w('32'), yellow: w('33'), cyan: w('36') };
}

/**
 * Greedy word wrap. Continuation lines are indented by `indent` spaces.
 * @param {string} text
 * @param {number} width
 * @param {number} indent
 */
function wrap(text, width, indent) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.map((l, i) => (i ? ' '.repeat(indent) + l : l)).join('\n');
}

const ICON = { ok: '✓', info: '~', warn: '!', error: '✗', absent: '·' };

/**
 * @param {Awaited<ReturnType<import('./check.js').runCheck>>} report
 * @param {{color:boolean, version:string}} o
 */
export function renderText(report, { color, version }) {
  const c = palette(color);
  const sev = { ok: c.green, info: c.cyan, warn: c.yellow, error: c.red, absent: c.dim };
  const home = report.meta.home;
  const out = [];
  out.push(`${c.bold('pathfork')} ${c.dim(version)} ${c.dim('·')} ${report.meta.kind} ${c.dim('·')} ${report.meta.platform}`);
  out.push('');
  const w = Math.max(...report.contexts.map((x) => x.id.length));
  for (const x of report.contexts) {
    const tail = x.error ? c.red(`failed: ${x.error}`) : c.dim(x.title);
    out.push(`  ${c.bold(x.id.padEnd(w))}  ${c.dim(x.how.padEnd(20))} ${tail}`);
  }
  out.push('');

  const bad = report.findings.filter((f) => f.severity !== 'ok');
  const good = report.findings.filter((f) => f.severity === 'ok');
  for (const f of bad) {
    out.push(`${sev[f.severity](ICON[f.severity])} ${c.bold(f.name)} ${c.dim('·')} ${f.summary}`);
    for (const g of f.groups) {
      const s = g.sample;
      const what =
        g.state === 'missing'
          ? c.red('not found'.padEnd(10))
          : `${(s.version ? `v${s.version}` : s.kind === 'file' ? '' : s.kind).padEnd(10)} ${tilde(s.path ?? '', home)}`;
      out.push(`    ${what}  ${c.dim(g.contexts.join(', '))}`);
    }
    f.why.forEach((line, i) => out.push(`    ${i === 0 ? c.dim('why  ') : '     '} ${wrap(line, 84, 10)}`));
    out.push('');
  }
  if (good.length) {
    const list = good
      .map((f) => `${f.name}${f.groups[0].sample.version ? ' ' + f.groups[0].sample.version : ''}`)
      .join(', ');
    out.push(`${c.green('✓')} consistent everywhere: ${c.dim(list)}`);
    out.push('');
  }

  for (const p of report.project) {
    const failing = p.per.filter((x) => x.satisfied === false);
    const unknown = p.per.every((x) => x.satisfied === null);
    const head = `${c.bold('project')} ${p.source} wants ${p.command} ${c.bold(p.spec)}`;
    if (unknown) out.push(`${c.cyan('~')} ${head} ${c.dim('· could not interpret this spec, not checked')}`);
    else if (!failing.length) out.push(`${c.green('✓')} ${head} ${c.dim('· satisfied in every context')}`);
    else {
      out.push(`${c.red('✗')} ${head}`);
      for (const x of p.per) {
        const tag = x.satisfied === false ? c.red('✗') : c.green('✓');
        out.push(`    ${tag} ${x.context.padEnd(w)}  ${x.found ? (x.version ? `v${x.version}` : 'found') : c.red('not found')}`);
      }
    }
    out.push('');
  }

  const errors = report.findings.filter((f) => f.severity === 'error').length;
  const warns = report.findings.filter((f) => f.severity === 'warn').length;
  const projBad = report.project.filter((p) => p.per.some((x) => x.satisfied === false)).length;
  if (errors + warns + projBad === 0) {
    out.push(c.green('No meaningful differences between contexts.'));
  } else {
    out.push(
      c.bold(`${errors + projBad} problem${errors + projBad === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`) +
        c.dim(' · run `pathfork path` to see which PATH entries differ'),
    );
  }
  return out.join('\n');
}

/**
 * @param {Awaited<ReturnType<import('./check.js').runCheck>>} report
 * @param {{color:boolean}} o
 */
export function renderPath(report, { color }) {
  const c = palette(color);
  const ids = report.contexts.filter((x) => !x.error).map((x) => x.id);
  if (!report.pathDiff.length) return c.green('PATH is identical in every context.');
  const out = [c.bold('PATH entries that are not present in every context'), ''];
  out.push(`  ${c.bold(ids.map((i) => i.padEnd(17)).join(''))}entry`);
  for (const e of report.pathDiff) {
    const cells = ids.map((i) => (e.present.includes(i) ? c.green('●') : c.dim('·')) + ' '.repeat(16));
    out.push(`  ${cells.join('')}${e.display}${e.source ? c.dim(`  ← ${e.source}`) : ''}`);
  }
  return out.join('\n');
}

/**
 * Markdown, suitable for pasting into an issue or PR comment.
 * @param {Awaited<ReturnType<import('./check.js').runCheck>>} report
 */
export function renderMarkdown(report) {
  const home = report.meta.home;
  const out = ['## pathfork report', '', `Shell: \`${report.meta.kind}\` on \`${report.meta.platform}\``, ''];
  out.push('| command | status | details |', '|---|---|---|');
  for (const f of report.findings) {
    const detail = f.groups
      .map((g) => `${g.state === 'missing' ? 'missing' : `${g.sample.version ? 'v' + g.sample.version + ' ' : ''}\`${tilde(g.sample.path ?? '', home)}\``} (${g.contexts.join(', ')})`)
      .join('<br>');
    out.push(`| \`${f.name}\` | ${ICON[f.severity]} ${f.summary} | ${detail} |`);
  }
  const why = report.findings.filter((f) => f.why.length);
  if (why.length) {
    out.push('', '### Why');
    for (const f of why) out.push(`- **${f.name}**: ${f.why.join(' ')}`);
  }
  return out.join('\n');
}
