const assert = require('node:assert/strict');

const SOURCE_HOST = 'd2l9nsnmtah87f.cloudfront.net';
function normalizeName(value) {
  return String(value).toLowerCase().replace(/°/g, '')
    .replace(/\b(?:male|fix|small|thumbnail)\b/g, ' ')
    .replace(/\bm\s*$/g, ' ').replace(/revers\b/g, 'reverse')
    .replace(/rollerer\b/g, 'roller').replace(/rollerout\b/g, 'rollout')
    .replace(/bycicle\b/g, 'bicycle').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/\b(?:v|version) ([23])\b/g, 'variant $1')
    .replace(/\biii\b/g, 'variant 3').replace(/\bii\b/g, 'variant 2')
    .replace(/\s+/g, ' ');
}
function sourceTitle(media) { return media.label.split('_')[0]; }
function sourceCode(media) { return media.sourceAssetId.slice(0, -4).padStart(4, '0'); }
function isMale(media) {
  return media.gender === 'male' && !/female|woman|women|\((?:femal|fema|fem|fe|f)\.mp4$/i.test(media.filename);
}
function validateSource(media) {
  const url = new URL(media.url);
  assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, SOURCE_HOST);
  assert.equal(url.search, ''); assert.equal(url.hash, ''); assert.equal(url.username, '');
  assert.equal(url.password, ''); assert.equal(url.port, '');
  assert.ok(url.pathname.startsWith('/exercise-assets/'));
  assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)), media.filename);
  assert.ok(/^[\d]{8,10}[- _][\w ().,%+-]+\.mp4$/.test(media.filename));
  assert.equal(media.filename.split('-')[0], media.sourceAssetId);
}

// Explicit identity checks for catalogue/source naming differences. Matching
// still requires this exact source ID AND this exact canonical catalogue name.
// These are reviewed movement identities, never nearest-name substitutions.
const REVIEWED_BY_CODE = {
  '0121': ['barbell upright row v. 3', 'Barbell-Upright-Row'],
  '0292': ['dumbbell one arm bent-over row', 'Dumbbell-Bent-over-Row'],
  '0466': ['gironda sternum chin', 'Sternum-Pull-up-(Gironda)'],
  '0576': ['lever chest press', 'Lever-Chest-Press-(plate-loaded)'],
  '0587': ['lever military press', 'Lever-Military-Press-(plate-loaded)'],
  '0588': ['lever narrow grip seated row', 'Lever-Neutral-Grip-Seated-Row-(plate-loaded)'],
  '0593': ['lever reverse hyperextension', 'Lever-Reverse-Hyperextension-(plate-loaded)'],
  '0594': ['lever seated calf raise', 'Lever-Seated-Calf-Raise-(plate-loaded)'],
  '0604': ['lever shrug', 'Lever-Shrug-(plate-loaded)'],
  '0606': ['lever t bar row', 'Lever-T-bar-Row-(plate-loaded)'],
  '0677': ['ring dips', 'Ring-Dip'],
  '1359': ['smith bent over row', 'Smith-Bent-Over-Pronated-Grip-Row'],
  '1479': ['lever incline chest press v. 2', 'Lever-Incline-Chest-Press'],
  '2285': ['lever pullover', 'Lever-Pullover-(plate-loaded)'],
  '2371': ['weighted russian twist v. 2', 'Weighted-Russian-Twist'],
  '3200': ['lever bent-over row with v-bar', 'Lever-Bent-over-Row-with-V-bar-(plate-loaded)'],
};
// Only existing demo records need these aliases; canonical exercises retain their
// original identities. Specific equipment/variation checks are not discarded.
const REVIEWED_DEMO = {
  'pec deck machine fly': '10301201',
  'svend press chest': '08561201',
  'barbell back squat': '00431201',
  'barbell bulgarian split squat': '00991201',
};

function buildMatches(workouts, catalog, sources, options = {}) {
  assert.equal(new Set(workouts.map(w => w.id)).size, workouts.length);
  assert.equal(new Set(catalog.map(w => String(w.id))).size, catalog.length);
  const canonical = new Map(catalog.map(w => [String(w.id), w]));
  const male = sources.filter(options.isMale || isMale);
  male.forEach(options.validateSource || validateSource);
  assert.equal(new Set(male.map(m => m.url)).size, male.length);
  const indexed = male.map(media => ({media, title:normalizeName(sourceTitle(media)), code:sourceCode(media)}));
  const results = workouts.map(workout => {
    const row = canonical.get(workout.exerciseCode);
    const name = normalizeName(row?.name ?? workout.name);
    const reviewed = row && REVIEWED_BY_CODE[row.id];
    const reviewedName = reviewed && normalizeName(reviewed[0]);
    const reviewedTitle = reviewed && normalizeName(reviewed[1]);
    const candidates = indexed.flatMap(({media,title,code}) => {
      const sameCode = !!row && code === row.id;
      if (sameCode && title === name) return [{media, rank: 3, method:'code-and-name'}];
      if (sameCode && reviewed && name === reviewedName && title === reviewedTitle) {
        return [{media,rank:3,method:'reviewed-code-and-movement'}];
      }
      if (title === name) return [{media, rank:2, method:'exact-name-and-equipment'}];
      if (!row && workout.exerciseCode?.startsWith('today-preview:') && REVIEWED_DEMO[workout.name.toLowerCase()] === media.sourceAssetId) {
        return [{media,rank:3,method:'reviewed-demo-movement'}];
      }
      return [];
    }).sort((a,b)=>b.rank-a.rank || a.media.filename.localeCompare(b.media.filename));
    const best = candidates.filter(c=>c.rank === candidates[0]?.rank);
    // Multiple equally good, differently numbered source variants need review.
    if (best.length !== 1) return {...workout, source:null, reason:best.length ? 'ambiguous-source-variants' : 'no-confirmed-male-match', candidates:best.map(c=>c.media.filename)};
    return {...workout, source:best[0].media, method:best[0].method};
  });
  return results;
}
module.exports={SOURCE_HOST,normalizeName,sourceTitle,sourceCode,isMale,validateSource,buildMatches};
