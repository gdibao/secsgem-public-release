'use client';

import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Avatar, Flexbox } from '@lobehub/ui';
import { Button, confirmModal, Select } from '@lobehub/ui/base-ui';
import { Alert, Form, Input, message, Switch } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/antd-compat/Card';
import {
  ADMIN_SETTINGS_SECTION_SWR_KEY,
  PROFILE_INTEREST_AREAS_SWR_KEY,
  PROFILE_OPTIONS_SWR_KEY,
  RUNTIME_CONFIG_SWR_KEY,
  USER_STATE_SWR_KEY,
} from '@/const/adminCacheKeys';
import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import { type AvatarPreset, DEFAULT_AVATAR_PRESETS } from '@/const/avatarPresets';
import { buildRuntimeSettingUpdates } from '@/features/Admin/adminRuntimeModelSettings';
import { buildModelOptions, resolveModelOptionValue } from '@/features/Admin/adminSettingsForm';
import ImageUrlUploadInput from '@/features/Admin/components/ImageUrlUploadInput';
import RuntimeModelFieldPair from '@/features/Admin/components/RuntimeModelFieldPair';
import {
  type ConfiguredInterestArea,
  normalizeConfiguredInterestAreas,
} from '@/features/ProfileInterests/interestAreas';
import { mutate, useClientDataSWR } from '@/libs/swr';
import {
  adminCommercialService,
  AdminSettingsRevisionConflictError,
} from '@/services/adminCommercial';

import { AdminFormActions, AdminPageError, AdminPageShell } from './layout';
import AdminSettingsConflictAlert from './shared/AdminSettingsConflictAlert';

export type AdminDefaultSettingsScope = 'ai-runtime-defaults' | 'integrations' | 'user-defaults';

type FormValues = {
  avatarPresets: AvatarPreset[];
  composioApiKey?: string;
  composioAuthConfigIds?: string;
  composioClearApiKey?: boolean;
  composioEnabled?: boolean;
  disabledBuiltinToolsText: string;
  languageModelDefaultsJson: string;
  memoryEmbeddingModel: string;
  memoryEmbeddingProvider: string;
  memoryGatekeeperModel: string;
  memoryGatekeeperProvider: string;
  memoryLayerExtractorModel: string;
  memoryLayerExtractorProvider: string;
  memoryPersonaWriterModel: string;
  memoryPersonaWriterProvider: string;
  profileInterestAreas: ConfiguredInterestArea[];
  serviceModelAgentMeta: string;
  serviceModelDefaultAgent: string;
  serviceModelFollowUpAction: string;
  serviceModelFollowUpActionEnabled: boolean;
  serviceModelGenerationTopic: string;
  serviceModelHistoryCompress: string;
  serviceModelInputCompletion: string;
  serviceModelInputCompletionEnabled: boolean;
  serviceModelPromptRewrite: string;
  serviceModelPromptRewriteEnabled: boolean;
  serviceModelThread: string;
  serviceModelTopic: string;
  serviceModelTranslation: string;
  userGlobalSettingsJson: string;
  vectorEmbeddingModel: string;
  vectorEmbeddingProvider: string;
  vectorQueryMode: string;
  vectorRerankerModel: string;
  vectorRerankerProvider: string;
};

type DefaultSettingsData = {
  avatarPresets?: AvatarPreset[];
  composioConfig?: {
    apiKeyConfigured?: boolean;
    apiKeyMasked?: string;
    authConfigIds?: string;
    enabled?: boolean;
  };
  memoryExtractionConfig?: Record<string, string | undefined>;
  profileInterestAreas?: unknown;
  sharedHealth?: { enabledNewapiModels?: unknown[] };
  userGlobalSettingsDefaults?: Record<string, any>;
  vectorConfig?: Record<string, string | undefined>;
};

type SettingUpdate = { key: string; value: unknown };

const jsonStringify = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const RUNTIME_SAVE_ERROR_MESSAGES: Record<string, string> = {
  DEFAULT_MODEL_DENIED_BY_FREE_PLAN: '该模型不在免费套餐允许范围内，请更换模型。',
  DEFAULT_MODEL_NOT_ENABLED: '该模型当前未启用，请先在模型目录中启用。',
  DEFAULT_MODEL_TYPE_MISMATCH: '所选模型类型与此运行时用途不匹配。',
};

