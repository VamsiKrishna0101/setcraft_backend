import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import prisma from '../config/prisma';

// Only the six deterministic items from the original requested preview.
// The shared exercise catalog can still be used in real plans that earn XP.
async function main() {
  const email = 'vklvl0101@gmail.com';
  const date = '2026-10-06';
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const ids = Array.from({ length: 6 }, (_, index) => {
    const hex = createHash('sha256').update(`fitai-today-preview:${email}:${date}:exercise:${index}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  });
  await prisma.$transaction(async tx => {
    const where = { userWorkout: { userId: user.id }, id: { in: ids } };
    const rows = await tx.userWorkoutItem.findMany({ where });
    assert.equal(rows.length, 6, 'Expected exactly the original six preview items.');
    for (const row of rows) assert.equal(row.dayOfWeek, 'TUESDAY');
    await tx.userWorkoutItem.updateMany({ where, data: { sourceProvider: 'FITAI_PREVIEW' } });
  });
  console.log('Tagged exactly six preview session items; training values preserved.');
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error.message); process.exitCode = 1; });
