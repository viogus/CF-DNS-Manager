import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const API = 'https://api.cloudflare.com/client/v4';
const TOKEN = process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const KV_NAME = 'DNS_ROTATIONS';
const WRANGLER_PATH = join(process.cwd(), 'wrangler.toml');

if (!TOKEN || !ACCOUNT_ID) {
  console.error('CF_API_TOKEN and CF_ACCOUNT_ID env vars required');
  process.exit(1);
}

const apiHeaders = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function findOrCreateKV() {
  // List existing namespaces
  console.log(`Finding KV namespace "${KV_NAME}"...`);
  const listRes = await fetch(
    `${API}/accounts/${ACCOUNT_ID}/storage/kv/namespaces?per_page=100`,
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

async function updateWranglerToml(kvId) {
  let content = readFileSync(WRANGLER_PATH, 'utf8');
  content = content.replace('PLACEHOLDER_KV_ID', kvId);
  writeFileSync(WRANGLER_PATH, content);
  console.log('Updated wrangler.toml with KV namespace ID');
}

async function main() {
  const kvId = await findOrCreateKV();
  await updateWranglerToml(kvId);
  console.log('KV setup complete.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
