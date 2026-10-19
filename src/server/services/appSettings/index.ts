import type { LobeAgentConfig } from '@lobechat/types';
import { sanitizeLinkUrl } from '@lobechat/utils';
import { eq, inArray } from 'drizzle-orm';
import { type PartialDeep } from 'type-fest';

import { APP_SETTING_KEYS } from '@/const/appSettingsRegistry';
import { appSettings } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { type LobeChatDatabase } from '@/database/type';
import { type UserSettings } from '@/types/user/settings';

import { bumpAppSettingsCacheVersion, getAppSettingsCacheVersion } from './cacheVersion';
import { decryptAppSettingSecret } from './secrets';

export {
  APP_SETTING_KEYS,
  APP_SETTING_REGISTRY,
  type AppSettingKey,
  getAppSettingRegistryItem,
  isSensitiveAppSettingKey,
} from '@/const/appSettingsRegistry';

const CACHED_KEYS = [
  APP_SETTING_KEYS.composioApiKey,
  APP_SETTING_KEYS.composioAuthConfigIds,
  APP_SETTING_KEYS.composioEnabled,
  APP_SETTING_KEYS.defaultAgentAvatar,
  APP_SETTING_KEYS.defaultAgentModel,
  APP_SETTING_KEYS.defaultAgentName,
  APP_SETTING_KEYS.defaultAgentProvider,
  APP_SETTING_KEYS.defaultImageModel,
  APP_SETTING_KEYS.defaultImageProvider,
  APP_SETTING_KEYS.defaultVideoModel,
  APP_SETTING_KEYS.defaultVideoProvider,
  APP_SETTING_KEYS.communitySkillUseButtonLabel,
  APP_SETTING_KEYS.helpMenuItems,
  APP_SETTING_KEYS.modelPolicyAllowlist,
  APP_SETTING_KEYS.modelPolicyApplyToEmbeddings,
  APP_SETTING_KEYS.modelPolicyApplyToGenerateObject,
  APP_SETTING_KEYS.modelPolicyBlocklist,
  APP_SETTING_KEYS.modelPolicyDefaultModelFallback,
  APP_SETTING_KEYS.modelPolicyDeniedMessage,
  APP_SETTING_KEYS.modelPolicyEnabled,
  APP_SETTING_KEYS.modelPolicyMode,
  APP_SETTING_KEYS.memoryUserMemoryEmbeddingModel,
  APP_SETTING_KEYS.memoryUserMemoryEmbeddingProvider,
  APP_SETTING_KEYS.memoryUserMemoryGatekeeperModel,
  APP_SETTING_KEYS.memoryUserMemoryGatekeeperProvider,
  APP_SETTING_KEYS.memoryUserMemoryLayerExtractorModel,
  APP_SETTING_KEYS.memoryUserMemoryLayerExtractorProvider,
  APP_SETTING_KEYS.memoryUserMemoryPersonaWriterModel,
  APP_SETTING_KEYS.memoryUserMemoryPersonaWriterProvider,
  APP_SETTING_KEYS.memoryUserMemoryTriggerMode,
  APP_SETTING_KEYS.notificationEventDefaults,
  APP_SETTING_KEYS.notificationInboxEnabled,
  APP_SETTING_KEYS.notificationPushEnabled,
  APP_SETTING_KEYS.pricingCreditMultiplier,
  APP_SETTING_KEYS.pricingModelRules,
  APP_SETTING_KEYS.storageS3AccessKeyId,
  APP_SETTING_KEYS.storageS3Bucket,
  APP_SETTING_KEYS.storageS3EnablePathStyle,
  APP_SETTING_KEYS.storageS3Endpoint,
  APP_SETTING_KEYS.storageS3FilePath,
  APP_SETTING_KEYS.storageS3PreviewUrlExpireIn,
  APP_SETTING_KEYS.storageS3PublicDomain,
  APP_SETTING_KEYS.storageS3Region,
  APP_SETTING_KEYS.storageS3SecretAccessKey,
  APP_SETTING_KEYS.storageS3SetAcl,
  APP_SETTING_KEYS.userGlobalSettingsDefaults,
  APP_SETTING_KEYS.vectorEmbeddingModel,
  APP_SETTING_KEYS.vectorEmbeddingProvider,
  APP_SETTING_KEYS.vectorQueryMode,
  APP_SETTING_KEYS.vectorRerankerModel,
  APP_SETTING_KEYS.vectorRerankerProvider,
] as const;

