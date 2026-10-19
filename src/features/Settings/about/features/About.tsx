'use client';

import { SiDiscord, SiGithub, SiRss, SiX, SiYoutube } from '@icons-pack/react-simple-icons';
import { Flexbox, Form } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  type AboutLinkId,
  DEFAULT_ABOUT_LINKS,
  normalizeAboutLinksConfig,
} from '@/const/aboutLinks';
import { useBrand, useBrandName } from '@/features/Brand';
import { lambdaClient } from '@/libs/trpc/client';

import AboutList from './AboutList';
import ItemCard from './ItemCard';
import ItemLink from './ItemLink';
import Version from './Version';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    font-size: 14px;
    font-weight: bold;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const iconMap: Partial<Record<AboutLinkId, any>> = {
  blog: SiRss,
  discord: SiDiscord,
  github: SiGithub,
  x: SiX as any,
  youtube: SiYoutube,
};

const About = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('common');
  const brand = useBrand();
  const brandingName = useBrandName();
  const { data } = useSWR('about-links', () =>
    lambdaClient.admin.settings.getPublicAboutLinks.query(),
  );
  const aboutLinks = normalizeAboutLinksConfig(
    data && typeof data === 'object' && 'links' in data ? data.links : data ?? DEFAULT_ABOUT_LINKS,
  );
  const aboutLogoUrl =
    data && typeof data === 'object' && 'logoUrl' in data && typeof data.logoUrl === 'string'
      ? data.logoUrl
      : brand.logoUrl;

  return (
    <Form.Group
      collapsible={false}
      gap={16}
      style={{ maxWidth: '1024px', width: '100%' }}
      title={`${t('about')} ${brandingName}`}
      variant={'filled'}
    >
      <Flexbox gap={20} paddingBlock={20} width={'100%'}>
        <div className={styles.title}>{t('version')}</div>
        <Version logoUrl={aboutLogoUrl} mobile={mobile} />
        <Divider style={{ marginBlock: 0 }} />
        <div className={styles.title}>{t('contact')}</div>
        <AboutList
          ItemRender={ItemLink}
          items={aboutLinks.contact.map((item) => ({
            href: item.url,
            label: item.label,
            value: item.id,
          }))}
        />
        <Divider style={{ marginBlock: 0 }} />
        <div className={styles.title}>{t('information')}</div>
        <AboutList
          grid
          ItemRender={ItemCard}
          items={aboutLinks.information.map((item) => ({
            href: item.url,
            icon: iconMap[item.id],
            label: item.label,
            value: item.id,
          }))}
        />
        <Divider style={{ marginBlock: 0 }} />
        <div className={styles.title}>{t('legal')}</div>
        <AboutList
          ItemRender={ItemLink}
          items={aboutLinks.legal.map((item) => ({
            href: item.url,
            label: item.label,
            value: item.id,
          }))}
        />
      </Flexbox>
    </Form.Group>
  );
});

export default About;
