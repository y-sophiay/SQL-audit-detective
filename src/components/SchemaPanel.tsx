import { useState } from 'react';
import type { TableInfo } from '../engine/protocol';
import { ErdModal } from './ErdModal';

interface Props {
  tables: TableInfo[];
  counts: Record<string, number> | null;
  onInsert: (text: string) => void;
}

const shortType = (t: string) =>
  t
    .replace('character varying', 'varchar')
    .replace('timestamp without time zone', 'timestamp')
    .replace('double precision', 'float8')
    .replace('smallint', 'int2')
    .replace('integer', 'int4')
    .replace('bigint', 'int8');

export function SchemaPanel({ tables, counts, onInsert }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [erd, setErd] = useState(false);

  if (tables.length === 0) return <p className="panel-empty">Loading tables…</p>;

  return (
    <div className="schema">
      <div className="schema-head">
        <p>Click a table to see its columns. Click a column name to paste it into the editor.</p>
        <button className="link-btn" type="button" onClick={() => setErd(true)}>
          View relationships
        </button>
      </div>
      <ul className="schema-list">
        {tables.map((tb) => {
          const isOpen = open === tb.name;
          return (
            <li key={tb.name} className={isOpen ? 'is-open' : undefined}>
              <button type="button" className="schema-table" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : tb.name)}>
                <span className="schema-name">{tb.name}</span>
                <span className="schema-count">{counts?.[tb.name] !== undefined ? counts[tb.name].toLocaleString() : ''}</span>
                <span className="schema-comment">{tb.comment}</span>
              </button>
              {isOpen && (
                <ul className="schema-cols">
                  {tb.columns.map((c) => (
                    <li key={c.name}>
                      <button type="button" onClick={() => onInsert(c.name)} title={c.comment ?? undefined}>
                        <span className="col-name">{c.name}</span>
                        <span className="col-type">{shortType(c.type)}</span>
                        <span className="col-tags">
                          {c.pk && <span className="tag">PK</span>}
                          {c.fk && <span className="tag">FK {c.fk.split('(')[0]}</span>}
                          {c.generated && <span className="tag">generated</span>}
                        </span>
                        {c.comment && <span className="col-comment">{c.comment}</span>}
                      </button>
                    </li>
                  ))}
                  <li className="schema-insert">
                    <button type="button" className="link-btn" onClick={() => onInsert(tb.name)}>
                      Paste {tb.name} into the editor
                    </button>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {erd && <ErdModal onClose={() => setErd(false)} />}
    </div>
  );
}
