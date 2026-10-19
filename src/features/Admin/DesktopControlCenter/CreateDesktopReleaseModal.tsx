'use client';

import type { DesktopBuildAsset, DesktopBuildAssetKind } from '@lobechat/types';
import { Descriptions, Form, Input, message,Modal, Radio } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminCommercialService } from '@/services/adminCommercial';

import {
  type BuildProfileFormValues,
  buildProfilePayloadFromForm,
  renderInstallerArtifactName,
} from './buildProfileForm';

interface CreateDesktopReleaseModalProps {
  assets: Partial<Record<DesktopBuildAssetKind, DesktopBuildAsset>>;
  formValues: BuildProfileFormValues;
  onClose: () => void;
  onReleaseChanged: () => void;
  open: boolean;
  profile: any;
}

const CreateDesktopReleaseModal = memo<CreateDesktopReleaseModalProps>(
  ({ formValues, onClose, onReleaseChanged, open, profile }) => {
    const { t } = useTranslation('subscription');
    const [form] = Form.useForm<{
      channel: 'canary' | 'stable';
      releaseNotes: string;
      version: string;
    }>();
    const [submitting, setSubmitting] = useState(false);
    const payload = useMemo(() => buildProfilePayloadFromForm(formValues), [formValues]);
    const version = Form.useWatch('version', form) || '0.0.0';
    const artifactName = renderInstallerArtifactName(payload.installerArtifactName, {
      arch: 'x64',
      ext: 'exe',
      productName: payload.applicationName,
      version,
    });

    const handleCreate = async () => {
      const values = await form.validateFields();
      setSubmitting(true);
      try {
        await adminCommercialService.createDesktopRelease({
          channel: values.channel,
          profileId: profile.id,
          releaseNotes: values.releaseNotes || '',
          version: values.version,
        });
        message.success(t('admin.desktopBuild.release.queued'));
        onClose();
      } catch {
        message.error(t('admin.desktopBuild.release.failed'));
      } finally {
        setSubmitting(false);
        onReleaseChanged();
      }
    };

    return (
      <Modal
        destroyOnHidden
        aria-label={t('admin.desktopBuild.release.title')}
        confirmLoading={submitting}
        maskTransitionName=""
        okText={t('admin.desktopBuild.release.confirm')}
        open={open}
        transitionName=""
        title={
          <span id="desktop-build-release-title">{t('admin.desktopBuild.release.title')}</span>
        }
        onCancel={submitting ? undefined : onClose}
        onOk={() => void handleCreate()}
      >
        <Form
          form={form}
          initialValues={{ channel: 'canary', releaseNotes: '', version: '2.4.0-canary.1' }}
          layout="vertical"
        >
          <Form.Item label={t('admin.desktopBuild.release.channel')} name="channel">
            <Radio.Group>
              <Radio.Button value="canary">{t('admin.desktopControl.status.canary')}</Radio.Button>
              <Radio.Button value="stable">{t('admin.desktopControl.status.stable')}</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label={t('admin.desktopBuild.release.version')}
            name="version"
            rules={[{ required: true }]}
          >
            <Input placeholder="2.4.0" />
          </Form.Item>
          <Form.Item label={t('admin.desktopBuild.release.notes')} name="releaseNotes">
            <Input.TextArea autoSize={{ maxRows: 4, minRows: 2 }} />
          </Form.Item>
        </Form>
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label={t('admin.desktopBuild.profile.revision')}>
            {profile.currentRevision || '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('admin.desktopBuild.applicationName')}>
            {payload.applicationName}
          </Descriptions.Item>
          <Descriptions.Item label={t('admin.desktopBuild.executableName')}>
            {payload.executableName}
          </Descriptions.Item>
          <Descriptions.Item label={t('admin.desktopBuild.release.artifact')}>
            {artifactName}
          </Descriptions.Item>
        </Descriptions>
        {!profile.firstStableReleaseAt ? (
          <p>{t('admin.desktopBuild.release.firstStableWarning')}</p>
        ) : null}
      </Modal>
    );
  },
);

CreateDesktopReleaseModal.displayName = 'CreateDesktopReleaseModal';

export default CreateDesktopReleaseModal;
