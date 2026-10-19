import { describe, expect, it } from 'vitest';

import { extractClientIp } from './clientIp';

describe('extractClientIp', () => {
  it('prefers the first forwarded address and trims it', () => {
    const headers = new Headers({
      'x-forwarded-for': ' 203.0.113.9, 10.0.0.2 ',
      'x-real-ip': '198.51.100.7',
    });

    expect(extractClientIp(headers)).toBe('203.0.113.9');
  });

  it('falls back to the real IP header', () => {
    expect(extractClientIp(new Headers({ 'x-real-ip': ' 198.51.100.7 ' }))).toBe(
      '198.51.100.7',
    );
  });

  it('returns undefined when neither header has an address', () => {
    expect(extractClientIp(new Headers())).toBeUndefined();
  });
});
