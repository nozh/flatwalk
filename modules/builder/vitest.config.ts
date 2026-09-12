import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@flatwalk/geometry': path.resolve(root, '../geometry/src/index.ts'),
    },
  },
  test: {
    dir: root,
    include: ['test/**/*.test.ts'],
  },
});
