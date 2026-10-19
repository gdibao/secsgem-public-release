import type { PaymentMethodId } from '@lobechat/types';

const STORAGE_KEY = 'comhub.topup.payment-intent.v1';
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const PAYMENT_METHODS = new Set<PaymentMethodId>([
  'alipay',
  'wechat_pay',
  'zpay_alipay',
  'zpay_wechat',
]);

export interface TopUpPaymentIntentStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

export interface TopUpPaymentIntent {
  idempotencyKey: string;
  method: PaymentMethodId;
  packageId: string;
}

const getSessionStorage = (): TopUpPaymentIntentStorage | undefined => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

const isTopUpPaymentIntent = (value: unknown): value is TopUpPaymentIntent => {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<TopUpPaymentIntent>;

  return (
    typeof intent.idempotencyKey === 'string' &&
    UUID_PATTERN.test(intent.idempotencyKey) &&
    typeof intent.method === 'string' &&
    PAYMENT_METHODS.has(intent.method as PaymentMethodId) &&
    typeof intent.packageId === 'string' &&
    intent.packageId.length > 0
  );
};

export const readTopUpPaymentIntent = (
  storage: TopUpPaymentIntentStorage | undefined = getSessionStorage(),
): TopUpPaymentIntent | undefined => {
  if (!storage) return;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (isTopUpPaymentIntent(parsed)) return parsed;
    storage.removeItem(STORAGE_KEY);
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable or blocked session storage.
    }
  }
};

export const getOrCreateTopUpPaymentIntent = (
  selection: Pick<TopUpPaymentIntent, 'method' | 'packageId'>,
  options: {
    createId?: () => string;
    storage?: TopUpPaymentIntentStorage;
  } = {},
): TopUpPaymentIntent => {
  const storage = options.storage ?? getSessionStorage();
  const existing = readTopUpPaymentIntent(storage);
  if (existing?.method === selection.method && existing.packageId === selection.packageId) {
    return existing;
  }

  const intent = {
    ...selection,
    idempotencyKey: (options.createId ?? (() => globalThis.crypto.randomUUID()))(),
  };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // The current request can still use the generated key when storage is unavailable.
  }
  return intent;
};

export const clearTopUpPaymentIntent = (
  idempotencyKey: string,
  storage: TopUpPaymentIntentStorage | undefined = getSessionStorage(),
) => {
  const existing = readTopUpPaymentIntent(storage);
  if (existing?.idempotencyKey !== idempotencyKey) return;
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable or blocked session storage.
  }
};
