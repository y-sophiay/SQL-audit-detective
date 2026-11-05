import { useEffect, useRef } from 'react';
import { TABLES, type TableDef } from '../data/schema';

const W = 210;
const HEAD = 30;
const ROW = 19;

/** Hand-placed so that the foreign-key lines do not cross. Employees links are listed, not drawn. */
const POS: Record<string, [number, number]> = {
  departments: [20, 20],
  employees: [20, 190],
  vendors: [300, 20],
  purchase_orders: [300, 190],
  po_audit_log: [300, 450],
  po_lines: [580, 70],
  invoices: [580, 390],
  goods_receipts: [860, 20],
  products: [860, 210],
  inventory_movements: [860, 360],
  payments: [860, 540],
  vendor_watchlist: [20, 350],
};

const keyCols = (t: TableDef) => t.columns.filter((c) => c.pk || c.fk);
const heightOf = (t: TableDef) => HEAD + ROW * (keyCols(t).length + 1) + 8;

export function ErdModal({ onClose }: { onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  const byName = new Map(TABLES.map((t) => [t.name as string, t]));
  const box = (name: string) => {
    const t = byName.get(name)!;
    const [x, y] = POS[name];
    return { t, x, y, h: heightOf(t) };
  };

  const edges: { d: string; key: string }[] = [];
  for (const t of TABLES) {
    for (const c of t.columns) {
      if (!c.fk) continue;
      const target = c.fk.split('(')[0];
      if (target === 'employees') continue;
      const a = box(t.name);
      const b = box(target);
      let x1: number, y1: number, x2: number, y2: number;
      if (a.x === b.x) {
        const down = b.y > a.y;
        x1 = x2 = a.x + W / 2;
        y1 = down ? a.y + a.h : a.y;
        y2 = down ? b.y : b.y + b.h;
        edges.push({ key: `${t.name}.${c.name}`, d: `M${x1},${y1} L${x2},${y2}` });
        continue;
      }
      const right = b.x > a.x;
      x1 = right ? a.x + W : a.x;
      x2 = right ? b.x : b.x + W;
      y1 = a.y + HEAD / 2 + 4;
      y2 = b.y + HEAD / 2 + 4;
      const mid = (x1 + x2) / 2;
      edges.push({ key: `${t.name}.${c.name}`, d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}` });
    }
  }

  const width = 860 + W + 20;
  const height = Math.max(...Object.keys(POS).map((n) => box(n).y + box(n).h)) + 20;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Table relationship diagram">
        <div className="modal-head">
          <div>
            <h2>Table relationships</h2>
            <p>
              Lines are foreign keys (FK). Every person column (requested_by, approved_by, paid_by and so on) points to employees; those are listed but not
              drawn.
            </p>
          </div>
          <button ref={closeBtn} type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="erd-scroll">
          <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="12 tables and their foreign keys">
            {edges.map((e) => (
              <path key={e.key} d={e.d} className="erd-edge" />
            ))}
            {TABLES.map((t) => {
              const { x, y, h } = box(t.name);
              const keys = keyCols(t);
              const rest = t.columns.length - keys.length;
              return (
                <g key={t.name} transform={`translate(${x},${y})`}>
                  <rect width={W} height={h} rx="8" className="erd-box" />
                  <path d={`M0 ${HEAD} V8 a8 8 0 0 1 8 -8 H${W - 8} a8 8 0 0 1 8 8 V${HEAD} Z`} className="erd-head" />
                  <text x="12" y="20" className="erd-title">
                    {t.name}
                  </text>
                  {keys.map((c, i) => (
                    <g key={c.name} transform={`translate(12,${HEAD + 17 + i * ROW})`}>
                      <text className="erd-col">{c.name}</text>
                      <text x={W - 24} textAnchor="end" className="erd-tag">
                        {c.pk ? 'PK' : 'FK'}
                      </text>
                    </g>
                  ))}
                  <text x="12" y={HEAD + 17 + keys.length * ROW} className="erd-more">
                    {rest} more columns
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
