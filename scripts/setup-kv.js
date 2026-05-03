import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const API = 'https://api.cloudflare.com/client/v4';
const TOKEN = process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const KV_NAME = 'DNS_ROTATIONS';
const WRANGLER_PATH = join(process.cwd(), 'wrangler.toml');

if (!TOKEN || !ACCOUNT_ID) {
  console.log('Skipping KV setup: CF_API_TOKEN and CF_ACCOUNT_ID not set.');
  console.log('Set GitHub Secrets to enable auto-deploy. See README for instructions.');
  process.exit(0);
}

const apiHeaders = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function findOrCreateKV() {
  console.log(`Finding KV namespace "${KV_NAME}"...`);

  // Paginate through namespaces (rarely needed but correct)
  let page = 1;
  while (true) {
    const listRes = await fetch(
      `${API}/accounts/${ACCOUNT_ID}/storage/kv/namespaces?per_page=50&page=${page}`,
      { headers: apiHeaders }
    );
    const listData = await listRes.json();

    if (!listData.success) {
      console.error('Failed to list KV namespaces:', JSON.stringify(listData.errors));
      process.exit(1);
    }

    const existing = listData.result.find(ns => ns.title === KV_NAME);
    if (existing) {
      console.log(`Found existing: ${existing.id}`);
      return existing.id;
    }

    if (listData.result.length < 50) break;
    page++;
  }

  // Create new
  console.log(`Creating new namespace "${KV_NAME}"...`);
  const createRes = await fetch(
    `${API}/accounts/${ACCOUNT_ID}/storage/kv/namespaces`,
    {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({ title: KV_NAME })
    }
  );
  const createData = await createRes.json();

  if (!createData.success) {
    console.error('Failed to create KV namespace:', JSON.stringify(createData.errors));
    process.exit(1);
  }

  console.log(`Created: ${createData.result.id}`);
  return createData.result.id;
}

function updateWranglerToml(kvId) {
  let content = readFileSync(WRANGLER_PATH, 'utf8');
  // Normalize CRLF to LF for consistent matching
  content = content.replace(/\r\n/g, '\n');
  const original = content;

  // Check if KV section is commented out
  if (content.includes('# [[kv_namespaces]]')) {
    content = content.replace(
      '# [[kv_namespaces]]\n# binding = "DNS_ROTATIONS"\n# id = "PLACEHOLDER_KV_ID"',
      `[[kv_namespaces]]\nbinding = "DNS_ROTATIONS"\nid = "${kvId}"`
    );
  } else {
    content = content.replace(/^id\s*=\s*"PLACEHOLDER_KV_ID"/m, `id = "${kvId}"`);
  }

  if (content === original) {
    console.warn('Warning: wrangler.toml KV section was not modified. Check the file format.');
  }

  if (process.env.CI) {
    writeFileSync(WRANGLER_PATH, content);
  }
  console.log('KV namespace ID:', kvId);
}

async function main() {
  const kvId = await findOrCreateKV();
  updateWranglerToml(kvId);
  console.log('KV setup complete.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
