'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { Alert } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_MOBILE_CONFIG,
  type MobilePublicConfigV1,
  normalizeMobileConfig,
} from '@/const/mobileConfig';
import {
  createMobileConfigPublication,
  type MobileConfigPublicationState,
} from '@/const/mobileConfigPublication';
import { adminCommercialService } from '@/services/adminCommercial';

import { AdminFormActions, AdminPageError, AdminPageShell } from './layout';
import MobileConfigPreview from './MobileConfigPreview';
import {
  ApplicationsSection,
  BottomNavigationSection,
  BrandSection,
  DesignToolsSection,
  DiscoverCommunitySection,
  FeaturedAssistantsSection,
  mobileSettingsStyles,
} from './MobileSettings';
import { useMobilePublicationActions } from './MobileSettings/useMobilePublicationActions';
import {
  cloneConfig,
  createMobileSettingsAsyncGuard,
  idleSelectorStatus,
  loadAssistantOptions,
  loadModelOptions,
  loadModuleAppOptions,
  type ModelOption,
  type SelectOption,
  type SelectorStatus,
  stringifyConfig,
  toFormConfig,
  validateFormConfig,
} from './mobileSettingsHelpers';
import { useUnsavedChangesGuard } from './shared/useUnsavedChangesGuard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  publicationMeta: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  revisionRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    min-height: 44px;
    padding-block: 6px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));
