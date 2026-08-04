// Read-through cache for the handful of things this application reads far more
// often than it writes: the dashboard counters, the hiring-flow dropdown
// values, and the entity/branch/role reference lists.
//
// Two backends, same interface:
//   REDIS_URL set  -> Redis, shared by every backend instance
//   otherwise      -> an in-process Map, which is all a single container needs
//
// Redis only becomes *necessary* when more than one backend process serves
// traffic: at that point an in-process cache diverges per instance, and one
// admin's change would appear on some page loads and not others. Until then
// the in-memory path is equivalent and has no service to run.
//
// Three rules this module keeps:
//   1. It fails OPEN. A Redis outage must never turn into a 500 - every miss,
//      timeout or connection error falls through to the database.
//   2. Every cached key is invalidated explicitly by the code that writes to
//      it. Nothing here relies on TTL alone to stay correct.
//   3. Nothing user-specific or permission-bearing is cached under a shared
//      key. Scoped data is keyed by the scope it belongs to.

const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 60);
const REDIS_URL = process.env.REDIS_URL || '';

let redis = null;
let redisHealthy = false;

if (REDIS_URL) {
  // Loaded lazily so the dependency is irrelevant when Redis is not configured
  const Redis = require('ioredis');
  redis = new Redis(REDIS_URL, {
    // A cache must never hold up a request. If Redis is slow, skip it.
    connectTimeout: 1000,
    commandTimeout: 300,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    lazyConnect: false,
  });
  redis.on('ready', () => {
    redisHealthy = true;
    console.log('Cache: Redis connected');
  });
  redis.on('end', () => {
    redisHealthy = false;
  });
  redis.on('error', (err) => {
    if (redisHealthy) console.error('Cache: Redis unavailable -', err.message);
    redisHealthy = false;
  });
} else {
  console.log('Cache: in-memory (set REDIS_URL to share a cache across instances)');
}

// ---- In-memory fallback -----------------------------------------------------

const memory = new Map(); // key -> { value, expiresAt }

const memoryGet = (key) => {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return hit.value;
};

const memorySet = (key, value, ttl) =>
  memory.set(key, { value, expiresAt: Date.now() + ttl * 1000 });

const memoryDrop = (prefix) => {
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
};

// Bounded so a bug in key construction cannot grow the heap without limit
const MEMORY_LIMIT = 500;
const trimMemory = () => {
  if (memory.size <= MEMORY_LIMIT) return;
  for (const key of memory.keys()) {
    memory.delete(key);
    if (memory.size <= MEMORY_LIMIT) break;
  }
};

// ---- Public interface -------------------------------------------------------

// Keys are namespaced by the database they describe. Without this, two
// environments pointed at one Redis - staging and production, or a blue/green
// pair - would serve each other's entity and branch lists, which look valid
// and are silently wrong. CACHE_NAMESPACE overrides it explicitly.
const databaseName = () => {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) return 'default';
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || 'default';
  } catch {
    return 'default';
  }
};

const PREFIX = `careers:${process.env.CACHE_NAMESPACE || databaseName()}:`;

// Reads through the cache, calling `loader` on a miss. Any cache failure is
// swallowed and the loader runs - a broken cache degrades to a slower app,
// never a failing one.
async function remember(key, loader, ttl = CACHE_TTL) {
  const fullKey = PREFIX + key;

  if (redis && redisHealthy) {
    try {
      const hit = await redis.get(fullKey);
      if (hit !== null) return JSON.parse(hit);
    } catch {
      // fall through to the loader
    }
  } else {
    const hit = memoryGet(fullKey);
    if (hit !== undefined) return hit;
  }

  const value = await loader();

  if (redis && redisHealthy) {
    try {
      await redis.set(fullKey, JSON.stringify(value), 'EX', ttl);
    } catch {
      // caching is best effort
    }
  } else {
    memorySet(fullKey, value, ttl);
    trimMemory();
  }

  return value;
}

// Drops every key under a prefix. Called by the code that writes the underlying
// data, so a change is visible immediately rather than after the TTL.
async function invalidate(prefix) {
  const full = PREFIX + prefix;

  if (redis && redisHealthy) {
    try {
      // SCAN rather than KEYS: KEYS blocks the whole server while it runs
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${full}*`, 'COUNT', 200);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    } catch {
      // A failed invalidation would serve stale data for up to the TTL, which
      // is why the TTL is short
    }
  }
  // Always clear the local copy too: a process may have cached before Redis
  // became reachable
  memoryDrop(full);
}

// Namespaces, so a write to one resource cannot accidentally clear another
const KEYS = {
  stats: 'stats:',
  flowOptions: 'flow:',
  entities: 'entities:',
  branches: 'branches:',
  roleCatalog: 'roles:catalog',
};

const isRedis = () => !!redis;
const isHealthy = () => (redis ? redisHealthy : true);

async function close() {
  if (redis) {
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  }
  memory.clear();
}

module.exports = { remember, invalidate, KEYS, isRedis, isHealthy, close, CACHE_TTL };
