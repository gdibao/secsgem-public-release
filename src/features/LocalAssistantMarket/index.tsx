'use client';

import { ActionIcon, Avatar, Button, Input } from '@lobehub/ui';
import { ArrowLeft, ExternalLink, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import MarketSourceTabs, { type MarketSource } from '../LocalMarket/MarketSourceTabs';
import {
  filterLocalAssistants,
  localAssistants,
  localBrands,
  localDomains,
  localRoleCategories,
  resolveLocalMirrorAvatar,
} from './catalog';
import { installLocalAssistant, installMirrorAssistant } from './install';
import { styles } from './style';

type MirrorAssistant = {
  author?: string;
  avatar?: string;
  description?: string;
  featured?: boolean;
  homepage?: string;
  iconKey: string;
  id: string;
  installCount?: number;
  name: string;
  official?: boolean;
  score?: number;
  sourceId: string;
  status: 'installable' | 'needs-config' | 'metadata-only' | 'blocked';
  tags?: string[];
  missing?: string[];
  stars?: number;
  version?: string;
};

const LocalAssistantMarket = ({
  embedded = false,
  initialDomain = '',
  limit,
  onInstalled,
}: {
  embedded?: boolean;
  initialDomain?: string;
  limit?: number;
  onInstalled?: (agentId: string) => void | Promise<void>;
  onBrowse?: () => void;
}) => {
  const { t } = useTranslation('discover');
  const navigate = useWorkspaceAwareNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [domain, setDomain] = useState(initialDomain);
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [source, setSource] = useState<MarketSource>('fab');
  const [mirrorAssistants, setMirrorAssistants] = useState<MirrorAssistant[]>([]);
  const [mirrorTotal, setMirrorTotal] = useState(0);
  const [mirrorPage, setMirrorPage] = useState(1);
  const [mirrorAll, setMirrorAll] = useState(false);
  const [mirrorLoading, setMirrorLoading] = useState(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const userId = useUserStore(userProfileSelectors.userId);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const invalidateAvailableAgents = useAgentStore((s) => s.invalidateAvailableAgents);
  const selected = pathname.match(/\/community\/agent\/([^/]+)\/?$/)?.[1];
  useEffect(() => {
    if (source !== 'local') return;

    const controller = new AbortController();
    setMirrorLoading(true);
    setError(false);
    const params = new URLSearchParams({
      all: mirrorAll ? '1' : '0',
      limit: String(limit || 80),
      page: String(mirrorPage),
    });
    if (query.trim()) params.set('q', query.trim());
    void fetch(`/market/local/assistants?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`local assistant market ${response.status}`);
        return response.json() as Promise<{ items: MirrorAssistant[]; total?: number }>;
      })
      .then(({ items: nextItems, total }) => {
        setMirrorAssistants(nextItems);
        setMirrorTotal(total || 0);
      })
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name !== 'AbortError') setError(true);
      })
      .finally(() => setMirrorLoading(false));

    return () => controller.abort();
  }, [limit, mirrorAll, mirrorPage, query, source]);

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matches = filterLocalAssistants(query, domain, category, brand).filter(
      (entry) => !selected || entry.identifier === selected,
    );
    return limit && !needle && !domain && !category && !brand ? matches.slice(0, limit) : matches;
  }, [query, selected, limit, domain, category, brand]);

  const mirrorItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return mirrorAssistants;
    return mirrorAssistants.filter((entry) =>
      [entry.sourceId, entry.name, entry.description, entry.author, ...(entry.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [mirrorAssistants, query]);

  const install = async (identifier: string) => {
    if (busy.current) return;
    if (!userId) {
      navigate('/signin', { escape: true });
      return;
    }
    busy.current = true;
    setPending(identifier);
    setError(false);
    try {
      const { agentId } = await installLocalAssistant(identifier, userId);
      invalidateAvailableAgents();
      void refreshAgentList().catch(() => undefined);
      if (onInstalled) await onInstalled(agentId);
      else navigate(`/agent/${encodeURIComponent(agentId)}`);
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setPending(undefined);
    }
  };

  const installMirror = async (sourceId: string) => {
    if (busy.current) return;
    if (!userId) {
      navigate('/signin', { escape: true });
      return;
    }
    busy.current = true;
    setPending(sourceId);
    setError(false);
    try {
      const { agentId } = await installMirrorAssistant(sourceId, userId);
      invalidateAvailableAgents();
      void refreshAgentList().catch(() => undefined);
      if (onInstalled) await onInstalled(agentId);
      else navigate(`/agent/${encodeURIComponent(agentId)}`);
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setPending(undefined);
    }
  };

  return (
    <main
      className={styles.page}
      data-testid={embedded ? 'local-assistant-recommendations' : 'local-assistant-catalog'}
      data-catalog-count={localAssistants.length}
    >
      {!embedded && (
        <header className={styles.header}>
          <ActionIcon
            icon={ArrowLeft}
            title={t('localMarket.back')}
            onClick={() => navigate('/')}
          />
          <h1>{t('localMarket.title')}</h1>
        </header>
      )}
      <nav aria-label={t('localMarket.title')} className={styles.tabs}>
        <span className={styles.meta}>
          {source === 'fab' ? `FAB 助手 ${localAssistants.length}` : '本地精选助手'}
        </span>
      </nav>
      <MarketSourceTabs
        fabLabel={embedded ? `FAB 助手 ${localAssistants.length}` : 'FAB 市场'}
        localLabel={embedded ? '本地精选助手' : '本地市场'}
        source={source}
        onChange={(nextSource) => {
          setSource(nextSource);
          setMirrorPage(1);
          setQuery('');
        }}
      />
      {source === 'local' && (
        <div className={styles.marketNotice} role="status">
          <span>{mirrorLoading ? '正在读取既有本地镜像…' : `精选 ${mirrorTotal} 条；默认按官方/精选与真实质量信号排序`}</span>
          <Button size="small" type="text" onClick={() => { setMirrorAll((value) => !value); setMirrorPage(1); }}>
            {mirrorAll ? '仅显示精选' : '显示全部元数据'}
          </Button>
        </div>
      )}
      <Input
        aria-label={t('localMarket.search')}
        placeholder={t('localMarket.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {source === 'fab' && (
        <div className={styles.filters}>
          <select
            aria-label={t('localMarket.domain')}
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          >
            <option value="">{t('localMarket.domain')}</option>
            {localDomains.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t('localMarket.category')}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{t('localMarket.category')}</option>
            {localRoleCategories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            aria-label={t('localMarket.brand')}
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
          >
            <option value="">{t('localMarket.brand')}</option>
            {localBrands.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      )}
      {source === 'fab' && <p className={styles.meta}>{t('localMarket.dependencies')}</p>}
      {error && <p role="alert">{t('localMarket.installError')}</p>}
      {source === 'fab' && items.length === 0 && <p role="status">{t('localMarket.empty')}</p>}
      {source === 'local' && mirrorItems.length === 0 && !mirrorLoading && (
        <p role="status">没有可显示的本地镜像助手。</p>
      )}
      <div className={styles.grid}>
        {source === 'local'
          ? mirrorItems.map((entry) => (
              <article className={styles.card} key={entry.id} data-assistant-id={entry.sourceId}>
                <Avatar
                  avatar={resolveLocalMirrorAvatar(entry.avatar, entry.iconKey)}
                  shape="square"
                  size={36}
                />
                <h2>{entry.name}</h2>
                <p>{entry.description || '本地镜像元数据，运行能力需单独核验。'}</p>
                <p className={styles.meta}>
                  {[entry.official && '官方', entry.featured && '精选', entry.author, entry.stars !== undefined ? `★ ${entry.stars}` : '星级暂无数据', entry.installCount !== undefined ? `使用 ${entry.installCount}` : '使用量暂无数据', entry.version && `版本 ${entry.version}`]
                    .filter(Boolean)
                    .join(' / ')}
                </p>
                <p className={styles.meta}>
                  {entry.status === 'installable' ? '可安装' : entry.status === 'needs-config' ? '需配置' : entry.status === 'blocked' ? '已阻断' : '仅元数据'}
                  {entry.missing?.length ? `：${entry.missing.join('；')}` : ''}
                </p>
                {entry.status === 'installable' || entry.status === 'needs-config' ? (
                  <Button
                    disabled={Boolean(pending)}
                    icon={Plus}
                    loading={pending === entry.sourceId}
                    onClick={() => void installMirror(entry.sourceId)}
                  >
                    {entry.status === 'needs-config'
                      ? '安装基础助手，稍后配置能力'
                      : t(userId ? 'localMarket.install' : 'localMarket.signIn')}
                  </Button>
                ) : entry.homepage ? (
                  <a href={entry.homepage} rel="noopener noreferrer" target="_blank">
                    <Button icon={ExternalLink} size="small" type="text">
                      查看来源
                    </Button>
                  </a>
                ) : (
                  <Button disabled size="small">
                    {entry.status === 'needs-config' ? '需配置，暂不可安装' : '仅元数据，暂不可安装'}
                  </Button>
                )}
              </article>
            ))
          : items.map((entry) => (
              <article
                className={styles.card}
                key={entry.identifier}
                data-assistant-id={entry.identifier}
              >
                <Avatar avatar={entry.meta.avatar} shape="square" size={36} />
                <h2>{entry.meta.title}</h2>
                <p>{entry.meta.description}</p>
                <p className={styles.meta}>{entry.meta.tags.join(' / ')}</p>
                {entry.config.plugins.length > 0 && (
                  <p role="status">
                    {t('localMarket.disabledTools', { names: entry.config.plugins.join(', ') })}
                  </p>
                )}
                <details open={selected === entry.identifier}>
                  <summary>{t('localMarket.prompt')}</summary>
                  <pre>{entry.config.systemRole}</pre>
                  <p>{entry.config.openingMessage}</p>
                  <ul>
                    {entry.config.openingQuestions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                </details>
                <Button
                  data-testid="local-assistant-install"
                  disabled={Boolean(pending)}
                  icon={Plus}
                  loading={pending === entry.identifier}
                  onClick={() => void install(entry.identifier)}
                >
                  {t(userId ? 'localMarket.install' : 'localMarket.signIn')}
                </Button>
              </article>
            ))}
      </div>
      {source === 'local' && mirrorAll && mirrorTotal > 80 && (
        <div className={styles.pagination}>
          <Button disabled={mirrorPage <= 1} size="small" onClick={() => setMirrorPage((page) => Math.max(1, page - 1))}>上一页</Button>
          <span className={styles.meta}>第 {mirrorPage} 页 / 共 {Math.ceil(mirrorTotal / 80)} 页</span>
          <Button disabled={mirrorPage >= Math.ceil(mirrorTotal / 80)} size="small" onClick={() => setMirrorPage((page) => page + 1)}>下一页</Button>
        </div>
      )}
    </main>
  );
};

export default LocalAssistantMarket;
