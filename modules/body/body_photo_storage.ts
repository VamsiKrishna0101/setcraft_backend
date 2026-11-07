import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { randomUUID } from 'node:crypto';
import { BodyAssessmentPhoto, Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import { BodyError } from './body_types';
import { decodePhotos } from './body_engine';

let client:S3Client|undefined;
function s3() {
  const {R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY}=process.env;
  if(!R2_ACCOUNT_ID||!R2_ACCESS_KEY_ID||!R2_SECRET_ACCESS_KEY)
    throw new BodyError(503,'Photo saving is unavailable. Try again or turn off Save photos.');
  return client??=new S3Client({region:'auto',endpoint:`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:R2_ACCESS_KEY_ID,secretAccessKey:R2_SECRET_ACCESS_KEY},maxAttempts:2,
    requestHandler:new NodeHttpHandler({connectionTimeout:5000,socketTimeout:15000})});
}
// Internal dependency seam for synthetic tests. Never supplied by HTTP clients.
export const bodyPhotoStorage={
  async put(bucket:string,key:string,data:Buffer,mimeType:string) {
    await s3().send(new PutObjectCommand({Bucket:bucket,Key:key,Body:data,ContentType:mimeType,
      CacheControl:'private, no-store'}));
  },
  async get(bucket:string,key:string):Promise<Buffer> {
    const result=await s3().send(new GetObjectCommand({Bucket:bucket,Key:key}));
    if(!result.Body) throw new BodyError(404,'Photo not found.');
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of result.Body as AsyncIterable<Uint8Array>) {
      size+=chunk.length;if(size>2000000) throw new BodyError(502,'This photo could not be loaded.');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  },
  async remove(bucket:string,key:string) {
    await s3().send(new DeleteObjectCommand({Bucket:bucket,Key:key}));
  }
};
export type StoredBodyPhoto={view:string;mimeType:string;sha256:string;bucket:string;objectKey:string};
export async function prepareBodyPhotos(assessmentId:string,photos:ReturnType<typeof decodePhotos>):Promise<StoredBodyPhoto[]> {
  const bucket=process.env.R2_BODY_BUCKET_NAME||'fitai-body-images';
  const prepared:StoredBodyPhoto[]=[];
  try {
    for(const photo of photos) {
      const objectKey=`assessments/${assessmentId}/${randomUUID()}.${photo.mimeType==='image/png'?'png':'jpg'}`;
      const stored={view:photo.view,mimeType:photo.mimeType,sha256:photo.sha256,bucket,objectKey};
      // Register cleanup BEFORE uploading. A crashed request cannot leave an untracked image.
      await prisma.bodyPhotoDeletion.create({data:{bucket,objectKey,notBefore:new Date(Date.now()+15*60000)}});
      prepared.push(stored);
      await bodyPhotoStorage.put(bucket,objectKey,photo.data,photo.mimeType);
    }
    return prepared;
  } catch {
    await discardPreparedPhotos(prepared);
    throw new BodyError(503,'Your photos could not be saved. Try again or turn off Save photos.');
  }
}
export async function attachPreparedPhotos(tx:Prisma.TransactionClient,photos:StoredBodyPhoto[]) {
  for(const p of photos) await tx.bodyPhotoDeletion.deleteMany({where:{bucket:p.bucket,objectKey:p.objectKey}});
}
export async function queuePhotoDeletion(tx:Prisma.TransactionClient,photos:ReadonlyArray<{bucket:string|null;objectKey:string|null}>) {
  for(const p of photos) if(p.bucket&&p.objectKey) await tx.bodyPhotoDeletion.upsert({
    where:{bucket_objectKey:{bucket:p.bucket,objectKey:p.objectKey}},
    create:{bucket:p.bucket,objectKey:p.objectKey},update:{notBefore:new Date()}});
}
export async function discardPreparedPhotos(photos:StoredBodyPhoto[]) {
  await prisma.$transaction(tx=>queuePhotoDeletion(tx,photos));
  await flushBodyPhotoDeletions();
}
let cleaning=false;
export async function flushBodyPhotoDeletions() {
  if(cleaning) return;
  cleaning=true;
  try {
    const pending=await prisma.bodyPhotoDeletion.findMany({where:{notBefore:{lte:new Date()}},take:100,orderBy:{notBefore:'asc'}});
    for(const p of pending) {
      try {
        // Never remove an attached image if a stale cleanup marker exists.
        const attached=await prisma.bodyAssessmentPhoto.count({where:{bucket:p.bucket,objectKey:p.objectKey}})
          + await prisma.progressPhoto.count({where:{bucket:p.bucket,OR:[{objectKey:p.objectKey},{thumbnailKey:p.objectKey}]}});
        if(!attached) await bodyPhotoStorage.remove(p.bucket,p.objectKey);
        await prisma.bodyPhotoDeletion.deleteMany({where:{id:p.id}});
      } catch { /* Retain durable marker for the next retry. No image or credential logging. */ }
    }
  } finally {cleaning=false;}
}
export async function readBodyPhoto(photo:Pick<BodyAssessmentPhoto,'data'|'bucket'|'objectKey'>):Promise<Buffer> {
  if(photo.bucket&&photo.objectKey) {
    try {return await bodyPhotoStorage.get(photo.bucket,photo.objectKey);}
    catch(error) {
      if((error as {name?:string}).name==='NoSuchKey') throw new BodyError(404,'Photo not found.');
      if(error instanceof BodyError) throw error;
      throw new BodyError(503,'This photo is unavailable. Please retry.');
    }
  }
  // Existing privately stored database photos remain readable without moving them silently.
  if(photo.data) return Buffer.from(photo.data);
  throw new BodyError(404,'Photo not found.');
}
