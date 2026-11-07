import prisma from '../config/prisma';
import redis from '../config/redis';

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'vklvl0101@gmail.com' },
  });
  if (!user) { console.log('User not found'); return; }

  await prisma.onboarding.update({
    where: { userId: user.id },
    data: { name: 'V' },
  });

  await redis.del(`home:${user.id}`);
  console.log(`✅ Name updated to "V", Redis cache busted for user ${user.id}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
