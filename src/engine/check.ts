import type { CaseDef } from '../cases';
import type { CaseTruth, Id } from '../data/generator';
import type { VerifyOutcome } from './protocol';

export interface ResultSet {
  fields: { name: string; dataTypeID: number }[];
  rows: unknown[][];
}

export type Verdict =
  | { status: 'no-result' }
  | { status: 'no-column'; column: string; have: string[] }
  | { status: 'verify-error'; message: string }
  | {
      status: 'wrong';
      expected: number;
      got: number;
      hit: number;
      missing: number;
      extra: number;
      messages: string[];
    }
  | { status: 'correct'; expected: number; duplicateRows: boolean };

/** Make 42, '42' and '42.0' compare equal; everything else compares as trimmed text. */
export function normaliseValue(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'bigint') return String(Number(v));
  const s = String(v ?? '').trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s;
}

export function checkAnswer(def: CaseDef, result: ResultSet | null, truth: CaseTruth): Verdict {
  if (!result || (result.rows.length === 0 && result.fields.length === 0)) return { status: 'no-result' };
  const idx = result.fields.findIndex((f) => f.name.toLowerCase() === def.answerColumn.toLowerCase());
  if (idx < 0) return { status: 'no-column', column: def.answerColumn, have: result.fields.map((f) => f.name) };

  const expected = new Set(truth.answer.map(normaliseValue));
  const gotList = result.rows
    .map((r) => r[idx])
    .filter((v) => v !== null && v !== undefined)
    .map(normaliseValue);
  const got = new Set(gotList);

  const hit = [...got].filter((x) => expected.has(x)).length;
  const missingIds = [...expected].filter((x) => !got.has(x));
  const extraIds = [...got].filter((x) => !expected.has(x));

  if (missingIds.length === 0 && extraIds.length === 0) {
    return { status: 'correct', expected: expected.size, duplicateRows: gotList.length !== got.size };
  }

  const messages: string[] = [];
  const extraSet = new Set(extraIds);
  for (const d of truth.decoys) {
    const msg = def.decoyMessages[d.key];
    if (msg && d.ids.some((id: Id) => extraSet.has(normaliseValue(id)))) messages.push(msg);
  }
  if (missingIds.length > 0 && def.decoyMessages['*missing']) messages.push(def.decoyMessages['*missing']);
  if (extraIds.length > 0 && messages.length === 0 && def.decoyMessages['*extra']) messages.push(def.decoyMessages['*extra']);
  if (messages.length === 0) {
    if (extraIds.length === 0)
      messages.push(
        'Your conditions may be too strict, or a JOIN filtered some rows out (an INNER JOIN drops rows that have no match on the right-hand table).',
      );
    else if (missingIds.length === 0) messages.push('You returned rows you should not have. Tighten your conditions.');
    else messages.push('Some are right and some are wrong. Re-check each condition for being too loose or too strict.');
  }
  return { status: 'wrong', expected: expected.size, got: got.size, hit, missing: missingIds.length, extra: extraIds.length, messages };
}

/** Hands-on cases: judge the state read by the case's check query after the player's script ran. */
export function checkState(def: CaseDef, verify: VerifyOutcome | undefined, truth: CaseTruth): Verdict {
  if (!verify) return { status: 'no-result' };
  if (!verify.ok) return { status: 'verify-error', message: verify.message };
  return checkAnswer(def, { fields: verify.fields, rows: verify.rows }, truth);
}
