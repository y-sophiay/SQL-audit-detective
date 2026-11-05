export interface Snippet {
  title: string;
  note: string;
  sql: string;
}
export interface SnippetGroup {
  name: string;
  items: Snippet[];
}

/** The sandbox cheat sheet. Every snippet runs as-is against the game database. */
export const SNIPPET_GROUPS: SnippetGroup[] = [
  {
    name: 'Querying and joining',
    items: [
      {
        title: 'Filter, sort, limit',
        note: 'WHERE / ORDER BY / LIMIT',
        sql: "SELECT po_number, total_amount, status\nFROM purchase_orders\nWHERE status = 'closed' AND total_amount > 9000\nORDER BY total_amount DESC\nLIMIT 10;",
      },
      {
        title: 'One row per group: DISTINCT ON',
        note: 'PostgreSQL-specific. The latest purchase order of each requester',
        sql: 'SELECT DISTINCT ON (requested_by) requested_by, po_number, po_date, total_amount\nFROM purchase_orders\nORDER BY requested_by, po_date DESC;',
      },
      {
        title: 'Case-insensitive search',
        note: 'ILIKE (PostgreSQL-specific)',
        sql: "SELECT vendor_id, vendor_name\nFROM vendors\nWHERE vendor_name ILIKE '%pack%';",
      },
      {
        title: 'LEFT JOIN to find rows with no match',
        note: 'Vendors without any purchase order',
        sql: 'SELECT v.vendor_id, v.vendor_name\nFROM vendors v\nLEFT JOIN purchase_orders po ON po.vendor_id = v.vendor_id\nWHERE po.po_id IS NULL;',
      },
      {
        title: 'Self join: employees and managers',
        note: 'Join a table to itself',
        sql: 'SELECT e.full_name AS employee, m.full_name AS manager\nFROM employees e\nLEFT JOIN employees m ON m.emp_id = e.manager_id\nORDER BY m.full_name, e.full_name;',
      },
    ],
  },
  {
    name: 'Aggregation and grouping',
    items: [
      {
        title: 'Spend per department',
        note: 'GROUP BY + SUM + ORDER BY',
        sql: 'SELECT d.dept_name, COUNT(*) AS orders, SUM(po.total_amount) AS spend\nFROM purchase_orders po\nJOIN departments d ON d.dept_id = po.dept_id\nGROUP BY d.dept_name\nORDER BY spend DESC;',
      },
      {
        title: 'HAVING: filter grouped results',
        note: 'Vendors with more than 30 purchase orders',
        sql: 'SELECT vendor_id, COUNT(*) AS orders\nFROM purchase_orders\nGROUP BY vendor_id\nHAVING COUNT(*) > 30\nORDER BY orders DESC;',
      },
      {
        title: 'FILTER: conditional aggregates',
        note: 'Count each status in one pass',
        sql: "SELECT COUNT(*) AS total,\n       COUNT(*) FILTER (WHERE status = 'closed')    AS closed,\n       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled\nFROM purchase_orders;",
      },
      {
        title: 'string_agg: collapse rows into one string',
        note: 'Vendors each employee has ordered from',
        sql: "SELECT e.full_name, string_agg(DISTINCT v.vendor_name, ', ' ORDER BY v.vendor_name) AS vendors\nFROM purchase_orders po\nJOIN employees e ON e.emp_id = po.requested_by\nJOIN vendors v ON v.vendor_id = po.vendor_id\nGROUP BY e.full_name\nLIMIT 10;",
      },
      {
        title: 'CASE WHEN: banding',
        note: 'Split PO amounts into three bands',
        sql: "SELECT CASE WHEN total_amount < 2000 THEN 'Small'\n            WHEN total_amount < 5000 THEN 'Medium'\n            ELSE 'Large' END AS band,\n       COUNT(*) AS orders\nFROM purchase_orders\nGROUP BY 1\nORDER BY 1;",
      },
    ],
  },
  {
    name: 'Dates, text and types',
    items: [
      {
        title: 'date_trunc: monthly totals',
        note: "'week' / 'month' / 'quarter' / 'year'",
        sql: "SELECT date_trunc('month', po_date)::date AS month, COUNT(*) AS orders, SUM(total_amount) AS spend\nFROM purchase_orders\nGROUP BY 1\nORDER BY 1;",
      },
      {
        title: 'Date arithmetic and INTERVAL',
        note: 'DATE - DATE gives a whole number of days',
        sql: "SELECT invoice_id, invoice_date, due_date,\n       due_date - invoice_date AS terms_days,\n       due_date + INTERVAL '7 days' AS grace_until\nFROM invoices\nLIMIT 10;",
      },
      {
        title: 'to_char and extract',
        note: 'Format dates, pull out parts',
        sql: "SELECT to_char(po_date, 'YYYY-MM') AS ym,\n       EXTRACT(dow FROM po_date) AS day_of_week,\n       COUNT(*)\nFROM purchase_orders\nGROUP BY 1, 2\nORDER BY 1, 2\nLIMIT 14;",
      },
      {
        title: 'regexp_replace and the ~ operator',
        note: 'Regular expressions',
        sql: "SELECT bank_account,\n       regexp_replace(bank_account, '\\D', '', 'g') AS digits_only,\n       bank_account ~ '^\\d{14}$' AS is_clean\nFROM vendors\nLIMIT 8;",
      },
      {
        title: 'split_part, upper, format',
        note: 'Everyday text functions',
        sql: "SELECT email,\n       split_part(email, '@', 1) AS mailbox,\n       upper(full_name) AS shout,\n       format('%s (%s)', full_name, title) AS label\nFROM employees\nLIMIT 5;",
      },
      {
        title: 'COALESCE and NULLIF',
        note: 'Handling NULL',
        sql: "SELECT full_name, COALESCE(manager_id::text, '(top of the org)') AS manager,\n       NULLIF(status, 'active') AS non_active\nFROM employees\nORDER BY emp_id\nLIMIT 5;",
      },
    ],
  },
  {
    name: 'Advanced queries',
    items: [
      {
        title: 'Window functions: ranking and running totals',
        note: 'ROW_NUMBER / SUM OVER',
        sql: 'SELECT vendor_id, po_number, total_amount,\n       ROW_NUMBER() OVER (PARTITION BY vendor_id ORDER BY total_amount DESC) AS rank_in_vendor,\n       SUM(total_amount) OVER (PARTITION BY vendor_id ORDER BY po_date, po_id) AS running_spend\nFROM purchase_orders\nORDER BY vendor_id, rank_in_vendor\nLIMIT 15;',
      },
      {
        title: 'LAG: compare with the previous row',
        note: 'How much each invoice differs from the previous one',
        sql: 'SELECT invoice_id, invoice_date, amount,\n       amount - LAG(amount) OVER (PARTITION BY vendor_id ORDER BY invoice_date, invoice_id) AS change_vs_prev\nFROM invoices\nWHERE vendor_id = 1\nORDER BY invoice_date, invoice_id;',
      },
      {
        title: 'Recursive CTE: walk the org chart',
        note: 'WITH RECURSIVE',
        sql: "WITH RECURSIVE org AS (\n  SELECT emp_id, full_name, title, manager_id, 0 AS depth,\n         full_name::text AS path\n  FROM employees WHERE manager_id IS NULL\n  UNION ALL\n  SELECT e.emp_id, e.full_name, e.title, e.manager_id, o.depth + 1,\n         o.path || ' > ' || e.full_name\n  FROM employees e\n  JOIN org o ON e.manager_id = o.emp_id\n)\nSELECT repeat('  ', depth) || full_name AS person, title, depth\nFROM org\nORDER BY path\nLIMIT 25;",
      },
      {
        title: 'generate_series: a continuous run of dates',
        note: 'Fill in the days that have no data',
        sql: "SELECT d::date AS day, COUNT(po.po_id) AS orders\nFROM generate_series(DATE '2025-03-01', DATE '2025-03-14', INTERVAL '1 day') AS d\nLEFT JOIN purchase_orders po ON po.po_date = d::date\nGROUP BY 1\nORDER BY 1;",
      },
      {
        title: 'UNION / INTERSECT / EXCEPT',
        note: 'Set operations',
        sql: '-- Vendors with purchase orders but no goods ever received\nSELECT vendor_id FROM purchase_orders\nEXCEPT\nSELECT po.vendor_id\nFROM purchase_orders po\nJOIN po_lines pl ON pl.po_id = po.po_id\nJOIN goods_receipts gr ON gr.po_line_id = pl.line_id;',
      },
      {
        title: 'JSONB: turn rows into JSON',
        note: 'jsonb_build_object / jsonb_agg',
        sql: "SELECT po.po_number,\n       jsonb_agg(jsonb_build_object('product', p.product_name, 'qty', pl.qty)) AS items\nFROM purchase_orders po\nJOIN po_lines pl ON pl.po_id = po.po_id\nJOIN products p ON p.product_id = pl.product_id\nGROUP BY po.po_number\nLIMIT 5;",
      },
      {
        title: 'EXPLAIN ANALYZE: read the execution plan',
        note: 'See what an index changes',
        sql: 'EXPLAIN ANALYZE\nSELECT * FROM invoices WHERE vendor_id = 5;',
      },
    ],
  },
  {
    name: 'Changing data (sandbox)',
    items: [
      {
        title: 'Create a table and insert data',
        note: 'CREATE TABLE + INSERT ... RETURNING',
        sql: "CREATE TABLE watchlist (\n  vendor_id INTEGER PRIMARY KEY REFERENCES vendors(vendor_id),\n  reason    TEXT NOT NULL,\n  added_on  DATE NOT NULL DEFAULT CURRENT_DATE\n);\n\nINSERT INTO watchlist (vendor_id, reason)\nVALUES (1, 'Odd account format'), (2, 'Payment overdue')\nRETURNING *;",
      },
      {
        title: 'UPSERT: update on conflict',
        note: 'INSERT ... ON CONFLICT DO UPDATE',
        sql: "-- Needs the watchlist table from the previous example; created here too\nCREATE TABLE IF NOT EXISTS watchlist (vendor_id INTEGER PRIMARY KEY, reason TEXT NOT NULL);\nINSERT INTO watchlist VALUES (1, 'Odd account format');\n\nINSERT INTO watchlist (vendor_id, reason)\nVALUES (1, 'Reviewed')\nON CONFLICT (vendor_id) DO UPDATE SET reason = EXCLUDED.reason\nRETURNING *;",
      },
      {
        title: 'UPDATE ... FROM: update using another table',
        note: 'Cancel open POs of inactive vendors, and see which ones',
        sql: "UPDATE purchase_orders po\nSET status = 'cancelled'\nFROM vendors v\nWHERE v.vendor_id = po.vendor_id\n  AND v.status = 'inactive'\n  AND po.status = 'open'\nRETURNING po.po_number, v.vendor_name;",
      },
      {
        title: 'DELETE ... RETURNING',
        note: 'Delete and see what was deleted (foreign keys protect you)',
        sql: "DELETE FROM po_audit_log\nWHERE field_name = 'ship_to'\nRETURNING log_id, po_id, old_value, new_value;",
      },
      {
        title: 'CREATE VIEW: save a query',
        note: 'Query it afterwards like a table',
        sql: "CREATE VIEW big_open_orders AS\nSELECT po_number, vendor_id, total_amount\nFROM purchase_orders\nWHERE status = 'open' AND total_amount > 8000;\n\nSELECT * FROM big_open_orders;",
      },
      {
        title: 'CREATE TABLE AS and CREATE INDEX',
        note: 'Create an index, then watch it with EXPLAIN',
        sql: 'CREATE TABLE po_copy AS SELECT * FROM purchase_orders;\nCREATE INDEX idx_copy_vendor ON po_copy (vendor_id);\nEXPLAIN SELECT * FROM po_copy WHERE vendor_id = 7;',
      },
      {
        title: 'ALTER TABLE: add columns and constraints',
        note: 'Change the structure',
        sql: "ALTER TABLE vendors ADD COLUMN risk_note TEXT;\nUPDATE vendors SET risk_note = 'review' WHERE vendor_id <= 3;\nSELECT vendor_id, vendor_name, risk_note FROM vendors ORDER BY vendor_id LIMIT 5;",
      },
    ],
  },
];
