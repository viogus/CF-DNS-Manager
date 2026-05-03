# Worker Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from Cloudflare Pages + Separate Cron Worker → Single Cloudflare Worker with built-in assets, cron, and KV.

**Architecture:** Move all 16 Pages Function handlers from `functions/api/` to `worker/routes/`. Replace file-based routing with lightweight custom router. Extract auth middleware to `worker/auth.js`. Add cron handler directly in Worker. Use Worker Assets for static file serving.

**Tech Stack:** Cloudflare Workers, KV, Cron Triggers, Worker Assets, jose (JWT), React/Vite (unchanged)

---

### Task 1: Create directory structure and wrangler config

**Files:**
- Create: `worker/routes/rotations/.gitkeep`
- Modify: `wrangler.toml`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p worker/routes/rotations
```

- [ ] **Step 2: Update wrangler.toml**

Read current `wrangler.toml`, replace with:

```toml
name = "cf-dns-manager"
main = "worker/index.js"
compatibility_date = "2026-05-03"

[assets]
directory = "dist"

[[kv_namespaces]]
binding = "DNS_ROTATIONS"
id = "DNS_ROTATIONS"

[triggers]
crons = ["* * * * *"]
```

- [ ] **Step 3: Update .gitignore**

Add `.wrangler/` to `.gitignore`.

- [ ] **Step 4: Commit**

```bash
git add worker/ wrangler.toml .gitignore
git commit -m "chore: create worker directory and update config"
```

---

### Task 2: Create auth middleware

**Files:**
- Create: `worker/auth.js`

- [ ] **Step 1: Write worker/auth.js**

Extract from `functions/api/_middleware.js`, adapting for Worker context. The `authenticate()` function returns `{ data, error }`:

```js
import { jwtVerify } from 'jose';

export async function authenticate(request, env, url) {
  const data = {};

  // Skip auth for login
  if (url.pathname === '/api/login') {
    return { data };
  }

  const clientToken = request.headers.get('X-Cloudflare-Token');
  const authHeader = request.headers.get('Authorization');
  const rotationKey = request.headers.get('X-Rotation-Key');

  // Priority 1: Client Mode
  if (clientToken) {
    data.cfToken = clientToken;
    return { data };
  }

  // Priority 2: Rotation Key (scoped to /api/rotations/)
  if (rotationKey && env.ROTATION_API_KEY && rotationKey === env.ROTATION_API_KEY) {
    if (!url.pathname.startsWith('/api/rotations/')) {
      return { error: { status: 403, body: { error: 'Rotation key not allowed for this endpoint' } } };
    }
    data.cfToken = env.CF_API_TOKEN;
    data.komariBaseUrl = env.KOMARI_BASE_URL;
    data.komariApiToken = env.KOMARI_API_TOKEN;
    return { data };
  }

  // Priority 3: Server Mode (JWT)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const serverSecret = env.APP_PASSWORD;

    if (!serverSecret) {
      return { error: { status: 403, body: { error: 'Server-side Managed Mode is not configured (missing APP_PASSWORD).' } } };
    }

    try {
      const secret = new TextEncoder().encode(serverSecret);
      await jwtVerify(token, secret);

      const accountIndex = parseInt(request.headers.get('X-Managed-Account-Index') || '0');
      let serverToken = env.CF_API_TOKEN;
      if (accountIndex > 0) {
        serverToken = env[`CF_API_TOKEN${accountIndex}`];
      }

      if (!serverToken) {
        return { error: { status: 403, body: { error: 'Selected managed account is not configured.' } } };
      }

      data.cfToken = serverToken;
      data.dnspodSecretId = env.DNSPOD_SECRET_ID;
      data.dnspodSecretKey = env.DNSPOD_SECRET_KEY;
      data.komariBaseUrl = env.KOMARI_BASE_URL;
      data.komariApiToken = env.KOMARI_API_TOKEN;
      return { data };
    } catch (e) {
      return { error: { status: 401, body: { error: 'Invalid or expired session.', message: e.message } } };
    }
  }

  return { error: { status: 401, body: { error: 'Authentication Required', message: 'Please provide X-Cloudflare-Token, X-Rotation-Key, or Authorization header.' } } };
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/auth.js
git commit -m "feat: add worker auth middleware"
```

---

### Task 3: Create Worker entry point with router

**Files:**
- Create: `worker/index.js`

- [ ] **Step 1: Write worker/index.js**

```js
import { authenticate } from './auth.js';
import * as login from './routes/login.js';
import * as verify from './routes/verify-token.js';
import * as zones from './routes/zones.js';
import * as dns from './routes/dns_records.js';
import * as dnsExport from './routes/dns_export.js';
import * as dnsImport from './routes/dns_import.js';
import * as dnsBatch from './routes/dns_batch.js';
import * as ch from './routes/custom_hostnames.js';
import * as fallback from './routes/fallback_origin.js';
import * as autoVerify from './routes/auto_verify.js';
import * as rotations from './routes/rotations.js';
import * as run from './routes/rotations/run.js';
import * as dnspod from './routes/dnspod.js';
import * as komari from './routes/komari.js';

