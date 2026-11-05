/**
 * Dataset generator.
 *
 * Builds a complete, internally consistent procure-to-pay dataset for the fictional
 * company "Harbourline Supply Co." from a seed, then plants a known set of anomalies
 * (the "crimes") together with look-alike decoys. The ground truth for every case is
 * returned next to the data, and tests prove that each case's reference SQL finds
 * exactly that truth on hundreds of different seeds.
 *
 * Design rules that keep the data coherent ("no contradictions in the data"):
 *  - money is handled as integer cents, never floats;
 *  - totals are derived from lines, invoices from receipts, payments from invoices;
 *  - normal data is generated so that it can *never* satisfy an anomaly predicate;
 *    anomalies are then planted deliberately, and decoys fail them for a subtle reason.
 */
import { Rng } from './rng';
import { dayNum, isoDay, isoTs, isWorkday, weekStart, SECONDS_PER_DAY } from './dates';
import type { DeptMaster, Masters } from './masters';
import { insertColumns, LOAD_ORDER, type TableName } from './schema';

export const PERIOD_START = '2025-01-01';
export const AS_OF = '2025-12-31';
export const SPLIT_THRESHOLD = 5000; // POs at/above this need extra sign-off
export const SMALL_PO_LIMIT = 2000; // POs up to this may be approved by any manager in the dept
export const OVERDUE_DAYS = 60;
/** case 16: what the inactive vendors must be listed with */
export const WATCH_REASON = 'Inactive vendor, do not use';
export const WATCH_DATE = '2025-12-31';

const D0 = dayNum(PERIOD_START);
const D_ASOF = dayNum(AS_OF);
const D_LAST_PO = dayNum('2025-12-12');

export type Cell = string | number | null;
export type TableRows = Record<TableName, Cell[][]>;
export type Id = string | number;

export interface Decoy {
  key: string;
  ids: Id[];
}
export interface CaseTruth {
  answer: Id[];
  decoys: Decoy[];
}
export interface Dataset {
  seed: string;
  tables: TableRows;
  /** keyed by case number 1..18 */
  truth: Record<number, CaseTruth>;
  story: {
    mastermind: { empId: number; name: string; title: string; dept: string };
    ghostVendors: { vendorId: number; vendorName: string; ownerName: string }[];
  };
}

// ───────────────────────────── internal types ─────────────────────────────

interface Emp {
  id: number;
  name: string;
  email: string;
  deptId: number;
  title: string;
  managerId: number | null;
  hireDay: number;
  status: 'active' | 'terminated';
  bank: string; // 14 digits
  level: 'ceo' | 'head' | 'manager' | 'staff';
}
interface Vendor {
  id: number;
  name: string;
  country: string;
  category: string;
  terms: number;
  bankDigits: string;
  bankText: string;
  taxId: string;
  status: 'active' | 'inactive';
  onboardedBy: number;
  onboardedDay: number;
  priceFactor: number;
  ghostOwner?: number;
  profile?: Record<string, unknown>;
}
interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  listPriceC: number;
}
interface SkelLine {
  productId: number;
  qty: number;
  priceC: number;
}
type AuditKind = 'raise' | 'lower' | 'preraise' | 'benignPre' | 'benignPost';
interface Skel {
  requester: Emp;
  vendor: Vendor;
  approver: Emp;
  day: number;
  createdSec: number;
  approvedSec: number;
  lines: SkelLine[];
  totalC: number;
  cancelled?: boolean;
  audit?: AuditKind;
  tags: string[]; // c4, c4decoy, c5, c5under, c5big, c8c …
  /** re-issue chain (case 13): the earlier PO this one replaces */
  replaces?: Skel;
  id: number;
  number: string;
}
interface Rcpt {
  poId: number;
  lineId: number;
  productId: number;
  qty: number;
  day: number;
  by: number;
  id: number;
}
interface Pay {
  day: number;
  amountC: number;
  method: 'EFT' | 'BPAY' | 'CHEQUE';
  paidBy: number;
  ref: string;
  id: number;
}
interface Inv {
  poId: number;
  vendorId: number;
  terms: number;
  number: string;
  invDay: number;
  dueDay: number;
  amountC: number;
  status: 'posted' | 'disputed' | 'void';
  enteredBy: number;
  pays: Pay[];
  tags: Set<string>;
  note: string | null;
  id: number;
}
interface ProdMove {
  day: number;
  type: 'OPENING' | 'RECEIPT' | 'ADJUST' | 'ISSUE';
  qty: number;
  refType: string | null;
  refId: number | null;
  seq: number;
  trueBal: number;
  recBal: number;
  productId: number;
  id: number;
  drift?: boolean;
}

const money = (c: number) => (c / 100).toFixed(2);
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const TYPE_ORDER = { OPENING: 0, RECEIPT: 1, ADJUST: 2, ISSUE: 3 } as const;

// ───────────────────────────── helpers ─────────────────────────────

function digits(rng: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += rng.int(0, 9);
  return s;
}
function newBankDigits(rng: Rng, used: Set<string>): string {
  for (;;) {
    const bsb = rng.pick(['012', '033', '062', '082', '112', '182', '213', '302', '633', '732']) + digits(rng, 3);
    const acct = String(rng.int(10_000_000, 99_999_999));
    const d = bsb + acct;
    if (!used.has(d)) {
      used.add(d);
      return d;
    }
  }
}
/** Vendors store account numbers in inconsistent human formats — normalising them is part of case 6. */
function formatBank(rng: Rng, d: string): string {
  switch (rng.int(0, 2)) {
    case 0:
      return `${d.slice(0, 3)}-${d.slice(3, 6)} ${d.slice(6)}`;
    case 1:
      return `${d.slice(0, 6)}-${d.slice(6)}`;
    default:
      return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  }
}
function abn(rng: Rng): string {
  const d = digits(rng, 11);
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
}
function randWorkday(rng: Rng, from: number, to: number): number {
  for (let i = 0; i < 100; i++) {
    const d = rng.int(from, to);
    if (isWorkday(d)) return d;
  }
  return from;
}

// ───────────────────────────── main ─────────────────────────────

