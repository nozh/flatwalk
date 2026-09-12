import {
  FlatModelSchema,
  PatchSchema,
  RevisionContextSchema,
  metaPathForOwner,
  ownersForPath,
  type FlatModel,
  type Op,
  type Patch,
  type RevisionContext,
} from "@flatwalk/contract";

export type RejectedOp = {
  path: string;
  value?: unknown;
  reason: "conflict" | "human" | "contract";
};

export type ApplyResult = {
  model: FlatModel;
  applied: Op[];
  rejected: RejectedOp[];
  touchedPaths: string[];
  touchedOwners: string[];
};

const EDITOR_PREFIX = "editor@";

export function apply(model: FlatModel, patch: Patch, touchedSince: RevisionContext): ApplyResult {
  const unchanged = (rejected: RejectedOp[]): ApplyResult => ({
    model,
    applied: [],
    rejected,
    touchedPaths: [],
    touchedOwners: [],
  });

  const parsedPatch = PatchSchema.safeParse(patch);
  const parsedContext = RevisionContextSchema.safeParse(touchedSince);
  const parsedModel = FlatModelSchema.safeParse(model);
  if (!parsedPatch.success || !parsedContext.success || !parsedModel.success) {
    const ops = parsedPatch.success ? parsedPatch.data.ops : Array.isArray(patch?.ops) ? patch.ops : [];
    return unchanged(contractReject(ops, "patch"));
  }

  const validPatch = parsedPatch.data;
  const context = parsedContext.data;
  const current = parsedModel.data;
  if (
    validPatch.modelId !== current.id ||
    context.modelId !== current.id ||
    context.currentRevision !== current.revision ||
    validPatch.baseRevision !== context.baseRevision
  ) {
    return unchanged(contractReject(validPatch.ops, validPatch.ops[0]?.path ?? "patch"));
  }

  if (validPatch.ops.length === 0) return unchanged([]);

  const tentative = clone(current);
  for (const op of validPatch.ops) {
    if (!applyOp(tentative, op)) return unchanged(contractReject(validPatch.ops, op.path));
  }

  const editor = isEditor(validPatch.module);
  const historyOwners = new Set(context.changes.flatMap((change) => change.touchedOwners));
  const classifications = validPatch.ops.map((op) => {
    const owners = unique([
      ...ownersForPath(current, op.path),
      ...ownersForPath(tentative as FlatModel, op.path),
    ]);
    const conflict = owners.some((owner) => historyOwners.has(owner));
    const human = !editor && owners.some((owner) => isHumanOwner(current, owner));
    const reason: RejectedOp["reason"] | null = conflict ? "conflict" : human ? "human" : null;
    const blockedOwners = owners.filter((owner) =>
      conflict ? historyOwners.has(owner) : human && isHumanOwner(current, owner),
    );
    return { op, owners, reason, blockedOwners };
  });

  const appliedOps = classifications.filter((item) => item.reason === null).map((item) => item.op);
  const rejectedItems = classifications.filter((item) => item.reason !== null);

  const next = clone(current);
  for (const op of appliedOps) applyOp(next, op);

  if (!editor) {
    for (const item of classifications) {
      if (item.reason !== null) continue;
      if (sameValue(getPath(current, item.op.path), getPath(next, item.op.path))) continue;
      for (const owner of item.owners) clearReviewed(next, owner);
    }
  }

  const atRevision = current.revision + 1;
  const rejected: RejectedOp[] = [];
  for (const item of rejectedItems) {
    rejected.push(toRejected(item.op, item.reason!));
    for (const owner of unique(item.blockedOwners)) {
      appendAlternative(next, owner, {
        module: validPatch.module,
        baseRevision: validPatch.baseRevision,
        atRevision,
        reason: item.reason === "conflict" ? "conflict" : "human",
        op: clone(item.op),
      });
    }
  }

  const candidate = next as FlatModel;
  const changed = JSON.stringify(omitRevision(current)) !== JSON.stringify(omitRevision(candidate));
  if (!changed) {
    return {
      model,
      applied: appliedOps,
      rejected,
      touchedPaths: [],
      touchedOwners: [],
    };
  }

  candidate.revision = atRevision;
  const checked = FlatModelSchema.safeParse(candidate);
  if (!checked.success) return unchanged(contractReject(validPatch.ops, rejected[0]?.path ?? appliedOps[0]?.path ?? "patch"));

  const touchedPaths = unique(diffPaths(current, checked.data).filter((path) => path !== "revision"));
  const touchedOwners = unique(touchedPaths.flatMap((path) => [
    ...ownersForPath(current, path),
    ...ownersForPath(checked.data, path),
  ]));

  return {
    model: checked.data,
    applied: appliedOps,
    rejected,
    touchedPaths,
    touchedOwners,
  };
}

