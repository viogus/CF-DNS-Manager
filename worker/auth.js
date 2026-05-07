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
    data.cfToken = env.CF_API_DNS_TOKEN || env.CF_API_TOKEN;
    data.komariBaseUrl = env.KOMARI_BASE_URL;
    data.komariApiToken = env.KOMARI_API_TOKEN;
    data.nodegetBaseUrl = env.NODEGET_BASE_URL;
    data.nodegetApiToken = env.NODEGET_API_TOKEN;
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
      let serverToken;
      if (accountIndex > 0) {
        serverToken = env[`CF_API_TOKEN${accountIndex}`];
      } else {
        serverToken = env.CF_API_DNS_TOKEN || env.CF_API_TOKEN;
      }

      if (!serverToken) {
        return { error: { status: 403, body: { error: 'Selected managed account is not configured.' } } };
      }

      data.cfToken = serverToken;
      data.dnspodSecretId = env.DNSPOD_SECRET_ID;
      data.dnspodSecretKey = env.DNSPOD_SECRET_KEY;
      data.komariBaseUrl = env.KOMARI_BASE_URL;
      data.komariApiToken = env.KOMARI_API_TOKEN;
      data.nodegetBaseUrl = env.NODEGET_BASE_URL;
      data.nodegetApiToken = env.NODEGET_API_TOKEN;
      return { data };
    } catch (e) {
      return { error: { status: 401, body: { error: 'Invalid or expired session.', message: e.message } } };
    }
  }

  return { error: { status: 401, body: { error: 'Authentication Required', message: 'Please provide X-Cloudflare-Token, X-Rotation-Key, or Authorization header.' } } };
}
