/** Portable rules complement JSON Schema; emitted verbatim for Python consumers. */
export type Rule = {
  path: string; kind: 'reference' | 'requires' | 'forbids'; target: string;
  assetKinds?: string[]; when?: { path: string; equals?: string | number | boolean; present?: boolean };
};
export const MODEL_RULES: Rule[] = [
  { path: 'plan.asset', kind: 'reference', target: '$.assets', assetKinds: ['plan', 'image'] },
  { path: 'walls.*.a', kind: 'reference', target: '$.vertices' },
  { path: 'walls.*.b', kind: 'reference', target: '$.vertices' },
  { path: 'openings.*.wall', kind: 'reference', target: '$.walls' },
  { path: 'assets.*.room', kind: 'reference', target: '$.rooms' },
  { path: 'assets.*.faces', kind: 'reference', target: '$.walls' },
  { path: 'assets.*.faces', kind: 'requires', target: 'room' },
  { path: 'assets.*.fromPhoto', kind: 'reference', target: '$.assets', assetKinds: ['photo'] },
  { path: 'rooms.*.dressing.panorama', kind: 'reference', target: '$.assets', assetKinds: ['panorama'] },
  { path: 'rooms.*.dressing.level', kind: 'requires', target: 'floor', when: { path: 'level', equals: 1 } },
  { path: 'rooms.*.dressing.level', kind: 'requires', target: 'floor', when: { path: 'level', equals: 2 } },
  { path: 'rooms.*.dressing.level', kind: 'requires', target: 'panorama', when: { path: 'level', equals: 2 } },
  { path: 'rooms.*.dressing.level', kind: 'forbids', target: 'panorama', when: { path: 'level', equals: 0 } },
  { path: 'rooms.*.dressing.level', kind: 'forbids', target: 'panorama', when: { path: 'level', equals: 1 } },
  { path: 'rooms.*.dressing.yaw', kind: 'requires', target: 'yawFor' },
  { path: 'rooms.*.dressing.yawFor', kind: 'requires', target: 'yaw' },
];
// A metadata slot exists iff its value key exists, including panorama:null.
export const META_PAIRS = ['floor', 'wallTone', 'panorama', 'yaw'];
export type ContractIssue = { code: string; path: (string | number)[]; message: string };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const present = (value: unknown) => value !== undefined && value !== null;
export function readPath(root: unknown, path: string): unknown {
  let value = root;
  for (const key of path.split('.')) {
    if (!object(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
function expand(root: unknown, parts: string[], prefix: string[] = []): { path: string[]; value: unknown; parent: unknown }[] {
  const [part, ...tail] = parts;
  if (!part || !object(root)) return [];
  const keys = part === '*' ? Object.keys(root) : [part];
  return keys.flatMap(key => tail.length ? expand(root[key], tail, [...prefix, key]) : [{ path: [...prefix, key], value: root[key], parent: root }]);
}
export function checkModelRules(model: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  for (const rule of MODEL_RULES) for (const entry of expand(model, rule.path.split('.'))) {
    if (!present(entry.value)) continue;
    if (rule.when) {
      const test = readPath(entry.parent, rule.when.path);
      if ('equals' in rule.when && test !== rule.when.equals) continue;
      if ('present' in rule.when && present(test) !== rule.when.present) continue;
    }
    const target = rule.target.startsWith('$.') ? readPath(model, rule.target.slice(2)) : readPath(entry.parent, rule.target);
    let valid: boolean;
    if (rule.kind === 'reference') {
      const referred = object(target) && typeof entry.value === 'string' && Object.hasOwn(target, entry.value) ? target[entry.value] : undefined;
      valid = referred !== undefined && (!rule.assetKinds || (object(referred) && rule.assetKinds.includes(String(referred.kind))));
    } else valid = rule.kind === 'requires' ? present(target) : !present(target);
    if (!valid) issues.push({ code: rule.kind, path: entry.path, message: `${rule.kind}: ${rule.target}${rule.assetKinds ? ` (${rule.assetKinds.join('|')})` : ''}` });
  }
  for (const { value, path } of expand(model, ['rooms', '*', 'dressing'])) {
    if (!object(value) || !object(value.meta)) continue;
    for (const field of META_PAIRS) if (Object.hasOwn(value, field) !== Object.hasOwn(value.meta, field))
      issues.push({ code: 'meta-pair', path: [...path, 'meta', field], message: `Value and meta.${field} must occur together` });
  }
  return issues;
}