function isEditor(module: string) {
  return module === "editor@0.1" || module.startsWith(EDITOR_PREFIX);
}

function contractReject(ops: Op[], fallbackPath: string): RejectedOp[] {
  if (ops.length === 0) return [{ path: fallbackPath, reason: "contract" }];
  return ops.map((op) => toRejected(op, "contract"));
}

function toRejected(op: Op, reason: RejectedOp["reason"]): RejectedOp {
  return op.op === "set" ? { path: op.path, value: op.value, reason } : { path: op.path, reason };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function omitRevision(model: FlatModel) {
  const { revision: _revision, ...rest } = model;
  return rest;
}

function applyOp(root: unknown, op: Op): boolean {
  return op.op === "set" ? setPath(root, op.path, op.value) : unsetPath(root, op.path);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split(".")) {
    const record = asRecord(current);
    if (!record || !Object.hasOwn(record, part)) return undefined;
    current = record[part];
  }
  return current;
}

function parentAndKey(root: unknown, path: string): { parent: Record<string, unknown>; key: string } | null {
  const parts = path.split(".");
  const key = parts.pop();
  if (!key) return null;
  let current: unknown = root;
  for (const part of parts) {
    const record = asRecord(current);
    if (!record || !Object.hasOwn(record, part)) return null;
    current = record[part];
  }
  const parent = asRecord(current);
  return parent ? { parent, key } : null;
}

function setPath(root: unknown, path: string, value: unknown): boolean {
  const target = parentAndKey(root, path);
  if (!target) return false;
  target.parent[target.key] = clone(value);
  return true;
}

function unsetPath(root: unknown, path: string): boolean {
  const target = parentAndKey(root, path);
  if (!target) return true;
  delete target.parent[target.key];
  return true;
}

function isHumanOwner(model: FlatModel, owner: string): boolean {
  const metaPath = metaPathForOwner(owner);
  if (!metaPath) return false;
  const meta = asRecord(getPath(model, metaPath));
  return meta?.provenance === "human";
}

function clearReviewed(root: unknown, owner: string) {
  const metaPath = metaPathForOwner(owner);
  if (!metaPath) return;
  const meta = asRecord(getPath(root, metaPath));
  if (!meta || meta.reviewed !== true) return;
  meta.reviewed = false;
}

function appendAlternative(
  root: unknown,
  owner: string,
  alternative: NonNullable<NonNullable<FlatModel["rooms"][string]["meta"]["alternatives"]>[number]>,
): boolean {
  const metaPath = metaPathForOwner(owner);
  if (!metaPath) return false;
  const meta = asRecord(getPath(root, metaPath));
  if (!meta) return false;
  const existing = Array.isArray(meta.alternatives) ? meta.alternatives : [];
  meta.alternatives = [...existing, alternative];
  meta.reviewed = false;
  return true;
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function unique(items: string[]) {
  return [...new Set(items)].sort();
}

function diffPaths(before: unknown, after: unknown, prefix = ""): string[] {
  if (sameValue(before, after)) return [];
  const beforeObj = asRecord(before);
  const afterObj = asRecord(after);
  if (!beforeObj || !afterObj) return prefix ? [prefix] : [];
  const keys = unique([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const paths: string[] = [];
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const hasBefore = Object.hasOwn(beforeObj, key);
    const hasAfter = Object.hasOwn(afterObj, key);
    if (!hasBefore || !hasAfter) paths.push(path);
    else paths.push(...diffPaths(beforeObj[key], afterObj[key], path));
  }
  return paths;
}
