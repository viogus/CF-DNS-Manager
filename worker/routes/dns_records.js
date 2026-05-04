export async function GET(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=50000`, {
    headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' }
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
    headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
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
    headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
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
    headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' }
  });
  const responseData = await response.json();
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