const TTL_MS = 30_000;

type CachedSettings = { at: number; data: Record<string, unknown>; version: null | string };

let cachedSettings: CachedSettings | null = null;
let cachedSettingsByDb = new WeakMap<LobeChatDatabase, CachedSettings>();
let pendingSettings: null | Promise<Record<string, unknown>> = null;
let pendingSettingsByDb = new WeakMap<LobeChatDatabase, Promise<Record<string, unknown>>>();
let localCacheGeneration = 0;

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
};

const normalizeBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

const normalizePositiveInt = (value: unknown, fallback: number, min: number, max: number) => {
  if (value === null || value === undefined || value === '') return fallback;

  const n = Number(value);

  if (!Number.isFinite(n)) return fallback;

  return Math.max(min, Math.min(max, Math.round(n)));
};

const DEFAULT_S3_FILE_PATH = 'files';

export type ServerComposioConfig = {
  apiKey?: string;
  authConfigIds?: string;
  enabled: boolean;
};

const parseOptionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
};

export const normalizeS3FilePath = (value: unknown) => {
  const text = normalizeString(value);

  if (!text) return null;

  return text.replaceAll('\\', '/').replaceAll(/^\/+|\/+$/g, '') || null;
};

export const getServerComposioConfig = async (
  db?: LobeChatDatabase,
): Promise<ServerComposioConfig> => {
  const [enabled, apiKey, authConfigIds] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.composioEnabled, db),
    getAppSettingValue(APP_SETTING_KEYS.composioApiKey, db),
    getAppSettingValue(APP_SETTING_KEYS.composioAuthConfigIds, db),
  ]);

  const decryptedApiKey = await decryptAppSettingSecret(APP_SETTING_KEYS.composioApiKey, apiKey);
  const resolvedApiKey = normalizeString(decryptedApiKey) ?? process.env.COMPOSIO_API_KEY;
  const envEnabled = parseOptionalBoolean(process.env.COMPOSIO_ENABLED);
  const dbEnabled = typeof enabled === 'boolean' ? enabled : undefined;

  return {
    apiKey: resolvedApiKey,
    authConfigIds: normalizeString(authConfigIds) ?? process.env.COMPOSIO_AUTH_CONFIG_IDS,
    enabled: dbEnabled ?? envEnabled ?? Boolean(resolvedApiKey),
  };
};

export type PublicCustomizationConfig = {
  helpMenuItems?: Array<{ label: string; url?: string }>;
  skillUseButtonLabel?: string;
};

const normalizePublicHelpMenuItems = (
  items: unknown,
): PublicCustomizationConfig['helpMenuItems'] => {
  if (!Array.isArray(items)) return undefined;

  const normalized = items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const label = normalizeString(item.label);
      const url = sanitizeLinkUrl(item.url);

      if (!label) return undefined;

      return {
        label,
        ...(url ? { url } : {}),
      };
    })
    .filter((item): item is { label: string; url?: string } => Boolean(item));

  return normalized;
};

export const getServerPublicCustomizationConfig = async (
  db?: LobeChatDatabase,
): Promise<PublicCustomizationConfig> => {
  const [rawSkillUseButtonLabel, rawHelpMenuItems] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.communitySkillUseButtonLabel, db),
    getAppSettingValue(APP_SETTING_KEYS.helpMenuItems, db),
  ]);

  const skillUseButtonLabel = normalizeString(rawSkillUseButtonLabel);
  const helpMenuItems = normalizePublicHelpMenuItems(rawHelpMenuItems);

  return {
    ...(Array.isArray(helpMenuItems) ? { helpMenuItems } : {}),
    ...(skillUseButtonLabel ? { skillUseButtonLabel } : {}),
  };
};

