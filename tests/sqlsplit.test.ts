import { describe, expect, it } from 'vitest';
import { isReadOnlyKeyword, splitStatements } from '../src/engine/sqlSplit';

describe('splitStatements', () => {
  it('splits on top-level semicolons and reports keywords', () => {
    const s = splitStatements('select 1; -- hi\n  WITH x AS (select 2) select * from x;');
    expect(s.map((x) => x.keyword)).toEqual(['SELECT', 'WITH']);
    expect(s[1].sql.startsWith('WITH')).toBe(true);
  });
  it('ignores semicolons inside strings, identifiers, comments and dollar quotes', () => {
    const s = splitStatements(`select 'a;b' as "c;d" /* ; */ ; select $$x;y$$; select E'it\\'s;ok'`);
    expect(s).toHaveLength(3);
    expect(s[0].keyword).toBe('SELECT');
  });
  it('flags non-read-only statements', () => {
    const k = splitStatements('-- comment\n  delete from t; select 1').map((x) => x.keyword);
    expect(k).toEqual(['DELETE', 'SELECT']);
    expect(isReadOnlyKeyword('DELETE')).toBe(false);
    expect(isReadOnlyKeyword('SELECT')).toBe(true);
  });
  it('tracks offsets and ignores empty statements', () => {
    const text = ';;  select 1;\n\nselect 2';
    const s = splitStatements(text);
    expect(s).toHaveLength(2);
    expect(text.slice(s[1].start, s[1].start + 8)).toBe('select 2');
  });
  it('treats a parenthesised query as read-only', () => {
    expect(splitStatements('(select 1) union (select 2)')[0].keyword).toBe('(');
  });
});
