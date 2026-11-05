import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { CASES, isFix } from '../src/cases';
import { generateDataset } from '../src/data/generator';
import { loadDataset } from '../src/data/load';
import { Executor } from '../src/engine/executor';
import { detectFeatures } from '../src/lib/features';
import { SNIPPET_GROUPS } from '../src/lib/snippets';
import { loadMastersFromDisk } from '../scripts/_masters-node';

let ex: Executor;

beforeAll(async () => {
  const db = await PGlite.create();
  await db.exec("SET TIME ZONE 'UTC'");
  await loadDataset(db, generateDataset('CONT01', loadMastersFromDisk()));
  ex = new Executor(db);
}, 120_000);

describe('every sandbox snippet runs against the real schema', () => {
  for (const g of SNIPPET_GROUPS) {
    for (const s of g.items) {
      it(`${g.name} / ${s.title}`, async () => {
        await ex.sandbox('begin');
        const o = await ex.run(s.sql, 'sandbox');
        await ex.sandbox('end');
        if (!o.ok) throw new Error(`${o.kind}: ${o.message}`);
        expect(o.results.length).toBeGreaterThan(0);
        const last = o.results[o.results.length - 1];
        if (last.kind === 'rows' && last.rowCount === 0) console.warn('EMPTY RESULT:', s.title);
      });
    }
  }
});

describe('case starters and concept examples run in read-only case mode', () => {
  for (const c of CASES) {
    it(`case ${c.id} starter`, async () => {
      const o = await ex.run(c.starter, isFix(c) ? 'fix' : 'case', isFix(c) ? c.verify : undefined);
      if (!o.ok) throw new Error(`${o.kind}: ${o.message}`);
    });
    it(`case ${c.id} concept example`, async () => {
      const o = await ex.run(c.concept.example, isFix(c) ? 'fix' : 'case', isFix(c) ? c.verify : undefined);
      if (!o.ok) throw new Error(`${o.kind}: ${o.message}`);
    });
  }
});

describe('feature detection', () => {
  it('ignores keywords inside comments and strings', () => {
    expect(detectFeatures("SELECT 'join group by' -- left join\nFROM x")).toEqual([]);
  });
  it('detects the usual suspects', () => {
    const ids = detectFeatures(
      'WITH a AS (SELECT 1) SELECT x::int, ROW_NUMBER() OVER (ORDER BY y) FROM t LEFT JOIN u USING (id) GROUP BY 1 HAVING COUNT(DISTINCT z) > 1',
    );
    for (const f of ['cte', 'cast', 'window', 'row-number', 'join', 'left-join', 'group-by', 'having', 'count-distinct']) expect(ids).toContain(f);
  });
  it('every case solution lights up at least one feature', () => {
    for (const c of CASES) expect(detectFeatures(c.solution).length, `case ${c.id}`).toBeGreaterThan(0);
  });
});
