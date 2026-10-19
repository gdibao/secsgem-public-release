export type DesktopUpdateServerUrlReason =
  'credentials-not-allowed' | 'https-required' | 'invalid-url' | 'unsafe-url';

export type DesktopUpdateServerUrlResult =
  { reason: DesktopUpdateServerUrlReason } | { url: string };

const isUnsafeIpv4Address = (value: string) => {
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;

  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
};

const getIpv6Groups = (value: string) => {
  const halves = value.split('::');
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;

  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((group) =>
    Number.parseInt(group || '0', 16),
  );

  return groups.length === 8 && groups.every(Number.isFinite) ? groups : null;
};

const isUnsafeLiteralHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '0.0.0.0' ||
    normalized === '::' ||
    normalized === '::1'
  ) {
    return true;
  }

  if (isUnsafeIpv4Address(normalized)) return true;

  if (!normalized.includes(':')) return false;
  if (/^(?:fc|fd|fe[89ab])/.test(normalized)) return true;

  const groups = getIpv6Groups(normalized);
  if (!groups) return false;
  const isIpv4MappedOrCompatible =
    groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0 || groups[5] === 0xffff);
  if (!isIpv4MappedOrCompatible) return false;

  return isUnsafeIpv4Address(
    `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`,
  );
};

export const normalizeDesktopUpdateServerUrl = (value: unknown): DesktopUpdateServerUrlResult => {
  const rawValue = typeof value === 'string' ? value.trim() : '';
  if (!rawValue) return { url: '' };

  try {
    const parsed = new URL(rawValue);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return { reason: 'credentials-not-allowed' };
    }
    if (isUnsafeLiteralHostname(parsed.hostname)) return { reason: 'unsafe-url' };
    if (parsed.protocol !== 'https:') return { reason: 'https-required' };

    return { url: parsed.toString().replace(/\/+$/, '') };
  } catch {
    return { reason: 'invalid-url' };
  }
};

export const normalizeDesktopDownloadUrl = (value: unknown): DesktopUpdateServerUrlResult => {
  const rawValue = typeof value === 'string' ? value.trim() : '';
  if (!rawValue) return { url: '' };

  try {
    const parsed = new URL(rawValue);
    if (parsed.username || parsed.password) return { reason: 'credentials-not-allowed' };
    if (isUnsafeLiteralHostname(parsed.hostname)) return { reason: 'unsafe-url' };
    if (parsed.protocol !== 'https:') return { reason: 'https-required' };

    return { url: parsed.toString() };
  } catch {
    return { reason: 'invalid-url' };
  }
};
