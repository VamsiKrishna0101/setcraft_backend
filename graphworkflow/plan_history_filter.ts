import type { Prisma } from '@prisma/client';
import { shiftDate, type ProgressRange } from '../modules/progress/progress_range';

export function planHistoryWhere(userId: string, range?: ProgressRange): Prisma.WeeklyPersonalPlanWhereInput {
  return {
    userId, synthetic: false,
    ...(range ? {
      weekStart: { gte: shiftDate(range.start, -6), lte: range.end },
      ...(range.selectedDates ? { OR: range.selectedDates.map(date => ({
        weekStart: { gte: shiftDate(date, -6), lte: date },
      })) } : {}),
    } : {}),
  };
}
