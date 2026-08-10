import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileReceiptStore, MemoryReceiptStore, OnceEngine } from '../src/once.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'once-test-'));
}

test('verifies an action and suppresses duplicate execution', async () => {
  let actionCalls = 0;
  let verifyCalls = 0;
  const fakeFetch = async (url) => {
    if (String(url).includes('/action')) {
      actionCalls++;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    verifyCalls++;
    return new Response(JSON.stringify({ status: 'refunded' }), { status: 200 });
  };

  const engine = new OnceEngine(new MemoryReceiptStore(), fakeFetch);
  const input = {
    idempotencyKey: 'refund-order-123',
    action: { method: 'POST', url: 'https://demo/action', body: { amount: 49 } },
    verify: { url: 'https://demo/verify', path: 'status', equals: 'refunded' }
  };

  const first = await engine.run(input);
  const second = await engine.run(input);

  assert.equal(first.status, 'VERIFIED');
  assert.equal(second.status, 'VERIFIED');
  assert.equal(second.duplicateSuppressed, true);
  assert.equal(actionCalls, 1);
  assert.equal(verifyCalls, 1);
});

test('verifies authoritative state after an action timeout', async () => {
  let actionCalls = 0;
  const fakeFetch = async (url) => {
    if (String(url).includes('/action')) {
      actionCalls++;
      throw new Error('timeout');
    }
    return new Response(JSON.stringify({ state: 'done' }), { status: 200 });
  };

  const engine = new OnceEngine(new MemoryReceiptStore(), fakeFetch);
  const receipt = await engine.run({
    idempotencyKey: 'abc',
    action: { method: 'POST', url: 'https://demo/action' },
    verify: { url: 'https://demo/verify', path: 'state', equals: 'done' }
  });

  assert.equal(receipt.status, 'VERIFIED');
  assert.equal(actionCalls, 1);
});

test('returns FAILED when observed state does not match', async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes('/action')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ status: 'pending' }), { status: 200 });
  };
  const engine = new OnceEngine(new MemoryReceiptStore(), fakeFetch);
  const receipt = await engine.run({
    idempotencyKey: 'x',
    action: { method: 'POST', url: 'https://demo/action' },
    verify: { url: 'https://demo/verify', path: 'status', equals: 'complete' }
  });
  assert.equal(receipt.status, 'FAILED');
});

test('durable receipt survives a new store/engine instance', async () => {
  const dir = await tempDir();
  let actionCalls = 0;
  const fakeFetch = async (url) => {
    if (String(url).includes('/action')) {
      actionCalls++;
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify({ state: 'done' }), { status: 200 });
  };

  const input = {
    idempotencyKey: 'persistent-1',
    action: { method: 'POST', url: 'https://demo/action' },
    verify: { url: 'https://demo/verify', path: 'state', equals: 'done' }
  };

  const first = await new OnceEngine(new FileReceiptStore({ dataDir: dir }), fakeFetch).run(input);
  const second = await new OnceEngine(new FileReceiptStore({ dataDir: dir }), fakeFetch).run(input);

  assert.equal(first.status, 'VERIFIED');
  assert.equal(second.status, 'VERIFIED');
  assert.equal(second.duplicateSuppressed, true);
  assert.equal(actionCalls, 1);

  await fs.rm(dir, { recursive: true, force: true });
});

test('20 simultaneous requests with one idempotency key execute the action only once', async () => {
  const dir = await tempDir();
  let actionCalls = 0;
  let verifyCalls = 0;

  const fakeFetch = async (url) => {
    if (String(url).includes('/action')) {
      actionCalls++;
      await delay(75);
      return new Response('{}', { status: 200 });
    }
    verifyCalls++;
    await delay(25);
    return new Response(JSON.stringify({ state: 'done' }), { status: 200 });
  };

  const input = {
    idempotencyKey: 'race-condition-test',
    action: { method: 'POST', url: 'https://demo/action' },
    verify: { url: 'https://demo/verify', path: 'state', equals: 'done' }
  };

  // Separate store instances simulate separate server workers/processes sharing one durable directory.
  const engines = Array.from({ length: 20 }, () => new OnceEngine(new FileReceiptStore({ dataDir: dir }), fakeFetch));
  const receipts = await Promise.all(engines.map((engine) => engine.run(input)));

  assert.equal(actionCalls, 1);
  assert.equal(verifyCalls, 1);
  assert.equal(receipts.filter((r) => r.duplicateSuppressed === false).length, 1);
  assert.equal(receipts.filter((r) => r.duplicateSuppressed === true).length, 19);
  assert.ok(receipts.every((r) => r.status === 'VERIFIED'));

  await fs.rm(dir, { recursive: true, force: true });
});

