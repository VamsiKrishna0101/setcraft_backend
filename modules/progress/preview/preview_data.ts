import prisma from "../../../config/prisma";
import { mapExercise } from "../../heatmap/training_map_engine";
import type { TrainingData } from "../training/training_data";

export type PreviewPayload = {
  session: { id: string; name: string; durationSeconds: number } | null;
  sets: Array<{
    id: string;
    itemId: string;
    exerciseId: string;
    setNumber: number;
    weight: number | null;
    reps: number;
    rpe: number;
  }>;
  body: Record<string, number>;
  recovery: { recovery: number; sleep: number; hrv: number; rhr: number };
  nutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    water: number;
  };
};

export async function previewDays(owner: string, end: string) {
  const rows = await prisma.progressPreviewDay.findMany({
    where: { userId: owner, date: { lte: end } },
    orderBy: { date: "asc" },
  });
  return rows.map((row) => ({
    date: row.date,
    data: row.data as unknown as PreviewPayload,
  }));
}

export async function previewTraining(
  owner: string,
  end: string,
): Promise<TrainingData> {
  const days = await previewDays(owner, end);
  const ids = [
    ...new Set(
      days.flatMap((day) => day.data.sets.map((set) => set.exerciseId)),
    ),
  ];
  const exercises = await prisma.workout.findMany({
    where: { id: { in: ids } },
    select: {
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
    },
  });
  const catalog = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const sets: TrainingData["sets"] = [];
  const sessions: TrainingData["sessions"] = [];
  for (const day of days) {
    const items = new Set<string>();
    for (const set of day.data.sets) {
      const workout = catalog.get(set.exerciseId);
      if (!workout) continue;
      items.add(set.itemId);
      sets.push({
        id: set.id,
        userWorkoutItemId: set.itemId,
        setNumber: set.setNumber,
        weight: set.weight,
        reps: set.reps,
        rpe: set.rpe,
        date: day.date,
        year: day.date.slice(0, 4),
        month: day.date.slice(5, 7),
        day: day.date.slice(8, 10),
        createdAt: new Date(`${day.date}T12:00:00Z`),
        workoutItem: { workout, setTargets: null },
      });
    }
    if (day.data.session)
      sessions.push({
        id: day.data.session.id,
        date: day.date,
        name: day.data.session.name,
        status: "COMPLETED",
        durationSeconds: day.data.session.durationSeconds,
        userWorkoutId: day.data.session.id,
        userWorkout: { items: [...items].map((id) => ({ id })) },
      });
  }
  return {
    sets,
    sessions: sessions.reverse(),
    mappings: new Map(
      exercises.map((exercise) => [exercise.id, mapExercise(exercise)]),
    ),
  };
}
