import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
/** three's GLTFExporter uses FileReader on Blobs; Node 18 has Blob but not FileReader. */
function ensureFileReader() {
  if (typeof FileReader !== 'undefined') return;
  globalThis.FileReader = class FileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then(buffer => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(buffer => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        this.result = `data:application/octet-stream;base64,${btoa(binary)}`;
        this.onloadend?.();
      });
    }
  } as unknown as typeof FileReader;
}

/** Node/browser GLB export. Not a substitute for snapshot tests; Viewer should consume `build()`. */
export function toGLB(root: THREE.Object3D): Promise<ArrayBuffer> {
  ensureFileReader();
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      result => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('toGLB expected a binary GLB ArrayBuffer'));
      },
      reject,
      { binary: true },
    );
  });
}
