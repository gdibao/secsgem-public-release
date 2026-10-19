// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalizeAlipayParameters, signAlipayParameters, verifyAlipaySignature } from './signature';

describe('Alipay RSA2 signature', () => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });

  it('sorts non-empty parameters without URL encoding or sign fields', () => {
    expect(canonicalizeAlipayParameters({
      app_id: 'app 1',
      empty: '',
      sign: 'ignored',
      sign_type: 'RSA2',
      subject: 'Module App & Pro',
    }, { excludeSignType: true })).toBe('app_id=app 1&subject=Module App & Pro');
  });

  it('signs and verifies the canonical RSA-SHA256 payload', () => {
    const parameters = { app_id: 'app-1', method: 'alipay.trade.page.pay', sign_type: 'RSA2' };
    const signature = signAlipayParameters(parameters, keys.privateKey);
    expect(verifyAlipaySignature({ ...parameters, sign: signature }, keys.publicKey)).toBe(true);
    expect(verifyAlipaySignature({ ...parameters, app_id: 'app-2', sign: signature }, keys.publicKey)).toBe(false);
  });
});
