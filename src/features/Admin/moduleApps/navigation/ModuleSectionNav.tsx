'use client';

import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import {
  MODULE_ADMIN_ROUTE_PATHS,
  type ModuleAdminRouteId,
  type ModuleAdminSection,
} from './catalog';
import { getModuleAppSectionsForRole, getModuleCenterSectionsForRole } from './policy';

const styles = createStaticStyles(({ css, cssVar }) => ({
  group: css`
    display: grid;
    gap: 4px;
  `,
  groupLabel: css`
    padding-block: 6px;
    padding-inline: 10px;

    font-size: 12px;
    font-weight: 600;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
  link: css`
    display: flex;
    align-items: center;

    min-height: 36px;
    padding-block: 7px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 14px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &[aria-current='page'] {
      font-weight: 600;
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  nestedLink: css`
    padding-inline-start: 20px;
  `,
  nav: css`
    display: grid;
    gap: 8px;
    align-content: start;
    width: 100%;
  `,
}));

const CENTER_LABEL_KEYS: Partial<Record<ModuleAdminRouteId, string>> = {
  'module-artifacts': 'artifacts',
  'module-audit': 'audit',
  'module-apps': 'apps',
  'module-installs': 'installs',
  'module-overview': 'overview',
  'module-payments': 'payments',
  'module-payouts': 'payouts',
  'module-publishers': 'publishers',
  'module-records': 'records',
  'module-revenue': 'revenue',
  'module-reviews': 'reviews',
  'module-runs': 'runs',
};

const DETAIL_LABEL_KEYS: Partial<Record<ModuleAdminRouteId, string>> = {
  'module-app-configuration': 'configuration',
  'module-app-entitlements': 'entitlements',
  'module-app-overview': 'overview',
  'module-app-products': 'products',
  'module-app-runtime': 'runtime',
};

const FINANCE_IDS = new Set<ModuleAdminRouteId>([
  'module-revenue',
  'module-payments',
  'module-payouts',
]);
const OPERATIONS_IDS = new Set<ModuleAdminRouteId>([
  'module-installs',
  'module-records',
  'module-runs',
  'module-artifacts',
]);

export interface ModuleSectionNavProps {
  appId?: string;
  mode?: 'center' | 'detail';
  onNavigate?: () => void;
  role?: null | string;
  variant?: 'center' | 'detail';
}

const resolveDetailPath = (path: string, appId?: string) =>
  appId ? path.replace(':appId', encodeURIComponent(appId)) : path;

const ModuleSectionNav = memo<ModuleSectionNavProps>(
  ({ appId, mode, onNavigate, role, variant }) => {
    const { t } = useTranslation('common');
    const translate = (key: string) => t(key as any);
    const profileRole = useUserStore(
      (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
    );
    const resolvedRole = role ?? profileRole;
    const resolvedMode = mode ?? variant ?? 'center';
    const sections =
      resolvedMode === 'detail'
        ? getModuleAppSectionsForRole(resolvedRole)
        : getModuleCenterSectionsForRole(resolvedRole);
    const labelKeys = resolvedMode === 'detail' ? DETAIL_LABEL_KEYS : CENTER_LABEL_KEYS;

    const renderLink = (section: ModuleAdminSection, nested = false) => {
      const labelKey = labelKeys[section.id];
      if (!labelKey) return null;

      return (
        <NavLink
          end
          className={`${styles.link}${nested ? ` ${styles.nestedLink}` : ''}`}
          key={section.id}
          title={translate(`moduleApps.admin.center.sectionDescriptions.${labelKey}`)}
          to={resolveDetailPath(MODULE_ADMIN_ROUTE_PATHS[section.id], appId)}
          onClick={onNavigate}
        >
          {translate(
            `moduleApps.admin.center.${
              resolvedMode === 'detail' ? 'detailNavigation' : 'navigation'
            }.${labelKey}`,
          )}
        </NavLink>
      );
    };

    if (resolvedMode === 'detail') {
      return (
        <nav
          aria-label={translate('moduleApps.admin.center.detailNavigation.label')}
          className={styles.nav}
        >
          {sections.map((section) => renderLink(section))}
        </nav>
      );
    }

    const financeSections = sections.filter((section) => FINANCE_IDS.has(section.id));
    const operationsSections = sections.filter((section) => OPERATIONS_IDS.has(section.id));
    const ungroupedSections = sections.filter(
      (section) => !FINANCE_IDS.has(section.id) && !OPERATIONS_IDS.has(section.id),
    );

    return (
      <nav
        aria-label={translate('moduleApps.admin.center.navigation.label')}
        className={styles.nav}
      >
        {ungroupedSections
          .filter((section) => section.id !== 'module-audit')
          .map((section) => renderLink(section))}
        {financeSections.length ? (
          <div
            aria-label={translate('moduleApps.admin.center.navigation.finance')}
            className={styles.group}
            role="group"
          >
            <div className={styles.groupLabel}>
              {translate('moduleApps.admin.center.navigation.finance')}
            </div>
            {financeSections.map((section) => renderLink(section, true))}
          </div>
        ) : null}
        {operationsSections.length ? (
          <div
            aria-label={translate('moduleApps.admin.center.navigation.operations')}
            className={styles.group}
            role="group"
          >
            <div className={styles.groupLabel}>
              {translate('moduleApps.admin.center.navigation.operations')}
            </div>
            {operationsSections.map((section) => renderLink(section, true))}
          </div>
        ) : null}
        {ungroupedSections
          .filter((section) => section.id === 'module-audit')
          .map((section) => renderLink(section))}
      </nav>
    );
  },
);

ModuleSectionNav.displayName = 'ModuleSectionNav';

export default ModuleSectionNav;
