import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../dist/worker', import.meta.url));
const exts = new Set(['.js', '.mjs', '.cjs', '.json']);

function ensureJsExtension(spec) {
  if (!spec.startsWith('.')) return spec;
  if (spec.includes('?')) return spec;
  const parts = spec.split('/');
  const last = parts[parts.length - 1] ?? '';
  if (!last) return spec;
  const extIndex = last.lastIndexOf('.');
  if (extIndex !== -1) {
    const ext = last.slice(extIndex);
    if (exts.has(ext)) return spec;
  }
  return `${spec}.js`;
}

const patterns = [
  new RegExp(String.raw`(import\s+[^'";]+\s+from\s+['"])(\.\.?(?:\/[^'";]+)*)(['"])`, 'g'),
  new RegExp(String.raw`(export\s+(?:\*|\{[^}]*\})\s+from\s+['"])(\.\.?(?:\/[^'";]+)*)(['"])`, 'g'),
  new RegExp(String.raw`(import\(\s*['"])(\.\.?(?:\/[^'";]+)*)(['"]\s*\))`, 'g')
];

async function processFile(path) {
  const source = await readFile(path, 'utf8');
  let updated = source;
  for (const pattern of patterns) {
    updated = updated.replace(pattern, (_match, prefix, spec, suffix) => {
      return `${prefix}${ensureJsExtension(spec)}${suffix}`;
    });
  }
  if (updated !== source) {
    await writeFile(path, updated);
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      await processFile(fullPath);
    }
  }
}

await walk(rootDir);
