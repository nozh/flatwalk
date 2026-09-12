import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { OverlayCanvasHost, OverlaySurface } from './overlay-host.ts';

function surface(width: number, height: number): OverlaySurface {
  const canvas = createCanvas(width, height);
  return {
    width,
    height,
    getContext: () => canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
    encodePng: async () => new Uint8Array(await canvas.encode('png')),
  };
}

/** Node adapter. Browser consumers pass a host or use createBrowserCanvasHost. */
export function createNodeCanvasHost(): OverlayCanvasHost {
  return {
    create: surface,
    async loadImage(bytes) {
      const image = await loadImage(Buffer.from(bytes));
      return { width: image.width, height: image.height, source: image as unknown as CanvasImageSource };
    },
  };
}
