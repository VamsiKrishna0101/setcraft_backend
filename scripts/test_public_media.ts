import assert from 'node:assert/strict';
import express from 'express';
import { inject } from 'light-my-request';
import { PUBLIC_MEDIA_BUCKETS, createPublicMediaRewriter } from '../utils/public_media';
import { preferredExerciseMedia, verifiedVideoVariant } from '../utils/exercise_media';

async function main() {
  const saved = Object.fromEntries(PUBLIC_MEDIA_BUCKETS.map(bucket => [bucket.env, process.env[bucket.env]]));
  try {
    for (const bucket of PUBLIC_MEDIA_BUCKETS) delete process.env[bucket.env];
    const male = PUBLIC_MEDIA_BUCKETS[0].legacy;
    const female = PUBLIC_MEDIA_BUCKETS[1].legacy;
    assert.equal(createPublicMediaRewriter()(`${male}/video.mp4`), `${male}/video.mp4`);
    process.env.R2_EXERCISE_PUBLIC_URL = 'https://media.setcraft.fit';
    process.env.R2_EXERCISE_FEMALE_PUBLIC_URL = 'https://media-female.setcraft.fit';
    process.env.R2_FOOD_PUBLIC_URL = 'https://food-images.setcraft.fit';
    const rewrite = createPublicMediaRewriter();
    const privateUrl = 'https://pub-4bcfc761736c48139b321f10d3e5293c.r2.dev/private.jpg';
    const original = { video: `${male}/videos/a%20b.mp4`, nested: [{ url: `${female}/poster.webp` }], privateUrl };
    assert.deepEqual(rewrite(original), { video: 'https://media.setcraft.fit/videos/a%20b.mp4', nested: [{ url: 'https://media-female.setcraft.fit/poster.webp' }], privateUrl });
    assert.equal(original.video, `${male}/videos/a%20b.mp4`);
    for (const value of [`${male}.evil.example/video.mp4`, `${male}/video.mp4?signature=secret`, `${male}/video.mp4#fragment`, 'https://user:pass@pub-2111ee02db9e4d4396611479b3804ef3.r2.dev/a.mp4']) assert.equal(rewrite(value), value);
    assert(verifiedVideoVariant({url: 'https://media.setcraft.fit/video.mp4'}));
    assert.equal(preferredExerciseMedia({female: {url: 'https://media.setcraft.fit/video.mp4'}}, 'female'), null);
    assert(preferredExerciseMedia({female: {url: 'https://media-female.setcraft.fit/video.mp4'}}, 'female'));
    const date = new Date('2026-11-05T00:00:00Z');
    assert.equal(rewrite(date), date);
    const app = express();
    app.use((_req, res, next) => {
      const json = res.json;
      res.json = function (body) { return json.call(this, rewrite(body)); };
      next();
    });
    app.get('/cached', (_req, res) => res.json({...original, date}));
    const response = await inject(app, {method: 'GET', url: '/cached'});
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().video, 'https://media.setcraft.fit/videos/a%20b.mp4');
    assert.equal(response.json().date, date.toISOString());
    process.env.R2_EXERCISE_PUBLIC_URL = 'http://media.setcraft.fit/path';
    assert.throws(createPublicMediaRewriter);
    console.log('Public media migration checks passed');
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
