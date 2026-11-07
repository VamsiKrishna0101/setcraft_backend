import prisma from "../../../config/prisma";
import { mapExercise } from "../../heatmap/training_map_engine";
import { calendarDate } from "../progress_types";
import { previewTraining } from "../preview/preview_data";

const workoutSelect = {
  id: true,
  name: true,
  namesByLang: true,
  bodyPart: true,
  target: true,
  muscleGroup: true,
  secondaryMuscles: true,
  equipment: true,
  category: true,
  thumbnailUrl: true,
};

async function realTrainingData(owner: string, end: string) {
  const [rows, sessions] = await Promise.all([
    prisma.workoutSetLog.findMany({
      where: {
        userId: owner,
        workoutItem: { sourceProvider: "USER", userWorkout: { userId: owner } },
      },
      select: {
        id: true,
        userWorkoutItemId: true,
        setNumber: true,
        weight: true,
        reps: true,
        rpe: true,
        day: true,
        month: true,
        year: true,
        createdAt: true,
        workoutItem: {
          select: { setTargets: true, workout: { select: workoutSelect } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.workoutSession.findMany({
      where: {
        userId: owner,
        date: { lte: end },
        userWorkout: { items: { some: { sourceProvider: "USER" } } },
      },
      select: {
        id: true,
        date: true,
        name: true,
        status: true,
        durationSeconds: true,
        userWorkoutId: true,
        userWorkout: {
          select: {
            items: { where: { sourceProvider: "USER" }, select: { id: true } },
          },
        },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    }),
  ]);
  const unique = new Map<string, (typeof rows)[number] & { date: string }>();
  for (const row of rows) {
    const date = `${row.year}-${row.month.padStart(2, "0")}-${row.day.padStart(2, "0")}`;
    if (!calendarDate.safeParse(date).success || date > end || row.reps <= 0)
      continue;
    unique.set(`${row.userWorkoutItemId}:${date}:${row.setNumber}`, {
      ...row,
      date,
    });
  }
  const sets = [...unique.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const mappings = new Map(
    sets.map((set) => [
      set.workoutItem.workout.id,
      mapExercise(set.workoutItem.workout),
    ]),
  );
  return {
    sets,
    sessions: sessions.filter(
      (session) => calendarDate.safeParse(session.date).success,
    ),
    mappings,
  };
}

export type TrainingData = Awaited<ReturnType<typeof realTrainingData>>;
export type LoggedSet = TrainingData["sets"][number];

export async function trainingData(
  owner: string,
  end: string,
  dataset?: string,
): Promise<TrainingData> {
  return dataset === "preview"
    ? previewTraining(owner, end)
    : realTrainingData(owner, end);
}
