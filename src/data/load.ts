import type { Cell, Dataset } from './generator';
import { createIndexesSql, createTablesSql, insertColumns, LOAD_ORDER, type TableName } from './schema';

/** Anything with an async exec(sql) — PGlite in the browser worker, in Node tests, in scripts. */
export interface SqlExecutor {
  exec(sql: string): Promise<unknown>;
}

const lit = (v: Cell): string => {
  if (v === null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('non-finite number in dataset');
    return String(v);
  }
  return `'${v.replace(/'/g, "''")}'`;
};

export function insertSql(table: TableName, rows: Cell[][], chunk = 500): string {
  const cols = insertColumns(table).join(', ');
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const values = rows
      .slice(i, i + chunk)
      .map((r) => `(${r.map(lit).join(', ')})`)
      .join(',\n');
    out.push(`INSERT INTO ${table} (${cols}) VALUES\n${values};`);
  }
  return out.join('\n');
}

export async function loadDataset(db: SqlExecutor, ds: Dataset, onProgress?: (label: string, done: number, total: number) => void): Promise<void> {
  const total = LOAD_ORDER.length + 2;
  let done = 0;
  const step = (label: string) => onProgress?.(label, ++done, total);

  await db.exec(createTablesSql());
  step('Creating tables');
  for (const t of LOAD_ORDER) {
    await db.exec(insertSql(t, ds.tables[t]));
    step(`Loading ${t}`);
  }
  await db.exec(createIndexesSql());
  step('Building indexes and statistics');
}

export function rowCounts(ds: Dataset): Record<string, number> {
  return Object.fromEntries(LOAD_ORDER.map((t) => [t, ds.tables[t].length]));
}
