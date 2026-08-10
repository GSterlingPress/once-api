import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileApiKeyStore, FileUsageMeter } from '../src/auth.js';

async function tempDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'once-auth-test-')); }

test('issues an API key but persists only its hash', async () => {
  const dir = await tempDir();
  const store = new FileApiKeyStore({ dataDir: dir });
  const issued = await store.issue({ name: 'test', monthlyQuota: 7 });
  assert.match(issued.apiKey, /^once_live_[0-9a-f]{12}_/);
  const raw = await fs.readFile(path.join(dir, 'auth', 'api-keys.json'), 'utf8');
  assert.equal(raw.includes(issued.apiKey), false);
  const authenticated = await store.authenticate(issued.apiKey);
  assert.equal(authenticated.name, 'test');
  assert.equal(authenticated.monthlyQuota, 7);
  await fs.rm(dir, { recursive: true, force: true });
});

test('revoked API keys stop authenticating', async () => {
  const dir = await tempDir();
  const store = new FileApiKeyStore({ dataDir: dir });
  const issued = await store.issue();
  assert.ok(await store.authenticate(issued.apiKey));
  assert.equal(await store.revoke(issued.id), true);
  assert.equal(await store.authenticate(issued.apiKey), null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('usage meter enforces quota atomically under concurrency', async () => {
  const dir = await tempDir();
  const meter = new FileUsageMeter({ dataDir: dir });
  const key = { id: 'abc123', monthlyQuota: 5 };
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => meter.reserve(key, '2099-01')));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason?.code === 'ONCE_QUOTA_EXCEEDED').length, 15);
  const usage = await meter.get(key.id, '2099-01');
  assert.equal(usage.calls, 5);
  await fs.rm(dir, { recursive: true, force: true });
});

test('usage survives a new meter instance', async () => {
  const dir = await tempDir();
  const key = { id: 'persist', monthlyQuota: 100 };
  await new FileUsageMeter({ dataDir: dir }).reserve(key, '2099-01');
  const usage = await new FileUsageMeter({ dataDir: dir }).get(key.id, '2099-01');
  assert.equal(usage.calls, 1);
  await fs.rm(dir, { recursive: true, force: true });
});
