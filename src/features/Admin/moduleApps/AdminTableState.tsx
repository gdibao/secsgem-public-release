'use client';

import type { ReactNode } from 'react';

import { ModulePageState } from './shared/ModulePageState';

const isPermissionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /FORBIDDEN|UNAUTHORIZED|permission denied/i.test(message);
};

export const AdminTableState = ({
  children,
  emptyLabel,
  error,
  loading,
  loadingLabel,
  onRetry,
  retryLabel,
}: {
  children: ReactNode;
  emptyLabel: string;
  error?: unknown;
  loading?: boolean;
  loadingLabel: string;
  onRetry?: () => void;
  retryLabel?: string;
}) => {
  return (
    <ModulePageState
      emptyDescription={emptyLabel}
      error={error}
      isEmpty={!children}
      loading={loading}
      loadingLabel={loadingLabel}
      retryLabel={retryLabel ?? 'Retry'}
      errorTitle={
        error ? (isPermissionError(error) ? 'Permission denied' : 'Could not load data') : undefined
      }
      onRetry={onRetry}
    >
      {children}
    </ModulePageState>
  );
};
