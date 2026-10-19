import { ADMIN_CAPABILITIES, type AdminCapability } from '@lobechat/types';

export const ADMIN_BASE_PATH = '/settings/admin';

export type AdminFeatureStatus =
  'active' | 'compatibility' | 'deprecated' | 'experimental' | 'planned';

export type AdminNavGroupKey =
  | 'overview'
  | 'user-access'
  | 'commercial'
  | 'ai-platform'
  | 'module-apps'
  | 'content-operations'
  | 'client-integrations'
  | 'system-security';

export type AdminNavIcon =
  | 'audit'
  | 'billing'
  | 'credits'
  | 'desktop'
  | 'documents'
  | 'expert-plaza'
  | 'file-storage'
  | 'files'
  | 'growth'
  | 'maintenance'
  | 'mobile'
  | 'models'
  | 'notifications'
  | 'orders'
  | 'overview'
  | 'plans'
  | 'plugins'
  | 'ppt'
  | 'pricing'
  | 'providers'
  | 'redemption'
  | 'recommendations'
  | 'settings'
  | 'stats'
  | 'subscriptions'
  | 'system-defaults'
  | 'topup'
  | 'topics'
  | 'users';

export type AdminCatalogGroup = {
  description: string;
  icon: AdminNavIcon;
  key: AdminNavGroupKey;
  label: string;
};

export type AdminCatalogItem = {
  accessCapabilities?: AdminCapability[];
  backendDomains: string[];
  debugId: string;
  description: string;
  group: AdminNavGroupKey;
  icon: AdminNavIcon;
  id: string;
  label: string;
  owner: string;
  path: string;
  readCapability: AdminCapability;
  segment: string;
  status: AdminFeatureStatus;
  writeCapabilities: AdminCapability[];
};

export const ADMIN_CATALOG_GROUPS: readonly AdminCatalogGroup[] = [
  {
    description: '关键指标、待处理事项、运行健康和版本信息',
    icon: 'overview',
    key: 'overview',
    label: '工作台',
  },
  {
    description: '用户身份、角色、支持动作和用户级审计',
    icon: 'users',
    key: 'user-access',
    label: '用户与权限',
  },
  {
    description: '套餐、订阅、平台订单、积分、兑换码和商业统计',
    icon: 'orders',
    key: 'commercial',
    label: '商业化',
  },
  {
    description: '服务商、模型目录、价格、策略、默认值和生成服务',
    icon: 'models',
    key: 'ai-platform',
    label: 'AI 平台',
  },
  {
    description: '模块应用目录、审核、商业化、运行数据和审计',
    icon: 'plugins',
    key: 'module-apps',
    label: '模块应用',
  },
  {
    description: '内容治理、推荐运营、专家广场、通知和增长',
    icon: 'documents',
    key: 'content-operations',
    label: '内容与运营',
  },
  {
    description: '桌面客户端、文件存储和外部集成状态',
    icon: 'desktop',
    key: 'client-integrations',
    label: '客户端与集成',
  },
  {
    description: '站点品牌、系统默认值、维护和审计日志',
    icon: 'settings',
    key: 'system-security',
    label: '系统与安全',
  },
];

const pathFor = (segment: string) => (segment ? `${ADMIN_BASE_PATH}/${segment}` : ADMIN_BASE_PATH);

