/**
 * Shared TC3-HMAC-SHA256 signing for DNSPod (Tencent Cloud) API calls.
 * Used by dnspod.js and auto_verify.js.
 */

export const DNSPOD_HOST = 'dnspod.tencentcloudapi.com';
export const DNSPOD_SERVICE = 'dnspod';
export const DNSPOD_VERSION = '2021-03-23';

async function hmacSha256(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

async function sha256Hex(message) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function signRequest(secretId, secretKey, action, payload, timestamp) {
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];
  const payloadStr = JSON.stringify(payload);

  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const signedHeaders = 'content-type;host';
  const hashedPayload = await sha256Hex(payloadStr);
  const canonicalHeaders = `content-type:application/json\nhost:${DNSPOD_HOST}\n`;

  const canonicalRequest = [
    httpRequestMethod, canonicalUri, canonicalQueryString,
    canonicalHeaders, signedHeaders, hashedPayload
  ].join('\n');

  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${DNSPOD_SERVICE}/tc3_request`;
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const stringToSign = [algorithm, timestamp.toString(), credentialScope, hashedCanonicalRequest].join('\n');

  const secretDate = await hmacSha256(`TC3${secretKey}`, date);
  const secretService = await hmacSha256(secretDate, DNSPOD_SERVICE);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = bytesToHex(await hmacSha256(secretSigning, stringToSign));

  return {
    'Authorization': `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': 'application/json',
    'Host': DNSPOD_HOST,
    'X-TC-Action': action,
    'X-TC-Timestamp': timestamp.toString(),
    'X-TC-Version': DNSPOD_VERSION
  };
}

export async function callDnspodApi(secretId, secretKey, action, payload = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = await signRequest(secretId, secretKey, action, payload, timestamp);
  const response = await fetch(`https://${DNSPOD_HOST}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  return response.json();
}
