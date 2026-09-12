import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtureValidationReport } from './fixture-validation-report';

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.generated/fixture-report.json');
mkdirSync(dirname(outPath), { recursive: true });
const artifact = buildFixtureValidationReport();
writeFileSync(outPath, JSON.stringify({
  fileName: artifact.fileName,
  url: artifact.url,
  json: artifact.json,
  modelId: artifact.report.modelId,
  revision: artifact.report.revision,
}));
