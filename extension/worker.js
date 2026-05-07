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

// 在目标 agent 上执行命令并获取输出
async function execOnAgent(token, uuid, cmd, args) {
    var createRes = await globalThis.nodeget('task_create_task', {
        token: token,
        target_uuid: uuid,
        task_type: { execute: { cmd: cmd, args: args } }
    });
    var taskId = (createRes && createRes.result && createRes.result.id)
        ? createRes.result.id : null;
    if (!taskId) return '';

    for (var j = 0; j < 30; j++) {
        await sleep(500);
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
                    return String(task.task_event_result).trim();
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

        // 匹配以 /api/servers 结尾的 GET 请求
        if (path.indexOf('/api/servers') === path.length - '/api/servers'.length && method === 'GET') {
            var auth = '';
            try { auth = request.headers.get('Authorization') || ''; } catch (e) {}
            var token = auth.replace('Bearer ', '');

            if (env.token && token !== env.token) {
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
                var servers = [];

                for (var i = 0; i < uuids.length; i++) {
                    var uuid = uuids[i];
                    try {
                        var name = uuid.substring(0, 8);

                        // 获取 hostname（从 static monitoring）
                        try {
                            var monRes = await globalThis.nodeget('nodeget-server_list_all_agent_uuid', { token: token || env.token });
                        } catch (e) {}

                        // 并行获取 IPv4 和 IPv6
                        var v4Result = await execOnAgent(token || env.token, uuid, 'curl', ['-s', 'ip.sb']);
                        var v6Result = await execOnAgent(token || env.token, uuid, 'curl', ['-6', '-s', 'ip.sb']);

                        var ipv4 = [];
                        var ipv6 = [];

                        v4Result = (v4Result || '').replace(/[^0-9.]/g, '');
                        if (v4Result && isIPv4(v4Result)) ipv4.push(v4Result);

                        v6Result = (v6Result || '').replace(/[^0-9a-fA-F:]/g, '');
                        if (v6Result && isIPv6(v6Result)) ipv6.push(v6Result);

                        if (ipv4.length || ipv6.length) {
                            servers.push({ name: name, ipv4: ipv4, ipv6: ipv6 });
                        }
                    } catch (e) {}
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
