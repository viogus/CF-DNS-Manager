import { getRotation, putRotation, deleteRotation, listRotationsForZone } from '../../rotations/_kv';

export async function onRequestGet(context) {
  const { env, params } = context;
  const { zoneId } = params;

  const rotations = await listRotationsForZone(env, zoneId);

  return new Response(JSON.stringify({ success: true, result: rotations }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const { zoneId } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!body.recordId || !body.recordType) {
    return new Response(JSON.stringify({ success: false, error: 'Missing required fields: recordId, recordType' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!['A', 'AAAA'].includes(body.recordType)) {
    return new Response(JSON.stringify({ success: false, error: 'Only A and AAAA records are supported' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!['komari', 'manual'].includes(body.ipSource)) {
    return new Response(JSON.stringify({ success: false, error: 'ipSource must be "komari" or "manual"' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (body.ipSource === 'manual' && (!body.manualIPs || body.manualIPs.length === 0)) {
    return new Response(JSON.stringify({ success: false, error: 'manualIPs required for manual ipSource' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (body.ipSource === 'manual' && body.manualIPs) {
    const validIP = (ip) => /^[0-9.]+$/.test(ip) && ip.includes('.') || /:/.test(ip);
    const invalid = body.manualIPs.find(ip => !validIP(ip));
    if (invalid) {
      return new Response(JSON.stringify({ success: false, error: `Invalid IP address: ${invalid}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  const interval = parseInt(body.interval) || 86400;
  if (interval < 300) {
    return new Response(JSON.stringify({ success: false, error: 'interval must be >= 300 seconds' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const existing = await getRotation(env, zoneId, body.recordId);
  const ipSourceChanged = existing && existing.ipSource !== body.ipSource;

  const config = {
    zoneId,
    zoneName: body.zoneName || '',
    recordId: body.recordId,
    recordName: body.recordName || '',
    recordType: body.recordType,
    ipSource: body.ipSource,
    manualIPs: body.ipSource === 'manual' ? (body.manualIPs || []) : [],
    komariServerFilter: body.komariServerFilter || [],
    interval,
    enabled: body.enabled !== false,
    currentIndex: (existing && !ipSourceChanged) ? existing.currentIndex : 0,
    lastRotatedAt: (existing && !ipSourceChanged) ? existing.lastRotatedAt : null,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await putRotation(env, config);

  return new Response(JSON.stringify({ success: true, result: config }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const { zoneId } = params;
  const url = new URL(request.url);
  const recordId = url.searchParams.get('id');

  if (!recordId) {
    return new Response(JSON.stringify({ success: false, error: 'Missing id parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const existing = await getRotation(env, zoneId, recordId);
  if (!existing) {
    return new Response(JSON.stringify({ success: false, error: 'Rotation not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = await request.json();

  if (body.enabled !== undefined) existing.enabled = !!body.enabled;
  if (body.interval !== undefined) {
    const interval = parseInt(body.interval);
    if (interval < 300) {
      return new Response(JSON.stringify({ success: false, error: 'interval must be >= 300 seconds' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    existing.interval = interval;
  }
  existing.updatedAt = new Date().toISOString();

  await putRotation(env, existing);

  return new Response(JSON.stringify({ success: true, result: existing }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { zoneId } = params;
  const url = new URL(context.request.url);
  const recordId = url.searchParams.get('id');

  if (!recordId) {
    return new Response(JSON.stringify({ success: false, error: 'Missing id parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  await deleteRotation(env, zoneId, recordId);

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
