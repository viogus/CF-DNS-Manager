// CF-DNS-Manager NodeGet Extension — worker.js
// 部署方式：NodeGet Dashboard → JS Worker → 创建/更新脚本
// 暴露 /api/servers 端点，返回 Komari 兼容格式的 agent IP 列表

function isIPv4(ip) {
    return /^[0-9.]+$/.test(ip) && ip.includes('.');
}

function isIPv6(ip) {
    return /:/.test(ip);
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}


function extractIP(parts, ver) {
    for (var i = 0; i < parts.length; i++) {
        var raw = (parts[i] || '').trim();
        if (!raw) continue;
        raw = ver === '6' ? raw.replace(/[^0-9a-fA-F:]/g, '') : raw.replace(/[^0-9.]/g, '');
        if (ver === '6' && isIPv6(raw)) return raw;
        if (ver === '4' && isIPv4(raw)) return raw;
    }
    return '';
}

async function execOnAgent(token, uuid, cmd, args) {
    var createRes = await globalThis.nodeget('task_create_task', {
        token: token,
        target_uuid: uuid,
        task_type: { execute: { cmd: cmd, args: args } }
    });
    var taskId = (createRes && createRes.result && createRes.result.id)
        ? createRes.result.id : null;
    if (!taskId) return '';

    for (var j = 0; j < 50; j++) {
        await sleep(200);
        try {
            var qRes = await globalThis.nodeget('task_query', {
                token: token,
                task_data_query: {
                    condition: [{ task_id: taskId }, { type: 'execute' }]
                }
            });
            if (qRes && qRes.result && qRes.result.length > 0) {
                var task = qRes.result[0];
                if (task.success === true && task.task_event_result) {
                    var out = task.task_event_result;
                    if (typeof out === 'object' && out !== null) {
                        return String(out.execute || Object.values(out)[0] || '').trim();
                    }
                    return String(out).trim();
                }
                if (task.success === false) return '';
            }
        } catch (e) {}
    }
    return '';
}

export default {
    async onRoute(request, env, runtimeCtx) {
        var urlStr = request.url || '';
        var path = '';
        try {
            path = new URL(urlStr).pathname;
        } catch (e) {
            var idx = urlStr.indexOf('/', 8);
            path = idx >= 0 ? urlStr.substring(idx) : urlStr;
        }
        if (path[path.length - 1] === '/') path = path.substring(0, path.length - 1);
        var method = request.method.toUpperCase();

        if (path.indexOf('/api/servers') === path.length - '/api/servers'.length && method === 'GET') {
            var auth = '';
            try { auth = request.headers.get('Authorization') || ''; } catch (e) {}
            var token = auth.replace('Bearer ', '');

            if (!env.token || token !== env.token) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            try {
                var rpc = await globalThis.nodeget('nodeget-server_list_all_agent_uuid', {
                    token: token || env.token
                });
                var uuids = (rpc && rpc.result && rpc.result.uuids)
                    ? rpc.result.uuids : [];

                if (uuids.length === 0) {
                    return new Response(JSON.stringify([]), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // 获取自定义名称：KV metadata_name → hostname → UUID 前缀
                var nameMap = {};

                var internalToken = env.super_token || token;

                // 优先从 KV 拿自定义名称
                try {
                    var nsKeys = uuids.map(function(u) {
                        return { namespace: u, key: 'metadata_name' };
                    });
                    var kvRes = await globalThis.nodeget('kv_get_multi_value', {
                        token: internalToken,
                        namespace_key: nsKeys
                    });
                    if (kvRes && kvRes.result) {
                        for (var k = 0; k < kvRes.result.length; k++) {
                            var entry = kvRes.result[k];
                            if (entry.value) {
                                nameMap[entry.namespace] = String(entry.value);
                            }
                        }
                    }
                } catch (e) { console.error('kv_get_multi_value failed:', e); }

                // 回退：从 static monitoring 拿 hostname
                try {
                    var staticRes = await globalThis.nodeget('agent_static_data_multi_last_query', {
                        token: token || env.token,
                        uuids: uuids,
                        fields: ['system']
                    });
                    if (staticRes && staticRes.result) {
                        for (var k2 = 0; k2 < staticRes.result.length; k2++) {
                            var item = staticRes.result[k2];
                            if (!nameMap[item.uuid]) {
                                var hn = (item.system && item.system.system_host_name) || '';
                                nameMap[item.uuid] = hn || item.uuid.substring(0, 8);
                            }
                        }
                    }
                } catch (e) { console.error('agent_static_data_multi_last_query failed:', e); }

                // 最终回退
                for (var ui = 0; ui < uuids.length; ui++) {
                    if (!nameMap[uuids[ui]]) nameMap[uuids[ui]] = uuids[ui].substring(0, 8);
                }

                // 并行获取 IP：一次性执行所有 IP 服务，取最快结果
                var results = await Promise.all(uuids.map(function(uuid) {
                    return (async function() {
                        try {
                            var name = nameMap[uuid];
                            var t = token || env.token;

                            var v4Parts = await Promise.all([
                                execOnAgent(t, uuid, 'curl', ['-4', '-s', 'ip.sb']),
                                execOnAgent(t, uuid, 'curl', ['-4', '-s', 'ifconfig.me']),
                                execOnAgent(t, uuid, 'curl', ['-4', '-s', 'api.ipify.org'])
                            ]);
                            var v6Parts = await Promise.all([
                                execOnAgent(t, uuid, 'curl', ['-6', '-s', 'ip.sb']),
                                execOnAgent(t, uuid, 'curl', ['-6', '-s', 'ifconfig.me']),
                                execOnAgent(t, uuid, 'curl', ['-6', '-s', 'api6.ipify.org'])
                            ]);

                            var v4 = extractIP(v4Parts, '4');
                            var v6 = extractIP(v6Parts, '6');

                            var ipv4 = v4 ? [v4] : [];
                            var ipv6 = v6 ? [v6] : [];

                            if (ipv4.length || ipv6.length) {
                                return { name: name, ipv4: ipv4, ipv6: ipv6 };
                            }
                        } catch (e) {}
                        return null;
                    })();
                }));

                var servers = [];
                for (var i = 0; i < results.length; i++) {
                    if (results[i]) servers.push(results[i]);
                }

                return new Response(JSON.stringify(servers), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({
                    error: 'Failed: ' + (e.message || e)
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        return new Response('Not Found', { status: 404 });
    }
};
