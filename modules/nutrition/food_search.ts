/**
 * High-performance, intelligent food search engine with:
 * - Stemming & plural/singular normalization (eggs <-> egg, berries <-> berry, etc.)
 * - Word boundary matching (avoids "egg" matching "eggplant" or "oil" matching "boiled")
 * - High-value culinary synonym & alias ranking
 * - Multi-token order-independent matching
 * - Multi-tiered relevance scoring (exact match > prefix > word match > alias > partial)
 */

export interface FoodSearchItem {
  id: string;
  name: string;
  brand?: string | null;
  category?: string;
  servingUnit?: string;
  servingSize?: number;
  proteinPerServing?: number;
  caloriesPerServing?: number;
  fiberPerServing?: number;
}

// Curated high-relevance food aliases mapping search queries to canonical food IDs.
// When a user searches these colloquial terms, the targeted food IDs receive maximum relevance priority.
export const CANONICAL_FOOD_ALIASES: Record<string, string[]> = {
  // Egg variations
  egg: [
    "5742074a-e498-50a1-b68c-a7c0500424df", // Egg — raw
    "43249be2-2e2a-5bdb-8564-94a8d6a8cd78", // Boiled egg
    "03df567b-4ec1-5bab-9620-4bc00eac9088", // Scrambled egg
    "88fa007c-237a-5eb8-bc8f-89d71f73e063", // Fried egg
    "edf30127-859f-524c-815f-96e5700be161", // Poached egg
    "0ec7311f-9392-5537-90a3-605ec03cee6b", // Egg white — raw
  ],
  eggs: [
    "5742074a-e498-50a1-b68c-a7c0500424df", // Egg — raw
    "43249be2-2e2a-5bdb-8564-94a8d6a8cd78", // Boiled egg
    "03df567b-4ec1-5bab-9620-4bc00eac9088", // Scrambled egg
    "88fa007c-237a-5eb8-bc8f-89d71f73e063", // Fried egg
    "edf30127-859f-524c-815f-96e5700be161", // Poached egg
    "0ec7311f-9392-5537-90a3-605ec03cee6b", // Egg white — raw
  ],
  "whole egg": [
    "5742074a-e498-50a1-b68c-a7c0500424df", // Egg — raw
    "43249be2-2e2a-5bdb-8564-94a8d6a8cd78", // Boiled egg
  ],
  "whole eggs": [
    "5742074a-e498-50a1-b68c-a7c0500424df",
    "43249be2-2e2a-5bdb-8564-94a8d6a8cd78",
  ],
  "raw egg": ["5742074a-e498-50a1-b68c-a7c0500424df"],
  "raw eggs": ["5742074a-e498-50a1-b68c-a7c0500424df"],
  "boiled egg": ["43249be2-2e2a-5bdb-8564-94a8d6a8cd78"],
  "boiled eggs": ["43249be2-2e2a-5bdb-8564-94a8d6a8cd78"],
  "hard boiled egg": ["43249be2-2e2a-5bdb-8564-94a8d6a8cd78"],
  "hard boiled eggs": ["43249be2-2e2a-5bdb-8564-94a8d6a8cd78"],
  "hard-boiled egg": ["43249be2-2e2a-5bdb-8564-94a8d6a8cd78"],
  "hard-boiled eggs": ["43249be2-2e2a-5bdb-8564-94a8d6a8cd78"],
  "soft boiled egg": ["43249be2-2e2a-5bdb-8564-94a8d6a8cd78"],
  "soft boiled eggs": ["43249be2-2e2a-5bdb-8564-94a8d6a8cd78"],
  "soft-boiled egg": ["43249be2-2e2a-5bdb-8564-94a8d6a8cd78"],
  "scrambled egg": ["03df567b-4ec1-5bab-9620-4bc00eac9088"],
  "scrambled eggs": ["03df567b-4ec1-5bab-9620-4bc00eac9088"],
  "fried egg": ["88fa007c-237a-5eb8-bc8f-89d71f73e063"],
  "fried eggs": ["88fa007c-237a-5eb8-bc8f-89d71f73e063"],
  "sunny side up": ["88fa007c-237a-5eb8-bc8f-89d71f73e063"],
  "over easy": ["88fa007c-237a-5eb8-bc8f-89d71f73e063"],
  "poached egg": ["edf30127-859f-524c-815f-96e5700be161"],
  "poached eggs": ["edf30127-859f-524c-815f-96e5700be161"],
  "egg white": ["0ec7311f-9392-5537-90a3-605ec03cee6b"],
  "egg whites": ["0ec7311f-9392-5537-90a3-605ec03cee6b"],
  "white egg": ["0ec7311f-9392-5537-90a3-605ec03cee6b"],

  // Oats & Grains
  oatmeal: [
    "040b85d4-f923-5c4e-8bbe-83b1f4ce7e3f", // Rolled oats — dry
    "b1468590-503f-57f9-8b39-ee1647ae8f8e", // Oat bran — dry
  ],
  oats: [
    "040b85d4-f923-5c4e-8bbe-83b1f4ce7e3f",
    "b1468590-503f-57f9-8b39-ee1647ae8f8e",
  ],
  porridge: ["040b85d4-f923-5c4e-8bbe-83b1f4ce7e3f"],
  "rolled oats": ["040b85d4-f923-5c4e-8bbe-83b1f4ce7e3f"],

  // Peanut butter & spreads
  pb: ["3ee78b2d-0c07-5bc2-ba62-d81e2fc4e307"],
  "peanut butter": ["3ee78b2d-0c07-5bc2-ba62-d81e2fc4e307"],

  // Eggplant / Aubergine
  eggplant: [
    "331370ff-5f69-5861-8365-b0d8a66a38f3", // Aubergine — raw
    "e1c41882-a5b5-500a-a48c-d8ad453512bf", // Aubergine — cooked
  ],
  eggplants: [
    "331370ff-5f69-5861-8365-b0d8a66a38f3",
    "e1c41882-a5b5-500a-a48c-d8ad453512bf",
  ],
  brinjal: [
    "331370ff-5f69-5861-8365-b0d8a66a38f3",
    "e1c41882-a5b5-500a-a48c-d8ad453512bf",
  ],

  // Dairy & Yogurt
  yoghurt: [
    "3818a1a8-96eb-571e-aa15-2863b2109145", // Fat-free Greek yogurt
    "4b7cb579-9865-52e4-b0c4-ae1465f34559", // Low-fat Greek yogurt
    "c32a429d-a1d1-5668-934f-ec9b819e0f6b", // Plain yogurt
    "61324a9b-e91d-57e6-9d1d-211d9586a2a2", // Whole-milk Greek yogurt
  ],
  yogurt: [
    "3818a1a8-96eb-571e-aa15-2863b2109145",
    "4b7cb579-9865-52e4-b0c4-ae1465f34559",
    "c32a429d-a1d1-5668-934f-ec9b819e0f6b",
    "61324a9b-e91d-57e6-9d1d-211d9586a2a2",
  ],
  "greek yogurt": [
    "3818a1a8-96eb-571e-aa15-2863b2109145",
    "4b7cb579-9865-52e4-b0c4-ae1465f34559",
    "61324a9b-e91d-57e6-9d1d-211d9586a2a2",
  ],
  "greek yoghurt": [
    "3818a1a8-96eb-571e-aa15-2863b2109145",
    "4b7cb579-9865-52e4-b0c4-ae1465f34559",
    "61324a9b-e91d-57e6-9d1d-211d9586a2a2",
  ],
  curd: ["c32a429d-a1d1-5668-934f-ec9b819e0f6b"],

  // Oils
  evoo: ["f8266ca5-4ef3-5278-80eb-97e702be7e6f"],
  "olive oil": ["f8266ca5-4ef3-5278-80eb-97e702be7e6f"],

  // Supplements & Protein
  whey: ["06ad1ee5-8a13-56aa-ac8a-aba2a032a23c"],
  "whey protein": ["06ad1ee5-8a13-56aa-ac8a-aba2a032a23c"],
  "protein powder": ["06ad1ee5-8a13-56aa-ac8a-aba2a032a23c"],

  // Beef & Meat
  "ground beef": [
    "f9b50d47-c919-5c2d-8b5c-0557ef0e6745", // Beef mince — raw, 5% fat
    "12158722-ffad-5a68-8449-85f8574c4926", // Beef mince — raw, 10% fat
  ],
  "beef mince": [
    "f9b50d47-c919-5c2d-8b5c-0557ef0e6745",
    "12158722-ffad-5a68-8449-85f8574c4926",
  ],
  mince: [
    "f9b50d47-c919-5c2d-8b5c-0557ef0e6745",
    "12158722-ffad-5a68-8449-85f8574c4926",
  ],
  steak: [
    "8f6658f6-f77e-51b7-8d6e-e7b50add36b4", // Beef sirloin — raw
    "66c0cadc-6619-5839-89cc-0d1fe0142462", // Beef sirloin — grilled
  ],

  // Chicken
  chicken: [
    "3d9df365-18cd-5ed0-b87f-1e5f46be8271", // Chicken breast — raw
    "9837d95c-5852-50aa-9c6f-ff0969ee9287", // Chicken breast — roasted
    "8575c6cb-313f-5b7a-8d42-a44273d123fa", // Chicken thigh — raw
  ],
  "chicken breast": [
    "3d9df365-18cd-5ed0-b87f-1e5f46be8271",
    "9837d95c-5852-50aa-9c6f-ff0969ee9287",
    "763c7c65-62a1-53df-b014-161b48285183",
  ],
  "chicken breasts": [
    "3d9df365-18cd-5ed0-b87f-1e5f46be8271",
    "9837d95c-5852-50aa-9c6f-ff0969ee9287",
  ],

  // Sweet Potato & Potato
  "sweet potato": [
    "0f8981f1-3323-5e9d-9d41-3957ebcb0b43", // Sweet potato — raw
    "5d7e828d-195f-5573-b26a-9b4e7fe699d6", // Sweet potato — baked
    "88465d3a-2313-585a-8b83-b9df636ebfc7", // Sweet potato — boiled
  ],
  "sweet potatoes": [
    "0f8981f1-3323-5e9d-9d41-3957ebcb0b43",
    "5d7e828d-195f-5573-b26a-9b4e7fe699d6",
    "88465d3a-2313-585a-8b83-b9df636ebfc7",
  ],
  yam: ["0f8981f1-3323-5e9d-9d41-3957ebcb0b43"],

  // Fish
  salmon: [
    "0effd4f7-83ef-5133-8f27-f0baa6fa07ef", // Farmed salmon — raw
    "a8245c1d-7e8e-55cf-8908-cc56618ed612", // Farmed salmon — baked
    "cdddcd3a-fdd1-536b-b70a-db6d3acd7c2d", // Smoked salmon
  ],
  tuna: ["ed6ccc41-f63d-57a3-b7a1-3b9571ee783c"], // Tuna in water — drained
};

