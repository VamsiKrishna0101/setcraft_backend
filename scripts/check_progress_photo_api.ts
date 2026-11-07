import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';

// Verifies the running server with an isolated empty account, then removes it.
async function main() {
  const id=randomUUID();
  await prisma.user.create({data:{id,email:`photo-api-${id}@example.invalid`,password:randomUUID()}});
  try {
    const token=jwt.sign({userId:id},process.env.JWT_ACCESS_SECRET!,{expiresIn:'1m'});
    for(const base of ['http://127.0.0.1:8000',
      'https://27dc-2401-4900-889d-5b4b-dd79-e94c-4489-b65b.ngrok-free.app']) {
      const response=await fetch(`${base}/api/progress-photos`,{headers:{
        authorization:`Bearer ${token}`,'ngrok-skip-browser-warning':'true'},signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,200,'Authenticated photo listing must succeed.');
      const page=await response.json() as {photos:unknown[];nextCursor:string|null};
      assert.deepEqual(page.photos,[]);assert.equal(page.nextCursor,null);
    }
    console.log('Local and public API photo listing passed with an isolated empty account.');
  } finally {await prisma.user.delete({where:{id}});console.log('Synthetic account removed.');}
}
main().catch(error=>{console.error('Live photo API verification failed:',error instanceof assert.AssertionError?error.message:(error as {name?:string}).name);process.exitCode=1;}).finally(()=>prisma.$disconnect());
