import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { APP_SETTING_KEYS } from '@/server/services/appSettings';

import * as catalogContract from './catalog';
import {
  APP_SETTINGS_CATALOG,
  APP_SETTINGS_SECTION_KEYS,
  GENERIC_WRITABLE_APP_SETTING_KEYS,
  getAppSettingCatalogItem,
  normalizeAppSettingValue,
  PPT_WRITABLE_APP_SETTING_KEYS,
  WRITABLE_APP_SETTING_KEYS,
} from './catalog';
import {
  EXPECTED_NORMALIZER_ADAPTER_BY_KEY,
  listNormalizerAdapterMismatches,
} from './catalog.test.fixtures';

const GENERIC_WRITE_SURFACE = 'adminSettingsRouter.setAppSetting';
const PPT_WRITE_SURFACE = 'adminPptRouter.saveSettings';
const repoRoot = path.resolve(__dirname, '../../../..');

const findNamedSource = (source: string, sourcePath: string, symbol: string) => {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const matches: ts.Node[] = [];

  const visit = (node: ts.Node) => {
    const isSupportedDeclaration =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isVariableDeclaration(node);
    const name = isSupportedDeclaration ? node.name : undefined;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === symbol) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  expect(matches.length, `${sourcePath}#${symbol}`).toBeGreaterThan(0);
  return matches.map((node) => node.getText(sourceFile)).join('\n');
};

const catalogItem = (key: string) => {
  const item = getAppSettingCatalogItem(key);
  expect(item).toBeDefined();
  return item!;
};

