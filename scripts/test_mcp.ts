import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inject} from 'light-my-request';
import express from 'express';
import jwt from 'jsonwebtoken';
import {ActivityLevel, DaysPerWeek, EatingStyle, Experience, SleepDuration, WorkoutDuration} from '@prisma/client';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import prisma from '../config/prisma';
import {rateLimitRedis} from '../config/redis';
import {mcpRoutes, mcpTokenRoutes} from '../modules/mcp/mcp_routes';
import {createToken, mintToken, tokenInput, verifyMcpToken, MCP_SCOPES, McpError} from '../modules/mcp/mcp_tokens';
import {acquireMcpSlot, checkMcpLimit, mcpBuckets, mcpLimitStore} from '../modules/mcp/mcp_limits';

async function main() {
  const a = randomUUID(), b = randomUUID(), exerciseId = randomUUID();
  const originalConsume = mcpLimitStore.consume;
  const counters: string[] = [];
  const makeUser = (id: string) => prisma.user.create({data: {id, email: `mcp-fixture-${id}@setcraft.invalid`, password: 'not-a-login-password-hash', isVerified: true}});
  try {
    await makeUser(a); await makeUser(b);
    console.log('MCP: isolated database owners ready.');
    await prisma.onboarding.create({data: {userId: a, name: 'MCP fixture', age: 28, gender: 'MALE', height: 180, weight: 80,
      workingToward: 'BUILD_MUSCLE', experience: Object.values(Experience)[0], daysPerWeek: Object.values(DaysPerWeek)[0],
      workoutDuration: Object.values(WorkoutDuration)[0], trainingLocation: 'GYM', equipment: [],
      activityLevel: Object.values(ActivityLevel)[0], sleepDuration: Object.values(SleepDuration)[0],
      eatingStyle: Object.values(EatingStyle)[0], limitations: [], customLimitations: 'PRIVATE_MEDICAL_SENTINEL', foodAllergies: ['PRIVATE_ALLERGY_SENTINEL']}});
    await prisma.workout.create({data: {id: exerciseId, name: `MCP fixture ${exerciseId}`, description: 'Fixture', category: 'strength', bodyPart: 'chest', equipment: 'bodyweight', instructions: ['Controlled movement.']}});
    const mondayDate = new Date(); mondayDate.setUTCHours(0, 0, 0, 0); mondayDate.setUTCDate(mondayDate.getUTCDate() - (mondayDate.getUTCDay() + 6) % 7);
    const monday = mondayDate.toISOString().slice(0, 10);
    const schedule = await prisma.userWorkout.create({data: {userId: a, weekLabel: 'fixture', scheduledDate: monday, status: 'COMPLETED'}});
    const item = await prisma.userWorkoutItem.create({data: {userWorkoutId: schedule.id, workoutId: exerciseId, dayOfWeek: 'MONDAY', sourceProvider: 'USER'}});
    await prisma.workoutSession.create({data: {userId: a, userWorkoutId: schedule.id, date: monday, status: 'COMPLETED'}});
    await prisma.workoutSetLog.create({data: {userId: a, userWorkoutItemId: item.id, setNumber: 1, weight: 20, reps: 10,
      day: String(mondayDate.getUTCDate()), month: String(mondayDate.getUTCMonth() + 1), year: String(mondayDate.getUTCFullYear())}});
    await prisma.bodyAssessment.create({data: {userId: a, recordedDate: monday, status: 'SAVED', method: 'entered',
      metrics: {waistCm: {value: 81, unit: 'cm', source: 'tape'}}, observations: [], quality: {private: 'PRIVATE_PHOTO_SENTINEL'}}});
    const run = await prisma.weeklyPlanRun.create({data: {userId: a, weekStart: monday, contextHash: randomUUID(), input: {private: 'PRIVATE_INPUT_SENTINEL'}, status: 'COMPLETED'}});
    await prisma.weeklyPersonalPlan.create({data: {userId: a, runId: run.id, weekStart: monday, version: 1, status: 'ACTIVE',
      promptVersion: 'fixture', ruleVersion: 'fixture', model: 'fixture', payload: {nutrition: {targets: {calories: 2222, protein: 150, carbs: 250, fat: 70}}, private: 'PRIVATE_PLAN_SENTINEL'}}});

    console.log('MCP: isolated workout, measurement and plan fixtures ready.');
    const app = express();
    app.get('/ping', (_req, res) => res.json({ok: true}));
    app.use('/mcp', mcpRoutes); app.use(express.json()); app.use('/tokens', mcpTokenRoutes);
    const base = 'https://mcp-test.setcraft.invalid'; // In-process only; never sent over the network.
    const login = (id: string) => jwt.sign({userId: id}, process.env.JWT_ACCESS_SECRET!, {expiresIn: '10m'});
    const appA = login(a), appB = login(b);
    // Exercise real Express parsing and the official MCP HTTP transport without
    // this host's broken socket proxy. PostgreSQL and Redis below remain real.
    const localFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.origin !== base) throw new Error('Test client may only call its in-process application.');
      const response = await inject(app, {method: (init?.method ?? 'GET') as any, url: url.pathname + url.search,
        headers: Object.fromEntries(new Headers(init?.headers).entries()), payload: typeof init?.body === 'string' ? init.body : undefined});
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
      return new Response([204, 205, 304].includes(response.statusCode) ? null : response.payload, {status: response.statusCode, headers});
    };
    async function request(path: string, bearer: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
      const response = await localFetch(base + path, {method, headers: {'Authorization': `Bearer ${bearer}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25'}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
      const text = await response.text();
      return {status: response.status, data: text ? JSON.parse(text) : {}, headers: response.headers};
    }
    let rpcId = 0;
    assert.equal((await request('/ping', appA)).status, 200);
    const call = (secret: string, name: string, args: unknown = {}) => request('/mcp', secret, {jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: {name, arguments: args}});
    const input = {name: 'Fixture Claude', scopes: [...MCP_SCOPES], expiresInDays: 30 as const};
    const first = await request('/tokens', appA, input);
    assert.equal(first.status, 201);
    console.log('MCP: fixture accounts and authenticated token issuance ready.');
    const issued = first.data.data;
    assert.ok(typeof issued.secret === 'string' && issued.secret.startsWith('sc_mcp_'));
    const row = await prisma.mcpAccessToken.findUniqueOrThrow({where: {id: issued.token.id}});
    assert.ok(row.secretHash.length === 64 && row.secretHash !== issued.secret, 'Store only an irreversible verification value.');
    assert.equal(row.userId, a);
    const listing = await request('/tokens', appA);
    assert.ok(!JSON.stringify(listing.data).includes(issued.secret));
    assert.ok(!JSON.stringify(listing.data).includes(row.secretHash));
    assert.equal((await request('/tokens', appA, {...input, userId: b})).status, 400);
    assert.equal((await request('/tokens', appA, {...input, scopes: ['photos:read']})).status, 400);
    assert.equal((await request('/tokens', issued.secret)).status, 401, 'MCP token cannot manage app credentials.');
    assert.equal((await request('/mcp', appA, {jsonrpc: '2.0', id: 1, method: 'tools/list'})).status, 401);
    assert.equal((await request('/mcp/unknown', issued.secret)).status, 404);
    assert.equal((await request('/mcp?token=fixture', issued.secret)).status, 400);
    await request(`/tokens/${row.id}`, appB, undefined, 'DELETE');
    assert.equal((await verifyMcpToken(`Bearer ${issued.secret}`)).userId, a, 'Another owner cannot revoke this credential.');
    assert.equal((await request(`/tokens/${row.id}/replace`, appB, input)).status, 404);
    const identity = await call(issued.secret, 'get_connected_account');
    assert.equal(identity.status, 200);
    assert.equal(identity.data.result.structuredContent.id, a);
    const badArgs = await call(issued.secret, 'get_connected_account', {userId: b});
    assert.ok(badArgs.data.result?.isError || badArgs.data.error, 'Extra identity selectors must be rejected.');
    for (const [name, args] of [
      ['get_training_profile', {}], ['get_weekly_workouts', {weekStart: monday}],
      ['get_workout_history', {from: monday, to: monday}], ['get_training_progress', {from: monday, to: monday}],
      ['get_exercise_details', {exerciseId}], ['get_nutrition_summary', {from: monday, to: monday}],
      ['get_measurement_trends', {from: monday, to: monday}],
    ] as const) {
      const result = await call(issued.secret, name, args);
      assert.equal(result.status, 200, `HTTP ${name}`);
      assert.ok(!result.data.result?.isError, `Read ${name} must succeed against the actual schema.`);
      const text = JSON.stringify(result.data);
      assert.ok(!text.includes('PRIVATE_'), `${name} must redact unrelated sensitive fields.`);
      if (name === 'get_training_progress') assert.equal(result.data.result.structuredContent.recordedSets, 1);
      if (name === 'get_measurement_trends') assert.equal(result.data.result.structuredContent.entries[0].metrics.waistCm.value, 81);
      if (name === 'get_nutrition_summary') assert.equal(result.data.result.structuredContent.savedDailyTargets.calories, 2222);
    }
    const narrow = await createToken(b, tokenInput.parse({name: 'Narrow', scopes: ['plans:read']}));
    assert.equal((await call(narrow.secret, 'get_training_profile')).status, 403);
    const tools = await request('/mcp', narrow.secret, {jsonrpc: '2.0', id: ++rpcId, method: 'tools/list'});
    assert.ok(tools.data.result.tools.every((t: any) => t.annotations.readOnlyHint === true));
    assert.ok(!tools.data.result.tools.some((t: any) => /nutrition|measurement|training_profile/.test(t.name)));
    const blankWeek = await call(narrow.secret, 'get_weekly_workouts', {weekStart: monday});
    assert.equal(blankWeek.data.result.structuredContent.workouts.length, 0, 'Private workouts must not cross accounts.');
    const tooWide = await call(issued.secret, 'get_workout_history', {from: '2025-01-01', to: '2026-01-01'});
    assert.equal(tooWide.data.result.isError, true);
    assert.equal((await request('/mcp', issued.secret, [{jsonrpc: '2.0', id: 1, method: 'tools/list'}])).status, 400);
    assert.equal((await request('/mcp', issued.secret, {padding: 'x'.repeat(33000)})).status, 413);
    console.log('MCP: real SDK transport, eight tools, strict input, scope isolation and sensitive-data redaction passed.');

    const raced = await Promise.allSettled(Array.from({length: 6}, () => createToken(a, tokenInput.parse({name: 'Cap fixture', scopes: ['plans:read']}))));
    assert.equal(raced.filter(r => r.status === 'fulfilled').length, 4);
    assert.equal(await prisma.mcpAccessToken.count({where: {userId: a, revokedAt: null}}), 5);
    const replaced = await createToken(a, tokenInput.parse({name: 'Replacement', scopes: ['workouts:read']}), row.id);
    await assert.rejects(() => verifyMcpToken(`Bearer ${issued.secret}`), (e: unknown) => e instanceof McpError && e.status === 401);
    assert.equal((await verifyMcpToken(`Bearer ${replaced.secret}`)).userId, a);
    await prisma.mcpAccessToken.update({where: {id: replaced.token.id}, data: {expiresAt: new Date(0)}});
    await assert.rejects(() => verifyMcpToken(`Bearer ${replaced.secret}`));
    assert.ok(mintToken().secretHash.length === 64);
    console.log('MCP: one-time issuance, transaction-safe five-token cap, ownership, replacement and expiry passed.');

    const principal = {userId: randomUUID(), tokenId: randomUUID(), scopes: []};
    const allKeys = new Set(mcpBuckets(principal, true).map(x => x.key));
    counters.push(...allKeys);
    const firstBatch = await Promise.allSettled(Array.from({length: 40}, () => checkMcpLimit(principal, true)));
    assert.equal(firstBatch.filter(x => x.status === 'fulfilled').length, 30);
    const secondPrincipal = {...principal, tokenId: randomUUID()};
    counters.push(...mcpBuckets(secondPrincipal, true).map(x => x.key));
    const secondBatch = await Promise.allSettled(Array.from({length: 40}, () => checkMcpLimit(secondPrincipal, true)));
    assert.equal(secondBatch.filter(x => x.status === 'fulfilled').length, 30);
    const thirdPrincipal = {...principal, tokenId: randomUUID()};
    counters.push(...mcpBuckets(thirdPrincipal, true).map(x => x.key));
    await assert.rejects(() => checkMcpLimit(thirdPrincipal, true), (e: unknown) => e instanceof McpError && e.status === 429);
    const releases = await Promise.all(Array.from({length: 3}, () => acquireMcpSlot(principal)));
    await assert.rejects(() => acquireMcpSlot(secondPrincipal), (e: unknown) => e instanceof McpError && e.status === 429);
    await Promise.all(releases.map(release => release()));
    await (await acquireMcpSlot(principal))();
    const narrowPrincipal = await verifyMcpToken(`Bearer ${narrow.secret}`);
    const occupied = await Promise.all(Array.from({length: 3}, () => acquireMcpSlot(narrowPrincipal)));
    try {
      const busy = await call(narrow.secret, 'get_connected_account');
      assert.equal(busy.status, 429, 'Busy execution slots must return HTTP 429 before transport headers.');
      assert.ok(Number(busy.headers.get('Retry-After')) > 0);
    } finally {await Promise.all(occupied.map(release => release()));}
    mcpLimitStore.consume = async () => ({allowed: false, retryAfterSeconds: 17});
    const denied = await call(narrow.secret, 'get_weekly_workouts', {weekStart: monday});
    assert.equal(denied.status, 429); assert.equal(denied.headers.get('Retry-After'), '17');
    mcpLimitStore.consume = async () => {throw new Error('Simulated Redis outage');};
    assert.equal((await call(narrow.secret, 'get_connected_account')).status, 503);
    assert.equal((await request(`/tokens/${narrow.token.id}`, appB, undefined, 'DELETE')).status, 204);
    await assert.rejects(() => verifyMcpToken(`Bearer ${narrow.secret}`));
    mcpLimitStore.consume = originalConsume;
    console.log('MCP: real Redis atomic multi-token quotas, concurrency, Retry-After, fail-closed outage and independent revocation passed.');

    // Full official-client handshake, not just hand-written JSON-RPC requests.
    const probe = (await prisma.mcpAccessToken.findMany({where: {userId: a, revokedAt: null, expiresAt: {gt: new Date()}}, select: {id: true}}))[0];
    assert.ok(probe);
    const dedicated = await createToken(b, tokenInput.parse({name: 'SDK client', scopes: ['training:read']}));
    const client = new Client({name: 'Setcraft integration test', version: '1.0.0'});
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), {fetch: localFetch, requestInit: {headers: {Authorization: `Bearer ${dedicated.secret}`}}}));
    assert.ok((await client.listTools()).tools.some(t => t.name === 'get_training_profile'));
    const response = await client.callTool({name: 'get_connected_account', arguments: {}});
    assert.ok(!response.isError); await client.close();
    const events = await prisma.mcpAuditEvent.findMany({where: {userId: {in: [a, b]}}});
    assert.ok(events.some(e => e.action === 'revoked'));
    assert.ok(!JSON.stringify(events).includes(issued.secret));
    console.log('MCP: official client initialization, discovery, invocation and metadata-only audit passed.');
  } finally {
    mcpLimitStore.consume = originalConsume;
    if (counters.length) await rateLimitRedis.del(...[...new Set(counters)]).catch(() => {});
    await prisma.user.deleteMany({where: {id: {in: [a, b]}, email: {startsWith: 'mcp-fixture-'}}});
    await prisma.workout.deleteMany({where: {id: exerciseId, name: {startsWith: 'MCP fixture '}}});
    await prisma.$disconnect();
  }
}
main().catch(error => {console.error('MCP verification failed:', error instanceof Error ? error.message : 'Unknown failure');
  if (error instanceof Error) console.error(error.stack?.split('\n').filter(line => line.trim().startsWith('at ')).slice(0, 7).join('\n'));
  console.error('Cause code:', error?.cause?.code ?? 'none');
  process.exitCode = 1;});
