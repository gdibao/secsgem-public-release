export type OpenAIImageOperation = 'edit' | 'generate';

type OpenAIImageModelAdapter = {
  defaultSize?: string;
  omitAutoParams?: string[];
  omitParams?: string[];
  operations?: OpenAIImageOperation[];
  paramMap?: Record<string, string>;
  supportedParams?: string[];
};

const OPENAI_IMAGE_MODEL_ADAPTERS: Record<string, OpenAIImageModelAdapter> = {
  'gemini-3-pro-image-preview': {
    omitAutoParams: ['aspect_ratio'],
    omitParams: ['n'],
    paramMap: { aspectRatio: 'aspect_ratio', resolution: 'image_size' },
    supportedParams: ['aspect_ratio', 'image', 'image_size', 'model', 'prompt'],
  },
  'gemini-3.1-flash-image-preview': {
    omitAutoParams: ['aspect_ratio'],
    omitParams: ['n'],
    paramMap: { aspectRatio: 'aspect_ratio', resolution: 'image_size' },
    supportedParams: ['aspect_ratio', 'image', 'image_size', 'model', 'prompt'],
  },
  'gpt-image-2': {
    defaultSize: '1024x1024',
    omitParams: ['input_fidelity', 'response_format', 'style'],
    supportedParams: ['image', 'model', 'n', 'prompt', 'quality', 'size'],
  },
  'qwen-image-edit': {
    omitParams: ['input_fidelity', 'n', 'response_format', 'size', 'style'],
    operations: ['edit'],
    supportedParams: ['image', 'model', 'prompt'],
  },
};

export const getOpenAIImageModelAdapter = (model: string, operation?: OpenAIImageOperation) =>
  Object.entries(OPENAI_IMAGE_MODEL_ADAPTERS).find(
    ([modelName, adapter]) =>
      (model === modelName || model.startsWith(`${modelName}-`)) &&
      (!operation || !adapter.operations || adapter.operations.includes(operation)),
  )?.[1];

export const sanitizeImageOptions = (
  model: string,
  options: Record<string, any>,
  operation?: OpenAIImageOperation,
) => {
  const adapter = getOpenAIImageModelAdapter(model, operation);
  if (!adapter) return options;

  const supportedParams = new Set(adapter.supportedParams);
  const omitParams = new Set(adapter.omitParams);
  const sanitized: Record<string, any> = {};

  Object.entries(options).forEach(([key, value]) => {
    const mappedKey = adapter.paramMap?.[key] ?? key;

    if (omitParams.has(key) || omitParams.has(mappedKey)) return;
    if (adapter.omitAutoParams?.includes(mappedKey) && value === 'auto') return;
    if (adapter.supportedParams && !supportedParams.has(mappedKey)) return;

    sanitized[mappedKey] = value;
  });

  if (adapter.defaultSize && (sanitized.size === undefined || sanitized.size === 'auto')) {
    sanitized.size = adapter.defaultSize;
  }

  return sanitized;
};
