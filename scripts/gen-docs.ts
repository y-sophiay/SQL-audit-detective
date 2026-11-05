import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { syncReadme } from '../src/data/docs';

const file = join(import.meta.dirname, '..', 'README.md');
const before = readFileSync(file, 'utf8');
const after = syncReadme(before);
if (process.argv.includes('--check')) {
  if (before !== after) {
    console.error('The generated README blocks are out of date. Run npm run docs');
    process.exit(1);
  }
  console.log('README is up to date');
} else {
  writeFileSync(file, after);
  console.log(before === after ? 'README already up to date' : 'README updated');
}
