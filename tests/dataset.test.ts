import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { CASES, isFix } from '../src/cases';
import { generateDataset, type Dataset } from '../src/data/generator';
import { loadDataset, rowCounts } from '../src/data/load';
import type { Masters } from '../src/data/masters';
import { normaliseValue } from '../src/engine/check';
import { Executor } from '../src/engine/executor';
import { loadMastersFromDisk } from '../scripts/_masters-node';

const WIDE = process.env.WIDE === '1';
const SEEDS = WIDE
  ? Array.from({ length: 120 }, (_, i) => `WIDE${i.toString(36).toUpperCase()}${(i * 7919) % 1000}`)
  : ['K7QX2M', 'DEMO42', 'AAAAAA', 'ZZZZZZ', 'P4SSWD', 'HELLO1', 'SQL101', 'AUDIT9'];

let masters: Masters;
let db: PGlite;

beforeAll(async () => {
  masters = loadMastersFromDisk();
  db = await PGlite.create();
}, 120_000);

async function reset(ds: Dataset) {
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await loadDataset(db, ds);
}

/** Every integrity probe must return zero rows. */
const INTEGRITY: Record<string, string> = {
  'PO total equals sum of lines': `SELECT po.po_id FROM purchase_orders po
     WHERE po.total_amount <> (SELECT SUM(line_amount) FROM po_lines l WHERE l.po_id = po.po_id)`,
  'every PO has at least one line': `SELECT po_id FROM purchase_orders po WHERE NOT EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = po.po_id)`,
  'approval after creation': `SELECT po_id FROM purchase_orders WHERE approved_at <= created_at`,
  'invoice vendor matches PO vendor': `SELECT i.invoice_id FROM invoices i JOIN purchase_orders po ON po.po_id = i.po_id WHERE po.vendor_id <> i.vendor_id`,
  'due date = invoice date + vendor terms': `SELECT i.invoice_id FROM invoices i JOIN vendors v ON v.vendor_id = i.vendor_id WHERE i.due_date <> i.invoice_date + v.payment_terms_days`,
  'payments add up to the invoice': `SELECT i.invoice_id FROM invoices i JOIN payments p ON p.invoice_id = i.invoice_id GROUP BY i.invoice_id, i.amount HAVING SUM(p.amount) <> i.amount`,
  'payment after invoice and within period': `SELECT p.payment_id FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id WHERE p.payment_date <= i.invoice_date OR p.payment_date > DATE '2025-12-31'`,
  'receipt not before approval, not after as-of': `SELECT g.gr_id FROM goods_receipts g JOIN po_lines l ON l.line_id = g.po_line_id JOIN purchase_orders po ON po.po_id = l.po_id
     WHERE g.received_date < po.approved_at::date OR g.received_date > DATE '2025-12-31'`,
  'no receipt beyond ordered quantity': `SELECT l.line_id FROM po_lines l JOIN goods_receipts g ON g.po_line_id = l.line_id GROUP BY l.line_id, l.qty HAVING SUM(g.received_qty) > l.qty`,
  'invoice dated on/after last receipt': `SELECT i.invoice_id FROM invoices i
     WHERE i.invoice_date < (SELECT MAX(g.received_date) FROM goods_receipts g JOIN po_lines l ON l.line_id = g.po_line_id WHERE l.po_id = i.po_id)`,
  'audit rows inside the period': `SELECT a.log_id FROM po_audit_log a JOIN purchase_orders po ON po.po_id = a.po_id
     WHERE a.changed_at < po.created_at OR a.changed_at > TIMESTAMP '2025-12-31 23:59:59'`,
  'status consistent with documents (closed ⇒ invoice)': `SELECT po_id FROM purchase_orders po WHERE po.status = 'closed' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.po_id = po.po_id)`,
  'cancelled POs have no receipts / invoices': `SELECT po.po_id FROM purchase_orders po WHERE po.status = 'cancelled'
     AND (EXISTS (SELECT 1 FROM invoices i WHERE i.po_id = po.po_id) OR EXISTS (SELECT 1 FROM po_lines l JOIN goods_receipts g ON g.po_line_id = l.line_id WHERE l.po_id = po.po_id))`,
  'products match vendor category': `SELECT l.line_id FROM po_lines l JOIN purchase_orders po ON po.po_id = l.po_id JOIN vendors v ON v.vendor_id = po.vendor_id JOIN products p ON p.product_id = l.product_id WHERE p.category <> v.category`,
  'requester dept = PO dept': `SELECT po.po_id FROM purchase_orders po JOIN employees e ON e.emp_id = po.requested_by WHERE e.dept_id <> po.dept_id`,
  'only the CEO lacks a manager': `SELECT emp_id FROM employees WHERE manager_id IS NULL AND title <> 'Chief Executive Officer'`,
  'leavers never appear in any role': `SELECT t.emp FROM (
       SELECT requested_by AS emp FROM purchase_orders UNION ALL SELECT approved_by FROM purchase_orders
       UNION ALL SELECT received_by FROM goods_receipts UNION ALL SELECT entered_by FROM invoices
       UNION ALL SELECT paid_by FROM payments UNION ALL SELECT changed_by FROM po_audit_log
       UNION ALL SELECT onboarded_by FROM vendors) t JOIN employees e ON e.emp_id = t.emp WHERE e.status <> 'active'`,
  'inventory RECEIPT rows mirror goods_receipts': `SELECT m.movement_id FROM inventory_movements m
     LEFT JOIN goods_receipts g ON g.gr_id = m.ref_id
     LEFT JOIN po_lines l ON l.line_id = g.po_line_id
     WHERE m.movement_type = 'RECEIPT' AND (g.gr_id IS NULL OR m.qty <> g.received_qty OR m.movement_date <> g.received_date OR m.product_id <> l.product_id)`,
  'every goods receipt reaches the stock ledger': `SELECT g.gr_id FROM goods_receipts g WHERE NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.movement_type = 'RECEIPT' AND m.ref_id = g.gr_id)`,
  'inventory qty signs': `SELECT movement_id FROM inventory_movements WHERE (movement_type IN ('OPENING','RECEIPT') AND qty <= 0) OR (movement_type = 'ISSUE' AND qty >= 0)`,
};

