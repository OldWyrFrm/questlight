// Builds one self-contained page: data, CSS and JS are inlined so it works from file://.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundle, loadData, validate } from './data.mjs';

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), 'utf8');
const fail = (message) => { console.error(`✗ ${message}`); process.exit(1); };
const sample = process.argv.includes('--sample');

const data = loadData(root(sample ? 'fixtures/sample' : 'data'));
const errors = validate(data);
if (errors.length) fail(`Data is not valid, so nothing was built:\n  ${errors.join('\n  ')}`);

// Source files are ES modules; inlined they become one script, so imports and exports go.
const js = `(() => {\n'use strict';\n${['src/graph.js', 'src/app.js'].map(read).join('\n')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')}\n})();`;
const css = read('src/styles.css');
const json = JSON.stringify(bundle(data, sample)).replace(/</g, '\\u003c');
if (/<\/script/i.test(js)) fail('src JavaScript contains "</script", which would break the inlined page.');
if (/<\/style/i.test(css)) fail('src/styles.css contains "</style", which would break the inlined page.');

// The policy allows only this exact script and stylesheet, and no network requests at all.
const hash = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
const policy = `default-src 'none'; script-src ${hash(js)}; style-src ${hash(css)}; img-src data:; base-uri 'none'; form-action 'none'`;
const parts = {
  CSP: `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
  STYLE: `<style>${css}</style>`,
  DATA: `<script type="application/json" id="data">${json}</script>`,
  SCRIPT: `<script>${js}</script>`,
};
let html = read('src/index.html');
for (const [name, value] of Object.entries(parts)) {
  if (!html.includes(`<!--${name}-->`)) fail(`src/index.html is missing the <!--${name}--> placeholder.`);
  html = html.replace(`<!--${name}-->`, () => value);
}

mkdirSync(root('dist'), { recursive: true });
for (const file of ['index.html', 'questlight.html']) writeFileSync(root(`dist/${file}`), html);
console.log(`✓ Built dist/index.html and dist/questlight.html (${(html.length / 1024).toFixed(1)} KB${sample ? ', sample data' : ''}).`);
