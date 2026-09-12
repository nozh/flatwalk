import { z } from 'zod';

export const SCHEMA_VERSION = '0.1' as const;
// Dot paths have no escaping. Reserve JavaScript prototype keys in every segment.
export const SEGMENT = '(?!(?:__proto__|prototype|constructor)(?:\\.|$))[A-Za-z0-9_][A-Za-z0-9_-]*';
export const IdSchema = z.string().regex(new RegExp(`^${SEGMENT}$(?![\\s\\S])`));
export const PathSchema = z.string().regex(new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})*$(?![\\s\\S])`));
export const RevisionSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);
const positive = z.number().positive();
const nonnegative = z.number().nonnegative();
const probability = z.number().min(0).max(1);
export const PointSchema = z.tuple([z.number(), z.number()]).check(z.minLength(2), z.maxLength(2));
export const JsonValueSchema = z.json();
export const MutablePathSchema = PathSchema.regex(/^(?:flat|plan|vertices|walls|openings|rooms|assets)(?:\.|$)/);
export const OpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('set'), path: MutablePathSchema, value: JsonValueSchema }),
  z.strictObject({ op: z.literal('unset'), path: MutablePathSchema }),
]);
export const PatchSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION), modelId: IdSchema,
  baseRevision: RevisionSchema, module: text, ops: z.array(OpSchema),
});
export const AlternativeSchema = z.strictObject({
  module: text, baseRevision: RevisionSchema, atRevision: RevisionSchema,
  reason: z.enum(['conflict', 'human']), op: OpSchema,
});
export const RepairSchema = z.strictObject({
  module: text, baseRevision: RevisionSchema, rule: text, ops: z.array(OpSchema).min(1),
  message: text,
});
export const MetaSchema = z.strictObject({
  provenance: text, basis: z.enum(['declared', 'inferred', 'assumed', 'declared-area']),
  confidence: probability.optional(), reviewed: z.boolean().optional(),
  question: text.optional(), alternatives: z.array(AlternativeSchema).optional(),
  repair: z.array(RepairSchema).optional(),
});
const PlanMetaSchema = MetaSchema.extend({ basis: z.enum(['declared-area', 'assumed', 'declared']) });
export const DEFAULT_FIELDS = ['wallHeight', 'doorHeight', 'windowSill', 'windowHeight'] as const;
export const DRESSING_FIELDS = ['level', 'floor', 'wallTone', 'panorama', 'yaw'] as const;
export const DefaultsSchema = z.strictObject({
  wallHeight: positive, doorHeight: positive, windowSill: nonnegative, windowHeight: positive,
  meta: z.strictObject({ wallHeight: MetaSchema, doorHeight: MetaSchema, windowSill: MetaSchema, windowHeight: MetaSchema }),
});
const FloorSchema = z.enum(['parquet', 'tile', 'laminate']);
const ToneSchema = z.enum(['light', 'dark', 'colored']);
export const DressingSchema = z.strictObject({
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  floor: FloorSchema.optional(), wallTone: ToneSchema.optional(),
  panorama: IdSchema.nullable().optional(), yaw: z.number().min(0).lt(360).optional(),
  // Identifies the panorama whose orientation the human/producer actually set.
  // Historical ID: allowed to outlive that asset; consumers ignore yaw on mismatch.
  yawFor: IdSchema.optional(),
  meta: z.strictObject({ level: MetaSchema, floor: MetaSchema.optional(), wallTone: MetaSchema.optional(), panorama: MetaSchema.optional(), yaw: MetaSchema.optional() }),
});
export const WallSchema = z.strictObject({ a: IdSchema, b: IdSchema, thickness: positive, exterior: z.boolean(), meta: MetaSchema });
const opening = { wall: IdSchema, at: nonnegative, width: positive, height: positive.optional(), meta: MetaSchema };
export const OpeningSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...opening, kind: z.literal('door'), entrance: z.boolean().optional(), passable: z.boolean().optional() }),
  z.strictObject({ ...opening, kind: z.literal('window'), sill: nonnegative.optional() }),
]);
export const RoomSchema = z.strictObject({
  anchor: PointSchema, type: z.enum(['living', 'bedroom', 'kitchen', 'bathroom', 'wc', 'hall', 'corridor', 'storage', 'unknown']),
  label: text, meta: MetaSchema, dressing: DressingSchema.optional(),
});
const asset = { url: text, width: z.int().positive(), height: z.int().positive(), meta: MetaSchema };
export const AssetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...asset, kind: z.literal('plan') }),
  z.strictObject({ ...asset, kind: z.literal('image') }),
  z.strictObject({ ...asset, kind: z.literal('photo'), room: IdSchema.nullable(), faces: IdSchema.nullable(), look: z.strictObject({ floor: z.enum(['parquet', 'tile', 'laminate', 'unknown']), wallTone: ToneSchema }).optional() }),
  z.strictObject({ ...asset, kind: z.literal('panorama'), projection: z.literal('equirectangular'), generatedBy: text, fromPhoto: IdSchema }),
]);
export const FlatModelStructureSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION), id: IdSchema, revision: RevisionSchema,
  source: z.strictObject({ site: text, url: text.optional(), fetchedAt: z.iso.datetime({ offset: true }), listingId: text.optional() }),
  flat: z.strictObject({ areaDeclared: positive.optional(), roomsDeclared: positive.optional(), meta: MetaSchema, defaults: DefaultsSchema }),
  plan: z.strictObject({ asset: IdSchema.nullable(), pxPerMeter: positive.optional(), meta: PlanMetaSchema }),
  vertices: z.record(IdSchema, PointSchema), walls: z.record(IdSchema, WallSchema),
  openings: z.record(IdSchema, OpeningSchema), rooms: z.record(IdSchema, RoomSchema), assets: z.record(IdSchema, AssetSchema),
});
export const CheckSchema = z.strictObject({
  checkId: text, layer: z.enum(['sources', 'contract', 'geometry', 'consistency', 'navigation', 'scale', 'assets', 'evidence']),
  status: z.enum(['pass', 'fail', 'unverified', 'skipped']), severity: z.enum(['info', 'warning', 'error']),
  entities: z.array(PathSchema), message: z.string(), fix: PatchSchema.optional(),
});
export const ValidationReportStructureSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION), modelId: IdSchema, revision: RevisionSchema,
  walkReady: z.boolean(), confirmation: probability, checks: z.array(CheckSchema),
  review: z.strictObject({ items: z.array(z.strictObject({ id: IdSchema, path: PathSchema, severity: z.enum(['info', 'warning', 'error']), reason: text, suggestion: text.optional() })) }),
});
// Retain owner paths at commit time, including owners of removed/relinked vertices.
export const RevisionChangeSchema = z.strictObject({
  revision: RevisionSchema, touchedPaths: z.array(PathSchema), touchedOwners: z.array(PathSchema),
});
export const RevisionContextStructureSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION), modelId: IdSchema,
  baseRevision: RevisionSchema, currentRevision: RevisionSchema, changes: z.array(RevisionChangeSchema),
});
export type FlatModel = z.infer<typeof FlatModelStructureSchema>;
export type Patch = z.infer<typeof PatchSchema>;
export type Op = z.infer<typeof OpSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type ValidationReport = z.infer<typeof ValidationReportStructureSchema>;
export type RevisionContext = z.infer<typeof RevisionContextStructureSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