const routes = [
  ['GET',    '/api/login',                          login],
  ['POST',   '/api/login',                          login],
  ['GET',    '/api/verify-token',                   verify],
  ['GET',    '/api/dnspod',                         dnspod],
  ['POST',   '/api/dnspod',                         dnspod],
  ['GET',    '/api/zones',                          zones],
  ['GET',    '/api/zones/:zoneId/dns_records',      dns],
  ['POST',   '/api/zones/:zoneId/dns_records',      dns],
  ['PATCH',  '/api/zones/:zoneId/dns_records',      dns],
  ['DELETE', '/api/zones/:zoneId/dns_records',      dns],
  ['GET',    '/api/zones/:zoneId/dns_export',       dnsExport],
  ['POST',   '/api/zones/:zoneId/dns_import',       dnsImport],
  ['POST',   '/api/zones/:zoneId/dns_batch',        dnsBatch],
  ['GET',    '/api/zones/:zoneId/custom_hostnames', ch],
  ['POST',   '/api/zones/:zoneId/custom_hostnames', ch],
  ['PATCH',  '/api/zones/:zoneId/custom_hostnames', ch],
  ['DELETE', '/api/zones/:zoneId/custom_hostnames', ch],
  ['GET',    '/api/zones/:zoneId/fallback_origin',  fallback],
  ['PUT',    '/api/zones/:zoneId/fallback_origin',  fallback],
  ['POST',   '/api/zones/:zoneId/auto_verify',      autoVerify],
  ['GET',    '/api/zones/:zoneId/rotations',        rotations],
  ['POST',   '/api/zones/:zoneId/rotations',        rotations],
  ['PATCH',  '/api/zones/:zoneId/rotations',        rotations],
  ['DELETE', '/api/zones/:zoneId/rotations',        rotations],
  ['POST',   '/api/rotations/run',                  run],
  ['GET',    '/api/komari/servers',                 komari],
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Cloudflare-Token,X-Rotation-Key,X-Managed-Account-Index',
};

function addCors(headers) {
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    if (!h.has(k)) h.set(k, v);
  }
  return h;
}

function matchRoute(method, pathname) {
  const segments = pathname.replace(/\/$/, '').split('/').filter(Boolean);
  for (const [m, pattern, handler] of routes) {
    if (m !== method && m !== '*') continue;
    const patternSegs = pattern.replace(/\/$/, '').split('/').filter(Boolean);
    if (patternSegs.length !== segments.length) continue;
    const params = {};
    let match = true;
    for (let i = 0; i < patternSegs.length; i++) {
      if (patternSegs[i].startsWith(':')) {
        params[patternSegs[i].slice(1)] = segments[i];
      } else if (patternSegs[i] !== segments[i]) {
        match = false;
        break;
      }
    }
    if (match) return { handler, params };
  }
  return null;
}

function methodToHandler(method) {
  const map = { GET: 'GET', POST: 'POST', PATCH: 'PATCH', PUT: 'PUT', DELETE: 'DELETE' };
  return map[method] || null;
}

