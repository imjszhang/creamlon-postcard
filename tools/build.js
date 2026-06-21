/**
 * Creamlon Postcard site builder.
 * Copies site/src into dist for GitHub Pages deployment.
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = join(root, 'site', 'src');
const out = join(root, 'dist');

console.log('\n  Build: creamlon-postcard site');
console.log('  ' + '='.repeat(40));

console.log('  [1/3] Cleaning dist/ ...');
if (existsSync(out)) {
  rmSync(out, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
mkdirSync(out, { recursive: true });

console.log('  [2/3] Copying site/src/ -> dist/ ...');
cpSync(src, out, { recursive: true });

console.log('  [3/3] Writing .nojekyll ...');
writeFileSync(join(out, '.nojekyll'), '');

console.log('  ' + '='.repeat(40));
console.log('  Output: dist/\n');
