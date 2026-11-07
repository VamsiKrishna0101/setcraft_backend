import assert from 'node:assert/strict';
import express from 'express';
import { subscriptionTestPages } from '../modules/subscription/subscription_test_pages';

async function main() {
  const app = express();
  app.use(subscriptionTestPages);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const root = `http://127.0.0.1:${address.port}/testing/`;
  try {
    process.env.SUBSCRIPTION_PROVIDER = 'revenuecat';
    process.env.REVENUECAT_ENVIRONMENT = 'sandbox';
    process.env.NODE_ENV = 'test';
    for (const page of ['terms', 'privacy']) {
      const response = await fetch(root + page);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /DEVELOPMENT TESTING/);
    }
    assert.equal((await fetch(root + 'unknown')).status, 404);
    process.env.NODE_ENV = 'production';
    assert.equal((await fetch(root + 'terms')).status, 404);
    assert.equal((await fetch(root + 'privacy')).status, 404);
    process.env.NODE_ENV = 'test';
    process.env.SUBSCRIPTION_PROVIDER = 'native';
    assert.equal((await fetch(root + 'terms')).status, 404);
    console.log('Sandbox information pages passed: accessible in development, denied in production and when disabled.');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
