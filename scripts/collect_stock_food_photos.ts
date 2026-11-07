import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(__dirname, "..");
const directory = path.join(root, "build/food-catalog/freefoodphotos");
const foods = JSON.parse(fs.readFileSync(path.join(root, "data/generic_foods.json"), "utf8")).foods;
const index: any[] = JSON.parse(fs.readFileSync(path.join(directory, "index.json"), "utf8"));
const registryPath = path.join(root, "data/food_stock_images.json");
const registry: Record<string, any> = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, "utf8")) : {};
const imagePath = path.join(root, "data/food_images.json");
const originalsPath = path.join(root, "data/food_generated_images.json");
const originals = fs.existsSync(originalsPath) ? JSON.parse(fs.readFileSync(originalsPath, "utf8")) : {};
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const choices: Record<string, string> = {
  "Boiled egg": "dairy/boiled_eggs", "Fried egg": "dairy/fried_egg", "Egg": "dairy/eggs_raw",
  "Whole milk": "dairy/milk_drink", "Milk": "dairy/milk_drink", "Skimmed milk": "dairy/milk_drink",
  "Plain yogurt": "dairy/yoghurt", "Low-fat plain yogurt": "dairy/yoghurt", "Fat-free plain yogurt": "dairy/yoghurt",
  "Cottage cheese": "dairy/cottage_cheese", "Salted butter": "dairy/butter", "Unsalted butter": "dairy/butter",
  "Brie": "dairy/soft_cheese_brie", "Feta-style cheese": "dairy/feta_cheese",
  "Beef mince": "meat/beef_mince", "Beef sirloin": "meat/sirlion",
  "Farmed salmon": "seafood/raw_salmon_fillets", "Mackerel": "seafood/mackerel_raw",
  "Sardines in oil": "seafood/canned_sardines", "Smoked salmon": "seafood/smoked_salmon_slices",
  "Chickpeas": "bread/chickpeas", "Rolled oats": "bread/rolled_oats", "White rice": "bread/white_rice",
  "Basmati rice": "bread/basmati_rice", "Pasta": "bread/dry_pasta", "Wheat tortilla": "bread/tortilla",
  "Apple": "fruit/apple_on_white", "Avocado": "fruit/avocado_halved", "Banana": "fruit/banana_slices",
  "Strawberries": "fruit/strawberries_halved", "Raspberries": "fruit/raspberries", "Grapes": "fruit/grape_bunch",
  "Orange": "fruit/halved_orange", "Grapefruit": "fruit/grapefruit", "Lemon": "fruit/lemon_on_white", "Lime": "fruit/limes_sliced",
  "Cucumber": "vegetables/sliced_whole_cucumber", "Tomato": "vegetables/tomato_halves", "Carrot": "vegetables/washed_carrots",
  "Broccoli": "vegetables/broccoli_floretes", "Cauliflower": "vegetables/cauliflower_on_white", "Cabbage": "vegetables/cabbages",
  "Onion": "vegetables/onions", "Brown mushrooms": "vegetables/field_mushrooms", "White mushrooms": "vegetables/white_mushrooms",
  "Asparagus": "vegetables/asparagus_raw", "Green beans": "vegetables/green_beans", "Green peas": "vegetables/fresh_peas",
  "Sweetcorn": "vegetables/sweet_corn_niblets", "Pumpkin": "vegetables/pumpkin_cut_open", "New potato": "vegetables/new_potatoes",
  "Walnuts": "fruit/walnut_kernels", "Cashews": "fruit/cashew_nuts", "Pistachios": "fruit/pistachios", "Peanuts": "fruit/peanuts",
  "Sesame seeds": "bread/sesame_seeds", "Brussels sprouts": "vegetables/brussel_sprouts",
  "Red pepper": "vegetables/red_capsicum", "Green pepper": "vegetables/green_bell_pepper", "Leek": "vegetables/fresh_leeks",
  "Radishes": "vegetables/radishes", "Celery": "vegetables/celery_alone", "Parsnip": "vegetables/parsnips",
  "Aubergine": "vegetables/slices_aubergine", "Oyster mushrooms": "vegetables/oyster_mushrooms",
  "Ginger": "herbs/ginger_bulb", "Poppy seeds": "herbs/poppy_seeds",
};
const exact: Record<string, string> = {
  "Asparagus — boiled": "vegetables/blanched_asparagus", "Aubergine — cooked": "vegetables/aubergine_grilled",
  "Pasta — cooked": "bread/cooked_pasta", "Beef sirloin — grilled": "meat/cooked_sirlion",
  "Farmed salmon — baked": "seafood/cooked_salmon",
  "Potato — boiled": "vegetables/boiled_potatoes", "Potato — baked": "vegetables/roasted_potatoes",
  "Parsnip — braised": "vegetables/parsnip_wedges",
};
let lastRequest = 0;
async function request(url: string) {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 1500 - (Date.now() - lastRequest))));
  lastRequest = Date.now();
  const response = await fetch(url, { headers: { "User-Agent": "SetcraftFoodCatalog/1.0 (licensed food photo selection)" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Photo source HTTP ${response.status}`);
  return response;
}
function save() {
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
  const latest = JSON.parse(fs.readFileSync(imagePath, "utf8"));
  for (const [id, photo] of Object.entries(registry))
    if (!latest[id]?.generated && latest[id]?.sourceSha256 !== photo.sourceSha256) latest[id] = photo;
  const temporary = imagePath + ".stock.tmp";
  fs.writeFileSync(temporary, JSON.stringify(latest, null, 2) + "\n"); fs.renameSync(temporary, imagePath);
}
async function main() {
  const cache = new Map<string, any>();
  for (const food of foods) {
    if (originals[food.id]) continue;
    const chosen = exact[food.name] ?? choices[food.name.split(" — ")[0]];
    if (!chosen || registry[food.id]?.sourceSha256) continue;
    const source = index.find(item => item.category + "/" + item.key === chosen);
    if (!source) { console.log(`Missing selected source: ${chosen}`); continue; }
    try {
      let image = cache.get(chosen);
      if (!image) {
        const pageFile = path.join(directory, `${source.category}-${source.key}.html`);
        const html = fs.existsSync(pageFile) ? fs.readFileSync(pageFile, "utf8") : await (await request(source.sourceUrl)).text();
        fs.writeFileSync(pageFile, html);
        if (!/creativecommons\.org\/licenses\/by\/3\.0/.test(html)) throw new Error("Photo page did not confirm CC BY 3.0");
        const link = html.match(/property=["']contentUrl["'][^>]*href=["']([^"']+)["']/i)?.[1];
        if (!link) throw new Error("No published image download URL");
        const originalUrl = new URL(link, source.sourceUrl).href;
        const imageFile = path.join(directory, `${source.category}-${source.key}.image`);
        const bytes = fs.existsSync(imageFile) ? fs.readFileSync(imageFile) : Buffer.from(await (await request(originalUrl)).arrayBuffer());
        fs.writeFileSync(imageFile, bytes);
        const sourceSha256 = sha(bytes), localSource = `build/food-catalog/source-images/${sourceSha256}.image`;
        fs.writeFileSync(path.join(root, localSource), bytes);
        image = { title: source.key.replace(/_/g, " "), provider: "FreeFoodPhotos.com", sourceUrl: source.sourceUrl, originalUrl,
          author: "FreeFoodPhotos.com", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
          licenseEvidenceUrl: "https://www.freefoodphotos.com/imagelicense.html", sourceSha256, localSource,
          reviewed: false, status: "pending-visual-review", method: "selected-stock-photo" };
        cache.set(chosen, image);
      }
      registry[food.id] = { ...image, name: food.name };
      save(); console.log(`Stock photo: ${food.name} — ${chosen}`);
    } catch (error: any) { console.log(`Photo pending: ${food.name}: ${error.message}`); }
  }
  console.log({ stockFoodPhotos: Object.keys(registry).length });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
