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

async function fetchKomariServers(env) {
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
    return normalizeServers(payload);
  } catch { return []; }
}

function getIPsFromServers(servers, rotation) {
  let filtered = servers;
  if (rotation.komariServerFilter && rotation.komariServerFilter.length > 0) {
    filtered = servers.filter(s => rotation.komariServerFilter.includes(s.name));
  }
  return rotation.recordType === 'AAAA'
    ? filtered.flatMap(s => s.ipv6)
    : filtered.flatMap(s => s.ipv4);
}

async function fetchKomariIPs(env, rotation) {
  const baseUrl = env.KOMARI_BASE_URL;
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

/** Match a single cron field value against a target number */
function matchField(field, value) {
  if (field === '*') return true;
  // Handle comma-separated values: "1,3,5"
  if (field.includes(',')) {
    return field.split(',').some(f => matchField(f, value));
  }
  // Handle step: "*/5", "0/15", or "1-5/2"
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    const s = parseInt(step);
    if (base === '*') return value % s === 0;
    // Check for range base: "1-5/2"
    if (base.includes('-')) {
      const [lo, hi] = base.split('-').map(Number);
      return value >= lo && value <= hi && (value - lo) % s === 0;
    }
    const b = parseInt(base);
    return value >= b && (value - b) % s === 0;
  }
  // Handle range: "1-5"
  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map(Number);
    return value >= lo && value <= hi;
  }
  // Exact match
  return parseInt(field) === value;
}

/** Check whether a 5-field cron expression matches a given Date */
function cronMatches(cronExpr, date) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, day, month, weekday] = parts;
  return (
    matchField(min, date.getUTCMinutes()) &&
    matchField(hour, date.getUTCHours()) &&
    matchField(day, date.getUTCDate()) &&
    matchField(month, date.getUTCMonth() + 1) &&
    matchField(weekday, date.getUTCDay() === 0 ? 7 : date.getUTCDay()) // Sun=7 in cron
  );
}

export async function runRotations(env) {
  const rotations = await listAllRotations(env);
  const results = [];
  const now = new Date();
  const thisMinute = now.toISOString().slice(0, 16);
  const cfToken = env.CF_API_DNS_TOKEN || env.CF_API_TOKEN;

  // Fetch Komari IPs once before the loop (shared across all rotations using komari)
  let komariServers = null;
  const komariNeeded = rotations.some(r => r.enabled && r.ipSource === 'komari');
  if (komariNeeded) {
    try { komariServers = await fetchKomariServers(env); } catch { komariServers = []; }
  }

  for (const rotation of rotations) {
    if (!rotation.enabled) continue;
    const lastMinute = rotation.lastRotatedAt ? rotation.lastRotatedAt.slice(0, 16) : '';
    if (lastMinute === thisMinute) continue;
    if (!rotation.cron || !cronMatches(rotation.cron, now)) continue;

    try {
      let ipPool;
      if (rotation.ipSource === 'komari') {
        ipPool = komariServers
          ? getIPsFromServers(komariServers, rotation)
          : await fetchKomariIPs(env, rotation);
      } else {
        ipPool = rotation.manualIPs || [];
      }
      if (ipPool.length === 0) {
        results.push({ recordId: rotation.recordId, status: 'skipped', reason: 'No IPs available' });
        continue;
      }
      const newIndex = rotation.currentIndex % ipPool.length;
      const newIP = ipPool[newIndex];
      const patchRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${rotation.zoneId}/dns_records/${rotation.recordId}`,
        {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newIP })
        }
      );
      const patchData = await patchRes.json();
      if (patchData.success) {
        rotation.currentIndex = (rotation.currentIndex + 1) % ipPool.length;
        rotation.lastRotatedAt = now.toISOString();
        rotation.updatedAt = rotation.lastRotatedAt;
        await putRotation(env, rotation);
        results.push({ recordId: rotation.recordId, recordName: rotation.recordName, status: 'rotated', newIP, nextIndex: rotation.currentIndex });
      } else {
        const err = patchData.errors?.[0];
        results.push({ recordId: rotation.recordId, status: 'failed', error: typeof err === 'string' ? err : err?.message || 'Unknown error' });
      }
    } catch (e) {
      results.push({ recordId: rotation.recordId, status: 'error', error: e.message });
    }
  }
  return { success: true, rotated: results.filter(r => r.status === 'rotated').length, results };
}

export async function POST(request, env, params, data) {
  const cfToken = data.cfToken || env.CF_API_TOKEN;
  if (!cfToken) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const result = await runRotations(env);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
}
