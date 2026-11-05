import type { StmtResult } from '../engine/protocol';
import { downloadText, resultToCsv } from '../lib/export';

/** PostgreSQL type OIDs that should be right-aligned like numbers. */
const NUMERIC_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700]);

const show = (v: unknown): string => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));

export function ResultTable({ result, index }: { result: StmtResult; index?: number }) {
  if (result.kind === 'command') {
    return (
      <div className="result-block">
        <div className="result-cmd">
          <span className="ok-dot" aria-hidden />
          <div>
            <p>
              Statement executed
              {result.affectedRows !== undefined ? `, ${result.affectedRows} rows affected` : ''}
              <span className="muted">, {result.elapsedMs.toFixed(1)} ms</span>
            </p>
            <code className="result-sql">{firstLine(result.sql)}</code>
          </div>
        </div>
      </div>
    );
  }

  const numeric = result.fields.map((f) => NUMERIC_OIDS.has(f.dataTypeID));
  return (
    <div className="result-block">
      <div className="result-scroll" tabIndex={0} role="region" aria-label={`Query result${index !== undefined ? ` ${index + 1}` : ''}`}>
        <table className="result-table">
          <thead>
            <tr>
              <th className="rownum" aria-hidden />
              {result.fields.map((f, i) => (
                <th key={i} className={numeric[i] ? 'num' : undefined}>
                  {f.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, r) => (
              <tr key={r}>
                <td className="rownum">{r + 1}</td>
                {row.map((v, c) => (
                  <td key={c} className={numeric[c] ? 'num' : undefined} title={v === null ? undefined : show(v)}>
                    {v === null || v === undefined ? <span className="null">NULL</span> : show(v)}
                  </td>
                ))}
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={result.fields.length + 1}>
                  No matching rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="result-foot">
        <span>
          {result.rowCount.toLocaleString()} {result.rowCount === 1 ? 'row' : 'rows'}
          {result.truncated ? `, showing the first ${result.rows.length.toLocaleString()}` : ''}
          <span className="muted">, {result.elapsedMs.toFixed(1)} ms</span>
        </span>
        {result.rows.length > 0 && (
          <button className="link-btn" type="button" onClick={() => downloadText('result.csv', resultToCsv(result))}>
            Download CSV
          </button>
        )}
      </div>
    </div>
  );
}

const firstLine = (s: string) => {
  const line = s.trim().split('\n')[0];
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
};

export function ResultStack({ results }: { results: StmtResult[] }) {
  return (
    <>
      {results.map((r, i) => (
        <ResultTable key={i} result={r} index={results.length > 1 ? i : undefined} />
      ))}
    </>
  );
}
