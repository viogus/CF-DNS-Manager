import { execSync } from 'child_process';

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

for (const name of OPTIONAL_SECRETS) {
  const val = process.env[name];
  if (val) {
    console.log(`Setting secret: ${name}`);
    execSync(`echo "${val}" | npx wrangler secret put "${name}"`, {
      stdio: 'inherit',
      env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN }
    });
  } else {
    console.log(`Skipping optional secret: ${name} (not set)`);
  }
}

console.log('Secrets setup complete.');
