type ProviderModelType =
  'chat' | 'embedding' | 'tts' | 'stt' | 'image' | 'video' | 'text2music' | 'realtime';

export type ProviderInstanceFormValues = {
  apiKey?: string;
  baseUrl: string;
  description?: string;
  enabled?: boolean;
  fetchOnClient?: boolean;
  groupKey?: string;
  groupMultiplier?: number;
  groupName?: string;
  name: string;
  pricingPolicy?: ProviderPricingPolicy;
  priority?: number;
  providerType?: AdminModelApiProviderType;
  usageScope?: ProviderModelType[];
};

export interface ProviderPricingPolicy {
  lobeHubOfficialPricingEnabled: boolean;
  modelBankFallbackEnabled: boolean;
  upstreamSyncEnabled: boolean;
}

export type AdminModelApiProviderType =
  | 'newapi'
  | 'sub2api'
  | 'openai-compatible'
  | 'openai'
  | 'claude'
  | 'deepseek'
  | 'aliyun'
  | 'opencode-go'
  | 'siliconflow';

export const ADMIN_MODEL_API_PROVIDER_TYPES: AdminModelApiProviderType[] = [
  'newapi',
  'sub2api',
  'openai-compatible',
  'openai',
  'claude',
  'deepseek',
  'aliyun',
  'opencode-go',
  'siliconflow',
];

const UPSTREAM_PRICING_PROVIDER_TYPES = new Set<AdminModelApiProviderType>(['newapi', 'sub2api']);
const LEGACY_MODEL_BANK_PROVIDER_TYPES = new Set<AdminModelApiProviderType>([
  'claude',
  'deepseek',
  'openai',
  'siliconflow',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const resolveProviderPricingPolicyForForm = ({
  metadata,
  newInstance = false,
  providerType = 'newapi',
}: {
  metadata?: Record<string, unknown> | null;
  newInstance?: boolean;
  providerType?: AdminModelApiProviderType;
}): ProviderPricingPolicy => {
  const storedPolicy = isRecord(metadata?.pricingPolicy) ? metadata.pricingPolicy : undefined;

  return {
    lobeHubOfficialPricingEnabled:
      typeof storedPolicy?.lobeHubOfficialPricingEnabled === 'boolean'
        ? storedPolicy.lobeHubOfficialPricingEnabled
        : false,
    modelBankFallbackEnabled:
      typeof storedPolicy?.modelBankFallbackEnabled === 'boolean'
        ? storedPolicy.modelBankFallbackEnabled
        : newInstance || LEGACY_MODEL_BANK_PROVIDER_TYPES.has(providerType),
    upstreamSyncEnabled:
      typeof storedPolicy?.upstreamSyncEnabled === 'boolean'
        ? storedPolicy.upstreamSyncEnabled
        : UPSTREAM_PRICING_PROVIDER_TYPES.has(providerType),
  };
};

const DEFAULT_BASE_URL_BY_PROVIDER_TYPE: Partial<Record<AdminModelApiProviderType, string>> = {
  'aliyun': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'claude': 'https://api.anthropic.com',
  'deepseek': 'https://api.deepseek.com/v1',
  'openai': 'https://api.openai.com/v1',
  'opencode-go': 'https://opencode.ai/zen/go/v1',
  'siliconflow': 'https://api.siliconflow.cn/v1',
};

export const getDefaultBaseUrlForAdminProviderType = (providerType?: AdminModelApiProviderType) =>
  providerType ? DEFAULT_BASE_URL_BY_PROVIDER_TYPE[providerType] : undefined;

const cleanText = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

export const buildProviderInstancePayload = (
  values: ProviderInstanceFormValues,
  options: { isEdit?: boolean } = {},
) => {
  const apiKey = cleanText(values.apiKey);
  const groupMultiplier =
    values.groupMultiplier === null || values.groupMultiplier === undefined
      ? undefined
      : Number(values.groupMultiplier);
  const payload: Record<string, unknown> = {
    baseUrl: values.baseUrl,
    description: cleanText(values.description),
    enabled: !!values.enabled,
    fetchOnClient: false,
    groupKey: cleanText(values.groupKey) ?? 'default',
    groupName: cleanText(values.groupName),
    name: values.name,
    pricingPolicy: values.pricingPolicy,
    priority: Number(values.priority || 0),
    providerType: values.providerType ?? 'newapi',
    usageScope: values.usageScope ?? [],
  };

  if (Number.isFinite(groupMultiplier) && Number(groupMultiplier) > 0) {
    payload.groupMultiplier = groupMultiplier;
  }

  if (apiKey && (!options.isEdit || !apiKey.includes('****'))) {
    payload.apiKey = apiKey;
  }

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
};
