import { calendarWindow, PlannedExercise } from "./training_map_engine";
import { weekday } from "../workout/session/session_types";

type Plan = {
  id: string;
  scheduledDate: string | null;
  status: string;
  createdAt: Date;
  items: Array<PlannedExercise & { status?: string }>;
};

/** Resolve each displayed calendar day independently; dated decisions win. */
export function trainingMapSchedule(
  plans: Plan[], dates: string[], restDates: string[], utcOffsetMinutes: number,
) {
  const newest = [...plans].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return dates.flatMap(date => {
    if (restDates.includes(date)) return [];
    const dated = newest.find(plan => plan.scheduledDate === date);
    const window = calendarWindow(date, utcOffsetMinutes);
    const plan = dated ?? newest.find(plan => plan.scheduledDate === null &&
      plan.status !== "SKIPPED" && plan.createdAt < window.endUtc &&
      (plan.status !== "COMPLETED" || plan.createdAt >= window.startUtc));
    if (!plan || plan.status === "SKIPPED") return [];
    return plan.items.filter(item => item.dayOfWeek === weekday(date) &&
      (!dated || item.status !== "SKIPPED"));
  });
}