describe('data model', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const hash = (d: Dataset) =>
      createHash('sha1')
        .update(JSON.stringify([d.tables, d.truth]))
        .digest('hex');
    const a1 = generateDataset('SAMEAA', masters);
    const a2 = generateDataset('SAMEAA', masters);
    const b = generateDataset('OTHERB', masters);
    expect(hash(a1)).toBe(hash(a2));
    expect(hash(a1)).not.toBe(hash(b));
    const masterminds = new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].map((x) => generateDataset(x, masters).truth[9].answer[0]));
    expect(masterminds.size).toBeGreaterThan(2);
  });

  it('is large enough to be interesting', () => {
    const c = rowCounts(generateDataset('SIZE01', masters));
    expect(c.employees).toBeGreaterThanOrEqual(100);
    expect(c.vendors).toBeGreaterThanOrEqual(60);
    expect(c.purchase_orders).toBeGreaterThanOrEqual(1500);
    expect(c.po_lines).toBeGreaterThanOrEqual(4000);
    expect(c.invoices).toBeGreaterThanOrEqual(1200);
    expect(c.payments).toBeGreaterThanOrEqual(1000);
    expect(c.inventory_movements).toBeGreaterThanOrEqual(6000);
  });
});

describe.each(SEEDS)('seed %s', (seed) => {
  let ds: Dataset;
  beforeAll(async () => {
    ds = generateDataset(seed, masters);
    await reset(ds);
  }, 120_000);

  for (const [name, sql] of Object.entries(INTEGRITY)) {
    it(`integrity: ${name}`, async () => {
      const r = await db.query(sql);
      expect(r.rows.slice(0, 5)).toEqual([]);
    });
  }

  for (const c of CASES.filter((x) => !isFix(x))) {
    it(`case ${c.id} (${c.title}): reference SQL finds exactly the planted answer`, async () => {
      const r = await db.query(c.solution, [], {
        rowMode: 'array',
        parsers: { 1700: (v: string) => v, 20: (v: string) => v, 1082: (v: string) => v, 1114: (v: string) => v },
      });
      const col = r.fields.findIndex((f) => f.name === c.answerColumn);
      expect(col, `column ${c.answerColumn} missing`).toBeGreaterThanOrEqual(0);
      const got = [...new Set((r.rows as unknown[][]).map((row) => normaliseValue(row[col])))].sort();
      const want = [...new Set(ds.truth[c.id].answer.map(normaliseValue))].sort();
      expect(got).toEqual(want);
      // decoys must never overlap the answer, and answers must be non-trivial
      expect(want.length).toBeGreaterThanOrEqual(1);
      const decoyIds = ds.truth[c.id].decoys.flatMap((d) => d.ids.map(normaliseValue));
      expect(decoyIds.filter((x) => want.includes(x))).toEqual([]);
    });
  }

  for (const c of CASES.filter(isFix)) {
    it(`case ${c.id} (${c.title}): reference script leaves exactly the expected state, and nothing persists`, async () => {
      const ex = new Executor(db);
      const before = (
        await db.query<{ n: string }>(`SELECT (SELECT COUNT(*) FROM invoices) + (SELECT COUNT(*) FROM payments) + (SELECT COUNT(*) FROM vendor_watchlist) AS n`)
      ).rows[0].n;
      const o = await ex.run(c.solution, 'fix', c.verify);
      if (!o.ok) throw new Error(`${o.kind}: ${o.message}`);
      expect(o.verify, 'verify missing').toBeDefined();
      if (!o.verify!.ok) throw new Error(`verify failed: ${o.verify!.message}`);
      const idx = o.verify!.fields.findIndex((f) => f.name === c.answerColumn);
      expect(idx).toBeGreaterThanOrEqual(0);
      const got = [...new Set(o.verify!.rows.map((row) => normaliseValue(row[idx])))].sort();
      const want = [...new Set(ds.truth[c.id].answer.map(normaliseValue))].sort();
      expect(got).toEqual(want);
      const decoyIds = ds.truth[c.id].decoys.flatMap((d) => d.ids.map(normaliseValue));
      expect(decoyIds.filter((x) => want.includes(x))).toEqual([]);
      // rolled back: the database is exactly as it was, and the player's table is gone
      const after = (
        await db.query<{ n: string }>(`SELECT (SELECT COUNT(*) FROM invoices) + (SELECT COUNT(*) FROM payments) + (SELECT COUNT(*) FROM vendor_watchlist) AS n`)
      ).rows[0].n;
      expect(after).toBe(before);
      const t = await db.query(
        `SELECT to_regclass('public.vendor_last_invoice') AS t, (SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'idx_payments_date') AS i`,
      );
      expect(t.rows[0]).toMatchObject({ t: null });
      expect(Number((t.rows[0] as { i: unknown }).i)).toBe(0);
    });
  }

  it('decoy groups are populated where promised', () => {
    for (const c of CASES) {
      for (const key of Object.keys(c.decoyMessages).filter((k) => !k.startsWith('*'))) {
        const g = ds.truth[c.id].decoys.find((d) => d.key === key);
        expect(g, `case ${c.id} decoy ${key}`).toBeDefined();
        expect(g!.ids.length, `case ${c.id} decoy ${key} empty`).toBeGreaterThan(0);
      }
    }
  });
});