export function generateDataset(seed: string, masters: Masters, onProgress?: (label: string) => void): Dataset {
  const root = new Rng(seed);
  const progress = (s: string) => onProgress?.(s);

  // ── departments & employees ──────────────────────────────────────────
  progress('Organisation and staff');
  const rngE = root.fork('employees');
  const deptByName = new Map(masters.departments.map((d) => [d.name, d]));
  const deptById = new Map(masters.departments.map((d) => [d.deptId, d]));
  const usedBank = new Set<string>();
  const usedNames = new Set<string>();
  const emps: Emp[] = [];

  const newPerson = (): { name: string; email: string } => {
    for (let i = 0; i < 500; i++) {
      const f = rngE.pick(masters.firstNames);
      const l = rngE.pick(masters.lastNames);
      const name = `${f} ${l}`;
      if (usedNames.has(name)) continue;
      usedNames.add(name);
      const slug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
      return { name, email: `${slug(f)}.${slug(l)}@harbourline.example` };
    }
    throw new Error('name pool exhausted');
  };
  const addEmp = (e: Omit<Emp, 'id' | 'name' | 'email' | 'bank' | 'status'>): Emp => {
    const p = newPerson();
    const emp: Emp = { ...e, id: emps.length + 1, name: p.name, email: p.email, status: 'active', bank: newBankDigits(rngE, usedBank) };
    emps.push(emp);
    return emp;
  };

  const exec = masters.departments.find((d) => d.buys.length === 0)!;
  const ceo = addEmp({ deptId: exec.deptId, title: 'Chief Executive Officer', managerId: null, hireDay: dayNum('2009-03-02'), level: 'ceo' });
  for (const d of masters.departments) {
    if (d === exec) continue;
    const head = addEmp({
      deptId: d.deptId,
      title: `Head of ${d.name}`,
      managerId: ceo.id,
      hireDay: rngE.int(dayNum('2010-01-04'), dayNum('2019-12-20')),
      level: 'head',
    });
    const nMgr = d.headcount >= 12 ? 2 : 1;
    const managers: Emp[] = [];
    for (let i = 0; i < nMgr; i++)
      managers.push(
        addEmp({
          deptId: d.deptId,
          title: `${d.name} Manager`,
          managerId: head.id,
          hireDay: rngE.int(dayNum('2012-01-02'), dayNum('2022-12-20')),
          level: 'manager',
        }),
      );
    const nStaff = d.headcount - 1 - nMgr;
    for (let i = 0; i < nStaff; i++) {
      const title = d.name === 'Finance' && i < 3 ? 'Accounts Payable Clerk' : rngE.pick(d.staffTitles);
      addEmp({ deptId: d.deptId, title, managerId: rngE.pick(managers).id, hireDay: rngE.int(dayNum('2014-01-06'), dayNum('2024-06-28')), level: 'staff' });
    }
  }
  // A handful of leavers (never used as requesters / approvers / clerks).
  const leaverPool = emps.filter((e) => e.level === 'staff' && !['Finance', 'Procurement', 'Warehouse & Logistics'].includes(deptById.get(e.deptId)!.name));
  for (const e of rngE.sample(leaverPool, 5)) e.status = 'terminated';

  const empById = new Map(emps.map((e) => [e.id, e]));
  const active = emps.filter((e) => e.status === 'active');
  const procId = deptByName.get('Procurement')!.deptId;
  const finId = deptByName.get('Finance')!.deptId;
  const whId = deptByName.get('Warehouse & Logistics')!.deptId;
  const apClerks = active.filter((e) => e.deptId === finId && e.title === 'Accounts Payable Clerk');
  const receivers = active.filter((e) => e.deptId === whId && e.level === 'staff');
  const onboarders = active.filter((e) => e.deptId === procId);
  const buyerDepts: DeptMaster[] = masters.departments.filter((d) => d.buys.length > 0 && d.poWeight > 0);
  const requesterPool = (deptId: number) => active.filter((e) => e.deptId === deptId && e.level !== 'ceo');

  // ── products & vendors ───────────────────────────────────────────────
  progress('Products and vendors');
  const products: Product[] = masters.products.map((p, i) => ({
    id: i + 1,
    sku: p.sku,
    name: p.name,
    category: p.category,
    unit: p.unit,
    listPriceC: p.listPriceC,
  }));
  const prodsByCat = new Map<string, Product[]>();
  for (const p of products) prodsByCat.set(p.category, [...(prodsByCat.get(p.category) ?? []), p]);

  const rngV = root.fork('vendors');
  const vendors: Vendor[] = masters.vendors.map((v, i) => {
    const onboarder = rngV.pick(onboarders);
    const digitsStr = newBankDigits(rngV, usedBank);
    return {
      id: i + 1,
      name: v.name,
      country: v.country,
      category: v.category,
      terms: v.termsDays,
      bankDigits: digitsStr,
      bankText: formatBank(rngV, digitsStr),
      taxId: abn(rngV),
      status: 'active' as const,
      onboardedBy: onboarder.id,
      onboardedDay: rngV.int(Math.max(onboarder.hireDay, dayNum('2014-01-01')), dayNum('2024-12-31')),
      priceFactor: rngV.float(0.93, 1.07),
    };
  });

  // ── the cast ─────────────────────────────────────────────────────────
  const rngP = root.fork('plot');
  const staffIn = (names: string[]) => active.filter((e) => e.level === 'staff' && names.some((n) => deptByName.get(n)?.deptId === e.deptId));
  const M = rngP.pick(staffIn(['Procurement']));
  const A = rngP.pick(staffIn(['Warehouse & Logistics', 'Operations', 'Facilities']).filter((e) => e.id !== M.id));
  const canBuy = (e: Emp) => (deptById.get(e.deptId)?.buys.length ?? 0) > 0 && e.level !== 'ceo';
  const B = rngP.pick(active.filter((e) => canBuy(e) && ![M.id, A.id].includes(e.id)));
  const C = rngP.pick(staffIn(['Procurement', 'IT', 'Operations']).filter((e) => ![M.id, A.id, B.id].includes(e.id)));
  const X = rngP.pick(active.filter((e) => canBuy(e) && ![M.id, A.id, B.id, C.id].includes(e.id)));

  // ghost vendors: look like any other supplier, but pay into an employee's own bank account
  const ghosts: Vendor[] = [];
  const claimedVendors = new Set<number>();
  for (const owner of [M, A, X]) {
    const buys = deptById.get(owner.deptId)!.buys;
    const candidates = masters.vendors
      .map((v, i) => ({ v, vendor: vendors[i] }))
      .filter((x) => x.v.ghostPool && buys.includes(x.v.category) && !claimedVendors.has(x.vendor.id));
    const chosen = rngP.pick(candidates).vendor;
    claimedVendors.add(chosen.id);
    chosen.ghostOwner = owner.id;
    chosen.bankDigits = owner.bank;
    chosen.bankText = formatBank(rngP, owner.bank);
    ghosts.push(chosen);
  }
  const [gM, gA] = ghosts;

  // decoy vendors for case 6
  const plain = () => vendors.filter((v) => !claimedVendors.has(v.id));
  const [dv1, dv2, dvNear] = rngP.sample(plain(), 3);
  [dv1, dv2, dvNear].forEach((v) => claimedVendors.add(v.id));
  dv2.bankDigits = dv1.bankDigits; // two legitimate subsidiaries sharing one account
  dv2.bankText = formatBank(rngP, dv1.bankDigits);
  {
    const victim = rngP.pick(active.filter((e) => ![M.id, A.id, X.id].includes(e.id)));
    const arr = victim.bank.split('');
    const pos = rngP.int(6, 13);
    arr[pos] = String((Number(arr[pos]) + rngP.int(1, 8)) % 10);
    dvNear.bankDigits = arr.join(''); // one digit off an employee's account: must NOT match
    dvNear.bankText = formatBank(rngP, dvNear.bankDigits);
  }
  // a few inactive vendors (never used)
  const inactive = rngP.sample(plain(), 3);
  inactive.forEach((v) => {
    v.status = 'inactive';
    claimedVendors.add(v.id);
  });
  const poVendors = new Map<string, Vendor[]>();
  for (const v of vendors) {
    if (v.status !== 'active' || v.ghostOwner) continue;
    poVendors.set(v.category, [...(poVendors.get(v.category) ?? []), v]);
  }

  // second file (case 12): products reserved for the price series, so that ordinary traffic never orders them
  const rngX = root.fork('followup');
  const reservedPairs = new Set<string>();
  const creepPlan: { vendor: Vendor; product: Product; kind: 'creep' | 'gradual' }[] = [];
  {
    const kinds: ('creep' | 'gradual')[] = ['creep', 'creep', 'creep', 'gradual', 'gradual'];
    const usedCat = new Set<string>();
    for (const v of rngX.shuffle([...poVendors.values()].flat())) {
      if (creepPlan.length >= kinds.length) break;
      if (claimedVendors.has(v.id) || usedCat.has(v.category)) continue;
      usedCat.add(v.category);
      const product = rngX.pick(prodsByCat.get(v.category)!);
      creepPlan.push({ vendor: v, product, kind: kinds[creepPlan.length] });
      reservedPairs.add(`${v.id}|${product.id}`);
    }
    if (creepPlan.length < kinds.length) throw new Error('could not plan the price series');
  }

  // ── purchase-order skeletons ─────────────────────────────────────────
  progress('Purchase orders');
  const rngO = root.fork('orders');
  const skels: Skel[] = [];
  const usedKeys = new Set<string>();
  const reserve = (reqId: number, vendorId: number, day: number): boolean => {
    const key = `${reqId}|${vendorId}|${weekStart(day)}`;
    if (usedKeys.has(key)) return false;
    usedKeys.add(key);
    return true;
  };

  const nLines = () => rngO.weighted([1, 2, 3, 4, 5, 6], [30, 28, 20, 12, 6, 4]);
  const totalOf = (lines: SkelLine[]) => lines.reduce((s, l) => s + l.qty * l.priceC, 0);
  const poolFor = (vendor: Vendor) => prodsByCat.get(vendor.category)!.filter((p) => !reservedPairs.has(`${vendor.id}|${p.id}`));
  const genLines = (vendor: Vendor, targetC: number, n: number): SkelLine[] => {
    const pool = poolFor(vendor);
    const chosen = rngO.sample(pool, Math.min(n, pool.length));
    const ws = chosen.map(() => rngO.float(0.3, 1));
    const wsum = ws.reduce((a, b) => a + b, 0);
    return chosen.map((p, i) => {
      const priceC = Math.max(1, Math.round(p.listPriceC * vendor.priceFactor * rngO.float(0.97, 1.03)));
      const qty = Math.max(1, Math.round((targetC * (ws[i] / wsum)) / priceC));
      return { productId: p.id, qty, priceC };
    });
  };
  const genLinesBetween = (vendor: Vendor, loC: number, hiC: number, maxLines = 4): SkelLine[] => {
    for (let t = 0; t < 800; t++) {
      const lines = genLines(vendor, rngO.float(loC, hiC), rngO.int(1, maxLines));
      const tot = totalOf(lines);
      if (tot >= loC && tot <= hiC) return lines;
    }
    const cheapest = [...poolFor(vendor)].sort((a, b) => a.listPriceC - b.listPriceC)[0];
    const priceC = cheapest.listPriceC;
    return [{ productId: cheapest.id, qty: Math.max(1, Math.floor((loC + hiC) / 2 / priceC)), priceC }];
  };
  const mkSkel = (requester: Emp, vendor: Vendor, day: number, lines: SkelLine[], approver: Emp, tags: string[] = []): Skel => {
    const createdSec = day * SECONDS_PER_DAY + rngO.int(8 * 3600 + 900, 16 * 3600 + 2700);
    const s: Skel = {
      requester,
      vendor,
      approver,
      day,
      createdSec,
      approvedSec: createdSec + rngO.int(2700, 2 * SECONDS_PER_DAY),
      lines,
      totalC: totalOf(lines),
      tags,
      id: 0,
      number: '',
    };
    skels.push(s);
    return s;
  };
  const managerOf = (e: Emp): Emp => empById.get(e.managerId!)!;
  const pickRequester = (): Emp => {
    const dept = rngO.weighted(
      buyerDepts,
      buyerDepts.map((d) => d.poWeight),
    );
    return rngO.pick(requesterPool(dept.deptId));
  };
  const pickVendorFor = (e: Emp): Vendor => {
    const dept = deptById.get(e.deptId)!;
    return rngO.pick(poVendors.get(rngO.pick(dept.buys))!);
  };
  const firstDay = D0 + 5;

  // case 12 — price creep: one product from one vendor, ordered five times with the price rising in steps
  const requesterFor = (vendor: Vendor): Emp => {
    const depts = buyerDepts.filter((d) => d.buys.includes(vendor.category));
    return rngX.pick(requesterPool(rngX.pick(depts.length ? depts : buyerDepts).deptId));
  };
  for (const plan of creepPlan) {
    const steps =
      plan.kind === 'creep'
        ? [1, rngX.float(1.0, 1.04), rngX.float(1.12, 1.2), rngX.float(1.0, 1.04), rngX.float(1.12, 1.2)]
        : [1, rngX.float(1.05, 1.08), rngX.float(1.05, 1.08), rngX.float(1.05, 1.08), rngX.float(1.05, 1.08)];
    let price = Math.max(50, Math.round(plan.product.listPriceC * plan.vendor.priceFactor));
    let day = randWorkday(rngX, D0 + 10, dayNum('2025-06-30'));
    for (const m of steps) {
      price = Math.max(1, Math.round(price * m));
      let placed = false;
      for (let a = 0; a < 60 && !placed; a++) {
        const req = requesterFor(plan.vendor);
        if (!reserve(req.id, plan.vendor.id, day)) continue;
        const qty = Math.max(1, Math.round(rngX.float(60_000, 200_000) / price));
        mkSkel(req, plan.vendor, day, [{ productId: plan.product.id, qty, priceC: price }], managerOf(req), [`c12${plan.kind}`]);
        placed = true;
      }
      if (!placed) throw new Error('could not place a price-series order');
      day = randWorkday(rngX, day + 14, day + 30);
    }
  }

  // case 13 — re-issue chains: a PO is cancelled and raised again, over and over
  const plantChain = (len: number, tag: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const req = pickRequester();
      const vendor = pickVendorFor(req);
      const lines = genLinesBetween(vendor, 20_000, 90_000, 2);
      const days: number[] = [];
      let day = randWorkday(rngX, D0 + 10, dayNum('2025-09-15'));
      for (let i = 0; i < len; i++) {
        days.push(day);
        day = randWorkday(rngX, day + 7, day + 10);
      }
      if (!days.every((d) => reserve(req.id, vendor.id, d))) continue;
      let prev: Skel | undefined;
      days.forEach((d, i) => {
        const s = mkSkel(
          req,
          vendor,
          d,
          lines.map((l) => ({ ...l })),
          managerOf(req),
          [tag],
        );
        s.replaces = prev;
        if (i < days.length - 1) s.cancelled = true;
        prev = s;
      });
      return;
    }
    throw new Error('could not place a re-issue chain');
  };
  for (let i = 0, n = rngX.int(2, 3); i < n; i++) plantChain(rngX.int(5, 6), 'c13long');
  for (let i = 0; i < 3; i++) plantChain(2, 'c13short');
  for (let i = 0; i < 2; i++) plantChain(3, 'c13short');

  // case 5 — split purchase orders (just under the sign-off threshold, same week, same vendor)
  const plantSplit = (req: Emp, vendor: Vendor, tag: string) => {
    for (let a = 0; a < 200; a++) {
      const monday = weekStart(rngO.int(D0 + 14, dayNum('2025-11-24')));
      if (!reserve(req.id, vendor.id, monday)) continue;
      const k = rngO.chance(0.3) ? 3 : 2;
      const days = rngO.sample([0, 1, 2, 3, 4], k).sort();
      for (const off of days) mkSkel(req, vendor, monday + off, genLinesBetween(vendor, 350_000, 499_900), managerOf(req), [tag]);
      return;
    }
    throw new Error('could not place split group');
  };
  const nGroupsM = 2;
  for (let i = 0; i < nGroupsM; i++) plantSplit(M, gM, 'c5');
  for (let i = 0, n = rngO.int(2, 3); i < n; i++) plantSplit(C, pickVendorFor(C), 'c5');
  // decoys: same-week pairs that stay under the threshold, or include one genuinely large (properly approved) order
  for (let i = 0, n = rngO.int(3, 4); i < n; i++) {
    for (let a = 0; a < 200; a++) {
      const req = pickRequester();
      const vendor = pickVendorFor(req);
      const monday = weekStart(rngO.int(D0 + 14, dayNum('2025-11-24')));
      if (!reserve(req.id, vendor.id, monday)) continue;
      for (const off of rngO.sample([0, 1, 2, 3, 4], 2))
        mkSkel(req, vendor, monday + off, genLinesBetween(vendor, 30_000, 190_000, 2), managerOf(req), ['c5under']);
      break;
    }
  }
  for (let i = 0, n = rngO.int(2, 3); i < n; i++) {
    for (let a = 0; a < 200; a++) {
      const req = pickRequester();
      const vendor = pickVendorFor(req);
      const monday = weekStart(rngO.int(D0 + 14, dayNum('2025-11-24')));
      if (!reserve(req.id, vendor.id, monday)) continue;
      const [d1, d2] = rngO.sample([0, 1, 2, 3, 4], 2);
      mkSkel(req, vendor, monday + d1, genLinesBetween(vendor, 520_000, 900_000, 5), managerOf(req), ['c5big']);
      mkSkel(req, vendor, monday + d2, genLinesBetween(vendor, 40_000, 150_000, 2), managerOf(req), ['c5big']);
      break;
    }
  }

  // case 4 — approvals that skip the requester's direct manager
  const peerApprovers = active.filter((e) => e.level === 'head' || e.level === 'manager');
  const approverOfKind = (req: Emp, kind: 'self' | 'peer' | 'sub'): Emp => {
    if (kind === 'self') return req;
    if (kind === 'sub') {
      const subs = active.filter((e) => e.managerId === req.id);
      if (subs.length) return rngO.pick(subs);
    }
    const peers = peerApprovers.filter((e) => e.deptId !== req.deptId && e.id !== req.managerId && e.id !== req.id);
    return rngO.pick(peers);
  };
  const plantOffManager = (req: Emp, count: number, kinds: ('self' | 'peer' | 'sub')[], vendorFor: (i: number) => Vendor) => {
    for (let i = 0; i < count; i++) {
      for (let a = 0; a < 200; a++) {
        const vendor = vendorFor(i);
        const day = randWorkday(rngO, D0 + 10, dayNum('2025-12-01'));
        if (!reserve(req.id, vendor.id, day)) continue;
        mkSkel(req, vendor, day, genLinesBetween(vendor, 250_000, 1_200_000, 4), approverOfKind(req, kinds[i % kinds.length]), ['c4']);
        break;
      }
    }
  };
  plantOffManager(M, rngO.int(3, 5), ['self', 'peer', 'self', 'sub', 'peer'], () => gM);
  plantOffManager(A, rngO.int(2, 3), ['self', 'peer', 'sub'], (i) => (i === 0 ? gA : pickVendorFor(A)));
  plantOffManager(B, rngO.int(2, 3), ['peer', 'self', 'peer'], () => pickVendorFor(B));
  // decoys: small orders approved by another manager in the same department (allowed by policy)
  for (let i = 0, made = 0; made < 26 && i < 400; i++) {
    const req = pickRequester();
    const alts = active.filter((e) => (e.level === 'head' || e.level === 'manager') && e.deptId === req.deptId && e.id !== req.id && e.id !== req.managerId);
    if (alts.length === 0) continue;
    const vendor = pickVendorFor(req);
    const day = randWorkday(rngO, firstDay, D_LAST_PO);
    if (!reserve(req.id, vendor.id, day)) continue;
    mkSkel(req, vendor, day, genLinesBetween(vendor, 15_000, 195_000, 3), rngO.pick(alts), ['c4decoy']);
    made++;
  }

  // ghost-vendor background traffic (so the fake suppliers look busy)
  for (const g of ghosts) {
    const owner = empById.get(g.ghostOwner!)!;
    for (let i = 0, n = rngO.int(5, 9); i < n; i++) {
      for (let a = 0; a < 100; a++) {
        const day = randWorkday(rngO, firstDay, D_LAST_PO);
        if (!reserve(owner.id, g.id, day)) continue;
        mkSkel(owner, g, day, genLines(g, Math.min(40_000_00, Math.max(12_000, rngO.lognormal(220_000, 0.8))), nLines()), managerOf(owner));
        break;
      }
    }
  }

  // ordinary traffic
  const N_NORMAL = 1650;
  for (let i = 0; i < N_NORMAL; i++) {
    for (let a = 0; a < 80; a++) {
      const req = pickRequester();
      const vendor = pickVendorFor(req);
      const day = randWorkday(rngO, firstDay, D_LAST_PO);
      if (!reserve(req.id, vendor.id, day)) continue;
      const target = Math.min(4_000_000, Math.max(12_000, rngO.lognormal(220_000, 1.0)));
      mkSkel(req, vendor, day, genLines(vendor, target, nLines()), managerOf(req));
      break;
    }
  }

  // case 8 (type C) — invoices received before any goods arrived
  const k8c = rngO.int(1, 2);
  for (let i = 0; i < k8c; i++) {
    for (let a = 0; a < 100; a++) {
      const req = pickRequester();
      const vendor = pickVendorFor(req);
      const day = randWorkday(rngO, dayNum('2025-12-01'), D_LAST_PO);
      if (!reserve(req.id, vendor.id, day)) continue;
      mkSkel(req, vendor, day, genLines(vendor, rngO.lognormal(300_000, 0.4), nLines()), managerOf(req), ['c8c']);
      break;
    }
  }

  // flags for cancellations and audit-log behaviours
  const free = () => skels.filter((s) => s.tags.length === 0);
  for (const s of free()) {
    const r = rngO.next();
    if (r < 0.03) s.cancelled = true;
    else if (r < 0.06) s.audit = 'lower';
    else if (r < 0.12) s.audit = 'preraise';
    else if (r < 0.22) s.audit = 'benignPost';
    else if (r < 0.36) s.audit = 'benignPre';
  }
  const raiseCandidates = free().filter((s) => !s.cancelled && !s.audit && s.day <= dayNum('2025-12-01'));
  const raised = rngO.sample(raiseCandidates, rngO.int(4, 7));
  raised.forEach((s) => (s.audit = 'raise'));

  // ── finalise POs: ids, numbers, lines ─────────────────────────────────
  progress('Lines, receipts, invoices');
  skels.sort((a, b) => a.createdSec - b.createdSec || a.requester.id - b.requester.id);
  skels.forEach((s, i) => {
    s.id = i + 1;
    s.number = `PO-2025-${pad(s.id, 5)}`;
  });

  interface LineRow {
    id: number;
    poId: number;
    no: number;
    productId: number;
    qty: number;
    priceC: number;
  }
  const lineRows: LineRow[] = [];
  const linesByPo = new Map<number, LineRow[]>();
  for (const s of skels) {
    const rows = s.lines.map((l, i) => ({ id: lineRows.length + i + 1, poId: s.id, no: i + 1, productId: l.productId, qty: l.qty, priceC: l.priceC }));
    lineRows.push(...rows);
    linesByPo.set(s.id, rows);
  }
  const lineById = new Map(lineRows.map((l) => [l.id, l]));

  // ── receipts, invoices, payments, audit logs ─────────────────────────
  const rngL = root.fork('lifecycle');
  const rcpts: Rcpt[] = [];
  const rcptsByPo = new Map<number, Rcpt[]>();
  const invs: Inv[] = [];
  const invByPo = new Map<number, Inv>();
  const poStatus = new Map<number, 'open' | 'received' | 'closed' | 'cancelled'>();
  interface AuditRow {
    poId: number;
    by: number;
    ts: number;
    field: string;
    oldV: string;
    newV: string;
    id: number;
  }
  const audits: AuditRow[] = [];
  const asOfEnd = D_ASOF * SECONDS_PER_DAY + 17 * 3600;

  const makePays = (inv: Inv, amountC: number): Pay[] => {
    const payDay = Math.max(inv.invDay + 1, inv.dueDay + rngL.int(-4, 9));
    if (payDay > D_ASOF) return [];
    const mk = (day: number, c: number): Pay => ({
      day,
      amountC: c,
      method: rngL.weighted(['EFT', 'BPAY', 'CHEQUE'] as const, [70, 20, 10]),
      paidBy: rngL.pick(apClerks).id,
      ref: `${rngL.pick(['EFT', 'BPY', 'CHQ'])}${pad(rngL.int(0, 99_999_999), 8)}`,
      id: 0,
    });
    if (rngL.chance(0.1) && amountC >= 2000) {
      const day2 = payDay + rngL.int(3, 20);
      if (day2 <= D_ASOF) {
        const first = Math.round(amountC * 0.5);
        return [mk(payDay, first), mk(day2, amountC - first)];
      }
    }
    return [mk(payDay, amountC)];
  };
  const makeInv = (s: Skel, invDay: number, amountC: number): Inv => {
    const inv: Inv = {
      poId: s.id,
      vendorId: s.vendor.id,
      terms: s.vendor.terms,
      number: '',
      invDay,
      dueDay: invDay + s.vendor.terms,
      amountC,
      status: 'posted',
      enteredBy: rngL.pick(apClerks).id,
      pays: [],
      tags: new Set(),
      note: null,
      id: 0,
    };
    invs.push(inv);
    invByPo.set(s.id, inv);
    return inv;
  };

  for (const s of skels) {
    const approvedDay = Math.floor(s.approvedSec / SECONDS_PER_DAY);

    // audit log behaviours
    const addAudit = (by: number, ts: number, field: string, oldV: string, newV: string) => audits.push({ poId: s.id, by, ts, field, oldV, newV, id: 0 });
    const postTs = (lo: number, hi: number) => Math.min(asOfEnd, s.approvedSec + rngL.int(lo, hi));
    const editor = () => (rngL.chance(0.75) ? s.requester.id : rngL.pick(active.filter((e) => e.deptId === procId)).id);
    switch (s.audit) {
      case 'raise':
        addAudit(editor(), postTs(3600, 14 * SECONDS_PER_DAY), 'total_amount', money(Math.round(s.totalC * rngL.float(0.55, 0.9))), money(s.totalC));
        break;
      case 'lower':
        addAudit(editor(), postTs(3600, 10 * SECONDS_PER_DAY), 'total_amount', money(Math.round(s.totalC * rngL.float(1.05, 1.4))), money(s.totalC));
        break;
      case 'preraise':
        addAudit(s.requester.id, s.createdSec + rngL.int(300, 2400), 'total_amount', money(Math.round(s.totalC * rngL.float(0.6, 0.95))), money(s.totalC));
        break;
      case 'benignPre':
        addAudit(s.requester.id, s.createdSec + rngL.int(300, 2400), 'delivery_date', isoDay(approvedDay + 10), isoDay(approvedDay + 14));
        break;
      case 'benignPost':
        if (rngL.chance(0.5))
          addAudit(editor(), postTs(3600, 6 * SECONDS_PER_DAY), 'delivery_date', isoDay(approvedDay + 10), isoDay(approvedDay + rngL.int(12, 20)));
        else addAudit(editor(), postTs(3600, 6 * SECONDS_PER_DAY), 'ship_to', 'Dock A', 'Dock B');
        break;
    }

    if (s.cancelled) {
      poStatus.set(s.id, 'cancelled');
      continue;
    }
    if (s.tags.includes('c8c')) {
      poStatus.set(s.id, 'open');
      const inv = makeInv(s, s.day + rngL.int(1, 4), s.totalC);
      inv.tags.add('c8C');
      continue;
    }

    // goods receipts
    const baseLag = rngL.int(4, 21);
    const myRcpts: Rcpt[] = [];
    let complete = true;
    for (const l of linesByPo.get(s.id)!) {
      const day0 = approvedDay + baseLag + rngL.int(0, 3);
      const mode = rngL.weighted(['full', 'split', 'short'] as const, [80, 12, 8]);
      const planned: { qty: number; day: number }[] = [];
      if (mode === 'split' && l.qty >= 2) {
        const first = Math.max(1, Math.min(l.qty - 1, Math.round(l.qty * rngL.float(0.4, 0.7))));
        planned.push({ qty: first, day: day0 }, { qty: l.qty - first, day: day0 + rngL.int(2, 9) });
      } else if (mode === 'short' && l.qty >= 5) planned.push({ qty: Math.max(1, Math.floor(l.qty * rngL.float(0.6, 0.95))), day: day0 });
      else planned.push({ qty: l.qty, day: day0 });
      let got = 0;
      for (const p of planned) {
        if (p.day > D_ASOF) {
          complete = false;
          continue;
        }
        const r: Rcpt = { poId: s.id, lineId: l.id, productId: l.productId, qty: p.qty, day: p.day, by: rngL.pick(receivers).id, id: 0 };
        rcpts.push(r);
        myRcpts.push(r);
        got++;
      }
      if (got === 0) complete = false;
    }
    rcptsByPo.set(s.id, myRcpts);
    if (myRcpts.length === 0) {
      poStatus.set(s.id, 'open');
      continue;
    }
    if (!complete) {
      poStatus.set(s.id, 'received');
      continue;
    }
    const lastDay = Math.max(...myRcpts.map((r) => r.day));
    const invDay = lastDay + rngL.int(0, 9);
    if (invDay > D_ASOF) {
      poStatus.set(s.id, 'received');
      continue;
    }
    const amountC = myRcpts.reduce((sum, r) => sum + r.qty * lineById.get(r.lineId)!.priceC, 0);
    const inv = makeInv(s, invDay, amountC);
    inv.pays = makePays(inv, amountC);
    poStatus.set(s.id, 'closed');
  }

  // sort invoices & assign vendor-scoped invoice numbers (before any duplicates are planted)
  invs.sort((a, b) => a.invDay - b.invDay || a.poId - b.poId);
  const seqByVendor = new Map<number, number>();
  for (const inv of invs) {
    const next = (seqByVendor.get(inv.vendorId) ?? 1000 + ((inv.vendorId * 137) % 4000)) + rngL.int(1, 4);
    seqByVendor.set(inv.vendorId, next);
    inv.number = `INV-${pad(inv.vendorId, 3)}-${pad(next, 4)}`;
  }

  // ── plant anomalies on invoices / receipts ────────────────────────────
  progress('Planting the anomalies');
  const rngI = root.fork('invoices');
  const taken = new Set<Inv>();
  const eligible = () => rngI.shuffle(invs.filter((i) => !taken.has(i) && !i.tags.has('c8C') && i.status === 'posted'));
  const setAmount = (inv: Inv, amountC: number) => {
    inv.amountC = amountC;
    if (inv.pays.length === 1) inv.pays[0].amountC = amountC;
    else if (inv.pays.length === 2) {
      const first = Math.round(amountC * 0.5);
      inv.pays[0].amountC = first;
      inv.pays[1].amountC = amountC - first;
    }
  };
  const lineValueC = (r: Rcpt) => r.qty * lineById.get(r.lineId)!.priceC;

  // case 8 — A: billed for the full order although goods were short; B: price inflated
  const nA = rngI.int(2, 3);
  const nB = rngI.int(2, 3);
  let doneA = 0;
  for (const inv of eligible()) {
    if (doneA >= nA) break;
    const myR = rcptsByPo.get(inv.poId) ?? [];
    const single = myR.filter(
      (r) => myR.filter((x) => x.lineId === r.lineId).length === 1 && lineById.get(r.lineId)!.qty >= 6 && r.qty === lineById.get(r.lineId)!.qty,
    );
    if (single.length === 0) continue;
    const target = single.sort((a, b) => lineValueC(b) - lineValueC(a))[0];
    const newQty = Math.max(1, Math.floor(target.qty * rngI.float(0.4, 0.7)));
    if ((target.qty - newQty) * lineById.get(target.lineId)!.priceC < 5000) continue;
    target.qty = newQty;
    inv.tags.add('c8A');
    taken.add(inv);
    doneA++;
  }
  let doneB = 0;
  for (const inv of eligible()) {
    if (doneB >= nB) break;
    setAmount(inv, Math.round(inv.amountC * rngI.float(1.06, 1.35)));
    inv.tags.add('c8B');
    taken.add(inv);
    doneB++;
  }
  invs.filter((i) => i.tags.has('c8C')).forEach((i) => taken.add(i));

  // case 3 — the same supplier invoice entered twice and paid twice
  const dupCopies: Inv[] = [];
  const mkCopy = (orig: Inv, status: Inv['status']): Inv => {
    const invDay = orig.invDay + rngI.int(1, 7);
    const copy: Inv = {
      ...orig,
      invDay,
      dueDay: invDay + orig.terms,
      status,
      enteredBy: rngI.pick(apClerks).id,
      pays: [],
      tags: new Set(),
      note: null,
      id: 0,
    };
    dupCopies.push(copy);
    return copy;
  };
  let done3 = 0;
  const nDup = rngI.int(3, 5);
  for (const orig of eligible()) {
    if (done3 >= nDup) break;
    if (orig.pays.length === 0 || orig.dueDay > D_ASOF - 60) continue;
    const copy = mkCopy(orig, 'posted');
    const payDay = copy.dueDay + rngI.int(-3, 9);
    copy.pays = [{ day: payDay, amountC: copy.amountC, method: 'EFT', paidBy: rngI.pick(apClerks).id, ref: `EFT${pad(rngI.int(0, 99_999_999), 8)}`, id: 0 }];
    orig.tags.add('c3');
    copy.tags.add('c3');
    taken.add(orig);
    done3++;
  }
  let doneVoid = 0;
  for (const orig of eligible()) {
    if (doneVoid >= 4) break;
    if (orig.pays.length === 0 || orig.dueDay > D_ASOF - 60) continue;
    const copy = mkCopy(orig, 'void');
    orig.tags.add('c3void');
    copy.tags.add('c3void');
    taken.add(orig);
    doneVoid++;
  }

  // case 2 — approved, long overdue, never paid
  let done2 = 0;
  const n2 = rngI.int(3, 6);
  for (const inv of eligible()) {
    if (done2 >= n2) break;
    if (inv.pays.length === 0 || inv.dueDay > D_ASOF - (OVERDUE_DAYS + 5)) continue;
    inv.pays = [];
    inv.tags.add('c2');
    taken.add(inv);
    done2++;
  }
  const decoyUnpaid = (count: number, tag: string, status: Inv['status'], pred: (i: Inv) => boolean) => {
    let n = 0;
    for (const inv of eligible()) {
      if (n >= count) break;
      if (inv.pays.length === 0 || !pred(inv)) continue;
      inv.pays = [];
      inv.status = status;
      inv.tags.add(tag);
      taken.add(inv);
      n++;
    }
  };
  decoyUnpaid(3, 'c2disputed', 'disputed', (i) => i.dueDay <= D_ASOF - 70);
  decoyUnpaid(3, 'c2void', 'void', (i) => i.dueDay <= D_ASOF - 70);
  decoyUnpaid(5, 'c2near', 'posted', (i) => i.dueDay >= D_ASOF - 55 && i.dueDay <= D_ASOF - 32);

  // finalise invoices (+ duplicate copies), assign ids, payments
  const allInvs = [...invs, ...dupCopies].sort(
    (a, b) => a.invDay - b.invDay || a.poId - b.poId || (a.status === 'void' ? 1 : 0) - (b.status === 'void' ? 1 : 0),
  );
  allInvs.forEach((inv, i) => (inv.id = i + 1));
  const allPays: { pay: Pay; inv: Inv }[] = [];
  for (const inv of allInvs) for (const p of inv.pays) allPays.push({ pay: p, inv });
  allPays.sort((a, b) => a.pay.day - b.pay.day || a.inv.id - b.inv.id);
  allPays.forEach((x, i) => (x.pay.id = i + 1));

  // receipts: ids in chronological order
  rcpts.sort((a, b) => a.day - b.day || a.lineId - b.lineId);
  rcpts.forEach((r, i) => (r.id = i + 1));

  // audit log ids in chronological order
  audits.sort((a, b) => a.ts - b.ts || a.poId - b.poId);
  audits.forEach((a, i) => (a.id = i + 1));

  // ── second file: notes, cheque numbers, vendor files, watchlist ───────────
  progress('Notes, cheques and vendor files');

  // case 10 — free-text notes on invoices; a few vendors have almost every invoice marked urgent
  const rngN = root.fork('notes');
  const CHATTER = [
    'Matches PO and goods receipt',
    'Freight included per quote',
    'Vendor confirmed amount by email',
    'Queried with vendor, resolved',
    'Recurring monthly order',
    'Credit note to follow separately',
  ];
  const URGENT = [
    'URGENT - pay on receipt',
    'Urgent payment requested by manager',
    'asap per Procurement',
    'ASAP, vendor threatening to stop supply',
    'Please expedite - urgent',
    'Urgent: do not wait for the due date',
  ];
  for (const inv of allInvs) inv.note = rngN.chance(0.12) ? rngN.pick(CHATTER) : null;
  const invsOfVendor = new Map<number, Inv[]>();
  for (const inv of allInvs) invsOfVendor.set(inv.vendorId, [...(invsOfVendor.get(inv.vendorId) ?? []), inv]);
  const noteable = rngN.shuffle(vendors.filter((v) => !v.ghostOwner && v.status === 'active' && (invsOfVendor.get(v.id)?.length ?? 0) >= 12));
  if (noteable.length < 9) throw new Error('not enough busy vendors for the notes case');
  const markUrgent = (v: Vendor, k: number) => {
    for (const inv of rngN.sample(invsOfVendor.get(v.id)!, k)) inv.note = rngN.pick(URGENT);
  };
  const urgentVendors = noteable.splice(0, rngN.int(3, 4));
  for (const v of urgentVendors) {
    const n = invsOfVendor.get(v.id)!.length;
    markUrgent(v, Math.min(n - 1, Math.ceil(n * rngN.float(0.6, 0.8))));
  }
  const edgeVendors = noteable.splice(0, 2);
  for (const v of edgeVendors) markUrgent(v, Math.floor(invsOfVendor.get(v.id)!.length * rngN.float(0.35, 0.45)));
  const fewVendors = noteable.splice(0, 3);
  for (const v of fewVendors) markUrgent(v, rngN.int(2, 3));

  // case 11 — cheques are numbered in sequence; a handful of numbers were never recorded
  const rngC = root.fork('cheques');
  const chequePays = allPays.filter((x) => x.pay.method === 'CHEQUE');
  if (chequePays.length < 40) throw new Error('too few cheque payments');
  let chequeNo = 100_200 + rngC.int(0, 700);
  const gapAt = new Set<number>();
  const wantGaps = rngC.int(3, 5);
  for (let a = 0; gapAt.size < wantGaps && a < 300; a++) {
    const i = rngC.int(3, chequePays.length - 4);
    if ([...gapAt].every((g) => Math.abs(g - i) > 5)) gapAt.add(i);
  }
  const missingCheques: number[] = [];
  chequePays.forEach(({ pay }, i) => {
    if (gapAt.has(i)) missingCheques.push(chequeNo++);
    pay.ref = `CHQ${chequeNo++}`;
  });
  for (const { pay } of allPays) if (pay.method !== 'CHEQUE') pay.ref = `${pay.method === 'EFT' ? 'EFT' : 'BPY'}${pay.ref.slice(3)}`;

  // case 14 — onboarding forms stored as JSON; "thin files" have most checks undone and a personal email
  const rngF = root.fork('profiles');
  const CITIES: Record<string, [string, string][]> = {
    AU: [
      ['Sydney', 'NSW'],
      ['Melbourne', 'VIC'],
      ['Brisbane', 'QLD'],
      ['Perth', 'WA'],
      ['Adelaide', 'SA'],
      ['Newcastle', 'NSW'],
    ],
    NZ: [
      ['Auckland', 'AKL'],
      ['Wellington', 'WGN'],
      ['Christchurch', 'CAN'],
    ],
    SG: [['Singapore', 'SG']],
    TW: [
      ['Taipei', 'TPE'],
      ['Taichung', 'TXG'],
    ],
  };
  const STREETS = ['Foundry Rd', 'Dock St', 'Industrial Ave', 'Mill Lane', 'Harbour Pde', 'Depot Way', 'Warehouse Cres'];
  const slugOf = (name: string) =>
    name
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/\b(pty|ltd|co|inc|limited)\b/g, '')
      .replace(/[^a-z]/g, '');
  const PERSONAL = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com.au'];
  type ProfileKind = 'normal' | 'thin' | 'oneCheck' | 'corporate' | 'solo';
  const kindOfVendor = new Map<number, ProfileKind>();
  const spare = rngF.shuffle(vendors.filter((v) => !claimedVendors.has(v.id) && v.status === 'active' && !v.ghostOwner));
  for (const g of ghosts) kindOfVendor.set(g.id, 'thin');
  const assign = (kind: ProfileKind, n: number) => spare.splice(0, n).forEach((v) => kindOfVendor.set(v.id, kind));
  assign('thin', rngF.int(2, 3));
  assign('oneCheck', 3);
  assign('corporate', 3);
  assign('solo', 2);
  for (const v of vendors) {
    const kind = kindOfVendor.get(v.id) ?? 'normal';
    const first = rngF.pick(masters.firstNames);
    const last = rngF.pick(masters.lastNames);
    const personalMail = kind === 'thin' || kind === 'oneCheck' || kind === 'solo';
    const email = personalMail
      ? `${first}.${last}${rngF.int(1, 99)}@${rngF.pick(PERSONAL)}`.toLowerCase().replace(/[^a-z0-9.@]/g, '')
      : `${rngF.pick(['accounts', 'sales', 'orders', 'ar'])}@${slugOf(v.name)}.example`;
    const [city, state] = rngF.pick(CITIES[v.country] ?? CITIES.AU);
    const checkNames = ['abn_verified', 'bank_verified', 'site_visit'] as const;
    const failed = new Set<string>();
    if (kind === 'thin' || kind === 'corporate') for (const c of rngF.sample([...checkNames], rngF.int(2, 3))) failed.add(c);
    if (kind === 'oneCheck') failed.add(rngF.pick([...checkNames]));
    v.profile = {
      contact: { name: `${first} ${last}`, email, phone: `+61 ${rngF.int(2, 8)} ${rngF.int(5000, 9999)} ${rngF.int(1000, 9999)}` },
      address: { line1: kind === 'thin' ? `PO Box ${rngF.int(100, 9999)}` : `${rngF.int(1, 180)} ${rngF.pick(STREETS)}`, city, state },
      checks: Object.fromEntries(checkNames.map((c) => [c, !failed.has(c)])),
      directors:
        kind === 'thin'
          ? [`${first} ${last}`]
          : Array.from({ length: rngF.int(1, 3) }, () => `${rngF.pick(masters.firstNames)} ${rngF.pick(masters.lastNames)}`),
    };
  }

  // case 16 — a compliance watchlist that already holds two rows
  const rngW = root.fork('watchlist');
  const listedBefore = (ds: number) => isoDay(dayNum('2025-01-15') + ds);
  const watchlist: { vendorId: number; reason: string; day: string }[] = [
    { vendorId: inactive[0].id, reason: 'Late deliveries', day: listedBefore(rngW.int(10, 120)) },
    {
      vendorId: rngW.pick(vendors.filter((v) => v.status === 'active' && !v.ghostOwner && !claimedVendors.has(v.id))).id,
      reason: 'Price dispute',
      day: listedBefore(rngW.int(130, 260)),
    },
  ];

  // ── inventory movements ───────────────────────────────────────────────
  progress('Stock ledger');
  const rngS = root.fork('stock');
  const movesByProduct = new Map<number, ProdMove[]>();
  const rcptsByProduct = new Map<number, Rcpt[]>();
  for (const r of rcpts) rcptsByProduct.set(r.productId, [...(rcptsByProduct.get(r.productId) ?? []), r]);
  let seq = 0;
  for (const p of products) {
    const myR = rcptsByProduct.get(p.id) ?? [];
    const events: Omit<ProdMove, 'trueBal' | 'recBal' | 'id'>[] = [];
    const opening = p.listPriceC > 50_000 ? rngS.int(2, 12) : rngS.int(30, 300);
    events.push({ day: D0, type: 'OPENING', qty: opening, refType: null, refId: null, seq: seq++, productId: p.id });
    for (const r of myR) events.push({ day: r.day, type: 'RECEIPT', qty: r.qty, refType: 'GR', refId: r.id, seq: seq++, productId: p.id });
    const avgIn = myR.length ? myR.reduce((s, r) => s + r.qty, 0) / myR.length : 10;
    const nIssue = Math.round(myR.length * rngS.float(0.35, 0.6));
    for (let i = 0; i < nIssue; i++)
      events.push({ day: rngS.int(D0 + 1, D_ASOF), type: 'ISSUE', qty: 0, refType: 'SO', refId: rngS.int(100_000, 999_999), seq: seq++, productId: p.id });
    const nAdj = Math.round((myR.length + nIssue) / 40);
    for (let i = 0; i < nAdj; i++)
      events.push({ day: rngS.int(D0 + 30, D_ASOF), type: 'ADJUST', qty: 0, refType: 'ST', refId: null, seq: seq++, productId: p.id });
    events.sort((a, b) => a.day - b.day || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.seq - b.seq);

    const moves: ProdMove[] = [];
    let bal = 0;
    for (const e of events) {
      if (e.type === 'ISSUE') {
        if (bal <= 0) continue;
        e.qty = -Math.min(bal, Math.max(1, Math.round(avgIn * rngS.float(0.8, 2.0))));
      } else if (e.type === 'ADJUST') {
        const mag = rngS.int(1, 5);
        e.qty = rngS.chance(0.6) ? -Math.min(mag, bal) : mag;
        if (e.qty === 0) continue;
      }
      bal += e.qty;
      moves.push({ ...e, trueBal: bal, recBal: bal, id: 0 });
    }
    movesByProduct.set(p.id, moves);
  }

  // case 7 — stock balance silently drifts away from the running total
  const drifted: ProdMove[] = [];
  const driftCandidates = rngS.shuffle(products.filter((p) => (movesByProduct.get(p.id)?.length ?? 0) >= 40));
  const nDrift = rngS.int(3, 5);
  for (const p of driftCandidates.slice(0, nDrift)) {
    const moves = movesByProduct.get(p.id)!;
    const k = rngS.int(10, moves.length - 12);
    const minBal = Math.min(...moves.slice(k).map((m) => m.trueBal));
    const d = minBal >= 4 && rngS.chance(0.7) ? -rngS.int(2, Math.min(30, minBal)) : rngS.int(5, 40);
    for (let i = k; i < moves.length; i++) moves[i].recBal = moves[i].trueBal + d;
    moves[k].drift = true;
    drifted.push(moves[k]);
  }
  const allMoves = [...movesByProduct.values()]
    .flat()
    .sort((a, b) => a.day - b.day || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.productId - b.productId || a.seq - b.seq);
  allMoves.forEach((m, i) => (m.id = i + 1));

  // ── assemble table rows ───────────────────────────────────────────────
  progress('Assembling tables');
  const tables = {} as TableRows;
  tables.departments = masters.departments.map((d) => [d.deptId, d.name, d.costCenter]);
  tables.employees = emps.map((e) => [e.id, e.name, e.email, e.deptId, e.title, e.managerId, isoDay(e.hireDay), e.status, e.bank]);
  tables.vendors = vendors.map((v) => [
    v.id,
    v.name,
    v.country,
    v.category,
    v.terms,
    v.bankText,
    v.taxId,
    v.status,
    v.onboardedBy,
    isoDay(v.onboardedDay),
    JSON.stringify(v.profile),
  ]);
  tables.products = products.map((p) => [p.id, p.sku, p.name, p.category, p.unit, money(p.listPriceC)]);
  tables.purchase_orders = skels.map((s) => [
    s.id,
    s.number,
    s.vendor.id,
    s.requester.deptId,
    s.requester.id,
    s.approver.id,
    isoTs(s.createdSec),
    isoTs(s.approvedSec),
    money(s.totalC),
    poStatus.get(s.id)!,
    s.replaces ? s.replaces.id : null,
  ]);
  tables.po_lines = lineRows.map((l) => [l.id, l.poId, l.no, l.productId, l.qty, money(l.priceC)]);
  tables.goods_receipts = rcpts.map((r) => [r.id, r.lineId, r.qty, isoDay(r.day), r.by]);
  tables.invoices = allInvs.map((i) => [
    i.id,
    i.number,
    i.vendorId,
    i.poId,
    isoDay(i.invDay),
    isoDay(i.dueDay),
    money(i.amountC),
    i.status,
    i.enteredBy,
    i.note,
  ]);
  tables.payments = allPays.map(({ pay, inv }) => [pay.id, inv.id, isoDay(pay.day), money(pay.amountC), pay.method, pay.paidBy, pay.ref]);
  tables.po_audit_log = audits.map((a) => [a.id, a.poId, a.by, isoTs(a.ts), a.field, a.oldV, a.newV]);
  tables.inventory_movements = allMoves.map((m) => [m.id, m.productId, isoDay(m.day), m.type, m.qty, m.recBal, m.refType, m.refId]);
  tables.vendor_watchlist = watchlist.map((w) => [w.vendorId, w.reason, w.day]);
  // sanity: column counts line up with the schema
  for (const t of LOAD_ORDER) {
    const w = insertColumns(t).length;
    if (tables[t].some((r) => r.length !== w)) throw new Error(`row width mismatch in ${t}`);
  }

  // ── ground truth ──────────────────────────────────────────────────────
  const poNumbers = (pred: (s: Skel) => boolean) => skels.filter(pred).map((s) => s.number);
  const invIds = (pred: (i: Inv) => boolean) => allInvs.filter(pred).map((i) => i.id);
  const uniq = <T>(a: T[]) => [...new Set(a)];
  const minus = (a: Id[], b: Id[]) => a.filter((x) => !b.includes(x));

  const t1 = poNumbers((s) => s.audit === 'raise');
  const t3 = uniq(allInvs.filter((i) => i.tags.has('c3')).map((i) => i.number));
  const t4 = poNumbers((s) => s.tags.includes('c4'));
  const t5 = uniq(skels.filter((s) => s.tags.includes('c5')).map((s) => s.requester.id));
  const t6 = ghosts.map((g) => g.id);
  const t7 = drifted.map((m) => m.id);
  const rcvValue = new Map<number, number>();
  for (const r of rcpts) rcvValue.set(r.poId, (rcvValue.get(r.poId) ?? 0) + lineValueC(r));
  const t8 = invIds((i) => i.tags.has('c8A') || i.tags.has('c8B') || i.tags.has('c8C'));
  const shortNormal = invIds(
    (i) => !i.tags.has('c8A') && !i.tags.has('c8B') && !i.tags.has('c8C') && i.status !== 'void' && (rcvValue.get(i.poId) ?? 0) < skels[i.poId - 1].totalC,
  );
  const instalments = uniq(allInvs.filter((i) => i.pays.length === 2 && !i.tags.has('c3')).map((i) => i.number));

  const truth: Record<number, CaseTruth> = {
    1: {
      answer: t1,
      decoys: [
        { key: 'lower', ids: poNumbers((s) => s.audit === 'lower') },
        { key: 'preraise', ids: poNumbers((s) => s.audit === 'preraise') },
        { key: 'benignPost', ids: poNumbers((s) => s.audit === 'benignPost') },
      ],
    },
    2: {
      answer: invIds((i) => i.tags.has('c2')),
      decoys: [
        { key: 'disputed', ids: invIds((i) => i.tags.has('c2disputed')) },
        { key: 'void', ids: invIds((i) => i.tags.has('c2void')) },
        { key: 'near', ids: invIds((i) => i.tags.has('c2near')) },
      ],
    },
    3: {
      answer: t3,
      decoys: [
        { key: 'voidDup', ids: uniq(allInvs.filter((i) => i.tags.has('c3void')).map((i) => i.number)) },
        { key: 'instalment', ids: instalments },
      ],
    },
    4: { answer: t4, decoys: [{ key: 'small', ids: poNumbers((s) => s.tags.includes('c4decoy')) }] },
    5: {
      answer: t5,
      decoys: [
        { key: 'under', ids: minus(uniq(skels.filter((s) => s.tags.includes('c5under')).map((s) => s.requester.id)), t5) },
        { key: 'big', ids: minus(uniq(skels.filter((s) => s.tags.includes('c5big')).map((s) => s.requester.id)), t5) },
      ],
    },
    6: {
      answer: t6,
      decoys: [
        { key: 'shared', ids: [dv1.id, dv2.id] },
        { key: 'near', ids: [dvNear.id] },
      ],
    },
    7: { answer: t7, decoys: [] },
    8: {
      answer: t8,
      decoys: [{ key: 'shortNormal', ids: shortNormal }],
    },
    9: { answer: [M.id], decoys: [{ key: 'partial', ids: [A.id, B.id, C.id, X.id] }] },
  };

  // ── second file: ground truth ─────────────────────────────────────────
  // 10 — vendors where more than half of at least six invoices carry an urgent note
  const isUrgent = (n: string | null) => n !== null && /urgent|asap/i.test(n);
  const urgentShare = (v: Vendor) => {
    const list = invsOfVendor.get(v.id) ?? [];
    return { n: list.length, k: list.filter((i) => isUrgent(i.note)).length };
  };
  truth[10] = {
    answer: vendors.filter((v) => urgentShare(v).n >= 6 && urgentShare(v).k * 2 > urgentShare(v).n).map((v) => v.id),
    decoys: [
      { key: 'edge', ids: edgeVendors.map((v) => v.id) },
      { key: 'few', ids: fewVendors.map((v) => v.id) },
    ],
  };

  // 11 — cheque numbers that were skipped
  truth[11] = { answer: missingCheques, decoys: [] };

  // 12 — an order line priced more than 10% above the previous order of the same product from the same vendor
  const lastPrice = new Map<string, number>();
  const lastPriceAny = new Map<number, number>();
  const t12: Id[] = [];
  const t12gradual: Id[] = [];
  const t12cross: Id[] = [];
  for (const l of lineRows) {
    const po = skels[l.poId - 1];
    const key = `${po.vendor.id}|${l.productId}`;
    const prev = lastPrice.get(key);
    const prevAny = lastPriceAny.get(l.productId);
    if (prev !== undefined && l.priceC * 10 > prev * 11) t12.push(l.id);
    else if (prevAny !== undefined && l.priceC * 10 > prevAny * 11) t12cross.push(l.id);
    if (prev !== undefined && po.tags.includes('c12gradual')) t12gradual.push(l.id);
    lastPrice.set(key, l.priceC);
    lastPriceAny.set(l.productId, l.priceC);
  }
  truth[12] = {
    answer: t12,
    decoys: [
      { key: 'gradual', ids: t12gradual },
      { key: 'crossVendor', ids: t12cross },
    ],
  };

  // 13 — the first PO of every chain that was re-issued four or more times
  const reissuedBy = new Map<Skel, Skel>();
  for (const sk of skels) if (sk.replaces) reissuedBy.set(sk.replaces, sk);
  const chainRoots = skels.filter((sk) => !sk.replaces && reissuedBy.has(sk));
  const chainLength = (root: Skel) => {
    let n = 1;
    for (let cur = root; reissuedBy.has(cur); cur = reissuedBy.get(cur)!) n++;
    return n;
  };
  truth[13] = {
    answer: chainRoots.filter((r) => chainLength(r) >= 5).map((r) => r.number),
    decoys: [{ key: 'short', ids: chainRoots.filter((r) => chainLength(r) < 5).map((r) => r.number) }],
  };

  // 14 — thin files: at least two checks not done and a personal email address
  const failedChecks = (v: Vendor) => Object.values((v.profile as { checks: Record<string, boolean> }).checks).filter((ok) => !ok).length;
  const personalEmail = (v: Vendor) => PERSONAL.some((d) => (v.profile as { contact: { email: string } }).contact.email.endsWith('@' + d));
  const vendorsOfKind = (k: ProfileKind) => vendors.filter((v) => (kindOfVendor.get(v.id) ?? 'normal') === k).map((v) => v.id);
  truth[14] = {
    answer: vendors.filter((v) => failedChecks(v) >= 2 && personalEmail(v)).map((v) => v.id),
    decoys: [
      { key: 'oneCheck', ids: vendorsOfKind('oneCheck') },
      { key: 'corporate', ids: vendorsOfKind('corporate') },
      { key: 'solo', ids: vendorsOfKind('solo') },
    ],
  };

  // 15 — undo the double payments: later copies void, their payment rows gone, nothing else touched
  const dupGroups = new Map<string, Inv[]>();
  for (const inv of allInvs.filter((i) => i.tags.has('c3'))) {
    const k = `${inv.vendorId}|${inv.number}`;
    dupGroups.set(k, [...(dupGroups.get(k) ?? []), inv]);
  }
  const originals: Inv[] = [];
  const copiesToUndo: Inv[] = [];
  for (const g of dupGroups.values()) {
    g.sort((a, b) => a.id - b.id);
    originals.push(g[0]);
    copiesToUndo.push(...g.slice(1));
  }
  const voidAfter = [...new Set([...allInvs.filter((i) => i.status === 'void').map((i) => i.id), ...copiesToUndo.map((i) => i.id)])];
  truth[15] = {
    answer: [...voidAfter.map((id) => `void:${id}`), `payments:${allPays.length - copiesToUndo.reduce((n, i) => n + i.pays.length, 0)}`],
    decoys: [
      { key: 'original', ids: originals.map((i) => `void:${i.id}`) },
      { key: 'instalment', ids: allInvs.filter((i) => i.pays.length === 2 && !i.tags.has('c3')).map((i) => `void:${i.id}`) },
    ],
  };

  // 16 — upsert the inactive vendors onto the watchlist
  const inactiveIds = new Set(inactive.map((v) => v.id));
  const wlKey = (w: { vendorId: number; reason: string; day: string }) => `${w.vendorId}:${w.reason}:${w.day}`;
  truth[16] = {
    answer: [...inactive.map((v) => `${v.id}:${WATCH_REASON}:${WATCH_DATE}`), ...watchlist.filter((w) => !inactiveIds.has(w.vendorId)).map(wlKey)],
    decoys: [{ key: 'stale', ids: watchlist.filter((w) => inactiveIds.has(w.vendorId)).map(wlKey) }],
  };

  // 17 — each vendor's most recent posted invoice, kept in a table whose primary key is vendor_id
  const newest = new Map<number, Inv>();
  const oldest = new Map<number, Inv>();
  for (const inv of allInvs.filter((i) => i.status === 'posted')) {
    const n = newest.get(inv.vendorId);
    if (!n || inv.invDay > n.invDay || (inv.invDay === n.invDay && inv.id > n.id)) newest.set(inv.vendorId, inv);
    const o = oldest.get(inv.vendorId);
    if (!o || inv.invDay < o.invDay || (inv.invDay === o.invDay && inv.id < o.id)) oldest.set(inv.vendorId, inv);
  }
  truth[17] = {
    answer: [...[...newest.values()].map((i) => `${i.vendorId}:${i.id}`), 'pk'],
    decoys: [{ key: 'oldest', ids: [...oldest.values()].filter((i) => newest.get(i.vendorId) !== i).map((i) => `${i.vendorId}:${i.id}`) }],
  };

  // 18 — an index whose first column is payments.payment_date
  truth[18] = { answer: ['indexed'], decoys: [] };

  return {
    seed,
    tables,
    truth,
    story: {
      mastermind: { empId: M.id, name: M.name, title: M.title, dept: deptById.get(M.deptId)!.name },
      ghostVendors: ghosts.map((g) => ({ vendorId: g.id, vendorName: g.name, ownerName: empById.get(g.ghostOwner!)!.name })),
    },
  };
}
