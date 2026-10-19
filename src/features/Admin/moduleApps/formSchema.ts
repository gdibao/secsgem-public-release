import type {
  ModuleAppActionConfig,
  ModuleAppAdminUpsertInput,
  ModuleAppBillingConfig,
  ModuleAppPage,
  ModuleAppPageType,
  ModuleAppPlanEntitlement,
  ModuleAppRuntimeType,
  ModuleAppSource,
  ModuleAppStatus,
  ModuleAppType,
} from '@lobechat/types';
import { moduleAppAdminUpsertSchema } from '@lobechat/types';

type NumericInput = number | string | undefined;

type JsonRecord = Record<string, unknown>;

type ModuleAppPageFormInput = Omit<Partial<ModuleAppPage>, 'sortOrder' | 'type'> & {
  actionBindingsJson?: string;
  dataSourceJson?: string;
  layoutSchemaJson?: string;
  sortOrder?: NumericInput;
  type?: ModuleAppPageType | string;
};

type ModuleAppActionFormInput = Omit<
  Partial<ModuleAppActionConfig>,
  'moduleMultiplier' | 'runtimeType'
> & {
  inputSchemaJson?: string;
  moduleMultiplier?: NumericInput;
  outputSchemaJson?: string;
  runtimeConfigJson?: string;
  runtimeType?: ModuleAppRuntimeType | string;
};

type ModuleAppEntitlementFormInput = Omit<
  Partial<ModuleAppPlanEntitlement>,
  'discountPercent' | 'freeQuotaCredits'
> & {
  discountPercent?: NumericInput;
  freeQuotaCredits?: NumericInput;
};

type ModuleAppBillingFormInput = Omit<
  Partial<ModuleAppBillingConfig>,
  'defaultMultiplier' | 'externalApiCostCredits' | 'fixedServiceFeeCredits'
> & {
  defaultMultiplier?: NumericInput;
  externalApiCostCredits?: NumericInput;
  fixedServiceFeeCredits?: NumericInput;
};

export type ModuleAppAdminFormInput = {
  actions?: ModuleAppActionFormInput[];
  appType?: ModuleAppType | string;
  billing?: ModuleAppBillingFormInput;
  category?: string;
  description?: string;
  displayName?: string;
  entitlements?: ModuleAppEntitlementFormInput[];
  icon?: string;
  id?: string;
  pages?: ModuleAppPageFormInput[];
  slug?: string;
  source?: ModuleAppSource | string;
  status?: ModuleAppStatus | string;
  tags?: string[] | string;
};

export type ModuleAppPageFormValues = ModuleAppPage & {
  actionBindingsJson: string;
  dataSourceJson: string;
  layoutSchemaJson: string;
};

export type ModuleAppActionFormValues = ModuleAppActionConfig & {
  inputSchemaJson: string;
  outputSchemaJson: string;
  runtimeConfigJson: string;
};

export type ModuleAppAdminFormValues = Omit<ModuleAppAdminUpsertInput, 'actions' | 'pages'> & {
  actions: ModuleAppActionFormValues[];
  entitlements: ModuleAppPlanEntitlement[];
  pages: ModuleAppPageFormValues[];
};

const DEFAULT_BILLING = {
  chargeMode: 'free',
  defaultMultiplier: 1,
  externalApiCostCredits: 0,
  failureFixedFeePolicy: 'do_not_charge',
  fixedServiceFeeCredits: 0,
} as const satisfies ModuleAppBillingConfig;

const DEFAULT_PAGE = {
  actionBindings: [],
  dataSource: {},
  key: 'overview',
  layoutSchema: {},
  routePath: '/',
  sortOrder: 0,
  title: 'Overview',
  type: 'overview',
} as const satisfies ModuleAppPage;

const runtimeTypes = new Set<ModuleAppRuntimeType>([
  'none',
  'record_create',
  'record_update',
  'record_archive',
  'api_action',
  'server_action',
  'content_generation',
  'workflow_step',
  'executable_action',
]);

const pageTypes = new Set<ModuleAppPageType>([
  'overview',
  'form',
  'list',
  'detail',
  'result',
  'artifact',
  'custom',
]);

const toText = (value: unknown) => String(value ?? '').trim();

const toNumber = (value: NumericInput, fallback: number) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;

  const text = toText(value);
  if (!text) return fallback;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toSlug = (value: unknown) =>
  toText(value)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .replaceAll(/-+/g, '-');

