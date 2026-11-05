/**
 * The single source of truth for the database layout.
 * The DDL, the in-game "table browser" comments, the Excel data dictionary and the
 * README ERD are all derived from this file, so they can never disagree.
 */

export type TableName =
  | 'departments'
  | 'employees'
  | 'vendors'
  | 'products'
  | 'purchase_orders'
  | 'po_lines'
  | 'goods_receipts'
  | 'invoices'
  | 'payments'
  | 'po_audit_log'
  | 'inventory_movements'
  | 'vendor_watchlist';

export interface ColDef {
  name: string;
  type: string;
  notNull?: boolean;
  pk?: boolean;
  unique?: boolean;
  /** e.g. "employees(emp_id)" */
  fk?: string;
  check?: string;
  /** GENERATED ALWAYS AS (…) STORED expression — such columns are never inserted. */
  generated?: string;
  comment: string;
}

export interface TableDef {
  name: TableName;
  comment: string;
  columns: ColDef[];
  /** Created after the bulk load, which is faster and lets ANALYZE see them. */
  indexes?: string[];
}

export const TABLES: TableDef[] = [
  {
    name: 'departments',
    comment: 'Department master',
    columns: [
      { name: 'dept_id', type: 'SMALLINT', pk: true, comment: 'Department ID' },
      { name: 'dept_name', type: 'TEXT', notNull: true, unique: true, comment: 'Department name' },
      { name: 'cost_center', type: 'TEXT', notNull: true, unique: true, comment: 'Cost centre code' },
    ],
  },
  {
    name: 'employees',
    comment: 'Employee master (manager_id points to the direct manager in this same table; the CEO has none)',
    columns: [
      { name: 'emp_id', type: 'INTEGER', pk: true, comment: 'Employee ID' },
      { name: 'full_name', type: 'TEXT', notNull: true, comment: 'Full name' },
      { name: 'email', type: 'TEXT', notNull: true, unique: true, comment: 'Company email' },
      { name: 'dept_id', type: 'SMALLINT', notNull: true, fk: 'departments(dept_id)', comment: 'Department' },
      { name: 'title', type: 'TEXT', notNull: true, comment: 'Job title' },
      { name: 'manager_id', type: 'INTEGER', fk: 'employees(emp_id)', comment: 'emp_id of the direct manager (NULL for the CEO)' },
      { name: 'hire_date', type: 'DATE', notNull: true, comment: 'Hire date' },
      { name: 'status', type: 'TEXT', notNull: true, check: "status IN ('active','terminated')", comment: 'Employment status: active / terminated' },
      { name: 'bank_account', type: 'TEXT', notNull: true, comment: 'Payroll bank account (BSB + account number, 14 digits)' },
    ],
  },
  {
    name: 'vendors',
    comment: 'Vendor master',
    columns: [
      { name: 'vendor_id', type: 'INTEGER', pk: true, comment: 'Vendor ID' },
      { name: 'vendor_name', type: 'TEXT', notNull: true, unique: true, comment: 'Vendor name' },
      { name: 'country', type: 'CHAR(2)', notNull: true, comment: 'Country code (ISO 3166-1 alpha-2)' },
      { name: 'category', type: 'TEXT', notNull: true, comment: 'Main supply category' },
      { name: 'payment_terms_days', type: 'SMALLINT', notNull: true, comment: 'Payment terms in days (counted from the invoice date)' },
      { name: 'bank_account', type: 'TEXT', notNull: true, comment: 'Vendor bank account (formats vary: may contain hyphens or spaces)' },
      { name: 'tax_id', type: 'TEXT', notNull: true, comment: 'Tax ID (ABN format)' },
      { name: 'status', type: 'TEXT', notNull: true, check: "status IN ('active','inactive')", comment: 'Relationship status' },
      { name: 'onboarded_by', type: 'INTEGER', notNull: true, fk: 'employees(emp_id)', comment: 'Set up by (employee)' },
      { name: 'onboarded_on', type: 'DATE', notNull: true, comment: 'Set-up date' },
      {
        name: 'profile',
        type: 'JSONB',
        notNull: true,
        comment:
          'Onboarding form as JSON: contact {name, email, phone}, address {line1, city, state}, checks {abn_verified, bank_verified, site_visit}, directors [names]',
      },
    ],
  },
  {
    name: 'products',
    comment: 'Product master',
    columns: [
      { name: 'product_id', type: 'INTEGER', pk: true, comment: 'Product ID' },
      { name: 'sku', type: 'TEXT', notNull: true, unique: true, comment: 'SKU' },
      { name: 'product_name', type: 'TEXT', notNull: true, comment: 'Product name' },
      { name: 'category', type: 'TEXT', notNull: true, comment: 'Category (matches vendors.category)' },
      { name: 'unit', type: 'TEXT', notNull: true, comment: 'Unit of measure' },
      { name: 'list_price', type: 'NUMERIC(12,2)', notNull: true, comment: 'List price (AUD)' },
    ],
  },
  {
    name: 'purchase_orders',
    comment: 'Purchase order header (all amounts in AUD)',
    columns: [
      { name: 'po_id', type: 'INTEGER', pk: true, comment: 'Internal PO ID' },
      { name: 'po_number', type: 'TEXT', notNull: true, unique: true, comment: 'PO number (as shown to people)' },
      { name: 'vendor_id', type: 'INTEGER', notNull: true, fk: 'vendors(vendor_id)', comment: 'Vendor' },
      { name: 'dept_id', type: 'SMALLINT', notNull: true, fk: 'departments(dept_id)', comment: 'Requesting department' },
      { name: 'requested_by', type: 'INTEGER', notNull: true, fk: 'employees(emp_id)', comment: 'Requested by' },
      { name: 'approved_by', type: 'INTEGER', notNull: true, fk: 'employees(emp_id)', comment: 'Approved by' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, comment: 'Created at' },
      { name: 'po_date', type: 'DATE', generated: 'created_at::date', comment: 'PO date (a generated column derived from created_at)' },
      { name: 'approved_at', type: 'TIMESTAMP', notNull: true, comment: 'Approved at' },
      { name: 'total_amount', type: 'NUMERIC(12,2)', notNull: true, check: 'total_amount > 0', comment: 'PO total = sum of line_amount in po_lines' },
      {
        name: 'status',
        type: 'TEXT',
        notNull: true,
        check: "status IN ('open','received','closed','cancelled')",
        comment: 'open = not yet received / received = received, not invoiced / closed = invoiced / cancelled',
      },
      {
        name: 'replaces_po_id',
        type: 'INTEGER',
        fk: 'purchase_orders(po_id)',
        comment: "If this PO was raised to replace an earlier (cancelled) one, that PO's po_id; NULL for an original PO",
      },
    ],
    indexes: [
      'CREATE INDEX idx_po_vendor ON purchase_orders (vendor_id)',
      'CREATE INDEX idx_po_requested_by ON purchase_orders (requested_by)',
      'CREATE INDEX idx_po_po_date ON purchase_orders (po_date)',
    ],
  },
  {
    name: 'po_lines',
    comment: 'Purchase order lines',
    columns: [
      { name: 'line_id', type: 'INTEGER', pk: true, comment: 'Line ID' },
      { name: 'po_id', type: 'INTEGER', notNull: true, fk: 'purchase_orders(po_id)', comment: 'Parent purchase order' },
      { name: 'line_no', type: 'SMALLINT', notNull: true, comment: 'Line number within the PO' },
      { name: 'product_id', type: 'INTEGER', notNull: true, fk: 'products(product_id)', comment: 'Product' },
      { name: 'qty', type: 'INTEGER', notNull: true, check: 'qty > 0', comment: 'Quantity ordered' },
      { name: 'unit_price', type: 'NUMERIC(12,2)', notNull: true, comment: 'Agreed unit price' },
      { name: 'line_amount', type: 'NUMERIC(12,2)', generated: 'qty * unit_price', comment: 'Line amount (generated column: qty × unit_price)' },
    ],
    indexes: ['CREATE INDEX idx_lines_po ON po_lines (po_id)', 'CREATE INDEX idx_lines_product ON po_lines (product_id)'],
  },
  {
    name: 'goods_receipts',
    comment: 'Goods receipts: a line can arrive in batches, so one po_line_id can have several rows',
    columns: [
      { name: 'gr_id', type: 'INTEGER', pk: true, comment: 'Receipt ID' },
      { name: 'po_line_id', type: 'INTEGER', notNull: true, fk: 'po_lines(line_id)', comment: 'Matching PO line' },
      { name: 'received_qty', type: 'INTEGER', notNull: true, check: 'received_qty > 0', comment: 'Quantity received this time' },
      { name: 'received_date', type: 'DATE', notNull: true, comment: 'Receipt date' },
      { name: 'received_by', type: 'INTEGER', notNull: true, fk: 'employees(emp_id)', comment: 'Received by' },
    ],
    indexes: ['CREATE INDEX idx_gr_line ON goods_receipts (po_line_id)'],
  },
  {
    name: 'invoices',
    comment: 'Vendor invoices. Note: the system has no unique constraint on (vendor_id, invoice_number)',
    columns: [
      { name: 'invoice_id', type: 'INTEGER', pk: true, comment: 'Internal invoice ID (order of entry)' },
      { name: 'invoice_number', type: 'TEXT', notNull: true, comment: 'Invoice number printed by the vendor' },
      { name: 'vendor_id', type: 'INTEGER', notNull: true, fk: 'vendors(vendor_id)', comment: 'Vendor' },
      { name: 'po_id', type: 'INTEGER', notNull: true, fk: 'purchase_orders(po_id)', comment: 'Matching purchase order' },
      { name: 'invoice_date', type: 'DATE', notNull: true, comment: 'Invoice date' },
      { name: 'due_date', type: 'DATE', notNull: true, comment: 'Due date (invoice date + payment terms)' },
      { name: 'amount', type: 'NUMERIC(12,2)', notNull: true, check: 'amount > 0', comment: 'Invoice amount' },
      {
        name: 'status',
        type: 'TEXT',
        notNull: true,
        check: "status IN ('posted','disputed','void')",
        comment: 'posted = booked / disputed = under dispute / void = cancelled',
      },
      { name: 'entered_by', type: 'INTEGER', notNull: true, fk: 'employees(emp_id)', comment: 'Entered by (accounts payable)' },
      { name: 'notes', type: 'TEXT', comment: 'Free-text note typed by the clerk when booking the invoice (usually empty)' },
    ],
    indexes: [
      'CREATE INDEX idx_inv_po ON invoices (po_id)',
      'CREATE INDEX idx_inv_vendor_number ON invoices (vendor_id, invoice_number)',
      'CREATE INDEX idx_inv_due ON invoices (due_date)',
    ],
  },
  {
    name: 'payments',
    comment: 'Payments: an invoice can be paid in instalments, so one invoice_id can have several rows',
    columns: [
      { name: 'payment_id', type: 'INTEGER', pk: true, comment: 'Payment ID' },
      { name: 'invoice_id', type: 'INTEGER', notNull: true, fk: 'invoices(invoice_id)', comment: 'Matching invoice' },
      { name: 'payment_date', type: 'DATE', notNull: true, comment: 'Payment date' },
      { name: 'amount', type: 'NUMERIC(12,2)', notNull: true, check: 'amount > 0', comment: 'Amount paid this time' },
      { name: 'method', type: 'TEXT', notNull: true, check: "method IN ('EFT','BPAY','CHEQUE')", comment: 'Payment method' },
      { name: 'paid_by', type: 'INTEGER', notNull: true, fk: 'employees(emp_id)', comment: 'Paid by (employee)' },
      { name: 'bank_ref', type: 'TEXT', notNull: true, comment: 'Bank reference (EFT… / BPY… / CHQ + cheque number, cheques are numbered in sequence)' },
    ],
    indexes: ['CREATE INDEX idx_pay_invoice ON payments (invoice_id)'],
  },
  {
    name: 'po_audit_log',
    comment: 'Change log for purchase order fields (old and new values are stored as text)',
    columns: [
      { name: 'log_id', type: 'INTEGER', pk: true, comment: 'Log entry ID' },
      { name: 'po_id', type: 'INTEGER', notNull: true, fk: 'purchase_orders(po_id)', comment: 'Changed purchase order' },
      { name: 'changed_by', type: 'INTEGER', notNull: true, fk: 'employees(emp_id)', comment: 'Changed by' },
      { name: 'changed_at', type: 'TIMESTAMP', notNull: true, comment: 'Changed at' },
      { name: 'field_name', type: 'TEXT', notNull: true, comment: 'Field that was changed: total_amount / delivery_date / ship_to' },
      { name: 'old_value', type: 'TEXT', comment: 'Old value (text)' },
      { name: 'new_value', type: 'TEXT', comment: 'New value (text)' },
    ],
    indexes: ['CREATE INDEX idx_audit_po ON po_audit_log (po_id)'],
  },
  {
    name: 'inventory_movements',
    comment: 'Stock movement ledger. qty is a signed movement; balance_after is the balance the system recorded after it',
    columns: [
      { name: 'movement_id', type: 'INTEGER', pk: true, comment: 'Movement ID (increases over time)' },
      { name: 'product_id', type: 'INTEGER', notNull: true, fk: 'products(product_id)', comment: 'Product' },
      { name: 'movement_date', type: 'DATE', notNull: true, comment: 'Movement date (there can be several on one day)' },
      {
        name: 'movement_type',
        type: 'TEXT',
        notNull: true,
        check: "movement_type IN ('OPENING','RECEIPT','ISSUE','ADJUST')",
        comment: 'OPENING = opening balance / RECEIPT = goods in / ISSUE = goods out / ADJUST = stock-take adjustment',
      },
      { name: 'qty', type: 'INTEGER', notNull: true, comment: 'Quantity moved (positive in, negative out)' },
      { name: 'balance_after', type: 'INTEGER', notNull: true, check: 'balance_after >= 0', comment: 'Balance recorded by the system after the movement' },
      { name: 'ref_type', type: 'TEXT', comment: 'Source document type: GR = goods receipt / SO = sales shipment (external system) / ST = stock-take' },
      { name: 'ref_id', type: 'INTEGER', comment: 'Source document ID (GR = goods_receipts.gr_id; SO = external system number; NULL for OPENING and ST)' },
    ],
    indexes: ['CREATE INDEX idx_inv_mov_product ON inventory_movements (product_id, movement_id)'],
  },
  {
    name: 'vendor_watchlist',
    comment: 'Compliance watchlist: vendors that need extra scrutiny (one row per vendor)',
    columns: [
      { name: 'vendor_id', type: 'INTEGER', pk: true, fk: 'vendors(vendor_id)', comment: 'Vendor on the list' },
      { name: 'reason', type: 'TEXT', notNull: true, comment: 'Why the vendor is on the list' },
      { name: 'listed_on', type: 'DATE', notNull: true, comment: 'Date the vendor was listed or last updated' },
    ],
  },
];

