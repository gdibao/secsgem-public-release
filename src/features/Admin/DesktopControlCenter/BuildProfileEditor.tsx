'use client';

import type { DesktopBuildAsset, DesktopBuildAssetKind } from '@lobechat/types';
import { Alert, Form, Input, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type BuildProfileFormValues, WINDOWS_ASSET_KINDS } from './buildProfileForm';
import DesktopBuildAssetUpload from './DesktopBuildAssetUpload';
import { desktopControlCenterStyles } from './styles';

interface BuildProfileEditorProps {
  assets: Partial<Record<DesktopBuildAssetKind, DesktopBuildAsset>>;
  form: ReturnType<typeof Form.useForm<BuildProfileFormValues>>[0];
  identityLocked?: boolean;
  onAssetUploaded: (kind: DesktopBuildAssetKind, asset: DesktopBuildAsset) => void;
  onValuesChange?: () => void;
  profileId: string;
}

const BuildProfileEditor = memo<BuildProfileEditorProps>(
  ({ assets, form, identityLocked, onAssetUploaded, onValuesChange, profileId }) => {
    const { t } = useTranslation('subscription');

    return (
      <Form<BuildProfileFormValues> form={form} layout="vertical" onValuesChange={onValuesChange}>
        <Typography.Title className={desktopControlCenterStyles.sectionTitle} level={4}>
          {t('admin.desktopBuild.profile.title')}
        </Typography.Title>
        <Form.Item label={t('admin.desktopBuild.applicationName')} name="applicationName">
          <Input />
        </Form.Item>
        <Form.Item
          extra={t('admin.desktopBuild.identity.help')}
          label={t('admin.desktopBuild.applicationId')}
          name="applicationId"
        >
          <Input disabled={identityLocked} />
        </Form.Item>
        <Form.Item
          extra={t('admin.desktopBuild.identity.help')}
          label={t('admin.desktopBuild.protocolScheme')}
          name="protocolScheme"
        >
          <Input disabled={identityLocked} />
        </Form.Item>
        <Form.Item label={t('admin.desktopBuild.executableName')} name="executableName">
          <Input />
        </Form.Item>
        <Form.Item
          extra={t('admin.desktopBuild.publisher.help')}
          label={t('admin.desktopBuild.publisher')}
          name="publisher"
        >
          <Input />
        </Form.Item>
        <Form.Item label={t('admin.desktopBuild.homepage')} name="homepage">
          <Input />
        </Form.Item>
        <Form.Item label={t('admin.desktopBuild.description')} name="description">
          <Input.TextArea autoSize={{ maxRows: 4, minRows: 2 }} />
        </Form.Item>
        <Form.Item label={t('admin.desktopBuild.shortcutName')} name="shortcutName">
          <Input />
        </Form.Item>
        <Form.Item label={t('admin.desktopBuild.uninstallDisplayName')} name="uninstallDisplayName">
          <Input />
        </Form.Item>
        <Form.Item
          extra={t('admin.desktopBuild.installerArtifactName.help')}
          label={t('admin.desktopBuild.installerArtifactName')}
          name="installerArtifactName"
        >
          <Input />
        </Form.Item>
        {identityLocked ? (
          <Alert message={t('admin.desktopBuild.identity.locked')} type="info" />
        ) : null}
        <Typography.Title className={desktopControlCenterStyles.sectionTitle} level={4}>
          {t('admin.desktopBuild.assets.title')}
        </Typography.Title>
        <div className={desktopControlCenterStyles.assetGrid}>
          {WINDOWS_ASSET_KINDS.map((kind) => (
            <DesktopBuildAssetUpload
              asset={assets[kind]}
              key={kind}
              kind={kind}
              profileId={profileId}
              onUploaded={(asset) => onAssetUploaded(kind, asset)}
            />
          ))}
        </div>
      </Form>
    );
  },
);

BuildProfileEditor.displayName = 'BuildProfileEditor';

export default BuildProfileEditor;
