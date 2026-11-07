import fs from "fs";
import path from "path";
import prisma from "../config/prisma";
import redis from "../config/redis";
import { Difficulty, TrainingLocation } from "@prisma/client";

interface WorkoutItem {
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
  restSeconds?: number;
  tempo?: string;
  caloriesBurnEstimate?: number;
  trainingLocation?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  tips?: string[];
  exerciseCode?: string;
}

// Biomechanical tips generator based on movement type
function generateProTips(name: string, target?: string, equipment?: string): string[] {
  const lowerName = name.toLowerCase();
  const lowerTarget = (target || "").toLowerCase();

  if (lowerName.includes("squat")) {
    return [
      "Keep your chest upright and maintain a neutral lumbar spine.",
      "Drive your knees outward in line with your toes throughout the descent.",
      "Push forcefully through your midfoot and heels on the ascent.",
    ];
  }
  if (lowerName.includes("deadlift") || lowerName.includes("hinge") || lowerName.includes("rdl")) {
    return [
      "Initiate the movement by hinging your hips back rather than bending your knees.",
      "Keep the bar or weight tight against your shins and thighs.",
      "Engage your lats to prevent spinal rounding.",
    ];
  }
  if (lowerName.includes("press") || lowerName.includes("bench")) {
    return [
      "Retract and depress your scapulae into the bench or backrest.",
      "Keep your wrists stacked directly over your elbows.",
      "Control the eccentric descent; do not bounce weight off your chest or shoulders.",
    ];
  }
  if (lowerName.includes("fly") || lowerName.includes("pec deck")) {
    return [
      "Maintain a slight, fixed bend in your elbows throughout the entire arc.",
      "Focus on driving your inner biceps together to maximize pectoral contraction.",
      "Pause for 1 second at peak contraction without letting weight stacks touch.",
    ];
  }
  if (lowerName.includes("bike") || lowerName.includes("row") || lowerName.includes("sprint") || lowerName.includes("cycling")) {
    return [
      "Maintain rhythmic breathing and avoid holding your breath during sprints.",
      "Keep core muscles braced to stabilize your pelvis and lower back.",
      "Focus on equal power output from both sides.",
    ];
  }
  if (lowerName.includes("raise") || lowerName.includes("delt")) {
    return [
      "Lead the movement with your elbows rather than your hands.",
      "Avoid using momentum or swinging your torso.",
      "Control the lowering phase for a full 2 to 3 seconds.",
    ];
  }
  if (lowerName.includes("thrust") || lowerName.includes("kickback") || lowerTarget.includes("glute")) {
    return [
      "Drive through your heels to achieve full hip extension at the top.",
      "Squeeze your glutes hard at lockout without hyperextending your lower back.",
      "Keep your chin slightly tucked to maintain spinal alignment.",
    ];
  }

  return [
    "Focus on mind-muscle connection and controlled tempo on every repetition.",
    "Exhale on exertion (concentric) and inhale on recovery (eccentric).",
    "Maintain steady core tension throughout the range of motion.",
  ];
}

function calculateMetrics(item: WorkoutItem) {
  const name = item.name.toLowerCase();
  const cat = item.category.toLowerCase();
  const eq = item.equipment.toLowerCase();

  let duration = 45;
  let restSeconds = 60;
  let tempo = "3-0-1-0";
  let caloriesBurnEstimate = 6.5;

  if (cat.includes("cardio") || name.includes("sprint") || name.includes("bike")) {
    duration = 60;
    restSeconds = 45;
    tempo = "EXPLOSIVE";
    caloriesBurnEstimate = 10.5;
  } else if (name.includes("squat") || name.includes("deadlift") || name.includes("thrust")) {
    duration = 50;
    restSeconds = 90;
    tempo = "3-1-1-0";
    caloriesBurnEstimate = 8.5;
  } else if (eq.includes("cable") || eq.includes("machine")) {
    duration = 40;
    restSeconds = 60;
    tempo = "2-1-1-1";
    caloriesBurnEstimate = 5.5;
  } else if (name.includes("press") || name.includes("lunge")) {
    duration = 45;
    restSeconds = 75;
    tempo = "3-0-1-0";
    caloriesBurnEstimate = 7.0;
  }

  return { duration, restSeconds, tempo, caloriesBurnEstimate };
}

