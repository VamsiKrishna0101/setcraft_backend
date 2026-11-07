const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('build/media-migration');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const plan = read('plan.json'), audit = read('audit.json'), applied = read('database-applied.json');
const uploaded = read('uploaded.json'), cleanup = read('cleanup.json'), benchmark = read('benchmark.json');
for (const entry of plan.entries) {
  const row = audit.workouts.find(w => w.exerciseCode === entry.code);
  if (!row || row.videoUrl !== entry.videoUrl || row.thumbnailUrl !== entry.thumbnailUrl) throw new Error('Final URL mapping differs from plan');
}
const date = new Date(benchmark.measuredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long', timeStyle: 'short' });
const summary = type => {
  const values = benchmark.results.filter(r => r.type === type).map(r => r.fullDownloadMs).sort((a, b) => a - b);
  return { minimum: (values[0] / 1000).toFixed(3), maximum: (values.at(-1) / 1000).toFixed(3), median: (values[Math.floor(values.length / 2)] / 1000).toFixed(3) };
};
const gif = summary('gif'), image = summary('image');
const lines = [
  '# Exercise media migration and measured loading times', '',
  `Completed ${date} IST.`, '',
  `- Uploaded and checksum-verified ${plan.entries.filter(e => !e.fallback).length} new animated GIFs (360 × 360).`,
  '- Exercise 0609 was missing locally. Its existing 180 × 180 animation was copied to a new URL and retained.',
  `- Removed ${cleanup.removedOldGifs} audited old GIFs from \`${plan.bucket}\`. Final GIF count: ${cleanup.finalGifs}.`,
  `- Updated only \`Workout.videoUrl\` and \`Workout.thumbnailUrl\` for ${applied.updatedRecords} exercise records.`,
  `- Preserved all ${applied.allExerciseRecords} records and every other Workout field, verified by a transaction fingerprint.`,
  '- Preserved the six unmatched preview exercise records, names, translations, timestamps, and workout history.',
  '- Verified all 1,324 existing image files against their Cloudflare object checksums. The image bucket was not modified.',
  '- Synced only the GIF URL fields in exercises.json and exercise_catalog.app.json; translations and image paths were preserved.',
  `- Upload and verification duration: ${uploaded.elapsedSeconds} seconds for approximately ${(plan.entries.reduce((s,e) => s + e.bytes, 0)/1e6).toFixed(1)} MB.`, '',
  '## Actual full downloads from this computer', '',
  'Three exercise sizes were tested, with one first request per asset and two repeat requests. All 18 public requests returned HTTP 200 from Cloudflare. GIF downloads also matched the uploaded SHA-256 checksums.', '',
  '| Media | Full download range | Median |',
  '| --- | ---: | ---: |',
  `| GIFs | ${gif.minimum}–${gif.maximum} seconds | ${gif.median} seconds |`,
  `| Images | ${image.minimum}–${image.maximum} seconds | ${image.median} seconds |`, '',
  '| Exercise | GIF size | First GIF download | Repeat GIF downloads | First image download | Repeat image downloads |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
];
for (const code of [...new Set(benchmark.results.map(r => r.code))]) {
  const gifs = benchmark.results.filter(r => r.code === code && r.type === 'gif');
  const images = benchmark.results.filter(r => r.code === code && r.type === 'image');
  const seconds = r => `${(r.fullDownloadMs / 1000).toFixed(3)} s`;
  lines.push(`| ${code} | ${(gifs[0].bytes/1000).toFixed(1)} KB | ${seconds(gifs[0])} | ${gifs.slice(1).map(seconds).join(', ')} | ${seconds(images[0])} | ${images.slice(1).map(seconds).join(', ')} |`);
}
lines.push('', 'These timings include HTTP response latency and the entire file download. They exclude GIF decoding, phone rendering, and the app’s local cache. A first asset request does not prove a globally cold Cloudflare cache. Phone/network results will vary.', '',
  '## View in the app', '',
  'Pull to refresh the exercise library to replace the previous locally cached catalogue. The new GIF URLs are versioned, so old animation bytes cannot be reused for the new URLs.', '',
  `[Preview exercise 0001 GIF](${plan.entries.find(e => e.code === '0001').videoUrl})`, '',
  'Backups and evidence: database-before.json, source JSON .before files, plan.json, uploaded.json, database-applied.json, deletion-manifest.json, cleanup.json, and benchmark.json in this directory.', '');
fs.writeFileSync(path.join(root, 'report.md'), lines.join('\n'));
console.log(JSON.stringify({ verifiedDatabaseMediaMappings: plan.entries.length, gifSeconds: gif, imageSeconds: image, report: 'build/media-migration/report.md' }, null, 2));