const splitTextList = (value?: string) =>
  Array.from(
    new Set(
      (value ?? '')
        .split(/[\r\n,;，；]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const parseJsonObject = (value: string) => {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('USER_GLOBAL_SETTINGS_MUST_BE_OBJECT');
  }

  return parsed as Record<string, any>;
};

const parseModelValue = (value?: string) => {
  if (!value) return null;
  const [provider, ...modelParts] = value.split(':');
  const model = modelParts.join(':');

  return provider && model ? { model, provider } : null;
};

const applyModelValue = (target: Record<string, any>, key: string, value?: string) => {
  const current =
    target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
      ? { ...target[key] }
      : {};
  delete current.model;
  delete current.provider;

  const modelConfig = parseModelValue(value);
  if (!modelConfig) {
    if (Object.keys(current).length > 0) target[key] = current;
    else delete target[key];
    return;
  }

  target[key] = { ...current, ...modelConfig };
};

const userModelFields: { extra: string; field: keyof FormValues; label: string }[] = [
  {
    extra: '用户打开“服务模型”页时会先看到此默认值，之后仍可保存自己的选择。',
    field: 'serviceModelDefaultAgent',
    label: '默认助手模型',
  },
  { extra: '用于自动生成会话标题。', field: 'serviceModelTopic', label: '话题命名模型' },
  {
    extra: '用于图像、视频和 PPT 等生成主题的自动命名。',
    field: 'serviceModelGenerationTopic',
    label: '生成主题命名模型',
  },
  { extra: '用于消息翻译。', field: 'serviceModelTranslation', label: '消息翻译模型' },
  { extra: '用于压缩长对话历史。', field: 'serviceModelHistoryCompress', label: '历史压缩模型' },
  {
    extra: '用于生成助手资料、描述和元信息。',
    field: 'serviceModelAgentMeta',
    label: '助手资料生成模型',
  },
  { extra: '用于子话题命名。', field: 'serviceModelThread', label: '子话题命名模型' },
];

const scopeCopy: Record<
  AdminDefaultSettingsScope,
  { description: string; descriptionKey: string; title: string; titleKey: string }
> = {
  'ai-runtime-defaults': {
    description:
      '配置向量检索和记忆抽取的运行时模型。可单独保存，或将可映射的记忆模型同步到所有用户设置。',
    descriptionKey: 'admin.defaultSettings.aiRuntime.description',
    title: 'AI 运行时默认值',
    titleKey: 'admin.defaultSettings.aiRuntime.title',
  },
  'integrations': {
    description: '配置可选的 Composio 工具集成。保存不会修改 AI 运行时或用户默认设置。',
    descriptionKey: 'admin.defaultSettings.integrations.description',
    title: '外部集成',
    titleKey: 'admin.defaultSettings.integrations.title',
  },
  'user-defaults': {
    description: '配置新用户继承的模型、工具、头像和兴趣领域默认值。',
    descriptionKey: 'admin.defaultSettings.userDefaults.description',
    title: '用户默认值',
    titleKey: 'admin.defaultSettings.userDefaults.title',
  },
};

const AdminDefaultSettingsPage = memo<{ scope: AdminDefaultSettingsScope }>(({ scope }) => {
  const { t } = useTranslation('subscription');
  const [form] = Form.useForm<FormValues>();
  const [saveError, setSaveError] = useState<unknown>();
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const {
    data,
    error,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR(ADMIN_SETTINGS_SECTION_SWR_KEY(scope), () =>
    adminCommercialService.getSettingsSection(scope),
  );
  const { data: storageSettings } = useClientDataSWR(
    scope === 'user-defaults' ? ADMIN_SETTINGS_SECTION_SWR_KEY('file-storage') : null,
    () => adminCommercialService.getSettingsSection('file-storage'),
  );
  const settings = data as DefaultSettingsData | undefined;
  const uploadPublicUrlPrefix = storageSettings?.storageS3PublicDomain || undefined;
  const modelOptions = useMemo(
    () =>
      buildModelOptions({
        enabledNewapiModels: settings?.sharedHealth?.enabledNewapiModels as any,
        modelType: 'chat',
      }),
    [settings?.sharedHealth?.enabledNewapiModels],
  );
  const embeddingModelOptions = useMemo(
    () =>
      buildModelOptions({
        enabledNewapiModels: settings?.sharedHealth?.enabledNewapiModels as any,
        modelType: 'embedding',
      }),
    [settings?.sharedHealth?.enabledNewapiModels],
  );
  const rerankerModelOptions = useMemo(
    () =>
      buildModelOptions({
        enabledNewapiModels: settings?.sharedHealth?.enabledNewapiModels as any,
      }),
    [settings?.sharedHealth?.enabledNewapiModels],
  );

  useEffect(() => {
    if (!settings) return;

    if (scope === 'ai-runtime-defaults') {
      const memory = settings.memoryExtractionConfig ?? {};
      const vector = settings.vectorConfig ?? {};
      form.setFieldsValue({
        memoryEmbeddingModel: memory.embeddingModel ?? '',
        memoryEmbeddingProvider: memory.embeddingProvider ?? '',
        memoryGatekeeperModel: memory.gatekeeperModel ?? '',
        memoryGatekeeperProvider: memory.gatekeeperProvider ?? '',
        memoryLayerExtractorModel: memory.layerExtractorModel ?? '',
        memoryLayerExtractorProvider: memory.layerExtractorProvider ?? '',
        memoryPersonaWriterModel: memory.personaWriterModel ?? '',
        memoryPersonaWriterProvider: memory.personaWriterProvider ?? '',
        vectorEmbeddingModel: vector.embeddingModel ?? '',
        vectorEmbeddingProvider: vector.embeddingProvider ?? '',
        vectorQueryMode: vector.queryMode ?? '',
        vectorRerankerModel: vector.rerankerModel ?? '',
        vectorRerankerProvider: vector.rerankerProvider ?? '',
      });
      return;
    }

    if (scope === 'integrations') {
      const composio = settings.composioConfig ?? {};
      form.setFieldsValue({
        composioApiKey: '',
        composioAuthConfigIds: composio.authConfigIds ?? '',
        composioClearApiKey: false,
        composioEnabled: composio.enabled ?? false,
      });
      return;
    }

    const userDefaults = settings.userGlobalSettingsDefaults ?? {};
    const systemAgent = userDefaults.systemAgent ?? {};
    form.setFieldsValue({
      avatarPresets: settings.avatarPresets ?? DEFAULT_AVATAR_PRESETS,
      disabledBuiltinToolsText: Array.isArray(userDefaults.tool?.uninstalledBuiltinTools)
        ? userDefaults.tool.uninstalledBuiltinTools.join('\n')
        : '',
      languageModelDefaultsJson: jsonStringify(userDefaults.languageModel ?? {}),
      profileInterestAreas: normalizeConfiguredInterestAreas(settings.profileInterestAreas),
      serviceModelAgentMeta: resolveModelOptionValue(systemAgent.agentMeta, modelOptions),
      serviceModelDefaultAgent: resolveModelOptionValue(
        userDefaults.defaultAgent?.config,
        modelOptions,
      ),
      serviceModelFollowUpAction: resolveModelOptionValue(systemAgent.followUpAction, modelOptions),
      serviceModelFollowUpActionEnabled: systemAgent.followUpAction?.enabled ?? false,
      serviceModelGenerationTopic: resolveModelOptionValue(
        systemAgent.generationTopic,
        modelOptions,
      ),
      serviceModelHistoryCompress: resolveModelOptionValue(
        systemAgent.historyCompress,
        modelOptions,
      ),
      serviceModelInputCompletion: resolveModelOptionValue(
        systemAgent.inputCompletion,
        modelOptions,
      ),
      serviceModelInputCompletionEnabled: systemAgent.inputCompletion?.enabled ?? false,
      serviceModelPromptRewrite: resolveModelOptionValue(systemAgent.promptRewrite, modelOptions),
      serviceModelPromptRewriteEnabled: systemAgent.promptRewrite?.enabled ?? true,
      serviceModelThread: resolveModelOptionValue(systemAgent.thread, modelOptions),
      serviceModelTopic: resolveModelOptionValue(systemAgent.topic, modelOptions),
      serviceModelTranslation: resolveModelOptionValue(systemAgent.translation, modelOptions),
      userGlobalSettingsJson: jsonStringify(userDefaults),
    });
  }, [form, modelOptions, scope, settings]);

  const buildUserDefaultsUpdates = (values: FormValues): SettingUpdate[] => {
    const userGlobalSettings = parseJsonObject(values.userGlobalSettingsJson);
    const systemAgent =
      userGlobalSettings.systemAgent &&
      typeof userGlobalSettings.systemAgent === 'object' &&
      !Array.isArray(userGlobalSettings.systemAgent)
        ? { ...userGlobalSettings.systemAgent }
        : {};

    applyModelValue(systemAgent, 'topic', values.serviceModelTopic);
    applyModelValue(systemAgent, 'generationTopic', values.serviceModelGenerationTopic);
    applyModelValue(systemAgent, 'translation', values.serviceModelTranslation);
    applyModelValue(systemAgent, 'historyCompress', values.serviceModelHistoryCompress);
    applyModelValue(systemAgent, 'agentMeta', values.serviceModelAgentMeta);
    applyModelValue(systemAgent, 'thread', values.serviceModelThread);
    applyModelValue(systemAgent, 'followUpAction', values.serviceModelFollowUpAction);
    applyModelValue(systemAgent, 'inputCompletion', values.serviceModelInputCompletion);
    applyModelValue(systemAgent, 'promptRewrite', values.serviceModelPromptRewrite);

    systemAgent.followUpAction = {
      ...systemAgent.followUpAction,
      enabled: values.serviceModelFollowUpActionEnabled,
    };
    systemAgent.inputCompletion = {
      ...systemAgent.inputCompletion,
      enabled: values.serviceModelInputCompletionEnabled,
    };
    systemAgent.promptRewrite = {
      ...systemAgent.promptRewrite,
      enabled: values.serviceModelPromptRewriteEnabled,
    };

    const defaultAgent =
      userGlobalSettings.defaultAgent &&
      typeof userGlobalSettings.defaultAgent === 'object' &&
      !Array.isArray(userGlobalSettings.defaultAgent)
        ? { ...userGlobalSettings.defaultAgent }
        : {};
    const defaultAgentConfig =
      defaultAgent.config &&
      typeof defaultAgent.config === 'object' &&
      !Array.isArray(defaultAgent.config)
        ? { ...defaultAgent.config }
        : {};
    delete defaultAgentConfig.model;
    delete defaultAgentConfig.provider;
    const defaultAgentModel = parseModelValue(values.serviceModelDefaultAgent);
    if (defaultAgentModel) Object.assign(defaultAgentConfig, defaultAgentModel);

    const shouldWriteDefaultAgent =
      Boolean(defaultAgentModel) ||
      Object.keys(defaultAgent).length > 0 ||
      Object.keys(defaultAgentConfig).length > 0;
    const mergedUserGlobalSettings = {
      ...userGlobalSettings,
      ...(shouldWriteDefaultAgent
        ? { defaultAgent: { ...defaultAgent, config: defaultAgentConfig } }
        : {}),
      languageModel: parseJsonObject(values.languageModelDefaultsJson),
      systemAgent,
      tool: {
        ...userGlobalSettings.tool,
        uninstalledBuiltinTools: splitTextList(values.disabledBuiltinToolsText),
      },
    };

    return [
      { key: APP_SETTING_KEYS.userGlobalSettingsDefaults, value: mergedUserGlobalSettings },
      { key: APP_SETTING_KEYS.profileAvatarPresets, value: values.avatarPresets ?? [] },
      {
        key: APP_SETTING_KEYS.profileInterestAreas,
        value: normalizeConfiguredInterestAreas(values.profileInterestAreas),
      },
    ];
  };

  const buildRuntimeUpdates = (values: FormValues): SettingUpdate[] =>
    buildRuntimeSettingUpdates({
      chatOptions: modelOptions,
      embeddingOptions: embeddingModelOptions,
      rerankerOptions: rerankerModelOptions,
      values,
    });

  const buildIntegrationUpdates = (values: FormValues): SettingUpdate[] => [
    { key: APP_SETTING_KEYS.composioEnabled, value: values.composioEnabled ?? false },
    { key: APP_SETTING_KEYS.composioAuthConfigIds, value: values.composioAuthConfigIds ?? '' },
    ...(values.composioClearApiKey || values.composioApiKey?.trim()
      ? [
          {
            key: APP_SETTING_KEYS.composioApiKey,
            value: values.composioClearApiKey ? '' : values.composioApiKey?.trim(),
          },
        ]
      : []),
  ];

  const handleSave = async (syncMode?: 'runtime-memory' | 'user-defaults') => {
    if (!data) return;

    setSubmitting(true);
    if (syncMode) setSyncing(true);
    setSaveError(undefined);

    try {
      const values = await form.validateFields();
      const updates =
        scope === 'ai-runtime-defaults'
          ? buildRuntimeUpdates(values)
          : scope === 'integrations'
            ? buildIntegrationUpdates(values)
            : buildUserDefaultsUpdates(values);

      await adminCommercialService.setAppSettingsBatch({ updates });
      await mutate(ADMIN_SETTINGS_SECTION_SWR_KEY(scope));

      if (scope === 'ai-runtime-defaults') {
        await mutate(RUNTIME_CONFIG_SWR_KEY);
        if (syncMode === 'runtime-memory') {
          try {
            const result = await adminCommercialService.syncRuntimeMemoryModelsToUsers();
            await mutate(USER_STATE_SWR_KEY);
            const skipped = result.skippedFields.length;
            if (skipped > 0) {
              message.warning(
                t('admin.defaultSettings.aiRuntime.savedAndSyncedWithSkipped', {
                  fields: result.syncedFields.length,
                  skipped,
                  users: result.syncedUsers,
                }),
              );
            } else {
              message.success(
                t('admin.defaultSettings.aiRuntime.savedAndSynced', {
                  fields: result.syncedFields.length,
                  users: result.syncedUsers,
                }),
              );
            }
          } catch {
            message.warning(t('admin.defaultSettings.aiRuntime.savedSyncFailed'));
          }
          return;
        }
        message.success(t('admin.defaultSettings.aiRuntime.saved'));
        return;
      }

      if (scope === 'integrations') {
        message.success(t('admin.defaultSettings.integrations.saved'));
        return;
      }

      await Promise.all([
        mutate(PROFILE_INTEREST_AREAS_SWR_KEY),
        mutate(PROFILE_OPTIONS_SWR_KEY),
        mutate(RUNTIME_CONFIG_SWR_KEY),
      ]);
      if (syncMode === 'user-defaults') {
        try {
          const result = await adminCommercialService.syncUserGlobalSettingsDefaultsToUsers({
            forceDefaultAgentMeta: true,
          });
          await mutate(USER_STATE_SWR_KEY);
          message.success(
            t('admin.defaultSettings.userDefaults.savedAndSynced', {
              fields: result.syncedFields.length,
              users: result.syncedUsers,
            }),
          );
        } catch {
          message.warning(t('admin.defaultSettings.userDefaults.savedSyncFailed'));
        }
        return;
      }
      message.success(t('admin.defaultSettings.userDefaults.saved'));
    } catch (error) {
      if (error instanceof AdminSettingsRevisionConflictError) {
        setSaveError(error);
      } else if (error instanceof SyntaxError) {
        message.error(t('admin.defaultSettings.invalidJson'));
      } else {
        const errorMessage = error instanceof Error ? error.message : '';
        message.error(
          RUNTIME_SAVE_ERROR_MESSAGES[errorMessage] ?? t('admin.defaultSettings.saveFailed'),
        );
      }
    } finally {
      setSubmitting(false);
      setSyncing(false);
    }
  };

  const renderRuntimeFields = () => (
    <>
      <Card title="向量检索设置">
        <Alert
          showIcon
          message="当前数据库向量列固定为 1024 维。更换 Embedding 模型前，请确认上游返回 1024 维，或支持 dimensions=1024。"
          style={{ marginBottom: 16 }}
          type="warning"
        />
        <RuntimeModelFieldPair
          extra="留空时使用服务器或系统默认值。"
          form={form}
          modelField="vectorEmbeddingModel"
          modelLabel="Embedding 模型"
          options={embeddingModelOptions}
          placeholder="选择 Embedding 模型"
          providerField="vectorEmbeddingProvider"
          providerLabel="Embedding 供应商"
        />
        <RuntimeModelFieldPair
          form={form}
          modelField="vectorRerankerModel"
          modelLabel="Reranker 模型"
          options={rerankerModelOptions}
          placeholder="选择 Reranker 模型"
          providerField="vectorRerankerProvider"
          providerLabel="Reranker 供应商"
        />
        <Form.Item extra="使用当前系统支持的 query_mode。" label="查询模式" name="vectorQueryMode">
          <Select
            allowClear
            showSearch
            options={[
              { label: 'semantic', value: 'semantic' },
              { label: 'full_text', value: 'full_text' },
              { label: 'hybrid', value: 'hybrid' },
            ]}
          />
        </Form.Item>
      </Card>
      <Card title="记忆分析模型设置">
        <Alert
          showIcon
          message="配置用户记忆判定、分层提取、画像生成和记忆向量检索模型。更换 Embedding 模型后，需重建已有记忆向量。"
          style={{ marginBottom: 16 }}
          type="info"
        />
        <RuntimeModelFieldPair
          extra="判断聊天内容是否需要写入长期记忆。"
          form={form}
          modelField="memoryGatekeeperModel"
          modelLabel="记忆判定模型"
          options={modelOptions}
          placeholder="选择聊天模型"
          providerField="memoryGatekeeperProvider"
          providerLabel="记忆判定供应商"
        />
        <RuntimeModelFieldPair
          extra="提取 activity、context、experience 等记忆层。"
          form={form}
          modelField="memoryLayerExtractorModel"
          modelLabel="分层提取模型"
          options={modelOptions}
          placeholder="选择聊天模型"
          providerField="memoryLayerExtractorProvider"
          providerLabel="分层提取供应商"
        />
        <RuntimeModelFieldPair
          extra="根据长期记忆生成和更新用户画像。"
          form={form}
          modelField="memoryPersonaWriterModel"
          modelLabel="用户画像写入模型"
          options={modelOptions}
          placeholder="选择聊天模型"
          providerField="memoryPersonaWriterProvider"
          providerLabel="用户画像供应商"
        />
        <RuntimeModelFieldPair
          extra="用于写入和搜索用户记忆向量。"
          form={form}
          modelField="memoryEmbeddingModel"
          modelLabel="记忆 Embedding 模型"
          options={embeddingModelOptions}
          placeholder="选择 Embedding 模型"
          providerField="memoryEmbeddingProvider"
          providerLabel="记忆 Embedding 供应商"
        />
      </Card>
    </>
  );

  const renderIntegrationFields = () => (
    <Card title="Composio tool integration">
      <Alert
        showIcon
        message="配置 Gmail、Notion、GitHub 和 Slack 等 AI 工具的可选 Composio 连接器。API Key 留空会保留现有密钥。"
        style={{ marginBottom: 16 }}
        type="info"
      />
      <Form.Item label="启用 Composio" name="composioEnabled" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item
        label="Project API Key"
        name="composioApiKey"
        extra={
          settings?.composioConfig?.apiKeyConfigured
            ? `当前密钥：${settings.composioConfig.apiKeyMasked || '已配置'}`
            : '尚未配置 Composio API Key。'
        }
      >
        <Input.Password autoComplete="new-password" placeholder="ak_..." />
      </Form.Item>
      <Form.Item
        extra="开启后会在保存时清除已保存的 API Key。"
        label="清除 API Key"
        name="composioClearApiKey"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
      <Form.Item
        extra='可选 JSON 映射，例如 {"gmail":"ac_xxx","github":"ac_xxx"}。'
        label="Auth Config IDs"
        name="composioAuthConfigIds"
      >
        <Input.TextArea autoSize={{ maxRows: 6, minRows: 2 }} placeholder='{"gmail":"ac_xxx"}' />
      </Form.Item>
    </Card>
  );

  const renderUserDefaultsFields = () => (
    <>
      <Card title="用户全局默认设置">
        <Alert
          showIcon
          message="这些值会与新用户的默认设置合并。用户自行保存过的设置仍优先。"
          style={{ marginBottom: 16 }}
          type="info"
        />
        {userModelFields.map(({ extra, field, label }) => (
          <Form.Item extra={extra} key={field} label={label} name={field}>
            <Select allowClear showSearch options={modelOptions} placeholder="选择聊天模型" />
          </Form.Item>
        ))}
        {[
          [
            'serviceModelFollowUpAction',
            'serviceModelFollowUpActionEnabled',
            '追问建议模型',
            '启用追问建议',
          ],
          [
            'serviceModelInputCompletion',
            'serviceModelInputCompletionEnabled',
            '输入建议模型',
            '启用输入建议',
          ],
          [
            'serviceModelPromptRewrite',
            'serviceModelPromptRewriteEnabled',
            '提示词改写模型',
            '启用提示词改写',
          ],
        ].map(([modelField, enabledField, label, enabledLabel]) => (
          <Flexbox horizontal gap={12} key={modelField}>
            <Form.Item label={label} name={modelField as keyof FormValues} style={{ flex: 1 }}>
              <Select allowClear showSearch options={modelOptions} placeholder="选择聊天模型" />
            </Form.Item>
            <Form.Item
              label={enabledLabel}
              name={enabledField as keyof FormValues}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Flexbox>
        ))}
        <Form.Item
          extra="写入 userDefaults.languageModel。"
          label="服务模型默认设置 JSON"
          name="languageModelDefaultsJson"
          rules={[{ message: '请填写 JSON 对象，留空请填 {}', required: true }]}
        >
          <Input.TextArea rows={8} spellCheck={false} />
        </Form.Item>
        <Form.Item
          extra="每行一个工具或技能 identifier；留空表示默认不禁用。"
          label="默认禁用的内置技能/工具"
          name="disabledBuiltinToolsText"
        >
          <Input.TextArea placeholder="web-browsing" rows={4} spellCheck={false} />
        </Form.Item>
        <Form.Item
          label="默认设置 JSON"
          name="userGlobalSettingsJson"
          rules={[{ message: '请填写 JSON 对象，留空请填 {}', required: true }]}
        >
          <Input.TextArea rows={12} spellCheck={false} />
        </Form.Item>
      </Card>
      <Card title="用户资料默认值">
        <Form.Item extra="用于注册引导和个人资料页的兴趣领域。" label="用户兴趣领域">
          <Form.List name="profileInterestAreas">
            {(fields, { add, remove }) => (
              <Flexbox gap={8}>
                {fields.map(({ key, name, ...restField }) => (
                  <Flexbox horizontal align="center" gap={8} key={key}>
                    <Form.Item {...restField} noStyle name={[name, 'key']}>
                      <Input placeholder="唯一标识" style={{ flex: 1 }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      noStyle
                      name={[name, 'label']}
                      rules={[{ message: '请填写显示名称', required: true }]}
                    >
                      <Input placeholder="显示名称，例如 AI 绘画" style={{ flex: 1.4 }} />
                    </Form.Item>
                    <MinusCircleOutlined
                      style={{ color: '#ff4d4f' }}
                      onClick={() => remove(name)}
                    />
                  </Flexbox>
                ))}
                <Button
                  block
                  icon={<PlusOutlined />}
                  type="dashed"
                  onClick={() => add({ key: '', label: '' })}
                >
                  添加兴趣领域
                </Button>
              </Flexbox>
            )}
          </Form.List>
        </Form.Item>
        <Form.Item label="用户头像预设">
          <Form.List name="avatarPresets">
            {(fields, { add, remove }) => (
              <Flexbox gap={8}>
                {fields.map(({ key, name, ...restField }) => (
                  <Flexbox horizontal align="center" gap={8} key={key}>
                    <Form.Item noStyle shouldUpdate>
                      {() => (
                        <Avatar
                          avatar={form.getFieldValue(['avatarPresets', name, 'value'])}
                          size={32}
                          title=""
                        />
                      )}
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      noStyle
                      name={[name, 'label']}
                      rules={[{ message: '请填写名称', required: true }]}
                    >
                      <Input placeholder="名称" style={{ flex: 1 }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      noStyle
                      name={[name, 'value']}
                      rules={[{ message: '请填写头像地址', required: true }]}
                    >
                      <ImageUrlUploadInput
                        placeholder="/images/avatar-presets/avatar-1.svg"
                        publicUrlPrefix={uploadPublicUrlPrefix}
                        style={{ flex: 2 }}
                      />
                    </Form.Item>
                    <MinusCircleOutlined
                      style={{ color: '#ff4d4f' }}
                      onClick={() => remove(name)}
                    />
                  </Flexbox>
                ))}
                <Button
                  block
                  icon={<PlusOutlined />}
                  type="dashed"
                  onClick={() => add({ label: '', value: '' })}
                >
                  添加头像
                </Button>
              </Flexbox>
            )}
          </Form.List>
        </Form.Item>
      </Card>
    </>
  );

  const saveLabel = scope === 'user-defaults' ? '保存用户默认值' : '保存设置';

  return (
    <AdminPageShell
      description={t(scopeCopy[scope].descriptionKey, scopeCopy[scope].description)}
      title={t(scopeCopy[scope].titleKey, scopeCopy[scope].title)}
      width="large"
    >
      {error ? (
        <AdminPageError
          description={t('admin.defaultSettings.loadFailed', '无法读取当前默认设置，请重试。')}
          onRetry={refresh}
        />
      ) : null}
      <AdminSettingsConflictAlert
        error={saveError}
        onReload={async () => {
          await refresh();
          setSaveError(undefined);
        }}
      />
      <Form
        disabled={isLoading || !data}
        form={form}
        layout="vertical"
        initialValues={{
          avatarPresets: DEFAULT_AVATAR_PRESETS,
          disabledBuiltinToolsText: '',
          languageModelDefaultsJson: '{}',
          profileInterestAreas: [],
          serviceModelFollowUpActionEnabled: false,
          serviceModelInputCompletionEnabled: false,
          serviceModelPromptRewriteEnabled: true,
          userGlobalSettingsJson: '{}',
        }}
      >
        <Flexbox gap={24}>
          {scope === 'ai-runtime-defaults'
            ? renderRuntimeFields()
            : scope === 'integrations'
              ? renderIntegrationFields()
              : renderUserDefaultsFields()}
          <AdminFormActions label={t('admin.defaultSettings.actions', '默认设置操作')}>
            {scope === 'user-defaults' ? (
              <Button
                danger
                disabled={isLoading || !data || submitting}
                loading={syncing}
                onClick={() => {
                  confirmModal({
                    cancelText: t('admin.defaultSettings.userDefaults.syncCancel'),
                    content: t('admin.defaultSettings.userDefaults.syncDescription'),
                    okText: t('admin.defaultSettings.userDefaults.syncConfirm'),
                    onOk: () => handleSave('user-defaults'),
                    title: t('admin.defaultSettings.userDefaults.syncTitle'),
                  });
                }}
              >
                {t('admin.defaultSettings.userDefaults.saveAndSync')}
              </Button>
            ) : null}
            {scope === 'ai-runtime-defaults' ? (
              <Button
                danger
                disabled={isLoading || !data || submitting}
                loading={syncing}
                onClick={() => {
                  confirmModal({
                    cancelText: t('admin.defaultSettings.aiRuntime.syncCancel'),
                    content: t('admin.defaultSettings.aiRuntime.syncDescription'),
                    okText: t('admin.defaultSettings.aiRuntime.syncConfirm'),
                    onOk: () => handleSave('runtime-memory'),
                    title: t('admin.defaultSettings.aiRuntime.syncTitle'),
                  });
                }}
              >
                {t('admin.defaultSettings.aiRuntime.saveAndSync')}
              </Button>
            ) : null}
            <Button
              disabled={isLoading || !data || syncing}
              loading={submitting && !syncing}
              type="primary"
              onClick={() => handleSave()}
            >
              {saveLabel}
            </Button>
          </AdminFormActions>
        </Flexbox>
      </Form>
    </AdminPageShell>
  );
});

AdminDefaultSettingsPage.displayName = 'AdminDefaultSettingsPage';

export default AdminDefaultSettingsPage;
