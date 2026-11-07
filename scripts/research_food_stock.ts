import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../build/food-catalog/freefoodphotos");
fs.mkdirSync(root, { recursive: true });
async function main() {
  if (process.argv.includes("--index")) {
    const categories = ["dairy", "vegetables", "bread", "breakfast", "drinks", "fruit", "herbs", "meat", "seafood", "cooking"];
    const photos: any[] = [];
    for (const category of categories) {
      const url = `https://www.freefoodphotos.com/imagelibrary/${category}/`;
      const file = path.join(root, `${category}.html`);
      let html = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!html) {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) { console.log(`${category}: HTTP ${response.status}`); continue; }
        html = await response.text(); fs.writeFileSync(file, html);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(match => new URL(match[1]!, url).href);
      for (const link of new Set(links)) {
        const matched = link.match(/\/imagelibrary\/([^/]+)\/slides\/([^/]+)\.html$/);
        if (matched && matched[2] !== "void") photos.push({ category: matched[1], key: matched[2], sourceUrl: link,
          imageUrl: link.replace(/\.html$/, ".jpg") });
      }
      console.log(`${category}: ${photos.filter(p => p.category === category).length} source photo pages`);
      fs.writeFileSync(path.join(root, "index.json"), JSON.stringify(photos, null, 2));
    }
    fs.writeFileSync(path.join(root, "index.json"), JSON.stringify(photos, null, 2));
    return;
  }
  const url = process.argv[2] || "https://www.freefoodphotos.com/imagelibrary/vegetables/";
  const response = await fetch(url, { headers: { "User-Agent": "SetcraftFoodCatalog/1.0 (food photo selection)" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Photo library HTTP ${response.status}`);
  const html = await response.text();
  fs.writeFileSync(path.join(root, "last-page.html"), html);
  const links = [...html.matchAll(/(?:href|src|data-src)=["']([^"']+)["']/gi)].map(match => new URL(match[1]!, url).href);
  console.log(JSON.stringify([...new Set(links.filter(link => /imagelibrary|large|medium|robots/.test(link)))], null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
