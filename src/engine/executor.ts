import type { PGlite } from '@electric-sql/pglite';
import { LIMITS, type RunFailure, type RunMode, type RunOutcome, type StmtResult, type TableInfo, type VerifyOutcome } from './protocol';
import { isReadOnlyKeyword, isSchemaChange, isSelectish, isTransactionKeyword, splitStatements } from './sqlSplit';

// Keep dates / timestamps / numerics as the exact text PostgreSQL printed — no JS Date or float surprises.
const PARSERS = {
  20: (v: string) => v,
  1082: (v: string) => v,
  1114: (v: string) => v,
  1184: (v: string) => v,
  1700: (v: string) => v,
};

const errorOf = (e: unknown): { message: string; hint?: string; detail?: string; position?: string } => {
  const x = e as { message?: string; hint?: string; detail?: string; position?: string };
  return { message: String(x?.message ?? e), hint: x?.hint, detail: x?.detail, position: x?.position };
};

const SCHEMA_SQL = `
SELECT c.relname AS table_name,
       obj_description(c.oid, 'pg_class') AS table_comment,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null,
       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY (i.indkey)) AS is_pk,
       (SELECT con.confrelid::regclass::text || '(' || (SELECT f.attname FROM pg_attribute f WHERE f.attrelid = con.confrelid AND f.attnum = con.confkey[1]) || ')'
          FROM pg_constraint con
         WHERE con.conrelid = c.oid AND con.contype = 'f' AND array_length(con.conkey, 1) = 1 AND con.conkey[1] = a.attnum
         LIMIT 1) AS fk,
       a.attgenerated <> '' AS is_generated,
       col_description(c.oid, a.attnum) AS column_comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm') AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum`;

const fail = (f: Omit<RunFailure, 'ok'>): RunFailure => ({ ok: false, ...f });

/**
 * Runs player SQL against a PGlite instance with the game's safety rules:
 *  - "case" mode is READ ONLY and always rolled back;
 *  - "fix" mode (hands-on cases) may change anything, then a check query reads the resulting state, then everything is rolled back;
 *  - "sandbox" mode lives inside one long transaction (reset = rollback), every run is atomic;
 *  - SELECTs are planner-checked first so a missing JOIN condition cannot freeze the tab.
 */
export class Executor {
  private sandboxOn = false;
  constructor(private readonly db: PGlite) {}

  /** Ask the planner what a SELECT would cost, and refuse obvious runaway queries before they freeze the tab. */
  private async costGuard(sql: string): Promise<RunFailure | null> {
    const pg = this.db;
    await pg.exec('SAVEPOINT guard');
    try {
      const r = await pg.query<{ 'QUERY PLAN': Array<{ Plan: Record<string, number> }> }>(`EXPLAIN (FORMAT JSON)\n${sql}`);
      await pg.exec('RELEASE guard');
      const plan = r.rows[0]?.['QUERY PLAN']?.[0]?.Plan;
      if (!plan) return null;
      if (plan['Plan Rows'] > LIMITS.maxPlanRows || plan['Total Cost'] > LIMITS.maxPlanCost) {
        return fail({
          kind: 'cost',
          message: `This query looks too large (about ${Math.round(plan['Plan Rows']).toLocaleString()} rows, cost ${Math.round(plan['Total Cost']).toLocaleString()}) and was blocked before running.`,
          hint: 'Common causes: a JOIN without an ON condition (a Cartesian product), or joining several one-to-many tables directly. Check the ON conditions, or aggregate in a CTE first.',
        });
      }
      return null;
    } catch {
      await pg.exec('ROLLBACK TO guard; RELEASE guard').catch(() => undefined);
      return null; // let the real execution report the proper syntax / name error
    }
  }

