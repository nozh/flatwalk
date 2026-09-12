import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFlatModel, ValidationReportSchema, type FlatModel, type ValidationReport } from '@flatwalk/contract';
import { validate } from '@flatwalk/validator';

function fixtureModelPath(): string {
  const candidates = [
    resolve(process.cwd(), 'fixtures/54541/flat.model.json'),
    resolve(process.cwd(), '../../fixtures/54541/flat.model.json'),
    resolve(process.cwd(), '../fixtures/54541/flat.model.json'),
  ];
  try {
    if (import.meta.url.startsWith('file:')) {
      candidates.unshift(resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/54541/flat.model.json'));
    }
  } catch { /* vitest may not expose a file: URL */ }
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('Cannot find fixtures/54541/flat.model.json for the Validator report helper.');
  return found;
}

export const FIXTURE_MODEL_PATH = fixtureModelPath();

export type FixtureValidationArtifact = {
  model: FlatModel;
  report: ValidationReport;
  fileName: string;
  url: string;
  json: string;
};

/** Real `validate(model)` for the prepared 54541 revision. Does not mutate the model file. */
export function buildFixtureValidationReport(): FixtureValidationArtifact {
  const raw: unknown = JSON.parse(readFileSync(FIXTURE_MODEL_PATH, 'utf8'));
  const parsed = validateFlatModel(raw);
  if (!parsed.success) {
    throw new Error(`Reference model 54541 failed Contract: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  const model = parsed.data;
  const report = validate(model);
  const checked = ValidationReportSchema.safeParse(report);
  if (!checked.success) {
    throw new Error(`validate() did not return a Contract ValidationReport: ${checked.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  if (checked.data.modelId !== model.id || checked.data.revision !== model.revision) {
    throw new Error(`Report ${checked.data.modelId} rev ${checked.data.revision} does not match model ${model.id} rev ${model.revision}`);
  }
  const padded = String(model.revision).padStart(3, '0');
  const fileName = `fixtures/54541/validation/rev-${padded}.json`;
  return {
    model,
    report: checked.data,
    fileName,
    url: `/${fileName}`,
    json: `${JSON.stringify(checked.data, null, 2)}\n`,
  };
}
