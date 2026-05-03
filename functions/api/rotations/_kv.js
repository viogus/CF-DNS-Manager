const ROTATION_PREFIX = 'rotation:';
const META_KEY = 'rotation:meta:v2';

function rotationKey(zoneId, recordId) {
  return `${ROTATION_PREFIX}${zoneId}:${recordId}`;
}

function zonePrefix(zoneId) {
  return `${ROTATION_PREFIX}${zoneId}:`;
}

async function getMetaIndex(env) {
  const val = await env.DNS_ROTATIONS.get(META_KEY);
  return val ? JSON.parse(val) : [];
}

async function saveMetaIndex(env, keys) {
  await env.DNS_ROTATIONS.put(META_KEY, JSON.stringify([...new Set(keys)]));
}

export async function getRotation(env, zoneId, recordId) {
  const val = await env.DNS_ROTATIONS.get(rotationKey(zoneId, recordId));
  return val ? JSON.parse(val) : null;
}

export async function putRotation(env, config) {
  const key = rotationKey(config.zoneId, config.recordId);
  await env.DNS_ROTATIONS.put(key, JSON.stringify(config));

  const meta = await getMetaIndex(env);
  if (!meta.includes(key)) {
    meta.push(key);
    await saveMetaIndex(env, meta);
  }
}

export async function deleteRotation(env, zoneId, recordId) {
  const key = rotationKey(zoneId, recordId);
  await env.DNS_ROTATIONS.delete(key);

  const meta = await getMetaIndex(env);
  await saveMetaIndex(env, meta.filter(k => k !== key));
}

export async function listRotationsForZone(env, zoneId) {
  const meta = await getMetaIndex(env);
  const prefix = zonePrefix(zoneId);
  const keys = meta.filter(k => k.startsWith(prefix));
  if (keys.length === 0) return [];
  const results = await Promise.all(keys.map(k => env.DNS_ROTATIONS.get(k)));
  return results.filter(Boolean).map(r => JSON.parse(r));
}

export async function listAllRotations(env) {
  const meta = await getMetaIndex(env);
  if (meta.length === 0) return [];
  const results = await Promise.all(meta.map(k => env.DNS_ROTATIONS.get(k)));
  return results.filter(Boolean).map(r => JSON.parse(r));
}
