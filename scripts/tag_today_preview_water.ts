import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import prisma from '../config/prisma';

// Backfill only the three deterministic records created by the earlier preview.
// Their amounts/dates are checked first and never changed.
async function main() {
  const email = 'vklvl0101@gmail.com';
  const date = '2026-10-06';
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const ids = [0, 1, 2].map(index => {
    const hex = createHash('sha256').update(`fitai-today-preview:${email}:${date}:water:${index}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  });
  await prisma.$transaction(async tx => {
    const rows = await tx.userWaterLog.findMany({ where: { userId: user.id, id: { in: ids } } });
    assert.equal(rows.length, 3, 'Expected exactly the three original preview records.');
    for (const row of rows) {
      assert.equal(row.day, '6'); assert.equal(row.month, '10'); assert.equal(row.year, '2026');
      assert.equal(row.amountMl, [500, 500, 450][ids.indexOf(row.id)]);
    }
    await tx.userWaterLog.updateMany({ where: { userId: user.id, id: { in: ids } },
      data: { sourceProvider: 'FITAI_PREVIEW' } });
  });
  console.log('Tagged exactly three preview water logs; amounts and dates preserved.');
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error.message); process.exitCode = 1; });
