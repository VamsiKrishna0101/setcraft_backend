import foodNames from "../../data/food_names.json";
import everydayFoods from "../../data/generic_foods.json";
import { Candidate, Food, Profile, Region, Pattern } from "./types";
import {
  mapExercise,
  Exercise,
} from "../../modules/heatmap/training_map_engine";

// Which part of the region an exercise mainly works, from simple name rules.
export function subTargetOf(
  region: Region,
  name: string,
  primary: string[],
): string {
  const exercise = name.toLowerCase();

  switch (region) {
    case "chest":
      return /incline/.test(exercise)
        ? "upper_chest"
        : /decline|dip/.test(exercise)
          ? "lower_chest"
          : "mid_chest";
    case "back":
      return /pull.?down|pull.?up|chin.?up|pullover|straight.?arm/.test(
        exercise,
      )
        ? "lats"
        : /extension|good morning|deadlift|superman/.test(exercise)
          ? "lower_back"
          : "upper_back";
    case "shoulders":
      return /lateral|side raise|upright/.test(exercise)
        ? "side_delts"
        : /rear|reverse fly|face pull/.test(exercise)
          ? "rear_delts"
          : /shrug/.test(exercise)
            ? "traps"
            : "front_delts";
    case "legs":
      if (primary.includes("calves") || /calf/.test(exercise)) {
        return "calves";
      }
      if (/hip thrust|glute|bridge|kickback|abduct/.test(exercise)) {
        return "glutes";
      }
      if (/curl|romanian|stiff|rdl|good morning/.test(exercise)) {
        return "hamstrings";
      }
      return primary.includes("quads")
        ? "quads"
        : primary.includes("hamstrings")
          ? "hamstrings"
          : primary.includes("glutes")
            ? "glutes"
            : "quads";
    case "biceps":
      return /hammer|reverse|wrist|forearm|zottman/.test(exercise)
        ? "brachialis_forearms"
        : /incline|drag/.test(exercise)
          ? "long_head"
          : /preacher|concentration|spider/.test(exercise)
            ? "short_head"
            : "biceps";
    case "triceps":
      return /overhead|french|skull|lying/.test(exercise)
        ? "long_head"
        : "lateral_medial_heads";
    case "core":
      return /oblique|twist|side|russian|woodchop|rotation/.test(exercise)
        ? "obliques"
        : /leg raise|knee raise|reverse crunch|hanging|flutter/.test(exercise)
          ? "lower_abs"
          : "upper_abs";
  }
}

export function curatedExercise(
  row: Exercise & {
    equipment: string;
    difficulty?: string;
    coachingMetadata?: unknown;
  },
): Candidate | null {
  const coaching = row.coachingMetadata as {
    exerciseType?: string;
    confidence?: string;
    requiresBench?: boolean;
    movementType?: string;
    difficultyReason?: string;
    limitations?: string[];
  } | null;
  // A timed, assisted, or unverified movement must not receive a weighted-rep prescription.
  if (
    coaching &&
    (coaching.confidence !== "HIGH" ||
      !["weight_reps", "bodyweight_reps"].includes(coaching.exerciseType || ""))
  )
    return null;
  const muscles = mapExercise(row);

  const primary = muscles.primary;

  const region: Region | undefined = primary.includes("chest")
    ? "chest"
    : primary.includes("shoulders")
      ? "shoulders"
      : primary.includes("biceps") || primary.includes("forearms")
        ? "biceps"
        : primary.includes("triceps")
          ? "triceps"
          : primary.includes("core")
            ? "core"
            : primary.some((muscle) =>
                  ["quads", "glutes", "hamstrings", "calves"].includes(muscle),
                )
              ? "legs"
              : primary.some((muscle) =>
                    ["lats", "upper_back", "lower_back"].includes(muscle),
                  )
                ? "back"
                : undefined;

  // Reps cannot describe timed work; assistance loads need a different progression model.
  if (
    !region ||
    /plank|hold|carry|walk|run|jump|stretch|balance|assisted/i.test(row.name)
  ) {
    return null;
  }

  const pattern: Pattern =
    region === "chest"
      ? "push"
      : region === "back"
        ? "pull"
        : region === "legs"
          ? primary.includes("calves")
            ? "calves"
            : primary.includes("hamstrings") || primary.includes("glutes")
              ? "hinge"
              : "squat"
          : region;

  const compound = coaching?.movementType
    ? coaching.movementType === "compound"
    : /press|squat|deadlift|lunge|row|pull.?down|chin.?down|pull.?up|chin.?up|push.?up|dip|hip thrust/i.test(
        row.name,
      );

  return {
    id: row.id,
    name: row.name,
    equipment: row.equipment,
    region,
    pattern,
    primary,
    secondary: muscles.secondary,
    compound,
    bodyweight: /body ?weight|none/i.test(row.equipment),
    requiresBench:
      coaching?.requiresBench ??
      (/bench|incline|decline/i.test(row.name) &&
        !/leverage|smith|machine|cable/i.test(row.equipment)),
    subTarget: subTargetOf(region, row.name, primary),
    difficulty: row.difficulty ?? null,
    movementType:
      coaching?.movementType ?? (compound ? "compound" : "isolation"),
    technicalReason: coaching?.difficultyReason,
    movementDemands: coaching?.limitations,
  };
}

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** True when the user confirmed one of these items (or, without item-level answers, the category). */
export function hasEquipmentItem(
  profile: Profile,
  tokens: string[],
  category?: string,
) {
  const equipmentIds = profile.equipmentIds.map(normalizeName);
  return equipmentIds.length
    ? equipmentIds.some((id) => tokens.includes(id))
    : !!category && profile.equipment.includes(category);
}

