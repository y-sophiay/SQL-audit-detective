import { PGlite } from '@electric-sql/pglite';
import { generateDataset } from '../src/data/generator';
import { loadDataset, rowCounts } from '../src/data/load';
import { loadMastersFromDisk } from './_masters-node';

const masters = loadMastersFromDisk();
let t = Date.now();
const ds = generateDataset(process.argv[2] ?? 'DEMO42', masters);
console.log('generate ms', Date.now() - t);
console.log(
  rowCounts(ds),
  Object.values(rowCounts(ds)).reduce((a, b) => a + b, 0),
);
console.log('truth sizes', Object.fromEntries(Object.entries(ds.truth).map(([k, v]) => [k, v.answer.length])));
t = Date.now();
const db = await PGlite.create();
console.log('boot ms', Date.now() - t);
t = Date.now();
await loadDataset(db, ds);
console.log('load ms', Date.now() - t);
const r = await db.query(
  'select count(*) from purchase_orders where total_amount <> (select sum(line_amount) from po_lines l where l.po_id = purchase_orders.po_id)',
);
console.log('po total mismatches', r.rows);
