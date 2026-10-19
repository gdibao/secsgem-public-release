'use client';

import { type ReactNode } from 'react';
import { createContext, memo, use, useCallback, useEffect, useMemo, useState } from 'react';

import { useBrand } from '@/features/Brand';

export type FaviconState = 'default' | 'done' | 'error' | 'progress';

interface FaviconStateContextValue {
  currentState: FaviconState;
  isDevMode: boolean;
}

interface FaviconSettersContextValue {
  setFavicon: (state: FaviconState) => void;
  setIsDevMode: (isDev: boolean) => void;
}

const FaviconStateContext = createContext<FaviconStateContextValue | null>(null);
const FaviconSettersContext = createContext<FaviconSettersContextValue | null>(null);

export const useFaviconState = () => {
  const context = use(FaviconStateContext);
  if (!context) {
    throw new Error('useFaviconState must be used within FaviconProvider');
  }
  return context;
};

export const useFaviconSetters = () => {
  const context = use(FaviconSettersContext);
  if (!context) {
    throw new Error('useFaviconSetters must be used within FaviconProvider');
  }
  return context;
};

const stateToFileName: Record<FaviconState, string> = {
  default: '',
  done: '-done',
  error: '-error',
  progress: '-progress',
};

const getFaviconPath = (state: FaviconState, isDev: boolean, size?: '32x32'): string => {
  const devSuffix = isDev ? '-dev' : '';
  const stateSuffix = stateToFileName[state];
  const sizeSuffix = size ? `-${size}` : '';
  return `/favicon${sizeSuffix}${stateSuffix}${devSuffix}.ico`;
};

const getFaviconHref = (
  state: FaviconState,
  isDev: boolean,
  size?: '32x32',
  customUrl?: string | null,
): string => customUrl?.trim() || `${getFaviconPath(state, isDev, size)}?v=${Date.now()}`;

const updateFaviconDOM = (state: FaviconState, isDev: boolean, customUrl?: string | null) => {
  if (typeof document === 'undefined') return;

  const head = document.head;
  const existingLinks = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"]',
  );

  if (existingLinks.length === 0) {
    const iconLink = document.createElement('link');
    iconLink.rel = 'icon';
    iconLink.href = getFaviconHref(state, isDev, undefined, customUrl);
    head.append(iconLink);

    const shortcutLink = document.createElement('link');
    shortcutLink.rel = 'shortcut icon';
    shortcutLink.href = getFaviconHref(state, isDev, '32x32', customUrl);
    head.append(shortcutLink);
    return;
  }

  existingLinks.forEach((link) => {
    const oldHref = link.href;
    const is32 = oldHref.includes('32x32');
    const rel = link.rel;

    link.remove();

    const newLink = document.createElement('link');
    newLink.rel = rel;
    newLink.href = getFaviconHref(state, isDev, is32 ? '32x32' : undefined, customUrl);
    head.append(newLink);
  });
};

export const FaviconProvider = memo<{ children: ReactNode }>(({ children }) => {
  const { faviconUrl } = useBrand();
  const [currentState, setCurrentState] = useState<FaviconState>('default');
  const [isDevMode, setIsDevModeState] = useState<boolean>(__DEV__);

  useEffect(() => {
    updateFaviconDOM(currentState, isDevMode, faviconUrl);
  }, [currentState, faviconUrl, isDevMode]);

  const setFavicon = useCallback(
    (state: FaviconState) => {
      setCurrentState(state);
      setIsDevModeState((isDev) => {
        updateFaviconDOM(state, isDev, faviconUrl);
        return isDev;
      });
    },
    [faviconUrl],
  );

  const setIsDevMode = useCallback(
    (isDev: boolean) => {
      setIsDevModeState(isDev);
      setCurrentState((state) => {
        updateFaviconDOM(state, isDev, faviconUrl);
        return state;
      });
    },
    [faviconUrl],
  );

  const stateValue = useMemo(() => ({ currentState, isDevMode }), [currentState, isDevMode]);

  const settersValue = useMemo(() => ({ setFavicon, setIsDevMode }), [setFavicon, setIsDevMode]);

  return (
    <FaviconStateContext value={stateValue}>
      <FaviconSettersContext value={settersValue}>{children}</FaviconSettersContext>
    </FaviconStateContext>
  );
});

FaviconProvider.displayName = 'FaviconProvider';
