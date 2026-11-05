import type { StmtResult } from '../engine/protocol';

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function resultToCsv(r: StmtResult): string {
  const lines = [r.fields.map((f) => cell(f.name)).join(',')];
  for (const row of r.rows) lines.push(row.map(cell).join(','));
  // BOM so that Excel opens the UTF-8 file correctly
  return '﻿' + lines.join('\r\n');
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
