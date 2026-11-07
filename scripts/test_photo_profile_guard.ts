import assert from 'node:assert/strict';
import prisma from '../config/prisma';
import {startBodyReview} from '../modules/body/body_service';
import {BodyError, reviewSchema} from '../modules/body/body_types';

async function main() {
  const delegate = prisma.onboarding;
  const original = delegate.findUnique;
  const input = reviewSchema.parse({recordedDate: '2026-10-20', utcOffsetMinutes: 330,
    consentToPhotoAnalysis:true,analysisProvider:"OPENAI" as const, consentToVisualCoaching: true,
    photos: [{view: 'front', mimeType: 'image/png', base64: 'a'.repeat(100)}]});
  try {
    for (const [profile, expected] of [
      [null, /Complete your profile/],
      [{age: 17}, /18 and over/],
      // An adult passes the age gate and reaches image validation. No photo is
      // uploaded and no assessment, job, or database row is created by this test.
      [{age: 18}, /photo|PNG|JPEG/i],
    ] as const) {
      delegate.findUnique = (async () => profile) as unknown as typeof original;
      await assert.rejects(() => startBodyReview('synthetic-profile-test', input),
        error => error instanceof BodyError && expected.test(error.message));
    }
  } finally {
    delegate.findUnique = original;
    await prisma.$disconnect();
  }
  console.log('Photo review profile checks passed: missing setup, under 18, adult boundary. No DB writes or AI calls.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
