import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startupFiles } from './contexts.js';

const MANAGERS = [
  { id: 'nvm', line: /nvm/i, match: /(^|\/)\.?nvm(\/|$)/i, hint: 'nvm has no shims, so only shells that source nvm.sh see its node. Either source it from a file those shells read, or switch to a shim-based manager (fnm, mise, volta, asdf).' },
  { id: 'pyenv', match: /pyenv/i, hint: 'pyenv works in non-interactive shells if its shims directory ($PYENV_ROOT/shims) is on PATH. Put that export in a file every shell reads.' },
  { id: 'rbenv', match: /rbenv/i, hint: 'rbenv works in non-interactive shells if $HOME/.rbenv/shims is on PATH.' },
  { id: 'asdf', line: /asdf/i, match: /(^|\/)\.?asdf(\/|$)/i, hint: 'asdf works in non-interactive shells if its shims directory is on PATH.' },
  { id: 'mise', line: /mise/i, match: /(^|\/)mise(\/|$)/i, hint: 'mise activation is interactive-only; for scripts and agents put the shims directory on PATH (`mise activate --shims`).' },
  { id: 'fnm', match: /fnm/i, hint: '`fnm env` must run in a file that non-interactive shells read, or fnm will only apply in your terminal.' },
  { id: 'volta', match: /volta/i, hint: 'Volta uses shims; make sure $VOLTA_HOME/bin is on PATH in a file every shell reads.' },
  { id: 'sdkman', match: /sdkman/i, hint: 'SDKMAN is initialised by a script that is usually only sourced interactively; add its `candidates/*/current/bin` directories to PATH instead.' },
  { id: 'conda', match: /(conda|miniforge|mambaforge)/i, hint: '`conda init` edits ~/.bashrc/.zshrc, so the conda Python is interactive-only by design.' },
  { id: 'homebrew', match: /(\/opt\/homebrew|linuxbrew)/i, hint: 'Homebrew is added by `brew shellenv`; it usually belongs in a profile file (.zprofile / .bash_profile), which non-login shells skip.' },
];

/** @param {string} dir */
export function detectManager(dir) {
  return MANAGERS.find((m) => m.match.test(dir));
}

/**
 * @param {string} file
 * @returns {string[]}
 */
function readLines(file) {
  try {
    return readFileSync(file, 'utf8').split('\n');
  } catch {
    return [];
  }
}

/** Does `lines[idx]` come after a guard that stops non-interactive shells? */
function findGuard(/** @type {string[]} */ lines, /** @type {number} */ idx) {
  for (let i = 0; i < idx; i++) {
    const l = lines[i];
    if (/^\s*#/.test(l)) continue;
    const mentionsInteractive = /\$-|\$PS1|\*i\*/.test(l);
    if (!mentionsInteractive) continue;
    const window = lines.slice(i, i + 4).join(' ');
    if (/\b(return|exit)\b/.test(window)) return i + 1;
  }
  return 0;
}

/**
 * Find which startup file lines mention `dir`, and who reads them.
 *
 * @param {string} dir     directory of interest (absolute)
 * @param {Object} o
 * @param {string} o.home
 * @param {string} o.kind  shell kind
 * @param {import('./contexts.js').Context[]} o.contexts
 */
export function findSources(dir, { home, kind, contexts }) {
  const needles = new Set([dir]);
  if (dir.startsWith(home)) {
    const rel = dir.slice(home.length);
    needles.add(`$HOME${rel}`);
    needles.add(`\${HOME}${rel}`);
    needles.add(`~${rel}`);
  }
  const manager = detectManager(dir);
  /** @type {{file:string, line:number, text:string, readBy:string[], why:string, guardLine:number}[]} */
  const sources = [];
  const files = startupFiles(kind);
  // Most bash setups have .bash_profile source .bashrc, which makes login shells read it too.
  const profileSourcesRc =
    kind === 'bash' &&
    files.some((f) => /profile|login/.test(f.file) && readLines(join(home, f.file)).some((l) => !/^\s*#/.test(l) && l.includes('.bashrc')));
  for (const sf of files) {
    const full = join(home, sf.file);
    if (!existsSync(full)) continue;
    const lines = readLines(full);
    lines.forEach((text, i) => {
      if (/^\s*#/.test(text)) return;
      const hit = [...needles].some((n) => text.includes(n)) || (manager && (manager.line ?? manager.match).test(text) && /PATH|source|\. |eval|init|env/.test(text));
      if (!hit) return;
      sources.push({
        file: `~/${sf.file}`,
        line: i + 1,
        text: text.trim(),
        readBy: contexts.filter((c) => sf.reads(c.props) || (profileSourcesRc && sf.file === '.bashrc' && !c.props.clean && c.props.login)).map((c) => c.id),
        why: sf.why,
        guardLine: findGuard(lines, i),
      });
    });
  }
  return { dir, manager, sources };
}

/**
 * Produce human-readable reasons why `present` contexts have something
 * `absent` contexts lack.
 *
 * @param {string} dir
 * @param {string[]} present
 * @param {string[]} absent
 * @param {{home:string, kind:string, contexts:import('./contexts.js').Context[]}} o
 * @returns {{lines:string[], manager?:string}}
 */
export function explainDifference(dir, present, absent, o) {
  const { sources, manager } = findSources(dir, o);
  const lines = [];
  const effective = sources.filter((s) => s.readBy.some((id) => present.includes(id)));
  const use = effective.length ? effective : sources;
  if (!use.length) {
    lines.push(
      `${tilde(dir, o.home)} is not set in your shell startup files; it is inherited from the parent process or a system file such as /etc/paths.d.`,
    );
  }
  for (const s of use.slice(0, 2)) {
    const byId = new Map(o.contexts.map((c) => [c.id, c]));
    const runsIn = s.readBy.filter((id) => !s.guardLine || byId.get(id)?.props.interactive);
    const skipped = absent.filter((id) => !runsIn.includes(id));
    lines.push(`${s.file}:${s.line} adds it: ${trim(s.text)}`);
    if (s.guardLine) lines.push(`${s.file}:${s.guardLine} returns early for non-interactive shells`);
    else lines.push(`${s.file} is only read by ${s.why}`);
    if (skipped.length) lines.push(`so it does not apply in: ${skipped.join(', ')}`);
  }
  if (manager) lines.push(manager.hint);
  return { lines, manager: manager?.id };
}

/** @param {string} p @param {string} home */
export function tilde(p, home) {
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** @param {string} s */
function trim(s) {
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}
