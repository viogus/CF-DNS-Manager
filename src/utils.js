export function getAuthHeaders(auth, withType = false) {
    if (!auth) return {};
    const headers = {};
    if (auth.mode === 'client') {
        headers['X-Cloudflare-Token'] = auth.token;
    } else if (auth.mode === 'server') {
        headers['Authorization'] = `Bearer ${auth.token}`;
        if (auth.currentAccountIndex !== undefined) {
            headers['X-Managed-Account-Index'] = String(auth.currentAccountIndex);
        }
    }
    if (withType) headers['Content-Type'] = 'application/json';
    return headers;
}
