'use client';

import type { DesktopBuildAsset, DesktopBuildAssetKind } from '@lobechat/types';
import { Button, confirmModal, Select } from '@lobehub/ui/base-ui';
import { Alert, Form, message, Skeleton, Typography } from 'antd';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import BuildProfileEditor from './BuildProfileEditor';
import {
  buildProfileFormFromProfile,
  type BuildProfileFormValues,
  buildProfilePayloadFromForm,
  createDefaultBuildProfileForm,
  hasCompleteWindowsAssets,
} from './buildProfileForm';
import CreateDesktopReleaseModal from './CreateDesktopReleaseModal';
import DesktopBuildHistory, { type DesktopReleaseHistoryItem } from './DesktopBuildHistory';
import { desktopControlCenterStyles } from './styles';

interface BuildProfileView {
  currentDraft?: {
    assetManifest?: Partial<Record<DesktopBuildAssetKind, DesktopBuildAsset>>;
    payload?: Partial<BuildProfileFormValues>;
  };
  currentRevision?: number;
  id: string;
  identityLocked?: boolean;
  name: string;
  status?: 'active' | 'archived';
}

interface BuildProfilePageProps {
  currentRelease?: { channel: 'canary' | 'stable'; version: string };
  onDirtyChange?: (dirty: boolean) => void;
  onReleaseActivated?: () => Promise<unknown> | unknown;
}

const getProfileItems = (data: unknown): BuildProfileView[] =>
  ((data as { items?: BuildProfileView[] } | undefined)?.items ?? []) as BuildProfileView[];

