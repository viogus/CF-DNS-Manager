# Nodeget IP Source Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nodeget.com as a third IP source (`nodeget`) for DNS rotation, mirroring the existing Komari integration pattern.

**Architecture:** New env vars (`NODEGET_BASE_URL`, `NODEGET_API_TOKEN`) → injected into request data by `auth.js` → new `/api/nodeget/servers` route proxies the nodeget extension endpoint → `run.js` fetches nodeget IPs same as komari → frontend `useNodeget` hook + ZoneDetail UI additions.

**Tech Stack:** JavaScript (Cloudflare Workers), React 18, Vite 7

---

### Task 1: Inject nodeget env vars into auth.js

**Files:**
- Modify: `worker/auth.js` (lines 27-29 and 60-61)

- [ ] **Step 1: Add nodeget env var injection alongside komari**

Add `data.nodegetBaseUrl` and `data.nodegetApiToken` on the same lines where `komariBaseUrl`/`komariApiToken` are set.

In the Rotation Key block, after line 28:

```js
data.komariBaseUrl = env.KOMARI_BASE_URL;
data.komariApiToken = env.KOMARI_API_TOKEN;
data.nodegetBaseUrl = env.NODEGET_BASE_URL;
data.nodegetApiToken = env.NODEGET_API_TOKEN;
```

In the Server Mode (JWT) block, after line 61:

```js
data.komariBaseUrl = env.KOMARI_BASE_URL;
data.komariApiToken = env.KOMARI_API_TOKEN;
data.nodegetBaseUrl = env.NODEGET_BASE_URL;
data.nodegetApiToken = env.NODEGET_API_TOKEN;
```

- [ ] **Step 2: Commit**

```bash
git add worker/auth.js
git commit -m "feat: inject nodeget env vars into auth context"
```

---

### Task 2: Create worker/routes/nodeget.js (API route)

**Files:**
- Create: `worker/routes/nodeget.js`

- [ ] **Step 1: Create the file**

Mirror of `worker/routes/komari.js`, adapted for nodeget. The nodeget extension already returns Komari-compatible `[{name, ipv4[], ipv6[]}]` shape, so `normalizeServers` handles it. The endpoint path is `/api/servers` on the extension (not `/api/admin/client/list`).

```js
// Nodeget API 代理端点
// 从环境变量读取 NODEGET_BASE_URL 和 NODEGET_API_TOKEN，代理请求 Nodeget 扩展端点

function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/[ ,\n\t]+/).filter(Boolean);
  return [];
}

function isIPv4(ip) {
  return /^[0-9.]+$/.test(ip) && ip.includes('.');
}

function isIPv6(ip) {
  return /:/.test(ip);
}

function normalizeServers(payload) {
  let list = [];
  if (Array.isArray(payload)) list = payload;
  else if (Array.isArray(payload?.clients)) list = payload.clients;
  else if (Array.isArray(payload?.data)) list = payload.data;

  const servers = [];
  for (const item of list || []) {
    const name = item.name || item.hostname || item.server_name || item.label || item.uuid || 'Unknown';
    const ipsRaw = [
      ...toArray(item.ipv4),
      ...toArray(item.ip_v4),
      ...toArray(item.ipv6),
      ...toArray(item.ip_v6),
    ];
    const ipv4 = [];
    const ipv6 = [];
    for (const ip of ipsRaw) {
      if (isIPv4(ip)) ipv4.push(ip);
      else if (isIPv6(ip)) ipv6.push(ip);
    }
    if (ipv4.length || ipv6.length) {
      servers.push({ name, ipv4: [...new Set(ipv4)], ipv6: [...new Set(ipv6)] });
    }
  }
  return servers;
}

export async function GET(request, env, params, data) {
  const baseUrl = data.nodegetBaseUrl;
  const apiToken = data.nodegetApiToken;

  if (!baseUrl) {
    return new Response(JSON.stringify({ enabled: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    let apiBase = baseUrl.trim().replace(/\/+$/, '');
    const url = `${apiBase}/api/servers`;

    const headers = {};
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      return new Response(JSON.stringify({
        enabled: true,
        error: `Nodeget API request failed: ${res.status}`,
        servers: []
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const payload = await res.json();
    const servers = normalizeServers(payload);

    return new Response(JSON.stringify({ enabled: true, servers }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      enabled: true,
      error: `Nodeget API connection failed: ${e.message}`,
      servers: []
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/routes/nodeget.js
git commit -m "feat: add /api/nodeget/servers proxy route"
```

