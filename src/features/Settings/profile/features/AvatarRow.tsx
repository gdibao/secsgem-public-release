'use client';

import { Avatar, Flexbox, Icon } from '@lobehub/ui';
import { Button, message, Modal, Upload } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2Icon, PencilIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/features/User/UserAvatar';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { saveToast } from '@/store/utils/saveToast';
import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

import ProfileRow from './ProfileRow';

const styles = createStaticStyles(({ css }) => ({
  overlay: css`
    cursor: pointer;

    position: absolute;
    z-index: 1;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    border-radius: 8px;

    opacity: 0;
    background: ${cssVar.colorBgMask};

    transition: opacity ${cssVar.motionDurationMid} ease;
  `,
  wrapper: css`
    cursor: pointer;
    position: relative;
    overflow: hidden;
    border-radius: 8px;

    &:hover .avatar-edit-overlay {
      opacity: 1;
    }
  `,
  presetGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 12px;
  `,
  presetItem: css`
    cursor: pointer;

    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    text-align: center;

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }
  `,
}));

const AvatarRow = () => {
  const { t } = useTranslation('auth');
  const isLogin = useUserStore(authSelectors.isLogin);
  const updateAvatar = useUserStore((s) => s.updateAvatar);
  const [uploading, setUploading] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [selectingPreset, setSelectingPreset] = useState<string | null>(null);
  const { data: profileOptions } = useClientDataSWR('profile-options', () =>
    adminCommercialService.getPublicProfileOptions(),
  );

  const saveAvatar = useCallback(
    async (avatar: string) => {
      try {
        setUploading(true);
        const img = new Image();
        img.src = avatar;

        await new Promise((resolve, reject) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', reject);
        });

        const webpBase64 = imageToBase64({ img, size: 256 });
        await updateAvatar(webpBase64);
      } catch (error) {
        console.error('Failed to upload avatar:', error);
        saveToast(error, {
          retry: () => void saveAvatar(avatar),
          title: t('profile.avatarUploadError'),
        });
      } finally {
        setUploading(false);
      }
    },
    [updateAvatar, t],
  );

  const handleUploadAvatar = useMemo(() => createUploadImageHandler(saveAvatar), [saveAvatar]);

  const canUpload = isLogin;

  const handleSelectPreset = async (avatar: string) => {
    try {
      setSelectingPreset(avatar);
      await updateAvatar(avatar);
      message.success(t('profile.avatarPresetSuccess', '头像已更新'));
      setPresetOpen(false);
    } catch (error) {
      saveToast(error, {
        retry: () => void handleSelectPreset(avatar),
        title: t('profile.avatarPresetError', '头像更新失败'),
      });
    } finally {
      setSelectingPreset(null);
    }
  };

  const avatarContent = canUpload ? (
    <Flexbox horizontal align="center" gap={8}>
      <Upload beforeUpload={handleUploadAvatar} itemRender={() => void 0} maxCount={1}>
        <div className={styles.wrapper}>
          <UserAvatar size={40} />
          <div
            className={`${styles.overlay} avatar-edit-overlay`}
            style={uploading ? { opacity: 1 } : undefined}
          >
            <Icon
              color={cssVar.colorTextLightSolid}
              icon={uploading ? Loader2Icon : PencilIcon}
              size={16}
              spin={uploading}
            />
          </div>
        </div>
      </Upload>
      <Button onClick={() => setPresetOpen(true)}>
        {t('profile.avatarPreset', '选择预设头像')}
      </Button>
      <Modal
        footer={null}
        open={presetOpen}
        title={t('profile.avatarPreset', '选择预设头像')}
        onCancel={() => setPresetOpen(false)}
      >
        <div className={styles.presetGrid}>
          {(profileOptions?.avatarPresets ?? []).map((item) => (
            <button
              className={styles.presetItem}
              disabled={selectingPreset === item.value}
              key={item.value}
              type="button"
              onClick={() => handleSelectPreset(item.value)}
            >
              <Flexbox align="center" gap={8}>
                <Avatar avatar={item.value} size={56} title={item.label} />
                <span>{item.label}</span>
              </Flexbox>
            </button>
          ))}
        </div>
      </Modal>
    </Flexbox>
  ) : (
    <UserAvatar size={40} />
  );

  return (
    <ProfileRow action={avatarContent} anchor={'profile-avatar'} label={t('profile.avatar')} />
  );
};

export default AvatarRow;
