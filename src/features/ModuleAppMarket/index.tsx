import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Input } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Boxes, Code2 } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import useSWR from 'swr';

import { MobileListSkeleton, MobileStateView } from '@/features/MobileWorkspace/components';
import { type InstalledModuleApp, moduleAppService } from '@/services/moduleApp';

import AppCard from './AppCard';
import MyAppsOverview from './MyAppsOverview';
import { useInstalledApps } from './useInstalledApps';

const SEARCH_DEBOUNCE_MS = 250;

type MarketplaceItem = InstalledModuleApp;

type ModuleAppMarketProps = {
  mode?: 'all' | 'my' | 'team';
  workspaceId?: string;
};

const labelKeys = {
  all: 'moduleApps.market.title',
  my: 'moduleApps.my.title',
  team: 'moduleApps.team.title',
} as const;

const styles = createStaticStyles(({ css, cssVar }) => ({
  error: css`
    font-size: 13px;
    color: ${cssVar.colorError};
  `,
  frame: css`
    display: flex;
    flex-direction: column;
    gap: 20px;

    box-sizing: border-box;
    width: 100%;
    max-width: 1200px;
    margin-inline: auto;
    padding: 16px;

    @media (width >= 768px) {
      padding: 24px;
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 12px 16px;
  `,
  header: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(180px, 320px);
    gap: 12px;
    align-items: center;

    min-height: 44px;

    @media (width < 600px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  heading: css`
    margin: 0;
    font-size: 20px;
    line-height: 28px;
  `,
  pagination: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
  `,
}));

const ModuleAppMarket = memo<ModuleAppMarketProps>(({ mode = 'all', workspaceId }) => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [teamSearchInput, setTeamSearchInput] = useState('');
  const [teamSearchQuery, setTeamSearchQuery] = useState('');
  const marketplace = useSWR<MarketplaceItem[]>(
    mode === 'all' ? ['moduleApp.listMarketplace'] : null,
    () => moduleAppService.listMarketplace() as Promise<MarketplaceItem[]>,
  );
  const teamApps = useInstalledApps({
    enabled: mode === 'team' && Boolean(workspaceId),
    query: teamSearchQuery,
    scope: 'workspace',
    workspaceId,
  });

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setTeamSearchQuery(teamSearchInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [teamSearchInput]);

  const apps = mode === 'team' ? teamApps.items : (marketplace.data ?? []);
  const listError = mode === 'team' ? teamApps.error : marketplace.error;
  const listLoading = mode === 'team' ? teamApps.isLoading : marketplace.isLoading;
  const retry = mode === 'team' ? teamApps.retry : marketplace.mutate;

  return (
    <section className={styles.frame} data-testid={`module-app-market-${mode}`}>
      <header className={styles.header}>
        <h2 className={styles.heading}>{t(labelKeys[mode])}</h2>
        {mode === 'team' && workspaceId ? (
          <Input
            aria-label={t('moduleApps.installed.search')}
            maxLength={80}
            placeholder={t('moduleApps.installed.search')}
            type={'search'}
            value={teamSearchInput}
            onChange={(event) => setTeamSearchInput(event.target.value)}
          />
        ) : mode !== 'team' ? (
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            {mode === 'all' ? (
              <Button icon={<Icon icon={Boxes} size={16} />} onClick={() => navigate('/apps/my')}>
                {t('moduleApps.my.title')}
              </Button>
            ) : null}
            <Button
              icon={<Icon icon={Code2} size={16} />}
              onClick={() => navigate('/apps/developer')}
            >
              {t('moduleApps.developer.title')}
            </Button>
          </Flexbox>
        ) : null}
      </header>
      {mode === 'my' ? (
        <MyAppsOverview />
      ) : mode === 'team' && !workspaceId ? (
        <MobileStateView
          description={t('moduleApps.market.emptyDescription')}
          title={t('moduleApps.market.empty')}
        />
      ) : listError && apps.length === 0 ? (
        <MobileStateView
          variant="error"
          action={{
            label: t(mode === 'team' ? 'moduleApps.installed.retry' : 'moduleApps.market.retry'),
            onClick: () => void retry(),
          }}
          title={t(
            mode === 'team' ? 'moduleApps.installed.loadError' : 'moduleApps.market.loadError',
          )}
        />
      ) : listLoading && apps.length === 0 ? (
        <MobileListSkeleton
          avatarSize={48}
          label={t(mode === 'team' ? 'moduleApps.installed.loading' : 'moduleApps.market.loading')}
          minRowHeight={88}
          rows={4}
          trailingWidth={72}
        />
      ) : apps.length ? (
        <>
          <div className={styles.grid} data-testid="module-app-market-grid">
            {apps.map((app) => (
              <AppCard
                category={app.category}
                description={app.description}
                id={app.id}
                installationReadiness={app.installationReadiness}
                installed={app.installed}
                key={app.id}
                name={app.displayName}
                publishedVersion={app.publishedVersion?.version}
                updateAvailable={app.updateAvailable}
                version={app.installedVersion?.version ?? app.version ?? undefined}
                workspaceId={mode === 'team' ? workspaceId : undefined}
              />
            ))}
          </div>
          {mode === 'team' && listError ? (
            <div className={styles.pagination}>
              <span className={styles.error} role={'alert'}>
                {t('moduleApps.installed.loadMoreError')}
              </span>
              <Button onClick={() => void teamApps.retry()}>
                {t('moduleApps.installed.retry')}
              </Button>
            </div>
          ) : mode === 'team' && teamApps.hasMore ? (
            <div className={styles.pagination}>
              <Button loading={teamApps.isLoadingMore} onClick={teamApps.loadMore}>
                {t('moduleApps.installed.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <MobileStateView
          description={t(
            mode === 'team'
              ? teamSearchInput.trim()
                ? 'moduleApps.installed.emptySearchDescription'
                : 'moduleApps.installed.emptyDescription'
              : 'moduleApps.market.emptyDescription',
          )}
          title={t(
            mode === 'team'
              ? teamSearchInput.trim()
                ? 'moduleApps.installed.emptySearch'
                : 'moduleApps.installed.empty'
              : 'moduleApps.market.empty',
          )}
        />
      )}
    </section>
  );
});

ModuleAppMarket.displayName = 'ModuleAppMarket';

export const ModuleAppMyApps = memo(() => <ModuleAppMarket mode="my" />);
ModuleAppMyApps.displayName = 'ModuleAppMyApps';

export const ModuleAppTeamApps = memo(() => {
  const [searchParams] = useSearchParams();
  return <ModuleAppMarket mode="team" workspaceId={searchParams.get('workspaceId') || undefined} />;
});
ModuleAppTeamApps.displayName = 'ModuleAppTeamApps';

export default ModuleAppMarket;
