// CF-DNS-Manager NodeGet Extension — worker.js
// 运行在 NodeGet Server 的 QuickJS 运行时中
// 暴露 /api/servers 端点，返回 Komari 兼容格式的 agent IP 列表

// ============================================================
// 工具函数（与 CF-DNS-Manager 的 normalizeServers 保持一致）
// ============================================================

function isIPv4(ip) {
    return /^[0-9.]+$/.test(ip) && ip.includes('.');
}

function isIPv6(ip) {
    return /:/.test(ip);
}

// ============================================================
// IP 获取
// ============================================================

// 从 agent UUID 列表和 server token 获取每个 agent 的 IP
// 策略：查询 static_monitoring 最新数据中的 system_host_name，
// 同时尝试通过 agent 连接元数据获取 IP
async function fetchAgentIPs(uuids, token) {
    const servers = [];

    for (const uuid of uuids) {
        try {
            // 方案1：查询最新的 static monitoring 数据获取 hostname
            const staticData = await globalThis.nodeget('monitoring.query_static', {
                token: token,
                query: {
                    condition: [
                        { uuid: uuid },
                        { limit: 1 }
                    ],
                    fields: ['system']
                }
            });

            // 方案2：获取 agent 的公网 IP（通过 task 触发 agent 的 ip_provider）
            const ipResult = await globalThis.nodeget('task.create', {
                token: token,
                target_uuid: uuid,
                task_type: { get_ip: {} }
            });

            // 轮询 task 结果
            let ipData = null;
            if (ipResult && ipResult.id) {
                for (let i = 0; i < 15; i++) {
                    await sleep(200);
                    const queryResult = await globalThis.nodeget('task.query', {
                        token: token,
                        task_data_query: {
                            condition: [
                                { task_id: ipResult.id },
                                { type: 'get_ip' }
                            ]
                        }
                    });
                    if (queryResult && queryResult.length > 0) {
                        const task = queryResult[0];
                        if (task.status === 'success' || task.status === 'failed') {
                            if (task.result) {
                                ipData = task.result;
                            }
                            break;
                        }
                    }
                }
            }

            // 提取 IP
            const ipv4 = [];
            const ipv6 = [];

            if (ipData) {
                const ip = ipData.ip || ipData.ipv4 || ipData.public_ip || '';
                if (ip) {
                    if (isIPv4(ip)) ipv4.push(ip);
                    else if (isIPv6(ip)) ipv6.push(ip);
                }
            }

            // 从 static monitoring 获取 hostname 作为 server name
            let name = uuid.substring(0, 8);
            if (staticData && staticData.length > 0 && staticData[0].system) {
                name = staticData[0].system.system_host_name || name;
            }

            if (ipv4.length || ipv6.length) {
                servers.push({ name, ipv4, ipv6 });
            }
        } catch (e) {
            // 单个 agent 失败不影响整体，继续下一个
            console.error('Failed to get IP for agent ' + uuid + ': ' + (e.message || e));
        }
    }

    return servers;
}

function sleep(ms) {
    return new Promise(function(resolve) {
        // QuickJS 兼容的 setTimeout
        setTimeout(resolve, ms);
    });
}

// ============================================================
// HTTP 路由
// ============================================================

export default {
    async onRoute(request, env, runtimeCtx) {
        // QuickJS 中 request.url 可能是相对路径，不能用 new URL()
        var path = request.url || '';
        // 去掉 query string
        var qIdx = path.indexOf('?');
        if (qIdx >= 0) path = path.substring(0, qIdx);
        // 去掉末尾斜杠
        if (path.length > 1 && path[path.length - 1] === '/') {
            path = path.substring(0, path.length - 1);
        }
        var method = typeof request.method === 'string'
            ? request.method.toUpperCase()
            : 'GET';

        // GET /api/servers — 返回 agent IP 列表
        if (path === '/api/servers' && method === 'GET') {
            // Token 校验
            var authHeader = null;
            var headers = request.headers || [];
            for (var i = 0; i < headers.length; i++) {
                var h = headers[i];
                // headers 可能是 [name, value] 数组或 {name, value} 对象
                var key = h[0] || h.name || '';
                if (key.toLowerCase() === 'authorization') {
                    authHeader = h[1] || h.value || '';
                    break;
                }
            }
            var token = authHeader ? authHeader.replace('Bearer ', '') : '';

            if (env.token && token !== env.token) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            try {
                // 获取所有 agent UUID
                var uuidResult = await globalThis.nodeget('nodeget-server_list_all_agent_uuid', {
                    token: token || env.token
                });

                var uuids = (uuidResult && uuidResult.uuids) ? uuidResult.uuids :
                    (Array.isArray(uuidResult) ? uuidResult : []);

                if (!uuids || uuids.length === 0) {
                    return new Response(JSON.stringify([]), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // 获取每个 agent 的 IP
                var servers = await fetchAgentIPs(uuids, token || env.token);

                return new Response(JSON.stringify(servers), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({
                    error: 'Failed to fetch agent IPs: ' + (e.message || e)
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        return new Response('Not Found', { status: 404 });
    }
};
