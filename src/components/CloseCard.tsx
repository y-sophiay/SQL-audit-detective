import { useEffect, useRef } from 'react';
import { LEVEL_LABEL, type CaseDef } from '../cases';
import { formatDuration, type CaseProgress } from '../state/game';

interface Props {
  def: CaseDef;
  progress: CaseProgress;
  duplicateRows: boolean;
  nextId: number | null;
  onNext: () => void;
  onStay: () => void;
}

/** The one big moment in the game: the case is stamped closed. */
export function CloseCard({ def, progress, duplicateRows, nextId, onNext, onStay }: Props) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // wait for the stamp to land before moving focus
    const id = setTimeout(() => primary.current?.focus(), 700);
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onStay();
    window.addEventListener('keydown', on);
    return () => {
      clearTimeout(id);
      window.removeEventListener('keydown', on);
    };
  }, [onStay]);

  const wrong = Math.min(6, Math.max(0, progress.attempts - 1));
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onStay()}>
      <div className="modal close-card" role="dialog" aria-modal="true" aria-label="Case closed">
        <div className="close-sheet">
          <p className="close-kicker">
            Case {String(def.id).padStart(2, '0')}, {LEVEL_LABEL[def.level]}
          </p>
          <h2>{def.title}</h2>
          <dl className="close-stats">
            <div>
              <dt>Score</dt>
              <dd className="big">{progress.score}</dd>
            </div>
            <div>
              <dt>Hints used</dt>
              <dd>{progress.hints}</dd>
            </div>
            <div>
              <dt>Wrong submissions</dt>
              <dd>{wrong}</dd>
            </div>
            <div>
              <dt>Time spent</dt>
              <dd>{formatDuration(progress.msSpent)}</dd>
            </div>
          </dl>
          {duplicateRows && (
            <p className="close-note">
              Your result contains duplicate rows. The answer is correct, but in practice you would normally remove them with DISTINCT or GROUP BY.
            </p>
          )}
          <div className="stamp" aria-hidden>
            <span>CLOSED</span>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onStay}>
            Review the solution
          </button>
          {nextId ? (
            <button ref={primary} type="button" className="btn btn-primary" onClick={onNext}>
              Go to case {String(nextId).padStart(2, '0')}
            </button>
          ) : (
            <button ref={primary} type="button" className="btn btn-primary" onClick={onNext}>
              View the report
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
