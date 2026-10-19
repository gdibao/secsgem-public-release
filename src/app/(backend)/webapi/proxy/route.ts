import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';

// SECURITY: P0 fix 2026-04-27 - was open proxy, now whitelist + auth
// Only allow fetching the NewAPI pricing endpoint (and compatible provider equivalents).
// Any other target URL is rejected with 403.
const PRICING_PATH_PATTERN = /^https:\/\/[^/]+\/api\/pricing$/;

function isAllowedProxyUrl(targetUrl: string): boolean {
  // Allow the configured NewAPI base URL + /api/pricing
  const newApiBase = process.env.NEWAPI_PROXY_URL;
  if (newApiBase) {
    const newApiPricingUrl = newApiBase.replace(/\/$/, '') + '/api/pricing';
    if (targetUrl === newApiPricingUrl) return true;
  }

  // Allow any HTTPS host serving /api/pricing (compatible providers)
  return PRICING_PATH_PATTERN.test(targetUrl);
}

/**
 * just for a proxy
 */
const handler = async (req: Request) => {
  const targetUrl = await req.text();

  if (!isAllowedProxyUrl(targetUrl)) {
    return NextResponse.json(
      { error: 'Target URL is not in the allowed whitelist' },
      { status: 403 },
    );
  }

  try {
    const res = await ssrfSafeFetch(targetUrl);

    // Clone headers and remove Content-Encoding because fetch() automatically
    // decompresses the response body, so we should not forward this header
    const headers = new Headers(res.headers);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length'); // Length changes after decompression

    return new Response(await res.arrayBuffer(), { headers });
  } catch (err) {
    console.error(err); // DNS lookup 127.0.0.1(family:4, host:127.0.0.1.nip.io) is not allowed. Because, It is private IP address.
    return NextResponse.json({ error: 'Not support internal host proxy' }, { status: 400 });
  }
};

export const POST = checkAuth(handler);
