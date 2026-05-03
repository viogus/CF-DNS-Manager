const ROTATION_PREFIX = 'rotation:';
const META_KEY = 'rotation:meta:v2';

function rotationKey(zoneId, recordId) {
  return `${ROTATION_PREFIX}${zoneId}:${recordId}`;
}

function zonePrefix(zoneId) {
  return `${ROTATION_PREFIX}${zoneId}:`;
}

function kv(env) {
  if (!env.DNS_ROTATIONS) {
    throw new Error('KV namespace DNS_ROTATIONS is not bound. Configure it in Pages Dashboard: Settings → Functions → KV bindings.');
  }
  return env.DNS_ROTATIONS;
}

async function getMetaIndex(env) {
  const val = await kv(env).get(META_KEY);
  return val ? JSON.parse(val) : [];
}

async function saveMetaIndex(env, keys) {
  await kv(env).put(META_KEY, JSON.stringify([...new Set(keys)]));
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

  const meta = await getMetaIndex(env);
  if (!meta.includes(key)) {
    meta.push(key);
    await saveMetaIndex(env, meta);
  }
}

export async function deleteRotation(env, zoneId, recordId) {
  const key = rotationKey(zoneId, recordId);
  await kv(env).delete(key);

  const meta = await getMetaIndex(env);
  await saveMetaIndex(env, meta.filter(k => k !== key));
}

export async function listRotationsForZone(env, zoneId) {
  try {
    const meta = await getMetaIndex(env);
    const prefix = zonePrefix(zoneId);
    const keys = meta.filter(k => k.startsWith(prefix));
    if (keys.length === 0) return [];
    const results = await Promise.all(keys.map(k => kv(env).get(k)));
    return results.filter(Boolean).map(r => JSON.parse(r));
  } catch (e) {
    if (e.message.includes('not bound')) return [];
    throw e;
  }
}

export async function listAllRotations(env) {
  try {
    const meta = await getMetaIndex(env);
    if (meta.length === 0) return [];
    const results = await Promise.all(meta.map(k => kv(env).get(k)));
    return results.filter(Boolean).map(r => JSON.parse(r));
  } catch (e) {
    if (e.message.includes('not bound')) return [];
    throw e;
  }
}
