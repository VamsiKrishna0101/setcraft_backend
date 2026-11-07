import { RangeQuery } from './progress_types';

export function shiftDate(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function monday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}

export function progressRange(query: RangeQuery, earliest?: string) {
  const days = { '4w': 28, '3m': 90, '1y': 365, all: 0, custom: 0 }[query.period];
  const end = query.period === 'custom' ? query.end! : query.date;
  const start = query.period === 'custom' ? query.start! : days ? shiftDate(end, 1 - days) : earliest ?? end;
  const length = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1);
  return {
    start,
    end,
    ...(query.dates ? { selectedDates: [...new Set(query.dates.split(','))].sort() } : {}),
    previousStart: shiftDate(start, -length),
    previousEnd: shiftDate(start, -1),
    comparable: query.period !== 'all' && !query.dates,
  };
}

export type ProgressRange = ReturnType<typeof progressRange>;

export function inRange(date: string, range: { start: string; end: string; selectedDates?: string[] }) {
  return date >= range.start && date <= range.end && (!range.selectedDates || range.selectedDates.includes(date));
}

export function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round((current - previous) / previous * 1000) / 10 : null;
}