export type ServerFileS3Config = {
  accessKeyId?: string;
  bucket?: string;
  enablePathStyle: boolean;
  endpoint?: string;
  internalEndpoint?: string;
  filePath: string;
  previewUrlExpireIn: number;
  publicDomain?: string;
  region?: string;
  secretAccessKey?: string;
  setAcl: boolean;
};

export const getServerFileS3Config = async (db?: LobeChatDatabase): Promise<ServerFileS3Config> => {
  const [
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucket,
    region,
    publicDomain,
    enablePathStyle,
    setAcl,
    previewUrlExpireIn,
    filePath,
  ] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.storageS3AccessKeyId, db),
    getAppSettingValue(APP_SETTING_KEYS.storageS3SecretAccessKey, db),
    getAppSettingValue(APP_SETTING_KEYS.storageS3Endpoint, db),
    getAppSettingValue(APP_SETTING_KEYS.storageS3Bucket, db),
    getAppSettingValue(APP_SETTING_KEYS.storageS3Region, db),
    getAppSettingValue(APP_SETTING_KEYS.storageS3PublicDomain, db),
    getAppSettingValue(APP_SETTING_KEYS.storageS3EnablePathStyle, db),
    getAppSettingValue(APP_SETTING_KEYS.storageS3SetAcl, db),
    getAppSettingValue(APP_SETTING_KEYS.storageS3PreviewUrlExpireIn, db),
    getAppSettingValue(APP_SETTING_KEYS.storageS3FilePath, db),
  ]);

  const envPreviewUrlExpireIn = Number.parseInt(process.env.S3_PREVIEW_URL_EXPIRE_IN || '7200');
  const decryptedSecretAccessKey = await decryptAppSettingSecret(
    APP_SETTING_KEYS.storageS3SecretAccessKey,
    secretAccessKey,
  );

  const adminEndpoint = normalizeString(endpoint);
  const environmentEndpoint = normalizeString(process.env.S3_ENDPOINT);

  return {
    accessKeyId: normalizeString(accessKeyId) ?? process.env.S3_ACCESS_KEY_ID,
    bucket: normalizeString(bucket) ?? process.env.S3_BUCKET,
    enablePathStyle: normalizeBoolean(enablePathStyle, process.env.S3_ENABLE_PATH_STYLE === '1'),
    endpoint: adminEndpoint ?? environmentEndpoint ?? undefined,
    // An internal endpoint configured through the environment belongs to the
    // environment endpoint. Do not combine it with a different admin-managed
    // public endpoint, or server-side CRUD can target a different bucket.
    internalEndpoint:
      !adminEndpoint || adminEndpoint === environmentEndpoint
        ? normalizeString(process.env.S3_INTERNAL_ENDPOINT) ?? undefined
        : undefined,
    filePath:
      normalizeS3FilePath(filePath) ||
      normalizeS3FilePath(process.env.NEXT_PUBLIC_S3_FILE_PATH) ||
      DEFAULT_S3_FILE_PATH,
    previewUrlExpireIn: normalizePositiveInt(
      previewUrlExpireIn,
      Number.isFinite(envPreviewUrlExpireIn) ? envPreviewUrlExpireIn : 7200,
      60,
      604_800,
    ),
    publicDomain:
      normalizeString(publicDomain) ??
      process.env.S3_PUBLIC_DOMAIN ??
      process.env.NEXT_PUBLIC_S3_DOMAIN,
    region: normalizeString(region) ?? process.env.S3_REGION,
    secretAccessKey: normalizeString(decryptedSecretAccessKey) ?? process.env.S3_SECRET_ACCESS_KEY,
    setAcl: normalizeBoolean(setAcl, process.env.S3_SET_ACL === '1'),
  };
};

export const normalizeModelIdList = (value: unknown): string[] => {
  const rawValues = Array.isArray(value)
    ? value.flatMap((item) => (typeof item === 'string' ? item.split(/[\r\n,;，；]+/) : []))
    : typeof value === 'string'
      ? value.split(/[\r\n,;，；]+/)
      : [];

  return Array.from(new Set(rawValues.map((item) => item.trim()).filter(Boolean)));
};

