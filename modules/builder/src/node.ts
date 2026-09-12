import type { FlatModel } from '@flatwalk/contract';
import { renderOverlay as renderOverlayOnHost, type RenderOverlayOptions } from './overlay.ts';
import { createNodeCanvasHost } from './overlay-node.ts';

export {
  build,
  buildScene,
  BuilderError,
  defaultGeometry,
  toGLB,
  createBrowserCanvasHost,
  overlayIds,
  overlayMarks,
  snapshot,
  roundCm,
} from './index.ts';
export type {
  BuildOptions,
  BuiltScene,
  BuilderGeometry,
  OverlayKind,
  OverlayMeta,
  OverlayResult,
  RenderOverlayOptions,
  OverlayCanvasHost,
  MeshSnapshot,
} from './index.ts';

export { createNodeCanvasHost };

/** Node overlay: `@napi-rs/canvas`. Browser bundles must keep using `@flatwalk/builder`. */
export function renderOverlay(model: FlatModel, planPng?: Uint8Array, options: RenderOverlayOptions = {}) {
  return renderOverlayOnHost(model, planPng, {
    ...options,
    host: options.host ?? createNodeCanvasHost(),
  });
}
