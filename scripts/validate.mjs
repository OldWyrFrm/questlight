import { fileURLToPath } from 'node:url';
import { loadData, validate } from './data.mjs';

const dir = process.argv[2] ?? fileURLToPath(new URL('../data', import.meta.url));
const data = loadData(dir);
const errors = validate(data);
for (const e of errors) console.error(`✗ ${e}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
const quests = data.questFiles.reduce((n, f) => n + f.quests.length, 0);
console.log(`✓ Data is valid: ${data.regions.length} regions, ${data.characters.length} characters, ${quests} quests.`);