export const serializeModelIdList = (value: unknown) => {
  const modelIds = normalizeModelIdList(value);

  return modelIds.length > 0 ? modelIds.join('\n') : null;
};

const readCachedSettings = async (db?: LobeChatDatabase): Promise<Record<string, unknown>> => {
  const existingPending = db ? pendingSettingsByDb.get(db) : pendingSettings;
  if (existingPending) return existingPending;

  const load = async () => {
    const now = Date.now();
    const loadGeneration = localCacheGeneration;
    const explicitCache = db ? cachedSettingsByDb.get(db) : cachedSettings;
    const sharedVersion = await getAppSettingsCacheVersion();

    if (
      explicitCache &&
      now - explicitCache.at < TTL_MS &&
      sharedVersion !== null &&
      explicitCache.version === sharedVersion
    ) {
      return explicitCache.data;
    }

    try {
      const serverDB = db ?? (await getServerDB());
      const rows = await serverDB.query.appSettings.findMany({
        where: inArray(appSettings.key, [...CACHED_KEYS]),
      });

      const data = Object.fromEntries(rows.map((row) => [row.key, row.value]));
      const nextCache = { at: now, data, version: sharedVersion };
      if (loadGeneration === localCacheGeneration) {
        if (db) cachedSettingsByDb.set(db, nextCache);
        else cachedSettings = nextCache;
      }

      return data;
    } catch (error) {
      if (explicitCache) return explicitCache.data;
      throw error;
    }
  };

  const request = load();
  if (db) pendingSettingsByDb.set(db, request);
  else pendingSettings = request;

  try {
    return await request;
  } finally {
    if (db) pendingSettingsByDb.delete(db);
    else pendingSettings = null;
  }
};

export const getAppSettingValue = async (key: string, db?: LobeChatDatabase): Promise<unknown> => {
  if ((CACHED_KEYS as readonly string[]).includes(key)) {
    const cached = await readCachedSettings(db);
    return cached[key] ?? null;
  }

  try {
    const serverDB = db ?? (await getServerDB());
    const row = await serverDB.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
    return row?.value ?? null;
  } catch {
    return null;
  }
};

export const getServerDefaultAgentSettingOverrides = async (
  db?: LobeChatDatabase,
): Promise<PartialDeep<LobeAgentConfig>> => {
  const [rawModel, rawProvider, rawName, rawAvatar] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.defaultAgentModel, db),
    getAppSettingValue(APP_SETTING_KEYS.defaultAgentProvider, db),
    getAppSettingValue(APP_SETTING_KEYS.defaultAgentName, db),
    getAppSettingValue(APP_SETTING_KEYS.defaultAgentAvatar, db),
  ]);
  const model = normalizeString(rawModel);
  const provider = normalizeString(rawProvider);
  const title = normalizeString(rawName);
  const avatar = normalizeString(rawAvatar);

  return {
    ...(avatar ? { avatar } : {}),
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(title ? { title } : {}),
  };
};

export const getServerDefaultGenerationModelSettingOverrides = async (
  db?: LobeChatDatabase,
): Promise<{
  image?: { model?: string; provider?: string };
  video?: { model?: string; provider?: string };
}> => {
  const [rawImageModel, rawImageProvider, rawVideoModel, rawVideoProvider] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.defaultImageModel, db),
    getAppSettingValue(APP_SETTING_KEYS.defaultImageProvider, db),
    getAppSettingValue(APP_SETTING_KEYS.defaultVideoModel, db),
    getAppSettingValue(APP_SETTING_KEYS.defaultVideoProvider, db),
  ]);
  const imageModel = normalizeString(rawImageModel);
  const imageProvider = normalizeString(rawImageProvider);
  const videoModel = normalizeString(rawVideoModel);
  const videoProvider = normalizeString(rawVideoProvider);

  return {
    ...(imageModel || imageProvider
      ? {
          image: {
            ...(imageModel ? { model: imageModel } : {}),
            ...(imageProvider ? { provider: imageProvider } : {}),
          },
        }
      : {}),
    ...(videoModel || videoProvider
      ? {
          video: {
            ...(videoModel ? { model: videoModel } : {}),
            ...(videoProvider ? { provider: videoProvider } : {}),
          },
        }
      : {}),
  };
};

