import type { CaseDef } from './types';

/**
 * The second file. Cases 10–14 teach more query techniques; cases 15–18 are hands-on: the player's script changes data
 * inside a transaction that is always rolled back, and a check query reads the state it left behind.
 * Every case has three hints, and the first one always teaches the command itself.
 */
export const FOLLOW_UP: CaseDef[] = [
  // ───────────────────────────────────────────── 10
  {
    id: 10,
    title: 'Urgent, Always Urgent',
    tagline: 'A vendor whose invoices all arrive with a pressure note',
    level: 5,
    unlockAfterSolved: 2,
    brief: [
      'An accounts payable clerk says: "Some vendors\' invoices always come with a note saying URGENT." Urgency is a classic pressure tactic: it gets an invoice paid before anyone looks at it closely.',
      "`invoices.notes` is free text typed by the clerk, so the wording and the capitalisation vary: 'URGENT - pay on receipt', 'Urgent payment requested', 'asap per Procurement'. A note counts as urgent if it contains the word **urgent** or **asap** in any capitalisation.",
    ],
    task: 'Find the vendors that have at least 6 invoices and where more than half of their invoices carry an urgent note.',
    answerColumn: 'vendor_id',
    skills: ['ILIKE', 'FILTER (WHERE …)', 'Conditional counts in HAVING'],
    hints: [
      "`LIKE` is case sensitive in PostgreSQL; `ILIKE` ignores case. `%` stands for any run of characters, so `notes ILIKE '%urgent%'` is true for 'URGENT - pay on receipt' and for 'Urgent payment requested'. Try it: `SELECT notes FROM invoices WHERE notes ILIKE '%urgent%' OR notes ILIKE '%asap%' LIMIT 20;`",
      "You need two counts per vendor in one pass: all invoices, and only the urgent ones. `COUNT(*) FILTER (WHERE condition)` counts only the rows that meet the condition, for example `COUNT(*) FILTER (WHERE notes ILIKE '%urgent%' OR notes ILIKE '%asap%') AS urgent_invoices`. Group by `vendor_id`.",
      'Judge the groups in HAVING, because the test is about counts: `HAVING COUNT(*) >= 6 AND (urgent count) * 2 > COUNT(*)`. Multiplying the urgent count by 2 is a way to say "more than half" without decimals.',
    ],
    concept: {
      title: 'ILIKE and FILTER',
      body: [
        '`LIKE` matches text case-sensitively; `ILIKE` ignores case. In the pattern `%` matches any number of characters (including none) and `_` matches exactly one. `NOT ILIKE` is the opposite. A pattern that matches too much is as risky as one that matches too little, so look at the rows it picks up.',
        '`aggregate(…) FILTER (WHERE condition)` applies the aggregate only to the rows that meet the condition. It lets you compute several different conditional counts or sums in one GROUP BY, and it replaces the older trick `SUM(CASE WHEN condition THEN 1 ELSE 0 END)`.',
      ],
      example:
        "SELECT vendor_id,\n       COUNT(*) AS invoices,\n       COUNT(*) FILTER (WHERE notes ILIKE '%urgent%') AS with_urgent\nFROM invoices\nGROUP BY vendor_id\nORDER BY with_urgent DESC\nLIMIT 10;",
    },
    pitfalls: [
      "Using `LIKE '%urgent%'`: it misses 'URGENT' and 'Urgent', so real cases drop out of the count.",
      "Checking only the word 'urgent': some pressure notes only say 'asap'.",
      'Putting the share test in WHERE (aggregates are not allowed there) or dividing two integers (`1 / 2` is 0 in integer arithmetic).',
    ],
    solution: `SELECT vendor_id,
       COUNT(*) AS invoices,
       COUNT(*) FILTER (WHERE notes ILIKE '%urgent%' OR notes ILIKE '%asap%') AS urgent_invoices
FROM invoices
GROUP BY vendor_id
HAVING COUNT(*) >= 6
   AND COUNT(*) FILTER (WHERE notes ILIKE '%urgent%' OR notes ILIKE '%asap%') * 2 > COUNT(*)
ORDER BY urgent_invoices DESC;`,
    solutionNotes:
      'FILTER gives two different counts in one pass over the table. The same result can be written with `SUM(CASE WHEN … THEN 1 ELSE 0 END)`. To print the actual share, divide with a numeric: `ROUND(100.0 * urgent_invoices / invoices)`.',
    decoyMessages: {
      edge: 'Some of your vendors have urgent notes on fewer than half of their invoices, or exactly half. The rule is more than half.',
      few: "A few urgent notes are normal. A vendor with two or three urgent invoices out of dozens is not a pattern, so compare with the vendor's total.",
    },
    starter: `-- First, see how the notes are worded
SELECT notes, COUNT(*) AS n
FROM invoices
WHERE notes IS NOT NULL
GROUP BY notes
ORDER BY n DESC;`,
  },

  // ───────────────────────────────────────────── 11
  {
    id: 11,
    title: 'Missing Cheques',
    tagline: 'A cheque number that nobody recorded',
    level: 5,
    unlockAfterSolved: 2,
    brief: [
      'Every cheque the company writes carries the next number in one running sequence, so the sequence should have no holes. A missing number means a cheque was written, and may have been cashed, that nobody recorded.',
      "In `payments`, a payment with `method = 'CHEQUE'` has a `bank_ref` such as `CHQ100245`: the letters CHQ followed by the cheque number. All the cheques of the year are in this one sequence. Other payment methods use other references and are not part of it.",
    ],
    task: 'Find every cheque number between the lowest and the highest one that has no payment.',
    answerColumn: 'cheque_no',
    skills: ['generate_series', 'EXCEPT', 'substr and casting'],
    hints: [
      '`generate_series(start, stop)` makes up one row for each integer from start to stop. It is a ruler to hold the real data against: `SELECT * FROM generate_series(1, 5);`. To get all the numbers that should exist, use the lowest and the highest cheque number as the two ends.',
      "First pull the number out of the reference: `substr(bank_ref, 4)::int` drops the three letters 'CHQ' (substr counts from 1, so start at 4) and turns the rest into an integer. Check it first: `SELECT substr(bank_ref, 4)::int FROM payments WHERE method = 'CHEQUE' LIMIT 5;`",
      '`EXCEPT` returns the rows of the first query that are not in the second. Put the cheque numbers in a CTE, then: `SELECT n AS cheque_no FROM generate_series(lowest, highest) AS n EXCEPT SELECT cheque_no FROM cheques`. For the two ends use `(SELECT MIN(cheque_no) FROM cheques)` and the same with MAX.',
    ],
    concept: {
      title: 'generate_series and set operations',
      body: [
        "`generate_series(a, b [, step])` is a set-returning function: it makes up rows that are not stored anywhere. It works for numbers and also for dates and timestamps (`generate_series(DATE '2025-12-01', DATE '2025-12-31', INTERVAL '1 day')`). To find gaps, build the list of what should exist, then subtract what does.",
        '`EXCEPT` is the set difference: rows of the first result that are not in the second. `UNION` stacks two results and removes duplicates (`UNION ALL` keeps them) and `INTERSECT` keeps the rows found in both. All of them need the same number of columns with compatible types, and they match columns by position, not by name.',
      ],
      example:
        "-- Which days in the first week of December had no payment at all?\nSELECT d::date AS day\nFROM generate_series(DATE '2025-12-01', DATE '2025-12-07', INTERVAL '1 day') AS d\nEXCEPT\nSELECT payment_date FROM payments\nORDER BY day;",
    },
    pitfalls: [
      "Starting `substr` at 3 keeps the letter 'Q', and the cast to integer fails. `substr(bank_ref, 4)` starts right after 'CHQ'.",
      'Not filtering on method: EFT and BPAY references are not cheque numbers.',
      'Using `NOT IN (subquery)` when the subquery can return NULL: one NULL makes the whole test unknown and nothing is returned. EXCEPT or NOT EXISTS are safer.',
    ],
    solution: `WITH cheques AS (
  SELECT substr(bank_ref, 4)::int AS cheque_no
  FROM payments
  WHERE method = 'CHEQUE'
)
SELECT n AS cheque_no
FROM generate_series((SELECT MIN(cheque_no) FROM cheques),
                     (SELECT MAX(cheque_no) FROM cheques)) AS n
EXCEPT
SELECT cheque_no FROM cheques
ORDER BY cheque_no;`,
    solutionNotes:
      'The same answer can be found with LAG: sort the cheque numbers, compare each with the one before, and report `previous + 1` wherever the difference is more than 1. generate_series is simpler when a gap could be longer than one number.',
    decoyMessages: {},
    starter: `-- First, look at how cheque references are written
SELECT payment_id, payment_date, bank_ref, substr(bank_ref, 4)::int AS cheque_no
FROM payments
WHERE method = 'CHEQUE'
ORDER BY cheque_no
LIMIT 15;`,
  },

  // ───────────────────────────────────────────── 12
  {
    id: 12,
    title: 'Price Creep',
    tagline: 'The price jumps again with the next order',
    level: 5,
    unlockAfterSolved: 2,
    brief: [
      'A buyer notices that the price of one product keeps going up from one order to the next. Prices move a little from order to order (a few percent is normal), but a **jump of more than 10%** over the previous order of the same product from the same vendor needs an explanation.',
      '`po_lines.unit_price` is the agreed price on each order line, and the date and vendor are on the parent purchase order. Compare each line with the **previous order** of the same product from the **same vendor**: not with the list price and not with another vendor.',
    ],
    task: 'Find the order lines whose unit price is more than 10% above the previous order of the same product from the same vendor.',
    answerColumn: 'line_id',
    skills: ['LAG()', 'PARTITION BY several columns', 'Filtering on a window result'],
    hints: [
      '`LAG(column) OVER (PARTITION BY group ORDER BY time)` reads a column from the previous row of the same group; for the first row of a group there is nothing before it, so the result is NULL. Try it: `SELECT po_id, unit_price, LAG(unit_price) OVER (ORDER BY po_id) AS previous FROM po_lines WHERE product_id = 5 LIMIT 10;` (`LEAD` is the same but looks at the next row.)',
      '"The same product from the same vendor" is the group, so it goes in PARTITION BY. The vendor is on the purchase order, so join `po_lines l` to `purchase_orders po` and use `PARTITION BY po.vendor_id, l.product_id ORDER BY po.po_id`. (`po_id` grows with time, so a smaller po_id is an earlier order.)',
      'A window function cannot be used in WHERE, so compute it in a CTE and filter outside: `WITH priced AS (SELECT l.line_id, l.unit_price, LAG(l.unit_price) OVER (…) AS prev_price FROM …) SELECT line_id … FROM priced WHERE unit_price > prev_price * 1.10`. The first order has a NULL prev_price and drops out by itself.',
    ],
    concept: {
      title: 'LAG and LEAD',
      body: [
        '`LAG(x [, n [, default]])` returns x from n rows before the current row inside its window (n defaults to 1, and default to NULL). `LEAD` looks forward instead. They are the tool for "compare each row with the one before it": price changes, days between events, running differences.',
        'The window\'s ORDER BY decides what "before" means, and PARTITION BY restarts the sequence for every group. Forget the PARTITION BY and the first order of one vendor gets compared with the last order of another.',
        '"More than 10% above" is `new > old * 1.10`. Written like this there is no division, so there is no divide-by-zero to worry about either.',
      ],
      example:
        'SELECT po_id, unit_price,\n       LAG(unit_price)  OVER (PARTITION BY product_id ORDER BY po_id) AS previous,\n       LEAD(unit_price) OVER (PARTITION BY product_id ORDER BY po_id) AS next\nFROM po_lines\nWHERE product_id = 5\nORDER BY po_id\nLIMIT 10;',
    },
    pitfalls: [
      'Partitioning by product only: different vendors charge different prices, so a switch from one vendor to another looks like a price rise.',
      'Comparing with the first order or with the list price instead of the order right before it: a series that rises 6% every time never jumps by 10% in one step.',
      'Writing the window function in WHERE: not allowed. Compute it in a CTE or subquery first.',
    ],
    solution: `WITH priced AS (
  SELECT l.line_id,
         po.po_number,
         po.vendor_id,
         l.product_id,
         l.unit_price,
         LAG(l.unit_price) OVER (PARTITION BY po.vendor_id, l.product_id ORDER BY po.po_id) AS prev_price
  FROM po_lines l
  JOIN purchase_orders po ON po.po_id = l.po_id
)
SELECT line_id, po_number, vendor_id, product_id, prev_price, unit_price,
       ROUND(100 * (unit_price - prev_price) / prev_price, 1) AS pct_up
FROM priced
WHERE unit_price > prev_price * 1.10
ORDER BY pct_up DESC;`,
    solutionNotes:
      'The window function is evaluated after WHERE, so the CTE is what makes the comparison possible. The `pct_up` column turns the test into something you can quote: how much the price went up in that one step.',
    decoyMessages: {
      gradual:
        'One of your series rose by 5 to 8% with every order. No single step is above 10%, so it does not meet the rule. Compare each order only with the one right before it.',
      crossVendor: 'You compared prices across different vendors. Every vendor has its own price level, so partition by vendor as well as by product.',
    },
    starter: `-- Look at the price history of one product, vendor by vendor
SELECT po.vendor_id, po.po_number, po.po_date, l.unit_price
FROM po_lines l
JOIN purchase_orders po ON po.po_id = l.po_id
WHERE l.product_id = 5
ORDER BY po.vendor_id, po.po_id
LIMIT 20;`,
  },

  // ───────────────────────────────────────────── 13
  {
    id: 13,
    title: 'Re-issue Loop',
    tagline: 'Cancel it, raise it again, cancel it, raise it again',
    level: 5,
    unlockAfterSolved: 3,
    brief: [
      'A reviewer sees purchase orders that are cancelled and raised again, and again, for the same goods. Each time the approval clock starts over, and an approver rarely looks closely at a PO they have already seen.',
      '`purchase_orders.replaces_po_id` points from a re-issued PO to the earlier PO it replaces (NULL for an ordinary, original PO). A PO that replaces one that itself replaced another forms a **chain**. Re-issuing once or twice happens, for example after a typo in a quantity. A chain of **five or more POs** is a pattern.',
    ],
    task: 'Find the original PO (the first one in the chain) of every chain that has five or more POs.',
    answerColumn: 'po_number',
    skills: ['WITH RECURSIVE', 'Walking a chain of parent and child rows', 'GROUP BY on the result'],
    hints: [
      'A chain of unknown length cannot be followed with a fixed number of self joins. `WITH RECURSIVE` can: it has a starting query (the anchor), then a second query that joins the table to the rows found so far, and it repeats until no new rows appear. Skeleton: `WITH RECURSIVE chain AS (anchor query UNION ALL recursive query that refers to chain) SELECT … FROM chain;`',
      'Anchor: the original POs, so `replaces_po_id IS NULL`; carry their `po_id` as `root`, and `1` as `depth`. Recursive step: `FROM purchase_orders p JOIN chain c ON p.replaces_po_id = c.po_id`, keeping `c.root` and adding 1 to the depth.',
      'Each chain now has one row per PO with its depth. Group by `root` and keep the chains where `MAX(depth) >= 5`, then join `purchase_orders` on `po_id = root` to show the PO number of the original. POs that were never re-issued stay at depth 1 and drop out.',
    ],
    concept: {
      title: 'WITH RECURSIVE',
      body: [
        'A recursive CTE has two parts joined by UNION ALL: the anchor member (it runs once) and the recursive member (it refers to the CTE\'s own name and runs again on the rows found in the previous round, until it returns nothing). It is how SQL walks trees and chains: org charts, bills of material, "replaced by" links.',
        'Carry a `depth` counter or the path along, so that you can tell how far each row is from the start. If the data can contain a loop the recursion never ends; the usual guards are a depth limit (`WHERE depth < 20`) or keeping the visited ids in an array.',
      ],
      example:
        'WITH RECURSIVE reports AS (\n  SELECT emp_id, 1 AS depth\n  FROM employees\n  WHERE manager_id IS NULL\n  UNION ALL\n  SELECT e.emp_id, r.depth + 1\n  FROM employees e\n  JOIN reports r ON e.manager_id = r.emp_id\n)\nSELECT depth, COUNT(*) AS people\nFROM reports\nGROUP BY depth\nORDER BY depth;',
    },
    pitfalls: [
      'Not carrying the root along: you know where each chain ends but no longer where it started.',
      'Counting the rows of the whole CTE instead of grouping by root, so every chain is mixed together.',
      'Starting the anchor from every PO that has a replaces_po_id: the chain then starts in the middle and its length comes out too short.',
    ],
    solution: `WITH RECURSIVE chain AS (
  SELECT po_id AS root, po_id, 1 AS depth
  FROM purchase_orders
  WHERE replaces_po_id IS NULL
  UNION ALL
  SELECT c.root, p.po_id, c.depth + 1
  FROM purchase_orders p
  JOIN chain c ON p.replaces_po_id = c.po_id
)
SELECT po.po_number, MAX(c.depth) AS chain_length
FROM chain c
JOIN purchase_orders po ON po.po_id = c.root
GROUP BY po.po_number
HAVING MAX(c.depth) >= 5
ORDER BY chain_length DESC;`,
    solutionNotes:
      'The anchor takes every original PO, and the recursive step follows the "replaced by" link one hop at a time. After the last hop no PO replaces the previous one, so the recursion stops by itself. The same pattern walks the employee hierarchy through manager_id.',
    decoyMessages: {
      short: 'Some of your chains have only two or three POs. Re-issuing once or twice is common. The rule is five or more POs in the chain.',
    },
    starter: `-- Which POs replaced an earlier one?
SELECT po_id, po_number, replaces_po_id, status
FROM purchase_orders
WHERE replaces_po_id IS NOT NULL
ORDER BY po_id
LIMIT 20;`,
  },

  // ───────────────────────────────────────────── 14
  {
    id: 14,
    title: 'Thin File',
    tagline: 'A vendor form with most of the boxes unticked',
    level: 5,
    unlockAfterSolved: 3,
    brief: [
      'When a vendor is onboarded, Procurement fills in a form. The system stores the whole form as one JSON document in `vendors.profile`: who to contact, the address, which checks were done, and the directors.',
      'A form with **at least two of the three checks not done** (`abn_verified`, `bank_verified`, `site_visit`) is called a thin file. A thin file whose contact email is on a personal email service (`gmail.com`, `outlook.com`, `hotmail.com` or `yahoo.com.au`) is a classic sign of a shell supplier.',
    ],
    task: 'Find the vendors whose form has at least two checks set to false and whose contact email is on one of those four personal email domains.',
    answerColumn: 'vendor_id',
    skills: ['JSONB operators -> and ->>', 'jsonb_each_text', 'split_part'],
    hints: [
      "`->` digs into JSON and returns JSON; `->>` returns text. Chain them to go deeper: `profile -> 'contact' ->> 'email'` is the contact email as text. Try it: `SELECT vendor_name, profile -> 'checks' AS checks, profile -> 'contact' ->> 'email' AS email FROM vendors LIMIT 10;`",
      "`profile -> 'checks'` is a small object of true/false values. `jsonb_each_text(obj)` turns an object into rows of (key, value), so you can count the false ones with a subquery: `(SELECT COUNT(*) FROM jsonb_each_text(v.profile -> 'checks') AS c WHERE c.value = 'false')`. The email domain is the part after the @: `split_part(email, '@', 2)`.",
      "Put both tests in WHERE: the count of false checks `>= 2`, and the domain `IN ('gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com.au')`. For a single check there is a shortcut: `profile @> '{\"checks\": {\"site_visit\": false}}'` is true when the document contains that fragment.",
    ],
    concept: {
      title: 'JSONB: query a document stored in a column',
      body: [
        "`jsonb` keeps a structured document in one column. `->` returns a JSON value (object, array or scalar) and `->>` returns text. Chain them to dig deeper, and cast when you need another type: `(profile -> 'checks' ->> 'site_visit')::boolean`.",
        '`@>` asks "does the left document contain the right one?". `jsonb_each_text(object)` turns an object into (key, value) rows and `jsonb_array_elements_text(array)` turns an array into rows, which is how you count or search inside a document.',
        'JSON is flexible, but it has no column types and no foreign keys. A value that you filter on all the time usually deserves a real column.',
      ],
      example:
        "SELECT vendor_id,\n       profile -> 'contact' ->> 'email' AS email,\n       (profile -> 'checks' ->> 'bank_verified')::boolean AS bank_ok,\n       jsonb_array_length(profile -> 'directors') AS directors\nFROM vendors\nORDER BY vendor_id\nLIMIT 8;",
    },
    pitfalls: [
      'Comparing the result of `->` with a text literal: `->` returns JSON, so use `->>` when you want text.',
      'Counting only one check. The rule needs at least two of the three to be false.',
      "Matching the domain with `LIKE '%gmail%'` and missing the other three personal domains.",
    ],
    solution: `SELECT v.vendor_id,
       v.vendor_name,
       v.profile -> 'contact' ->> 'email' AS email,
       (SELECT COUNT(*) FROM jsonb_each_text(v.profile -> 'checks') AS c WHERE c.value = 'false') AS checks_failed
FROM vendors v
WHERE (SELECT COUNT(*) FROM jsonb_each_text(v.profile -> 'checks') AS c WHERE c.value = 'false') >= 2
  AND split_part(v.profile -> 'contact' ->> 'email', '@', 2)
      IN ('gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com.au')
ORDER BY v.vendor_id;`,
    solutionNotes:
      'The ghost vendors of case 6 all show up here: thin files were their common signature. In a real system you would put this test in a view, so that it is written once and every report agrees on it.',
    decoyMessages: {
      oneCheck: 'Some of your vendors have only one check undone. The rule needs at least two.',
      corporate: 'Some of your vendors have two or more checks undone but use a company email address. Both conditions are required.',
      solo: 'Some of your vendors use a personal email address but had all their checks done. Both conditions are required.',
    },
    starter: `-- Look at the onboarding forms
SELECT vendor_id, vendor_name, profile
FROM vendors
ORDER BY vendor_id
LIMIT 5;`,
  },

  // ───────────────────────────────────────────── 15
  {
    id: 15,
    title: 'Undo the Double Payment',
    tagline: 'Void the duplicates and take their payments back off the books',
    level: 6,
    kind: 'fix',
    unlockAfterSolved: 4,
    brief: [
      'In case 3 you found invoices that were entered twice and paid twice. Now you clean up. The **first entry** of each pair stays: it is the real invoice. The **later copy** has to be marked void, and the payment recorded against it has to be deleted.',
      'This is a hands-on case, so you change data. Your script runs in a transaction that is **rolled back after every run**, so you can try as often as you like and nothing is lost. When you hand in, the game looks at what your script left behind and compares it with what a correct clean-up leaves.',
      'Two invoices are duplicates when they have the same vendor and the same invoice number. An invoice paid in two instalments is not a duplicate, and a duplicate that was already voided needs no change.',
    ],
    task: 'Void the later copy of every duplicate pair and delete the payments recorded against those copies. Leave everything else as it is.',
    answerColumn: 'state',
    skills: ['UPDATE', 'DELETE … USING', 'RETURNING', 'Checking rows before changing them'],
    verify: `SELECT 'void:' || invoice_id AS state FROM invoices WHERE status = 'void'
UNION ALL
SELECT 'payments:' || COUNT(*) FROM payments`,
    hints: [
      "`UPDATE table SET column = value WHERE condition` changes the rows that match, and `RETURNING columns` at the end hands those rows back so you can see what you did: `UPDATE invoices SET status = 'void' WHERE invoice_id = 123 RETURNING invoice_id, status;`. Write the WHERE first: an UPDATE without one changes every row.",
      'First identify the later copies with a plain SELECT and look at the rows before you change anything. A later copy shares vendor and invoice number with an earlier invoice, so its id is larger than the smallest id of its group: `SELECT i.invoice_id FROM invoices i WHERE i.invoice_id > (SELECT MIN(j.invoice_id) FROM invoices j WHERE j.vendor_id = i.vendor_id AND j.invoice_number = i.invoice_number);`',
      "Use that list in an UPDATE: `UPDATE invoices SET status = 'void' WHERE invoice_id IN (…) RETURNING invoice_id;`. Then remove their payments: `DELETE FROM payments WHERE invoice_id IN (…) RETURNING payment_id, invoice_id, amount;` (or `DELETE FROM payments p USING invoices i WHERE p.invoice_id = i.invoice_id AND i.status = 'void'`). Put both statements in one script, separated by a semicolon.",
    ],
    concept: {
      title: 'UPDATE, DELETE and RETURNING',
      body: [
        '`UPDATE t SET col = expr [FROM other] WHERE …` changes existing rows, `DELETE FROM t [USING other] WHERE …` removes them, and `INSERT INTO t …` adds rows. All three can end with `RETURNING`, which hands back the affected rows (any columns, even expressions), so you can see exactly what happened.',
        'The WHERE clause is what protects the rest of the table. A good habit is to write it as a SELECT first, look at the rows, and only then turn the SELECT into an UPDATE or DELETE. In a real database you would also wrap the change in BEGIN … COMMIT and check the result before committing; this game always rolls back for you.',
        'Foreign keys protect you from some mistakes: a row that another table still refers to cannot be deleted. Payments sit at the end of the chain, so they can be deleted. Invoices cannot be deleted while payments refer to them, and an audit trail should keep voided invoices anyway.',
      ],
      example:
        "-- Try it on one row; the change is rolled back afterwards\nUPDATE invoices\nSET status = 'disputed'\nWHERE invoice_id = 1\nRETURNING invoice_id, invoice_number, status;",
    },
    pitfalls: [
      'Voiding the first entry instead of the later copy. The first entry is the real invoice.',
      'Matching on invoice number alone: other vendors can use the same number, and instalment invoices are not duplicates. Match vendor and number.',
      'Deleting from `invoices` instead of voiding. The foreign key from payments refuses it, and the audit trail should keep the voided invoice.',
      'Voiding the copy but leaving its payment, or deleting payments without voiding. The clean-up has two halves.',
    ],
    solution: `-- later copies: same vendor and invoice number as an earlier invoice
UPDATE invoices i
SET status = 'void'
WHERE i.invoice_id > (SELECT MIN(j.invoice_id)
                      FROM invoices j
                      WHERE j.vendor_id = i.vendor_id
                        AND j.invoice_number = i.invoice_number)
RETURNING i.invoice_id, i.invoice_number, i.status;

-- the payments recorded against voided invoices
DELETE FROM payments p
USING invoices i
WHERE p.invoice_id = i.invoice_id
  AND i.status = 'void'
RETURNING p.payment_id, p.invoice_id, p.amount;`,
    solutionNotes:
      'Two stages: identify, then change. The DELETE sees the status written by the UPDATE because both run in the same transaction. Voided duplicates that already existed have no payments, so the DELETE leaves them alone. The RETURNING output of the DELETE is the amount you can claim back.',
    decoyMessages: {
      original: 'You voided the first entry of a pair. The first entry is the real invoice; the later copy is the duplicate.',
      instalment:
        'You voided an invoice that was paid in two instalments. Two payments on one invoice is not a duplicate: duplicates are separate invoices with the same vendor and number.',
      '*missing':
        'Part of the clean-up is missing. After your script every later copy must be void and the payments recorded against those copies must be gone.',
      '*extra':
        'Your script changed something it should not have: an invoice was voided that should not be, or more payments were deleted than belong to the copies.',
    },
    verifyHelp: 'The check reads invoices and payments after your script ran.',
    starter: `-- First, look at the pairs. Which invoices share a vendor and an invoice number?
SELECT vendor_id, invoice_number, COUNT(*) AS entries,
       string_agg(invoice_id::text || ' (' || status || ')', ', ' ORDER BY invoice_id) AS invoices
FROM invoices
GROUP BY vendor_id, invoice_number
HAVING COUNT(*) > 1;`,
  },

  // ───────────────────────────────────────────── 16
  {
    id: 16,
    title: 'The Watchlist',
    tagline: 'Add the inactive vendors, some of them are already listed',
    level: 6,
    kind: 'fix',
    unlockAfterSolved: 4,
    brief: [
      'Compliance keeps a short list of vendors that need extra scrutiny: the table `vendor_watchlist`, one row per vendor. Look at it first; it is small.',
      'Every vendor whose status is **inactive** has to be on the list with the reason `Inactive vendor, do not use` and the date `2025-12-31`. Some of them may already be on the list under an older reason: for those, replace the reason and the date. Do not add a second row (`vendor_id` is the primary key, so PostgreSQL would refuse). Vendors on the list for other reasons are not your business: leave them exactly as they are.',
      'Your script runs in a transaction that is rolled back after every run, so you can try as often as you like.',
    ],
    task: 'Add every inactive vendor to the watchlist with the new reason and date, updating the row where the vendor is already listed.',
    answerColumn: 'state',
    skills: ['INSERT … SELECT', 'ON CONFLICT DO UPDATE (upsert)', 'EXCLUDED', 'RETURNING'],
    verify: `SELECT vendor_id || ':' || reason || ':' || listed_on AS state FROM vendor_watchlist`,
    hints: [
      '`INSERT INTO table (columns) VALUES (…)` adds one row, and `INSERT INTO table (columns) SELECT …` adds every row that the query returns. Try a plain insert for a vendor that is already listed and read the error: `duplicate key value violates unique constraint`. That error is what the next hint removes.',
      '`ON CONFLICT (vendor_id) DO UPDATE SET reason = EXCLUDED.reason` turns that error into an update. `EXCLUDED` is the row you tried to insert. `ON CONFLICT … DO NOTHING` would keep the old row untouched, which is not what we want here because the old reason has to be replaced.',
      "Shape of the full statement: `INSERT INTO vendor_watchlist (vendor_id, reason, listed_on) SELECT vendor_id, 'Inactive vendor, do not use', DATE '2025-12-31' FROM vendors WHERE status = 'inactive' ON CONFLICT (vendor_id) DO UPDATE SET reason = …, listed_on = … RETURNING *;` Fill in what the update should take from EXCLUDED.",
    ],
    concept: {
      title: 'INSERT … ON CONFLICT (upsert)',
      body: [
        'An upsert means "insert, or update if it already exists". PostgreSQL spells it `INSERT … ON CONFLICT (key) DO UPDATE SET …`. The conflict target is a unique column or the primary key, and `EXCLUDED.column` refers to the value you tried to insert.',
        '`DO NOTHING` skips the conflicting rows instead of updating them, which is useful for "add the missing ones only". You can add a `WHERE` to `DO UPDATE` so that it updates only when something actually changes.',
        'The whole statement is atomic. Two people running it at the same time cannot create a duplicate, which is not true of the pattern "SELECT, then decide, then INSERT or UPDATE" written in application code.',
      ],
      example:
        "-- Try it: list vendor 1, then list it again under another reason\nINSERT INTO vendor_watchlist (vendor_id, reason, listed_on)\nVALUES (1, 'Under review', DATE '2025-12-31')\nON CONFLICT (vendor_id) DO UPDATE\nSET reason = EXCLUDED.reason, listed_on = EXCLUDED.listed_on\nRETURNING *;",
    },
    pitfalls: [
      'A plain INSERT: it fails on the first vendor that is already listed, and nothing is added at all.',
      "`ON CONFLICT DO NOTHING`: the old reason ('Late deliveries') stays, so the row is not what the policy requires.",
      'Emptying the table and inserting again: the vendors that were listed for other reasons disappear.',
      'Typing the reason or the date slightly differently. The check compares them exactly.',
    ],
    solution: `INSERT INTO vendor_watchlist (vendor_id, reason, listed_on)
SELECT vendor_id, 'Inactive vendor, do not use', DATE '2025-12-31'
FROM vendors
WHERE status = 'inactive'
ON CONFLICT (vendor_id) DO UPDATE
SET reason    = EXCLUDED.reason,
    listed_on = EXCLUDED.listed_on
RETURNING vendor_id, reason, listed_on;`,
    solutionNotes:
      'One statement does both jobs: new vendors are inserted and listed vendors are updated. RETURNING shows the final row for every inactive vendor, whichever path it took.',
    decoyMessages: {
      stale: 'A vendor is still listed under its old reason. `ON CONFLICT … DO NOTHING` keeps the old row; use `DO UPDATE` to replace the reason and the date.',
      '*missing':
        'The watchlist is not what it should be yet: every inactive vendor needs the new reason and date, and vendors listed for other reasons must stay exactly as they were.',
      '*extra': 'A row on the list has the wrong content. Check the reason text and the date, and make sure you did not change vendors that are not inactive.',
    },
    verifyHelp: 'The check reads vendor_watchlist after your script ran.',
    starter: `-- First, what is on the watchlist right now?
SELECT w.vendor_id, v.vendor_name, v.status, w.reason, w.listed_on
FROM vendor_watchlist w
JOIN vendors v ON v.vendor_id = w.vendor_id;`,
  },

  // ───────────────────────────────────────────── 17
  {
    id: 17,
    title: 'Latest per Vendor',
    tagline: "Keep each vendor's newest invoice in a table of its own",
    level: 6,
    kind: 'fix',
    unlockAfterSolved: 4,
    brief: [
      'Finance wants a quick lookup of the most recent posted invoice of every vendor, to see who has gone quiet. They want it as a real table, not a query, so that it can be exported and indexed.',
      'Create a table named `vendor_last_invoice` with the columns `vendor_id`, `invoice_id`, `invoice_date` and `amount`. It holds one row for each vendor that has at least one **posted** invoice: the one with the latest `invoice_date` (if two share a date, the one with the higher `invoice_id`). Then make `vendor_id` the primary key of the table.',
      'Your script runs in a transaction that is rolled back after every run, so you can try as often as you like.',
    ],
    task: 'Build vendor_last_invoice with one row per vendor, holding its newest posted invoice, and make vendor_id its primary key.',
    answerColumn: 'state',
    skills: ['DISTINCT ON', 'CREATE TABLE … AS SELECT', 'ALTER TABLE … ADD PRIMARY KEY'],
    verify: `SELECT vendor_id || ':' || invoice_id AS state FROM vendor_last_invoice
UNION ALL
SELECT 'pk' WHERE EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.vendor_last_invoice'::regclass AND contype = 'p')`,
    hints: [
      '`SELECT DISTINCT ON (vendor_id) …` keeps only the first row of each vendor. "First" is decided by ORDER BY, which must start with the same column: `ORDER BY vendor_id, invoice_date DESC, invoice_id DESC` puts each vendor\'s newest invoice first. (Without DESC you would get the oldest.)',
      "`CREATE TABLE new_table AS SELECT …` creates a table from the result of a query, with the same column names and types. Filter `status = 'posted'` in the WHERE, so that voided and disputed invoices can never be chosen.",
      'A table made with CREATE TABLE AS has no keys. Add one afterwards with a second statement: `ALTER TABLE vendor_last_invoice ADD PRIMARY KEY (vendor_id);`. The key also proves that there is exactly one row per vendor: PostgreSQL would refuse it if there were duplicates.',
    ],
    concept: {
      title: 'DISTINCT ON, CREATE TABLE AS and ALTER TABLE',
      body: [
        '`DISTINCT ON (a, b)` is a PostgreSQL extension that keeps the first row for each (a, b). It is the shortest way to say "the latest row per group". The standard alternative is `ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)` and keeping row 1.',
        '`CREATE TABLE t AS SELECT …` builds and fills a table in one statement. `ALTER TABLE` changes a table that exists: `ADD COLUMN`, `DROP COLUMN`, `ADD PRIMARY KEY (…)`, `ADD CONSTRAINT … CHECK (…)`, `RENAME TO`. Constraints are how a database protects itself from bad data.',
      ],
      example:
        "SELECT DISTINCT ON (vendor_id)\n       vendor_id, invoice_id, invoice_date, amount\nFROM invoices\nWHERE status = 'posted'\nORDER BY vendor_id, invoice_date DESC, invoice_id DESC\nLIMIT 8;",
    },
    pitfalls: [
      'An ORDER BY that does not start with the DISTINCT ON column: PostgreSQL refuses it.',
      'Sorting the date ascending: you get the first invoice of each vendor, not the last.',
      'Forgetting the status filter: a voided or disputed invoice can be the newest one of a vendor.',
      'Forgetting the primary key. It is part of the task, and the check looks for it.',
    ],
    solution: `CREATE TABLE vendor_last_invoice AS
SELECT DISTINCT ON (vendor_id)
       vendor_id, invoice_id, invoice_date, amount
FROM invoices
WHERE status = 'posted'
ORDER BY vendor_id, invoice_date DESC, invoice_id DESC;

ALTER TABLE vendor_last_invoice ADD PRIMARY KEY (vendor_id);`,
    solutionNotes:
      'DISTINCT ON does the grouping and the picking in one step, and the ORDER BY decides which row of each group survives. The primary key is added last, because a key on the result would otherwise have to be declared before the table has its rows.',
    decoyMessages: {
      oldest:
        "Some rows hold a vendor's oldest invoice. DISTINCT ON keeps the first row of each group in your ORDER BY, so sort the invoice date descending (newest first).",
      '*missing':
        'The table is not complete yet. Check that it has one row for every vendor with a posted invoice, holding the newest one, and that vendor_id is the primary key.',
      '*extra': 'The table has rows that should not be there. Only posted invoices count, one per vendor.',
    },
    verifyHelp:
      'The check reads the table vendor_last_invoice. Make sure your script creates it, with the columns vendor_id, invoice_id, invoice_date and amount.',
    starter: `-- First, look at one vendor's invoices, newest first
SELECT vendor_id, invoice_id, invoice_date, status, amount
FROM invoices
WHERE vendor_id = 1
ORDER BY invoice_date DESC, invoice_id DESC;`,
  },

  // ───────────────────────────────────────────── 18
  {
    id: 18,
    title: 'Slow Report',
    tagline: 'The payments-by-date report reads the whole table',
    level: 6,
    kind: 'fix',
    unlockAfterSolved: 4,
    brief: [
      'The month-end report lists the payments made in a date range, and finance says it is slow. Before changing anything, ask PostgreSQL how it plans to run the query: `EXPLAIN` shows the plan without running the query.',
      "The report is `SELECT * FROM payments WHERE payment_date BETWEEN DATE '2025-03-01' AND DATE '2025-03-07'`. Run EXPLAIN on it first. If the plan says **Seq Scan**, PostgreSQL reads every row of the table to find the few that match. An index on the filter column lets it jump straight to them.",
      'Your script runs in a transaction that is rolled back after every run, so you can try as often as you like. In one script you can run EXPLAIN, create the index, and run EXPLAIN again to compare the two plans.',
    ],
    task: 'Create an index on payments whose first column is payment_date, and show with a second EXPLAIN that the report can use it.',
    answerColumn: 'state',
    skills: ['EXPLAIN', 'CREATE INDEX', 'Reading a query plan'],
    verify: `SELECT 'indexed' AS state
WHERE EXISTS (
  SELECT 1
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
  WHERE t.relname = 'payments' AND a.attname = 'payment_date')`,
    hints: [
      "Put `EXPLAIN` in front of any query to see the plan instead of the rows: `EXPLAIN SELECT * FROM payments WHERE payment_date BETWEEN DATE '2025-03-01' AND DATE '2025-03-07';`. Read the lines from the most indented one outwards. `Seq Scan on payments` means the whole table is read; `Index Scan` or `Bitmap Index Scan` means an index is used.",
      '`CREATE INDEX index_name ON table (column)` builds an index. Give it a name that says what it is for, such as `idx_payments_date`. Then run the same EXPLAIN again and compare. An index on `invoice_id` already exists, but it does not help a filter on dates.',
      'The index has to start with `payment_date` (more columns after it are allowed). `EXPLAIN ANALYZE` really runs the query and adds real timings, while plain `EXPLAIN` only estimates. If the second plan still shows a Seq Scan, the filter matches so much of the table that PostgreSQL thinks reading it all is cheaper; the narrow March week should use the index.',
    ],
    concept: {
      title: 'EXPLAIN and indexes',
      body: [
        '`EXPLAIN` shows the plan the optimizer chose, with estimated rows and cost. `EXPLAIN ANALYZE` runs the query and adds real times and row counts. A **Seq Scan** reads the whole table, an **Index Scan** follows an index to the matching rows, and a **Bitmap Heap Scan** first collects the matches from an index and then reads the table pages in order.',
        'An index is a sorted copy of one or more columns that points back to the rows. It makes lookups and range filters fast and makes writes slightly slower. PostgreSQL decides for itself whether to use an index: for a query that matches most of the table a Seq Scan is cheaper, so an index that is not used is not a bug.',
      ],
      example: 'EXPLAIN\nSELECT * FROM payments\nWHERE invoice_id = 100;',
    },
    pitfalls: [
      'Creating the index on another table or on another column. The check looks for an index on payments that starts with payment_date.',
      'Expecting an index to be used for every query. A filter that matches most of the table still gets a Seq Scan.',
      'Wrapping the column in a function in the query (`WHERE payment_date::text …`), which stops a plain index from being used.',
    ],
    solution: `EXPLAIN
SELECT * FROM payments
WHERE payment_date BETWEEN DATE '2025-03-01' AND DATE '2025-03-07';

CREATE INDEX idx_payments_date ON payments (payment_date);

EXPLAIN
SELECT * FROM payments
WHERE payment_date BETWEEN DATE '2025-03-01' AND DATE '2025-03-07';`,
    solutionNotes:
      'Compare the two plans in the results: the first reads the whole table, the second goes through the new index. Indexes cost space and slow down writes a little, so create them for queries that are really run often.',
    decoyMessages: {
      '*missing': 'No index on payments starts with payment_date yet. Create one with CREATE INDEX … ON payments (payment_date).',
    },
    verifyHelp: 'The check looks at the indexes of the payments table after your script ran.',
    starter: `-- First, how does PostgreSQL plan to run the report?
EXPLAIN
SELECT * FROM payments
WHERE payment_date BETWEEN DATE '2025-03-01' AND DATE '2025-03-07';`,
  },
];
