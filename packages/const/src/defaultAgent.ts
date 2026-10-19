export const DEFAULT_COMHUB_AGENT_AVATAR = '/images/brand/chituo-ai-logo.png';

export const DEFAULT_COMHUB_AGENT_NAME = '驰拓助手';

// Only the exact repository-owned legacy asset is a known product default.
export const resolveDefaultAgentAvatar = (avatar?: string | null) =>
  avatar === '/avatars/lobe-ai.png' ? DEFAULT_COMHUB_AGENT_AVATAR : avatar;
