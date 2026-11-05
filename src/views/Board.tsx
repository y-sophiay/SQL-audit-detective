import { CASES, LEVEL_LABEL } from '../cases';
import { hrefFor } from '../lib/router';
import { isUnlocked, rankOf, solvedCount, totalScore } from '../state/game';
import { useGame } from '../state/GameProvider';

export function CaseTiles() {
  const g = useGame();
  return (
    <ol className="ledger">
      {CASES.map((c) => {
        const p = g.progress(c.id);
        const open = isUnlocked(c, g.save);
        const status = p.solved ? `Closed, ${p.score} pts` : p.gaveUp ? 'Solution viewed' : p.runs > 0 ? 'In progress' : '';
        const inner = (
          <>
            <span className="ledger-no">{String(c.id).padStart(2, '0')}</span>
            <span className="ledger-main">
              <span className="ledger-title">{c.title}</span>
              <span className="ledger-tag">{open ? c.tagline : `Close ${c.unlockAfterSolved} other cases to unlock`}</span>
              <span className="ledger-skills">{c.skills.join(', ')}</span>
            </span>
            <span className={`ledger-level level-${c.level}`}>{LEVEL_LABEL[c.level]}</span>
            <span className={`ledger-status ${p.solved ? 'is-solved' : ''}`}>{open ? status : 'Locked'}</span>
          </>
        );
        return (
          <li key={c.id} className={`${open ? '' : 'is-locked'} ${p.solved ? 'is-done' : ''} ${open && !p.solved && p.runs > 0 ? 'is-active' : ''}`}>
            {open ? (
              <a className="ledger-row" href={hrefFor({ name: 'case', id: c.id })}>
                {inner}
              </a>
            ) : (
              <div className="ledger-row" aria-disabled="true">
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Board() {
  const g = useGame();
  const solved = solvedCount(g.save);
  const total = totalScore(g.save);
  const pct = Math.round((solved / CASES.length) * 100);

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Cases</h1>
          <p className="lede">
            Case code <span className="mono">{g.save.seed}</span>. Cases 1 to 9 run from easy to hard and are best done in order; the finale unlocks after you
            close six others. Cases 10 to 18 are follow-up files that each teach a specific command, and cases 15 to 18 let you change data.
          </p>
        </div>
        <div className="progress-card">
          <p className="progress-rank">{rankOf(total, solved, CASES.length)}</p>
          <p className="progress-nums">
            {solved} of {CASES.length} closed, {total} points
          </p>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={CASES.length} aria-valuenow={solved} aria-label="Cases closed">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      <CaseTiles />

      {solved === CASES.length && (
        <div className="cta-row">
          <a className="btn btn-primary" href={hrefFor({ name: 'report' })}>
            View the report
          </a>
        </div>
      )}
    </main>
  );
}
