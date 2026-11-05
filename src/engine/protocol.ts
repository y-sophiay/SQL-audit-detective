import type { CaseTruth, Dataset } from '../data/generator';

/**
 * case    read-only, always rolled back (query cases)
 * fix     a normal transaction that is always rolled back; a check query then reads the state the script left behind (hands-on cases)
 * sandbox one long transaction, kept until reset
 */
export type RunMode = 'case' | 'fix' | 'sandbox';

export interface FieldInfo {
  name: string;
  dataTypeID: number;
}

export interface StmtResult {
  /** the statement that produced this result (trimmed) */
  sql: string;
  kind: 'rows' | 'command';
  fields: FieldInfo[];
  rows: unknown[][];
  /** total rows PostgreSQL returned (rows[] may be truncated) */
  rowCount: number;
  truncated: boolean;
  affectedRows?: number;
  elapsedMs: number;
}

/** What the check query of a hands-on case returned after the player's script ran (before the rollback). */
export type VerifyOutcome = { ok: true; fields: FieldInfo[]; rows: unknown[][] } | { ok: false; message: string };

export interface RunSuccess {
  ok: true;
  results: StmtResult[];
  elapsedMs: number;
  schemaChanged: boolean;
  /** only for mode 'fix' when a check query was supplied */
  verify?: VerifyOutcome;
}

export interface RunFailure {
  ok: false;
  kind: 'sql' | 'blocked' | 'cost' | 'timeout';
  message: string;
  hint?: string;
  detail?: string;
  /** 0-based character offset into the editor text, when PostgreSQL reported one */
  position?: number;
}

export type RunOutcome = RunSuccess | RunFailure;

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
  fk: string | null;
  generated: boolean;
  comment: string | null;
}
export interface TableInfo {
  name: string;
  comment: string | null;
  columns: ColumnInfo[];
}

export interface ReadyInfo {
  seed: string;
  counts: Record<string, number>;
  truth: Record<number, CaseTruth>;
  story: Dataset['story'];
}

export type WorkerRequest =
  | { type: 'init'; seed: string }
  | { type: 'run'; id: number; sql: string; mode: RunMode; verify?: string }
  | { type: 'schema'; id: number }
  | { type: 'sandbox'; id: number; action: 'begin' | 'end' | 'reset' };

export type WorkerResponse =
  | { type: 'progress'; label: string; done: number; total: number }
  | ({ type: 'ready' } & ReadyInfo)
  | { type: 'fatal'; message: string }
  | { type: 'run'; id: number; outcome: RunOutcome }
  | { type: 'schema'; id: number; tables: TableInfo[] }
  | { type: 'sandbox'; id: number; ok: boolean };

export const LIMITS = {
  maxRows: 1000,
  maxStatements: 20,
  /** planner estimate above which a SELECT is refused (cartesian explosions, runaway joins) */
  maxPlanRows: 2_000_000,
  maxPlanCost: 2_000_000,
  timeoutMs: 12_000,
} as const;
