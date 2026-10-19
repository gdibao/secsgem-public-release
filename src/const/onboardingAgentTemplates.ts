import {
  type AgentTemplate,
  MarketplaceCategory,
} from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import type { LobeAgentConfig } from '@lobechat/types';

export const COMHUB_LOCAL_ONBOARDING_AGENT_PREFIX = 'comhub-local-onboarding-';

export type LocalOnboardingAgentTemplate = AgentTemplate & {
  config: Partial<LobeAgentConfig>;
  tags?: string[];
};

export const LOCAL_ONBOARDING_AGENT_TEMPLATES: LocalOnboardingAgentTemplate[] = [
  {
    avatar: '✍️',
    category: MarketplaceCategory.ContentCreation,
    config: {
      systemRole:
        'You are a practical writing assistant. Help the user draft, rewrite, summarize, and polish Chinese business content with a clear structure.',
    },
    description: '撰写、润色、总结中文内容，适合日常办公与运营文案。',
    id: `${COMHUB_LOCAL_ONBOARDING_AGENT_PREFIX}writer`,
    tags: ['writing', 'office'],
    title: '通用写作助手',
  },
  {
    avatar: '📊',
    category: MarketplaceCategory.BusinessStrategy,
    config: {
      systemRole:
        'You are a business analysis assistant. Help the user break down goals, analyze data, compare options, and produce actionable conclusions.',
    },
    description: '拆解业务问题、整理数据结论、输出可执行建议。',
    id: `${COMHUB_LOCAL_ONBOARDING_AGENT_PREFIX}analyst`,
    tags: ['business', 'analysis'],
    title: '业务分析助手',
  },
  {
    avatar: '🧩',
    category: MarketplaceCategory.Engineering,
    config: {
      systemRole:
        'You are a software engineering assistant. Help the user inspect requirements, explain code, design implementation steps, and identify risks.',
    },
    description: '辅助理解代码、设计实现步骤、排查技术风险。',
    id: `${COMHUB_LOCAL_ONBOARDING_AGENT_PREFIX}engineer`,
    tags: ['engineering', 'code'],
    title: '技术研发助手',
  },
  {
    avatar: '🎯',
    category: MarketplaceCategory.Operations,
    config: {
      systemRole:
        'You are a productivity assistant. Help the user turn messy notes into plans, task lists, schedules, and follow-up reminders.',
    },
    description: '把想法整理成计划、清单、日程和后续行动。',
    id: `${COMHUB_LOCAL_ONBOARDING_AGENT_PREFIX}planner`,
    tags: ['productivity', 'planning'],
    title: '效率规划助手',
  },
];

export const getLocalOnboardingAgentTemplate = (id: string) =>
  LOCAL_ONBOARDING_AGENT_TEMPLATES.find((template) => template.id === id);
