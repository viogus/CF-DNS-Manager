# GitHub Actions Auto-Deploy

## Context

Current deployment requires: Dashboard KV namespace creation + copy ID to wrangler.toml + setting 9 env vars + `npm run deploy`. Goal: fork repo → set GitHub Secrets → push → auto-deploy. Zero Dashboard interaction.

## Design

### Workflow: `.github/workflows/deploy.yml`

Triggered on push to main. Steps:

1. Checkout + Node setup + npm ci + build
2. Run `scripts/setup-kv.js` — auto-find or create KV namespace via Cloudflare API, write ID into `wrangler.toml`
3. Set secrets via `wrangler secret put` (from GitHub Secrets)
4. `npx wrangler deploy`

### setup-kv.js

Uses `CF_API_TOKEN` and `CF_ACCOUNT_ID` env vars (from GitHub Secrets). Calls Cloudflare API:

```
GET /client/v4/accounts/{id}/storage/kv/namespaces?per_page=100
→ search for DNS_ROTATIONS
→ if found: use id
→ if not: POST /client/v4/accounts/{id}/storage/kv/namespaces { title: "DNS_ROTATIONS" }
→ replace PLACEHOLDER_KV_ID in wrangler.toml with real id
```

### wrangler.toml change

```toml
[[kv_namespaces]]
binding = "DNS_ROTATIONS"
id = "PLACEHOLDER_KV_ID"
```

### GitHub Secrets needed

| Secret | Required | Purpose |
|--------|----------|---------|
| `CF_API_TOKEN` | Yes | Cloudflare API (Workers, KV edit) |
| `CF_ACCOUNT_ID` | Yes | Cloudflare account identifier |
| `APP_PASSWORD` | For server mode | Admin password |
| `DNSPOD_SECRET_ID` | Optional | Tencent Cloud |
| `DNSPOD_SECRET_KEY` | Optional | Tencent Cloud |
| `KOMARI_BASE_URL` | Optional | Komari panel |
| `KOMARI_API_TOKEN` | Optional | Komari API |
| `ROTATION_API_KEY` | Optional | IP rotation |

### Files

| File | Action |
|------|--------|
| `.github/workflows/deploy.yml` | Create |
| `scripts/setup-kv.js` | Create |
| `wrangler.toml` | Edit: placeholder KV ID |
| `README.md` | Edit: GitHub Actions deploy docs |

### Verification

1. Fork to test repo, set GitHub Secrets, push → workflow runs
2. Check wrangler deploy output in Actions log
3. Verify Worker responds at `<name>.<user>.workers.dev`
4. Verify IP rotation page loads, create test rule, check KV entry created