export const ADMIN_CATALOG = [
  {
    backendDomains: ['stats', 'subscriptions', 'settings'],
    debugId: 'Desktop > Admin > overview',
    description: '查看核心指标、待处理事项和运行健康状态',
    group: 'overview',
    icon: 'overview',
    id: 'overview',
    label: '工作台',
    owner: 'admin-platform',
    path: pathFor(''),
    readCapability: ADMIN_CAPABILITIES.adminAccess,
    segment: '',
    status: 'active',
    writeCapabilities: [],
  },
  {
    backendDomains: ['users', 'credits', 'subscriptions'],
    debugId: 'Desktop > Admin > users',
    description: '管理用户身份、角色、状态和支持动作',
    group: 'user-access',
    icon: 'users',
    id: 'users',
    label: '用户管理',
    owner: 'identity',
    path: pathFor('users'),
    readCapability: ADMIN_CAPABILITIES.userRead,
    segment: 'users',
    status: 'active',
    writeCapabilities: [
      ADMIN_CAPABILITIES.supportWrite,
      ADMIN_CAPABILITIES.financeWrite,
      ADMIN_CAPABILITIES.adminAccess,
    ],
  },
  {
    backendDomains: ['workspace', 'workspaceMember'],
    debugId: 'Desktop > Admin > workspaces',
    description: '创建工作区并进入成员管理',
    group: 'user-access',
    icon: 'users',
    id: 'workspaces',
    label: '工作区管理',
    owner: 'identity',
    path: pathFor('workspaces'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'workspaces',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['settings'],
    debugId: 'Desktop > Admin > user-defaults',
    description: '配置新用户继承的模型、工具、头像和兴趣领域默认值',
    group: 'user-access',
    icon: 'users',
    id: 'user-defaults',
    label: '用户默认值',
    owner: 'identity',
    path: pathFor('user-defaults'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'user-defaults',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['plans'],
    debugId: 'Desktop > Admin > plans',
    description: '配置套餐价格、积分和权益',
    group: 'commercial',
    icon: 'plans',
    id: 'plans',
    label: '套餐与权益',
    owner: 'commercial',
    path: pathFor('plans'),
    readCapability: ADMIN_CAPABILITIES.financeRead,
    segment: 'plans',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.financeWrite],
  },
  {
    backendDomains: ['subscriptions'],
    debugId: 'Desktop > Admin > subscriptions',
    description: '查看订阅并处理套餐变更',
    group: 'commercial',
    icon: 'subscriptions',
    id: 'subscriptions',
    label: '订阅管理',
    owner: 'commercial',
    path: pathFor('subscriptions'),
    readCapability: ADMIN_CAPABILITIES.financeRead,
    segment: 'subscriptions',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.financeWrite],
  },
  {
    backendDomains: ['orders', 'topupPackages'],
    debugId: 'Desktop > Admin > orders',
    description: '查看平台订单和充值状态',
    group: 'commercial',
    icon: 'orders',
    id: 'orders',
    label: '平台订单与充值',
    owner: 'commercial',
    path: pathFor('orders'),
    readCapability: ADMIN_CAPABILITIES.financeRead,
    segment: 'orders',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.financeWrite],
  },
  {
    accessCapabilities: [ADMIN_CAPABILITIES.systemRead, ADMIN_CAPABILITIES.financeRead],
    backendDomains: ['settings', 'payment', 'moduleApps'],
    debugId: 'Desktop > Admin > payments',
    description: '统一配置支付渠道并处理充值交易与模块支付诊断',
    group: 'commercial',
    icon: 'billing',
    id: 'payments',
    label: '支付中心',
    owner: 'commercial',
    path: pathFor('payments'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'payments',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite, ADMIN_CAPABILITIES.financeWrite],
  },
  {
    backendDomains: ['credits'],
    debugId: 'Desktop > Admin > credits',
    description: '查看积分账户、余额和流水',
    group: 'commercial',
    icon: 'credits',
    id: 'credits',
    label: '积分账户与流水',
    owner: 'commercial',
    path: pathFor('credits'),
    readCapability: ADMIN_CAPABILITIES.financeRead,
    segment: 'credits',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.financeWrite],
  },
  {
    backendDomains: ['redemption'],
    debugId: 'Desktop > Admin > redemption',
    description: '生成、查询和停用兑换码',
    group: 'commercial',
    icon: 'redemption',
    id: 'redemption',
    label: '兑换码',
    owner: 'commercial',
    path: pathFor('redemption'),
    readCapability: ADMIN_CAPABILITIES.financeRead,
    segment: 'redemption',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.financeWrite],
  },
  {
    backendDomains: ['stats', 'referral'],
    debugId: 'Desktop > Admin > stats',
    description: '查看收入、订阅和推荐统计',
    group: 'commercial',
    icon: 'stats',
    id: 'stats',
    label: '商业统计',
    owner: 'commercial',
    path: pathFor('stats'),
    readCapability: ADMIN_CAPABILITIES.financeRead,
    segment: 'stats',
    status: 'active',
    writeCapabilities: [],
  },
  {
    backendDomains: ['newapiProviders'],
    debugId: 'Desktop > Admin > providers',
    description: '维护服务商实例、用途范围和模型目录',
    group: 'ai-platform',
    icon: 'providers',
    id: 'providers',
    label: '服务商与实例',
    owner: 'ai-platform',
    path: pathFor('providers'),
    readCapability: ADMIN_CAPABILITIES.modelOpsRead,
    segment: 'providers',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.modelOpsWrite],
  },
  {
    accessCapabilities: [
      ADMIN_CAPABILITIES.modelOpsRead,
      ADMIN_CAPABILITIES.financeRead,
      ADMIN_CAPABILITIES.systemRead,
    ],
    backendDomains: ['newapiProviders', 'plans', 'settings'],
    debugId: 'Desktop > Admin > model-billing-matrix',
    description: '统一管理模型目录、倍率和套餐计费',
    group: 'ai-platform',
    icon: 'pricing',
    id: 'model-billing-matrix',
    label: '模型目录与计费',
    owner: 'ai-platform',
    path: pathFor('model-billing-matrix'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'model-billing-matrix',
    status: 'active',
    writeCapabilities: [
      ADMIN_CAPABILITIES.modelOpsWrite,
      ADMIN_CAPABILITIES.financeWrite,
      ADMIN_CAPABILITIES.systemWrite,
    ],
  },
  {
    backendDomains: ['settings'],
    debugId: 'Desktop > Admin > model-policy',
    description: '配置平台模型访问允许和禁用策略',
    group: 'ai-platform',
    icon: 'models',
    id: 'model-policy',
    label: '模型访问策略',
    owner: 'ai-platform',
    path: pathFor('model-policy'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'model-policy',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['ppt'],
    debugId: 'Desktop > Admin > ppt',
    description: '配置 PPT 生成服务和套餐额度',
    group: 'ai-platform',
    icon: 'ppt',
    id: 'ppt',
    label: '生成服务',
    owner: 'ai-platform',
    path: pathFor('ppt'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'ppt',
    status: 'experimental',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['settings'],
    debugId: 'Desktop > Admin > ai-runtime-defaults',
    description: '配置向量检索和记忆抽取的 AI 运行时默认模型',
    group: 'ai-platform',
    icon: 'system-defaults',
    id: 'ai-runtime-defaults',
    label: 'AI 运行时默认值',
    owner: 'ai-runtime',
    path: pathFor('ai-runtime-defaults'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'ai-runtime-defaults',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    accessCapabilities: [ADMIN_CAPABILITIES.moduleAppRead, ADMIN_CAPABILITIES.financeRead],
    backendDomains: ['moduleApps'],
    debugId: 'Desktop > Admin > modules',
    description: '治理模块应用、审核、商业化和运行数据',
    group: 'module-apps',
    icon: 'plugins',
    id: 'modules',
    label: '模块应用中心',
    owner: 'module-apps',
    path: pathFor('modules'),
    readCapability: ADMIN_CAPABILITIES.moduleAppRead,
    segment: 'modules',
    status: 'experimental',
    writeCapabilities: [
      ADMIN_CAPABILITIES.moduleAppWrite,
      ADMIN_CAPABILITIES.financeWrite,
      ADMIN_CAPABILITIES.auditRead,
    ],
  },
  {
    backendDomains: ['engineeringTools'],
    debugId: 'Desktop > Admin > engineering-tools',
    description: '维护工程工具、分类、排序、启停和三个侧栏入口',
    group: 'module-apps',
    icon: 'plugins',
    id: 'engineering-tools',
    label: '工程工具目录',
    owner: 'module-apps',
    path: pathFor('engineering-tools'),
    readCapability: ADMIN_CAPABILITIES.moduleAppRead,
    segment: 'engineering-tools',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.moduleAppWrite],
  },
  {
    backendDomains: ['content'],
    debugId: 'Desktop > Admin > content-resources',
    description: '集中管理话题、资源文件和用户文档',
    group: 'content-operations',
    icon: 'documents',
    id: 'content-resources',
    label: '内容资源',
    owner: 'content',
    path: pathFor('content-resources'),
    readCapability: ADMIN_CAPABILITIES.contentRead,
    segment: 'content-resources',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.contentWrite],
  },
  {
    backendDomains: ['settings'],
    debugId: 'Desktop > Admin > content-operations',
    description: '集中管理推荐、专家广场、公告通知和运营开关',
    group: 'content-operations',
    icon: 'recommendations',
    id: 'content-operations',
    label: '内容运营',
    owner: 'operations',
    path: pathFor('content-operations'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'content-operations',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['settings', 'referral'],
    debugId: 'Desktop > Admin > growth',
    description: '配置注册、推荐和增长策略',
    group: 'content-operations',
    icon: 'growth',
    id: 'growth',
    label: '注册与增长',
    owner: 'operations',
    path: pathFor('growth'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'growth',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['settings', 'desktop-release'],
    debugId: 'Desktop > Admin > desktop-update',
    description: '统一管理桌面安装、版本、客户端状态和更新设置',
    group: 'client-integrations',
    icon: 'desktop',
    id: 'desktop-update',
    label: '桌面端控制中心',
    owner: 'client',
    path: pathFor('desktop-update'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'desktop-update',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['settings'],
    debugId: 'Desktop > Admin > mobile',
    description: '统一管理移动端品牌、底部导航、发现内容和应用入口',
    group: 'client-integrations',
    icon: 'mobile',
    id: 'mobile',
    label: '移动端控制中心',
    owner: 'client',
    path: pathFor('mobile'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'mobile',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['settings'],
    debugId: 'Desktop > Admin > integrations',
    description: '配置 Composio 等外部工具集成',
    group: 'client-integrations',
    icon: 'plugins',
    id: 'integrations',
    label: '外部集成',
    owner: 'integrations',
    path: pathFor('integrations'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'integrations',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['settings', 's3'],
    debugId: 'Desktop > Admin > file-storage',
    description: '配置对象存储、CDN 和预签名 URL',
    group: 'client-integrations',
    icon: 'file-storage',
    id: 'file-storage',
    label: '文件存储',
    owner: 'storage',
    path: pathFor('file-storage'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'file-storage',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['settings'],
    debugId: 'Desktop > Admin > settings',
    description: '配置站点品牌、登录页和帮助入口',
    group: 'system-security',
    icon: 'settings',
    id: 'settings',
    label: '站点与品牌',
    owner: 'system',
    path: pathFor('settings'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'settings',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['settings'],
    debugId: 'Desktop > Admin > maintenance',
    description: '管理缓存、数据保留和维护任务',
    group: 'system-security',
    icon: 'maintenance',
    id: 'maintenance',
    label: '缓存与维护',
    owner: 'system',
    path: pathFor('maintenance'),
    readCapability: ADMIN_CAPABILITIES.systemRead,
    segment: 'maintenance',
    status: 'active',
    writeCapabilities: [ADMIN_CAPABILITIES.systemWrite],
  },
  {
    backendDomains: ['audit'],
    debugId: 'Desktop > Admin > audit',
    description: '查询后台操作和敏感动作记录',
    group: 'system-security',
    icon: 'audit',
    id: 'audit',
    label: '审计日志',
    owner: 'security',
    path: pathFor('audit'),
    readCapability: ADMIN_CAPABILITIES.auditRead,
    segment: 'audit',
    status: 'active',
    writeCapabilities: [],
  },
] as const satisfies readonly AdminCatalogItem[];

export const getAdminCatalogAccessCapabilities = (item: AdminCatalogItem) =>
  item.accessCapabilities ?? [item.readCapability];

export type AdminCatalogId = (typeof ADMIN_CATALOG)[number]['id'];
