import { useEffect, useState } from 'react';
import { FEATURES, FEATURE_GROUPS } from '../lib/features';
import { hrefFor } from '../lib/router';
import { solvedCount } from '../state/game';
import { useGame } from '../state/GameProvider';
import { CASES } from '../cases';
import { CaseTiles } from './Board';

const DEMO = `SELECT po.po_number
FROM purchase_orders po
JOIN po_audit_log l USING (po_id)
WHERE l.changed_at > po.approved_at
  AND l.new_value::numeric
    > l.old_value::numeric;`;

const TOKEN = /(\b(?:SELECT|FROM|JOIN|USING|WHERE|AND)\b|::\w+)/g;

function Code({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={part.startsWith('::') ? 'tok-ty' : 'tok-kw'}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Typed() {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [n, setN] = useState(reduce ? DEMO.length : 0);
  const [stamped, setStamped] = useState(reduce);

  useEffect(() => {
    if (reduce) return;
    let i = 0;
    let t2: ReturnType<typeof setTimeout>;
    const t = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= DEMO.length) {
        clearInterval(t);
        t2 = setTimeout(() => setStamped(true), 450);
      }
    }, 26);
    return () => {
      clearInterval(t);
      clearTimeout(t2);
    };
  }, [reduce]);

  return (
    <div className="demo" aria-hidden>
      <div className="demo-bar">
        <span>purchase_orders</span>
        <span>Illustration</span>
      </div>
      <pre className="demo-code">
        <Code text={DEMO.slice(0, n)} />
        {n < DEMO.length && <span className="caret" />}
      </pre>
      <div className={`stamp stamp-demo ${stamped ? 'is-on' : ''}`}>
        <span>FLAGGED</span>
      </div>
    </div>
  );
}

export function Home() {
  const g = useGame();
  const solved = solvedCount(g.save);
  const started = solved > 0 || Object.values(g.save.progress).some((p) => p.runs > 0);

  return (
    <main className="page">
      <section className="hero">
        <h1>Every entry leaves a fingerprint.</h1>
        <Typed />
        <div className="hero-copy">
          <p className="lede">
            <strong>SQL Audit Detective</strong> is a game for learning SQL by auditing a company's purchasing and payment data. Harbourline Supply's books hold{' '}
            {CASES.length} cases, from duplicate payments to ghost vendors, and you find them with real PostgreSQL running in your browser.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary btn-lg" href={hrefFor({ name: 'board' })}>
              {started ? 'Continue the investigation' : 'Start investigating'}
            </a>
            <a className="btn btn-quiet btn-lg" href={hrefFor({ name: 'sandbox' })}>
              Practise in the sandbox
            </a>
          </div>
          <p className="fine seed-line">
            Your case code this round is <span className="mono">{g.save.seed}</span>. The same code always generates the same data; a new round means completely
            different data.
            {started && (
              <>
                {' '}
                <button type="button" className="link-btn" onClick={g.newGame}>
                  New round
                </button>
              </>
            )}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="page-head">
          <h2 className="page-title">{CASES.length} cases</h2>
          <p className="lede">
            Start with case 1. Later cases unlock as you close others; the finale opens after six. Cases 10 to 18 are follow-up files that teach more SQL, and
            the last four let you change data.
          </p>
        </div>
        <CaseTiles />
      </section>

      <section className="section">
        <h2 className="section-title">How it works</h2>
        <ol className="steps">
          <li>
            <h3>Read the brief</h3>
            <p>Each case tells you what looks wrong and which column to hand in.</p>
          </li>
          <li>
            <h3>Query the database with SQL</h3>
            <p>About 22,000 rows across 12 tables, with real anomalies and look-alike traps that turn out to be fine.</p>
          </li>
          <li>
            <h3>Submit and stamp the case closed</h3>
            <p>The answer must match exactly; missing or extra rows do not count. When you are off, the feedback points you in a specific direction.</p>
          </li>
        </ol>
      </section>

      <section className="section">
        <h2 className="section-title">The PostgreSQL you will practise</h2>
        <p className="section-lede">
          The cases take you through the first groups. Changing data and the advanced syntax have ready-to-run examples in the sandbox.
        </p>
        <div className="feature-index">
          {FEATURE_GROUPS.map((grp) => (
            <div key={grp} className="feature-group">
              <h3>{grp}</h3>
              <p>
                {FEATURES.filter((f) => f.group === grp)
                  .map((f) => f.label)
                  .join(', ')}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
