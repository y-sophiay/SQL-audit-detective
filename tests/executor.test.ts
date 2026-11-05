import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { CASES, isFix } from '../src/cases';
import { generateDataset } from '../src/data/generator';
import { loadDataset } from '../src/data/load';
import { Executor } from '../src/engine/executor';
import type { RunOutcome } from '../src/engine/protocol';
import { loadMastersFromDisk } from '../scripts/_masters-node';

let db: PGlite;
let ex: Executor;

const ok = (o: RunOutcome) => {
  if (!o.ok) throw new Error(`expected success, got ${o.kind}: ${o.message}`);
  return o;
};

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec("SET TIME ZONE 'UTC'");
  await loadDataset(db, generateDataset('EXEC01', loadMastersFromDisk()));
  ex = new Executor(db);
}, 120_000);

describe('executor — case mode', () => {
  it('returns rows with exact text for numerics and dates', async () => {
    const o = ok(await ex.run('SELECT po_number, total_amount, po_date FROM purchase_orders ORDER BY po_id LIMIT 2', 'case'));
    expect(o.results[0].rows).toHaveLength(2);
    expect(typeof o.results[0].rows[0][1]).toBe('string');
    expect(String(o.results[0].rows[0][2])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('blocks data-changing statements up front', async () => {
    const o = await ex.run('DELETE FROM employees', 'case');
    expect(o).toMatchObject({ ok: false, kind: 'blocked' });
  });

  it('PostgreSQL itself refuses writes hidden inside a WITH (read-only transaction) and nothing changes', async () => {
    const before = ok(await ex.run('SELECT COUNT(*) FROM employees', 'case')).results[0].rows[0][0];
    const o = await ex.run('WITH d AS (DELETE FROM employees RETURNING *) SELECT * FROM d', 'case');
    expect(o).toMatchObject({ ok: false, kind: 'sql' });
    const after = ok(await ex.run('SELECT COUNT(*) FROM employees', 'case')).results[0].rows[0][0];
    expect(after).toEqual(before);
  });

  it('reports the error position as an offset into the editor text', async () => {
    const text = 'SELECT 1;\nSELECT * FROM nope_table';
    const o = await ex.run(text, 'case');
    expect(o.ok).toBe(false);
    if (!o.ok) {
      expect(o.kind).toBe('sql');
      expect(text.slice(o.position!, o.position! + 10)).toBe('nope_table');
    }
  });

  it('runs several statements and returns one result each', async () => {
    const o = ok(await ex.run('SELECT 1 AS a; SELECT 2 AS b, 3 AS c', 'case'));
    expect(o.results.map((r) => r.fields.map((f) => f.name))).toEqual([['a'], ['b', 'c']]);
  });

  it('stops a missing-ON cross join before it runs', async () => {
    const o = await ex.run('SELECT COUNT(*) FROM invoices, po_lines, goods_receipts', 'case');
    expect(o).toMatchObject({ ok: false, kind: 'cost' });
    const g = await ex.run('SELECT * FROM generate_series(1, 100000000)', 'case');
    expect(g).toMatchObject({ ok: false, kind: 'cost' });
  });

  it('truncates huge result sets for display but reports the true row count', async () => {
    const o = ok(await ex.run('SELECT * FROM inventory_movements', 'case'));
    expect(o.results[0].rows.length).toBe(1000);
    expect(o.results[0].truncated).toBe(true);
    expect(o.results[0].rowCount).toBeGreaterThan(1000);
  });

  it('never trips the cost guard on any reference solution (and shows the headroom)', async () => {
    for (const c of CASES.filter((x) => !isFix(x))) {
      const o = await ex.run(c.solution, 'case');
      expect(o.ok, `case ${c.id}`).toBe(true);
      const plan = await db.query<{ 'QUERY PLAN': { Plan: Record<string, number> }[] }>(`EXPLAIN (FORMAT JSON) ${c.solution.replace(/;\s*$/, '')}`);
      const p = plan.rows[0]['QUERY PLAN'][0].Plan;
      console.log(`case ${c.id}: plan rows ${p['Plan Rows']}, cost ${Math.round(p['Total Cost'])}`);
    }
  });

  it('does not freeze on EXPLAIN / SHOW', async () => {
    ok(await ex.run('EXPLAIN SELECT * FROM invoices', 'case'));
    ok(await ex.run('SHOW timezone', 'case'));
  });
});

describe('executor — fix mode (hands-on cases)', () => {
  const count = async (t: string) => Number(ok(await ex.run(`SELECT COUNT(*) FROM ${t}`, 'case')).results[0].rows[0][0]);

  it('lets the script change data, reads the state with the check query, then rolls everything back', async () => {
    const before = await count('payments');
    const o = ok(await ex.run('DELETE FROM payments', 'fix', "SELECT 'payments:' || COUNT(*) AS state FROM payments"));
    expect(o.verify).toEqual({ ok: true, fields: [{ name: 'state', dataTypeID: 25 }], rows: [['payments:0']] });
    expect(await count('payments')).toBe(before);
  });

  it('rolls back DDL too', async () => {
    ok(await ex.run('CREATE TABLE tmp_fix (a int); CREATE INDEX tmp_idx ON payments (payment_date)', 'fix', 'SELECT 1 AS state'));
    expect((await ex.run('SELECT * FROM tmp_fix', 'case')).ok).toBe(false);
    const idx = ok(await ex.run("SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'tmp_idx'", 'case')).results[0].rows[0][0];
    expect(Number(idx)).toBe(0);
  });

  it('refuses transaction control, and reports a failing check query instead of throwing', async () => {
    expect(await ex.run('COMMIT', 'fix', 'SELECT 1 AS state')).toMatchObject({ ok: false, kind: 'blocked' });
    const o = ok(await ex.run('SELECT 1', 'fix', 'SELECT * FROM table_the_player_never_made'));
    expect(o.verify).toMatchObject({ ok: false });
  });

  it('a failing script leaves nothing behind', async () => {
    const before = await count('payments');
    const o = await ex.run('DELETE FROM payments; SELECT * FROM missing_table', 'fix', 'SELECT 1 AS state');
    expect(o.ok).toBe(false);
    expect(await count('payments')).toBe(before);
  });

  it('does not disturb an open sandbox session', async () => {
    await ex.sandbox('begin');
    ok(await ex.run('CREATE TABLE keep_me (a int)', 'sandbox'));
    ok(await ex.run('SELECT 1', 'fix', 'SELECT 1 AS state'));
    await ex.sandbox('end');
  });
});

describe('executor — sandbox', () => {
  it('keeps changes across runs, survives errors, and rolls back on reset', async () => {
    expect(await ex.sandbox('begin')).toBe(true);
    ok(await ex.run('CREATE TABLE scratch (a int primary key, b text); INSERT INTO scratch VALUES (1, $$x$$)', 'sandbox'));
    expect(ok(await ex.run('SELECT * FROM scratch', 'sandbox')).results[0].rows).toEqual([[1, 'x']]);

    const bad = await ex.run('SELECT * FROM missing_table', 'sandbox');
    expect(bad.ok).toBe(false);
    expect(ok(await ex.run('SELECT COUNT(*) FROM scratch', 'sandbox')).results[0].rows[0][0]).toBe('1');

    // atomic: a failing statement undoes the earlier statements of the same run
    const atomic = await ex.run("INSERT INTO scratch VALUES (2, 'y'); SELECT * FROM missing_table", 'sandbox');
    expect(atomic.ok).toBe(false);
    expect(ok(await ex.run('SELECT COUNT(*) FROM scratch', 'sandbox')).results[0].rows[0][0]).toBe('1');

    // foreign keys are real: deleting a referenced employee is refused …
    expect((await ex.run('DELETE FROM employees WHERE emp_id = 1', 'sandbox')).ok).toBe(false);
    // … but a leaf table can be emptied
    ok(await ex.run('DELETE FROM po_audit_log', 'sandbox'));
    expect(ok(await ex.run('SELECT COUNT(*) FROM po_audit_log', 'sandbox')).results[0].rows[0][0]).toBe('0');

    expect(await ex.sandbox('reset')).toBe(true);
    expect((await ex.run('SELECT * FROM scratch', 'sandbox')).ok).toBe(false);
    expect(Number(ok(await ex.run('SELECT COUNT(*) FROM po_audit_log', 'sandbox')).results[0].rows[0][0])).toBeGreaterThan(100);
  });

  it('rejects transaction control inside the sandbox', async () => {
    expect(await ex.run('COMMIT', 'sandbox')).toMatchObject({ ok: false, kind: 'blocked' });
  });

  it('leaving the sandbox restores pristine case data', async () => {
    ok(await ex.run('DELETE FROM payments', 'sandbox'));
    expect(await ex.sandbox('end')).toBe(true);
    expect(Number(ok(await ex.run('SELECT COUNT(*) FROM payments', 'case')).results[0].rows[0][0])).toBeGreaterThan(1000);
  });

  it('reports DDL as a command result and flags schema changes', async () => {
    const o = ok(await ex.run('CREATE VIEW big_pos AS SELECT * FROM purchase_orders WHERE total_amount > 9000', 'sandbox'));
    expect(o.schemaChanged).toBe(true);
    expect(o.results[0].kind).toBe('command');
    const tables = await ex.schema();
    expect(tables.map((t) => t.name)).toContain('big_pos');
    await ex.sandbox('end');
  });
});

describe('executor — schema introspection', () => {
  it('returns all tables with comments, keys and generated columns', async () => {
    const tables = await ex.schema();
    expect(tables.map((t) => t.name).sort()).toEqual(
      [
        'departments',
        'employees',
        'goods_receipts',
        'inventory_movements',
        'invoices',
        'payments',
        'po_audit_log',
        'po_lines',
        'products',
        'purchase_orders',
        'vendor_watchlist',
        'vendors',
      ].sort(),
    );
    const po = tables.find((t) => t.name === 'purchase_orders')!;
    expect(po.comment).toContain('Purchase order');
    expect(po.columns.find((c) => c.name === 'po_id')!.pk).toBe(true);
    expect(po.columns.find((c) => c.name === 'vendor_id')!.fk).toBe('vendors(vendor_id)');
    expect(po.columns.find((c) => c.name === 'po_date')!.generated).toBe(true);
    expect(tables.find((t) => t.name === 'employees')!.columns.find((c) => c.name === 'manager_id')!.fk).toBe('employees(emp_id)');
  });
});
