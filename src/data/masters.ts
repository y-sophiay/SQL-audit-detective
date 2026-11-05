import { parseCsv } from './csv';

export interface DeptMaster {
  deptId: number;
  name: string;
  costCenter: string;
  headcount: number;
  buys: string[];
  poWeight: number;
  staffTitles: string[];
}
export interface ProductMaster {
  sku: string;
  name: string;
  category: string;
  unit: string;
  listPriceC: number; // cents
}
export interface VendorMaster {
  name: string;
  country: string;
  category: string;
  termsDays: number;
  ghostPool: boolean;
}
export interface Masters {
  departments: DeptMaster[];
  products: ProductMaster[];
  vendors: VendorMaster[];
  firstNames: string[];
  lastNames: string[];
}
export interface MasterCsv {
  departments: string;
  products: string;
  vendors: string;
  firstNames: string;
  lastNames: string;
}

const num = (v: string, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Master data column ${what} is not a number: “${v}”`);
  return n;
};
const list = (v: string) =>
  v
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);

/** Parse + validate the Excel-editable master CSV files. Throws a readable error on bad data. */
export function parseMasters(csv: MasterCsv): Masters {
  const departments = parseCsv(csv.departments).map((r) => ({
    deptId: num(r.dept_id, 'dept_id'),
    name: r.dept_name,
    costCenter: r.cost_center,
    headcount: num(r.headcount, 'headcount'),
    buys: list(r.buys_categories),
    poWeight: num(r.po_weight, 'po_weight'),
    staffTitles: list(r.staff_titles),
  }));
  const products = parseCsv(csv.products).map((r) => ({
    sku: r.sku,
    name: r.product_name,
    category: r.category,
    unit: r.unit,
    listPriceC: Math.round(num(r.list_price, 'list_price') * 100),
  }));
  const vendors = parseCsv(csv.vendors).map((r) => ({
    name: r.vendor_name,
    country: r.country,
    category: r.category,
    termsDays: num(r.payment_terms_days, 'payment_terms_days'),
    ghostPool: r.ghost_pool === '1',
  }));
  const firstNames = parseCsv(csv.firstNames)
    .map((r) => r.name)
    .filter(Boolean);
  const lastNames = parseCsv(csv.lastNames)
    .map((r) => r.name)
    .filter(Boolean);

  validateMasters({ departments, products, vendors, firstNames, lastNames });
  return { departments, products, vendors, firstNames, lastNames };
}

export function validateMasters(m: Masters): void {
  const fail = (msg: string): never => {
    throw new Error(`Master data check failed: ${msg}`);
  };
  const exec = m.departments.find((d) => d.buys.length === 0);
  if (!exec || exec.headcount !== 1) fail('There must be one Executive department with headcount = 1 and no buys_categories (it holds the CEO)');
  const buyers = m.departments.filter((d) => d.buys.length > 0 && d.poWeight > 0);
  if (buyers.length < 4) fail('At least 4 departments must buy things');
  for (const d of buyers) {
    if (d.headcount < 5) fail(`${d.name} needs a headcount of at least 5`);
    if (d.staffTitles.length === 0) fail(`${d.name} has no staff_titles`);
  }
  const procurement = m.departments.find((d) => d.name === 'Procurement');
  const finance = m.departments.find((d) => d.name === 'Finance');
  const warehouse = m.departments.find((d) => d.name === 'Warehouse & Logistics');
  if (!procurement || !finance || !warehouse) fail('The departments must include Procurement, Finance and Warehouse & Logistics (the storyline needs them)');
  if (finance && finance.headcount < 6) fail('Finance needs a headcount of at least 6 (several accounts-payable staff are required)');
  if (new Set(m.departments.map((d) => d.deptId)).size !== m.departments.length) fail('Duplicate dept_id');

  const categories = new Set(m.products.map((p) => p.category));
  for (const d of buyers) for (const c of d.buys) if (!categories.has(c)) fail(`Department ${d.name} buys category “${c}”, which is not in products.csv`);
  for (const c of categories) {
    if (m.products.filter((p) => p.category === c).length < 6) fail(`Category ${c} has fewer than 6 products`);
    if (m.vendors.filter((v) => v.category === c).length < 3) fail(`Category ${c} has fewer than 3 vendors`);
  }
  for (const v of m.vendors) if (!categories.has(v.category)) fail(`Vendor ${v.name} has category “${v.category}”, which is not in products.csv`);
  if (new Set(m.vendors.map((v) => v.name)).size !== m.vendors.length) fail('Duplicate vendor name');
  if (new Set(m.products.map((p) => p.sku)).size !== m.products.length) fail('Duplicate SKU');
  if (m.vendors.filter((v) => v.ghostPool).length < 6) fail('At least 6 vendors must have ghost_pool = 1');
  if (m.firstNames.length < 30 || m.lastNames.length < 30) fail('Need at least 30 first names and 30 last names');
  const totalHeads = m.departments.reduce((s, d) => s + d.headcount, 0);
  if (totalHeads > m.firstNames.length * m.lastNames.length * 0.2) fail('Too many employees for the size of the name pool');
}