const SPECIFIC_PLURALS: Record<string, string> = {
  eggs: "egg",
  apples: "apple",
  bananas: "banana",
  berries: "berry",
  strawberries: "strawberry",
  blueberries: "blueberry",
  raspberries: "raspberry",
  blackberries: "blackberry",
  cranberries: "cranberry",
  potatoes: "potato",
  tomatoes: "tomato",
  oats: "oat",
  mushrooms: "mushroom",
  carrots: "carrot",
  onions: "onion",
  beans: "bean",
  lentils: "lentil",
  noodles: "noodle",
  nuts: "nut",
  seeds: "seed",
  olives: "olive",
  chips: "chip",
  prawns: "prawn",
  shrimps: "shrimp",
  scallops: "scallop",
  figs: "fig",
  steaks: "steak",
  breasts: "breast",
  thighs: "thigh",
  fillets: "fillet",
  whites: "white",
  yolks: "yolk",
};

const SPECIFIC_SINGULARS: Record<string, string> = Object.fromEntries(
  Object.entries(SPECIFIC_PLURALS).map(([pl, sg]) => [sg, pl]),
);

const COMPOUND_SUFFIXES = new Set([
  "berry",
  "berries",
  "nut",
  "nuts",
  "bean",
  "beans",
  "seed",
  "seeds",
  "corn",
  "fruit",
]);

