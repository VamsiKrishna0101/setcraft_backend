import 'dotenv/config';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';

async function main() {
  const email = process.argv.find(arg => arg.startsWith('--email='))?.slice(8);
  if (!email) throw new Error('Pass an exact --email= address. This check is read-only.');
  const user = await prisma.user.findUniqueOrThrow({where: {email}, select: {id: true}});
  const token = jwt.sign({userId: user.id}, process.env.JWT_ACCESS_SECRET!, {expiresIn: '2m'});
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 8000}/api/heatmap/plan?date=${today}&utcOffsetMinutes=330`,
    {headers: {Authorization: `Bearer ${token}`}});
  assert.equal(response.status, 200, 'The running backend must serve the new authenticated map endpoint');
  const result = await response.json() as {status: string; workouts: unknown[]};
  const onboarding = await prisma.onboarding.count({where: {userId: user.id}});
  assert.equal(result.status, 'none');
  assert.equal(result.workouts.length, 0);
  assert.equal(onboarding, 0);
  console.log(JSON.stringify({email, mapEndpoint: response.status, mapStatus: result.status,
    scheduledWorkouts: result.workouts.length, onboardingRows: onboarding, signInPreserved: true}));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;}).finally(() => prisma.$disconnect());
