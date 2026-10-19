export interface ParsedModelSelection {
  model: string;
  provider: string;
}

/**
 * Base UI Select can emit an empty value while closing or clearing a menu.
 * Keep that transient state out of the persisted agent config.
 */
export const parseModelSelection = (
  value: unknown,
  optionProvider?: unknown,
): ParsedModelSelection | undefined => {
  if (typeof value !== 'string' || value.length === 0) return;

  const [valueProvider, ...modelParts] = value.split('/');
  const model = modelParts.join('/');
  const provider =
    typeof optionProvider === 'string' && optionProvider.length > 0
      ? optionProvider
      : valueProvider;

  if (!provider || !model) return;

  return { model, provider };
};
