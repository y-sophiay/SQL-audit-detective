import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncReadme } from '../src/data/docs';

describe('README', () => {
  it('generated blocks (ERD, case table, data dictionary) match schema.ts and the case list', () => {
    const text = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8');
    expect(syncReadme(text) === text, 'run `npm run docs`').toBe(true);
  });
});
