import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { cases } from '../test/cases.js';
import { FlatModelStructureSchema, PatchSchema, ValidationReportStructureSchema, RevisionContextStructureSchema, SCHEMA_VERSION, MODEL_RULES, META_PAIRS } from '../src/index.js';
const dir = new URL('../schemas/', import.meta.url);
await mkdir(dir, { recursive: true });
const artifacts: Record<string, unknown> = {};
for (const [name, schema] of Object.entries({ FlatModel: FlatModelStructureSchema, Patch: PatchSchema, ValidationReport: ValidationReportStructureSchema, RevisionContext: RevisionContextStructureSchema })) {
  artifacts[`${name}.schema.json`] = { ...z.toJSONSchema(schema, { target: 'draft-2020-12' }), $id: `https://flatwalk.local/contract/${SCHEMA_VERSION}/${name}.schema.json`, title: name, description: 'Generated from Zod. Full validation also requires semantic-rules.json and the contract runtime.' };
}
artifacts['semantic-rules.json'] = { schemaVersion: SCHEMA_VERSION, modelRules: MODEL_RULES, dressingMetaPairs: META_PAIRS, reportRules: ['unique-checkIds', 'unique-reviewIds', 'fix-target'], revisionRules: ['complete-ordered-history'] };
for (const [name, value] of Object.entries(artifacts)) {
  const output = JSON.stringify(value, null, 2) + '\n';
  const path = new URL(name, dir);
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== output) throw new Error(`Stale generated artifact: ${name}`);
  } else await writeFile(path, output);
}
console.log(`${Object.keys(artifacts).length} generated artifacts ${process.argv.includes('--check') ? 'current' : 'written'}`);

const corpus = JSON.stringify(cases, null, 2) + '\n';
const corpusPath = new URL('../test/corpus.json', import.meta.url);
if (process.argv.includes('--check')) { if (await readFile(corpusPath, 'utf8') !== corpus) throw new Error('Stale shared corpus'); }
else await writeFile(corpusPath, corpus);
