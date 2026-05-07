// Komari API 代理端点
// 从环境变量读取 KOMARI_BASE_URL 和 KOMARI_API_TOKEN，代理请求 Komari 服务器列表

import { normalizeServers } from './_normalize.js';

export async function GET(request, env, params, data) {
  const baseUrl = data.komariBaseUrl;
  const apiToken = data.komariApiToken;

  // 未配置 Komari 环境变量时返回 disabled 状态
  if (!baseUrl) {
    return new Response(JSON.stringify({ enabled: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 构建 API 地址
    let apiBase = baseUrl.trim().replace(/\/+$/, '');
    if (!/\/api$/.test(apiBase)) apiBase += '/api';
    const url = `${apiBase}/admin/client/list`;

    const headers = {};
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      return new Response(JSON.stringify({
        enabled: true,
        error: `Komari API 请求失败: ${res.status}`,
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
      error: `Komari API 连接失败: ${e.message}`,
      servers: []
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
