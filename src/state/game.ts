import type { CaseDef } from '../cases';

export interface CaseProgress {
  solved: boolean;
  gaveUp: boolean;
  /** submissions made */
  attempts: number;
  runs: number;
  /** hint levels revealed, 0–3 */
  hints: number;
  score: number;
  msSpent: number;
  lastSql: string;
  solvedSql: string | null;
  solvedAt: number | null;
}

export interface SaveFile {
  v: 1;
  seed: string;
  createdAt: number;
  progress: Record<number, CaseProgress>;
  /** ids of SQL features the player has successfully run (see lib/features) */
  practised: string[];
}

export interface HistoryEntry {
  seed: string;
  finishedAt: number;
  solved: number;
  score: number;
}

export interface Store {
  save: SaveFile | null;
  history: HistoryEntry[];
}

const KEY = 'ledger-detective:v1';

export const emptyProgress = (): CaseProgress => ({
  solved: false,
  gaveUp: false,
  attempts: 0,
  runs: 0,
  hints: 0,
  score: 0,
  msSpent: 0,
  lastSql: '',
  solvedSql: null,
  solvedAt: null,
});

export const newSave = (seed: string): SaveFile => ({ v: 1, seed, createdAt: Date.now(), progress: {}, practised: [] });

export const progressOf = (save: SaveFile | null, id: number): CaseProgress => ({ ...emptyProgress(), ...(save?.progress[id] ?? {}) });

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Store;
      if (parsed && Array.isArray(parsed.history) && (parsed.save === null || parsed.save?.v === 1)) return parsed;
    }
  } catch {
    /* private mode or corrupt data: start fresh */
  }
  return { save: null, history: [] };
}

export function persist(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or unavailable — the game still works, it just will not resume */
  }
}

/** 100 points, minus 10 per hint level, minus 5 per wrong submission (up to 6), never below 20. */
export function scoreOnSolve(hints: number, wrongSubmissions: number): number {
  return Math.max(20, 100 - 10 * hints - 5 * Math.min(6, wrongSubmissions));
}

export const solvedCount = (save: SaveFile | null) => Object.values(save?.progress ?? {}).filter((p) => p.solved).length;
export const totalScore = (save: SaveFile | null) => Object.values(save?.progress ?? {}).reduce((s, p) => s + (p.solved ? p.score : 0), 0);

export function isUnlocked(def: CaseDef, save: SaveFile | null): boolean {
  if (!def.unlockAfterSolved) return true;
  const others = Object.entries(save?.progress ?? {}).filter(([id, p]) => Number(id) !== def.id && p.solved).length;
  return others >= def.unlockAfterSolved;
}

export function rankOf(total: number, solved: number, caseCount: number): string {
  const per = total / Math.max(1, caseCount);
  if (solved === caseCount && per >= 83) return 'Chief Audit Officer';
  if (per >= 61) return 'Senior Auditor';
  if (per >= 28) return 'Auditor';
  return 'Junior Auditor';
}

export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'under 1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
