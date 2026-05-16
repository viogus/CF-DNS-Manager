const ROTATION_PREFIX = 'rotation:';

let _listCache = null;
let _listCacheTs = 0;
const LIST_CACHE_TTL = 300_000;

function rotationKey(zoneId, recordId) {
  return `${ROTATION_PREFIX}${zoneId}:${recordId}`;
}

function zonePrefix(zoneId) {
  return `${ROTATION_PREFIX}${zoneId}:`;
}

function kv(env) {
  if (!env.DNS_ROTATIONS) {
    throw new Error('KV namespace DNS_ROTATIONS is not bound. Create a KV namespace (wrangler kv namespace create DNS_ROTATIONS, or Cloudflare Dashboard: Workers & Pages > KV) and set its ID in [[kv_namespaces]] in wrangler.toml.');
  }
  return env.DNS_ROTATIONS;
}

export async function getRotation(env, zoneId, recordId) {
  if (_listCache) {
    const cached = _listCache.find(r => r.zoneId === zoneId && r.recordId === recordId);
    if (cached) return cached;
  }
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
  if (_listCache) {
    const idx = _listCache.findIndex(r => r.zoneId === config.zoneId && r.recordId === config.recordId);
    if (idx >= 0) {
      _listCache[idx] = config;
    } else {
      _listCache.push(config);
    }
  }
}

export async function deleteRotation(env, zoneId, recordId) {
  const key = rotationKey(zoneId, recordId);
  await kv(env).delete(key);
  if (_listCache) {
    const idx = _listCache.findIndex(r => r.zoneId === zoneId && r.recordId === recordId);
    if (idx >= 0) _listCache.splice(idx, 1);
  }
}

export async function listRotationsForZone(env, zoneId) {
  const all = await listAllRotations(env);
  return all.filter(r => r.zoneId === zoneId);
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
