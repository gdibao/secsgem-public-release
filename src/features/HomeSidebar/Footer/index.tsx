'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { type MenuProps } from '@lobehub/ui';
import { DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { DiscordIcon, GithubIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import { Book, CircleHelp, Crown, Download, Feather, FileClockIcon, FlaskConical, Send, Settings2, SettingsIcon, Sparkles } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { openChangelogModal } from '@/components/ChangelogModal';
import { openFeedbackModal } from '@/components/FeedbackModal';
import { PUBLIC_HELP_MENU_SWR_KEY } from '@/const/adminCacheKeys';
import { DOCUMENTS_REFER_URL, GITHUB } from '@/const/url';
import Billboard from '@/features/Billboard';
import { useBillboardMenuItems } from '@/features/Billboard/MenuItems';
import { useBrand } from '@/features/Brand';
import { useActiveNavKey } from '@/features/NavPanel/useActiveNavKey';
import { buildCustomHelpMenuItems } from '@/features/User/helpMenuItems';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useNavLayout } from '@/hooks/useNavLayout';
import { adminCommercialService } from '@/services/adminCommercial';
import { useAnalytics } from '@/libs/analytics/client';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { createConfiguredHelpMenuItems } from './helpMenuItems';

const styles = createStaticStyles(({ css, cssVar }) => ({
  memberCard: css`isolation: isolate; position: relative; overflow: hidden; margin-block-end: 4px; padding: 10px; border-radius: 8px; background: ${cssVar.colorFillQuaternary}; box-shadow: 0 6px 18px ${cssVar.colorWarningBg}; transition: transform 160ms ease, background 160ms ease; &:hover { transform: translateY(-1px); background: ${cssVar.colorFillTertiary}; } @media (prefers-reduced-motion: reduce) { transition: none; &:hover { transform: none; } }`,
  memberDescription: css`font-size: 12px; line-height: 1.45; color: ${cssVar.colorTextDescription};`,
  memberIcon: css`color: ${cssVar.colorWarning}; filter: drop-shadow(0 2px 4px ${cssVar.colorWarningBg});`,
  memberLink: css`display: block; padding-inline: 8px; color: inherit; text-decoration: none;`,
  memberSparkle: css`margin-inline-start: auto; color: ${cssVar.colorWarning}; opacity: 0.72;`,
  memberTitle: css`font-size: 13px; line-height: 1.3;`,
}));

type FooterMenuItems = NonNullable<MenuProps['items']>;
const injectMenuTracking = (items: FooterMenuItems, track: (key: string) => void): FooterMenuItems => items.map((item) => {
  if (!item || (item as { type?: string }).type === 'divider') return item;
  const key = (item as { key?: string | number }).key;
  if (!key) return item;
  const originalOnClick = (item as { onClick?: (info: unknown) => void }).onClick;
  return { ...item, onClick: (info: unknown) => { track(String(key)); originalOnClick?.(info); } };
});
const collectMenuKeys = (items: FooterMenuItems): string[] => items.filter((item) => item && (item as { type?: string }).type !== 'divider').map((item) => (item as { key?: string | number }).key).filter((key): key is string | number => Boolean(key)).map(String);

const Footer = memo(() => {
  const { t } = useTranslation('common');
  const { analytics } = useAnalytics();
  const { footer } = useNavLayout();
  const brand = useBrand();
  const hasActiveWorkspace = useHasActiveWorkspace();
  const settingLabelKey = hasActiveWorkspace ? 'userPanel.workspaceSetting' : 'userPanel.setting';
  const isHomeSidebar = useActiveNavKey() === 'home';
  const billboardMenuItems = useBillboardMenuItems();
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const customization = useServerConfigStore((s) => s.serverConfig.customization);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const { data: configuredHelpMenuItems } = useSWR(PUBLIC_HELP_MENU_SWR_KEY, () => adminCommercialService.getPublicHelpMenu());
  const trackMenuClick = useCallback((key: string) => { try { analytics?.track({ name: 'home_footer_menu_clicked', properties: { key, spm: `homepage.footer.${key}.clicked` } }); } catch { /* analytics must not affect the menu */ } }, [analytics]);
  const handleOpenChangelogModal = useCallback(() => { openChangelogModal(); }, []);
  const handleOpenFeedbackModal = useCallback(() => { openFeedbackModal(); }, []);
  const customHelpItems = useMemo(() => buildCustomHelpMenuItems(customization?.helpMenuItems), [customization?.helpMenuItems]);
  const defaultHelpMenuItems = useMemo<FooterMenuItems>(() => [
    ...(footer.showSettingsEntry && !isDevMode ? [{ icon: <Icon icon={Settings2} />, key: 'setting', label: <WorkspaceLink to="/settings">{t(settingLabelKey)}</WorkspaceLink> }, { type: 'divider' as const }] : []),
    ...(enableBusinessFeatures ? [{ icon: <Icon icon={Send} />, key: 'inviteFriend', label: <WorkspaceLink to="/settings/referral">{t('userPanel.inviteFriend')}</WorkspaceLink> }] : []),
    ...(customHelpItems.length > 0 ? customHelpItems : [
      { icon: <Icon icon={Book} />, key: 'docs', label: <a href={DOCUMENTS_REFER_URL} rel="noopener noreferrer" target="_blank">{t('userPanel.docs')}</a> },
      { icon: <Icon icon={Feather} />, key: 'feedback', label: t('userPanel.feedback'), onClick: handleOpenFeedbackModal },
      ...(SOCIAL_URL.discord ? [{ icon: <Icon icon={DiscordIcon} />, key: 'discord', label: <a href={SOCIAL_URL.discord} rel="noopener noreferrer" target="_blank">{t('userPanel.discord')}</a> }] : []),
      { type: 'divider' as const },
      { icon: <Icon icon={FileClockIcon} />, key: 'changelog', label: t('changelog'), onClick: handleOpenChangelogModal },
      ...(footer.layout === 'compact' ? [{ icon: <Icon icon={Download} />, key: 'get-app', label: <WorkspaceLink escape to="/apps">{t('getApp')}</WorkspaceLink> }] : []),
      ...(footer.layout === 'compact' && !footer.hideGitHub ? [{ icon: <Icon icon={GithubIcon} />, key: 'github', label: <a href={GITHUB} rel="noopener noreferrer" target="_blank">GitHub</a> }] : []),
      ...(footer.showEvalEntry && footer.layout === 'compact' ? [{ icon: <Icon icon={FlaskConical} />, key: 'eval', label: <WorkspaceLink to="/eval">Evaluation Lab</WorkspaceLink> }] : []),
    ]),
  ], [customHelpItems, enableBusinessFeatures, footer.hideGitHub, footer.layout, footer.showEvalEntry, footer.showSettingsEntry, handleOpenChangelogModal, handleOpenFeedbackModal, isDevMode, settingLabelKey, t]);
  const configuredMenuItems = useMemo(() => Array.isArray(configuredHelpMenuItems) ? createConfiguredHelpMenuItems(configuredHelpMenuItems, { onChangelog: handleOpenChangelogModal, onFeedback: handleOpenFeedbackModal, onProductHunt: () => {} }) : [], [configuredHelpMenuItems, handleOpenChangelogModal, handleOpenFeedbackModal]);
  const { helpMenuItems, trackedMenuKeys } = useMemo(() => { const ownItems = (Array.isArray(configuredHelpMenuItems) ? configuredMenuItems : defaultHelpMenuItems) as FooterMenuItems; return { helpMenuItems: [...injectMenuTracking(ownItems, trackMenuClick), ...(isHomeSidebar && billboardMenuItems?.length ? [{ type: 'divider' as const }, ...billboardMenuItems] : [])], trackedMenuKeys: collectMenuKeys(ownItems) }; }, [billboardMenuItems, configuredHelpMenuItems, configuredMenuItems, defaultHelpMenuItems, isHomeSidebar, trackMenuClick]);
  const handleMenuOpenChange = useCallback((open: boolean) => { if (!open) return; try { analytics?.track({ name: 'home_footer_menu_opened', properties: { keys: trackedMenuKeys.join(','), spm: 'homepage.footer.opened' } }); } catch { /* analytics must not affect the menu */ } }, [analytics, trackedMenuKeys]);
  return <>
    {isHomeSidebar && enableBusinessFeatures && <WorkspaceLink className={styles.memberLink} to={brand.sidebarMemberUrl || '/settings/plans'}><Flexbox className={styles.memberCard} gap={5}><Flexbox horizontal align="center" gap={6}><Icon className={styles.memberIcon} icon={Crown} size={15} /><strong className={styles.memberTitle}>{brand.sidebarMemberLabel || '升级方案'}</strong><Icon className={styles.memberSparkle} icon={Sparkles} size={13} /></Flexbox><span className={styles.memberDescription}>解锁更多容量与高级功能。</span></Flexbox></WorkspaceLink>}
    {footer.layout === 'expanded' ? <Flexbox horizontal align="center" gap={2} justify="space-between" padding={8}><Flexbox horizontal align="center" flex={1} gap={2}><DropdownMenu items={helpMenuItems} placement="topLeft" onOpenChange={handleMenuOpenChange}><ActionIcon aria-label={t('userPanel.help')} data-billboard-anchor="" icon={CircleHelp} size={16} /></DropdownMenu>{!footer.hideGitHub && <a aria-label="GitHub" href={GITHUB} rel="noopener noreferrer" target="_blank"><ActionIcon icon={GithubIcon} size={16} title="GitHub" /></a>}<WorkspaceLink to="/eval"><ActionIcon icon={FlaskConical} size={16} title="Evaluation Lab" /></WorkspaceLink></Flexbox><ThemeButton placement="topCenter" size={16} /></Flexbox> : <Flexbox horizontal align="center" gap={2} padding={8}><DropdownMenu items={helpMenuItems} placement="topLeft" onOpenChange={handleMenuOpenChange}><ActionIcon aria-label={t('userPanel.help')} icon={CircleHelp} size={16} /></DropdownMenu>{isDevMode && <WorkspaceLink to="/settings"><ActionIcon aria-label={t(settingLabelKey)} icon={SettingsIcon} size={16} title={t(settingLabelKey)} /></WorkspaceLink>}</Flexbox>}
    {isHomeSidebar && <Billboard />}
  </>;
});

export default Footer;
