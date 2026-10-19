import { type PaymentMethodId, Plans, type SubscriptionCycleType } from '@lobechat/types';

const STORAGE_KEY = 'comhub.subscription.payment-intent.v1';
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const PAYMENT_METHODS = new Set<PaymentMethodId>([
  'alipay',
  'wechat_pay',
  'zpay_alipay',
  'zpay_wechat',
]);
const CYCLES = new Set<SubscriptionCycleType>(['lifetime', 'monthly', 'one_time', 'yearly']);
const PLANS = new Set<Plans>(Object.values(Plans));

export interface SubscriptionPaymentIntentStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

export interface SubscriptionPaymentIntent {
  cycle: SubscriptionCycleType;
  idempotencyKey: string;
  method: PaymentMethodId;
  plan: Plans;
}

const getStorage = (): SubscriptionPaymentIntentStorage | undefined => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

const isIntent = (value: unknown): value is SubscriptionPaymentIntent => {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<SubscriptionPaymentIntent>;
  return (
    typeof intent.idempotencyKey === 'string' &&
    UUID_PATTERN.test(intent.idempotencyKey) &&
    typeof intent.method === 'string' &&
    PAYMENT_METHODS.has(intent.method as PaymentMethodId) &&
    typeof intent.plan === 'string' &&
    PLANS.has(intent.plan as Plans) &&
    typeof intent.cycle === 'string' &&
    CYCLES.has(intent.cycle as SubscriptionCycleType)
  );
};

export const readSubscriptionPaymentIntent = (
  storage: SubscriptionPaymentIntentStorage | undefined = getStorage(),
): SubscriptionPaymentIntent | undefined => {
  if (!storage) return;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (isIntent(parsed)) return parsed;
    storage.removeItem(STORAGE_KEY);
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable or blocked session storage.
    }
  }
};

export const getOrCreateSubscriptionPaymentIntent = (
  selection: Omit<SubscriptionPaymentIntent, 'idempotencyKey'>,
  options: {
    createId?: () => string;
    storage?: SubscriptionPaymentIntentStorage;
  } = {},
) => {
  const storage = options.storage ?? getStorage();
  const existing = readSubscriptionPaymentIntent(storage);
  if (
    existing?.plan === selection.plan &&
    existing.cycle === selection.cycle &&
    existing.method === selection.method
  ) {
    return existing;
  }
  const intent = {
    ...selection,
    idempotencyKey: (options.createId ?? (() => globalThis.crypto.randomUUID()))(),
  };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // The generated key still protects this browser request when storage is unavailable.
  }
  return intent;
};

export const clearSubscriptionPaymentIntent = (
  idempotencyKey: string,
  storage: SubscriptionPaymentIntentStorage | undefined = getStorage(),
) => {
  const existing = readSubscriptionPaymentIntent(storage);
  if (existing?.idempotencyKey !== idempotencyKey) return;
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable or blocked session storage.
  }
};
