import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserCanvasHost, renderOverlay } from '../src/index.ts';
import { oneRoom } from './helpers.ts';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function installOffscreenCanvasShim() {
  const previous = globalThis.OffscreenCanvas;
  class ShimOffscreenCanvas {
    width: number;
    height: number;
    #canvas: ReturnType<typeof createCanvas>;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.#canvas = createCanvas(width, height);
    }
    getContext(kind: string) {
      if (kind !== '2d') return null;
      return this.#canvas.getContext('2d');
    }
    async convertToBlob() {
      const bytes = await this.#canvas.encode('png');
      return new Blob([Uint8Array.from(bytes)], { type: 'image/png' });
    }
  }
  globalThis.OffscreenCanvas = ShimOffscreenCanvas as unknown as typeof OffscreenCanvas;
  return () => {
    if (previous) globalThis.OffscreenCanvas = previous;
    else delete (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
  };
}

describe('createBrowserCanvasHost', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('returns a PNG from the shared overlay renderer', async () => {
    restore = installOffscreenCanvasShim();
    const host = createBrowserCanvasHost();
    const result = await renderOverlay(oneRoom(), undefined, { host });
    expect(result.meta.kind).toBe('scheme');
    expect([...result.png.slice(0, 4)]).toEqual(PNG_MAGIC);
    expect(result.png.byteLength).toBeGreaterThan(100);
  });
});