async function handleRequest(request, env) {
  const url = new URL(request.url);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // API routes
  if (url.pathname.startsWith('/api/')) {
    const match = matchRoute(request.method, url.pathname);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: addCors({ 'Content-Type': 'application/json' })
      });
    }

    const { handler, params } = match;
    const handlerFn = methodToHandler(request.method);

    // Auth
    const { data, error: authError } = await authenticate(request, env, url);
    if (authError) {
      return new Response(JSON.stringify(authError.body), {
        status: authError.status,
        headers: addCors({ 'Content-Type': 'application/json' })
      });
    }

    // Dispatch to handler
    if (handlerFn && handler[handlerFn]) {
      return handler[handlerFn](request, env, params, data);
    } else if (handler.onRequest) {
      return handler.onRequest({ request, env, params, data });
    }
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: addCors({ 'Content-Type': 'application/json' })
    });
  }

  // Static assets: Worker Assets handles serving dist/ + SPA fallback to index.html
  return env.ASSETS.fetch(request);
}

async function handleScheduled(event, env, ctx) {
  const { listAllRotations, putRotation } = await import('./routes/rotations/_kv.js');
  const { runRotations } = await import('./routes/rotations/run.js');
  ctx.waitUntil(runRotations(env));
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};
```

- [ ] **Step 2: Commit**

```bash
git add worker/index.js
git commit -m "feat: add worker entry point with router and cron handler"
```

---

### Task 4: Migrate simple handlers (no zoneId param)

**Files:**
- Create: `worker/routes/login.js`
- Create: `worker/routes/verify-token.js`
- Create: `worker/routes/zones.js`
- Create: `worker/routes/dnspod.js`
- Create: `worker/routes/komari.js`

- [ ] **Step 1: Create worker/routes/login.js**

Copy from `functions/api/login.js`. Change `export async function onRequestPost(context)` to `export async function POST(request, env, params, data)`. Replace `context.request` with `request`, `context.env` with `env`, `context.data` with `data`.

```js
import { SignJWT } from 'jose';

