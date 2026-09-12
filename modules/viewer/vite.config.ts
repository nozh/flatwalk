import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const viewerRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(viewerRoot, '../..');
const fixtureDir = resolve(repoRoot, 'fixtures/54541');
const defaultRun = resolve(viewerRoot, 'demo-run');
const runDir = resolve(process.env.FLATWALK_RUN ?? defaultRun);

const mime: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !normalize(rel).startsWith(`..${sep}`);
}

function sendFile(root: string, urlPath: string, res: ServerResponse): void {
  const relativePath = decodeURIComponent(urlPath.split('?')[0] ?? '').replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('\0')) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const file = resolve(root, relativePath);
  if (!inside(root, file) || !existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  res.setHeader('Content-Type', mime[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}

function attachStatic(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? '';
    if (url.startsWith('/fixtures/54541/')) {
      if (!existsSync(fixtureDir)) {
        res.statusCode = 404;
        res.end('54541 fixture is not available yet');
        return;
      }
      sendFile(fixtureDir, url.slice('/fixtures/54541/'.length), res);
      return;
    }
    if (url.startsWith('/model/') || url.startsWith('/materials/') || url.startsWith('/validation/')) {
      sendFile(runDir, url, res);
      return;
    }
    next();
  });
}

function emitTree(plugin: { emitFile: (file: { type: 'asset'; fileName: string; source: Buffer }) => void }, from: string, prefix: string): void {
  if (!existsSync(from)) return;
  for (const name of readdirSync(from, { withFileTypes: true })) {
    const full = join(from, name.name);
    const dest = `${prefix}/${name.name}`;
    if (name.isDirectory()) emitTree(plugin, full, dest);
    else if (name.isFile() && mime[extname(name.name).toLowerCase()]) {
      plugin.emitFile({ type: 'asset', fileName: dest, source: readFileSync(full) });
    }
  }
}

function staticData(): Plugin {
  return {
    name: 'flatwalk-static-data',
    configureServer: attachStatic,
    configurePreviewServer: attachStatic,
    generateBundle() {
      emitTree(this, fixtureDir, 'fixtures/54541');
      emitTree(this, join(runDir, 'model'), 'model');
      emitTree(this, join(runDir, 'materials'), 'materials');
    },
  };
}

export default defineConfig({
  root: viewerRoot,
  resolve: { dedupe: ['three'] },
  // Builder's renderOverlay picks a canvas host at runtime: the Node host imports the native @napi-rs/canvas
  // binding, which the browser branch never loads. Keep it out of pre-bundling and of the browser bundle.
  optimizeDeps: { exclude: ['@napi-rs/canvas'] },
  build: { rollupOptions: { external: ['@napi-rs/canvas'] } },
  server: { port: 5173, strictPort: true, fs: { allow: [viewerRoot, repoRoot] } },
  preview: { port: 4173, strictPort: true },
  plugins: [staticData()],
});
