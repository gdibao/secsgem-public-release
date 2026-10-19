import { type SharedTopicData } from '@/types/topic';

const DEFAULT_ASSISTANT_TITLE = '驰拓 AI 助手';

export const buildTopicByline = (data: SharedTopicData) => {
  const isInboxAgent = !data.groupId && data.agentMeta?.slug === 'inbox';

  return data.groupMeta?.title || (isInboxAgent ? DEFAULT_ASSISTANT_TITLE : data.agentMeta?.title);
};
