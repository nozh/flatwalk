import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { BuilderError } from './errors.ts';
import { drawBanner, drawMarks, fontSizeFor } from './overlay-draw.ts';
import type { OverlayCanvasHost, OverlaySurface } from './overlay-host.ts';
import { overlayIds, overlayMarks } from './overlay-marks.ts';

export type OverlayKind = 'aligned' | 'plan-only' | 'scheme';

export type OverlayMeta = {
  modelId: string;
  revision: number;
  kind: OverlayKind;
  width: number;
  height: number;
  pxPerMeter?: number;
  ids: { rooms: string[]; walls: string[]; openings: string[] };
  diagnostics: string[];
};

export type OverlayResult = {
  png: Uint8Array;
  /** Labeled meter schematic when the plan cannot be registered. Not an aligned overlay. */
  schemePng?: Uint8Array;
  meta: OverlayMeta;
};

export type RenderOverlayOptions = {
  host?: OverlayCanvasHost;
};

async function defaultHost(): Promise<OverlayCanvasHost> {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const { createBrowserCanvasHost } = await import('./overlay-browser.ts');
    return createBrowserCanvasHost();
  }
  const { createNodeCanvasHost } = await import('./overlay-node.ts');
  return createNodeCanvasHost();
}

function validModel(model: FlatModel): FlatModel {
  const parsed = validateFlatModel(model);
  if (!parsed.success) {
    throw new BuilderError(
      'contract',
      'FlatModel failed Contract validation; Builder does not overlay it',
      parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return parsed.data;
}

function scaleOf(model: FlatModel): number | undefined {
  const value = model.plan.pxPerMeter;
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function schemeBounds(model: FlatModel) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of Object.values(model.vertices)) {
    xs.push(point[0]);
    ys.push(point[1]);
  }
  for (const room of Object.values(model.rooms)) {
    xs.push(room.anchor[0]);
    ys.push(room.anchor[1]);
  }
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 4, maxY: 3 };
  return {
    minX: Math.min(...xs) - 0.6,
    minY: Math.min(...ys) - 0.6,
    maxX: Math.max(...xs) + 0.6,
    maxY: Math.max(...ys) + 0.6,
  };
}

async function paintScheme(model: FlatModel, host: OverlayCanvasHost, extraBanner: string): Promise<OverlaySurface> {
  const box = schemeBounds(model);
  const spanX = Math.max(box.maxX - box.minX, 1);
  const spanY = Math.max(box.maxY - box.minY, 1);
  const width = 800;
  const height = Math.max(240, Math.round((spanY / spanX) * width));
  const pxPerMeter = (width - 48) / spanX;
  const marks = overlayMarks(model, pxPerMeter).map(mark => {
    if (mark.kind === 'room') {
      return { ...mark, x: (mark.x / pxPerMeter - box.minX) * pxPerMeter + 24, y: (mark.y / pxPerMeter - box.minY) * pxPerMeter + 24 };
    }
    return {
      ...mark,
      x1: (mark.x1 / pxPerMeter - box.minX) * pxPerMeter + 24,
      y1: (mark.y1 / pxPerMeter - box.minY) * pxPerMeter + 24,
      x2: (mark.x2 / pxPerMeter - box.minX) * pxPerMeter + 24,
      y2: (mark.y2 / pxPerMeter - box.minY) * pxPerMeter + 24,
    };
  });
  const surface = host.create(width, height);
  const ctx = surface.getContext();
  ctx.fillStyle = '#fffbeb';
  ctx.fillRect(0, 0, width, height);
  drawMarks(ctx, marks, fontSizeFor(width, height));
  drawBanner(ctx, width, height, extraBanner, 'top');
  return surface;
}

/**
 * Overlay of the accepted FlatModel. Call after Resolver applies the parser/repair patch.
 * Does not invent pxPerMeter. Geometry Core is not a second source — marks follow vertices/walls/openings/rooms.
 */
export async function renderOverlay(
  model: FlatModel,
  planPng?: Uint8Array,
  options: RenderOverlayOptions = {},
): Promise<OverlayResult> {
  const valid = validModel(model);
  const host = options.host ?? (await defaultHost());
  const ids = overlayIds(valid);
  const diagnostics: string[] = [];
  const pxPerMeter = scaleOf(valid);
  const hasGeometry = Object.keys(valid.walls).length > 0 || Object.keys(valid.rooms).length > 0;

  if (planPng && planPng.byteLength > 0) {
    const image = await host.loadImage(planPng);
    if (pxPerMeter) {
      const surface = host.create(image.width, image.height);
      const ctx = surface.getContext();
      ctx.drawImage(image.source, 0, 0, image.width, image.height);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, image.width, image.height);
      ctx.restore();
      drawMarks(ctx, overlayMarks(valid, pxPerMeter), fontSizeFor(image.width, image.height));
      const png = await surface.encodePng();
      return {
        png,
        meta: {
          modelId: valid.id,
          revision: valid.revision,
          kind: 'aligned',
          width: image.width,
          height: image.height,
          pxPerMeter,
          ids,
          diagnostics,
        },
      };
    }

    diagnostics.push('missing-pxPerMeter');
    const surface = host.create(image.width, image.height);
    const ctx = surface.getContext();
    ctx.drawImage(image.source, 0, 0, image.width, image.height);
    drawBanner(
      ctx,
      image.width,
      image.height,
      'NOT ALIGNED — plan.pxPerMeter missing; schematic meters are a separate PNG',
      'bottom',
    );
    const png = await surface.encodePng();
    let schemePng: Uint8Array | undefined;
    if (hasGeometry) {
      diagnostics.push('scheme-not-registered-to-plan');
      schemePng = await (await paintScheme(valid, host, 'SCHEMATIC — not registered to original plan pixels')).encodePng();
    }
    return {
      png,
      schemePng,
      meta: {
        modelId: valid.id,
        revision: valid.revision,
        kind: 'plan-only',
        width: image.width,
        height: image.height,
        ids,
        diagnostics,
      },
    };
  }

  diagnostics.push('missing-plan-png');
  if (!pxPerMeter) diagnostics.push('missing-pxPerMeter');
  diagnostics.push('scheme-not-registered-to-plan');
  const surface = await paintScheme(
    valid,
    host,
    'SCHEMATIC — not registered to original plan pixels',
  );
  const png = await surface.encodePng();
  return {
    png,
    meta: {
      modelId: valid.id,
      revision: valid.revision,
      kind: 'scheme',
      width: surface.width,
      height: surface.height,
      ids,
      diagnostics,
    },
  };
}
