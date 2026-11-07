import { addDays, PlannerError } from './types';

export type SelectedSchedule = { startDate: string; trainingDates: string[] };

export function mondayOf(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -(day === 0 ? 6 : day - 1));
}

export function localMidnight(date: string, timezone: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
  let instant = target;
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += target - represented;
  }
  return new Date(instant);
}

export function validateSelectedSchedule(weekStart: string, today: string, input: SelectedSchedule) {
  const dates = [...input.trainingDates].sort();
  if (input.startDate < today || input.startDate > addDays(today, 28) ||
      mondayOf(input.startDate) !== weekStart || dates.length < 1 || dates.length > 6 ||
      new Set(dates).size !== dates.length ||
      dates.some(date => date < input.startDate || date > addDays(weekStart, 6))) {
    throw new PlannerError('INVALID_SCHEDULE', 'Choose one to six training dates from your start date through Sunday.');
  }
  return { startDate: input.startDate, trainingDates: dates };
}
