import { useCallback, useEffect, useRef, useState } from 'react';
import { CASES, LEVEL_LABEL, caseById, isFix } from '../cases';
import { CloseCard } from '../components/CloseCard';
import { ErdModal } from '../components/ErdModal';
import { ErrorBox, VerdictBox } from '../components/Feedback';
import { ResultStack } from '../components/ResultTable';
import { SchemaPanel } from '../components/SchemaPanel';
import { SqlEditor, type EditorHandle, type ErrorMark } from '../components/SqlEditor';
import { checkAnswer, checkState, type Verdict } from '../engine/check';
import type { RunOutcome } from '../engine/protocol';
import { Inline } from '../lib/md';
import { go, hrefFor } from '../lib/router';
import { isUnlocked, scoreOnSolve } from '../state/game';
import { useGame } from '../state/GameProvider';

type Tab = 'brief' | 'schema' | 'hints' | 'learn';
const TABS: { id: Tab; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'schema', label: 'Tables' },
  { id: 'hints', label: 'Hints' },
  { id: 'learn', label: 'Learn' },
];

export function Workspace({ id }: { id: number }) {
  const def = CASES.find((c) => c.id === id);
  const g = useGame();
  if (!def) {
    return (
      <main className="page narrow">
        <h1 className="page-title">Case not found</h1>
        <a className="btn btn-primary" href={hrefFor({ name: 'board' })}>
          Back to cases
        </a>
      </main>
    );
  }
  if (!isUnlocked(def, g.save)) {
    const need = def.unlockAfterSolved ?? 0;
    return (
      <main className="page narrow">
        <h1 className="page-title">Case {String(id).padStart(2, '0')} is locked</h1>
        <p className="lede">Close {need} other cases first to unlock this one.</p>
        <a className="btn btn-primary" href={hrefFor({ name: 'board' })}>
          Back to cases
        </a>
      </main>
    );
  }
  return <Case key={`${g.save.seed}-${id}`} id={id} />;
}

