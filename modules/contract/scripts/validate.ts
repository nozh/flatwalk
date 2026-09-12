import { readFile } from 'node:fs/promises';
import { FlatModelSchema } from '../src/index.js';
if (!process.argv[2]) throw new Error('Usage: npm run validate -- /path/to/flat.model.json');
const result = FlatModelSchema.safeParse(JSON.parse(await readFile(process.argv[2], 'utf8')));
if (!result.success) { console.error(JSON.stringify(result.error.issues, null, 2)); process.exitCode = 1; }
else console.log(`Contract valid: ${result.data.id} rev ${result.data.revision}; geometry/walkability not checked`);