/** Tables in foreign-key dependency order (parents first). */
export const LOAD_ORDER: TableName[] = [
  'departments',
  'employees',
  'vendors',
  'products',
  'purchase_orders',
  'po_lines',
  'goods_receipts',
  'invoices',
  'payments',
  'po_audit_log',
  'inventory_movements',
  'vendor_watchlist',
];

export function tableDef(name: TableName): TableDef {
  const t = TABLES.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown table ${name}`);
  return t;
}

/** Columns that take part in INSERT (generated columns are computed by PostgreSQL). */
export function insertColumns(name: TableName): string[] {
  return tableDef(name)
    .columns.filter((c) => !c.generated)
    .map((c) => c.name);
}

function columnDdl(c: ColDef): string {
  const parts = [c.name, c.type];
  if (c.generated) parts.push(`GENERATED ALWAYS AS (${c.generated}) STORED`);
  if (c.pk) parts.push('PRIMARY KEY');
  if (c.notNull && !c.pk && !c.generated) parts.push('NOT NULL');
  if (c.unique) parts.push('UNIQUE');
  if (c.fk) parts.push(`REFERENCES ${c.fk}`);
  if (c.check) parts.push(`CHECK (${c.check})`);
  return '  ' + parts.join(' ');
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function createTablesSql(): string {
  const out: string[] = [];
  for (const t of TABLES) {
    out.push(`CREATE TABLE ${t.name} (\n${t.columns.map(columnDdl).join(',\n')}\n);`);
  }
  for (const t of TABLES) {
    out.push(`COMMENT ON TABLE ${t.name} IS ${sqlStr(t.comment)};`);
    for (const c of t.columns) out.push(`COMMENT ON COLUMN ${t.name}.${c.name} IS ${sqlStr(c.comment)};`);
  }
  return out.join('\n');
}

export function createIndexesSql(): string {
  return TABLES.flatMap((t) => t.indexes ?? []).join(';\n') + ';\nANALYZE;';
}
