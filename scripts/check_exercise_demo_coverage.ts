import prisma from "../config/prisma";
import { preferredExerciseMedia } from "../utils/exercise_media";
import { curatedExercise } from "../graphworkflow/common/catalog";

async function main() {
  const rows = await prisma.workout.findMany({
    where: { catalogStatus: { notIn: ["STAGED", "ARCHIVED"] } },
    select: {
      id: true,
      name: true,
      equipment: true,
      difficulty: true,
      coachingMetadata: true,
      target: true,
      muscleGroup: true,
      bodyPart: true,
      secondaryMuscles: true,
      mediaVariants: true,
    },
  });
  for (const gender of ["male", "female"]) {
    const available = rows.filter((row) =>
      preferredExerciseMedia(row.mediaVariants, gender),
    );
    const curated = available
      .map((row) => curatedExercise(row))
      .filter(Boolean);
    console.log(
      JSON.stringify({
        gender,
        active: rows.length,
        demos: available.length,
        plannerCandidates: curated.length,
        regions: Object.fromEntries(
          [
            "chest",
            "back",
            "legs",
            "shoulders",
            "biceps",
            "triceps",
            "core",
          ].map((region) => [
            region,
            curated.filter((candidate) => candidate?.region === region).length,
          ]),
        ),
        withPoster: available.filter(
          (row) => preferredExerciseMedia(row.mediaVariants, gender)?.posterUrl,
        ).length,
        examplesWithoutDemo: rows
          .filter((row) => !preferredExerciseMedia(row.mediaVariants, gender))
          .slice(0, 5)
          .map((row) => row.name),
      }),
    );
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
