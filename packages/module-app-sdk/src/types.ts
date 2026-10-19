export type ModuleAppDataFilter = {
  field: string;
  operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'prefix';
  value: unknown;
};

export type ModuleAppDataSort = {
  direction?: 'asc' | 'desc';
  field: string;
};

export type ModuleAppDataQueryInput = {
  cursor?: string;
  filters?: ModuleAppDataFilter[];
  limit?: number;
  sort?: ModuleAppDataSort[];
  tableKey: string;
};

export type ModuleAppDataGetInput = { rowKey: string; tableKey: string };
export type ModuleAppDataArchiveInput = ModuleAppDataGetInput;

export type ModuleAppDataInsertInput = {
  rowKey?: string;
  tableKey: string;
  values: Record<string, unknown>;
};

export type ModuleAppDataUpdateInput = {
  rowKey: string;
  tableKey: string;
  values: Record<string, unknown>;
};

export type ModuleAppDataTransactionOperation =
  | ({ operation: 'archive' } & ModuleAppDataArchiveInput)
  | ({ operation: 'insert' } & ModuleAppDataInsertInput)
  | ({ operation: 'update' } & ModuleAppDataUpdateInput);

export type ModuleAppDataTransaction = { operations: ModuleAppDataTransactionOperation[] };

export type ModuleAppDataRow = {
  createdAt: Date;
  installationId: string;
  rowKey: string;
  status: 'active' | 'archived';
  tableKey: string;
  updatedAt: Date;
  values: Record<string, unknown>;
};

export type ModuleAppTaskRunInput = { runId: string };
export type ModuleAppTaskRun = {
  id: string;
  status: 'cancelled' | 'failed' | 'queued' | 'running' | 'succeeded' | 'waiting';
  [key: string]: unknown;
};

export type ModuleAppAiMessage = {
  content: string;
  role: 'assistant' | 'system' | 'user';
};

export type ModuleAppAiChatInput = {
  maxTokens?: number;
  messages: ModuleAppAiMessage[];
  model: string;
  temperature?: number;
};

export type ModuleAppAiTokenUsage = {
  input: number;
  output: number;
  total: number;
};

export type ModuleAppAiChatResult = {
  actualAiCredits: number;
  model: string;
  text: string;
  tokenUsage: ModuleAppAiTokenUsage;
};

export type ModuleAppAiModel = {
  abilities: string[];
  displayName?: string;
  id: string;
  type: 'chat';
};

export type ModuleAppPaymentMethod = {
  id: 'alipay' | 'wechat_pay' | 'zpay_alipay' | 'zpay_wechat';
  label: string;
  provider: 'alipay' | 'wechat_pay' | 'zpay';
};

export type ModuleAppPaymentCatalogItem = {
  amount: number;
  billingPeriod?: 'monthly' | 'yearly';
  currency: 'CNY' | 'USD';
  licenseScope: 'personal' | 'workspace' | 'workspace_seat';
  productId: string;
  productKey: string;
  productType: 'free' | 'one_time' | 'subscription';
  trialDays: number;
};

export type ModuleAppPaymentCheckoutInput = {
  idempotencyKey: string;
  method?: ModuleAppPaymentMethod['id'];
  productId: string;
};

export type ModuleAppPaymentCheckoutAction =
  | { fields: Record<string, string>; method: 'POST'; type: 'form'; url: string }
  | { type: 'redirect'; url: string }
  | { type: 'qrcode'; url: string };

export type ModuleAppPaymentCheckoutResult = {
  checkout: ModuleAppPaymentCheckoutAction;
  method: ModuleAppPaymentMethod['id'];
  orderId: string;
  outTradeNo: string;
  provider: ModuleAppPaymentMethod['provider'];
};

export type ModuleAppPaymentOrderStatus = 'cancelled' | 'paid' | 'pending' | 'refunded';

export type ModuleAppPaymentOrderStatusResult = {
  method: ModuleAppPaymentMethod['id'] | null;
  paymentStatus: 'created' | 'failed' | 'paid' | 'pending' | 'refunded' | null;
  provider: ModuleAppPaymentMethod['provider'] | null;
  status: ModuleAppPaymentOrderStatus;
};
