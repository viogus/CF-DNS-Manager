export async function GET(request, env, params, data) {
  const { cfToken } = data;

  const response = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=50', {
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    }
  });

  const result = await response.json();
  return new Response(JSON.stringify(result), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
