// Tiny hash-based store: Upstash Redis (Vercel "KV") when configured, otherwise a local
// JSON file for development. On a read-only host without Redis it falls back to memory,
// so the site can still be browsed (writes then fail with StorageUnavailable).
const fs = require('fs');
const path = require('path');

const PREFIX = 'news-outlet:';
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

class StorageUnavailable extends Error {}

let redis = null;
if (REDIS_URL && REDIS_TOKEN) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

// --- local file mode ---------------------------------------------------------
let memory = null;
function readFile() {
  if (memory) return memory;
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return {}; }
}
function writeFile(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    memory = db;
    throw new StorageUnavailable(err.message);
  }
}

const clone = (v) => (v === undefined || v === null ? v : structuredClone(v));

const store = {
  redis: !!redis,

  /** All fields of a hash as { field: value }. */
  async all(hash) {
    if (redis) return (await redis.hgetall(PREFIX + hash)) || {};
    return clone(readFile()[hash] || {});
  },

  async get(hash, field) {
    if (redis) return (await redis.hget(PREFIX + hash, field)) ?? null;
    return clone((readFile()[hash] || {})[field] ?? null);
  },

  async set(hash, field, value) {
    if (redis) return redis.hset(PREFIX + hash, { [field]: value });
    const db = readFile();
    db[hash] = { ...(db[hash] || {}), [field]: clone(value) };
    writeFile(db);
  },

  async del(hash, field) {
    if (redis) return redis.hdel(PREFIX + hash, field);
    const db = readFile();
    if (db[hash]) delete db[hash][field];
    writeFile(db);
  },

  /** Remove a whole hash. */
  async drop(hash) {
    if (redis) return redis.del(PREFIX + hash);
    const db = readFile();
    delete db[hash];
    writeFile(db);
  },

  /** Seed a hash once, if it has never been written. Never throws on read-only hosts. */
  async seed(hash, entries) {
    if (redis) {
      if ((await redis.exists(PREFIX + hash)) || !Object.keys(entries).length) return;
      await redis.hset(PREFIX + hash, entries);
      return;
    }
    const db = readFile();
    if (db[hash]) return;
    db[hash] = clone(entries);
    try { writeFile(db); } catch { /* served from memory */ }
  },
};

module.exports = { store, StorageUnavailable };