const toKey = (value: unknown, fallback: string) => {
  const normalized = (toText(value) || fallback)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .replaceAll(/_+/g, '_');

  const withLetterStart = /^[a-z]/.test(normalized) ? normalized : `${fallback}_${normalized}`;
  const clipped = withLetterStart.slice(0, 64).replaceAll(/_+$/g, '');

  return /^[a-z][a-z0-9_]{1,63}$/.test(clipped) ? clipped : fallback;
};

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const parseJson = (value: string | undefined, fieldName: string) => {
  const text = toText(value);
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${fieldName}`);
  }
};

const parseJsonRecord = (
  jsonValue: string | undefined,
  objectValue: unknown,
  fallback: JsonRecord,
  fieldName: string,
) => {
  const parsed = parseJson(jsonValue, fieldName);
  if (parsed !== undefined) return isRecord(parsed) ? parsed : fallback;
  if (isRecord(objectValue)) return objectValue;
  return fallback;
};

const parseJsonArray = <T>(
  jsonValue: string | undefined,
  arrayValue: unknown,
  fallback: T[],
  fieldName: string,
) => {
  const parsed = parseJson(jsonValue, fieldName);
  if (parsed !== undefined) return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  if (Array.isArray(arrayValue)) return arrayValue as T[];
  return fallback;
};

const formatJson = (value: unknown) => {
  if (Array.isArray(value)) return value.length > 0 ? JSON.stringify(value, null, 2) : '';
  if (isRecord(value)) return Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '';

  return '';
};

const toTags = (value: ModuleAppAdminFormInput['tags']) => {
  const tags = Array.isArray(value) ? value : toText(value).split(',');

  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
};

const toStatus = (value: ModuleAppAdminFormInput['status']): ModuleAppStatus => {
  if (value === 'published' || value === 'unpublished') return value;
  return 'draft';
};

const toSource = (value: ModuleAppAdminFormInput['source']): ModuleAppSource => {
  if (value === 'system' || value === 'user' || value === 'developer') return value;
  return 'admin';
};

const toAppType = (value: ModuleAppAdminFormInput['appType']): ModuleAppType => {
  if (
    value === 'api_app' ||
    value === 'ai_app' ||
    value === 'workflow_app' ||
    value === 'hybrid_app'
  ) {
    return value;
  }

  return 'standard_app';
};

const toPageType = (value: ModuleAppPageFormInput['type']): ModuleAppPageType =>
  pageTypes.has(value as ModuleAppPageType) ? (value as ModuleAppPageType) : 'overview';

const toRuntimeType = (value: ModuleAppActionFormInput['runtimeType']): ModuleAppRuntimeType =>
  runtimeTypes.has(value as ModuleAppRuntimeType) ? (value as ModuleAppRuntimeType) : 'none';

const normalizePage = (page: ModuleAppPageFormInput, index: number): ModuleAppPageFormValues => {
  const dataSource = parseJsonRecord(
    page.dataSourceJson,
    page.dataSource,
    {},
    `pages[${index}].dataSourceJson`,
  );
  const layoutSchema = parseJsonRecord(
    page.layoutSchemaJson,
    page.layoutSchema,
    {},
    `pages[${index}].layoutSchemaJson`,
  );
  const actionBindings = parseJsonArray<{ actionKey: string; event: string }>(
    page.actionBindingsJson,
    page.actionBindings,
    [],
    `pages[${index}].actionBindingsJson`,
  );

  return {
    actionBindings,
    actionBindingsJson: page.actionBindingsJson ?? formatJson(actionBindings),
    dataSource,
    dataSourceJson: page.dataSourceJson ?? formatJson(dataSource),
    key: toKey(page.key, index === 0 ? 'overview' : `page_${index + 1}`),
    layoutSchema,
    layoutSchemaJson: page.layoutSchemaJson ?? formatJson(layoutSchema),
    routePath: toText(page.routePath).startsWith('/')
      ? toText(page.routePath)
      : `/${toText(page.routePath) || 'page'}`,
    sortOrder: Math.round(toNumber(page.sortOrder, index)),
    title: toText(page.title) || `Page ${index + 1}`,
    type: toPageType(page.type),
  };
};

const normalizeAction = (
  action: ModuleAppActionFormInput,
  index: number,
): ModuleAppActionFormValues => {
  const inputSchema = parseJsonRecord(
    action.inputSchemaJson,
    action.inputSchema,
    { fields: [] },
    `actions[${index}].inputSchemaJson`,
  ) as ModuleAppActionConfig['inputSchema'];
  const outputSchema = parseJsonRecord(
    action.outputSchemaJson,
    action.outputSchema,
    {},
    `actions[${index}].outputSchemaJson`,
  );
  const runtimeConfig = parseJsonRecord(
    action.runtimeConfigJson,
    action.runtimeConfig,
    {},
    `actions[${index}].runtimeConfigJson`,
  );

  return {
    id: toKey(action.id, `action_${index + 1}`),
    inputSchema,
    inputSchemaJson: action.inputSchemaJson ?? formatJson(inputSchema),
    moduleMultiplier: toNumber(action.moduleMultiplier, 1),
    name: toText(action.name) || `Action ${index + 1}`,
    outputSchema,
    outputSchemaJson: action.outputSchemaJson ?? formatJson(outputSchema),
    runtimeConfig,
    runtimeConfigJson: action.runtimeConfigJson ?? formatJson(runtimeConfig),
    runtimeType: toRuntimeType(action.runtimeType),
  };
};

const normalizeEntitlement = (
  entitlement: ModuleAppEntitlementFormInput,
): ModuleAppPlanEntitlement => ({
  discountPercent: toNumber(entitlement.discountPercent, 0),
  freeQuotaCredits: toNumber(entitlement.freeQuotaCredits, 0),
  installable: entitlement.installable === true,
  plan: toText(entitlement.plan),
  runnable: entitlement.runnable === true,
  visible: entitlement.visible === true,
});

const normalizeBilling = (billing: ModuleAppAdminFormInput['billing']): ModuleAppBillingConfig => ({
  chargeMode:
    billing?.chargeMode === 'fixed' ||
    billing?.chargeMode === 'ai_usage' ||
    billing?.chargeMode === 'external_api' ||
    billing?.chargeMode === 'hybrid'
      ? billing.chargeMode
      : 'free',
  defaultMultiplier: toNumber(billing?.defaultMultiplier, DEFAULT_BILLING.defaultMultiplier),
  externalApiCostCredits: toNumber(
    billing?.externalApiCostCredits,
    DEFAULT_BILLING.externalApiCostCredits,
  ),
  failureFixedFeePolicy: 'do_not_charge',
  fixedServiceFeeCredits: toNumber(
    billing?.fixedServiceFeeCredits,
    DEFAULT_BILLING.fixedServiceFeeCredits,
  ),
});

export const createDefaultModuleAppFormValues = (): ModuleAppAdminFormValues => ({
  actions: [],
  appType: 'standard_app',
  billing: { ...DEFAULT_BILLING },
  category: '',
  description: '',
  displayName: '',
  entitlements: [],
  icon: 'Blocks',
  pages: [normalizePage(DEFAULT_PAGE, 0)],
  slug: '',
  source: 'admin',
  status: 'draft',
  tags: [],
});

export const normalizeModuleAppFormValues = (
  input: ModuleAppAdminFormInput,
): ModuleAppAdminFormValues => {
  const pages = input.pages?.length
    ? input.pages.map(normalizePage)
    : [normalizePage(DEFAULT_PAGE, 0)];

  return {
    actions: input.actions?.map(normalizeAction) ?? [],
    appType: toAppType(input.appType),
    billing: normalizeBilling(input.billing),
    category: toText(input.category),
    description: toText(input.description),
    displayName: toText(input.displayName),
    entitlements: input.entitlements?.map(normalizeEntitlement).filter((item) => item.plan) ?? [],
    icon: toText(input.icon) || 'Blocks',
    id: toText(input.id) || undefined,
    pages,
    slug: toSlug(input.slug),
    source: toSource(input.source),
    status: toStatus(input.status),
    tags: toTags(input.tags),
  };
};

export const buildModuleAppUpsertInput = (
  values: ModuleAppAdminFormValues,
): ModuleAppAdminUpsertInput =>
  moduleAppAdminUpsertSchema.parse({
    ...values,
    actions: values.actions.map(
      ({ inputSchemaJson, outputSchemaJson, runtimeConfigJson, ...action }) => action,
    ),
    pages: values.pages.map(
      ({ actionBindingsJson, dataSourceJson, layoutSchemaJson, ...page }) => page,
    ),
  });

export const parseModuleAppAdminForm = (value: unknown) =>
  buildModuleAppUpsertInput(
    normalizeModuleAppFormValues({
      ...(value as ModuleAppAdminFormInput),
    }),
  );

type ModuleAppPublishReadiness = {
  actions?: unknown[];
  entitlements?: Array<{ runnable?: boolean; visible?: boolean }>;
  pages?: unknown[];
};

export type ModuleAppPublishWarningCode = 'noActions' | 'noPages' | 'noVisibleEntitlement';

const moduleAppPublishWarningMessages = {
  noActions: 'No runnable actions configured',
  noPages: 'No pages configured',
  noVisibleEntitlement: 'No visible plan entitlement configured',
} as const satisfies Record<ModuleAppPublishWarningCode, string>;

export const buildModuleAppPublishWarningCodes = (app: ModuleAppPublishReadiness) => {
  const warnings: ModuleAppPublishWarningCode[] = [];

  if (!app.pages || app.pages.length === 0) warnings.push('noPages');
  if (!app.actions || app.actions.length === 0) warnings.push('noActions');
  if (!app.entitlements?.some((item) => item.visible)) {
    warnings.push('noVisibleEntitlement');
  }

  return warnings;
};

export const buildModuleAppPublishWarnings = (app: ModuleAppPublishReadiness) =>
  buildModuleAppPublishWarningCodes(app).map((code) => moduleAppPublishWarningMessages[code]);
