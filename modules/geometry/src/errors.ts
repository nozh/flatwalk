export type GeometryErrorCode =
  | 'nonplanar'
  | 'ambiguous-mapping'
  | 'invalid-start'
  | 'missing-room'
  | 'wall-not-on-room';

export class GeometryError extends Error {
  readonly code: GeometryErrorCode;
  readonly entities: string[];

  constructor(code: GeometryErrorCode, message: string, entities: string[] = []) {
    super(message);
    this.name = 'GeometryError';
    this.code = code;
    this.entities = entities;
  }
}