const BuildProfilePage = memo<BuildProfilePageProps>(
  ({ currentRelease, onDirtyChange, onReleaseActivated }) => {
    const { t } = useTranslation('subscription');
    const [form] = Form.useForm<BuildProfileFormValues>();
    const profiles = useClientDataSWR(['admin-desktop-build-profiles'], () =>
      adminCommercialService.listBuildProfiles({ limit: 50 }),
    );
    const profileItems = getProfileItems(profiles.data);
    const [selectedProfileId, setSelectedProfileId] = useState<string>();
    const [localProfile, setLocalProfile] = useState<BuildProfileView>();
    const selectedProfile = useMemo(
      () =>
        profileItems.find((profile) => profile.id === selectedProfileId) ??
        (localProfile?.id === selectedProfileId ? localProfile : undefined) ??
        profileItems[0] ??
        localProfile,
      [localProfile, profileItems, selectedProfileId],
    );
    const isLocalProfile = Boolean(
      selectedProfile &&
      localProfile?.id === selectedProfile.id &&
      !profileItems.some((profile) => profile.id === selectedProfile.id),
    );
    const [assets, setAssets] = useState<Partial<Record<DesktopBuildAssetKind, DesktopBuildAsset>>>(
      {},
    );
    const [savedAssets, setSavedAssets] = useState<
      Partial<Record<DesktopBuildAssetKind, DesktopBuildAsset>>
    >({});
    const [savedFormValues, setSavedFormValues] = useState<BuildProfileFormValues>();
    const [baseRevision, setBaseRevision] = useState(0);
    const [saving, setSaving] = useState(false);
    const [archiving, setArchiving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false);
    const loadedProfileIdRef = useRef<string | undefined>(undefined);
    const [releaseOpen, setReleaseOpen] = useState(false);
    const releases = useClientDataSWR(['admin-desktop-releases', selectedProfile?.id], () =>
      selectedProfile?.id
        ? adminCommercialService.listDesktopReleases({ limit: 25, profileId: selectedProfile.id })
        : Promise.resolve([]),
    );

    const confirmDiscard = (onConfirm: () => void) =>
      confirmModal({
        cancelText: t('admin.desktopControl.unsaved.cancel'),
        content: t('admin.desktopControl.unsaved.description'),
        okText: t('admin.desktopControl.unsaved.discard'),
        onOk: onConfirm,
        title: t('admin.desktopControl.unsaved.title'),
      });

    const createProfile = () => {
      const defaults = createDefaultBuildProfileForm();
      const id = globalThis.crypto.randomUUID();
      setLocalProfile({
        currentRevision: 0,
        id,
        identityLocked: false,
        name: defaults.applicationName,
        status: 'active',
      });
      setSelectedProfileId(id);
    };

    const handleCreateProfile = () => {
      if (dirty) return confirmDiscard(createProfile);
      createProfile();
    };

    const handleSelectProfile = (profileId: string) => {
      if (profileId === selectedProfile?.id) return;
      if (dirty) return confirmDiscard(() => setSelectedProfileId(profileId));
      setSelectedProfileId(profileId);
    };

    useEffect(() => {
      if (!selectedProfile) return;
      if (dirtyRef.current && loadedProfileIdRef.current === selectedProfile.id) return;
      setSelectedProfileId((current) => current ?? selectedProfile.id);
      const profileFormValues = buildProfileFormFromProfile(selectedProfile);
      form.setFieldsValue(profileFormValues);
      setAssets(selectedProfile.currentDraft?.assetManifest ?? {});
      setSavedAssets(selectedProfile.currentDraft?.assetManifest ?? {});
      setSavedFormValues(profileFormValues);
      setBaseRevision(selectedProfile.currentRevision ?? 0);
      loadedProfileIdRef.current = selectedProfile.id;
      dirtyRef.current = false;
      setDirty(false);
    }, [form, selectedProfile]);

    useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

    const markDirty = () => {
      dirtyRef.current = true;
      setDirty(true);
    };

    if (profiles.error) {
      return (
        <Alert
          title={t('admin.desktopBuild.loadFailed')}
          type="error"
          action={
            <Button onClick={() => void profiles.mutate()}>
              {t('admin.desktopControl.retry')}
            </Button>
          }
        />
      );
    }

    if (profiles.isLoading && !profiles.data) return <Skeleton active paragraph={{ rows: 8 }} />;
    if (!selectedProfile)
      return (
        <Alert
          description={t('admin.desktopBuild.emptyDescription')}
          title={t('admin.desktopBuild.empty')}
          type="info"
          action={
            <Button onClick={handleCreateProfile}>{t('admin.desktopBuild.profile.create')}</Button>
          }
        />
      );

    const canCreateBuild = hasCompleteWindowsAssets(savedAssets);
    const canSaveDraft = hasCompleteWindowsAssets(assets);

    const handleSaveDraft = async () => {
      const payload = buildProfilePayloadFromForm(await form.validateFields());
      if (!hasCompleteWindowsAssets(assets)) return;
      setSaving(true);
      try {
        await adminCommercialService.saveBuildProfileDraft({
          assets,
          ...(isLocalProfile ? { createIfMissing: true } : {}),
          expectedRevision: baseRevision,
          name: payload.applicationName,
          payload,
          profileId: selectedProfile.id,
        });
        setSavedAssets(assets);
        setSavedFormValues(payload);
        dirtyRef.current = false;
        setDirty(false);
        if (isLocalProfile) {
          setLocalProfile((current) =>
            current
              ? {
                  ...current,
                  currentDraft: { assetManifest: assets, payload },
                  currentRevision: (current.currentRevision ?? 0) + 1,
                  name: payload.applicationName,
                }
              : current,
          );
        }
        await profiles.mutate();
        message.success(t('admin.desktopBuild.saveSuccess'));
      } catch (error) {
        message.error(
          error instanceof Error &&
            error.message.includes('DESKTOP_BUILD_PROFILE_REVISION_CONFLICT')
            ? t('admin.desktopBuild.revisionConflict')
            : t('admin.desktopBuild.saveFailed'),
        );
      } finally {
        setSaving(false);
      }
    };

    const performArchiveProfile = async () => {
      setArchiving(true);
      try {
        await adminCommercialService.archiveBuildProfile(selectedProfile.id);
        dirtyRef.current = false;
        setDirty(false);
        setSelectedProfileId(undefined);
        await profiles.mutate();
        message.success(t('admin.desktopBuild.profile.archiveSuccess'));
      } catch {
        message.error(t('admin.desktopBuild.profile.archiveFailed'));
      } finally {
        setArchiving(false);
      }
    };

    const archiveProfile = () => {
      confirmModal({
        cancelText: t('admin.desktopBuild.profile.archiveCancel'),
        content: t('admin.desktopBuild.profile.archiveDescription', { name: selectedProfile.name }),
        okText: t('admin.desktopBuild.profile.archive'),
        onOk: performArchiveProfile,
        title: t('admin.desktopBuild.profile.archiveTitle'),
      });
    };

    return (
      <div className={desktopControlCenterStyles.buildProfileLayout}>
        <div className={desktopControlCenterStyles.buildProfileHeader}>
          <div>
            <Typography.Title className={desktopControlCenterStyles.sectionTitle} level={4}>
              {t('admin.desktopControl.tabs.buildProfile')}
            </Typography.Title>
            <Typography.Text type="secondary">{t('admin.desktopBuild.subtitle')}</Typography.Text>
          </div>
          <div className={desktopControlCenterStyles.buildProfileActions}>
            <label
              className={desktopControlCenterStyles.buildProfileSelectorLabel}
              htmlFor="desktop-build-profile-selector"
            >
              {t('admin.desktopBuild.profile.selector')}
            </label>
            <Select
              id="desktop-build-profile-selector"
              style={{ minWidth: 180 }}
              value={selectedProfile.id}
              options={[
                ...(isLocalProfile && localProfile ? [localProfile] : []),
                ...profileItems,
              ].map((profile) => ({ label: profile.name, value: profile.id }))}
              onChange={(profileId) => void handleSelectProfile(profileId)}
            />
            {!isLocalProfile ? (
              <Button loading={archiving} onClick={() => void archiveProfile()}>
                {t('admin.desktopBuild.profile.archive')}
              </Button>
            ) : null}
          </div>
        </div>
        <Alert
          showIcon
          description={t('admin.desktopBuild.publisher.description')}
          title={t('admin.desktopBuild.publisher.notice')}
          type="info"
        />
        <BuildProfileEditor
          assets={assets}
          form={form}
          identityLocked={selectedProfile.identityLocked}
          profileId={selectedProfile.id}
          onValuesChange={markDirty}
          onAssetUploaded={(kind, asset) => {
            setAssets((current) => ({ ...current, [kind]: asset }));
            markDirty();
          }}
        />
        <div className={desktopControlCenterStyles.formActions}>
          <Button disabled={!canSaveDraft} loading={saving} onClick={() => void handleSaveDraft()}>
            {t('admin.desktopBuild.saveDraft')}
          </Button>
          <Button disabled={!canCreateBuild} type="primary" onClick={() => setReleaseOpen(true)}>
            {t('admin.desktopBuild.createBuild')}
          </Button>
        </div>
        {!canCreateBuild ? (
          <Alert title={t('admin.desktopBuild.assets.incomplete')} type="warning" />
        ) : null}
        <DesktopBuildHistory
          currentRelease={currentRelease}
          releases={(releases.data as DesktopReleaseHistoryItem[] | undefined) ?? []}
          onActivated={onReleaseActivated}
          onReconciled={() => releases.mutate()}
        />
        <CreateDesktopReleaseModal
          assets={savedAssets}
          formValues={savedFormValues ?? buildProfileFormFromProfile(selectedProfile)}
          open={releaseOpen}
          profile={selectedProfile}
          onClose={() => setReleaseOpen(false)}
          onReleaseChanged={() => void releases.mutate()}
        />
      </div>
    );
  },
);

BuildProfilePage.displayName = 'BuildProfilePage';

export default BuildProfilePage;
