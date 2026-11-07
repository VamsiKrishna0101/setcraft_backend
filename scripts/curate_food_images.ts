import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Candidate = {
  title: string;
  originalUrl: string;
  downloadUrl: string;
  sourceUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  attributionRequired: boolean;
  description: string;
  width: number;
  height: number;
  score: number;
};
const root = path.resolve(__dirname, "..");
const catalogFile =
  process.argv.find((v) => v.startsWith("--catalog="))?.slice(10) ??
  "data/generic_foods.json";
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, catalogFile), "utf8"),
);
const searchFolder = path.join(root, "build/food-catalog/commons-search");
const imageFolder = path.join(root, "build/food-catalog/source-images");
const target = path.join(root, "data/food_images.json");
fs.mkdirSync(searchFolder, { recursive: true });
fs.mkdirSync(imageFolder, { recursive: true });
const manifest: Record<string, any> = fs.existsSync(target)
  ? JSON.parse(fs.readFileSync(target, "utf8"))
  : {};
const overridesFile = path.join(root, "data/food_image_queries.json");
const overrides = fs.existsSync(overridesFile)
  ? JSON.parse(fs.readFileSync(overridesFile, "utf8"))
  : {};
const limit = Number(
  process.argv.find((v) => v.startsWith("--limit="))?.split("=")[1] ?? 300,
);
const filter = process.argv.find((v) => v.startsWith("--only="))?.slice(7);
const clean = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const save = () =>
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequest = 0;

async function get(url: string) {
  // Be polite to Commons and reuse local search results on every resumed run.
  await pause(Math.max(0, 1800 - (Date.now() - lastRequest)));
  lastRequest = Date.now();
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SetcraftFoodCatalog/1.0 (generic food image curation)",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Image source HTTP ${response.status}`);
  return response;
}

async function search(query: string): Promise<Candidate[]> {
  const file = path.join(searchFolder, hash(query) + ".json");
  let payload;
  if (fs.existsSync(file)) payload = JSON.parse(fs.readFileSync(file, "utf8"));
  else {
    const parameters = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query + " filetype:bitmap",
      gsrnamespace: "6",
      gsrlimit: "20",
      prop: "imageinfo",
      iiprop: "url|extmetadata|size|mime",
      iiurlwidth: "640",
      iiextmetadatafilter:
        "Artist|LicenseShortName|LicenseUrl|AttributionRequired|Restrictions|ImageDescription|Categories",
      format: "json",
      maxlag: "5",
    });
    payload = (await (
      await get("https://commons.wikimedia.org/w/api.php?" + parameters)
    ).json()) as any;
    if (payload.error) throw new Error(payload.error.info);
    fs.writeFileSync(file, JSON.stringify(payload));
  }
  const tokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2 && !["food", "bowl", "glass"].includes(t));
  return Object.values(payload.query?.pages ?? {})
    .flatMap((page: any) => {
      const info = page.imageinfo?.[0];
      if (
        !info ||
        !/^image\/(jpeg|png|webp)$/.test(info.mime) ||
        Math.min(info.width, info.height) < 280
      )
        return [];
      const metadata = info.extmetadata ?? {};
      const value = (key: string) => clean(String(metadata[key]?.value ?? ""));
      const license = value("LicenseShortName");
      if (
        !/^(CC0(?: 1\.0)?|Public domain|CC BY(?:-SA)? [1-4]\.0)$/i.test(
          license,
        ) ||
        value("Restrictions")
      )
        return [];
      const title = String(page.title);
      const description = value("ImageDescription");
      const content = title + " " + description;
      if (
        /microscop|diagram|logo|coat.of.arms|map of|painting|drawing|illustration|engraving|advertisement|label|packaging|supermarket|shop shelf|store shelf|scanning.electron|signboard|protein.*brand|road|portrait|restaurant menu|FMIB|BioArt|Sturm\d|Vanity Fair|harvest|fishing|carrying|products|omelette|pastrami|croissant|medizinal|köhler|herbarium|flower|bloom|woodville|field|plantation|skippy|chobani|unilever/i.test(
          content,
        )
      )
        return [];
      let score = 30 - Number(page.index ?? 20);
      score -= title.length / 4;
      for (const token of tokens)
        if (title.toLowerCase().includes(token)) score += 20;
        else if (content.toLowerCase().includes(token)) score += 3;
      if (tokens.every((t) => title.toLowerCase().includes(t))) score += 25;
      if (
        /\b(raw|cooked|roasted|boiled|grilled|steamed|dry|dried)\b/i.test(query)
      ) {
        const preparation = query.match(
          /\b(raw|cooked|roasted|boiled|grilled|steamed|dry|dried)\b/i,
        )![0];
        if (!content.toLowerCase().includes(preparation.toLowerCase()))
          score -= 30;
      }
      if (info.width / info.height > 2.5 || info.height / info.width > 2.5)
        score -= 15;
      return [
        {
          title,
          originalUrl: info.url,
          downloadUrl: info.thumburl ?? info.url,
          sourceUrl: info.descriptionurl,
          author: value("Artist"),
          license,
          licenseUrl:
            value("LicenseUrl") ||
            "https://creativecommons.org/publicdomain/mark/1.0/",
          attributionRequired: value("AttributionRequired") !== "false",
          description,
          width: info.width,
          height: info.height,
          score,
        },
      ];
    })
    .sort((a, b) => b.score - a.score);
}

