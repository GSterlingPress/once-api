import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FileApiKeyStore } from '../src/auth.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function tempDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'once-server-test-')); }

async function startServer(dataDir) {
  const port = 19000 + Math.floor(Math.random() * 3000);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve('.'), env: { ...process.env, ONCE_DATA_DIR: dataDir, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return { child, port };
    } catch {}
    await delay(40);
  }
  child.kill();
  throw new Error('Server did not start');
}

test('server rejects missing API keys and exposes authenticated usage', async () => {
  const dir = await tempDir();
  const keyStore = new FileApiKeyStore({ dataDir: dir });
  const issued = await keyStore.issue({ name: 'server-test', monthlyQuota: 3 });
  const { child, port } = await startServer(dir);
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/v1/usage`);
    assert.equal(denied.status, 401);
    const ok = await fetch(`http://127.0.0.1:${port}/v1/usage`, { headers: { authorization: `Bearer ${issued.apiKey}` } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.quota, 3);
    assert.equal(body.usage.calls, 0);
    assert.equal(body.remaining, 3);
  } finally {
    child.kill();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