describe('APP_SETTINGS_CATALOG', () => {
  it('covers every registry key once and applies lifecycle/write invariants', () => {
    const registeredKeys = Object.values(APP_SETTING_KEYS).sort();
    const catalogKeys = APP_SETTINGS_CATALOG.map((item) => item.key).sort();

    expect(catalogKeys).toEqual(registeredKeys);
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);

    for (const setting of APP_SETTINGS_CATALOG) {
      expect(setting.defaultSource).toBeTruthy();
      expect(setting.effectiveSource.length).toBeGreaterThan(0);
      expect(setting.cacheScopes).toContain('app-settings');
      expect(setting.valueSchema).toBeTruthy();

      if (setting.lifecycle === 'active') {
        expect(setting.writable).toBe(true);
        expect(setting.writeSurfaces.length).toBeGreaterThan(0);
        expect(setting.runtimeConsumers.length).toBeGreaterThan(0);
      } else {
        expect(setting.writable).toBe(false);
        expect(setting.writeSurfaces).toEqual([]);
      }

      if (setting.ownership === 'external') expect(setting.lifecycle).toBe('external');
    }

    expect(APP_SETTINGS_SECTION_KEYS.notifications).toContain(
      APP_SETTING_KEYS.notificationRetentionDays,
    );
    expect(
      Object.values(APP_SETTINGS_SECTION_KEYS).filter((keys) =>
        keys.includes(APP_SETTING_KEYS.notificationRetentionDays),
      ),
    ).toHaveLength(1);
    expect(APP_SETTINGS_SECTION_KEYS.settings).toEqual(
      expect.arrayContaining([
        APP_SETTING_KEYS.communityForkAndChatLabel,
        APP_SETTING_KEYS.communitySkillUseButtonLabel,
        APP_SETTING_KEYS.defaultAgentAvatar,
        APP_SETTING_KEYS.defaultAgentName,
        APP_SETTING_KEYS.defaultSkillName,
      ]),
    );
    expect(APP_SETTINGS_SECTION_KEYS.plans).toContain(APP_SETTING_KEYS.plansFaqItems);
    expect(APP_SETTINGS_SECTION_KEYS['model-billing-matrix']).toEqual(
      expect.arrayContaining([
        APP_SETTING_KEYS.defaultAgentModel,
        APP_SETTING_KEYS.defaultAgentProvider,
        APP_SETTING_KEYS.defaultImageModel,
        APP_SETTING_KEYS.defaultImageProvider,
        APP_SETTING_KEYS.defaultVideoModel,
        APP_SETTING_KEYS.defaultVideoProvider,
      ]),
    );
    expect(APP_SETTINGS_SECTION_KEYS['user-defaults']).toEqual(
      expect.arrayContaining([
        APP_SETTING_KEYS.profileAvatarPresets,
        APP_SETTING_KEYS.profileInterestAreas,
        APP_SETTING_KEYS.userGlobalSettingsDefaults,
      ]),
    );
    expect(APP_SETTINGS_SECTION_KEYS.integrations).toEqual(
      expect.arrayContaining([
        APP_SETTING_KEYS.composioApiKey,
        APP_SETTING_KEYS.composioAuthConfigIds,
        APP_SETTING_KEYS.composioEnabled,
      ]),
    );
    expect(APP_SETTINGS_SECTION_KEYS['ai-runtime-defaults']).toContain(
      APP_SETTING_KEYS.vectorEmbeddingModel,
    );
    expect(APP_SETTINGS_SECTION_KEYS['system-defaults']).toEqual(
      expect.arrayContaining([
        ...APP_SETTINGS_SECTION_KEYS['ai-runtime-defaults'],
        ...APP_SETTINGS_SECTION_KEYS.integrations,
        ...APP_SETTINGS_SECTION_KEYS['user-defaults'],
      ]),
    );
    expect(APP_SETTINGS_SECTION_KEYS.settings).not.toContain(
      APP_SETTING_KEYS.userGlobalSettingsDefaults,
    );
    expect(
      APP_SETTINGS_CATALOG.filter(
        (item) => item.key === APP_SETTING_KEYS.userGlobalSettingsDefaults,
      ),
    ).toHaveLength(1);
    expect(APP_SETTINGS_SECTION_KEYS.maintenance).toContain(
      APP_SETTING_KEYS.memoryUserMemoryTriggerMode,
    );
    expect(APP_SETTINGS_SECTION_KEYS['module-runtime']).toEqual(
      expect.arrayContaining([
        APP_SETTING_KEYS.moduleAppExecutionEnabled,
        APP_SETTING_KEYS.moduleAppPublicExecutionEnabled,
        APP_SETTING_KEYS.moduleAppRuntimeInternalToken,
        APP_SETTING_KEYS.moduleAppRuntimeInternalUrl,
        APP_SETTING_KEYS.moduleAppRuntimeInvocationEnabled,
        APP_SETTING_KEYS.moduleAppRuntimePublicOrigin,
        APP_SETTING_KEYS.moduleAppScheduleDispatchEnabled,
        APP_SETTING_KEYS.moduleAppWorkflowPrivilegedExecutorsEnabled,
      ]),
    );
    for (const key of APP_SETTINGS_SECTION_KEYS['module-runtime']) {
      expect(catalogItem(key).requiredCapability).toBe('moduleAppWrite');
    }
    expect(WRITABLE_APP_SETTING_KEYS).not.toContain(APP_SETTING_KEYS.desktopOssAccessKeySecret);

    expect(catalogItem(APP_SETTING_KEYS.ordersManagementEnabled)).toMatchObject({
      auditPolicy: 'none',
      effectiveSource: ['application-default'],
      lifecycle: 'deprecated',
      requiredCapability: 'systemRead',
      runtimeConsumers: [],
      writable: false,
      writeSurfaces: [],
    });
    expect(GENERIC_WRITABLE_APP_SETTING_KEYS).not.toContain(
      APP_SETTING_KEYS.ordersManagementEnabled,
    );
  });

  it('declares exact environment fallback order for S3, Composio, cron, and memory', () => {
    const expectedS3Sources = new Map<string, string[]>([
      [APP_SETTING_KEYS.storageS3AccessKeyId, ['environment:S3_ACCESS_KEY_ID']],
      [APP_SETTING_KEYS.storageS3Bucket, ['environment:S3_BUCKET']],
      [
        APP_SETTING_KEYS.storageS3EnablePathStyle,
        ['environment:S3_ENABLE_PATH_STYLE', 'application-default'],
      ],
      [APP_SETTING_KEYS.storageS3Endpoint, ['environment:S3_ENDPOINT']],
      [
        APP_SETTING_KEYS.storageS3FilePath,
        ['environment:NEXT_PUBLIC_S3_FILE_PATH', 'application-default'],
      ],
      [
        APP_SETTING_KEYS.storageS3PreviewUrlExpireIn,
        ['environment:S3_PREVIEW_URL_EXPIRE_IN', 'application-default'],
      ],
      [
        APP_SETTING_KEYS.storageS3PublicDomain,
        ['environment:S3_PUBLIC_DOMAIN', 'environment:NEXT_PUBLIC_S3_DOMAIN'],
      ],
      [APP_SETTING_KEYS.storageS3Region, ['environment:S3_REGION']],
      [APP_SETTING_KEYS.storageS3SecretAccessKey, ['environment:S3_SECRET_ACCESS_KEY']],
      [APP_SETTING_KEYS.storageS3SetAcl, ['environment:S3_SET_ACL', 'application-default']],
    ]);

    for (const [key, fallbacks] of expectedS3Sources) {
      expect(catalogItem(key).effectiveSource).toEqual([`database:${key}`, ...fallbacks]);
    }

    expect(catalogItem(APP_SETTING_KEYS.composioEnabled).effectiveSource).toEqual([
      `database:${APP_SETTING_KEYS.composioEnabled}`,
      'environment:COMPOSIO_ENABLED',
      `database:${APP_SETTING_KEYS.composioApiKey}`,
      'environment:COMPOSIO_API_KEY',
      'application-default',
    ]);
    expect(catalogItem(APP_SETTING_KEYS.cronSecret).effectiveSource).toEqual([
      `database:${APP_SETTING_KEYS.cronSecret}`,
      'environment:CRON_SECRET',
    ]);
    expect(catalogItem(APP_SETTING_KEYS.memoryUserMemoryTriggerMode).effectiveSource).toEqual([
      'environment:MEMORY_USER_MEMORY_TRIGGER_MODE',
      `database:${APP_SETTING_KEYS.memoryUserMemoryTriggerMode}`,
      'application-default',
    ]);
  });

  it('matches the independent exact key-to-normalizer-adapter contract', () => {
    expect(Object.keys(EXPECTED_NORMALIZER_ADAPTER_BY_KEY).sort()).toEqual(
      APP_SETTINGS_CATALOG.map((item) => item.key).sort(),
    );

    const actual = Object.fromEntries(
      APP_SETTINGS_CATALOG.map((setting) => [setting.key, setting.normalizer]),
    );
    expect(listNormalizerAdapterMismatches(actual)).toEqual([]);
  });

  it('rejects within-family normalizer adapter mutations', () => {
    const storageMutation = {
      ...EXPECTED_NORMALIZER_ADAPTER_BY_KEY,
      [APP_SETTING_KEYS.storageS3FilePath]:
        EXPECTED_NORMALIZER_ADAPTER_BY_KEY[APP_SETTING_KEYS.storageS3AccessKeyId],
    };
    expect(listNormalizerAdapterMismatches(storageMutation)).toContainEqual({
      actual: 'storage-string',
      expected: 'storage-file-path',
      key: APP_SETTING_KEYS.storageS3FilePath,
    });

    const modelPolicyMutation = {
      ...EXPECTED_NORMALIZER_ADAPTER_BY_KEY,
      [APP_SETTING_KEYS.modelPolicyMode]:
        EXPECTED_NORMALIZER_ADAPTER_BY_KEY[APP_SETTING_KEYS.modelPolicyDeniedMessage],
    };
    expect(listNormalizerAdapterMismatches(modelPolicyMutation)).toContainEqual({
      actual: 'model-policy-string',
      expected: 'model-policy-mode-enum',
      key: APP_SETTING_KEYS.modelPolicyMode,
    });
  });

  it('preserves non-secret normalization and rejects new non-string cron secrets', () => {
    expect(normalizeAppSettingValue(APP_SETTING_KEYS.brandName, '  ComHub  ')).toBe('ComHub');
    expect(normalizeAppSettingValue(APP_SETTING_KEYS.notificationRetentionDays, 10_000)).toBe(3650);
    expect(normalizeAppSettingValue(APP_SETTING_KEYS.cronSecret, '  exact secret  ')).toBe(
      '  exact secret  ',
    );
    expect(() => normalizeAppSettingValue(APP_SETTING_KEYS.cronSecret, 42)).toThrow();
    expect(() =>
      normalizeAppSettingValue(APP_SETTING_KEYS.cronSecret, { nested: ['value'] }),
    ).toThrow();
  });

  it('validates known nested user global default fields without requiring a complete settings object', () => {
    expect(
      normalizeAppSettingValue(APP_SETTING_KEYS.userGlobalSettingsDefaults, {
        systemAgent: { followUpAction: { enabled: true } },
        tool: { uninstalledBuiltinTools: ['search'] },
      }),
    ).toEqual({
      systemAgent: { followUpAction: { enabled: true } },
      tool: { uninstalledBuiltinTools: ['search'] },
    });

    expect(() =>
      normalizeAppSettingValue(APP_SETTING_KEYS.userGlobalSettingsDefaults, {
        systemAgent: { followUpAction: { enabled: 'true' } },
      }),
    ).toThrow();
    expect(() =>
      normalizeAppSettingValue(APP_SETTING_KEYS.userGlobalSettingsDefaults, {
        tool: { uninstalledBuiltinTools: 'search' },
      }),
    ).toThrow();
    expect(() =>
      normalizeAppSettingValue(APP_SETTING_KEYS.userGlobalSettingsDefaults, {
        general: { isLiteMode: 'false' },
      }),
    ).toThrow();
  });

  it('accepts only non-credentialed HTTPS or local HTTP payment URLs', () => {
    expect(
      normalizeAppSettingValue(APP_SETTING_KEYS.paymentPublicBaseUrl, 'https://app.example.com'),
    ).toBe('https://app.example.com');
    expect(
      normalizeAppSettingValue(APP_SETTING_KEYS.paymentPublicBaseUrl, 'http://localhost:3210'),
    ).toBe('http://localhost:3210');
    expect(() =>
      normalizeAppSettingValue(APP_SETTING_KEYS.paymentPublicBaseUrl, 'http://app.example.com'),
    ).toThrow(/valid HTTPS URL/);
    expect(() =>
      normalizeAppSettingValue(
        APP_SETTING_KEYS.paymentZpayApiBaseUrl,
        'https://user:secret@pay.example.com',
      ),
    ).toThrow(/valid HTTPS URL/);
  });

  it('normalizes Runtime endpoints and rejects credentialed or non-HTTPS public origins', () => {
    expect(
      normalizeAppSettingValue(
        APP_SETTING_KEYS.moduleAppRuntimeInternalUrl,
        'http://module-runtime:3210/ready',
      ),
    ).toBe('http://module-runtime:3210');
    expect(
      normalizeAppSettingValue(
        APP_SETTING_KEYS.moduleAppRuntimePublicOrigin,
        'https://runtime.example.com/apps',
      ),
    ).toBe('https://runtime.example.com');
    expect(() =>
      normalizeAppSettingValue(
        APP_SETTING_KEYS.moduleAppRuntimeInternalUrl,
        'https://operator:secret@runtime.example.com',
      ),
    ).toThrow(/valid HTTP\(S\) origin/);
    expect(() =>
      normalizeAppSettingValue(
        APP_SETTING_KEYS.moduleAppRuntimePublicOrigin,
        'http://runtime.example.com',
      ),
    ).toThrow(/valid HTTPS origin/);
  });

  it('models PPT settings as dedicated system-write contracts with exact limits', () => {
    const pptKeys = Object.values(APP_SETTING_KEYS).filter((key) => key.startsWith('docmee.ppt.'));

    expect([...PPT_WRITABLE_APP_SETTING_KEYS].sort()).toEqual([...pptKeys].sort());
    for (const key of pptKeys) {
      const setting = catalogItem(key);
      expect(setting).toMatchObject({
        auditPolicy: setting.sensitive ? 'write-redacted' : 'write',
        lifecycle: 'active',
        requiredCapability: 'systemWrite',
        writeSurfaces: [PPT_WRITE_SURFACE],
      });
      expect(GENERIC_WRITABLE_APP_SETTING_KEYS).not.toContain(key);
    }

    const dailyLimit = catalogItem(APP_SETTING_KEYS.docmeePptDailyLimit).valueSchema;
    expect(dailyLimit.safeParse(null).success).toBe(true);
    expect(dailyLimit.safeParse(0).success).toBe(true);
    expect(dailyLimit.safeParse(-1).success).toBe(false);

    const tokenTtl = catalogItem(APP_SETTING_KEYS.docmeePptTokenTtlMinutes).valueSchema;
    expect(tokenTtl.safeParse(1).success).toBe(true);
    expect(tokenTtl.safeParse(1440).success).toBe(true);
    expect(tokenTtl.safeParse(0).success).toBe(false);
    expect(tokenTtl.safeParse(1441).success).toBe(false);

    expect(
      normalizeAppSettingValue(APP_SETTING_KEYS.docmeePptDailyLimit, 0, PPT_WRITE_SURFACE),
    ).toBeNull();
    expect(() =>
      normalizeAppSettingValue(APP_SETTING_KEYS.docmeePptEnabled, true, GENERIC_WRITE_SURFACE),
    ).toThrow(/not writable/);
  });

  it('routes mobile configuration writes only through the publication contract', () => {
    for (const key of [APP_SETTING_KEYS.mobileConfig, APP_SETTING_KEYS.mobileConfigPublication]) {
      expect(catalogItem(key)).toMatchObject({
        lifecycle: 'active',
        requiredCapability: 'systemWrite',
        writable: true,
        writeSurfaces: ['adminSettingsRouter.mobilePublication'],
      });
      expect(GENERIC_WRITABLE_APP_SETTING_KEYS).not.toContain(key);
    }
  });

  it('derives runtime consumers from source-backed contracts', () => {
    type ConsumerContract = {
      id: string;
      keyEvidence: {
        consumerReferenceSymbol?: string;
        sourcePath?: string;
        sourceSymbol?: string;
      } & (
        | { kind: 'literal' }
        | { kind: 'prefix'; prefix: string }
        | {
            kind: 'registry';
            namespace: 'APP_SETTING_KEYS' | 'SETTING_KEYS';
          }
      );
      keys: string[];
      sourcePath: string;
      symbol: string;
    };

    const contracts = (catalogContract as any)
      .APP_SETTING_RUNTIME_CONSUMER_CONTRACTS as ConsumerContract[];
    expect(contracts).toBeDefined();
    expect(new Set(contracts.map((contract) => contract.id)).size).toBe(contracts.length);
    expect(contracts.find((contract) => contract.id === 'payment-runtime-config')).toMatchObject({
      keyEvidence: {
        consumerReferenceSymbol: 'PAYMENT_SETTING_KEYS',
        sourcePath: 'src/server/services/payments/environmentFallbacks.ts',
        sourceSymbol: 'PAYMENT_ENVIRONMENT_FALLBACKS',
      },
      sourcePath: 'src/server/services/payments/config.ts',
      symbol: 'getServerPaymentConfig',
    });

    const keyNames = new Map<string, string>(
      Object.entries(APP_SETTING_KEYS).map(([name, key]) => [key, name] as const),
    );

    for (const contract of contracts) {
      expect(contract.sourcePath).not.toMatch(/src\/features\/Admin/);
      expect(contract.symbol).not.toContain('getAll');

      const sourceFile = path.resolve(repoRoot, contract.sourcePath);
      expect(existsSync(sourceFile), contract.sourcePath).toBe(true);
      const source = readFileSync(sourceFile, 'utf8');
      const consumerSource = findNamedSource(source, contract.sourcePath, contract.symbol);
      const evidenceSourcePath = contract.keyEvidence.sourcePath ?? contract.sourcePath;
      const evidenceFile = path.resolve(repoRoot, evidenceSourcePath);
      expect(existsSync(evidenceFile), evidenceSourcePath).toBe(true);
      const evidenceFileSource =
        evidenceSourcePath === contract.sourcePath ? source : readFileSync(evidenceFile, 'utf8');
      const evidenceSource = contract.keyEvidence.sourceSymbol
        ? findNamedSource(evidenceFileSource, evidenceSourcePath, contract.keyEvidence.sourceSymbol)
        : consumerSource;
      if (contract.keyEvidence.sourceSymbol) {
        const referenceSymbol =
          contract.keyEvidence.consumerReferenceSymbol ?? contract.keyEvidence.sourceSymbol;
        expect(consumerSource, `${contract.id}:${referenceSymbol}`).toContain(referenceSymbol);
      }

      for (const key of contract.keys) {
        if (contract.keyEvidence.kind === 'registry') {
          const keyName = keyNames.get(key);
          expect(keyName, key).toBeDefined();
          expect(evidenceSource, `${contract.id}:${key}`).toContain(
            `${contract.keyEvidence.namespace}.${keyName}`,
          );
        } else if (contract.keyEvidence.kind === 'literal') {
          expect(evidenceSource, `${contract.id}:${key}`).toContain(key);
        } else {
          expect(key.startsWith(contract.keyEvidence.prefix), key).toBe(true);
          expect(evidenceSource, `${contract.id}:${key}`).toContain(contract.keyEvidence.prefix);
        }
      }
    }

    for (const setting of APP_SETTINGS_CATALOG) {
      const expected = contracts
        .filter((contract) => contract.keys.includes(setting.key))
        .map(({ id, sourcePath, symbol }) => ({ id, sourcePath, symbol }));
      expect(setting.runtimeConsumers, setting.key).toEqual(
        setting.lifecycle === 'active' ? expected : [],
      );
    }

    const cronConsumerPaths = catalogItem(APP_SETTING_KEYS.cronSecret).runtimeConsumers.map(
      (consumer: any) => consumer.sourcePath,
    );
    expect(cronConsumerPaths).toEqual(
      expect.arrayContaining([
        'src/app/(backend)/api/admin/desktop-release/auth.ts',
        'src/app/(backend)/api/admin/maintenance/route.ts',
      ]),
    );
    expect(catalogItem(APP_SETTING_KEYS.cronSecret).runtimeConsumers).toContainEqual({
      id: 'desktop-release-legacy-authentication',
      sourcePath: 'src/app/(backend)/api/admin/desktop-release/auth.ts',
      symbol: 'resolveDesktopReleaseToken',
    });
    expect(catalogItem(APP_SETTING_KEYS.referralRewardCredits).runtimeConsumers).toContainEqual(
      expect.objectContaining({
        sourcePath: 'packages/database/src/models/commercial.ts',
        symbol: 'resolveReferralRewardCredits',
      }),
    );
  });
});
