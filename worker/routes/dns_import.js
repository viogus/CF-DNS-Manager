export async function POST(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;

  // Proxy the multipart form data request — forward Content-Type so Cloudflare can parse the file
  const contentType = request.headers.get('Content-Type');
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/import`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      ...(contentType ? { 'Content-Type': contentType } : {})
    },
    body: request.body
  });

  const responseData = await response.json();
  return new Response(JSON.stringify(responseData), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
