const ROTATION_PREFIX = 'rotation:';

let _listCache = null;
let _listCacheTs = 0;
const LIST_CACHE_TTL = 90_000; // 90s > cron interval, guarantees alternating cache hits

function rotationKey(zoneId, recordId) {
  return `${ROTATION_PREFIX}${zoneId}:${recordId}`;
}

function zonePrefix(zoneId) {
  return `${ROTATION_PREFIX}${zoneId}:`;
}

function bustCache() {
  _listCache = null;
  _listCacheTs = 0;
}

function kv(env) {
  if (!env.DNS_ROTATIONS) {
    throw new Error('KV namespace DNS_ROTATIONS is not bound. Create a KV namespace (wrangler kv namespace create DNS_ROTATIONS, or Cloudflare Dashboard: Workers & Pages > KV) and set its ID in [[kv_namespaces]] in wrangler.toml.');
  }
  return env.DNS_ROTATIONS;
}

export async function getRotation(env, zoneId, recordId) {
  try {
    const val = await kv(env).get(rotationKey(zoneId, recordId));
    return val ? JSON.parse(val) : null;
  } catch (e) {
    if (e.message.includes('not bound')) return null;
    throw e;
  }
}

export async function putRotation(env, config) {
  const key = rotationKey(config.zoneId, config.recordId);
  await kv(env).put(key, JSON.stringify(config));
  bustCache();
}

export async function deleteRotation(env, zoneId, recordId) {
  const key = rotationKey(zoneId, recordId);
  await kv(env).delete(key);
  bustCache();
}

export async function listRotationsForZone(env, zoneId) {
  try {
    const prefix = zonePrefix(zoneId);
    let keys = [];
    let list_complete = false;
    let cursor = undefined;

    while (!list_complete) {
      const listResult = await kv(env).list({ prefix, cursor });
      keys.push(...listResult.keys.map(k => k.name));
      list_complete = listResult.list_complete;
      if (!list_complete) {
        cursor = listResult.cursor;
      }
    }
    
    if (keys.length === 0) return [];
    const results = await Promise.all(keys.map(k => kv(env).get(k)));
    return results.filter(Boolean).map(r => JSON.parse(r));
  } catch (e) {
    if (e.message.includes('not bound')) return [];
    throw e;
  }
}

export async function listAllRotations(env) {
  if (_listCache && Date.now() - _listCacheTs < LIST_CACHE_TTL) return _listCache;
  try {
    let keys = [];
    let list_complete = false;
    let cursor = undefined;

    while (!list_complete) {
      const listResult = await kv(env).list({ prefix: ROTATION_PREFIX, cursor });
      keys.push(...listResult.keys.map(k => k.name));
      list_complete = listResult.list_complete;
      if (!list_complete) {
        cursor = listResult.cursor;
      }
    }

    if (keys.length === 0) {
      _listCache = [];
      _listCacheTs = Date.now();
      return [];
    }
    const results = await Promise.all(keys.map(k => kv(env).get(k)));
    const parsed = results.filter(Boolean).map(r => JSON.parse(r));
    _listCache = parsed;
    _listCacheTs = Date.now();
    return parsed;
  } catch (e) {
    if (e.message.includes('not bound')) return [];
    throw e;
  }
}
