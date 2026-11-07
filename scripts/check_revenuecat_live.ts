import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';

async function main() {
  const id = randomUUID();
  const root = `http://127.0.0.1:${process.env.PORT || 8000}/api/subscription`;
  try {
    await prisma.user.create({ data: { id, email: `rc-live-${id}@example.invalid`, password: 'not-a-login' } });
    const token = jwt.sign({ userId: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '5m' });
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const result = await fetch(`${root}/status`, { headers });
    assert.equal(result.status, 200);
    const { data } = await result.json() as any;
    assert.equal(data.billingProvider, 'revenuecat');
    assert.equal(data.billingReady, true);
    assert.equal(data.hasAccess, false, 'An empty RevenueCat customer cannot unlock premium');
    for (const field of ['termsUrl', 'privacyUrl']) {
      assert.equal(typeof data[field], 'string');
      const page = await fetch(data[field], { headers: { 'ngrok-skip-browser-warning': 'true' }, signal: AbortSignal.timeout(15000) });
      assert.equal(page.status, 200);
      assert.match(await page.text(), /DEVELOPMENT TESTING/);
    }
    assert.equal((await fetch(`${root}/revenuecat/sync`, { method: 'POST', headers })).status, 200);
    assert.equal((await fetch(`${root}/revenuecat/sync`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${root}/revenuecat/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: { type: 'TEST' } }) })).status, 401);
    assert.equal((await fetch(`${root}/revenuecat/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: process.env.REVENUECAT_WEBHOOK_AUTH! }, body: JSON.stringify({ event: { type: 'TEST' } }) })).status, 200);
    console.log('Live API verified: RevenueCat status/sync, locked empty customer, auth guards, authorized webhook. No purchase made.');
  } finally {
    await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
