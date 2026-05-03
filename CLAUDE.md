# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Start Vite dev server (local/client mode)
npm run dev:wrangler     # Wrangler Pages dev proxied to Vite on :5173 (server/managed mode, needs .dev.vars)
npm run build            # Production build to dist/
npm run preview          # Preview production build locally
npx wrangler pages deploy dist  # Deploy to Cloudflare Pages
```

There is no test suite or linting configured.

## Architecture

**Edge-native SPA** — React 18 frontend (Vite 7) deployed to Cloudflare Pages, with a Pages Functions serverless backend. Zero traditional server — API routes live as edge functions under `functions/api/`.

### Frontend (`src/`)

- **`src/App.jsx`** — Single monolithic component file containing ALL UI: login, zone list, DNS records CRUD, SSL for SaaS custom hostnames, DNSPod management, and Komari server selector. Approx. 3000 lines. i18n is inlined (~200 lines of translation objects, `zh`/`en`).
- **`src/index.css`** and **`src/mobile.css`** — Global and mobile-responsive styles.

### Backend (`functions/api/`)

File-based routing conforming to Cloudflare Pages Functions conventions. Each file exports `onRequestGet`/`onRequestPost`/`onRequestPatch`/`onRequestDelete`/`onRequestPut` — the HTTP method handlers.

**Auth flow (`_middleware.js`):**
1. `/api/login` bypasses auth.
2. **Client mode**: `X-Cloudflare-Token` header → transparent proxy, CF token injected into `context.data.cfToken`.
3. **Server mode**: `Authorization: Bearer <JWT>` → JWT verified with `jose` library against `APP_PASSWORD` env var → server's `CF_API_TOKEN` from env injected into `context.data.cfToken`. Multi-account supported via `X-Managed-Account-Index` header selecting `CF_API_TOKEN{n}`.
4. Server mode also injects `dnspodSecretId`, `dnspodSecretKey`, `komariBaseUrl`, `komariApiToken` into context.

**API route pattern** — All routes are thin proxies to the Cloudflare API (`api.cloudflare.com/client/v4/...`), forwarding requests with the resolved `cfToken` from context. Routes under `[zoneId]` use `context.params.zoneId`.

**DNSPod integration (`dnspod.js`, `auto_verify.js`)** — Implements Tencent Cloud TC3-HMAC-SHA256 signing in Workers-compatible Web Crypto API. `dnspod.js` proxies CRUD actions (whitelist: DescribeDomainList, DescribeRecordList, CreateRecord, ModifyRecord, DeleteRecord). `auto_verify.js` auto-creates DNS verification TXT records in DNSPod when creating Cloudflare custom hostnames, using domain suffix matching to find the correct DNSPod zone.

**Komari integration (`komari/servers.js`)** — Proxies Komari server IP list. Returns `{ enabled: false }` when not configured. Normalizes various API response shapes.

### Key architectural facts

- `APP_PASSWORD` env var is the root secret — if not set, server mode returns 403.
- The entire app is a single-page app with conditional rendering based on `auth` state (Login screen vs Dashboard).
- Zone selection is automatic: sorts by `modified_on` descending (most recently modified first), selects the first. Persists selection across re-fetches if the zone still exists.
- `auth` object shape: `{ mode: 'client'|'server', token: string, remember: boolean, currentAccountIndex?: number, accountName?: string }`.
- Persisted via `localStorage` (remembered) or `sessionStorage` (session-only).
