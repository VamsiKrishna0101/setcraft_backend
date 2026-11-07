import 'dotenv/config';
import prisma from '../config/prisma';

async function main() {
  const email = process.argv.find(arg => arg.startsWith('--email='))?.slice(8);
  if (!email) throw new Error('An exact --email is required. Read-only diagnostic.');
  const user = await prisma.user.findUniqueOrThrow({where: {email}, select: {
    onboarding: {select: {age: true, updatedAt: true}},
  }});
  console.log(JSON.stringify({profileExists: !!user.onboarding,
    age: user.onboarding?.age ?? null, updatedAt: user.onboarding?.updatedAt ?? null}));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;})
  .finally(() => prisma.$disconnect());
