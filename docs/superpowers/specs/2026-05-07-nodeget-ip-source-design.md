# Nodeget IP Source Integration

## Goal

Add nodeget.com as a third IP source for DNS rotation, alongside the existing `komari` and `manual` sources. The nodeget API uses JSON-RPC and does not expose agent IPs directly, so a nodeget extension bridges the gap.

## Architecture

Two independent pieces:

1. **Nodeget extension** — deployed to the nodeget server, exposes a REST endpoint that returns agent IPs
2. **CF-DNS-Manager integration** — worker routes and frontend changes to consume the extension endpoint

```
Nodeget Server (JSON-RPC)
       ↑
       │ internal calls (list_all_agent_uuid, task query, etc.)
       │
Nodeget Extension (worker.js)
  GET /api/servers → [{name, ipv4[], ipv6[]}]
       ↑
       │ HTTP + Bearer token
       │
CF-DNS-Manager Worker
  fetchNodegetServers(env) → normalizeServers() → IP pool
       ↓
Cloudflare API PATCH dns_records
```

## Nodeget Extension

### Structure

```
app.json           # extension metadata
worker.js          # HTTP handler, queries nodeget JSON-RPC internally
resources/
  index.html       # minimal status page
```

### `worker.js` behavior

- Listens on `GET /api/servers`
- Validates the request's `Authorization: Bearer <token>` header
- Internally calls nodeget's JSON-RPC `nodeget-server_list_all_agent_uuid` to enumerate agents
- For each agent, finds the last known IP from nodeget's internal data (task table, connection metadata, or monitoring summaries)
- Returns JSON matching Komari's `normalizeServers` output:

```json
[
  { "name": "agent-name", "ipv4": ["1.2.3.4"], "ipv6": ["::1"] }
]
```

### Auth

Uses nodeget's fine-grained token model. The extension receives the token from CF-DNS-Manager's request and verifies permissions. Token format: `token_key:token_secret`.

### Deployment

Uploaded to the nodeget server via its extension management UI. Gets a URL:
`https://<nodeget-host>/worker-route/static-worker-route/{extension_uuid}/`

## CF-DNS-Manager Integration

### Environment Variables

| Variable | Purpose |
|---|---|
| `NODEGET_BASE_URL` | Extension base URL (e.g., `https://nodeget.example.com/worker-route/static-worker-route/{uuid}`) |
| `NODEGET_API_TOKEN` | Fine-grained token for authenticating to the extension |

### Worker Changes

**`worker/auth.js`** — Inject `nodegetBaseUrl` and `nodegetApiToken` into request `data` object (same pattern as komari vars on lines 27-29 and 60-61).

**`worker/routes/nodeget.js`** (new) — `GET /api/nodeget/servers` endpoint:
- Reads `nodegetBaseUrl` and `nodegetApiToken` from `data`
- Returns `{ enabled: false }` if either is unset
- Fetches `{baseUrl}/api/servers` with `Authorization: Bearer {token}`
- Normalizes response with `normalizeServers()` (same function, already handles multiple shapes)
- Returns `{ enabled: true, servers: [...] }`

**`worker/routes/rotations/run.js`** — New functions mirroring komari:
- `fetchNodegetServers(env)` — calls extension endpoint, returns normalized servers
- `fetchNodegetIPs(env, rotation)` — fetches and filters servers by `nodegetServerFilter`
- `getIPsFromNodegetServers(servers, rotation)` — filters servers, extracts IPv4/IPv6 by recordType

In `runRotations()`:
- Pre-fetch block: if any rotation uses `ipSource === 'nodeget'`, fetch nodeget servers once
- IP pool branch: `nodeget` case added alongside `komari` and `manual`
- Default timezone: `rotation.timezone || 'Asia/Shanghai'` (existing, no change)

**`worker/index.js`** — Register new route:
- `router.get('/api/nodeget/servers', ...)` with JWT auth handler

### Rotation Config Shape

New fields on rotation objects stored in KV:
```json
{
  "ipSource": "komari|manual|nodeget",
  "nodegetServerFilter": ["agent-1", "agent-2"]
}
```

`ipSource === 'nodeget'` is the new valid value. `nodegetServerFilter` works identically to `komariServerFilter`: empty array = all servers, otherwise only matching names.

### Frontend Changes

**`src/hooks/useNodeget.js`** (new) — Mirror of `useKomari.js`:
- Fetches `/api/nodeget/servers` with auth headers
- 10-minute cache
- Only active in server mode
- Builds `ipToNameMap` for DNS record tagging
- Provides `getOptions(type)` for IP dropdown

**`src/components/ZoneDetail.jsx`**:
- IP source dropdown: add `nodeget` option (only when `nodegetEnabled`)
- Nodeget server filter checkboxes: same flex-wrap UI as komari, bound to `nodegetServerFilter`
- Rotation table: `ipSource` column already renders the source value, no change needed
- DNS record komari tags: extend to nodeget IPs (if `ipToNameMap` has a match, show name tag)
- Add `nodegetEnabled` state and `useNodeget` hook usage

**`src/i18n.js`** — Add translation keys for nodeget-related UI strings.

### Error Handling

| Scenario | Behavior |
|---|---|
| Env vars not configured | `/api/nodeget/servers` returns `{enabled:false}`, frontend hides nodeget option |
| Extension unreachable | `fetchNodegetServers` catches → returns `[]`, rotation skips with "No IPs available" |
| Extension returns non-2xx | Logged, returns `[]`, rotation skips |
| Empty IP pool (no matching agents) | Rotation skips |
| Invalid token | Extension returns 401, worker catches, returns `[]` |

### Testing

Manual verification checklist:
- [ ] Nodeget extension deployed and returning JSON at `/api/servers`
- [ ] `GET /api/nodeget/servers` returns expected data
- [ ] Nodeget option appears in rotation modal when env vars are set
- [ ] Server filter checkboxes populate with nodeget agent names
- [ ] Rotation with `ipSource: 'nodeget'` runs and patches DNS records
- [ ] Rotation with nodeget server filter only uses selected agent IPs
- [ ] Rotation skips gracefully when extension is unreachable
- [ ] AAAA rotation uses IPv6 addresses from nodeget agents
- [ ] Mobile card shows nodeget rotation info correctly

### Scope Notes

- The nodeget extension's internal IP retrieval (JSON-RPC calls) is part of the extension's `worker.js`, not CF-DNS-Manager
- The existing `normalizeServers()` in `run.js` is reused without modification
- The `'UTC'` → `'Asia/Shanghai'` display fix for pre-existing rotation records is not included — tracked separately from the earlier code review