export async function POST(request, env, params, data) {
  const { password } = await request.json();
  const serverPassword = env.APP_PASSWORD;

  if (!serverPassword) {
    return new Response(JSON.stringify({ error: 'Server is not configured for password login.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const msgUint8 = new TextEncoder().encode(serverPassword);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const serverPasswordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  if (password === serverPasswordHash) {
    const secret = new TextEncoder().encode(serverPassword);
    const jwt = await new SignJWT({ admin: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secret);

    const accounts = [];
    if (env.CF_API_TOKEN) accounts.push({ id: 0, name: 'Default Account' });
    let i = 1;
    while (env[`CF_API_TOKEN${i}`]) {
      accounts.push({ id: i, name: `Account ${i}` });
      i++;
    }

    return new Response(JSON.stringify({ token: jwt, accounts }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Invalid password' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

- [ ] **Step 2: Create worker/routes/verify-token.js**

```js
export async function GET(request, env, params, data) {
  const clientToken = request.headers.get('X-Cloudflare-Token');

  if (!clientToken) {
    return new Response(JSON.stringify({ success: false, message: 'No token provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const verifyResponse = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: {
        'Authorization': `Bearer ${clientToken}`,
        'Content-Type': 'application/json'
      }
    });

    const verifyData = await verifyResponse.json();

    if (verifyData.success && verifyData.result && verifyData.result.status === 'active') {
      return new Response(JSON.stringify({ success: true, message: 'Token is valid' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        message: verifyData.messages?.[0]?.message || 'Invalid token'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      message: 'Failed to verify token'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

- [ ] **Step 3: Create worker/routes/zones.js**

```js
export async function GET(request, env, params, data) {
  const { cfToken } = data;

  const response = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=50', {
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    }
  });

  const responseData = await response.json();
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

- [ ] **Step 4: Create worker/routes/dnspod.js**

Copy the full file from `functions/api/dnspod.js`. Change:
- `onRequestGet(context)` → `GET(request, env, params, data)`, access `data.dnspodSecretId` instead of `context.data.dnspodSecretId`
- `onRequestPost(context)` → `POST(request, env, params, data)`, same `context.data` → `data` change
- Keep internal helper functions (`hmacSha256`, `sha256Hex`, `bytesToHex`, `signRequest`, `callDnspodApi`) unchanged.

- [ ] **Step 5: Create worker/routes/komari.js**

Copy the full file from `functions/api/komari/servers.js`. Change:
- `onRequestGet(context)` → `GET(request, env, params, data)`
- `context.data.komariBaseUrl` → `data.komariBaseUrl`
- `context.data.komariApiToken` → `data.komariApiToken`
- Keep helper functions (`toArray`, `isIPv4`, `isIPv6`, `normalizeServers`) unchanged.

- [ ] **Step 6: Commit**

```bash
git add worker/routes/login.js worker/routes/verify-token.js worker/routes/zones.js worker/routes/dnspod.js worker/routes/komari.js
git commit -m "feat: migrate login, verify, zones, dnspod, komari handlers"
```

---

### Task 5: Migrate DNS zone-scoped handlers

**Files:**
- Create: `worker/routes/dns_records.js`
- Create: `worker/routes/dns_export.js`
- Create: `worker/routes/dns_import.js`
- Create: `worker/routes/dns_batch.js`

- [ ] **Step 1: Create worker/routes/dns_records.js**

Copy from `functions/api/zones/[zoneId]/dns_records.js`. Change:
- `onRequestGet(context)` → `GET(request, env, params, data)`, use `params.zoneId`, `data.cfToken`
- `onRequestPost(context)` → `POST(request, env, params, data)`
- `onRequestPatch(context)` → `PATCH(request, env, params, data)`, read `recordId` from URL: `new URL(request.url).searchParams.get('id')`
- `onRequestDelete(context)` → `DELETE(request, env, params, data)`

```js
export async function GET(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=100`, {
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    }
  });

  const responseData = await response.json();
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function POST(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;
  const body = await request.json();

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const responseData = await response.json();
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function PATCH(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;
  const recordId = new URL(request.url).searchParams.get('id');
  const body = await request.json();

  if (!recordId) return new Response('Missing ID', { status: 400 });

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const responseData = await response.json();
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function DELETE(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;
  const recordId = new URL(request.url).searchParams.get('id');

  if (!recordId) return new Response('Missing ID', { status: 400 });

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    }
  });

  const responseData = await response.json();
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

- [ ] **Step 2: Create worker/routes/dns_export.js**

Copy from `functions/api/zones/[zoneId]/dns_export.js`. Change `onRequestGet(context)` → `GET(request, env, params, data)`. Use `params.zoneId`, `data.cfToken`.

- [ ] **Step 3: Create worker/routes/dns_import.js**

Copy from `functions/api/zones/[zoneId]/dns_import.js`. Change `onRequestPost(context)` → `POST(request, env, params, data)`. Use `params.zoneId`, `data.cfToken`. Forward `request.headers.get('Content-Type')` as before.

- [ ] **Step 4: Create worker/routes/dns_batch.js**

Copy from `functions/api/zones/[zoneId]/dns_batch.js`. Change `onRequestPost(context)` → `POST(request, env, params, data)`. Use `params.zoneId`, `data.cfToken`.

- [ ] **Step 5: Commit**

```bash
git add worker/routes/dns_records.js worker/routes/dns_export.js worker/routes/dns_import.js worker/routes/dns_batch.js
git commit -m "feat: migrate DNS record CRUD, export, import, batch handlers"
```

---

### Task 6: Migrate SaaS and rotation handlers

**Files:**
- Create: `worker/routes/custom_hostnames.js`
- Create: `worker/routes/auto_verify.js`
- Create: `worker/routes/fallback_origin.js`
- Create: `worker/routes/rotations.js`
- Create: `worker/routes/rotations/_kv.js` (copy)
- Create: `worker/routes/rotations/run.js` (copy + adapt)

- [ ] **Step 1: Create worker/routes/custom_hostnames.js**

Copy from `functions/api/zones/[zoneId]/custom_hostnames.js`. Convert 4 exports:
- `onRequestGet(context)` → `GET(request, env, params, data)`
- `onRequestPost(context)` → `POST(request, env, params, data)`
- `onRequestDelete(context)` → `DELETE(request, env, params, data)`
- `onRequestPatch(context)` → `PATCH(request, env, params, data)`

All use `params.zoneId`, `data.cfToken`. DELETE and PATCH read `id` from `new URL(request.url).searchParams.get('id')`.

- [ ] **Step 2: Create worker/routes/auto_verify.js**

Copy from `functions/api/zones/[zoneId]/auto_verify.js`. Convert:
- Keep TC3 signing helpers (`hmacSha256`, `sha256Hex`, `bytesToHex`, `signRequest`, `callDnspodApi`, `extractPossibleDomains`)
- `onRequestPost(context)` → `POST(request, env, params, data)`
- `context.data.dnspodSecretId` → `data.dnspodSecretId`
- `context.data.dnspodSecretKey` → `data.dnspodSecretKey`
- `context.params.zoneId` → `params.zoneId`
- `context.request` → `request`

- [ ] **Step 3: Create worker/routes/fallback_origin.js**

Copy from `functions/api/zones/[zoneId]/fallback_origin.js`. Convert:
- `onRequestGet(context)` → `GET(request, env, params, data)`
- `onRequestPut(context)` → `PUT(request, env, params, data)`
Both use `params.zoneId`, `data.cfToken`.

- [ ] **Step 4: Copy worker/routes/rotations/_kv.js**

Direct copy from `functions/api/rotations/_kv.js`. No changes needed — the file only uses `env.DNS_ROTATIONS` (Worker env binding), which is the same in both Pages Functions and Workers.

```bash
cp functions/api/rotations/_kv.js worker/routes/rotations/_kv.js
```

- [ ] **Step 5: Create worker/routes/rotations/run.js**

Copy from `functions/api/rotations/run.js`. Two changes:
1. `onRequestPost(context)` → `POST(request, env, params, data)`. Use `data.cfToken` and `data.komariBaseUrl`/`data.komariApiToken` instead of reading from env for those.
2. Extract a `runRotations(env)` function for the cron handler:

```js
export async function runRotations(env) {
  const rotations = await listAllRotations(env);
  const results = [];
  const now = new Date();
  const thisMinute = now.toISOString().slice(0, 16);
  const cfToken = env.CF_API_TOKEN;

  for (const rotation of rotations) {
    if (!rotation.enabled) continue;
    const lastMinute = rotation.lastRotatedAt ? rotation.lastRotatedAt.slice(0, 16) : '';
    if (lastMinute === thisMinute) continue;
    if (!rotation.cron || !cronMatches(rotation.cron, now)) continue;

    try {
      let ipPool;
      if (rotation.ipSource === 'komari') {
        ipPool = await fetchKomariIPs(env, rotation);
      } else {
        ipPool = rotation.manualIPs || [];
      }
      if (ipPool.length === 0) {
        results.push({ recordId: rotation.recordId, status: 'skipped', reason: 'No IPs available' });
        continue;
      }
      const newIndex = rotation.currentIndex % ipPool.length;
      const newIP = ipPool[newIndex];
      const patchRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${rotation.zoneId}/dns_records/${rotation.recordId}`,
        {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newIP })
        }
      );
      const patchData = await patchRes.json();
      if (patchData.success) {
        rotation.currentIndex = (rotation.currentIndex + 1) % ipPool.length;
        rotation.lastRotatedAt = now.toISOString();
        rotation.updatedAt = rotation.lastRotatedAt;
        await putRotation(env, rotation);
        results.push({ recordId: rotation.recordId, recordName: rotation.recordName, status: 'rotated', newIP, nextIndex: rotation.currentIndex });
      } else {
        results.push({ recordId: rotation.recordId, status: 'failed', error: patchData.errors?.[0]?.message || 'Unknown error' });
      }
    } catch (e) {
      results.push({ recordId: rotation.recordId, status: 'error', error: e.message });
    }
  }
  return { success: true, rotated: results.filter(r => r.status === 'rotated').length, results };
}

