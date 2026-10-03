#!/usr/bin/env node
// Renders real pathfork output (ANSI) into a small SVG "screenshot" for the README.
// usage: node scripts/render-svg.js <out.svg> <command shown> -- <pathfork args...>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [out, shown, sep, ...args] = process.argv.slice(2);
if (!out || !shown || sep !== '--') {
  console.error('usage: render-svg.js <out.svg> <command shown> -- <pathfork args...>');
  process.exit(2);
}

// pathfork exits 1 when it finds problems, which is the point of the demo.
const run = spawnSync(process.execPath, ['bin/pathfork.js', ...args], {
  env: { ...process.env, FORCE_COLOR: '1' },
  encoding: 'utf8',
});
if (run.status === 2 || run.error) throw new Error(run.stderr || String(run.error));
const result = run.stdout;

const COLORS = { 1: null, 2: '#6e7681', 31: '#ff7b72', 32: '#7ee787', 33: '#e3b341', 36: '#79c0ff' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Parse one ANSI-coloured line into [{text, color, bold}]. */
function spans(line) {
  const out = [];
  let color = null;
  let bold = false;
  for (const part of line.split(/(\x1b\[\d+m)/)) {
    const m = part.match(/^\x1b\[(\d+)m$/);
    if (m) {
      const code = Number(m[1]);
      if (code === 0) (color = null), (bold = false);
      else if (code === 1) bold = true;
      else color = COLORS[code] ?? color;
    } else if (part) out.push({ text: part, color, bold });
  }
  return out;
}

const lines = [`\x1b[32m$\x1b[0m ${shown}`, '', ...result.replace(/\n+$/, '').split('\n')];
const CW = 8.4;
const LH = 19;
const plain = (l) => l.replace(/\x1b\[\d+m/g, '');
const cols = Math.max(...lines.map((l) => plain(l).length));
const width = Math.ceil(cols * CW + 48);
const height = lines.length * LH + 72;

const rows = lines
  .map((l, i) => {
    const y = 64 + i * LH;
    const tspans = spans(l)
      .map((s) => `<tspan${s.color ? ` fill="${s.color}"` : ''}${s.bold ? ' font-weight="700"' : ''}>${esc(s.text)}</tspan>`)
      .join('');
    return `<text x="24" y="${y}" xml:space="preserve">${tspans}</text>`;
  })
  .join('\n');

writeFileSync(
  out,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="pathfork output: node resolves to different versions depending on how the shell starts">
<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
<rect width="${width}" height="36" rx="10" fill="#161b22"/><rect y="26" width="${width}" height="10" fill="#161b22"/>
<circle cx="22" cy="18" r="6" fill="#ff5f56"/><circle cx="42" cy="18" r="6" fill="#ffbd2e"/><circle cx="62" cy="18" r="6" fill="#27c93f"/>
<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="14" fill="#c9d1d9">
${rows}
</g>
</svg>
`,
);
console.log(`wrote ${out} (${width}x${height})`);
