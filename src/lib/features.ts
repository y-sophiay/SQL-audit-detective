/**
 * PostgreSQL features the game wants you to practise. A feature counts as "practised"
 * when a query that uses it ran successfully — whether in a case or in the sandbox.
 */
export interface Feature {
  id: string;
  label: string;
  group: string;
  test: RegExp;
}

export const FEATURE_GROUPS = ['Querying and joining', 'Aggregation and grouping', 'Dates, text and types', 'Advanced queries', 'Changing data'] as const;

export const FEATURES: Feature[] = [
  { id: 'join', group: 'Querying and joining', label: 'JOIN', test: /\bjoin\b/i },
  { id: 'left-join', group: 'Querying and joining', label: 'LEFT JOIN', test: /\bleft\s+(outer\s+)?join\b/i },
  { id: 'anti-join', group: 'Querying and joining', label: 'NOT EXISTS / IS NULL', test: /\bnot\s+exists\b|\bis\s+null\b/i },
  { id: 'self-join', group: 'Querying and joining', label: 'Self join', test: /\bfrom\s+(\w+)\s+(?:as\s+)?(\w+)[\s\S]*?\bjoin\s+\1\s+(?:as\s+)?\w+/i },
  { id: 'distinct-from', group: 'Querying and joining', label: 'IS DISTINCT FROM', test: /\bis\s+(not\s+)?distinct\s+from\b/i },
  { id: 'distinct-on', group: 'Querying and joining', label: 'DISTINCT ON', test: /\bdistinct\s+on\s*\(/i },
  { id: 'ilike', group: 'Querying and joining', label: 'ILIKE', test: /\bilike\b/i },

  { id: 'group-by', group: 'Aggregation and grouping', label: 'GROUP BY', test: /\bgroup\s+by\b/i },
  { id: 'having', group: 'Aggregation and grouping', label: 'HAVING', test: /\bhaving\b/i },
  { id: 'count-distinct', group: 'Aggregation and grouping', label: 'COUNT(DISTINCT …)', test: /count\s*\(\s*distinct\b/i },
  { id: 'string-agg', group: 'Aggregation and grouping', label: 'string_agg', test: /\bstring_agg\s*\(/i },
  { id: 'filter', group: 'Aggregation and grouping', label: 'FILTER (WHERE …)', test: /\bfilter\s*\(\s*where\b/i },

  { id: 'cast', group: 'Dates, text and types', label: ':: type cast', test: /::\s*[a-z]/i },
  { id: 'date-arith', group: 'Dates, text and types', label: 'Date arithmetic (DATE / INTERVAL)', test: /\bdate\s+'|\binterval\b|\bcurrent_date\b/i },
  { id: 'date-trunc', group: 'Dates, text and types', label: 'date_trunc', test: /\bdate_trunc\s*\(/i },
  { id: 'to-char', group: 'Dates, text and types', label: 'to_char / extract', test: /\bto_char\s*\(|\bextract\s*\(/i },
  { id: 'regexp', group: 'Dates, text and types', label: 'regexp_replace / ~', test: /\bregexp_(replace|match|matches)\s*\(|\s~\*?\s/i },
  { id: 'coalesce', group: 'Dates, text and types', label: 'COALESCE / NULLIF', test: /\b(coalesce|nullif)\s*\(/i },
  { id: 'case', group: 'Dates, text and types', label: 'CASE WHEN', test: /\bcase\s+when\b/i },

  { id: 'cte', group: 'Advanced queries', label: 'CTE (WITH)', test: /\bwith\s+(recursive\s+)?\w+\s+as\s*(not\s+materialized\s*)?\(/i },
  { id: 'recursive', group: 'Advanced queries', label: 'WITH RECURSIVE', test: /\bwith\s+recursive\b/i },
  { id: 'window', group: 'Advanced queries', label: 'Window functions (OVER)', test: /\bover\s*\(/i },
  { id: 'row-number', group: 'Advanced queries', label: 'ROW_NUMBER / RANK', test: /\b(row_number|rank|dense_rank)\s*\(/i },
  { id: 'lag', group: 'Advanced queries', label: 'LAG / LEAD', test: /\b(lag|lead)\s*\(/i },
  { id: 'set-ops', group: 'Advanced queries', label: 'UNION / INTERSECT / EXCEPT', test: /\b(union|intersect|except)\b/i },
  { id: 'subquery', group: 'Advanced queries', label: 'Subqueries (IN / EXISTS)', test: /\b(in|exists)\s*\(\s*select\b/i },
  { id: 'generate-series', group: 'Advanced queries', label: 'generate_series', test: /\bgenerate_series\s*\(/i },
  { id: 'json', group: 'Advanced queries', label: 'JSONB', test: /\bjsonb?_(build_object|agg|build_array)\s*\(|->>/i },
  { id: 'explain', group: 'Advanced queries', label: 'EXPLAIN', test: /^\s*explain\b/im },

  { id: 'insert', group: 'Changing data', label: 'INSERT', test: /\binsert\s+into\b/i },
  { id: 'update', group: 'Changing data', label: 'UPDATE', test: /\bupdate\s+\w+(\s+(as\s+)?\w+)?\s+set\b/i },
  { id: 'delete', group: 'Changing data', label: 'DELETE', test: /\bdelete\s+from\b/i },
  { id: 'upsert', group: 'Changing data', label: 'ON CONFLICT (UPSERT)', test: /\bon\s+conflict\b/i },
  { id: 'returning', group: 'Changing data', label: 'RETURNING', test: /\breturning\b/i },
  { id: 'create-table', group: 'Changing data', label: 'CREATE TABLE', test: /\bcreate\s+(temp(orary)?\s+)?table\b/i },
  { id: 'create-view', group: 'Changing data', label: 'CREATE VIEW', test: /\bcreate\s+(or\s+replace\s+)?(materialized\s+)?view\b/i },
  { id: 'create-index', group: 'Changing data', label: 'CREATE INDEX', test: /\bcreate\s+(unique\s+)?index\b/i },
  { id: 'alter', group: 'Changing data', label: 'ALTER TABLE', test: /\balter\s+table\b/i },
];

/** Remove comments and the contents of string literals so that keywords in them do not count. */
export function stripSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

export function detectFeatures(sql: string): string[] {
  const clean = stripSql(sql);
  return FEATURES.filter((f) => f.test.test(clean)).map((f) => f.id);
}
