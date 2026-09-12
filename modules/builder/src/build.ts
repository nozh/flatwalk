import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import * as THREE from 'three';
import { BuilderError } from './errors.ts';
import { buildFloorsAndCeilings, defaultGeometry, type BuilderGeometry } from './floors.ts';
import { createMaterials } from './materials.ts';
import { buildWalls } from './walls.ts';

export type BuildOptions = {
  /** Defaults to Geometry Core. Pass a stub only in tests; that is not production integration. */
  geometry?: BuilderGeometry;
  /** Skip floors/ceilings (walls-only while Geometry Core is unavailable). */
  floors?: boolean;
};

export type BuiltScene = {
  group: THREE.Group;
  warnings: string[];
};

export function build(model: FlatModel, options: BuildOptions = {}): THREE.Group {
  return buildScene(model, options).group;
}

export function buildScene(model: FlatModel, options: BuildOptions = {}): BuiltScene {
  const parsed = validateFlatModel(model);
  if (!parsed.success) {
    throw new BuilderError(
      'contract',
      'FlatModel failed Contract validation; Builder does not assemble it',
      parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const valid = parsed.data;
  const warnings: string[] = [];
  const group = new THREE.Group();
  group.name = `flat:${valid.id}`;
  const materials = createMaterials();
  buildWalls(valid, materials, group);
  if (options.floors !== false) {
    buildFloorsAndCeilings(valid, materials, group, options.geometry ?? defaultGeometry, warnings);
  }
  group.userData.warnings = warnings;
  group.userData.revision = valid.revision;
  group.userData.modelId = valid.id;
  return { group, warnings };
}
