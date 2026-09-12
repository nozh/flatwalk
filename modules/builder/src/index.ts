export { build, buildScene, type BuildOptions, type BuiltScene } from './build.ts';
export { BuilderError } from './errors.ts';
export { defaultGeometry, type BuilderGeometry } from './floors.ts';
export { toGLB } from './glb.ts';
export { createBrowserCanvasHost } from './overlay-browser.ts';
export { overlayIds, overlayMarks } from './overlay-marks.ts';
export { renderOverlay, type OverlayKind, type OverlayMeta, type OverlayResult, type RenderOverlayOptions } from './overlay.ts';
export type { OverlayCanvasHost } from './overlay-host.ts';
export { snapshot, roundCm, type MeshSnapshot } from './snapshot.ts';
