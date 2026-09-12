import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const importRe = /(?:from|import)\s*\(\s*['"]([^'"]+)['"]|from\s+['"]([^'"]+)['"]/g;

function walk(entry: string): string[] {
  const visited: string[] = [];
  const queue = [path.resolve(srcRoot, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.includes(file) || !file.startsWith(srcRoot) || !file.endsWith('.ts')) continue;
    visited.push(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(importRe)) {
      const spec = match[1] ?? match[2] ?? '';
      if (spec.startsWith('.')) queue.push(path.resolve(path.dirname(file), spec));
      else if (spec === '@napi-rs/canvas' || spec.startsWith('@napi-rs/canvas/')) visited.push(spec);
    }
  }
  return visited.map(file => (file.startsWith(srcRoot) ? path.relative(srcRoot, file) : file));
}

describe('browser entry import graph', () => {
  it('does not reach overlay-node or @napi-rs/canvas from the public package root', () => {
    const files = walk('index.ts');
    expect(files).toContain('overlay.ts');
    expect(files).not.toContain('overlay-node.ts');
    expect(files.some(file => file.includes('@napi-rs/canvas'))).toBe(false);
  });
});
