import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PUBLIC_MEDIA_BUCKETS, publicMediaOrigin } from '../utils/public_media';

const buckets = ['fitai-exercise-media', 'fitai-exercise-media-female', 'fitai-exercise-images', 'fitai-food-images'];

async function main() {
  const {R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY} = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) throw new Error('R2 S3 credentials are required');
  const client = new S3Client({region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY}, maxAttempts: 2});
  try {
    for (const [index, bucket] of PUBLIC_MEDIA_BUCKETS.entries()) {
      const origin = publicMediaOrigin(bucket.env, bucket.legacy);
      if (origin === bucket.legacy || new URL(origin).hostname.endsWith('.r2.dev')) {
        throw new Error(`${bucket.env} must point to an active custom domain`);
      }
      const listed = await client.send(new ListObjectsV2Command({Bucket: buckets[index], MaxKeys: 20}));
      const object = listed.Contents?.find(item => item.Key && (item.Size ?? 0) > 0 && !item.Key.endsWith('/'));
      if (!object?.Key) throw new Error(`${buckets[index]} has no test object`);
      const path = object.Key.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${origin}/${path}`, {headers: {Range: 'bytes=0-0'}, redirect: 'error', signal: AbortSignal.timeout(20000)});
      await response.body?.cancel();
      if (response.status !== 200 && response.status !== 206) throw new Error(`${buckets[index]} returned HTTP ${response.status}`);
      console.log(`${buckets[index]}: HTTPS object request passed (${response.status})`);
    }
  } finally { client.destroy(); }
}
void main().catch(error => {
  // Network SDK errors may contain request details; report only the message.
  console.error(error instanceof Error ? error.message : 'Production media check failed');
  process.exitCode = 1;
});
