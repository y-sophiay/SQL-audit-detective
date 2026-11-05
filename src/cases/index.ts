import type { CaseDef } from './types';
import { FOLLOW_UP } from './followup';

export type { CaseDef, ConceptCard } from './types';

export const LEVEL_LABEL: Record<CaseDef['level'], string> = {
  1: 'Beginner',
  2: 'Intermediate',
  3: 'Advanced',
  4: 'Finale',
  5: 'Follow-up',
  6: 'Hands-on',
};

const MAIN_FILE: CaseDef[] = [
  // ───────────────────────────────────────────── 01
  {
    id: 1,
    title: 'Edited After Approval',
    tagline: 'Approved, then quietly raised',
    level: 1,
    brief: [
      'Company policy: once a purchase order is approved, its amount must not go up, or it has to be sent for approval again. The head of audit suspects someone is quietly raising amounts after approval.',
      '`po_audit_log` records the old and new value of every field change on a purchase order. Both values are stored as text.',
    ],
    task: 'Find the purchase orders whose total_amount was raised after they were approved.',
    answerColumn: 'po_number',
    skills: ['JOIN', 'WHERE', '::numeric type cast', 'Comparing timestamps'],
    hints: [
      '"After approval" means the change time `po_audit_log.changed_at` is later than `purchase_orders.approved_at`. Join the two tables on `po_id`.',
      "Old and new values are text, so comparing them directly is an alphabetical comparison (`'900.00' > '1200.00'` is true). Use PostgreSQL's `value::numeric` to turn them into numbers first.",
      "Three conditions: `field_name = 'total_amount'`, `changed_at > approved_at`, and `new_value::numeric > old_value::numeric`. Output `po_number`; DISTINCT may help.",
    ],
    concept: {
      title: 'JOIN and the `::` type cast',
      body: [
        'JOIN pairs up rows of two tables that share a key: `ON a.po_id = po.po_id`.',
        'PostgreSQL casts with `value::type` (the standard spelling is `CAST(value AS type)`; they are equivalent). Always cast text to a number before comparing sizes, otherwise the comparison goes character by character.',
        'Timestamps (TIMESTAMP) can be compared directly with `>` and `<` to see which came first.',
      ],
      example: "SELECT '900.00' > '1200.00' AS as_text,\n       '900.00'::numeric > '1200.00'::numeric AS as_number;",
    },
    pitfalls: [
      'Forgetting the `field_name` condition also pulls in delivery-date changes.',
      'Forgetting the cast, so text comparison gives the wrong ordering.',
      'Comparing only the timing and not whether the amount went up or down.',
    ],
    solution: `SELECT DISTINCT po.po_number
FROM purchase_orders po
JOIN po_audit_log a ON a.po_id = po.po_id
WHERE a.field_name = 'total_amount'
  AND a.changed_at > po.approved_at
  AND a.new_value::numeric > a.old_value::numeric
ORDER BY po.po_number;`,
    solutionNotes:
      'Two things matter: `changed_at > approved_at` limits it to "after approval", and `::numeric` comes before comparing amounts. This also excludes changes made before approval, decreases, and changes to other fields.',
    decoyMessages: {
      lower: 'You also returned POs whose amount was lowered after approval. A decrease is not a violation, so watch the direction of the comparison.',
      preraise: 'Some of your rows were raised before approval. Check the order of changed_at and approved_at.',
      benignPost: 'Some of your rows only had their delivery date or ship-to changed after approval. Remember to restrict field_name.',
    },
    starter: `-- First, see what the change log looks like
SELECT *
FROM po_audit_log
LIMIT 10;`,
  },

  // ───────────────────────────────────────────── 02
  {
    id: 2,
    title: 'Invoiced, Never Paid',
    tagline: 'Booked invoices that nobody ever paid',
    level: 1,
    brief: [
      'The accounts payable manager received a reminder from a vendor: some invoices were booked long ago but have no payment at all.',
      'The company measures from the audit date **2025-12-31** (hard-code this date and do not use CURRENT_DATE, or the answer will change with the day you play). A booked invoice (`status = \'posted\'`) that is more than 60 days overdue and has no payment record counts as "overdue and unpaid".',
    ],
    task: 'Find the invoices that are posted, more than 60 days overdue, and have no payment record at all.',
    answerColumn: 'invoice_id',
    skills: ['LEFT JOIN … IS NULL', 'NOT EXISTS', 'Date arithmetic'],
    hints: [
      '"No payment record" means there is no matching `invoice_id` in `payments`. There are two classic ways to find what does not exist: `LEFT JOIN … WHERE right_table.primary_key IS NULL`, or `NOT EXISTS (subquery)`.',
      "In PostgreSQL, subtracting dates gives a whole number of days directly: `DATE '2025-12-31' - due_date`.",
      "Conditions: `status = 'posted'`, `DATE '2025-12-31' - due_date > 60`, and no row in payments matches.",
    ],
    concept: {
      title: 'Anti-joins and date arithmetic',
      body: [
        'A LEFT JOIN keeps every row of the left table; where the right side has no match its columns are NULL. Adding `WHERE right_table_pk IS NULL` then picks the rows with no match. This is called an anti-join. `NOT EXISTS` is equivalent and is often easier to read.',
        "Date arithmetic: `DATE - DATE` gives an integer (days); `DATE + integer` gives a date; `TIMESTAMP - TIMESTAMP` gives an INTERVAL. You can also write `due_date + INTERVAL '60 days' < DATE '2025-12-31'`.",
      ],
      example:
        "SELECT DATE '2025-12-31' - DATE '2025-10-01' AS days_apart,\n       DATE '2025-10-01' + 60 AS plus_60_days,\n       DATE '2025-10-01' + INTERVAL '2 months' AS plus_2_months;",
    },
    pitfalls: [
      'An INNER JOIN throws away exactly the rows that have no payment.',
      'Writing `payments.invoice_id = NULL` instead of `IS NULL` (it is never true).',
      'Forgetting to restrict status, so void or disputed invoices are counted too.',
    ],
    solution: `SELECT i.invoice_id, i.invoice_number, i.due_date, i.amount,
       DATE '2025-12-31' - i.due_date AS days_overdue
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.invoice_id
WHERE p.payment_id IS NULL
  AND i.status = 'posted'
  AND DATE '2025-12-31' - i.due_date > 60
ORDER BY days_overdue DESC;`,
    solutionNotes:
      'The same answer can be written with `NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.invoice_id)`. In PostgreSQL the two usually get the same execution plan; compare them with EXPLAIN.',
    decoyMessages: {
      disputed: 'Disputed invoices are not "booked but never paid". Look at status.',
      void: 'Void invoices never needed paying. Remember to filter on status.',
      near: 'Some invoices are unpaid but not yet more than 60 days overdue. Check the days condition.',
    },
    starter: `-- First, see what invoices and payments look like
SELECT i.invoice_id, i.invoice_number, i.due_date, i.status, p.payment_id
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.invoice_id
LIMIT 20;`,
  },

  // ───────────────────────────────────────────── 03
  {
    id: 3,
    title: 'Double Payment',
    tagline: 'One invoice entered twice and paid twice',
    level: 2,
    brief: [
      'A payment clerk complains: "How can one vendor have two invoices with exactly the same number?" `invoices` has no unique constraint on `(vendor_id, invoice_number)`, so an invoice that is entered twice can end up paid twice.',
      'Be careful: some invoices are paid in **instalments** (one invoice, two payments), which is not a duplicate. A duplicate entry that was voided and never paid caused no loss either.',
    ],
    task: 'Find the invoice numbers that were entered as several invoices by the same vendor, where every one of those invoices has a payment.',
    answerColumn: 'invoice_number',
    skills: ['GROUP BY on several columns', 'HAVING', 'COUNT(DISTINCT)', 'string_agg'],
    hints: [
      'You group by "same vendor + same invoice number", so GROUP BY takes two columns: `vendor_id, invoice_number`.',
      'JOIN `payments` first (keeping only invoices that were paid), then group. Voided duplicates with no payment simply disappear. To filter the grouped result use HAVING, not WHERE.',
      '`COUNT(*)` counts payments, so instalments get flagged by mistake. Count the number of distinct invoices instead: `HAVING COUNT(DISTINCT i.invoice_id) > 1`.',
    ],
    concept: {
      title: 'GROUP BY, HAVING and string_agg',
      body: [
        'WHERE filters rows (before grouping); HAVING filters groups (after grouping, so it can use COUNT, SUM and other aggregates).',
        '`COUNT(DISTINCT x)` counts only distinct values. After a JOIN one invoice can appear on several rows, so use DISTINCT to count invoices.',
        "`string_agg(column::text, ', ')` joins a group of values into one string (MySQL calls it GROUP_CONCAT). It is handy for listing the details while you aggregate.",
      ],
      example:
        "SELECT vendor_id, COUNT(*) AS invoices,\n       string_agg(invoice_number, ', ' ORDER BY invoice_date) AS numbers\nFROM invoices\nGROUP BY vendor_id\nHAVING COUNT(*) > 40\nORDER BY invoices DESC;",
    },
    pitfalls: [
      'Using `COUNT(*)` rather than `COUNT(DISTINCT invoice_id)`, so instalment invoices are flagged by mistake.',
      'Putting an aggregate condition in WHERE (a syntax error).',
      'Not joining payments first, so voided duplicates with no payment are counted.',
    ],
    solution: `SELECT i.vendor_id,
       i.invoice_number,
       COUNT(DISTINCT i.invoice_id)             AS times_entered,
       SUM(p.amount)                            AS total_paid,
       string_agg(DISTINCT i.invoice_id::text, ', ') AS invoice_ids
FROM invoices i
JOIN payments p ON p.invoice_id = i.invoice_id
GROUP BY i.vendor_id, i.invoice_number
HAVING COUNT(DISTINCT i.invoice_id) > 1
ORDER BY total_paid DESC;`,
    solutionNotes:
      'The key is to JOIN payments before grouping and to count distinct invoices rather than payment rows. The `total_paid` column also tells you directly how much was paid.',
    decoyMessages: {
      instalment: 'You also caught instalment invoices. `COUNT(*)` counts payments; count the distinct invoices instead.',
      voidDup: 'You counted voided duplicates that were never paid. First require a payment record.',
    },
    starter: `-- First, check whether any invoice numbers repeat
SELECT vendor_id, invoice_number, COUNT(*) AS n
FROM invoices
GROUP BY vendor_id, invoice_number
HAVING COUNT(*) > 1;`,
  },

  // ───────────────────────────────────────────── 04
  {
    id: 4,
    title: 'Skipping the Chain of Command',
    tagline: 'Approving your own purchase?',
    level: 2,
    brief: [
      "Purchasing policy: a purchase order above **AUD 2,000** must be approved by the requester's direct manager. For small purchases of 2,000 or less, any manager in the same department may approve.",
      "An employee's direct manager is stored in `employees.manager_id`, which points to another employee in the same table. The head of audit found POs that were approved by the requester themselves, or by someone unrelated.",
    ],
    task: "Find the purchase orders above 2,000 whose approver is not the requester's direct manager.",
    answerColumn: 'po_number',
    skills: ['Self join', 'IS DISTINCT FROM', 'Table aliases'],
    hints: [
      "The requester's manager has to be looked up in `employees`, and the same table is needed more than once (one row for the requester, one for the approver). Join it several times under different aliases, for example `employees r` and `employees a`.",
      'Join `purchase_orders.requested_by` to the requester row `r`, then compare `po.approved_by` with `r.manager_id` for inequality. `IS DISTINCT FROM` is a "not equal" that treats NULL as an ordinary value.',
      "Add `total_amount > 2000` to exclude small purchases. To show the approver's name, join employees once more under the alias `a`.",
    ],
    concept: {
      title: 'Self joins and NULL-safe comparison',
      body: [
        'A table can be joined to itself as long as each side gets a different alias: `FROM employees e JOIN employees boss ON boss.emp_id = e.manager_id`. This is the basic skill for hierarchical data (employee to manager).',
        'In SQL, `NULL <> 5` is NULL (treated as not true), so NULLs get filtered out quietly. `a IS DISTINCT FROM b` compares NULL as an ordinary value and always returns TRUE or FALSE.',
      ],
      example:
        'SELECT e.full_name AS employee, boss.full_name AS manager\nFROM employees e\nLEFT JOIN employees boss ON boss.emp_id = e.manager_id\nORDER BY e.emp_id\nLIMIT 10;',
    },
    pitfalls: [
      'Forgetting aliases: using the same table twice is an outright error.',
      'Swapping the requester and approver conditions.',
      'Forgetting the 2,000 threshold and counting legitimate small-purchase approvals.',
    ],
    solution: `SELECT po.po_number,
       r.full_name AS requester,
       a.full_name AS approver,
       po.total_amount
FROM purchase_orders po
JOIN employees r ON r.emp_id = po.requested_by
JOIN employees a ON a.emp_id = po.approved_by
WHERE po.total_amount > 2000
  AND po.approved_by IS DISTINCT FROM r.manager_id
ORDER BY po.total_amount DESC;`,
    solutionNotes:
      'This query uses employees in two roles: r (requester) and a (approver). Look at the results and you will see more than one pattern of violation: approving your own PO, being approved by a subordinate, and being approved by a manager from another department.',
    decoyMessages: {
      small: 'For purchases of 2,000 or less, other managers in the same department may approve. Do not forget the amount threshold.',
    },
    starter: `-- Look at purchase orders, requesters and approvers
SELECT po.po_number, po.requested_by, po.approved_by, po.total_amount
FROM purchase_orders po
LIMIT 10;`,
  },

  // ───────────────────────────────────────────── 05
  {
    id: 5,
    title: 'Order Splitting',
    tagline: 'One big order, cut into several small ones',
    level: 2,
    brief: [
      'A purchase order of **AUD 5,000** or more needs the CFO to co-sign. Someone is splitting big orders into several, each kept under 5,000, to avoid that co-signature.',
      'The typical pattern: the **same requester, the same vendor and the same week** raise 2 or more POs, each below 5,000, but together above 5,000. (Weeks start on Monday.)',
    ],
    task: 'Find the requesters who split orders.',
    answerColumn: 'emp_id',
    skills: ['date_trunc', 'GROUP BY', 'HAVING with several aggregate conditions', 'MAX / SUM'],
    hints: [
      'For "the same week", `date_trunc(\'week\', po_date)` rounds a date down to the Monday of its week. Group by it together with `requested_by` and `vendor_id`.',
      'A group must meet three conditions at once: at least 2 orders, a total of at least 5000, and the largest single order still below 5000 (otherwise it is just "a legitimate big order plus a small one"). All three judge the group, so they belong in HAVING.',
      '`HAVING COUNT(*) >= 2 AND SUM(total_amount) >= 5000 AND MAX(total_amount) < 5000`. In the output, alias `requested_by` as `emp_id`.',
    ],
    concept: {
      title: 'date_trunc and multiple HAVING conditions',
      body: [
        "`date_trunc('week', timestamp)` rounds the time down to 00:00 on Monday of that week (ISO week). The same works for `'day'`, `'month'`, `'quarter'` and `'year'`; it is the most common function for time-bucket reports.",
        'HAVING can hold several aggregate conditions at once. To show a timestamp as a date, add `::date` after it.',
      ],
      example:
        "SELECT date_trunc('month', po_date)::date AS month,\n       COUNT(*) AS orders,\n       SUM(total_amount) AS spend\nFROM purchase_orders\nGROUP BY 1\nORDER BY 1;",
    },
    pitfalls: [
      "Using `to_char(po_date, 'IW')` gives only the week number without the year, so weeks from different years get mixed up.",
      'Checking only that the total exceeds 5000 and missing the "every order is below 5000" condition.',
      'Leaving vendor_id out of the grouping, so orders to different vendors get mixed together.',
    ],
    solution: `SELECT po.requested_by AS emp_id,
       e.full_name,
       po.vendor_id,
       date_trunc('week', po.po_date)::date AS week_start,
       COUNT(*)                 AS po_count,
       SUM(po.total_amount)     AS combined,
       string_agg(po.po_number, ', ' ORDER BY po.po_date) AS po_numbers
FROM purchase_orders po
JOIN employees e ON e.emp_id = po.requested_by
GROUP BY po.requested_by, e.full_name, po.vendor_id, date_trunc('week', po.po_date)
HAVING COUNT(*) >= 2
   AND SUM(po.total_amount) >= 5000
   AND MAX(po.total_amount) < 5000
ORDER BY combined DESC;`,
    solutionNotes:
      '`MAX(total_amount) < 5000` is the heart of this case: it excludes the normal situation of "a properly approved big order plus one small one". Also, `string_agg(… ORDER BY …)` shows at a glance which POs were split.',
    decoyMessages: {
      under: 'Some of your groups do not even total 5,000. Check the total condition.',
      big: 'Some of your groups contain an order of 5,000 or more that was properly co-signed. Check the "every order below 5,000" condition.',
    },
    starter: `-- First, group POs by requester / vendor / week
SELECT requested_by, vendor_id,
       date_trunc('week', po_date)::date AS week_start,
       COUNT(*) AS n, SUM(total_amount) AS combined
FROM purchase_orders
GROUP BY requested_by, vendor_id, date_trunc('week', po_date)
HAVING COUNT(*) >= 2
LIMIT 20;`,
  },

  // ───────────────────────────────────────────── 06
  {
    id: 6,
    title: 'Ghost Vendor',
    tagline: 'This vendor seems to exist only on paper',
    level: 3,
    brief: [
      "Someone says: \"Some of our vendors don't seem to be real.\" HR gives one lead: a vendor's bank account in the vendor master is the same as an employee's **payroll account**.",
      'The difficulty is the format: employee accounts are 14 plain digits, while vendor accounts were typed by hand in varying formats, possibly with hyphens or spaces. Comparing with `=` will not match a single row.',
    ],
    task: 'Find the vendors whose bank account equals the payroll account of any employee.',
    answerColumn: 'vendor_id',
    skills: ['regexp_replace', 'JOIN ON an expression', 'Regular expressions'],
    hints: [
      'Look at `vendors.bank_account` and `employees.bank_account` first: the formats differ. You need to normalise the vendor account by removing every non-digit character.',
      "`regexp_replace(column, '\\D', '', 'g')`: `\\D` means \"not a digit\", and the fourth argument `'g'` means replace everywhere (without it only the first match is replaced).",
      "The ON condition of a JOIN can be any expression: `JOIN employees e ON regexp_replace(v.bank_account, '\\D', '', 'g') = e.bank_account`.",
    ],
    concept: {
      title: 'regexp_replace and joining on an expression',
      body: [
        "`regexp_replace(source, pattern, replacement, flags)`: the flag `'g'` replaces every match, and `'i'` ignores case. Common patterns: `\\d` a digit, `\\D` a non-digit, `\\s` whitespace, `^` / `$` start / end.",
        "The match operators `~` (matches) and `~*` (matches, ignoring case) are handy too: `bank_account ~ '^\\d{14}$'` checks for exactly 14 digits. Simple cases can also use `replace()` or `translate()`.",
        'A JOIN condition is not limited to equal columns; any expression that returns a boolean will do. Such a JOIN cannot use an ordinary index, so mind performance on big tables.',
      ],
      example:
        "SELECT bank_account,\n       regexp_replace(bank_account, '\\D', '', 'g') AS digits_only,\n       bank_account ~ '^\\d{14}$' AS already_clean\nFROM vendors\nLIMIT 8;",
    },
    pitfalls: [
      "Forgetting the `'g'` flag, so only the first hyphen is removed.",
      'Normalising only one side, so the other side still does not match.',
      'Thinking that "two vendors share an account" is the answer. You have to compare against the employees\' accounts.',
    ],
    solution: String.raw`SELECT v.vendor_id,
       v.vendor_name,
       v.bank_account  AS vendor_account,
       e.emp_id,
       e.full_name     AS employee,
       e.bank_account  AS employee_account
FROM vendors v
JOIN employees e
  ON regexp_replace(v.bank_account, '\D', '', 'g') = e.bank_account
ORDER BY v.vendor_id;`,
    solutionNotes:
      'This step connects two worlds that have no foreign key between them, using nothing but an equal column value. Note down the employees it catches; the last case needs them.',
    decoyMessages: {
      shared:
        'Two legitimate vendors share one bank account (parent and subsidiary), but neither matches any employee. Were you only comparing vendors with each other?',
      near: "One vendor's account differs from an employee's by a single digit. It has to match exactly.",
    },
    starter: `-- Compare the account formats on both sides
SELECT 'vendor' AS who, bank_account FROM vendors
UNION ALL
SELECT 'employee', bank_account FROM employees
LIMIT 12;`,
  },

  // ───────────────────────────────────────────── 07
  {
    id: 7,
    title: 'Stock Drift',
    tagline: 'The book balance stops matching the ledger from one entry on',
    level: 3,
    brief: [
      'A warehouse count shows that the book stock of some products is off. `inventory_movements` is the stock ledger: `qty` is signed (positive for goods in, negative for goods out) and `balance_after` is the balance the system recorded after the movement.',
      "Normally each row's `balance_after` should equal the running total of all `qty` for that product up to that row. But for some products, from a certain row on the system balance no longer matches the running total: someone bypassed the ledger and edited the balance directly.",
    ],
    task: 'Find every product whose book balance starts to drift from the running total, and report the **first** drifting movement_id of each.',
    answerColumn: 'movement_id',
    skills: ['Window functions: SUM() OVER', 'ROW_NUMBER() OVER', 'CTE (WITH)'],
    hints: [
      'Use a window function for the running total: `SUM(qty) OVER (PARTITION BY product_id ORDER BY movement_id)`. PARTITION BY is like GROUP BY, but it does not collapse the rows.',
      'Put the running total in a CTE (`WITH running AS (…)`) and filter `balance_after <> running_total` outside. Always order by `movement_id`: when several rows share a date, ordering by date alone treats the same-day rows as peers and accumulates them together, which gives wrong results.',
      'To get "the first row per product", number the drifting rows with `ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY movement_id)` and keep `= 1`.',
    ],
    concept: {
      title: 'Window functions and CTEs',
      body: [
        'A window function computes a value for every row, but over the context of its own group (`PARTITION BY`) sorted by `ORDER BY`. Common ones: `SUM() OVER` for running totals, `ROW_NUMBER()` for numbering, `LAG()` / `LEAD()` for the previous / next row, and `RANK()` for ranking.',
        'A window with `ORDER BY` defaults to the range "from the first row of the group to the current row *and all rows with the same sort value (peers)*". So when the sort key has duplicates (the same date), the running total adds all the same-day rows at once. For a row-by-row running total, add a column that sorts uniquely.',
        '`WITH name AS (query)` is called a CTE. Naming an intermediate result and reusing it in the next query lets you read a complex query in stages.',
      ],
      example:
        'SELECT movement_id, movement_date, qty,\n       SUM(qty) OVER (PARTITION BY product_id ORDER BY movement_id) AS running_total,\n       LAG(balance_after) OVER (PARTITION BY product_id ORDER BY movement_id) AS prev_balance\nFROM inventory_movements\nWHERE product_id = 1\nORDER BY movement_id\nLIMIT 10;',
    },
    pitfalls: [
      'Ordering by `movement_date` only: several rows on one day break the running total and many normal rows get flagged.',
      'Forgetting PARTITION BY product_id, so all products accumulate together.',
      'Writing the window function directly in WHERE (not allowed). Put it in a subquery or CTE first.',
    ],
    solution: `WITH running AS (
  SELECT movement_id, product_id, movement_date, movement_type, qty, balance_after,
         SUM(qty) OVER (PARTITION BY product_id ORDER BY movement_id) AS expected_balance
  FROM inventory_movements
),
flagged AS (
  SELECT *,
         ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY movement_id) AS nth_bad
  FROM running
  WHERE balance_after <> expected_balance
)
SELECT movement_id, product_id, movement_date, balance_after, expected_balance,
       balance_after - expected_balance AS drift
FROM flagged
WHERE nth_bad = 1
ORDER BY product_id;`,
    solutionNotes:
      'Window functions are evaluated after WHERE, which is why two CTE layers are needed: the first computes the expected balance, the second filters the mismatching rows and numbers them per product. The `drift` column shows the size of the deviation (positive = book is too high, negative = book is too low).',
    decoyMessages: {},
    starter: `-- Try a running total for a single product
SELECT movement_id, movement_date, movement_type, qty, balance_after,
       SUM(qty) OVER (PARTITION BY product_id ORDER BY movement_id) AS running_total
FROM inventory_movements
WHERE product_id = 1
ORDER BY movement_id
LIMIT 15;`,
  },

  // ───────────────────────────────────────────── 08
  {
    id: 8,
    title: 'Three-Way Match',
    tagline: 'Goods half delivered, invoice billed in full',
    level: 3,
    brief: [
      'The standard accounts payable control is the "three-way match": an invoice should not exceed **the value of the goods actually received**. Received value = Σ (quantity received × PO unit price).',
      'Three common violations: the invoice is billed for the whole order though only part arrived; the unit price on the invoice is inflated; or an invoice arrives before any goods. Be careful: `goods_receipts` is at line level and a line can arrive in batches; and some vendors always invoice "for what was actually delivered", so their amounts are correct.',
    ],
    task: 'Find the invoices whose amount is greater than the value of the goods received.',
    answerColumn: 'invoice_id',
    skills: ['CTE to aggregate first', 'LEFT JOIN', 'COALESCE', 'Avoiding fan-out'],
    hints: [
      'Received value takes three tables: `goods_receipts`, then `po_lines` (for the unit price), then aggregate to `po_id`. Aggregate this part in a CTE first so you get one row per purchase order.',
      'If you join invoices to po_lines to goods_receipts and then SUM, an invoice is counted several times (when a line has several receipts). This is called fan-out. Aggregate first, then attach the invoice, and nothing is duplicated.',
      'Some invoices belong to POs with no receipts at all. Attach the CTE with a `LEFT JOIN` and use `COALESCE(received_value, 0)` so NULL is treated as 0 before comparing.',
    ],
    concept: {
      title: 'Aggregate in a CTE first, avoid fan-out',
      body: [
        'A one-to-many JOIN repeats the columns of the "one" side. If you then SUM them, you count them several times (fan-out). The cure is to aggregate the "many" side to one row in a subquery or CTE first, and then JOIN.',
        '`COALESCE(a, b)` returns the first non-NULL value and is often used to fill in missing values after a LEFT JOIN. Any comparison with NULL gives NULL, so without COALESCE the invoices for goods that never arrived would be filtered out silently.',
        'The NUMERIC type does exact decimal arithmetic, which suits money and has no floating-point error.',
      ],
      example:
        'WITH received AS (\n  SELECT pl.po_id, SUM(gr.received_qty * pl.unit_price) AS received_value\n  FROM goods_receipts gr\n  JOIN po_lines pl ON pl.line_id = gr.po_line_id\n  GROUP BY pl.po_id\n)\nSELECT po.po_number, po.total_amount, r.received_value\nFROM purchase_orders po\nLEFT JOIN received r ON r.po_id = po.po_id\nLIMIT 10;',
    },
    pitfalls: [
      'Comparing against the PO total rather than the received value, which wrongly flags invoices that were billed for what was received.',
      'Joining several tables directly and then using SUM, which counts rows more than once.',
      'Using an INNER JOIN or forgetting COALESCE, so invoices issued before the goods arrived are missed.',
    ],
    solution: `WITH received AS (
  SELECT pl.po_id,
         SUM(gr.received_qty * pl.unit_price) AS received_value
  FROM goods_receipts gr
  JOIN po_lines pl ON pl.line_id = gr.po_line_id
  GROUP BY pl.po_id
)
SELECT i.invoice_id,
       i.invoice_number,
       i.amount                                  AS invoiced,
       COALESCE(r.received_value, 0)             AS received_value,
       i.amount - COALESCE(r.received_value, 0)  AS overbilled
FROM invoices i
LEFT JOIN received r ON r.po_id = i.po_id
WHERE i.amount > COALESCE(r.received_value, 0)
ORDER BY overbilled DESC;`,
    solutionNotes:
      'This query shows the standard way to handle a one-to-many relationship: aggregate to "one row per purchase order" first, then attach the invoices one to one. The `overbilled` column is the amount billed in excess and can be used directly as the basis for recovery.',
    decoyMessages: {
      shortNormal:
        'Some invoices are lower than the PO total because only part of the goods arrived and the vendor invoiced what was delivered, so their amounts are fine. Compare against the value received, not the PO total.',
    },
    starter: `-- First, work out the received value of each purchase order
SELECT pl.po_id, SUM(gr.received_qty * pl.unit_price) AS received_value
FROM goods_receipts gr
JOIN po_lines pl ON pl.line_id = gr.po_line_id
GROUP BY pl.po_id
LIMIT 10;`,
  },

  // ───────────────────────────────────────────── 09
  {
    id: 9,
    title: 'Finale: Connecting the Chain',
    tagline: 'One name, on all three lists',
    level: 4,
    brief: [
      'The head of audit lays out what you found so far: skipped approvals, split orders and the ghost vendor.',
      '"One incident may be a slip. But when the same person shows up on all three lists, it is no coincidence."',
    ],
    task: 'Find the employee who is on all three of these lists: (1) requesters with skipped approvals (case 4), (2) requesters who split orders (case 5), (3) employees whose payroll account matches a vendor (case 6).',
    answerColumn: 'emp_id',
    skills: ['CTE', 'INTERSECT', 'DISTINCT', 'Reusing earlier queries'],
    unlockAfterSolved: 6,
    hints: [
      'Wrap the queries of cases 4, 5 and 6 each in a CTE, and have every CTE output a single column `emp_id`. For case 6, output the matched **employee** `e.emp_id`, not the vendor.',
      'The set operator `INTERSECT` takes the intersection of two results, and it chains: `A INTERSECT B INTERSECT C`.',
      'If you prefer not to use INTERSECT: `SELECT emp_id FROM a WHERE emp_id IN (SELECT emp_id FROM b) AND emp_id IN (SELECT emp_id FROM c)`, or use `JOIN … USING (emp_id)`.',
    ],
    concept: {
      title: 'Set operations: UNION / INTERSECT / EXCEPT',
      body: [
        '`UNION` is the union, `INTERSECT` the intersection and `EXCEPT` the difference (in A but not in B). All three remove duplicate rows by default; add `ALL` to keep them. The queries must have matching numbers and types of columns.',
        'Splitting a complex problem into a few well-named CTEs, each answering one small question, and combining them at the end with a set operation or a JOIN is a good habit for readable, verifiable queries.',
      ],
      example: 'SELECT dept_id FROM employees\nINTERSECT\nSELECT dept_id FROM purchase_orders;',
    },
    pitfalls: [
      "The CTE for case 6 outputs vendor_id instead of the employee's emp_id, so the intersection is always empty.",
      'The column types on the three lists differ, so INTERSECT raises an error.',
      'Using UNION instead of INTERSECT, which returns lots of people who appear only once.',
    ],
    solution: String.raw`WITH off_manager AS (
  SELECT DISTINCT po.requested_by AS emp_id
  FROM purchase_orders po
  JOIN employees r ON r.emp_id = po.requested_by
  WHERE po.total_amount > 2000
    AND po.approved_by IS DISTINCT FROM r.manager_id
),
splitters AS (
  SELECT DISTINCT requested_by AS emp_id
  FROM purchase_orders
  GROUP BY requested_by, vendor_id, date_trunc('week', po_date)
  HAVING COUNT(*) >= 2
     AND SUM(total_amount) >= 5000
     AND MAX(total_amount) < 5000
),
ghost_owners AS (
  SELECT DISTINCT e.emp_id
  FROM vendors v
  JOIN employees e
    ON regexp_replace(v.bank_account, '\D', '', 'g') = e.bank_account
)
SELECT emp_id FROM off_manager
INTERSECT
SELECT emp_id FROM splitters
INTERSECT
SELECT emp_id FROM ghost_owners;`,
    solutionNotes:
      "Each of the three CTEs answers one question, and INTERSECT finds the person they have in common. Once you have the emp_id, join employees and vendors to see this person's title and how much their ghost vendor was paid. That is the whole picture of the case.",
    decoyMessages: {
      partial: 'The people you found appear on only some of the lists. They have to be on all three.',
    },
    starter: `-- Wrap the earlier cases in CTEs, each outputting only emp_id
WITH off_manager AS (
  SELECT DISTINCT po.requested_by AS emp_id
  FROM purchase_orders po
  JOIN employees r ON r.emp_id = po.requested_by
  WHERE po.total_amount > 2000
    AND po.approved_by IS DISTINCT FROM r.manager_id
)
SELECT * FROM off_manager;`,
  },
];

/** The second file: more query techniques (cases 10–14) and cases where you change data (15–18). */
export const CASES: CaseDef[] = [...MAIN_FILE, ...FOLLOW_UP];

export const isFix = (c: CaseDef) => c.kind === 'fix';

export function caseById(id: number): CaseDef {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown case ${id}`);
  return c;
}