---

### Task 3: Register nodeget route in worker/index.js

**Files:**
- Modify: `worker/index.js`

- [ ] **Step 1: Import nodeget module**

After the komari import (line 15), add:

```js
import * as nodeget from './routes/nodeget.js';
```

- [ ] **Step 2: Register the route**

After line 43 (`['GET', '/api/komari/servers', komari]`), add:

```js
['GET',    '/api/nodeget/servers',                 nodeget],
```

- [ ] **Step 3: Commit**

```bash
git add worker/index.js
git commit -m "feat: register nodeget API route"
```

---

### Task 4: Add nodeget fetch functions to worker/routes/rotations/run.js

**Files:**
- Modify: `worker/routes/rotations/run.js`

- [ ] **Step 1: Add fetchNodegetServers function**

After `fetchKomariServers` (ends at line 59), add:

```js
async function fetchNodegetServers(env) {
  const baseUrl = env.NODEGET_BASE_URL;
  const apiToken = env.NODEGET_API_TOKEN;
  if (!baseUrl) return [];
  try {
    let apiBase = baseUrl.trim().replace(/\/+$/, '');
    const url = `${apiBase}/api/servers`;
    const headers = {};
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const payload = await res.json();
    return normalizeServers(payload);
  } catch { return []; }
}
```

- [ ] **Step 2: Add getIPsFromNodegetServers function**

After `getIPsFromServers` (ends at line 69), add:

```js
function getIPsFromNodegetServers(servers, rotation) {
  let filtered = servers;
  if (rotation.nodegetServerFilter && rotation.nodegetServerFilter.length > 0) {
    filtered = servers.filter(s => rotation.nodegetServerFilter.includes(s.name));
  }
  return rotation.recordType === 'AAAA'
    ? filtered.flatMap(s => s.ipv6)
    : filtered.flatMap(s => s.ipv4);
}
```

- [ ] **Step 3: Add fetchNodegetIPs function**

After `getIPsFromNodegetServers`, add:

```js
async function fetchNodegetIPs(env, rotation) {
  const baseUrl = env.NODEGET_BASE_URL;
  const apiToken = env.NODEGET_API_TOKEN;
  if (!baseUrl) return [];

  try {
    let apiBase = baseUrl.trim().replace(/\/+$/, '');
    const url = `${apiBase}/api/servers`;

    const headers = {};
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

    const res = await fetch(url, { headers });
    if (!res.ok) return [];

    const payload = await res.json();
    let servers = normalizeServers(payload);

    if (rotation.nodegetServerFilter && rotation.nodegetServerFilter.length > 0) {
      servers = servers.filter(s => rotation.nodegetServerFilter.includes(s.name));
    }

    return rotation.recordType === 'AAAA'
      ? servers.flatMap(s => s.ipv6)
      : servers.flatMap(s => s.ipv4);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Add nodeget pre-fetch to runRotations**

After the komari pre-fetch block (after line 196, `}` closes `if (komariNeeded)` ), add:

```js
  // Fetch Nodeget IPs once before the loop
  let nodegetServers = null;
  const nodegetNeeded = rotations.some(r => r.enabled && r.ipSource === 'nodeget');
  if (nodegetNeeded) {
    try { nodegetServers = await fetchNodegetServers(env); } catch { nodegetServers = []; }
  }
```

- [ ] **Step 5: Add nodeget branch to IP pool selection**

In the IP pool block (around line 206), add `else if` for nodeget after the komari branch:

```js
      let ipPool;
      if (rotation.ipSource === 'komari') {
        ipPool = komariServers
          ? getIPsFromServers(komariServers, rotation)
          : await fetchKomariIPs(env, rotation);
      } else if (rotation.ipSource === 'nodeget') {
        ipPool = nodegetServers
          ? getIPsFromNodegetServers(nodegetServers, rotation)
          : await fetchNodegetIPs(env, rotation);
      } else {
        ipPool = rotation.manualIPs || [];
      }
