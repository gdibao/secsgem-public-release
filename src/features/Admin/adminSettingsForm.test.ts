import { DEFAULT_PRICING_CREDIT_MULTIPLIER } from '@lobechat/const/currency';
import { describe, expect, it } from 'vitest';

import { DEFAULT_COMHUB_AGENT_AVATAR, DEFAULT_COMHUB_AGENT_NAME } from '@/const/defaultAgent';

import {
  ADMIN_SETTINGS_FORM_SETTING_KEYS,
  ADMIN_SETTINGS_NON_FORM_SETTING_KEYS,
  buildFormValues,
  buildModelOptions,
  buildSettingMaterializationUpdates,
  buildSettingUpdates,
  getAdminSettingsRefreshKeys,
  resolveModelOptionValue,
  resolveModelProviderLabel,
  SETTING_KEYS,
} from './adminSettingsForm';

describe('adminSettingsForm', () => {
  it('uses the shared app setting key registry', () => {
    expect(SETTING_KEYS.brandName).toBe('brand.name');
    expect(SETTING_KEYS.desktopDownloadUrl).toBe('desktop.download.url');
    expect(SETTING_KEYS.plansFaqItems).toBe('plans.faq.items');
  });

  it('classifies every registered app setting as form-managed or explicitly non-form', () => {
    const allRegisteredKeys = Object.values(SETTING_KEYS).sort();
    const formKeys = [...ADMIN_SETTINGS_FORM_SETTING_KEYS].sort();
    const nonFormKeys = [...ADMIN_SETTINGS_NON_FORM_SETTING_KEYS].sort();
    const nonFormKeySet = new Set<string>(nonFormKeys);
    const coveredKeys = [...new Set([...formKeys, ...nonFormKeys])].sort();

    expect(formKeys).toEqual([...new Set(formKeys)]);
    expect(nonFormKeys).toEqual([...new Set(nonFormKeys)]);
    expect(formKeys.filter((key) => nonFormKeySet.has(key))).toEqual([]);
    expect(coveredKeys).toEqual(allRegisteredKeys);
    expect(formKeys).toContain(SETTING_KEYS.brandName);
    expect(nonFormKeys).toContain(SETTING_KEYS.composioApiKey);
  });

  it('builds default model options from enabled provider models and suggestions', () => {
    expect(
      buildModelOptions({
        defaultModelSuggestions: ['manual-chat', 'deepseek-chat'],
        enabledNewapiModels: [
          {
            displayName: 'DeepSeek Chat',
            instanceName: '主网关',
            modelId: 'deepseek-chat',
            modelType: 'chat',
            provider: 'newapi',
          },
          {
            displayName: null,
            instanceName: '图像网关',
            modelId: 'flux-kontext',
            modelType: 'image',
            provider: 'newapi',
          },
        ],
      }),
    ).toEqual([
      {
        label: 'DeepSeek Chat (newapi / 主网关 / chat)',
        model: 'deepseek-chat',
        provider: 'newapi',
        providerLabel: 'newapi / 主网关',
        value: 'newapi:deepseek-chat',
      },
      {
        label: 'flux-kontext (newapi / 图像网关 / image)',
        model: 'flux-kontext',
        provider: 'newapi',
        providerLabel: 'newapi / 图像网关',
        value: 'newapi:flux-kontext',
      },
      {
        label: 'manual-chat (newapi / suggested)',
        model: 'manual-chat',
        provider: 'newapi',
        value: 'newapi:manual-chat',
      },
    ]);
  });

  it('uses managed provider display name in model option labels while preserving provider id', () => {
    expect(
      buildModelOptions({
        enabledNewapiModels: [
          {
            displayName: 'Qwen Coder',
            instanceName: 'OpenCode Go',
            modelId: 'qwen3-coder',
            modelType: 'chat',
            provider: 'opencodego-1234567890',
          },
        ],
      }),
    ).toEqual([
      {
        label: 'Qwen Coder (opencodego-1234567890 / OpenCode Go / chat)',
        model: 'qwen3-coder',
        provider: 'opencodego-1234567890',
        providerLabel: 'opencodego-1234567890 / OpenCode Go',
        value: 'opencodego-1234567890:qwen3-coder',
      },
    ]);
  });

  it('resolves a legacy provider id model value to the unique enabled model option', () => {
    const options = buildModelOptions({
      enabledNewapiModels: [
        {
          displayName: 'DeepSeek Chat',
          instanceName: 'Primary Gateway',
          modelId: 'deepseek-chat',
          modelType: 'chat',
          provider: 'newapi',
        },
      ],
    });

    expect(
      resolveModelOptionValue({ model: 'deepseek-chat', provider: '1234567890' }, options),
    ).toBe('newapi:deepseek-chat');
  });

  it('uses provider type and instance name instead of numeric provider ids in model option labels', () => {
    const options = buildModelOptions({
      enabledNewapiModels: [
        {
          displayName: 'OpenCode Chat',
          instanceName: 'OpenCode Gateway',
          modelId: 'opencode-chat',
          modelType: 'chat',
          provider: '1234567890',
          providerType: 'opencodego',
        },
      ],
    });

    expect(options[0]).toMatchObject({
      label: 'OpenCode Chat (opencodego / OpenCode Gateway / chat)',
      provider: '1234567890',
      providerLabel: 'opencodego / OpenCode Gateway',
      value: '1234567890:opencode-chat',
    });
    expect(options[0].label).not.toContain('1234567890');
  });

  it('resolves managed provider labels for UUID-backed memory model settings', () => {
    const options = buildModelOptions({
      enabledNewapiModels: [
        {
          displayName: 'DeepSeek V4 Pro',
          instanceName: 'OpenCode Go',
          modelId: 'deepseek-v4-pro',
          modelType: 'chat',
          provider: '757e1732-8478-4c93-a4dd-1e17489a9c48',
          providerType: 'opencode-go',
        },
      ],
    });

    expect(
      resolveModelProviderLabel(
        {
          model: 'deepseek-v4-pro',
          provider: '757e1732-8478-4c93-a4dd-1e17489a9c48',
        },
        options,
      ),
    ).toBe('opencode-go / OpenCode Go');
  });

  it('shows provider type and instance group without leaking UUID provider ids', () => {
    const options = buildModelOptions({
      enabledNewapiModels: [
        {
          displayName: 'Qwen Coder',
          instanceName: 'OpenCode Gateway',
          modelId: 'qwen-coder',
          modelType: 'chat',
          provider: '757e1732-8478-4c93-a4dd-1e17489a9c48',
          providerType: 'opencode-go',
        },
      ],
    });

    expect(options[0]).toMatchObject({
      label: 'Qwen Coder (opencode-go / OpenCode Gateway / chat)',
      providerLabel: 'opencode-go / OpenCode Gateway',
      value: '757e1732-8478-4c93-a4dd-1e17489a9c48:qwen-coder',
    });
    expect(options[0].label).not.toContain('757e1732');
  });

  it('builds site setting updates only for changed site basics', () => {
    const initial = {
      ...buildFormValues(),
      brandFaviconUrl: '',
      brandAuthTitle: 'Agent teammates that grow with you',
      brandCopyrightText: '© 2026 驰拓 AI. All rights reserved.',
      brandLogoUrl: '/logo.png',
      brandLoadingText: 'Loading',
      brandLoadingSvgUrl: '',
      brandName: '驰拓 AI',
      brandPrimaryColor: '#1677ff',
      brandSlogan: '',
      aboutLogoUrl: '',
      communitySkillUseButtonLabel: '',
      aboutLinks: {
        contact: [],
        information: [],
        legal: [],
      },
      cronAuditRetentionDays: 365,
      cronPendingOrderExpiryDays: 7,
      cronSecret: '',
      defaultAgentAvatar: '/avatars/xuangguo-ai.png',
      defaultAgentModel: 'gpt-4o-mini',
      defaultAgentName: DEFAULT_COMHUB_AGENT_NAME,
      defaultAgentProvider: 'newapi',
      defaultImageModel: 'flux-pro',
      defaultImageProvider: 'newapi',
      defaultSkillName: 'LobeHub',
      defaultVideoModel: 'sora-2',
      defaultVideoProvider: 'newapi',
      helpMenuItems: [],
      memoryUserMemoryTriggerMode: 'auto' as const,
      ordersEnabled: true,
      pricingMultiplier: DEFAULT_PRICING_CREDIT_MULTIPLIER,
      profileInterestAreas: [],
      referralRewardCredits: 0,
      sidebarGenerationLabel: '生成',
      sidebarMemberLabel: '会员',
      sidebarMemberUrl: '/settings/plans',
    };

    expect(
      buildSettingUpdates(
        {
          ...initial,
          brandName: 'ComHub',
        },
        initial,
      ),
    ).toEqual([{ key: SETTING_KEYS.brandName, value: 'ComHub' }]);
  });

  it('includes about page logo in brand setting updates', () => {
    const initial = buildFormValues({
      aboutLogoUrl: '',
      brandLogoUrl: '/brand/logo.svg',
    });

    expect(initial.aboutLogoUrl).toBe('');

    expect(
      buildSettingUpdates(
        {
          ...initial,
          aboutLogoUrl: '/uploads/admin/about-logo.png',
        },
        initial,
      ),
    ).toEqual([{ key: SETTING_KEYS.aboutLogoUrl, value: '/uploads/admin/about-logo.png' }]);

    expect(
      getAdminSettingsRefreshKeys([
        { key: SETTING_KEYS.aboutLogoUrl, value: '/uploads/admin/about-logo.png' },
      ]),
    ).toEqual(['brand-config']);
  });

  it('keeps default image and video model values readable without saving them from site settings', () => {
    const initial = buildFormValues({
      defaultImageModel: 'flux-pro',
      defaultImageProvider: 'newapi',
      defaultVideoModel: 'sora-2',
      defaultVideoProvider: 'newapi',
    });

    expect(initial.defaultImageModel).toBe('flux-pro');
    expect(initial.defaultImageProvider).toBe('newapi');
    expect(initial.defaultVideoModel).toBe('sora-2');
    expect(initial.defaultVideoProvider).toBe('newapi');

    expect(
      buildSettingUpdates(
        {
          ...initial,
          defaultImageModel: 'flux-kontext',
          defaultVideoModel: 'kling-v2',
        },
        initial,
      ),
    ).toEqual([]);
  });

  it('includes default assistant name and avatar in form values and updates', () => {
    const initial = buildFormValues({
      defaultAgentAvatar: DEFAULT_COMHUB_AGENT_AVATAR,
      defaultAgentName: DEFAULT_COMHUB_AGENT_NAME,
    });

    expect(initial.defaultAgentName).toBe(DEFAULT_COMHUB_AGENT_NAME);
    expect(initial.defaultAgentAvatar).toBe(DEFAULT_COMHUB_AGENT_AVATAR);

    expect(
      buildSettingUpdates(
        {
          ...initial,
          defaultAgentAvatar: '/images/brand/logo.svg',
          defaultAgentName: '驰拓 AI 助手',
        },
        initial,
      ),
    ).toEqual([
      { key: SETTING_KEYS.defaultAgentName, value: '驰拓 AI 助手' },
      { key: SETTING_KEYS.defaultAgentAvatar, value: '/images/brand/logo.svg' },
    ]);
  });

  it('falls back instead of materializing empty default assistant identity', () => {
    const initial = buildFormValues({
      brandName: 'ComHub',
      defaultAgentAvatar: '',
      defaultAgentName: '',
      defaultSkillName: '',
    });

    expect(initial.defaultAgentName).toBe(DEFAULT_COMHUB_AGENT_NAME);
    expect(initial.defaultAgentAvatar).toBe(DEFAULT_COMHUB_AGENT_AVATAR);
    expect(initial.defaultSkillName).toBe('ComHub');

    expect(
      buildSettingMaterializationUpdates({
        ...initial,
        defaultAgentAvatar: '',
        defaultAgentName: '',
        defaultSkillName: '',
      }),
    ).toEqual(
      expect.arrayContaining([
        { key: SETTING_KEYS.defaultAgentName, value: DEFAULT_COMHUB_AGENT_NAME },
        { key: SETTING_KEYS.defaultAgentAvatar, value: DEFAULT_COMHUB_AGENT_AVATAR },
        { key: SETTING_KEYS.defaultSkillName, value: 'ComHub' },
      ]),
    );
  });

  it('includes default skill name in form values and updates', () => {
    const initial = buildFormValues({
      defaultSkillName: 'LobeHub',
    });

    expect(initial.defaultSkillName).toBe('LobeHub');

    expect(
      buildSettingUpdates(
        {
          ...initial,
          defaultSkillName: '驰拓技能',
        },
        initial,
      ),
    ).toEqual([{ key: SETTING_KEYS.defaultSkillName, value: '驰拓技能' }]);
  });

  it('includes login page title and copyright in brand setting updates', () => {
    const initial = buildFormValues({
      brandAuthTitle: 'Agent teammates that grow with you',
      brandCopyrightText: '© 2026 驰拓 AI. All rights reserved.',
    });

    expect(
      buildSettingUpdates(
        {
          ...initial,
          brandAuthTitle: '与团队一起成长的 AI 助手',
          brandCopyrightText: '© 2026 Xuangguo AI',
        },
        initial,
      ),
    ).toEqual([
      { key: SETTING_KEYS.brandAuthTitle, value: '与团队一起成长的 AI 助手' },
      { key: SETTING_KEYS.brandCopyrightText, value: '© 2026 Xuangguo AI' },
    ]);
  });

  it('includes home messenger controls and community fork copy in brand setting updates', () => {
    const initial = buildFormValues({
      communityForkAndChatLabel: '',
      communitySkillUseButtonLabel: '',
      homeMessengerEnabled: true,
      homeMessengerBannerTitle: '',
    });

    expect(
      buildSettingUpdates(
        {
          ...initial,
          communityForkAndChatLabel: '立即派生',
          communitySkillUseButtonLabel: 'Use in ComHub',
          homeMessengerEnabled: false,
          homeMessengerBannerTitle: '在聊天平台中，与 {{brandName}} 畅聊',
        },
        initial,
      ),
    ).toEqual([
      {
        key: SETTING_KEYS.homeMessengerBannerTitle,
        value: '在聊天平台中，与 {{brandName}} 畅聊',
      },
      { key: SETTING_KEYS.homeMessengerEnabled, value: false },
      { key: SETTING_KEYS.communityForkAndChatLabel, value: '立即派生' },
      { key: SETTING_KEYS.communitySkillUseButtonLabel, value: 'Use in ComHub' },
    ]);

    expect(
      getAdminSettingsRefreshKeys([
        { key: SETTING_KEYS.communitySkillUseButtonLabel, value: 'Use in ComHub' },
        {
          key: SETTING_KEYS.homeMessengerBannerTitle,
          value: '在聊天平台中，与 {{brandName}} 畅聊',
        },
      ]),
    ).toEqual(['serverConfig:get', ['user:initState'], 'brand-config']);
  });

  it('includes sidebar member and generation labels in brand setting updates', () => {
    const initial = buildFormValues({
      sidebarGenerationLabel: '生成',
      sidebarMemberLabel: '会员',
      sidebarMemberUrl: '/settings/plans',
    });

    expect(
      buildSettingUpdates(
        {
          ...initial,
          sidebarGenerationLabel: '创作',
          sidebarMemberLabel: '会员中心',
          sidebarMemberUrl: '/settings/plans?tab=vip',
        },
        initial,
      ),
    ).toEqual([
      { key: SETTING_KEYS.sidebarMemberLabel, value: '会员中心' },
      { key: SETTING_KEYS.sidebarMemberUrl, value: '/settings/plans?tab=vip' },
      { key: SETTING_KEYS.sidebarGenerationLabel, value: '创作' },
    ]);

    expect(
      getAdminSettingsRefreshKeys([{ key: SETTING_KEYS.sidebarMemberLabel, value: '会员中心' }]),
    ).toEqual(['brand-config']);
  });

  it('keeps loading copy separate from login and slogan copy', () => {
    const initial = buildFormValues({
      brandAuthTitle: 'Login page copy',
      brandLoadingText: 'Loading copy',
      brandSlogan: 'Legacy slogan',
    });

    expect(initial.brandAuthTitle).toBe('Login page copy');
    expect(initial.brandLoadingText).toBe('Loading copy');
    expect(initial.brandSlogan).toBe('Legacy slogan');

    expect(
      buildSettingUpdates(
        {
          ...initial,
          brandLoadingText: 'Only this appears while loading',
        },
        initial,
      ),
    ).toEqual([{ key: SETTING_KEYS.brandLoadingText, value: 'Only this appears while loading' }]);
  });

  it('refreshes runtime config and user state when default assistant config changes', () => {
    expect(
      getAdminSettingsRefreshKeys([
        { key: SETTING_KEYS.defaultAgentModel, value: 'deepseek-chat' },
      ]),
    ).toEqual(['serverConfig:get', ['user:initState']]);

    expect(
      getAdminSettingsRefreshKeys([
        { key: SETTING_KEYS.defaultAgentName, value: DEFAULT_COMHUB_AGENT_NAME },
      ]),
    ).toEqual(['serverConfig:get', ['user:initState']]);

    expect(
      getAdminSettingsRefreshKeys([{ key: SETTING_KEYS.brandName, value: '驰拓 AI' }]),
    ).toEqual(['brand-config']);
  });

  it('refreshes runtime config and user state when memory analysis models change', () => {
    expect(
      getAdminSettingsRefreshKeys([
        { key: SETTING_KEYS.memoryUserMemoryGatekeeperModel, value: 'gpt-5.5' },
      ]),
    ).toEqual(['serverConfig:get', ['user:initState']]);

    expect(
      getAdminSettingsRefreshKeys([
        { key: SETTING_KEYS.memoryUserMemoryEmbeddingProvider, value: 'siliconflow' },
      ]),
    ).toEqual(['serverConfig:get', ['user:initState']]);
  });

  it('shares the pricing model rules setting key with matrix-style admin pages', () => {
    expect(SETTING_KEYS.pricingModelRules).toBe('pricing.modelRules');
  });

  it('shares profile interest setting key with admin-managed profile options', () => {
    expect(SETTING_KEYS.profileInterestAreas).toBe('profile.interestAreas');
  });

  it('keeps memory trigger mode readable without saving it from site settings', () => {
    const initial = buildFormValues({
      memoryUserMemoryTriggerMode: 'auto',
    });

    expect(initial.memoryUserMemoryTriggerMode).toBe('auto');

    expect(
      buildSettingUpdates(
        {
          ...initial,
          memoryUserMemoryTriggerMode: 'direct',
        },
        initial,
      ),
    ).toEqual([]);
  });

  it('keeps global billing controls readable without saving them from site settings', () => {
    const initial = buildFormValues({
      ordersManagementEnabled: true,
      pricingCreditMultiplier: 1,
    });

    expect(initial.ordersEnabled).toBe(true);
    expect(initial.pricingMultiplier).toBe(1);

    expect(
      buildSettingUpdates(
        {
          ...initial,
          ordersEnabled: false,
          pricingMultiplier: 1.35,
        },
        initial,
      ),
    ).toEqual([]);
  });

  it('defaults global pricing multiplier to the configured 35 percent margin', () => {
    const initial = buildFormValues();

    expect(initial.pricingMultiplier).toBe(DEFAULT_PRICING_CREDIT_MULTIPLIER);
  });

  it('normalizes non-positive global pricing multiplier to the configured 35 percent margin', () => {
    const initial = buildFormValues();

    expect(buildSettingUpdates({ ...initial, pricingMultiplier: 0 }, initial)).toEqual([]);
  });

  it('keeps S3 storage settings readable without saving them from site settings', () => {
    const initial = buildFormValues({
      storageS3AccessKeyId: 'env-access-key',
      storageS3Bucket: 'env-bucket',
      storageS3EnablePathStyle: false,
      storageS3Endpoint: 'https://env-s3.example.com',
      storageS3FilePath: 'env-files',
      storageS3PreviewUrlExpireIn: 7200,
      storageS3PublicDomain: '',
      storageS3Region: 'us-east-1',
      storageS3SecretAccessKeyConfigured: true,
      storageS3SetAcl: true,
    });

    expect(initial.storageS3SecretAccessKey).toBe('');
    expect(initial.storageS3SecretAccessKeyConfigured).toBe(true);

    expect(
      buildSettingUpdates(
        {
          ...initial,
          storageS3AccessKeyId: 'admin-access-key',
          storageS3Bucket: 'admin-bucket',
          storageS3EnablePathStyle: true,
          storageS3Endpoint: 'https://admin-s3.example.com',
          storageS3FilePath: '/admin-files/',
          storageS3PreviewUrlExpireIn: 1800,
          storageS3PublicDomain: 'https://cdn.example.com',
          storageS3Region: 'ap-southeast-1',
          storageS3SecretAccessKey: 'new-secret',
          storageS3SetAcl: false,
        },
        initial,
      ),
    ).toEqual([]);
  });

  it('does not rotate S3 secrets from site settings', () => {
    const initial = buildFormValues({
      storageS3AccessKeyId: 'env-access-key',
      storageS3Bucket: 'env-bucket',
      storageS3Endpoint: 'https://env-s3.example.com',
      storageS3SecretAccessKeyConfigured: true,
    });

    expect(
      buildSettingUpdates(
        {
          ...initial,
          storageS3SecretAccessKey: 'rotated-secret',
        },
        initial,
      ),
    ).toEqual([]);
  });

  it('saves about page links as one shared setting', () => {
    const initial = buildFormValues({
      aboutLinks: {
        contact: [{ id: 'officialSite', label: '官方网站', url: 'https://lobehub.com' }],
        information: [],
        legal: [],
      },
    });

    expect(
      buildSettingUpdates(
        {
          ...initial,
          aboutLinks: {
            ...initial.aboutLinks,
            contact: [
              { id: 'officialSite', label: '驰拓官网', url: 'https://xuangguo.example.com' },
            ],
          },
        },
        initial,
      ),
    ).toEqual([
      {
        key: SETTING_KEYS.aboutLinks,
        value: {
          ...initial.aboutLinks,
          contact: [
            { id: 'officialSite', label: '驰拓官网', url: 'https://xuangguo.example.com' },
            ...initial.aboutLinks.contact.slice(1),
          ],
        },
      },
    ]);
  });

  it('preserves structured help menu settings for public navigation customization', () => {
    const initial = buildFormValues({
      helpMenuItems: [
        {
          action: 'url',
          enabled: true,
          icon: 'book',
          key: 'docs',
          label: ' Docs ',
          url: ' https://docs.example.com ',
        },
        {
          action: 'feedback',
          enabled: false,
          icon: 'feather',
          key: 'feedback',
          label: 'Hidden feedback',
        },
      ],
    } as any);

    expect(initial.helpMenuItems).toEqual([
      {
        action: 'url',
        enabled: true,
        icon: 'book',
        key: 'docs',
        label: 'Docs',
        url: 'https://docs.example.com',
      },
    ]);

    expect(
      buildSettingUpdates(
        {
          ...initial,
          helpMenuItems: [
            ...initial.helpMenuItems,
            {
              action: 'changelog',
              enabled: true,
              icon: 'file-clock',
              key: 'updates',
              label: 'Updates',
            },
          ],
        },
        initial,
      ),
    ).toEqual([
      {
        key: SETTING_KEYS.helpMenuItems,
        value: [
          ...initial.helpMenuItems,
          {
            action: 'changelog',
            enabled: true,
            icon: 'file-clock',
            key: 'updates',
            label: 'Updates',
          },
        ],
      },
    ]);

    expect(getAdminSettingsRefreshKeys([{ key: SETTING_KEYS.helpMenuItems, value: [] }])).toEqual([
      'public-help-menu',
    ]);
  });

  it('materializes site customization defaults without restoring explicitly empty help menus', () => {
    const values = buildFormValues({
      brandLoadingText: 'Loading ComHub',
      brandName: 'ComHub',
      helpMenuItems: [],
    } as any);

    expect(buildSettingMaterializationUpdates(values)).toEqual(
      expect.arrayContaining([
        { key: SETTING_KEYS.brandName, value: 'ComHub' },
        { key: SETTING_KEYS.brandLoadingText, value: 'Loading ComHub' },
        { key: SETTING_KEYS.sidebarMemberLabel, value: '会员' },
        { key: SETTING_KEYS.sidebarMemberUrl, value: '/settings/plans' },
        { key: SETTING_KEYS.helpMenuItems, value: [] },
      ]),
    );
  });

  it('saves about page version settings as one public setting', () => {
    const initial = buildFormValues({
      aboutPage: {
        changelogLabel: 'Changelog',
        changelogUrl: 'https://old.example.com/changelog',
        logoLinkUrl: 'https://old.example.com',
      },
    } as any) as any;

    expect(initial.aboutPage).toEqual({
      changelogLabel: 'Changelog',
      changelogUrl: 'https://old.example.com/changelog',
      logoLinkUrl: 'https://old.example.com',
    });

    expect(getAdminSettingsRefreshKeys([{ key: 'about.page', value: initial.aboutPage }])).toEqual([
      'public-about-page',
    ]);
  });
});
