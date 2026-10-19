import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { CalculatorManifest } from '@lobechat/builtin-tool-calculator/manifest';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { SkillsManifest } from '@lobechat/builtin-tool-skills';
import { TaskManifest } from '@lobechat/builtin-tool-task';
import { fabSkillIdentifier } from '@lobechat/builtin-skills/fab-engineering';

import capabilities from './capabilities.json';

type FabRole = (typeof capabilities.roles)[number];
type FabToolPackage = (typeof capabilities.toolPackages)[number];
type FabSkillPackage = (typeof capabilities.skillPackages)[number];

/**
 * The catalog is the source of truth for role capabilities. These are the
 * native tools that are actually shipped in the Fab image; a T-package is a
 * requirement, not a claim that a third-party CAD/PLC/SCADA SDK is installed.
 */
const toolPackagePlugins: Record<string, string[]> = {
  T01: [KnowledgeBaseManifest.identifier],
  T02: [AgentDocumentsManifest.identifier],
  T03: [CalculatorManifest.identifier],
  T04: [AgentDocumentsManifest.identifier, CalculatorManifest.identifier],
  T05: [AgentDocumentsManifest.identifier],
  T06: [AgentDocumentsManifest.identifier],
  T07: [AgentDocumentsManifest.identifier],
  T08: [AgentDocumentsManifest.identifier],
  T09: [AgentDocumentsManifest.identifier, CloudSandboxManifest.identifier],
  T10: [
    AgentDocumentsManifest.identifier,
    CalculatorManifest.identifier,
    CloudSandboxManifest.identifier,
  ],
  T11: [AgentDocumentsManifest.identifier, CloudSandboxManifest.identifier],
  T12: [AgentDocumentsManifest.identifier, CloudSandboxManifest.identifier],
  T13: [AgentDocumentsManifest.identifier],
  T14: [AgentDocumentsManifest.identifier, TaskManifest.identifier],
  T15: [AgentDocumentsManifest.identifier, CalculatorManifest.identifier],
  T16: [AgentDocumentsManifest.identifier],
  T17: [AgentDocumentsManifest.identifier, TaskManifest.identifier],
  T18: [AgentDocumentsManifest.identifier, CalculatorManifest.identifier],
  T19: [CalculatorManifest.identifier, CloudSandboxManifest.identifier],
  T20: [AgentDocumentsManifest.identifier, TaskManifest.identifier],
};

const roleByIdentifier = new Map<string, FabRole>(
  capabilities.roles.map((role) => [role.identifier, role]),
);
const toolPackageById = new Map<string, FabToolPackage>(
  capabilities.toolPackages.map((tool) => [tool.id, tool]),
);
const skillPackageById = new Map<string, FabSkillPackage>(
  capabilities.skillPackages.map((skill) => [skill.id, skill]),
);

const unique = <T>(items: T[]) => [...new Set(items)];

export const isFabPluginPinned = (
  plugins: Array<string | { identifier: string; mode?: string }> | undefined,
  identifier: string,
) =>
  plugins?.some((plugin) =>
    typeof plugin === 'string'
      ? plugin === identifier
      : plugin.identifier === identifier && (plugin.mode ?? 'pinned') === 'pinned',
  ) ?? false;

export const fabOfflineKnowledgeConnectorIdentifier = 'fab-offline-knowledge';

export const getFabRole = (identifier: string) => roleByIdentifier.get(identifier);

/**
 * Every assistant receives the global Fab knowledge tool and the local skill
 * runner. Role-specific tools are then derived from its T-package list. The
 * resulting arrays intentionally differ between roles.
 */
export const getFabOfflinePluginEntries = (identifier: string) => {
  const role = roleByIdentifier.get(identifier);

  const pluginIds = unique([
    SkillsManifest.identifier,
    KnowledgeBaseManifest.identifier,
    ...(role?.skillPackages.map(fabSkillIdentifier) ?? []),
    ...(role?.toolPackages.flatMap((packageId) => toolPackagePlugins[packageId] ?? []) ?? []),
  ]);

  return pluginIds.map((pluginIdentifier) => ({
    identifier: pluginIdentifier,
    mode: 'pinned' as const,
  }));
};

/**
 * The catalog's S-packages used to be only prose inside the prompt. Promote
 * them to an explicit, role-scoped local skill profile so the installed agent
 * carries its own workflow instead of exposing the same generic skill list.
 */
export const getFabRoleSkillProfile = (identifier: string) => {
  const role = roleByIdentifier.get(identifier);
  if (!role) {
    return [
      '## 本地已绑定能力（随本助手安装）',
      '- 能力范围：继承原半导体助手的职责提示词，并使用 Fab 本地知识库与本地技能运行时。',
      '- 交付物：依据原助手提示词输出可审阅的工程草案、分析结果和待核验清单。',
      '- 验收重点：没有真实工具结果、官方资料定位或授权证据时，必须标记未核实，不得声称已经执行。',
      '- 本助手未声明第三方专业 SDK、CAD/PLC IDE、仿真器或现场连接已经安装。',
    ].join('\n');
  }

  const tools = role.toolPackages
    .map((id) => toolPackageById.get(id))
    .filter((item): item is FabToolPackage => Boolean(item));
  const skills = role.skillPackages
    .map((id) => skillPackageById.get(id))
    .filter((item): item is FabSkillPackage => Boolean(item));

  return [
    '## 本地已绑定能力（随本助手安装）',
    `- 能力范围：${role.knowledgeScope}`,
    `- 交付物：${role.deliverable}`,
    `- 验收重点：${role.acceptance}`,
    '- 以下 T 包已映射到本镜像实际存在的原生工具；未列出的专业 SDK、CAD/PLC IDE、仿真器和现场连接不可假设已安装：',
    ...tools.map((tool) => `  - ${tool.id} ${tool.name}：${tool.contract}`),
    '- 以下 S 包已作为本助手的本地工作技能规则装载：',
    ...skills.map((skill) => `  - ${skill.id} ${skill.name}：${skill.workflow}`),
    '- 所有检索只通过已授权的 Fab 本地知识库连接；所有计算或文件处理只使用当前绑定的本地原生工具。',
    '- 没有真实工具结果、官方资料定位或授权证据时，必须标记未核实，不得声称已经执行。',
  ].join('\n');
};

/** Backward-compatible export used by existing catalog tests and callers. */
export const fabOfflinePluginEntries = getFabOfflinePluginEntries('c150-d01');
