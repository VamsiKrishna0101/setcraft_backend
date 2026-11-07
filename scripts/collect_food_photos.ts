import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "data/generic_foods.json"), "utf8"),
);
const folder = path.join(root, "build/food-catalog/wiki-photos");
const target = path.join(root, "data/food_images.json");
fs.mkdirSync(folder, { recursive: true });
fs.mkdirSync(path.join(root, "build/food-catalog/source-images"), {
  recursive: true,
});
const output: Record<string, any> = fs.existsSync(target)
  ? JSON.parse(fs.readFileSync(target, "utf8"))
  : {};
const overridesPath = path.join(root, "data/food_photo_overrides.json");
const overrides: Record<string, { title: string }> = fs.existsSync(overridesPath)
  ? JSON.parse(fs.readFileSync(overridesPath, "utf8")) : {};
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const plain = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const save = () => {
  const latest = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : {};
  const originalsPath = path.join(root, "data/food_generated_images.json");
  const originals = fs.existsSync(originalsPath) ? JSON.parse(fs.readFileSync(originalsPath, "utf8")) : {};
  const stockPath = path.join(root, "data/food_stock_images.json");
  const stock = fs.existsSync(stockPath) ? JSON.parse(fs.readFileSync(stockPath, "utf8")) : {};
  for (const [id, photo] of Object.entries(stock) as [string, any][]) {
    if (originals[id]) continue;
    const sameSource = output[id]?.sourceSha256 === photo.sourceSha256;
    output[id] = { ...photo, ...(sameSource ? output[id] : {}) };
  }
  for (const [id, photo] of Object.entries(originals) as [string, any][]) {
    const sameSource = output[id]?.sourceSha256 === photo.sourceSha256;
    output[id] = { ...photo, ...(sameSource ? output[id] : {}) };
  }
  for (const [id, photo] of Object.entries(latest) as [string, any][]) {
    if (photo.sourceSha256 && photo.sourceSha256 === output[id]?.sourceSha256)
      for (const key of ["outputFile", "sha256", "cropCenter", "reviewed"])
        if (photo[key] !== undefined) output[id][key] = photo[key];
  }
  const temporary = target + `.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(output, null, 2) + "\n");
  fs.renameSync(temporary, target);
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const aliases: Record<string, string> = {
  "Scrambled egg": "Scrambled eggs",
  Egg: "Egg as food",
  "Whole milk": "Milk",
  Milk: "Milk",
  "Skimmed milk": "Milk",
  "Plain yogurt": "Yogurt",
  "Low-fat plain yogurt": "Yogurt",
  "Fat-free plain yogurt": "Yogurt",
  "Fat-free Greek yogurt": "Strained yogurt",
  "Low-fat Greek yogurt": "Strained yogurt",
  "Whole-milk Greek yogurt": "Strained yogurt",
  Parmesan: "Parmigiano Reggiano",
  "Swiss cheese": "Emmental cheese",
  "Salted butter": "Butter",
  "Unsalted butter": "Butter",
  "Chicken breast": "Chicken as food",
  "Chicken thigh": "Chicken as food",
  "Turkey breast": "Turkey as food",
  "Turkey mince": "Ground turkey",
  "Beef mince": "Ground beef",
  "Beef sirloin": "Sirloin steak",
  "Lamb leg": "Lamb and mutton",
  Cod: "Cod as food",
  Haddock: "Haddock",
  "Tuna in water": "Canned fish",
  "Farmed salmon": "Salmon as food",
  Mackerel: "Mackerel as food",
  "Sardines in oil": "Sardines as food",
  "Firm tofu": "Tofu",
  "Soft tofu": "Tofu",
  Chickpeas: "Chickpea",
  Lentils: "Lentil",
  "Black beans": "Black turtle bean",
  "Kidney beans": "Kidney bean",
  "White beans": "Navy bean",
  "Split peas": "Split pea",
  Porridge: "Oatmeal",
  Pasta: "Pasta",
  "Wholewheat pasta": "Whole-wheat pasta",
  "Pearl barley": "Pearl barley",
  "Wholemeal bread": "Whole wheat bread",
  "Multigrain bread": "Multigrain bread",
  "Sweet potato": "Sweet potato",
  Mandarin: "Mandarin orange",
  Clementine: "Clementine",
  Kiwi: "Kiwifruit",
  "Medjool dates": "Date palm",
  Prunes: "Prune",
  Courgette: "Zucchini",
  "Brown mushrooms": "Agaricus bisporus",
  "Red-leaf lettuce": "Red leaf lettuce",
  "Butterhead lettuce": "Lettuce",
  "Green beans": "Green bean",
  "Green peas": "Pea",
  Sweetcorn: "Sweet corn",
  Swede: "Rutabaga",
  "Dill pickles": "Pickled cucumber",
  Almonds: "Almond",
  Walnuts: "Walnut",
  Hazelnuts: "Hazelnut",
  Cashews: "Cashew",
  Pistachios: "Pistachio",
  Pecans: "Pecan",
  "Brazil nuts": "Brazil nut",
  "Pine nuts": "Pine nut",
  "Macadamia nuts": "Macadamia",
  Peanuts: "Peanut",
  "Peanut butter": "Peanut butter",
  "Pumpkin seeds": "Pumpkin seed",
  "Sunflower seeds": "Sunflower seed",
  "Flax seeds": "Flaxseed",
  "Sesame seeds": "Sesame",
  "Hemp seeds": "Hemp seed",
  "Dark chocolate": "Dark chocolate",
  "Black coffee": "Coffee",
  "Decaf coffee": "Coffee",
  "Soy drink": "Soy milk",
  "Almond drink": "Almond milk",
  "Oat drink": "Oat milk",
  "Milk kefir": "Kefir",
  "Plain quark": "Quark (dairy product)",
  "Feta-style cheese": "Feta",
  "Wholegrain rye bread": "Rye bread",
  Baguette: "Baguette",
  "Pitta bread": "Pita",
  Muesli: "Muesli",
  Granola: "Granola",
  "New potato": "Potato",
  "Farmed trout": "Trout",
  Prawns: "Shrimp as food",
  "Brussels sprouts": "Brussels sprout",
  "Whey protein": "Whey protein",
  "Soy protein powder": "Soy protein",
  "Wild sea bass": "European seabass",
  "Sea bass": "European seabass",
  Herring: "Herring as food",
  "Hake fillet": "Hake",
  Mussels: "Mussel",
  Scallops: "Scallop",
  "Blue crab": "Crab meat",
  "Low-fat cream cheese": "Cream cheese",
  Camembert: "Camembert",
  Edam: "Edam cheese",
  "Fresh goat cheese": "Goat cheese",
  "Whole goat milk": "Milk",
  "Plain goat yogurt": "Yogurt",
  "Basmati rice": "Basmati",
  "Wholewheat couscous": "Couscous",
  "Whole wheat grains": "Wheat berry",
  Spelt: "Spelt",
  "Rye grain": "Rye",
  Amaranth: "Amaranth grain",
  "Wheat bran": "Bran",
  "Wholewheat English muffin": "English muffin",
  "Corn tortilla": "Corn tortilla",
  "Wheat tortilla": "Flour tortilla",
  "Wholemeal wheat flour": "Whole-wheat flour",
  "Wheat flour": "Wheat flour",
  "Wholemeal rye flour": "Rye flour",
  "Chickpea flour": "Gram flour",
  "Corn flour": "Cornmeal",
  "Puffed rice cakes": "Puffed rice cakes",
  Blackberries: "Blackberry",
  Blackcurrants: "Blackcurrant",
  "Red and white currants": "Redcurrant",
  Plums: "Plum",
  "Fresh figs": "Common fig",
  "Dried figs": "Dried fruit",
  "Dried apricots": "Dried apricot",
  "Honeydew melon": "Honeydew (melon)",
  Cranberries: "Cranberry",
  "Dried goji berries": "Goji",
  "Fresh coconut flesh": "Coconut",
  "Red pepper": "Bell pepper",
  "Green pepper": "Bell pepper",
  "Fennel bulb": "Florence fennel",
  Turnip: "Turnip",
  Aubergine: "Eggplant",
  "Pak choi": "Bok choy",
  "White mushrooms": "Agaricus bisporus",
  "Oyster mushrooms": "Pleurotus ostreatus",
  "Shiitake mushrooms": "Shiitake",
  Rocket: "Eruca vesicaria",
  Ginger: "Ginger",
  "Broad beans": "Vicia faba",
  "Mung beans": "Mung bean",
  "Green lentils": "Lentil",
  "Dried coconut flesh": "Desiccated coconut",
  Chestnuts: "Chestnut",
  "Unsweetened cocoa powder": "Cocoa solids",
  "Tomato passata": "Tomato purée",
  "Tomato paste": "Tomato paste",
  "Black olives": "Olive",
  "Wholegrain mustard": "Mustard (condiment)",
  "Oat bran": "Bran",
  "Poppy seeds": "Poppy seed",
  "Coconut water": "Coconut water",
};

function subject(food: any) {
  const stem = food.name.split(" — ")[0];
  return aliases[stem] ?? stem;
}

let lastRequest = 0;
const cooldownFile = path.join(folder, "host-cooldowns.json");
const cooldowns: Record<string, number> = fs.existsSync(cooldownFile) ? JSON.parse(fs.readFileSync(cooldownFile, "utf8")) : {};
async function request(url: string) {
  const host = new URL(url).hostname;
  for (let attempt = 0; attempt < 4; attempt++) {
    await pause(Math.max(0, (cooldowns[host] || 0) - Date.now()));
    await pause(Math.max(0, 4000 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    const response = await fetch(url, {
      headers: {
        "User-Agent": "SetcraftFoodCatalog/1.0 (generic food photo curation)",
      },
      signal: AbortSignal.timeout(45000),
    });
    if (response.status === 429 || response.status === 503) {
      const wait = Math.max(
        20,
        Number(response.headers.get("retry-after")) || 20 * (attempt + 1),
      );
      console.log(
        `Photo source busy (${new URL(url).hostname}); retrying in ${wait}s`,
      );
      await response.body?.cancel();
      cooldowns[host] = Date.now() + wait * 1000;
      fs.writeFileSync(cooldownFile, JSON.stringify(cooldowns));
      await pause(wait * 1000);
      continue;
    }
    if (!response.ok)
      throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
    return response;
  }
  throw new Error(`${new URL(url).hostname}: rate limit persists`);
}

async function jsonRequest(url: string) {
  const cached = path.join(folder, sha(url) + ".json");
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, "utf8"));
  const payload = (await (await request(url)).json()) as any;
  if (payload.error) throw new Error(payload.error.info);
  fs.writeFileSync(cached, JSON.stringify(payload));
  return payload;
}

async function main() {
  const subjects: string[] = [...new Set<string>(catalog.foods.map(subject))];
  const pages = new Map<string, any>();
  for (let i = 0; i < subjects.length; i += 40) {
    const batch = subjects.slice(i, i + 40);
    const parameters = new URLSearchParams({
      action: "query",
      titles: batch.join("|"),
      prop: "pageimages",
      piprop: "name|original",
      format: "json",
      redirects: "1",
    });
    const payload = await jsonRequest(
      "https://en.wikipedia.org/w/api.php?" + parameters,
    );
    const redirects = new Map<string, string>(
      [
        ...(payload.query?.normalized ?? []),
        ...(payload.query?.redirects ?? []),
      ].map((r: any) => [r.from, r.to]),
    );
    const responsePages: any[] = Object.values(payload.query?.pages ?? {});
    for (const name of batch) {
      let normalized = name;
      for (let j = 0; j < 4 && redirects.has(normalized); j++)
        normalized = redirects.get(normalized)!;
      const page = responsePages.find(
        (p) =>
          p.title === normalized ||
          p.title.toLowerCase() === normalized.toLowerCase(),
      );
      if (page?.pageimage) pages.set(name, page);
    }
  }
  const imageNames: string[] = [
    ...new Set<string>([...pages.values()].map((p) => "File:" + p.pageimage)),
  ];
  for (const item of Object.values(overrides)) if (!imageNames.includes(item.title)) imageNames.push(item.title);
  const imageMetadata = new Map<string, any>();
  for (let i = 0; i < imageNames.length; i += 40) {
    const parameters = new URLSearchParams({
      action: "query",
      titles: imageNames.slice(i, i + 40).join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata|size|mime",
      iiurlwidth: "640",
      iiextmetadatafilter:
        "Artist|LicenseShortName|LicenseUrl|AttributionRequired|Restrictions|ImageDescription",
      format: "json",
    });
    const payload = await jsonRequest(
      "https://commons.wikimedia.org/w/api.php?" + parameters,
    );
    for (const page of Object.values(payload.query?.pages ?? {}) as any[]) {
      if (page.imageinfo?.[0])
        imageMetadata.set(page.title.replace(/_/g, " "), page.imageinfo[0]);
    }
  }
  console.log(
    `Found main images for ${pages.size}/${subjects.length} food subjects`,
  );
  const downloads = new Map<string, { relative: string; hash: string }>();
  let count = 0;
  for (const food of catalog.foods) {
    const latest = JSON.parse(fs.readFileSync(target, "utf8"))[food.id];
    if (latest?.generated || latest?.reviewed || latest?.method === "selected-stock-photo") { output[food.id] = latest; continue; }
    const page = pages.get(subject(food));
    const title = overrides[food.name]?.title ?? (page?.pageimage
      ? "File:" + page.pageimage.replace(/_/g, " ")
      : "");
    if (output[food.id]?.sourceSha256 && output[food.id]?.title === title) continue;
    const info = imageMetadata.get(title);
    if (!info) {
      output[food.id] = {
        name: food.name,
        status: "needs-photo",
        query: subject(food),
        reviewed: false,
      };
      save();
      continue;
    }
    const value = (key: string) =>
      plain(String(info.extmetadata?.[key]?.value ?? ""));
    const license = value("LicenseShortName");
    if (
      !/^(CC0(?: 1\.0)?|Public domain|CC BY(?:-SA)? (?:[1-4]\.0|2\.5)(?: [a-z]{2})?)$/i.test(
        license,
      ) ||
      value("Restrictions") ||
      !/^image\/(jpeg|png|webp)$/.test(info.mime)
    ) {
      output[food.id] = {
        name: food.name,
        status: "needs-photo",
        query: subject(food),
        reason: "Unsupported photo licence/format",
        reviewed: false,
      };
      save();
      continue;
    }
    try {
      let download = downloads.get(title);
      if (!download) {
        const sourceCache = path.join(folder, sha(title) + ".image");
        const bytes = fs.existsSync(sourceCache)
          ? fs.readFileSync(sourceCache)
          : Buffer.from(
              await (
                await request(
                  canonicalImageUrl(info.thumburl || info.url),
                )
              ).arrayBuffer(),
            );
        if (bytes.length > 14 * 1024 * 1024)
          throw new Error("Source photo exceeds size cap");
        fs.writeFileSync(sourceCache, bytes);
        const hash = sha(bytes);
        const relative = `build/food-catalog/source-images/${hash}.image`;
        fs.writeFileSync(path.join(root, relative), bytes);
        download = { relative, hash };
        downloads.set(title, download);
      }
      output[food.id] = {
        name: food.name,
        query: subject(food),
        method: "wikipedia-main-image",
        title,
        sourceUrl: info.descriptionurl,
        originalUrl: info.url,
        author: value("Artist") || "Unknown author",
        license,
        licenseUrl:
          value("LicenseUrl") ||
          "https://creativecommons.org/publicdomain/mark/1.0/",
        attributionRequired: value("AttributionRequired") !== "false",
        description: value("ImageDescription"),
        localSource: download.relative,
        sourceSha256: download.hash,
        status: "pending-visual-review",
        reviewed: false,
      };
      save();
      console.log(`Photo ${++count}: ${food.name} — ${title}`);
    } catch (error: any) {
      console.log(`Pending photo: ${food.name}: ${error.message}`);
    }
  }
  console.log({
    photos: Object.values(output).filter((p: any) => p.sourceSha256).length,
    foods: catalog.foods.length,
  });
}
function canonicalImageUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
  return url.href;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
