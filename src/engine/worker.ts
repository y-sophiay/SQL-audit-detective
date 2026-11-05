/// <reference lib="webworker" />
import { PGlite } from '@electric-sql/pglite';
import { generateDataset } from '../data/generator';
import { loadDataset, rowCounts } from '../data/load';
import { parseMasters } from '../data/masters';
import deptCsv from '../data/master/departments.csv?raw';
import productCsv from '../data/master/products.csv?raw';
import vendorCsv from '../data/master/vendors.csv?raw';
import firstCsv from '../data/master/first_names.csv?raw';
import lastCsv from '../data/master/last_names.csv?raw';
import { Executor } from './executor';
import type { RunOutcome, WorkerRequest, WorkerResponse } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WorkerResponse) => ctx.postMessage(m);

let db: PGlite | null = null;

let exec: Executor | null = null;

const errorMessage = (e: unknown) => String((e as { message?: string })?.message ?? e);

async function init(seed: string) {
  try {
    if (db) await db.close().catch(() => undefined);
    const masters = parseMasters({ departments: deptCsv, products: productCsv, vendors: vendorCsv, firstNames: firstCsv, lastNames: lastCsv });
    post({ type: 'progress', label: 'Starting PostgreSQL (WebAssembly)', done: 0, total: 14 });
    db = await PGlite.create();
    await db.exec("SET TIME ZONE 'UTC'");
    post({ type: 'progress', label: 'Generating this round’s data', done: 1, total: 14 });
    const ds = generateDataset(seed, masters);
    await loadDataset(db, ds, (label, done, total) => post({ type: 'progress', label, done: 1 + done, total: total + 2 }));
    exec = new Executor(db);
    post({ type: 'ready', seed, counts: rowCounts(ds), truth: ds.truth, story: ds.story });
  } catch (e) {
    post({ type: 'fatal', message: errorMessage(e) });
  }
}

const notReady: RunOutcome = { ok: false, kind: 'blocked', message: 'The database is not ready yet.' };

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  switch (m.type) {
    case 'init':
      void init(m.seed);
      break;
    case 'run':
      void (exec ? exec.run(m.sql, m.mode, m.verify) : Promise.resolve(notReady)).then((outcome) => post({ type: 'run', id: m.id, outcome }));
      break;
    case 'schema':
      void (exec ? exec.schema() : Promise.resolve([])).then((tables) => post({ type: 'schema', id: m.id, tables }));
      break;
    case 'sandbox':
      void (exec ? exec.sandbox(m.action) : Promise.resolve(false)).then((ok) => post({ type: 'sandbox', id: m.id, ok }));
      break;
  }
};
