export async function POST(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;
  const body = await request.json();

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/batch`, {
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