export async function POST(request, env, params, data) {
  const cfToken = data.cfToken || env.CF_API_TOKEN;
  if (!cfToken) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const result = await runRotations(env);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

Keep the helper functions `isIPv4`, `isIPv6`, `toArray`, `normalizeServers`, `fetchKomariIPs`, `matchField`, `cronMatches` from the original file.

- [ ] **Step 6: Create worker/routes/rotations.js**

Copy from `functions/api/zones/[zoneId]/rotations.js`. Adjust imports: `'../../rotations/_kv'` → `'./rotations/_kv'`.
Convert exports:
- `onRequestGet(context)` → `GET(request, env, params, data)`, use `params.zoneId`
- `onRequestPost(context)` → `POST(request, env, params, data)`, use `params.zoneId`, `request`
- `onRequestPatch(context)` → `PATCH(request, env, params, data)`, read `id` from `new URL(request.url).searchParams.get('id')`
- `onRequestDelete(context)` → `DELETE(request, env, params, data)`, read `id` from `new URL(request.url).searchParams.get('id')`
Keep `isValidCron` and `CRON_RE` unchanged.

- [ ] **Step 7: Commit**

```bash
git add worker/routes/custom_hostnames.js worker/routes/auto_verify.js worker/routes/fallback_origin.js worker/routes/rotations.js worker/routes/rotations/
git commit -m "feat: migrate SaaS, rotation, and auto_verify handlers"
```

---

### Task 7: Update package.json and README

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add deploy script to package.json**

Find the `"scripts"` block and add:
```json
"deploy": "npm run build && wrangler deploy"
```

- [ ] **Step 2: Update README deployment section**

Replace the "生产部署" section with:

```markdown
### 生产部署

```bash
npm run deploy
```

一条命令完成：前端构建 + Worker 部署 + 静态资源上传 + KV 绑定 + Cron 触发器配置。
```

Remove the separate Cron Worker deployment steps in the IP rotation section. Replace with:

```markdown
Cron 触发器已在 `wrangler.toml` 中配置（`* * * * *`），执行 `npm run deploy` 后自动生效，无需额外操作。
```

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "chore: add deploy script, update README for Worker deployment"
```

---

### Task 8: Clean up old files

**Files:**
- Delete: `functions/` (entire directory)
- Delete: `workers/` (entire directory)

- [ ] **Step 1: Delete old directories**

```bash
rm -rf functions/ workers/
```

- [ ] **Step 2: Commit**

```bash
git add -A functions/ workers/
git commit -m "chore: remove Pages Functions and separate Cron Worker"
```

---

### Task 9: Local test and verify

- [ ] **Step 1: Build frontend**

```bash
npm run build
```
Expected: dist/ output with index.html, assets/*.js, assets/*.css

- [ ] **Step 2: Start wrangler dev**

```bash
npx wrangler dev
```

- [ ] **Step 3: Test API endpoints**

```bash
# Test login
curl http://localhost:8787/api/login

# Test zones
curl http://localhost:8787/api/zones -H "X-Cloudflare-Token: $CF_TOKEN"

# Test rotation CRUD
curl http://localhost:8787/api/zones/:zoneId/rotations -H "Authorization: Bearer $JWT"
```

- [ ] **Step 4: Test static assets**

Open http://localhost:8787 in browser. Should see the React app. Navigate to login, verify the page loads.

- [ ] **Step 5: Test cron trigger (simulated)**

```bash
curl http://localhost:8787/__scheduled
```
Expected: Rotation execution runs (may return 500 if no KV binding in dev).

---

### Task 10: Deploy to production

- [ ] **Step 1: Deploy**

```bash
npm run deploy
```

- [ ] **Step 2: Verify deployment**

Open the deployed Worker URL. Test login, zone list, DNS management, rotation tab.

- [ ] **Step 3: Tag release**

```bash
git tag -a 0.3 -m "v0.3: Migrated to Cloudflare Worker — unified deployment"
git push origin 0.3
```
