import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Run only on the new .125 deployment directory. Refuses to replace existing secrets.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...privateKey.export({ format: 'jwk' }), alg: 'RS256', use: 'sig', kid: randomBytes(8).toString('hex') };
const values = {
  POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
  REDIS_PASSWORD: randomBytes(32).toString('hex'),
  AUTH_SECRET: randomBytes(32).toString('hex'),
  KEY_VAULTS_SECRET: randomBytes(32).toString('base64'),
  JWKS_KEY: `'${JSON.stringify({ keys: [jwk] })}'`,
  S3_ACCESS_KEY_ID: randomBytes(16).toString('hex'),
  S3_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
};
const template = readFileSync('.env.example', 'utf8');
const content = template.split('\n').map(line => {
  const key = line.slice(0, line.indexOf('='));
  return Object.hasOwn(values, key) ? `${key}=${values[key]}` : line;
}).join('\n');
writeFileSync('.env', content, { mode: 0o600, flag: 'wx' });
console.log('Created .env with unique secrets and locked email/password auth; no secrets printed.');
