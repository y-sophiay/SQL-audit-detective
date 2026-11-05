import type { RunFailure } from '../engine/protocol';
import type { CaseDef } from '../cases';
import type { Verdict } from '../engine/check';

const KIND_LABEL: Record<RunFailure['kind'], string> = {
  sql: 'There is an error in your SQL',
  blocked: 'This statement cannot run here',
  cost: 'Query too expensive, not executed',
  timeout: 'Query timed out',
};

export function ErrorBox({ failure }: { failure: RunFailure }) {
  return (
    <div className="feedback feedback-error" role="alert">
      <p className="feedback-title">{KIND_LABEL[failure.kind]}</p>
      <p className="feedback-body mono">{failure.message}</p>
      {failure.detail && <p className="feedback-body mono muted">{failure.detail}</p>}
      {failure.hint && <p className="feedback-body">Hint: {failure.hint}</p>}
    </div>
  );
}

export function VerdictBox({ verdict, def }: { verdict: Verdict; def: CaseDef }) {
  switch (verdict.status) {
    case 'no-result':
      return (
        <div className="feedback feedback-warn" role="status">
          <p className="feedback-title">Nothing to check</p>
          <p className="feedback-body">The last statement you submit must be a SELECT that returns at least one column.</p>
        </div>
      );
    case 'no-column':
      return (
        <div className="feedback feedback-warn" role="status">
          <p className="feedback-title">The result has no {verdict.column} column</p>
          <p className="feedback-body">
            Columns you returned: <span className="mono">{verdict.have.join(', ') || '(none)'}</span>. This case is checked on{' '}
            <span className="mono">{def.answerColumn}</span>. If yours has another name, rename it with <span className="mono">AS</span>.
          </p>
        </div>
      );
    case 'verify-error':
      return (
        <div className="feedback feedback-warn" role="status">
          <p className="feedback-title">The check could not read the result of your script</p>
          <p className="feedback-body mono">{verdict.message}</p>
          {def.verifyHelp && <p className="feedback-body">{def.verifyHelp}</p>}
        </div>
      );
    case 'wrong':
      return (
        <div className="feedback feedback-miss" role="status">
          <p className="feedback-title">Not quite</p>
          <p className="feedback-body">
            {def.kind === 'fix'
              ? `After your script, the check found ${verdict.got} items: ${verdict.hit} as expected, ${verdict.missing} missing, ${verdict.extra} unexpected.`
              : `You returned ${verdict.got}: ${verdict.hit} correct, ${verdict.missing} missing, ${verdict.extra} extra.`}
          </p>
          <ul className="feedback-list">
            {verdict.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      );
    case 'correct':
      return (
        <div className="feedback feedback-ok" role="status">
          <p className="feedback-title">Correct</p>
        </div>
      );
  }
}
