# Cloudflare DNS & SaaS Manager

一个轻量化、完全运行在 Cloudflare 生态中的 Cloudflare DNS 与 SaaS (SSL for SaaS) 管理面板。


## ✨ 功能特性

- **DNS 记录管理**：完整的 DNS 记录 CRUD 操作，支持批量导入/导出
- **SaaS 自定义主机名**：管理 SSL for SaaS 自定义主机名，支持 SSL 证书配置
- **DNSPod 集成**（托管模式）：
  - 独立的 DNSPod 域名和记录管理
  - 自动配置验证记录：创建自定义主机名后自动在 DNSPod 创建验证 TXT 记录
  - 智能去重：自动检测并跳过已存在的相同记录
- **多账户支持**：通过环境变量配置多个 Cloudflare API Token
- **双模式运行**：支持本地模式（直接使用 API Token）和托管模式（服务端中转）
- **DNS IP 轮换**（托管模式）：
  - 定时自动更换 DNS 记录的 IP 地址（A/AAAA）
  - 支持 Komari 服务器 IP 池或手动指定 IP 列表
  - Round-Robin 顺序轮换，使用 cron 表达式精确指定轮换时间点
  - 通过 Cloudflare Workers Cron Triggers + KV 实现


## 📋 详细部署指南

### 部署

1. 创建 KV 命名空间：[Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers 和 Pages → KV → 创建命名空间 → 名称 `DNS_ROTATIONS`
2. 将 KV namespace ID 填入 `wrangler.toml` 的 `[[kv_namespaces]]` 中
3. 部署：

```bash
npm run deploy
```

一条命令完成：前端构建 + Worker 部署 + 静态资源上传 + KV 绑定 + Cron 触发器配置。

#### 环境变量配置

在 Cloudflare Dashboard → Workers 和 Pages → 选择 `cf-dns-manager` Worker → 设置 → 变量 → 添加：

| 变量 | 类型 | 说明 |
|------|------|------|
| `APP_PASSWORD` | 密钥 | 管理员密码（托管模式必需） |
| `CF_API_TOKEN` | 密钥 | Cloudflare API 令牌（必需） |
| `CF_API_TOKEN1` | 密钥 | 第二个账户令牌（可选） |
| `CF_API_TOKEN2` | 密钥 | 第三个账户令牌（可选） |
| `ROTATION_API_KEY` | 密钥 | IP 轮换执行密钥（可选） |
| `DNSPOD_SECRET_ID` | 密钥 | 腾讯云 SecretId（可选） |
| `DNSPOD_SECRET_KEY` | 密钥 | 腾讯云 SecretKey（可选） |
| `KOMARI_BASE_URL` | 文本 | Komari 面板地址（可选） |
| `KOMARI_API_TOKEN` | 密钥 | Komari API 令牌（可选） |

#### API 令牌权限推荐：区域.DNS.编辑，区域.SSL和证书.编辑

> **注意**：部署后 Worker 的 Cron 触发器会自动生效（每分钟检查一次轮换规则），无需额外配置。

#### DNSPod 集成（可选，托管模式）

如需使用 DNSPod 自动验证功能，请额外设置：
1. 添加 `DNSPOD_SECRET_ID` 变量（腾讯云 API 密钥 ID）
2. 添加 `DNSPOD_SECRET_KEY` 变量（腾讯云 API 密钥 Key）

> 获取密钥：登录 [腾讯云控制台](https://console.cloud.tencent.com/cam/capi) > 访问密钥 > API 密钥管理

配置后，创建自定义主机名时会自动在 DNSPod 创建验证记录。


#### Komari 集成（可选，托管模式）

如需使用 Komari 服务器 IP 快捷选择功能，请额外设置：
1. 添加 `KOMARI_BASE_URL` 变量（Komari 面板地址，如 `https://komari.example.com`）
2. 添加 `KOMARI_API_TOKEN` 变量（Komari API 令牌）

配置后，在 DNS 记录添加/编辑 A 或 AAAA 记录时，可通过下拉框快速选择 Komari 服务器 IP；DNS 列表中已解析的 IP 也会显示对应的 Komari 服务器名称标签。


#### DNS IP 轮换（可选，托管模式）

IP 轮换功能随 Worker 部署自动生效，**无需额外配置**。创建 KV 命名空间并将 ID 填入 `wrangler.toml` 后，`npm run deploy` 会同时部署 Cron 触发器。

在页面 IP 轮换标签页中：
- 创建轮换规则，使用 **5 字段 cron 表达式** 指定执行时间
- 点击 **Rotate Now** 按钮手动立即执行
- 保持页面打开时会每 60 秒自动检查

##### 注意事项

- 每条轮换规则使用 **5 字段 cron 表达式**（分 时 日 月 周）指定执行时间，输入时会实时显示人类可读的含义。
- Cron 触发器每分钟执行一次，但每条规则只在 cron 表达式匹配的分钟才真正轮换。
- 轮换仅支持 **A** 和 **AAAA** 记录，MX/TXT/CNAME 等类型不支持。
- 常用 cron 示例：`*/5 * * * *`（每 5 分钟）、`0 */6 * * *`（每 6 小时）、`0 3 * * *`（每天凌晨 3 点）、`0 9 * * 1-5`（工作日早上 9 点）。

---

## 🏗️ 项目架构

本项目采用 **Cloudflare Worker** 全栈架构：

- **Frontend**: React 18 + Vite 构建的 SPA，通过 Worker Assets 全球分发。
- **Backend**: Worker 统一处理 API 路由 + 认证中间件 + Cron 定时任务。
- **Storage**: Cloudflare KV 存储轮换配置。
- **Security**: 
    - **托管模式**：后端校验 `APP_PASSWORD` 并颁发基于 `jose` 签名的 JWT 令牌。
    - **本地模式**：前端令牌通过自定义 Header 经后端透明代理，不经过任何持久化存储。
- **Middleware**: Worker 入口处统一认证，支持 Client Token / Rotation Key / JWT 三种方式。


## 开发与部署

### 本地开发
1. **安装依赖**：
   ```bash
   npm install
   ```
2. **启动前端开发服务器**（仅前端，无后端）：
   ```bash
   npm run dev
   ```
3. **启动完整 Worker 开发服务器**（前端 + 后端 + KV + Cron）：
   ```bash
   npx wrangler dev
   ```
   创建 `.dev.vars` 文件配置环境变量（参考上方环境变量表）。

### 生产部署

```bash
npm run deploy
```

等价于 `npm run build && wrangler deploy`，一条命令完成：Vite 构建 + Worker 部署 + 静态资源 + KV 绑定 + Cron 触发器。

---
*由 [Antigravity](https://github.com/google-deepmind) 驱动开发*
