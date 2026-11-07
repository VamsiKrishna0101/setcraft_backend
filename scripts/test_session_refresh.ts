import 'dotenv/config';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { refreshSession } from '../modules/auth/auth_service';
async function main() {
const original=prisma.user.findUnique;
(prisma.user as any).findUnique=async ({where}:any)=>where.id==='synthetic-owner'?{id:where.id,email:'synthetic@example.test'}:null;
try {
  const refresh=jwt.sign({userId:'synthetic-owner'},process.env.JWT_REFRESH_SECRET!,{expiresIn:'1h'});
  const result=await refreshSession(refresh);
  assert.equal((jwt.verify(result.tokens.accessToken,process.env.JWT_ACCESS_SECRET!) as jwt.JwtPayload).userId,'synthetic-owner');
  assert.equal(result.tokens.refreshToken,refresh);
  const expired=jwt.sign({userId:'synthetic-owner'},process.env.JWT_REFRESH_SECRET!,{expiresIn:-1});
  await assert.rejects(refreshSession(expired));
  await assert.rejects(refreshSession(jwt.sign({userId:'missing'},process.env.JWT_REFRESH_SECRET!)));
  await assert.rejects(refreshSession(jwt.sign({userId:'synthetic-owner',email:'synthetic@example.test'},process.env.JWT_ACCESS_SECRET!)));
  await assert.rejects(refreshSession(jwt.sign({userId:'synthetic-owner'},'synthetic-wrong-secret')));
  console.log('Session refresh verification passed. No database writes; tokens never logged.');
} finally { prisma.user.findUnique=original; }

}
main().catch(error => { console.error(error.message); process.exitCode=1; });
