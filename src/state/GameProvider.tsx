import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { newCaseCode } from '../data/rng';
import { SqlEngine, type BootProgress } from '../engine/client';
import type { ReadyInfo, TableInfo } from '../engine/protocol';
import { detectFeatures } from '../lib/features';
import { emptyProgress, loadStore, newSave, persist, progressOf, solvedCount, totalScore, type CaseProgress, type SaveFile, type Store } from './game';

export interface Toast {
  id: number;
  text: string;
}

export interface Game {
  engine: SqlEngine;
  /** null while the database for the current seed is being built */
  info: ReadyInfo | null;
  boot: BootProgress | null;
  bootError: string | null;
  tables: TableInfo[];
  refreshSchema: () => Promise<void>;
  /** bumps whenever the database was rebuilt behind the player's back (timeout) */
  epoch: number;
  save: SaveFile;
  history: Store['history'];
  progress: (id: number) => CaseProgress;
  patchCase: (id: number, fn: (p: CaseProgress) => CaseProgress) => void;
  markPractised: (sql: string) => void;
  newGame: () => void;
  restartSame: () => void;
  toasts: Toast[];
  toast: (text: string) => void;
}

const Ctx = createContext<Game | null>(null);

export function useGame(): Game {
  const g = useContext(Ctx);
  if (!g) throw new Error('useGame outside GameProvider');
  return g;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new SqlEngine());
  const [store, setStore] = useState<Store>(() => {
    const s = loadStore();
    return s.save ? s : { ...s, save: newSave(newCaseCode()) };
  });
  const [info, setInfo] = useState<ReadyInfo | null>(null);
  const [boot, setBoot] = useState<BootProgress | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [epoch, setEpoch] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const save = store.save as SaveFile;
  const seed = save.seed;

  useEffect(() => persist(store), [store]);

  const toast = useCallback((text: string) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refreshSchema = useCallback(async () => {
    try {
      setTables(await engine.schema());
    } catch {
      /* engine restarting — the next refresh will catch up */
    }
  }, [engine]);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setBootError(null);
    setBoot({ label: 'Preparing', done: 0, total: 1 });
    engine.onProgress = (p) => !cancelled && setBoot(p);
    engine
      .start(seed)
      .then(async (r) => {
        if (cancelled) return;
        setInfo(r);
        setBoot(null);
        setTables(await engine.schema());
      })
      .catch((e: unknown) => {
        if (!cancelled) setBootError(String((e as Error)?.message ?? e));
      });
    return () => {
      cancelled = true;
      engine.dispose();
    };
  }, [engine, seed]);

  useEffect(() => {
    engine.onRebuildStart = () => toast('Query timed out. Rebuilding the database from the same data…');
    engine.onRebuild = () => {
      setEpoch((e) => e + 1);
      void refreshSchema();
      toast('Database rebuilt (sandbox changes were reset)');
    };
  }, [engine, toast, refreshSchema]);

  const patchCase = useCallback((id: number, fn: (p: CaseProgress) => CaseProgress) => {
    setStore((s) => {
      const cur = s.save as SaveFile;
      return { ...s, save: { ...cur, progress: { ...cur.progress, [id]: fn(progressOf(cur, id)) } } };
    });
  }, []);

  const markPractised = useCallback((sql: string) => {
    const ids = detectFeatures(sql);
    if (ids.length === 0) return;
    setStore((s) => {
      const cur = s.save as SaveFile;
      const have = new Set(cur.practised);
      if (ids.every((i) => have.has(i))) return s;
      ids.forEach((i) => have.add(i));
      return { ...s, save: { ...cur, practised: [...have] } };
    });
  }, []);

  const newGame = useCallback(() => {
    setStore((s) => {
      const old = s.save as SaveFile;
      const played = Object.values(old.progress).some((p) => p.attempts > 0 || p.runs > 0);
      const history = played
        ? [{ seed: old.seed, finishedAt: Date.now(), solved: solvedCount(old), score: totalScore(old) }, ...s.history].slice(0, 20)
        : s.history;
      return { history, save: { ...newSave(newCaseCode()), practised: old.practised } };
    });
  }, []);

  const restartSame = useCallback(() => {
    setStore((s) => {
      const old = s.save as SaveFile;
      return { ...s, save: { ...newSave(old.seed), practised: old.practised } };
    });
  }, []);

  const value = useMemo<Game>(
    () => ({
      engine,
      info,
      boot,
      bootError,
      tables,
      refreshSchema,
      epoch,
      save,
      history: store.history,
      progress: (id: number) => progressOf(save, id) ?? emptyProgress(),
      patchCase,
      markPractised,
      newGame,
      restartSame,
      toasts,
      toast,
    }),
    [engine, info, boot, bootError, tables, refreshSchema, epoch, save, store.history, patchCase, markPractised, newGame, restartSame, toasts, toast],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
