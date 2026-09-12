import { z } from 'zod';
import { FlatModelStructureSchema, ValidationReportStructureSchema, RevisionContextStructureSchema, DEFAULT_FIELDS, DRESSING_FIELDS, type FlatModel } from './schemas.js';
import { checkModelRules } from './rules.js';
export * from './schemas.js';
export * from './rules.js';

export const FlatModelSchema = FlatModelStructureSchema.superRefine((model, ctx) => {
  for (const issue of checkModelRules(model)) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});
export const ValidationReportSchema = ValidationReportStructureSchema.superRefine((report, ctx) => {
  for (const key of ['checks', 'review'] as const) {
    const items = key === 'checks' ? report.checks.map(x => x.checkId) : report.review.items.map(x => x.id);
    if (new Set(items).size !== items.length) ctx.addIssue({ code: 'custom', path: key === 'checks' ? ['checks'] : ['review', 'items'], message: 'IDs must be unique within the report' });
  }
  report.checks.forEach((check, i) => {
    if (check.fix && (check.fix.modelId !== report.modelId || check.fix.baseRevision !== report.revision))
      ctx.addIssue({ code: 'custom', path: ['checks', i, 'fix'], message: 'Fix must target this model and revision' });
  });
});
export const RevisionContextSchema = RevisionContextStructureSchema.superRefine((context, ctx) => {
  if (context.currentRevision < context.baseRevision || context.changes.length !== context.currentRevision - context.baseRevision ||
      context.changes.some((change, i) => change.revision !== context.baseRevision + i + 1))
    ctx.addIssue({ code: 'custom', path: ['changes'], message: 'Complete ordered history (baseRevision, currentRevision] required' });
});
export const validateFlatModel = (input: unknown) => FlatModelSchema.safeParse(input);
export const pathsOverlap = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
/** All current metadata owners; useful for confirmation and expanding parent replacements. */
export function listMetaOwners(model: FlatModel): string[] {
  const owners = ['flat', 'plan', ...DEFAULT_FIELDS.map(f => `flat.defaults.${f}`)];
  for (const collection of ['walls', 'openings', 'rooms', 'assets'] as const)
    for (const id of Object.keys(model[collection])) owners.push(`${collection}.${id}`);
  for (const [id, room] of Object.entries(model.rooms)) if (room.dressing)
    for (const field of DRESSING_FIELDS) if (Object.hasOwn(room.dressing, field)) owners.push(`rooms.${id}.dressing.${field}`);
  return owners;
}
/** Ownership only, no applying ops or conflict resolution. Call on before AND after snapshots. */
export function ownersForPath(model: FlatModel, path: string): string[] {
  const parts = path.split('.');
  // Whole containers/replacements touch descendants; editing a room's type does not.
  if (path === 'flat' || ['walls', 'openings', 'rooms', 'assets'].includes(path) ||
      (parts[0] === 'rooms' && parts.length === 2))
    return [...new Set([path, ...listMetaOwners(model).filter(owner => pathsOverlap(path, owner))])];
  if (parts[0] === 'vertices') {
    const owners = Object.entries(model.walls).filter(([, wall]) => !parts[1] || wall.a === parts[1] || wall.b === parts[1]).map(([id]) => `walls.${id}`);
    // Tombstone owner prevents unnoticed concurrent creation/deletion of orphan vertices.
    return [...new Set([parts.slice(0, 2).join('.'), ...owners])];
  }
  if (parts[0] === 'flat' && parts[1] === 'defaults') {
    const field = parts[2] === 'meta' ? parts[3] : parts[2];
    return field && DEFAULT_FIELDS.includes(field as typeof DEFAULT_FIELDS[number]) ? [`flat.defaults.${field}`] : DEFAULT_FIELDS.map(f => `flat.defaults.${f}`);
  }
  if (parts[0] === 'rooms' && parts[2] === 'dressing') {
    let field = parts[3] === 'meta' ? parts[4] : parts[3];
    if (field === 'yawFor') field = 'yaw';
    const root = `rooms.${parts[1]}.dressing`;
    return field && DRESSING_FIELDS.includes(field as typeof DRESSING_FIELDS[number]) ? [`${root}.${field}`] : DRESSING_FIELDS.map(f => `${root}.${f}`);
  }
  if (parts[0] === 'flat' || parts[0] === 'plan') return [parts[0]];
  return [parts.slice(0, 2).join('.')];
}
/** Metadata address of a canonical owner. Container ancestors do not own nested groups. */
export function metaPathForOwner(owner: string): string | null {
  if (owner.startsWith('vertices')) return null;
  const parts = owner.split('.');
  if (parts[0] === 'flat' && parts[1] === 'defaults') return `flat.defaults.meta.${parts[2]}`;
  if (parts[0] === 'rooms' && parts[2] === 'dressing') return `rooms.${parts[1]}.dressing.meta.${parts[3]}`;
  return `${owner}.meta`;
}
