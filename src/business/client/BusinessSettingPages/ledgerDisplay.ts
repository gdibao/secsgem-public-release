const UUID_RE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

type LedgerModelMetadata = Record<string, unknown> | null | undefined;

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value !== 'string') continue;

    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
};

const pickMetadataString = (metadata: LedgerModelMetadata, keys: string[]) => {
  if (!metadata || typeof metadata !== 'object') return;

  return pickString(...keys.map((key) => metadata[key]));
};

export const formatCreditLedgerDescription = (value?: unknown, metadata?: LedgerModelMetadata) => {
  const description = typeof value === 'string' ? value.trim() : '';
  if (!description) return '--';

  const consumedPrefix = 'Consumed on ';
  if (!description.toLowerCase().startsWith(consumedPrefix.toLowerCase())) return description;

  const [provider, ...modelSegments] = description.slice(consumedPrefix.length).split('/');
  const model = modelSegments.join('/');
  const displayModel =
    pickMetadataString(metadata, ['modelDisplayName', 'modelName', 'displayName']) ||
    pickString(model, provider && !UUID_RE.test(provider) ? provider : undefined) ||
    '--';
  const displayProvider =
    pickMetadataString(metadata, [
      'providerDisplayName',
      'providerName',
      'instanceName',
      'groupName',
      'providerType',
    ]) || (provider && !UUID_RE.test(provider) ? provider : undefined);
  const providerSuffix =
    displayProvider && displayProvider !== displayModel ? ` · 服务商：${displayProvider}` : '';

  return `模型调用：${displayModel}${providerSuffix}`;
};
