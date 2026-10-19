'use client';

import { confirmModal } from '@lobehub/ui/base-ui';
import { useEffect } from 'react';
import { useBlocker } from 'react-router';

type UnsavedChangesGuardOptions = {
  cancelText: string;
  confirmText: string;
  isDirty: boolean;
  message: string;
  title: string;
};

export const useUnsavedChangesGuard = ({
  cancelText,
  confirmText,
  isDirty,
  message,
  title,
}: UnsavedChangesGuardOptions) => {
  const blocker = useBlocker(isDirty);
  const { proceed, reset, state } = blocker;

  useEffect(() => {
    if (state !== 'blocked') return;

    confirmModal({
      cancelText,
      content: message,
      okText: confirmText,
      onCancel: reset,
      onOk: proceed,
      title,
    });
  }, [cancelText, confirmText, message, proceed, reset, state, title]);

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, message]);

  return blocker;
};
