import fs from "fs";
import path from "path";
import prisma from "../config/prisma";
import redis from "../config/redis";
import { Difficulty, TrainingLocation } from "@prisma/client";

interface RawWorkoutItem {
  id: string;
  name: string;
  bodyPart: string;
  equipment: string;
  target?: string;
  secondaryMuscles?: string[];
  instructions: string[];
  description: string;
  difficulty: string;
  category: string;
  duration?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
}

function mapDifficulty(diff?: string): Difficulty {
  const normalized = (diff || "").toLowerCase().trim();
  if (normalized === "intermediate") return Difficulty.INTERMEDIATE;
  if (normalized === "advanced") return Difficulty.ADVANCED;
  return Difficulty.BEGINNER;
}

async function main() {
  const jsonPath = path.join(__dirname, "../50gymworkouts.json");
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Could not find 50gymworkouts.json at ${jsonPath}`);
  }

  const rawData: RawWorkoutItem[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`🚀 Found ${rawData.length} gym workouts in 50gymworkouts.json.`);

  let createdCount = 0;
  let updatedCount = 0;

  for (const item of rawData) {
    const exerciseCode = item.id.padStart(4, "0");
    // Standard relative media keys in Cloudflare R2:
    const videoKey = item.videoUrl || `exercises/${exerciseCode}.mp4`;
    const posterKey = item.thumbnailUrl || `exercises/${exerciseCode}_poster.webp`;

    const exerciseData = {
      name: item.name.trim(),
      description: item.description?.trim() || "Gym strength exercise.",
      category: item.category?.trim() || "Strength",
      duration: item.duration && item.duration > 0 ? item.duration : 15,
      bodyPart: item.bodyPart?.trim() || "Full Body",
      target: item.target?.trim() || null,
      secondaryMuscles: Array.isArray(item.secondaryMuscles) ? item.secondaryMuscles : [],
      equipment: item.equipment?.trim() || "Machine",
      instructions: Array.isArray(item.instructions) && item.instructions.length > 0
        ? item.instructions
        : ["Execute repetitions with controlled tempo and full range of motion."],
      difficulty: mapDifficulty(item.difficulty),
      trainingLocation: TrainingLocation.GYM,
      videoUrl: videoKey,
    };

    const existing = await prisma.workout.findUnique({
      where: { name: exerciseData.name },
    });

    if (existing) {
      await prisma.workout.update({
        where: { id: existing.id },
        data: exerciseData,
      });
      updatedCount++;
    } else {
      await prisma.workout.create({
        data: exerciseData,
      });
      createdCount++;
    }
  }

  // Bust exercise caches in Redis so clients see updates immediately
  try {
    const keys = await redis.keys("exercises:*");
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🧹 Invalidated ${keys.length} exercise cache keys in Redis.`);
    }
  } catch (err) {
    console.warn("⚠️ Redis cache invalidation skipped:", err);
  }

  console.log(`✅ Finished seeding gym workouts!`);
  console.log(`   - Created: ${createdCount}`);
  console.log(`   - Updated: ${updatedCount}`);
  console.log(`   - Total Processed: ${rawData.length}`);
}

main()
  .catch((err) => {
    console.error("❌ Error seeding gym workouts:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