async function main() {
  if (process.argv.includes("--repair")) {
    const specs: {query:string; names:string[]}[] = JSON.parse(fs.readFileSync(path.join(root,"data/food_photo_searches.json"),"utf8"));
    const repairsPath = path.join(root,"data/food_photo_repairs.json");
    const repairs: Record<string,any> = fs.existsSync(repairsPath) ? JSON.parse(fs.readFileSync(repairsPath,"utf8")) : {};
    for (const spec of specs) {
      const current = JSON.parse(fs.readFileSync(target,"utf8"));
      const selectedFoods = catalog.foods.filter((f:any)=>spec.names.includes(f.name) && !current[f.id]?.generated && !repairs[f.id]?.sourceSha256);
      if (!selectedFoods.length) continue;
      try {
        const candidates = await search(spec.query);
        const selected = candidates[0];
        if (!selected) { console.log(`No suitable photo: ${spec.query}`); continue; }
        const cacheFile = path.join(imageFolder,hash(selected.title)+".image");
        const image = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile) : Buffer.from(await (await get(selected.downloadUrl)).arrayBuffer());
        fs.writeFileSync(cacheFile,image);
        const sourceSha256 = hash(image), localSource = `build/food-catalog/source-images/${sourceSha256}.image`;
        fs.writeFileSync(path.join(root,localSource),image);
        const latest = JSON.parse(fs.readFileSync(target,"utf8"));
        for (const food of selectedFoods) {
          const photo = {name:food.name,query:spec.query,...selected,localSource,sourceSha256,
            provider:"Wikimedia Commons",status:"pending-visual-review",reviewed:false,method:"review-replacement"};
          repairs[food.id]=photo; latest[food.id]=photo;
        }
        fs.writeFileSync(repairsPath,JSON.stringify(repairs,null,2)+"\n");
        const temporary=target+".repair.tmp";fs.writeFileSync(temporary,JSON.stringify(latest,null,2)+"\n");fs.renameSync(temporary,target);
        console.log(`Replacement: ${spec.query} — ${selected.title}`);
      } catch(error:any) { console.log(`Replacement pending: ${spec.query}: ${error.message}`); }
    }
    return;
  }
  const research = process.argv.find(value => value.startsWith("--research="))?.slice(11);
  if (research) {
    const candidates = await search(research);
    console.log(JSON.stringify(candidates.map(candidate => ({ title: candidate.title, license: candidate.license,
      description: candidate.description.slice(0, 160), score: candidate.score })), null, 2));
    return;
  }
  let prepared = 0;
  for (const food of catalog.foods) {
    if (prepared >= limit) break;
    if (filter && !food.name.toLowerCase().includes(filter.toLowerCase()))
      continue;
    if (
      manifest[food.id]?.sourceSha256 &&
      fs.existsSync(path.join(root, manifest[food.id].localSource))
    )
      continue;
    const query =
      overrides[food.id]?.query ??
      food.sourceDetails.imageSearch ??
      food.name.split(" — ")[0];
    try {
      const candidates = await search(query);
      let selected = overrides[food.id]?.title
        ? candidates.find((c) => c.title === overrides[food.id].title)
        : candidates[0];
      if (!selected) {
        const restricted = await search(query + ' incategory:"CC-Zero"');
        selected = restricted[0];
      }
      if (!selected) {
        manifest[food.id] = {
          name: food.name,
          query,
          status: "needs-photo",
          reviewed: false,
        };
        console.log(`Needs photo: ${food.name}`);
        save();
        continue;
      }
      const image = Buffer.from(
        await (await get(selected.downloadUrl)).arrayBuffer(),
      );
      if (image.length > 12 * 1024 * 1024)
        throw new Error("Source photo exceeds size cap");
      const sourceHash = hash(image);
      const localSource = `build/food-catalog/source-images/${sourceHash}.image`;
      fs.writeFileSync(path.join(root, localSource), image);
      manifest[food.id] = {
        name: food.name,
        query,
        ...selected,
        localSource,
        sourceSha256: sourceHash,
        status: "pending-visual-review",
        reviewed: false,
      };
      prepared++;
      console.log(`Prepared ${prepared}: ${food.name} — ${selected.title}`);
      save();
    } catch (error: any) {
      console.warn(`Photo pending: ${food.name}: ${error.message}`);
      manifest[food.id] = {
        name: food.name,
        query,
        status: "needs-photo",
        reviewed: false,
      };
      save();
    }
  }
  console.log({
    downloaded: Object.values(manifest).filter((m: any) => m.sourceSha256)
      .length,
    pending:
      catalog.foods.length -
      Object.values(manifest).filter((m: any) => m.sourceSha256).length,
  });
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
