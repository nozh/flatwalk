import type { OverlayCanvasHost, OverlaySurface } from './overlay-host.ts';

function surfaceFromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): OverlaySurface {
  return {
    width: canvas.width,
    height: canvas.height,
    getContext: () => canvas.getContext('2d') as CanvasRenderingContext2D,
    async encodePng() {
      if ('convertToBlob' in canvas) {
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return new Uint8Array(await blob.arrayBuffer());
      }
      const blob = await new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(result => {
          if (result) resolve(result);
          else reject(new Error('canvas toBlob failed'));
        }, 'image/png');
      });
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

export function createBrowserCanvasHost(): OverlayCanvasHost {
  return {
    create(width, height) {
      if (typeof OffscreenCanvas !== 'undefined') {
        return surfaceFromCanvas(new OffscreenCanvas(width, height));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return surfaceFromCanvas(canvas);
    },
    async loadImage(bytes) {
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
        type: 'image/png',
      });
      const source = await createImageBitmap(blob);
      return { width: source.width, height: source.height, source };
    },
  };
}