export function equipmentAllowed(candidate: Candidate, profile: Profile) {
  const equipmentIds = profile.equipmentIds.map(normalizeName);

  const equipmentCategories = profile.equipment;

  const hasEquipment = (tokens: string[], category: string) =>
    equipmentIds.length
      ? equipmentIds.some((id) => tokens.includes(id))
      : equipmentCategories.includes(category);

  if (
    candidate.requiresBench &&
    !hasEquipment(["flat bench", "adjustable bench", "bench"], "BENCH")
  ) {
    return false;
  }

  if (candidate.bodyweight) {
    if (/inverted.*row|supine.*row|suspended.*row/i.test(candidate.name)) {
      return equipmentIds.some((id) =>
        ["pullup bar", "smith machine", "suspension trainer"].includes(id),
      );
    }
    if (/pull.?up|chin.?up|hanging/i.test(candidate.name)) {
      return hasEquipment(["pullup bar", "assisted pullup dip"], "OTHER");
    }

    if (/dip/i.test(candidate.name)) {
      return hasEquipment(["dip bars", "assisted pullup dip"], "OTHER");
    }

    return true;
  }

  if (/dumbbell/i.test(candidate.equipment)) {
    return hasEquipment(
      ["dumbbells", "dumbbell", "adjustable dumbbells"],
      "DUMBBELLS",
    );
  }

  if (/^barbell$/i.test(candidate.equipment)) {
    return hasEquipment(["barbell", "barbells", "olympic barbell"], "BARBELLS");
  }

  if (/^cable$/i.test(candidate.equipment)) {
    return hasEquipment(["cable station", "cable machine", "cable"], "CABLE");
  }

  if (/kettlebell/i.test(candidate.equipment)) {
    return equipmentIds.includes("kettlebells");
  }

  if (/band/i.test(candidate.equipment)) {
    return equipmentIds.includes("resistance bands");
  }

  if (/smith/i.test(candidate.equipment)) {
    return hasEquipment(["smith machine"], "MACHINES");
  }

  if (/leverage|machine|sled/i.test(candidate.equipment)) {
    const dedicatedMachines: Array<[RegExp, string]> = [
      [/leg press/i, "leg press"],
      [/hack squat/i, "hack squat"],
      [/chest press/i, "chest press"],
      [/shoulder press/i, "shoulder press"],
      [/leg extension/i, "leg extension"],
      [/leg curl/i, "leg curl"],
      [/pulldown|pull down/i, "lat pulldown"],
      [/row/i, "seated row"],
      [/reverse fly|rear delt/i, "rear delt"],
      [/fly|pec deck/i, "pec deck"],
      [/assisted.*(pull|dip)/i, "assisted pullup dip"],
    ];

    const machine = dedicatedMachines.find(([name]) =>
      name.test(candidate.name),
    );

    return machine ? hasEquipment([machine[1]], "MACHINES") : false;
  }

  return false;
}
// Only these simple foods have reviewed dietary/allergen classifications.

const foodRules: Array<{
  test: RegExp;
  group: Food["group"];
  vegan: boolean;
  allergens: string[];
}> = [
  {
    test: /^Oat flakes$/i,
    group: "breakfast",
    vegan: true,
    allergens: ["gluten", "oats"],
  },
  {
    test: /^Chicken, breast, (skinless, )?(meat, |meat and skin, )?(cooked|roasted|grilled)/i,
    group: "protein",
    vegan: false,
    allergens: [],
  },
  {
    test: /^Lentil, (green, )?(boiled\/cooked|cooked)/i,
    group: "protein",
    vegan: true,
    allergens: ["legumes"],
  },
  {
    test: /^Tofu, (plain|natural)/i,
    group: "protein",
    vegan: true,
    allergens: ["soy"],
  },
  {
    test: /^Rice, white, (parboiled, )?cooked, no added salt$/i,
    group: "starch",
    vegan: true,
    allergens: [],
  },
  {
    test: /^Potato, (peeled, )?(boiled\/cooked in water|cooked in water|boiled)/i,
    group: "starch",
    vegan: true,
    allergens: [],
  },
  {
    test: /^Banana, (flesh, )?raw$/i,
    group: "fruit",
    vegan: true,
    allergens: [],
  },
  {
    test: /^Apple, (with skin, |flesh and skin, )?raw$/i,
    group: "fruit",
    vegan: true,
    allergens: [],
  },
  {
    test: /^Broccoli, (boiled\/cooked in water|cooked)/i,
    group: "vegetable",
    vegan: true,
    allergens: [],
  },
  {
    test: /^Carrot, (boiled\/cooked in water|cooked)/i,
    group: "vegetable",
    vegan: true,
    allergens: [],
  },
  { test: /^Olive oil$/i, group: "fat", vegan: true, allergens: [] },
  {
    test: /^Almond, peeled, no added salt$/i,
    group: "fat",
    vegan: true,
    allergens: ["nuts", "almonds"],
  },
  {
    test: /^Walnut(, kernel|, dried)?$/i,
    group: "fat",
    vegan: true,
    allergens: ["nuts", "walnuts"],
  },
];

