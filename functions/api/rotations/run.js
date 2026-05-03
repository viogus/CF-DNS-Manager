import { listAllRotations, putRotation } from './_kv';

function isIPv4(ip) {
  return /^[0-9.]+$/.test(ip) && ip.includes('.');
}

function isIPv6(ip) {
  return /:/.test(ip);
}

function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/[ ,\n\t]+/).filter(Boolean);
  return [];
}

function normalizeServers(payload) {
  let list = [];
  if (Array.isArray(payload)) list = payload;
  else if (Array.isArray(payload?.clients)) list = payload.clients;
  else if (Array.isArray(payload?.data)) list = payload.data;

  const servers = [];
  for (const item of list || []) {
    const name = item.name || item.hostname || item.server_name || item.label || item.uuid || 'Unknown';
    const ipsRaw = [
      ...toArray(item.ipv4), ...toArray(item.ip_v4),
      ...toArray(item.ipv6), ...toArray(item.ip_v6),
    ];
    const ipv4 = [];
    const ipv6 = [];
    for (const ip of ipsRaw) {
      if (isIPv4(ip)) ipv4.push(ip);
      else if (isIPv6(ip)) ipv6.push(ip);
    }
    if (ipv4.length || ipv6.length) {
      servers.push({ name, ipv4: [...new Set(ipv4)], ipv6: [...new Set(ipv6)] });
    }
  }
  return servers;
}

async function fetchKomariIPs(env, rotation) {
  const baseUrl = env.KOMARI_BASE_URL;
  const apiToken = env.KOMARI_API_TOKEN;
  if (!baseUrl) return [];

  try {
    let apiBase = baseUrl.trim().replace(/\/+$/, '');
    if (!/\/api$/.test(apiBase)) apiBase += '/api';
    const url = `${apiBase}/admin/client/list`;

    const headers = {};
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

    const res = await fetch(url, { headers });
    if (!res.ok) return [];

    const payload = await res.json();
    let servers = normalizeServers(payload);

    if (rotation.komariServerFilter && rotation.komariServerFilter.length > 0) {
      servers = servers.filter(s => rotation.komariServerFilter.includes(s.name));
    }

    return rotation.recordType === 'AAAA'
      ? servers.flatMap(s => s.ipv6)
      : servers.flatMap(s => s.ipv4);
  } catch {
    return [];
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const rotationKey = request.headers.get('X-Rotation-Key');
  if (!rotationKey || rotationKey !== env.ROTATION_API_KEY) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const rotations = await listAllRotations(env);
  const results = [];
  const now = Date.now();

  for (const rotation of rotations) {
    if (!rotation.enabled) continue;

    const lastRotated = rotation.lastRotatedAt ? new Date(rotation.lastRotatedAt).getTime() : 0;
    if (now - lastRotated < rotation.interval * 1000) continue;

    try {
      let ipPool;
      if (rotation.ipSource === 'komari') {
        ipPool = await fetchKomariIPs(env, rotation);
      } else {
        ipPool = rotation.manualIPs || [];
      }

      if (ipPool.length === 0) {
        results.push({ recordId: rotation.recordId, status: 'skipped', reason: 'No IPs available' });
        continue;
      }

      const newIndex = rotation.currentIndex % ipPool.length;
      const newIP = ipPool[newIndex];

      const cfToken = env.CF_API_TOKEN;
      const patchRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${rotation.zoneId}/dns_records/${rotation.recordId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${cfToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ content: newIP })
        }
      );

      const patchData = await patchRes.json();

      if (patchData.success) {
        rotation.currentIndex = (rotation.currentIndex + 1) % ipPool.length;
        rotation.lastRotatedAt = new Date().toISOString();
        rotation.updatedAt = rotation.lastRotatedAt;
        await putRotation(env, rotation);

        results.push({
          recordId: rotation.recordId,
          recordName: rotation.recordName,
          status: 'rotated',
          newIP,
          nextIndex: rotation.currentIndex
        });
      } else {
        results.push({
          recordId: rotation.recordId,
          status: 'failed',
          error: patchData.errors?.[0]?.message || 'Unknown error'
        });
      }
    } catch (e) {
      results.push({ recordId: rotation.recordId, status: 'error', error: e.message });
    }
  }

  return new Response(JSON.stringify({ success: true, rotated: results.filter(r => r.status === 'rotated').length, results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
