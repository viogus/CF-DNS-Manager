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
  - Round-Robin 顺序轮换，可自定义间隔（最短 5 分钟）
  - 通过 Cloudflare Workers Cron Triggers + KV 实现


## 📋 详细部署指南

### Cloudflare Pages

1. Fork 或克隆本仓库到您的 GitHub 账户
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 Workers 和 Pages 页面
3. 点击"创建应用-创建 Pages 应用"，连接您的 GitHub 仓库
4. 框架预设-选择：React(vite)
5. 点击"保存并部署"

#### 此时可以使用"本地模式"登录了

如果需要"托管模式"，请继续设置环境变量：
1. 在 Cloudflare Pages 控制面板中，点击"设置" > "变量和机密" > 添加类型：密钥
2. 添加 `APP_PASSWORD` 变量（必须设置）（！！！请使用复杂的密码，如有必要请开启"Cloudflare Access"）
3. 添加 `CF_API_TOKEN` 变量（必须设置）
4. 添加 `CF_API_TOKEN1` 变量（可选）
5. 添加 `CF_API_TOKEN2` 变量（可选）
6. 返回部署页面，选择"重新部署"
#### API 令牌权限推荐：区域.DNS.编辑，区域.SSL和证书.编辑


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

如需使用 DNS 记录定时 IP 轮换功能，需要额外配置 KV 存储和 Cron Worker：

##### 1. 创建 KV 命名空间

```bash
npx wrangler kv:namespace create DNS_ROTATIONS
npx wrangler kv:namespace create DNS_ROTATIONS --preview
```

将输出的 `id` 和 `preview_id` 填入 `wrangler.toml` 的 `[[kv_namespaces]]` 中。

##### 2. 绑定 KV 到 Pages

在 Cloudflare Pages 控制面板：设置 → Functions → KV 命名空间绑定 → 添加 `DNS_ROTATIONS` 绑定。

##### 3. 添加环境变量

| 变量 | 说明 |
|------|------|
| `ROTATION_API_KEY` | 轮换执行 API 的认证密钥（自行生成复杂随机字符串） |

> **注意**：如果使用 Komari 作为 IP 来源，还需要已配置 `KOMARI_BASE_URL` 和 `KOMARI_API_TOKEN`。

##### 4. 部署 Cron Worker

```bash
npx wrangler deploy workers/rotate-trigger.js --name cf-dns-rotator --cron "*/5 * * * *"
```

部署后，在 Cloudflare Dashboard 为 Worker 设置环境变量：
- `ROTATION_URL`：Pages 部署地址，如 `https://cf-dns-manager.pages.dev`
- `ROTATION_API_KEY`：与 Pages 中 `ROTATION_API_KEY` 相同的密钥

##### 5. 本地开发

在 `.dev.vars` 中添加：
```
ROTATION_API_KEY=dev-secret-key
DNS_ROTATIONS=<preview 命名空间 ID>
```

测试轮换执行：
```bash
curl -X POST http://localhost:8788/api/rotations/run \
  -H "X-Rotation-Key: dev-secret-key"
```

##### 注意事项

- 轮换间隔最短为 **300 秒**（5 分钟），建议生产环境设置为 3600 秒以上。
- Cron Worker 每 5 分钟触发一次，但实际是否轮换由每条规则的 `lastRotatedAt + interval` 决定，不会频繁执行。
- 轮换仅支持 **A** 和 **AAAA** 记录，MX/TXT/CNAME 等类型不支持。
- KV 存储的旋转配置通过 meta index 管理，删除所有规则后 meta index 会自动清理。
- 多账户场景下，轮换使用 `CF_API_TOKEN`（account index 0），如需指定账户请修改 KV 中的配置。

---

## 🏗️ 项目架构

本项目采用 **边缘原生 (Edge-Native)** 全栈架构，完全运行在 Cloudflare 生态中：

- **Frontend**: 基于 React 18 与 Vite 构建的单页应用 (SPA)，通过 Cloudflare Pages 全球分发。
- **Backend**: 使用 Cloudflare Pages Functions 实现 Serverless API，运行在边缘节点。
- **Security**: 
    - **托管模式**：后端校验 `APP_PASSWORD` 并颁发基于 `jose` 签名的 JWT 令牌。
    - **本地模式**：前端令牌通过自定义 Header 经后端透明代理，不经过任何持久化存储。
- **Middleware**: 自动拦截并校验所有 API 请求的身份合法性。


## 开发与部署

### 开发环境
1. **安装依赖**：
   ```bash
   npm install
   ```
2. **启动开发服务器**：
   ```bash
   # 模拟本地模式
   npm run dev
   
   # 模拟托管模式 (需安装 wrangler)
   # 创建 .dev.vars 文件配置环境变量
   npx wrangler pages dev ./dist
   ```

### 生产部署
1. **编译打包**：
   ```bash
   npm run build
   ```
2. **发布至 Pages**：
   ```bash
   npx wrangler pages deploy dist
   ```

---
*由 [Antigravity](https://github.com/google-deepmind) 驱动开发*
