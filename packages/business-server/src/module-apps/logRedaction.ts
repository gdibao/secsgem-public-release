const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_LOG_KEY_PATTERN =
  /authorization|api.?key|access.?token|refresh.?token|secret|password|credential|cookie/i;

export const redactModuleAppLogValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => redactModuleAppLogValue(item));

  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_LOG_KEY_PATTERN.test(key) ? REDACTED_VALUE : redactModuleAppLogValue(item),
    ]),
  );
};

export const redactResolvedModuleAppSecretValues = (
  value: unknown,
  secrets: Record<string, string>,
): unknown => {
  const secretValues = Object.values(secrets).filter(Boolean);

  if (secretValues.length === 0) return redactModuleAppLogValue(value);

  const redactText = (text: string) =>
    secretValues.reduce((current, secret) => current.split(secret).join(REDACTED_VALUE), text);

  const redactValue = (item: unknown): unknown => {
    if (typeof item === 'string') return redactText(item);
    if (Array.isArray(item)) return item.map((entry) => redactValue(entry));

    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([key, entry]) => [
          key,
          redactValue(entry),
        ]),
      );
    }

    return item;
  };

  return redactModuleAppLogValue(redactValue(value));
};
