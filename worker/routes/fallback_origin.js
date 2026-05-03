export async function GET(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/fallback_origin`, {
    headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' }
  });
  const responseData = await response.json();
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function PUT(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;
  const body = await request.json();
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/fallback_origin`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const responseData = await response.json();
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
