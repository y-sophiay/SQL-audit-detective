import { useState } from 'react';
import { CASES } from '../cases';
import { FEATURES, FEATURE_GROUPS } from '../lib/features';
import { hrefFor } from '../lib/router';
import { formatDuration, rankOf, solvedCount, totalScore } from '../state/game';
import { useGame } from '../state/GameProvider';

export function Report() {
  const g = useGame();
  const [reveal, setReveal] = useState(false);
  const solved = solvedCount(g.save);
  const total = totalScore(g.save);
  const rank = rankOf(total, solved, CASES.length);
  const spent = Object.values(g.save.progress).reduce((s, p) => s + p.msSpent, 0);
  const practised = new Set(g.save.practised);

  const wrongOf = (id: number) => {
    const p = g.progress(id);
    return Math.max(0, p.attempts - (p.solved ? 1 : 0));
  };

  const markdown = () => {
    const rows = CASES.map((c) => {
      const p = g.progress(c.id);
      return `| ${c.id} ${c.title} | ${p.solved ? 'Closed' : p.gaveUp ? 'Solution viewed' : 'Open'} | ${p.hints} | ${wrongOf(c.id)} | ${p.solved ? p.score : 0} |`;
    });
    const done = FEATURES.filter((f) => practised.has(f.id)).map((f) => f.label);
    return [
      '# Ledger Detective investigation report',
      '',
      `Case code ${g.save.seed}, rank ${rank}, ${solved} of ${CASES.length} cases closed, ${total} points, ${formatDuration(spent)} spent.`,
      '',
      '| Case | Status | Hints | Wrong | Score |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
      '',
      `PostgreSQL features practised (${done.length} of ${FEATURES.length}): ${done.join(', ') || 'none yet'}`,
    ].join('\n');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      g.toast('Copied as Markdown');
    } catch {
      g.toast('Your browser blocked copying. Please select the text manually.');
    }
  };

  const story = g.info?.story;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Investigation report</h1>
          <p className="lede">
            Case code <span className="mono">{g.save.seed}</span>, {formatDuration(spent)} spent in total.
          </p>
        </div>
        <div className="progress-card">
          <p className="progress-rank">{rank}</p>
          <p className="progress-nums">
            {solved} of {CASES.length} closed, {total} points
          </p>
        </div>
      </header>

      <section className="section">
        <h2 className="section-title">Results by case</h2>
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Status</th>
                <th className="num">Hints</th>
                <th className="num">Wrong</th>
                <th className="num">Time</th>
                <th className="num">Score</th>
              </tr>
            </thead>
            <tbody>
              {CASES.map((c) => {
                const p = g.progress(c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      <a href={hrefFor({ name: 'case', id: c.id })}>
                        {String(c.id).padStart(2, '0')} {c.title}
                      </a>
                    </td>
                    <td>{p.solved ? 'Closed' : p.gaveUp ? 'Solution viewed' : p.runs > 0 ? 'In progress' : 'Not started'}</td>
                    <td className="num">{p.hints}</td>
                    <td className="num">{wrongOf(c.id)}</td>
                    <td className="num">{p.msSpent ? formatDuration(p.msSpent) : '-'}</td>
                    <td className="num">{p.solved ? p.score : 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">
          PostgreSQL features practised: {FEATURES.filter((f) => practised.has(f.id)).length} of {FEATURES.length}
        </h2>
        <p className="section-lede">
          A feature lights up once a query that uses it has run successfully, in a case or in the sandbox. Grey ones are untried; the sandbox has a ready-to-run
          example for each.
        </p>
        <div className="feature-index">
          {FEATURE_GROUPS.map((grp) => (
            <div key={grp} className="feature-group">
              <h3>{grp}</h3>
              <ul className="chips">
                {FEATURES.filter((f) => f.group === grp).map((f) => (
                  <li key={f.id} className={practised.has(f.id) ? 'is-on' : undefined}>
                    {f.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">The truth</h2>
        {!reveal ? (
          <>
            <p className="section-lede">
              Who the mastermind of case 9 is, and who is behind the ghost vendors, can be revealed here. If you have not finished investigating, do not click
              yet.
            </p>
            <button type="button" className="btn btn-quiet" onClick={() => setReveal(true)} disabled={!story}>
              Reveal the truth
            </button>
          </>
        ) : (
          story && (
            <div className="prose">
              <p>
                The mastermind is <strong>{story.mastermind.name}</strong> ({story.mastermind.dept}, {story.mastermind.title}), employee ID{' '}
                {story.mastermind.empId}.
              </p>
              <p>The ghost vendors and the people behind them:</p>
              <ul className="plain-list">
                {story.ghostVendors.map((v) => (
                  <li key={v.vendorId}>
                    Vendor {v.vendorId}, {v.vendorName}, account owned by {v.ownerName}
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
      </section>

      <div className="cta-row">
        <button type="button" className="btn btn-primary" onClick={() => (g.newGame(), (location.hash = '#/board'))}>
          Play again (new data)
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => void copy()}>
          Copy as Markdown
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            if (confirm('Restart with the same data? Your current results will be cleared.')) {
              g.restartSame();
              location.hash = '#/board';
            }
          }}
        >
          Restart this round
        </button>
      </div>

      {g.history.length > 0 && (
        <section className="section">
          <h2 className="section-title">Past rounds</h2>
          <ul className="plain-list">
            {g.history.map((h) => (
              <li key={h.seed + h.finishedAt}>
                <span className="mono">{h.seed}</span>, {h.solved} closed, {h.score} points, {new Date(h.finishedAt).toLocaleDateString('en-AU')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