function mapDifficulty(diff?: string): Difficulty {
  const val = (diff || "").toLowerCase().trim();
  if (val === "intermediate") return Difficulty.INTERMEDIATE;
  if (val === "advanced") return Difficulty.ADVANCED;
  return Difficulty.BEGINNER;
}

async function main() {
  const jsonPath = path.join(__dirname, "../50gymworkouts.json");
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Could not find 50gymworkouts.json at ${jsonPath}`);
  }

  const rawList: WorkoutItem[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`Loaded ${rawList.length} workouts from ${jsonPath}`);

  const enrichedList: WorkoutItem[] = [];

  for (const item of rawList) {
    const rawId = item.id.trim();
    const numId = parseInt(rawId, 10);
    const code = rawId.padStart(4, "0");

    // Exact video keys verified on live Cloudflare R2 bucket:
    // Files 51 & 52 are named "51.mp4" and "52.mp4", while 53-100 are "0053.mp4"-"0100.mp4"
    const videoKey = numId <= 52 ? `${numId}.mp4` : `${code}.mp4`;
    // Placeholder thumbnail URL as requested (can be customized later):
    const posterKey = `posters/${code}.webp`;

    const metrics = calculateMetrics(item);
    const tips = generateProTips(item.name, item.target, item.equipment);

    const enriched: WorkoutItem = {
      ...item,
      id: code,
      exerciseCode: code,
      duration: item.duration ?? metrics.duration,
      restSeconds: item.restSeconds ?? metrics.restSeconds,
      tempo: item.tempo ?? metrics.tempo,
      caloriesBurnEstimate: item.caloriesBurnEstimate ?? metrics.caloriesBurnEstimate,
      trainingLocation: "GYM",
      videoUrl: videoKey,
      thumbnailUrl: posterKey,
      tips: item.tips && item.tips.length > 0 ? item.tips : tips,
    };

    enrichedList.push(enriched);
  }

  // 1. Write back enriched JSON file permanently
  fs.writeFileSync(jsonPath, JSON.stringify(enrichedList, null, 4), "utf-8");
  console.log(`✅ Permanently updated 50gymworkouts.json with all URLs, metrics, and pro tips!`);

  // 2. Seed database
  let created = 0;
  let updated = 0;

  for (const item of enrichedList) {
    const data = {
      exerciseCode: item.exerciseCode,
      name: item.name.trim(),
      description: item.description?.trim() || "Gym strength exercise.",
      category: item.category?.trim() || "Strength",
      duration: item.duration ?? 45,
      bodyPart: item.bodyPart?.trim() || "Full Body",
      target: item.target?.trim() || null,
      secondaryMuscles: Array.isArray(item.secondaryMuscles) ? item.secondaryMuscles : [],
      equipment: item.equipment?.trim() || "Machine",
      instructions: Array.isArray(item.instructions) && item.instructions.length > 0
        ? item.instructions
        : ["Execute repetitions with controlled tempo and full range of motion."],
      difficulty: mapDifficulty(item.difficulty),
      trainingLocation: TrainingLocation.GYM,
      videoUrl: item.videoUrl,
      thumbnailUrl: item.thumbnailUrl,
      caloriesBurnEstimate: item.caloriesBurnEstimate ?? 7.0,
      tempo: item.tempo ?? "3-0-1-0",
      restSeconds: item.restSeconds ?? 75,
      tips: item.tips ?? [],
    };

    const existing = await prisma.workout.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      await prisma.workout.update({
        where: { id: existing.id },
        data,
      });
      updated++;
    } else {
      await prisma.workout.create({
        data,
      });
      created++;
    }
  }

  // 3. Clear Redis exercise and user workout caches
  try {
    const keys = await redis.keys("exercises:*");
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🧹 Invalidated ${keys.length} exercise cache keys in Redis.`);
    }
  } catch (err) {
    console.warn("⚠️ Redis cache clear skipped:", err);
  }

  console.log(`\n🎉 SEEDING COMPLETE!`);
  console.log(`   • Total Exercises: ${enrichedList.length}`);
  console.log(`   • Created: ${created}`);
  console.log(`   • Updated: ${updated}`);
  console.log(`   • Sample R2 Video Key: ${enrichedList[0].videoUrl}`);
  console.log(`   • Sample R2 Full URL: ${process.env.EXERCISE_VIDEO_BASE_URL}/${enrichedList[0].videoUrl}`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
