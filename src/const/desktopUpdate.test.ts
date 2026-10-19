import { describe, expect, it } from 'vitest';

import { normalizeDesktopDownloadUrl, normalizeDesktopUpdateServerUrl } from './desktopUpdate';

describe('normalizeDesktopUpdateServerUrl', () => {
  it('normalizes a public HTTPS base URL', () => {
    expect(normalizeDesktopUpdateServerUrl('  https://updates.example.com/releases/  ')).toEqual({
      url: 'https://updates.example.com/releases',
    });
  });

  it('does not treat public hostnames that resemble IPv6 ranges as literals', () => {
    expect(normalizeDesktopUpdateServerUrl('https://fcloud.example.com')).toEqual({
      url: 'https://fcloud.example.com',
    });
  });

  it.each([
    ['http://updates.example.com', 'https-required'],
    ['https://user:secret@updates.example.com', 'credentials-not-allowed'],
    ['https://updates.example.com?token=secret', 'credentials-not-allowed'],
    ['https://127.0.0.1:9000', 'unsafe-url'],
    ['https://[fc00::1]', 'unsafe-url'],
  ])('rejects unsafe update server URL %s', (url, reason) => {
    expect(normalizeDesktopUpdateServerUrl(url)).toEqual({ reason });
  });
});

describe('normalizeDesktopDownloadUrl', () => {
  it('keeps public HTTPS download URLs including signed query parameters', () => {
    expect(normalizeDesktopDownloadUrl(' https://cdn.example.com/app.exe?token=signed ')).toEqual({
      url: 'https://cdn.example.com/app.exe?token=signed',
    });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'http://cdn.example.com/app.exe',
    'https://user:secret@cdn.example.com/app.exe',
    'https://127.0.0.1/app.exe',
    'https://[::ffff:127.0.0.1]/app.exe',
  ])('rejects unsafe download URL %s', (url) => {
    expect(normalizeDesktopDownloadUrl(url)).toHaveProperty('reason');
  });
});
