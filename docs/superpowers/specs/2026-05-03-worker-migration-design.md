# Worker Migration Design

## Context

Current project uses Cloudflare Pages (static hosting + Functions file-based routing) + separate KV namespace + separate Cron Worker. This requires 4 independent deployment steps. Migrating to a single Cloudflare Worker unifies everything: one `wrangler deploy` command deploys the Worker, static assets, KV binding, and Cron trigger.

## Architecture

```
Before:                              After:
┌──────────┐                        ┌─────────────────┐
│  Pages   │ ← static               │                 │
├──────────┤                        │     Worker      │
│Functions │ ← API routes           │  ┌───────────┐  │
├──────────┤                        │  │ Assets    │  │ ← React SPA
│   KV     │ ← rotation configs     │  ├───────────┤  │
├──────────┤                        │  │ API routes│  │ ← 16 handlers
│  Cron    │ ← scheduled trigger    │  ├───────────┤  │
│  Worker  │                        │  │ Cron      │  │ ← built-in
└──────────┘                        │  ├───────────┤  │
                                    │  │ KV binding│  │ ← built-in
  4 deployment steps                │  └───────────┘  │
                                    └─────────────────┘

                                      1 deployment step
```

## File Structure Changes

```
NEW:  worker/
        index.js            # Entry point: router + cron handler
        auth.js             # Auth logic (extracted from _middleware.js)
        routes/             # Migrated from functions/api/
          login.js
          verify-token.js
          zones.js
          dns_records.js
          dns_batch.js
          dns_import.js
          dns_export.js
          custom_hostnames.js
          auto_verify.js
          fallback_origin.js
          dnspod.js
          komari.js
          rotations/
            _kv.js
            run.js

DEL:  functions/            # All Pages Functions removed
      workers/              # Cron Worker removed (built into Worker)

MOD:  wrangler.toml         # Add main, assets, triggers
      package.json          # Add "deploy" script
      README.md             # Update deployment docs
      .gitignore            # Add .wrangler/
```

## Router Design

Lightweight custom router in `worker/index.js` (~50 lines). No external dependencies.

```js
// Route table: [method, pattern, handler]
const routes = [
  ['GET',  '/api/login',                    login.GET],
  ['POST', '/api/login',                    login.POST],
  ['GET',  '/api/verify-token',             verify.GET],
  ['POST', '/api/dnspod',                   dnspod.POST],
  ['GET',  '/api/dnspod',                   dnspod.GET],
  ['GET',  '/api/zones',                    zones.GET],
  ['GET',  '/api/zones/:zoneId/dns_records',     dns.GET],
  ['POST', '/api/zones/:zoneId/dns_records',     dns.POST],
  ['PATCH','/api/zones/:zoneId/dns_records',     dns.PATCH],
  ['DELETE','/api/zones/:zoneId/dns_records',    dns.DELETE],
  ['GET',  '/api/zones/:zoneId/dns_export',      export.GET],
  ['POST', '/api/zones/:zoneId/dns_import',      import.POST],
  ['POST', '/api/zones/:zoneId/dns_batch',       batch.POST],
  ['GET',  '/api/zones/:zoneId/custom_hostnames', ch.GET],
  ['POST', '/api/zones/:zoneId/custom_hostnames', ch.POST],
  ['PATCH','/api/zones/:zoneId/custom_hostnames', ch.PATCH],
  ['DELETE','/api/zones/:zoneId/custom_hostnames',ch.DELETE],
  ['GET',  '/api/zones/:zoneId/fallback_origin',  fallback.GET],
  ['PUT',  '/api/zones/:zoneId/fallback_origin',  fallback.PUT],
  ['POST', '/api/zones/:zoneId/auto_verify',      auto_verify.POST],
  ['GET',  '/api/zones/:zoneId/rotations',        rotations.GET],
  ['POST', '/api/zones/:zoneId/rotations',        rotations.POST],
  ['PATCH','/api/zones/:zoneId/rotations',        rotations.PATCH],
  ['DELETE','/api/zones/:zoneId/rotations',       rotations.DELETE],
  ['POST', '/api/rotations/run',                  run.POST],
  ['GET',  '/api/komari/servers',                 komari.GET],
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Cloudflare-Token,X-Rotation-Key,X-Managed-Account-Index',
};
```

Pattern matching: `:param` segments extracted from URL pathname, compared with route pattern segments.

## Auth Middleware

Extracted from `functions/api/_middleware.js` into `worker/auth.js`. Logic unchanged:

1. `/api/login` — skip auth
2. Check `X-Cloudflare-Token` — client mode, inject into `data.cfToken`
3. Check `X-Rotation-Key` — rotation key, scoped to `/api/rotations/`, inject `env.CF_API_TOKEN`
4. Check `Authorization: Bearer <JWT>` — server mode, verify JWT with `jose`, inject `env.CF_API_TOKEN`
5. No valid auth — return 401

Auth runs before every API route handler (except login).

## Handler Migration

Each handler changes from Pages Function convention:
```js
// Before (Pages Function)
export async function onRequestGet(context) {
  const { cfToken } = context.data;
  const { zoneId } = context.params;
  ...
}
```

```js
// After (Worker)
export async function GET(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;
  ...
}
```

Auth runs before handler dispatch. The `data` object (containing `cfToken`, `komariBaseUrl`, etc.) is returned by `auth.js` and passed as the 4th argument to each handler. This preserves the same field access pattern (`data.cfToken`) that handlers currently use with `context.data`.

The `request` is the standard Request object, `env` is Worker env bindings (KV, secrets), `params` is extracted from URL pattern matching.

## Cron Handler

In `worker/index.js`:

```js
export default {
  fetch: handleRequest,  // Router + auth + handler dispatch
  scheduled: async (event, env, ctx) => {
    // Call the rotation run logic directly (no HTTP fetch needed)
    await runRotations(env);
  }
};
```

`runRotations` is extracted from `run.js` — no need for the HTTP round-trip through `/api/rotations/run`.

## Static Assets

Worker Assets feature serves the React SPA. Request flow:

1. If path starts with `/api/` → route to API handler
2. Otherwise → serve from `dist/` assets (or fallback to `index.html` for SPA routing)

## Deployment

```bash
npm run build          # Vite → dist/
npx wrangler deploy    # Worker + assets + KV + cron
```

Add to `package.json`:
```json
"deploy": "npm run build && wrangler deploy"
```

## Migration Steps (Ordered)

1. Create `worker/` directory structure
2. Create `worker/index.js` with router + cron handler
3. Create `worker/auth.js` from `_middleware.js`
4. Migrate each handler: rename exports, adjust params
5. Update `wrangler.toml`
6. Update `package.json` with deploy script
7. Update `README.md`
8. Test locally: `wrangler dev`
9. Delete `functions/` and `workers/` directories
10. Deploy: `npm run deploy`
11. Remove Pages deployment in Cloudflare Dashboard (optional, can keep as fallback)

## Verification

1. `wrangler dev` — local test all API routes
2. `wrangler deploy` — deploy to production
3. Create a test rotation rule via UI, verify KV entry
4. Wait for cron trigger, verify DNS record IP changed
5. Verify login works (both client and server modes)
6. Verify static assets served correctly (SPA routing, /api/ routes)