/**
 * Returns canonical word variants for stemming (e.g. ['egg', 'eggs']).
 */
export function getStemVariants(word: string): string[] {
  const w = word.toLowerCase().trim();
  if (!w) return [];
  const variants = new Set<string>([w]);

  if (SPECIFIC_PLURALS[w]) variants.add(SPECIFIC_PLURALS[w]);
  if (SPECIFIC_SINGULARS[w]) variants.add(SPECIFIC_SINGULARS[w]);

  // Standard English pluralization rules
  if (w.endsWith("ies") && w.length > 4) {
    variants.add(w.slice(0, -3) + "y");
  } else if (w.endsWith("y") && w.length > 3) {
    variants.add(w.slice(0, -1) + "ies");
  } else if (w.endsWith("oes") && w.length > 4) {
    variants.add(w.slice(0, -2));
  } else if (
    (w.endsWith("o") && w.length > 3) ||
    w === "tomato" ||
    w === "potato"
  ) {
    variants.add(w + "es");
  } else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) {
    variants.add(w.slice(0, -1));
  } else if (!w.endsWith("s") && w.length >= 2) {
    variants.add(w + "s");
  }

  return Array.from(variants);
}

/**
 * Escapes regex special characters.
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks if a word token matches a text with strict word boundaries or compound suffix.
 * Short terms (<= 3 chars, e.g. "egg", "oil", "tea", "pea", "nut") MUST match
 * as complete word tokens or supported compound suffixes, preventing accidental
 * matches inside unrelated words (like "egg" in "eggplant" or "oil" in "boiled").
 */
