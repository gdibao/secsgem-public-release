'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { Alert, Empty, Input, message, Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { createStaticStyles } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

import InlineTable from '@/components/InlineTable';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import AdminDangerousActionButton from './AdminDangerousActionButton';
import type { AdminDangerousActionEnvelope } from './adminDangerousActions';
import { AdminPageShell, AdminResponsiveTable, AdminSection, AdminToolbar } from './layout';

const { Text } = Typography;

const styles = createStaticStyles(({ css }) => ({
  filters: css`
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;

    min-width: 0;
  `,
  pagination: css`
    display: flex;
    justify-content: center;
  `,
  search: css`
    flex: 1 1 280px;
    min-width: min(240px, 100%);
    max-width: 360px;

    @media (width < 640px) {
      max-width: none;
    }
  `,
  select: css`
    flex: 0 1 160px;
    min-width: min(160px, 100%);

    @media (width < 640px) {
      flex: 1 1 160px;
    }
  `,
  userSearch: css`
    flex: 1 1 220px;
    min-width: min(220px, 100%);
    max-width: 280px;

    @media (width < 640px) {
      max-width: none;
    }
  `,
}));

type ContentMode = 'documents' | 'files' | 'topics';
type TopicStatus = 'active' | 'archived' | 'completed';
type DocumentSourceType = 'agent' | 'agent-signal' | 'api' | 'file' | 'topic' | 'web';

const EMPTY_TEXT = '-';
type ContentDeleteCommand =
  | AdminDangerousActionEnvelope<'content.deleteDocument'>
  | AdminDangerousActionEnvelope<'content.deleteFile'>
  | AdminDangerousActionEnvelope<'content.deleteTopic'>;
const PAGE_SIZE = 50;

const formatDate = (value?: Date | string | null) =>
  value ? new Date(value).toLocaleString() : EMPTY_TEXT;

