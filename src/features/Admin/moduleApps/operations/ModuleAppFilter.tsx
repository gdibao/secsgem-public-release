'use client';

import { ADMIN_CAPABILITIES, hasAdminCapability } from '@lobechat/types';
import { Button, Input, Select } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { moduleAppCacheKeys } from '../shared/cacheKeys';
import { setFilter } from '../shared/queryState';
import type { AdminModuleAppDetail, AdminModuleAppItem } from '../types';

const styles = createStaticStyles(({ css }) => ({
  controls: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: end;
  `,
  field: css`
    display: grid;
    gap: 4px;
    min-width: min(280px, 100%);
  `,
}));

type AppFilterOption = Pick<AdminModuleAppItem, 'displayName' | 'id' | 'slug'>;
type AppListResponse = { items?: AppFilterOption[]; nextCursor?: null | string };

const mergeOptions = (current: AppFilterOption[], incoming: AppFilterOption[]) => {
  const byId = new Map(current.map((app) => [app.id, app]));
  let changed = false;

  for (const item of incoming) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
      changed = true;
    }
  }

  return changed ? [...byId.values()] : current;
};

const ModuleAppFilter = memo(() => {
  const { t: translate } = useTranslation('common');
  const t = (key: string) => translate(key as any);
  const [searchParams, setSearchParams] = useSearchParams();
  const role = useUserStore(
    (state) => (userProfileSelectors.userProfile(state) as { role?: string } | undefined)?.role,
  );
  const canReadApps = hasAdminCapability(role, ADMIN_CAPABILITIES.moduleAppRead);
  const appId = searchParams.get('appId') ?? undefined;
  const [manualAppId, setManualAppId] = useState(appId ?? '');
  const [appCursor, setAppCursor] = useState<string>();
  const [options, setOptions] = useState<AppFilterOption[]>([]);
  const appListKey = canReadApps ? moduleAppCacheKeys.apps('', appCursor) : null;
  const { data: appData, isLoading: appListLoading } = useClientDataSWR<AppListResponse>(
    appListKey,
    () =>
      adminCommercialService.moduleApps.list({
        cursor: appCursor,
        limit: 25,
      }) as Promise<AppListResponse>,
  );

  const appItemsRef = useRef(appData?.items);
  appItemsRef.current = appData?.items;
  const appItemsSignature = appData?.items
    ?.map((app) => `${app.id}\0${app.displayName}\0${app.slug}`)
    .join('\0');

  useEffect(() => {
    const incoming = appItemsRef.current;
    if (incoming) setOptions((current) => mergeOptions(current, incoming));
  }, [appItemsSignature]);

  const selectedInList = useMemo(() => options.some((app) => app.id === appId), [appId, options]);
  const selectedDetailKey =
    canReadApps && appId && !selectedInList && !appListLoading
      ? moduleAppCacheKeys.detail(appId)
      : null;
  const { data: selectedDetail } = useClientDataSWR<AdminModuleAppDetail | undefined>(
    selectedDetailKey,
    () => adminCommercialService.moduleApps.get({ appId: appId! }),
  );

  const selectedDetailId = selectedDetail?.id;
  const selectedDetailName = selectedDetail?.displayName;
  const selectedDetailSlug = selectedDetail?.slug;

  useEffect(() => {
    if (
      selectedDetailId &&
      selectedDetailName &&
      selectedDetailSlug &&
      appId === selectedDetailId
    ) {
      setOptions((current) =>
        mergeOptions(
          [
            {
              displayName: selectedDetailName,
              id: selectedDetailId,
              slug: selectedDetailSlug,
            },
          ],
          current,
        ),
      );
    }
  }, [appId, selectedDetailId, selectedDetailName, selectedDetailSlug]);

  const selectApp = (nextAppId: string) => {
    setSearchParams((current) => setFilter(current, 'appId', nextAppId || undefined));
  };

  useEffect(() => setManualAppId(appId ?? ''), [appId]);

  return (
    <div className={styles.controls} data-testid="module-app-filter">
      <label className={styles.field}>
        <span>{t('moduleApps.admin.operations.filterLabel')}</span>
        {canReadApps ? (
          <Select
            aria-label={t('moduleApps.admin.operations.filterLabel')}
            value={appId ?? ''}
            options={[
              { label: t('moduleApps.admin.operations.selectApp'), value: '' },
              ...options.map((app) => ({
                label: app.displayName || app.slug,
                value: app.id,
              })),
            ]}
            onChange={(value) => selectApp(String(value ?? ''))}
          />
        ) : (
          <Input
            aria-label={t('moduleApps.admin.operations.filterLabel')}
            value={manualAppId}
            onChange={(event) => setManualAppId(event.target.value)}
          />
        )}
      </label>
      {!canReadApps ? (
        <Button
          disabled={!manualAppId.trim() || manualAppId.trim() === appId}
          onClick={() => selectApp(manualAppId.trim())}
        >
          {t('moduleApps.admin.operations.applyAppId')}
        </Button>
      ) : null}
      {canReadApps && appData?.nextCursor ? (
        <Button onClick={() => setAppCursor(appData.nextCursor ?? undefined)}>
          {t('moduleApps.admin.operations.loadMoreApps')}
        </Button>
      ) : null}
    </div>
  );
});

ModuleAppFilter.displayName = 'ModuleAppFilter';

export default ModuleAppFilter;
