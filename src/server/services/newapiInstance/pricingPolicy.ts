export interface AdminProviderPricingPolicy {
  lobeHubOfficialPricingEnabled: boolean;
  modelBankFallbackEnabled: boolean;
  upstreamSyncEnabled: boolean;
}

const MODEL_BANK_PROVIDER_BY_ADMIN_PROVIDER_TYPE: Record<string, string> = {
  claude: 'anthropic',
  deepseek: 'deepseek',
  openai: 'openai',
  siliconflow: 'siliconcloud',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const resolveModelBankProviderForAdminType = (
  providerType?: null | string,
): string | undefined =>
  providerType ? MODEL_BANK_PROVIDER_BY_ADMIN_PROVIDER_TYPE[providerType] : undefined;

export const resolveAdminProviderPricingPolicy = (
  metadata: Record<string, unknown> | null | undefined,
  providerType?: null | string,
): AdminProviderPricingPolicy => {
  const storedPolicy = isRecord(metadata?.pricingPolicy) ? metadata.pricingPolicy : undefined;
  const upstreamDefault = !providerType || providerType === 'newapi' || providerType === 'sub2api';
  const modelBankDefault = Boolean(resolveModelBankProviderForAdminType(providerType));

  return {
    lobeHubOfficialPricingEnabled:
      typeof storedPolicy?.lobeHubOfficialPricingEnabled === 'boolean'
        ? storedPolicy.lobeHubOfficialPricingEnabled
        : false,
    modelBankFallbackEnabled:
      typeof storedPolicy?.modelBankFallbackEnabled === 'boolean'
        ? storedPolicy.modelBankFallbackEnabled
        : modelBankDefault,
    upstreamSyncEnabled:
      typeof storedPolicy?.upstreamSyncEnabled === 'boolean'
        ? storedPolicy.upstreamSyncEnabled
        : upstreamDefault,
  };
};
