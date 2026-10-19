import { app } from 'electron';

import { DESKTOP_APPLICATION_NAME } from '@/const/env';

type RequestHeaders = Headers | Record<string, number | string | string[] | undefined>;

const FALLBACK_USER_AGENT_NAME = 'ChituoAI-Desktop';

export const getDesktopUserAgentName = (applicationName?: string) => {
  const asciiName = (applicationName ?? '')
    .normalize('NFKD')
    .replaceAll(/[^\x20-\x7E]/g, '')
    .trim()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^\w.-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');

  return asciiName.length >= 3 ? asciiName : FALLBACK_USER_AGENT_NAME;
};

const DESKTOP_USER_AGENT_NAME = getDesktopUserAgentName(DESKTOP_APPLICATION_NAME);

export const getDesktopUserAgent = () => `${DESKTOP_USER_AGENT_NAME}/${app.getVersion()}`;

export const setDesktopUserAgentHeader = (headers: RequestHeaders) => {
  const userAgent = getDesktopUserAgent();

  if (headers instanceof Headers) {
    headers.set('User-Agent', userAgent);
    return;
  }

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'user-agent') {
      delete headers[key];
    }
  }

  headers['User-Agent'] = userAgent;
};
