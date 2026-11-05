import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMasters, type Masters } from '../src/data/masters';

const here = dirname(fileURLToPath(import.meta.url));
export const MASTER_DIR = join(here, '..', 'src', 'data', 'master');

export function loadMastersFromDisk(dir = MASTER_DIR): Masters {
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  return parseMasters({
    departments: read('departments.csv'),
    products: read('products.csv'),
    vendors: read('vendors.csv'),
    firstNames: read('first_names.csv'),
    lastNames: read('last_names.csv'),
  });
}
