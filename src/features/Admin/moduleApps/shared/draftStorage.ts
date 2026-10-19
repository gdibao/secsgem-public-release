const DRAFT_VERSION = 1 as const;
const DRAFT_KEY_PREFIX = `admin-module-app-draft:v${DRAFT_VERSION}:`;
const DRAFT_SCOPE_PATTERN = /^[^/]+\/configuration$|^[^/]+\/entitlements$/;
const SENSITIVE_FIELD_NAMES = new Set(['batchid', 'requestedamount']);
const SENSITIVE_DESCRIPTOR_CONTAINER_NAMES = new Set([
  'env',
  'environment',
  'environmentvariables',
  'headers',
  'metadata',
  'variables',
]);
const SENSITIVE_DESCRIPTOR_FIELD_NAMES = new Set([
  'envname',
  'headername',
  'key',
  'name',
  'parametername',
  'variablename',
]);
const SENSITIVE_FINANCE_IDENTIFIER_PATTERN =
  /(?:discrepancy|license|order|refund|revenueentry|settlementbatch|trade|transaction)(?:id|ids|no|number|reference)$/;
const SENSITIVE_FIELD_PATTERN =
  /alipay|api.?key|authorization|bank(?:account|name|number)?|card(?:number)?|credential|evidence|iban|payment|payout|private.?key|recipient|routing(?:number)?|secret|tax(?:id)?/i;
const SENSITIVE_DESCRIPTOR_NAME_PATTERN =
  /alipay|api.?key|authorization|bank(?:account|name|number)?|card(?:number)?|credential|evidence|iban|private.?key|recipient|routing(?:number)?|secret|tax(?:id)?/i;
const SENSITIVE_PAYMENT_DESCRIPTOR_PATTERN =
  /(?:payment|payout)(?:account|customer|intent|method|provider|recipient|transaction)?(?:id|ids|no|number|reference)$/;
const NON_SENSITIVE_TOKEN_USAGE_PATTERN =
  /^(?:cached|completion|context|estimated|input|max|min|output|prompt|reasoning|remaining|total|used)tokens?$/;
const SENSITIVE_TOKEN_FIELD_PATTERN = /token(?:id|s|value)?$/;

export type ModuleDraftView = 'configuration' | 'entitlements';
export type ModuleDraftStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

type ModuleDraftEnvelope<T> = {
  data: T;
  version: typeof DRAFT_VERSION;
};

const getDefaultStorage = (): ModuleDraftStorage | undefined =>
  typeof window === 'undefined' ? undefined : window.localStorage;

const getDraftKey = (scope: string) => {
  if (!DRAFT_SCOPE_PATTERN.test(scope)) {
    throw new TypeError('Module app draft scope must target configuration or entitlements');
  }

  return `${DRAFT_KEY_PREFIX}${scope}`;
};

const normalizeFieldName = (key: string) => key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase();

const isSensitiveTokenFieldName = (normalizedKey: string) =>
  !NON_SENSITIVE_TOKEN_USAGE_PATTERN.test(normalizedKey) &&
  SENSITIVE_TOKEN_FIELD_PATTERN.test(normalizedKey);

const isSensitiveFieldName = (key: string) => {
  const normalizedKey = normalizeFieldName(key);

  return (
    SENSITIVE_FIELD_NAMES.has(normalizedKey) ||
    SENSITIVE_FINANCE_IDENTIFIER_PATTERN.test(normalizedKey) ||
    SENSITIVE_FIELD_PATTERN.test(key) ||
    isSensitiveTokenFieldName(normalizedKey)
  );
};

const isSensitiveDescriptorName = (key: string) => {
  const normalizedKey = normalizeFieldName(key);

  return (
    SENSITIVE_FIELD_NAMES.has(normalizedKey) ||
    SENSITIVE_FINANCE_IDENTIFIER_PATTERN.test(normalizedKey) ||
    SENSITIVE_DESCRIPTOR_NAME_PATTERN.test(key) ||
    SENSITIVE_PAYMENT_DESCRIPTOR_PATTERN.test(normalizedKey) ||
    isSensitiveTokenFieldName(normalizedKey)
  );
};

const hasSensitiveField = (value: unknown, descriptorContainer = false): boolean => {
  if (!value || typeof value !== 'object') return false;

  if (Array.isArray(value)) {
    if (
      descriptorContainer &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      isSensitiveDescriptorName(value[0])
    ) {
      return true;
    }

    return value.some((nestedValue) => hasSensitiveField(nestedValue, descriptorContainer));
  }

  if (
    descriptorContainer &&
    Object.hasOwn(value, 'value') &&
    Object.entries(value).some(
      ([key, nestedValue]) =>
        SENSITIVE_DESCRIPTOR_FIELD_NAMES.has(normalizeFieldName(key)) &&
        typeof nestedValue === 'string' &&
        isSensitiveDescriptorName(nestedValue),
    )
  ) {
    return true;
  }

  return Object.entries(value).some(([key, nestedValue]) => {
    if (isSensitiveFieldName(key)) return true;

    return hasSensitiveField(
      nestedValue,
      SENSITIVE_DESCRIPTOR_CONTAINER_NAMES.has(normalizeFieldName(key)),
    );
  });
};

const assertNoSensitiveFields = (draft: unknown) => {
  if (hasSensitiveField(draft)) {
    throw new TypeError('Sensitive module app draft field cannot be persisted');
  }
};

const serializeDraft = <T>(draft: T) => {
  assertNoSensitiveFields(draft);

  return JSON.stringify({ data: draft, version: DRAFT_VERSION } satisfies ModuleDraftEnvelope<T>);
};

export const createModuleDraftScope = (appId: string, view: ModuleDraftView) => {
  const normalizedAppId = appId.trim();
  if (!normalizedAppId || normalizedAppId.includes('/')) {
    throw new TypeError('Module app draft appId must be non-empty and cannot contain slashes');
  }

  return `${normalizedAppId}/${view}` as const;
};

export const loadModuleDraft = <T>(
  scope: string,
  storage: ModuleDraftStorage | undefined = getDefaultStorage(),
): T | null => {
  if (!storage) return null;

  const key = getDraftKey(scope);
  const stored = storage.getItem(key);
  if (!stored) return null;

  try {
    const envelope = JSON.parse(stored) as Partial<ModuleDraftEnvelope<T>>;
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      envelope.version !== DRAFT_VERSION ||
      !Object.hasOwn(envelope, 'data')
    ) {
      storage.removeItem(key);
      return null;
    }

    if (hasSensitiveField(envelope.data)) {
      storage.removeItem(key);
      return null;
    }

    return envelope.data as T;
  } catch {
    storage.removeItem(key);
    return null;
  }
};

export const saveModuleDraft = <T>(
  scope: string,
  draft: T,
  storage: ModuleDraftStorage | undefined = getDefaultStorage(),
) => {
  if (!storage) return;
  storage.setItem(getDraftKey(scope), serializeDraft(draft));
};

export const clearModuleDraft = (
  scope: string,
  storage: ModuleDraftStorage | undefined = getDefaultStorage(),
) => {
  storage?.removeItem(getDraftKey(scope));
};
