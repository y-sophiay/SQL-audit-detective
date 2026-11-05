import { Board } from './views/Board';
import { Home } from './views/Home';
import { Report } from './views/Report';
import { Sandbox } from './views/Sandbox';
import { Workspace } from './views/Workspace';
import { hrefFor, useRoute, type Route } from './lib/router';
import { GameProvider, useGame } from './state/GameProvider';
import { CASES } from './cases';
import { solvedCount } from './state/game';

const NAV: { route: Route; label: string; match: Route['name'][] }[] = [
  { route: { name: 'board' }, label: 'Cases', match: ['board', 'case'] },
  { route: { name: 'sandbox' }, label: 'Sandbox', match: ['sandbox'] },
  { route: { name: 'report' }, label: 'Report', match: ['report'] },
];

function Shell() {
  const route = useRoute();
  const g = useGame();
  const pct = g.boot ? Math.min(100, Math.round((g.boot.done / Math.max(1, g.boot.total)) * 100)) : 100;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={hrefFor({ name: 'home' })} aria-label="Ledger Detective, home">
          <svg viewBox="0 0 38 26" width="38" height="26" aria-hidden>
            <circle cx="13" cy="13" r="13" fill="#1F2BC9" style={{ mixBlendMode: 'multiply' }} />
            <circle cx="25" cy="13" r="13" fill="#FF5C8A" style={{ mixBlendMode: 'multiply' }} />
          </svg>
          <span>Ledger Detective</span>
        </a>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <a key={n.label} href={hrefFor(n.route)} aria-current={n.match.includes(route.name) ? 'page' : undefined}>
              {n.label}
              {n.label === 'Cases' && solvedCount(g.save) > 0 && <span className="nav-count">{solvedCount(g.save)}</span>}
            </a>
          ))}
        </nav>
        <div className={`db-status ${g.bootError ? 'is-error' : g.boot ? 'is-loading' : 'is-ready'}`} role="status">
          <span className="dot" aria-hidden />
          {g.bootError ? 'Database failed to start' : g.boot ? `Preparing database ${pct}%` : 'PostgreSQL ready'}
        </div>
      </header>

      {g.bootError && (
        <div className="banner" role="alert">
          <p>
            PostgreSQL (WebAssembly) failed to start: <span className="mono">{g.bootError}</span>. Please use a recent browser and reload the page.
          </p>
        </div>
      )}

      {(route.name === 'home' || route.name === 'board' || route.name === 'report') && (
        <div className="dateline">
          <p>
            <span>
              Case code <b className="mono">{g.save.seed}</b>
            </span>
            <span>Harbourline Supply Co.</span>
            <span>Audit date 31 Dec 2025</span>
            <span>
              {solvedCount(g.save)} of {CASES.length} closed
            </span>
          </p>
        </div>
      )}

      {route.name === 'home' && <Home />}
      {route.name === 'board' && <Board />}
      {route.name === 'case' && <Workspace id={route.id} />}
      {route.name === 'sandbox' && <Sandbox />}
      {route.name === 'report' && <Report />}

      {route.name !== 'case' && route.name !== 'sandbox' && (
        <footer className="footer">
          <p>All data is fictional and regenerated from the case code every round. Your SQL runs in your own browser and is never uploaded.</p>
        </footer>
      )}

      <div className="toasts" aria-live="polite">
        {g.toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function App() {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}
