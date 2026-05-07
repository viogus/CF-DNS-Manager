# CF-DNS-Manager NodeGet Extension

通过 NodeGet JS Worker 暴露 agent IP 列表，供 CF-DNS-Manager 的 IP 轮换功能使用。

## 工作原理

```
CF-DNS-Manager  --GET /api/servers + Bearer token-->  JS Worker (onRoute)
                                                          │
                                                          ├─ 校验外部 token (env.token)
                                                          ├─ nodeget-server_list_all_agent_uuid → UUID 列表
                                                          ├─ kv_get_multi_value (SuperToken) → 自定义名称
                                                          ├─ agent_static_data_multi_last_query → hostname 回退
                                                          ├─ 并行: curl ip.sb / curl -6 ip.sb → IP
                                                          └─ 返回 [{name, ipv4:[], ipv6:[]}]
```

## 部署步骤

### 1. 创建细粒度 Token

NodeGet Dashboard → Token 管理 → 创建：

| 配置项 | 值 |
|--------|-----|
| 名称 | `cf-dns-worker` |
| Scope | Global |
| 权限 | `NodeGet::ListAllAgentUuid` |
| | `Task::Create` → `Execute` |
| | `Task::Read` → `Execute` |
| | `StaticMonitoring::Read` → `system` |

记录生成的 token（格式 `TokenKey:TokenSecret`）。

### 2. 获取 SuperToken

Dashboard → Token 管理 → 找到安装 NodeGet 时自动生成的 SuperToken（通常是第一个 token，有全部权限）。

### 3. 创建 JS Worker

Dashboard → JS Worker 管理 → Create：

| 配置项 | 值 |
|--------|-----|
| Name | `cf-dns-api` |
| Route Name | `cf-dns-api` |
| Env | `{"token":"<细粒度token>","super_token":"<SuperToken>"}` |

Script 填入 `worker.js` 的完整内容。

> **为什么需要 SuperToken**：agent 的自定义名称（如 "GreenCloud-Tyo"）存储在 KV 中，以 agent UUID 为 namespace、`metadata_name` 为 key。细粒度 token 的 KV 权限无法覆盖动态的 UUID namespace，只能用 SuperToken 读取。

### 4. 验证

```bash
curl -H "Authorization: Bearer <细粒度token>" \
  https://<nodeget-host>/worker-route/cf-dns-api/api/servers
```

预期返回：
```json
[
  {"name":"GreenCloud-Tyo","ipv4":[],"ipv6":["2a12:a304:4:6f2::a"]},
  {"name":"DediRock-Buf","ipv4":[],"ipv6":["2605:6f01:2000:9e::ad36:f559"]},
  {"name":"Hinet","ipv4":["1.168.160.105"],"ipv6":[]}
]
```

### 5. 配置 CF-DNS-Manager

**GitHub Secrets**（Actions → Secrets and variables → New repository secret）：

| Secret | 值 |
|--------|-----|
| `NODEGET_BASE_URL` | `https://<nodeget-host>/worker-route/cf-dns-api` |
| `NODEGET_API_TOKEN` | 第一步创建的细粒度 token |

push main 后自动 deploy。

## 名称获取优先级

1. KV `metadata_name`（Dashboard 自定义名称）— SuperToken
2. Static monitoring `system_host_name`（系统 hostname）— 细粒度 token
3. UUID 前 8 位（最终回退）

## Token 权限说明

| 权限 | 用途 | Token |
|------|------|-------|
| `NodeGet::ListAllAgentUuid` | 获取所有 agent UUID | 细粒度 |
| `Task::Create (Execute)` | 在 agent 上执行 curl | 细粒度 |
| `Task::Read (Execute)` | 轮询 task 结果 | 细粒度 |
| `StaticMonitoring::Read (system)` | 获取 hostname 回退 | 细粒度 |
| `KV::Read` (全 namespace) | 获取自定义名称 | SuperToken |

## 扩展系统说明

`app.json` + `resources/icon.svg` 可通过 Dashboard 扩展管理安装，但 JS Worker 必须手动创建。原因是扩展系统的 static-worker（静态文件服务）与 worker 的 onRoute（HTTP 路由）共用同一 route_name 时会冲突。
