import { fabSkillDefinitions, fabSkillIdentifier } from '@lobechat/builtin-skills/fab-engineering';

import capabilities from '@/features/LocalAssistantMarket/capabilities.json';

import { type LocalMarketItem } from './types';

export const FAB_SANDBOX_TOOL_ID = 'lobe-cloud-sandbox';

export const fabSkillItems: LocalMarketItem[] = fabSkillDefinitions.map((skill) => ({
  author: '驰拓 AI',
  category: 'FAB 工程技能',
  description: skill.workflow,
  id: fabSkillIdentifier(skill.id),
  installable: true,
  name: `FAB 专用 · ${skill.name}`,
  source: 'fab',
}));

export const localMcpItems: LocalMarketItem[] = [
  {
    author: '驰拓 AI',
    category: '知识库',
    description: '连接已部署的半导体本地知识库，按权限返回原文片段、版本和证据定位。',
    id: 'fab-offline-knowledge',
    installable: true,
    missing: ['需要在 Fab 本地连接器设置中核对当前用户权限'],
    name: 'Fab 本地知识库',
    source: 'fab',
    sourceId: 'fab-offline-knowledge',
    status: 'needs-config',
  },
  {
    author: '驰拓 AI',
    category: '隔离执行',
    description: '通过 OnlyBoxes 本地隔离沙箱执行受限计算和文件处理，不连接生产现场。',
    id: 'fab-local-sandbox',
    installable: true,
    missing: ['由 Fab 服务端原生 OnlyBoxes 配置提供，按当前用户隔离会话'],
    name: 'Fab 本地沙箱',
    source: 'fab',
    sourceId: FAB_SANDBOX_TOOL_ID,
    status: 'needs-config',
  },
];

export const localModelItems: LocalMarketItem[] = [
  {
    author: 'myapi',
    category: '多模态 / 工具调用',
    description:
      'Fab 当前默认模型别名，支持识图、工具调用和长上下文；实际可用性取决于站点模型配置。',
    id: 'default-vision',
    installable: true,
    name: 'default-vision',
    source: 'runtime',
  },
  {
    author: 'myapi',
    category: 'Fab 默认模型',
    description: 'Fab 站点允许的默认文本模型别名。',
    id: 'default-model',
    installable: true,
    name: 'default-model',
    source: 'runtime',
  },
  {
    author: 'myapi',
    category: 'Fab 默认模型',
    description: 'Fab 站点允许的默认编程模型别名。',
    id: 'default-coding',
    installable: true,
    name: 'default-coding',
    source: 'runtime',
  },
];

export const localProviderItems: LocalMarketItem[] = [
  {
    author: '驰拓 AI',
    category: 'OpenAI 兼容中转',
    description: 'Fab 专用 myapi 站点凭证入口；用户只能看到管理员允许的模型别名。',
    id: 'myapi',
    installable: true,
    name: 'myapi · Fab 模型供应商',
    source: 'runtime',
  },
];

export const localCapabilitySummary = {
  domains: capabilities.domains.length,
  roles: capabilities.roles.length,
  skillPackages: capabilities.skillPackages.length,
  toolPackages: capabilities.toolPackages.length,
};
