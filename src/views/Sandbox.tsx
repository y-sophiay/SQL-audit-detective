import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBox } from '../components/Feedback';
import { ResultStack } from '../components/ResultTable';
import { SchemaPanel } from '../components/SchemaPanel';
import { SqlEditor, type EditorHandle, type ErrorMark } from '../components/SqlEditor';
import type { RunOutcome } from '../engine/protocol';
import { SNIPPET_GROUPS } from '../lib/snippets';
import { useGame } from '../state/GameProvider';

type Tab = 'snippets' | 'schema';

export function Sandbox() {
  const g = useGame();
  const [sql, setSql] = useState(SNIPPET_GROUPS[0].items[0].sql);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('snippets');
  const [mark, setMark] = useState<ErrorMark | null>(null);
  const editor = useRef<EditorHandle>(null);
  const markKey = useRef(0);
  const { engine, info, epoch, refreshSchema, markPractised, toast } = g;

  // The sandbox is one long transaction: entering opens it, leaving rolls everything back.
  useEffect(() => {
    if (!info) return;
    let live = true;
    setReady(false);
    void engine.sandbox('begin').then((ok) => live && setReady(ok));
    return () => {
      live = false;
      void engine.sandbox('end').then(() => refreshSchema());
    };
  }, [engine, info, epoch, refreshSchema]);

  const execute = useCallback(async () => {
    if (running || !ready || !sql.trim()) return;
    setRunning(true);
    const out = await engine.run(sql, 'sandbox');
    setRunning(false);
    setOutcome(out);
    setMark(!out.ok && out.position !== undefined ? { pos: out.position, key: ++markKey.current } : null);
    if (out.ok) {
      markPractised(sql);
      if (out.schemaChanged) void refreshSchema();
    }
  }, [running, ready, sql, engine, markPractised, refreshSchema]);

  const reset = async () => {
    await engine.sandbox('reset');
    await refreshSchema();
    setOutcome(null);
    setMark(null);
    toast('Restored the original data');
  };

  return (
    <main className="ws">
      <aside className="ws-side">
        <div className="ws-head">
          <a className="back" href="#/">
            Home
          </a>
          <h1>Sandbox</h1>
          <p className="fine">
            Do anything here: INSERT, UPDATE, DELETE, create tables and indexes. Every change is undone when you leave this page or press Reset, and none of it
            touches the cases.
          </p>
        </div>
        <div className="tabs" role="tablist">
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'snippets'}
            className={tab === 'snippets' ? 'is-active' : undefined}
            onClick={() => setTab('snippets')}
          >
            Examples
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'schema'}
            className={tab === 'schema' ? 'is-active' : undefined}
            onClick={() => setTab('schema')}
          >
            Tables
          </button>
        </div>
        <div className="ws-panel" role="tabpanel">
          {tab === 'schema' ? (
            <SchemaPanel tables={g.tables} counts={info?.counts ?? null} onInsert={(t) => editor.current?.insert(t)} />
          ) : (
            <div className="snippets">
              {SNIPPET_GROUPS.map((grp) => (
                <section key={grp.name}>
                  <h3 className="h-mini">{grp.name}</h3>
                  <ul>
                    {grp.items.map((s) => (
                      <li key={s.title}>
                        <button
                          type="button"
                          onClick={() => {
                            setSql(s.sql);
                            setTimeout(() => editor.current?.focus(), 0);
                          }}
                        >
                          <span className="snip-title">{s.title}</span>
                          <span className="snip-note">{s.note}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="ws-main">
        <div className="editor-card">
          <div className="editor-bar">
            <div className="editor-actions">
              <button type="button" className="btn btn-primary" onClick={() => void execute()} disabled={running || !ready}>
                Run
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => void reset()} disabled={!ready}>
                Reset database
              </button>
            </div>
            <span className="kbd-hint">
              <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to run; several statements at once are fine
            </span>
          </div>
          <SqlEditor ref={editor} value={sql} onChange={setSql} onRun={() => void execute()} errorMark={mark} tables={g.tables} minHeight={260} />
        </div>
        <div className="results" aria-live="polite">
          {!ready && <p className="panel-empty">Preparing the sandbox…</p>}
          {running && <p className="running">Running…</p>}
          {ready && !outcome && !running && <p className="panel-empty">Pick an example on the left, or write your own SQL.</p>}
          {outcome && !outcome.ok && <ErrorBox failure={outcome} />}
          {outcome?.ok && <ResultStack results={outcome.results} />}
        </div>
      </section>
    </main>
  );
}
