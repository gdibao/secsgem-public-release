'use client';

import type { DesktopBuildAsset, DesktopBuildAssetKind } from '@lobechat/types';
import { Button, Space, Tag, Typography, Upload, message } from 'antd';
import type { UploadProps } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminCommercialService } from '@/services/adminCommercial';

const acceptByKind: Record<DesktopBuildAssetKind, string> = {
  appPreview: '.png',
  nsisHeader: '.bmp,.png',
  nsisSidebar: '.bmp,.png',
  windowsIcon: '.ico',
};

const labelKeyByKind: Record<DesktopBuildAssetKind, string> = {
  appPreview: 'admin.desktopBuild.assets.appPreview',
  nsisHeader: 'admin.desktopBuild.assets.nsisHeader',
  nsisSidebar: 'admin.desktopBuild.assets.nsisSidebar',
  windowsIcon: 'admin.desktopBuild.assets.windowsIcon',
};

interface DesktopBuildAssetUploadProps {
  asset?: DesktopBuildAsset;
  kind: DesktopBuildAssetKind;
  onUploaded: (asset: DesktopBuildAsset) => void;
  profileId: string;
}

const DesktopBuildAssetUpload = memo<DesktopBuildAssetUploadProps>(
  ({ asset, kind, onUploaded, profileId }) => {
    const { t } = useTranslation('subscription');
    const [uploading, setUploading] = useState(false);
    const accept = acceptByKind[kind];
    const statusLabel = useMemo(
      () =>
        uploading
          ? t('admin.desktopBuild.assets.uploading')
          : asset
            ? t('admin.desktopBuild.assets.ready')
            : t('admin.desktopBuild.assets.missing'),
      [asset, t, uploading],
    );

    const beforeUpload: UploadProps['beforeUpload'] = async (file) => {
      setUploading(true);
      try {
        const target = (await adminCommercialService.createBuildAssetUpload({
          kind,
          profileId,
        })) as { headers?: Record<string, string>; key: string; uploadUrl: string };
        const response = await fetch(target.uploadUrl, {
          body: file,
          headers: target.headers,
          method: 'PUT',
        });
        if (!response.ok) throw new Error('DESKTOP_BUILD_ASSET_UPLOAD_FAILED');
        const trustedAsset = await adminCommercialService.completeBuildAssetUpload({
          key: target.key,
          kind,
          profileId,
        });
        onUploaded(trustedAsset as DesktopBuildAsset);
        message.success(t('admin.desktopBuild.assets.validated'));
      } catch {
        message.error(t('admin.desktopBuild.assets.failed'));
      } finally {
        setUploading(false);
      }

      return Upload.LIST_IGNORE;
    };

    return (
      <Space align="center" orientation="vertical" size={4}>
        <Typography.Text strong>{t(labelKeyByKind[kind] as any)}</Typography.Text>
        <Tag color={asset ? 'success' : uploading ? 'processing' : 'default'}>{statusLabel}</Tag>
        <Typography.Text ellipsis style={{ maxWidth: 180 }} type="secondary">
          {asset?.key || t('admin.desktopBuild.assets.help')}
        </Typography.Text>
        <Upload accept={accept} beforeUpload={beforeUpload} maxCount={1} showUploadList={false}>
          <Button loading={uploading} size="small">
            {asset ? t('admin.desktopBuild.assets.replace') : t('admin.desktopBuild.assets.upload')}
          </Button>
        </Upload>
      </Space>
    );
  },
);

DesktopBuildAssetUpload.displayName = 'DesktopBuildAssetUpload';

export default DesktopBuildAssetUpload;