const AdminMobileSettingsPage = memo(() => {
  const { t } = useTranslation('subscription');
  const tr = useCallback(
    (key: string, defaultValue: string, values: Record<string, unknown> = {}) =>
      String(t(key as any, { defaultValue, ...values })),
    [t],
  );
  const asyncGuardRef = useRef<ReturnType<typeof createMobileSettingsAsyncGuard> | null>(null);
  if (!asyncGuardRef.current) asyncGuardRef.current = createMobileSettingsAsyncGuard();
  const asyncGuard = asyncGuardRef.current;
  const [formValues, setFormValues] = useState<MobilePublicConfigV1>(() =>
    cloneConfig(DEFAULT_MOBILE_CONFIG),
  );
  const [baseline, setBaseline] = useState<MobilePublicConfigV1>(() =>
    cloneConfig(DEFAULT_MOBILE_CONFIG),
  );
  const [publicationState, setPublicationState] = useState<MobileConfigPublicationState>(() =>
    createMobileConfigPublication(DEFAULT_MOBILE_CONFIG, new Date(0).toISOString()),
  );
  const [assistantOptions, setAssistantOptions] = useState<SelectOption[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [moduleAppOptions, setModuleAppOptions] = useState<SelectOption[]>([]);
  const [assistantStatus, setAssistantStatus] = useState<SelectorStatus>(idleSelectorStatus);
  const [modelStatus, setModelStatus] = useState<SelectorStatus>(idleSelectorStatus);
  const [moduleAppStatus, setModuleAppStatus] = useState<SelectorStatus>(idleSelectorStatus);
  const [selectedAssistantId, setSelectedAssistantId] = useState('');
  const [selectedModelValue, setSelectedModelValue] = useState('');
  const [selectedModuleAppId, setSelectedModuleAppId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const loadPublication = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const publication = await adminCommercialService.getMobileSettingsPublication();
      const normalized = toFormConfig(publication.draft.config);
      if (!asyncGuard.isMounted()) return;
      setPublicationState(publication);
      setFormValues(normalized);
      setBaseline(normalized);
    } catch {
      if (asyncGuard.isMounted()) {
        setError(tr('admin.mobile.loadError', 'Failed to load mobile settings.'));
      }
    } finally {
      if (asyncGuard.isMounted()) setLoading(false);
    }
  }, [asyncGuard, tr]);

  const refreshAssistantOptions = useCallback(async () => {
    if (!asyncGuard.isMounted()) return;
    setAssistantStatus({ loading: true });
    try {
      const assistants = await loadAssistantOptions();
      if (!asyncGuard.isMounted()) return;
      setAssistantOptions(assistants);
      setAssistantStatus({ loading: false });
    } catch {
      if (!asyncGuard.isMounted()) return;
      setAssistantOptions([]);
      setSelectedAssistantId('');
      setAssistantStatus({
        error: tr('admin.mobile.assistantSelectorUnavailable', 'Assistant selector unavailable.'),
        loading: false,
      });
    }
  }, [asyncGuard, tr]);

  const refreshModelOptions = useCallback(async () => {
    if (!asyncGuard.isMounted()) return;
    setModelStatus({ loading: true });
    try {
      const models = await loadModelOptions();
      if (!asyncGuard.isMounted()) return;
      setModelOptions(models);
      setModelStatus({ loading: false });
    } catch {
      if (!asyncGuard.isMounted()) return;
      setModelOptions([]);
      setSelectedModelValue('');
      setModelStatus({
        error: tr('admin.mobile.modelSelectorUnavailable', 'Model selector unavailable.'),
        loading: false,
      });
    }
  }, [asyncGuard, tr]);

  const refreshModuleAppOptions = useCallback(async () => {
    if (!asyncGuard.isMounted()) return;
    setModuleAppStatus({ loading: true });
    try {
      const moduleApps = await loadModuleAppOptions();
      if (!asyncGuard.isMounted()) return;
      setModuleAppOptions(moduleApps);
      setModuleAppStatus({ loading: false });
    } catch {
      if (!asyncGuard.isMounted()) return;
      setModuleAppOptions([]);
      setSelectedModuleAppId('');
      setModuleAppStatus({
        error: tr('admin.mobile.moduleAppSelectorUnavailable', 'Module app selector unavailable.'),
        loading: false,
      });
    }
  }, [asyncGuard, tr]);

  useEffect(() => {
    asyncGuard.mount();
    void loadPublication();
    return () => asyncGuard.unmount();
  }, [asyncGuard, loadPublication]);

  const normalizedPreview = useMemo(() => normalizeMobileConfig(formValues), [formValues]);
  const validation = useMemo(
    () =>
      validateFormConfig(formValues, {
        builtinPaths: tr(
          'admin.mobile.validation.builtinPaths',
          'Built-in app paths must be internal.',
        ),
        uniquePaths: tr(
          'admin.mobile.validation.uniquePaths',
          'Visible tab paths must be internal and unique.',
        ),
      }),
    [formValues, tr],
  );
  const dirty = stringifyConfig(formValues) !== stringifyConfig(baseline);
  const canSaveReady = dirty && !loading && validation.valid;
  const draftDiffersFromPublished =
    stringifyConfig(baseline) !== stringifyConfig(publicationState.published.config);
  const canPublishReady = !dirty && draftDiffersFromPublished && !loading && validation.valid;
  const { publish, publishing, rollback, rollingBackRevision, save, saving } =
    useMobilePublicationActions({
      asyncGuard,
      canPublish: canPublishReady,
      canSave: canSaveReady,
      formValues,
      publicationState,
      setBaseline,
      setError,
      setFormValues,
      setPublicationState,
      setSuccess,
      tr,
    });
  const canSave = canSaveReady && !saving;
  const canPublish = canPublishReady && !saving && !publishing;
  useUnsavedChangesGuard({
    cancelText: tr('admin.mobile.unsavedStay', 'Keep editing'),
    confirmText: tr('admin.mobile.unsavedLeave', 'Leave'),
    isDirty: dirty,
    message: tr(
      'admin.mobile.unsavedChanges',
      'You have unsaved mobile settings. Leave this page?',
    ),
    title: tr('admin.mobile.unsavedTitle', 'Discard unsaved mobile settings?'),
  });

  useEffect(() => {
    if (dirty) return;
    const refreshPublication = async () => {
      try {
        const publication = await adminCommercialService.getMobileSettingsPublication();
        if (!asyncGuard.isMounted()) return;
        const normalized = toFormConfig(publication.draft.config);
        setPublicationState(publication);
        setFormValues(normalized);
        setBaseline(normalized);
      } catch {
        // Keep the current editor state; the explicit page error path handles initial load failures.
      }
    };
    window.addEventListener('focus', refreshPublication);
    window.addEventListener('online', refreshPublication);
    return () => {
      window.removeEventListener('focus', refreshPublication);
      window.removeEventListener('online', refreshPublication);
    };
  }, [asyncGuard, dirty]);

  const updateForm = (next: MobilePublicConfigV1) => {
    asyncGuard.markDraftChanged();
    setSuccess(undefined);
    setError(undefined);
    setFormValues(next);
  };

  const restoreDefaults = () => {
    confirmModal({
      cancelText: tr('admin.mobile.restoreCancel', 'Cancel'),
      content: tr(
        'admin.mobile.restoreDescription',
        'Current draft values will be replaced by the mobile defaults.',
      ),
      okText: tr('admin.mobile.restoreDefaults', 'Restore defaults'),
      onOk: () => updateForm(cloneConfig(DEFAULT_MOBILE_CONFIG)),
      title: tr('admin.mobile.restoreConfirm', 'Restore mobile defaults?'),
    });
  };

  if (loading) {
    return (
      <AdminPageShell
        description={tr('admin.mobile.subtitle', '配置手机端品牌、导航、内容入口和发布版本。')}
        title={tr('admin.mobile.title', '手机端配置')}
        width="full"
      >
        <Flexbox data-testid="mobile-settings-loading" gap={16}>
          <Skeleton.Button active block style={{ height: 32, width: 240 }} />
          <Skeleton.Paragraph active rows={4} />
          <Skeleton.Button active block style={{ height: 120 }} />
        </Flexbox>
      </AdminPageShell>
    );
  }

  const sectionProps = { formValues, tr, updateForm };
  return (
    <AdminPageShell
      description={tr('admin.mobile.subtitle', '配置手机端品牌、导航、内容入口和发布版本。')}
      title={tr('admin.mobile.title', '手机端配置')}
      width="full"
    >
      <Flexbox gap={24}>
        {error ? <AdminPageError description={error} onRetry={loadPublication} /> : null}
        {success ? <Alert showIcon title={success} type="success" /> : null}
        {validation.messages.map((message) => (
          <Alert showIcon key={message} title={message} type="warning" />
        ))}

        <BrandSection {...sectionProps} />
        <BottomNavigationSection {...sectionProps} />
        <DesignToolsSection {...sectionProps} />
        <DiscoverCommunitySection {...sectionProps} />
        <FeaturedAssistantsSection
          {...sectionProps}
          assistantOptions={assistantOptions}
          assistantStatus={assistantStatus}
          modelOptions={modelOptions}
          modelStatus={modelStatus}
          selectedAssistantId={selectedAssistantId}
          selectedModelValue={selectedModelValue}
          setSelectedAssistantId={setSelectedAssistantId}
          setSelectedModelValue={setSelectedModelValue}
          onLoadAssistants={() => void refreshAssistantOptions()}
          onLoadModels={() => void refreshModelOptions()}
          onRetryAssistants={() => void refreshAssistantOptions()}
          onRetryModels={() => void refreshModelOptions()}
        />
        <ApplicationsSection
          {...sectionProps}
          moduleAppOptions={moduleAppOptions}
          moduleAppStatus={moduleAppStatus}
          selectedModuleAppId={selectedModuleAppId}
          setSelectedModuleAppId={setSelectedModuleAppId}
          onLoadModuleApps={() => void refreshModuleAppOptions()}
          onRetryModuleApps={() => void refreshModuleAppOptions()}
        />

        <section
          aria-label={tr('admin.mobile.preview', 'Preview')}
          className={mobileSettingsStyles.section}
        >
          <h2 className={mobileSettingsStyles.sectionTitle}>
            {tr('admin.mobile.preview', 'Preview')}
          </h2>
          <MobileConfigPreview config={normalizedPreview} />
        </section>

        <section
          aria-label={tr('admin.mobile.history', 'Publication history')}
          className={mobileSettingsStyles.section}
        >
          <h2 className={mobileSettingsStyles.sectionTitle}>
            {tr('admin.mobile.history', 'Publication history')}
          </h2>
          <div className={styles.publicationMeta}>
            {tr('admin.mobile.draftRevision', 'Draft revision {{draft}}', {
              draft: publicationState.draft.revision,
            })}
            {' | '}
            {tr('admin.mobile.publishedRevision', 'Published revision {{published}}', {
              published: publicationState.published.revision,
            })}
          </div>
          {publicationState.history.map((snapshot) => (
            <div className={styles.revisionRow} key={snapshot.revision}>
              <span>
                {tr('admin.mobile.revision', 'Revision {{revision}}', {
                  revision: snapshot.revision,
                })}{' '}
                <time dateTime={snapshot.updatedAt}>
                  {new Date(snapshot.updatedAt).toLocaleString()}
                </time>
              </span>
              {snapshot.revision !== publicationState.published.revision ? (
                <Button
                  loading={rollingBackRevision === snapshot.revision}
                  onClick={() => void rollback(snapshot.revision)}
                >
                  {tr('admin.mobile.rollback', 'Roll back')}
                </Button>
              ) : null}
            </div>
          ))}
        </section>

        <AdminFormActions label={tr('admin.mobile.actions', '手机端配置操作')}>
          <Button onClick={() => void restoreDefaults()}>
            {tr('admin.mobile.restoreDefaults', 'Restore defaults')}
          </Button>
          <Button disabled={!canSave} loading={saving} onClick={() => void save()}>
            {tr('admin.mobile.saveDraft', 'Save draft')}
          </Button>
          <Button
            disabled={!canPublish}
            loading={publishing}
            type="primary"
            onClick={() => void publish()}
          >
            {tr('admin.mobile.publish', 'Publish')}
          </Button>
        </AdminFormActions>
      </Flexbox>
    </AdminPageShell>
  );
});

AdminMobileSettingsPage.displayName = 'AdminMobileSettingsPage';

export { createMobileSettingsAsyncGuard };
export default AdminMobileSettingsPage;
