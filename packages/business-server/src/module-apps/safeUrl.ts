import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';

import { Agent, buildConnector, type Dispatcher } from 'undici';

export type ModuleAppUrlResolver = (
  hostname: string,
) => Promise<readonly string[]> | readonly string[];

export interface ModuleAppUrlSafetyOptions {
  resolveHostname?: ModuleAppUrlResolver;
}

export interface ResolvedModuleAppApiUrl {
  addresses: readonly string[];
  hostname: string;
  url: string;
}

export type ModuleAppDispatcherFactory = (
  resolved: Pick<ResolvedModuleAppApiUrl, 'addresses' | 'hostname'>,
) => Dispatcher;

const unsafeUrlError = () => new Error('MODULE_APP_UNSAFE_API_URL');

const privateIpv4Patterns = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
];

export function isSafeModuleAppApiUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (host === 'localhost' || host.endsWith('.localhost')) return false;
    if (host === '0.0.0.0') return false;
    if (privateIpv4Patterns.some((pattern) => pattern.test(host))) return false;

    return true;
  } catch {
    return false;
  }
}

const resolveHostnameWithSystemDns: ModuleAppUrlResolver = async (hostname) => {
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });

    return addresses.map(({ address }) => address);
  } catch {
    throw unsafeUrlError();
  }
};

const stripIpv6Brackets = (hostname: string) =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

const parseIpv4Octets = (address: string) => {
  const octets = address.split('.').map((value) => Number(value));

  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return null;
  }

  return octets;
};

const isUnsafeIpv4 = (address: string) => {
  const octets = parseIpv4Octets(address);

  if (!octets) return false;

  const [a, b] = octets;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;

  return a >= 224;
};

const parseIpv6Address = (address: string) => {
  const normalizedAddress = address.toLowerCase();
  const ipv4TailMatch = normalizedAddress.match(/(\d+\.\d+\.\d+\.\d+)$/);
  let expandedAddress = normalizedAddress;

  if (ipv4TailMatch) {
    const octets = parseIpv4Octets(ipv4TailMatch[1]);
    if (!octets) return null;

    const [a, b, c, d] = octets;
    expandedAddress = `${normalizedAddress.slice(0, ipv4TailMatch.index)}${((a << 8) | b).toString(
      16,
    )}:${((c << 8) | d).toString(16)}`;
  }

  const parts = expandedAddress.split('::');

  if (parts.length > 2) return null;

  const leftParts = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const rightParts = parts[1] ? parts[1].split(':').filter(Boolean) : [];
  const hextetCount = leftParts.length + rightParts.length;

  if (parts.length === 1 && hextetCount !== 8) return null;
  if (parts.length === 2 && hextetCount >= 8) return null;

  const hextets = [
    ...leftParts,
    ...Array.from({ length: 8 - hextetCount }, () => '0'),
    ...rightParts,
  ];

  if (hextets.length !== 8) return null;

  let value = 0n;

  for (const hextet of hextets) {
    if (!/^[\da-f]{1,4}$/.test(hextet)) return null;

    value = (value << 16n) + BigInt(Number.parseInt(hextet, 16));
  }

  return value;
};

const isUnsafeIpv6 = (address: string) => {
  const normalizedAddress = stripIpv6Brackets(address.toLowerCase());

  if (normalizedAddress === '::' || normalizedAddress === '::1') return true;
  if (normalizedAddress.includes('::ffff:')) return true;

  const value = parseIpv6Address(normalizedAddress);

  if (value === null) return false;

  const unsafeRanges = [
    [0n, 1n],
    [0xfc00_0000_0000_0000_0000_0000_0000_0000n, 0xfdff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn],
    [0xfe80_0000_0000_0000_0000_0000_0000_0000n, 0xfebf_ffff_ffff_ffff_ffff_ffff_ffff_ffffn],
    [0xff00_0000_0000_0000_0000_0000_0000_0000n, 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn],
  ] as const;

  return unsafeRanges.some(([start, end]) => value >= start && value <= end);
};

const isUnsafeIpAddress = (address: string) => {
  const normalizedAddress = stripIpv6Brackets(address.toLowerCase());
  const ipVersion = isIP(normalizedAddress);

  if (ipVersion === 4) return isUnsafeIpv4(normalizedAddress);
  if (ipVersion === 6) return isUnsafeIpv6(normalizedAddress);

  return true;
};

const assertSafeHostname = (hostname: string) => {
  const normalizedHostname = hostname.toLowerCase();
  const hostWithoutBrackets = stripIpv6Brackets(normalizedHostname);

  if (!normalizedHostname) throw unsafeUrlError();
  if (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.localhost')) {
    throw unsafeUrlError();
  }

  const ipVersion = isIP(hostWithoutBrackets);
  if (ipVersion && isUnsafeIpAddress(hostWithoutBrackets)) {
    throw unsafeUrlError();
  }
};

export const resolveSafeModuleAppApiUrl = async (
  value: string,
  options: ModuleAppUrlSafetyOptions = {},
): Promise<ResolvedModuleAppApiUrl> => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw unsafeUrlError();
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw unsafeUrlError();
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw unsafeUrlError();
  }

  assertSafeHostname(parsedUrl.hostname);

  const hostWithoutBrackets = stripIpv6Brackets(parsedUrl.hostname);
  const resolvedAddresses = isIP(hostWithoutBrackets)
    ? [hostWithoutBrackets]
    : await Promise.resolve(
        (options.resolveHostname ?? resolveHostnameWithSystemDns)(parsedUrl.hostname),
      );

  if (resolvedAddresses.length === 0) {
    throw unsafeUrlError();
  }

  for (const address of resolvedAddresses) {
    if (isUnsafeIpAddress(address)) {
      throw unsafeUrlError();
    }
  }

  return {
    addresses: [...new Set(resolvedAddresses.map(stripIpv6Brackets))],
    hostname: hostWithoutBrackets.toLowerCase(),
    url: parsedUrl.toString(),
  };
};

export const assertSafeModuleAppApiUrl = async (
  value: string,
  options: ModuleAppUrlSafetyOptions = {},
): Promise<string> => (await resolveSafeModuleAppApiUrl(value, options)).url;

export const createModuleAppPinnedLookup = (
  resolved: Pick<ResolvedModuleAppApiUrl, 'addresses' | 'hostname'>,
): LookupFunction => {
  const expectedHostname = resolved.hostname.toLowerCase().replace(/\.$/, '');
  const records = resolved.addresses.map((address) => ({
    address,
    family: isIP(address) as 4 | 6,
  }));

  return (hostname, options, callback) => {
    const requestedHostname = hostname.toLowerCase().replace(/\.$/, '');
    const requestedFamily =
      options.family === 4 || options.family === 'IPv4'
        ? 4
        : options.family === 6 || options.family === 'IPv6'
          ? 6
          : 0;
    const candidates = requestedFamily
      ? records.filter((record) => record.family === requestedFamily)
      : records;

    if (requestedHostname !== expectedHostname || candidates.length === 0) {
      const error = new Error('MODULE_APP_UNSAFE_API_URL') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      callback(error, []);
      return;
    }

    if (options.all) {
      callback(null, candidates);
      return;
    }

    callback(null, candidates[0].address, candidates[0].family);
  };
};

export const createModuleAppPinnedDispatcher: ModuleAppDispatcherFactory = (resolved) =>
  new Agent({
    connect: buildConnector({ lookup: createModuleAppPinnedLookup(resolved) }),
  });
