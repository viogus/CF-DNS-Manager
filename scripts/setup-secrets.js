const API = 'https://api.cloudflare.com/client/v4';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const WORKER_NAME = 'cf-dns-manager';

const OPTIONAL_SECRETS = [
  'APP_PASSWORD',
  'CF_API_TOKEN1',
  'CF_API_TOKEN2',
  'DNSPOD_SECRET_ID',
  'DNSPOD_SECRET_KEY',
  'KOMARI_BASE_URL',
  'KOMARI_API_TOKEN',
  'ROTATION_API_KEY',
];

if (!TOKEN || !ACCOUNT_ID) {
  console.log('Skipping secrets: CLOUDFLARE_API_TOKEN or CF_ACCOUNT_ID not set.');
  process.exit(0);
}

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function setSecret(name, value) {
  const url = `${API}/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets`;
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name, text: value, type: 'secret_text' })
  });
  const data = await res.json();
  if (!data.success) {
    console.error(`Failed to set ${name}:`, JSON.stringify(data.errors));
    return false;
  }
  return true;
}

async function main() {
  for (const name of OPTIONAL_SECRETS) {
    const val = process.env[name];
    if (val) {
      console.log(`Setting secret: ${name}`);
      await setSecret(name, val);
    } else {
      console.log(`Skipping optional secret: ${name} (not set)`);
    }
  }
  console.log('Secrets setup complete.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
