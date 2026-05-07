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
    return (r && r.result && r.result.id) ? r.result.id : 0;
}

// 按 agent UUID 批量查 task 结果
async function queryAgentTasks(token, uuid, taskIds) {
    if (taskIds.length === 0) return {};
    try {
        var q = await globalThis.nodeget('task_query', {
            token: token,
            task_data_query: { condition: [{ uuid: uuid }, { type: 'execute' }, { limit: taskIds.length }] }
        });
        var resultMap = {};
        if (q && q.result && q.result.length > 0) {
            var idSet = {};
            for (var k = 0; k < taskIds.length; k++) idSet[taskIds[k]] = true;
            for (var j = 0; j < q.result.length; j++) {
                var t = q.result[j];
                if (!idSet[t.task_id]) continue;
                if (t.success === true && t.task_event_result) {
                    var o = t.task_event_result;
                    var out = typeof o === 'object' && o ? String(o.execute || Object.values(o)[0] || '') : String(o);
                    resultMap[t.task_id] = out.trim();
                }
            }
        }
        return resultMap;
    } catch (e) { return {}; }
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
                var t = token || env.token;

                var ipCmds = [
                    ['curl', ['-4', '-s', 'ip.sb']],
                    ['curl', ['-6', '-s', 'ip.sb']]
                ];
                var ipFallback = [
                    ['curl', ['-4', '-s', 'ifconfig.me']],
                    ['curl', ['-4', '-s', 'api.ipify.org']],
                    ['curl', ['-6', '-s', 'ifconfig.me']],
                    ['curl', ['-6', '-s', 'api6.ipify.org']]
                ];

                var agentTasks = {};
                for (var ai = 0; ai < uuids.length; ai++) {
                    agentTasks[uuids[ai]] = [];
                }

                // 阶段1：KV name、static hostname、首轮 30 个 task 全部并行
                var parallelWork = [];

                parallelWork.push((async function() {
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
                })());

                parallelWork.push((async function() {
                    try {
                        var staticRes = await globalThis.nodeget('agent_static_data_multi_last_query', {
                            token: t, uuids: uuids, fields: ['system']
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
                })());

                for (var ai = 0; ai < uuids.length; ai++) {
                    for (var ci = 0; ci < 2; ci++) {
                        parallelWork.push((function(u, ci2) {
                            return createTask(t, u, ipCmds[ci2][0], ipCmds[ci2][1]).then(function(id) {
                                if (id) agentTasks[u].push({ id: id, ver: ci2 === 0 ? '4' : '6' });
                            });
                        })(uuids[ai], ci));
                    }
                }
                await Promise.all(parallelWork);

                for (var ui = 0; ui < uuids.length; ui++) {
                    if (!nameMap[uuids[ui]]) nameMap[uuids[ui]] = uuids[ui].substring(0, 8);
                }

                await sleep(800);

                // 阶段2：查询首轮 30 个 task
                var agentResults = {};
                var queryPromises = uuids.map(function(uuid) {
                    return (async function() {
                        var tasks = agentTasks[uuid] || [];
                        if (tasks.length === 0) return;
                        var ids = tasks.map(function(t) { return t.id; });
                        var results = await queryAgentTasks(t, uuid, ids);
                        var v4 = '', v6 = '';
                        for (var ti = 0; ti < tasks.length; ti++) {
                            var raw = results[tasks[ti].id];
                            if (!raw) continue;
                            var ip = parseIP(raw, tasks[ti].ver);
                            if (tasks[ti].ver === '4' && !v4) v4 = ip;
                            if (tasks[ti].ver === '6' && !v6) v6 = ip;
                        }
                        if (v4 || v6) agentResults[uuid] = { v4: v4, v6: v6 };
                    })();
                });
                await Promise.all(queryPromises);

                // 阶段3：缺 v4 或 v6 的 agent 创建 fallback task
                var fallbackTasks = [];
                for (var mi = 0; mi < uuids.length; mi++) {
                    var uuid = uuids[mi];
                    var r = agentResults[uuid];
                    if (!r) {
                        fallbackTasks.push({ uuid: uuid, ver: '4', cmdIdx: 0 });
                        fallbackTasks.push({ uuid: uuid, ver: '6', cmdIdx: 2 });
                    } else {
                        if (!r.v4) fallbackTasks.push({ uuid: uuid, ver: '4', cmdIdx: 0 });
                        if (!r.v6) fallbackTasks.push({ uuid: uuid, ver: '6', cmdIdx: 2 });
                    }
                }

                if (fallbackTasks.length > 0) {
                    var fbPromises = fallbackTasks.map(function(fb) {
                        return createTask(t, fb.uuid, ipFallback[fb.cmdIdx][0], ipFallback[fb.cmdIdx][1]).then(function(id) {
                            if (id) { fb.id = id; return fb; }
                            return null;
                        });
                    });
                    var createdFbs = (await Promise.all(fbPromises)).filter(function(f) { return f; });

                    await sleep(1200);

                    // 按 agent 分组查询 fallback
                    var fbByAgent = {};
                    for (var fi = 0; fi < createdFbs.length; fi++) {
                        var fb = createdFbs[fi];
                        if (!fbByAgent[fb.uuid]) fbByAgent[fb.uuid] = [];
                        fbByAgent[fb.uuid].push(fb);
                    }

                    var fbQueries = Object.keys(fbByAgent).map(function(uuid) {
                        return (async function() {
                            var fbs = fbByAgent[uuid];
                            var ids = fbs.map(function(f) { return f.id; });
                            var results = await queryAgentTasks(t, uuid, ids);
                            for (var fi = 0; fi < fbs.length; fi++) {
                                var raw = results[fbs[fi].id];
                                if (!raw) continue;
                                var ip = parseIP(raw, fbs[fi].ver);
                                if (!ip) continue;
                                if (!agentResults[uuid]) agentResults[uuid] = { v4: '', v6: '' };
                                if (fbs[fi].ver === '4' && !agentResults[uuid].v4) agentResults[uuid].v4 = ip;
                                if (fbs[fi].ver === '6' && !agentResults[uuid].v6) agentResults[uuid].v6 = ip;
                            }
                        })();
                    });
                    await Promise.all(fbQueries);
                }

                var servers = [];
                for (var au in agentResults) {
                    var r = agentResults[au];
                    servers.push({
                        name: nameMap[au] || au.substring(0, 8),
                        ipv4: r.v4 ? [r.v4] : [],
                        ipv6: r.v6 ? [r.v6] : []
                    });
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
