const SENSITIVE_FILE_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.yarnrc',
  '.yarnrc.yml',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ed25519',
  'id_rsa',
  'service-account.json',
]);

const SENSITIVE_EXTENSIONS = new Set(['jks', 'key', 'keystore', 'p12', 'pem', 'pfx']);
const SENSITIVE_DIRECTORIES = new Set(['.aws', '.azure', '.kube', 'gcloud']);
const MAX_SECRET_SCAN_BYTES = 1024 * 1024;

const SECRET_PATTERNS = [
  /-----BEGIN (?:DSA |EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[\w-]{35}\b/,
  /\bgh[pousr]_[0-9A-Za-z]{36,255}\b/,
  /\bnpm_[0-9A-Za-z]{36}\b/,
  /\bsk_live_[0-9A-Za-z]{16,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
] as const;

export const isSensitiveModuleAppPath = (value: string) => {
  const normalized = value.replaceAll('\\', '/').toLowerCase();
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts.at(-1) ?? '';
  const extension = fileName.includes('.') ? (fileName.split('.').at(-1) ?? '') : '';

  if (fileName === '.env' || fileName.startsWith('.env.')) return true;
  if (SENSITIVE_FILE_NAMES.has(fileName) || SENSITIVE_EXTENSIONS.has(extension)) return true;
  if (fileName.startsWith('id_rsa.') || fileName.startsWith('id_ed25519.')) return true;
  if (fileName.startsWith('service-account') && fileName.endsWith('.json')) return true;

  return parts.some((part) => SENSITIVE_DIRECTORIES.has(part));
};

export const containsModuleAppSecret = (data: Uint8Array) => {
  if (data.byteLength === 0) return false;

  const text = new TextDecoder('utf-8', { fatal: false }).decode(
    data.subarray(0, MAX_SECRET_SCAN_BYTES),
  );
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
};
