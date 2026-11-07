import 'dotenv/config';
import fs from 'node:fs';
const source = JSON.parse(fs.readFileSync('exercises.json','utf8'));
const base = process.env.EXERCISE_VIDEO_BASE_URL?.replace(/\/+$/,'');
if (!base?.startsWith('https://')) throw new Error('Exercise media base is not configured');
async function main() {
  const rows = [source[0],source[100],source[500],source[source.length-1]];
  for (const row of rows) for (const field of ['image','gif_url']) {
    if (field === 'gif_url' && row[field] === null) continue;
    const url = row[field].startsWith('https://') ? row[field] : `${base}/${row[field]}`;
    const response = await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(15000)});
    console.log(JSON.stringify({code:row.id,type:field,status:response.status,contentType:response.headers.get('content-type'),bytes:response.headers.get('content-length')}));
    if (!response.ok) process.exitCode = 1;
  }
}
main().catch(() => { console.error('Media check could not reach the configured CDN'); process.exitCode=1; });
