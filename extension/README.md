# CF-DNS-Manager NodeGet Extension

通过 NodeGet JS Worker 暴露 agent IP 列表，供 CF-DNS-Manager 的 IP 轮换功能使用。

## 工作原理

```
CF-DNS-Manager  --GET /api/servers + Bearer token-->  JS Worker (onRoute)
                                                          │
                                                          ├─ 校验 token (env.token)
                                                          ├─ nodeget-server_list_all_agent_uuid → UUID 列表
                                                          ├─ 逐个 agent 执行 curl ip.sb / curl -6 ip.sb
                                                          ├─ 轮询 task 结果获取 IP
                                                          └─ 返回 [{name, ipv4:[], ipv6:[]}]
```

## 部署步骤

### 1. 创建 Token

NodeGet Dashboard → Token 管理 → 创建细粒度 Token：

| 配置项 | 值 |
|--------|-----|
| 名称 | `cf-dns-worker` |
| Scope | Global |
| 权限 | `NodeGet::ListAllAgentUuid` |
| | `Task::Create` → `Execute` |
| | `Task::Read` → `Execute` |

记录生成的 token（格式 `TokenKey:TokenSecret`）。

### 2. 创建 JS Worker

NodeGet Dashboard → JS Worker 管理 → Create：

| 配置项 | 值 |
|--------|-----|
| Name | `cf-dns-api` |
| Route Name | `cf-dns-api` |
| Env | `{"token":"<第一步的 token>"}` |

Script 填入 `worker.js` 的完整内容。

### 3. 验证

```bash
curl -H "Authorization: Bearer <token>" \
  https://<nodeget-host>/worker-route/cf-dns-api/api/servers
```

预期返回：
```json
[
  {"name":"224f010f","ipv4":["1.2.3.4"],"ipv6":[]},
  {"name":"309d6f7e","ipv4":[],"ipv6":["::1"]}
]
```

### 4. 配置 CF-DNS-Manager

在 Cloudflare Pages 环境变量中添加：

| 变量 | 值 |
|------|-----|
| `NODEGET_BASE_URL` | `https://<nodeget-host>/worker-route/cf-dns-api` |
| `NODEGET_API_TOKEN` | 第一步创建的 token |

## 可选：通过扩展系统安装

`app.json` + `resources/icon.svg` 可通过 Dashboard 扩展管理安装，但 JS Worker 需要手动创建（扩展系统的 static-worker 与 onRoute 路由冲突）。

## Token 权限说明

| 权限 | 用途 |
|------|------|
| `NodeGet::ListAllAgentUuid` | 获取所有 agent 的 UUID 列表 |
| `Task::Create (Execute)` | 在 agent 上执行 curl 获取 IP |
| `Task::Read (Execute)` | 轮询 task 执行结果 |
