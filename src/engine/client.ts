import { LIMITS, type ReadyInfo, type RunFailure, type RunMode, type RunOutcome, type TableInfo, type WorkerRequest, type WorkerResponse } from './protocol';

export interface BootProgress {
  label: string;
  done: number;
  total: number;
}

type Pending = {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * Main-thread handle to the PostgreSQL worker.
 * The database lives in a Web Worker so that a runaway query can be killed by simply
 * terminating the worker; the dataset is then rebuilt from the same seed in a few seconds.
 */
export class SqlEngine {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private seed = '';
  private booting: Promise<ReadyInfo> | null = null;
  private bootResolve?: (r: ReadyInfo) => void;
  private bootReject?: (e: Error) => void;

  ready: ReadyInfo | null = null;
  onProgress?: (p: BootProgress) => void;
  /** fired when the worker had to be rebuilt after a timeout (sandbox changes are lost) */
  onRebuild?: () => void;
  /** fired the moment a timeout forces the worker to be rebuilt */
  onRebuildStart?: () => void;

  start(seed: string): Promise<ReadyInfo> {
    this.dispose();
    this.seed = seed;
    this.ready = null;
    this.booting = new Promise<ReadyInfo>((resolve, reject) => {
      this.bootResolve = resolve;
      this.bootReject = reject;
    });
    this.booting.catch(() => undefined);
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => this.handle(ev.data);
    w.onerror = (ev) => this.bootReject?.(new Error(ev.message || 'worker error'));
    this.send({ type: 'init', seed });
    return this.booting;
  }

  private send(m: WorkerRequest) {
    this.worker?.postMessage(m);
  }

  private handle(m: WorkerResponse) {
    switch (m.type) {
      case 'progress':
        this.onProgress?.({ label: m.label, done: m.done, total: m.total });
        break;
      case 'ready': {
        const { type: _t, ...info } = m;
        void _t;
        this.ready = info;
        this.bootResolve?.(info);
        break;
      }
      case 'fatal':
        this.bootReject?.(new Error(m.message));
        break;
      case 'run': {
        const p = this.pending.get(m.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(m.id);
          (p.resolve as (v: RunOutcome) => void)(m.outcome);
        }
        break;
      }
      case 'schema': {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          (p.resolve as (v: TableInfo[]) => void)(m.tables);
        }
        break;
      }
      case 'sandbox': {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          (p.resolve as (v: boolean) => void)(m.ok);
        }
        break;
      }
    }
  }

  private async whenReady(): Promise<void> {
    if (this.ready) return;
    if (!this.booting) throw new Error('engine not started');
    await this.booting;
  }

  async run(sql: string, mode: RunMode, verify?: string): Promise<RunOutcome> {
    await this.whenReady();
    const id = ++this.seq;
    return new Promise<RunOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.onRebuildStart?.();
        void this.rebuild().then(
          () => this.onRebuild?.(),
          () => this.onRebuild?.(),
        );
        const f: RunFailure = {
          ok: false,
          kind: 'timeout',
          message: `The query ran for more than ${LIMITS.timeoutMs / 1000} seconds. It was stopped and the database was rebuilt.`,
          hint: 'Check for a missing JOIN condition, an endless recursion, or needless work on a large table.',
        };
        resolve(f);
      }, LIMITS.timeoutMs);
      this.pending.set(id, { resolve: resolve as never, reject, timer });
      this.send({ type: 'run', id, sql, mode, verify });
    });
  }

  async schema(): Promise<TableInfo[]> {
    await this.whenReady();
    const id = ++this.seq;
    return new Promise<TableInfo[]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as never, reject });
      this.send({ type: 'schema', id });
    });
  }

  async sandbox(action: 'begin' | 'end' | 'reset'): Promise<boolean> {
    await this.whenReady();
    const id = ++this.seq;
    return new Promise<boolean>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as never, reject });
      this.send({ type: 'sandbox', id, action });
    });
  }

  /** Throw the database away and rebuild it from the same seed. */
  rebuild(): Promise<ReadyInfo> {
    return this.start(this.seed);
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) clearTimeout(p.timer);
    this.pending.clear();
  }
}
