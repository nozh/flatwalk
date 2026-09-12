import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import type { FlatModel } from '@flatwalk/contract';
import { BuilderError, renderOverlay } from '../src/index.ts';
import { oneRoom } from './helpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../../../fixtures/54541/flat.model.json');
const planPngPath = path.resolve(here, '../../../../../prototype/data/54541/plan.png');

async function solidPng(width: number, height: number, color = '#ffffff'): Promise<Uint8Array> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return new Uint8Array(await canvas.encode('png'));
}

async function pngSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const canvas = createCanvas(1, 1);
  const img = await (await import('@napi-rs/canvas')).loadImage(Buffer.from(bytes));
  canvas.width = img.width;
  canvas.height = img.height;
  return { width: img.width, height: img.height };
}

describe('renderOverlay', () => {
  it('aligns marks to the source PNG size when pxPerMeter is known', async () => {
    const model = oneRoom();
    model.assets = {
      plan: { kind: 'plan', url: 'memory://plan.png', width: 40, height: 30, meta: model.plan.meta },
    };
    model.plan = { ...model.plan, pxPerMeter: 10, asset: 'plan' };
    const plan = await solidPng(40, 30, '#f3f4f6');
    const result = await renderOverlay(model, plan);
    expect(result.meta.modelId).toBe('builder-synth');
    expect(result.meta.revision).toBe(1);
    expect(result.meta.kind).toBe('aligned');
    expect(result.meta.width).toBe(40);
    expect(result.meta.height).toBe(30);
    expect(result.meta.pxPerMeter).toBe(10);
    expect(result.schemePng).toBeUndefined();
    expect(result.meta.ids.rooms).toContain('r1');
    expect(result.meta.ids.walls).toContain('wN');
    expect(result.meta.ids.openings).toContain('oDoor');
    const size = await pngSize(result.png);
    expect(size).toEqual({ width: 40, height: 30 });
  });

  it('does not paint schematic meters onto the plan when pxPerMeter is missing', async () => {
    const model = oneRoom();
    const plan = await solidPng(40, 30, '#ffffff');
    const result = await renderOverlay(model, plan);
    expect(result.meta.kind).toBe('plan-only');
    expect(result.meta.diagnostics).toContain('missing-pxPerMeter');
    expect(result.meta.pxPerMeter).toBeUndefined();
    expect(result.schemePng).toBeInstanceOf(Uint8Array);
    expect(result.schemePng!.byteLength).toBeGreaterThan(100);
    const { loadImage } = await import('@napi-rs/canvas');
    const img = await loadImage(Buffer.from(result.png));
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixel = ctx.getImageData(20, 20, 1, 1).data;
    expect(pixel[0]).toBe(255);
    expect(pixel[1]).toBe(255);
    expect(pixel[2]).toBe(255);
  });

  it('returns a labeled schematic, not an aligned overlay, when there is no plan image', async () => {
    const model = oneRoom();
    const result = await renderOverlay(model);
    expect(result.meta.kind).toBe('scheme');
    expect(result.meta.diagnostics).toContain('missing-plan-png');
    expect(result.meta.modelId).toBe(model.id);
    expect(result.meta.revision).toBe(model.revision);
    const size = await pngSize(result.png);
    expect(size.width).toBeGreaterThan(10);
    expect(size.height).toBeGreaterThan(10);
  });

  it('rejects a contract-invalid model the same way build() does', async () => {
    const broken = oneRoom();
    broken.walls.wN = { ...broken.walls.wN!, a: 'missing', b: 'v2' };
    await expect(renderOverlay(broken)).rejects.toBeInstanceOf(BuilderError);
  });

  it('renders 54541 overlay at the real plan.png size with live IDs', async () => {
    const model = JSON.parse(readFileSync(fixture, 'utf8')) as FlatModel;
    const plan = new Uint8Array(readFileSync(planPngPath));
    const result = await renderOverlay(model, plan);
    expect(result.meta.kind).toBe('aligned');
    expect(result.meta.modelId).toBe('cityexpert-54541');
    expect(result.meta.revision).toBe(0);
    expect(result.meta.width).toBe(940);
    expect(result.meta.height).toBe(786);
    expect(result.meta.ids.rooms).toEqual(expect.arrayContaining(['r1', 'r10']));
    expect(result.meta.ids.openings).toContain('o10');
    const outDir = path.join(here, 'output');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'overlay-54541.png'), result.png);
    writeFileSync(path.join(outDir, 'overlay-54541.meta.json'), JSON.stringify(result.meta, null, 2));

    const unscaled = structuredClone(model);
    delete unscaled.plan.pxPerMeter;
    const bare = await renderOverlay(unscaled, plan);
    expect(bare.meta.kind).toBe('plan-only');
    writeFileSync(path.join(outDir, 'plan-only-54541.png'), bare.png);
    if (bare.schemePng) writeFileSync(path.join(outDir, 'scheme-54541.png'), bare.schemePng);
  });
});
