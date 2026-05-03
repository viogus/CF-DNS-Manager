export async function onRequestPost(context) {
    const { cfToken } = context.data;
    const { zoneId } = context.params;

    // Proxy the multipart form data request — forward Content-Type so Cloudflare can parse the file
    const contentType = context.request.headers.get('Content-Type');
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/import`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${cfToken}`,
            ...(contentType ? { 'Content-Type': contentType } : {})
        },
        body: context.request.body
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
    });
}
