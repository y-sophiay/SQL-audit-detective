/**
 * Day-number helpers. A "day" is an integer count of days since 1970-01-01 (UTC),
 * which sidesteps every time-zone and DST trap while generating data.
 */

export function dayNum(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function isoDay(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. (1970-01-01 was a Thursday.) */
export function weekday(n: number): number {
  return (((n + 4) % 7) + 7) % 7;
}

export function isWorkday(n: number): boolean {
  const w = weekday(n);
  return w !== 0 && w !== 6;
}

/** Monday of the week containing day n — matches PostgreSQL date_trunc('week', …). */
export function weekStart(n: number): number {
  return n - ((weekday(n) + 6) % 7);
}

/** Seconds since epoch → 'YYYY-MM-DD HH:MM:SS'. */
export function isoTs(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

export const SECONDS_PER_DAY = 86_400;
