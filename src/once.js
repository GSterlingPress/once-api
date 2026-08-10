import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class MemoryReceiptStore {
  constructor() {
    this.map = new Map();
    this.locks = new Map();
  }
  async get(key) { return this.map.get(key); }
  async put(key, receipt) { this.map.set(key, receipt); }
  async runExclusive(key, fn) {
    const prior = this.locks.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const queued = prior.then(() => gate);
    this.locks.set(key, queued);
    await prior;
    try { return await fn(); }
    finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }
}

function safeName(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Durable JSON receipt store with filesystem locks.
 * - Atomic receipt writes via temp file + rename.
 * - Cross-process lock acquisition via fs.open(..., 'wx').
 * - Stale lock cleanup prevents a crashed process from blocking forever.
 */
export class FileReceiptStore {
  constructor({
    dataDir = process.env.ONCE_DATA_DIR ?? path.resolve('.once-data'),
    lockTimeoutMs = 10_000,
    lockPollMs = 20,
    staleLockMs = 30_000
  } = {}) {
    this.dataDir = dataDir;
    this.receiptsDir = path.join(dataDir, 'receipts');
    this.locksDir = path.join(dataDir, 'locks');
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockPollMs = lockPollMs;
    this.staleLockMs = staleLockMs;
  }

  async init() {
    await fs.mkdir(this.receiptsDir, { recursive: true });
    await fs.mkdir(this.locksDir, { recursive: true });
  }

  receiptPath(key) { return path.join(this.receiptsDir, `${safeName(key)}.json`); }
  lockPath(key) { return path.join(this.locksDir, `${safeName(key)}.lock`); }

  async get(key) {
    await this.init();
    try {
      return JSON.parse(await fs.readFile(this.receiptPath(key), 'utf8'));
    } catch (err) {
      if (err?.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async put(key, receipt) {
    await this.init();
    const target = this.receiptPath(key);
    const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, target);
  }

  async tryRemoveStaleLock(lockFile) {
    try {
      const stat = await fs.stat(lockFile);
      if (Date.now() - stat.mtimeMs > this.staleLockMs) {
        await fs.unlink(lockFile).catch(() => {});
      }
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }

  async acquire(key) {
    await this.init();
    const lockFile = this.lockPath(key);
    const startedAt = Date.now();

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
        await this.tryRemoveStaleLock(lockFile);
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          const error = new Error(`Timed out waiting for ONCE lock for idempotency key: ${key}`);
          error.code = 'ONCE_LOCK_TIMEOUT';
          throw error;
        }
        await sleep(this.lockPollMs);
      }
    }
  }

  async runExclusive(key, fn) {
    const release = await this.acquire(key);
    try { return await fn(); }
    finally { await release(); }
  }
}

function getPath(obj, pathExpr) {
  if (pathExpr === '' || pathExpr === '$') return obj;
  const parts = pathExpr.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export class OnceEngine {
  constructor(store, fetcher = fetch) {
    this.store = store;
    this.fetcher = fetcher;
  }

  async run(input) {
    const execute = async () => {
      const existing = await this.store.get(input.idempotencyKey);
      if (existing?.status === 'VERIFIED') {
        return { ...existing, duplicateSuppressed: true };
      }

      let actionStatus;
      try {
        const res = await this.fetcher(input.action.url, {
          method: input.action.method,
          headers: {
            'content-type': 'application/json',
            'idempotency-key': input.idempotencyKey,
            ...(input.action.headers ?? {})
          },
          body: input.action.body === undefined ? undefined : JSON.stringify(input.action.body)
        });
        actionStatus = res.status;
      } catch (err) {
        if (err?.code === 'ONCE_UNSAFE_URL') throw err;
        // A transport failure does not prove the action failed.
        // We deliberately continue to authoritative verification.
      }

      let verifyStatus;
      let observed;
      let status = 'UNCERTAIN';

      try {
        const vres = await this.fetcher(input.verify.url, {
          method: input.verify.method ?? 'GET',
          headers: input.verify.headers
        });
        verifyStatus = vres.status;
        const body = await parseBody(vres);
        observed = getPath(body, input.verify.path);
        status = Object.is(observed, input.verify.equals) ? 'VERIFIED' : 'FAILED';
      } catch (err) {
        if (err?.code === 'ONCE_UNSAFE_URL') throw err;
        status = 'UNCERTAIN';
      }

      const receipt = {
        receiptId: `once_${crypto.randomUUID()}`,
        idempotencyKey: input.idempotencyKey,
        status,
        actionStatus,
        verifyStatus,
        observed,
        expected: input.verify.equals,
        createdAt: new Date().toISOString(),
        duplicateSuppressed: false
      };

      await this.store.put(input.idempotencyKey, receipt);
      return receipt;
    };

    if (typeof this.store.runExclusive === 'function') {
      return this.store.runExclusive(input.idempotencyKey, execute);
    }
    return execute();
  }
}