export const getServerVectorSettingOverrides = async (
  db?: LobeChatDatabase,
): Promise<{
  embeddingModel?: { model?: string; provider?: string };
  queryMode?: string;
  rerankerModel?: { model?: string; provider?: string };
}> => {
  const [
    rawEmbeddingProvider,
    rawEmbeddingModel,
    rawRerankerProvider,
    rawRerankerModel,
    rawQueryMode,
  ] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.vectorEmbeddingProvider, db),
    getAppSettingValue(APP_SETTING_KEYS.vectorEmbeddingModel, db),
    getAppSettingValue(APP_SETTING_KEYS.vectorRerankerProvider, db),
    getAppSettingValue(APP_SETTING_KEYS.vectorRerankerModel, db),
    getAppSettingValue(APP_SETTING_KEYS.vectorQueryMode, db),
  ]);

  const embeddingProvider = normalizeString(rawEmbeddingProvider);
  const embeddingModel = normalizeString(rawEmbeddingModel);
  const rerankerProvider = normalizeString(rawRerankerProvider);
  const rerankerModel = normalizeString(rawRerankerModel);
  const queryMode = normalizeString(rawQueryMode);

  return {
    ...(embeddingProvider || embeddingModel
      ? {
          embeddingModel: {
            ...(embeddingProvider ? { provider: embeddingProvider } : {}),
            ...(embeddingModel ? { model: embeddingModel } : {}),
          },
        }
      : {}),
    ...(queryMode ? { queryMode } : {}),
    ...(rerankerProvider || rerankerModel
      ? {
          rerankerModel: {
            ...(rerankerProvider ? { provider: rerankerProvider } : {}),
            ...(rerankerModel ? { model: rerankerModel } : {}),
          },
        }
      : {}),
  };
};

export type ServerMemoryExtractionModelSettingOverrides = {
  embedding?: { model?: string; provider?: string };
  gatekeeper?: { model?: string; provider?: string };
  layerExtractor?: { model?: string; provider?: string };
  personaWriter?: { model?: string; provider?: string };
};

const toModelSetting = (provider: string | null, model: string | null) =>
  provider || model
    ? {
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
      }
    : undefined;

export const getServerMemoryExtractionSettingOverrides = async (
  db?: LobeChatDatabase,
): Promise<ServerMemoryExtractionModelSettingOverrides> => {
  const [
    rawGatekeeperProvider,
    rawGatekeeperModel,
    rawLayerExtractorProvider,
    rawLayerExtractorModel,
    rawPersonaWriterProvider,
    rawPersonaWriterModel,
    rawEmbeddingProvider,
    rawEmbeddingModel,
  ] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.memoryUserMemoryGatekeeperProvider, db),
    getAppSettingValue(APP_SETTING_KEYS.memoryUserMemoryGatekeeperModel, db),
    getAppSettingValue(APP_SETTING_KEYS.memoryUserMemoryLayerExtractorProvider, db),
    getAppSettingValue(APP_SETTING_KEYS.memoryUserMemoryLayerExtractorModel, db),
    getAppSettingValue(APP_SETTING_KEYS.memoryUserMemoryPersonaWriterProvider, db),
    getAppSettingValue(APP_SETTING_KEYS.memoryUserMemoryPersonaWriterModel, db),
    getAppSettingValue(APP_SETTING_KEYS.memoryUserMemoryEmbeddingProvider, db),
    getAppSettingValue(APP_SETTING_KEYS.memoryUserMemoryEmbeddingModel, db),
  ]);

  const gatekeeper = toModelSetting(
    normalizeString(rawGatekeeperProvider),
    normalizeString(rawGatekeeperModel),
  );
  const layerExtractor = toModelSetting(
    normalizeString(rawLayerExtractorProvider),
    normalizeString(rawLayerExtractorModel),
  );
  const personaWriter = toModelSetting(
    normalizeString(rawPersonaWriterProvider),
    normalizeString(rawPersonaWriterModel),
  );
  const embedding = toModelSetting(
    normalizeString(rawEmbeddingProvider),
    normalizeString(rawEmbeddingModel),
  );

  return {
    ...(gatekeeper ? { gatekeeper } : {}),
    ...(layerExtractor ? { layerExtractor } : {}),
    ...(personaWriter ? { personaWriter } : {}),
    ...(embedding ? { embedding } : {}),
  };
};