function Case({ id }: { id: number }) {
  const def = caseById(id)!;
  const fix = isFix(def);
  const g = useGame();
  const p = g.progress(id);
  const done = p.solved;

  const [sql, setSql] = useState(p.lastSql || def.starter);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<Tab>('brief');
  const [mark, setMark] = useState<ErrorMark | null>(null);
  const [closing, setClosing] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [erd, setErd] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const markKey = useRef(0);

  // time on the case: count only while the tab is visible
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') g.patchCase(id, (c) => ({ ...c, msSpent: c.msSpent + 10_000 }));
    }, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, id]);

  const execute = useCallback(async (): Promise<RunOutcome | null> => {
    if (running || !sql.trim()) return null;
    setRunning(true);
    setVerdict(null);
    const out = await g.engine.run(sql, fix ? 'fix' : 'case', fix ? def.verify : undefined);
    setRunning(false);
    setOutcome(out);
    setMark(!out.ok && out.position !== undefined ? { pos: out.position, key: ++markKey.current } : null);
    g.patchCase(id, (c) => ({ ...c, runs: c.runs + 1, lastSql: sql }));
    if (out.ok) g.markPractised(sql);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, sql, g.engine, id, fix]);

  const submit = useCallback(async () => {
    const out = await execute();
    if (!out || !out.ok) return;
    let v: Verdict;
    if (fix) {
      if (!g.info) return;
      v = checkState(def, out.verify, g.info.truth[id]);
    } else {
      const rows = [...out.results].reverse().find((r) => r.kind === 'rows');
      if (!rows || !g.info) {
        setVerdict({ status: 'no-result' });
        return;
      }
      v = checkAnswer(def, rows, g.info.truth[id]);
    }
    setVerdict(v);
    if (v.status === 'wrong') {
      g.patchCase(id, (c) => ({ ...c, attempts: c.attempts + 1 }));
    } else if (v.status === 'correct' && !done) {
      const score = p.gaveUp ? 0 : scoreOnSolve(p.hints, p.attempts);
      g.patchCase(id, (c) => ({ ...c, attempts: c.attempts + 1, solved: true, score, solvedSql: sql, solvedAt: Date.now() }));
      setDuplicate(v.duplicateRows);
      setClosing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execute, def, fix, id, done, p.gaveUp, p.hints, p.attempts, sql, g.info]);

  const nextId = CASES.find((c) => c.id !== id && !g.progress(c.id).solved && isUnlocked(c, g.save))?.id ?? null;
  const showSolution = done || p.gaveUp;
  const insert = (text: string) => editor.current?.insert(text);
  const useSql = (text: string) => {
    setSql(text);
    setTimeout(() => editor.current?.focus(), 0);
  };

  return (
    <main className="ws">
      <aside className="ws-side">
        <div className="ws-head">
          <a className="back" href={hrefFor({ name: 'board' })}>
            All cases
          </a>
          <p className="ws-level">
            Case {String(id).padStart(2, '0')}, {LEVEL_LABEL[def.level]}
            {done && <span className="badge badge-ok">Closed, {p.score} pts</span>}
          </p>
          <h1>{def.title}</h1>
        </div>
        <div className="tabs" role="tablist" aria-label="Case material">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'is-active' : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ws-panel" role="tabpanel">
          {tab === 'brief' && (
            <div className="prose brief">
              <div className="task">
                <p className="task-label">What to find</p>
                <p>
                  <Inline text={def.task} />
                </p>
                <p className="task-answer">
                  {fix ? (
                    <>Hand in your script. The game runs it, reads the tables it changed, then rolls everything back.</>
                  ) : (
                    <>
                      Hand in a result with a column named <code>{def.answerColumn}</code>.
                    </>
                  )}
                </p>
              </div>
              <div className="map-row">
                <button type="button" className="btn btn-quiet" onClick={() => setErd(true)}>
                  Open the table map
                </button>
                <span>Optional. Shows how the tables connect, so you can see which JOIN you need.</span>
              </div>
              <h2 className="h-mini">Background</h2>
              {def.brief.map((b, i) => (
                <p key={i}>
                  <Inline text={b} />
                </p>
              ))}
              <p className="skills-line">Practised here: {def.skills.join(', ')}</p>
              <p className="fine">
                {fix
                  ? 'The audit date is 2025-12-31; do not use CURRENT_DATE. In this case your script may change data. Every run is rolled back, so nothing is ever lost and you can retry freely.'
                  : 'The audit date is 2025-12-31; do not use CURRENT_DATE. The database is read-only in a case. Hands-on cases and the Sandbox let you change data.'}
              </p>
            </div>
          )}
          {tab === 'schema' && <SchemaPanel tables={g.tables} counts={g.info?.counts ?? null} onInsert={insert} />}
          {tab === 'hints' && (
            <div className="hints">
              <p className="fine">Each hint costs 10 points. Try on your own first.</p>
              {def.hints.map((h, i) => {
                const shown = i < p.hints;
                const next = i === p.hints;
                return (
                  <section key={i} className={`hint ${shown ? 'is-open' : ''}`}>
                    <h3>Hint {i + 1}</h3>
                    {shown ? (
                      <p>
                        <Inline text={h} />
                      </p>
                    ) : next ? (
                      <button type="button" className="btn btn-quiet" onClick={() => g.patchCase(id, (c) => ({ ...c, hints: Math.min(3, c.hints + 1) }))}>
                        Open hint {i + 1}
                      </button>
                    ) : (
                      <p className="muted">Open the previous hint first.</p>
                    )}
                  </section>
                );
              })}
              {p.hints >= 3 && !showSolution && (
                <div className="giveup">
                  <p>Still stuck after all three hints? You can view the solution. This case then scores no points.</p>
                  <button type="button" className="btn btn-quiet" onClick={() => (g.patchCase(id, (c) => ({ ...c, gaveUp: true })), setTab('learn'))}>
                    Show the solution
                  </button>
                </div>
              )}
            </div>
          )}
          {tab === 'learn' && (
            <div className="prose">
              <h2 className="h-small">
                <Inline text={def.concept.title} />
              </h2>
              {def.concept.body.map((b, i) => (
                <p key={i}>
                  <Inline text={b} />
                </p>
              ))}
              <div className="codebox">
                <pre>{def.concept.example}</pre>
                <button type="button" className="link-btn" onClick={() => useSql(def.concept.example)}>
                  Paste into the editor
                </button>
              </div>
              <h3 className="h-mini">Common pitfalls</h3>
              <ul className="plain-list">
                {def.pitfalls.map((x, i) => (
                  <li key={i}>
                    <Inline text={x} />
                  </li>
                ))}
              </ul>
              <h3 className="h-mini">Solution</h3>
              {showSolution ? (
                <>
                  <div className="codebox">
                    <pre>{def.solution}</pre>
                    <button type="button" className="link-btn" onClick={() => useSql(def.solution)}>
                      Paste into the editor
                    </button>
                  </div>
                  <p>
                    <Inline text={def.solutionNotes} />
                  </p>
                </>
              ) : (
                <p className="muted">The solution appears once the case is closed, or after you open all three hints and give up.</p>
              )}
            </div>
          )}
        </div>
      </aside>

      <section className="ws-main">
        <div className="editor-card">
          <div className="editor-bar">
            <div className="editor-actions">
              <button type="button" className="btn btn-quiet" onClick={() => void execute()} disabled={running || !g.info}>
                Run
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={running || !g.info}>
                {fix ? (done ? 'Check the script again' : 'Hand in script') : done ? 'Check the answer again' : 'Submit answer'}
              </button>
            </div>
            <div className="editor-meta">
              <button type="button" className="link-btn" onClick={() => setSql(def.starter)}>
                Restore starter query
              </button>
              <span className="kbd-hint">
                <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to run, add <kbd>Shift</kbd> to submit
              </span>
            </div>
          </div>
          <SqlEditor
            ref={editor}
            value={sql}
            onChange={setSql}
            onRun={() => void execute()}
            onSubmit={() => void submit()}
            errorMark={mark}
            tables={g.tables}
            minHeight={220}
          />
        </div>

        <div className="results" aria-live="polite">
          {!g.info && <p className="panel-empty">The database is still being prepared. You can run queries once it is ready.</p>}
          {running && <p className="running">Running…</p>}
          {!running && !outcome && g.info && (
            <p className="panel-empty">
              {fix ? 'Press Run to run your script and see what each statement returned.' : 'Press Run to see results.'} Not sure where to start? Open Tables on
              the left and browse the columns.
            </p>
          )}
          {outcome && !outcome.ok && <ErrorBox failure={outcome} />}
          {verdict && <VerdictBox verdict={verdict} def={def} />}
          {outcome?.ok && <ResultStack results={outcome.results} />}
        </div>
      </section>

      {erd && <ErdModal onClose={() => setErd(false)} />}
      {closing && (
        <CloseCard
          def={def}
          progress={g.progress(id)}
          duplicateRows={duplicate}
          nextId={nextId}
          onStay={() => {
            setClosing(false);
            setTab('learn');
          }}
          onNext={() => go(nextId ? { name: 'case', id: nextId } : { name: 'report' })}
        />
      )}
    </main>
  );
}
