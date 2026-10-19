'use client';

import { confirmModal } from '@lobehub/ui/base-ui';
import { type Dispatch, type SetStateAction, useRef, useState } from 'react';

import { type MobilePublicConfigV1, normalizeMobileConfig } from '@/const/mobileConfig';
import type { MobileConfigPublicationState } from '@/const/mobileConfigPublication';
import { refreshMobileConfig } from '@/features/MobileWorkspace/useMobileConfig';
import { adminCommercialService } from '@/services/adminCommercial';

import type { createMobileSettingsAsyncGuard } from '../mobileSettingsHelpers';
import { cloneConfig } from '../mobileSettingsHelpers';

type AsyncGuard = ReturnType<typeof createMobileSettingsAsyncGuard>;
type Translate = (key: string, defaultValue: string, values?: Record<string, unknown>) => string;

interface UseMobilePublicationActionsParams {
  asyncGuard: AsyncGuard;
  canPublish: boolean;
  canSave: boolean;
  formValues: MobilePublicConfigV1;
  publicationState: MobileConfigPublicationState;
  setBaseline: Dispatch<SetStateAction<MobilePublicConfigV1>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setFormValues: Dispatch<SetStateAction<MobilePublicConfigV1>>;
  setPublicationState: Dispatch<SetStateAction<MobileConfigPublicationState>>;
  setSuccess: Dispatch<SetStateAction<string | undefined>>;
  tr: Translate;
}

const isConflictError = (reason: unknown) => {
  const error = reason as {
    data?: { code?: string };
    message?: string;
    shape?: { data?: { code?: string } };
  };
  return (
    error?.data?.code === 'CONFLICT' ||
    error?.shape?.data?.code === 'CONFLICT' ||
    error?.message?.includes('MOBILE_CONFIG_REVISION_CONFLICT')
  );
};

export const useMobilePublicationActions = ({
  asyncGuard,
  canPublish,
  canSave,
  formValues,
  publicationState,
  setBaseline,
  setError,
  setFormValues,
  setPublicationState,
  setSuccess,
  tr,
}: UseMobilePublicationActionsParams) => {
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [rollingBackRevision, setRollingBackRevision] = useState<number>();
  const publishingRef = useRef(false);
  const rollingBackRef = useRef(false);

  const save = async () => {
    if (!canSave) return;
    const submittedRevision = asyncGuard.beginSave();
    if (submittedRevision === undefined) return;
    setSaving(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const publication = await adminCommercialService.saveMobileSettingsDraft(
        normalizeMobileConfig(formValues),
        publicationState.draft.revision,
      );
      if (!asyncGuard.isMounted()) return;
      const normalized = cloneConfig(publication.draft.config);
      setPublicationState(publication);
      setBaseline(normalized);
      if (asyncGuard.isCurrent(submittedRevision)) {
        setFormValues(normalized);
        setSuccess(tr('admin.mobile.draftSaved', 'Mobile draft saved.'));
      }
    } catch (reason) {
      if (asyncGuard.isMounted()) {
        setError(
          isConflictError(reason)
            ? tr(
                'admin.mobile.saveConflict',
                'Another administrator updated this draft. Your local edits were preserved; reload before saving.',
              )
            : tr('admin.mobile.saveError', 'Failed to save mobile settings.'),
        );
      }
    } finally {
      asyncGuard.finishSave();
      if (asyncGuard.isMounted()) setSaving(false);
    }
  };

  const publish = async () => {
    if (!canPublish || publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const publication = await adminCommercialService.publishMobileSettings({
        expectedDraftRevision: publicationState.draft.revision,
        expectedRevision: publicationState.published.revision,
      });
      if (!asyncGuard.isMounted()) return;
      setPublicationState(publication);
      const normalized = cloneConfig(publication.draft.config);
      setFormValues(normalized);
      setBaseline(normalized);
      await refreshMobileConfig().catch(() => undefined);
      setSuccess(tr('admin.mobile.published', 'Mobile settings published.'));
    } catch (reason) {
      if (!asyncGuard.isMounted()) return;
      setError(
        isConflictError(reason)
          ? tr(
              'admin.mobile.publishConflict',
              'A newer mobile revision was published. Your draft was preserved; reload before publishing.',
            )
          : tr('admin.mobile.publishError', 'Failed to publish mobile settings.'),
      );
    } finally {
      publishingRef.current = false;
      if (asyncGuard.isMounted()) setPublishing(false);
    }
  };

  const performRollback = async (targetRevision: number) => {
    rollingBackRef.current = true;
    setRollingBackRevision(targetRevision);
    setError(undefined);
    setSuccess(undefined);
    try {
      const publication = await adminCommercialService.rollbackMobileSettings({
        expectedDraftRevision: publicationState.draft.revision,
        expectedRevision: publicationState.published.revision,
        targetRevision,
      });
      if (!asyncGuard.isMounted()) return;
      const normalized = cloneConfig(publication.draft.config);
      setPublicationState(publication);
      setFormValues(normalized);
      setBaseline(normalized);
      await refreshMobileConfig().catch(() => undefined);
      setSuccess(tr('admin.mobile.rolledBack', 'Mobile settings rolled back.'));
    } catch (reason) {
      if (!asyncGuard.isMounted()) return;
      setError(
        isConflictError(reason)
          ? tr(
              'admin.mobile.publishConflict',
              'A newer mobile revision was published. Your draft was preserved; reload before publishing.',
            )
          : tr('admin.mobile.rollbackError', 'Failed to roll back mobile settings.'),
      );
    } finally {
      rollingBackRef.current = false;
      if (asyncGuard.isMounted()) setRollingBackRevision(undefined);
    }
  };

  const rollback = (targetRevision: number) => {
    if (rollingBackRef.current) return;
    confirmModal({
      cancelText: tr('admin.mobile.rollbackCancel', 'Cancel'),
      content: tr(
        'admin.mobile.rollbackConfirm',
        'Publish revision {{revision}} as a new revision?',
        {
          revision: targetRevision,
        },
      ),
      okText: tr('admin.mobile.rollback', 'Roll back'),
      onOk: () => performRollback(targetRevision),
      title: tr('admin.mobile.rollbackTitle', 'Roll back mobile settings?'),
    });
  };

  return { publish, publishing, rollback, rollingBackRevision, save, saving };
};
