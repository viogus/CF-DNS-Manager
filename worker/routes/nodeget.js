// Nodeget API 代理端点
// 从环境变量读取 NODEGET_BASE_URL 和 NODEGET_API_TOKEN，代理请求 Nodeget 扩展端点

import { normalizeServers } from './_normalize.js';

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
