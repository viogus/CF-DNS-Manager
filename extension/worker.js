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

function parseIP(raw, ver) {
    raw = (raw || '').trim();
    if (!raw) return '';
    if (ver === '6') { raw = raw.replace(/[^0-9a-fA-F:]/g, ''); return isIPv6(raw) ? raw : ''; }
    raw = raw.replace(/[^0-9.]/g, '');
    return isIPv4(raw) ? raw : '';
}

// 只创建 task，返回 taskId
async function createTask(token, uuid, cmd, args) {
    var r = await globalThis.nodeget('task_create_task', {
        token: token, target_uuid: uuid,
        task_type: { execute: { cmd: cmd, args: args } }
    });
    return (r && r.result && r.result.id) ? { id: r.result.id, uuid: uuid } : null;
}

// 批量查询 task 结果
async function batchQueryTasks(token, taskRefs) {
    var resultMap = {};
    if (taskRefs.length === 0) return resultMap;
    for (var i = 0; i < taskRefs.length; i++) {
        try {
            var q = await globalThis.nodeget('task_query', {
                token: token,
                task_data_query: { condition: [{ task_id: taskRefs[i].id }, { type: 'execute' }] }
            });
            if (q && q.result && q.result.length > 0) {
                var t = q.result[0];
                if (t.success === true || t.success === false) {
                    var out = '';
                    if (t.success && t.task_event_result) {
                        var o = t.task_event_result;
                        out = typeof o === 'object' && o ? String(o.execute || Object.values(o)[0] || '') : String(o);
                    }
                    resultMap[taskRefs[i].id] = out.trim();
                }
            }
        } catch (e) {}
    }
    return resultMap;
}

export default {
    async onRoute(request, env, runtimeCtx) {
        var urlStr = request.url || '';
        var path = '';
        try { path = new URL(urlStr).pathname; } catch (e) { var idx = urlStr.indexOf('/', 8); path = idx >= 0 ? urlStr.substring(idx) : urlStr; }
        if (path[path.length - 1] === '/') path = path.substring(0, path.length - 1);
        var method = request.method.toUpperCase();

        if (path.indexOf('/api/servers') === path.length - '/api/servers'.length && method === 'GET') {
            var auth = '';
            try { auth = request.headers.get('Authorization') || ''; } catch (e) {}
            var token = auth.replace('Bearer ', '');

            if (!env.token || token !== env.token) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401, headers: { 'Content-Type': 'application/json' }
                });
            }

            try {
                var rpc = await globalThis.nodeget('nodeget-server_list_all_agent_uuid', {
                    token: token || env.token
                });
                var uuids = (rpc && rpc.result && rpc.result.uuids) ? rpc.result.uuids : [];
                if (uuids.length === 0) {
                    return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
                }

                var nameMap = {};
                var internalToken = env.super_token || token;
                try {
                    var nsKeys = uuids.map(function(u) { return { namespace: u, key: 'metadata_name' }; });
                    var kvRes = await globalThis.nodeget('kv_get_multi_value', { token: internalToken, namespace_key: nsKeys });
                    if (kvRes && kvRes.result) {
                        for (var k = 0; k < kvRes.result.length; k++) {
                            var entry = kvRes.result[k];
                            if (entry.value) nameMap[entry.namespace] = String(entry.value);
                        }
                    }
                } catch (e) { console.error('kv_get_multi_value failed:', e); }

                try {
                    var staticRes = await globalThis.nodeget('agent_static_data_multi_last_query', {
                        token: token || env.token, uuids: uuids, fields: ['system']
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

                for (var ui = 0; ui < uuids.length; ui++) {
                    if (!nameMap[uuids[ui]]) nameMap[uuids[ui]] = uuids[ui].substring(0, 8);
                }

                var t = token || env.token;

                // 阶段1：并行创建所有 task
                var ipCmds = [
                    ['curl', ['-4', '-s', 'ip.sb']],
                    ['curl', ['-4', '-s', 'ifconfig.me']],
                    ['curl', ['-4', '-s', 'api.ipify.org']],
                    ['curl', ['-6', '-s', 'ip.sb']],
                    ['curl', ['-6', '-s', 'ifconfig.me']],
                    ['curl', ['-6', '-s', 'api6.ipify.org']]
                ];
                var createPromises = [];
                for (var ai = 0; ai < uuids.length; ai++) {
                    for (var ci = 0; ci < ipCmds.length; ci++) {
                        createPromises.push((function(u, ci2) {
                            return createTask(t, u, ipCmds[ci2][0], ipCmds[ci2][1]).then(function(ref) {
                                if (ref) ref.cmdIdx = ci2;
                                return ref;
                            });
                        })(uuids[ai], ci));
                    }
                }
                var allTasks = (await Promise.all(createPromises)).filter(function(r) { return r; });

                // 阶段2：等待 agent 执行
                await sleep(3000);

                // 阶段3：批量查询所有 task
                var resultMap = await batchQueryTasks(t, allTasks);
                var pending = [];
                for (var pi = 0; pi < allTasks.length; pi++) {
                    if (!(allTasks[pi].id in resultMap)) pending.push(allTasks[pi]);
                }

                // 阶段4：未完成的再等 2s 重试
                if (pending.length > 0) {
                    await sleep(2000);
                    var resultMap2 = await batchQueryTasks(t, pending);
                    for (var key in resultMap2) { resultMap[key] = resultMap2[key]; }
                }

                // 组装结果：每个 agent 取最快的 v4 和 v6
                var agentResults = {};
                for (var ti = 0; ti < allTasks.length; ti++) {
                    var ref = allTasks[ti];
                    var raw = resultMap[ref.id];
                    if (!raw) continue;
                    var ver = ref.cmdIdx < 3 ? '4' : '6';
                    var ip = parseIP(raw, ver);
                    if (!ip) continue;
                    var au = ref.uuid;
                    if (!agentResults[au]) agentResults[au] = {};
                    if (ver === '4' && !agentResults[au].v4) agentResults[au].v4 = ip;
                    if (ver === '6' && !agentResults[au].v6) agentResults[au].v6 = ip;
                }

                var servers = [];
                for (var au2 in agentResults) {
                    var r = agentResults[au2];
                    var v4 = r.v4 || '';
                    var v6 = r.v6 || '';
                    if (v4 || v6) {
                        servers.push({
                            name: nameMap[au2] || au2.substring(0, 8),
                            ipv4: v4 ? [v4] : [],
                            ipv6: v6 ? [v6] : []
                        });
                    }
                }

                return new Response(JSON.stringify(servers), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ error: 'Failed: ' + (e.message || e) }), {
                    status: 500, headers: { 'Content-Type': 'application/json' }
                });
            }
        }
        return new Response('Not Found', { status: 404 });
    }
};