export const getServerUserGlobalSettingsDefaults = async (
  db?: LobeChatDatabase,
): Promise<PartialDeep<UserSettings>> => {
  const raw = await getAppSettingValue(APP_SETTING_KEYS.userGlobalSettingsDefaults, db);

  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as PartialDeep<UserSettings>)
    : {};
};

export const getServerDefaultModelSuggestions = async ({
  currentModel,
}: {
  currentModel?: string | null;
}) => {
  return Array.from(new Set([currentModel?.trim()].filter(Boolean) as string[]));
};

export type ServerModelPolicyUsageType =
  'asr' | 'chat' | 'embeddings' | 'generate_object' | 'image' | 'video';

export type ServerModelPolicyConfig = {
  allowlist: string[];
  applyToEmbeddings: boolean;
  applyToGenerateObject: boolean;
  blocklist: string[];
  defaultModelFallback: string | null;
  deniedMessage: string;
  enabled: boolean;
  mode: 'allowlist' | 'blocklist';
};

const normalizeModelPolicyMode = (value: unknown): ServerModelPolicyConfig['mode'] =>
  value === 'allowlist' || value === 'blocklist' ? value : 'blocklist';

export const getServerModelPolicyConfig = async (
  db?: LobeChatDatabase,
): Promise<ServerModelPolicyConfig> => {
  const [
    enabled,
    mode,
    allowlist,
    blocklist,
    deniedMessage,
    applyToEmbeddings,
    applyToGenerateObject,
    defaultModelFallback,
  ] = await Promise.all([
    getAppSettingValue(APP_SETTING_KEYS.modelPolicyEnabled, db),
    getAppSettingValue(APP_SETTING_KEYS.modelPolicyMode, db),
    getAppSettingValue(APP_SETTING_KEYS.modelPolicyAllowlist, db),
    getAppSettingValue(APP_SETTING_KEYS.modelPolicyBlocklist, db),
    getAppSettingValue(APP_SETTING_KEYS.modelPolicyDeniedMessage, db),
    getAppSettingValue(APP_SETTING_KEYS.modelPolicyApplyToEmbeddings, db),
    getAppSettingValue(APP_SETTING_KEYS.modelPolicyApplyToGenerateObject, db),
    getAppSettingValue(APP_SETTING_KEYS.modelPolicyDefaultModelFallback, db),
  ]);

  return {
    allowlist: normalizeModelIdList(allowlist),
    applyToEmbeddings: normalizeBoolean(applyToEmbeddings, true),
    applyToGenerateObject: normalizeBoolean(applyToGenerateObject, true),
    blocklist: normalizeModelIdList(blocklist),
    defaultModelFallback: normalizeString(defaultModelFallback),
    deniedMessage:
      normalizeString(deniedMessage) || '当前模型未开放使用，请在后台模型权限中调整可用模型。',
    enabled: normalizeBoolean(enabled, false),
    mode: normalizeModelPolicyMode(mode),
  };
};

export const invalidateServerAppSettings = async () => {
  localCacheGeneration += 1;
  cachedSettings = null;
  cachedSettingsByDb = new WeakMap<LobeChatDatabase, CachedSettings>();
  pendingSettings = null;
  pendingSettingsByDb = new WeakMap<LobeChatDatabase, Promise<Record<string, unknown>>>();
  await bumpAppSettingsCacheVersion();
};
