export type OverlayImage = {
  width: number;
  height: number;
  source: CanvasImageSource;
};

export type OverlaySurface = {
  width: number;
  height: number;
  getContext(): CanvasRenderingContext2D;
  encodePng(): Promise<Uint8Array>;
};

export type OverlayCanvasHost = {
  create(width: number, height: number): OverlaySurface;
  loadImage(bytes: Uint8Array): Promise<OverlayImage>;
};
