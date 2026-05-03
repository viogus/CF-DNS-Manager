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

  // Static assets: Worker Assets serves dist/ + SPA fallback to index.html
  return env.ASSETS.fetch(request);
}

async function handleScheduled(event, env, ctx) {
  const { runRotations } = await import('./routes/rotations/run.js');
  ctx.waitUntil(runRotations(env));
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};