const formatSize = (value?: number | null) => {
  if (!value) return EMPTY_TEXT;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const compactId = (value?: string | null) =>
  value ? <code>{value.slice(0, 12)}</code> : EMPTY_TEXT;

const userLabel = (
  user?: {
    email?: string | null;
    fullName?: string | null;
    id?: string | null;
    username?: string | null;
  } | null,
) => (
  <Flexbox gap={2}>
    <span>{user?.fullName || user?.username || user?.email || EMPTY_TEXT}</span>
    {user?.id ? <Text type="secondary">{compactId(user.id)}</Text> : null}
  </Flexbox>
);

const statusColor: Record<TopicStatus, string> = {
  active: 'green',
  archived: 'default',
  completed: 'blue',
};

const sourceTypeOptions: Array<{ label: string; value: DocumentSourceType }> = [
  { label: '文件', value: 'file' },
  { label: '网页', value: 'web' },
  { label: 'API', value: 'api' },
  { label: '话题', value: 'topic' },
  { label: '助理', value: 'agent' },
  { label: '助理信号', value: 'agent-signal' },
];

const getModeCopy = (mode: ContentMode) => {
  if (mode === 'topics') {
    return {
      actionHint: '归档会保留数据但隐藏活跃状态；删除会直接移除话题记录。',
      listTitle: '话题列表',
      searchPlaceholder: '搜索标题、描述、内容或用户',
      subtitle: '统一查看所有用户的话题，支持按状态筛选、归档和删除异常话题。',
      tableLabel: '话题数据表',
      title: '话题管理',
    };
  }

  if (mode === 'files') {
    return {
      actionHint: '删除会移除文件记录，请先确认该资源不再需要。',
      listTitle: '文件列表',
      searchPlaceholder: '搜索文件名、类型、地址或用户',
      subtitle: '查看所有用户上传或生成的资源文件，定位体积、类型和归属用户。',
      tableLabel: '文件数据表',
      title: '资源文件管理',
    };
  }

  return {
    actionHint: '删除会移除文稿/知识文档记录，请确认不会影响用户资料与知识库。',
    listTitle: '文档列表',
    searchPlaceholder: '搜索标题、文件名、来源或用户',
    subtitle: '查看用户文稿、网页、文件解析文档和助理相关文档，支持按来源类型筛选。',
    tableLabel: '文档数据表',
    title: '用户文稿管理',
  };
};

const AdminContentPage = memo<{ mode: ContentMode }>(({ mode }) => {
  const copy = getModeCopy(mode);
  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState('');
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState<TopicStatus | undefined>();
  const [sourceType, setSourceType] = useState<DocumentSourceType | undefined>();
  const [actingId, setActingId] = useState<string | null>(null);

  const swrKey = useMemo(
    () => ['admin-content', mode, cursor, query, userId, status ?? '', sourceType ?? ''] as const,
    [cursor, mode, query, sourceType, status, userId],
  );

  const { data, error, isLoading } = useClientDataSWR(swrKey, () => {
    const common = {
      cursor,
      limit: PAGE_SIZE,
      query: query || undefined,
      userId: userId || undefined,
    };

    if (mode === 'topics') {
      return adminCommercialService.listAdminTopics({ ...common, status });
    }
    if (mode === 'files') {
      return adminCommercialService.listAdminFiles(common);
    }
    return adminCommercialService.listAdminDocuments({ ...common, sourceType });
  });

  const resetFilters = () => {
    setCursor(0);
  };

  const refresh = useCallback(async () => mutate(swrKey), [swrKey]);

  const runAction = useCallback(
    async (
      id: string,
      action: 'archive-topic' | 'delete-document' | 'delete-file' | 'delete-topic',
      command?: ContentDeleteCommand,
    ) => {
      setActingId(id);
      try {
        if (action === 'archive-topic') await adminCommercialService.archiveAdminTopic(id);
        if (action === 'delete-topic' && command?.actionId === 'content.deleteTopic') {
          await adminCommercialService.deleteAdminTopic(id, command);
        }
        if (action === 'delete-file' && command?.actionId === 'content.deleteFile') {
          await adminCommercialService.deleteAdminFile(id, command);
        }
        if (action === 'delete-document' && command?.actionId === 'content.deleteDocument') {
          await adminCommercialService.deleteAdminDocument(id, command);
        }
        message.success('操作已完成');
        await refresh();
      } catch {
        message.error('操作失败，请稍后重试');
      } finally {
        setActingId(null);
      }
    },
    [refresh],
  );

  const columns = useMemo<ColumnsType<any>>(() => {
    if (mode === 'topics') {
      return [
        {
          key: 'title',
          render: (_: unknown, row: any) => (
            <Flexbox gap={2}>
              <span>{row.topic.title || EMPTY_TEXT}</span>
              <Text type="secondary">{compactId(row.topic.id)}</Text>
            </Flexbox>
          ),
          title: '话题',
          width: 260,
        },
        {
          key: 'user',
          render: (_: unknown, row: any) => userLabel(row.user),
          title: '用户',
          width: 220,
        },
        {
          key: 'status',
          render: (_: unknown, row: any) => (
            <Tag color={statusColor[row.topic.status as TopicStatus] ?? 'default'}>
              {row.topic.status}
            </Tag>
          ),
          title: '状态',
          width: 100,
        },
        {
          key: 'mode',
          render: (_: unknown, row: any) => row.topic.mode || EMPTY_TEXT,
          title: '模式',
          width: 120,
        },
        {
          key: 'favorite',
          render: (_: unknown, row: any) =>
            row.topic.favorite ? <Tag color="gold">收藏</Tag> : EMPTY_TEXT,
          title: '标记',
          width: 100,
        },
        {
          key: 'updatedAt',
          render: (_: unknown, row: any) => formatDate(row.topic.updatedAt),
          title: '更新时间',
          width: 180,
        },
        {
          key: 'actions',
          render: (_: unknown, row: any) => (
            <Space>
              {row.topic.status !== 'archived' ? (
                <Button
                  loading={actingId === row.topic.id}
                  size="small"
                  onClick={() => runAction(row.topic.id, 'archive-topic')}
                >
                  归档
                </Button>
              ) : null}
              <AdminDangerousActionButton
                danger
                actionId="content.deleteTopic"
                confirmTitle="确认删除这个话题？"
                loading={actingId === row.topic.id}
                size="small"
                onConfirm={(command) => runAction(row.topic.id, 'delete-topic', command)}
              >
                删除
              </AdminDangerousActionButton>
            </Space>
          ),
          title: '操作',
          width: 160,
        },
      ];
    }

    if (mode === 'files') {
      return [
        {
          key: 'name',
          render: (_: unknown, row: any) => (
            <Flexbox gap={2}>
              <span>{row.file.name || EMPTY_TEXT}</span>
              <Text type="secondary">{compactId(row.file.id)}</Text>
            </Flexbox>
          ),
          title: '文件',
          width: 260,
        },
        {
          key: 'user',
          render: (_: unknown, row: any) => userLabel(row.user),
          title: '用户',
          width: 220,
        },
        {
          key: 'fileType',
          render: (_: unknown, row: any) => row.file.fileType || EMPTY_TEXT,
          title: '类型',
          width: 180,
        },
        {
          key: 'size',
          render: (_: unknown, row: any) => formatSize(row.file.size),
          title: '大小',
          width: 100,
        },
        {
          key: 'embeddingTaskId',
          render: (_: unknown, row: any) =>
            row.file.embeddingTaskId ? compactId(row.file.embeddingTaskId) : EMPTY_TEXT,
          title: '向量任务',
          width: 140,
        },
        {
          key: 'updatedAt',
          render: (_: unknown, row: any) => formatDate(row.file.updatedAt),
          title: '更新时间',
          width: 180,
        },
        {
          key: 'actions',
          render: (_: unknown, row: any) => (
            <AdminDangerousActionButton
              danger
              actionId="content.deleteFile"
              confirmTitle="确认删除这个文件记录？"
              loading={actingId === row.file.id}
              size="small"
              onConfirm={(command) => runAction(row.file.id, 'delete-file', command)}
            >
              删除
            </AdminDangerousActionButton>
          ),
          title: '操作',
          width: 100,
        },
      ];
    }

    return [
      {
        key: 'title',
        render: (_: unknown, row: any) => (
          <Flexbox gap={2}>
            <span>{row.document.title || row.document.filename || EMPTY_TEXT}</span>
            <Text type="secondary">{compactId(row.document.id)}</Text>
          </Flexbox>
        ),
        title: '文稿',
        width: 280,
      },
      {
        key: 'user',
        render: (_: unknown, row: any) => userLabel(row.user),
        title: '用户',
        width: 220,
      },
      {
        key: 'sourceType',
        render: (_: unknown, row: any) => <Tag>{row.document.sourceType}</Tag>,
        title: '来源类型',
        width: 110,
      },
      {
        key: 'fileType',
        render: (_: unknown, row: any) => row.document.fileType || EMPTY_TEXT,
        title: '文件类型',
        width: 160,
      },
      {
        key: 'chars',
        render: (_: unknown, row: any) => row.document.totalCharCount ?? EMPTY_TEXT,
        title: '字符数',
        width: 100,
      },
      {
        key: 'updatedAt',
        render: (_: unknown, row: any) => formatDate(row.document.updatedAt),
        title: '更新时间',
        width: 180,
      },
      {
        key: 'actions',
        render: (_: unknown, row: any) => (
          <AdminDangerousActionButton
            danger
            actionId="content.deleteDocument"
            confirmTitle="确认删除这个文稿？"
            loading={actingId === row.document.id}
            size="small"
            onConfirm={(command) => runAction(row.document.id, 'delete-document', command)}
          >
            删除
          </AdminDangerousActionButton>
        ),
        title: '操作',
        width: 100,
      },
    ];
  }, [actingId, mode, runAction]);

  return (
    <AdminPageShell description={copy.subtitle} title={copy.title} width="full">
      <Alert showIcon title={copy.actionHint} type="info" />
      <AdminSection
        description={`当前加载 ${data?.items?.length ?? 0} 条记录`}
        title={copy.listTitle}
        actions={
          <Button
            icon={<RefreshCw aria-hidden size={14} />}
            loading={isLoading}
            onClick={() => void refresh()}
          >
            刷新数据
          </Button>
        }
      >
        <AdminToolbar>
          <div className={styles.filters}>
            <Input.Search
              allowClear
              className={styles.search}
              placeholder={copy.searchPlaceholder}
              onSearch={(value) => {
                setQuery(value.trim());
                resetFilters();
              }}
            />
            <Input.Search
              allowClear
              className={styles.userSearch}
              placeholder="按用户 ID 筛选"
              onSearch={(value) => {
                setUserId(value.trim());
                resetFilters();
              }}
            />
            {mode === 'topics' ? (
              <Select
                allowClear
                className={styles.select}
                placeholder="话题状态"
                value={status}
                options={[
                  { label: '活跃', value: 'active' },
                  { label: '已完成', value: 'completed' },
                  { label: '已归档', value: 'archived' },
                ]}
                onChange={(value) => {
                  setStatus(value as TopicStatus | undefined);
                  resetFilters();
                }}
              />
            ) : null}
            {mode === 'documents' ? (
              <Select
                allowClear
                className={styles.select}
                options={sourceTypeOptions}
                placeholder="来源类型"
                value={sourceType}
                onChange={(value) => {
                  setSourceType(value as DocumentSourceType | undefined);
                  resetFilters();
                }}
              />
            ) : null}
          </div>
        </AdminToolbar>

        {error ? (
          <Alert
            showIcon
            action={<Button onClick={() => void refresh()}>重试</Button>}
            description="请检查服务状态后重试，现有筛选条件会保留。"
            title="数据加载失败"
            type="error"
          />
        ) : null}

        <AdminResponsiveTable label={copy.tableLabel}>
          <InlineTable
            columns={columns}
            dataSource={data?.items ?? []}
            loading={isLoading}
            locale={{ emptyText: <Empty description="暂无数据" /> }}
            rowKey={(row: any) => row.topic?.id || row.file?.id || row.document?.id}
          />
        </AdminResponsiveTable>
        {data?.nextCursor != null ? (
          <div className={styles.pagination}>
            <Button loading={isLoading} onClick={() => setCursor(data.nextCursor!)}>
              加载更多
            </Button>
          </div>
        ) : null}
      </AdminSection>
    </AdminPageShell>
  );
});

AdminContentPage.displayName = 'AdminContentPage';

export const AdminTopicsPage = memo(() => <AdminContentPage mode="topics" />);
export const AdminFilesPage = memo(() => <AdminContentPage mode="files" />);
export const AdminDocumentsPage = memo(() => <AdminContentPage mode="documents" />);

AdminTopicsPage.displayName = 'AdminTopicsPage';
AdminFilesPage.displayName = 'AdminFilesPage';
AdminDocumentsPage.displayName = 'AdminDocumentsPage';
