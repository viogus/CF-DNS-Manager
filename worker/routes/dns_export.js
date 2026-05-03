export async function GET(request, env, params, data) {
  const { cfToken } = data;
  const { zoneId } = params;

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/export`, {
    headers: { 'Authorization': `Bearer ${cfToken}` }
  });

  if (!response.ok) {
    return new Response(await response.text(), { status: response.status });
  }

  const responseData = await response.text();
  return new Response(responseData, {
    headers: {
      'Content-Type': 'text/plain',
      'Content-Disposition': `attachment; filename="dns_records_${zoneId}.txt"`
    }
  });
}