export function tokenMatchesText(text: string, token: string): boolean {
  if (!text || !token) return false;
  const variants = getStemVariants(token);

  for (const variant of variants) {
    const esc = escapeRegex(variant);
    // Exact word boundary match: starts at word boundary and ends at word boundary
    const wordBoundaryRegex = new RegExp(
      "(?:^|[^a-zA-Z0-9])" + esc + "(?:$|[^a-zA-Z0-9])",
      "i",
    );
    if (wordBoundaryRegex.test(text)) return true;

    // Compound word suffix check (e.g. "Blueberries" ends with "berries", "Walnuts" ends with "nuts")
    if (COMPOUND_SUFFIXES.has(variant)) {
      const suffixRegex = new RegExp(esc + "(?:$|[^a-zA-Z0-9])", "i");
      if (suffixRegex.test(text)) return true;
    }

    // For longer terms (>= 4 chars), also permit word-prefix match (e.g. "strawber" matches "strawberries")
    if (variant.length >= 4) {
      const prefixRegex = new RegExp("(?:^|[^a-zA-Z0-9])" + esc, "i");
      if (prefixRegex.test(text)) return true;
    }
  }

  return false;
}

/**
 * Cleans a food name down to its base core staple name (before em-dash or comma).
 * e.g. "Egg — raw" -> "egg"
 *      "Rolled oats — dry" -> "rolled oats"
 */
export function getBaseFoodName(name: string): string {
  return name.split(/[—–,-]/)[0]?.trim().toLowerCase() || "";
}

/**
 * Calculate multi-tiered relevance score for a food item against a search query.
 * Higher score = more relevant result. 0 = no match.
 */
