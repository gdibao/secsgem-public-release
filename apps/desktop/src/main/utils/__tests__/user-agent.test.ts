import { app } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  getDesktopUserAgent,
  getDesktopUserAgentName,
  setDesktopUserAgentHeader,
} from '../user-agent';

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.2.3'),
  },
}));

describe('user-agent utilities', () => {
  it('builds desktop user agent from Electron app version', () => {
    expect(getDesktopUserAgent()).toBe('ChituoAI-Desktop/1.2.3');
  });

  it('uses an ASCII-safe fallback for a localized application name', () => {
    const userAgentName = getDesktopUserAgentName('驰拓 AI 助手');

    expect(userAgentName).toBe('ChituoAI-Desktop');
    expect([...userAgentName].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true);
  });

  it('sets User-Agent on Headers', () => {
    const headers = new Headers({ 'user-agent': 'old' });

    setDesktopUserAgentHeader(headers);

    expect(headers.get('User-Agent')).toBe('ChituoAI-Desktop/1.2.3');
  });

  it('replaces case-insensitive User-Agent keys on plain objects', () => {
    const headers: Record<string, string> = { 'user-agent': 'old' };

    setDesktopUserAgentHeader(headers);

    expect(headers).toEqual({ 'User-Agent': 'ChituoAI-Desktop/1.2.3' });
    expect(app.getVersion).toHaveBeenCalled();
  });
});