// Only the reviewed everyday catalogue can enter this broader name classifier.
const everydayById = new Map(
  everydayFoods.foods.map((food) => [food.id, food]),
);

function everydayRule(id: string, name: string) {
  const entry = everydayById.get(id);
  if (!entry || entry.name !== name) return null;
  if (/flour|bran|— dry|— uncooked/i.test(name) && !/rolled oats/i.test(name))
    return null;
  if (
    (entry.category === "PROTEIN_SOURCE" && /— raw|— dried/i.test(name)) ||
    (entry.category === "CARB_SOURCE" &&
      /— raw|— uncooked|pasta — dry/i.test(name))
  )
    return null;

  const plantProtein =
    /tofu|tempeh|chickpeas|lentils|beans|peas|hummus|soy protein/i.test(name);
  const dairy = entry.category === "DAIRY";
  const egg = /egg/i.test(name);
  const vegetarian =
    /whey protein/i.test(name) ||
    dairy ||
    egg ||
    plantProtein ||
    !["PROTEIN_SOURCE"].includes(entry.category);
  const vegan =
    vegetarian &&
    !dairy &&
    !/whey protein/i.test(name) &&
    !egg &&
    !/butter|mayonnaise|honey/i.test(
      name.replace(/peanut butter|almond butter/i, ""),
    );
  const group: Food["group"] | null =
    dairy || entry.category === "PROTEIN_SOURCE"
      ? "protein"
      : entry.category === "CARB_SOURCE"
        ? /oats|porridge|muesli|granola/i.test(name)
          ? "breakfast"
          : "starch"
        : entry.category === "FRUIT"
          ? /avocado/i.test(name)
            ? "fat"
            : "fruit"
          : entry.category === "VEGETABLE"
            ? "vegetable"
            : entry.category === "FAT_SOURCE"
              ? "fat"
              : /soy drink|almond drink|oat drink/i.test(name)
                ? "protein"
                : null;
  if (!group || /mayonnaise|butter$/i.test(name)) return null;
  // Allergen screening still requires verified ingredient/cross-contact metadata.
  return { group, vegan, vegetarian, allergens: [] as string[] };
}

export function curatedFood(row: {
  id: string;
  name: string;
  servingUnit: string;
  servingSize: number;
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  imageUrl: string | null;
  sourceName: string | null;
}): Food | null {
  if (row.servingUnit !== "g" || row.servingSize !== 100) {
    return null;
  }

  const rule =
    everydayRule(row.id, row.name) ??
    foodRules.find((rule) => rule.test.test(row.name));

  if (!rule) {
    return null;
  }

  const scale = 100 / row.servingSize;

  return {
    id: row.id,
    name: row.name,
    group: rule.group,
    vegan: rule.vegan,
    vegetarian: "vegetarian" in rule ? rule.vegetarian : rule.vegan,
    allergens: rule.allergens,
    calories: row.caloriesPerServing * scale,
    protein: row.proteinPerServing * scale,
    carbs: row.carbsPerServing * scale,
    fat: row.fatPerServing * scale,
    imageUrl: row.imageUrl,
    source: row.sourceName,
  };
}
export function foodAllowed(food: Food, profile: Profile) {
  if (
    (profile.eatingStyle === "VEGAN" && !food.vegan) ||
    (profile.eatingStyle === "VEGETARIAN" && !(food.vegetarian ?? food.vegan))
  ) {
    return false;
  }

  if (profile.eatingStyle === "OTHER" || profile.allergies.length) {
    return false;
  } // No verified ingredient/cross-contact metadata yet.

  const translations = (foodNames as Record<string, Record<string, string>>)[
    food.id
  ];
  const names = [food.name, ...Object.values(translations ?? {})].map(
    normalizeName,
  );
  return !profile.dislikes.some((value) => {
    const disliked = normalizeName(value);
    if (!disliked) return false;
    if (names.some((name) => name.includes(disliked))) return true;
    if (/^(meat|red meat)$/.test(disliked))
      return /chicken|turkey|beef|pork/i.test(food.name);
    if (/^(fish|seafood)$/.test(disliked))
      return /salmon|cod|haddock|tuna|sardine|mackerel|prawn|trout/i.test(
        food.name,
      );
    if (/^(dairy|milk products)$/.test(disliked))
      return (
        /milk|yogurt|cheese|quark|kefir|mozzarella|parmesan|ricotta|gouda|cheddar|brie/i.test(
          food.name,
        ) && !/soy|almond|oat drink/i.test(food.name)
      );
    return false;
  });
}
