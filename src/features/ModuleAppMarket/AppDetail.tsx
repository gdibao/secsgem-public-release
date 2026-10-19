import type {
  ModuleAppGrantSnapshot,
  ModuleAppInstallationReadiness,
  PaymentCreateResult,
  PaymentMethodId,
} from '@lobechat/types';
import { A } from '@lobehub/ui';
import { Button, buttonStyles, confirmModal, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { Archive, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import useSWR from 'swr';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { MobileStateView } from '@/features/MobileWorkspace/components';
import { moduleAppService } from '@/services/moduleApp';

import InstallationSecrets from './InstallationSecrets';
import PurchaseModal, { type ModuleAppCatalogItem } from './PurchaseModal';

type VersionGrantChange = {
  added: ModuleAppGrantSnapshot;
  hasExpansion: boolean;
  targetSnapshot: ModuleAppGrantSnapshot;
};

type ModuleAppVersionOption = {
  grantChange?: VersionGrantChange;
  id: string;
  version: string;
};

type ModuleAppDetailData = {
  actions: unknown[];
  canManageInstallation?: boolean;
  canManageInstallationSecrets?: boolean;
  category: string;
  description?: string;
  displayName: string;
  id: string;
  installationId?: string;
  installed?: boolean;
  installedVersion?: { id: string; version: string };
  installationReadiness?: ModuleAppInstallationReadiness;
  publishedVersion?: ModuleAppVersionOption | null;
  rollbackVersions?: ModuleAppVersionOption[];
  source?: string;
  updateAvailable?: boolean;
  version?: string;
};

type ModuleAppLicenseData = {
  endsAt?: Date | string | null;
  status?: string;
};

type ModuleAppOrderData = {
  appId: string;
  id: string;
  status: 'cancelled' | 'paid' | 'pending' | 'refunded';
  workspaceId?: null | string;
};

const isOrderInScope = (order: ModuleAppOrderData, appId?: string, workspaceId?: string) =>
  order.appId === appId && (workspaceId ? order.workspaceId === workspaceId : !order.workspaceId);

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;

    & > :where(a, button) {
      min-height: 44px;
    }

    @media (width < 600px) {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      width: 100%;

      & > :where(a, button) {
        width: 100%;
      }
    }
  `,
  description: css`
    margin: 0;

    font-size: 14px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  error: css`
    margin: 0;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 13px;
    line-height: 20px;
    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  grantList: css`
    display: grid;
    gap: 6px;

    margin-block: 12px 0;
    padding-inline-start: 20px;

    overflow-wrap: anywhere;
  `,
  frame: css`
    display: flex;
    flex-direction: column;
    gap: 20px;

    box-sizing: border-box;
    width: 100%;
    max-width: 960px;
    margin-inline: auto;
    padding: 16px;

    @media (width >= 768px) {
      padding: 24px;
    }
  `,
  header: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: start;

    @media (width < 600px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  intro: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  `,
  loading: css`
    display: grid;
    place-items: center;
    min-height: 240px;
  `,
  metadata: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 24px;

    min-width: 0;
    margin: 0;

    @media (width < 600px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  metadataItem: css`
    display: grid;
    grid-template-columns: minmax(88px, auto) minmax(0, 1fr);
    gap: 12px;
    align-items: center;

    min-width: 0;
    min-height: 48px;
    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    & > dt {
      font-size: 13px;
      color: ${cssVar.colorTextSecondary};
    }

    & > dd {
      min-width: 0;
      margin: 0;

      color: ${cssVar.colorText};
      text-align: end;
      overflow-wrap: anywhere;
    }
  `,
  notice: css`
    margin: 0;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 13px;
    line-height: 20px;
    color: ${cssVar.colorWarning};

    background: ${cssVar.colorWarningBg};
  `,
  source: css`
    display: inline-flex;

    padding-block: 2px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};

    background: ${cssVar.colorFillSecondary};
  `,
  title: css`
    margin: 0;

    font-size: 24px;
    font-weight: 600;
    line-height: 32px;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
}));

const ModuleAppDetail = memo(() => {
  const { appId } = useParams();
  const [searchParams] = useSearchParams();
  const workspaceId = searchParams.get('workspaceId') || undefined;
  const { t } = useTranslation('common');
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [installationLoading, setInstallationLoading] = useState(false);
  const [uninstallError, setUninstallError] = useState(false);
  const [versionChangeError, setVersionChangeError] = useState(false);
  const detail = useSWR<ModuleAppDetailData>(
    appId ? ['moduleApp.getDetail', appId, workspaceId] : null,
    () =>
      moduleAppService.getDetail({
        appIdOrSlug: appId!,
        workspaceId,
      }) as Promise<ModuleAppDetailData>,
  );
  const catalog = useSWR<ModuleAppCatalogItem[]>(
    appId ? ['moduleApp.listCatalog', appId] : null,
    () => moduleAppService.listCatalog({ appId }) as Promise<ModuleAppCatalogItem[]>,
  );
  const license = useSWR<ModuleAppLicenseData | null>(
    appId ? ['moduleApp.getLicense', appId, workspaceId] : null,
    () =>
      moduleAppService.getLicense({
        appId: appId!,
        workspaceId,
      }) as Promise<ModuleAppLicenseData | null>,
  );
  const orders = useSWR<ModuleAppOrderData[]>(
    appId ? ['moduleApp.listOrders', appId, workspaceId] : null,
    () => moduleAppService.listOrders({ limit: 100 }) as Promise<ModuleAppOrderData[]>,
    {
      refreshInterval: (data) =>
        data?.some(
          (order) =>
            isOrderInScope(order, detail.data?.id, workspaceId) && order.status === 'pending',
        )
          ? 5000
          : 0,
      revalidateOnFocus: true,
    },
  );
  const scopedCatalog = useMemo(
    () =>
      catalog.data?.filter((item) =>
        workspaceId ? item.licenseScope !== 'personal' : item.licenseScope === 'personal',
      ) ?? [],
    [catalog.data, workspaceId],
  );
  const latestOrder = useMemo(
    () => orders.data?.find((order) => isOrderInScope(order, detail.data?.id, workspaceId)),
    [detail.data?.id, orders.data, workspaceId],
  );
  const licenseData = license.data;
  const licenseLoading = license.isLoading;
  const refreshLicense = license.mutate;
  const commerceLoading = Boolean(catalog.isLoading || licenseLoading || orders.isLoading);

  useEffect(() => {
    if (latestOrder?.status === 'paid' && !licenseData && !licenseLoading) {
      void refreshLicense();
    }
  }, [latestOrder?.status, licenseData, licenseLoading, refreshLicense]);

  if (detail.isLoading)
    return (
      <div aria-label={t('moduleApps.market.loading')} className={styles.loading} role="status">
        <NeuralNetworkLoading size={40} />
      </div>
    );
  if (detail.error || !detail.data) {
    return (
      <MobileStateView
        title={t('moduleApps.market.loadError')}
        variant="error"
        action={{
          label: t('moduleApps.market.retry'),
          onClick: () => void detail.mutate(),
        }}
      />
    );
  }
  const detailData = detail.data;

  const createOrder = async (input: {
    idempotencyKey: string;
    productId: string;
    workspaceId?: string;
  }) => {
    const order = (await moduleAppService.createOrder(input)) as ModuleAppOrderData;
    await orders.mutate();
    return order;
  };
  const createPayment = (input: {
    method?: PaymentMethodId;
    orderId: string;
  }): Promise<PaymentCreateResult> => moduleAppService.createPayment(input);
  const install = async ({
    appId: installAppId,
    workspaceId: installWorkspaceId,
  }: {
    appId: string;
    workspaceId?: string;
  }) => {
    setInstallationLoading(true);
    try {
      if (installWorkspaceId) {
        await moduleAppService.installWorkspace({
          appId: installAppId,
          workspaceId: installWorkspaceId,
        });
      } else {
        await moduleAppService.installPersonal({ appId: installAppId });
      }
      await detail.mutate();
    } finally {
      setInstallationLoading(false);
    }
  };
  const performUninstall = async (dataPolicy: 'delete' | 'retain') => {
    setInstallationLoading(true);
    setUninstallError(false);
    try {
      if (workspaceId) {
        await moduleAppService.uninstallWorkspace({
          appId: detailData.id,
          dataPolicy,
          workspaceId,
        });
      } else {
        await moduleAppService.uninstallPersonal({ appId: detailData.id, dataPolicy });
      }
      toast.success(t('moduleApps.market.uninstallSuccess'));
      await Promise.allSettled([detail.mutate(), refreshLicense()]);
    } catch {
      setUninstallError(true);
    } finally {
      setInstallationLoading(false);
    }
  };
  const uninstall = (dataPolicy: 'delete' | 'retain') => {
    setUninstallError(false);
    setVersionChangeError(false);
    confirmModal({
      content: t(
        dataPolicy === 'delete'
          ? 'moduleApps.market.uninstallDeleteConfirmContent'
          : 'moduleApps.market.uninstallRetainConfirmContent',
      ),
      okButtonProps: { danger: true },
      okText: t(
        dataPolicy === 'delete'
          ? 'moduleApps.market.uninstallDelete'
          : 'moduleApps.market.uninstallRetain',
      ),
      onOk: () => performUninstall(dataPolicy),
      title: t('moduleApps.market.uninstallConfirmTitle', { name: detailData.displayName }),
    });
  };
  const performVersionChange = async (
    operation: 'rollback' | 'upgrade',
    targetVersionId?: string,
    acceptedGrantSnapshot?: ModuleAppGrantSnapshot,
  ) => {
    if (!detailData.installedVersion) return;

    setInstallationLoading(true);
    setUninstallError(false);
    setVersionChangeError(false);
    try {
      await moduleAppService.changeInstallationVersion({
        appId: detailData.id,
        acceptedGrantSnapshot,
        expectedVersionId: detailData.installedVersion.id,
        operation,
        targetVersionId,
        workspaceId,
      });
      await detail.mutate();
    } catch {
      setVersionChangeError(true);
    } finally {
      setInstallationLoading(false);
    }
  };
  const changeVersion = (
    operation: 'rollback' | 'upgrade',
    version: ModuleAppVersionOption | null | undefined,
  ) => {
    if (!version) return;
    const grantChange = version.grantChange;
    if (!grantChange?.hasExpansion) {
      void performVersionChange(operation, operation === 'rollback' ? version.id : undefined);
      return;
    }

    const expandedGrants = Object.entries(grantChange.added).filter(
      ([, items]) => items.length > 0,
    );
    confirmModal({
      content: (
        <div>
          <p>{t('moduleApps.market.grantConfirmContent')}</p>
          <ul className={styles.grantList}>
            {expandedGrants.map(([dimension, items]) => (
              <li key={dimension}>
                <strong>{t(`moduleApps.market.grants.${dimension}` as any)}</strong>
                {`: ${items.join(', ')}`}
              </li>
            ))}
          </ul>
        </div>
      ),
      okText: t('moduleApps.market.grantConfirmAction'),
      onOk: () =>
        performVersionChange(
          operation,
          operation === 'rollback' ? version.id : undefined,
          grantChange.targetSnapshot,
        ),
      title: t('moduleApps.market.grantConfirmTitle', { version: version.version }),
    });
  };
  const cancelOrder = async (orderId: string) => {
    await moduleAppService.cancelOrder({ orderId });
    await orders.mutate();
  };
  const canManageInstallation = detailData.canManageInstallation !== false;
  const rollbackVersions = detailData.rollbackVersions ?? [];
  const runtimeUnavailable = detailData.installationReadiness?.runtime === 'unavailable';
  const configurationState = detailData.installationReadiness?.configuration;

  return (
    <main className={styles.frame} data-testid="module-app-detail">
      <header className={styles.header}>
        <div className={styles.intro}>
          <h1 className={styles.title}>{detailData.displayName}</h1>
          {detailData.description ? (
            <p className={styles.description}>{detailData.description}</p>
          ) : null}
        </div>
        <div className={styles.actions} data-testid="module-app-detail-actions">
          {detailData.installed ? (
            <>
              {runtimeUnavailable ? (
                <Button disabled data-button-type="primary" type="primary">
                  {t('moduleApps.market.open')}
                </Button>
              ) : (
                <A
                  data-button-type="primary"
                  href={`/apps/${detailData.id}/app${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`}
                  className={cx(
                    buttonStyles.base,
                    buttonStyles.sizeMiddle,
                    buttonStyles.variantPrimary,
                  )}
                >
                  {t('moduleApps.market.open')}
                </A>
              )}
              {canManageInstallation && detailData.updateAvailable ? (
                <Button
                  icon={<RefreshCw aria-hidden size={16} />}
                  loading={installationLoading}
                  onClick={() => changeVersion('upgrade', detailData.publishedVersion)}
                >
                  {t('moduleApps.market.update')}
                </Button>
              ) : null}
              {canManageInstallation && rollbackVersions.length > 0 ? (
                <DropdownMenu
                  nativeButton={false}
                  placement="bottomRight"
                  items={rollbackVersions.map((version) => ({
                    icon: <RotateCcw aria-hidden size={16} />,
                    key: version.id,
                    label: t('moduleApps.market.rollbackTo', { version: version.version }),
                    onClick: () => changeVersion('rollback', version),
                  }))}
                >
                  <Button disabled={installationLoading} icon={<RotateCcw aria-hidden size={16} />}>
                    {t('moduleApps.market.rollback')}
                  </Button>
                </DropdownMenu>
              ) : null}
              {canManageInstallation ? (
                <Button
                  icon={<Archive aria-hidden size={16} />}
                  loading={installationLoading}
                  onClick={() => uninstall('retain')}
                >
                  {t('moduleApps.market.uninstallRetain')}
                </Button>
              ) : null}
              {canManageInstallation ? (
                <Button
                  danger
                  icon={<Trash2 aria-hidden size={16} />}
                  loading={installationLoading}
                  onClick={() => uninstall('delete')}
                >
                  {t('moduleApps.market.uninstallDelete')}
                </Button>
              ) : null}
            </>
          ) : canManageInstallation && licenseData ? (
            <Button
              data-button-type="primary"
              loading={installationLoading}
              type="primary"
              onClick={() => install({ appId: detailData.id, workspaceId })}
            >
              {t('moduleApps.purchase.install')}
            </Button>
          ) : canManageInstallation ? (
            <Button
              data-button-type="primary"
              disabled={commerceLoading}
              loading={commerceLoading}
              type="primary"
              onClick={() => setPurchaseOpen(true)}
            >
              {latestOrder?.status === 'pending'
                ? t('moduleApps.purchase.pending')
                : t('moduleApps.purchase.title')}
            </Button>
          ) : null}
        </div>
      </header>
      {versionChangeError || uninstallError ? (
        <p className={styles.error} role="alert">
          {t(
            uninstallError
              ? 'moduleApps.market.uninstallError'
              : 'moduleApps.market.versionChangeError',
          )}
        </p>
      ) : null}
      {detailData.installed && runtimeUnavailable ? (
        <p className={styles.error} role="alert">
          {t('moduleApps.readiness.runtimeUnavailableDescription')}
        </p>
      ) : detailData.installed && configurationState === 'invalid' ? (
        <p className={styles.error} role="alert">
          {t('moduleApps.readiness.configurationInvalid')}
        </p>
      ) : detailData.installed && configurationState === 'required' ? (
        <p className={styles.notice} role="status">
          {t(
            detailData.canManageInstallationSecrets === true
              ? 'moduleApps.readiness.configurationRequiredManager'
              : 'moduleApps.readiness.configurationRequiredMember',
          )}
        </p>
      ) : null}
      <dl className={styles.metadata} data-testid="module-app-detail-metadata">
        <div className={styles.metadataItem} data-testid="module-app-detail-metadata-item">
          <dt>{t('moduleApps.market.category')}</dt>
          <dd>{detailData.category}</dd>
        </div>
        <div className={styles.metadataItem} data-testid="module-app-detail-metadata-item">
          <dt>{t('moduleApps.market.version')}</dt>
          <dd>{detailData.installedVersion?.version ?? detailData.version}</dd>
        </div>
        <div className={styles.metadataItem} data-testid="module-app-detail-metadata-item">
          <dt>{t('moduleApps.market.source')}</dt>
          <dd>
            <span className={styles.source}>{detailData.source ?? 'admin'}</span>
          </dd>
        </div>
        <div className={styles.metadataItem} data-testid="module-app-detail-metadata-item">
          <dt>{t('moduleApps.market.actions')}</dt>
          <dd>{detailData.actions.length}</dd>
        </div>
      </dl>
      {detailData.installed &&
      detailData.canManageInstallationSecrets === true &&
      detailData.installationId ? (
        <InstallationSecrets
          installationId={detailData.installationId}
          key={detailData.installationId}
          workspaceId={workspaceId}
          onChange={() => detail.mutate()}
        />
      ) : null}
      <PurchaseModal
        catalog={scopedCatalog}
        license={licenseData}
        loading={orders.isValidating}
        open={purchaseOpen}
        order={latestOrder}
        workspaceId={workspaceId}
        onCancelOrder={cancelOrder}
        onClose={() => setPurchaseOpen(false)}
        onCreateOrder={createOrder}
        onCreatePayment={createPayment}
        onInstall={install}
      />
    </main>
  );
});

ModuleAppDetail.displayName = 'ModuleAppDetail';

export default ModuleAppDetail;