```

- [ ] **Step 6: Commit**

```bash
git add worker/routes/rotations/run.js
git commit -m "feat: add nodeget IP fetching to rotation engine"
```

---

### Task 5: Accept 'nodeget' ipSource in rotations.js validation

**Files:**
- Modify: `worker/routes/rotations.js`

- [ ] **Step 1: Update ipSource validation**

Line 47, change:

```js
if (!['komari', 'manual'].includes(body.ipSource)) {
```

to:

```js
if (!['komari', 'manual', 'nodeget'].includes(body.ipSource)) {
```

- [ ] **Step 2: Update error message**

Same line, change:

```js
return new Response(JSON.stringify({ success: false, error: 'ipSource must be "komari" or "manual"' }), {
```

to:

```js
return new Response(JSON.stringify({ success: false, error: 'ipSource must be "komari", "manual", or "nodeget"' }), {
```

- [ ] **Step 3: Add nodegetServerFilter to POST config**

In the POST body handler, after the `komariServerFilter` line (line 90), add:

```js
komariServerFilter: body.komariServerFilter || [],
nodegetServerFilter: body.nodegetServerFilter || [],
```

- [ ] **Step 4: Save nodegetServerFilter in config object**

In the config object (around line 98), add after `komariServerFilter`:

```js
nodegetServerFilter: body.nodegetServerFilter || [],
```

- [ ] **Step 5: Handle nodeget ipSource for manualIPs/komariServerFilter**

The existing logic on lines 89-90 already handles this via the `ipSource` check, but we need to add nodeget handling. Change lines 89-90 from:

```js
manualIPs: body.ipSource === 'manual' ? (body.manualIPs || []) : [],
komariServerFilter: body.komariServerFilter || [],
```

to:

```js
manualIPs: body.ipSource === 'manual' ? (body.manualIPs || []) : [],
komariServerFilter: body.ipSource === 'komari' ? (body.komariServerFilter || []) : [],
nodegetServerFilter: body.ipSource === 'nodeget' ? (body.nodegetServerFilter || []) : [],
```

- [ ] **Step 6: For ipSourceChanged detection, also reset index if switching to/from nodeget**

The existing `ipSourceChanged` logic on line 80 handles this generically — no change needed since it compares old and new `ipSource`.

- [ ] **Step 7: Commit**

```bash
git add worker/routes/rotations.js
git commit -m "feat: accept nodeget ipSource in rotation CRUD"
```

---

### Task 6: Create src/hooks/useNodeget.js

**Files:**
- Create: `src/hooks/useNodeget.js`

- [ ] **Step 1: Create the hook file**

Mirror of `useKomari.js`, using `/api/nodeget/servers` and nodeget-specific names:

```js
import { useState, useEffect, useRef, useMemo } from 'react';

const NODEGET_CACHE_TTL = 10 * 60 * 1000;

const useNodeget = (auth) => {
    const [servers, setServers] = useState([]);
    const [nodegetEnabled, setNodegetEnabled] = useState(false);
    const [loading, setLoading] = useState(false);
    const cacheRef = useRef({ ts: 0, servers: [], enabled: false });

    const fetchServers = async () => {
        if (auth?.mode !== 'server') {
            setNodegetEnabled(false);
            return;
        }
        if (Date.now() - cacheRef.current.ts < NODEGET_CACHE_TTL && cacheRef.current.ts > 0) {
            setServers(cacheRef.current.servers);
            setNodegetEnabled(cacheRef.current.enabled);
            return;
        }
        setLoading(true);
        try {
            const headers = {};
            if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
            if (auth.currentAccountIndex !== undefined) {
                headers['X-Managed-Account-Index'] = String(auth.currentAccountIndex);
            }
            const res = await fetch('/api/nodeget/servers', { headers });
            const data = await res.json();
            if (data.enabled) {
                setServers(data.servers || []);
                setNodegetEnabled(true);
                cacheRef.current = { ts: Date.now(), servers: data.servers || [], enabled: true };
            } else {
                setNodegetEnabled(false);
                cacheRef.current = { ts: Date.now(), servers: [], enabled: false };
            }
        } catch {
            setNodegetEnabled(false);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchServers();
    }, [auth?.mode, auth?.token, auth?.currentAccountIndex]);

    const ipToNameMap = useMemo(() => {
        const map = new Map();
        for (const s of servers) {
            for (const ip of s.ipv4) {
                const arr = map.get(ip) || [];
                if (!arr.includes(s.name)) arr.push(s.name);
                map.set(ip, arr);
            }
            for (const ip of s.ipv6) {
                const arr = map.get(ip) || [];
                if (!arr.includes(s.name)) arr.push(s.name);
                map.set(ip, arr);
            }
        }
        return map;
    }, [servers]);

    const getOptions = (type) => {
        return servers.flatMap(s => {
            const list = type === 'AAAA' ? s.ipv6 : s.ipv4;
            return list.map(ip => ({ value: ip, label: `${s.name} — ${ip}` }));
        });
    };

    return { servers, nodegetEnabled, loading, ipToNameMap, getOptions, refresh: fetchServers };
};

export default useNodeget;
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useNodeget.js
git commit -m "feat: add useNodeget hook"
```

---

### Task 7: Add nodeget UI to ZoneDetail.jsx

**Files:**
- Modify: `src/components/ZoneDetail.jsx`

- [ ] **Step 1: Import useNodeget hook**

Line 3, add after the useKomari import:

```js
import useNodeget from '../hooks/useNodeget.js';
```

- [ ] **Step 2: Call useNodeget hook**

Line 37, change from:

```js
const { komariEnabled, ipToNameMap, getOptions: getKomariOptions, servers } = useKomari(auth);
```

to:

```js
const { komariEnabled, ipToNameMap: komariIpToNameMap, getOptions: getKomariOptions, servers: komariServers } = useKomari(auth);
const { nodegetEnabled, ipToNameMap: nodegetIpToNameMap, getOptions: getNodegetOptions, servers: nodegetServers } = useNodeget(auth);
```

- [ ] **Step 3: Rename komari `servers` → `komariServers` in existing UI**

The komari filter checkbox block (original line 1403) uses `servers.map(...)`. With the rename in Step 2, change:

```jsx
{servers.map(s => (
```

to:

```jsx
{komariServers.map(s => (
```

Also change `servers.length === 0` (line 1420) to `komariServers.length === 0`.

- [ ] **Step 4: Add nodeget to defaultRotation**

Line 154 (inside `defaultRotation`), add after `komariServerFilter`:

```js
komariServerFilter: [],
nodegetServerFilter: [],
```

- [ ] **Step 4: Add nodeget to editRotationStart**

Line 247 (inside `editRotationStart`), add after `komariServerFilter`:

```js
nodegetServerFilter: [...(rot.nodegetServerFilter || [])],
```

- [ ] **Step 5: Add nodeget to handleRotationSubmit body**

Line 268 (inside `handleRotationSubmit`), add after the komariServerFilter line:

```js
nodegetServerFilter: newRotation.ipSource === 'nodeget' ? newRotation.nodegetServerFilter : [],
```

- [ ] **Step 6: Add nodeget to IP source dropdown options**

Lines 1392-1395, change the options array from:

```js
options={[
    ...(komariEnabled ? [{ value: 'komari', label: t('rotationSourceKomari') }] : []),
    { value: 'manual', label: t('rotationSourceManual') }
]}
```

to:

```js
options={[
    ...(komariEnabled ? [{ value: 'komari', label: t('rotationSourceKomari') }] : []),
    ...(nodegetEnabled ? [{ value: 'nodeget', label: t('rotationSourceNodeget') }] : []),
    { value: 'manual', label: t('rotationSourceManual') }
]}
```

- [ ] **Step 7: Add nodeget server filter checkboxes**

After the komari filter block (after line 1423, the `)}` that closes `{newRotation.ipSource === 'komari' && (`), add:

```jsx
                            {newRotation.ipSource === 'nodeget' && (
                                <div className="input-row">
                                    <label>{t('nodegetServers')}</label>
                                    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {nodegetServers.map(s => (
                                            <label key={s.name} style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', background: newRotation.nodegetServerFilter.includes(s.name) ? '#fff7ed' : '#f9fafb', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={newRotation.nodegetServerFilter.includes(s.name)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setNewRotation({ ...newRotation, nodegetServerFilter: [...newRotation.nodegetServerFilter, s.name] });
                                                        } else {
                                                            setNewRotation({ ...newRotation, nodegetServerFilter: newRotation.nodegetServerFilter.filter(n => n !== s.name) });
                                                        }
                                                    }}
                                                    style={{ width: '14px', height: '14px' }}
                                                />
                                                {s.name}
                                            </label>
                                        ))}
                                        {nodegetServers.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>...</span>}
                                    </div>
                                </div>
                            )}
```

- [ ] **Step 8: Update DNS record komari tags to also check nodeget**

Line 1012, change:

```jsx
{komariEnabled && ipToNameMap.has(record.content) && (
    <span style={{ marginLeft: '6px', padding: '1px 6px', borderRadius: '10px', background: '#f0f0ff', color: '#6366f1', fontSize: '0.6875rem', border: '1px solid #c7d2fe', whiteSpace: 'nowrap' }}>
        {ipToNameMap.get(record.content).join(', ')}
    </span>
)}
```

to:

```jsx
{((komariEnabled && komariIpToNameMap.has(record.content)) || (nodegetEnabled && nodegetIpToNameMap.has(record.content))) && (
    <span style={{ marginLeft: '6px', padding: '1px 6px', borderRadius: '10px', background: '#f0f0ff', color: '#6366f1', fontSize: '0.6875rem', border: '1px solid #c7d2fe', whiteSpace: 'nowrap' }}>
        {[...(komariIpToNameMap.get(record.content) || []), ...(nodegetIpToNameMap.get(record.content) || [])].join(', ')}
    </span>
)}
```

- [ ] **Step 9: Update DNS record mobile tags (same pattern)**

Lines 1098-1100, apply the same change as Step 8 (the mobile card has identical komari tag logic).

- [ ] **Step 10: Update rotation table ipSource display**

Line 1287, change:

```jsx
{rot.ipSource === 'komari' ? t('rotationSourceKomari') : t('rotationSourceManual')}
```

to:

```jsx
{rot.ipSource === 'komari' ? t('rotationSourceKomari') : rot.ipSource === 'nodeget' ? t('rotationSourceNodeget') : t('rotationSourceManual')}
```

- [ ] **Step 11: Update rotation mobile card ipSource display**

Line 1334, apply the same ternary change as Step 10.

- [ ] **Step 12: Add nodeget quick IP select to DNS record modal**

After the komari quick-select block (line 1545, the `})()}` closing the komari block), add a matching nodeget block:

```jsx

                            {nodegetEnabled && ['A', 'AAAA'].includes(newRecord.type) && (() => {
                                const opts = getNodegetOptions(newRecord.type);
                                return opts.length > 0 ? (
                                    <div className="input-row">
                                        <label>{t('nodegetServer')}</label>
                                        <div style={{ flex: 1 }}>
                                            <CustomSelect
                                                value={newRecord.content}
                                                onChange={(e) => setNewRecord({ ...newRecord, content: e.target.value })}
                                                options={[{ value: '', label: t('nodegetSelectPlaceholder') }, ...opts]}
                                                placeholder={t('nodegetSelectPlaceholder')}
                                            />
                                        </div>
                                    </div>
                                ) : null;
                            })()}
```

- [ ] **Step 13: Commit**

```bash
git add src/components/ZoneDetail.jsx
git commit -m "feat: add nodeget IP source UI"
```

---

### Task 8: Add nodeget i18n strings

**Files:**
- Modify: `src/i18n.js`

- [ ] **Step 1: Add zh translation keys**

After `rotationSourceManual` (line 187), add:

```js
rotationSourceNodeget: 'Nodeget 节点',
nodegetServers: 'Nodeget 节点（留空 = 全部）',
nodegetServer: '选择IP',
nodegetSelectPlaceholder: '选择 Nodeget 节点 IP...',
```

- [ ] **Step 2: Add en translation keys**

After `rotationSourceManual` (line 399), add:

```js
rotationSourceNodeget: 'Nodeget Nodes',
nodegetServers: 'Nodeget nodes (empty = all)',
nodegetServer: 'Select IP',
nodegetSelectPlaceholder: 'Select Nodeget node IP...',
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n.js
git commit -m "feat: add nodeget i18n strings"
```

---

### Verification Checklist

After all tasks are committed:

- [ ] Start dev server: `npm run dev:wrangler`
- [ ] Open the app, login with server mode
- [ ] Navigate to a zone with DNS records
- [ ] Verify `nodeget` appears as an IP source option in the rotation modal (if `NODEGET_BASE_URL` is set)
- [ ] Verify nodeget server filter checkboxes appear when `nodeget` is selected
- [ ] Create a rotation with `ipSource: 'nodeget'`, verify it's saved and displayed in the table
- [ ] Verify the mobile card shows `Nodeget Nodes` as the source
- [ ] Verify DNS record IP tags show for nodeget IPs
- [ ] Verify `GET /api/nodeget/servers` returns `{ enabled: true, servers: [...] }` when env vars are configured
- [ ] Verify `GET /api/nodeget/servers` returns `{ enabled: false }` when env vars are missing
- [ ] Verify nodeget rotation runs via `POST /api/rotations/run` (manual trigger)
