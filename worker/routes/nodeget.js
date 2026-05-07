// Nodeget API 代理端点
// 从环境变量读取 NODEGET_BASE_URL 和 NODEGET_API_TOKEN，代理请求 Nodeget 扩展端点

function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/[ ,\n\t]+/).filter(Boolean);
  return [];
}

function isIPv4(ip) {
  return /^[0-9.]+$/.test(ip) && ip.includes('.');
}

function isIPv6(ip) {
  return /:/.test(ip);
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
      ...toArray(item.ipv4),
      ...toArray(item.ip_v4),
      ...toArray(item.ipv6),
      ...toArray(item.ip_v6),
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

export async function GET(request, env, params, data) {
  const baseUrl = data.nodegetBaseUrl;
  const apiToken = data.nodegetApiToken;

  if (!baseUrl) {
    return new Response(JSON.stringify({ enabled: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    let apiBase = baseUrl.trim().replace(/\/+$/, '');
    const url = `${apiBase}/api/servers`;

    const headers = {};
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      return new Response(JSON.stringify({
        enabled: true,
        error: `Nodeget API request failed: ${res.status}`,
        servers: []
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const payload = await res.json();
    const servers = normalizeServers(payload);

    return new Response(JSON.stringify({ enabled: true, servers }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      enabled: true,
      error: `Nodeget API connection failed: ${e.message}`,
      servers: []
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
