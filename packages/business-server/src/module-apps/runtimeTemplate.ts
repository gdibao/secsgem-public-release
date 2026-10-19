export const renderModuleAppTemplateString = (
  template: string,
  values: Record<string, unknown>,
): string =>
  template.replace(/\{\{\s*([\w:-]+)\s*\}\}|\{([\w:-]+)\}/g, (_match, doubleKey, singleKey) => {
    const key = doubleKey || singleKey;
    const value = values[key];

    if (value === undefined || value === null) return '';

    return String(value);
  });

export const renderModuleAppTemplateValue = (
  value: unknown,
  values: Record<string, unknown>,
): unknown => {
  if (typeof value === 'string') return renderModuleAppTemplateString(value, values);

  if (Array.isArray(value)) return value.map((item) => renderModuleAppTemplateValue(item, values));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        renderModuleAppTemplateValue(item, values),
      ]),
    );
  }

  return value;
};

export const sanitizeModuleAppArtifactFileName = (value: string): string => {
  const sanitized = value
    .trim()
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-\./g, '.')
    .replace(/^-|-$/g, '');

  return sanitized || 'module-app-result.md';
};