  async run(sql: string, mode: RunMode, verify?: string): Promise<RunOutcome> {
    const pg = this.db;
    const stmts = splitStatements(sql);
    if (stmts.length === 0) return fail({ kind: 'blocked', message: 'There is no SQL to run. Write a query first.' });
    if (stmts.length > LIMITS.maxStatements) return fail({ kind: 'blocked', message: `At most ${LIMITS.maxStatements} statements can run at once.` });
    for (const s of stmts) {
      if (mode === 'case' && !isReadOnlyKeyword(s.keyword))
        return fail({
          kind: 'blocked',
          message: `Case mode is read-only: only SELECT / WITH / EXPLAIN / SHOW are allowed (you wrote ${s.keyword}).`,
          hint: 'To practise INSERT, UPDATE, DELETE, CREATE TABLE and similar, use the Sandbox. Changes there never affect the case data.',
          position: s.start,
        });
      if (mode === 'sandbox' && isTransactionKeyword(s.keyword))
        return fail({
          kind: 'blocked',
          message: `The sandbox already runs inside a transaction, so ${s.keyword} is not supported.`,
          hint: 'To undo all your changes, press “Reset database”.',
          position: s.start,
        });
      if (mode === 'fix' && isTransactionKeyword(s.keyword))
        return fail({
          kind: 'blocked',
          message: `Your script already runs inside a transaction, so ${s.keyword} is not needed.`,
          hint: 'Everything is rolled back after each run, so you can run the script as often as you like.',
          position: s.start,
        });
    }

    if (mode === 'case' || mode === 'fix') {
      if (this.sandboxOn) {
        await pg.exec('ROLLBACK').catch(() => undefined);
        this.sandboxOn = false;
      }
      await pg.exec(mode === 'case' ? 'BEGIN READ ONLY' : 'BEGIN');
    } else if (!this.sandboxOn) {
      await pg.exec('BEGIN');
      this.sandboxOn = true;
    }
    // every run is atomic: in the sandbox a failing statement rolls the whole run back to this savepoint
    await pg.exec('SAVEPOINT run_sp');

    const t0 = performance.now();
    const results: StmtResult[] = [];
    let schemaChanged = false;
    try {
      for (const s of stmts) {
        if (isSelectish(s.keyword)) {
          const blocked = await this.costGuard(s.sql);
          if (blocked) throw Object.assign(new Error(blocked.message), { __failure: { ...blocked, position: s.start } });
        }
        const t1 = performance.now();
        let r;
        try {
          r = await pg.query(s.sql, [], { rowMode: 'array', parsers: PARSERS });
        } catch (e) {
          const x = errorOf(e);
          const pos = x.position ? s.start + Number(x.position) - 1 : s.start;
          throw Object.assign(new Error(x.message), { __failure: fail({ kind: 'sql', message: x.message, hint: x.hint, detail: x.detail, position: pos }) });
        }
        const rows = r.rows as unknown[][];
        results.push({
          sql: s.sql,
          kind: r.fields.length > 0 ? 'rows' : 'command',
          fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
          rows: rows.length > LIMITS.maxRows ? rows.slice(0, LIMITS.maxRows) : rows,
          rowCount: rows.length,
          truncated: rows.length > LIMITS.maxRows,
          affectedRows: r.affectedRows,
          elapsedMs: performance.now() - t1,
        });
        if (isSchemaChange(s.keyword)) schemaChanged = true;
      }
      if (mode === 'sandbox') await pg.exec('RELEASE run_sp');
      let verifyOut: VerifyOutcome | undefined;
      if (mode === 'fix' && verify) {
        try {
          const r = await pg.query(verify, [], { rowMode: 'array', parsers: PARSERS });
          verifyOut = { ok: true, fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })), rows: r.rows as unknown[][] };
        } catch (e) {
          verifyOut = { ok: false, message: errorOf(e).message };
        }
      }
      return { ok: true, results, elapsedMs: performance.now() - t0, schemaChanged, ...(verifyOut ? { verify: verifyOut } : {}) };
    } catch (e) {
      if (mode === 'sandbox') await pg.exec('ROLLBACK TO run_sp; RELEASE run_sp').catch(() => undefined);
      const f = (e as { __failure?: RunFailure }).__failure;
      return f ?? fail({ kind: 'sql', message: errorOf(e).message });
    } finally {
      if (mode === 'case' || mode === 'fix') await pg.exec('ROLLBACK').catch(() => undefined);
    }
  }

  async schema(): Promise<TableInfo[]> {
    const r = await this.db.query<{
      table_name: string;
      table_comment: string | null;
      column_name: string;
      data_type: string;
      not_null: boolean;
      is_pk: boolean;
      fk: string | null;
      is_generated: boolean;
      column_comment: string | null;
    }>(SCHEMA_SQL);
    const tables: TableInfo[] = [];
    for (const row of r.rows) {
      let t = tables.find((x) => x.name === row.table_name);
      if (!t) tables.push((t = { name: row.table_name, comment: row.table_comment, columns: [] }));
      t.columns.push({
        name: row.column_name,
        type: row.data_type,
        notNull: row.not_null,
        pk: row.is_pk,
        fk: row.fk,
        generated: row.is_generated,
        comment: row.column_comment,
      });
    }
    return tables;
  }

  async sandbox(action: 'begin' | 'end' | 'reset'): Promise<boolean> {
    const pg = this.db;
    try {
      if (this.sandboxOn) await pg.exec('ROLLBACK');
      this.sandboxOn = false;
      if (action !== 'end') {
        await pg.exec('BEGIN');
        this.sandboxOn = true;
      }
      return true;
    } catch {
      return false;
    }
  }
}
