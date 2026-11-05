import { CASES, LEVEL_LABEL } from '../cases';
import { TABLES } from './schema';

/** Mermaid ER diagram generated from schema.ts — keys only, so it stays readable. */
export function erdMermaid(): string {
  const lines = ['erDiagram'];
  for (const t of TABLES) {
    lines.push(`  ${t.name} {`);
    for (const c of t.columns) {
      if (c.pk) lines.push(`    ${c.type.split('(')[0]} ${c.name} PK`);
      else if (c.fk) lines.push(`    ${c.type.split('(')[0]} ${c.name} FK`);
    }
    lines.push('  }');
  }
  for (const t of TABLES) {
    for (const c of t.columns) {
      if (!c.fk) continue;
      const parent = c.fk.split('(')[0];
      lines.push(`  ${parent} ${c.notNull ? '||' : '|o'}--o{ ${t.name} : "${c.name}"`);
    }
  }
  return lines.join('\n');
}

export function casesTable(): string {
  const rows = CASES.map((c) => `| ${c.id} | ${c.title} | ${LEVEL_LABEL[c.level]} | ${c.tagline} | ${c.skills.join(', ')} |`);
  return ['| # | Case | Level | Scenario | SQL practised |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

export function dictionaryMarkdown(): string {
  const out: string[] = [];
  for (const t of TABLES) {
    out.push(`### ${t.name}`, '', t.comment, '', '| Column | Type | Description |', '| --- | --- | --- |');
    for (const c of t.columns) {
      const flags = [
        c.pk ? 'PK' : '',
        c.fk ? `FK to ${c.fk}` : '',
        c.unique ? 'unique' : '',
        c.notNull && !c.pk ? 'NOT NULL' : '',
        c.generated ? 'generated' : '',
      ].filter(Boolean);
      out.push(`| ${c.name} | ${c.type}${flags.length ? ` (${flags.join(', ')})` : ''} | ${c.comment} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

export const MARKERS = {
  erd: ['<!-- ERD:START -->', '<!-- ERD:END -->'],
  cases: ['<!-- CASES:START -->', '<!-- CASES:END -->'],
  dict: ['<!-- DICT:START -->', '<!-- DICT:END -->'],
} as const;

/** Replace the generated blocks of a README-like text. */
export function syncReadme(text: string): string {
  const blocks: Record<keyof typeof MARKERS, string> = {
    erd: '```mermaid\n' + erdMermaid() + '\n```',
    cases: casesTable(),
    dict: dictionaryMarkdown(),
  };
  let out = text;
  for (const key of Object.keys(MARKERS) as (keyof typeof MARKERS)[]) {
    const [a, b] = MARKERS[key];
    const i = out.indexOf(a);
    const j = out.indexOf(b);
    if (i < 0 || j < i) throw new Error(`README is missing the ${a} … ${b} markers`);
    out = out.slice(0, i + a.length) + '\n' + blocks[key] + '\n' + out.slice(j);
  }
  return out;
}
