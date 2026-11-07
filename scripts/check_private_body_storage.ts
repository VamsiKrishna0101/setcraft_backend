import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {bodyPhotoStorage} from '../modules/body/body_photo_storage';
import prisma from '../config/prisma';

// Only synthetic bytes. Never uploads existing member photos.
async function main() {
  const bucket=process.env.R2_BODY_BUCKET_NAME||'fitai-body-images';
  const key=`verification/${randomUUID()}.png`;
  const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const publicBase=process.env.R2_BODY_PUBLIC_URL;
  assert(publicBase,'Set the former public URL to verify public access is disabled');
  try {
    await bodyPhotoStorage.put(bucket,key,data,'image/png');
    const publicResponse=await fetch(`${publicBase.replace(/\/$/,'')}/${key}`,{signal:AbortSignal.timeout(15000)});
    assert([401,403,404].includes(publicResponse.status),`Public access must be disabled; got ${publicResponse.status}`);
    assert((await bodyPhotoStorage.get(bucket,key)).equals(data));
    console.log('Private R2 upload/read passed; unauthenticated public access is blocked.');
  } finally {await bodyPhotoStorage.remove(bucket,key);}
  console.log('Synthetic verification image deleted. No member data was uploaded.');
}
main().catch(error=>{console.error('Private storage check failed:',error instanceof assert.AssertionError?error.message:(error as {name?:string}).name);process.exitCode=1;}).finally(()=>prisma.$disconnect());