export function scoreFoodMatch(
  food: FoodSearchItem,
  query: string,
  options?: {
    translations?: Record<string, string>;
    language?: string;
  },
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 100; // browsing mode: baseline

  const name = food.name.toLowerCase();
  const baseName = getBaseFoodName(name);
  const brand = (food.brand || "").toLowerCase();
  const category = (food.category || "").toUpperCase();

  let score = 0;
  let hasAliasMatch = false;

  // 1. Curated Alias Exact Match (Highest priority)
  const aliasIds = CANONICAL_FOOD_ALIASES[q];
  if (aliasIds && aliasIds.includes(food.id)) {
    const rankIndex = aliasIds.indexOf(food.id);
    score += Math.max(2200, 3200 - rankIndex * 150);
    hasAliasMatch = true;
  }

  // 2. Exact Match on Base Name or Full Name
  if (baseName === q) {
    score += 3000;
  } else if (name === q) {
    score += 2600;
  } else if (name.startsWith(q)) {
    score += 1800;
  } else if (baseName.startsWith(q)) {
    score += 1600;
  }

  // 3. Multi-token Word-Boundary Match
  const queryTokens = q.split(/\s+/).filter(Boolean);
  const foodTokens = name.split(/[\s—–,/\\()]+/).filter(Boolean);

  let matchedTokensCount = 0;
  let matchesInOrder = true;
  let lastFoundIndex = -1;

  for (const token of queryTokens) {
    let tokenMatched = false;
    let foundIndex = -1;

    for (let i = 0; i < foodTokens.length; i++) {
      const ft = foodTokens[i]!;
      if (tokenMatchesText(ft, token)) {
        tokenMatched = true;
        foundIndex = i;
        break;
      }
    }

    if (!tokenMatched && brand && tokenMatchesText(brand, token)) {
      tokenMatched = true;
      foundIndex = 999;
    }

    if (tokenMatched) {
      matchedTokensCount++;
      if (foundIndex < lastFoundIndex) {
        matchesInOrder = false;
      }
      lastFoundIndex = foundIndex;
    }
  }

  const allTokensMatched =
    queryTokens.length > 0 && matchedTokensCount === queryTokens.length;

  if (allTokensMatched) {
    score += 1200;
    if (matchesInOrder) score += 300;
  } else if (queryTokens.length > 1 && !hasAliasMatch) {
    // When a multi-word query is entered, require all tokens to match unless there's an alias match,
    // preventing single-token noise like "Fried egg" showing up for "egg white".
    // If fewer than all tokens match, give 0 unless it's a 3+ token query matching >= 75%.
    if (matchedTokensCount / queryTokens.length < 0.75) {
      // Don't qualify
    } else {
      score += Math.round((matchedTokensCount / queryTokens.length) * 600);
    }
  } else if (matchedTokensCount > 0) {
    score += Math.round((matchedTokensCount / queryTokens.length) * 600);
  }

  // 4. Localized translation match (from food_names.json)
  if (options?.translations && options.language) {
    const translated =
      options.translations[options.language]?.toLowerCase() || "";
    if (translated) {
      const transBase = getBaseFoodName(translated);
      if (transBase === q || translated === q) {
        score += 2400;
      } else {
        const transTokens = translated.split(/[\s—–,/\\()]+/).filter(Boolean);
        let transMatches = 0;
        for (const token of queryTokens) {
          if (transTokens.some((tt) => tokenMatchesText(tt, token))) {
            transMatches++;
          }
        }
        if (transMatches === queryTokens.length) {
          score += 1000;
        }
      }
    }
  }

  // If nothing matched at all, return 0
  if (score === 0) return 0;

  // 5. Category Affinity Boost
  const isProteinSearch =
    tokenMatchesText(q, "egg") ||
    tokenMatchesText(q, "eggs") ||
    tokenMatchesText(q, "chicken") ||
    tokenMatchesText(q, "beef") ||
    tokenMatchesText(q, "salmon") ||
    tokenMatchesText(q, "tuna") ||
    tokenMatchesText(q, "whey") ||
    tokenMatchesText(q, "protein");
  if (isProteinSearch && category === "PROTEIN_SOURCE") {
    score += 250;
  }

  const isFruitSearch =
    tokenMatchesText(q, "apple") ||
    tokenMatchesText(q, "banana") ||
    tokenMatchesText(q, "berry") ||
    tokenMatchesText(q, "fruit");
  if (isFruitSearch && category === "FRUIT") {
    score += 250;
  }

  const isOilSearch =
    tokenMatchesText(q, "oil") ||
    tokenMatchesText(q, "butter") ||
    tokenMatchesText(q, "fat");
  if (isOilSearch && category === "FAT_SOURCE") {
    score += 250;
  }

  // 6. Primary / Core Food Simplicity Boost
  // Pure staple ingredients (e.g. "Egg — raw", "Apple", "Banana") score higher than complex multi-ingredient items
  const lengthPenalty = Math.min(300, name.length * 3);
  score += Math.max(0, 300 - lengthPenalty);

  return score;
}

/**
 * Filter and rank food items by relevance.
 */
export function filterAndRankFoods<T extends FoodSearchItem>(
  foods: T[],
  query: string,
  options?: {
    category?: string;
    focus?: string;
    language?: string;
    foodTranslations?: Record<string, Record<string, string>>;
  },
): { items: T[]; total: number } {
  const q = query.trim();
  if (!q) {
    return { items: foods, total: foods.length };
  }

  let candidates = foods;
  if (options?.category) {
    candidates = candidates.filter((f) => f.category === options.category);
  }

  if (options?.focus && options.focus !== "ALL") {
    candidates = candidates.filter((f) => {
      const per100 =
        f.servingUnit === "g" && f.servingSize && f.servingSize > 0
          ? 100 / f.servingSize
          : 0;
      if (per100 <= 0) return false;
      if (options.focus === "PROTEIN") {
        return (f.proteinPerServing ?? 0) * per100 >= 15;
      }
      if (options.focus === "FIBRE") {
        return (f.fiberPerServing ?? 0) * per100 >= 3;
      }
      if (options.focus === "LIGHTER") {
        return (f.caloriesPerServing ?? 0) * per100 <= 100;
      }
      return true;
    });
  }

  let scored: Array<{ item: T; score: number }> = [];

  for (const food of candidates) {
    const trans = options?.foodTranslations
      ? options.foodTranslations[food.id]
      : undefined;
    const score = scoreFoodMatch(food, q, {
      translations: trans,
      language: options?.language || "en",
    });

    if (score > 0) {
      scored.push({ item: food, score });
    }
  }

  // Sort descending by score; if tied, sort alphabetically by clean name
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.name.localeCompare(b.item.name);
  });

  return {
    items: scored.map((s) => s.item),
    total: scored.length,
  };
}
