'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Segmented, type SegmentedOptions, Select, type SelectProps } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ImageIcon, Presentation, Video } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

export interface GenerationMediaModeSegmentProps {
  /** `hero`: large labeled headline select. `toolbar`: compact icon-only toggle group. */
  layout?: 'hero' | 'toolbar';
  mode: 'image' | 'ppt' | 'video';
}

const styles = createStaticStyles(({ css }) => ({
  heroSelect: css`
    width: auto;
    font-size: inherit;
    line-height: 1.2;
  `,
  heroText: css`
    font-size: 24px;
    font-weight: 600;
    line-height: 1.2;
  `,
  toolbarItem: css`
    width: 30px;
    height: 30px;
    padding-inline: 0;
  `,
  toolbarLabel: css`
    display: none;
  `,
}));

const GenerationMediaModeSegment = memo<GenerationMediaModeSegmentProps>(
  ({ mode, layout = 'toolbar' }) => {
    const { t } = useTranslation('common');
    const navigate = useWorkspaceAwareNavigate();
    const isHero = layout === 'hero';

    const heroOptions = useMemo<SelectProps['options']>(
      () => [
        {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <span className={styles.heroText}>{t('tab.image')}</span>
            </Flexbox>
          ),
          value: 'image',
        },
        {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <span className={styles.heroText}>{t('tab.video')}</span>
            </Flexbox>
          ),
          value: 'video',
        },
        {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              {!isHero && <Icon icon={Presentation} />}
              <span className={isHero ? styles.heroText : undefined}>{t('tab.ppt')}</span>
            </Flexbox>
          ),
          value: 'ppt',
        },
      ],
      [isHero, t],
    );

    const toolbarOptions = useMemo<SegmentedOptions<'image' | 'ppt' | 'video'>>(
      () => [
        {
          icon: <Icon icon={ImageIcon} size={16} />,
          label: t('tab.image'),
          title: t('tab.image'),
          value: 'image',
        },
        {
          icon: <Icon icon={Video} size={16} />,
          label: t('tab.video'),
          title: t('tab.video'),
          value: 'video',
        },
        {
          icon: <Icon icon={Presentation} size={16} />,
          label: t('tab.ppt'),
          title: t('tab.ppt'),
          value: 'ppt',
        },
      ],
      [t],
    );

    const labelRender: SelectProps['labelRender'] = useCallback(
      (props: any) => {
        const v = String((props as { value?: string }).value ?? '');
        const text = v === 'video' ? t('tab.video') : v === 'ppt' ? t('tab.ppt') : t('tab.image');
        const icon = v === 'video' ? Video : v === 'ppt' ? Presentation : ImageIcon;
        if (isHero) {
          return (
            <span
              style={{
                fontSize: 'inherit',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {text}
            </span>
          );
        }
        return (
          <Flexbox horizontal align="center" gap={6}>
            <Icon icon={icon} size={16} />
            <span style={{ whiteSpace: 'nowrap' }}>{text}</span>
          </Flexbox>
        );
      },
      [isHero, t],
    );

    const handleChange = useCallback(
      (value: string) => {
        if (value === mode) return;
        const pathMap = { image: '/image', ppt: '/ppt', video: '/video' } as const;
        navigate(pathMap[value as keyof typeof pathMap] ?? '/image');
      },
      [mode, navigate],
    );

    if (!isHero)
      return (
        <Segmented<'image' | 'ppt' | 'video'>
          classNames={{ item: styles.toolbarItem, itemLabel: styles.toolbarLabel }}
          options={toolbarOptions}
          size={'small'}
          value={mode}
          onChange={handleChange}
        />
      );

    return (
      <Select
        className={styles.heroSelect}
        labelRender={labelRender}
        options={heroOptions}
        popupMatchSelectWidth={false}
        size={'large'}
        value={mode}
        variant={'borderless'}
        onChange={handleChange}
      />
    );
  },
);

GenerationMediaModeSegment.displayName = 'GenerationMediaModeSegment';

export default GenerationMediaModeSegment;
