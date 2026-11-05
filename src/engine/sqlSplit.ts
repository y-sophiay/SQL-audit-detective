/**
 * A small, dependency-free SQL statement splitter.
 * It understands line / (nested) block comments, 'strings' with '' escapes, E'…' strings,
 * "quoted identifiers" and $tag$ dollar quotes — enough to split on top-level semicolons.
 */
export interface Stmt {
  /** the statement text exactly as typed (no trailing semicolon) */
  sql: string;
  /** offset of `sql` inside the original text */
  start: number;
  /** first keyword, upper-cased, comments stripped — e.g. SELECT, WITH, CREATE. "(" for a parenthesised query. */
  keyword: string;
}

export function splitStatements(text: string): Stmt[] {
  const out: Stmt[] = [];
  let raw = '';
  let clean = '';
  let start = -1;
  let i = 0;
  const n = text.length;

  const flush = () => {
    if (clean.trim() !== '') {
      const m = /^\s*(\(|[A-Za-z_]+)/.exec(clean);
      out.push({ sql: raw.trim(), start: start + (raw.length - raw.trimStart().length), keyword: m ? m[1].toUpperCase() : '' });
    }
    raw = '';
    clean = '';
    start = -1;
  };
  const take = (s: string, keepInClean: boolean) => {
    if (start < 0) start = i;
    raw += s;
    clean += keepInClean ? s : ' ';
  };

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '-' && next === '-') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      const chunk = text.slice(i, j);
      if (clean.trim() !== '') take(chunk, false);
      i = j;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth--;
          j += 2;
        } else j++;
      }
      if (clean.trim() !== '') take(text.slice(i, j), false);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const escapeBackslash = c === "'" && /[eE]$/.test(clean) && !/[A-Za-z0-9_]$/.test(clean.slice(0, -1));
      let j = i + 1;
      while (j < n) {
        if (escapeBackslash && text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === c) {
          if (text[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      take(text.slice(i, j + 1), true);
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = text.indexOf(tag, i + tag.length);
        const j = end < 0 ? n : end + tag.length;
        take(text.slice(i, j), true);
        i = j;
        continue;
      }
    }
    if (c === ';') {
      flush();
      i++;
      continue;
    }
    take(c, true);
    i++;
  }
  flush();
  return out;
}

const READ_ONLY_KEYWORDS = new Set(['SELECT', 'WITH', 'VALUES', 'TABLE', 'EXPLAIN', 'SHOW', '(']);
const TXN_KEYWORDS = new Set(['BEGIN', 'START', 'COMMIT', 'END', 'ABORT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'PREPARE']);
const SELECTISH = new Set(['SELECT', 'WITH', 'VALUES', 'TABLE', '(']);

export const isReadOnlyKeyword = (k: string) => READ_ONLY_KEYWORDS.has(k);
export const isTransactionKeyword = (k: string) => TXN_KEYWORDS.has(k);
export const isSelectish = (k: string) => SELECTISH.has(k);
export const isSchemaChange = (k: string) => k === 'CREATE' || k === 'DROP' || k === 'ALTER';
