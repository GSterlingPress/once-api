import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

async function atomicWriteJson(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, target);
}

async function readJson(target, fallback) {
  try { return JSON.parse(await fs.readFile(target, 'utf8')); }
  catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

class FileLock {
  constructor({ locksDir, timeoutMs = 10_000, pollMs = 15, staleMs = 30_000 }) {
    this.locksDir = locksDir;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.staleMs = staleMs;
  }

  async acquire(key) {
    await fs.mkdir(this.locksDir, { recursive: true });
    const lockFile = path.join(this.locksDir, `${sha256(key)}.lock`);
    const started = Date.now();
    while (true) {
      try {
        const handle = await fs.open(lockFile, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
        return async () => {
          await handle.close().catch(() => {});
          await fs.unlink(lockFile).catch(() => {});
        };
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
        try {
          const stat = await fs.stat(lockFile);
          if (Date.now() - stat.mtimeMs > this.staleMs) await fs.unlink(lockFile).catch(() => {});
        } catch (statErr) {
          if (statErr?.code !== 'ENOENT') throw statErr;
        }
        if (Date.now() - started >= this.timeoutMs) {
          const error = new Error('Timed out waiting for metering lock');
          error.code = 'ONCE_METER_LOCK_TIMEOUT';
          throw error;
        }
        await sleep(this.pollMs);
      }
    }
  }

  async runExclusive(key, fn) {
    const release = await this.acquire(key);
    try { return await fn(); }
    finally { await release(); }
  }
}

export class FileApiKeyStore {
  constructor({ dataDir = process.env.ONCE_DATA_DIR ?? path.resolve('.once-data') } = {}) {
    this.dataDir = dataDir;
    this.keysFile = path.join(dataDir, 'auth', 'api-keys.json');
    this.lock = new FileLock({ locksDir: path.join(dataDir, 'auth', 'locks') });
  }

  async issue({ name = 'default', monthlyQuota = 10_000 } = {}) {
    return this.lock.runExclusive('api-keys', async () => {
      const records = await readJson(this.keysFile, []);
      const id = crypto.randomBytes(6).toString('hex');
      const secret = crypto.randomBytes(24).toString('base64url');
      const apiKey = `once_live_${id}_${secret}`;
      const record = {
        id,
        name,
        keyPrefix: `once_live_${id}`,
        keyHash: sha256(apiKey),
        monthlyQuota,
        enabled: true,
        createdAt: new Date().toISOString()
      };
      records.push(record);
      await atomicWriteJson(this.keysFile, records);
      return { apiKey, ...record, keyHash: undefined };
    });
  }

  async list() {
    const records = await readJson(this.keysFile, []);
    return records.map(({ keyHash, ...rest }) => rest);
  }

  async revoke(id) {
    return this.lock.runExclusive('api-keys', async () => {
      const records = await readJson(this.keysFile, []);
      const record = records.find((item) => item.id === id);
      if (!record) return false;
      record.enabled = false;
      record.revokedAt = new Date().toISOString();
      await atomicWriteJson(this.keysFile, records);
      return true;
    });
  }

  async authenticate(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return null;
    const match = /^once_live_([0-9a-f]{12})_/.exec(apiKey);
    if (!match) return null;
    const records = await readJson(this.keysFile, []);
    const record = records.find((item) => item.id === match[1]);
    if (!record || !record.enabled) return null;
    const actual = Buffer.from(sha256(apiKey), 'hex');
    const expected = Buffer.from(record.keyHash, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const { keyHash, ...safe } = record;
    return safe;
  }
}

export class FileUsageMeter {
  constructor({ dataDir = process.env.ONCE_DATA_DIR ?? path.resolve('.once-data') } = {}) {
    this.usageDir = path.join(dataDir, 'usage');
    this.lock = new FileLock({ locksDir: path.join(dataDir, 'usage-locks') });
  }

  usagePath(keyId, period = monthKey()) {
    return path.join(this.usageDir, keyId, `${period}.json`);
  }

  async get(keyId, period = monthKey()) {
    return readJson(this.usagePath(keyId, period), {
      keyId,
      period,
      calls: 0,
      verified: 0,
      failed: 0,
      uncertain: 0,
      duplicateSuppressed: 0,
      updatedAt: null
    });
  }

  async reserve(keyRecord, period = monthKey()) {
    return this.lock.runExclusive(`${keyRecord.id}:${period}`, async () => {
      const usage = await this.get(keyRecord.id, period);
      if (usage.calls >= keyRecord.monthlyQuota) {
        const error = new Error('Monthly API quota exceeded');
        error.code = 'ONCE_QUOTA_EXCEEDED';
        error.usage = usage;
        error.quota = keyRecord.monthlyQuota;
        throw error;
      }
      usage.calls += 1;
      usage.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.usagePath(keyRecord.id, period), usage);
      return usage;
    });
  }

  async recordResult(keyId, receipt, period = monthKey()) {
    return this.lock.runExclusive(`${keyId}:${period}`, async () => {
      const usage = await this.get(keyId, period);
      const field = String(receipt.status ?? '').toLowerCase();
      if (field === 'verified' || field === 'failed' || field === 'uncertain') usage[field] += 1;
      if (receipt.duplicateSuppressed) usage.duplicateSuppressed += 1;
      usage.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.usagePath(keyId, period), usage);
      return usage;
    });
  }
}

export function bearerToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(/\s+/, 2);
  return scheme?.toLowerCase() === 'bearer' ? token : null;
}
