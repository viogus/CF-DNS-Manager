// 共享工具函数：IP 分类和服务端数据标准化

export function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/[ ,\n\t]+/).filter(Boolean);
  return [];
}

export function isIPv4(ip) {
  return /^[0-9.]+$/.test(ip) && ip.includes('.');
}

export function isIPv6(ip) {
  return /:/.test(ip);
}

export function normalizeServers(payload) {
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
