'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { type MenuProps } from '@lobehub/ui';
import { ActionIcon, Avatar, Flexbox, Icon } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { MoreHorizontal, Pin, PinOff } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentGroupAvatar from '@/features/AgentGroupAvatar';

import { getMobileRecentTimeKind, type MobileRecentConversation } from './recentItems';

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatar: css`
    position: relative;

    display: inline-flex;
    flex: 0 0 40px;

    width: 40px;
    height: 40px;
  `,
  badge: css`
    padding-block: 1px;
    padding-inline: 5px;
    border-radius: 4px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  content: css`
    flex: 1;
    min-width: 0;
    text-align: start;
  `,
  menu: css`
    flex: 0 0 44px;
    width: 44px;
  `,
  main: css`
    cursor: pointer;

    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;

    min-width: 0;
    padding: 0;
    border: none;

    color: inherit;

    background: transparent;
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;

    min-height: 64px;
    padding-block: 8px;
    padding-inline: 12px 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  topic: css`
    overflow: hidden;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  unread: css`
    position: absolute;
    inset-block-start: -5px;
    inset-inline-end: -7px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    min-width: 18px;
    height: 18px;
    padding-inline: 4px;
    border: 2px solid ${cssVar.colorBgContainer};
    border-radius: 999px;

    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorTextLightSolid};

    background: ${cssVar.colorError};
  `,
}));

interface RecentConversationRowProps {
  item: MobileRecentConversation;
  onOpen: () => void;
  onTogglePin: () => void;
  pending?: boolean;
}

const RecentConversationRow = memo<RecentConversationRowProps>(
  ({ item, onOpen, onTogglePin, pending = false }) => {
    const { t } = useTranslation('common');
    const isGroup = item.kind === 'group';
    const customAvatar = typeof item.avatar === 'string' ? item.avatar : undefined;
    const memberAvatars = Array.isArray(item.avatar) ? item.avatar : [];
    const unreadCount = item.unreadCount ?? 0;
    const timeKind = getMobileRecentTimeKind(item.updatedAt);
    const timeLabel =
      timeKind === 'justNow'
        ? t('mobile.recent.justNow', { defaultValue: 'Just now' })
        : timeKind === 'today'
          ? t('mobile.recent.today', { defaultValue: 'Today' })
          : timeKind === 'yesterday'
            ? t('mobile.recent.yesterday', { defaultValue: 'Yesterday' })
            : item.updatedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const menuItems = useMemo<MenuProps['items']>(
      () => [
        {
          disabled: pending,
          icon: <Icon icon={item.pinned ? PinOff : Pin} />,
          key: 'pin',
          label: item.pinned ? t('mobile.recent.unpin') : t('mobile.recent.pin'),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onTogglePin();
          },
        },
      ],
      [item.pinned, onTogglePin, pending, t],
    );

    return (
      <div className={styles.row} data-kind={item.kind} data-testid="recent-conversation-row">
        <button
          aria-label={t('mobile.recent.open', { name: item.title })}
          className={styles.main}
          data-mobile-focus-key={`${item.kind}:${item.id}`}
          type="button"
          onClick={onOpen}
        >
          <span className={styles.avatar}>
            {isGroup ? (
              <AgentGroupAvatar
                avatar={customAvatar}
                backgroundColor={item.backgroundColor ?? undefined}
                memberAvatars={memberAvatars}
                size={40}
              />
            ) : (
              <Avatar
                emojiScaleWithBackground
                avatar={customAvatar || DEFAULT_AVATAR}
                background={item.backgroundColor ?? undefined}
                shape="square"
                size={40}
              />
            )}
            {unreadCount > 0 ? (
              <span
                aria-label={t('mobile.recent.unread', { count: unreadCount })}
                className={styles.unread}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : null}
          </span>
          <Flexbox className={styles.content} gap={4}>
            <div className={styles.title}>{item.title}</div>
            {item.topicTitle ? <div className={styles.topic}>{item.topicTitle}</div> : null}
            <Flexbox horizontal align="center" gap={6}>
              {isGroup ? <span className={styles.badge}>{t('mobile.recent.group')}</span> : null}
              <time
                className={styles.meta}
                data-testid="recent-conversation-date"
                dateTime={item.updatedAt.toISOString()}
              >
                {timeLabel}
              </time>
            </Flexbox>
          </Flexbox>
        </button>
        <span className={styles.menu}>
          <DropdownMenu items={menuItems}>
            <ActionIcon
              aria-label={t('mobile.recent.moreActions', { name: item.title })}
              disabled={pending}
              icon={MoreHorizontal}
              loading={pending}
              size={{ blockSize: 44, size: 18 }}
              title={t('mobile.recent.moreActions', { name: item.title })}
              onClick={(event) => event.stopPropagation()}
            />
          </DropdownMenu>
        </span>
      </div>
    );
  },
);

RecentConversationRow.displayName = 'RecentConversationRow';

export default RecentConversationRow;
