/**
 * Export the game's data to Excel.
 *   npm run export:xlsx                 # seed DEMO42 → exports/ledger-detective-DEMO42.xlsx (+ master-data.xlsx)
 *   npm run export:xlsx -- K7QX2M       # a specific case code
 *   npm run export:xlsx -- K7QX2M --with-answers   # also add the answer-key sheet (spoilers!)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { CASES } from '../src/cases';
import { generateDataset, type Cell } from '../src/data/generator';
import { LOAD_ORDER, TABLES, insertColumns, type TableDef } from '../src/data/schema';
import { erdMermaid } from '../src/data/docs';
import { loadMastersFromDisk, MASTER_DIR } from './_masters-node';
import { normaliseCaseCode } from '../src/data/rng';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/data/csv';

const args = process.argv.slice(2);
const withAnswers = args.includes('--with-answers');
const seed = normaliseCaseCode(args.find((a) => !a.startsWith('--')) ?? 'DEMO42');
const outDir = join(import.meta.dirname, '..', 'exports');
mkdirSync(outDir, { recursive: true });

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFE6' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FF174F3E' } };

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle' };
  row.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

function fit(ws: ExcelJS.Worksheet, rows: Cell[][], header: string[]) {
  header.forEach((h, i) => {
    const sample = rows.slice(0, 300).reduce((m, r) => Math.max(m, String(r[i] ?? '').length), h.length);
    ws.getColumn(i + 1).width = Math.min(46, Math.max(10, sample + 2));
  });
}

function typed(def: TableDef, colName: string, v: Cell): ExcelJS.CellValue {
  if (v === null) return null;
  const col = def.columns.find((c) => c.name === colName)!;
  const t = col.type.toUpperCase();
  if (typeof v === 'string' && t === 'DATE') return new Date(`${v}T00:00:00Z`);
  if (typeof v === 'string' && t.startsWith('TIMESTAMP')) return new Date(`${v.replace(' ', 'T')}Z`);
  if (typeof v === 'string' && t.startsWith('NUMERIC')) return Number(v);
  return v;
}

function numFmt(def: TableDef, colName: string): string | undefined {
  const t = def.columns.find((c) => c.name === colName)!.type.toUpperCase();
  if (t === 'DATE') return 'yyyy-mm-dd';
  if (t.startsWith('TIMESTAMP')) return 'yyyy-mm-dd hh:mm:ss';
  if (t.startsWith('NUMERIC')) return '#,##0.00';
  return undefined;
}

async function dataWorkbook() {
  const ds = generateDataset(seed, loadMastersFromDisk());
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ledger Detective';

  const readme = wb.addWorksheet('README');
  readme.columns = [{ width: 110 }];
  [
    `Ledger Detective: full data for case code ${seed}`,
    '',
    'This workbook is an Excel version of the same data. Its columns match the PostgreSQL tables in the game exactly. Use it to:',
    '1. Hunt for anomalies by eye first with filters and pivot tables, then confirm them with SQL.',
    '2. Read the data dictionary to understand each column and how the tables relate.',
    '',
    'Note: generated columns (po_date, line_amount) are computed by PostgreSQL in the database and are not included here.',
    withAnswers
      ? 'This file includes the Answers sheet (spoilers).'
      : 'This file contains no answers. To add them: npm run export:xlsx -- ' + seed + ' --with-answers',
    '',
    'Tables (row counts):',
    ...LOAD_ORDER.map((t) => `${t}: ${ds.tables[t].length.toLocaleString()} rows. ${TABLES.find((x) => x.name === t)!.comment}`),
  ].forEach((line, i) => {
    const c = readme.getCell(i + 1, 1);
    c.value = line;
    if (i === 0) c.font = { bold: true, size: 14, color: { argb: 'FF174F3E' } };
    c.alignment = { wrapText: true };
  });

  const dict = wb.addWorksheet('Data dictionary');
  dict.addRow(['Table', 'Column', 'Type', 'PK', 'FK', 'Required', 'Description']);
  for (const t of TABLES) {
    for (const c of t.columns) dict.addRow([t.name, c.name, c.type, c.pk ? 'PK' : '', c.fk ?? '', c.notNull || c.pk ? 'Yes' : '', c.comment]);
  }
  [16, 20, 16, 6, 28, 6, 70].forEach((w, i) => (dict.getColumn(i + 1).width = w));
  styleHeader(dict);

  const erd = wb.addWorksheet('ER diagram (Mermaid)');
  erd.getColumn(1).width = 90;
  erd.getCell(1, 1).value = 'Paste this into https://mermaid.live to see the diagram:';
  erdMermaid()
    .split('\n')
    .forEach((l, i) => (erd.getCell(i + 3, 1).value = l));
  erd.getColumn(1).font = { name: 'Consolas' };

  for (const name of LOAD_ORDER) {
    const def = TABLES.find((t) => t.name === name)!;
    const cols = insertColumns(name);
    const ws = wb.addWorksheet(name);
    ws.addRow(cols);
    for (const r of ds.tables[name]) ws.addRow(r.map((v, i) => typed(def, cols[i], v)));
    cols.forEach((c, i) => {
      const f = numFmt(def, c);
      if (f) ws.getColumn(i + 1).numFmt = f;
    });
    fit(ws, ds.tables[name], cols);
    styleHeader(ws);
  }

  if (withAnswers) {
    const ws = wb.addWorksheet('Answers (spoilers)');
    ws.addRow(['Case', 'Title', 'Answer column', 'Answer', 'Decoy type', 'Decoys']);
    for (const c of CASES) {
      const truth = ds.truth[c.id];
      ws.addRow([c.id, c.title, c.answerColumn, truth.answer.join(', '), '', '']);
      for (const d of truth.decoys) ws.addRow(['', '', '', '', d.key, d.ids.join(', ')]);
    }
    [8, 18, 16, 60, 14, 60].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    styleHeader(ws);
  }

  const file = join(outDir, `ledger-detective-${seed}.xlsx`);
  await wb.xlsx.writeFile(file);
  console.log('wrote', file);
}

/** The editable master data, as one workbook: change names, products, vendors, then save back as CSV (UTF-8). */
async function mastersWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheets: string[] = ['departments', 'products', 'vendors', 'first_names', 'last_names'];
  for (const file of sheets) {
    const rows = parseCsv(readFileSync(join(MASTER_DIR, `${file}.csv`), 'utf8'));
    const header = Object.keys(rows[0] ?? {});
    const ws = wb.addWorksheet(file.slice(0, 31));
    ws.addRow(header);
    rows.forEach((r) => ws.addRow(header.map((h) => r[h])));
    header.forEach((h, i) => {
      const w = rows.slice(0, 200).reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length);
      ws.getColumn(i + 1).width = Math.min(60, Math.max(10, w + 2));
    });
    styleHeader(ws);
  }
  const file = join(outDir, 'master-data.xlsx');
  await wb.xlsx.writeFile(file);
  console.log('wrote', file);
}

await dataWorkbook();
await mastersWorkbook();
